"""State + detectors in one ordered pass: the deterministic half of the pipeline."""

from __future__ import annotations

from collections.abc import Iterable, Sequence
from typing import Any

from byline.events.models import MatchEvent
from byline.football.decisions import DecisionCard, DecisionExplainer
from byline.football.detectors.base import PatternCandidate
from byline.football.detectors.counterattack import CounterattackDetector
from byline.football.detectors.overlap import OverlapDetector
from byline.football.detectors.repeated_channel import RepeatedChannelDetector
from byline.football.storylines import Storyline, StorylineEngine
from byline.match_state.reducer import MatchState
from byline.signals.engine import ContextSource, Signal, SignalEngine
from byline.tactics.moments import TacticalMoment, tactical_moments
from byline.world.models import World

_MOMENTS: dict[str, list[TacticalMoment]] = {}


_CONTEXT: dict[tuple[str, int], list[Any]] = {}


def context_for(key: str, world: World) -> ContextSource:
    """Context facts for a prefix of an immutable log, memoised by (log, last seq): seeks rebuild instantly."""
    from byline.world.context import context_facts

    def source(events: Sequence[MatchEvent]) -> list[Any]:
        k = (key, events[-1].seq if events else -1)
        if k not in _CONTEXT:
            _CONTEXT[k] = context_facts(world, events)
        return _CONTEXT[k]

    return source


def moments_for(key: str, world: World, events: Sequence[MatchEvent], tracking: dict[str, Any] | None) -> list[TacticalMoment]:
    """Tactical moments of a whole immutable log, computed once. Each is only released by MatchIntelligence when
    the replay reaches its `available_seq`, so nothing is shown before the data it uses exists."""
    if key not in _MOMENTS:
        _MOMENTS[key] = tactical_moments(world, events, tracking)
    return _MOMENTS[key]


class MatchIntelligence:
    def __init__(self, world: World, detectors: Iterable[object] | None = None,
                 tracking: dict[str, Any] | None = None, moments: Sequence[TacticalMoment] | None = None,
                 context_source: ContextSource | None = None) -> None:
        self.world = world
        self.state = MatchState(world)
        self.detectors = list(detectors) if detectors is not None else [
            RepeatedChannelDetector(), CounterattackDetector(), OverlapDetector(tracking),
        ]
        self.candidates: list[PatternCandidate] = []
        self.retractions: dict[str, str] = {}  # candidate_id -> reason (append-only corrections)
        self.new_retractions: list[str] = []
        self.explainer = DecisionExplainer()
        self.new_decisions: list[DecisionCard] = []
        d1 = next((d for d in self.detectors if isinstance(d, RepeatedChannelDetector)), None)
        self.storylines = StorylineEngine(world.fixture.match_id, d1)
        self.new_storylines: list[Storyline] = []
        self._pending_moments = sorted(moments or [], key=lambda m: (m.available_seq, m.at_ms))
        self._moment_i = 0
        self.moments: list[TacticalMoment] = []
        self.new_moments: list[TacticalMoment] = []
        self.signals = SignalEngine(world.fixture.match_id, context_source)
        self.new_signals: list[Signal] = []
        self.voided_evidence: set[str] = set()

    def ingest(self, ev: MatchEvent) -> list[PatternCandidate]:
        self.new_retractions = []
        self.new_decisions = []
        self.new_storylines = []
        self.new_moments = []
        self.new_signals = []
        if self.state.apply(ev) == "duplicate":
            return []
        self.new_decisions = self.explainer.observe(ev, self.state)
        found: list[PatternCandidate] = []
        for det in self.detectors:
            found.extend(det.observe(ev, self.state))  # type: ignore[attr-defined]
        self.candidates.extend(found)
        if ev.type == "goal.disallowed":
            self._retract_for_voided_goal(ev)
        self.new_storylines = self.storylines.observe(ev, self.state, found, self.retractions, self.new_retractions)
        while self._moment_i < len(self._pending_moments) and self._pending_moments[self._moment_i].available_seq <= ev.seq:
            self.new_moments.append(self._pending_moments[self._moment_i])
            self._moment_i += 1
        self.moments.extend(self.new_moments)
        self.new_signals = self.signals.observe(ev, self.state, self.new_storylines, self.new_moments,
                                                self.voided_evidence if ev.type == "goal.disallowed" else set())
        return found

    def _retract_for_voided_goal(self, ev: MatchEvent) -> None:
        """DET-10 / LAW-15: a story whose evidence includes a voided goal attack no longer stands."""
        gid = ev.payload["goal_event_id"]
        goal = self.state.event_payload(gid) or {}
        voided = {gid, goal.get("shot_event_id")}
        self.voided_evidence = {str(v) for v in voided if v}
        reason_word = str(ev.payload.get("reason", "")).replace("_", " ")
        route = "after a VAR check" if ev.payload.get("decision_route") == "after_var_check" else "by the referee"
        for c in self.candidates:
            if c.candidate_id in self.retractions or not voided & set(c.evidence_event_ids):
                continue
            self.retractions[c.candidate_id] = (
                f"Retracted at {ev.display_clock}: the goal ({gid}) at the end of this move was disallowed for "
                f"{reason_word} {route} ({ev.payload.get('law_ref')}, official event {ev.event_id}).")
            self.new_retractions.append(c.candidate_id)

    def candidate_view(self, c: PatternCandidate) -> PatternCandidate:
        reason = self.retractions.get(c.candidate_id)
        return c if reason is None else c.model_copy(update={"status": "retracted", "retraction_reason": reason})


def run_detectors(world: World, events: Iterable[MatchEvent],
                  tracking: dict[str, Any] | None = None, moments: Sequence[TacticalMoment] | None = None,
                  context_source: ContextSource | None = None) -> MatchIntelligence:
    mi = MatchIntelligence(world, tracking=tracking, moments=moments, context_source=context_source)
    for ev in events:
        mi.ingest(ev)
    return mi
