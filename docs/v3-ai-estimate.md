# V3: inference audit and estimate for one new verified scenario (no calls made)

## Where the budget stands

| | |
|---|---|
| Hard ledger | 53/53 used. No call can be made until you raise `BYLINE_MODEL_CALL_CAP` |
| Real model calls to date | 63 in total, of which 32 were in the approved Option A run on 21 Oct (about US$0.036) |
| Recorded and served at zero cost | 4 verified insights (with Spanish for 3), 6 storyline reads, 1 full-time recap |
| V3 work | **No model calls.** All tactics, What If?, signals and history are deterministic geometry and records |

## What one new verified scenario would add

The candidate is the signature 7' moment: "Haddad-Rhys was open as Lindqvist's pass was cut out." Today it is explained entirely from measurements, with no AI wording. A Foundry-verified version would let the agents write the commentator, studio and fan text, checked against the same numbers.

| Step | Calls | Tokens (est.) | Notes |
|---|---|---|---|
| Investigation of the tactical moment with the V3 four-call pipeline (prefetched evidence, independent verifier, deterministic rule check) | 4 | about 12,000 | The case brief and authoritative metrics come from the moment's measurements (lanes, space, bypassed opponents) |
| Spanish translation of the verified text | 1 | about 750 | Optional |
| Safety margin (one revision) | up to 3 | about 6,000 | Only used if the verifier asks for a revision |
| **Maximum** | **8** | **about 19,000** | **About US$0.01** at gpt-4.1-mini list price (US$0.40 / US$1.60 per million input / output tokens) |

Required change: a small adapter to open an agent case from a tactical moment instead of a detector candidate. The rule check would gain the moment's numbers as allowed values. This is about half a day of work and can be tested offline with the existing mock.

Not proposed: model calls for routine signals, storyline reads per version (already recorded) or fan text (deterministic templates are safer and free).

Model inference stays asynchronous. A slower investigation never blocks the match, the signals or the What If? view.
