# BYLINE deployment record

| Item | Value |
|---|---|
| Status | Judging release, frozen until judging ends (10 Nov 2026) |
| Public URL | https://ca-byline-demo.yellowstone-acde35ac.eastus.azurecontainerapps.io |
| Source commit | `2d9b13f` (CI run 40363811364: secrets, api, web, image smoke test and full E2E all green) |
| Image | `ghcr.io/kieran-r96/byline@sha256:70c74c992737e7244ddee2b452b12c7b48e033ac9d85d27149e2b419f8bc062e` (built and smoke-tested by the `release-image` workflow, run 40365679382) |
| Deployed | 26 Oct 2026, about 14:00 UTC |
| Azure resources | Resource group `rg-byline-hackathon` (East US): Container Apps environment `cae-byline-hackathon` (Consumption, no Log Analytics) and Container App `ca-byline-demo` (0.25 vCPU, 0.5 GiB, 1 replica min and max, HTTPS-only ingress on port 8000). Budget `budget-byline-hackathon` ($20 a month, alerts at 50%, 80% and forecast 100% to the subscription owner). |
| Runtime configuration | Image defaults: `BYLINE_AI_PROVIDER=foundry`, `BYLINE_AI_CACHE_ONLY=true`, `BYLINE_MODEL_CALL_CAP=0`, API docs off, one trusted proxy hop. Set on the app: `BYLINE_HSTS=true`. No Foundry endpoint, key, tenant or identity is configured, so no model call is possible. |
| Not created | Container registry (ACR Tasks are not permitted on the Free Trial; the image is on GHCR instead), Log Analytics, databases, custom domain, VNet |

## External verification (26 Oct 2026)

| Check | Result |
|---|---|
| `/healthz`, home page, built assets, deep link `/studio` | 200 |
| HTTP | 301 to HTTPS; ingress HTTPS-only |
| Three synthetic matches served | BYLINE-01, -02, -03 |
| 7' recorded Foundry run | `state: verified`, provenance with 6 Foundry response IDs (Investigator, Analyst, Verifier) |
| AI status | `recorded`, cache-only, call cap 0, 0 calls used |
| Security headers | CSP, HSTS, nosniff, X-Frame-Options DENY; no `server` header |
| Unknown `/api` path | 404 |
| Full Playwright E2E suite against the URL (`E2E_BASE_URL=… npx playwright test`) | **39/39 passed** |
| axe audit against the URL, 13 states × desktop, laptop and phone | **0 serious or critical** |

## Redeploy the exact image

```bash
az containerapp update -n ca-byline-demo -g rg-byline-hackathon \
  --image ghcr.io/kieran-r96/byline@sha256:70c74c992737e7244ddee2b452b12c7b48e033ac9d85d27149e2b419f8bc062e
```
