# BYLINE
## Master product, engineering, AI, football intelligence and visual-experience blueprint
**Inside the Game: Microsoft x Premier League Developer Hackathon | 2026**
**Authority:** Product owner-approved delivery brief. **Status:** Architecture proposal, NOT implemented software.
**Intended reader:** Claude Code, acting as lead implementation engineer under direct supervision of the product owner.

> **Mission:** Deliver a functioning, exceptionally polished, explainable football-intelligence product within the submission window. BYLINE turns a live-replayed **synthetic** match into traceable insights, intuitive commentator research, a studio-ready graphics queue, and a restrained, personalised fan experience. The core demonstration must be real: ingest an event, detect a pattern, investigate and verify its evidence through genuine Microsoft Foundry-powered agents, and render an audience-appropriate output.

> **Non-negotiable:** Do not build a static sports dashboard or a fake AI demo. Do not build a FIFA game, video-computer-vision tracker, gambling integration, or production live-feed licence infrastructure. Do not spend real money, create paid resources, change billing tiers, or deploy cloud infrastructure without explicit human approval.

---

## 0. EXECUTIVE DECISIONS. READ BEFORE CODING

1. **Build ONE monorepo, ONE web app and ONE backend.** The app has Commentator, Studio and Fan modes backed by the same match state and insight service.
2. **Start with a vertical slice.** One deterministic synthetic scenario with a repeated attacking-channel pattern must go from event replay -> rule detector -> actual Foundry model call -> machine-readable verified story -> live UI. Only then scale features.
3. **Implement football rules as structured match facts and explainers, never as an unverified LLM referee.** Officials decide calls in a synthetic ground-truth stream. BYLINE interprets and explains them; for borderline cases it describes uncertainty.
4. **No actual Premier League data or footage.** Invent clubs, names, crests and kits. Use synthetic event and (where relevant) tracking data. No unlicensed club logos, player photos, broadcast video, crowd audio or music.
5. **Protect the £0 out-of-pocket budget.** Confirm the Azure promotional credit is ACTIVATED, not just advertised; establish deployment/model pricing and rate limits before provisioning. Refuse pay-as-you-go upgrades or billable services outside verified credit.
6. **Premium UX is part of the engineering brief, not decoration.** A polished motion-driven match theatre, restrained commentary research, accurate visual system, keyboard/touch accessibility, and a convincing studio graphics preview. Avoid low-effort default chart dashboards, basic schematic SVG placeholders, font chaos and decorative cards without purpose.
7. **Protect the deadline.** No endless architecture packs, no unnecessary services, no unexplained redesigns, no half-day speculative refactors, no claims of completion without test results.
8. **Ship a hosted judge-accessible demo that remains usable into 10 November 2026.** Anonymous, clear demo access; transparent 'synthetic match' labelling; cache and replay fail-safes. No credentials/keys in GitHub.
9. **Use Microsoft services substantively.** A real Foundry model deployment is called by the app; a genuine multi-agent workflow is orchestrated with Microsoft Agent Framework where SDK and permission access allow. Log agent roles, hand-offs and verification. GitHub houses public source and CI. Hosting through Azure Container Apps if approved and feasible.
10. **Task truthfulness:** If a planned piece cannot be implemented, mark it CUT or BLOCKED and show the functional fallback. Never simulate a model answer while claiming a live model ran.

---

## 1. COMPETITION CONTRACT AND STRATEGY

**Authoritative competition source:** https://github.com/microsoft/insidethegamehackathon/blob/main/OFFICIAL%20RULES.md

**Deadlines:** October 27, 2026 at 11:59 PM US Pacific for submission. Confirm local conversion; allow at least 12 hours contingency. Judging through November 10; keep project operational throughout. The video must be **under 2 minutes**, show real functioning software on target device, have a public permitted video URL, contain no unauthorised protected IP. Public GitHub repo and a working accessible demo are required.

### Five-stage challenge mapping

| Brief stage | BYLINE implementation | Judge-visible proof |
|---|---|---|
| Ingest | Generated timeline of passes, shots, pressure, challenges, cards, set-pieces, match metadata, positional snapshots | 'LIVE / SYNTHETIC' stream advances and updates match clock/state |
| Interpret | Event aggregates; passage-of-play segmentation; attacking channel and transition detectors; foul/offside decision context | Story Radar flags a pattern based on matching event IDs, not a scripted text field |
| Explain | Foundry-powered investigator and narrative agent constrained to cited evidence; deterministic verifier | Why It Matters card with 'Show Evidence', uncertainty, model-run trace |
| Render | Timed structured overlay packet and on-screen producer preview | Approve -> local broadcast overlay appears at the intended time |
| Personalize | Commentator detail, studio producer, fan Classic/Discover/Analyst and player/language preference | Toggle modes for the SAME insight and see genuinely different content |

### Other brief asks, prioritized
- **Must show:** narrative, context, explainability, automated recap, audience difference, working UI and backend, synthetic dataset innovation, source records.
- **Include cheaply:** pass distance, modelled pass difficulty, player tags on **formation/pitch animation**, speed only when derived from valid synthetic positional samples, an example in a second language.
- **Stretch:** automatic event extraction from raw incoming video. It is suggested, **not a requirement** and is incompatible with the time budget if implemented well.
- **Category focus:** Best Multi-Agent System or Best Use of Microsoft Foundry, while also submitting as a compelling overall solution. Distinct agents, shared state, explicit handoffs, rejection/revision, retries, durable logs, and real evaluation count. Merely naming four prompts 'agents' does not.

### Judge impact in 120 seconds
The film should prove: 'The game changes -> BYLINE notices something deeper -> click evidence -> same verified finding is rendered three ways -> a referee decision is explained accurately -> recap is generated'. Show actual working functionality with uncut short recordings where practical. No exaggerated claims of video tracking, referee automation, trained football vision, or production broadcast integrations.

---

## 2. PRODUCT POSITIONING: MAKE IT DISTINCT

**One-line positioning:** **BYLINE. Every moment has a meaning.**

**Core differentiation:** Existing data suppliers provide events, graphics and editorial content. BYLINE's hackathon value proposition is **interactive, evidence-backed story discovery** with frictionless research and one intelligence layer driving three experiences. Do NOT claim to be first to invent sports analytics, overlays, tactical detection or commentator notes.

### Key users and jobs

**Commentator:** Glance at tactical and story suggestions, tap a formation shirt/number, tap club crest, get short researched fact cards, mark a particular card **Used** with one tap, hide it from primary recommendations but leave it in history. Every fact has evidence, provenance, and 'as of' metadata. The commentator never types a long search mid-play.

**Studio producer:** See queued candidate graphics with significance, timestamps, evidence and integrity status. Choose **Review / Approve / Reject / Hide**. Approve places a graphics card into the app's simulated broadcast layer, not into real Sky TV. Preview final aspect ratio and safe areas. The graphic contains appropriate expiry/retraction state.

**Fan:** **Classic** default: clean uninterrupted match theatre and score bar; no forced popups. **Discover:** subtle optional 'Why did that happen?' affordance or sidecar panel; favourite club/player weighting. **Analyst:** rich evidence paths, event breakdown, pace/pressing/rhythm comparisons. Language preference independent of role.

