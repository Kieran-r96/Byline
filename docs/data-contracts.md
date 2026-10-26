# Data contracts and commercial-data readiness

**Status:** BYLINE runs on synthetic data only. Everything below the provider boundary (state, detectors, agents, insights, UI) consumes the internal contracts described here. **No commercial data integration exists in this prototype.** This document explains how licensed feeds would replace the synthetic inputs and what would have to be built.

## 1. The boundary

```
licensed event feed ─┐                          ┌─► MatchState (reducer, rules)
licensed tracking ───┼─► provider adapter ─► internal contracts ─┼─► detectors / storylines
licensed history  ───┘   (to be built)        (implemented)      ├─► agents (bounded tools)
synthetic generator ─────► SyntheticReplayAdapter (implemented) ─┘    └─► insights / overlays / UI
```

- Interface: `apps/api/byline/ingest/adapter.py`. It defines `MatchDataAdapter` (world, events, tracking) and an `IdRegistry` that maps provider IDs to internal IDs. `SyntheticReplayAdapter` is the only implementation.
- Downstream code never sees vendor field names. Replacing the source means writing one adapter, with no changes to detectors or agents.

## 2. Internal contracts (implemented)

| Contract | Where | Key fields |
|---|---|---|
| Fixture / match | `world/models.py` `Fixture` | `match_id`, competition, kickoff (local time and timezone), venue, home/away team IDs, `ruleset` (version `IFAB-2026/27` plus competition modifiers), `synthetic` flag |
| Teams, squads, managers | `Team`, `Player`, `Manager` | team ID, names, kit colours, formation, players (ID, shirt number, names, position, foot) |
| Officials | `Official` | ID, name, role (referee, assistants, fourth official, VAR, AVAR) |
| Line-ups | event `lineup.confirmed` | formation, 11 starters with slots, bench |
| Match events | `events/models.py` `MatchEvent` (JSON Schema `contracts/match-event.schema.json`) | `event_id` (immutable), `seq` (strict order), `elapsed_ms` (monotonic match timeline), `period`, `display_clock`, `team_id`, `player_id`, `type` (about 40 typed payloads), `source`, `truth_status` (`official_synthetic`, `observed_synthetic`, `derived`, `model_interpretation`), `correlation_id`, `supersedes_event_id` |
| Disciplinary and decisions | typed payloads | `foul.committed` (severity, restart, in-area, advantage, DOGSO/SPA, attempted-to-play), `card.*` (reason, linked foul), `restart.awarded` (type, team, location, reason event, law), `offside.*` (position vs offence, interference type, decision event), `penalty.*` |
| Corrections, VAR, retractions | `goal.provisional` → `var.review_started` → `var.review_outcome` → `goal.confirmed` / `goal.disallowed`; `disciplinary.reviewed` | Append-only: a correction is a new event that references the earlier one. The reducer rebuilds state; dependent stories and graphics are withdrawn as a new version with a reason. |
| Tracking | `tracking.json.gz` | `interval_ms` (500), entity order, frames `[t, ball x, y, z, (x, y) per entity…]`, `precision` note (player-centre; not suitable for marginal offside) |
| Historical facts | `world/knowledge.py` and `world/facts.py` `Fact` | `fact_id`, subject, type and category, text, `provenance` (`fictional_seeded` or `match_event_derived`), `source`, `as_of`, linked `event_source_ids`, relevance and reason |
| Insights | `stories/models.py` `Insight` (JSON Schema `contracts/insight.schema.json`) | status and version, canonical claim, evidence event IDs, metric provenance, verification, audience variants, translations, retraction reason |

Time model: `elapsed_ms` is the single monotonic timeline that orders everything, while `display_clock` (for example `45+2'`) is computed per period. Provider wall-clock timestamps would be kept as provenance alongside it and never used for ordering.

## 3. Mapping a licensed event feed (to be built)

