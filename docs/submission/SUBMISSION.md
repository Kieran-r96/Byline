# Submission text (paste-ready)

## Title

BYLINE: Match Intelligence

## Short description

BYLINE turns a live synthetic football match into verified match intelligence. Three Microsoft Foundry agents, orchestrated with Microsoft Agent Framework, investigate, explain and independently check each tactical moment, and a deterministic validator can send claims back for revision. Verified findings then reach commentators as ready-to-say facts, producers as approval-gated broadcast graphics, and fans as an interactive "what would you do?".

## Detailed description

**The problem.** During a live match, commentators, producers and fans all ask the same question: what is the story behind what just happened? Raw data rarely answers it in time, and AI-written explanations cannot be trusted on air unless every claim can be checked.

**What BYLINE does.** BYLINE replays a football-realistic synthetic match event by event: about 2,600 events plus 2 Hz player and ball tracking, with fictional clubs.

1. **Detection.** Deterministic detectors measure every pass and position and flag moments that matter. For example, at 7' the intended pass was cut out (an opponent 0.3 m from the lane) while a teammate's lane was clear by 3.3 m.
2. **Investigation and verification.** Microsoft Agent Framework orchestrates three specialised agents on a GPT-4.1-mini deployment in Microsoft Foundry:
   - the **Investigator** gathers events and tracking measurements through bounded read-only tools;
   - the **Analyst** writes the explanation;
   - the **Verifier** independently checks every claim against the evidence.
3. **Validation.** A final deterministic validation layer checks references, numbers and football constraints. It can return claims to the Analyst for revision before anything is published. The featured 7' insight is a genuine recorded example: the Verifier approved draft 1, the validator flagged a name, the Analyst revised, and draft 2 passed.
4. **Three experiences from one verified finding:**
   - **Commentator Command:** tap a shirt and the player file leads with the one fact worth saying now. Pin it, mark it used, or open quick tools for stats, records and decisions.
   - **Studio:** BYLINE proposes a broadcast graphic filled only from verified data, with every field traced to its source. A producer previews it as a lower third, corner box or full screen and takes it to air on a simulated programme monitor. Nothing airs without a human, and VAR holds and corrections withdraw graphics automatically.
   - **Fan:** a guided 3D tactical replay with clearly labelled hypotheticals, and "What would you do?" on the real frozen frame.

**Trust by design.**
- Every AI result carries its trace: agents, drafts, tokens, latency and the Foundry response ID of every call. You can inspect it in the app under **How it was checked**.
- Hypotheticals are labelled, never predictions.
- The public demo is cache-only. It replays recorded outputs of genuine Foundry runs and makes no new model calls, so judging costs nothing and cannot drift.

**Where it could go.** The same engine could be integrated with licensed Opta event and historical data, professional player and ball tracking, synchronised match footage and broadcasters' existing graphics and visualisation systems. This is a future integration opportunity; none of these connections exists today.

## Microsoft technologies used

- **Microsoft Foundry:** GPT-4.1-mini model deployment (Entra ID authentication) used for all agent runs.
- **Microsoft Agent Framework (Python):** a `WorkflowBuilder` graph with Investigator → Analyst → Verifier → deterministic validator, a conditional revision edge, function tools and metering middleware.
- **Azure Container Apps:** hosts the public demo in a single Consumption container, HTTPS-only and cache-only, with no credentials in the image.
- **GitHub and GitHub Actions:** public source and CI covering lint, type checks, unit tests, secret scans, a container smoke test, Playwright end-to-end and accessibility tests. The image is published to GitHub Container Registry.

## Categories (suggested)

- Best Multi-Agent System
- Best Use of Microsoft Foundry
- Also eligible for the overall prize

## Links

| Field | Value |
|---|---|
| Live demo | https://ca-byline-demo.yellowstone-acde35ac.eastus.azurecontainerapps.io |
| Repository | https://github.com/Kieran-r96/Byline |
| Video | _your YouTube or Vimeo URL_ |
| Judge walkthrough | https://github.com/Kieran-r96/Byline/blob/main/docs/submission/JUDGE_WALKTHROUGH.md |

## Testing instructions (for the form)

No sign-in is needed. Open the live demo in desktop Chrome or Edge.

1. Drag the timeline to about 6:30 to see the 7' verified insight.
2. Press **Show the play**, then **Next** to step through the replay. Press **How it was checked** to inspect the genuine recorded Foundry multi-agent run: each agent, draft number, tokens, latency and Foundry response ID.
3. Switch to **Studio** and press **Take to air now**.
4. Switch to **Fan → Discover** and answer **What would you do?**

The full guide is in `docs/submission/JUDGE_WALKTHROUGH.md`.

All data and clubs are synthetic. The demo replays recorded outputs of genuine Foundry runs and makes no new model calls. The demo stays available until judging ends on 10 November 2026.
