# BYLINE Quality Assurance, Football Laws Test Matrix and Evaluation Protocol

**Test objective:** Judges must see actual functionality. A polished screen alone does not pass. Synthetic input, calculated state, agent evidence, decision logic and interface must be independently repeatable and truthful.

## 1. Testing pyramid and commands

- Pure domain unit tests: event validation, pitch direction, clock, state reducer, rules and each detector; fast, no model calls.
- Integration: replay dataset -> API -> state/pattern/insight store, multi-agent adapters with **test-only mocked** Foundry SDK clients, retractions, caching/rate limits.
- Genuine Foundry contract tests: opt-in test marker, run using **approved active credit and credentials**, record real status/latency/cost tokens, never in default CI.
- Browser smoke using Playwright (preferred) or equivalent: seek/play, formation, facts, Used, evidence, modes, overlay approve and VAR correction. Screenshots at desktop/tablet/mobile, accessibility check.
- Production remote smoke: new browser session, mobile, cold start/reconnect, public accessible demo and safety.
- `make verify`: backend unit/integration, frontend typecheck/build, schema tests, lint and deterministic golden journey. Failure -> task not done.
- `make evaluation`: deterministic gold detectors + schema/claim assertions, report JSON and Markdown with actual calculated metrics.

## 2. Fixture invariants, unit tests

| Test ID | Input | Expected result |
|---|---|---|
| EVT-01 | Duplicate event same ID/seq replayed | Exactly-once reducer semantics; no double goal/card |
| EVT-02 | Later event arrives before prior seq | Buffered/backfilled or rejected with clear recovery; no corrupt state |
| EVT-03 | Halftime switches attack direction | Channel metrics normalised to attacking direction |
| EVT-04 | First/second-half match time and added time | Correct period state and e.g. `45+2'` formatting |
| EVT-05 | Sub off then event attempted by same player | Invalid event rejected from match generator/state |
| EVT-06 | Sent off then pass attributed to player | Validation fails and player removed from active formation |
| EVT-07 | Seek backwards after goal and card | State rebuilt correctly; cards/goals not duplicated |
| EVT-08 | Browser SSE disconnect/reconnect | Recovers with cursor/event backfill without stale misleading state |
| EVT-09 | Match restarts after confirmed goal | Kickoff to conceding team according to simulation setup |
| EVT-10 | Source replay altered intentionally | Golden version/checksum drift surfaced as fixture change |
| EVT-11 | VAR reversal append-only | Authoritative final score correct; provisional event retains audit history |
| EVT-12 | Invalid coordinates / unknown player | Schema or domain check rejects with structured error |

## 3. Fouls, cards, offside, penalty, free kicks, referee logic

Use IFAB 2026/27 official source as authority. This matrix is simplified test intent; double-check exact rule phrasing while implementing. Record law reference in each rule explanation; don't adjudicate arbitrary video manually.

