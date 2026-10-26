# Cost guardrails (£0 out-of-pocket)

Application-level limits are the real protection. Azure budget alerts are notifications, not hard limits.

| Guard | Where | Default |
|---|---|---|
| Hard, persistent cap on real model calls (all agents, translator, recap, probes) | `agents/ledger.py`, file `apps/api/.cache/model_call_ledger.json` | `BYLINE_MODEL_CALL_CAP=20` |
| Cache-only mode: recorded real results served; no client is even created | `BYLINE_AI_CACHE_ONLY` | `true` locally and in the Dockerfile |
| Per-session calls / per-day calls / per-case tokens | `agents/budget.py` | 30 / 400 / 14,000 |
| Concurrency, then circuit breaker after 3 consecutive failures (120 s) | `agents/budget.py` | 2 |
| Identical candidates never re-investigated (disk cache keyed by log checksum, candidate, evidence, deployment, prompt version) | `stories/service.py` | always on |
| One revision round and one JSON-repair retry per agent; no blind retry loops | `agents/orchestrator.py` | always on |
| Status endpoint never calls the model | `api/app.py` | always on |
| Sessions capped and idle sessions evicted | `api/sessions.py` | 200 sessions / 30 min idle |
| CI never calls a model (`BYLINE_AI_PROVIDER=off`); the live test is opt-in only | `.github/workflows/ci.yml`, `pytest -m foundry_live` | |

Usage so far (2026-10-20): 31 real model calls in total. 13 were made before the ledger existed; 18 of the overnight cap of 20 have been used. Around 60k tokens on gpt-4.1-mini. Per-run details are in `docs/evidence/` and `docs/evaluation/report.md`.

Deployment cost notes are in `docs/deployment-plan.md`. No Azure resources have been created by Claude.
