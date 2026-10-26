"""BYLINE HTTP API. Read-only demo surface; model calls only via bounded server-side cases."""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import time
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from functools import lru_cache
from pathlib import Path
from typing import Any, Literal

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from byline.agents.provider import ProviderStatus, chat_client
from byline.agents.tactical import ai_state as tactical_ai_state
from byline.agents.tactical import insight_response as tactical_insight_response
from byline.api.sessions import ALLOWED_SPEEDS, ReplaySession, SessionLimit, SessionManager, StreamMessage
from byline.config import REPO_ROOT, get_settings
from byline.football.intelligence import context_for, moments_for, run_detectors
from byline.football.rules_reference import LAWS, VAR_PROTOCOL, law_reference
from byline.storage.fixtures import MatchPackage, available_scenarios, load_package, package_for_match
from byline.stories.recap import RecapNotReady, deterministic_recap, recap_facts
from byline.stories.service import InsightService
from byline.tactics.frame import Pitch
from byline.tactics.whatif import build_view, build_whatif
from byline.world.context import ContextFact, context_facts
from byline.world.dossier import h2h_dossier, match_dossier, player_dossier, talking_points, team_dossier
from byline.world.facts import contextualise, match_facts, ranked, seeded_facts

log = logging.getLogger("byline.api")
VERSION = "0.2.0"


class Runtime:
    def __init__(self) -> None:
        self.settings = get_settings()
        self.sessions = SessionManager()
        factory = chat_client if self.settings.byline_ai_provider == "foundry" else None
        self.insights = InsightService(self.settings, lambda: list(self.sessions.sessions.values()), factory)
        self.sessions.on_candidate = self.insights.submit
        self.sessions.on_retract = self.insights.retract
        self.sessions.storyline_view = self.insights.storyline_view
        self.provider_status = ProviderStatus(
            self.settings.byline_ai_provider,
            "configured" if self.settings.byline_ai_provider == "foundry" else "disabled",
            self.settings.foundry_deployment,
            "Live Foundry deployment configured; status updates from real agent runs"
            if self.settings.byline_ai_provider == "foundry" else "AI disabled by configuration",
        )

    def provider_view(self) -> ProviderStatus:
        """Derived from real agent outcomes; viewing status never spends a model call."""
        st = self.provider_status
        if st.provider != "foundry":
            return st
        if self.settings.byline_ai_cache_only:
            # never calls a model: serves recorded real runs, so it is neither live nor degraded
            return ProviderStatus("foundry", "recorded", st.deployment,
                                  "Recorded real Foundry runs; no new model calls")
        b = self.insights.budget
        if b.breaker_open:
            return ProviderStatus("foundry", "degraded", st.deployment, "Temporarily paused after model errors")
        if b.ledger is not None and b.ledger.remaining() == 0:
            return ProviderStatus("foundry", "degraded", st.deployment, "Demo model-call budget used; showing cached "
                                  "and detector-only insights")
        if b.latencies_ms:
            return ProviderStatus("foundry", "ready", st.deployment, "Live Foundry deployment responding",
                                  last_latency_ms=b.latencies_ms[-1])
        return st


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    rt = Runtime()
    rt.insights.loop = asyncio.get_running_loop()
    app.state.rt = rt
    for sid in available_scenarios():
        pkg = load_package(sid)  # warm caches: tactics + context facts make the first seek instant
        _replayed(pkg.match_id, None)
        _warm_dossiers(pkg.match_id)
    rt.sessions.start()
    yield
    await rt.sessions.stop()


_docs = get_settings().byline_api_docs
app = FastAPI(title="BYLINE API", version=VERSION, lifespan=lifespan,
              docs_url="/docs" if _docs else None, redoc_url="/redoc" if _docs else None)


RATE_PER_S = 15.0
RATE_BURST = 60.0
_buckets: dict[str, tuple[float, float]] = {}


def client_key(request: Request) -> str:
    """The client address for rate limits and session quotas. X-Forwarded-For is client-controlled, except for
    the entries our own proxies append on the right, so exactly BYLINE_TRUSTED_PROXY_HOPS of them are trusted."""
    hops = get_settings().byline_trusted_proxy_hops
    if hops > 0:
        chain = [p.strip() for p in request.headers.get("x-forwarded-for", "").split(",") if p.strip()]
        if len(chain) >= hops:
            return chain[-hops][:64]
    return request.client.host if request.client else "unknown"


@app.middleware("http")
async def rate_limit(request: Request, call_next: Any) -> Any:
    if request.url.path.startswith("/api/") and not request.url.path.endswith("/stream"):
        key = client_key(request)
        now = time.monotonic()
        tokens, last = _buckets.get(key, (RATE_BURST, now))
        tokens = min(RATE_BURST, tokens + (now - last) * RATE_PER_S)
        if tokens < 1.0:
            return JSONResponse({"detail": "rate limited"}, status_code=429, headers={"Retry-After": "2"})
        _buckets[key] = (tokens - 1.0, now)
        if len(_buckets) > 10_000:
            _buckets.clear()
    return await call_next(request)