### Guiding principles
- **Normal football comes first.** Match centre remains visually dominant. Information secondary and dismissible.
- **Two taps to a useful fact.** Easy target sizes (at least 44 CSS px, preferably ~48-56 on touch).
- **No moving text underneath a reader.** New Story Radar items appear in a pending queue; open facts remain stable unless user changes them.
- **No unsupported certainty.** Facts, interpretations and speculative possibilities are visibly distinct.
- **One event, three lenses.** Shared evidence, tailored output.
- **Professional broadcast aesthetics, not a developer admin dashboard.**

---

## 3. VISUAL / INTERACTION DESIGN SYSTEM: PREMIUM FOOTBALL PRODUCT

**Design ambition:** Sophisticated international broadcast technology. Think elite live coverage, tasteful data journalism, touch-first commentary console, luxury dark editorial interface. It should feel like a high-budget sports production application, not Bootstrap, a Power BI dashboard, a generic startup landing page or children's football graphics.

### Visual identity
- Product: **BYLINE**, uppercase wordmark in a clean geometric sans. Subtle diagonal baseline/line motif; create ORIGINAL asset.
- Palette CSS variables:
  - `--ink: #07121D` near-black midnight navy, main app shell.
  - `--deep: #0D1E2D` secondary shell.
  - `--panel: #13283A` surfaces.
  - `--panel-elevated: #173246` drawers.
  - `--cream: #F5F2E9` main text (warm broadcast white).
  - `--muted: #9EB1BF` secondary text.
  - `--gold: #E7BA60` premium focus and moment accent, **sparingly**.
  - `--teal: #50C9C2` positive live intelligence accent.
  - `--grass: #135C43` pitch tones, not main background.
  - `--red: #F26C6B` dismissals/critical warnings only.
  - `--line: rgba(225,241,248,.13)` subtle panel separators.
- Typography: contemporary highly readable display weight 650/750, body 400/500; system-first or properly licensed free web fonts such as Manrope/Inter. Use condensed numerals sparingly for scores and clocks; do not use serif body text. Enable tabular numerals for clocks/metrics.
- Contrast: WCAG AA target for text and important controls, avoid grey-on-grey, ensure status does not depend on colour alone.
- Motion: 180-260ms controlled transitions and a 350ms luxury drawer slide, no constant breathing glows or gimmicky animated gradients. Honor `prefers-reduced-motion`.
- Radius: 12-16px cards, 16-24px major drawers, medium outlines and soft physically plausible shadow; avoid excessive pill badges.
- Iconography: consistent 18/20px line icons, useful not decorative. Team crests are original fictional marks; can be CSS shapes or purpose-made original simple assets. No Premier League branding copied.

### Required hero interaction: MATCH THEATRE
- Desktop (>=1280px): top bar with BYLINE, live synthetic label, selected fixture, mode switch and preferences. Main central wide cinematic match board / replay theatre (approx 16:9). Left compact lineup/formation rail if helpful. Right contextual dock (approx 360-420px) for Story Radar and details. Do not squeeze match area to half the screen.
- Tablet landscape (768-1279): match board with slide-over bottom/right contextual drawer. Large shirt number targets.
- Mobile: match board ~16:9 at top, bottom-sheet for facts, bottom nav for Match / Stories / Teams / View. No horizontal overflow; full-screen dialog for evidence as needed.
- **Pitch visuals:** Build the replay theatre using **Canvas 2D / PixiJS if justified** with rich pitch texture/stripe treatment, believable timing, subtle shadows, ball trail, player team colours and smoothly interpolated movement. Not flat static SVG diagrams. Camera can pan/zoom programmatically inside *our* synthetic render, not any real broadcast footage. We are NOT building a 3D football game. No stock footage or unlicensed sports video.
- Display excellent scoreboard with kit-colour flags, score, clock and game status. Overlay sparingly. Smooth timeline scrub, replay speed 1x/4x/12x/30x, pause/play, restart and jump-to-moment. The source remains deterministic.
- Formation overlay for commenter: visually premium team formation cards with readable player **numbers/names** and substitutions; tapping opens profile. Clarity beats a complex 3D pitch.
- Evidence mode: timestamped attacking sequences highlighted on the pitch timeline, contextual path/repeated-channel heat band; clear legend. Explain 'what this supports' vs 'what this cannot establish'.
- No meaningless sparklines or dense chart grids on the main screen.

### Mandatory interface screens/components
1. **Match Home:** hero pitch, score, timeline, important-moments rail, intro one-sentence value.
2. **Commentator:** teams/formation, player details drawer tabs `Quick | Records | Stories | Match`, **Mark Used** on a specific card, `Pin`, `Back to Match`; click crest for `Today | Records | Rivalry | Historical | Unusual` (sensitive claims must have sources; for synthetic clubs all backstory explicitly fictional).
3. **Story Radar:** 3-5 high-quality opportunities, not endless feed. Category/icon, short insight, `Why`, `Show evidence`, state `Investigating / Verified / Tentative / Rejected`.
4. **Evidence Workspace:** individual source events, timestamp, visible path, calculation values, explainability note, verification outcome and limitations.
5. **Studio:** queue with mini-card overlay preview, evidence/reliability, approval status; an approved mock overlay appears atop BYLINE synthetic match. Preview 16:9 safe area.
6. **Fan:** toggle Classic / Discover / Analyst, favourite team/player, language English + one well-reviewed translation. Classic MUST be nearly completely clean.
7. **Match Recap:** final score, arc of match, key events, successful narrative explanation, rejected claims never used, story recap in selected language.
8. **System / Demo lab:** replay selector, seeded scenario ID, genuine Foundry connection indicator, calls/latency tokens and budget guard state, ability to replay events quickly, technical trace drawer (opt-in).

### Copywriting / editorial tone
- Short plain-English titles under 12 words. Outcomes understandable in 3 seconds.
- A tactical insight is **not** a claim to read a manager's mind.
- Use `Evidence: 4 passes, events E141–E147` or explanatory equivalents.
- Never present generated numerical odds or invented player's real-world records. All fictional club history is marked demo data.
- Badge 'Possible tactical pattern' until sufficient evidence and verifier sign-off; 'Verified evidence' does not mean proven causal intent.

### Premium delivery acceptance
At 1440x900 and tablet viewport, above fold should look and behave like a finished high-end broadcast tool. No layout cutoffs, no default scaffolding splash, no giant unstyled SVG pitch, no missing states, no garish gradients, no irrelevant charts, no dead buttons, no text clipping. The first demo interaction must work in under three seconds excluding initial startup, and no freezing during event playback.

---

## 4. RECOMMENDED ONE-APP TECHNICAL ARCHITECTURE

**Architecture choice**: practical modular monolith, optimised for solo delivery.

