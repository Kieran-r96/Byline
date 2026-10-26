"""Regression tests for the backend review findings (sessions, seek, studio, REST views, recap)."""

from __future__ import annotations

import asyncio
import json

import pytest
from fastapi.testclient import TestClient

import byline.api.app as app_module
from byline.api.app import app
from byline.api.sessions import ReplaySession, SessionLimit, SessionManager, StreamMessage
from byline.config import REPO_ROOT, Settings
from byline.overlay.desk import StudioDesk
from byline.storage.fixtures import load_package
from byline.stories.models import Insight
from byline.stories.service import InsightService


def drain(q: asyncio.Queue[StreamMessage]) -> list[StreamMessage]:
    out = []
    while not q.empty():
        out.append(q.get_nowait())
    return out


def test_watched_sessions_are_never_evicted() -> None:
    mgr = SessionManager()
    pkg = load_package("golden_story")
    watched = mgr.create(pkg, client_key="judge")
    watched.subscribe()
    others = [mgr.create(pkg, client_key="judge") for _ in range(5)]
    mgr.create(pkg, client_key="judge")  # 7th evicts the oldest IDLE session, never the watched one
    assert watched.session_id in mgr.sessions and others[0].session_id not in mgr.sessions
    for s in list(mgr.sessions.values()):
        if not s.subscribers:
            s.subscribe()
    with pytest.raises(SessionLimit):
        mgr.create(pkg, client_key="judge")
    mgr.create(pkg, client_key="someone-else")  # other clients unaffected


def test_seek_publishes_insights_after_reset_and_all_decisions() -> None:
    pkg = load_package("discipline_var")
    svc = InsightService(Settings(byline_ai_provider="off"), lambda: [], None, cache_dir=None)
    s = ReplaySession("t", pkg, on_candidate=svc.submit)
    q = s.subscribe()
    s.seek(pkg.events[-1].elapsed_ms)
    msgs = drain(q)
    reset_at = next(i for i, m in enumerate(msgs) if m.event == "replay_reset")
    assert all(i > reset_at for i, m in enumerate(msgs) if m.event == "insight_update")
    decisions = [m for m in msgs if m.event == "decision"]
    assert len(decisions) == len(s.intelligence.explainer.cards) > 12
    assert any(m.data["kind"] == "RED CARD" for m in decisions)


def test_cache_only_fallbacks_survive_seek_and_reconnect(tmp_path) -> None:  # type: ignore[no-untyped-def]
    pkg = load_package("golden_story")
    svc = InsightService(Settings(byline_ai_provider="foundry", byline_ai_cache_only=True,
                                  foundry_deployment="gpt-4.1-mini"), lambda: [], lambda: None, cache_dir=tmp_path)
    s = ReplaySession("t", pkg, on_candidate=svc.submit)
    s.seek(pkg.events[-1].elapsed_ms)
    assert set(svc.records) == {c.candidate_id for c in s.intelligence.candidates}
    q = s.subscribe()
    svc.replay_to(s)
    assert len([m for m in drain(q) if m.event == "insight_update"]) == len(s.intelligence.candidates)


def test_seek_never_starts_model_work() -> None:
    pkg = load_package("golden_story")
    started: list[str] = []

    def factory() -> None:
        started.append("client")

    svc = InsightService(Settings(byline_ai_provider="foundry", foundry_deployment="x"), lambda: [], factory,
                         cache_dir=None)

    def no_spawn(coro: object) -> None:
        started.append("task")
        coro.close()  # type: ignore[attr-defined]

    svc._spawn = no_spawn  # type: ignore[method-assign,assignment]
    s = ReplaySession("t", pkg, on_candidate=svc.submit)
    s.seek(pkg.events[-1].elapsed_ms)
    assert started == []
    names = {r.insight.verification.checker_name for r in svc.records.values() if r.insight}
    assert names == {"deterministic_only (ai_skipped)"}
    assert all(r.upgradable for r in svc.records.values())


def test_stale_story_not_reproposed_to_studio_after_seek() -> None:
    run = json.loads((REPO_ROOT / "docs" / "evidence" / "foundry-run-20261020-212528.json").read_text())
    ins = Insight.model_validate(run["insight"])
    pkg = load_package("golden_story")
    desk = StudioDesk(pkg.world, pkg.match_id)
    desk.offer_insight(ins, 5_000_000)
    assert desk.packets == {}
    desk.offer_insight(ins, (ins.created_at_ms or 0) + 10_000)
    p = next(iter(desk.packets.values()))
    assert p.match_elapsed_ms == ins.created_at_ms


def test_ticker_survives_a_failing_session() -> None:
    async def run() -> None:
        mgr = SessionManager()
        pkg = load_package("golden_story")
        bad = mgr.create(pkg)
        good = mgr.create(pkg)

        def boom(dt: float) -> None:
            raise RuntimeError("corrupt cache entry")

        bad.tick = boom  # type: ignore[method-assign]
        bad.playing = True
        good.playing = True
        good.speed = 60
        mgr.start()
        await asyncio.sleep(0.5)
        await mgr.stop()
        assert good.playhead_ms > 0 and bad.playing is False

    asyncio.run(run())


def test_evidence_and_insight_respect_session_retraction_and_playhead() -> None:
    pkg = load_package("golden_story")
    dis = next(e for e in pkg.events if e.type == "goal.disallowed")
    with TestClient(app) as c:
        sid = c.post("/api/matches/BYLINE-01/sessions", json={"speed": 30}).json()["session_id"]
        c.post(f"/api/sessions/{sid}/control", json={"action": "seek", "elapsed_ms": 600_000})
        assert c.get("/api/insights/P-D2-NBA-2005/evidence", params={"session_id": sid}).status_code == 404
        c.post(f"/api/sessions/{sid}/control", json={"action": "seek", "elapsed_ms": dis.elapsed_ms + 1000})
        ev = c.get("/api/insights/P-D2-NBA-2005/evidence", params={"session_id": sid}).json()
        assert ev["candidate"]["status"] == "retracted"
        ins = c.get("/api/insights/I-P-D2-NBA-2005", params={"session_id": sid}).json()
        assert ins["stage"] == "retracted"


def test_recap_wording_for_retake_and_order() -> None:
    with TestClient(app) as c:
        r = c.get("/api/matches/BYLINE-02/recap").json()
        texts = [p["text"] for p in r["turning_points"]]
        assert any("penalty retaken" in t for t in texts)
        assert "2 players sent off" in r["summary"]
        assert len([t for t in texts if "scores" in t]) == 3  # no goal dropped
        retake = next(i for i, t in enumerate(texts) if "retaken" in t)
        converted = max(i for i, t in enumerate(texts) if "Ferrandi" in t and "scores" in t)
        assert retake < converted


def test_facts_before_kickoff_and_rate_limit(monkeypatch: pytest.MonkeyPatch) -> None:
    with TestClient(app) as c:
        assert c.get("/api/matches/BYLINE-01/players/NBA-09/facts", params={"upto_seq": -1}).status_code == 200
        monkeypatch.setattr(app_module, "RATE_PER_S", 0.0)
        monkeypatch.setattr(app_module, "RATE_BURST", 3.0)
        app_module._buckets.clear()
        codes = [c.get("/api/matches").status_code for _ in range(5)]
        assert codes[:3] == [200, 200, 200] and codes[-1] == 429
        assert c.get("/healthz").status_code == 200  # health is never rate limited
