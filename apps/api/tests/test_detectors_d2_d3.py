"""T013 / DET-04..07: fast counterattack (events) and overlap (tracking)."""

from __future__ import annotations

import json
from typing import Any

from byline.config import API_ROOT
from byline.football.detectors.counterattack import CounterattackDetector
from byline.football.detectors.overlap import OverlapDetector
from byline.football.intelligence import MatchIntelligence, run_detectors
from byline.storage.fixtures import MatchPackage
from byline.world.models import World
from tests.conftest import EventFactory, kickoff_stream, pt


def labels(scenario: str) -> list[dict[str, Any]]:
    data: list[dict[str, Any]] = json.loads((API_ROOT / "eval" / "labels" / f"{scenario}.labels.json").read_text())
    return data


def overlaps(c: Any, lab: dict[str, Any]) -> bool:
    return bool(c.team_id == lab["team_id"] and c.window_start_ms <= lab["end_ms"] + 2000
                and c.window_end_ms >= lab["start_ms"] - 2000)


def test_golden_counterattacks_match_labels(golden: MatchPackage) -> None:
    mi = run_detectors(golden.world, golden.events, tracking=golden.tracking)
    d2 = [c for c in mi.candidates if c.pattern_type == "counterattack"]
    for lab in [lb for lb in labels("golden_story") if lb["pattern_type"] == "counterattack"]:
        assert any(overlaps(c, lab) for c in d2), lab
    for c in d2:
        m = c.calculated_metrics
        assert float(m["seconds_regain_to_shot"]) <= 12 and float(m["metres_advanced"]) >= 30
        assert int(m["passes_and_carries"]) >= 2


def test_golden_overlap_needs_tracking(golden: MatchPackage) -> None:
    with_t = [c for c in run_detectors(golden.world, golden.events, tracking=golden.tracking).candidates
              if c.pattern_type == "overlap"]
    lab = next(lb for lb in labels("golden_story") if lb["pattern_type"] == "overlap")
    assert len(with_t) == 1 and overlaps(with_t[0], lab)
    c = with_t[0]
    assert c.frame_intervals and c.frame_intervals[0].end_ms <= c.detected_at_ms
    assert float(c.calculated_metrics["runner_distance_m"]) >= 12
    without = [c for c in run_detectors(golden.world, golden.events, tracking=None).candidates
               if c.pattern_type == "overlap"]
    assert without == []  # DET-07: no frames -> no overlap claim


def _counter_mi(world: World) -> tuple[MatchIntelligence, EventFactory]:
    f = EventFactory()
    mi = MatchIntelligence(world, [CounterattackDetector()])
    for ev in kickoff_stream(f, world):
        mi.ingest(ev)
    return mi, f


def test_fast_break_triggers(world: World) -> None:
    mi, f = _counter_mi(world)
    mi.ingest(f("interception", "RVC", "RVC-06", dt=2000, location=pt(70, 30)))  # RVC attacks -x: ax = 35
    mi.ingest(f("pass.completed", "RVC", "RVC-06", dt=1500, start=pt(70, 30), end=pt(55, 40),
                receiver_player_id="RVC-10"))
    mi.ingest(f("carry", "RVC", "RVC-10", dt=2500, start=pt(55, 40), end=pt(40, 38)))
    mi.ingest(f("pass.completed", "RVC", "RVC-10", dt=1500, start=pt(40, 38), end=pt(22, 34),
                receiver_player_id="RVC-09"))
    found = mi.ingest(f("shot", "RVC", "RVC-09", dt=1200, location=pt(18, 34), end=pt(0, 33), outcome="saved"))
    assert len(found) == 1 and found[0].calculated_metrics["seconds_regain_to_shot"] == 6.7


def test_slow_build_up_does_not_trigger(world: World) -> None:
    """DET-04 negative."""
    mi, f = _counter_mi(world)
    mi.ingest(f("interception", "RVC", "RVC-06", dt=2000, location=pt(70, 30)))
    for i in range(6):
        a, b = ("RVC-06", "RVC-08") if i % 2 == 0 else ("RVC-08", "RVC-06")
        mi.ingest(f("pass.completed", "RVC", a, dt=3000, start=pt(60 - i * 6, 30), end=pt(54 - i * 6, 32),
                    receiver_player_id=b))
    assert mi.ingest(f("shot", "RVC", "RVC-06", dt=1500, location=pt(18, 34), end=pt(0, 33), outcome="saved")) == []


def test_possession_change_without_progression(world: World) -> None:
    """DET-05 negative: regain then a speculative shot with no move."""
    mi, f = _counter_mi(world)
    mi.ingest(f("interception", "RVC", "RVC-06", dt=2000, location=pt(40, 30)))
    assert mi.ingest(f("shot", "RVC", "RVC-06", dt=2000, location=pt(38, 30), end=pt(0, 33),
                       outcome="off_target")) == []


def test_stationary_wide_pair_is_not_an_overlap(golden: MatchPackage) -> None:
    """DET-06 negative: frames where the receiver stands still beside the carrier."""
    ents: list[str] = golden.tracking["entities"]
    n = len(ents)

    def frame(t: int, rb: tuple[float, float], rw: tuple[float, float]) -> list[float | None]:
        row: list[float | None] = [float(t), 60.0, 60.0, 0.0, *([None] * (2 * n))]
        for pid, (x, y) in (("NBA-02", rb), ("NBA-07", rw)):
            i = 4 + 2 * ents.index(pid)
            row[i], row[i + 1] = x, y
        return row

    frames = [frame(t, (62.0, 63.0), (63.0, 60.0)) for t in range(0, 8000, 500)]
    w = golden.world
    mi = MatchIntelligence(w, [OverlapDetector({"entities": ents, "frames": frames})])
    f = EventFactory(match_id=w.fixture.match_id)
    for ev in kickoff_stream(f, w):
        mi.ingest(ev)
    f.t = 6500
    mi.ingest(f("pass.completed", "NBA", "NBA-07", dt=500, start=pt(63, 60), end=pt(64, 63),
                receiver_player_id="NBA-02"))
    assert mi.ingest(f("shot", "NBA", "NBA-09", dt=2000, location=pt(95, 34), end=pt(105, 33),
                       outcome="saved")) == []
