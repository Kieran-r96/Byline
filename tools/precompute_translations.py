"""Operator tool: add a validated Spanish variant to each RECORDED verified insight (1 real call each).

    apps/api/.venv/Scripts/python tools/precompute_translations.py

Charges the persistent hard ledger; skips insights that already have Spanish; refuses when low.
"""

from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "apps" / "api"))


async def main() -> int:
    from byline.agents.budget import BudgetGuard
    from byline.agents.ledger import CallLedger
    from byline.agents.provider import chat_client
    from byline.agents.translate import translate_es
    from byline.config import Settings
    from byline.storage.fixtures import load_package
    from byline.stories.models import Insight
    from byline.stories.service import RECORDED_DIR

    settings = Settings(byline_ai_provider="foundry")
    ledger = CallLedger(settings.byline_model_call_cap)
    budget = BudgetGuard(max_calls_per_session=10, max_calls_per_day=10, max_tokens_per_case=20_000, ledger=ledger)
    client = chat_client(settings)
    world = load_package("golden_story").world
    for path in sorted(RECORDED_DIR.glob("*.json")):
        data = json.loads(path.read_text(encoding="utf-8"))
        ins = Insight.model_validate(data["insight"])
        if any(k.startswith("es.") for k in ins.audience_variants.translations):
            print(f"{ins.insight_id}: already has Spanish")
            continue
        if ledger.remaining() < 2:
            print(f"STOP: only {ledger.remaining()} calls left under the cap")
            break
        shipped, trace = await translate_es(client, ins, world, lambda: budget.charge("translate", 0))
        print(f"{ins.insight_id}: shipped {len([k for k in shipped if not k.endswith('_note')])}/7 fields "
              f"calls={trace['model_calls']} tokens={trace['tokens']} latency_ms={trace.get('latency_ms')} "
              f"issues={trace.get('issues')} ledger={ledger.used()}/{ledger.cap}")
        if shipped:
            print("   ES:", shipped.get("es.canonical_claim"))
            data["insight"]["audience_variants"]["translations"].update(shipped)
            data.setdefault("translation_traces", []).append(trace)
            path.write_text(json.dumps(data, indent=1, ensure_ascii=False), encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
