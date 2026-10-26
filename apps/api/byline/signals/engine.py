"""Signal engine: turns official events, storylines, tactical moments and context facts into a small,
prioritised stream that each audience can trust.

  tier      alert (goals, cards, substitutions, VAR, penalties, milestones) · insight (tactical
            developments, published stories, records) · quiet (emerging trends, routine tactical notes)
  dedup     one stable signal_id per real-world thing; content changes bump the version, never a new id
  suppress  a quiet or insight signal of the same kind and team inside its window is folded into the
            previous one (counted), so users are not shown the same idea repeatedly
  correct   a VAR decision is a new version of the same signal (status "corrected" or "withdrawn"),
            and any signal whose evidence includes the voided goal is withdrawn with the official reason
  route     every signal carries per-audience text; audiences filter by tier and kind

Deterministic: the engine is driven event by event inside MatchIntelligence, so a seek rebuilds it exactly.
"""

from __future__ import annotations

from collections.abc import Callable, Sequence
from dataclasses import dataclass, field
from typing import Any, Literal

from byline.events.models import MatchEvent
from byline.football.storylines import Storyline
from byline.match_state.reducer import MatchState
from byline.tactics.moments import TacticalMoment

Tier = Literal["alert", "insight", "quiet"]
Audience = Literal["commentator", "studio", "fan"]
TIER_RANK = {"alert": 0, "insight": 1, "quiet": 2}

# suppression windows (match time) for repeated ideas of the same kind and team
SUPPRESS_MS: dict[str, int] = {"tactical:line_break": 10 * 60_000, "tactical:between_lines": 10 * 60_000,
                               "tactical:beaten": 8 * 60_000, "tactical:run": 8 * 60_000,
                               "tactical:high_turnover": 6 * 60_000, "storyline:quiet": 0}
# tactical kinds worth an insight (the rest stay quiet notes for professionals)
INSIGHT_KINDS = {"option", "overload", "foul_stops_attack", "high_turnover", "shape_change", "press", "stretched", "response"}


@dataclass
class Signal:
    signal_id: str
    kind: str  # goal | card | substitution | var | penalty | milestone | record | context | storyline | tactical
    tier: Tier
    team_id: str | None
    at_ms: int
    seq: int
    display_clock: str
    headline: str
    text: dict[str, str]  # audience -> sentence
    audiences: list[Audience]
    refs: dict[str, Any] = field(default_factory=dict)  # event_ids, moment_id, storyline_id, fact_id
    evidence_event_ids: list[str] = field(default_factory=list)
    status: Literal["live", "corrected", "withdrawn"] = "live"
    status_reason: str | None = None
    version: int = 1
    folded: int = 0  # how many similar signals were suppressed into this one
    actions: list[str] = field(default_factory=list)  # e.g. "show_why", "what_if", "research"

    def to_json(self) -> dict[str, Any]:
        return {
            "signal_id": self.signal_id, "kind": self.kind, "tier": self.tier, "team_id": self.team_id,
            "at_ms": self.at_ms, "seq": self.seq, "display_clock": self.display_clock, "headline": self.headline,
            "text": self.text, "audiences": self.audiences, "refs": self.refs,
            "evidence_event_ids": self.evidence_event_ids, "status": self.status, "status_reason": self.status_reason,
            "version": self.version, "folded": self.folded, "actions": self.actions,
        }


ContextSource = Callable[[Sequence[MatchEvent]], Sequence[Any]]
CONTEXT_TRIGGERS = {"lineup.confirmed", "goal.confirmed", "goal.disallowed", "substitution", "card.yellow",
                    "card.second_yellow", "card.red", "match.finished", "period.ended"}


