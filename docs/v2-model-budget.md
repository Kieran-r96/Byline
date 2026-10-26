# Live Intelligence Engine V2: proposed model-call budget (needs owner approval)

No calls have been made for V2. The ledger is at 18/20. Everything below needs approval, and the hard cap (`BYLINE_MODEL_CALL_CAP`) would have to be raised to allow it. All figures are for `gpt-4.1-mini` on the existing Foundry resource; no new resources are needed.

Baseline from the recorded runs (`docs/engine-audit.md`): a full investigation takes 5 calls, about 9,100 tokens and 17.7 s. The investigator accounts for 54% of that time.

| Work | What it proves | Calls | Tokens (est.) |
|---|---|---|---|
| **V3 orchestration**: give the investigator and verifier their tool data up front (deterministic pre-fetch, the same bounded data), which removes one tool round-trip each. Analyst, verifier and rule check are unchanged. Re-run on the 3 recorded stories (D1, D3, D2-71) and compare verdicts, numbers and wording. | Target: under 10 s per full investigation with the same checks | 9 (3 runs × 3 calls) | ~21,000 |
| **V2 tier T1**: one cheap call writing a one-line measured summary for a storyline version (DEVELOPING / STRONG), checked by the deterministic rule check. Golden match only, capped. | T1 latency under 5 s; rule-check pass rate | 8 | ~8,000 |
| **V5 evaluation**: full T2 investigation of the 3 golden stories that have never had an AI run (35:40, 50:46, 56:20) | Verification rate on unseen candidates; what the verifier rejects | up to 15 | ~30,000 |
| Reserve for one retry on a failed run | | 3 | ~6,000 |
| **Total** | | **35 maximum** | **~65,000** |

The rough cost at gpt-4.1-mini list prices is well under US$1; please confirm against your own Azure pricing. Every result would be recorded and committed, then served in cache-only mode. The public demo stays at zero cost.

## Options

- **A. Full (35 calls):** V3, T1 and V5 as above. The cap would be raised to 55.
- **B. Speed only (9 calls):** V3 only, which proves the 10-second target. The cap would be raised to 30.
- **C. None:** keep V2 deterministic. Tier T0 (storylines plus detector summaries) already ships. V3 and V5 would be documented as designed but not measured.

What ships without any spend: storylines (V1), the storyline UI (V4), the engine audit (V0), and the deterministic V5 metrics (time to first signal, update frequency, watch-only noise, determinism, VAR correctness), which are already in `docs/engine-audit.md`.
