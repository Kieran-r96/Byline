# BYLINE pre-deployment security audit

Date: 2026-10-24. Base commit `39d6708`; audit branch `worktree-agent-aecbe9e0db16c121a`. Scope: the owner's Priority 7 directive (secrets, dependencies, input handling, CORS and headers, production config, Foundry spend, Azure tokens, read-only demo, tests, licences, fresh browser session). Submission rules: `docs/compliance-checklist.md`.

**What this audit does not claim.** It is evidence from automated tests, scans and local black-box probes of the single-container build. It is not a penetration test, and nothing was deployed: Docker is not installed here, so the image itself was not built (CI builds and smoke-tests it); Azure ingress behaviour is marked NEEDS VERIFICATION where it matters. Security is therefore *tested*, not *fully verified*.

## Findings by severity

| ID | Severity | Finding | Status |
|---|---|---|---|
| M1 | Medium | Rate limits and the per-client session quota were keyed on the **left-most `X-Forwarded-For` entry**, which the client controls. Rotating the header gave unlimited requests and sessions. | **Fixed** `0434b82`: keyed on the entry our proxy appends (`BYLINE_TRUSTED_PROXY_HOPS`, 0 = ignore the header; image = 1 for Azure Container Apps). Post-deploy check needed (below). |
| M2 | Medium | No browser security headers (CSP, `nosniff`, framing, referrer, permissions). | **Fixed** `0434b82`, `ac7e681`: strict CSP with no `unsafe-inline`/`unsafe-eval`, and 0 violations across 39 UI scenes. |
| M3 | Medium (availability/cost) | Each *uncached* replay position (`upto_seq`) costs about 0.3-0.8 s of CPU. One client at 15 req/s could keep a 0.5 vCPU replica busy. | **Open (residual).** Mitigations: per-IP rate limit (now not spoofable), `maxReplicas=1` caps the bill, Free Trial spending limit, scale to zero. A cost-aware limiter is the fix if abuse appears. |
| L1 | Low | Request bodies were unbounded (memory). | **Fixed** `0434b82`: 16 KiB limit, 413 before parsing (Content-Length and chunked). |
| L2 | Low | Docker image defaults (`BYLINE_AI_PROVIDER=off`) did not match the public demo: the image alone showed no recorded Foundry insights, and the spend guard depended on deploy-time env only. | **Fixed** `0434b82`: image = cache-only Foundry, `BYLINE_MODEL_CALL_CAP=0`, no endpoint, key, tenant or identity. |
| L3 | Low | Unknown `/api/...` paths returned the app shell (200) in single-container mode. | **Fixed** `0434b82`: JSON 404. |
| L4 | Low | `/docs` and `/redoc` load Swagger UI and ReDoc from a third-party CDN; `server: uvicorn` header. | **Fixed** `0434b82`: off in the image (`BYLINE_API_DOCS=false`; `/openapi.json` kept, no secrets); `--no-server-header`. |
| L5 | Low | The minified bundle strips the MIT and OFL licence notices of what it ships. | **Fixed** `09d625c`: `/third-party-notices.txt`. |
| L6 | Low (privacy) | All 119 commits carry the owner's work email address as author and committer. | **Owner action** when squashing: use a GitHub `noreply` address. |
| L7 | Low | Python dependencies are resolved fresh at image build (no lock or constraints file). | **Open.** Today's fresh resolution audits clean. Recommend a constraints file once the image can be built and tested. |
| L8 | Low | The call ledger lives on the container's ephemeral disk and resets on restart. | **Accepted.** Cache-only + cap 0 make it moot for the public demo. Keep the cap small if live mode is ever enabled (`docs/deployment-plan.md` already says so). |
| I1 | Info | Production build ships source maps. | Accepted: the repository is public anyway. |
| I2 | Info | A 500 comes from Starlette's outermost error handler, without the security headers. Its body is only `Internal Server Error`. | Accepted. |
| I3 | Info | No project LICENSE file. | **Owner decision** (`docs/licensing-and-data.md`). |

No High or Critical findings. No secret was found anywhere.

## Fix commits (this branch)

| Commit | Subject |
|---|---|
| `e35f3f2` | Secret scan: `--history` (every line ever added, every ref), `--dir` (build output), more patterns, values never printed |
| `0434b82` | Security headers + CSP, 413 body limit, non-spoofable rate-limit key, `/api` 404 under the SPA, public-demo image defaults, 24 security tests |
| `ac7e681` | zod runs jitless, so the CSP holds with 0 violations; fresh-session E2E test |
| `09d625c` | Licence notices shipped with the app; THIRD_PARTY.md and licensing notes completed |
| `2976380` | The credential-canary crawl also fetches recorded real agent traces |