class SignalEngine:
    def __init__(self, match_id: str, context_source: ContextSource | None = None) -> None:
        self.match_id = match_id
        self.context_source = context_source
        self.signals: dict[str, Signal] = {}
        self.changed: list[Signal] = []
        self._last_kind: dict[tuple[str, str | None], str] = {}  # (kind key, team) -> signal_id
        self._events: list[MatchEvent] = []
        self._fact_text: dict[str, str] = {}  # fact_id -> last text surfaced

    # ------------------------------------------------------------- bookkeeping
    def _put(self, s: Signal) -> Signal:
        old = self.signals.get(s.signal_id)
        if old is not None:
            if old.to_json() | {"version": 0} == s.to_json() | {"version": 0}:
                return old
            s.version = old.version + 1
            s.folded = max(s.folded, old.folded)
        self.signals[s.signal_id] = s
        if s not in self.changed:
            self.changed.append(s)
        return s

    def _suppressed(self, key: str, team: str | None, at_ms: int) -> Signal | None:
        """The earlier signal this one folds into, if inside its suppression window."""
        window = SUPPRESS_MS.get(key)
        sid = self._last_kind.get((key, team))
        if window is None or sid is None:
            return None
        prev = self.signals.get(sid)
        if prev is None or at_ms - prev.at_ms > window:
            return None
        return prev

    def _text(self, commentator: str, fan: str | None = None, studio: str | None = None) -> dict[str, str]:
        return {"commentator": commentator, "studio": studio or commentator, "fan": fan or commentator}

    # ------------------------------------------------------------- per event
    def observe(self, ev: MatchEvent, state: MatchState, storylines: Sequence[Storyline],
                moments: Sequence[TacticalMoment], retracted_evidence: set[str]) -> list[Signal]:
        self.changed = []
        self._events.append(ev)
        self._official(ev, state)
        for sl in storylines:
            self._storyline(sl, ev)
        for m in moments:
            self._tactical(m, state)
        if ev.type == "goal.disallowed" and retracted_evidence:
            self._withdraw_evidence(retracted_evidence, ev)
        if ev.type == "offside.offence_confirmed":
            self._withdraw_offside(ev)
        if self.context_source is not None and ev.type in CONTEXT_TRIGGERS:
            self._context(ev)
        return self.changed

    def _name(self, state: MatchState, pid: str | None) -> str:
        if not pid:
            return ""
        try:
            return state.world.player(pid).display_name
        except KeyError:
            return pid

    def _official(self, ev: MatchEvent, st: MatchState) -> None:
        w = st.world
        team = w.team(ev.team_id).short_name if ev.team_id else ""
        who = self._name(st, ev.player_id)
        score = f"{w.home.short_name} {st.provisional_score[w.home.team_id]}–{st.provisional_score[w.away.team_id]} " \
                f"{w.away.short_name}"
        base: dict[str, Any] = {"team_id": ev.team_id, "at_ms": ev.elapsed_ms, "seq": ev.seq,
                                "display_clock": ev.display_clock or ""}
        if ev.type == "goal.provisional":
            self._put(Signal(f"sig-goal-{ev.event_id}", "goal", "alert", headline=f"GOAL · {score}",
                             text=self._text(f"{who} scores for {team}. {score}, awaiting confirmation.",
                                             f"Goal for {team}! {who} scores. {score}."),
                             audiences=["commentator", "studio", "fan"], evidence_event_ids=[ev.event_id],
                             refs={"event_id": ev.event_id, **({"player_id": ev.player_id} if ev.player_id else {})},
                             actions=["show_why"], **base))
        elif ev.type == "goal.confirmed":
            sid = f"sig-goal-{ev.payload['goal_event_id']}"
            prev = self.signals.get(sid)
            if prev is not None:
                s = Signal(**{**prev.__dict__})
                # the provisional wording ("awaiting confirmation") must not outlive the confirmation
                scorer = self._name(st, str(prev.refs["player_id"])) if prev.refs.get("player_id") else ""
                scorer_team = w.team(prev.team_id).short_name if prev.team_id else team
                s.text = self._text(f"{scorer} scores for {scorer_team}. {score}, confirmed at {ev.display_clock}.",
                                    f"Goal for {scorer_team}! {scorer} scores. {score}.")
                s.headline = f"GOAL · {score}"  # a 'VAR CHECK' headline must not outlive the check either
                s.status_reason = "Confirmed"
                self._put(s)
        elif ev.type == "goal.disallowed":
            sid = f"sig-goal-{ev.payload['goal_event_id']}"
            prev = self.signals.get(sid)
            reason = str(ev.payload.get("reason", "")).replace("_", " ")
            route = "after a VAR check" if ev.payload.get("decision_route") == "after_var_check" else "by the referee"
            retake = self._penalty_retake()
            if prev is not None:
                s = Signal(**{**prev.__dict__})
                s.status, s.tier = "corrected", "alert"
                if retake is not None:
                    # Law 14: a scored penalty touched twice by the kicker is retaken; it is not a foul
                    touch = str(retake.payload.get("touch", "")).replace("_", " ")
                    s.headline = "NO GOAL · penalty to be retaken"
                    s.status_reason = (f"Ruled out {route}: {touch} by the kicker, so the penalty is retaken "
                                       f"({ev.payload.get('law_ref')}) at {ev.display_clock}.")
                    s.text = self._text(f"Goal ruled out: {touch} by the kicker, the penalty is retaken "
                                        f"({ev.payload.get('law_ref')}). Score stays {score}.",
                                        f"No goal yet: the penalty is retaken after a {touch}. Still {score}.")
                    s.evidence_event_ids = [*prev.evidence_event_ids, retake.event_id, ev.event_id]
                else:
                    s.headline = f"NO GOAL · disallowed for {reason}"
                    s.status_reason = (f"Disallowed for {reason} {route} ({ev.payload.get('law_ref')}) at "
                                       f"{ev.display_clock}.")
                    s.text = self._text(f"Goal ruled out for {reason} {route}. Score stays {score}.",
                                        f"No goal: ruled out for {reason} {route}. Still {score}.")
                    s.evidence_event_ids = [*prev.evidence_event_ids, ev.event_id]
                self._put(s)
        elif ev.type == "var.review_started":
            subj = ev.payload.get("subject_event_id")
            sid = f"sig-goal-{subj}" if f"sig-goal-{subj}" in self.signals else f"sig-var-{ev.event_id}"
            prev = self.signals.get(sid)
            check = str(ev.payload.get("reason", "VAR check"))
            if prev is not None:
                s = Signal(**{**prev.__dict__})
                s.headline = f"VAR CHECK · {prev.headline.split(' · ', 1)[-1]}"
                s.status_reason = f"VAR checking: {check.lower()}"
                s.text = self._text(f"VAR is checking the goal: {check.lower()}. Do not call the score yet.",
                                    f"VAR is checking the goal ({check.lower()}).")
                self._put(s)
            else:
                self._put(Signal(sid, "var", "alert", headline="VAR CHECK", text=self._text(f"VAR check: {check}."),
                                 audiences=["commentator", "studio", "fan"], evidence_event_ids=[ev.event_id], **base))
        elif ev.type in ("card.yellow", "card.second_yellow", "card.red"):
            label = {"card.yellow": "YELLOW CARD", "card.second_yellow": "SECOND YELLOW · SENT OFF",
                     "card.red": "RED CARD"}[ev.type]
            self._put(Signal(f"sig-card-{ev.event_id}", "card", "alert", headline=f"{label} · {who}",
                             text=self._text(f"{label.title()} for {who} ({team}).", f"{label.title()} for {who}."),
                             audiences=["commentator", "studio", "fan"], evidence_event_ids=[ev.event_id],
                             refs={"event_id": ev.event_id, "player_id": ev.player_id}, actions=["research"], **base))
        elif ev.type == "substitution":
            on = self._name(st, ev.payload.get("player_on_id"))
            off = self._name(st, ev.payload.get("player_off_id"))
            self._put(Signal(f"sig-sub-{ev.event_id}", "substitution", "alert", headline=f"SUBSTITUTION · {team}",
                             text=self._text(f"{team}: {on} on for {off}.", f"Change for {team}: {on} comes on for {off}."),
                             audiences=["commentator", "studio", "fan"], evidence_event_ids=[ev.event_id],
                             refs={"event_id": ev.event_id, "player_id": ev.payload.get("player_on_id")},
                             actions=["research"], **base))
        elif ev.type == "penalty.outcome" and ev.payload.get("outcome") != "scored":  # a goal has its own alert
            outcome = str(ev.payload.get("outcome", "")).replace("_", " ")
            self._put(Signal(f"sig-pen-{ev.event_id}", "penalty", "alert", headline=f"PENALTY · {outcome.upper()}",
                             text=self._text(f"Penalty {outcome} ({who}, {team})."), audiences=["commentator", "studio", "fan"],
                             evidence_event_ids=[ev.event_id], **base))

    def _storyline(self, sl: Storyline, ev: MatchEvent) -> None:
        if sl.state == "RESOLVED" and f"sig-{sl.storyline_id}" not in self.signals:
            return  # a watch that faded before anyone was told about it stays silent
        tier: Tier = "insight" if sl.state in ("STRONG", "CONFIRMED") else "quiet"
        sid = f"sig-{sl.storyline_id}"
        prev = self.signals.get(sid)
        if prev is not None and prev.tier == "insight" and tier == "quiet" and sl.state != "RESOLVED":
            tier = "insight"  # never demote silently; weakening is shown as a status line instead
        status: Literal["live", "corrected", "withdrawn"] = "live"
        reason = None
        if sl.withdrawn_candidate_ids:
            status = "corrected" if any(c not in sl.withdrawn_candidate_ids for c in sl.candidate_ids) else "withdrawn"
            reason = sl.history[-1].reason
        state_word = {"OBSERVING": "Watching", "DEVELOPING": "Building", "STRONG": "Story", "CONFIRMED": "Confirmed",
                      "WEAKENING": "Fading", "RESOLVED": "Over"}[sl.state]
        last = sl.history[-1]
        self._put(Signal(sid, "storyline", tier, team_id=sl.team_id, at_ms=last.at_ms, seq=last.seq,
                         display_clock=last.display_clock, headline=f"{state_word} · {sl.headline}",
                         text=self._text(last.reason, f"{sl.headline.split(': ', 1)[-1].capitalize()}."),
                         audiences=["commentator", "studio", "fan"] if tier != "quiet" else ["commentator"],
                         refs={"storyline_id": sl.storyline_id, "candidate_ids": list(sl.candidate_ids)},
                         evidence_event_ids=list(sl.evidence_event_ids)[-12:], status=status, status_reason=reason,
                         actions=["show_why"] if sl.candidate_ids else []))

    def _tactical(self, m: TacticalMoment, st: MatchState) -> None:
        key = f"tactical:{m.kind}"
        tier: Tier = "insight" if m.kind in INSIGHT_KINDS else "quiet"
        if m.kind == "high_turnover" and m.extra.get("shot_outcome") not in ("goal", "saved"):
            tier = "quiet"  # only regains that produced a goal or a shot on target are worth interrupting for
        prev = self._suppressed(key, m.team_id, m.at_ms) if tier == "quiet" else None
        if prev is not None:
            s = Signal(**{**prev.__dict__})
            s.folded = prev.folded + 1
            s.text = {**prev.text, "commentator": f"{prev.text['commentator']} (+{s.folded} similar)"
                      if "(+" not in prev.text["commentator"] else
                      prev.text["commentator"].rsplit(" (+", 1)[0] + f" (+{s.folded} similar)"}
            self._put(s)
            return
        audiences: list[Audience] = ["commentator", "studio", "fan"] if tier == "insight" else ["commentator", "fan"]
        s = self._put(Signal(
            f"sig-{m.moment_id}", "tactical", tier, team_id=m.team_id, at_ms=m.available_ms, seq=m.available_seq,
            display_clock=m.display_clock, headline=m.title,
            text=self._text(m.summary, str(m.extra.get("plain", m.summary)), m.title),
            audiences=audiences, refs={"moment_id": m.moment_id, "tactic": m.kind},
            evidence_event_ids=list(m.evidence_event_ids),
            actions=["show_why"] + (["what_if"] if m.whatif else [])))
        self._last_kind[(key, m.team_id)] = s.signal_id

    def _penalty_retake(self) -> MatchEvent | None:
        """The penalty.outcome 'retake' that the current goal.disallowed implements, if any (Law 14)."""
        for e in reversed(self._events[:-1]):
            if e.type == "penalty.outcome":
                return e if e.payload.get("outcome") == "retake" else None
            if e.type in ("penalty.taken", "restart.taken", "kickoff"):
                return None
        return None

    def _withdraw_offside(self, ev: MatchEvent) -> None:
        """Law 11: the pass that played an offside team-mate in, and the play after it, did not stand. A tactical
        signal that measures that pass (e.g. a line-breaking pass to the offside player) or the play after it is
        withdrawn with the official reason; play before the offending pass is untouched."""
        decision = str(ev.payload.get("decision_event_id") or "")
        ids = [e.event_id for e in self._events]
        if decision not in ids:
            return
        voided = set(ids[ids.index(decision):-1])
        self._withdraw_evidence(voided, ev, reason=(
            f"Withdrawn at {ev.display_clock}: it measures play ruled out for offside (the pass {decision} and what "
            f"followed it; Law 11, official event {ev.event_id})."), kinds={"tactical"})

    def _withdraw_evidence(self, voided: set[str], ev: MatchEvent, reason: str | None = None,
                           kinds: set[str] | None = None) -> None:
        reason = reason or (f"Withdrawn at {ev.display_clock}: its evidence includes the goal ruled out by the "
                            f"official decision ({ev.event_id}).")
        for s in list(self.signals.values()):
            if s.kind in ("goal",) or s.status == "withdrawn" or not voided & set(s.evidence_event_ids):
                continue
            if s.kind == "storyline" or (kinds is not None and s.kind not in kinds):
                continue  # storylines carry their own VAR-aware versioning
            c = Signal(**{**s.__dict__})
            c.status, c.status_reason = "withdrawn", reason
            c.evidence_event_ids = [*s.evidence_event_ids, ev.event_id]
            self._put(c)

    def _context(self, ev: MatchEvent) -> None:
        assert self.context_source is not None
        current = list(self.context_source(self._events))
        live_ids = {str(getattr(f, "fact_id", "")) for f in current}
        # a fact that no longer applies (a conditional projection after the score changed) is withdrawn, not left
        for fid in list(self._fact_text):
            sig = self.signals.get(f"sig-{fid}")
            if fid not in live_ids and sig is not None and sig.status == "live":
                c = Signal(**{**sig.__dict__})
                c.status, c.status_reason = "withdrawn", f"No longer applies after {ev.display_clock or 'the latest event'}."
                self._put(c)
        for f in current:
            fid = str(getattr(f, "fact_id", ""))
            text_now = str(getattr(f, "short_text", ""))
            if not fid or self._fact_text.get(fid) == text_now:
                continue  # never surface the same fact twice; a changed text is a new version below
            self._fact_text[fid] = text_now
            prio = str(getattr(f, "priority", "quiet"))
            tier: Tier = "alert" if prio == "alert" else "insight" if prio == "insight" else "quiet"
            category = str(getattr(f, "category", "context"))
            kind = "milestone" if category == "milestone" else "record" if category in ("record", "streak") else "context"
            text = str(getattr(f, "short_text", ""))
            subj_kind = str(getattr(f, "subject_kind", ""))
            subj = getattr(f, "subject_id", None)
            team = subj if subj_kind == "team" and isinstance(subj, str) else (subj.split("-")[0] if subj_kind == "player"
                                                                               and isinstance(subj, str) else None)
            self._put(Signal(
                f"sig-{fid}", kind, tier, team_id=team, at_ms=ev.elapsed_ms, seq=ev.seq,
                display_clock=ev.display_clock or "", headline=text if len(text) <= 60 else category.upper(),
                text=self._text(text), audiences=["commentator", "studio", "fan"] if tier != "quiet" else ["commentator"],
                refs={"fact_id": fid, "category": category, "rule": getattr(f, "rule", None), "subject_id": subj,
                      **({"player_id": subj} if subj_kind == "player" else {})},
                evidence_event_ids=[t for t in [getattr(f, "trigger_event_id", None)] if t],
                actions=["research"]))

    def snapshot(self) -> list[dict[str, Any]]:
        return [s.to_json() for s in sorted(self.signals.values(), key=lambda s: (s.at_ms, s.signal_id))]
