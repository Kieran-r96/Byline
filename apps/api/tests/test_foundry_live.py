"""OPT-IN real Foundry test (AI-12). Never runs by default.

    .venv/Scripts/python -m pytest -m foundry_live -s

Uses the real Entra-authenticated Foundry deployment from .env, runs the full
investigator -> analyst -> verifier workflow on the golden story candidate and saves the
redacted trace under docs/evidence/ as proof of real inference.
"""

from __future__ import annotations

import json
import time

import pytest

from byline.agents.budget import BudgetGuard
from byline.agents.ledger import CallLedger
from byline.agents.orchestrator import investigate
from byline.agents.provider import chat_client
from byline.config import REPO_ROOT, Settings
from byline.football.intelligence import run_detectors
from byline.match_state.reducer import replay
from byline.storage.fixtures import MatchPackage

pytestmark = pytest.mark.foundry_live


async def test_real_foundry_workflow(golden: MatchPackage) -> None:
    settings = Settings(byline_ai_provider="foundry")
    if not settings.foundry_configured:
        pytest.skip("Foundry not configured in .env")
    cand = run_detectors(golden.world, golden.events).candidates[0]
    state = replay(golden.world, list(golden.events), upto_seq=cand.detected_at_seq).snapshot()
    ledger = CallLedger(settings.byline_model_call_cap)
    if ledger.remaining() < 8:
        pytest.skip(f"persistent model-call cap nearly used ({ledger.used()}/{ledger.cap})")
    budget = BudgetGuard(max_calls_per_session=10, max_calls_per_day=10, max_tokens_per_case=40_000, ledger=ledger)
    case = await investigate(cand, session_id="live-test", world=golden.world, events=golden.events, state=state,
                             client=chat_client(settings), budget=budget, provider="foundry",
                             deployment=settings.foundry_deployment, prior_titles=[])
    out = REPO_ROOT / "docs" / "evidence"
    out.mkdir(parents=True, exist_ok=True)
    path = out / f"foundry-run-{time.strftime('%Y%m%d-%H%M%S')}.json"
    path.write_text(json.dumps({"trace": case.trace.model_dump(mode="json"),
                                "insight": case.insight.model_dump(mode="json") if case.insight else None,
                                "error": case.error, "budget": budget.snapshot()}, indent=1), encoding="utf-8")
    print(f"\nsaved {path}\noutcome={case.trace.outcome} calls={case.trace.total_model_calls} "
          f"tokens={case.trace.total_tokens} latency_ms={case.trace.total_latency_ms}")
    assert case.error is None, case.error
    assert case.trace.total_model_calls >= 3
    assert all(s.response_ids for s in case.trace.steps if s.agent in ("investigator", "analyst", "verifier"))
    assert case.insight is not None and case.insight.status in ("verified", "tentative")
