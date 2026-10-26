# BYLINE Azure test and judging deployment: resources and cost plan

Status: **awaiting owner approval**. Nothing below has been created. Prices are Azure list prices (USD) as published for Container Apps and Container Registry; confirm in the Azure pricing calculator before approving.

## Subscription facts (checked 26 Oct 2026, read-only)

| Item | Value |
|---|---|
| Offer | Free Trial (`FreeTrial_2014-09-01`), state Enabled |
| Spending limit | **On**: when the trial credit is used up, or the trial period ends, resources are **disabled** rather than billed |
| Existing resources | `rg-kroberts13-4620` (Sweden Central): the Foundry resource used for the recorded runs. Untouched by this plan. |
| Providers to register (free) | `Microsoft.App`, `Microsoft.ContainerRegistry` |
| Remaining credit and trial end date | **Not readable from the CLI for a Free Trial. Owner to confirm in the portal (Subscriptions → Azure subscription 1 → Overview: credit remaining and days left).** |

**Key risk:** judging runs to **10 Nov 2026**. A Free Trial lasts 30 days from sign-up. If the trial ends before 10 Nov, the demo goes offline unless the subscription is upgraded, and you have said not to upgrade. Please confirm the end date before approving; if it is before 10 Nov, see "If the trial ends early" below.

## Resources (all in one new resource group)

| # | Resource | Name | Tier and size | Region |
|---|---|---|---|---|
| 1 | Resource group | `rg-byline-hackathon` | free | East US |
| 2 | Container Registry | `crbylinehackathon` | **Basic** (10 GB included) | East US |
| 3 | Container Apps environment | `cae-byline-hackathon` | Consumption only, **logs destination: none** (no Log Analytics workspace) | East US |
| 4 | Container App | `ca-byline-demo` | 0.25 vCPU, 0.5 GiB; **min 1 / max 1 replica**; public HTTPS ingress on port 8000; image pulled with a managed identity (AcrPull) | East US |
| 5 | Budget | `budget-byline-hackathon` | USD 20 per month on the resource group, alerts at 50%, 80% and 100% to your email | — |

East US is chosen because most judges are likely to be in North America; the price is the same in UK South or Sweden Central if you prefer.

Not created: no database, no custom domain, no Log Analytics or Application Insights, no VM, no Kubernetes cluster, no virtual network, no new model deployment, no Foundry calls. The image is built with `az acr build` from the exact commit that passed CI.

## Cost estimate

**Container App** (Consumption plan). The monthly free grant per subscription is 180,000 vCPU-seconds, 360,000 GiB-seconds and 2 million requests. One always-on replica at 0.25 vCPU and 0.5 GiB uses about 648,000 vCPU-s and 1,296,000 GiB-s per 30 days.

| Scenario (30 days) | Billable after free grant | Approx. cost |
|---|---|---|
| Mostly idle (judges visit occasionally) | 468k vCPU-s at the idle rate ($0.000003/s) plus 936k GiB-s ($0.000003/s) | **about $4.2** |
| Busy all month (worst case, constant replays) | 468k vCPU-s at the active rate ($0.000024/s) plus 936k GiB-s | **about $14** |

**Container Registry Basic:** about $0.167 per day, so **about $2.7** to 10 Nov. Image builds with ACR Tasks are about $0.0001 per second, roughly **$0.03 per build**.

**Networking:** the first 100 GB of outbound data per month are free. The app sends a few MB per visit, so the expected cost is **$0**.

**Logging and monitoring:** none created, **$0**. Health is checked with the built-in HTTP probe, and live logs can be streamed on demand.

**Total, 27 Oct to 10 Nov (about 15 days):** **about $4–10**, paid from the trial credit. **Maximum practical exposure in a full month: about $17**. With the spending limit on, the trial credit cannot be exceeded; budget alerts are notifications only, not a hard cap.

**Cheaper alternative, if you accept cold starts:** min replicas 0 (scale to zero) keeps compute inside the free grant (about $0). The first visitor after an idle period waits about 10–30 s while the container starts. For judging, min 1 is recommended.

## How to monitor

- Cost Management → Cost analysis, filtered to `rg-byline-hackathon` (daily).
- Budget alert emails at 50%, 80% and 100% of $20.
- `az containerapp show -n ca-byline-demo -g rg-byline-hackathon --query properties.runningStatus` and the `/healthz` endpoint.

## If the trial ends early

The resources are disabled and the URL stops working. Options, in order of preference:

1. You decide to upgrade the subscription before then (your call; costs as above).
2. Redeploy the same public image to another free container host, and update the submission's demo link with the judges' permission.
3. Judges run it locally with one command (`docker run -p 8000:8000 …`), as documented in the README.

## Clean-up after judging

`az group delete -n rg-byline-hackathon` removes everything in this plan in one step.
