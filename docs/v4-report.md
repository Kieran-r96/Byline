# BYLINE V4: product experience report (22 Oct 2026)

Checkpoint before V4: git tag `pre-v4-experience` (the V3 build, all suites green). The design language and information architecture are in `docs/v4-design.md`.

## 1. Three products on one engine

All three roles share one deterministic engine: the event log, tracking, 12 tactical detectors, signals and the knowledge base. The difference is the job each one does and the layout built for that job.

| | Commentator | Studio | Fan |
|---|---|---|---|
| **Who** | Watching the real match from a commentary position | Producer or analyst in a gallery | On the sofa with a phone |
| **Job** | Glance, then say something worth saying | Prepare, approve and air graphics; build analysis | Enjoy the game more |
| **Layout** | Three columns: team sheets, Now, research | Two workspaces: Live production and Analysis desk | One centred feed with a scoreboard and a match pulse |
| **The pitch** | A small simulated-feed thumbnail (the demo's data source), never the centre | Inside the programme monitor and the 3D tactical stage | None persistent; each moment brings its own picture |
| **Signature interaction** | The lead updates the moment something happens; one click opens the guided 3D explanation | A goal arrives held or for review, the producer previews it, then takes it now, at the next stoppage or in 30 s | "What would you do?" on the real frozen frame, then what actually happened and how open each option measured |

### Commentator
- **Lead:** the newest official event while it is fresh (goal, card, substitution, VAR), otherwise the newest discovery. It is one large headline and one sentence. Before kick-off it shows the derby context, a one-line statement of what BYLINE does, **Start the match** and **Jump to the first AI-verified story**.
- **Key events strip:** official events only, with VAR corrections struck through in place.
- **Developing:** measured tactical moments and storylines (labelled "Tactical · measured" and "Pattern · Building / Story / Over"), plus AI-verified stories labelled **Deep analysis · verified by Foundry agents**.
- **Talking points:** ranked by the server using the full event history and the knowledge base. Each says why it matters now ("Vantreight had a shot at 28' (goal) in the last 3 minutes") and where it comes from, with Mark used and Research.
- **Match log:** routine events only (shots, saves, corners, throw-ins, fouls, offsides, cards, substitutions), kept apart from discoveries.
- **Team sheets:** always visible, both teams one click apart. Players are grouped by line with goals, cards and substitutions marked, then the bench and the manager.
- **Research:**
  - Search covers any player, club, manager, "derby" or "referee".
  - Live stats: shots, on target, saves, corners, fouls, throw-ins, offsides, cards, substitutions, passes, pass accuracy and share of passes.
  - **Player dossier:** profile, today's numbers, season, career table, milestones, derby goals, injuries and connections.
  - **Club dossier:** manager record, form, current streaks with the record in the history, season, records, honours and next fixtures.
  - **Head to head and venue dossiers.**
  - Every block states its scope, and everything is labelled fictional.
- **Below 1100 px** the surface becomes a switcher (Now, Team sheets, Research) with Now first.

### Studio
- **Live production:**
  - **Queue** in lanes: On air, Scheduled, Held by VAR, For review, Withdrawn after a correction, then history.
  - **Monitors:** a preview monitor and a programme monitor carrying the label "Demo output: simulated programme feed. No broadcast hardware or playout is connected."
  - **Inspector:** fact check by source, air status, source events and rule, the verified Foundry read for tactical graphics, and the actions **Take to air now**, **At the next stoppage**, **In 30 seconds**, **Reject** and **Take off air**.
  - **Safeguards:** a producer approves every graphic. A VAR check holds goal graphics and cannot be overridden, and a correction withdraws anything built on the voided evidence.
- **Seven graphic formats:** score flash, substitution board, record plate, stats panel, decision panel, telestration plate and story lower third.
- **Analysis desk:**
  - Pre-match, half-time and full-time packages.
  - A library of measured moments, filterable by kind.
  - The 3D stage for the selected moment.
  - Measured talking points to tick.
  - A table of what happened against the measured hypothetical alternatives.
  - **Send to production:** proposes the graphic. Only what has already happened can be proposed, a producer still approves it, and nothing is duplicated.

### Fan
- **Scoreboard:** one large scoreboard in every fan mode.
- **"Who are you with today?":** pick a team, then **Your player** with today's numbers from the player dossier.
- **Filters:** Everything, Big moments, How it happened, Did you know? and your player.
- **Feed:** goal cards in kit colour, one-line cards for cards and substitutions, typographic **Did you know?** cards with the record's number, AI-verified pattern stories, and **What would you do?**:
  - The real frozen frame appears with the real pass hidden. The fan picks Haddad-Rhys, Rennard or Vantreight.
  - The reveal says what happened, gives each option's measured lane and space in plain words, then shows the verified Foundry read and the honest line "Nobody can know what would have happened next".
  - The answer is remembered on this device only.
- **Classic** stays minimal: scoreboard, pitch and big events. **Analyst** adds more stats and the precise wording.

## 2. The tactical replay (Three.js)

`apps/web/src/components/Stage/`, built for BYLINE:
- **Five guided steps:** the decision, their lines, the measured options, What if? and the takeaway. Each reveals one layer, and the camera moves between steps.
- **Controls:** pause, play, previous, next, Replay the real play (real tracking), and speeds 0.5x, 1x and 1.5x.
- **Captions** use only the moment's measured numbers. Tests check that every printed number exists in the view and that no outcome, probability or "%" appears.
- **The ball:** a truncated-icosahedron shader (12 black pentagons, 20 white hexagons) with an outline, contact shadow and halo. The 2D feed ball now has a pentagon pattern too.
- **Visual language:**
  - Defensive lines are translucent curtains, and the offside line is dashed chalk.
  - Attacking-direction chevrons are drawn on the grass.
  - Lane opponents are ringed coral and the actual pass ends at an interception marker.
  - Measured lanes are teal; the hypothetical is lilac and dashed, with a travelling ghost ball.
- **It never moves the live match:** it draws the frozen frame from the moment view and fetches tracking itself.
- **Performance:** 60 fps on an integrated GPU (average frame 16.7 ms) and nothing renders while the picture is still. three.js is loaded only when the stage opens.
- **Reduced motion:** steps cut instantly, with no autoplay and no ghost-ball travel.
- **No WebGL:** an accessible SVG version with the same steps is shown instead.

## 3. Foundry: measured results

Your approval covered at most 8 GPT-4.1-mini calls and US$1. Billing was checked first: Free Trial subscription, spending limit on.

| | |
|---|---|
| Moment | `T-option-NBA-0180`, 7': Lindqvist's pass to Vantreight cut out by Ndiaye-Shaw while Haddad-Rhys was open |
| Pipeline | Microsoft Agent Framework: investigator, analyst, independent verifier, then a deterministic rule check (only measured numbers, only players in the moment, no outcome, probability or intent claims, hypotheticals framed as options) |
| Calls | **6 of 8**: investigator, analyst, verifier, one analyst + verifier revision, Spanish |
| Tokens | 17,312 in / 2,730 out |
| Latency | 29.2 s in total |
| Cost | **about US$0.0113** at list price |
| Result | **Verified**: every claim supported, rule check passed |
| Ledger | 53 before, 59 after (cap 61 for this run only) |

The verified commentator line reads: "Lindqvist's pass was cut out, but Haddad-Rhys was open with plenty of space ahead."

The revision was caused by our own rule check rejecting "M. Lindqvist's" as an unknown name. That was a false positive, now fixed narrowly with a regression test.

The run is recorded and served from cache. It appears in the Commentator's lead and Developing feed, the analysis layer, the studio inspector and the fan reveal, always labelled as deep analysis and always separate from the measurements.

Details are in `docs/ai-provenance.md` §6 and the per-call log `docs/evidence/v4-tactical-calls.jsonl`.

## 4. Tests and checks

See PROGRESS.md for the final numbers of this build. The suites are:
- **Backend:** pytest, ruff and mypy strict.
- **Web unit:** vitest.
- **Browser E2E:** Playwright against the real stack, with specs per role plus keyboard, no-look-ahead and smoke.
- **Accessibility:** axe over 13 scenes at desktop, laptop and phone.

Screenshots:
- `docs/screenshots/v4/final/`: 28 shots at 1920, 1440, 1280, 1024 and 390 wide.
- `docs/screenshots/v4/stage/`: 11 shots of the stage.

## 5. Remaining limitations

- **Synthetic data shapes what can be shown.** Overloads are rare and the defensive-shift detector never fires; both are reported as they are. Possession is approximate (time between events).
- **One verified tactical read.** Only the 7' moment has a Foundry read; other moments are explained from measurements only. Raising coverage needs your approval for more calls.
- **Agent latency is still about 30 s per case.** It runs asynchronously and never blocks the match.
- **Stage framing at narrow widths.** In the stage at 390 px, one line label can sit under the title plate on the line-break step. In WebGL choose mode the pass-to buttons sit over the players.
- **Fictional player text uses "his".** Some seeded fact sentences use "his", a style inherited from the V2 knowledge base.
- **Tactics replay windows are capped at 12 s.**

## 6. Deployment and submission readiness

- **Ready now:** the full product in cache-only mode at £0: recorded real Foundry runs, no live model calls, and every check in §4.
- **Your decisions still needed:**
  1. A GitHub remote. CI is written. The packed git history is about 136 MB, mostly old PNG screenshots; a fresh squashed history before making the repository public would bring it down to the current tree.
  2. Approval for the cloud deployment (`docs/deployment-plan.md`).
  3. Recording the under-two-minute film. The suggested path: the Commentator pre-match; "Jump to the first AI-verified story"; the 7' moment in 3D; the studio taking the goal to air; and the fan's What would you do?
