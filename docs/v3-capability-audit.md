# V3 capability audit (21 Oct 2026)

Checkpoint tag: `pre-v3-intelligence`, the stable, submission-ready R2 build with all suites green.

## What the data can genuinely support

| Source | What exists | Limits |
|---|---|---|
| Event log (2,582 events in the golden match) | 1,398 completed passes (start, end, receiver, height, kind, under pressure), 308 failed passes (intended receiver, outcome), 284 interceptions, 246 carries, 79 pressure events, 26 tackles, 10 fouls (type, severity, `stopped_promising_attack`, `denied_goal_scoring_opportunity`, advantage), 4 substitutions, shots, saves, cards, VAR, offside, penalty | Synthetic, so the patterns reflect the generator. There is no event for an off-ball run, a dribble attempt or a duel won or lost. |
| Tracking (2 Hz, 41 entities including both benches and the referee) | Every on-pitch player's position every 0.5 s, plus the ball's x, y and height | Positions are player centres (no body parts or facing direction), so it cannot judge marginal offside. Players away from the ball follow the formation-anchored realism model. |
| Knowledge base (`world/knowledge.py`) | 10 seasons of league tables, careers, 22 derby meetings, discipline, connections, referee records, about 245 derived facts | No match-by-match fixture list: no streaks, no record margins, no upcoming fixtures, and no manager tenure or records |

## Tactics: reusable, to extend, infeasible

| Tactic | Status | How (deterministic) |
|---|---|---|
| Repeated channel attacks and opponents' response | Reusable (D1 + storylines); extend the response measure | Opponents' lateral shift and line height after the pattern, from tracking |
| Fast transitions after a regain | Reusable (D2) | |
| Overlapping runs | Reusable (D3) | |
| Line-breaking passes and central progression | **Build** | Pass start and end + opponents' lines computed from the tracking frame at the pass |
| Numerical overloads (3v1, 4v2) | **Build** | Attackers vs defenders within a radius of the ball in the final third, from tracking |
| Dangerous passing options stopped by a foul | **Build** | The foul event + the carrier's passing options at the moment of the foul (lanes and space from tracking) |
| Defenders beaten on the carry | **Build** | Carry start and end against opponents goal-side at the start and behind at the end |
| Pressing, high turnovers, PPDA-style intensity | **Build** | Pressure, tackle and interception events in the opponent half, and opponent passes per defensive action |
| Compactness and gaps between lines | **Build** | Team length, width and gap between lines per frame window |
| Substitution and measurable shape change | **Build** | Average shape before and after each substitution (10-minute windows) |
| Runs that create passing options | **Build** | At a pass, team-mates whose space and lane opened over the previous 2 s |
| Passing options ("What If?") | **Build (signature)** | Lanes, interception risk, receiver space, progression, offside check: geometry only |
| Expected goals, pass success probabilities, simulated futures | **Infeasible / unsafe** | No calibrated model; we will not show invented probabilities or continue the play |
| Player or manager intent | **Never asserted** | Interpretations only describe what the measurements show |

## Knowledge and context

- **Reusable:** careers, appearances, goals, cards, milestones, derby history and referee records.
- **Extend:** a match-by-match fixture list (competitions, dates, venues, results) for 10 seasons, computed streaks, record margins ("biggest defeat since …"), upcoming fixtures, manager tenure and records, and a history-provider interface. Facts are computed from records under defined rules, never from the model's memory.

## Product

- **Reusable:** storylines, the evidence replay, the theatre, the studio queue, the research drawer, audience variants, VAR corrections.
- **Build:** a prioritised signal engine (quiet / insight / alert; deduplicated, suppressed, versioned, corrected, routed per audience), a fan companion layout, What If? overlays, progressive replay animation, and a more visible ball.

## Cost

No new model calls without approval. The ledger is at 53/53. Everything above is deterministic. The estimate for one new verified scenario is in `docs/v3-ai-estimate.md`.

## Findings after implementation

- **Numerical overloads are rare in this synthetic data:** one genuine 3v1 in the golden match at a 12 m radius. The detector reports that one rather than loosening the definition.
- **Pressing intensity is measurable and varies:** for example, Northbridge reduce Riverton to 6.6 passes per defensive action at 20', against 15.8 earlier.
- **Line spacing responds plausibly to events:** Riverton's back-to-midfield gap reaches 26 m at 75', after their red card.
- **No defensive lateral response clears its 3 m threshold** in the three fixtures. It is reported as absent, and the threshold is unchanged.
- **The signature What If? (7') is internally consistent:** the player the event log records as intercepting the pass is one of the two opponents the geometry measures in the passing lane.