---

## 1. Secrets

| | |
|---|---|
| **Method** | `tools/secret_scan.py`, extended with three modes and patterns for private keys, Azure key assignments, JWTs and bearer tokens, storage connection strings, OpenAI, GitHub, AWS, Google and Slack tokens, Entra client secrets, SAS signatures, **real Azure AI resource hostnames** and **tenant/subscription id assignments**. Forbidden files: `.env`, `.env.*` except `.env.example`, `.pem`, `.pfx`, `.p12`, `.azure/`, `model_call_ledger.json`. Findings name file and pattern, never the value. A self-test plants a token of each kind (`test_secret_scanner_detects_each_pattern_without_printing_values`, `test_dist_scan_finds_a_planted_token`). |
| **Commands** | `python tools/secret_scan.py` · `python tools/secret_scan.py --history` · `python tools/secret_scan.py --dir apps/web/dist` |
| **Result** | Tracked: **559 files, 0 findings**. History: **119 commits on all refs, 0 findings**; no forbidden file was ever added. The refs are master, 10 `worktree-agent-*` branches and 5 tags; the stash is empty. Built bundle: **45 files, 0 findings**. A manual grep of the tracked tree for Azure hostnames, GUIDs and the owner's email found none. |
| **.env handling** | `.env` is git-ignored and docker-ignored (`.env`, `.env.*`), and was never committed. The local `.env` holds no key: auth is Entra (`FOUNDRY_AUTH=entra`, no `FOUNDRY_API_KEY`). Its endpoint and tenant id stay local. `.env.example` has placeholders only. |
| **Residual** | The owner's work email is in commit metadata (L6). History will be squashed before publishing; the scan above covers it either way. |

## 2. Dependencies

| | |
|---|---|
| **Method** | `pip-audit 2.10.1` in a throwaway venv (project venv untouched). It audited (a) the 78 pinned packages actually installed in the project venv, and (b) a fresh resolution of the image's requirements (`pyproject` deps + `requirements-ai.txt`). `npm audit` in `apps/web`, production and full trees. |
| **Commands** | `pip-audit -r project-freeze.txt --no-deps --disable-pip` · `pip-audit -r docker-reqs.txt` · `npm audit --omit=dev` · `npm audit` |
| **Result** | Python: **0 known vulnerabilities** (78/78 audited, none skipped); fresh resolution: **0**. npm: **0** (production: 9 packages; full: 370 packages). Advisory databases as of 2026-10-24. No upgrades were needed. |
| **Residual** | L7 (unpinned image build). Re-run before each image build. |

## 3. API input handling and injection

Routes enumerated in `apps/api/byline/api/app.py`: **39** (35 GET, 4 POST), plus the SPA fallback, the `/assets` mount and `/openapi.json`. There is no PUT, PATCH or DELETE (405, probed).

