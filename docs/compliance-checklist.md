# Compliance checklist: Microsoft "Inside the Game" hackathon official rules

Source: `OFFICIAL RULES.md` in github.com/microsoft/insidethegamehackathon, fetched 2026-10-24 (the repository has no README; the rules file is the authority). Quotes are short excerpts. Status: **PASS** = evidence in this repository; **FAIL** = not met today; **NEEDS VERIFICATION** = depends on an owner action or on something outside the repository. Security evidence: `docs/security-audit.md`. This document cross-checks `docs/submission-checklist.md`.

| # | Rule (section) | Status | Evidence | Owner action |
|---|---|---|---|---|
| 1 | Submission period ends **27 Oct 2026, 11:59 pm PT** (§1) | NEEDS VERIFICATION | Deadline = 28 Oct 07:59 UK time (`docs/submission-checklist.md`) | Submit before the deadline and keep the confirmation |
| 2 | Registered entrant, age of majority, team ≤ 4, not an excluded person (§3) | NEEDS VERIFICATION | Outside the repository | Confirm registration (registration closed 20 Oct, 12:00 pm PT) and eligibility |
| 3 | "Projects must be newly created … after the start of the Hackathon Registration Period" (§4.3) | PASS (owner to confirm) | First commit 2026-10-20 (`git log`); registration opened 29 Sep | Confirm no pre-existing code was reused |
| 4 | Responds to the challenge (synthetic football events → explainable match intelligence, narratives, personalised experiences) and fits at least one category (§4.1, §4.2) | PASS | Five-stage pipeline, verified insights, Commentator/Studio/Fan views (`README.md`, `PROGRESS.md`) | Choose the category or categories in the form (e.g. Best Multi-Agent System, Best Use of Microsoft Foundry) |
| 5 | "Projects must use synthetic, football-realistic data" (§4.7) | PASS | Seeded generator, fictional clubs (`docs/licensing-and-data.md`) | none |
| 6 | Text description: "elevator pitch … what you built, which Microsoft and Azure technologies used", what it does, the problem it solves (§4.4) | NEEDS VERIFICATION | Material in `README.md` and `docs/demo-script.md` | Write the pitch in the submission form; name Microsoft Foundry (gpt-4.1-mini, Entra auth) and Microsoft Agent Framework |
| 7 | Demo video "less than two (2) minutes", showing the project working on its platform (§4.4) | NEEDS VERIFICATION | Script: `docs/demo-script.md` | Record it and check the length is under 2:00 |
| 8 | Video at a public URL on YouTube, Vimeo, Facebook Video or Youku; no unlicensed third-party trademarks or music (§4.4) | NEEDS VERIFICATION | App has no third-party marks or music (`docs/security-audit.md` §11) | Upload publicly, add no music unless you hold rights, and link it in the form |
| 9 | "Your repository must be public for your entry to be considered" (§4.4) | FAIL (today) | No GitHub remote yet | Squash the history (use a GitHub `noreply` author email; finding L6), push to a **public** repository, and link it. Run `python tools/secret_scan.py --history` on the squashed repository first. |
| 10 | Working demo or test build link; free and unrestricted for testing until judging ends (10 Nov 2026); credentials if private (§4.8) | NEEDS VERIFICATION | The image is a public, read-only, cache-only demo needing no login (fresh-session E2E passed); `docs/deployment-plan.md` | Approve and deploy, keep it up until 10 Nov 23:59 PT, put the URL and testing instructions in the form, and run the post-deploy checks in `docs/security-audit.md` |
| 11 | Materials in English (§4.9) | PASS | UI, docs and demo script in English (Spanish is an optional toggle) | Keep the video narration and pitch in English |
| 12 | Original work, solely owned; third-party SDKs, APIs and data used under their terms; open-source licences complied with (§4.3, §4.6, §4.11) | PASS | Dependency licences all permissive; notices ship at `/third-party-notices.txt`; original assets (`apps/web/THIRD_PARTY.md`) | Choose a project LICENSE before publishing (not required by the rules) |
| 13 | Prohibited content: no offensive, defamatory or illegal content, and nothing promoting alcohol, drugs, tobacco or politics (§4.4) | PASS | Fictional sport content only; validator blocks betting, real leagues and providers | none |
| 14 | No financial or preferential support from Microsoft for this project (§4.12) | NEEDS VERIFICATION | Free Trial credit only (`PROGRESS.md`) | Confirm that a standard Azure free trial is not "preferential support" (it is generally available) |
| 15 | Must not have won another contest; multiple entries must differ substantially (§4.4, §4.5) | NEEDS VERIFICATION | n/a | Confirm |
| 16 | Stage One pass/fail: fits the theme and "required technologies" (§6.1) | PASS | Real Microsoft Foundry calls (recorded traces, ledger 59) and Microsoft Agent Framework workflow (`docs/ai-provenance.md`) | Make the hero technologies visible in the video and pitch |
| 17 | Hosted demo must not incur uncontrolled cost or expose secrets (good practice, not a rule) | PASS (local evidence) | Cache-only, cap 0, no credentials in the image; 0 secrets in tree, history and bundle | Post-deploy checks in `docs/security-audit.md` |

**Counts:** PASS 8 (#3, 4, 5, 11, 12, 13, 16, 17), FAIL 1 (#9), NEEDS VERIFICATION 8 (#1, 2, 6, 7, 8, 10, 14, 15).

## Cross-check with `docs/submission-checklist.md`

That file is out of date in two places: it still lists Gate E UI and the a11y/responsive pass as unchecked, but both are complete (axe 0 violations in 39 scenes; E2E 26-27/27). Its owner items match rows 7-10 above. One addition: confirm the project licence (row 12).
