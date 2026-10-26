"""API smoke + session playback (T001/T003/T005 acceptance through HTTP)."""

from __future__ import annotations

import json
import time
from pathlib import Path

from fastapi.testclient import TestClient

from byline.api.app import app, safe_static_file
from byline.api.sessions import StreamMessage


def test_health_status_and_matches() -> None:
    with TestClient(app) as c:
        assert c.get("/healthz").json()["status"] == "ok"
        st = c.get("/api/system/status").json()
        assert st["synthetic"] is True and st["ai"]["provider"] == "off" and st["ai"]["state"] == "disabled"
        ids = {m["match_id"] for m in c.get("/api/matches").json()}
        assert {"BYLINE-01", "BYLINE-03"} <= ids
        detail = c.get("/api/matches/BYLINE-01").json()
        assert detail["world"]["fixture"]["synthetic"] is True
        assert c.get("/api/matches/NOPE").status_code == 404


def test_patterns_endpoint_returns_evidence() -> None:
    with TestClient(app) as c:
        pats = c.get("/api/matches/BYLINE-01/patterns").json()
        kinds = [p["pattern_type"] for p in pats]
        assert kinds.count("repeated_channel_attack") == 1 and "overlap" in kinds and "counterattack" in kinds
        assert all(p["evidence_event_ids"] for p in pats)
        assert c.get("/api/matches/BYLINE-01/patterns", params={"upto_seq": 300}).json() == []
        assert len(c.get("/api/matches/BYLINE-03/patterns").json()) <= 1


def test_tracking_window_and_validation() -> None:
    with TestClient(app) as c:
        r = c.get("/api/matches/BYLINE-01/tracking", params={"from_ms": 60_000, "to_ms": 120_000}).json()
        assert len(r["frames"]) == 121 and r["frames"][0][0] == 60_000
        assert c.get("/api/matches/BYLINE-01/tracking", params={"from_ms": 0, "to_ms": 999_999}).status_code == 422


def test_rules_endpoint() -> None:
    with TestClient(app) as c:
        law = c.get("/api/rules/11").json()
        assert law["ruleset_version"] == "IFAB-2026/27"
        assert any("not an offence" in p for p in law["points"])
        assert c.get("/api/rules/99").status_code == 404


def test_session_seek_detects_story_and_publishes_offline_insight() -> None:
    with TestClient(app) as c:
        sid = c.post("/api/matches/BYLINE-01/sessions", json={"speed": 30}).json()["session_id"]
        rt = app.state.rt
        sess = rt.sessions.get(sid)
        q = sess.subscribe()
        hb = c.post(f"/api/sessions/{sid}/control", json={"action": "seek", "elapsed_ms": 1_700_000}).json()
        assert hb["playhead_ms"] == 1_700_000
        msgs: list[StreamMessage] = []
        while not q.empty():
            msgs.append(q.get_nowait())
        kinds = [m.event for m in msgs]
        assert "replay_reset" in kinds and "pattern_candidate" in kinds
        ins = [m for m in msgs if m.event == "insight_update"]
        assert ins and ins[-1].data["stage"] == "tentative"
        assert ins[-1].data["insight"]["verification"]["checker_name"].startswith("deterministic_only")
        # seeking back before the story: the session no longer holds that candidate
        c.post(f"/api/sessions/{sid}/control", json={"action": "seek", "elapsed_ms": 600_000})
        assert sess.intelligence.candidates == []
        assert c.post(f"/api/sessions/{sid}/control", json={"action": "speed", "speed": 7}).status_code == 422
        assert c.post("/api/sessions/nope/control", json={"action": "play"}).status_code == 404


def test_session_tick_releases_events_in_order() -> None:
    with TestClient(app) as c:
        sid = c.post("/api/matches/BYLINE-01/sessions", json={"speed": 60}).json()["session_id"]
        sess = app.state.rt.sessions.get(sid)
        sess.playing = True
        sess.tick(10.0)  # 10 s wall at 60x = 10 simulated minutes
        assert sess.playhead_ms == 600_000
        assert all(e.elapsed_ms <= 600_000 for e in sess.events[: sess.cursor])
        assert sess.events[sess.cursor].elapsed_ms > 600_000
        assert sess.intelligence.state.last_seq == sess.cursor - 1


