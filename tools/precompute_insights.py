"""Operator tool: run REAL Foundry investigations for chosen candidates and store them in the
app's insight cache (same production path, validator and hard call ledger as the server).

    apps/api/.venv/Scripts/python tools/precompute_insights.py golden_story P-D3-NBA-1638 P-D2-NBA-2005

Prints outcome, calls, tokens and latency for each case. Refuses when the ledger is too low.
"""

from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "apps" / "api"))


async def main(scenario: str, ids: list[str]) -> int:
    from byline.agents.orchestrator import investigate
    from byline.agents.provider import chat_client
    from byline.api.sessions import ReplaySession
    from byline.config import Settings
    from byline.storage.fixtures import load_package
    from byline.stories.service import InsightRecord, InsightService

    settings = Settings(byline_ai_provider="foundry")
    service = InsightService(settings, lambda: [], chat_client)
    pkg = load_package(scenario)
    session = ReplaySession("precompute", pkg, on_candidate=lambda s, c, live=True: None)
    session.seek(pkg.events[-1].elapsed_ms)
    cands = {c.candidate_id: c for c in session.intelligence.candidates}
    ledger = service.budget.ledger
    assert ledger is not None
    for cid in ids:
        c = cands.get(cid)
        if c is None:
            print(f"{cid}: not a candidate in {scenario}; available: {sorted(cands)}")
            continue
        if service._load(service.cache_key(session, c), c) is not None:
            print(f"{cid}: already cached, skipping (no calls)")
            continue
        if ledger.remaining() < 6:
            print(f"STOP: only {ledger.remaining()} real calls left under the hard cap ({ledger.cap}).")
            break
        mid = ReplaySession("precompute-mid", pkg, on_candidate=lambda s, c, live=True: None)
        mid.seek(c.detected_at_ms)
        state = mid.intelligence.state.snapshot()
        case = await investigate(c, session_id="operator-precompute", world=pkg.world, events=pkg.events,
                                 state=state, client=service.client(), budget=service.budget, provider="foundry",
                                 deployment=settings.foundry_deployment, prior_titles=[],
                                 tracking=pkg.tracking if c.pattern_type == "overlap" else None)
        t = case.trace
        print(f"{cid}: outcome={t.outcome} calls={t.total_model_calls} tokens={t.total_tokens} "
              f"latency_ms={t.total_latency_ms} ledger_used={ledger.used()}/{ledger.cap}")
        if case.insight is not None:
            print("   title:", case.insight.title)
            print("   claim:", case.insight.canonical_claim)
            if case.insight.verification.issues:
                print("   issues:", case.insight.verification.issues)
        if case.error is None and case.insight is not None:
            rec = InsightRecord(c, case.insight.status, case.insight, t, "foundry", service.cache_key(session, c))
            service._save(rec)
            out = ROOT / "docs" / "evidence" / f"precompute-{cid}.json"
            out.write_text(json.dumps({"trace": t.model_dump(mode="json"),
                                       "insight": case.insight.model_dump(mode="json")}, indent=1), encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main(sys.argv[1], sys.argv[2:])))