# Same-origin single container: the built app loads only its own hashed scripts, stylesheet, self-hosted fonts and
# favicon, and talks only to its own API (fetch + EventSource). Three.js renders to a canvas (no workers or eval);
# zod runs jitless (no eval); Vite inlines the smallest font subsets as data: URIs.
CONTENT_SECURITY_POLICY = "; ".join([
    "default-src 'self'", "script-src 'self'", "style-src 'self'", "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self'", "media-src 'self'", "worker-src 'self' blob:", "object-src 'none'", "base-uri 'none'",
    "form-action 'self'", "frame-ancestors 'none'",
])
SECURITY_HEADERS = {
    "Content-Security-Policy": CONTENT_SECURITY_POLICY,
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "X-Frame-Options": "DENY",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Resource-Policy": "same-origin",
}
HSTS = "max-age=31536000; includeSubDomains"


class SecurityMiddleware:
    """Pure ASGI (safe for SSE): adds browser security headers to every response and refuses request bodies over
    BYLINE_MAX_BODY_BYTES (413) before they are buffered. No CORS middleware is installed on purpose: the app and
    API share one origin, so browsers refuse cross-origin reads."""

    def __init__(self, app: ASGIApp, *, hsts: bool = False, max_body: int = 16_384) -> None:
        self.app = app
        self.max_body = max_body
        self.headers = [(k.lower().encode(), v.encode()) for k, v in SECURITY_HEADERS.items()]
        if hsts:
            self.headers.append((b"strict-transport-security", HSTS.encode()))

    def _with_headers(self, send: Send) -> Send:
        async def send_secured(message: Message) -> None:
            if message["type"] == "http.response.start":
                present = {k.lower() for k, _ in message.get("headers", [])}
                message["headers"] = [*message.get("headers", []),
                                      *[(k, v) for k, v in self.headers if k not in present]]
            await send(message)
        return send_secured

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        secured = self._with_headers(send)
        too_large = JSONResponse({"detail": "request body too large"}, status_code=413)
        length = dict(scope["headers"]).get(b"content-length")
        if length is not None and (not length.isdigit() or int(length) > self.max_body):
            await too_large(scope, receive, secured)
            return
        received, over, started = 0, False, False

        async def receive_bounded() -> Message:
            nonlocal received, over
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > self.max_body:  # a chunked upload with no Content-Length: stop reading it
                    over = True
                    return {"type": "http.disconnect"}
            return message

        async def send_bounded(message: Message) -> None:
            nonlocal started
            if over:  # whatever the app answers to the cut-off body, the client is told why: 413
                if not started:
                    started = True
                    await too_large(scope, receive, secured)
                return
            if message["type"] == "http.response.start":
                started = True
            await secured(message)

        try:
            await self.app(scope, receive_bounded, send_bounded)
        except Exception:
            if not over:
                raise
            if not started:
                await too_large(scope, receive, secured)


app.add_middleware(SecurityMiddleware, hsts=get_settings().byline_hsts,
                   max_body=get_settings().byline_max_body_bytes)


def rt_of(request: Request) -> Runtime:
    return request.app.state.rt  # type: ignore[no-any-return]


def pkg_or_404(match_id: str) -> MatchPackage:
    try:
        return package_for_match(match_id)
    except KeyError:
        raise HTTPException(404, "unknown match") from None


def session_or_404(rt: Runtime, sid: str) -> ReplaySession:
    try:
        return rt.sessions.get(sid)
    except KeyError:
        raise HTTPException(404, "session expired") from None


# ---------------------------------------------------------------- health and status


@app.get("/healthz")
def healthz() -> dict[str, str]:
    return {"status": "ok", "version": VERSION}


@app.get("/api/system/status")
def system_status(request: Request) -> dict[str, Any]:
    rt = rt_of(request)
    st = rt.provider_view()
    return {
        "ai": {"provider": st.provider, "state": st.state, "deployment": st.deployment,
               "detail": st.detail, "last_latency_ms": st.last_latency_ms,
               "calls_used": rt.insights.budget.ledger.used() if rt.insights.budget.ledger
               else rt.insights.budget.day_calls,
               "calls_cap": rt.insights.budget.ledger.cap if rt.insights.budget.ledger
               else rt.insights.budget.max_calls_per_day,
               "budget": rt.insights.budget.snapshot(), "cache_only": rt.settings.byline_ai_cache_only},
        "synthetic": True,
        "version": VERSION,
        "sessions": len(rt.sessions.sessions),
        "orchestration": "Microsoft Agent Framework (Python) workflow: investigator -> analyst -> verifier",
    }


# ---------------------------------------------------------------- matches