def test_static_path_traversal_contained(tmp_path: Path) -> None:
    root = tmp_path / "dist"
    root.mkdir()
    (root / "index.html").write_text("ok")
    (tmp_path / "secret.txt").write_text("nope")
    r = root.resolve()
    assert safe_static_file(r, "index.html") == (root / "index.html").resolve()
    assert safe_static_file(r, "../secret.txt") is None
    assert safe_static_file(r, "..%2Fsecret.txt") is None
    assert safe_static_file(r, "") is None


def _drain(sess) -> list[StreamMessage]:  # type: ignore[no-untyped-def]
    q = sess.subscribers[-1]
    out = []
    while not q.empty():
        out.append(q.get_nowait())
    return out


def test_var_reversal_retracts_dependent_story_per_session() -> None:
    """T012 / DET-10 / LAW-27: story built on the voided goal is retracted only once VAR decides."""
    from byline.storage.fixtures import load_package

    pkg = load_package("golden_story")
    shot = next(e for e in pkg.events if e.type == "goal.provisional" and e.elapsed_ms > 4_000_000)
    dis = next(e for e in pkg.events if e.type == "goal.disallowed")
    with TestClient(app) as c:
        sid = c.post("/api/matches/BYLINE-01/sessions", json={"speed": 30}).json()["session_id"]
        sess = app.state.rt.sessions.get(sid)
        sess.subscribe()
        c.post(f"/api/sessions/{sid}/control", json={"action": "seek", "elapsed_ms": shot.elapsed_ms + 1000})
        msgs = _drain(sess)
        d2 = [m for m in msgs if m.event == "pattern_candidate" and m.data["candidate_id"] == "P-D2-NBA-2005"]
        assert d2 and d2[-1].data["status"] == "discovered"
        assert not any(m.event == "insight_update" and m.data["stage"] == "retracted" for m in msgs)
        sess.playing = True
        sess.speed = 60
        while sess.playhead_ms < dis.elapsed_ms:
            sess.tick(1.0)
        # the retraction is published by a background task: allow it to land on a slow runner
        msgs = []
        deadline = time.monotonic() + 10
        while True:
            msgs += _drain(sess)
            ret = [m for m in msgs if m.event == "insight_update" and m.data["candidate_id"] == "P-D2-NBA-2005"]
            if (ret and ret[-1].data["stage"] == "retracted") or time.monotonic() > deadline:
                break
            time.sleep(0.05)
        assert ret and ret[-1].data["stage"] == "retracted"
        ins = ret[-1].data["insight"]
        assert ins["status"] == "retracted" and ins["version"] == 2 and "offside" in ins["retraction_reason"]
        cands = [m for m in msgs if m.event == "pattern_candidate" and m.data["candidate_id"] == "P-D2-NBA-2005"]
        assert cands[-1].data["status"] == "retracted"
        # seek back before the VAR decision: retraction disappears, no duplicate candidates
        c.post(f"/api/sessions/{sid}/control", json={"action": "seek", "elapsed_ms": shot.elapsed_ms + 1000})
        assert "P-D2-NBA-2005" not in sess.intelligence.retractions
        ids = [x.candidate_id for x in sess.intelligence.candidates]
        assert len(ids) == len(set(ids))
        # the 28' channel story (a confirmed goal) is never retracted
        c.post(f"/api/sessions/{sid}/control", json={"action": "seek", "elapsed_ms": sess.duration_ms})
        assert set(sess.intelligence.retractions) == {"P-D2-NBA-2005"}


def test_evidence_available_without_insight_record() -> None:
    with TestClient(app) as c:
        r = c.get("/api/insights/P-D3-NBA-1601/evidence")
        assert r.status_code == 200 and r.json()["events"] and r.json()["candidate"]["pattern_type"] == "overlap"
        assert c.get("/api/insights/P-NOPE/evidence").status_code == 404