| Test ID | Scenario | Expected behavior |
|---|---|---|
| LAW-01 | Careless direct-free-kick foul outside penalty area | Direct free kick awarded; no automatic yellow |
| LAW-02 | Reckless challenge | Yellow sanction per official decision, direct free kick or penalty as appropriate |
| LAW-03 | Serious foul play/excessive force | Straight-red decision supported; player off; team down to 10 |
| LAW-04 | Second caution to same active player | Second-yellow + dismissal, roster changes, no extra events from player |
| LAW-05 | Holding foul denies obvious chance in penalty area | Penalty and red if official DOGSO decision and no attempt to play ball; not blanket 'any foul yellow' |
| LAW-06 | Penalty area DOGSO attempting to play ball | Nuanced reduced sanction if conditions met per IFAB; preserve official result |
| LAW-07 | Advantage after foul leads to continuation | Play continues, disciplinary follow-up handled, no invented second restart |
| LAW-08 | Offside position at pass but does not interfere | No offside offence; later onside play legal when appropriate |
| LAW-09 | Onside/level with second-last opponent | No offside for level position |
| LAW-10 | Direct reception from a throw-in | No offside offence even if advanced position |
| LAW-11 | Direct reception from goal kick | No offside offence |
| LAW-12 | Direct reception from corner kick | No offside offence |
| LAW-13 | Offside active involvement after teammate passes | Offence confirmed and INDIRECT free kick |
| LAW-14 | Opponent deliberate play vs incidental deflection | Different offside context and authoritative decision preserved |
| LAW-15 | Offside ruled after goal | Goal provisional/disallowed, scoreboard corrected and dependent insights retracted |
| LAW-16 | Direct free kick enters opponent goal untouched | Valid goal if correctly awarded taken |
| LAW-17 | Indirect free kick enters opponent goal untouched | No direct goal; correct opposing restart (goal kick) |
| LAW-18 | DFK-eligible defender offence in own penalty area | Penalty awarded by ground-truth referee event |
| LAW-19 | Ordinary foul outside penalty area | Do NOT award penalty |
| LAW-20 | Penalty kick scored/saved/missed | Correct score/rebound state, kicker id and game continuation |
| LAW-21 | Kicker deliberately touches ball again before anyone else | Appropriate indirect free kick (or direct for handball) under relevant rules |
| LAW-22 | Accidental double touch at penalty entering goal | Retake under IFAB 2026/27 clarification |
| LAW-23 | Accidental double touch at penalty not entering goal | Indirect free kick under IFAB 2026/27 clarification |
| LAW-24 | Goalkeeper handles in designated legal area | Do not call handball simply because ball touched hands |
| LAW-25 | Goal kick/corner/throw-in caused by ball crossing appropriate boundary | Correct restart awarded by last touch |
| LAW-26 | VAR 'checking' status | No settled new final ruling until decision arrives |
| LAW-27 | VAR overturns previously suggested studio goal graphic | Retract graphic, invalidate dependent recap claim and audit previous preview |
| LAW-28 | Referee identified at kickoff and in decision history | Correct simulated official and metadata (not LLM fabricated) |
| LAW-29 | Penalty DOGSO law rule nuance explained to fan | Wording refers to tackle attempt or pull and reason; no incorrect blanket 'double jeopardy' |
| LAW-30 | Competitions may vary substitution/time-wasting rules | Versioned competition config, no assumptions presented as universal |

For ambiguous edge cases, defer to official IFAB source and store explicit officiating decision in synthetic fixture. Prefer truthful caveat over false authority.

## 4. Tactical detection gold / adversarial tests

| Test ID | Pattern | Positive setup | Negative/adversarial setup |
|---|---|---|---|
| DET-01 | Repeated-channel attack | >=4 progressive final-third entries in 3+ possessions in same channel | 4 passes but only one possession, not 4 distinct entries |
| DET-02 | Repeated-channel attack | Same flank trends over 10 minutes, source event IDs listed | One long diagonal pass with no repeated attacking pattern |
| DET-03 | Channel direction | Change ends at halftime; same tactical flank normalized | Incorrect world left/right after sides swap |
| DET-04 | Fast counterattack | Interception -> rapid progression -> shot with timestamps | Slow possession build-up followed by shot |
| DET-05 | Fast counterattack | Ball won in middle third to attacking third quickly | Possession changed but no progression/chance |
| DET-06 | Overlap | Fullback trajectory advances beyond winger in wide corridor and chance-linked pass | Two stationary players side by side near touchline |
| DET-07 | Overlap | Tracking evidence supports run, ball moved into exploited area | Only pass events, no positional frames, must NOT claim overlap |
| DET-08 | Pressure change | Documented pressure/recoveries increase with data | Merely more goals, no pressure samples; do not infer press |
| DET-09 | Ordinary seed | Low novelty, no quality pressure pattern | Should not invent three 'dramatic stories' |
| DET-10 | VAR retraction | Candidate linked to voided goal or event | No published story may remain verified if its key evidence invalidated |
| DET-11 | Same key repeatedly triggers | Event loop runs 50 frames beyond trigger | Exactly one surfaced candidate per cooldown/novelty key |
| DET-12 | Model tries unsupported conclusion | Agent claims a defender was dragged out without tracking | Deterministic/agent verification rejects or narrows claim |

### Detection metrics to report
Number of gold scenarios evaluated, `TP`, `FP`, `FN`, `TN` if applicable, precision and recall calculated only from actual labelled dataset; per-detector evidence coverage and no-data abstention. Dataset should include at least 3 positive + 3 negative examples per detector across seeds, wherever practical. No manufactured high accuracy scores.

## 5. AI and grounded narrative tests