@app.get("/api/matches")
def list_matches() -> list[dict[str, Any]]:
    out = []
    for sid in available_scenarios():
        p = load_package(sid)
        f = p.world.fixture
        out.append({"match_id": f.match_id, "scenario_id": sid, "title": f.scenario.title,
                    "description": f.scenario.description, "seed": f.scenario.seed, "home": f.home_team_id,
                    "away": f.away_team_id, "duration_ms": p.events[-1].elapsed_ms, "synthetic": True})
    return out


@app.get("/api/matches/{match_id}")
def get_match(match_id: str) -> dict[str, Any]:
    p = pkg_or_404(match_id)
    h1 = next(e for e in p.events if e.type == "period.started")
    h2 = [e for e in p.events if e.type == "period.started"][-1]
    return {
        "world": p.world.model_dump(mode="json"),
        "duration_ms": p.events[-1].elapsed_ms,
        "periods": [{"period": "H1", "start_ms": h1.elapsed_ms}, {"period": "H2", "start_ms": h2.elapsed_ms}],
        "event_count": len(p.events),
        "events_sha256": p.events_sha256,
        "tracking": {"interval_ms": p.tracking["interval_ms"], "entities": p.tracking["entities"],
                     "precision": p.tracking["precision"]},
    }


@app.get("/api/matches/{match_id}/events")
def get_events(match_id: str, after_seq: int = Query(-1, ge=-1), limit: int = Query(500, ge=1, le=2000),
               upto_ms: int | None = Query(None, ge=0)) -> dict[str, Any]:
    p = pkg_or_404(match_id)
    evs = [e for e in p.events[after_seq + 1:] if upto_ms is None or e.elapsed_ms <= upto_ms][:limit]
    return {"events": [e.to_json_dict() for e in evs], "last_seq": p.events[-1].seq}


@app.get("/api/matches/{match_id}/tracking")
def get_tracking(match_id: str, from_ms: int = Query(..., ge=0), to_ms: int = Query(..., ge=0)) -> JSONResponse:
    p = pkg_or_404(match_id)
    if to_ms < from_ms or to_ms - from_ms > 180_000:
        raise HTTPException(422, "window must be 0-180 s")
    frames = [r for r in p.tracking["frames"] if from_ms <= r[0] <= to_ms]
    return JSONResponse({"from_ms": from_ms, "to_ms": to_ms, "interval_ms": p.tracking["interval_ms"],
                         "frames": frames}, headers={"Cache-Control": "public, max-age=3600"})


@lru_cache(maxsize=256)
def _replayed(match_id: str, upto_seq: int | None) -> Any:
    p = package_for_match(match_id)
    evs = p.events if upto_seq is None else tuple(e for e in p.events if e.seq <= upto_seq)
    return run_detectors(p.world, evs, tracking=p.tracking,
                         moments=moments_for(p.events_sha256, p.world, p.events, p.tracking),
                         context_source=context_for(p.events_sha256, p.world))


@lru_cache(maxsize=256)
def _state_json(match_id: str, upto_seq: int | None) -> str:
    return json.dumps(_replayed(match_id, upto_seq).state.snapshot())


@app.get("/api/matches/{match_id}/state")
def get_state(match_id: str, upto_seq: int | None = Query(None, ge=0)) -> dict[str, Any]:
    pkg_or_404(match_id)
    data: dict[str, Any] = json.loads(_state_json(match_id, upto_seq))
    return data


@app.get("/api/matches/{match_id}/teams/{team_id}/facts")
def team_facts(match_id: str, team_id: str, upto_seq: int | None = Query(None, ge=-1)) -> dict[str, Any]:
    p = pkg_or_404(match_id)
    if team_id not in (p.world.fixture.home_team_id, p.world.fixture.away_team_id):
        raise HTTPException(404, "unknown team")
    evs = [e for e in p.events if upto_seq is None or e.seq <= upto_seq]
    facts = contextualise([f for f in seeded_facts(p.world) if f.subject_id == team_id], evs, team_id)
    return {"team_id": team_id, "facts": ranked(facts), "notice": "Fictional club history for a synthetic demo."}


@app.get("/api/matches/{match_id}/players/{player_id}/facts")
def player_facts(match_id: str, player_id: str, upto_seq: int | None = Query(None, ge=-1)) -> dict[str, Any]:
    p = pkg_or_404(match_id)
    if not p.world.has_player(player_id):
        raise HTTPException(404, "unknown player")
    evs = [e for e in p.events if upto_seq is None or e.seq <= upto_seq]
    seeded = contextualise([f for f in seeded_facts(p.world) if f.subject_id == player_id], evs, player_id)
    live = match_facts(p.world, player_id, evs)
    pl = p.world.player(player_id)
    return {"player": {**pl.model_dump(mode="json"), "display_name": pl.display_name},
            "facts": ranked(live + seeded), "notice": "Fictional player for a synthetic demo."}


