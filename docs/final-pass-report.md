# BYLINE final quality, experience and security pass (24–25 Oct 2026)

Checkpoint before this pass: git tag `pre-final-pass`. No paid model calls; the ledger is still 59. No Azure changes and no deployment.

## 1. Commentator
- **Now area.** One compact focal moment card.
  - A goal leads with the scorer and keeps its confirmation state, so a provisional goal still reads "awaiting confirmation" (unit test).
  - **Developing** shows verified Foundry stories, measured tactics and patterns, each story once, with no empty states.
  - **Worth saying** is a list of rows. Every point has **Pin**, **Mark used** and **Detail**, where Detail shows the server's scope or date line.
- **Player file** (opens from a shirt).
  - The top three facts come first, with Pin to top and Mark used.
  - Tabs:
    - **Today:** figures plus match involvement, meaning the official events and measured tactical moments the player features in, each with Show the play.
    - **Season:** this season's figures and totals.
    - **Career:** season by season.
    - **Milestones.**
- **Club file** (opens from either crest in the score bug or the line-up).
  - At the top: the form chips, the league line and the top facts.
  - Tabs:
    - **Overview:** manager record, streaks and this season.
    - **Records:** honours, biggest results and league seasons.
    - **Rivalry:** the itemised derby record, last meetings and derby scorers.
    - **Fixtures.**
- **Notifications.** While a file is open, important moments arrive as a brief note bottom-left with one action. Notes never take focus and leave after 8 s.
- **Pre-match.** A fixture line (competition, matchday, stadium and referee from the match dossier) and three pre-match talking points.
- **Bug fixed.** Playback controls are now sent to the server in order. Under load, a "play" could overtake "Back to match", leaving the match playing from the wrong place (unit test).
- **E2E test of the timed task.** A new user opens a player, finds a fact, marks it used and is back on the match in under 8 s, and the match never stops.

## 2. Studio
- Every graphic previews in four template-defined formats: lower third, upper-right corner box, player spotlight and full-screen analysis.
- Builds are richer for goals, substitutions, milestones, tactical change and player spotlights.
- Take and take-off use a timed mix or wipe, with a reduced-motion fallback.
- The programme monitor reads as a future live feed and stays labelled simulated. The signal path shows "Picture in · Graphics · Programme out: Not connected".
- A tactical corner box loops the guided clip.
- The package builder (pre-match, half-time, full-time) has a running order you can reorder from the keyboard, plus preview and queue actions.
- Human approval, VAR holds and correction withdrawals are unchanged and tested.
- Screenshots: `docs/screenshots/final-pass/studio/`.

## 3. Tactical replay and What If?
- **Camera and labels.** Framing is tighter and camera moves are slower and eased. At most four names show per step, and labels move clear of the plates and never overlap them.
- **Takeaway.** The final step is one plain sentence.
- **Steps.** The featured 7' moment now has 8 steps, including **Then?** and **The ball in**.
  - These two steps show an *illustrative* continuation: Vantreight's supporting run, Tremaine closing, Ndiaye-Shaw tracking, and the ball in.
  - The continuation ends in a contested delivery ("could block it", "could get there first"), not a goal.
  - It is computed from the frozen frame with published kinematics (ADR 10) and labelled "Illustrative · not what happened · no outcome implied".
  - Real, measured-hypothetical and illustrative layers never share a step, and there are no probabilities (tested).
- **Small sizes.** The clip is legible at 320×180 for the Studio corner box.
- **Verified run intact.** The recorded Foundry verification for `T-option-NBA-0180` still serves as verified, with its key unchanged.
- Screenshots: `docs/screenshots/final-pass/stage/`.

## 4. Fan
- **Crests are the team picker**, then a compact side switch. Arrow keys flip the perspective, and your player is remembered per side.
- **Player choice** is a one-line pick.
- **"Compare the teams"** shows only measured numbers, on demand.
- **Mode purposes are stated in the switcher:**
  - Classic follows the match only.
  - Discover is moments-first, with one focal moment, folded routine runs and rationed facts.
  - Analyst puts measurements first.
- **Before kick-off** there is a matchup card instead of an empty feed.

## 5. Football intelligence validation (the corner bug)
- **Root cause.** The data feed records a restart as "restart taken", followed by the taker's first ball action stamped as `open_play` or `cross`. The detectors trusted that stamp, so they measured these restarts as open play:
  - a corner (golden 33');
  - two throw-ins (golden 78'; ordinary 64');
  - a goal kick (discipline 22').
- **Fix.** It is in the detection layer: `byline/events/phase.py` classifies each event as open play, a restart type or dead ball. Open-play detectors read only open-play actions, and the tracking frame must be within 500 ms of the event. A regression sweep covers every moment in every scenario.
- **Also fixed:**
  - Every emitted historical claim is verified against the raw fictional records.
  - "Most recent" derby goals are listed newest first.
  - Official corrections reach every signal they contradict.
  - The match log names which team a corner, throw-in or penalty is awarded to.
  - The dossier scope reads "released so far", not an internal parameter name.
- **Not finished (cut by the usage limit).** An explicit four-category field (actual event, measured, supported interpretation, hypothetical) on every API output. Today the categories are carried by kind, provenance and UI labels.

## 6. Security and submission audit
- Full detail is in `docs/security-audit.md` and `docs/compliance-checklist.md`.
- **Fixed:**
  - Rate limits can no longer be dodged by spoofing `X-Forwarded-For`.
  - A strict CSP and security headers are on every response.
  - Request bodies are capped at 16 KiB (413 above that).
  - Unknown `/api` paths return a JSON 404.
  - The image defaults to the public cache-only demo with call cap 0 and no API docs.
  - The secret scan now covers full history and the build output.
  - Licence notices ship with the app.
- **Evidence:**
  - 24 security tests, including proofs that no model client is created across whole matches and 360 anonymous requests.
  - The secret scan found 0 findings (tracked files, all history, the bundle).
  - pip-audit and npm audit found 0 vulnerabilities.
  - A fresh-browser-session E2E test makes same-origin requests only and logs no console errors.
- **Open:**
  - M3 Medium: uncached replays cost CPU. Mitigated by one replica, the Free Trial spending limit and the per-IP limit.
  - The Docker image has not been built here, because Docker is not installed.

## 7. Verification (master after all merges)
| Check | Result |
|---|---|
| Backend: ruff, mypy strict, pytest | Clean, clean, 333 passed |
| Web: typecheck, lint, vitest, build | Clean, clean, 158 passed, built |
| Playwright E2E (cache-only API) | 33 tests: 31 passed in the full run; the 2 Fan failures were a stale spec, now fixed and passing (Fan 6/6, Studio and keyboard 12/12, Commentator 24/24 over two repeats) |
| axe, 13 states × 3 viewports | 0 serious/critical; the last moderate issue was fixed (research and evidence scenes re-audited clean) |
| Secret scan | 0 findings |
| Real model calls in this pass | 0 |

## Known limitations
- **3D background shirts.** On the 3D stage, background players' shirts don't darken; the SVG fallback is correct.
- **Crowded labels.** Labels are tight on the "ball in" step when two ghost shirts meet.
- **Pin can vanish after a seek.** A talking point pinned in the first second after a seek can drop out when the server ranking replaces the instant local list.