- **Frontend:** React + TypeScript + Vite. CSS variables / Tailwind CSS if speed helps; prefer explicit polished components. Motion (small targeted animation utility) and accessible dialog/drawer primitives. Canvas 2D pitch renderer. Query data from backend; SSE for match event stream with polling fallback; use Zod for runtime contract validation. Avoid gigantic external component frameworks if they impose generic aesthetics.
- **Backend:** Python 3.12+, FastAPI, Pydantic v2, uvicorn, structured logger, pytest. Modules by domain (`simulation`, `football`, `rules`, `insights`, `agents`, `presentation`, `api`). Maintain strict typed contracts.
- **Simulator:** deterministic seed-based synthetic fixture generator; pre-generated event log checked into repo for golden runs, plus parametrised alternative seeds and adversarial samples. Sessions advance through log at simulated speed; live ingestion is the *streaming replay of immutable timestamped events*, not prewritten model conclusions.
- **Storage for competition:** seeded JSON/JSONL fixture packages in source + SQLite dev cache (or simple in-process cache). Make match replay reconstructable by source log and cursor. No mandatory persistent external database dependency for judges. Optional Azure Cosmos DB free-tier adapter later only if activation, region, cost and permissions checked. Do not persist essential judge state only to local ephemeral container disk.
- **Agents:** Microsoft Agent Framework (Python) for typed sequential hand-offs and retry/conditional paths; Foundry model deployment accessible by SDK/REST. If the Agent Framework SDK proves incompatible in the live environment, preserve *genuine model calls and distinct role prompts* with explicit app-side typed handoffs; document fallback honestly. Do not misrepresent framework usage.
- **Hosting:** first deliver localhost and test. After owner approval, single Azure Container Apps consumption application serving static compiled frontend and FastAPI. Avoid AKS, multiple always-on containers, GPU deployments, Redis clusters and premium ingestion products. Consider Azure static frontend if simpler, but the single-container deployment keeps config minimal. Keep `minReplicas=0` within compatibility of SSE and replay recovery; prove cold start and reconnect path.
- **CI:** GitHub Actions lint/typecheck/pytest/front-end build/end-to-end smoke. Minimal Docker and reproducible local commands.

```text
                       ORIGINAL SYNTHETIC MATCH DATA
        fixture + roster + ruleset + referee decisions + tracking
                                 |
                   deterministic event replay stream
                                 v
            FastAPI ingest & event-sourced MATCH STATE
             score/clock/lineups/cards/restars/VAR etc.
                                 |
                      FOOTBALL INTELLIGENCE
            aggregates + detectors + ranking + evidence
                                 |
                interesting cases ONLY; bounded queue
                                 v
                 MICROSOFT FOUNDRY AGENT WORKFLOW
     Investigator -> Tactical/Narrative Analyst -> Verifier
            -> Editorial / Personalization formatter
                                 |
                 VERIFIED STRUCTURED INSIGHT STORE
          id/events/version/status/expiry/translation/overlay
                          /       |        \
                         v        v         v
                    Commentator  Studio    Fan
                  formation/facts approve  Classic/Discover

          event journal, audit traces, replay, acceptance tests
```

**Core rule:** Model calls are triggered by significant candidate stories or user `Explain` requests, NEVER every positional tick. Cache identical insight signatures. Limit concurrent requests. Prioritise low latency deterministic state updates. If Foundry is down, keep the match and rules UI alive and clearly mark AI unavailable.

---

## 5. DATA CONTRACTS AND CLOCK MODEL

The `contracts/*.schema.json` files in this pack are authoritative starting contracts; refine after tests, preserve backward compatibility or update tests and change log.

### Coordinate model
- World pitch: **105m length, 68m width**. `x` from 0 to 105 left to right on our canonical neutral pitch. `y` from 0 to 68 top to bottom.
- Each team has `attacking_direction` per period: `+x` or `-x`. Convert to `attacking_x` 0-105 when calculating final-third penetration, pressure or attack channels; **never confuse left side of the picture with a team's attacking right wing**.
- Tracking sample: `match_id, frame_time_ms, period, player_id, x_m, y_m, visible/active, source='synthetic', precision`. Ball has similar position and optional z. Coordinates track player-centres only; **insufficient to adjudicate marginal offside**.
- Frame timestamps are monotonic real replay event times, separate from displayed match clock. Display stoppage as `45+3'`/`90+5'`, preserving a continuous `elapsed_ms`. Timezone is for scheduled fixture metadata only.
- Events have `event_id, match_id, schema_version, seq, elapsed_ms, period, clock, team_id?, player_id?, type, payload, source, truth_status, correlation_id?`.
- Reversals are **append-only correction events** (e.g. goal disallowed), never silently mutate historical event records.

### Core event taxonomy (implemented as strongly typed payload variants)
- `fixture.created`, `team_news.updated`, `lineup.confirmed`, `period.started`, `kickoff`, `period.ended`, `match.finished`.
- `pass.completed`, `pass.failed`, `carry`, `ball_recovery`, `turnover`, `pressure`, `challenge`, `tackle`, `interception`, `shot`, `save`, `goal.provisional`, `goal.confirmed`, `goal.disallowed`, `own_goal`.
- `foul.committed`, `advantage.applied`, `advantage.recalled`, `offside.position_detected` (candidate only), `offside.offence_confirmed`, `card.yellow`, `card.second_yellow`, `card.red`, `disciplinary.reviewed`, `injury.stoppage`.
- `restart.awarded` with type `direct_free_kick | indirect_free_kick | penalty | corner | goal_kick | throw_in | dropped_ball | kickoff`, `restart.taken`, `penalty.taken`, `penalty.outcome`, `substitution`, `var.review_started`, `var.review_outcome`.
- `tracking.frame` at bounded rate. These are large volume and should NOT create a database insert or SSE story for each player on every frame; frame batches optional.

### Core entities
`Match`, `Team`, `Player`, `Manager`, `Official` (role main/assistant/fourth/VAR/AVAR), `FixtureContext`, `Roster`, `Appearance`, `SyntheticFact`, `TrackingFrame`, `MatchEvent`, `Segment`, `PatternCandidate`, `Insight`, `EvidenceRef`, `AudienceVariant`, `OverlayPacket`, `AgentTrace`, `UserViewPrefs`, `UsedFact`.

### Event source of truth vs derivation
- The **synthetic referee/official decision** stream is authoritative for scoring and match sanctions. Data generator creates adjudicated outcomes from plausible authored fixtures/scenarios; it must not call an LLM to randomly decide rulings.
- BYLINE reads tracking/events to identify possible patterns and explains known decisions with IFAB law references.
- `truth_status` distinguishes `observed_synthetic`, `official_synthetic`, `derived`, `model_interpretation`; prevent data laundering from a generated explanation into a confirmed match fact.
- Versioned insights can be `pending | verified | tentative | rejected | retracted | superseded` and maintain reason and validator metadata.
- Facts can be `fictional_seeded | public_law_reference`, with `source_title, source_url (when appropriate), updated_at`, never invented real-player biographies.

### API endpoints, initial contract
- `GET /healthz` and `GET /api/system/status` (Foundry `configured | ready | degraded | disabled`, not fake health).
- `GET /api/matches` and `GET /api/matches/{match_id}` fixture, roster, score, officials, ruleset, current state.
- `GET /api/matches/{match_id}/lineups` and `/teams/{team_id}/facts` and `/players/{player_id}/facts`.
- `GET /api/matches/{match_id}/stream?speed=...&cursor=...` as SSE, validated cursor, resumable `Last-Event-ID` where possible.
- `POST /api/matches/{match_id}/sessions` create replay session; `POST /.../control` start/pause/seek/speed/reset, with bounded replay.
- `GET /api/matches/{match_id}/events?after_seq=&limit=` and `/patterns` and `/insights` and `/recap`.
- `POST /api/insights/{insight_id}/explain` user-initiated bounded request; `GET /api/insights/{id}/evidence`; `GET /api/insights/{id}/trace` (redacted).
- `POST /api/studio/overlays/{id}/approve|reject` demo-only; no external broadcast publish.
- `POST /api/users/{demo_session}/used-facts` and `GET /api/users/{demo_session}/preferences` optional client-local persistence for usability.
- `GET /api/metrics/demo` aggregated counts, latency percentiles, verification, false-positive test set; do not expose token, key, prompts with secrets.
- `GET /api/rules/{law_ref}` short verified synthetic explainer with IFAB source and law version.

