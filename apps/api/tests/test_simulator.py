"""T003: deterministic simulator. Byte-identical replay, coherent clock/direction and physics."""

from __future__ import annotations

import gzip
import hashlib
import json
import math

import pytest

from byline.config import FIXTURE_DIR
from byline.events.models import MatchEvent
from byline.match_state.reducer import replay
from byline.simulation.generate import events_jsonl, generate
from byline.simulation.scenarios import SCENARIOS
from byline.storage.fixtures import MatchPackage


@pytest.fixture(scope="module")
def regenerated_golden():  # type: ignore[no-untyped-def]
    return generate(SCENARIOS["golden_story"])


def test_same_seed_is_byte_identical_to_checked_in_fixture(regenerated_golden) -> None:  # type: ignore[no-untyped-def]
    """EVT-10: any drift from the committed golden log is surfaced as a fixture change."""
    fresh = events_jsonl(regenerated_golden.events).encode()
    committed = (FIXTURE_DIR / "golden_story.events.jsonl").read_bytes()
    assert hashlib.sha256(fresh).hexdigest() == hashlib.sha256(committed).hexdigest()
    tracking = json.dumps(regenerated_golden.tracking, separators=(",", ":")).encode()
    with gzip.open(FIXTURE_DIR / "golden_story.tracking.json.gz", "rb") as fh:
        assert hashlib.sha256(tracking).hexdigest() == hashlib.sha256(fh.read()).hexdigest()


def test_different_seed_varies_play_but_not_authored_outcomes() -> None:
    a = generate(SCENARIOS["golden_story"], seed=99)
    b = generate(SCENARIOS["golden_story"])
    assert events_jsonl(a.events) != events_jsonl(b.events)
    assert a.events[-1]["payload"]["final_score"] == b.events[-1]["payload"]["final_score"] == {"NBA": 2, "RVC": 1}


def test_full_replay_is_legal_and_final_score_matches(golden: MatchPackage, ordinary: MatchPackage) -> None:
    """Every event passes the strict reducer: no actions by dismissed/substituted players etc."""
    gs = replay(golden.world, list(golden.events)).snapshot()
    assert gs["finished"] and gs["score"] == {"NBA": 2, "RVC": 1}
    assert gs["teams"]["RVC"]["sent_off"] == ["RVC-06"]
    os_ = replay(ordinary.world, list(ordinary.events)).snapshot()
    assert os_["finished"] and os_["score"] == {"NBA": 0, "RVC": 1}


def test_sequence_and_time_are_monotonic(golden: MatchPackage) -> None:
    seqs = [e.seq for e in golden.events]
    assert seqs == list(range(len(seqs)))
    times = [e.elapsed_ms for e in golden.events]
    assert times == sorted(times)
    assert len({e.event_id for e in golden.events}) == len(golden.events)


def test_halftime_swaps_attacking_direction(golden: MatchPackage) -> None:
    starts = [e for e in golden.events if e.type == "period.started"]
    assert starts[0].payload["attacking_direction"] == {"NBA": "+x", "RVC": "-x"}
    assert starts[1].payload["attacking_direction"] == {"NBA": "-x", "RVC": "+x"}
    kicks = [e for e in golden.events if e.type == "kickoff" and e.payload["reason"] == "period_start"]
    assert [k.team_id for k in kicks] == ["NBA", "RVC"]


def test_stoppage_time_display(golden: MatchPackage) -> None:
    ends = [e for e in golden.events if e.type == "period.ended"]
    # announced added time is a minimum; the whistle keeps its true clock (play ran into the next minute)
    assert [e.payload["added_minutes"] for e in ends] == [2, 4]
    assert [e.display_clock for e in ends] == ["45+3'", "90+5'"]
    assert any(e.display_clock and e.display_clock.startswith("45+") for e in golden.events
               if e.type == "offside.offence_confirmed")


def test_realistic_volumes(golden: MatchPackage) -> None:
    passes = [e for e in golden.events if e.type in ("pass.completed", "pass.failed")]
    completed = [e for e in passes if e.type == "pass.completed"]
    assert 1200 <= len(passes) <= 2200
    assert 0.72 <= len(completed) / len(passes) <= 0.9
    lengths = [math.dist((e.payload["start"]["x_m"], e.payload["start"]["y_m"]),
                         (e.payload["end"]["x_m"], e.payload["end"]["y_m"])) for e in completed]
    assert 14 <= sum(lengths) / len(lengths) <= 28
    shots = [e for e in golden.events if e.type == "shot"]
    assert 15 <= len(shots) <= 60


def _frame_at(pkg: MatchPackage, t: int) -> list[float | None]:
    frames = pkg.tracking["frames"]
    i = min(range(len(frames)), key=lambda k: abs(frames[k][0] - t)) if len(frames) < 50 else None
    if i is None:
        lo, hi = 0, len(frames) - 1
        while lo < hi:
            mid = (lo + hi) // 2
            if frames[mid][0] < t:
                lo = mid + 1
            else:
                hi = mid
        i = lo
    return frames[i]


def test_tracking_agrees_with_events(golden: MatchPackage) -> None:
    """Passers are physically at the pass origin (within 2 frames of motion) and nobody exceeds sprint speed."""
    ents = golden.tracking["entities"]
    idx = {pid: 4 + 2 * i for i, pid in enumerate(ents)}
    checked = 0
    for ev in golden.events[::7]:
        if ev.type != "pass.completed":
            continue
        row = _frame_at(golden, ev.elapsed_ms)
        x, y = row[idx[ev.player_id]], row[idx[ev.player_id] + 1]  # type: ignore[index]
        assert x is not None and y is not None
        s = ev.payload["start"]
        assert math.dist((x, y), (s["x_m"], s["y_m"])) < 9.0
        checked += 1
    assert checked > 100
    frames = golden.tracking["frames"]
    for a, b in zip(frames[1000:4000], frames[1001:4001], strict=True):
        dt = (b[0] - a[0]) / 1000  # type: ignore[operator]
        if dt != 0.5:
            continue
        for k in range(4, len(a) - 2, 2):
            if a[k] is None or b[k] is None:
                continue
            speed = math.dist((a[k], a[k + 1]), (b[k], b[k + 1])) / dt  # type: ignore[arg-type]
            assert speed < 9.5


def test_lineup_and_officials_are_seeded_not_generated(golden: MatchPackage) -> None:
    roles = {o.role: o.name for o in golden.world.fixture.officials}
    assert roles["referee"] == "Imogen Castell"
    lineups = [e for e in golden.events if e.type == "lineup.confirmed"]
    assert len(lineups) == 2 and all(len(e.payload["starters"]) == 11 for e in lineups)


def test_events_round_trip(golden: MatchPackage) -> None:
    for ev in golden.events[:200]:
        assert MatchEvent.model_validate_json(ev.model_dump_json()) == ev
