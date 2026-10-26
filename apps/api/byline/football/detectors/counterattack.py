"""D2: fast counterattack — ball won outside the final third, a shot within seconds.

Event-only. Uses measured elapsed time between the regain and the shot and the field
advancement in the team's attacking direction. Makes no claim about shape or intent.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from byline.events.models import MatchEvent
from byline.football.detectors.base import PatternCandidate
from byline.football.geometry import FINAL_THIRD_AX, to_attacking
from byline.match_state.reducer import MatchState

REGAIN_TYPES = {"interception", "tackle", "ball_recovery"}
MOVE_TYPES = {"pass.completed", "carry"}


@dataclass(frozen=True)
class D2Config:
    max_seconds: float = 12.0
    min_advance_m: float = 30.0
    min_actions: int = 2
    cooldown_ms: int = 4 * 60_000


@dataclass
class Transition:
    team_id: str
    possession_id: int
    regain: MatchEvent
    regain_ax: float
    actions: list[MatchEvent] = field(default_factory=list)


THIRD_NAME = {0: "defensive third", 1: "middle third"}


class CounterattackDetector:
    pattern_type = "counterattack"

    def __init__(self, config: D2Config | None = None) -> None:
        self.cfg = config or D2Config()
        self.open: Transition | None = None
        self.last_fired: dict[str, int] = {}

    def _ax(self, state: MatchState, team: str, x: float, y: float) -> float:
        return to_attacking(state.attacking_direction[team], x, y)[0]

    def observe(self, ev: MatchEvent, state: MatchState) -> list[PatternCandidate]:
        team = ev.team_id
        if ev.type in REGAIN_TYPES and team and team in state.attacking_direction:
            loc = ev.payload["location"]
            ax = self._ax(state, team, loc["x_m"], loc["y_m"])
            self.open = Transition(team, state.possession_id, ev, ax) if ax < FINAL_THIRD_AX else None
            return []
        t = self.open
        if t is None:
            return []
        expired = (ev.elapsed_ms - t.regain.elapsed_ms) / 1000.0 > self.cfg.max_seconds
        if expired or state.possession_id != t.possession_id or (team and team != t.team_id and ev.type in
                                                                   ("pass.completed", "pass.failed", "carry")):
            self.open = None
            return []
        if ev.type in MOVE_TYPES and team == t.team_id:
            t.actions.append(ev)
            return []
        if ev.type == "shot" and team == t.team_id:
            self.open = None
            return self._maybe_fire(ev, state, t)
        return []

    def _maybe_fire(self, shot: MatchEvent, state: MatchState, t: Transition) -> list[PatternCandidate]:
        cfg = self.cfg
        loc = shot.payload["location"]
        shot_ax = self._ax(state, t.team_id, loc["x_m"], loc["y_m"])
        advance = shot_ax - t.regain_ax
        seconds = (shot.elapsed_ms - t.regain.elapsed_ms) / 1000.0
        if advance < cfg.min_advance_m or len(t.actions) < cfg.min_actions or seconds > cfg.max_seconds:
            return []
        last = self.last_fired.get(t.team_id)
        if last is not None and shot.elapsed_ms - last < cfg.cooldown_ms:
            return []
        self.last_fired[t.team_id] = shot.elapsed_ms
        team_name = state.world.team(t.team_id).name
        regain_player = state.world.player(t.regain.player_id or "")
        regain_kind = t.regain.type.replace("_", " ")
        third = THIRD_NAME[0 if t.regain_ax < 35 else 1]
        outcome = shot.payload["outcome"]
        evidence = [t.regain.event_id, *[a.event_id for a in t.actions], shot.event_id]
        metrics: dict[str, float | int | str | bool] = {
            "seconds_regain_to_shot": round(seconds, 1),
            "metres_advanced": round(advance, 1),
            "passes_and_carries": len(t.actions),
            "regain_type": t.regain.type,
            "regain_zone": third,
            "shot_outcome": outcome,
            "regain_clock": t.regain.display_clock or "",
        }
        article = "an" if regain_kind[0] in "aeiou" else "a"
        summary = (f"{team_name} won the ball through {article} {regain_kind} by #{regain_player.shirt_number} "
                   f"{regain_player.display_name} in their {third} and shot {seconds:.1f} seconds later after "
                   f"{len(t.actions)} passes or carries, advancing {advance:.0f} metres (shot outcome: "
                   f"{outcome.replace('_', ' ')}).")
        score = round(min(1.0, (cfg.max_seconds - seconds) / cfg.max_seconds * 0.5 + min(advance, 70) / 140
                          + (0.2 if outcome == "goal" else 0.1 if outcome == "saved" else 0.0)), 3)
        return [PatternCandidate(
            candidate_id=f"P-D2-{t.team_id}-{shot.seq:04d}",
            match_id=state.match_id, pattern_type="counterattack", team_id=t.team_id,
            detected_at_seq=shot.seq, detected_at_ms=shot.elapsed_ms,
            display_clock=shot.display_clock or state.minute(),
            window_start_ms=t.regain.elapsed_ms, window_end_ms=shot.elapsed_ms,
            evidence_event_ids=tuple(evidence), calculated_metrics=metrics,
            score_components={"speed": round((cfg.max_seconds - seconds) / cfg.max_seconds, 3),
                              "advance": round(min(advance, 70) / 70, 3)},
            score=score,
            confidence_band="supported",
            novelty_key=f"counterattack:{t.team_id}:{t.regain.event_id}",
            factual_summary=summary,
            allowed_claims=(
                "A quick transition followed the regain and created a shot.",
                "Seconds from regain to shot, metres advanced and number of actions.",
            ),
            unsupported_claims=(
                "Any claim that the opposition was out of shape or caught out of position (no shape data used).",
                "Any claim about a planned or rehearsed counter-attacking strategy.",
                "Any claim about a change of formation.",
            ),
            explanation_constraints=(
                f"Regain outside the final third, shot within {cfg.max_seconds:.0f} s, at least "
                f"{cfg.min_advance_m:.0f} m advanced in the team's attacking direction, at least "
                f"{cfg.min_actions} passes or carries.",
                "Times are measured from event timestamps in the synthetic log.",
            ),
        )]
