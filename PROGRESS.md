# BYLINE work log

## Current status (2026-10-25 05:00 BST, release fix complete; feature development stopped)
- **Release fix:** Studio graphics stay on air until taken off (timed optional; root cause: 9 s of match time ≈ 0.75 s at 12x); replay "on the ball" only when tracking agrees (audit of 208 moments: 5 high-turnover mislabels fixed, What If? carriers all correct); all 52 line-breaking passes verified against measured lines (regression test); Commentator Command (search + quick-access tools, smart actions on live events, files that lead with one big fact, Mark used/Pin, big numbers, contextual actions); every role in the Studio's dark identity; Fan WWYD keeps its choices in view. Verify passed (vitest 160), E2E 39/39, axe 0 serious/critical. Screenshots: `docs/screenshots/release/`.

## Previous status (2026-10-25 02:00 BST, final pass complete)
- **Final quality, experience and security pass:** see `docs/final-pass-report.md` (Commentator Now area, player and club files, notifications; Studio formats and package builder; illustrative What If? continuation; crest-first Fan; corner mislabel fixed at the detection layer; security headers, unspoofable rate limits, no-model-call proofs). Checkpoint tag `pre-final-pass`.
- **Last verified:** verify all steps passed (pytest 333, vitest 158), E2E all specs passing (see report §7), axe 0 serious/critical, secret scan 0, pip-audit and npm audit 0.
- **Real Foundry usage:** ledger 59; no calls in this pass. **Cloud:** nothing created or deployed.
- **Remaining blockers (owner):** see `docs/compliance-checklist.md`: (1) public GitHub repo (squash history, noreply email, choose a LICENSE); (2) approve deployment (`docs/deployment-plan.md`), then verify the image build, HTTPS and the X-Forwarded-For hop; (3) record and publicly upload the film under 2:00 (`docs/demo-script.md`); (4) submit in Innovation Studio before 27 Oct 23:59 PT, confirming eligibility.

## How to run
- Replay a scenario timeline: `py tools/run.py replay-scenario golden_story`
- Evaluation report: `py tools/run.py evaluation` → docs/evaluation/report.md
- Real investigations for chosen candidates (spends ledger): `apps/api/.venv/Scripts/python tools/precompute_insights.py golden_story <candidate ids>`
- Backend: `py tools/run.py api` (or `cd apps/api && .venv/Scripts/python -m uvicorn byline.api.app:app --port 8000`)
- Frontend: `py tools/run.py web` → http://localhost:5173
- Verify all: `py tools/run.py verify`
- Regenerate fixtures (changes golden checksums): `py tools/run.py generate`

## Work entries

