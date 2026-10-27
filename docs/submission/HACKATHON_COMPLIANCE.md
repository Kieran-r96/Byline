# Final compliance checklist

**Source:** Official Rules, github.com/microsoft/insidethegamehackathon (`OFFICIAL RULES.md`).

**Status as of 27 Oct 2026:** the application and video are frozen. The detailed per-rule audit is in `docs/compliance-checklist.md`.

## Mandatory requirements

| Requirement | Status | Evidence |
|---|---|---|
| Submit by **27 Oct 2026, 23:59 PT** (28 Oct, 06:59 UK) | **Owner action** | Submit in the portal and keep the confirmation |
| Registered, eligible entrant | **Owner to confirm** | Outside the repository |
| Project newly created during the hackathon | PASS | First commit 20 Oct 2026 |
| Responds to the challenge, using synthetic football-realistic data | PASS | Seeded generator, fictional clubs (`docs/licensing-and-data.md`) |
| Uses the required Microsoft technology | PASS | Real Microsoft Foundry runs (recorded, with response IDs); Microsoft Agent Framework workflow (`apps/api/byline/agents/orchestrator.py`) |
| Text description: pitch, what it does, Microsoft technologies | PASS | `docs/submission/SUBMISSION.md` |
| Demo video **under 2 minutes**, showing the working project | PASS | 111.9 s, 1920×1080, all footage recorded from the live app |
| Video at a **public URL** on YouTube, Vimeo, Facebook Video or Youku | **Owner action** | Upload, set to Public (or Unlisted only if the portal accepts it), paste the link |
| No unlicensed third-party trademarks, music or footage in the video | PASS | Original synthesised music, fictional clubs, no real logos |
| **Public** repository | PASS | https://github.com/Kieran-r96/Byline (public, clean history, no secrets) |
| Working demo, free and unrestricted until **10 Nov 2026** | PASS | Live, no sign-in, cache-only; health-checked 27 Oct (below) |
| Materials in English | PASS | Video, README and submission text |
| No prohibited content | PASS | Fictional sport content only |

## Optional (strengthens the entry; not required)

| Item | Status |
|---|---|
| Category selection (Best Multi-Agent System, Best Use of Microsoft Foundry) | Choose in the form |
| CI on GitHub Actions | PASS: green on the released commit |
| Accessibility (axe) | PASS: 0 serious or critical issues across 39 scenes |
| Second language | Partial: Spanish for recorded AI insights and stories only; the interface is English |
| Additional languages (fr, de, it, pt) | Not implemented; future work |
| Live (non-cached) inference in the public demo | Deliberately off (cost control); recorded genuine runs are shown instead |
| Real data, tracking, footage and broadcast integrations | Future work; disclosed as not connected |
| Licence file | None by choice; the code is visible, but no rights are granted |

## Release freeze: final health check (27 Oct 2026)

| Check | Result |
|---|---|
| Container App `ca-byline-demo` | Running, provisioning Succeeded, minimum 1 replica |
| Image | `ghcr.io/kieran-r96/byline@sha256:70c74c992737e7244ddee2b452b12c7b48e033ac9d85d27149e2b419f8bc062e` (commit `2d9b13f`) |
| `/healthz` | `{"status":"ok","version":"0.2.0"}` |
| Index | 200 |
| `/api/matches` | 3 matches |
| 7' insight | Verified, with 6 Foundry response IDs |
| `/api/system/status` | `state: recorded`, `cache_only: true`, `calls_used: 0`, `calls_cap: 0` |
| Last full verification against Azure | E2E 39/39, accessibility 0 serious or critical issues |

**Freeze rules:**
- No further application, image or infrastructure changes before judging ends, except a release-critical fix.
- Documentation-only commits do not trigger CI or a redeploy.
- The Azure budget alert ($20) stays in place.
- Expected spend through 10 Nov is about $2–7 of trial credit.
