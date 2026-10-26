"""V1: persistent, versioned storylines. Deterministic, gate-preserving, append-only and VAR-aware."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from byline.api.app import app
from byline.api.sessions import ReplaySession
from byline.football.intelligence import run_detectors
from byline.storage.fixtures import MatchPackage, available_scenarios, load_package

ORDER = ["OBSERVING", "DEVELOPING", "STRONG", "CONFIRMED", "WEAKENING", "RESOLVED"]


def final(pkg: MatchPackage):  # type: ignore[no-untyped-def]
    return run_detectors(pkg.world, pkg.events, tracking=pkg.tracking)


def test_golden_channel_story_builds_before_publication_and_then_fades(golden: MatchPackage) -> None:
    mi = final(golden)
    cand = next(c for c in mi.candidates if c.candidate_id == "P-D1-NBA-0760")
    sl = next(s for s in mi.storylines.storylines if "P-D1-NBA-0760" in s.candidate_ids)
    states = [v.state for v in sl.history]
    assert states == ["OBSERVING", "DEVELOPING", "STRONG", "WEAKENING", "RESOLVED"]
    strong = sl.history[2]
    # STRONG only at the exact event where the unchanged production detector published
    assert (strong.at_ms, strong.seq) == (cand.detected_at_ms, cand.detected_at_seq)
    # the build-up is visible minutes before publication, from the detector's own measurements
    assert cand.detected_at_ms - sl.history[0].at_ms >= 3 * 60_000
    developing = sl.history[1]
    assert "danger" in developing.metrics["gates_pending"]
    assert set(developing.metrics["gates_passed"]) == {"volume", "possessions", "share", "baseline", "unusual"}


@pytest.mark.parametrize("scenario", available_scenarios())
def test_only_published_candidates_make_a_storyline_strong(scenario: str) -> None:
    mi = final(load_package(scenario))
    linked = [cid for s in mi.storylines.storylines for cid in s.candidate_ids]
    assert sorted(linked) == sorted(c.candidate_id for c in mi.candidates)  # every candidate, exactly once
    for s in mi.storylines.storylines:
        reached = {v.state for v in s.history}
        if reached & {"STRONG", "CONFIRMED"}:
            assert s.candidate_ids, s.storyline_id
        else:  # watch-only storylines never assert a story
            assert not s.candidate_ids and reached <= {"OBSERVING", "DEVELOPING", "RESOLVED"}
    watch_only = [s for s in mi.storylines.storylines if not s.candidate_ids]
    assert len(watch_only) <= 6  # measured noise bound on the fixtures (see docs/engine-audit.md)


@pytest.mark.parametrize("scenario", available_scenarios())
def test_histories_are_versioned_monotonic_and_end_resolved(scenario: str) -> None:
    pkg = load_package(scenario)
    mi = final(pkg)
    for s in mi.storylines.storylines:
        assert [v.version for v in s.history] == list(range(1, len(s.history) + 1))
        assert [v.at_ms for v in s.history] == sorted(v.at_ms for v in s.history)
        assert s.state == "RESOLVED"  # every storyline closes by full time
        assert all(v.display_clock for v in s.history)


def test_var_withdrawal_is_a_new_version_not_an_edit(golden: MatchPackage) -> None:
    mi = final(golden)
    sl = next(s for s in mi.storylines.storylines if "P-D2-NBA-2005" in s.candidate_ids)
    assert sl.withdrawn_candidate_ids == ["P-D2-NBA-2005"]
    states = [v.state for v in sl.history]
    i = states.index("CONFIRMED")
    after = sl.history[i + 1]
    assert after.state == "STRONG" and "withdrawn" in after.reason and "disallowed" in after.reason
    # what still stands is re-measured: one fast break, no longer the voided goal
    assert after.metrics["occurrences"] == 1 and after.metrics["shot_outcome"] != "goal"
    # the confirmation that the withdrawn goal produced is still in the history (append-only)
    assert "2 in this spell" in sl.history[i].reason


def test_storylines_as_of_any_point_are_a_prefix_of_the_final_history(golden: MatchPackage) -> None:
    full = {s.storyline_id: s for s in final(golden).storylines.storylines}
    for cut in (900, 1400, 1700, 2100):
        evs = tuple(e for e in golden.events if e.seq <= cut)
        part = run_detectors(golden.world, evs, tracking=golden.tracking).storylines.storylines
        for s in part:
            f = full[s.storyline_id]
            got = [(v.version, v.state, v.seq) for v in s.history]
            assert got == [(v.version, v.state, v.seq) for v in f.history][: len(got)]


def test_session_streams_storyline_updates_and_seek_replays_them(golden: MatchPackage) -> None:
    s = ReplaySession("t", golden, on_candidate=lambda *_a, **_k: None)
    q = s.subscribe()
    s.playing, s.speed = True, 60
    while s.playhead_ms < 30 * 60_000:
        s.tick(0.5)
    seen = []
    while not q.empty():
        m = q.get_nowait()
        if m.event == "storyline_update":
            seen.append((m.data["storyline_id"], m.data["state"], m.data["version"]))
    sid = "SL-repeated-channel-attack-NBA-right-1"
    assert [st for i, st, _v in seen if i == sid] == ["OBSERVING", "DEVELOPING", "STRONG"]
    s.seek(0)
    while not q.empty():
        q.get_nowait()
    s.seek(30 * 60_000)
    replayed = []
    while not q.empty():
        m = q.get_nowait()
        if m.event == "storyline_update":
            replayed.append(m.data)
    one = next(d for d in replayed if d["storyline_id"] == sid)
    assert one["state"] == "STRONG" and [h["state"] for h in one["history"]] == ["OBSERVING", "DEVELOPING", "STRONG"]


def test_storylines_endpoint() -> None:
    with TestClient(app) as c:
        early = c.get("/api/matches/BYLINE-01/storylines", params={"upto_seq": 300}).json()
        full = c.get("/api/matches/BYLINE-01/storylines").json()
    assert len(full) >= len(early)
    one = next(d for d in full if d["storyline_id"] == "SL-repeated-channel-attack-NBA-right-1")
    assert one["candidate_ids"] == ["P-D1-NBA-0760"] and one["state"] == "RESOLVED"
    assert all(d["state"] in ORDER for d in full)