### SSE contract
Each stream message has `id` matching sequence, `event` typed (`match_event`, `match_state`, `pattern_candidate`, `insight_update`, `tracking_batch`, `heartbeat`, `replay_reset`) and JSON payload. Never put raw large blobs into every message. Handle old cursors/replay reset. Frontend retries with backoff and can recover via REST event backfill.

---

## 6. SYNTHETIC FOOTBALL WORLD AND SCENARIO DESIGN

A simulator that generates 2,000 random passes isn't impressive if play is incoherent. We need **causally consistent football episodes** and reproducible outcomes.

### Fictional match seed
- Clubs: e.g. **Northbridge Athletic** (deep garnet) vs **Riverton City** (electric blue). Original crests, original 20-25 synthetic players per club, officials, managers, stadium, fixture metadata, short invented histories.
- 90+ minute timeline, extra time optional not needed. Two starting XI formations, 5 plausible substitutions per team max per scenario based on competition config (competition rules can vary; use configurable ruleset rather than universal hardcode), cards, restarts, shot map, goals and narrative turning points.
- 2-3 **intentionally embedded but not pre-labelled to the detector** tactical motifs: (A) repeated right-channel attacks with final-third entries; (B) a counterattack after a high turnover; (C) an overlap evidenced by positional frame series. Include negative cases where activity is similar but conditions aren't satisfied.
- One referee arc: careless trip outside box -> direct free kick; reckless foul -> yellow; second yellow -> dismissal; clearly offside *offence* -> indirect restart; penalty inside box -> taken/saved/scored; VAR goal review -> provisional -> disallowed or confirmed. Include advantage applied after foul and injury stoppage. Not all need occur in the 120-second video, but must function in full replay.
- Built-in mode: 1x simulated or 12x/30x for full arc; separate showcase checkpoints allow jump near seeded highlights. Show 'Synthetic data • seeded scenario v1'.

### Generator requirements
- Seed reproducibility: same seed and config -> identical events and outcome, same IDs and timeline. Different seed -> sensible variation.
- No events by sent-off players after dismissal; no substitutes before they enter; no completed pass by a player not on pitch; no penalties without awarded restart; no confirmed goals while VAR pending if scored provisional. Invariants validated.
- Possession changes follow ball control/restart results. Restart state requires appropriate taker/time/clock. `period.ended` boundaries correct, halftime teams swap directions.
- Track event provenance, difficulty parameters, possession team and player location where required.
- Generate 3 scenario seeds: Golden Story, Discipline and VAR, Ordinary Match (few stories). Scenario tests must prove pattern detectors don't trigger on the ordinary seed.
- Add a small perturbation tool that swaps some safe event variants to prove AI isn't just recognising fixture ID; do not change the expected law outcomes without updating ground-truth generator.

### Data realism and validation
- Pass length = Euclidean meters within pitch bounds. Pass distance includes `(x2-x1)^2+(y2-y1)^2` rooted. Position smoothing respects plausible max player speed.
- Speed from distance/time measured over frames, not guessed. Shot speed if physically meaningful ball-frame deltas exist; otherwise label unavailable.
- Modelled pass difficulty from distance + defensive pressure + target space and angle using explainable rule coefficients. Call it **BYLINE experimental pass-difficulty index**, never present as an official league metric or a trained model.
- Match momentum and 'control vs chaos' derived from transparent windows; no assertion that momentum causes future goals.
- User-facing metrics never exceed what input data can support.

---

## 7. FOOTBALL RULES, OFFICIATING AND SET-PIECES (IMPORTANT)

**Primary authority:** IFAB **Laws of the Game 2026/27**. Reference https://theifab.com/laws/latest/ and https://theifab.com/law-changes/latest/. Rules can change by season and competition options; store explicit `ruleset_version: 'IFAB-2026/27'` plus competition modifiers. Treat the following as a simplified **simulation/explanation specification**, not a replacement for official rule text.

### Match state machine
`PRE_MATCH -> FIRST_HALF_ACTIVE -> HALF_TIME -> SECOND_HALF_ACTIVE -> FULL_TIME`, with nested `PLAYING`, `STOPPED`, `RESTART_AWARDED`, `RESTART_READY`, `VAR_REVIEW`, `ADVANTAGE_ACTIVE`, `INJURY_STOPPAGE`. A stoppage is not always the same as a period end. Added time is tracked. Maintain `pending_decision` for provisional goals, penalty review, offside/VAR context.

### Law-aware events and UI behavior

**A. Fouls (Law 12)**
- Record offender, victim, position, contact/type, severity (`careless | reckless | excessive_force` when applicable), ball-in-play, referee official signal and advantage decision.
- Typical careless direct-free-kick offence receives no automatic card; reckless offence is caution; excessive force may be sending-off. Use official decision payload, not a universal 'every foul is yellow' heuristic.
- Distinguish direct vs indirect free kicks, handling, impeding, dangerous play and goalkeeper-specific offences where grounded.
- Detect foul location inside/outside offender's penalty area for **direct-free-kick offence** -> penalty where rules apply. Not every contact inside a box is a penalty.
- `advantage.applied` can let play continue; original foul/card follow-up handled law-aware with official decision. If play stops, do not manufacture a different restart.
- SPA and DOGSO decisions are nuanced. In penalty area, DOGSO when attempting to play/challenge for the ball can reduce red to yellow under specified circumstances, while holding/pulling/pushing/no attempt can remain red. Do not implement oversimplified blanket 'last man = red'.

**B. Cards and dismissals**
- Yellow updates player and team discipline; yellow accumulation configurable. Second caution leads dismissal; preserve two yellow events and red outcome, update 10-player shape, forbid later player actions and recommend pressing-shape story only if evidence demonstrates change.
- Straight red and second yellow distinct. Card can follow advantage stoppage. A VAR red card review is possible under eligible protocols, but a second-yellow review is not universally in VAR scope; treat scenario-specific and check protocols.
- `card.retracted` or `disciplinary.reviewed` corrections append new events, update authoritative state with audit trail.

**C. Offside (Law 11)**
- **Offside POSITION alone is NOT an offence.** At time a teammate plays/touches the ball, candidate requires player in opponents' half, nearer goal line than both ball and second-last opponent using eligible body parts, then involvement in active play (touch, interfere with opponent, gain advantage in specified situations).
- Level with second-last opponent is onside; arms/hands ignored. Player-centre x/y cannot validate marginal body-part calls. For demo, give explicit synthetic ground truth (official decision and simplified point-in-time representations).
- No offside offence directly from **throw-in, goal kick or corner kick**. Following an ordinary free kick, offside may apply.
- Deliberate opponent play vs deflection/save differs; don't assert an offence on deflection alone without context; store `touch_nature` and official decision.
- Referee offside offence restarts with an **indirect free kick**, not direct. A goal flagged offside remains `provisional` until confirmed/disallowed outcome. Describe law explanation but never claim machine-authoritative VAR accuracy.

**D. Free kicks (Law 13)**
- Distinguish `direct` and `indirect`; direct free kick can score directly against opponent; indirect requires another player's touch for a valid goal. For indirect signal and ceremonial wall/distance, record simulation metadata as appropriate. Free-kick offence -> restart type per Law 12 and location.
- Don't overcomplicate every ceremonial positioning infringement for MVP.

