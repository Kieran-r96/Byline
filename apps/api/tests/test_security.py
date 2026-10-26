"""Pre-deployment security checks (docs/security-audit.md). No test here reaches a real model: the model client
factory is a spy that fails the test if it is ever invoked."""

from __future__ import annotations

import importlib.util
import json
import logging
import subprocess
import sys
import uuid
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic import SecretStr

import byline.api.app as app_module
from byline.agents.budget import BudgetExceeded, BudgetGuard
from byline.agents.ledger import CallLedger
from byline.agents.provider import ProviderStatus
from byline.api.app import CONTENT_SECURITY_POLICY, SecurityMiddleware, app, client_key, mount_static
from byline.api.sessions import ReplaySession, StreamMessage
from byline.config import API_ROOT, REPO_ROOT, Settings, get_settings
from byline.storage.fixtures import available_scenarios, load_package
from byline.stories.service import InsightService

# canaries built at runtime so this file never trips tools/secret_scan.py
CANARY_HOST = "contoso-canary" + ".services.ai" + ".azure.com"
CANARY_TENANT = str(uuid.UUID(int=0x5EC12E7_0000_4000_8000_0000_0000_CAFE))
CANARY_KEY = "Zk" * 24
CANARIES = (CANARY_HOST, CANARY_TENANT, CANARY_KEY)


def canary_settings(**over: Any) -> Settings:
    base: dict[str, Any] = {
        "byline_ai_provider": "foundry", "byline_ai_cache_only": True, "foundry_deployment": "gpt-4.1-mini",
        "foundry_openai_base_url": f"https://{CANARY_HOST}/openai/v1", "foundry_tenant_id": CANARY_TENANT,
        "foundry_auth": "api_key", "foundry_api_key": SecretStr(CANARY_KEY),
    }
    base.update(over)
    return Settings(**base)


class SpyFactory:
    """Stands in for byline.agents.provider.chat_client. Creating a client is the first step of any model call."""

    def __init__(self) -> None:
        self.calls = 0

    def __call__(self) -> Any:
        self.calls += 1
        raise AssertionError("a model client was requested")


def full_ledger(tmp_path: Path, used: int = 59, cap: int = 20) -> CallLedger:
    path = tmp_path / "model_call_ledger.json"
    path.write_text(json.dumps({"calls": used, "started_at": 0, "entries": []}), encoding="utf-8")
    return CallLedger(cap=cap, path=path)


# ---------------------------------------------------------------- headers, CORS, debug, docs


def test_security_headers_on_api_errors_and_rate_limited_responses(monkeypatch: pytest.MonkeyPatch) -> None:
    with TestClient(app) as c:
        responses = [c.get("/healthz"), c.get("/api/matches"), c.get("/api/matches/NOPE"),
                     c.get("/api/matches/BYLINE-01/tracking?from_ms=0&to_ms=999999")]
        monkeypatch.setattr(app_module, "RATE_PER_S", 0.0)
        monkeypatch.setattr(app_module, "RATE_BURST", 1.0)
        app_module._buckets.clear()
        responses += [c.get("/api/rules"), c.get("/api/rules")]
    assert [r.status_code for r in responses] == [200, 200, 404, 422, 200, 429]
    for r in responses:
        assert r.headers["content-security-policy"] == CONTENT_SECURITY_POLICY
        assert r.headers["x-content-type-options"] == "nosniff"
        assert r.headers["x-frame-options"] == "DENY"
        assert r.headers["referrer-policy"] == "no-referrer"
        assert "camera=()" in r.headers["permissions-policy"]
        assert r.headers["cross-origin-opener-policy"] == "same-origin"
        assert "strict-transport-security" not in r.headers  # only behind HTTPS (BYLINE_HSTS)


def test_csp_has_no_unsafe_sources_and_blocks_framing() -> None:
    directives = dict(d.split(" ", 1) for d in CONTENT_SECURITY_POLICY.split("; "))
    assert "unsafe-inline" not in CONTENT_SECURITY_POLICY and "unsafe-eval" not in CONTENT_SECURITY_POLICY
    assert directives["script-src"] == "'self'" and directives["connect-src"] == "'self'"
    assert directives["frame-ancestors"] == "'none'" and directives["object-src"] == "'none'"
    assert "http" not in CONTENT_SECURITY_POLICY  # no third-party host is allowed anywhere


