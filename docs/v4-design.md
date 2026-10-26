# BYLINE V4: design language and information architecture

Checkpoint: `pre-v4-experience` (the V3 build, all suites green).

## Identity: chalk and floodlight

BYLINE is football intelligence for the people who make and watch a broadcast. The visual identity comes from the match itself: chalk lines on night grass, floodlit stands, team sheets and the telestrator a pundit draws on. There are no cartoon agents, glass panels, decorative gradients or rows of identical cards.

### Colour (semantic, never decorative)

| Token | Hex | Meaning |
|---|---|---|
| `--night` | `#0B1214` | Base: floodlit night, a green-tinted black |
| `--stand` | `#121B1E` | Raised surface (a panel), used sparingly |
| `--terrace` | `#1A2629` | Interactive surface: a control at rest |
| `--chalk` | `#F2F0E8` | Primary text and pitch lines |
| `--chalk-2` | `#A9B4B3` | Secondary text |
| `--chalk-3` | `#6F7C7B` | Tertiary text and quiet metadata (decorative only, never the sole carrier of information) |
| `--flood` | `#F4B740` | Live now: an alert, the current selection, the ball's halo |
| `--measured` | `#4FD1C5` | Measured from data: tracking or events |
| `--hypo` | `#B7A4FF` | Hypothetical: What If? only, always dashed |
| `--against` | `#FF7A6B` | What went wrong: interception, card, corrected or withdrawn |
| team kits | from world | Identity only (crests, player discs, chips) |

Each colour means one thing everywhere. Lilac never appears outside a hypothetical layer.

### Type

There is one family, **Archivo** (a variable font with width and weight axes):

- **Body:** normal width, 400–500 weight.
- **Display, scores and broadcast plates:** condensed width (`wdth` 62–75) at 700–800, so it reads like a stadium board or lower-third.
- **Overlines and small labels:** sentence case, never all caps.
- **Numbers:** always tabular.

| Step | Size |
|---|---|
| Micro | 12 |
| Small | 13 |
| Body | 15 |
| Lead | 18 |
| Title | 22 |
| Display | 32 |
| Hero | 56 (condensed) |

Line length stays at or below 70 characters.

### Shape and space

- The spacing scale is 4/8/12/16/24/32/48.
- Radii follow hierarchy: controls 8, cards 12, sheets 20. Monitors and pitch frames use 4, like real broadcast monitors.
- Separation comes from space and a single hairline, not from boxes inside boxes. Only items that can be selected get a surface.

### Motion

- Motion answers an action: opening a moment, advancing a step, approving a graphic.
- One orchestrated reveal is allowed: the tactical stage reveals one layer per step.
- Under reduced motion there are no camera flights or autoplay, and steps change instantly.

## Information architecture: three products, one engine

| Role | Who | Primary job | Layout | The pitch |
|---|---|---|---|---|
| **Commentator** | Watching the real match in a booth | Glance, then research | Three columns: team sheets · Now · Research and stats | A small simulated feed thumbnail (the demo source), not the centre |
| **Studio** | Producer or analyst | Prepare, approve and air graphics; build analysis | Two workspaces: **Live production** (queue · programme/preview monitors · inspector) and **Analysis desk** (moments library · 3D tactical stage · breakdown composer) | Inside the programme monitor and the tactical stage |
| **Fan** | On the sofa with a phone | Enjoy the game more | One centred feed: match header, player spotlight, moment cards, What would you do?, Did you know? | None persistent; each moment brings its own animated picture |

### Commentator rules

- **Now** separates *discoveries* (alerts, verified stories, tactical insights, context) from *routine* events (throw-ins, fouls, corners), which go in a dense ticker.
- Each discovery is one sentence readable in 2–3 seconds, with detail on demand.
- Talking points are ranked by relevance to who is involved right now.
- Team sheets are always visible. One click on a player opens research, with no modal over the match.

### Studio safeguards

- AI suggestions never go to air without a human approval.
- A VAR review holds every goal graphic. A correction withdraws anything built on the voided evidence.
- The programme output is labelled **Demo output: no broadcast hardware or playout integration**.

### Fan rules

- Language is plain and personal ("your player", "you're on the ball").
- What would you do? offers only the real measured options, then shows what actually happened and how open each option was, with no outcome claims.
- Classic stays minimal: score, pitch, events. Analyst adds stats and the full tactical detail.

## Truthfulness, unchanged from V3

- Every number shown is measured or counted from the synthetic data.
- Hypotheticals are labelled and dashed, and never claim an outcome or a probability.
- AI text appears only when it comes from a real recorded Foundry run, labelled with its provenance.
