import { z } from 'zod'

/**
 * Zod schemas for the live backend contract (docs/api-contract.md v0.2).
 * Objects are "loose": unknown extra fields are kept so the backend can add
 * fields without breaking the UI, but every field the UI reads is validated.
 */

const Point = z.looseObject({ x_m: z.number(), y_m: z.number() })
export type PitchPoint = z.infer<typeof Point>

// ---------------------------------------------------------------- events

export const MatchEventSchema = z.looseObject({
  event_id: z.string().min(1),
  seq: z.number().int().nonnegative(),
  elapsed_ms: z.number().nonnegative(),
  period: z.string(),
  display_clock: z.string(),
  team_id: z.string().nullable(),
  player_id: z.string().nullable(),
  type: z.string().min(1),
  truth_status: z.string().optional(),
  payload: z.record(z.string(), z.unknown()),
  supersedes_event_id: z.string().nullable().optional(),
})
export type MatchEvent = z.infer<typeof MatchEventSchema>

export const EventsPageSchema = z.looseObject({
  events: z.array(MatchEventSchema),
  last_seq: z.number().int(),
})

/** Read an optional {x_m, y_m} from an event payload without trusting it. */
export function payloadPoint(ev: MatchEvent, key: string): PitchPoint | null {
  const parsed = Point.safeParse(ev.payload[key])
  return parsed.success ? parsed.data : null
}

export function payloadString(ev: MatchEvent, key: string): string | null {
  const v = ev.payload[key]
  return typeof v === 'string' ? v : null
}

// ---------------------------------------------------------------- state

const ScoreMap = z.record(z.string(), z.number().int().nonnegative())

export const GoalSchema = z.looseObject({
  goal_event_id: z.string(),
  team_id: z.string(),
  scorer_id: z.string().nullable(),
  minute: z.string(),
  status: z.enum(['provisional', 'confirmed', 'disallowed']),
})

export const CardSchema = z.looseObject({
  card_event_id: z.string(),
  team_id: z.string(),
  player_id: z.string().nullable(),
  colour: z.enum(['yellow', 'second_yellow', 'red']),
  minute: z.string(),
  reason: z.string().nullable().optional(),
})

const TeamStateSchema = z.looseObject({
  formation: z.string(),
  on_pitch: z.record(z.string(), z.string()),
  bench: z.array(z.string()),
  used_subs: z.number().int(),
  off: z.array(z.string()),
  sent_off: z.array(z.string()),
})

export const VarReviewSchema = z.looseObject({
  subject_event_id: z.string(),
  check_type: z.string(),
  reason: z.string(),
})

export const MatchStateSchema = z.looseObject({
  seq: z.number().int(),
  elapsed_ms: z.number(),
  period: z.string(),
  phase: z.string(),
  play_state: z.string(),
  clock: z.string(),
  minute: z.string(),
  score: ScoreMap,
  provisional_score: ScoreMap,
  goals: z.array(GoalSchema),
  cards: z.array(CardSchema),
  possession_team: z.string().nullable(),
  attacking_direction: z.record(z.string(), z.enum(['+x', '-x'])),
  teams: z.record(z.string(), TeamStateSchema),
  var_review: VarReviewSchema.nullable(),
  stats: z.record(z.string(), z.record(z.string(), z.number())).optional(),
  playhead_ms: z.number().optional(),
  finished: z.boolean().optional(),
})
export type MatchState = z.infer<typeof MatchStateSchema>

// ---------------------------------------------------------------- transport

export const HeartbeatSchema = z.looseObject({
  playhead_ms: z.number().nonnegative(),
  speed: z.number().positive(),
  playing: z.boolean(),
  cursor: z.number().int().nonnegative(),
  duration_ms: z.number().positive(),
  server_time: z.number().optional(),
})
export type Heartbeat = z.infer<typeof HeartbeatSchema>

export const ReplayResetSchema = z.looseObject({
  playhead_ms: z.number().nonnegative(),
  cursor: z.number().int().nonnegative(),
  last_seq: z.number().int(),
})
export type ReplayReset = z.infer<typeof ReplayResetSchema>