def test_hsts_only_when_enabled() -> None:
    inner = FastAPI()

    @inner.get("/x")
    def x() -> dict[str, bool]:
        return {"ok": True}

    with TestClient(SecurityMiddleware(inner, hsts=True)) as c:
        assert c.get("/x").headers["strict-transport-security"].startswith("max-age=31536000")


def test_no_cors_grant_for_other_origins() -> None:
    with TestClient(app) as c:
        r = c.get("/api/matches", headers={"Origin": "https://evil.example"})
        pre = c.options("/api/matches/BYLINE-01/sessions", headers={
            "Origin": "https://evil.example", "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type"})
    assert r.status_code == 200 and "access-control-allow-origin" not in r.headers
    assert pre.status_code >= 400 and "access-control-allow-origin" not in pre.headers


def test_cross_site_form_post_cannot_create_a_session() -> None:
    """A cross-site HTML form can only send text/plain or form bodies, which the JSON API rejects."""
    with TestClient(app) as c:
        r = c.post("/api/matches/BYLINE-01/sessions", content=b'{"speed": 12}',
                   headers={"Content-Type": "text/plain", "Origin": "https://evil.example"})
    assert r.status_code == 422


def test_debug_off_and_server_errors_are_generic(monkeypatch: pytest.MonkeyPatch) -> None:
    assert app.debug is False

    def explode() -> list[str]:
        raise RuntimeError(f"provider said: {CANARY_HOST} token {CANARY_KEY}")

    with TestClient(app, raise_server_exceptions=False) as c:
        monkeypatch.setattr(app_module, "available_scenarios", explode)
        r = c.get("/api/matches")
    assert r.status_code == 500 and r.text == "Internal Server Error"
    assert "Traceback" not in r.text and CANARY_HOST not in r.text


def test_public_image_settings_disable_interactive_docs() -> None:
    """The Dockerfile sets BYLINE_API_DOCS=false: /docs and /redoc (CDN-hosted UIs) are not served."""
    code = ("import byline.api.app as a; print(a.app.docs_url, a.app.redoc_url, a.app.debug, "
            "a.get_settings().byline_ai_cache_only, a.get_settings().byline_model_call_cap)")
    env = {**_minimal_env(), **_dockerfile_env()}
    out = subprocess.run([sys.executable, "-c", code], cwd=API_ROOT, env=env, capture_output=True, text=True,
                         check=True, timeout=120).stdout.split()
    assert out == ["None", "None", "False", "True", "0"]


def _minimal_env() -> dict[str, str]:
    import os

    keep = ("PATH", "SYSTEMROOT", "TEMP", "TMP", "HOME", "USERPROFILE", "LOCALAPPDATA", "APPDATA", "PYTHONPATH")
    return {k: v for k, v in os.environ.items() if k in keep}


def _dockerfile_env() -> dict[str, str]:
    """The ENV block of the repo Dockerfile's runtime stage, parsed (so this test tracks the real file)."""
    text = (REPO_ROOT / "Dockerfile").read_text(encoding="utf-8")
    stage = text.split("AS api", 1)[1]
    block = stage.split("ENV ", 1)[1].split("\nWORKDIR", 1)[0].replace("\\\n", " ")
    pairs = dict(tok.split("=", 1) for tok in block.split() if "=" in tok)
    pairs.pop("BYLINE_STATIC_DIR", None)
    return pairs


def test_dockerfile_public_defaults() -> None:
    env = _dockerfile_env()
    assert env["BYLINE_AI_CACHE_ONLY"] == "true" and env["BYLINE_MODEL_CALL_CAP"] == "0"
    assert env["BYLINE_API_DOCS"] == "false"
    assert "FOUNDRY_OPENAI_BASE_URL" not in env and "FOUNDRY_API_KEY" not in env and "FOUNDRY_TENANT_ID" not in env
    dockerignore = (REPO_ROOT / ".dockerignore").read_text(encoding="utf-8").split()
    assert ".env" in dockerignore and "**/.cache" in dockerignore