### 2026-10-20 — T001–T005 Gate A, T007/T008 agents, API (Claude)
**Working functionality (observed):**
- Seeded synthetic match generator produces a full 96-minute match (golden 2,582 events / ordinary 2,615) with 2 Hz tracking for 22 players + ball (x,y,z) + referee. Same seed → byte-identical log (checksum test). Stats are football-plausible: ~83% pass completion, ~21 m mean pass, ~20–30 shots per team.
- Golden story outcome 2–1: careless trip (DFK, no card) 9', offside position not involved 14', right-channel goal 28', RVC counter saved 36', reckless yellow 42', offside offence → IFK 45+1', RVC counter goal 52', overlap 57', second yellow → dismissal 63', subs 66'/79', VAR-disallowed goal (offside) 71–72', penalty scored 85', advantage then caution 90+1'/90+3'.
- Strict event-sourced reducer replays both matches with zero violations; rejects actions by substituted/dismissed players, second caution recorded as plain yellow, penalty outside the area, DFK offence in own area, goal confirmation during open VAR check, wrong kick-off team, wrong final score, duplicate/conflicting/out-of-order events (journal buffers gaps). Seek = rebuild from log (~0.3 s full match).
- D1 repeated-channel detector (events only; no tracking): golden seed → exactly 1 story (NBA right channel, 28'), inside authored window; ordinary seed → 0. Thresholds: ≥5 entries, ≥3 possessions, ≥60% share, ≥1 dangerous entry, baseline +20 pts and binomial tail ≤0.005 vs the team's own earlier spread. Offside-ruled passes excluded. Perturbed seeds (11–14): authored motif found 4/5 runs incl. canonical; 3 incidental detections in 9 other runs (to be reported honestly in T022).
- Agent workflow on Microsoft Agent Framework 1.22 (`WorkflowBuilder` graph, Executors wrapping separate `Agent`s): Investigator (7 bounded read-only tools) → Analyst → Verifier (3 tools) → deterministic validator → one revision loop → verified insight or labelled factual fallback. Tested with a TEST-ONLY scripted client through the real AF tool loop: happy path, wrong-number caught after verifier approval, positional claim rejected twice → no verified insight, invalid JSON retried once, unknown event id rejected, session cap blocks calls, timeout trips circuit breaker.
- FastAPI: `/healthz`, `/api/system/status` (real probe; currently honestly "degraded: different Entra tenant"), matches, events, tracking, state, patterns, sessions + SSE stream, insights/evidence/trace, rules. Live SSE smoke: seek 26' + play 60x → 314 events streamed, candidate at 28', insight stages queued → investigating → tentative (labelled deterministic summary because auth failed).
- Security: SPA static fallback path traversal fixed + tested.

**Files:** `apps/api/byline/**`, `apps/api/tests/**`, `tools/run.py`, `tools/foundry_login.py`, `docs/api-contract.md`, `.env.example`, `.gitignore`, `.gitattributes`.
**Decisions (reversible, documented):** Python 3.12 venv (Agent Framework compatibility); Chat Completions via official OpenAI SDK `AsyncOpenAI(base_url=…/openai/v1, api_key=<Entra token provider>)` wrapped in AF `OpenAIChatCompletionClient`; repo-local git user.name "Kieran"; `tools/run.py` replaces make on Windows; HT break compressed to 5 s of replay time.
**FOUNDRY:** code real, calls blocked at auth; mocks used only in tests and labelled. **COST:** none.
**NEXT:** T009 match theatre (frontend agent running), T006 real call once `az login` done, then T010–T013 (rules matrix, decision explainer, VAR retraction, D2/D3 detectors).

### 2026-10-20 (22:30) — Gate B real runs, Gate D, T018/T019 backend, T022/T023 (Claude)
**Working functionality (observed):**
- Real Foundry: DefaultAzureCredential→AzureCliCredential; direct call 5.6 s (29+39 tokens). Full Agent Framework workflow verified on D1 (5 calls, 9.9k tokens, 17.4 s), D3 overlap (5 calls, 8.0k tokens, 18.5 s; agent used the tracking tool), D2 71' (5 calls, 9.4k tokens, 17.2 s). One run was cut short by my own 6k per-case token cap (config error → cap raised to 14k, retried once). Traces in `docs/evidence/`.
- D2 counterattack + D3 overlap detectors: golden counters 36'/51' and overlap 56' match authored labels; overlap abstains without tracking; negatives quiet.
- VAR reversal (72') retracts the 71' counter story (real AI insight → "retracted", version 2, official reason) and the studio goal graphic, per session; seeking back restores it.
- Decision explainer: law-grounded cards for every official decision (16-case law matrix PASS), streamed as SSE `decision`.
- Discipline & VAR match (BYLINE-02): throw-in offside exception, straight red, DOGSO holding (penalty+red, saved), dropped ball, IFK into goal → goal kick, VAR-confirmed goal, DOGSO attempt (penalty+yellow), double-touch retake → all legal through the strict reducer, all explained.
- Research facts API (fictional, provenance-labelled, live match facts without future leakage); studio desk (approval-gated, timed, expiring, VAR-retracted); full-time recap (409 before FT; deterministic reconciled recap; optional validated model rewrite).
- Evaluation report (10 matches, 26k events, 0 reducer failures): dev seeds D1 1/0/0, D2 2/3/0, D3 1/0/0 (TP/FP/FN); held-out D1 3/7/1, D2 6/21/2, D3 3/1/1 — unlabelled detections are genuine-by-definition but unauthored, reported honestly as FP.
- Bugs found & fixed: session control/tick race (RLock), background tasks scheduled from threadpool (now loop-safe), recap 500 in cache-only, path traversal in SPA fallback, evidence 404 without insight record.
**NEXT:** Gate E UI (agent running) → review screenshots; T020 Spanish variant (≤6 calls left); T021 a11y pass; owner approval for deploy + GitHub remote.

### 2026-10-20 (23:10) — T014/T020/T023 + independent backend review (Claude)
**Working functionality (observed):**
- Discipline & VAR match (BYLINE-02) replays legally; all 9 referee cases explained (test).
- Real Spanish variants for the 3 recorded verified insights (3 calls; 20/21 fields shipped, 1 headline dropped by the length guard → English fallback).
- Live-server background path verified with real inference: full-time model recap (1 call, validated, 0 issues) replaced the deterministic recap; recorded so cache-only deploys show it. Ledger **18/20**; spending stopped (2 in reserve).
- CI workflow, Dockerfile (single container) and secret scan written; single-process static+API serving verified locally (Docker not installed here; image build will run in CI).
- Independent read-only backend review: 13 substantiated findings (session eviction of watched sessions, CPU DoS via uncached replays, seek blocking the loop, fallback insights lost after seek, decisions truncated, stale studio proposals, cross-thread asyncio queue writes, ticker death on one exception, REST views ignoring retractions, recap wording, slow-consumer staleness, raw provider errors in traces, ledger lock) — **all fixed with regression tests**. Suite: 127 passed; mypy strict + ruff clean; secret scan 0.
**NEXT:** integrate + verify Gate E UI from the frontend agent; T021 a11y/responsive pass; owner: GitHub remote + deploy approval.

### 2026-10-20 (23:35) — Gate E UI + T021 (frontend agent, verified and committed by Claude)
**Working functionality (observed):** commentator formation (10-man shape after dismissal, subs in slot), player/club research drawers with per-fact Used/Undo/Pin; law-grounded decision explainer (3-step, IFAB links, live prompts for major decisions); fan Classic (clean) / Discover / Analyst; studio desk with approval → on-air lower third → VAR-withdrawn graphics; editorial recap (Foundry-written, validated); Spanish toggle with per-field English fallback; match picker for all three scenarios. Accessibility: axe 0 violations across 24 runs (8 states × 3 viewports), keyboard-only E2E for play/evidence/research/studio, inert backgrounds, Escape + focus return, focus-safe toasts, 1024×768 dock layout, reduced motion verified on canvas pixels. One recap wording bug fixed by Claude (route-aware disallowed reason).
**State:** all P0/P1 build tasks PASS except owner-gated T023 (remote), T024 (deploy approval), T025/T026 (film, submission, freeze).

### 2026-10-21 (13:40) — Owner product-readiness directive: R0 Story Radar, R1 movement (Claude)
**R0 observed:** full trace (`docs/story-timeline.md`): golden stories detected 27:13 (D1, real verified), 35:40, 50:46, 55:45 (D3, real verified), 56:20, 70:43 (D2, real verified, withdrawn 71:53 after VAR); BYLINE-02: 39:46, 45:54; ordinary: 36:59. Delivery is in the exact tick that releases the evidence at 1x/12x/60x; backward seek removes; replay re-delivers once; Commentator/Studio/Fan Discover/Analyst show it, Fan Classic clean (E2E 5/5). At 15:14 nothing existed yet — not a defect, but a demo problem → Key moments + "Jump to the first AI-verified story": one click from kick-off → Verified real story in ~8 s (E2E). No thresholds changed; nothing fabricated.
**R1 observed:** see `docs/movement-audit.md` — evidence-preserving realism pass; all invariants pass on 3 matches; browser movement test passes; UI no longer calls a provisional goal a "VAR CHECK".
**R3 observed:** player drawer and research panel show derived fictional history (e.g. NBA-09's 100th appearance today, RVC-06 one booking from a ban, which becomes "booking number 5 brings a one-match ban" once he is booked and "no longer counts" after the second yellow). Consistency tests pass.
**R5 observed:** provider boundary implemented for the synthetic source only; `docs/data-contracts.md` explains the mapping for licensed feeds without claiming any integration.
**R4 observed:** from kick-off, Commentator -> Jump to the first AI-verified story -> Show evidence -> Show how the AI reached this displays the real recorded D1 run: Investigator (get_events 11 events -> get_match_context), Analyst claim, Verifier (approved; one sentence marked unsupported, shown honestly), Rule check passed, 5 Foundry response ids, commentator/studio/fan/analyst outputs and Spanish. Labelled "served from cache, no new model call". Web 59/59, E2E 13/13. Model spend: none (ledger 18/20).
**V0 observed:** `docs/engine-audit.md` — first signal median 24 min, longest silence median 37 min; danger gate is the only one whose removal finds authored channel patterns earlier (0.5-3 min), the loose gates add 55 noise candidates for 1 authored; investigator = 54% of agent latency.
**V1 observed:** golden match NBA right channel: OBSERVING 23' -> DEVELOPING 25' (every gate but danger) -> STRONG 28' (the unchanged detector publishes) -> WEAKENING 34' -> RESOLVED 36'. NBA counters: STRONG 57' -> CONFIRMED 71' -> STRONG 72' (VAR withdrew the 71' goal story; new version, history kept). Across 10 matches first signal median 4.5 min (was 24.2), no gate changed. Known data quirk: `period.ended` carries the announced added time (45+2') after a 45+3' event; storyline clocks stay monotonic.
**V4 observed:** Commentator, Jump to the first AI-verified story: "Building now" shows "DEVELOPING · since 23' · v2 — 7 of 8 final-third entries…; every gate except a dangerous entry has passed" with no story card; at 28' it becomes STRONG v3 and the verified story card appears beneath; History lists v1 23' / v2 25' / v3 28'. Web 64/64, E2E 14/14 (axe included). Model spend: none (ledger 18/20).
**2026-10-21 owner directive (R2 + Option A) observed:**
- Chronology: whistles now keep their true clock (generator fix, regression tests on fixtures + seeds); recorded real runs re-keyed only after proving identical inputs (4/4).
- AI (approved Option A): billing verified (Free Trial, spending limit on); 32 real calls, US$0.036; V3 4-call pipeline (checks intact, 20.5 s, target missed); 6 storyline reads shipped; new verified story RVC 36'. Ledger 53/53, spending stopped.
- R2 shipped and reviewed in the browser at 1440/1280/1024/820/390: storyline cards, Replay evidence, theatre identity, studio queue with VAR hold, research cards, truthful AI status. Bugs found by visual review and fixed: 'degraded' status in demo mode, duplicate story cards, VAR withdrawal hidden by the new card, measured line still counting a voided goal, 'Agents not run' on recorded runs, referee drawn like a second ball, evidence clock using raw elapsed time, controls pushed off screen, goal graphic approvable during a VAR check.
- Tests: backend 180, web 66, E2E 15, axe 0 serious/critical in 24 scenes.

## V3: the intelligence experience (21-22 Oct 2026)

Observed in the real app (cache-only backend, zero model calls):
- **Signature:**
  1. The Live feed delivers "S. Haddad-Rhys was open as M. Lindqvist's pass was cut out" at 7'.
  2. Show why freezes the pitch on the 6:14 frame, with the defending lines drawn.
  3. *What happened*: the pass draws into a lane holding 2 opponents (closest 0.3 m), and the interception is marked.
  4. *What if? (hypothetical)*: two real open options appear in teal (Haddad-Rhys, lane 3.3 m clear and 9.3 m of space; Rennard, 6.5 m and 13.8 m) with corridors, space rings and bypassed opponents dimmed. No outcome is claimed. Replay the play shows the real move.
- **Tactics:** 12 deterministic detectors with observed / interpretation / unknowns, released only when their data exists.
- **Signals:**
  - **Tiers and corrections:** alert / insight / quiet; stable ids, versions, suppression. VAR corrections are shown in place: "NO GOAL · disallowed for offside", and the tactical moment built on that goal is withdrawn.
  - **Knowledge:** history-derived alerts, for example "Luca Ferrandi's 10th derby goal, the most in derbies since 2016/17" and "Riverton have lost four league games in a row for the first time since March 2020".
- **Knowledge base:** match-by-match fictional history for 10 seasons, records and streaks computed under stated rules, and a HistoryProvider boundary.
- **Fan companion:** Discover and Analyst are a moment feed with mini pitches, Did you know?, follow-a-player and plain wording. Classic is unchanged.
- **Studio:** tactical graphics in the production queue (deterministic fact line), and Evidence opens the tactical explanation.
- **Visual:** a white ball with rim and halo, a broadcast alert plate, progressive evidence arrows, and a wider match centre on wide screens.
- **Tests:** backend 227; web unit 72; E2E 19 (new intelligence.spec); axe 0 serious or critical across 30 scenes.

## V4: the product experience (22 Oct 2026)

**Working functionality (observed in the browser and by the suites):**
- **Commentator:** a glance-first lead, the official key-events strip, developing play (measured moments, storylines, AI-verified stories labelled as deep analysis), server-ranked talking points with reasons, a routine match log, always-visible team sheets, and research (search, live stats, player, club, head-to-head and venue dossiers). A view switcher below 1100 px.
- **Studio:** a queue in lanes (on air, scheduled, held by VAR, for review, withdrawn), preview and programme monitors (labelled demo output), and an inspector with take now / next stoppage / 30 s / reject / take off air. VAR holds cannot be overridden. Seven graphic formats. The analysis desk has pre-match, half-time and full-time packages, the 3D stage, measured talking points, actual against hypothetical, and send to production.
- **Fan:** scoreboard, team and player spotlight (from the player dossier), filters, goal cards, What would you do? (the real pass hidden until the fan chooses), Did you know?, verified pattern stories and the match pulse. Classic stays minimal.
- **Tactical stage:** five steps with one layer each, controls, reduced motion and an SVG fallback, at 60 fps on an integrated GPU. It never moves the live match.
- **Backend:** dossier and talking-points endpoints with no look-ahead; 13 new stats keys (throw-ins, saves, possession and more); studio scheduling cues, substitution boards, record plates, stats panels and producer proposals; the goal signal drops "awaiting confirmation" once confirmed.
- **Foundry:** the tactical case adapter on the existing pipeline; one real verified run recorded and served from cache. One validator false positive (a possessive name) was found by the run and fixed with a regression test.

**Honest notes:**
- Twice in V4 I committed before a gate finished (one lint error, then gated fixes). Every later commit was gated on lint, types and tests.
- Removed UI replaced by V4: role panel tabs, signal feed, fan companion, 2D tactics workspace, old studio desk, formation panel and status cluster. Their behaviour is covered by the new surfaces and tests.

### 2026-10-22 (11:36–20:45) — V4.1 UX correction and creative direction (Claude + two agents, merged and verified by Claude)
**Working functionality (observed):**
- Commentator at 1440, 1280 and 1024: the 7' moment, its verified Foundry line, Show the play, Mark used and Dismiss, Developing and Worth saying all fit above the fold beside the shirt formation; the moment settles into Match so far after six match minutes.
- A shirt opens the player file beside the moment (today's numbers, facts with Pin to top, Mark used and Undo, career); club switch animates; club file opens from the header. E2E by mouse and keyboard.
- Show the play / See the evidence / Replay evidence pause the match; "← Back to match" returns to the same clock, speed and play state (E2E checks the playhead). Escape closes only the top layer.
- The 3D stage is manual by default with seven steps; "Then?" draws a simulated continuation computed by new backend geometry (pass ≤25 m lane checks, shooting window ≥12°, wide cross), labelled simulated with no outcome implied. The recorded Foundry run still matches its key (checked at runtime).
- Studio: previewing or airing the 7' tactical breakthrough loops its clip on the monitor; the inspector lists every field with its source and evidence id; switching to the fictional Northgate template redraws the same graphic. VAR hold, withdrawal and human approval unchanged (E2E).
- Fan: team, then player as shirts; What would you do? hides the real pass until a choice, then explains in plain words with the verified read; Show me why opens the stage; stats behind Match stats.
- Bugs found and fixed during review: control bytes in two regexes (my own script escapes), Escape closing two layers, the side panel covering the speed buttons, accessible names not matching visible text on shirts and stage controls, the scrubber thumb off the timeline rail, "Var check" kicker casing.
**Files:** `apps/web/src/app/**` (commentator, fan, studio, analysis), `components/{Formation,Stage,Broadcast,Drawer}`, `styles/*`, `apps/api/byline/tactics/whatif.py`, `apps/api/tests/test_continuations.py`, E2E specs, `docs/v4.1-report.md`, `docs/demo-script.md`, `docs/screenshots/v4.1/`.
**FOUNDRY:** no calls. **COST:** none.
**NEXT (owner-gated):** GitHub publication + CI, deployment approval, external testing, the two-minute film.