- `AI-01`: Investigation case cites only match events that exist in event journal; non-existent E-ID is rejected.
- `AI-02`: Every number in displayed claim recalculates from evidence or seeded records; mismatch triggers revision/rejection.
- `AI-03`: Analyst says 'left-back was pulled away' without tracking; verifier marks unsupported, editor rephrases or suppresses.
- `AI-04`: Foundry timeout; match score/stream unaffected, user sees degraded status and deterministic factual explanation.
- `AI-05`: Repeated candidate and same language; cached, no duplicate model charge.
- `AI-06`: Model emits invalid JSON; validate, bounded retry once, fallback; no UI crash.
- `AI-07`: Verifier rejects two consecutive drafts; case ends rejected, no approved graphic.
- `AI-08`: User manually requests explanation; rate limit enforced, no unlimited public guest costs.
- `AI-09`: Second-language output preserves score, player numbers, cited law version, IDs and source facts.
- `AI-10`: English studio, commentator and fan outputs differ in content length and specificity but preserve objective facts.
- `AI-11`: No model token or endpoint values exposed to browser; output trace sanitised.
- `AI-12`: Foundry connection test actual and clearly distinguished from test mock; trace contains run ID and timed model call.
- `AI-13`: Simulated red, penalty, foul and offside explainers never contradict official event states; deterministic law references pinned.
- `AI-14`: No pre-cooked phrase keyed by hard-coded event ID passed as a Foundry-generated discovery.

## 6. UI and UX scenarios

- `UX-01`: New user can launch match with no account and discover an insight in <=2 gestures.
- `UX-02`: Visual at desktop 1440x900 looks broadcast-premium, central theatre dominates, optional contextual dock not cluttered.
- `UX-03`: Tablet formation shirt targets are usable with finger; no tiny badges pretending to be controls.
- `UX-04`: Phone 390x844 keeps match visible while drawer opens as bottom sheet, and has no horizontal scrollbar.
- `UX-05`: Fan Classic mode has no injected story popups overlaying the match.
- `UX-06`: Fan Discover shows brief explanations only when elected; Analyst shows deeper evidence.
- `UX-07`: Studio review, approve, reject, hide and retraction are real interactions.
- `UX-08`: Per-fact Mark Used hides it from main suggestions but doesn't hide player or all future facts; Undo works.
- `UX-09`: Changing replay speed, pause, seek, restart doesn't desync cards/score/timeline.
- `UX-10`: Fact card doesn't move underneath a reading commentator when new events arrive.
- `UX-11`: No dead links; buttons do their advertised action; keyboard and screen reader names exist.
- `UX-12`: Reduced motion setting respected, colour contrast at least WCAG AA for primary reading content.
- `UX-13`: No unlicensed badge, image, stock video, music, badge resemblance or borrowed project UI.
- `UX-14`: Confidence and provenance conveyed with text + evidence, not just a coloured dot.
- `UX-15`: Graceful states: loading, empty, offline, AI rate limit, late match, no insights available.

## 7. Release / deployment checks

1. Fresh clone builds with README and `.env.example`; no local-only dependencies or secret leaks.
2. Public repo belongs to entrant and licensing of any third-party code/assets is explicitly satisfied.
3. Azure model/deployment checked *with genuine trial credit active*, no PAYG upgrade. Owner approves cloud resources explicitly.
4. App works using a fresh external browser on PC and mobile without special Azure tenant sign-in.
5. Demo lasts through Nov 10 judging window, with budget guard avoiding unauthorised costs.
6. A completely clean demo visitor can select golden scenario, play/seek, inspect detected insight and evidence, change modes, see decision explainer and recap.
7. A test visitor cannot generate unlimited billable model calls.
8. Private logs don't expose account name/address, subscription numbers, keys or tokens.
9. Hosted endpoint and demo video are externally reachable, GitHub public; video is **under 120 seconds**.
10. Submission is submitted in the **Innovation Studio project page**. Screenshots of draft project creation are not proof of submitted status.

## 8. Evaluation report format

```
BYLINE EVALUATION REPORT | timestamp | app commit SHA | seed versions
OFFLINE RUN: scenarios N | events total N | event reducer failures N
DET-01: TP N / FP N / FN N ... (actual observations only)
REFEREE MATRIX: tests passed X/Y; discrepancies ...
AGENTS: provider [actual Foundry / test mock / disabled] | runs N | valid N | rejected N
  schema failures N | unsupported numerical claims N | retries N | time p50/p95 (measured)
COST: actual reported token usage and model/deployment names if available; estimate only if labelled
UI: viewports tested; failed flows; screenshot paths
DEPLOY: actual externally tested URL and uptime/cold-start observations
LIMITATIONS: ...
RELEASE STATUS: PASS/BLOCKED and reason
```

**Remember:** green tests do not mean competition victory. They mean the prototype can credibly withstand judges clicking through it.