export const SessionSchema = z.looseObject({
  session_id: z.string().min(1),
  match_id: z.string(),
  speed: z.number(),
  duration_ms: z.number().positive(),
})
export type SessionInfo = z.infer<typeof SessionSchema>

// ---------------------------------------------------------------- intelligence

const MetricValue = z.union([z.number(), z.string(), z.boolean(), z.null()])
export const MetricsSchema = z.record(z.string(), MetricValue)
export type Metrics = z.infer<typeof MetricsSchema>

export const PatternCandidateSchema = z.looseObject({
  candidate_id: z.string().min(1),
  pattern_type: z.string().min(1),
  team_id: z.string().nullable(),
  detected_at_ms: z.number().nonnegative(),
  display_clock: z.string(),
  evidence_event_ids: z.array(z.string()),
  calculated_metrics: MetricsSchema,
  factual_summary: z.string(),
  confidence_band: z.string(),
  unsupported_claims: z.array(z.string()).default([]),
  score: z.number().optional(),
  window_start_ms: z.number().optional(),
  window_end_ms: z.number().optional(),
  frame_intervals: z.array(z.looseObject({ start_ms: z.number(), end_ms: z.number() })).default([]),
  status: z.string().optional(),
  retraction_reason: z.string().nullable().optional(),
})
export type PatternCandidate = z.infer<typeof PatternCandidateSchema>

export const VerificationSchema = z.looseObject({
  verdict: z.string(),
  issues: z.array(z.string()),
  checker_name: z.string(),
  agent_run_id: z.string().nullable().optional(),
})

export const InsightSchema = z.looseObject({
  insight_id: z.string(),
  candidate_id: z.string(),
  status: z.string(),
  insight_type: z.string(),
  title: z.string(),
  canonical_claim: z.string(),
  why_it_matters: z.string(),
  uncertainty: z.string().nullable().optional(),
  certainty: z.string(),
  evidence_event_ids: z.array(z.string()),
  metric_provenance: MetricsSchema,
  verification: VerificationSchema,
  version: z.number().int().optional(),
  retraction_reason: z.string().nullable().optional(),
  audience_variants: z
    .looseObject({
      commentator: z.string().optional(),
      fan_discover: z.string().optional(),
      fan_analyst: z.string().optional(),
      studio: z.looseObject({ headline: z.string(), subtitle: z.string() }).optional(),
      translations: z.record(z.string(), z.string()).optional(),
    })
    .optional(),
})
export type Insight = z.infer<typeof InsightSchema>

export const TraceSummarySchema = z.looseObject({
  case_id: z.string().optional(),
  provider: z.string().nullable().optional(),
  model_deployment: z.string().nullable().optional(),
  agents: z.array(z.string()).default([]),
  model_calls: z.number().default(0),
  tokens: z.number().default(0),
  latency_ms: z.number().nullable().optional(),
  outcome: z.string().nullable().optional(),
  cache_hit: z.boolean().optional(),
})
export type TraceSummary = z.infer<typeof TraceSummarySchema>

export const InsightUpdateSchema = z.looseObject({
  candidate_id: z.string().min(1),
  pattern_type: z.string(),
  team_id: z.string().nullable(),
  detected_at_ms: z.number(),
  display_clock: z.string(),
  stage: z.string().min(1),
  provider: z.string().nullable().optional(),
  from_cache: z.boolean().optional(),
  insight: InsightSchema.nullable(),
  trace_summary: TraceSummarySchema.nullable().optional(),
})
export type InsightUpdate = z.infer<typeof InsightUpdateSchema>

export const EvidenceSchema = z.looseObject({
  candidate: PatternCandidateSchema,
  events: z.array(MatchEventSchema),
  insight: InsightSchema.nullable(),
})
export type Evidence = z.infer<typeof EvidenceSchema>

