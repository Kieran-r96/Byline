# AI provenance: what is real inference, and what is not

BYLINE never shows model-generated text that did not come from a real Microsoft Foundry call. This page lists every output that came from a model, when it was produced, and how the app labels it.

## 1. Where real inference was used

All calls went to `gpt-4.1-mini` on the existing Foundry resource, authenticated with Entra ID (Azure CLI credential). No keys were used and no extra resources were created.

| Output | Candidate / story | Recorded | Model calls | Tokens | Wall time | File |
|---|---|---|---|---|---|---|
| Verified insight | D1, Northbridge right channel, 27:13 (`P-D1-NBA-0760`) | 20 Oct 2026 21:25 | 5 | 9,944 | 17.4 s | `apps/api/recorded/insights/85f831bd….json` |
| Verified insight | D3, 55:45 (`P-D3-NBA-1601`) | 20 Oct 2026 21:53 | 5 | 7,990 | 18.5 s | `apps/api/recorded/insights/e612c36b….json` |
| Verified insight, later withdrawn by VAR at 71:53 | D2, 70:43 (`P-D2-NBA-2005`) | 20 Oct 2026 21:54 | 5 | 9,384 | 17.2 s | `apps/api/recorded/insights/a4e0f79e….json` |
| Spanish variants (one per insight) | the three insights above | 20 Oct 2026 22:19 | 3 | 2,148 | 2.5–7.2 s each | `translation_traces` inside each insight file |
| Full-time recap | BYLINE-01 | 20 Oct 2026 22:21 | 1 | 1,382 | 7.1 s | `apps/api/recorded/recaps/1cccb5f3….json` |
| Verified insight (first run on this story) | D2, Riverton counter-attack, 36' (`P-D2-RVC-0986`) | 21 Oct 2026 | 5 | 12,878 | 17.1 s | `apps/api/recorded/insights/011e9503….json` |
| Storyline reads, tier 1 (6 shipped, 2 blocked by the rule check) | golden storyline versions | 21 Oct 2026 | 8 | ~4,000 | ~1.1 s each | `apps/api/recorded/storylines/` |
| Pipeline evaluation runs (not served; audit only) | D1, D3, D2-71 re-runs | 21 Oct 2026 | 19 | ~54,000 | 16–23 s | `docs/evidence/v3-runs/`, `docs/evaluation/v2-ai-eval.md` |

Every agent step stores its Foundry response IDs (`chatcmpl-…`), tool calls with arguments, token counts and latency. The raw run records are also kept in `docs/evidence/`.

**Each insight run is a real multi-agent workflow** (Microsoft Agent Framework `WorkflowBuilder`):

1. **Investigator** (2 calls): calls the read-only tools `get_events` and `get_match_context`, writes a candidate finding and lists what it cannot establish.
2. **Analyst** (1 call): writes one canonical claim and the commentator, studio, fan-discover and fan-analyst versions from the investigator's dossier only.
3. **Verifier** (2 calls): independently re-reads the events and detector metrics with its own tools and checks each claim. In the D1 run it marked one "why it matters" sentence as unsupported and still approved the core claim. The UI shows that ✗ as-is.
4. **Rule check** (no model): deterministically recomputes every number, name and event ID in the text and blocks publication on any mismatch.

**Re-keyed after a data fix (21 Oct 2026).** The half-time and full-time whistles were stamped with the announced added time, so they appeared earlier than the last action. The fix changed the event-log checksum that recordings are keyed by. `python -m byline.tools.rekey_recordings pre-r2-redesign` proved that every input each run received was byte-identical before and after the fix: the candidate, the match state at detection, every recorded tool call replayed in full, and the validator's verdict (for the recap, the full-time fact sheet). Only then did it move each file to its new key. No output was changed or regenerated, and each file carries a `rekeyed` entry.

## 2. Full model-call accounting

| | Calls |
|---|---|
| Before the ledger existed: first direct Foundry call and live tests of the D1 workflow (including the recorded D1 run) | 13 |
| D3 insight (recorded) | 5 |
| A second D3 case stopped by the per-case token cap (a configuration error; the cap was raised to 14k). No output was kept or shown. | 4 |
| D2 insight (recorded) | 5 |
| Spanish translations | 3 |
| Full-time recap (live server background path, then recorded) | 1 |
| V2 evaluation on 21 Oct (approved Option A): 32 requests, US$0.036 at list price (`docs/evaluation/v2-ai-eval.md`) | 32 |
| V4 tactical read of the 7' moment on 22 Oct (approved: at most 8 calls, US$1): investigator, analyst, verifier, one analyst + verifier revision, Spanish. 17,312 in / 2,730 out tokens, about US$0.0113 (`docs/evidence/v4-tactical-calls.jsonl`) | 6 |
| **Total** | **69** (ledger 59; 3 ledger slots went to authentication failures that never reached the model) |

The ledger (`apps/api/.cache/model_call_ledger.json`) reads 59. The cap was raised to 61 only for the approved V4 run; 2 approved calls were left unused. No further calls without the owner's approval.

## 3. What is deterministic (not AI)