@app.get("/api/matches/{match_id}/decisions")
def get_decisions(match_id: str, upto_seq: int | None = Query(None, ge=0)) -> list[dict[str, Any]]:
    """Why-that-decision cards for official decisions up to upto_seq (law-grounded, deterministic)."""
    pkg_or_404(match_id)
    return [d.model_dump(mode="json") for d in _replayed(match_id, upto_seq).explainer.cards]


@app.get("/api/matches/{match_id}/patterns")
def get_patterns(match_id: str, upto_seq: int | None = Query(None, ge=0)) -> list[dict[str, Any]]:
    pkg_or_404(match_id)
    mi = _replayed(match_id, upto_seq)
    return [mi.candidate_view(c).model_dump(mode="json") for c in mi.candidates]


@app.get("/api/matches/{match_id}/storylines")
def get_storylines(match_id: str, upto_seq: int | None = Query(None, ge=0)) -> list[dict[str, Any]]:
    """Persistent, versioned storylines as of `upto_seq` (deterministic; no model work)."""
    pkg_or_404(match_id)
    snap: list[dict[str, Any]] = _replayed(match_id, upto_seq).storylines.snapshot()
    return snap


@app.get("/api/matches/{match_id}/tactics")
def get_tactics(match_id: str, upto_seq: int | None = Query(None, ge=0)) -> list[dict[str, Any]]:
    """Tactical moments released by `upto_seq` (deterministic geometry over events + tracking)."""
    pkg_or_404(match_id)
    return [m.to_json() for m in _replayed(match_id, upto_seq).moments]


@app.get("/api/matches/{match_id}/tactics/{moment_id}/whatif")
def get_whatif(match_id: str, moment_id: str, upto_seq: int | None = Query(None, ge=0)) -> dict[str, Any]:
    """The decision instant, what happened, and real alternatives on the same frame (no outcomes implied)."""
    p = pkg_or_404(match_id)
    mi = _replayed(match_id, upto_seq)
    m = next((x for x in mi.moments if x.moment_id == moment_id), None)
    if m is None:
        raise HTTPException(404, "unknown or not yet available moment")
    data = build_whatif(m, p.world, list(p.events), Pitch(p.world, p.events, p.tracking))
    if data is None:
        raise HTTPException(404, "no what-if for this moment")
    return data


@app.get("/api/matches/{match_id}/tactics/{moment_id}/view")
def get_moment_view(match_id: str, moment_id: str, upto_seq: int | None = Query(None, ge=0)) -> dict[str, Any]:
    """Any released tactical moment as a drawable frame (positions, evidence arrows, lines, optional What If?)."""
    p = pkg_or_404(match_id)
    m = next((x for x in _replayed(match_id, upto_seq).moments if x.moment_id == moment_id), None)
    if m is None:
        raise HTTPException(404, "unknown or not yet available moment")
    view = build_view(m, p.world, list(p.events), Pitch(p.world, p.events, p.tracking))
    if view is None:
        raise HTTPException(404, "no frame for this moment")
    view["ai_state"] = tactical_ai_state(p, moment_id)  # reads recordings only; never a model call
    return view


@app.get("/api/matches/{match_id}/tactics/{moment_id}/insight")
def get_moment_insight(match_id: str, moment_id: str, request: Request,
                       upto_seq: int | None = Query(None, ge=0)) -> dict[str, Any]:
    """The agents' verified interpretation of a released tactical moment, when a run has been recorded.
    state: verified | tentative | rejected | not_run. Serves recordings only: an HTTP request never starts a
    model call, in any mode."""
    p = pkg_or_404(match_id)
    if not any(x.moment_id == moment_id for x in _replayed(match_id, upto_seq).moments):
        raise HTTPException(404, "unknown or not yet available moment")
    return tactical_insight_response(p, moment_id, cache_only=rt_of(request).settings.byline_ai_cache_only)


@app.get("/api/matches/{match_id}/signals")
def get_signals(match_id: str, upto_seq: int | None = Query(None, ge=0)) -> list[dict[str, Any]]:
    """The prioritised signal stream as of `upto_seq` (deduplicated, versioned, VAR-corrected)."""
    pkg_or_404(match_id)
    snap: list[dict[str, Any]] = _replayed(match_id, upto_seq).signals.snapshot()
    return snap


@lru_cache(maxsize=256)
def _context_json(match_id: str, upto_seq: int | None) -> str:
    p = package_for_match(match_id)
    evs = p.events if upto_seq is None else tuple(e for e in p.events if e.seq <= upto_seq)
    return json.dumps([f.to_json() for f in context_facts(p.world, evs)])


@app.get("/api/matches/{match_id}/context")
def get_context(match_id: str, upto_seq: int | None = Query(None, ge=0)) -> list[dict[str, Any]]:
    """History-derived context facts valid at `upto_seq` (fictional history; deterministic; never the future:
    only events with seq <= upto_seq are used)."""
    pkg_or_404(match_id)
    data: list[dict[str, Any]] = json.loads(_context_json(match_id, upto_seq))
    return data


# ---------------------------------------------------------------- V4 commentator research (dossiers + talking points)


