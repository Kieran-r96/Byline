# BYLINE: Match Intelligence

**Football intelligence you can trust, written for whoever is watching.**

BYLINE follows a live football match event by event, detects the moments and tactical patterns that matter, has a team of AI agents investigate and verify the evidence, and turns the result into three different experiences: research for the **commentator**, approval-gated graphics for the **studio producer**, and an explainable second screen for the **fan**.

> **Synthetic data, fictional clubs.** Northbridge Athletic, Riverton City, their players, officials, stadiums and histories are invented. BYLINE is not connected to the Premier League, any broadcaster or any real data feed, and uses no real footage, crests or brands. The studio "programme" output is simulated; no broadcast hardware is connected.

Built for Microsoft's *Inside the Game: Premier League Developer Hackathon* (2026).

**Live demo:** https://ca-byline-demo.yellowstone-acde35ac.eastus.azurecontainerapps.io (judging release, no sign-in) · **Video (under 2 minutes):** _link added at submission_ · **[Judge walkthrough](docs/submission/JUDGE_WALKTHROUGH.md)**

![Commentator at 7 minutes: one live insight, verified by Foundry agents](docs/screenshots/release/cm-7m-desk.png)

## Try BYLINE in 60 seconds

Open the [live demo](https://ca-byline-demo.yellowstone-acde35ac.eastus.azurecontainerapps.io). It starts on the **Commentator** view of the golden match (BYLINE-01).

1. **0–15 s.** Drag the timeline to about **6:30**. The live insight reads *"S. Haddad-Rhys was open as M. Lindqvist's pass was cut out"*, with an amber **Verified by Foundry agents** line.
2. **15–30 s.** Press **Show the play**. Step through the guided replay with **Next**: what happened, the measured options, the labelled *What if?*. Open **How it was checked** to see the recorded agent run (calls, tokens, latency). Press **← Back to match**; the clock returns to exactly where you were.
3. **30–40 s.** Tap the **Vantreight** shirt. The player file leads with the one fact worth saying; press **Mark used**.
4. **40–50 s.** Switch to **Studio**. Preview the *Tactical breakthrough*, try a format (lower third, corner box, spotlight, full screen) and press **Take to air now**: the graphic stays on the simulated programme monitor until **Take off air**.
5. **50–60 s.** Switch to **Fan**, pick **Northbridge** by its crest, choose a player, and answer **What would you do?** on the real frozen frame.

## The problem

Live football produces thousands of events a match. Broadcasters and fans get raw numbers; what they need is to know **which moments matter and why**, with claims they can trust on air. Generic AI summaries are fast but unverifiable. BYLINE treats every published claim as something that must be traced back to match evidence.

## What makes it different

- **An evolving understanding of the match:** stories move from *watching* to *building* to *confirmed* as evidence accumulates, and are withdrawn when an official correction (VAR) changes the record.
- **Evidence-backed explanations:** every insight cites real event IDs; a deterministic validator blocks unsupported names, numbers, outcomes and betting language.
- **Tactical visualisation:** a guided 3D replay (Three.js, with an SVG fallback) shows what happened, what was measured, and, clearly labelled, what else was on.
- **Hypotheticals with limits:** *What If?* alternatives and an illustrative continuation are computed from the frozen tracking frame, labelled "not what happened", with no probabilities and no implied outcome.
- **Human in the loop:** nothing airs in the studio without a producer's approval; VAR holds and corrections withdraw graphics automatically.

## Three experiences, one engine

| Commentator | Studio | Fan |
|---|---|---|
| One live insight, developing stories, talking points with *Mark used* and *Pin*, the line-up as shirts, player and club files that lead with the one fact worth saying, quick tools (players, clubs, tactics, stats, records, fixtures, managers, decisions, search). | Live production rundown, preview and simulated programme monitors, four graphic formats (lower third, corner box, spotlight, full screen), template-driven broadcaster styles with per-field data provenance, VAR holds, take on/off air, pre-match/half-time/full-time packages. | Classic (just the match), Discover (moments explained) and Analyst (measurements first); pick a side by crest, follow a player, compare the teams, and play *What would you do?* on the real frozen frame. |

| | |
|---|---|
| ![Player file](docs/screenshots/release/cm-player-desk.png) | ![Studio corner-box tactical graphic on the simulated programme monitor](docs/screenshots/final-pass/studio/programme-tactical-pip-on-air-1440.jpg) |
| ![Guided tactical replay, illustrative continuation](docs/screenshots/final-pass/stage/0180-step7-fan-1440.jpg) | ![Fan: What would you do?](docs/screenshots/release/fan-7m-desk.png) |

## Architecture

```mermaid
flowchart LR
  A[Synthetic match source<br/>events + 2 Hz tracking] --> B[Match event engine<br/>event-sourced reducer, IFAB rules]
  B --> C[Tactical detectors<br/>& match statistics]
  C --> I
  subgraph AF[Microsoft Agent Framework workflow · Foundry gpt-4.1-mini]
    I[Investigator<br/>bounded read-only tools] --> AN[Analyst]
    AN --> V[Verifier<br/>re-checks the evidence]
    V --> DV{Deterministic validator<br/>event ids, numbers, names, no outcomes}
    DV -- issues: one revision --> AN
  end
  DV -- approved --> F[Verified intelligence<br/>stories, tactical reads, recap]
  DV -- rejected twice --> X[Labelled factual summary<br/>nothing unverified is published]
  F --> G1[Commentator]
  F --> G2[Studio · human approval to air]
  F --> G3[Fan]
  B -. official corrections (VAR) withdraw stories and graphics .-> F
```

- **Ingest.** A seeded simulator produces three full 96-minute matches (about 2,600 events each plus tracking). Sessions stream them over server-sent events at 1–60x; seeking rebuilds state from the log, so replays are deterministic.
- **Interpret.** A strict event-sourced reducer enforces the laws of the game (provisional goals during VAR checks, no actions by dismissed players). Detectors find repeated-channel attacks, fast counters, overlaps, line-breaking passes, high turnovers and better passing options from events and tracking; restarts are never measured as open play.
- **Explain.** See the multi-agent workflow below; there is also a law-grounded "Why that decision?" explainer for official decisions.
- **Render and personalise.** One verified claim is written for each audience (commentator, studio, fan), with an optional Spanish variant.

Details: [architecture decisions](docs/architecture-decisions.md) · [API contract](docs/api-contract.md) · [evaluation](docs/evaluation/report.md) · [intelligence audit](docs/final-pass-report.md).

## How BYLINE uses Microsoft Foundry and multi-agent AI

BYLINE uses Microsoft Agent Framework to orchestrate three specialised AI agents powered by a GPT-4.1-mini model deployment in Microsoft Foundry.

The **Investigator** gathers and structures relevant match events, tracking measurements and contextual evidence. The **Analyst** transforms this evidence into a tactical explanation. The **Verifier** independently evaluates the explanation against the source data.

A conditional workflow allows claims to be revised when verification identifies problems. A separate deterministic validation layer checks evidence references, calculations and football-specific constraints before an insight can be published.

The hackathon demonstration uses recorded outputs from genuine Microsoft Foundry inference runs, with traceable response IDs, agent handoffs and verification decisions. The publicly accessible application operates in cache-only mode to control spending, while preserving the original agent execution records for inspection.

Agents execute within BYLINE's Python backend using Microsoft Agent Framework. They are not hosted in Foundry Agent Service.

**A real revision, on the record.** The featured 7th-minute moment is a genuine recorded run (`apps/api/recorded/tactics/00cf4191cdb7dd4c6910563c.json`): Investigator → Analyst → Verifier (approved) → deterministic validator, which flagged one name in the draft (it read the possessive "M. Lindqvist's" as an unknown player; a check we have since made exact). The workflow sent the draft **back to the Analyst for a revision**, and the revised draft passed a second Verifier and validator round. All 6 model calls carry their Foundry response IDs, token counts and latency, and the live demo serves that trace with the insight (`/api/matches/BYLINE-01/tactics/T-option-NBA-0180/insight`).

Where to look: `apps/api/byline/agents/orchestrator.py` (the `WorkflowBuilder` graph and the three executors), `agents/tools.py` (bounded read-only tools), `agents/validator.py` (deterministic checks), `apps/api/recorded/` (the recorded runs with per-step response IDs, tokens and latency), `docs/ai-provenance.md`.

**Recorded, not live.** In the demo, every AI result is a stored record of a real run, shown with its trace ("Real Foundry run"). Cache misses fall back to clearly labelled deterministic summaries; they never trigger a model call. A persistent hard cap blocks calls even if cache-only were switched off.

## Microsoft and Azure technology used

| Technology | How BYLINE uses it |
|---|---|
| Microsoft Foundry | GPT-4.1-mini model deployment used for the agent runs (Entra ID authentication) |
| Microsoft Agent Framework (Python) | `WorkflowBuilder` graph, `Agent`s with function tools and middleware metering |
| Azure Container Apps | Hosts the public demo: one Consumption-plan container, HTTPS, cache-only, no credentials ([deployment record](docs/submission/DEPLOYMENT.md)) |
| GitHub Actions | CI on every code change: tests, type checks, lint, secret scans, container build and HTTP smoke test, browser E2E and accessibility; a manual workflow publishes the image to GitHub Container Registry |

## Run it

**Container (what the public demo runs):**

```bash
docker build -t byline .
docker run -p 8000:8000 byline     # http://localhost:8000, cache-only, no credentials needed
```

**Development:** Python 3.12 and Node 22. Use two terminals.

macOS or Linux:

```bash
# terminal 1: API (cache-only, recorded runs, no credentials)
cd apps/api && python3 -m venv .venv && .venv/bin/pip install -e ".[dev]" -r requirements-ai.txt
BYLINE_AI_PROVIDER=foundry BYLINE_AI_CACHE_ONLY=true .venv/bin/python -m uvicorn byline.api.app:app --port 8000
# terminal 2: web app on http://localhost:5173
cd apps/web && npm ci && npm run dev
```

Windows (PowerShell):

```powershell
# terminal 1: API
cd apps\api; py -3.12 -m venv .venv; .venv\Scripts\pip install -e ".[dev]" -r requirements-ai.txt
$env:BYLINE_AI_PROVIDER="foundry"; $env:BYLINE_AI_CACHE_ONLY="true"; .venv\Scripts\python -m uvicorn byline.api.app:app --port 8000
# terminal 2: web app on http://localhost:5173
cd apps\web; npm ci; npm run dev
```

## Tests and CI

`pytest` (backend, including security and no-model-call proofs), `ruff` and strict `mypy`; `vitest`, `tsc` and ESLint (web); Playwright browser E2E; an axe accessibility audit over 13 states at three viewports; secret scans of the tree, the full history and the built bundle. CI never calls a model, never deploys and needs no secrets ([.github/workflows/ci.yml](.github/workflows/ci.yml)).

## Security model

Read-only public demo: visitors get their own ephemeral replay session and cannot change match data, recorded AI evidence or configuration. Strict Content-Security-Policy and security headers, request-size limits, rate limits that ignore spoofed forwarding headers, no API docs in production, a non-root container. See [security audit](docs/security-audit.md).

## The vision: from synthetic football to live broadcast intelligence

BYLINE was developed rapidly as a working proof of concept for the Microsoft Inside the Game hackathon, using entirely synthetic match events, player tracking and fictional football histories.

The real opportunity lies in connecting the same intelligence engine to the professional data and production infrastructure already available to broadcasters and football organisations.

Imagine BYLINE integrated with **Opta's rich event and historical data, licensed player and ball tracking, live match video, and the broadcast graphics and visualisation tools already used across elite football.**

Rather than simply presenting statistics, BYLINE could continuously investigate the match as it unfolds: identifying emerging tactical patterns, understanding why key moments occurred, checking historical significance and delivering evidence-backed insights tailored to different audiences.

For commentators, that could mean immediate, contextual research and meaningful talking points. For production teams, it could mean automatically prepared tactical overlays, passing-lane visualisations, player movements and alternative scenarios, ready for a producer to review and take to air. For fans, it could mean a personalised, interactive understanding of the football they're watching.

**The ambition is not to build another football statistics platform. It is to turn existing football data into intelligence that can be explained, visualised and used in real time.**

The current prototype demonstrates this approach using synthetic data and a simulated broadcast environment. Integrating real-world feeds, licensed video and professional broadcast systems would require commercial partnerships, data rights and further engineering, but the underlying investigation, verification and storytelling workflows are already demonstrated in BYLINE.

## Known limitations

- Synthetic data only; a licensed live data feed would replace the simulator.
- Events and 2 Hz player and ball tracking come from the simulator. BYLINE does not detect events from video and uses no computer vision.
- The demo shows recorded Foundry runs, not live inference.
- Studio programme output is simulated; there is no broadcast integration.
- Tactical hypotheticals are geometric sketches from a frozen frame, not predictions.

## Licence and attribution

No licence has been chosen yet: until one is added, the source is visible but no rights to reuse it are granted. Third-party components keep their own licences; see [THIRD_PARTY.md](apps/web/THIRD_PARTY.md) and [licensing and data](docs/licensing-and-data.md). Fonts: Instrument Sans, Archivo, Manrope and Barlow Condensed (SIL Open Font License).
