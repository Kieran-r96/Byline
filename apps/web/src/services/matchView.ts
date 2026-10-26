import type { MatchPeriod, TeamId, TimelineMarker } from '../types/shell'
import type { InsightEntry } from './matchSession'
import { payloadString } from './schemas'
import type { Insight, MatchDetail, MatchEvent, MatchState, PatternCandidate, Player, Team } from './schemas'

/** Pure view-model helpers: everything here is unit-testable without React. */

// ---------------------------------------------------------------- score

export interface ScoreDisplay {
  home: number
  away: number
  /** True while a goal is provisional (awaiting confirmation) or under VAR review. */
  checking: boolean
  /** True only while the official stream has an open VAR review (never inferred). */
  varReview: boolean
  /** The side whose score is provisional, if any. */
  provisionalSide: 'home' | 'away' | null
}

/**
 * Score display rule (api-contract): show `score`; when `provisional_score`
 * differs, show the provisional value flagged as CHECKING. Never present a
 * provisional goal as confirmed.
 */
export function scoreDisplay(state: MatchState | null, homeId: string, awayId: string): ScoreDisplay {
  if (!state) return { home: 0, away: 0, checking: false, varReview: false, provisionalSide: null }
  const confirmedHome = state.score[homeId] ?? 0
  const confirmedAway = state.score[awayId] ?? 0
  const provHome = state.provisional_score[homeId] ?? confirmedHome
  const provAway = state.provisional_score[awayId] ?? confirmedAway
  const differs = provHome !== confirmedHome || provAway !== confirmedAway
  return {
    home: provHome,
    away: provAway,
    checking: differs || state.var_review !== null,
    varReview: state.var_review !== null,
    provisionalSide: provHome !== confirmedHome ? 'home' : provAway !== confirmedAway ? 'away' : null,
  }
}

export function periodLabel(period: string | undefined): MatchPeriod {
  switch (period) {
    case 'H1':
      return '1H'
    case 'HT':
      return 'HT'
    case 'H2':
      return '2H'
    case 'FT':
      return 'FT'
    default:
      return 'PRE'
  }
}

/**
 * Match clock from the extrapolated playhead: first half counts from 0,
 * second half restarts at 45:00 from its own kick-off.
 */
