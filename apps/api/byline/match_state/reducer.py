"""Event-sourced match state.

``MatchState.apply`` consumes events strictly in sequence order. Duplicates (same id + seq)
are ignored (exactly-once), gaps raise ``SequenceGap`` so the journal can buffer/backfill,
and domain violations raise ``DomainError`` without mutating state. Seeking is a rebuild
from the immutable log (``replay``), never an in-place undo.
"""

from __future__ import annotations

import copy
from dataclasses import dataclass, field
from typing import Any, Literal

from byline.events.models import MatchEvent
from byline.world.clock import broadcast_clock, minute_label
from byline.world.models import World


class DomainError(ValueError):
    def __init__(self, event_id: str, code: str, message: str) -> None:
        super().__init__(f"{event_id}: [{code}] {message}")
        self.event_id, self.code, self.detail = event_id, code, message


class SequenceGap(ValueError):
    def __init__(self, expected: int, got: int) -> None:
        super().__init__(f"expected seq {expected}, got {got}")
        self.expected, self.got = expected, got


ApplyResult = Literal["applied", "duplicate"]
_NO_ROLLBACK = {"world", "applied", "_payload_index"}

ON_BALL = {
    "pass.completed", "pass.failed", "carry", "shot", "interception", "ball_recovery", "tackle", "restart.taken",
    "kickoff", "penalty.taken", "save",
}
ACTOR_MUST_BE_ON_PITCH = ON_BALL | {
    "pressure", "challenge", "foul.committed", "goal.provisional", "offside.position_detected", "turnover",
}


@dataclass
class GoalRecord:
    goal_event_id: str
    team_id: str
    scorer_id: str | None
    minute: str
    elapsed_ms: int
    status: Literal["provisional", "confirmed", "disallowed"] = "provisional"
    decided_by_event_id: str | None = None
    situation: str = "open_play"


@dataclass
class CardRecord:
    card_event_id: str
    team_id: str
    player_id: str
    colour: Literal["yellow", "second_yellow", "red"]
    minute: str
    reason: str
    status: Literal["active", "rescinded"] = "active"


@dataclass
class TeamSheet:
    formation: str = ""
    on_pitch: dict[str, str] = field(default_factory=dict)  # slot -> player_id
    bench: list[str] = field(default_factory=list)
    used_subs: int = 0
    off: list[str] = field(default_factory=list)
    sent_off: list[str] = field(default_factory=list)


@dataclass
class TeamStats:
    passes: int = 0
    passes_completed: int = 0
    shots: int = 0
    shots_on_target: int = 0
    fouls: int = 0
    corners: int = 0
    offsides: int = 0
    # V4 additions (new keys only; existing keys keep their meaning)
    shots_off_target: int = 0  # shot outcome off_target or woodwork
    shots_blocked: int = 0
    saves: int = 0  # save events by this team's goalkeeper
    throw_ins: int = 0  # restart.awarded throw_in to this team
    goal_kicks: int = 0
    free_kicks: int = 0  # direct + indirect free kicks awarded to this team
    tackles: int = 0
    interceptions: int = 0
    possession_ms: int = 0  # in-play time between events while this team had the ball (approximate)


ACTIVE_PHASES = ("FIRST_HALF_ACTIVE", "SECOND_HALF_ACTIVE")
IN_PLAY = ("PLAYING", "ADVANTAGE_ACTIVE")