const ToolCallSchema = z.looseObject({
  name: z.string(),
  arguments: z.record(z.string(), z.unknown()).default({}),
  result_preview: z.string().optional(),
  latency_ms: z.number().optional(),
})

const AgentStepSchema = z.looseObject({
  agent: z.string(),
  attempt: z.number().optional(),
  started_at: z.number().optional(),
  response_ids: z.array(z.string()).default([]),
  tool_calls: z.array(ToolCallSchema).default([]),
  output: z.record(z.string(), z.unknown()).nullable().optional(),
  latency_ms: z.number(),
  model_calls: z.number().default(0),
  input_tokens: z.number().default(0),
  output_tokens: z.number().default(0),
  error: z.string().nullable().optional(),
  handoff_to: z.string().nullable().optional(),
})

export const AgentTraceSchema = z.looseObject({
  case_id: z.string(),
  provider: z.string(),
  model_deployment: z.string().nullable(),
  orchestration: z.string().optional(),
  stages: z.array(z.string()).default([]),
  steps: z.array(AgentStepSchema).default([]),
  outcome: z.string().nullable().optional(),
  total_latency_ms: z.number().default(0),
  total_model_calls: z.number().default(0),
  total_tokens: z.number().default(0),
  cache_hit: z.boolean().optional(),
})
export type AgentTrace = z.infer<typeof AgentTraceSchema>

// ---------------------------------------------------------------- match detail

export const PlayerSchema = z.looseObject({
  player_id: z.string(),
  team_id: z.string(),
  shirt_number: z.number().int(),
  given_name: z.string(),
  family_name: z.string(),
  position: z.string(),
})
export type Player = z.infer<typeof PlayerSchema>