| Check | Evidence |
|---|---|
| Path/query bounds | Pydantic/FastAPI validation on every parameter. 17 hostile inputs each return 404/422, never 500 (`test_parameter_bounds_and_unknown_ids`): speed outside {1,4,12,30,60}, unknown control action, negative or missing seek, tracking window > 180 s or reversed, `limit` > 2000, negative `upto_seq`, `ref` > 120 chars, overlay action not in {approve, reject, hide}, `delay_ms` > 600 000, unknown session, match, moment, player or law. A seek beyond full time is clamped. |
| Body size | 16 KiB limit (`BYLINE_MAX_BODY_BYTES`), 413 for Content-Length and for chunked bodies (`test_oversized_bodies_rejected_before_parsing`). Live: a 100 KB body returns `413 {"detail":"request body too large"}`. |
| Session spam | Sessions are capped at 6 per client (the oldest idle one is evicted, never a watched one) and 200 in total. Idle sessions expire after 30 min. Live: 7 creates from one address leave 6 alive. |
| SSE limits | At most 4 streams per session. Live: the 5th stream returns `429`. Slow consumers are disconnected (queue 5000). Streams are exempt from the request-rate limit; they are bounded by the session caps. |
| Rate limit | 15 req/s, burst 60, per client. Live, with uvicorn proxy-header trust off: 200 concurrent requests, each with a different spoofed `X-Forwarded-For`, gave **66 allowed and 134 limited** (before M1, every one would pass). Test: `test_spoofed_forwarded_for_does_not_evade_rate_limit`, `test_client_key_trusts_only_proxy_appended_entries`. Note: uvicorn trusts `X-Forwarded-For` from loopback peers by default. That matters only for same-host clients; never set `FORWARDED_ALLOW_IPS=*`. |
| Static files / traversal | `safe_static_file` resolves under the root and rejects escapes. HTTP-level test on a real mount: `test_static_serving_contains_path_traversal` (6 encodings). Live raw-socket probes (`../`, `%2e%2e`, `..%2F`, backslashes, via `/` and `/assets/`) for `apps/api/byline/config.py` and `.env.example`: **no leak** (app shell or 404). |
| Errors | `app.debug` is False. An internal exception returns a bare `500 Internal Server Error` with no traceback or provider text (`test_debug_off_and_server_errors_are_generic`). Provider errors are reduced to a class name plus a fixed sentence (`provider.redact`). 422 bodies echo only the caller's own input, as JSON with `nosniff`. |
| Prompt injection | **No request text reaches any prompt.** The model-call sites (section 6) take only candidates, storylines, state and recap facts derived from the immutable synthetic fixtures. A visitor controls only *when* (playhead), never *what*. `Proposal.ref` is used only as a lookup key. Model output is validated before use (`agents/validator.py`: ids must exist, numbers must match, no betting terms or real leagues). |
| File system / subprocess | No HTTP path runs a subprocess (only CLI tools and `byline/evaluation`). File reads from HTTP use names derived from SHA-256 keys or validated moment ids. In cache-only mode no HTTP path writes to disk: after the full E2E suite, 39 a11y scenes and the probes, **no ledger file or insight cache was created** in the worktree's `apps/api/.cache`. |

## 4. CORS and browser security headers

| | |
|---|---|
| **CORS** | No CORS middleware, on purpose: app and API share one origin. A cross-origin `GET` gets no `Access-Control-Allow-Origin`, and the preflight is refused (`test_no_cors_grant_for_other_origins`). A cross-site form POST (`text/plain`) cannot create a session (422, `test_cross_site_form_post_cannot_create_a_session`). Mutating session routes also need the unguessable 96-bit session id. |
| **Headers** (every response, including 404/422/429/413 and SSE; pure ASGI middleware) | `Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; media-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'` · `X-Content-Type-Options: nosniff` · `X-Frame-Options: DENY` · `Referrer-Policy: no-referrer` · `Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()` · `Cross-Origin-Opener-Policy: same-origin` · `Cross-Origin-Resource-Policy: same-origin` |
| **CSP compatibility** | The built app needed two changes: zod's JIT probe (`new Function`) caused a `script-src eval` violation, so zod now runs jitless (`ac7e681`); Vite inlines four tiny font subsets as `data:` URIs, so `font-src` allows `data:`. Result against the single-container build: **0 CSP violations, 0 console errors, 0 off-origin requests in all 39 a11y scenes** (13 states × desktop, laptop and phone, including the Three.js stage, whose `scene-*.js` chunk loaded 12 times), and the full E2E suite passes (27/27). |
| **HSTS** | Off by default; `BYLINE_HSTS=true` adds `max-age=31536000; includeSubDomains`. **Owner action at deploy:** enable it only when the ingress is HTTPS-only (Container Apps `allowInsecure=false`). `test_hsts_only_when_enabled`. |

## 5. Production configuration

| Item | Image (`Dockerfile`) | Evidence |
|---|---|---|
| Debug | FastAPI `debug=False`, no `--reload` | `test_debug_off_and_server_errors_are_generic` |
| AI mode | `BYLINE_AI_PROVIDER=foundry`, `BYLINE_AI_CACHE_ONLY=true`, `FOUNDRY_DEPLOYMENT=gpt-4.1-mini` | `test_public_image_settings_disable_interactive_docs` boots the app with the Dockerfile's own `ENV` block (parsed from the file) |
| Spend cap | `BYLINE_MODEL_CALL_CAP=0` | `test_cap_zero_blocks_the_first_call`, `test_dockerfile_public_defaults` |
| Credentials | none: no endpoint, key, tenant or identity | `test_dockerfile_public_defaults`; `.dockerignore` excludes `.env*`, `.cache`, `.git`, `.claude` |
| API docs | `BYLINE_API_DOCS=false` (`/openapi.json` stays) | live: `/docs` serves the app shell, not Swagger |
| Proxy | `BYLINE_TRUSTED_PROXY_HOPS=1` (one ingress hop) | section 3 |
| Process | non-root uid 10001, `--no-server-header`, healthcheck `/healthz` | live: no `server` header |
| Logging | uvicorn default `info` (access log on). The deployment plan uses `--logs-destination none`. Logs never contain credentials (`test_anonymous_crawl…` checks every log record for canaries). | |