**E. Penalties (Law 14)**
- A penalty is awarded for relevant DFK offence by defender within own penalty area while ball in play. Record taker, keeper, placement, timing, outcome, rebound, encroachment status when simulated, cards and VAR changes.
- Kick taken once appropriately, ball in play after kick and clear movement, kicker cannot deliberately play a second time before another player touches it. Handle direct goal/saved/missed/post/rebound.
- 2026/27 clarified accidental double touch: if a penalty kicker accidentally touches with both feet / non-kicking leg immediately and the ball enters goal, retake; if not scored, indirect free kick. Don't claim every double touch is automatically a goal cancellation without circumstances.
- Distinguish penalty kick during match vs kicks from penalty mark (shootout); the latter is stretch/non-MVP.

**F. Other restarts (Laws 8, 15–17)**
- Kick-off after goal/each half; corners and goal kicks when ball crosses goal line with correct last touch; throw-in when crosses touchline; dropped ball for qualifying stoppages.
- Avoid inventing throw-in offside. Model stoppage and restart correctly rather than as single generic 'set-piece' event.
- Ruleset can optionally illustrate current time-wasting countdown rules, but don't include unless reliably implemented and tested.

**G. Referee, officials, VAR and match context**
- Pre-match metadata: kickoff time (including timezone), ground, fictional managers, starting XI, benches, main referee, assistants, VAR roles, suspension/injury/absence notes explicitly seeded as fictional.
- VAR simulation has check reason, eligible review category, provisional decision, recommendation and final on-field referee decision. A **VAR event is not itself a final ruling**. Timeline and published overlays must update/retract if outcome reverses.
- Don't overstate authority of the assistant. `BYLINE explains official decisions; it does not officiate matches` appears in the explanatory view.

### Explain-the-decision UX (important standout)
After a foul, card, offside, penalty or VAR outcome:
- Prompt `WHY THAT DECISION?` in commentator and Discover Fan modes only when a materially important event occurs.
- Show compact decision: `Decision: Indirect free kick | Reason: Active involvement from an offside position | Law 11 | Official match event: E...`.
- A 3-step optional explainer: **What happened** (grounded event) -> **Which rule applies** (IFAB version and short source) -> **What changes now** (restart/score/team shape).
- Display `Law-grounded explanation` separately from `AI tactical interpretation`.
- If inputs are insufficient (e.g., only player-centre coords), explain the known officiating outcome with caveat instead of claiming pixel-level offside verification.
- For professional commentary: quick card + `Mark Used` on that specific talking point.

### Football law test catalogue (more in QA document)
Offside position vs offence, halfway exception, level, throw-in/goal-kick/corner exception, deliberate opponent play vs deflection, DFK outside/inside penalty area, reckless caution, second yellow red, DOGSO challenge vs pull, advantage, indirect free kick direct goal disallowed, penalty score/save/rebound, accidental penalty double touch, goal provisional/reversal, 10-player lineup integrity, stoppage + restart.

---

## 8. FOOTBALL INTELLIGENCE: OBJECTIVE DETECTORS FIRST

### Core signals (pure Python, no LLM)
1. `pass_distance_m` and `pass_difficulty_index` (experimental, deterministic coefficients documented).
2. `final_third_entries` per team/channel rolling time window; normalised to attacking direction.
3. `territorial_pressure` from possessions and entries around area; only claim player pressing shape if tracking evidence exists.
4. `transition_speed` from turnover to opponent half / attacking third / shot within a bounded time.
5. `attack_channel_distribution` left, centre, right; optionally adjusted for opposition formation.
6. `rhythm_index` pace, turnover frequency, time between high-value events; 'control vs chaos' as clearly defined index, not arbitrary feeling.
7. `player_involvement` recent passes, shots, recoveries, fouls, cards, milestones from SYNTHETIC history.
8. `referee_context` state, law-grounded event result and competition-specific ruleset.

### Three required detectors

**Detector D1. REPEATED-CHANNEL ATTACKS**
- Sliding 8-12 simulated minute window; segment distinct possessions and count progressive entries on normalized right/left/centre. Compare with preceding window and match baseline. Trigger candidate if >=4 entries from >=3 possessions and channel share exceeds e.g. 60%, with at least one resulting chance or dangerous final-third entry. Thresholds are tunable, recorded, and tests include false-positive ordinary match.
- Allowed claim: `The home side is repeatedly progressing through the right channel` with event evidence.
- Forbidden claim without tracking: `The opposition left-back is being dragged out of position`.

**Detector D2. FAST COUNTERATTACK**
- Possession won in own/middle third -> rapid forward progression in <=12 simulated seconds -> final-third entry / shot, with meaningful field advancement. Cite turnover, passes/carries and shot. Use measured elapsed time.
- Allowed claim: `A quick transition followed the interception and created a shot`.
- Forbidden claim without shape: `Manager deliberately switched to a 4-2-4`.

**Detector D3. OVERLAP WITH TRACKING**
- Needs time-sampled positions for two same-team wide players AND defenders, coherent orientation, one runner advancing past carrier along flank, ball progression and possible defender movement. Work from trajectory over at least several frames, not a static snapshot.
- Classification `possible overlapping run` when core requirements pass. Stronger `overlap contributed to chance` only if there is a linked pass into exploited channel and a resulting chance. Avoid claims of intention, causality beyond evidence. Cross-check positions/time and event linkage.

**Optional detector D4. PRESSURE CHANGE**
- With rich synthetic pressure events and tracking, measure intensity at higher pitch locations across windows. Without adequate events, use explicitly weaker `increased high recoveries` phrasing, not 'high press detected'.

### Candidate scoring / suppression
- Each detector returns `candidate_id, pattern_type, score_components, evidence_event_ids, frame_intervals, calculated_metrics, unsupported_claims, detected_at_seq, novelty_key, confidence_band, explanation_constraints`.
- Deterministic significance threshold, cooldown per team+pattern, avoid repeated alerts, avoid spamming a live commentator.
- If VAR/goal reversal changes narrative, invalidate affected candidates and retract studio overlay/recap story.
- Score is editorial priority, **not statistically calibrated real-world probability**.

### Pseudocode
```python
for incoming_event in ordered_event_stream:
    state.apply(incoming_event)                         # validated + idempotent
    aggregates.update(state, incoming_event)
    candidates = detectors.evaluate(state, aggregates)
    for candidate in novelty_filter(candidates):
        if candidate.evidence_is_sufficient and ai_budget.can_infer(candidate):
            queue_ai_work(candidate, snapshot=state.version)
        else:
            publish_deterministic_explanation_or_suppress(candidate)
    publish_state_and_event_updates()
```

### Accuracy demonstration
- Gold dataset labelled separately for *evaluation* only, hidden from detector runtime. Unit tests for each pattern, negatives, threshold boundary, random-seed perturbations, event order handling.
- Evaluation report: Precision/recall on synthetic labelled scenarios, unsupported-claim rejection rate, LLM output schema validity, mismatch count, mean/p95 latency (when measured), token usage (when measured). Never invent benchmark numbers.

---

## 9. AI: GENUINE MULTI-AGENT FOUNDRY WORKFLOW

Use https://github.com/microsoft/agent-framework and official Foundry SDK guides. Validate current versions/API by reading docs before implementation; don't copy an outdated Agent Service Python example blindly.

