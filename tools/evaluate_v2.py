"""Operator tool: the approved Option A evaluation (docs/v2-model-budget.md). REAL Foundry calls.

    apps/api/.venv/Scripts/python tools/evaluate_v2.py

Phases, in order, all through the production code paths and the persistent hard ledger:
  V3  re-run the three recorded stories with the prefetching pipeline and compare with the originals
  T1  one storyline read per golden storyline version in DEVELOPING / STRONG / CONFIRMED
  V5  first investigation of the golden stories that never had an AI run
Hard limit: 35 new calls (the ledger cap is set to used + 35 for this run only). Every request is logged
with latency, tokens, success and estimated cost to docs/evidence/v2-calls.jsonl; results go to
docs/evidence/v2-eval.json. Nothing is regenerated for demo purposes and nothing is published here.
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
import time
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "apps" / "api"))
LOG = ROOT / "docs" / "evidence" / "v2-calls.jsonl"
OUT = ROOT / "docs" / "evidence" / "v2-eval.json"
NEW_CALLS = 35
V3_IDS = ["P-D1-NBA-0760", "P-D3-NBA-1601", "P-D2-NBA-2005"]
V5_IDS = ["P-D2-RVC-0986", "P-D2-RVC-1471", "P-D2-NBA-1619"]


async def main() -> int:
    os.environ["BYLINE_CALL_LOG"] = str(LOG)
    from byline.agents.ledger import CallLedger
    from byline.agents.orchestrator import investigate, log_call
    from byline.agents.provider import chat_client
    from byline.agents.storyline_read import T1_STATES, read_storyline
    from byline.api.sessions import ReplaySession
    from byline.config import Settings
    from byline.football.intelligence import MatchIntelligence
    from byline.storage.fixtures import load_package
    from byline.stories.service import RECORDED_DIR, RECORDED_READS, InsightRecord, InsightService

    used = CallLedger(20).used()
    # 3 slots were reserved by attempts that failed authentication before reaching the model (logged);
    # they still count against the approved 35, so the cap stays at 18 + 35 = 53.
    settings = Settings(byline_ai_provider="foundry", byline_model_call_cap=18 + NEW_CALLS)
    service = InsightService(settings, lambda: [], chat_client)
    ledger = service.budget.ledger
    assert ledger is not None
    print(f"ledger {ledger.used()}/{ledger.cap}: {ledger.remaining()} new calls allowed")
    pkg = load_package("golden_story")
    session = ReplaySession("eval", pkg, on_candidate=lambda s, c, live=True: None)
    session.seek(pkg.events[-1].elapsed_ms)
    cands = {c.candidate_id: c for c in session.intelligence.candidates}
    originals = {}
    for p in RECORDED_DIR.glob("*.json"):
        d = json.loads(p.read_text(encoding="utf-8"))
        originals[d["insight"]["candidate_id"]] = d["trace"]
    report: dict[str, Any] = {"started": time.time(), "ledger_start": ledger.used(), "cap": ledger.cap,
                              "v3": [], "t1": [], "v5": []}

    async def run_case(cid: str) -> dict[str, Any]:
        c = cands[cid]
        mid = ReplaySession("eval-mid", pkg, on_candidate=lambda s, c, live=True: None)
        mid.seek(c.detected_at_ms)
        case = await investigate(c, session_id=f"eval-{cid}", world=pkg.world, events=pkg.events,
                                 state=mid.intelligence.state.snapshot(), client=service.client(),
                                 budget=service.budget, provider="foundry", deployment=settings.foundry_deployment,
                                 prior_titles=[], tracking=pkg.tracking if c.pattern_type == "overlap" else None)
        t = case.trace
        row = {"candidate_id": cid, "display_clock": c.display_clock, "outcome": t.outcome,
               "calls": t.total_model_calls, "tokens": t.total_tokens, "latency_ms": t.total_latency_ms,
               "per_step": [{"agent": s.agent, "attempt": s.attempt, "calls": s.model_calls,
                             "latency_ms": s.latency_ms, "model_tool_calls": [x.name for x in s.tool_calls
                                                                              if not x.prefetched]}
                            for s in t.steps],
               "error": case.error}
        if case.insight is not None:
            row.update(title=case.insight.title, claim=case.insight.canonical_claim,
                       issues=case.insight.verification.issues, status=case.insight.status)
        if case.error is None and case.insight is not None:
            key = service.cache_key(session, c)
            service._save(InsightRecord(c, case.insight.status, case.insight, t, "foundry", key))
            row["cache_key"] = key
        print(f"  {cid} {c.display_clock}: {row['outcome']} calls={row['calls']} tokens={row['tokens']} "
              f"{row['latency_ms'] / 1000:.1f}s ledger={ledger.used()}/{ledger.cap}")
        return row

    if "--retry" in sys.argv:
        # one case with the corrected V3 pipeline, using what is left of the approved 35
        cid = sys.argv[sys.argv.index("--retry") + 1]
        retry_out = OUT.with_name("v2-eval-retry.json")
        if ledger.remaining() < 3:
            print(f"STOP: only {ledger.remaining()} calls left")
            return 1
        row = await run_case(cid)
        o = originals.get(cid)
        if o:
            row["original"] = {"calls": o["total_model_calls"], "tokens": o["total_tokens"],
                               "latency_ms": o["total_latency_ms"], "outcome": o["outcome"]}
        retry_out.write_text(json.dumps({"ledger_end": ledger.used(), "cap": ledger.cap, "run": row}, indent=1),
                             encoding="utf-8")
        print(json.dumps(row["per_step"], indent=1))
        return 0

    print("V3: prefetching pipeline on the three recorded stories")
    for cid in V3_IDS:
        if ledger.remaining() < 8:
            print("  STOP: not enough ledger left for a full case")
            break
        row = await run_case(cid)
        o = originals.get(cid)
        if o:
            row["original"] = {"calls": o["total_model_calls"], "tokens": o["total_tokens"],
                               "latency_ms": o["total_latency_ms"], "outcome": o["outcome"]}
        report["v3"].append(row)

    print("T1: storyline reads")
    world = pkg.world
    versions: list[tuple[str, int, int]] = []
    for sl in session.intelligence.storylines.storylines:
        for v in sl.history:
            if v.state in T1_STATES:
                versions.append((sl.storyline_id, v.version, v.seq))
    for sid, version, seq in sorted(versions, key=lambda x: x[2])[:8]:  # T1 budget: 8 calls
        if ledger.remaining() < 1:
            print("  STOP: ledger exhausted")
            break
        mi = MatchIntelligence(world, tracking=pkg.tracking)
        for ev in pkg.events:
            if ev.seq > seq:
                break
            mi.ingest(ev)
        sl_at = next(x for x in mi.storylines.storylines if x.storyline_id == sid)
        assert sl_at.version == version, (sid, version, sl_at.version)
        sl_json = sl_at.to_json()
        others = [x for t in world.teams if t.team_id != sl_at.team_id for x in (t.name, t.short_name)]
        t0 = time.perf_counter()
        try:
            read, trace = await read_storyline(service.client(), sl_json, others,
                                               lambda: service.budget.charge("eval-t1", 0))
        except Exception as exc:  # noqa: BLE001
            log_call({"t": time.time(), "role": "storyline_reader", "storyline_id": sid, "ok": False,
                      "latency_ms": int((time.perf_counter() - t0) * 1000), "error": type(exc).__name__})
            print(f"  {sid} v{version}: FAILED {type(exc).__name__}")
            report["t1"].append({"storyline_id": sid, "version": version, "error": type(exc).__name__})
            continue
        log_call({"t": time.time(), "role": "storyline_reader", "storyline_id": sid, "version": version, "ok": True,
                  "latency_ms": trace.get("latency_ms"), "input_tokens": trace["input_tokens"],
                  "output_tokens": trace["output_tokens"], "response_id": trace.get("response_id")})
        key = service.read_key(session, sl_at)
        RECORDED_READS.mkdir(parents=True, exist_ok=True)
        (RECORDED_READS / f"{key}.json").write_text(json.dumps({
            "storyline_id": sid, "version": version, "state": sl_at.state, "model_deployment": "gpt-4.1-mini",
            "saved_at": time.time(), "read": read.model_dump() if read else None, "trace": trace}, indent=1),
            encoding="utf-8")
        report["t1"].append({"storyline_id": sid, "version": version, "state": sl_at.state,
                             "shipped": read is not None, "issues": trace.get("issues"),
                             "latency_ms": trace.get("latency_ms"),
                             "tokens": trace["input_tokens"] + trace["output_tokens"],
                             "line": (trace.get("output") or {}).get("line")})
        print(f"  {sid} v{version} {sl_at.state}: {'shipped' if read else 'BLOCKED'} "
              f"{trace.get('latency_ms')}ms :: {(trace.get('output') or {}).get('line')} {trace.get('issues') or ''}")

    print("V5: first AI run on golden stories without one")
    for cid in V5_IDS:
        if ledger.remaining() < 6:
            print(f"  STOP: only {ledger.remaining()} calls left")
            break
        report["v5"].append(await run_case(cid))

    report["ledger_end"] = ledger.used()
    report["finished"] = time.time()
    OUT.write_text(json.dumps(report, indent=1), encoding="utf-8")
    print(f"done: {report['ledger_end'] - report['ledger_start']} new calls; report {OUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
