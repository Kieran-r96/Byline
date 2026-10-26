"""Persistent storylines: one evolving, versioned narrative per (team, pattern) instead of isolated alerts.

States: OBSERVING -> DEVELOPING -> STRONG -> CONFIRMED -> WEAKENING -> RESOLVED.

Everything is deterministic and measured. The publication gates are unchanged: a storyline reaches
STRONG only when the production detector publishes a candidate. Earlier states only report the
detector's own measurements (counts, shares, which gates already pass) and make no story claim.
Every change is a new version appended to the history. A VAR correction that voids a linked
candidate's evidence also arrives as a new version (append-only, like the event log).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal

from byline.events.models import MatchEvent
from byline.football.detectors.base import PatternCandidate
from byline.football.detectors.repeated_channel import CHANNEL_WORD, ChannelMeasure, RepeatedChannelDetector
from byline.match_state.reducer import MatchState

State = Literal["OBSERVING", "DEVELOPING", "STRONG", "CONFIRMED", "WEAKENING", "RESOLVED"]
ACTIVE: tuple[State, ...] = ("OBSERVING", "DEVELOPING", "STRONG", "CONFIRMED", "WEAKENING")
CHANNELS = ("left", "centre", "right")

# Display-only thresholds for the earliest stage. They never publish a story.
OBSERVE_MIN_ENTRIES = 4
OBSERVE_MIN_SHARE = 0.5
OBSERVE_MIN_POSSESSIONS = 2
OBSERVE_MAX_TAIL = 0.02  # already unusual against the team's own earlier spread
FADE_SHARE_MARGIN = 0.1  # hysteresis: a watched channel fades only clearly below the bar
MIN_DWELL_MS = 2 * 60_000
REMEASURE_MS = 30_000
# Event-pattern storylines (counterattacks, overlaps): a repeat within this time confirms; quiet means it fades.
REPEAT_CONFIRMS_MS = 20 * 60_000
WEAKEN_AFTER_MS = 10 * 60_000
RESOLVE_AFTER_MS = 20 * 60_000


@dataclass
class Version:
    version: int
    state: State
    at_ms: int
    seq: int
    display_clock: str
    reason: str
    metrics: dict[str, Any]


@dataclass
class Storyline:
    storyline_id: str
    match_id: str
    pattern_type: str
    team_id: str
    subject: str
    state: State
    opened_at_ms: int
    headline: str
    candidate_ids: list[str] = field(default_factory=list)
    evidence_event_ids: list[str] = field(default_factory=list)
    linked_storyline_ids: list[str] = field(default_factory=list)
    withdrawn_candidate_ids: list[str] = field(default_factory=list)
    history: list[Version] = field(default_factory=list)
    last_support_ms: int = 0
    # measurements of each linked event-pattern candidate, so a VAR withdrawal can re-measure what still stands
    candidate_metrics: dict[str, dict[str, Any]] = field(default_factory=dict)

    @property
    def version(self) -> int:
        return self.history[-1].version if self.history else 0

    @property
    def updated_at_ms(self) -> int:
        return self.history[-1].at_ms if self.history else self.opened_at_ms

    def to_json(self) -> dict[str, Any]:
        last = self.history[-1]
        return {
            "storyline_id": self.storyline_id, "match_id": self.match_id, "pattern_type": self.pattern_type,
            "team_id": self.team_id, "subject": self.subject, "state": self.state, "version": self.version,
            "opened_at_ms": self.opened_at_ms, "updated_at_ms": self.updated_at_ms,
            "display_clock": last.display_clock, "headline": self.headline, "reason": last.reason,
            "metrics": last.metrics, "candidate_ids": list(self.candidate_ids),
            "withdrawn_candidate_ids": list(self.withdrawn_candidate_ids),
            "evidence_event_ids": list(self.evidence_event_ids),
            "linked_storyline_ids": list(self.linked_storyline_ids),
            "history": [{"version": v.version, "state": v.state, "at_ms": v.at_ms, "seq": v.seq,
                         "display_clock": v.display_clock, "reason": v.reason} for v in self.history],
        }


def _channel_metrics(m: ChannelMeasure, cfg_window_ms: int) -> dict[str, Any]:
    return {
        "window_minutes": cfg_window_ms // 60_000,
        "channel_entries": len(m.ch),
        "total_entries": len(m.window),
        "channel_share": round(m.share, 3),
        "distinct_possessions": len(m.possessions),
        "dangerous_entries": len(m.dangerous),
        "gates_passed": sorted(g for g, ok in m.gates.items() if ok),
        "gates_pending": sorted(g for g, ok in m.gates.items() if not ok),
    }


class StorylineEngine:
    def __init__(self, match_id: str, channel_detector: RepeatedChannelDetector | None) -> None:
        self.match_id = match_id
        self.d1 = channel_detector
        self.storylines: list[Storyline] = []
        self.active: dict[tuple[str, str, str], Storyline] = {}  # (pattern, team, subject) -> storyline
        self.changed: list[Storyline] = []
        self._serial: dict[tuple[str, str, str], int] = {}
        self._last_measured: dict[tuple[str, str], int] = {}
        self._clock = ""

    # -- bookkeeping -------------------------------------------------------------------------------------
    def _open(self, pattern: str, team: str, subject: str, ev: MatchEvent, state: MatchState,
              headline: str) -> Storyline:
        key = (pattern, team, subject)
        n = self._serial.get(key, 0) + 1
        self._serial[key] = n
        sid = f"SL-{pattern}-{team}-{subject}-{n}".replace("_", "-")
        sl = Storyline(sid, self.match_id, pattern, team, subject, "OBSERVING", ev.elapsed_ms, headline,
                       last_support_ms=ev.elapsed_ms)
        self.storylines.append(sl)
        self.active[key] = sl
        return sl

    def _version(self, sl: Storyline, new_state: State, ev: MatchEvent, state: MatchState, reason: str,
                 metrics: dict[str, Any]) -> None:
        sl.state = new_state
        sl.history.append(Version(sl.version + 1, new_state, ev.elapsed_ms, ev.seq, self._clock, reason, metrics))
        if new_state == "RESOLVED":
            self.active.pop((sl.pattern_type, sl.team_id, sl.subject), None)
        if sl not in self.changed:
            self.changed.append(sl)

    # -- per event ---------------------------------------------------------------------------------------
    def observe(self, ev: MatchEvent, state: MatchState, found: list[PatternCandidate],
                retractions: dict[str, str], new_retractions: list[str]) -> list[Storyline]:
        self.changed = []
        self._clock = ev.display_clock or state.minute()
        if self.d1 is not None:
            self._channels(ev, state, found)
        for c in found:
            if c.pattern_type in ("counterattack", "overlap"):
                self._event_pattern(c, ev, state)
        for cid in new_retractions:
            self._withdraw(cid, retractions[cid], ev, state)
        self._decay(ev, state)
        if ev.type in ("period.ended", "match.finished"):
            for sl in list(self.active.values()):
                word = "full time" if ev.type == "match.finished" or state.period == "FT" else "the end of the half"
                self._version(sl, "RESOLVED", ev, state, f"Closed at {word}.", sl.history[-1].metrics)
        return self.changed

    def _channels(self, ev: MatchEvent, state: MatchState, found: list[PatternCandidate]) -> None:
        assert self.d1 is not None
        fired = {(c.team_id, str(c.calculated_metrics.get("channel"))): c for c in found
                 if c.pattern_type == "repeated_channel_attack"}
        relevant = ev.type in ("pass.completed", "carry", "shot", "offside.offence_confirmed")
        teams = list(state.attacking_direction)
        for team in teams:
            for channel in CHANNELS:
                key = ("repeated_channel_attack", team, channel)
                sl = self.active.get(key)
                due = ev.elapsed_ms - self._last_measured.get((team, channel), -REMEASURE_MS) >= REMEASURE_MS
                if not ((relevant and ev.team_id == team) or (sl is not None and due) or (team, channel) in fired):
                    continue
                self._last_measured[(team, channel)] = ev.elapsed_ms
                m = self.d1.measure(team, channel, ev.elapsed_ms)
                self._step_channel(sl, m, fired.get((team, channel)), ev, state)

    def _step_channel(self, sl: Storyline | None, m: ChannelMeasure, cand: PatternCandidate | None,
                      ev: MatchEvent, state: MatchState) -> None:
        metrics = _channel_metrics(m, self.d1.cfg.window_ms if self.d1 else 600_000)
        team_name = state.world.team(m.team_id).name
        word = CHANNEL_WORD[m.channel]
        counts = f"{len(m.ch)} of {len(m.window)} final-third entries in the last {metrics['window_minutes']} minutes"
        observing = (len(m.ch) >= OBSERVE_MIN_ENTRIES and m.share >= OBSERVE_MIN_SHARE
                     and len(m.possessions) >= OBSERVE_MIN_POSSESSIONS and m.tail <= OBSERVE_MAX_TAIL)
        holding = len(m.ch) >= OBSERVE_MIN_ENTRIES - 1 and m.share >= OBSERVE_MIN_SHARE - FADE_SHARE_MARGIN
        if sl is None:
            if not (observing or cand is not None):
                return
            sl = self._open("repeated_channel_attack", m.team_id, m.channel, ev, state,
                            f"{team_name}: attacks through the {word} channel")
            if cand is None:
                self._version(sl, "OBSERVING", ev, state, f"{counts[0].upper()}{counts[1:]}.", metrics)
                if not m.passes_except_danger:
                    return
        if cand is not None:
            sl.candidate_ids.append(cand.candidate_id)
            sl.evidence_event_ids = sorted(set(sl.evidence_event_ids) | set(cand.evidence_event_ids))
            sl.last_support_ms = ev.elapsed_ms
            again = sl.state in ("STRONG", "CONFIRMED", "WEAKENING") and len(sl.candidate_ids) > 1
            self._version(sl, "CONFIRMED" if again else "STRONG", ev, state,
                          ("Published again" if again else "Published") + f": {counts}, every detector gate passed.",
                          metrics)
            return
        if m.ch and m.ch[-1].elapsed_ms > sl.last_support_ms:
            sl.last_support_ms = m.ch[-1].elapsed_ms
        s = sl.state
        if s in ("OBSERVING",) and m.passes_except_danger:
            self._version(sl, "DEVELOPING", ev, state,
                          f"{counts[0].upper()}{counts[1:]}; every gate except a dangerous entry has passed.", metrics)
        elif s == "STRONG" and m.passes and m.dangerous and m.dangerous[-1].elapsed_ms > sl.updated_at_ms:
            self._version(sl, "CONFIRMED", ev, state,
                          f"The pattern continued after publication ({counts}, "
                          f"{len(m.dangerous)} dangerous).", metrics)
        elif s in ("STRONG", "CONFIRMED") and not (m.gates["volume"] and m.gates["share"]):
            self._version(sl, "WEAKENING", ev, state, f"Now {counts}.", metrics)
        elif s == "WEAKENING" and m.passes:
            self._version(sl, "STRONG", ev, state, f"Back above every gate: {counts}.", metrics)
        elif (s in ("OBSERVING", "DEVELOPING", "WEAKENING") and not holding
              and ev.elapsed_ms - sl.updated_at_ms >= MIN_DWELL_MS):
            self._version(sl, "RESOLVED", ev, state, f"Faded: {counts}.", metrics)

    def _event_pattern(self, c: PatternCandidate, ev: MatchEvent, state: MatchState) -> None:
        subject = str(c.calculated_metrics.get("flank", "flank")) if c.pattern_type == "overlap" else "transition"
        key = (c.pattern_type, c.team_id, subject)
        team_name = state.world.team(c.team_id).name
        noun = "overlapping runs on the " + subject if c.pattern_type == "overlap" else "fast counter-attacks"
        sl = self.active.get(key)
        if sl is None:
            sl = self._open(c.pattern_type, c.team_id, subject, ev, state, f"{team_name}: {noun}")
        sl.candidate_ids.append(c.candidate_id)
        sl.evidence_event_ids = sorted(set(sl.evidence_event_ids) | set(c.evidence_event_ids))
        n = len([x for x in sl.candidate_ids if x not in sl.withdrawn_candidate_ids])
        recent = ev.elapsed_ms - sl.last_support_ms <= REPEAT_CONFIRMS_MS
        sl.last_support_ms = ev.elapsed_ms
        own = {k: v for k, v in c.calculated_metrics.items() if isinstance(v, (int, float, str, bool))}
        sl.candidate_metrics[c.candidate_id] = own
        metrics = {"occurrences": n, **own}
        if n >= 2 and recent:
            self._version(sl, "CONFIRMED", ev, state, f"{n} in this spell, latest at {c.display_clock}.", metrics)
        else:
            self._version(sl, "STRONG", ev, state, f"Published at {c.display_clock}.", metrics)
        if c.pattern_type == "overlap":
            self._link(sl, ("repeated_channel_attack", c.team_id, subject))

    def _link(self, sl: Storyline, other_key: tuple[str, str, str]) -> None:
        other = self.active.get(other_key)
        if other is not None and other.storyline_id not in sl.linked_storyline_ids:
            sl.linked_storyline_ids.append(other.storyline_id)
            other.linked_storyline_ids.append(sl.storyline_id)
            if other not in self.changed:
                self.changed.append(other)

    def _withdraw(self, cid: str, reason: str, ev: MatchEvent, state: MatchState) -> None:
        for sl in self.storylines:
            if cid not in sl.candidate_ids or cid in sl.withdrawn_candidate_ids:
                continue
            sl.withdrawn_candidate_ids.append(cid)
            remaining = [x for x in sl.candidate_ids if x not in sl.withdrawn_candidate_ids]
            metrics = {**sl.history[-1].metrics, "withdrawn": len(sl.withdrawn_candidate_ids)}
            if remaining and remaining[-1] in sl.candidate_metrics:
                # re-measure from what still stands: the voided move no longer counts
                metrics = {"occurrences": len(remaining), **sl.candidate_metrics[remaining[-1]],
                           "withdrawn": len(sl.withdrawn_candidate_ids)}
            if not remaining:
                if sl.state == "RESOLVED":  # already closed: still record the correction as a new version
                    sl.history.append(Version(sl.version + 1, "RESOLVED", ev.elapsed_ms, ev.seq, self._clock,
                                              f"Withdrawn. {reason}", metrics))
                    if sl not in self.changed:
                        self.changed.append(sl)
                else:
                    self._version(sl, "RESOLVED", ev, state, f"Withdrawn. {reason}", metrics)
            else:
                self._version(sl, "STRONG" if sl.state != "RESOLVED" else "RESOLVED", ev, state,
                              f"One linked story withdrawn; {len(remaining)} still {'stands' if len(remaining) == 1 else 'stand'}. {reason}", metrics)

    def _decay(self, ev: MatchEvent, state: MatchState) -> None:
        for sl in list(self.active.values()):
            if sl.pattern_type == "repeated_channel_attack":
                continue  # measured on the detector's window instead
            quiet = ev.elapsed_ms - sl.last_support_ms
            if sl.state in ("STRONG", "CONFIRMED") and quiet >= WEAKEN_AFTER_MS:
                self._version(sl, "WEAKENING", ev, state, f"No repeat for {WEAKEN_AFTER_MS // 60_000} minutes.",
                              sl.history[-1].metrics)
            elif sl.state == "WEAKENING" and quiet >= RESOLVE_AFTER_MS:
                self._version(sl, "RESOLVED", ev, state, f"No repeat for {RESOLVE_AFTER_MS // 60_000} minutes.",
                              sl.history[-1].metrics)

    def snapshot(self) -> list[dict[str, Any]]:
        return [sl.to_json() for sl in self.storylines]