### Purpose of agents
- Agents are *not* the event detector. They investigate why a detector's evidence matters, draft readable claims and cross-check against tools.
- Prefer 3 purposeful LLM roles plus a deterministic validator. A fourth audience renderer can be a pure transform or a model call only for the final output/language, preserving verified facts.

### Role A. **INVESTIGATOR** (tool-using)
Input: `PatternCandidate` + current `MatchContext` snapshot and caps.
Tools: `get_recent_events(team, time_window)`, `get_tracking_window(frame_range)`, `get_player_facts`, `get_team_facts`, `get_rule_reference(law_number)`, `get_prior_insights`.
Returns typed `EvidenceDossier` with related event IDs, match facts, uncertainties, candidate finding and source references. MUST not assert tactical causation beyond data.

### Role B. **ANALYST / STORY EDITOR**
Input: EvidenceDossier.
Produces 1) one-sentence insight, 2) factual explanation, 3) significance, 4) limitations, 5) alternate explanation if material, 6) plain-language variant plan, 7) citations to event IDs. No invented background, odds, real-world records or unsupported spatial relationships.

### Role C. **VERIFIER** (separate role with tool access)
Validate every externally visible number, named actor, location, timing, law decision, and causal claim against event/source evidence. Return `verified | needs_revision | rejected` and reasons. Can ask Analyst for ONE correction round only; if still unsupported, downgrade to a deterministic factual summary or suppress. Deterministic schema/domain validation after verifier is mandatory.

### Editor/Personalizer (final pure transform or tightly bounded model)
Take **only verified canonical claims** and produce:
- `commentary`: max ~35 words, glanceable with useful context.
- `studio`: title <=55 chars, subtitle <=100 chars, event anchor/time, template ID, timing/expiry, review-required.
- `fan`: `classic` null/no overlay, `discover` <=30 words, `analyst` structured evidence + metrics, `follow_player` relevance weighting.
- English always. A second language can be requested from the same canonical facts; verify numbers, names, IDs and rule meaning are preserved. Mark translations as translations, not newly sourced claims.

### Mandatory output schema
```json
{
  "insight_id": "I-0031",
  "match_id": "BYLINE-01",
  "candidate_id": "P-011",
  "status": "verified",
  "type": "repeated_channel_attack",
  "title": "A pattern building on the right",
  "canonical_claim": "Four of the last six final-third entries came from the home team's right.",
  "why_it_matters": "The team is finding repeatable progress into dangerous areas.",
  "uncertainty": "Does not establish defenders' intentions or positioning.",
  "evidence_event_ids": ["E-110", "E-115", "E-121", "E-129"],
  "metric_provenance": {"window_minutes": 10, "channel_share": 0.667},
  "verified_by": "verification_agent_and_deterministic_checker",
  "audience_variants": {"commentator": "...", "studio": {"template":"channel-pressure"}, "fan_discover": "..."},
  "expires_at_elapsed_ms": 2900000,
  "version": 1
}
```
The JSON above is illustrative, not real match evidence.

### Shared state and hand-offs
- `InvestigationCase` record tracks case ID, state snapshot version, candidate, agent step/run ID, event tool calls, attempt count, error, verdict, latency and token budget.
- Orchestrator stages: `queued -> investigating -> analysing -> verifying -> approved|tentative|rejected -> rendered`, and `retracted` on changed evidence.
- Agents never write raw match state; only issue typed findings to service layer. There is no open browser/web search while processing each event; football law tool uses pinned IFAB metadata (with link), synthetic facts are from seeded database.
- Tool functions take validated IDs and bounded ranges; avoid arbitrary shell/network/file access from agents.
- Agent prompts strictly prohibit ungrounded statements, betting/odds recommendations, sources not present, false authoritative rules decisions and fake citation ids.
- A2A or MCP is NOT mandatory. Integrate only if it adds real value without development risk. Orchestration handoffs and tool use are sufficient for the intended architecture.

### Cost/latency and resilience
- `BYLINE_AI_ENABLED` / `BYLINE_AI_PROVIDER=foundry|mock_for_tests|off`. `mock_for_tests` cannot be presented to judges as a real Foundry result. The visual demo must indicate provider state.
- `BYLINE_MAX_MODEL_CALLS_PER_SESSION` (e.g. 30), `BYLINE_MAX_TOKENS_PER_CASE`, concurrency <=2, one correction round, per-candidate TTL/cache and project-level circuit breaker. Configure rates after measuring real deployment.
- If Foundry is unavailable, publish deterministic event/rule descriptions with `AI temporarily unavailable`, and make retry explicit; don't expose the model provider's secret in responses.
- Deterministic validator checks referenced ids exist and numeric claims recalculate. A model's self-reported 'confidence 97%' is NOT meaningful; use evidence tiers `supported | tentative | insufficient`.
- Do not let models adjudicate offences or override referee decisions.
- Measure real Foundry latency, response validity and token use on 10+ scenarios. Report actual results only.

---

## 10. STORY RADAR, PLAYER RESEARCH AND EDITORIAL POLICY

### Story Radar lifecycle
`discovered -> investigating -> evidence_checked -> available -> used/pinned/dismissed -> expired/retracted`. Display max 3 featured cards, remainder inbox with filters. Persist per user session `used` on fact ID and insight ID, **not** entire player card. A used fact can be opened later via 'Used history'; new player facts remain accessible.

### Contextual ranking
Based on: recency, novelty, current fixture/opponent, current player participation, milestone proximity from fictional seeded histories, urgency, evidence strength, personal team/player, audience role, whether fact previously used. Include reason such as 'Relevant because Player 9 was substituted 2 minutes ago'. No unsupported claims of discovering real-world personal anecdotes.

### Fact provenance
Each fact has `fact_id, subject_id, fact_type, short_text, extended_text, fictional_record_source, event_source_ids, certainty, last_reviewed, expires_at?`.
Avoid unsupported 'bad things' about actual clubs/players. Synthetic clubs can have fictional setbacks/controversies that are not defamatory, or the category may be named `Setbacks` rather than scandals. No real people's sensitive facts.

### Commentary interface interaction contract
- Tap team formation / crest -> focused drawer <300ms transition.
- Tabs `Quick`, `Records`, `Stories`, `Match`, `Rules` (rules context for officiating).
- **Mark Used** applies to fact/story only, confirmation toast, offer Undo. Pinned facts at top. Used facts hide from suggestions but remain searchable.
- Large back/close targets, no accidental loss of reading position. Never auto-close a drawer because live events arrive.
- Substitution immediately updates active formation and optional 'coming on' fact with official event metadata.

### Match recap generator
- Derived from final authoritative score, key events and verified insights, ordered by time; include late winner, turning points, cards, penalties and disallowed goals when material.
- Retry and deterministic fallback template on model failure. Reconcile all numbers/players/goals/cards with final state. No claim of final score before `match.finished`.
- Give studio summary and fan summary; all claims traceable to events.

---

## 11. STRUCTURED GRAPHICS / PERSONALISATION CONTRACT

**OverlayPacket** from verified insight:
`id, match_id, source_insight_id, version, status='proposed|approved|on_screen|expired|retracted', template_id, match_elapsed_ms, display_from_ms, display_for_ms, title, subtitle, team, player_ids, source_event_ids, language, priority, safe_area, animation_style`.