| Concern | What a commercial adapter must do |
|---|---|
| IDs | Register every provider match, team, player and official ID in `IdRegistry`; keep the original IDs in event provenance for audit. |
| Event types | Map provider event and qualifier codes to `MatchEvent.type` and the typed payloads; drop or log unmapped types and never guess. |
| Coordinates | Convert the provider's pitch system (often 0–100 by 0–100, or centred metres) to 105 × 68 m, with x left to right on a canonical pitch; record attacking direction per period. |
| Ordering and late data | Assign `seq` in the adapter; out-of-order deliveries are buffered by `EventJournal` (implemented) and gaps are backfilled. |
| Revisions and deletions | Providers revise or delete events after the fact. Represent each as a new correction event (`supersedes_event_id`), never an in-place edit; the reducer and retraction logic already handle append-only corrections. |
| Official vs observed | Map referee decisions (cards, restarts, VAR outcomes) to `truth_status=official_*` and on-ball observations to `observed_*`. Agents can only cite, not create, official decisions. |
| Latency | Live feeds deliver within seconds. The pipeline is incremental per event already; model work is asynchronous and never blocks state. |

## 4. Mapping licensed tracking (to be built)

- Commercial optical tracking typically runs at 10–25 Hz with player IDs, sometimes with ball height. The adapter would resample to the internal frame layout, map IDs through `IdRegistry`, and align frames to `elapsed_ms` using the provider's match-clock synchronisation.
- Detectors that use tracking (overlap) read only bounded windows through the same interface. Agents get downsampled windows through a bounded tool.
- Body-part offside cannot be judged from player centres. Explanations keep the caveat that the official decision is authoritative.

## 5. Mapping historical facts (to be built)

- A licensed statistics or history service would populate the same structured layer as `knowledge.py`: season records, appearances, goals, cards, head-to-heads. Facts would still be **derived** from that structure, never typed by hand, with `provenance` set to the licensed source and an `as_of` date.
- Today every historical fact is fictional and labelled as such.

### 5.1 History provider boundary (implemented for synthetic data)

`apps/api/byline/world/history.py` defines `HistoryProvider`, the history counterpart of `MatchDataAdapter`. Records (`world/records.py`) and live context facts (`world/context.py`) read history only through it:

| Method | Returns |
|---|---|
| `today()` | ISO date of today's fixture |
| `fixtures(team_id)` | completed `ClubMatch` records before today, oldest first: date, season, `Competition` (league or cup), stage, venue and stadium, opponent (and `opponent_id` for a derby), score, derby scorers |
| `upcoming(team_id, n)` | the next fixtures after today |
| `season_table(team_id)` | completed league `SeasonRecord`s |
| `career(player_id)` | season-by-season appearances, goals, cards |
| `head_to_head(team_id, opponent_id)` | derbies from `team_id`'s side |
| `manager(team_id)` | `ManagerTenure` (appointed season, start date, previous club) |
| `stadium()`, `all_time_head_to_head()` | venue facts and all-time derby totals |

`SyntheticHistoryProvider` is the only implementation. Its match-by-match history is seeded and generated to agree exactly with `knowledge.py`: each completed season's league W/D/L and goals equal the `SeasonRecord`, every derby is one of the recorded meetings (date and score), the current season's nine league results are the published form line, and each cup run ends in the recorded round. A few authored constraints (listed in `AUTHORED_CONSTRAINTS`) only decide *where* results fall in the calendar, never the totals. A licensed statistics provider would implement the same protocol and map its ids through `IdRegistry`. Records stay computed by explicit rules (streak, first-since, biggest-since, milestones), never typed by hand, and `provenance` would name the licensed source in place of `fictional_seeded`.

## 6. What is not claimed

- There is no live league connection, no broadcast integration, and no licensed or real player, club or brand data.
- Adapter code for any commercial provider has not been written or tested.
- Production use would also need data licences, rights clearance for any likenesses, latency and SLA engineering, and monitoring.
