# P1 movement realism audit

Measured by `python -m byline.tools.movement_audit <scenario>` on the shipped tracking files. The UI renders these files and the detectors read them, so what is shown is what is analysed. Invariants are enforced by `apps/api/tests/test_movement.py` (all three matches); the browser demonstration is `apps/web/e2e/movement.spec.ts` and `docs/screenshots/p1-movement-trails.jpg`.

## Findings (before)

| Measure (golden match) | Before | Real-football reference |
|---|---|---|
| Outfield distance per match (median) | **16.4 km** | ~10–11 km |
| Outfield median speed | **3.2 m/s** | ~1.8–2.0 m/s |
| Max share of match standing still (outfield) | **33%** (striker frozen for spells of 434 s, 381 s and 656 s) | small |
| Ball jumps > 40 m/s | **18** (ball appeared on restart spots) | 0 |
| Acting player vs event coordinates | 0.81 m median | — |

Root causes:
1. The stage-1 engine moved off-ball players "sprint to formation target, then stop".
2. When a cross failed, the intended target's movement pin was never cleared, so a striker stood in the box for minutes.
3. Restarts placed the ball instantly.
4. The second-half kick-off frame still showed the ball where the first half ended.

## Fix: deterministic stage-2 realism pass (`apps/api/byline/simulation/realism.py`)

- **Evidence preserved exactly.** A player engaged in play stays untouched: that means within 8 s of any event naming them as actor, receiver, victim, opponent, goalkeeper or substitute. Event logs are byte-identical (same SHA-256). Every detector candidate across all three matches is identical, including IDs, evidence, metrics and frame intervals. The recorded real Foundry overlap insight ("36.5 m in 5.5 s…") still matches the displayed tracking exactly (tested).
- **Off-ball model.**
  - Each disengaged player follows a slot anchor in the team shape, shifted with the ball and possession.
  - The block is compressed out of possession, and the nearest defender presses the ball.
  - Movement is velocity-smoothed with jog and run limits.
  - Each path is computed forwards and backwards and cross-faded, so it leaves and rejoins the untouched windows continuously, and never across half-time.
- **Ball.** It is carried to restart spots during stoppages (arriving before the restart event) and sits on the centre spot before each kick-off.

## After

| Measure | Golden | Discipline & VAR | Ordinary | Invariant |
|---|---|---|---|---|
| Outfield km per match (median) | 10.6 | 12.1 | 11.6 | 8–13 |
| Outfield median speed | 1.72 m/s | 1.81 m/s | 1.80 m/s | 1.2–2.5 |
| Outfield max speed | 9.85 m/s | 10.05 m/s | 9.65 m/s | ≤ 10.5 (elite top speed) |
| Max share standing still (outfield) | 7.4% | 8.5% | 6.4% | < 15% |
| Ball jumps > 40 m/s | 0 | 0 | 0 | 0 |
| Acting player vs event coordinates | 0.81 m | 0.80 m | 0.89 m | median < 1.5, p95 < 3.5 |
| Team width in / out of possession (golden) | 55 m / 43 m | | | out < in − 6 m |
| Goalkeepers in their own third | > 97% of frames | | | > 97% |

Related UI correctness fix found during the demonstration: a provisional goal awaiting on-field confirmation (e.g. 28') was labelled "VAR CHECK". Now only an official open VAR review shows VAR CHECK; otherwise the score bug shows "CONFIRMING".

Known limits:
- Tracking is synthetic player-centre data at 2 Hz. Player orientation and body shape are not modelled.
- Off-ball movement is a team-shape model, not individual tactical intelligence such as marking assignments or decoy runs.