Templates: `goal_story`, `channel_pressure`, `transition_breakdown`, `player_milestone`, `referee_decision`, `full_time_recap`. Each uses BYLINE original styling and safe-area guidelines; no third-party logos/music. All graphics require human approval in Studio mode, except locally safe mock-preview.

### Fan experience
- Classic = no forced overlay or unrequested pop-up, while story availability signalled unobtrusively if opted in.
- Discover = a short learning explanation after an important event, no chart clutter; `Why?` opens evidence.
- Analyst = annotated replay snippets from our synthetic theatre with pattern details, decisions, timeline.
- Favourite player = relevant events about that selected player; don't pretend optical tracking of live TV; formation and real synthetic event player IDs only.
- Favourite team = tone and ordering personalised but **facts unchanged**. No fan-specific outcome bias in factual claims.
- Multilingual = at least one second language if working end-to-end, preserve all numbers and rules.

---

## 12. SECURITY, COST AND OPERATIONS

### Security
- No secrets in repository, screenshots, logs or React bundle. Use `.env.example`; `.gitignore` `.env`/credential stores; secret scan in CI.
- Foundry calls are server-side only; no direct browser API keys. Use `DefaultAzureCredential` where possible; role permissions least privilege and explicit approval.
- Public judge demo is read-only by design. Limit model triggers via server rate limits and per-session quotas; no unauthenticated unlimited AI spend.
- Studio approve action affects only user sandbox presentation, never an external broadcast. Simple ephemeral demo session IDs with optional signed controls if needed. No personal user data or production data.
- Validate query/IDs/speed, guard `seek`, `limit` and fan inputs; sanitise HTML; CSP best effort; no user-generated raw HTML into graphics.
- Health/status redacts secrets and subscription IDs. Ignore unauthorised attempts to leak Foundry secrets via agent content.

### Credit budget guardrails
- $200 new Azure credit is conditional on account eligibility/activation. Portal promotional banner alone is insufficient; confirm subscription offer and remaining credit.
- No pay-as-you-go upgrade without explicit owner approval. No premium GPU, paid stock assets, unnecessary managed databases, AKS, premium tool connections or long-running hot compute.
- An Azure budget ALERT IS NOT a hard spending limit. Trial-credit exhaustion can suspend services; avoid exhausting it, retain functional cached/replay fallback. Reference https://learn.microsoft.com/en-us/azure/cost-management-billing/manage/avoid-charges-free-account .
- Log API call count/tokens and assign conservative daily application-level quotas. Cache by hash of `match_seed + candidate evidence ids + output language + model deployment version`.
- Azure Container Apps consumption free grant helps but isn't a blanket promise of no charges, especially with other resources/networking. Reference https://learn.microsoft.com/en-us/azure/container-apps/billing .
- Agents may incur model and tool charges. Reference https://azure.microsoft.com/en-us/pricing/details/foundry-agent-service/ .
- STOP if provisioning UI asks to upgrade, card charge, paid plan, or no eligible Foundry quota. Explain blocker to owner with zero-cost alternative.

### Runbook and continuity
- Two commands to run full local app (`make dev` or documented frontend/backend pair).
- `make verify` runs tests, lint, typecheck, build and a synthetic golden scenario; no Azure needed for deterministic tests.
- `make replay-scenario SCENARIO=golden` and `make evaluation` output documented machine-readable results.
- Azure readiness endpoint, startup smoke, evidence story smoke after deploy, front-end mobile/tablet screenshot checks.
- Deploy early enough to expose external access issues. Do not wait until last evening. Verify from a non-development browser/device and on phone.
- Deploy cost-safe app that stays available until judging ends without incurring real charges; when using free credit, monitor burn and protect demo.

---

## 13. NON-FUNCTIONAL REQUIREMENTS AND QUALITY GATES

**Latency targets (aspirational and measured, not promised):** deterministic event state UI <= 500 ms after stream message; click-to-card <= 200 ms after cached fetch; candidate surface <= 1.5 seconds after enough events; Foundry enriched insight <= 8–15 seconds if actual model latency permits, with intermediate Investigating state. UI should never block on LLM to update the score.

**Reliability:** event application idempotent, duplicate/out-of-order detection, deterministic replay, reconnection, no incorrect goal count after VAR, no duplicate penalties, no cardless second-yellow dismissal, no match state corruption. Persist source timeline, rebuild snapshots as needed.

**Accessibility:** visible focus, semantic controls, keyboard support, 44px target size, AA contrast, reduced-motion, screen-reader alt/labels, no data represented solely by colour.

**Responsive:** 390px wide phone, 820px tablet, 1440px desktop; no horizontal scroll of primary app, safe-area iPhone support, landscape tablet supported. Test actual responsive behaviour before claiming polished.

**Acceptance evidence:** each feature marked DONE only with run command, test output and a short video/screenshot demonstrating behaviour. Agentic claims require traces showing actual calls and verifier verdict. Performance claims measured, not guessed.

---

## 14. RISK MANAGEMENT AND FEATURE FREEZE

| Risk | Mitigation / cut path |
|---|---|
| Azure Foundry access blocked | Local engine fully implemented, provider adapter ready; immediately report. Use real Foundry as soon as access works. No fake claims |
| Model prices/quota exceed credit | Reduce calls/models, cache, suppress low-value triggers, guard budget and keep no-cost mode |
| Agent Framework SDK incompatibility | Pin supported Python package versions and sample from current docs. If blocked, implement typed manual handoffs invoking real Foundry, document honestly |
| Tactical detector false confidence | Show evidence and limitations, use conservative thresholds, 'possible' labels, gold negative tests |
| Football law errors | Pin IFAB 2026/27, use official result payload, test edge cases, no automated officiating promise |
| Visuals look generic | Dedicated design review against style tokens and screenshots; stop new features until hero UX looks premium |
| Player-video mapping scope creep | Do not implement. Simulated pitch + lineup touch only |
| Judging host goes down | Readiness tests, deterministic demo replay, no app dependency on an always-on workstation |
| Claude wastes time | Hard work-unit scope, 20-minute blocker escalation, no unrelated refactors, continuous vertical slices |
| Only 7 days | No rigid daily quotas, but gates and deadline buffer. Cut stretch scope before cutting proof-of-pipeline |

### Absolute order of technical gates (NOT a calendar)
1. **Gate A**: local synthetic event -> correct state -> candidate with trace.
2. **Gate B**: candidate -> real Foundry multi-role workflow -> verified structured output -> cached result.
3. **Gate C**: first PREMIUM polished interface renders it end-to-end with replay and evidence.
4. **Gate D**: fouls/offside/cards/free kicks/penalties/VAR correctness + formation research, fixtures and recap.
5. **Gate E**: distinct Commentator/Studio/Fan presentation; graphics preview, preferences and translated variant.
6. **Gate F**: real external deployment, judge access, QA, repo README, video and submission.

### Kill / reduce rules
- If Foundry integration blocked > 2 focused debugging cycles, bring problem to owner. Do not start 15 more features.
- If detector accuracy is weak, simplify claims to those provably grounded and document remaining limitations.
- If time is tight, CUT: advanced visuals (retain refined pitch), extra datasets, external database, translations beyond one, fourth detector, optional video auto-eventing. KEEP: 5-stage pipeline, proof of real Microsoft AI, evidence verifier, three distinct UX variants, law correctness for seeded cases, judge access.
- Feature freeze before submitting. No architecture rewrite during final QA.

---

## 15. REPO STRUCTURE

