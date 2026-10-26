"""P0: story delivery timing across playback modes (cache-only = the public demo configuration)."""

from __future__ import annotations

import asyncio

import pytest

from byline.api.sessions import ReplaySession, StreamMessage
from byline.config import Settings
from byline.storage.fixtures import load_package
from byline.stories.service import InsightService

D1 = "P-D1-NBA-0760"


def make(tmp_path):  # type: ignore[no-untyped-def]
    pkg = load_package("golden_story")
    svc = InsightService(Settings(byline_ai_provider="foundry", byline_ai_cache_only=True,
                                  foundry_deployment="gpt-4.1-mini"), lambda: [], lambda: None, cache_dir=tmp_path)
    s = ReplaySession("t", pkg, on_candidate=svc.submit, on_retract=svc.retract)
    q = s.subscribe()
    return pkg, s, q


def insights(q: asyncio.Queue[StreamMessage]) -> list[StreamMessage]:
    out = []
    while not q.empty():
        m = q.get_nowait()
        if m.event == "insight_update":
            out.append(m)
    return out


def detected_ms(pkg) -> int:  # type: ignore[no-untyped-def]
    ev = next(e for e in pkg.events if e.event_id == "E0760")
    return int(ev.elapsed_ms)


@pytest.mark.parametrize("speed,dt", [(1, 0.1), (12, 0.1), (60, 0.25)])
def test_story_arrives_exactly_when_its_evidence_is_released(tmp_path, speed: int, dt: float) -> None:  # type: ignore[no-untyped-def]
    pkg, s, q = make(tmp_path)
    t = detected_ms(pkg)
    s.seek(t - 20_000)
    insights(q)
    s.playing, s.speed = True, speed
    got: list[StreamMessage] = []
    while not got:
        before = s.playhead_ms
        s.tick(dt)
        got = [m for m in insights(q) if m.data["candidate_id"] == D1]
        if got:  # delivered in the tick whose window contains the detection event, never earlier
            assert before < t <= s.playhead_ms
        else:
            assert s.playhead_ms < t
    assert s.playhead_ms - t <= speed * dt * 1000
    assert got and got[-1].data["stage"] == "verified" and got[-1].data["from_cache"] is True
    assert got[-1].data["trace_summary"]["provider"] == "foundry"


def test_backward_seek_and_replay_from_kickoff(tmp_path) -> None:  # type: ignore[no-untyped-def]
    pkg, s, q = make(tmp_path)
    t = detected_ms(pkg)
    s.seek(t + 60_000)
    assert [m for m in insights(q) if m.data["candidate_id"] == D1][-1].data["stage"] == "verified"
    s.seek(t - 60_000)
    assert D1 not in {c.candidate_id for c in s.intelligence.candidates}
    assert not [m for m in insights(q) if m.data["candidate_id"] == D1]
    s.control("reset")
    assert all(e.elapsed_ms == 0 for e in pkg.events[: s.cursor])  # only pre-match events at 0 ms
    assert s.intelligence.candidates == []
    s.seek(t + 1000)
    got = [m for m in insights(q) if m.data["candidate_id"] == D1]
    assert len(got) == 1 and got[0].data["stage"] == "verified"


def test_showcase_checkpoints_lead_to_real_verified_story() -> None:
    from fastapi.testclient import TestClient

    from byline.api.app import app

    with TestClient(app) as c:
        sc = c.get("/api/matches/BYLINE-01/showcase").json()
        first = sc["first_verified_ai_story"]
        assert first["id"] == D1 and first["recorded_ai"] is True
        assert 0 < first["at_ms"] - first["jump_to_ms"] <= 75_000
        kinds = {m["kind"] for m in sc["moments"]}
        assert kinds == {"story", "decision"}
        assert [m["at_ms"] for m in sc["moments"]] == sorted(m["at_ms"] for m in sc["moments"])
        assert any(m["retracted_later"] for m in sc["moments"])  # the VAR-withdrawn 71' story
        assert c.get("/api/matches/NOPE/showcase").status_code == 404