# ---------------------------------------------------------------- input handling


def test_oversized_bodies_rejected_before_parsing() -> None:
    with TestClient(app) as c:
        big = c.post("/api/matches/BYLINE-01/sessions", content=b"{" + b" " * 40_000 + b"}",
                     headers={"Content-Type": "application/json"})

        def chunks() -> Iterator[bytes]:
            yield b'{"speed": 12, "pad": "'
            for _ in range(40):
                yield b"x" * 1024
            yield b'"}'

        chunked = c.post("/api/matches/BYLINE-01/sessions", content=chunks(),
                         headers={"Content-Type": "application/json"})
        bad_length = c.post("/api/matches/BYLINE-01/sessions", content=b"{}",
                            headers={"Content-Type": "application/json", "Content-Length": "-1"})
        ok = c.post("/api/matches/BYLINE-01/sessions", json={"speed": 12})
    assert big.status_code == 413 and big.headers["x-content-type-options"] == "nosniff"
    assert chunked.status_code == 413
    assert bad_length.status_code in (400, 413)
    assert ok.status_code == 200


def test_parameter_bounds_and_unknown_ids() -> None:
    with TestClient(app) as c:
        sid = c.post("/api/matches/BYLINE-01/sessions", json={"speed": 12}).json()["session_id"]
        codes = {
            "bad speed": c.post("/api/matches/BYLINE-01/sessions", json={"speed": 1000}).status_code,
            "bad control": c.post(f"/api/sessions/{sid}/control", json={"action": "rm -rf"}).status_code,
            "negative seek": c.post(f"/api/sessions/{sid}/control",
                                    json={"action": "seek", "elapsed_ms": -5}).status_code,
            "seek no ms": c.post(f"/api/sessions/{sid}/control", json={"action": "seek"}).status_code,
            "speed not allowed": c.post(f"/api/sessions/{sid}/control",
                                        json={"action": "speed", "speed": 7}).status_code,
            "huge window": c.get("/api/matches/BYLINE-01/tracking?from_ms=0&to_ms=999999").status_code,
            "reversed window": c.get("/api/matches/BYLINE-01/tracking?from_ms=50&to_ms=10").status_code,
            "limit too big": c.get("/api/matches/BYLINE-01/events?limit=999999").status_code,
            "negative seq": c.get("/api/matches/BYLINE-01/state?upto_seq=-9").status_code,
            "long ref": c.post(f"/api/sessions/{sid}/overlays/propose",
                               json={"kind": "tactical", "ref": "x" * 500}).status_code,
            "bad overlay action": c.post(f"/api/sessions/{sid}/overlays/O-1/delete").status_code,
            "delay too long": c.post(f"/api/sessions/{sid}/overlays/O-1/approve?cue=delay&delay_ms=9999999").status_code,
            "unknown session": c.get("/api/sessions/does-not-exist/state").status_code,
            "unknown match": c.get("/api/matches/../../etc/passwd").status_code,
            "unknown moment": c.get("/api/matches/BYLINE-01/tactics/..%2F..%2Fx/insight").status_code,
            "unknown player": c.get("/api/matches/BYLINE-01/players/NOPE/facts").status_code,
            "unknown law": c.get("/api/rules/999").status_code,
        }
        far_seek = c.post(f"/api/sessions/{sid}/control", json={"action": "seek", "elapsed_ms": 10**12})
    assert all(code in (404, 422) for code in codes.values()), codes
    assert far_seek.status_code == 200 and far_seek.json()["playhead_ms"] <= 7_000_000  # clamped to full time


def test_session_ids_are_unguessable_and_not_listed() -> None:
    with TestClient(app) as c:
        ids = {c.post("/api/matches/BYLINE-01/sessions", json={"speed": 12}).json()["session_id"] for _ in range(3)}
        listing = json.dumps([c.get("/api/system/status").json(), c.get("/api/metrics/demo").json()])
    assert all(len(i) >= 16 for i in ids)  # secrets.token_urlsafe(12): 96 random bits
    assert not any(i in listing for i in ids)