```text
byline/
  CLAUDE.md
  BYLINE_MASTER_BLUEPRINT.md
  TASKS.md
  QA_AND_EVALUATION.md
  KICKOFF_PROMPT.md
  README.md
  .env.example
  .gitignore
  Makefile
  compose.yaml                  # optional local dev
  Dockerfile
  contracts/
    match-event.schema.json
    insight.schema.json
  apps/
    web/
      src/
        app/                   # routes, providers, contexts
        components/
          MatchTheatre/
          Formation/
          StoryRadar/
          EvidenceDrawer/
          DecisionExplainer/
          StudioQueue/
          FanExperience/
          ReplayControls/
        features/
        services/
        styles/
        types/
      public/                   # original fictional assets only
      tests/
    api/
      byline/
        api/
        simulation/
        events/
        match_state/
        football/
          rules/
          metrics/
          detectors/
        agents/
          tools/
          prompts/
          orchestration/
        stories/
        overlay/
        storage/
        observability/
        config.py
      tests/
        fixtures/
          golden_story.jsonl
          discipline_var.jsonl
          ordinary_match.jsonl
  docs/
    architecture-decisions.md
    cost-guardrails.md
    submission-checklist.md
    licensing-and-data.md
    demo-script.md
  .github/workflows/ci.yml
```

Do not mechanically generate every folder before needed; this is a guide, not a requirement for empty scaffolding. Keep code modules cohesive and not overabstracted.

---

## 16. PROMPTS FOR AI AGENTS (POLICY SUMMARY)

**Global prompt:**
> You are an evidence-limited football editorial agent for a synthetic match. Use only provided official synthetic match events, approved synthetic facts, computed metrics, and pinned IFAB rule references. Cite exact event IDs for every nontrivial football claim. Distinguish an observed event from interpretation. Never invent player history, tactics, precise player movement, laws, real-world data, sources, wagering probabilities or managerial intent. Return only the prescribed JSON schema. When evidence is insufficient, say so clearly, request permitted tools or reject the claim. Never alter the match's authoritative referee decisions.

**Investigator task:** Gather bounded pertinent events and synthetic history, identify alternate explanations, list claims that cannot be supported.

**Analyst task:** State what happened, why it matters, and how confident the evidence is using supported/tentative/insufficient. Do not infer intention or offside from headless centre coordinates.

**Verifier task:** Challenge named players, teams, scores, numerical values, law references and inference type; emit correction request and reason if unsupported, and reject irreparable unsupported claims.

**Presenter task:** Rephrase the canonical verified result for each role while preserving names, times, numbers and uncertainty. Classic fan mode has no unsolicited visual output.

---

## 17. DEMO SCRIPT (TARGET < 120s)

- **00:00–00:12:** Cinematic BYLINE home, two fictional teams, synthetic match streaming with elegant score clock and simple UI; voice: 'Most broadcasts show what happened; BYLINE shows why it matters.'
- **00:12–00:30:** Three attacking sequences accumulate in repeated channel, Story Radar surfaces a candidate with 'Investigating'. Actual Foundry agent traces visible after verification; avoid fake wait.
- **00:30–00:48:** Verified tactical story becomes available. Tap `Show Evidence`; show events/visual paths and limitations.
- **00:48–01:04:** Tap player shirt in formation -> facts -> `Mark Used`; show same card doesn't reappear and new facts remain accessible.
- **01:04–01:21:** Foul/offside/penalty and decision explainer using pinned Law; an offside goal may be disallowed and any proposed overlay is retracted.
- **01:21–01:42:** Toggle 'One moment, three views' Commentator / Studio / Fan. Approve studio preview locally; Classic fan experience remains unobstructed.
- **01:42–01:54:** Full-time recap auto-generated, concise trace of evidence, English plus a second language if implemented.
- **01:54–01:59:** Professional BYLINE end card and value proposition.

Voiceover and captured UI must accurately reflect what was actually implemented. The repo README shows architecture, technologies, reproducible golden replay, tests and limitations. Place video on approved platform; public URL; judge-accessible project; submit in time.

---

## 18. DEFINITION OF DONE FOR FINAL SUBMISSION

All of the following, or clearly documented conscious reductions explicitly approved by owner:

- [ ] New original BYLINE project, original assets and synthetic dataset.
- [ ] Seeded event replay handles match lifecycle and required rules decisions without state corruption.
- [ ] >=3 tactical detectors with source evidence and at least one reliable negative case each.
- [ ] Actual Foundry model run integrated with a purposeful investigator/editor/verifier workflow, observed real responses, schema validation, cost guard.
- [ ] An insight can be traced to immutable event IDs, annotated frame/replay and rule references.
- [ ] VAR and corrections retract/replace affected narratives and graphics appropriately.
- [ ] Premium, responsive, accessible match UI with functional controls and no fake buttons.
- [ ] Interactive formation/team/player research; per-fact Used, Undo, Pin history.
- [ ] Commentator, Studio and Fan variants genuinely different; Fan Classic clean.
- [ ] Proposed, approved, rejected and expired studio graphics packets render in mock production overlay.
- [ ] Football officiating examples (fouls, first/second yellow, red, offside, free kicks, penalty, advantage) tested against the current IFAB ruleset.
- [ ] Reproducible metrics and an automated full-time recap grounded to final match state.
- [ ] Local tests, UI build, E2E smoke and deploy smoke all pass; result notes recorded.
- [ ] Hosted demo available to judges free of charge during judging window.
- [ ] Public GitHub repository, README, third-party attribution/IP note, <2 min demo video, completed submission.
- [ ] Cloud spend remains within approved free trial credit; owner has not opted into unapproved billing.

---

## 19. KNOWN LIMITATIONS TO STATE PUBLICLY

BYLINE is a competition prototype using wholly synthetic teams and football-realistic events. It is not a certified referee system, optically tracking real broadcast footage, licensed to use Premier League footage or brands, an official Opta/Genius metric feed, or a real-time betting/odds service. Tactical insights are estimates from the available event and position stream; match officials' outcomes come from simulation ground truth. Any third-party service integration beyond the prototype requires commercial data/rights and further engineering.

**The product must look like a million-pound platform and act like a carefully engineered one, while remaining honest that this is a week-one demonstrator. Polish is achieved through restraint, speed, evidence, graceful degradation and extraordinary fit-for-purpose UX, not 100 unfinished features.**

### References
- Microsoft official hackathon rules: https://github.com/microsoft/insidethegamehackathon/blob/main/OFFICIAL%20RULES.md
- Microsoft Agent Framework: https://github.com/microsoft/agent-framework
- Foundry SDK and agent framework: https://learn.microsoft.com/en-us/azure/foundry/how-to/develop/sdk-overview
- Foundry Agent Service pricing: https://azure.microsoft.com/en-us/pricing/details/foundry-agent-service/
- Azure Container Apps billing: https://learn.microsoft.com/en-us/azure/container-apps/billing
- Azure free offer and charge avoidance: https://learn.microsoft.com/en-us/azure/cost-management-billing/manage/avoid-charges-free-account
- IFAB 2026/27 Laws of the Game: https://theifab.com/laws/latest/
- IFAB law changes: https://theifab.com/law-changes/latest/
- IFAB offside law: https://theifab.com/laws/latest/offside/
- IFAB fouls and misconduct: https://theifab.com/laws/latest/fouls-and-misconduct/
- IFAB penalty: https://theifab.com/laws/latest/the-penalty-kick/