def _seq_key(p: MatchPackage, upto_seq: int | None) -> int | None:
    """Normalise the playhead so every seq at or past the last event shares the full-log cache entry."""
    return None if upto_seq is None or upto_seq >= p.events[-1].seq else upto_seq


def _released(p: MatchPackage, upto_seq: int | None) -> tuple[Any, ...]:
    return p.events if upto_seq is None else tuple(e for e in p.events if e.seq <= upto_seq)


def _context_at(p: MatchPackage, upto_seq: int | None) -> list[ContextFact]:
    return list(context_for(p.events_sha256, p.world)(_released(p, upto_seq)))


@lru_cache(maxsize=1024)
def _dossier_json(kind: str, match_id: str, upto_seq: int | None, subject: str = "") -> str:
    """Memoised per (kind, match, seq, subject); deterministic, so a cached answer is always current."""
    p = package_for_match(match_id)
    evs = _released(p, upto_seq)
    if kind == "match":
        return json.dumps(match_dossier(p.world, _context_at(p, None)))
    state = _replayed(match_id, upto_seq).state if upto_seq is None or upto_seq >= 0 else None
    if kind == "player":
        return json.dumps(player_dossier(p.world, evs, subject, state=state))
    if kind == "team":
        return json.dumps(team_dossier(p.world, evs, subject, state=state))
    if kind == "h2h":
        return json.dumps(h2h_dossier(p.world, evs, state=state))
    mi = _replayed(match_id, upto_seq) if upto_seq is None or upto_seq >= 0 else None
    return json.dumps(talking_points(
        p.world, evs, _context_at(p, upto_seq), state=state,
        storylines=mi.storylines.snapshot() if mi is not None else (),
        moments=[m.to_json() for m in mi.moments] if mi is not None else (), limit=TALKING_POINTS_MAX))


def _dossier(kind: str, match_id: str, upto_seq: int | None, subject: str = "") -> dict[str, Any]:
    data: dict[str, Any] = json.loads(_dossier_json(kind, match_id, upto_seq, subject))
    return data


def _warm_dossiers(match_id: str) -> None:
    p = package_for_match(match_id)
    _dossier_json("match", match_id, None)
    _dossier_json("h2h", match_id, None)
    for t in p.world.teams:
        _dossier_json("team", match_id, None, t.team_id)
        for pl in t.players:
            _dossier_json("player", match_id, None, pl.player_id)
    _dossier_json("talking_points", match_id, None)


TALKING_POINTS_MAX = 30


@app.get("/api/matches/{match_id}/dossier/players/{player_id}")
def dossier_player(match_id: str, player_id: str, upto_seq: int | None = Query(None, ge=-1)) -> dict[str, Any]:
    """Player research dossier: identity, this match so far, season, career, milestones, connections, facts."""
    p = pkg_or_404(match_id)
    if not p.world.has_player(player_id):
        raise HTTPException(404, "unknown player")
    return _dossier("player", match_id, _seq_key(p, upto_seq), player_id)


@app.get("/api/matches/{match_id}/dossier/teams/{team_id}")
def dossier_team(match_id: str, team_id: str, upto_seq: int | None = Query(None, ge=-1)) -> dict[str, Any]:
    """Club research dossier: identity, manager record, form, streaks, seasons, honours, squad, this match."""
    p = pkg_or_404(match_id)
    if team_id not in (p.world.fixture.home_team_id, p.world.fixture.away_team_id):
        raise HTTPException(404, "unknown team")
    return _dossier("team", match_id, _seq_key(p, upto_seq), team_id)


@app.get("/api/matches/{match_id}/dossier/h2h")
def dossier_h2h(match_id: str, upto_seq: int | None = Query(None, ge=-1)) -> dict[str, Any]:
    """Derby record: all-time, record window, last six meetings, leading scorers, biggest wins, current runs."""
    p = pkg_or_404(match_id)
    return _dossier("h2h", match_id, _seq_key(p, upto_seq))


@app.get("/api/matches/{match_id}/dossier/match")
def dossier_match(match_id: str) -> dict[str, Any]:
    """Fixture, venue and stadium, officials with the referee record, pre-match context facts, ruleset notes."""
    pkg_or_404(match_id)
    return _dossier("match", match_id, None)


@app.get("/api/matches/{match_id}/talking-points")
def get_talking_points(match_id: str, upto_seq: int | None = Query(None, ge=-1),
                       limit: int = Query(8, ge=1, le=TALKING_POINTS_MAX)) -> dict[str, Any]:
    """Ranked, deduplicated talking points as of `upto_seq` (deterministic; only events with seq <= upto_seq)."""
    p = pkg_or_404(match_id)
    seq = _seq_key(p, upto_seq)
    points: list[dict[str, Any]] = json.loads(_dossier_json("talking_points", match_id, seq))
    return {"match_id": match_id, "upto_seq": p.events[-1].seq if seq is None else seq,
            "talking_points": points[:limit], "fictional": True,
            "notice": "Fictional clubs, players and history; computed from synthetic data released so far."}