def test_spoofed_forwarded_for_does_not_evade_rate_limit(monkeypatch: pytest.MonkeyPatch) -> None:
    with TestClient(app) as c:
        monkeypatch.setattr(app_module, "RATE_PER_S", 0.0)
        monkeypatch.setattr(app_module, "RATE_BURST", 3.0)
        app_module._buckets.clear()
        codes = [c.get("/api/rules", headers={"X-Forwarded-For": f"10.0.0.{i}"}).status_code for i in range(5)]
    assert codes == [200, 200, 200, 429, 429]


class _Req:
    def __init__(self, xff: str | None, peer: str = "203.0.113.9") -> None:
        self.headers = {"x-forwarded-for": xff} if xff is not None else {}
        self.client = type("C", (), {"host": peer})()


def test_client_key_trusts_only_proxy_appended_entries(monkeypatch: pytest.MonkeyPatch) -> None:
    assert client_key(_Req("1.1.1.1, 198.51.100.7")) == "203.0.113.9"  # default: header ignored
    monkeypatch.setattr(get_settings(), "byline_trusted_proxy_hops", 1)
    assert client_key(_Req("1.1.1.1, 198.51.100.7")) == "198.51.100.7"  # the entry our ingress appended
    assert client_key(_Req("198.51.100.7")) == "198.51.100.7"
    assert client_key(_Req(None)) == "203.0.113.9"


def test_static_serving_contains_path_traversal(tmp_path: Path) -> None:
    root = tmp_path / "web"
    (root / "assets").mkdir(parents=True)
    (root / "index.html").write_text("<div id=root>", encoding="utf-8")
    (root / "assets" / "app.js").write_text("console.log(1)", encoding="utf-8")
    (tmp_path / "secret.txt").write_text("TOP-SECRET", encoding="utf-8")
    site = FastAPI()
    mount_static(site, root)
    with TestClient(site) as c:
        assert c.get("/").text == "<div id=root>"
        assert c.get("/assets/app.js").text == "console.log(1)"
        assert c.get("/commentator/deep/link").text == "<div id=root>"  # client-side route -> app shell
        for probe in ("/..%2Fsecret.txt", "/%2e%2e/secret.txt", "/assets/..%2F..%2Fsecret.txt",
                      "/%2e%2e%2f%2e%2e%2fsecret.txt", "/..\\secret.txt", "/assets/%2e%2e/%2e%2e/secret.txt"):
            r = c.get(probe)
            assert "TOP-SECRET" not in r.text, probe
        api = c.get("/api/does-not-exist")
    assert api.status_code == 404 and api.json() == {"detail": "Not Found"}


# ---------------------------------------------------------------- Foundry: no anonymous path can spend