const HexColour = z.string().regex(/^#[0-9a-fA-F]{6}$/)

export const TeamSchema = z.looseObject({
  team_id: z.string(),
  name: z.string(),
  short_name: z.string(),
  code: z.string(),
  kit: z.looseObject({
    primary: HexColour,
    secondary: HexColour,
    number: HexColour,
    goalkeeper: HexColour,
  }),
  formation: z.string(),
  players: z.array(PlayerSchema),
  stadium: z.string().optional(),
  founded: z.number().optional(),
})
export type Team = z.infer<typeof TeamSchema>

export const MatchDetailSchema = z.looseObject({
  world: z.looseObject({
    fixture: z.looseObject({
      match_id: z.string(),
      home_team_id: z.string(),
      away_team_id: z.string(),
      venue: z.string().optional(),
      scenario: z
        .looseObject({ scenario_id: z.string(), version: z.string(), seed: z.number().optional() })
        .optional(),
    }),
    teams: z.array(TeamSchema).min(2),
  }),
  duration_ms: z.number().positive(),
  periods: z.array(z.looseObject({ period: z.string(), start_ms: z.number().nonnegative() })),
  event_count: z.number().int(),
  tracking: z.looseObject({
    interval_ms: z.number().positive(),
    entities: z.array(z.string()).min(1),
    precision: z.string().optional(),
  }),
})
export type MatchDetail = z.infer<typeof MatchDetailSchema>

export const TrackingChunkSchema = z.looseObject({
  from_ms: z.number(),
  to_ms: z.number(),
  interval_ms: z.number().positive(),
  frames: z.array(z.array(z.number().nullable()).min(4)),
})
export type TrackingChunk = z.infer<typeof TrackingChunkSchema>


// ---------------------------------------------------------------- decisions (v0.4)

export const RuleRefSchema = z.looseObject({
  law: z.string(),
  title: z.string(),
  url: z.string(),
  point: z.string(),
})

export const DecisionSchema = z.looseObject({
  decision_id: z.string().min(1),
  kind: z.string().min(1),
  clock: z.string(),
  team_id: z.string().nullable(),
  player_id: z.string().nullable(),
  headline: z.string(),
  decision: z.string(),
  reason: z.string(),
  what_happened: z.string(),
  which_rule: z.array(RuleRefSchema),
  what_changes: z.string(),
  caveats: z.array(z.string()).default([]),
  provisional: z.boolean(),
  source_event_ids: z.array(z.string()),
  ruleset_version: z.string(),
  disclaimer: z.string(),
  explanation_kind: z.string(),
  importance: z.enum(['major', 'minor']),
})
export type Decision = z.infer<typeof DecisionSchema>

export const DecisionListSchema = z.union([
  z.array(DecisionSchema),
  z.looseObject({ decisions: z.array(DecisionSchema) }).transform((d) => d.decisions),
])

// ---------------------------------------------------------------- research facts (v0.5)

export const FactSchema = z.looseObject({
  fact_id: z.string().min(1),
  subject_id: z.string(),
  subject_kind: z.string(),
  fact_type: z.string(),
  category: z.string().optional(),
  short_text: z.string(),
  extended_text: z.string().nullable().optional(),
  provenance: z.string(),
  source: z.string(),
  event_source_ids: z.array(z.string()).default([]),
  as_of: z.string().optional(),
  certainty: z.string().optional(),
  relevance: z.number().optional(),
  relevance_reason: z.string().nullable().optional(),
})
export type Fact = z.infer<typeof FactSchema>

export const PlayerFactsSchema = z.looseObject({
  player: z.looseObject({
    player_id: z.string(),
    team_id: z.string().optional(),
    shirt_number: z.number().int(),
    given_name: z.string(),
    family_name: z.string(),
    position: z.string(),
    preferred_foot: z.string().optional(),
    display_name: z.string().optional(),
  }),
  facts: z.array(FactSchema),
  notice: z.string().optional(),
})
export type PlayerFacts = z.infer<typeof PlayerFactsSchema>

export const TeamFactsSchema = z.looseObject({
  team_id: z.string(),
  facts: z.array(FactSchema),
  notice: z.string().optional(),
})
export type TeamFacts = z.infer<typeof TeamFactsSchema>

// ---------------------------------------------------------------- studio overlays + recap (v0.6)

export const OverlayPacketSchema = z.looseObject({
  id: z.string().min(1),
  source_kind: z.string(),
  source_id: z.string(),
  version: z.number().int(),
  status: z.enum(['proposed', 'approved', 'on_screen', 'expired', 'rejected', 'hidden', 'retracted']),
  template_id: z.string(),
  match_elapsed_ms: z.number(),
  display_from_ms: z.number().nullable().optional(),
  display_for_ms: z.number().nullable().optional(),
  expires_at_ms: z.number().nullable().optional(),
  title: z.string(),
  subtitle: z.string(),
  team_id: z.string().nullable().optional(),
  player_ids: z.array(z.string()).default([]),
  source_event_ids: z.array(z.string()).default([]),
  safe_area: z.string().optional(),
  status_reason: z.string().nullable().optional(),
  on_hold: z.boolean().optional(),
  requires_approval: z.boolean().optional(),
  demo_only: z.boolean().optional(),
  cue: z.enum(['now', 'next_stoppage', 'delay']).nullable().optional(),
  origin: z.enum(['auto', 'producer']).optional(),
  data: z.record(z.string(), z.unknown()).optional(),
  priority: z.number().optional(),
})
export type OverlayPacket = z.infer<typeof OverlayPacketSchema>

export const OverlayUpdateSchema = z.union([
  z.looseObject({ snapshot: z.array(OverlayPacketSchema) }),
  OverlayPacketSchema,
])

export const OverlayListSchema = z.union([
  z.array(OverlayPacketSchema),
  z.looseObject({ overlays: z.array(OverlayPacketSchema) }).transform((d) => d.overlays),
])

export const RecapSchema = z.looseObject({
  final_score: z.record(z.string(), z.number()),
  headline: z.string(),
  summary: z.string(),
  turning_points: z.array(z.looseObject({ minute: z.string(), text: z.string(), event_ids: z.array(z.string()) })),
  goals: z.array(z.record(z.string(), z.unknown())).default([]),
  disallowed: z.array(z.record(z.string(), z.unknown())).default([]),
  discipline: z.array(z.record(z.string(), z.unknown())).default([]),
  stories: z.array(z.record(z.string(), z.unknown())).default([]),
  stats: z.record(z.string(), z.record(z.string(), z.unknown())).default({}),
  source_event_ids: z.array(z.string()).default([]),
  generated_by: z.string(),
  validation_issues: z.array(z.string()).default([]),
  model_trace: z.record(z.string(), z.unknown()).nullable().optional(),
  synthetic_notice: z.string().optional(),
})
export type Recap = z.infer<typeof RecapSchema>

export const MatchSummarySchema = z.looseObject({
  match_id: z.string(),
  scenario_id: z.string(),
  title: z.string(),
  description: z.string().optional(),
})
export const MatchListSchema = z.array(MatchSummarySchema)
export type MatchSummary = z.infer<typeof MatchSummarySchema>

// ---------------------------------------------------------------- storylines

export const STORYLINE_STATES = ['OBSERVING', 'DEVELOPING', 'STRONG', 'CONFIRMED', 'WEAKENING', 'RESOLVED'] as const
export type StorylineState = (typeof STORYLINE_STATES)[number]

export const StorylineSchema = z.looseObject({
  storyline_id: z.string().min(1),
  match_id: z.string(),
  pattern_type: z.string(),
  team_id: z.string(),
  subject: z.string(),
  state: z.enum(STORYLINE_STATES),
  version: z.number().int(),
  opened_at_ms: z.number(),
  updated_at_ms: z.number(),
  display_clock: z.string(),
  headline: z.string(),
  reason: z.string(),
  metrics: z.record(z.string(), z.unknown()).default({}),
  candidate_ids: z.array(z.string()).default([]),
  withdrawn_candidate_ids: z.array(z.string()).default([]),
  evidence_event_ids: z.array(z.string()).default([]),
  linked_storyline_ids: z.array(z.string()).default([]),
  /** Tier-1 Foundry read of this exact version (rule-checked); absent when none exists. */
  ai_read: z
    .looseObject({
      line: z.string(),
      caveat: z.string().optional(),
      tier: z.string().optional(),
      response_id: z.string().nullable().optional(),
      latency_ms: z.number().nullable().optional(),
      from_cache: z.boolean().optional(),
    })
    .nullable()
    .optional(),
  history: z
    .array(
      z.looseObject({
        version: z.number().int(),
        state: z.enum(STORYLINE_STATES),
        at_ms: z.number(),
        seq: z.number(),
        display_clock: z.string(),
        reason: z.string(),
      }),
    )
    .default([]),
})
export type Storyline = z.infer<typeof StorylineSchema>

// ---------------------------------------------------------------- tactics + signals (V3)

const ObservedSchema = z.looseObject({ label: z.string(), value: z.union([z.number(), z.string()]), unit: z.string().default('') })

export const TacticalMomentSchema = z.looseObject({
  moment_id: z.string().min(1),
  kind: z.string(),
  label: z.string(),
  team_id: z.string(),
  at_ms: z.number(),
  seq: z.number(),
  display_clock: z.string(),
  title: z.string(),
  observed: z.array(ObservedSchema).default([]),
  summary: z.string(),
  interpretation: z.string(),
  unknowns: z.array(z.string()).default([]),
  evidence_event_ids: z.array(z.string()).default([]),
  focus_player_ids: z.array(z.string()).default([]),
  frame_ms: z.number(),
  significance: z.number().default(0),
  whatif: z.boolean().default(false),
  available_ms: z.number(),
  available_seq: z.number(),
  plain: z.string().optional(),
})
export type TacticalMoment = z.infer<typeof TacticalMomentSchema>

export const SIGNAL_TIERS = ['alert', 'insight', 'quiet'] as const
export const SignalSchema = z.looseObject({
  signal_id: z.string().min(1),
  kind: z.string(),
  tier: z.enum(SIGNAL_TIERS),
  team_id: z.string().nullable().optional(),
  at_ms: z.number(),
  seq: z.number(),
  display_clock: z.string(),
  headline: z.string(),
  text: z.record(z.string(), z.string()),
  audiences: z.array(z.string()).default([]),
  refs: z.record(z.string(), z.unknown()).default({}),
  evidence_event_ids: z.array(z.string()).default([]),
  status: z.enum(['live', 'corrected', 'withdrawn']).default('live'),
  status_reason: z.string().nullable().optional(),
  version: z.number().int(),
  folded: z.number().int().default(0),
  actions: z.array(z.string()).default([]),
})
export type Signal = z.infer<typeof SignalSchema>

const PlayerDotSchema = z.looseObject({
  pid: z.string(), team_id: z.string(), x: z.number(), y: z.number(), gk: z.boolean(), number: z.number(), name: z.string(),
})
const OptionSchema = z.looseObject({
  receiver_id: z.string(), x: z.number(), y: z.number(), distance_m: z.number(), progression_m: z.number(),
  lane_clearance_m: z.number(), lane_blocker_id: z.string().nullable(), lane_opponents: z.array(z.string()).default([]),
  receiver_space_m: z.number(), nearest_marker_id: z.string().nullable(), opponents_bypassed: z.number(),
  beyond_back_line: z.boolean(), between_lines: z.boolean(), offside_position: z.boolean(), rating: z.string(),
  bypassed_ids: z.array(z.string()).default([]), value: z.number().optional(),
})
export type PassOption = z.infer<typeof OptionSchema>
const LinesSchema = z.looseObject({ back_x: z.number(), mid_x: z.number(), offside_x: z.number() }).nullable()
const XY = z.tuple([z.number(), z.number()])
/** A simulated continuation: a possible next action from an alternative receiver's frozen spot (never history). */
const ContinuationSchema = z.looseObject({
  kind: z.enum(['pass', 'shot', 'cross']),
  from_id: z.string(),
  from: XY,
  label: z.string().min(1),
  pass: OptionSchema.extend({ rank: z.number().optional() }).optional(),
  shot: z
    .looseObject({
      goal_centre: XY,
      posts: z.tuple([XY, XY]),
      distance_m: z.number(),
      angle_deg: z.number(),
      defenders_in_triangle: z.array(z.string()).default([]),
      goalkeeper_id: z.string().nullable(),
      goalkeeper: XY.nullable(),
      goalkeeper_in_triangle: z.boolean().default(false),
    })
    .optional(),
  cross: z
    .looseObject({
      channel: z.string(),
      targets: z.array(
        z.looseObject({ pid: z.string(), x: z.number(), y: z.number(), nearest_marker_id: z.string().nullable(), marker_distance_m: z.number().nullable() }),
      ),
      offside_ids: z.array(z.string()).default([]),
    })
    .optional(),
})
export type Continuation = z.infer<typeof ContinuationSchema>
/** Additive and optional: an item that does not validate is dropped on its own, never the whole view. */
const ContinuationsSchema = z
  .array(z.unknown())
  .default([])
  .transform((items) =>
    items.flatMap((item) => {
      const r = ContinuationSchema.safeParse(item)
      return r.success && r.data[r.data.kind] ? [r.data] : []
    }),
  )
const IllustrativeMoverSchema = z.looseObject({
  pid: z.string(), role: z.string(), from: XY, to: XY, distance_m: z.number(), reached: z.boolean(),
})
/**
 * One illustrative way the best alternative could continue (ADR 10): rule-based moves from the frozen frame with
 * stated speeds. Never history, never a prediction. Additive and optional: a payload that does not validate is
 * dropped (null), never the whole view.
 */
const IllustrativeSchema = z.looseObject({
  from_id: z.string(),
  label: z.string().min(1),
  pass: z.looseObject({ from: XY, to: XY, distance_m: z.number(), seconds: z.number() }),
  run: IllustrativeMoverSchema.extend({ held_onside: z.boolean(), offside_x: z.number() }),
  defenders: z.array(IllustrativeMoverSchema),
  delivery: z.looseObject({ from: XY, to: XY, distance_m: z.number(), seconds: z.number() }),
  contests: z.array(z.looseObject({ pid: z.string(), kind: z.enum(['block', 'intercept']), at: XY, gap_m: z.number(), arrive_s: z.number() })).default([]),
  seconds_to_ball_in: z.number(),
})
export type Illustrative = z.infer<typeof IllustrativeSchema>
const IllustrativeOrNull = z
  .unknown()
  .optional()
  .transform((v) => {
    const r = IllustrativeSchema.safeParse(v)
    return r.success ? r.data : null
  })
export const WhatIfSchema = z.looseObject({
  moment_id: z.string(),
  team_id: z.string(),
  defending_team_id: z.string(),
  frame_ms: z.number(),
  carrier_id: z.string(),
  origin: z.tuple([z.number(), z.number()]),
  actual: z.looseObject({
    kind: z.string(), receiver_id: z.string().nullable(), end: z.array(z.number()), outcome: z.string().nullable(),
    interceptor_id: z.string().nullable(), option: OptionSchema.nullable(), event_id: z.string(),
  }),
  alternatives: z.array(OptionSchema),
  continuations: ContinuationsSchema,
  continuation_rules: z.record(z.string(), z.string()).optional(),
  illustrative: IllustrativeOrNull,
  illustrative_rules: z.record(z.string(), z.string()).optional(),
  lines: LinesSchema,
  labels: z.looseObject({ history: z.string(), hypothetical: z.string() }),
  rules: z.record(z.string(), z.string()),
})
export type WhatIf = z.infer<typeof WhatIfSchema>
export const MomentViewSchema = TacticalMomentSchema.extend({
  direction: z.string(),
  defending_team_id: z.string(),
  players: z.array(PlayerDotSchema),
  ball: z.tuple([z.number(), z.number()]).nullable(),
  arrows: z.array(z.looseObject({ event_id: z.string(), type: z.string(), from: z.array(z.number()), to: z.array(z.number()), player_id: z.string().nullable() })),
  lines: LinesSchema,
  replay: z.looseObject({ from_ms: z.number(), to_ms: z.number() }),
  whatif: WhatIfSchema.nullable(),
})
export type MomentView = z.infer<typeof MomentViewSchema>

// ---------------------------------------------------------------- stream

export const STREAM_SCHEMAS = {
  match_event: MatchEventSchema,
  match_state: MatchStateSchema,
  heartbeat: HeartbeatSchema,
  pattern_candidate: PatternCandidateSchema,
  insight_update: InsightUpdateSchema,
  replay_reset: ReplayResetSchema,
  decision: DecisionSchema,
  overlay_update: OverlayUpdateSchema,
  recap: RecapSchema,
  storyline_update: StorylineSchema,
  tactical_moment: TacticalMomentSchema,
  signal: SignalSchema,
} as const

export type StreamEventName = keyof typeof STREAM_SCHEMAS

export type StreamMessage = {
  [K in StreamEventName]: { event: K; data: z.infer<(typeof STREAM_SCHEMAS)[K]> }
}[StreamEventName]

/**
 * Parse one SSE frame (event name + raw JSON text). Returns null for unknown
 * event names, non-JSON data or payloads that fail validation; never throws.
 */
export function parseStreamMessage(
  event: string,
  raw: string,
  onInvalid: (reason: string) => void = () => {},
): StreamMessage | null {
  if (!(event in STREAM_SCHEMAS)) return null
  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch {
    onInvalid(`${event}: data was not JSON`)
    return null
  }
  const schema = STREAM_SCHEMAS[event as StreamEventName]
  const parsed = schema.safeParse(json)
  if (!parsed.success) {
    onInvalid(`${event}: ${parsed.error.issues[0]?.path.join('.') ?? ''} ${parsed.error.issues[0]?.message ?? ''}`)
    return null
  }
  return { event, data: parsed.data } as StreamMessage
}