`docs/deployment-plan.md` passes `FOUNDRY_OPENAI_BASE_URL=<endpoint>` to the cache-only app. It is not needed in cache-only mode, so **omit it** (one less identifier in the environment).

## 6. Foundry: every code path that can call a model

| # | Path | Reachable from HTTP? | Gates before any call |
|---|---|---|---|
| 1 | Story investigation: `InsightService.submit` → `_run` → `investigate` (Agent Framework workflow, about 3-6 calls) | Yes: a *live* playing session reaching a story | `live` and provider is `foundry` and **not cache-only** and a client factory exists and no cached/recorded run and `budget.can_start` (breaker, per-session 30, daily 400, **ledger remaining ≥ 3**). Then every single request calls `BudgetGuard.charge` → `CallLedger.reserve` (persistent cap, fail-closed lock). |
| 2 | Storyline read: `storyline_view(live=True)` → `read_storyline` (1 call) | Yes: live storyline update | not cache-only, no recorded read, ≤ 8 per match per process, **ledger remaining ≥ 1**, then `charge` |
| 3 | Full-time recap: `recap()` → `model_recap` (1 call) | Yes: `GET /api/sessions/{sid}/recap` after full time | not cache-only, not already running, **ledger remaining ≥ 1**, then `charge` |
| 4 | Tactical insight: `GET …/tactics/{id}/insight` | Yes | **Never calls**: serves recordings only (`tactical.insight_response`) |
| 5 | `provider.probe`, Spanish translation, tactical investigations, precompute scripts | **No**: CLI tools only (`tools/*.py`, `byline/tools/*`) | ledger `reserve` before each call |

**Proof (tests with a spy client factory that fails if invoked; no real calls):**
- `test_cache_only_never_requests_a_model_client_over_whole_matches` ×3 matches: each full match is played *live* (every candidate, storyline and retraction takes the live path), then seeked back and forth, then the recap is requested, with 1000 calls of budget available. Result: **0 client requests, 0 ledger reservations, 0 background tasks**, and no canary credential in any stream message.
- `test_exhausted_ledger_blocks_every_live_path_even_without_cache_only` ×3: cache-only **off**, the ledger at the real state of **59 used / cap 20**. Result: 0 client requests; the ledger stays at 59; every non-recorded story is a labelled tentative fallback.
- `test_cap_zero_blocks_the_first_call`: the image's cap 0 refuses the first reservation on a fresh disk.
- `test_anonymous_crawl_makes_no_model_call_and_leaks_no_credentials`: **360 anonymous requests** to every public route and session action (3 matches, sessions played to full time, 4 recorded real agent traces fetched). Result: 0 client requests, 0 reservations, no 5xx.
- Existing: `test_persistent_ledger_hard_cap`, `test_ledger_blocks_mid_case`, `test_budget_cap_degrades_to_factual_summary`, `test_cache_only_mode_serves_recorded_real_insight_and_never_calls`.
- Live: `/api/system/status` reports `state: recorded, cache_only: true, calls_used: 0, calls_cap: 0`. The main repository's real ledger is unchanged at **59**.

## 7. Cached demo cannot exceed the model budget

In cache-only mode no model client object is ever constructed (paths 1-3 check cache-only before scheduling any work, and the client is created lazily inside that work). Even if cache-only were switched off by mistake, the image has (a) cap 0, (b) no endpoint, so `openai_client` raises before any network I/O, and (c) no managed identity or Azure CLI login, so no Entra token can be obtained. Spend is therefore zero by three independent controls, each covered by tests. The Azure budget alert is not a hard limit; these application controls are.

## 8. No privileged Azure tokens exposed

- The Entra bearer-token provider exists only inside the server-side `AsyncOpenAI` client (`agents/provider.py`). It is never serialised, logged or returned. `FOUNDRY_API_KEY` is a `SecretStr`. The browser never receives or needs any credential: the app sets no cookies, sends no auth headers, and the fresh session saw no 401/403.
- Status, metrics, insight, trace and evidence responses expose only provider name, state, deployment name (`gpt-4.1-mini`), counts, latencies and Foundry response ids. The canary test plants a fake resource hostname, tenant GUID and API key in the server settings. None appears in any of the 360 responses or in any log record.
- Bundle: 0 scanner findings. The only absolute URLs are XML/SVG namespaces, React error-docs links and JSON-schema ids. There is no Azure host, and nothing is fetched from any other host (fresh-session test).