def _drive_whole_match(svc: InsightService, scenario: str) -> list[StreamMessage]:
    """Play a full match live (every candidate, storyline and retraction goes through the live path), then seek
    back and forth (the rebuild path) and ask for the full-time recap."""
    pkg = load_package(scenario)
    s = ReplaySession(f"t-{scenario}", pkg, on_candidate=svc.submit, on_retract=svc.retract,
                      storyline_view=svc.storyline_view, speed=60)
    q = s.subscribe()
    s.playing = True
    out: list[StreamMessage] = []
    while s.cursor < len(s.events):
        s.tick(5.0)  # 5 s x 60 = 5 minutes of match per tick
        while not q.empty():
            out.append(q.get_nowait())
    svc.recap(s)
    for target in (pkg.events[-1].elapsed_ms // 3, 0, pkg.events[-1].elapsed_ms):
        s.seek(target)
    while not q.empty():
        out.append(q.get_nowait())
    return out


@pytest.mark.parametrize("scenario", available_scenarios())
def test_cache_only_never_requests_a_model_client_over_whole_matches(scenario: str, tmp_path: Path) -> None:
    spy = SpyFactory()
    svc = InsightService(canary_settings(), lambda: [], spy, cache_dir=tmp_path / "insights")
    svc.budget.ledger = full_ledger(tmp_path, used=0, cap=1000)  # plenty of budget: only cache-only stops it
    msgs = _drive_whole_match(svc, scenario)
    assert spy.calls == 0
    assert svc.tasks == {} and svc.read_tasks == {} and svc.recap_tasks == {}
    assert svc.budget.ledger.used() == 0
    assert any(m.event == "insight_update" for m in msgs) or scenario != "golden_story"
    blob = json.dumps([m.data for m in msgs])
    assert not any(c in blob for c in CANARIES)


@pytest.mark.parametrize("scenario", available_scenarios())
def test_exhausted_ledger_blocks_every_live_path_even_without_cache_only(scenario: str, tmp_path: Path) -> None:
    """If cache-only were switched off by mistake, the persistent hard cap (59 used of 20) still stops all spend."""
    spy = SpyFactory()
    svc = InsightService(canary_settings(byline_ai_cache_only=False), lambda: [], spy,
                         cache_dir=tmp_path / "insights")
    svc.budget.ledger = full_ledger(tmp_path, used=59, cap=20)
    msgs = _drive_whole_match(svc, scenario)
    assert spy.calls == 0
    assert svc.tasks == {} and svc.read_tasks == {} and svc.recap_tasks == {}
    assert svc.budget.ledger.used() == 59
    fallbacks = [m.data for m in msgs if m.event == "insight_update" and not m.data["from_cache"]]
    assert all(m["stage"] == "tentative" for m in fallbacks)


def test_cap_zero_blocks_the_first_call(tmp_path: Path) -> None:
    """The public image sets BYLINE_MODEL_CALL_CAP=0: no call can be reserved even on a fresh container disk."""
    g = BudgetGuard(max_calls_per_session=30, max_calls_per_day=400, max_tokens_per_case=14_000,
                    ledger=CallLedger(cap=0, path=tmp_path / "fresh.json"))
    assert g.can_start("anyone") == (False, "ledger_cap")
    with pytest.raises(BudgetExceeded, match="ledger_cap"):
        g.charge("anyone", 0)


def _crawl(c: TestClient) -> list[tuple[str, int, str]]:
    seen: list[tuple[str, int, str]] = []

    def get(path: str) -> Any:
        r = c.get(path)
        seen.append((path, r.status_code, r.text))
        return r.json() if r.headers.get("content-type", "").startswith("application/json") else None

    for p in ("/healthz", "/api/system/status", "/api/metrics/demo", "/api/rules", "/api/rules/11"):
        get(p)
    for m in get("/api/matches"):
        mid = m["match_id"]
        # a visitor's session first: reaching the stories creates the insight records (recorded real runs with
        # full agent traces, or labelled fallbacks) that the insight, evidence and trace routes then serve
        sid = c.post(f"/api/matches/{mid}/sessions", json={"speed": 60}).json()["session_id"]
        for body in ({"action": "play"}, {"action": "seek", "elapsed_ms": 1_700_000}, {"action": "pause"},
                     {"action": "seek", "elapsed_ms": 10**9}):
            r = c.post(f"/api/sessions/{sid}/control", json=body)
            seen.append((f"control {body}", r.status_code, r.text))
        r = c.post(f"/api/sessions/{sid}/overlays/propose", json={"kind": "stats"})
        seen.append(("propose", r.status_code, r.text))
        for suffix in ("/state", "/overlays", "/recap"):
            get(f"/api/sessions/{sid}{suffix}")
        for suffix in ("", "/events?limit=50", "/tracking?from_ms=0&to_ms=20000", "/state", "/decisions",
                       "/patterns", "/storylines", "/signals", "/context", "/dossier/h2h", "/dossier/match",
                       "/talking-points", "/showcase", "/recap", f"/teams/{m['home']}/facts",
                       f"/dossier/teams/{m['away']}"):
            get(f"/api/matches/{mid}{suffix}")
        for t in get(f"/api/matches/{mid}/tactics")[:40]:
            get(f"/api/matches/{mid}/tactics/{t['moment_id']}/view")
            get(f"/api/matches/{mid}/tactics/{t['moment_id']}/insight")
        for cand in get(f"/api/matches/{mid}/patterns"):
            for suffix in ("", f"?session_id={sid}", "/evidence", "/trace"):
                get(f"/api/insights/I-{cand['candidate_id']}{suffix}")
    return seen


def test_anonymous_crawl_makes_no_model_call_and_leaks_no_credentials(tmp_path: Path,
                                                                       caplog: pytest.LogCaptureFixture) -> None:
    """Every public GET and every session action, as an anonymous visitor, against a server configured like the
    public demo but holding canary credentials: no model client is requested and no canary appears in any
    response body or log line."""
    spy = SpyFactory()
    caplog.set_level(logging.DEBUG)
    with TestClient(app) as c:
        rt = app.state.rt
        settings = canary_settings()
        svc = InsightService(settings, lambda: list(rt.sessions.sessions.values()), spy,
                             cache_dir=tmp_path / "insights")
        svc.loop = rt.insights.loop
        svc.budget.ledger = full_ledger(tmp_path, used=0, cap=1000)
        rt.settings, rt.insights = settings, svc
        rt.provider_status = ProviderStatus("foundry", "configured", settings.foundry_deployment, "configured")
        rt.sessions.on_candidate, rt.sessions.on_retract = svc.submit, svc.retract
        rt.sessions.storyline_view = svc.storyline_view
        seen = _crawl(c)
    assert spy.calls == 0 and svc.budget.ledger.used() == 0
    assert len(seen) > 150
    traces = [json.loads(t) for p, code, t in seen if p.endswith("/trace") and code == 200]
    assert any(t["provider"] == "foundry" and t["total_model_calls"] > 0 for t in traces)  # real recorded runs
    assert all(code < 500 for _, code, _ in seen), [(p, code) for p, code, _ in seen if code >= 500]
    for path, _, text in seen:
        assert not any(canary in text for canary in CANARIES), path
    assert not any(canary in rec.getMessage() for rec in caplog.records for canary in CANARIES)
    status = next(json.loads(t) for p, _, t in seen if p == "/api/system/status")
    assert status["ai"]["state"] == "recorded" and status["ai"]["cache_only"] is True


# ---------------------------------------------------------------- secret scanner self-test


def _scanner() -> Any:
    spec = importlib.util.spec_from_file_location("secret_scan", REPO_ROOT / "tools" / "secret_scan.py")
    assert spec is not None and spec.loader is not None
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_secret_scanner_detects_each_pattern_without_printing_values() -> None:
    scan = _scanner()
    samples = {
        "private key": "-----BEGIN " + "PRIVATE KEY-----",
        "azure key assignment": "api_key" + " = '" + "A1b2" * 10 + "'",
        "jwt": "eyJ" + "a" * 24 + ".eyJ" + "b" * 24 + "." + "c" * 12,
        "connection string": "AccountKey" + "=" + "Q" * 30,
        "openai key": "sk-" + "x" * 40,
        "entra client secret": "abc" + "8Q~" + "y" * 34,
        "azure sas signature": "https://a.blob.core.windows.net/c?sv=1&sig" + "=" + "Z" * 40,
        "github token": "ghp" + "_" + "g" * 36,
        "azure ai resource hostname": "https://" + CANARY_HOST + "/openai/v1",
        "tenant or subscription id": "tenant_id" + "=" + CANARY_TENANT,
    }
    for name, text in samples.items():
        assert name in scan.scan_text(text), name
    assert scan.scan_text("FOUNDRY_OPENAI_BASE_URL=https://<your-resource>.services.ai.azure.com/openai/v1") == []
    assert scan.FORBIDDEN_FILES.search(".env") and scan.FORBIDDEN_FILES.search("apps/api/.env.local")
    assert not scan.FORBIDDEN_FILES.search(".env.example")


def test_dist_scan_finds_a_planted_token(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    scan = _scanner()
    (tmp_path / "assets").mkdir()
    (tmp_path / "assets" / "index.js").write_text("const t='" + "ghp" + "_" + "q" * 36 + "'", encoding="utf-8")
    assert scan.main(["--dir", str(tmp_path)]) == 1
    out = capsys.readouterr().out
    assert "github token" in out and "q" * 36 not in out