# ---------------------------------------------------------------- sessions + stream


class SessionCreate(BaseModel):
    speed: int = Field(12)


class Control(BaseModel):
    action: Literal["play", "pause", "seek", "speed", "reset"]
    speed: int | None = None
    elapsed_ms: int | None = Field(None, ge=0)


@app.post("/api/matches/{match_id}/sessions")
def create_session(match_id: str, body: SessionCreate, request: Request) -> dict[str, Any]:
    if body.speed not in ALLOWED_SPEEDS:
        raise HTTPException(422, f"speed must be one of {ALLOWED_SPEEDS}")
    try:
        s = rt_of(request).sessions.create(pkg_or_404(match_id), speed=body.speed, client_key=client_key(request))
    except SessionLimit as exc:
        raise HTTPException(503, str(exc), headers={"Retry-After": "30"}) from None
    return {"session_id": s.session_id, "match_id": match_id, "speed": s.speed, "duration_ms": s.duration_ms}


@app.post("/api/sessions/{sid}/control")
def control(sid: str, body: Control, request: Request) -> dict[str, Any]:
    rt = rt_of(request)
    s = session_or_404(rt, sid)
    try:
        s.control(body.action, speed=body.speed, elapsed_ms=body.elapsed_ms)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from None
    return s.heartbeat().data


def sse(msg: StreamMessage) -> bytes:
    head = f"id: {msg.id}\n" if msg.id else ""
    return f"{head}event: {msg.event}\ndata: {json.dumps(msg.data, separators=(',', ':'))}\n\n".encode()