def test_cache_only_mode_serves_recorded_real_insight_and_never_calls(tmp_path) -> None:  # type: ignore[no-untyped-def]
    from byline.api.sessions import ReplaySession
    from byline.config import Settings
    from byline.storage.fixtures import load_package
    from byline.stories.service import InsightService

    def boom() -> None:
        raise AssertionError("no client may be created in cache-only mode")

    svc = InsightService(Settings(byline_ai_provider="foundry", byline_ai_cache_only=True,
                                  foundry_deployment="gpt-4.1-mini"), lambda: [], boom, cache_dir=tmp_path)
    pkg = load_package("golden_story")
    s = ReplaySession("t", pkg, on_candidate=svc.submit)
    q = s.subscribe()
    s.seek(pkg.events[-1].elapsed_ms)
    ups = {}
    while not q.empty():
        m = q.get_nowait()
        if m.event == "insight_update":
            ups[m.data["candidate_id"]] = m.data
    assert ups["P-D3-NBA-1601"]["stage"] == "verified" and ups["P-D3-NBA-1601"]["from_cache"] is True
    assert ups["P-D3-NBA-1601"]["trace_summary"]["provider"] == "foundry"
    assert ups["P-D2-RVC-0986"]["stage"] == "verified"  # V5: first real run on this story (2026-10-21)
    assert ups["P-D2-RVC-1471"]["insight"]["verification"]["checker_name"] == "deterministic_only (ai_cache_only)"


def test_background_work_scheduled_from_worker_thread() -> None:
    """Regression: sync routes run in a threadpool; scheduling must target the server loop."""
    import asyncio
    import threading

    from byline.config import Settings
    from byline.stories.service import InsightService

    svc = InsightService(Settings(byline_ai_provider="off"), lambda: [], None, cache_dir=None)
    loop = asyncio.new_event_loop()
    svc.loop = loop
    done = threading.Event()

    async def work() -> None:
        done.set()

    t = threading.Thread(target=loop.run_forever, daemon=True)
    t.start()
    fut = svc._spawn(work())  # called from this (non-loop) thread
    fut.result(timeout=5)
    assert done.is_set()
    loop.call_soon_threadsafe(loop.stop)


def test_recap_endpoint_ok_in_cache_only_mode() -> None:
    """Regression: recap after FT must not 500 (no model recap is started in cache-only mode)."""
    rt = None
    with TestClient(app) as c:
        rt = app.state.rt
        rt.settings = rt.settings.model_copy(update={"byline_ai_provider": "foundry", "byline_ai_cache_only": True})
        rt.insights.settings = rt.settings
        sid = c.post("/api/matches/BYLINE-01/sessions", json={"speed": 30}).json()["session_id"]
        sess = rt.sessions.get(sid)
        c.post(f"/api/sessions/{sid}/control", json={"action": "seek", "elapsed_ms": sess.duration_ms})
        r = c.get(f"/api/sessions/{sid}/recap")
        assert r.status_code == 200 and r.json()["generated_by"] in ("deterministic", "foundry_recap_writer")
        assert r.json()["final_score"] == {"Northbridge": 2, "Riverton": 1}
        assert rt.insights.recap_tasks == {}


def test_demo_metrics_and_match_recap() -> None:
    with TestClient(app) as c:
        m = c.get("/api/metrics/demo").json()
        assert m["synthetic"] is True and "budget" in m
        blob = json.dumps(m)
        assert "services.ai.azure.com" not in blob and "tenant" not in blob.lower()
        r = c.get("/api/matches/BYLINE-02/recap").json()
        assert r["final_score"] == {"Northbridge": 2, "Riverton": 1} and r["generated_by"] == "deterministic"


def test_cache_only_status_is_recorded_not_degraded(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    """The public demo serves recorded real runs: it must not look broken even when the call budget is spent."""
    from byline.api.app import Runtime
    from byline.config import get_settings

    monkeypatch.setenv("BYLINE_AI_PROVIDER", "foundry")
    monkeypatch.setenv("BYLINE_AI_CACHE_ONLY", "true")
    get_settings.cache_clear()
    try:
        st = Runtime().provider_view()
    finally:
        get_settings.cache_clear()
    assert st.state == "recorded" and "no new model calls" in st.detail