export function matchClock(playheadMs: number, detail: MatchDetail | null, state: MatchState | null): string {
  const period = state?.period
  if (period === 'PRE' || (!period && playheadMs <= 0)) return '00:00'
  if (period === 'HT') return '45:00'
  if (period === 'FT') return state?.clock && /\d/.test(state.clock) ? state.clock : '90:00'
  const h2 = detail?.periods.find((p) => p.period === 'H2')?.start_ms
  let seconds: number
  if (h2 !== undefined && (period === 'H2' || playheadMs >= h2)) seconds = 45 * 60 + (playheadMs - h2) / 1000
  else seconds = playheadMs / 1000
  const s = Math.max(0, Math.floor(seconds))
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

/** Football minute label for an elapsed time ("7'", "45+2'", "90+4'"), the convention used everywhere else. */
export function footballMinute(elapsedMs: number, detail: MatchDetail | null): string {
  const h2 = detail?.periods.find((p) => p.period === 'H2')?.start_ms
  const second = h2 !== undefined && elapsedMs >= h2
  const inPeriod = second ? elapsedMs - (h2 ?? 0) : elapsedMs
  const minute = Math.floor(inPeriod / 60_000) + 1 + (second ? 45 : 0)
  const cap = second ? 90 : 45
  return minute > cap ? `${cap}+${minute - cap}'` : `${minute}'`
}

// ---------------------------------------------------------------- world lookups

export interface WorldIndex {
  players: Map<string, Player>
  teams: Map<string, Team>
  homeId: TeamId
  awayId: TeamId
}

export function indexWorld(detail: MatchDetail | null): WorldIndex {
  const players = new Map<string, Player>()
  const teams = new Map<string, Team>()
  for (const t of detail?.world.teams ?? []) {
    teams.set(t.team_id, t)
    for (const p of t.players) players.set(p.player_id, p)
  }
  const home = (detail?.world.fixture.home_team_id ?? 'NBA') as TeamId
  const away = (detail?.world.fixture.away_team_id ?? 'RVC') as TeamId
  return { players, teams, homeId: home, awayId: away }
}

export function playerLabel(world: WorldIndex, id: string | null | undefined): string | null {
  if (!id) return null
  const p = world.players.get(id)
  if (!p) return id
  return `${p.family_name} (${p.shirt_number})`
}

export function teamName(world: WorldIndex, id: string | null | undefined): string {
  if (!id) return ''
  return world.teams.get(id)?.name ?? id
}

// ---------------------------------------------------------------- events in words

const EVENT_WORDS: Record<string, string> = {
  'pass.completed': 'Pass',
  'pass.failed': 'Pass, not completed',
  carry: 'Carry',
  shot: 'Shot',
  save: 'Save',
  tackle: 'Tackle',
  interception: 'Interception',
  pressure: 'Pressure',
  ball_recovery: 'Ball recovery',
  'foul.committed': 'Foul',
  'goal.provisional': 'Goal (awaiting confirmation)',
  'goal.confirmed': 'Goal confirmed',
  'goal.disallowed': 'Goal disallowed',
  'card.yellow': 'Yellow card',
  'card.second_yellow': 'Second yellow card',
  'card.red': 'Red card',
  'penalty.taken': 'Penalty taken',
  'penalty.outcome': 'Penalty',
  'var.review_started': 'VAR check',
  'var.review_outcome': 'VAR decision',
  'restart.awarded': 'Restart awarded',
  'restart.taken': 'Restart taken',
  substitution: 'Substitution',
  'offside.offence_confirmed': 'Offside',
  'period.started': 'Period started',
  'period.ended': 'Period ended',
  kickoff: 'Kick-off',
}

export function eventWords(type: string): string {
  return EVENT_WORDS[type] ?? type.replace(/[._]/g, ' ').replace(/^\w/, (c) => c.toUpperCase())
}

/** Short headline for a moment chip / live region, e.g. "GOAL · Northbridge Athletic". */
export function momentText(ev: MatchEvent, world: WorldIndex): { kicker: string; detail: string } {
  const team = teamName(world, ev.team_id)
  const who = playerLabel(world, ev.player_id)
  switch (ev.type) {
    case 'goal.confirmed':
      return { kicker: 'GOAL', detail: [team, who].filter(Boolean).join(' · ') }
    case 'goal.disallowed':
      return { kicker: 'GOAL DISALLOWED', detail: [team, String(ev.payload.reason ?? '')].filter(Boolean).join(' · ') }
    case 'card.yellow':
      return { kicker: 'YELLOW CARD', detail: [who, team].filter(Boolean).join(' · ') }
    case 'card.second_yellow':
      return { kicker: 'SECOND YELLOW · SENT OFF', detail: [who, team].filter(Boolean).join(' · ') }
    case 'card.red':
      return { kicker: 'RED CARD', detail: [who, team].filter(Boolean).join(' · ') }
    case 'penalty.outcome':
      return { kicker: 'PENALTY', detail: [String(ev.payload.outcome ?? ''), who].filter(Boolean).join(' · ') }
    case 'var.review_started':
      return { kicker: 'VAR CHECK', detail: String(ev.payload.reason ?? 'Review in progress') }
    default:
      return { kicker: eventWords(ev.type).toUpperCase(), detail: who ?? team }
  }
}

// ---------------------------------------------------------------- timeline

export function buildMarkers(
  keyEvents: readonly MatchEvent[],
  candidates: readonly PatternCandidate[],
  insights: Readonly<Record<string, InsightEntry>>,
  world: WorldIndex,
): TimelineMarker[] {
  const out: TimelineMarker[] = []
  for (const ev of keyEvents) {
    let kind: TimelineMarker['kind'] | null = null
    let title = ''
    const team = teamName(world, ev.team_id)
    const who = playerLabel(world, ev.player_id)
    switch (ev.type) {
      case 'goal.confirmed':
        kind = 'goal'
        title = `Goal: ${[who, team].filter(Boolean).join(', ')}`
        break
      case 'goal.disallowed':
        kind = 'var'
        title = `Goal disallowed after VAR check (${String(ev.payload.reason ?? 'review')})`
        break
      case 'card.yellow':
        kind = 'yellow'
        title = `Yellow card: ${[who, team].filter(Boolean).join(', ')}`
        break
      case 'card.second_yellow':
        kind = 'red'
        title = `Second yellow, sent off: ${[who, team].filter(Boolean).join(', ')}`
        break
      case 'card.red':
        kind = 'red'
        title = `Red card: ${[who, team].filter(Boolean).join(', ')}`
        break
      case 'penalty.outcome':
        kind = 'penalty'
        title = `Penalty ${String(ev.payload.outcome ?? '')}: ${who ?? team}`
        break
    }
    if (kind) {
      out.push({
        id: ev.event_id,
        kind,
        atSeconds: ev.elapsed_ms / 1000,
        title,
        minuteLabel: ev.display_clock,
        ...(ev.team_id === 'NBA' || ev.team_id === 'RVC' ? { teamId: ev.team_id } : {}),
      })
    }
  }
  for (const c of candidates) {
    const entry = insights[c.candidate_id]
    out.push({
      id: c.candidate_id,
      kind: 'story',
      atSeconds: c.detected_at_ms / 1000,
      title: entry?.update.insight?.title ?? categoryLabel(c),
      minuteLabel: c.display_clock,
      ...(c.team_id === 'NBA' || c.team_id === 'RVC' ? { teamId: c.team_id } : {}),
    })
  }
  return out.sort((a, b) => a.atSeconds - b.atSeconds)
}

// ---------------------------------------------------------------- stories

const PATTERN_WORDS: Record<string, string> = {
  repeated_channel_attack: 'Pattern',
  counterattack: 'Counter-attack',
  overlap: 'Overlap',
  pressure_change: 'Pressure shift',
  player_milestone: 'Milestone',
  decision_explainer: 'Decision',
  goal_story: 'Goal story',
}

export function categoryLabel(c: Pick<PatternCandidate, 'pattern_type' | 'calculated_metrics'>): string {
  const base = PATTERN_WORDS[c.pattern_type] ?? 'Pattern'
  const m = c.calculated_metrics
  if (typeof m.channel === 'string' && m.channel) return `${base} · ${m.channel} channel`
  if (typeof m.flank === 'string' && m.flank) return `${base} · ${m.flank} flank`
  if (typeof m.regain_type === 'string' && m.regain_type) return `${base} · ${m.regain_type.replace(/_/g, ' ')}`
  return base
}

/** Neutral pending title, before any insight text exists. */
export function pendingTitle(c: Pick<PatternCandidate, 'pattern_type'>): string {
  switch (c.pattern_type) {
    case 'counterattack':
      return 'Possible counter-attack'
    case 'overlap':
      return 'Possible overlapping run'
    default:
      return 'Possible pattern'
  }
}

export function isRetracted(c: PatternCandidate | undefined, entry: InsightEntry | undefined): boolean {
  return c?.status === 'retracted' || entry?.update.stage === 'retracted' || entry?.update.insight?.status === 'retracted'
}

export function retractionReason(c: PatternCandidate | undefined, entry: InsightEntry | undefined): string | null {
  return entry?.update.insight?.retraction_reason ?? c?.retraction_reason ?? null
}

export type StageTone = 'pending' | 'verified' | 'detector' | 'rejected' | 'tentative' | 'withdrawn'

export interface StageInfo {
  label: string
  tone: StageTone
  /** Final (no more stages expected). */
  done: boolean
}

export function isDetectorOnly(entry: InsightEntry | undefined): boolean {
  const checker = entry?.update.insight?.verification.checker_name ?? ''
  return checker.startsWith('deterministic_only')
}

export function stageInfo(entry: InsightEntry | undefined): StageInfo {
  if (!entry) return { label: 'Queued', tone: 'pending', done: false }
  const stage = entry.update.stage
  switch (stage) {
    case 'queued':
      return { label: 'Queued', tone: 'pending', done: false }
    case 'investigating':
      return { label: 'Investigating', tone: 'pending', done: false }
    case 'analysing':
      return { label: 'Analysing', tone: 'pending', done: false }
    case 'verifying':
      return { label: 'Verifying', tone: 'pending', done: false }
    case 'validating':
      return { label: 'Validating', tone: 'pending', done: false }
    case 'verified':
      return { label: 'Verified', tone: 'verified', done: true }
    case 'rejected':
      return { label: 'Rejected', tone: 'rejected', done: true }
    case 'tentative': {
      if (isDetectorOnly(entry)) {
        const checker = entry.update.insight?.verification.checker_name ?? ''
        const label = checker.includes('ai_off')
          ? 'Detector summary · AI off'
          : checker.includes('cache_only')
            ? 'Detector summary · not AI-reviewed'
            : checker.includes('ai_skipped')
              ? 'Detector summary · skipped ahead'
              : 'Detector summary · AI unavailable'
        return { label, tone: 'detector', done: true }
      }
      return { label: 'Tentative', tone: 'tentative', done: true }
    }
    case 'failed':
      return { label: 'Unavailable', tone: 'rejected', done: true }
    case 'retracted':
      return { label: 'Withdrawn', tone: 'withdrawn', done: true }
    default:
      return { label: stage.replace(/_/g, ' '), tone: 'pending', done: false }
  }
}

/** The three real agent steps; a step is "reached" only if its stage was received. */
export const AGENT_STEPS = [
  { id: 'investigate', label: 'Investigate', stages: ['investigating'] },
  { id: 'analyse', label: 'Analyse', stages: ['analysing'] },
  { id: 'verify', label: 'Verify', stages: ['verifying', 'validating', 'verified'] },
] as const

const AGENT_OF_STEP: Record<string, string> = { investigate: 'investigator', analyse: 'analyst', verify: 'verifier' }

/** Steps that really ran: streamed live, or recorded in the run's trace (a recording served after a seek). */
export function reachedSteps(entry: InsightEntry | undefined): Set<string> {
  const seen = new Set(entry?.stages ?? [])
  const agents = new Set(entry?.update.trace_summary?.model_calls ? entry.update.trace_summary.agents : [])
  const reached = new Set<string>()
  for (const step of AGENT_STEPS) {
    if (step.stages.some((s) => seen.has(s)) || agents.has(AGENT_OF_STEP[step.id] ?? '')) reached.add(step.id)
  }
  return reached
}

/** Turn a raw provider error into short, professional copy (no stack text). */
export function sanitiseIssue(issue: string): string {
  const head = issue.split(/[:(]/)[0]?.trim() ?? ''
  if (/^AI disabled/i.test(issue)) return 'AI is switched off for this demo run.'
  if (/^[A-Za-z]+(Error|Exception)$/.test(head)) return `AI provider unavailable (${head}).`
  return issue.length > 160 ? `${issue.slice(0, 157)}…` : issue
}

// ---------------------------------------------------------------- line-ups

export interface LineupSlot {
  slot: string
  playerId: string | null
  /** Player sent off from this slot (slot left empty: 10-man shape). */
  sentOffId: string | null
  subOn: boolean
}

export interface Lineup {
  formation: string
  slots: LineupSlot[]
}

interface Starter {
  player_id: string
  slot: string
}

function startersFrom(ev: MatchEvent | undefined): { formation: string; starters: Starter[] } | null {
  if (!ev) return null
  const raw = ev.payload.starters
  if (!Array.isArray(raw)) return null
  const starters = raw.filter(
    (s): s is Starter =>
      !!s && typeof s === 'object' && typeof (s as Starter).player_id === 'string' && typeof (s as Starter).slot === 'string',
  )
  return { formation: typeof ev.payload.formation === 'string' ? ev.payload.formation : '', starters }
}

/**
 * Current shape for a team: live `on_pitch` slots from match_state, falling
 * back to the confirmed line-up before kick-off. Substitutes occupy the slot
 * of the player they replaced; a sent-off player's slot stays visibly empty.
 */
export function teamLineup(teamId: string, state: MatchState | null, keyEvents: readonly MatchEvent[]): Lineup {
  const lineupEv = keyEvents.find((e) => e.type === 'lineup.confirmed' && e.team_id === teamId)
  const confirmed = startersFrom(lineupEv)
  const ts = state?.teams[teamId]
  const subsOn = new Set(
    keyEvents
      .filter((e) => e.type === 'substitution' && e.team_id === teamId)
      .map((e) => payloadString(e, 'player_on_id'))
      .filter((x): x is string => !!x),
  )
  const onPitch = ts && Object.keys(ts.on_pitch).length ? ts.on_pitch : null
  const formation = ts?.formation || confirmed?.formation || ''
  if (!onPitch && !confirmed) return { formation, slots: [] }
  const slotOrder = confirmed?.starters.map((s) => s.slot) ?? Object.keys(onPitch ?? {})
  const slots: LineupSlot[] = []
  const sentOff = new Set(ts?.sent_off ?? [])
  for (const slot of slotOrder) {
    const current = onPitch ? (onPitch[slot] ?? null) : (confirmed?.starters.find((s) => s.slot === slot)?.player_id ?? null)
    let sentOffId: string | null = null
    if (!current) {
      const starter = confirmed?.starters.find((s) => s.slot === slot)?.player_id
      if (starter && sentOff.has(starter)) sentOffId = starter
      else sentOffId = [...sentOff].find((id) => !Object.values(onPitch ?? {}).includes(id)) ?? null
    }
    slots.push({ slot, playerId: current, sentOffId, subOn: !!current && subsOn.has(current) })
  }
  for (const [slot, pid] of Object.entries(onPitch ?? {})) {
    if (!slotOrder.includes(slot)) slots.push({ slot, playerId: pid, sentOffId: null, subOn: subsOn.has(pid) })
  }
  return { formation, slots }
}

// ---------------------------------------------------------------- translations (T020)

export type InsightField = 'title' | 'canonical_claim' | 'commentator' | 'fan_discover' | 'fan_analyst'

export interface LocalText {
  text: string | undefined
  /** Text shown is a machine translation (English is the reference). */
  translated: boolean
  /** Spanish requested but this field is only available in English. */
  englishOnly: boolean
}

/**
 * Per-field Spanish with English fallback. Translations arrive flattened as
 * `es.<field>`; validators may drop individual fields, so each falls back on
 * its own. Detector summaries carry no translations and stay English.
 */
export function insightText(insight: Insight | null | undefined, field: InsightField, lang: 'en' | 'es'): LocalText {
  if (!insight) return { text: undefined, translated: false, englishOnly: false }
  const av = insight.audience_variants
  const english =
    field === 'title' ? insight.title : field === 'canonical_claim' ? insight.canonical_claim : av?.[field]
  if (lang !== 'es') return { text: english, translated: false, englishOnly: false }
  const es = av?.translations?.[`es.${field}`]
  if (es && es.trim()) return { text: es, translated: true, englishOnly: false }
  return { text: english, translated: false, englishOnly: true }
}