@app.get("/api/sessions/{sid}/stream")
async def stream(sid: str, request: Request) -> StreamingResponse:
    rt = rt_of(request)
    s = session_or_404(rt, sid)
    try:
        q = s.subscribe()
    except SessionLimit as exc:
        raise HTTPException(429, str(exc)) from None
    with s.lock:
        initial = [s.state_message(), s.heartbeat(), *[s.candidate_message(c) for c in s.intelligence.candidates],
                   *[StreamMessage("decision", card.model_dump(mode="json"), id=card.decision_id)
                     for card in s.intelligence.explainer.cards],
                   *[s.storyline_message(sl) for sl in s.intelligence.storylines.storylines],
                   *[s.moment_message(m) for m in s.intelligence.moments],
                   *[s.signal_message(sig) for sig in s.intelligence.signals.signals.values()],
                   *[rt.insights.view(rec, s) for c in s.intelligence.candidates
                     if (rec := rt.insights.records.get(c.candidate_id)) is not None],
                   s.overlay_snapshot()]

    async def gen() -> AsyncIterator[bytes]:
        try:
            yield b"retry: 2000\n\n"
            for m in initial:
                yield sse(m)
            last_beat = time.monotonic()
            while True:
                if await request.is_disconnected() or s.is_overflowed(q):
                    break  # an overflowed consumer is closed so the browser reconnects and backfills
                s.touch()
                try:
                    msg = await asyncio.wait_for(q.get(), timeout=1.0)
                    yield sse(msg)
                except TimeoutError:
                    pass
                if time.monotonic() - last_beat > 1.0:
                    yield sse(s.heartbeat())
                    last_beat = time.monotonic()
        finally:
            s.unsubscribe(q)

    return StreamingResponse(gen(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@app.get("/api/sessions/{sid}/overlays")
def list_overlays(sid: str, request: Request) -> list[dict[str, Any]]:
    s = session_or_404(rt_of(request), sid)
    with s.lock:
        return s.studio.snapshot()


@app.post("/api/sessions/{sid}/overlays/{overlay_id}/{action}")
def overlay_action(sid: str, overlay_id: str, action: Literal["approve", "reject", "hide"],
                   request: Request, cue: Literal["now", "next_stoppage", "delay"] = Query("now"),
                   delay_ms: int = Query(0, ge=0, le=600_000),
                   duration_ms: int | None = Query(None, ge=5_000, le=1_800_000)) -> dict[str, Any]:
    """Demo-only producer action. Affects this sandbox session; never an external broadcast."""
    s = session_or_404(rt_of(request), sid)
    with s.lock:
        try:
            p = s.studio.act(overlay_id, action, s.playhead_ms, cue=cue, delay_ms=delay_ms, duration_ms=duration_ms)
        except KeyError:
            raise HTTPException(404, "unknown overlay") from None
        except ValueError as exc:
            raise HTTPException(409, str(exc)) from None
        s.studio.advance(s.playhead_ms)
        s.flush_studio()
        return s.studio.packets[p.id].model_dump(mode="json")


class Proposal(BaseModel):
    kind: Literal["tactical", "context", "stats"]
    ref: str | None = Field(None, max_length=120)


@app.post("/api/sessions/{sid}/overlays/propose")
def overlay_propose(sid: str, body: Proposal, request: Request) -> dict[str, Any]:
    """Demo-only: a producer asks for a graphic from the analysis desk. It still needs approval to air."""
    s = session_or_404(rt_of(request), sid)
    with s.lock:
        try:
            p, already = s.propose(body.kind, body.ref)
        except KeyError:
            raise HTTPException(404, "nothing to propose: unknown or not yet happened") from None
        except ValueError as exc:
            raise HTTPException(409, str(exc)) from None
        s.flush_studio()
        return {**p.model_dump(mode="json"), "already_queued": already}


@app.get("/api/metrics/demo")
def demo_metrics(request: Request) -> dict[str, Any]:
    """Aggregated, secret-free counts for the System / Demo lab view."""
    rt = rt_of(request)
    stages: dict[str, int] = {}
    for rec in rt.insights.records.values():
        stages[str(rec.stage)] = stages.get(str(rec.stage), 0) + 1
    report_path = REPO_ROOT / "docs" / "evaluation" / "report.json"
    evaluation = None
    if report_path.exists():
        rep = json.loads(report_path.read_text(encoding="utf-8"))
        evaluation = {"generated": rep.get("timestamp"), "detectors": rep["offline"]["detectors"],
                      "agents": {k: rep["agents"][k] for k in ("runs", "verified", "model_calls", "tokens",
                                                               "case_latency_p50_ms", "case_latency_p95_ms")}}
    return {"sessions": len(rt.sessions.sessions), "insight_stages": stages,
            "budget": rt.insights.budget.snapshot(), "cache_only": rt.settings.byline_ai_cache_only,
            "evaluation": evaluation, "synthetic": True}


SHOWCASE_LEAD_MS = 75_000
PATTERN_LABEL = {"repeated_channel_attack": "Channel pattern", "counterattack": "Fast break", "overlap": "Overlap run"}


@lru_cache(maxsize=8)
def _recorded_candidates() -> frozenset[str]:
    from byline.stories.service import RECORDED_DIR

    ids = set()
    for path in RECORDED_DIR.glob("*.json"):
        with contextlib.suppress(ValueError, KeyError, OSError):
            d = json.loads(path.read_text(encoding="utf-8"))
            if d["insight"]["status"] == "verified" and d.get("provider") == "foundry":
                ids.add(d["insight"]["candidate_id"])
    return frozenset(ids)


@app.get("/api/matches/{match_id}/showcase")
def showcase(match_id: str) -> dict[str, Any]:
    """Key-moment checkpoints for demos (blueprint: showcase checkpoints). Derived from the deterministic
    detector + decision run over the immutable log; `recorded_ai` marks stories with a recorded REAL
    verified Foundry run. Jumping only seeks the replay; nothing is precomputed for the viewer."""
    pkg_or_404(match_id)
    mi = _replayed(match_id, None)
    recorded = _recorded_candidates()
    moments: list[dict[str, Any]] = []
    for c in mi.candidates:
        moments.append({"kind": "story", "id": c.candidate_id, "label": PATTERN_LABEL.get(c.pattern_type, "Story"),
                        "team_id": c.team_id, "clock": c.display_clock, "at_ms": c.detected_at_ms,
                        "jump_to_ms": max(0, c.detected_at_ms - SHOWCASE_LEAD_MS),
                        "recorded_ai": c.candidate_id in recorded,
                        "retracted_later": c.candidate_id in mi.retractions})
    for d in mi.explainer.cards:
        if d.importance != "major":
            continue
        ev_ms = next((e.elapsed_ms for e in package_for_match(match_id).events
                      if e.event_id == d.source_event_ids[-1]), 0)
        moments.append({"kind": "decision", "id": d.decision_id, "label": d.kind.title(), "team_id": d.team_id,
                        "clock": d.clock, "at_ms": ev_ms, "jump_to_ms": max(0, ev_ms - 20_000),
                        "recorded_ai": False, "retracted_later": False})
    moments.sort(key=lambda m: m["at_ms"])
    first_ai = next((m for m in moments if m["recorded_ai"]), None)
    return {"match_id": match_id, "moments": moments, "first_verified_ai_story": first_ai,
            "note": "Jump points are computed from detector and official-decision outputs on the synthetic log."}


@app.get("/api/matches/{match_id}/recap")
def match_recap(match_id: str) -> dict[str, Any]:
    """Deterministic full-time recap of the whole match (no model call)."""
    p = pkg_or_404(match_id)
    st = _replayed(match_id, None).state
    facts = recap_facts(st, list(p.events), [])
    return deterministic_recap(st, facts).model_dump(mode="json")


@app.get("/api/sessions/{sid}/recap")
def session_recap(sid: str, request: Request) -> dict[str, Any]:
    rt = rt_of(request)
    s = session_or_404(rt, sid)
    try:
        with s.lock:
            return rt.insights.recap(s).model_dump(mode="json")
    except RecapNotReady as exc:
        raise HTTPException(409, str(exc)) from None


@app.get("/api/sessions/{sid}/state")
def session_state(sid: str, request: Request) -> dict[str, Any]:
    s = session_or_404(rt_of(request), sid)
    return {**s.state_message().data, "heartbeat": s.heartbeat().data,
            "candidates": [c.model_dump(mode="json") for c in s.intelligence.candidates],
            "storylines": s.intelligence.storylines.snapshot()}


# ---------------------------------------------------------------- insights


def _session_view(request: Request, cid: str, session_id: str | None) -> tuple[Any, str | None]:
    """Returns (session or None, retraction reason). With a session, the candidate must be reached."""
    if session_id is None:
        return None, None
    s = session_or_404(rt_of(request), session_id)
    with s.lock:
        if not any(c.candidate_id == cid for c in s.intelligence.candidates):
            raise HTTPException(404, "not reached in this session yet")
        return s, s.intelligence.retractions.get(cid)


@app.get("/api/insights/{insight_id}")
def get_insight(insight_id: str, request: Request, session_id: str | None = None) -> dict[str, Any]:
    rec = rt_of(request).insights.get(insight_id)
    if rec is None:
        raise HTTPException(404, "unknown insight")
    _, retraction = _session_view(request, rec.candidate.candidate_id, session_id)
    return rec.message(retraction).data


@lru_cache(maxsize=8)
def _all_candidates(scenario_id: str) -> dict[str, Any]:
    p = load_package(scenario_id)
    return {c.candidate_id: c for c in run_detectors(p.world, p.events, tracking=p.tracking).candidates}


@app.get("/api/insights/{insight_id}/evidence")
def get_evidence(insight_id: str, request: Request, session_id: str | None = None) -> dict[str, Any]:
    """Evidence works even when no insight record exists (AI off, degraded or budget-capped).
    Pass session_id to get the session's view (playhead-gated, retractions applied)."""
    rec = rt_of(request).insights.get(insight_id)
    cid = insight_id.removeprefix("I-")
    _, retraction = _session_view(request, cid, session_id)
    cand = rec.candidate if rec is not None else None
    if cand is None:
        for sid in available_scenarios():
            cand = _all_candidates(sid).get(cid)
            if cand is not None:
                break
    if cand is None:
        raise HTTPException(404, "unknown insight or candidate")
    p = package_for_match(cand.match_id)
    insight = rec.insight if rec is not None else None
    ids = set(cand.evidence_event_ids) | set(insight.evidence_event_ids if insight else [])
    evs = [e.to_json_dict() for e in p.events if e.event_id in ids]
    if retraction is not None:
        cand = cand.model_copy(update={"status": "retracted", "retraction_reason": retraction})
        if insight is not None:
            insight = insight.model_copy(update={"status": "retracted", "version": insight.version + 1,
                                                 "retraction_reason": retraction[:500]})
    return {"candidate": cand.model_dump(mode="json"), "events": evs,
            "insight": insight.model_dump(mode="json") if insight else None}


@app.get("/api/insights/{insight_id}/trace")
def get_trace(insight_id: str, request: Request) -> dict[str, Any]:
    rec = rt_of(request).insights.get(insight_id)
    if rec is None or rec.trace is None:
        raise HTTPException(404, "no trace")
    return rec.trace.model_dump(mode="json")  # contains no keys, tokens or endpoints


# ---------------------------------------------------------------- rules


@app.get("/api/rules")
def list_rules() -> dict[str, Any]:
    return {"ruleset_version": "IFAB-2026/27", "laws": sorted(LAWS), "var": VAR_PROTOCOL}


@app.get("/api/rules/{law_number}")
def get_rule(law_number: int) -> dict[str, Any]:
    try:
        return law_reference(law_number)
    except KeyError:
        raise HTTPException(404, "no pinned reference") from None


# ---------------------------------------------------------------- static frontend (single-container deploy)

def safe_static_file(root: Path, path: str) -> Path | None:
    """Resolve `path` under `root`; None if missing or escaping the root (path traversal)."""
    if not path:
        return None
    try:
        target = (root / path).resolve(strict=True)
    except (FileNotFoundError, RuntimeError, OSError):
        return None
    return target if target.is_relative_to(root) and target.is_file() else None


def mount_static(target: FastAPI, root: Path) -> None:
    """Serve the built web app from `root`: hashed assets, real files, and index.html for client-side routes.
    Unknown /api/ paths stay a JSON 404 rather than the app shell."""
    static_root = root.resolve()
    target.mount("/assets", StaticFiles(directory=static_root / "assets"), name="assets")

    @target.get("/{path:path}", include_in_schema=False)
    def spa(path: str) -> FileResponse:
        if path == "api" or path.startswith("api/"):
            raise HTTPException(404, "Not Found")
        return FileResponse(safe_static_file(static_root, path) or static_root / "index.html")


_static = get_settings().byline_static_dir
if _static and Path(_static).is_dir():
    mount_static(app, Path(_static))
