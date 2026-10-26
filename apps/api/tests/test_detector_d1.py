"""T005 / DET-01..03, DET-09, DET-11: repeated-channel detector from raw events only."""

from __future__ import annotations

import json

from byline.config import API_ROOT
from byline.events.models import MatchEvent
from byline.football.detectors.repeated_channel import D1Config, RepeatedChannelDetector, binomial_tail
from byline.football.geometry import channel_of, to_attacking
from byline.football.intelligence import MatchIntelligence, run_detectors
from byline.match_state.reducer import MatchState
from byline.storage.fixtures import MatchPackage
from byline.world.models import World
from tests.conftest import EventFactory, kickoff_stream, pt


def test_golden_positive_triggers_once_with_real_evidence(golden: MatchPackage) -> None:
    mi = run_detectors(golden.world, golden.events)
    d1 = [c for c in mi.candidates if c.pattern_type == "repeated_channel_attack"]
    assert len(d1) == 1
    c = d1[0]
    assert c.team_id == "NBA" and c.calculated_metrics["channel"] == "right"
    assert c.calculated_metrics["channel_entries"] >= 5
    assert c.calculated_metrics["distinct_possessions"] >= 3
    ids = {e.event_id: e for e in golden.events}
    for eid in c.evidence_event_ids:
        assert eid in ids  # AI-01 precondition: evidence ids exist in the journal
        assert ids[eid].seq <= c.detected_at_seq  # no look-ahead
    labels = json.loads((API_ROOT / "eval" / "labels" / "golden_story.labels.json").read_text())
    lab = next(lb for lb in labels if lb["pattern_type"] == "repeated_channel_attack")
    assert lab["start_ms"] <= c.detected_at_ms <= lab["end_ms"] + 60_000


def test_ordinary_match_stays_quiet(ordinary: MatchPackage) -> None:
    """DET-09: no channel/overlap stories; at most one genuine quick break across 90 minutes."""
    mi = run_detectors(ordinary.world, ordinary.events, tracking=ordinary.tracking)
    assert [c for c in mi.candidates if c.pattern_type != "counterattack"] == []
    assert len(mi.candidates) <= 1


def test_detector_never_reads_labels() -> None:
    import inspect

    import byline.football.detectors.repeated_channel as mod
    src = inspect.getsource(mod)
    assert "labels.json" not in src and "API_ROOT" not in src and "byline.config" not in src


def test_attacking_frame_normalisation() -> None:
    """DET-03: a team's right flank flips in world coordinates at half-time."""
    assert channel_of(to_attacking("+x", 80, 60)[1]) == "right"
    assert channel_of(to_attacking("-x", 25, 8)[1]) == "right"
    assert channel_of(to_attacking("-x", 25, 60)[1]) == "left"


def _entry(f: EventFactory, team: str, player: str, receiver: str, world_end_y: float, dt: int = 20_000,
           start_x: float = 60, end_x: float = 80) -> MatchEvent:
    return f("pass.completed", team, player, dt=dt, start=pt(start_x, world_end_y), end=pt(end_x, world_end_y),
             receiver_player_id=receiver)


def _shot(f: EventFactory, team: str, player: str, x: float = 95) -> MatchEvent:
    return f("shot", team, player, dt=2000, location=pt(x, 34), end=pt(105, 40), outcome="off_target")


def _change(f: EventFactory, team: str, player: str) -> MatchEvent:
    return f("interception", team, player, dt=3000, location=pt(40, 30))


def _build(world: World, seq: list[tuple[str, ...]]) -> MatchIntelligence:
    f = EventFactory()
    mi = MatchIntelligence(world, [RepeatedChannelDetector(D1Config(require_baseline=False))])
    for ev in kickoff_stream(f, world):
        mi.ingest(ev)
    for step in seq:
        kind = step[0]
        if kind == "entry":
            mi.ingest(_entry(f, "NBA", "NBA-02", "NBA-07", float(step[1])))
        elif kind == "shot":
            mi.ingest(_shot(f, "NBA", "NBA-07"))
        elif kind == "lose":
            mi.ingest(_change(f, "RVC", "RVC-06"))
            mi.ingest(f("pass.completed", "RVC", "RVC-06", dt=2000, start=pt(40, 30), end=pt(35, 30),
                        receiver_player_id="RVC-08"))
            mi.ingest(_change(f, "NBA", "NBA-04"))
    return mi


def test_positive_synthetic_sequence_triggers_once() -> None:
    from byline.world.models import ScenarioRef
    from byline.world.seed_world import build_world
    w = build_world("T-MATCH", ScenarioRef(scenario_id="t", seed=1, version="t", title="t", description="t"))
    steps: list[tuple[str, ...]] = []
    for _ in range(6):
        steps += [("entry", "62"), ("shot",), ("lose",)]
    steps += [("entry", "62"), ("lose",)] * 10  # DET-11: keeps going past trigger
    mi = _build(w, steps)
    assert len(mi.candidates) == 1
    c = mi.candidates[0]
    assert c.calculated_metrics["channel"] == "right"
    assert c.novelty_key == "repeated_channel_attack:NBA:right"
    assert "dragged" in " ".join(c.unsupported_claims)


def test_single_possession_is_not_a_pattern() -> None:
    """DET-01 negative: 6 entries but one possession."""
    from byline.world.models import ScenarioRef
    from byline.world.seed_world import build_world
    w = build_world("T-MATCH", ScenarioRef(scenario_id="t", seed=1, version="t", title="t", description="t"))
    mi = _build(w, [("entry", "62")] * 6 + [("shot",)])
    assert mi.candidates == []


def test_spread_channels_do_not_trigger() -> None:
    from byline.world.models import ScenarioRef
    from byline.world.seed_world import build_world
    w = build_world("T-MATCH", ScenarioRef(scenario_id="t", seed=1, version="t", title="t", description="t"))
    steps: list[tuple[str, ...]] = []
    for y in ("62", "8", "34", "62", "8", "34", "62", "8"):
        steps += [("entry", y), ("shot",), ("lose",)]
    assert _build(w, steps).candidates == []


def test_no_chance_no_story() -> None:
    from byline.world.models import ScenarioRef
    from byline.world.seed_world import build_world
    w = build_world("T-MATCH", ScenarioRef(scenario_id="t", seed=1, version="t", title="t", description="t"))
    steps: list[tuple[str, ...]] = []
    for _ in range(6):
        steps += [("entry", "62"), ("lose",)]
    assert _build(w, steps).candidates == []


def test_offside_pass_is_not_an_entry(world: World) -> None:
    f = EventFactory()
    st = MatchState(world)
    det = RepeatedChannelDetector(D1Config(require_baseline=False))
    for ev in kickoff_stream(f, world):
        st.apply(ev)
    p = _entry(f, "NBA", "NBA-02", "NBA-09", 62)
    st.apply(p)
    det.observe(p, st)
    assert len(det.entries) == 1
    o = f("offside.offence_confirmed", "NBA", "NBA-09", official=True, interference_type="interfering_with_play",
          decision_event_id=p.event_id, location=pt(80, 62))
    st.apply(o)
    det.observe(o, st)
    assert det.entries == []


def test_binomial_tail() -> None:
    assert abs(binomial_tail(7, 9, 1 / 3) - 0.00833) < 1e-4
    assert abs(binomial_tail(0, 5, 0.3) - 1.0) < 1e-12