class MatchState:
    def __init__(self, world: World) -> None:
        self.world = world
        self.match_id = world.fixture.match_id
        self.home = world.fixture.home_team_id
        self.away = world.fixture.away_team_id
        self.max_subs = world.fixture.ruleset.max_substitutions
        self.last_seq = -1
        self.applied: dict[str, int] = {}
        self.elapsed_ms = 0
        self.period = "PRE"
        self.period_start_ms = 0
        self.phase = "PRE_MATCH"
        self.play_state = "STOPPED"
        self.attacking_direction: dict[str, str] = {}
        self.score: dict[str, int] = {self.home: 0, self.away: 0}
        self.goals: list[GoalRecord] = []
        self.cards: list[CardRecord] = []
        self.yellows: dict[str, int] = {}
        self.sheets: dict[str, TeamSheet] = {self.home: TeamSheet(), self.away: TeamSheet()}
        self.stats: dict[str, TeamStats] = {self.home: TeamStats(), self.away: TeamStats()}
        self.possession_team: str | None = None
        self.possession_id = 0
        self.pending_restart: dict[str, Any] | None = None
        self.var_review: dict[str, Any] | None = None
        self.advantage_foul_id: str | None = None
        self.last_conceding_team: str | None = None
        self.last_event_id: str | None = None
        self.finished = False
        self._payload_index: dict[str, dict[str, Any]] = {}
        self._last_award: dict[str, Any] | None = None

    # ------------------------------------------------------------ helpers

    def on_pitch(self, player_id: str) -> bool:
        return any(player_id in s.on_pitch.values() for s in self.sheets.values())

    def team_of(self, player_id: str) -> str:
        return self.world.player(player_id).team_id

    def clock(self) -> str:
        return broadcast_clock(self.period, self.elapsed_ms - self.period_start_ms)

    def minute(self) -> str:
        return minute_label(self.period, self.elapsed_ms - self.period_start_ms)

    @property
    def provisional_score(self) -> dict[str, int]:
        s = dict(self.score)
        for g in self.goals:
            if g.status == "provisional":
                s[g.team_id] += 1
        return s

    # ------------------------------------------------------------ apply

    def apply(self, ev: MatchEvent) -> ApplyResult:
        if ev.match_id != self.match_id:
            raise DomainError(ev.event_id, "wrong_match", f"event for {ev.match_id}")
        if ev.event_id in self.applied:
            if self.applied[ev.event_id] == ev.seq:
                return "duplicate"
            raise DomainError(ev.event_id, "id_conflict", "event id reused with a different seq")
        if ev.seq <= self.last_seq:
            raise DomainError(ev.event_id, "seq_conflict", f"seq {ev.seq} already used by another event")
        if ev.seq != self.last_seq + 1:
            raise SequenceGap(self.last_seq + 1, ev.seq)
        if self.finished:
            raise DomainError(ev.event_id, "after_full_time", "no events after match.finished")
        self._validate_refs(ev)
        snapshot = {k: copy.deepcopy(v) for k, v in self.__dict__.items() if k not in _NO_ROLLBACK}
        try:
            self._reduce(ev)
        except DomainError:
            self.__dict__.update(snapshot)
            raise
        self._payload_index[ev.event_id] = ev.payload
        if ev.type == "restart.awarded":
            self._last_award = {"restart_type": ev.payload["restart_type"],
                                "team_id": ev.payload["awarded_to_team_id"]}
        elif ev.type in ("restart.taken", "kickoff", "penalty.taken"):
            self._last_award = None
        self.applied[ev.event_id] = ev.seq
        self.last_seq = ev.seq
        self.elapsed_ms = max(self.elapsed_ms, ev.elapsed_ms)
        self.last_event_id = ev.event_id
        return "applied"

    def _validate_refs(self, ev: MatchEvent) -> None:
        if ev.team_id is not None and ev.team_id not in self.sheets:
            raise DomainError(ev.event_id, "unknown_team", ev.team_id)
        if ev.player_id is not None:
            if not self.world.has_player(ev.player_id):
                raise DomainError(ev.event_id, "unknown_player", ev.player_id)
            if ev.team_id is not None and self.team_of(ev.player_id) != ev.team_id:
                raise DomainError(ev.event_id, "player_team_mismatch", f"{ev.player_id} not in {ev.team_id}")
        for key in ("receiver_player_id", "victim_player_id", "player_off_id", "player_on_id", "goalkeeper_id",
                    "opponent_player_id", "assist_player_id", "intended_receiver_player_id"):
            pid = ev.payload.get(key)
            if pid is not None and not self.world.has_player(pid):
                raise DomainError(ev.event_id, "unknown_player", f"{key}={pid}")
        if ev.elapsed_ms < self.elapsed_ms:
            raise DomainError(ev.event_id, "time_regression", "elapsed_ms went backwards")

    def _require_on_pitch(self, ev: MatchEvent, pid: str | None, what: str) -> None:
        if pid is None:
            return
        for sheet in self.sheets.values():
            if pid in sheet.sent_off:
                raise DomainError(ev.event_id, "dismissed_player", f"{what} {pid} was sent off")
            if pid in sheet.off:
                raise DomainError(ev.event_id, "substituted_player", f"{what} {pid} was substituted off")
        if not self.on_pitch(pid):
            raise DomainError(ev.event_id, "not_on_pitch", f"{what} {pid} is not on the pitch")

    def _reduce(self, ev: MatchEvent) -> None:
        t = ev.type
        p = ev.payload
        if self.possession_team is not None and self.phase in ACTIVE_PHASES and self.play_state in IN_PLAY:
            self.stats[self.possession_team].possession_ms += max(0, ev.elapsed_ms - self.elapsed_ms)
        if t in ACTOR_MUST_BE_ON_PITCH:
            if self.phase not in ("FIRST_HALF_ACTIVE", "SECOND_HALF_ACTIVE"):
                raise DomainError(ev.event_id, "ball_not_in_play_period", f"{t} outside an active period")
            self._require_on_pitch(ev, ev.player_id, "actor")
        if t == "pass.completed":
            self._require_on_pitch(ev, p["receiver_player_id"], "receiver")
            if self.team_of(p["receiver_player_id"]) != ev.team_id:
                raise DomainError(ev.event_id, "receiver_wrong_team", "completed pass to an opponent")
        if t in ON_BALL and ev.team_id is not None:
            self._possess(ev.team_id, new=t in ("restart.taken", "kickoff", "penalty.taken"))
            if t in ("restart.taken", "kickoff", "penalty.taken"):
                self.pending_restart = None
                self.play_state = "PLAYING"

        handler = getattr(self, "_on_" + t.replace(".", "_"), None)
        if handler is not None:
            handler(ev)

    def _possess(self, team: str, new: bool = False) -> None:
        if team != self.possession_team or new:
            self.possession_id += 1
            self.possession_team = team

    # ------------------------------------------------------------ handlers

    def _on_lineup_confirmed(self, ev: MatchEvent) -> None:
        assert ev.team_id is not None
        sheet = self.sheets[ev.team_id]
        if sheet.on_pitch:
            raise DomainError(ev.event_id, "lineup_twice", "lineup already confirmed")
        starters = {s["slot"]: s["player_id"] for s in ev.payload["starters"]}
        for pid in [*starters.values(), *ev.payload["bench"]]:
            if self.team_of(pid) != ev.team_id:
                raise DomainError(ev.event_id, "lineup_wrong_team", pid)
        if len(set(starters.values())) != 11:
            raise DomainError(ev.event_id, "lineup_size", "starting XI must be 11 distinct players")
        sheet.formation = ev.payload["formation"]
        sheet.on_pitch = starters
        sheet.bench = list(ev.payload["bench"])

    def _on_period_started(self, ev: MatchEvent) -> None:
        expected = {"H1": "PRE_MATCH", "H2": "HALF_TIME"}
        if ev.period not in expected or self.phase != expected[ev.period]:
            raise DomainError(ev.event_id, "bad_period_transition", f"{self.phase} -> {ev.period}")
        if any(not s.on_pitch for s in self.sheets.values()):
            raise DomainError(ev.event_id, "no_lineup", "both lineups must be confirmed before kick-off")
        self.period = ev.period
        self.period_start_ms = ev.elapsed_ms
        self.phase = "FIRST_HALF_ACTIVE" if ev.period == "H1" else "SECOND_HALF_ACTIVE"
        self.attacking_direction = dict(ev.payload["attacking_direction"])
        self.play_state = "RESTART_AWARDED"

    def _on_period_ended(self, ev: MatchEvent) -> None:
        if self.phase == "FIRST_HALF_ACTIVE":
            self.phase, self.period = "HALF_TIME", "HT"
        elif self.phase == "SECOND_HALF_ACTIVE":
            self.phase, self.period = "FULL_TIME", "FT"
        else:
            raise DomainError(ev.event_id, "bad_period_transition", f"period.ended during {self.phase}")
        self.play_state = "STOPPED"
        self.pending_restart = None

    def _on_match_finished(self, ev: MatchEvent) -> None:
        if self.phase != "FULL_TIME":
            raise DomainError(ev.event_id, "finish_before_full_time", "match.finished before second half ended")
        if any(g.status == "provisional" for g in self.goals):
            raise DomainError(ev.event_id, "pending_goal", "cannot finish with an undecided goal")
        if ev.payload["final_score"] != self.score:
            raise DomainError(ev.event_id, "final_score_mismatch", f"{ev.payload['final_score']} != {self.score}")
        self.finished = True

    def _on_kickoff(self, ev: MatchEvent) -> None:
        if ev.payload["reason"] == "after_goal" and ev.team_id != self.last_conceding_team:
            raise DomainError(ev.event_id, "wrong_kickoff_team", "the team that conceded kicks off")

    def _on_pass_completed(self, ev: MatchEvent) -> None:
        assert ev.team_id is not None
        st = self.stats[ev.team_id]
        st.passes += 1
        st.passes_completed += 1

    def _on_pass_failed(self, ev: MatchEvent) -> None:
        assert ev.team_id is not None
        self.stats[ev.team_id].passes += 1
        if ev.payload["outcome"] == "out_of_play":
            self.play_state = "STOPPED"

    def _on_shot(self, ev: MatchEvent) -> None:
        assert ev.team_id is not None
        st = self.stats[ev.team_id]
        st.shots += 1
        if ev.payload["outcome"] in ("goal", "saved"):
            st.shots_on_target += 1
        elif ev.payload["outcome"] in ("off_target", "woodwork"):
            st.shots_off_target += 1
        elif ev.payload["outcome"] == "blocked":
            st.shots_blocked += 1

    def _on_save(self, ev: MatchEvent) -> None:
        assert ev.team_id is not None
        self.stats[ev.team_id].saves += 1

    def _on_tackle(self, ev: MatchEvent) -> None:
        assert ev.team_id is not None
        self.stats[ev.team_id].tackles += 1

    def _on_interception(self, ev: MatchEvent) -> None:
        assert ev.team_id is not None
        self.stats[ev.team_id].interceptions += 1

    def _on_goal_provisional(self, ev: MatchEvent) -> None:
        assert ev.team_id is not None
        self.goals.append(GoalRecord(
            goal_event_id=ev.event_id, team_id=ev.team_id, scorer_id=ev.player_id, minute=self.minute_at(ev),
            elapsed_ms=ev.elapsed_ms, situation="penalty" if self.pending_penalty_kick else "open_play",
        ))
        self.play_state = "STOPPED"

    @property
    def pending_penalty_kick(self) -> bool:
        return bool(self.pending_restart and self.pending_restart.get("restart_type") == "penalty_in_play")

    def minute_at(self, ev: MatchEvent) -> str:
        return ev.display_clock or minute_label(ev.period, ev.elapsed_ms - self.period_start_ms)

    def _goal(self, ev: MatchEvent) -> GoalRecord:
        gid = ev.payload["goal_event_id"]
        for g in self.goals:
            if g.goal_event_id == gid:
                if g.status != "provisional":
                    raise DomainError(ev.event_id, "goal_already_decided", f"{gid} is {g.status}")
                return g
        raise DomainError(ev.event_id, "unknown_goal", gid)

    def _on_goal_confirmed(self, ev: MatchEvent) -> None:
        g = self._goal(ev)
        if self.var_review and self.var_review.get("subject_event_id") == g.goal_event_id:
            raise DomainError(ev.event_id, "var_pending", "goal cannot be confirmed while VAR check is open")
        g.status, g.decided_by_event_id = "confirmed", ev.event_id
        self.score[g.team_id] += 1
        self.last_conceding_team = self.world.opponent_of(g.team_id)

    def _on_goal_disallowed(self, ev: MatchEvent) -> None:
        g = self._goal(ev)
        g.status, g.decided_by_event_id = "disallowed", ev.event_id

    def _on_foul_committed(self, ev: MatchEvent) -> None:
        assert ev.team_id is not None
        self.stats[ev.team_id].fouls += 1
        p = ev.payload
        if p["restart_type"] == "penalty" and not p["in_offender_penalty_area"]:
            raise DomainError(ev.event_id, "penalty_outside_area", "penalty requires offence in own penalty area")
        if p["in_offender_penalty_area"] and p["restart_type"] == "direct_free_kick":
            raise DomainError(ev.event_id, "dfk_inside_own_area",
                              "a direct-free-kick offence by a defender in their own area is a penalty")
        if p.get("advantage_played"):
            self.advantage_foul_id = ev.event_id
            self.play_state = "ADVANTAGE_ACTIVE"
        else:
            self.play_state = "STOPPED"

    def _on_advantage_applied(self, ev: MatchEvent) -> None:
        self.play_state = "ADVANTAGE_ACTIVE"

    def _on_advantage_recalled(self, ev: MatchEvent) -> None:
        self.play_state = "STOPPED"

    def _card(self, ev: MatchEvent, colour: Literal["yellow", "second_yellow", "red"]) -> None:
        pid = ev.player_id
        assert pid is not None and ev.team_id is not None
        sheet = self.sheets[ev.team_id]
        if pid in sheet.sent_off:
            raise DomainError(ev.event_id, "already_dismissed", f"{pid} already sent off")
        is_participant = pid in sheet.on_pitch.values() or pid in sheet.bench or pid in sheet.off
        if not is_participant:
            raise DomainError(ev.event_id, "not_in_squad", pid)
        n = self.yellows.get(pid, 0)
        if colour == "yellow" and n >= 1:
            raise DomainError(ev.event_id, "second_caution_as_yellow", "a second caution must be card.second_yellow")
        if colour == "second_yellow" and n != 1:
            raise DomainError(ev.event_id, "second_yellow_without_first", "no prior caution recorded")
        self.cards.append(CardRecord(ev.event_id, ev.team_id, pid, colour, self.minute_at(ev),
                                     str(ev.payload.get("reason"))))
        if colour == "yellow":
            self.yellows[pid] = n + 1
            return
        if colour == "second_yellow":
            self.yellows[pid] = n + 1
        sheet.sent_off.append(pid)
        sheet.on_pitch = {s: p for s, p in sheet.on_pitch.items() if p != pid}
        if pid in sheet.bench:
            sheet.bench.remove(pid)

    def _on_card_yellow(self, ev: MatchEvent) -> None:
        self._card(ev, "yellow")

    def _on_card_second_yellow(self, ev: MatchEvent) -> None:
        self._card(ev, "second_yellow")

    def _on_card_red(self, ev: MatchEvent) -> None:
        self._card(ev, "red")

    def _on_disciplinary_reviewed(self, ev: MatchEvent) -> None:
        cid = ev.payload["card_event_id"]
        rec = next((c for c in self.cards if c.card_event_id == cid), None)
        if rec is None:
            raise DomainError(ev.event_id, "unknown_card", cid)
        if ev.payload["outcome"] == "upgraded":
            sheet = self.sheets[rec.team_id]
            if rec.colour != "yellow" or rec.player_id in sheet.sent_off:
                raise DomainError(ev.event_id, "bad_upgrade", "only an active caution can be upgraded")
            rec.status = "rescinded"
            self.cards.append(CardRecord(ev.event_id, rec.team_id, rec.player_id, "red", self.minute_at(ev),
                                         "upgraded_after_review"))
            sheet.sent_off.append(rec.player_id)
            sheet.on_pitch = {s: p for s, p in sheet.on_pitch.items() if p != rec.player_id}
            return
        if ev.payload["outcome"] == "rescinded":
            rec.status = "rescinded"
            sheet = self.sheets[rec.team_id]
            if rec.colour in ("red", "second_yellow") and rec.player_id in sheet.sent_off:
                raise DomainError(ev.event_id, "rescind_after_dismissal",
                                  "simulation does not restore a dismissed player mid-match")
            if rec.colour == "yellow":
                self.yellows[rec.player_id] = max(0, self.yellows.get(rec.player_id, 1) - 1)

    def _on_substitution(self, ev: MatchEvent) -> None:
        assert ev.team_id is not None
        sheet = self.sheets[ev.team_id]
        off, on = ev.payload["player_off_id"], ev.payload["player_on_id"]
        if sheet.used_subs >= self.max_subs:
            raise DomainError(ev.event_id, "too_many_subs", f"max {self.max_subs}")
        if off not in sheet.on_pitch.values():
            raise DomainError(ev.event_id, "sub_off_not_on_pitch", off)
        if on not in sheet.bench:
            raise DomainError(ev.event_id, "sub_on_not_on_bench", on)
        if ev.player_id != on:
            raise DomainError(ev.event_id, "sub_actor_mismatch", "player_id must be the incoming player")
        slot = next(s for s, p in sheet.on_pitch.items() if p == off)
        sheet.on_pitch[slot] = on
        sheet.bench.remove(on)
        sheet.off.append(off)
        sheet.used_subs += 1

    def _on_offside_offence_confirmed(self, ev: MatchEvent) -> None:
        assert ev.team_id is not None
        if ev.payload["decision_event_id"] not in self.applied:
            raise DomainError(ev.event_id, "unknown_decision_event", ev.payload["decision_event_id"])
        self.stats[ev.team_id].offsides += 1
        self.play_state = "STOPPED"

    def _on_restart_awarded(self, ev: MatchEvent) -> None:
        p = ev.payload
        rt = p["restart_type"]
        reason_id = p.get("reason_event_id")
        if rt == "dropped_ball" and self.play_state != "INJURY_STOPPAGE" and reason_id is None:
            raise DomainError(ev.event_id, "dropped_ball_without_stoppage", "dropped ball needs a stoppage")
        if rt == "penalty":
            foul = self._find_event_payload(reason_id)
            if foul is None or foul.get("restart_type") != "penalty":
                raise DomainError(ev.event_id, "penalty_without_offence", "penalty needs a penalty-area offence")
        st = self.stats[p["awarded_to_team_id"]]
        if rt == "corner":
            st.corners += 1
        elif rt == "throw_in":
            st.throw_ins += 1
        elif rt == "goal_kick":
            st.goal_kicks += 1
        elif rt in ("direct_free_kick", "indirect_free_kick"):
            st.free_kicks += 1
        self.pending_restart = {"restart_type": rt, "team_id": p["awarded_to_team_id"], "event_id": ev.event_id}
        self.play_state = "RESTART_AWARDED"
        if self.advantage_foul_id:
            self.advantage_foul_id = None

    def event_payload(self, event_id: str) -> dict[str, Any] | None:
        return self._payload_index.get(event_id)

    def _find_event_payload(self, event_id: str | None) -> dict[str, Any] | None:
        if event_id is None:
            return None
        return self._payload_index.get(event_id)

    def _on_restart_taken(self, ev: MatchEvent) -> None:
        pr = self._last_award
        if pr is None:
            raise DomainError(ev.event_id, "restart_not_awarded", "restart.taken without restart.awarded")

    def _on_penalty_taken(self, ev: MatchEvent) -> None:
        pr = self._last_award
        if pr is None or pr["restart_type"] != "penalty" or pr["team_id"] != ev.team_id:
            raise DomainError(ev.event_id, "penalty_not_awarded", "no penalty awarded to this team")
        self.pending_restart = {"restart_type": "penalty_in_play", "team_id": ev.team_id, "event_id": ev.event_id}

    def _on_penalty_outcome(self, ev: MatchEvent) -> None:
        self.pending_restart = None

    def _on_var_review_started(self, ev: MatchEvent) -> None:
        if self.var_review is not None:
            raise DomainError(ev.event_id, "var_already_open", "one VAR review at a time")
        self.var_review = {"subject_event_id": ev.payload["subject_event_id"], "check_type": ev.payload["check_type"],
                           "started_event_id": ev.event_id, "reason": ev.payload["reason"]}
        self.play_state = "VAR_REVIEW"

    def _on_var_review_outcome(self, ev: MatchEvent) -> None:
        if self.var_review is None or self.var_review["subject_event_id"] != ev.payload["subject_event_id"]:
            raise DomainError(ev.event_id, "var_not_open", "no matching VAR review")
        self.var_review = None
        self.play_state = "STOPPED"

    def _on_injury_stoppage(self, ev: MatchEvent) -> None:
        self.play_state = "INJURY_STOPPAGE"

    # ------------------------------------------------------------ snapshot

    def stats_view(self) -> dict[str, dict[str, Any]]:
        """Per-team stats: the TeamStats counters plus values derived from cards, sheets and possession time.
        yellow_cards counts active first cautions; red_cards counts dismissals (second yellow or straight red).
        possession_pct is each team's share of possession_ms (None before any in-play time)."""
        total = sum(s.possession_ms for s in self.stats.values())
        home_pct = round(100 * self.stats[self.home].possession_ms / total) if total else None
        out: dict[str, dict[str, Any]] = {}
        for t, s in self.stats.items():
            d: dict[str, Any] = s.__dict__.copy()
            active = [c for c in self.cards if c.team_id == t and c.status == "active"]
            d["yellow_cards"] = sum(1 for c in active if c.colour == "yellow")
            d["red_cards"] = sum(1 for c in active if c.colour in ("second_yellow", "red"))
            d["substitutions"] = self.sheets[t].used_subs
            d["possession_pct"] = None if home_pct is None else (home_pct if t == self.home else 100 - home_pct)
            out[t] = d
        return out

    def snapshot(self) -> dict[str, Any]:
        def sheet(team: str) -> dict[str, Any]:
            s = self.sheets[team]
            return {"formation": s.formation, "on_pitch": dict(s.on_pitch), "bench": list(s.bench),
                    "used_subs": s.used_subs, "off": list(s.off), "sent_off": list(s.sent_off)}

        return {
            "match_id": self.match_id,
            "seq": self.last_seq,
            "last_event_id": self.last_event_id,
            "elapsed_ms": self.elapsed_ms,
            "period": self.period,
            "phase": self.phase,
            "play_state": self.play_state,
            "clock": self.clock(),
            "minute": self.minute(),
            "score": dict(self.score),
            "provisional_score": self.provisional_score,
            "goals": [g.__dict__.copy() for g in self.goals],
            "cards": [c.__dict__.copy() for c in self.cards],
            "possession_team": self.possession_team,
            "possession_id": self.possession_id,
            "attacking_direction": dict(self.attacking_direction),
            "teams": {t: sheet(t) for t in self.sheets},
            "stats": self.stats_view(),
            "var_review": dict(self.var_review) if self.var_review else None,
            "pending_restart": dict(self.pending_restart) if self.pending_restart else None,
            "finished": self.finished,
        }


def replay(world: World, events: list[MatchEvent], upto_seq: int | None = None) -> MatchState:
    st = MatchState(world)
    for ev in events:
        if upto_seq is not None and ev.seq > upto_seq:
            break
        st.apply(ev)
    return st