Everything else is produced by code and labelled as such:

- detection of pattern candidates, the referee decision explanations, match state and score, facts and history (fictional, seeded), movement and tracking
- the "Detector summary" text on the five stories that never had a real investigation (D2 50:46, D2 56:20, BYLINE-02 39:46 and 45:54, ordinary 36:59). These show the stage pill **Detector summary · not AI-reviewed** and "No AI run" in the evidence, never "Verified".
- the deterministic full-time recap, used when no recorded model recap exists

## 4. How the app labels it

| Mode | What is shown | Label in the evidence workspace |
|---|---|---|
| Cache-only (`BYLINE_AI_CACHE_ONLY=true`, the public demo mode) | the recorded real outputs above, byte for byte | **Real Foundry run** · "Recorded 20 Oct, 21:25 · gpt-4.1-mini · 5 model calls · 9,944 tokens · 17.4 s · **served from cache, no new model call**" |
| Live (`BYLINE_AI_PROVIDER=foundry`, ledger has room) | a fresh run; a case already recorded is still served from the recording first | **Real Foundry run** · "Ran <time> …" with no cache notice |
| No AI run for this story | the detector summary | "No AI run: detector summary." |
| Tests only (`BYLINE_AI_PROVIDER=mock_for_tests`) | canned mock output; never used in the demo or deployment configuration | provider status "Test mock: not real model output" and a **Test mock** badge |

Cache-only mode does not pretend to be live. The stamp says "Recorded" with the original run time, and every cached response carries `cache_hit: true` from the API (`/api/insights/{id}/trace`). The E2E test `demo path` in `apps/web/e2e/stories.spec.ts` asserts the "served from cache, no new model call" label on the real verified story.

To see it: start the demo, choose **Commentator**, press **Jump to the first AI-verified story**, open **Show evidence**, then **Show how the AI reached this**. Screenshot: `docs/screenshots/p4-agent-run.png`.

## 5. Fresh inference

None is planned without approval. The proposed budget for the Live Intelligence Engine V2 evaluation will be stated before any paid run (see `TASKS.md`).

## 6. Tactical moments (V4): one real verified run

The agent pipeline can open a case from a tactical moment instead of a detector candidate. One real run was made on 22 Oct 2026 for `T-option-NBA-0180` (7', "S. Haddad-Rhys was open as M. Lindqvist's pass was cut out"), within the owner's approval of at most 8 calls and US$1, after checking billing (Free Trial subscription, spending limit on).

| | |
|---|---|
| Result | **Verified**: the verifier approved every claim and the rule check passed |
| Calls | 6: investigator 8.8 s, analyst 3.7 s, verifier 5.5 s, analyst revision 4.1 s, verifier 5.0 s, Spanish 2.6 s |
| Tokens and cost | 17,312 in / 2,730 out, about US$0.0113 at list price; 29.2 s in total |
| Why a revision | The first draft was rejected by our own rule check for naming "M. Lindqvist's", a false positive (the possessive did not match the surname). The validator was fixed narrowly afterwards (a trailing possessive is stripped; invented names are still rejected) with a regression test. The verified text was produced before the fix and passed the original, stricter rules. |
| Served | From `apps/api/recorded/tactics/00cf4191cdb7dd4c6910563c.json` in cache-only mode, labelled "Deep analysis · verified by Foundry agents" with the calls, tokens, latency and cost one click away |

- **Inputs.** The case brief and the authoritative metrics come only from the moment's measurements: the observed list, the What If? payload (what happened, the measured alternatives, the defending lines) and its unknowns (`apps/api/byline/agents/subject.py`). The evidence ids are the moment's (`E0180`, `E0181`). The investigator's prefetch is `get_moment_facts` + `get_events` + `get_match_context`.
- **Rule check.** It applies every detector rule plus tactical rules (`validate_tactical_draft`). The only numbers allowed are the moment's measurements, their rounding and the minute. The only names allowed are players in the moment. Outcome and probability claims are blocked ("would have", "certain goal", "chance of", percentages, xG, "should"), as are intent and instruction claims ("wanted to", "tried to", "decided to", "instructed") and judgements of the player. Every hypothetical sentence must be framed as an option or alternative.
- **Recording.** A run is recorded only by the operator CLI with `--confirm`, as `recorded/tactics/<key>.json`. The key covers the moment id, an input hash and the tactical prompt version. The input hash covers everything the agents can receive: the moment facts, every event up to the snapshot, the match state and the tracking frames up to the snapshot. If any of these change, the recording is no longer served and nothing is regenerated. A data fix that leaves them untouched keeps the key, so no re-key is needed. Mock runs are refused from that folder.
- **Provenance.** Each record stores the deployment, prompt version, input hash, and per call: role, latency, input and output tokens, response id and ledger slot. It also stores the start and finish timestamps, the verifier's checks and the validator's result for each attempt.
- **Plan first.** `tools/run_tactical_case.py --match BYLINE-01 --moment T-option-NBA-0180` prints the plan, sizes and maximum cost and makes no call. `--confirm` runs once, with a hard stop at `--max-calls` (at most 8, revision and Spanish included).
