# V2 AI evaluation (approved Option A, 21 Oct 2026)

All real `gpt-4.1-mini` calls ran on the existing Foundry resource under the persistent hard ledger, with the cap set to 18 + 35 = 53.

- **Raw data:** every request is in `docs/evidence/v2-calls.jsonl`. The run reports are `docs/evidence/v2-eval.json` and `v2-eval-retry.json`. The superseded V3 traces are in `docs/evidence/v3-runs/`.
- **Billing checked first:** the subscription is a Free Trial with the spending limit on. £0.019 had been consumed before this run. List price is US$0.40 per million input tokens and US$1.60 per million output (Azure retail prices API).

## Spend

| | |
|---|---|
| Real model requests | **32**, all successful |
| Tokens | 64,418 input, 6,570 output |
| Estimated cost at list price | **US$0.036** |
| Ledger slots used | 35 of 35 (32 requests plus 3 attempts that failed Entra authentication before reaching the model) |
| Logged attempts that never reached the model | 11: the 3 authentication failures, then 8 blocked by the open circuit breaker |

## V3: faster orchestration

| Run | Calls | Tokens | Wall time | Outcome |
|---|---|---|---|---|
| Original recordings (mean of 3) | 5 | 9,106 | 17.7 s | 3 verified |
| Prefetch v1, duplicate tools still offered (3 runs) | 5 each | 11,671–17,423 | 16.1–23.0 s | 2 verified; D1 stopped by the 14k per-case token cap during its revision (nothing shipped) |
| Prefetch v2, duplicate tools removed (D1) | **4** | 11,708 | 20.5 s | verified |

- **Finding:** with the evidence attached, gpt-4.1-mini still re-requested the same tools when they were offered. That cost a round trip and about 40% more tokens. Removing the duplicates made the verifier a single call (5.4 s). The investigator still chose a round trip for new context (`get_recent_events`, `get_player`), which took 10.9 s.
- **Target not met:** the run took 20.5 s against a target of under 10 s. Further latency work would have to be on the investigator. Options are a smaller output schema, streaming, or running the investigator in parallel with deterministic drafting. None was tested, because the budget was used up.
- **Checks kept:** independent verifier, deterministic validator and one revision loop. In v2 the verifier judges an independent fetch of the draft's own cited events, and any unknown ID is still caught by the validator.

## V2 tier 1: storyline reads

- 8 reads, one per golden storyline version in DEVELOPING, STRONG or CONFIRMED. Mean latency 1.06 s (0.84–1.36 s).
- **6 shipped, 2 blocked** by the deterministic check:
  - the model rounded 46.7 m to "47 metres";
  - it cited the 71st minute, which is not in that version's measurements.
- Example DEVELOPING read at 25': *"Northbridge Athletic is building pressure with 7 of 8 entries down the right, but no dangerous entries yet."*

## V5: first AI run on unseen golden stories

- **P-D2-RVC-0986 (36'):** verified in 5 calls, 17.1 s. Claim: *"Riverton City regained possession via interception in the middle third and advanced 46.7 metres through 3 passes or carries before a shot was saved 9.4 seconds later."* It is now recorded and served as a real verified story.
- **P-D2-RVC-1471 and P-D2-NBA-1619:** not run, because the approved budget was used up. They remain labelled detector summaries.

## Editorial quality (honest read)

- **Accurate:** numbers and names are exact, and nothing forbidden appears in the verified runs.
- **Bland:** the "why it matters" lines are generic, for example "highlights the ability to quickly transition from defence to attack". The rules forbid claims about intent and tactics. Without richer, allowed context (game state, sequence history, the opponent's last defensive action), the model falls back to generic phrasing. This is a prompt and context problem, not a safety one.
