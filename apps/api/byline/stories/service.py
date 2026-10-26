"""Insight service: candidate -> (cache | agent investigation | deterministic fallback) -> sessions.

* Identical candidates (same match log checksum, candidate id, evidence, deployment and prompt
  version) never trigger a second model run; results persist on disk across restarts.
* A session only receives insights for candidates it has itself reached, so nobody sees the
  future after a seek.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import os
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from byline.agents.budget import BudgetGuard
from byline.agents.ledger import CallLedger
from byline.agents.orchestrator import Stage, deterministic_insight, investigate
from byline.agents.prompts import COMPATIBLE_PROMPT_VERSIONS, PROMPT_VERSION
from byline.agents.storyline_read import T1_STATES, T1_VERSION, read_storyline
from byline.api.sessions import ReplaySession, StreamMessage
from byline.config import API_ROOT, Settings
from byline.football.detectors.base import PatternCandidate
from byline.football.storylines import Storyline
from byline.stories.models import AgentTrace, Insight
from byline.stories.recap import Recap, deterministic_recap, model_recap, recap_facts

log = logging.getLogger("byline.insights")
CACHE_DIR = API_ROOT / ".cache" / "insights"
# Committed, read-only recordings of REAL Foundry runs (with traces), so a fresh clone/deploy can show
# genuine verified insights without spending again. Served as cache hits, never as new inference.
RECORDED_DIR = API_ROOT / "recorded" / "insights"
RECORDED_READS = API_ROOT / "recorded" / "storylines"
T1_MAX_PER_MATCH = 8  # tier-1 reads per match and server process (the hard ledger still applies)


@dataclass
class InsightRecord:
    candidate: PatternCandidate
    stage: Stage | str
    insight: Insight | None = None
    trace: AgentTrace | None = None
    provider: str = "off"
    cache_key: str = ""
    updated_at: float = field(default_factory=time.time)
    from_cache: bool = False
    # a detector-only fallback that a later live viewer may upgrade with a real investigation
    upgradable: bool = False

    def message(self, retraction: str | None = None) -> StreamMessage:
        insight, stage = self.insight, self.stage
        if retraction is not None and insight is not None:
            # append-only correction: same insight, new version, retracted with the official reason
            insight = insight.model_copy(update={"status": "retracted", "version": insight.version + 1,
                                                 "retraction_reason": retraction[:500]})
            stage = "retracted"
        return StreamMessage("insight_update", {
            "candidate_id": self.candidate.candidate_id,
            "pattern_type": self.candidate.pattern_type,
            "team_id": self.candidate.team_id,
            "detected_at_ms": self.candidate.detected_at_ms,
            "display_clock": self.candidate.display_clock,
            "stage": stage,
            "provider": self.provider,
            "from_cache": self.from_cache,
            "insight": insight.model_dump(mode="json") if insight else None,
            "trace_summary": trace_summary(self.trace),
        }, id=f"insight-{self.candidate.candidate_id}-{stage}")


def atomic_write(path: Path, text: str) -> None:
    tmp = path.with_suffix(f".{os.getpid()}.tmp")
    tmp.write_text(text, encoding="utf-8")
    os.replace(tmp, path)


def trace_summary(trace: AgentTrace | None) -> dict[str, Any] | None:
    if trace is None:
        return None
    return {
        "case_id": trace.case_id, "provider": trace.provider, "model_deployment": trace.model_deployment,
        "agents": [s.agent for s in trace.steps], "model_calls": trace.total_model_calls,
        "tokens": trace.total_tokens, "latency_ms": trace.total_latency_ms, "outcome": trace.outcome,
        "cache_hit": trace.cache_hit,
    }


class InsightService:
    def __init__(self, settings: Settings, sessions: Callable[[], list[ReplaySession]],
                 client_factory: Callable[[], Any] | None = None, cache_dir: Path | None = CACHE_DIR) -> None:
        self.settings = settings
        self.sessions = sessions
        self.client_factory = client_factory
        self._client: Any = None
        self.cache_dir = cache_dir
        self.records: dict[str, InsightRecord] = {}
        self.tasks: dict[str, Any] = {}
        self.recap_tasks: dict[str, Any] = {}
        self.read_tasks: dict[str, Any] = {}
        self.read_counts: dict[str, int] = {}
        # The server's event loop. Sync routes run in FastAPI's threadpool (no loop there), so background
        # agent work is always scheduled thread-safely onto this loop.
        self.loop: asyncio.AbstractEventLoop | None = None
        self.budget = BudgetGuard(
            max_calls_per_session=settings.byline_max_model_calls_per_session,
            max_calls_per_day=settings.byline_max_model_calls_global_per_day,
            max_tokens_per_case=settings.byline_max_tokens_per_case,
            concurrency=settings.byline_model_concurrency,
            ledger=CallLedger(settings.byline_model_call_cap) if settings.byline_ai_provider == "foundry" else None,
        )

    @property
    def provider(self) -> str:
        return self.settings.byline_ai_provider

    def client(self) -> Any:
        if self._client is None and self.client_factory is not None:
            self._client = self.client_factory()
        return self._client

    # ------------------------------------------------------------ keys and cache

    def cache_key(self, session: ReplaySession, c: PatternCandidate, version: str = PROMPT_VERSION) -> str:
        raw = json.dumps([session.package.events_sha256, c.candidate_id, list(c.evidence_event_ids), "en",
                          self.settings.foundry_deployment, version, self.provider])
        return hashlib.sha256(raw.encode()).hexdigest()[:24]

    def _load(self, key: str, c: PatternCandidate) -> InsightRecord | None:
        if self.cache_dir is None:
            return None
        # committed recordings are curated (e.g. later enriched with validated translations) and win over the
        # runtime cache, which may hold an older copy of the same real run
        path = RECORDED_DIR / f"{key}.json"
        if not path.exists():
            path = self.cache_dir / f"{key}.json"
        if not path.exists():
            return None
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            trace = AgentTrace.model_validate(data["trace"]) if data.get("trace") else None
            insight = Insight.model_validate(data["insight"])
        except (OSError, ValueError, KeyError):  # corrupt/truncated cache entry = cache miss, never a crash
            log.warning("ignoring unreadable cache entry %s", path.name)
            return None
        if trace is not None:
            trace.cache_hit = True
        return InsightRecord(candidate=c, stage=data["stage"], insight=insight, trace=trace,
                             provider=data["provider"], cache_key=key, from_cache=True)

    def _save(self, rec: InsightRecord) -> None:
        if self.cache_dir is None or rec.insight is None or rec.provider == "mock_for_tests":
            return
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        atomic_write(self.cache_dir / f"{rec.cache_key}.json", json.dumps({
            "stage": rec.stage, "provider": rec.provider, "saved_at": time.time(),
            "insight": rec.insight.model_dump(mode="json"),
            "trace": rec.trace.model_dump(mode="json") if rec.trace else None,
        }, indent=1))

    # ------------------------------------------------------------ fan-out

    def _publish(self, rec: InsightRecord, match_id: str) -> None:
        for s in self.sessions():
            if s.package.match_id != match_id:
                continue
            if any(c.candidate_id == rec.candidate.candidate_id for c in s.intelligence.candidates):
                s.publish(self.view(rec, s))

    @staticmethod
    def view(rec: InsightRecord, session: ReplaySession) -> StreamMessage:
        retraction = session.intelligence.retractions.get(rec.candidate.candidate_id)
        if retraction is None and rec.insight is not None and rec.insight.status == "verified":
            # offer verified, still-standing stories to this session's studio desk (approval required)
            session.studio.offer_insight(rec.insight, session.playhead_ms)  # anchored to detection time
            session.flush_studio()
        return rec.message(retraction)

    # ------------------------------------------------------------ tier 1: storyline reads (V2)

    def read_key(self, session: ReplaySession, sl: Storyline) -> str:
        raw = json.dumps([session.package.events_sha256, sl.storyline_id, sl.version, T1_VERSION,
                          self.settings.foundry_deployment])
        return hashlib.sha256(raw.encode()).hexdigest()[:24]

    def _load_read(self, key: str) -> dict[str, Any] | None:
        folders = [RECORDED_READS] + ([self.cache_dir.parent / "storylines"] if self.cache_dir is not None else [])
        for folder in folders:
            path = folder / f"{key}.json"
            if path.exists():
                try:
                    data: dict[str, Any] = json.loads(path.read_text(encoding="utf-8"))
                    return data
                except (OSError, ValueError):
                    return None
        return None

    def storyline_view(self, session: ReplaySession, sl: Storyline, live: bool = False) -> dict[str, Any]:
        """T0 storyline JSON plus a recorded/cached T1 read when one exists; live updates may start one."""
        data = sl.to_json()
        if sl.state not in T1_STATES:
            return data
        key = self.read_key(session, sl)
        rec = self._load_read(key)
        if rec is not None and rec.get("read"):
            t = rec.get("trace", {})
            data["ai_read"] = {**rec["read"], "tier": "T1", "provider": "foundry",
                               "model_deployment": rec.get("model_deployment"), "response_id": t.get("response_id"),
                               "latency_ms": t.get("latency_ms"), "recorded_at": rec.get("saved_at"),
                               "from_cache": True}
            return data
        match_id = session.package.match_id
        can_call = (live and self.provider == "foundry" and not self.settings.byline_ai_cache_only
                    and self.client_factory is not None and rec is None and key not in self.read_tasks
                    and self.read_counts.get(match_id, 0) < T1_MAX_PER_MATCH
                    and self.budget.ledger is not None and self.budget.ledger.remaining() >= 1)
        if can_call:
            self.read_counts[match_id] = self.read_counts.get(match_id, 0) + 1
            self.read_tasks[key] = self._spawn(self._run_read(session, sl.to_json(), key))
        return data

    async def _run_read(self, session: ReplaySession, sl_json: dict[str, Any], key: str) -> None:
        world = session.package.world
        others = [t.name for t in world.teams if t.team_id != sl_json["team_id"]]
        others += [t.short_name for t in world.teams if t.team_id != sl_json["team_id"]]
        try:
            read, trace = await read_storyline(self.client(), sl_json, others,
                                               lambda: self.budget.charge(session.session_id, 0))
        except Exception as exc:  # noqa: BLE001 - a failed read leaves the deterministic storyline untouched
            log.warning("storyline read %s failed: %s", sl_json["storyline_id"], type(exc).__name__)
            return
        record = {"storyline_id": sl_json["storyline_id"], "version": sl_json["version"], "state": sl_json["state"],
                  "model_deployment": self.settings.foundry_deployment, "saved_at": time.time(),
                  "read": read.model_dump() if read else None, "trace": trace}
        if self.cache_dir is not None:
            folder = self.cache_dir.parent / "storylines"
            folder.mkdir(parents=True, exist_ok=True)
            atomic_write(folder / f"{key}.json", json.dumps(record, indent=1))
        if read is None:
            return
        for s in self.sessions():
            if s.package.match_id != session.package.match_id:
                continue
            sl = next((x for x in s.intelligence.storylines.storylines if x.storyline_id == sl_json["storyline_id"]
                       and x.version == sl_json["version"]), None)
            if sl is not None:
                s.publish(StreamMessage("storyline_update", self.storyline_view(s, sl),
                                        id=f"{sl.storyline_id}-v{sl.version}-read"))

    def retract(self, session: ReplaySession, c: PatternCandidate) -> None:
        """Called when this session's own playhead reaches the correcting official event."""
        rec = self.records.get(c.candidate_id)
        if rec is not None:
            session.publish(self.view(rec, session))

    def replay_to(self, session: ReplaySession) -> None:
        """Re-send what this session is entitled to see (holds the session lock: touches its studio)."""
        with session.lock:
            for c in session.intelligence.candidates:
                rec = self.records.get(c.candidate_id)
                if rec is not None:
                    session.publish(self.view(rec, session))

    def _fallback(self, c: PatternCandidate, reason: Any, issue: str, key: str, upgradable: bool) -> InsightRecord:
        return InsightRecord(c, "tentative", deterministic_insight(c, reason=reason, issues=[issue]),
                             provider=self.provider, cache_key=key, upgradable=upgradable)

    # ------------------------------------------------------------ main entry

    def submit(self, session: ReplaySession, c: PatternCandidate, live: bool = True) -> None:
        """live=False when a seek/rebuild re-derived the candidate: serve what exists, never start spend."""
        cid = c.candidate_id
        existing = self.records.get(cid)
        can_investigate = (live and self.provider == "foundry" and not self.settings.byline_ai_cache_only
                           and self.client_factory is not None)
        if existing is not None and not (existing.upgradable and can_investigate):
            session.publish(self.view(existing, session))
            return
        key = self.cache_key(session, c)
        cached = self._load(key, c)
        for older in COMPATIBLE_PROMPT_VERSIONS:
            if cached is None:
                cached = self._load(self.cache_key(session, c, older), c)
        if cached is not None:
            self.records[cid] = cached
            session.publish(self.view(cached, session))
            return
        if self.provider == "foundry" and self.settings.byline_ai_cache_only:
            rec = self._fallback(c, "ai_cache_only", "cache-only demo mode", key, upgradable=False)
            self.records[cid] = rec
            session.publish(self.view(rec, session))
            return
        if self.provider == "off" or self.client_factory is None:
            rec = InsightRecord(c, "tentative", deterministic_insight(c, reason="ai_off", issues=["AI disabled"]),
                                provider="off", cache_key=key)
            self.records[cid] = rec
            session.publish(self.view(rec, session))
            return
        if not live:
            if existing is None:
                rec = self._fallback(c, "ai_skipped", "reached by seeking; not investigated live", key, True)
                self.records[cid] = rec
                session.publish(self.view(rec, session))
            else:
                session.publish(self.view(existing, session))
            return
        ok, why = self.budget.can_start(session.session_id)
        if not ok:
            rec = self._fallback(c, "ai_unavailable", f"budget: {why}", key, upgradable=True)
            self.records[cid] = rec
            session.publish(self.view(rec, session))
            return
        rec = InsightRecord(c, "queued", provider=self.provider, cache_key=key)
        self.records[cid] = rec
        session.publish(self.view(rec, session))
        snapshot = session.intelligence.state.snapshot()
        prior = [r.insight.title for r in self.records.values()
                 if r.insight is not None and r.insight.match_id == c.match_id and r.insight.status == "verified"]
        self.tasks[cid] = self._spawn(self._run(session, c, rec, snapshot, prior))

    async def _run(self, session: ReplaySession, c: PatternCandidate, rec: InsightRecord, state: dict[str, Any],
                   prior: list[str]) -> None:
        match_id = c.match_id

        async def on_stage(_cid: str, stage: Stage) -> None:
            rec.stage = stage
            rec.updated_at = time.time()
            self._publish(rec, match_id)

        try:
            case = await investigate(
                c, session_id=session.session_id, world=session.package.world, events=session.package.events,
                state=state, client=self.client(), budget=self.budget, provider=self.provider,
                deployment=self.settings.foundry_deployment, prior_titles=prior,
                tracking=session.package.tracking if c.pattern_type == "overlap" else None, on_stage=on_stage,
            )
            rec.insight, rec.trace = case.insight, case.trace
            rec.stage = case.insight.status if case.insight else "failed"
            if case.error is None:
                self._save(rec)
            log.info("case %s -> %s (%s calls, %s ms)", case.case_id, rec.stage, case.trace.total_model_calls,
                     case.trace.total_latency_ms)
        except Exception as exc:  # noqa: BLE001
            log.exception("investigation crashed")
            rec.insight = deterministic_insight(c, reason="ai_unavailable", issues=[type(exc).__name__])
            rec.stage = "tentative"
        finally:
            self.tasks.pop(c.candidate_id, None)
        if rec.trace is not None and (rec.trace.outcome or "").startswith("degraded"):
            rec.upgradable = True  # transient failure: keep showing the fallback; a later live viewer may retry
        self._publish(rec, match_id)

    # ------------------------------------------------------------ full-time recap (T019)

    def session_insights(self, session: ReplaySession) -> list[Insight]:
        out = []
        for c in session.intelligence.candidates:
            rec = self.records.get(c.candidate_id)
            if rec is not None and rec.insight is not None and c.candidate_id not in session.intelligence.retractions:
                out.append(rec.insight)
        return out

    def recap(self, session: ReplaySession) -> Recap:
        """Raises RecapNotReady before full time. Starts (once) a validated model recap in the background."""
        state = session.intelligence.state
        events = list(session.package.events[: session.cursor])
        facts = recap_facts(state, events, self.session_insights(session))
        key = hashlib.sha256(json.dumps([session.package.events_sha256, PROMPT_VERSION, facts["verified_stories"],
                                         self.settings.foundry_deployment]).encode()).hexdigest()[:24]
        cached = self._load_recap(key)
        if cached is not None:
            return cached
        base = deterministic_recap(state, facts)
        may_call_model = (self.provider == "foundry" and not self.settings.byline_ai_cache_only
                          and self.client_factory is not None and key not in self.recap_tasks
                          and self.budget.ledger is not None and self.budget.ledger.remaining() >= 1)
        if may_call_model:
            known = {e.event_id for e in events}
            self.recap_tasks[key] = self._spawn(self._run_recap(key, base, facts, known, session))
        return base

    async def _run_recap(self, key: str, base: Recap, facts: dict[str, Any], known: set[str],
                         session: ReplaySession) -> None:
        try:
            draft, issues, trace = await model_recap(self.client(), facts, known, session.package.world,
                                                     lambda: self.budget.charge("recap", 0))
        except Exception as exc:  # noqa: BLE001 - deterministic recap remains
            log.warning("model recap failed: %s", type(exc).__name__)
            return
        self.budget.record(True, trace.get("latency_ms"), int(trace.get("tokens") or 0))
        if draft is None or issues:
            rec = base.model_copy(update={"validation_issues": issues, "model_trace": trace})
        else:
            rec = base.model_copy(update={"headline": draft.headline, "summary": draft.summary,
                                          "turning_points": draft.turning_points,
                                          "generated_by": "foundry_recap_writer", "model_trace": trace,
                                          "source_event_ids": sorted({i for p in draft.turning_points
                                                                      for i in p.event_ids})})
        self._save_recap(key, rec)
        for s in self.sessions():
            if s.package.match_id == base.match_id and s.intelligence.state.finished:
                s.publish(StreamMessage("recap", rec.model_dump(mode="json"), id=f"recap-{key}"))

    def _load_recap(self, key: str) -> Recap | None:
        if self.cache_dir is None:
            return None
        path = self.cache_dir.parent / "recaps" / f"{key}.json"
        if not path.exists():
            path = RECORDED_DIR.parent / "recaps" / f"{key}.json"
        if not path.exists():
            return None
        try:
            return Recap.model_validate_json(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return None

    def _save_recap(self, key: str, rec: Recap) -> None:
        if self.cache_dir is None:
            return
        path = self.cache_dir.parent / "recaps"
        path.mkdir(parents=True, exist_ok=True)
        atomic_write(path / f"{key}.json", rec.model_dump_json(indent=1))

    def _spawn(self, coro: Any) -> Any:
        try:
            return asyncio.get_running_loop().create_task(coro)
        except RuntimeError:
            if self.loop is None:
                coro.close()
                raise RuntimeError("InsightService.loop not set; cannot schedule background work") from None
            return asyncio.run_coroutine_threadsafe(coro, self.loop)

    def get(self, insight_or_candidate_id: str) -> InsightRecord | None:
        cid = insight_or_candidate_id.removeprefix("I-")
        return self.records.get(cid)
