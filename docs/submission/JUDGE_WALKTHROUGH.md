# Judge walkthrough

**Live demo:** https://ca-byline-demo.yellowstone-acde35ac.eastus.azurecontainerapps.io

No sign-in is needed. It works best in desktop Chrome or Edge at 1440 px wide or more.

**Before you start:**
- All clubs, players and match data are synthetic. The studio "programme" output is simulated.
- The AI results you see are **recorded outputs of genuine Microsoft Foundry runs**. The public demo is cache-only and makes no new model calls.

## 1. See a verified insight arrive (30 s)

1. The app opens on **Commentator**, match BYLINE-01 (Northbridge v Riverton).
2. Drag the timeline at the bottom to about **6:30**, or press Play at 4×.
3. The 7' insight appears: *"S. Haddad-Rhys was open as M. Lindqvist's pass was cut out"*. It carries an amber **Verified by Foundry agents** line.

## 2. Check the evidence (45 s)

1. On that insight, press **Show the play**. A 3D replay of the real frozen frame opens.
2. Press **Next** to step through the guided replay:
   - *Their lines*;
   - *What happened*: the pass was cut out, with an opponent 0.3 m from the intended lane;
   - *Measured options*: Haddad-Rhys's lane was clear by 3.3 m;
   - *What if?*: labelled **Hypothetical, not what happened**.
3. The right-hand panel lists every measured value, and what the data cannot show.

## 3. Inspect the genuine multi-agent run (60 s)

In the same replay, press **How it was checked**. This is the recorded Microsoft Agent Framework run:

| Step | What the record shows |
|---|---|
| Investigator (Foundry agent) | Gathered the events and tracking measurements with 3 read-only tool calls |
| Analyst (Foundry agent) | Wrote draft 1 |
| Verifier (Foundry agent) | Independently checked each claim against the evidence: **approved** |
| Deterministic validator (no model) | Flagged one name, "M. Lindqvist's", as not a player in this moment, and **returned the claim for revision** |
| Analyst, draft 2 → Verifier → validator | Revised, approved again, passed. Published as verified |

- **Totals:** 6 genuine model calls (5 agent calls plus 1 translation), 17,312 input / 2,730 output tokens, 29.2 s, recorded 22 Oct 2026, 02:06 UTC.
- **Per-call detail:** each call shows its agent, draft number, latency, tokens and its **Foundry response ID** (`chatcmpl-…`).

The validator's flag was an over-strict wording rule, not a factual error. It is shown as it happened.

**Inspect the raw record:**
- **API:** https://ca-byline-demo.yellowstone-acde35ac.eastus.azurecontainerapps.io/api/matches/BYLINE-01/tactics/T-option-NBA-0180/insight returns the insight together with its full trace.
- **Source:**
  - recording: `apps/api/recorded/tactics/00cf4191cdb7dd4c6910563c.json`;
  - workflow graph: `apps/api/byline/agents/orchestrator.py`, built with `WorkflowBuilder`, with a conditional revise edge back to the Analyst;
  - deterministic checks: `apps/api/byline/agents/validator.py`;
  - provenance notes: `docs/ai-provenance.md`.
- **System status:** `/api/system/status` shows `"state": "recorded"`, `"cache_only": true` and `calls_used: 0`.

Press **← Back to match**. The clock returns to where you were.

## 4. Commentator Command (30 s)

1. Tap the **Vantreight** shirt, about 30:00 into the match. The player file leads with the one fact worth saying now.
2. Press **Pin** or **Mark used**: the next fact moves up.
3. Try the quick tools above the match (Players, Match stats, Records, Decisions).

## 5. Studio (60 s)

1. Switch to **Studio** at about 7:00. Open *Better option on · 7'* from the rundown.
2. Try **Lower third**, **Corner box** and **Full-screen analysis** in the preview.
3. Press **Take to air now**. The graphic appears on the simulated programme monitor. Every field is traced to its source in the table below it.
4. **Pre-match, half-time and full-time packages.** Drag the timeline to about **47:00**, then open the **Analysis desk** tab and choose **Half-time**.
   - Pick measured moments from the library and press **Add to package**.
   - Reorder the running order and set each item's format.
   - Press **Send package to production**.
   - The items arrive in the Live production rundown in running order, and the producer still approves each one before it airs.
   - **Pre-match** and **Full-time** work the same way.

## 6. Fan (20 s)

Switch to **Fan → Discover** at about 7:00, then answer **What would you do?** on the frozen frame and see what really happened.

## Known limits

- **Data:** synthetic data only. No Opta, tracking, broadcast video or graphics-system integration exists yet; that is future work.
- **Agents:** they run in BYLINE's Python backend via Microsoft Agent Framework, not in Foundry Agent Service, and all three use the same gpt-4.1-mini deployment.
- **AI-text language:** an AI-text language setting (English or Spanish) applies to the recorded verified insights. The rest of the interface is English.