## 9. Read-only public demo

| What a visitor can change | Blast radius |
|---|---|
| Their own replay session: play, pause, seek, speed, reset | That session only. In memory, expires after 30 min idle. The 96-bit random id is never listed (`test_session_ids_are_unguessable_and_not_listed`). |
| Their session's demo studio desk: approve, reject, hide or propose a graphic | That session only; labelled "demo programme monitor", never an external broadcast. |
| Shared, by design: rate-limit buckets, session counts, insight records per story | Deterministic in cache-only mode: a story's record is the recorded real run or the same labelled fallback for everyone. A visitor cannot inject text. Abuse can only cost availability (M3). |

There are no admin or write endpoints beyond the above, no uploads, no accounts, and no disk writes from HTTP in cache-only mode.

## 10. Test gates (this branch, cache-only backend on :8104)

| Gate | Result |
|---|---|
| Backend: `ruff check byline tests` / `mypy` (strict, 76 files) / `pytest -q` | clean / clean / **317 passed** (293 before + 24 new in `tests/test_security.py`), 1 deselected (opt-in `foundry_live`) |
| Web: `npm run typecheck` / `lint` / `test` (vitest) / `build` | clean / clean / **126 passed** (17 files) / built |
| E2E (Playwright, against the CSP-enabled single container `:8104`) | **27/27 passed** (26 existing + new `fresh-session.spec.ts`) |
| E2E (standard config: `vite preview :4184` → API `:8104`, final run) | **26/27 passed**. 1 failed: `commentator.spec.ts:81` (story evidence replay, "Back to match"). That spec does not touch the security changes and passed in the single-container run. Not re-run (time box), so it is recorded as an open failure, not called flaky. |
| Accessibility (`scripts/a11y-audit.mjs --url http://127.0.0.1:8104`) | **0 violations of any impact in 39 scenes** |
| CSP/console sweep (same 39 scenes, throwaway harness) | **0 CSP violations, 0 console errors, 0 off-origin requests** |
| Secret scan (tracked / history / dist) | 0 / 0 / 0 findings |

## 11. Licences

Summary (details: `apps/web/THIRD_PARTY.md`, `docs/licensing-and-data.md`):
- **Shipped in the web bundle:** React, React DOM, scheduler, three.js 0.186.1 and zod (MIT); Instrument Sans, Archivo, Manrope and Barlow Condensed (OFL-1.1, unmodified, self-hosted). Their licence texts now ship at `/third-party-notices.txt`.
- **API image:** 45 Python distributions, all permissive: MIT, BSD-3-Clause, Apache-2.0, PSF-2.0, MIT-0, and MPL-2.0 for `certifi` (unmodified).
- **Dev only:** 370 npm packages; besides permissive licences, MPL-2.0 (axe-core, lightningcss) and CC-BY-4.0 (caniuse-lite data), none shipped.
- **Media:** the only media files are the original `favicon.svg` and 182 screenshots of BYLINE itself. Stage textures are procedural, and crests and wordmark are original SVG/TSX. There is no footage, photo, club mark, music or real person. The validator blocks real-league and data-provider names.

## 12. Fresh browser session without credentials

`apps/web/e2e/fresh-session.spec.ts` uses a new Playwright context with empty storage and cookies against the built app and the cache-only backend. **Passed** both against the single container (`FRESH_SESSION_URL=http://127.0.0.1:8104`, which also checks the security headers on the app shell) and in the standard E2E run. It shows:
- The app loads and plays (position advances).
- The recorded verified Foundry story at 28' is served ("verified by Foundry agents"); status is `recorded`, `cache_only: true`.
- No CSP violations, console errors or page errors; no request to any other host (no Azure, no Google Fonts); no 401/403; no cookies set.

## Post-deploy checks (NEEDS VERIFICATION once the owner approves a deployment)

1. Confirm the Container Apps ingress *appends* the client IP to `X-Forwarded-For`. Send a burst of 200 requests with spoofed headers from outside: expect about 60 allowed, then 429.
2. HTTPS-only ingress. Then set `BYLINE_HSTS=true`.
3. `curl -I https://<app>/` shows the CSP and other headers; `/api/system/status` shows `recorded`, `cache_only: true`, `calls_cap: 0`.
4. Do not pass `FOUNDRY_OPENAI_BASE_URL` or assign a managed identity to the cache-only app.
5. Re-run `npm audit` and `pip-audit` right before the image build.
