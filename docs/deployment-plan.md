# T024 deployment plan — REQUIRES OWNER APPROVAL BEFORE ANY STEP THAT CREATES RESOURCES

Status: prepared only. No Azure resource has been created by Claude.

## Proposed shape (cheapest credible)

- **One Azure Container Apps app** on the Consumption plan: 0.5 vCPU / 1 GiB, `minReplicas=0`, `maxReplicas=1`. It serves the API and the built web app from the repo `Dockerfile`.
- **Image registry: GitHub Container Registry**, public package, free. This avoids Azure Container Registry, whose Basic tier has a fixed monthly charge.
- **AI:**
  - The default public setting is `BYLINE_AI_PROVIDER=foundry` + `BYLINE_AI_CACHE_ONLY=true`. Judges see the recorded real verified insights, and no model calls are made.
  - Optional live mode: a system-assigned managed identity, granted *Cognitive Services OpenAI User* on the existing Foundry resource. `DefaultAzureCredential` then picks up the managed identity automatically, so no key is needed. Keep `BYLINE_MODEL_CALL_CAP` small (for example 60 for the whole judging window). The ledger lives on ephemeral disk, so set `maxReplicas=1`. A restart resets the ledger file, which is why cache-only remains the recommended public mode.
- **Logs:** Container Apps environment with Log Analytics. Ingestion is billed beyond the free allowance; keep logs minimal or use the "none" logs destination.

## Cost expectations (approximate; verify in the Azure pricing calculator before approving)

| Item | Expectation |
|---|---|
| Container Apps consumption | Monthly free grant (vCPU-seconds, GiB-seconds, 2M requests) likely covers judge traffic with scale-to-zero. Open SSE streams keep a replica active while someone watches, so a busy judging day may exceed the grant slightly (expected cents to a few £ from credit). |
| GHCR | Free for public images |
| Foundry gpt-4.1-mini | Cache-only: £0. Live: a case is ~8–10k tokens (≈1 US cent per case at list price, to verify) |
| Log Analytics | Free allowance per month; avoid verbose logging |

An Azure budget alert is **not** a hard limit (Microsoft docs). The hard limits are application-level: the cache-only mode and the ledger.

## Read-only preflight (safe to run; no changes)

```bash
az account show --query "{name:name, state:state, tenant:tenantId}"
az consumption usage list --top 5           # confirms credit/billing visibility
az provider show -n Microsoft.App --query registrationState
```

## Commands to run only after explicit approval (owner runs or approves each)

```bash
az group create -n rg-byline -l uksouth
az containerapp env create -n byline-env -g rg-byline -l uksouth --logs-destination none
az containerapp create -n byline -g rg-byline --environment byline-env \
  --image ghcr.io/<owner>/byline:<tag> --ingress external --target-port 8000 \
  --cpu 0.5 --memory 1Gi --min-replicas 0 --max-replicas 1 \
  --env-vars BYLINE_AI_PROVIDER=foundry BYLINE_AI_CACHE_ONLY=true FOUNDRY_DEPLOYMENT=gpt-4.1-mini \
             FOUNDRY_OPENAI_BASE_URL=<endpoint> BYLINE_MODEL_CALL_CAP=0
```

Post-deploy smoke checks: `/healthz`, `/api/matches`, the golden story with the 28' verified insight, then an iPhone browser check. Record the results in PROGRESS.md.
