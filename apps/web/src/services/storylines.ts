import type { StoryVariant } from '../components/StoryRadar/StoryRadar'
import type { Storyline, StorylineState } from './schemas'

export const STATE_LABEL: Record<StorylineState, string> = {
  OBSERVING: 'Watching',
  DEVELOPING: 'Developing',
  STRONG: 'Strong',
  CONFIRMED: 'Confirmed',
  WEAKENING: 'Weakening',
  RESOLVED: 'Resolved',
}

/** The four steps a storyline climbs; Weakening and Resolved are shown as a status, not a step. */
export const RAIL: StorylineState[] = ['OBSERVING', 'DEVELOPING', 'STRONG', 'CONFIRMED']

/** Which storylines an audience sees. Shared state; only the visibility differs per role. */
export function visibleStorylines(all: readonly Storyline[], variant: StoryVariant): Storyline[] {
  const active = all.filter((s) => s.state !== 'RESOLVED')
  const shown = variant === 'discover' ? active.filter((s) => s.state !== 'OBSERVING') : active
  return [...shown].sort((a, b) => b.updated_at_ms - a.updated_at_ms)
}

/** First clock at which each rail step was reached (from the append-only history). */
export function railClocks(sl: Storyline): Partial<Record<StorylineState, string>> {
  const out: Partial<Record<StorylineState, string>> = {}
  for (const v of sl.history) if (!out[v.state]) out[v.state] = v.display_clock
  return out
}

const SIDE: Record<string, string> = { left: 'left', centre: 'middle', right: 'right' }
const CATEGORY: Record<string, string> = {
  repeated_channel_attack: 'Channel pattern',
  counterattack: 'Fast breaks',
  overlap: 'Overlapping runs',
}

export function storylineCategory(sl: Storyline): string {
  const base = CATEGORY[sl.pattern_type] ?? 'Storyline'
  if (sl.pattern_type === 'repeated_channel_attack') return `${base} · ${SIDE[sl.subject] ?? sl.subject}`
  if (sl.pattern_type === 'overlap') return `${base} · ${sl.subject} flank`
  return base
}

function num(m: Record<string, unknown>, k: string): number | null {
  const v = m[k]
  return typeof v === 'number' ? v : null
}

/**
 * The deterministic measurement behind a storyline, in the audience's words. Built only from the
 * storyline's own metrics (no new claims); falls back to the engine's reason when a metric is missing.
 */
export function measuredLine(sl: Storyline, variant: StoryVariant): string {
  const m = sl.metrics
  if (sl.pattern_type === 'repeated_channel_attack') {
    const ce = num(m, 'channel_entries')
    const te = num(m, 'total_entries')
    const w = num(m, 'window_minutes')
    const poss = num(m, 'distinct_possessions')
    const d = num(m, 'dangerous_entries')
    if (ce === null || te === null) return sl.reason
    const side = SIDE[sl.subject] ?? sl.subject
    if (variant === 'discover') return `${ce} of their last ${te} attacks into the final third went down the ${side}.`
    const parts = [`${ce} of ${te} final-third entries down the ${side}${w !== null ? ` in ${w} min` : ''}`]
    if (poss !== null) parts.push(`${poss} possessions`)
    if (d !== null) parts.push(`${d} dangerous`)
    return parts.join(' · ')
  }
  if (sl.pattern_type === 'counterattack') {
    const occ = num(m, 'occurrences') ?? 1
    const secs = num(m, 'seconds_regain_to_shot')
    const metres = num(m, 'metres_advanced')
    const outcome = typeof m.shot_outcome === 'string' ? m.shot_outcome.replace(/_/g, ' ') : null
    if (secs === null) return sl.reason
    if (variant === 'discover') {
      const what = outcome === 'goal' ? 'a goal' : outcome ? `a shot (${outcome})` : 'a shot'
      return `${occ === 1 ? 'A fast break' : `${occ} fast breaks`}: the latest went from winning the ball to ${what} in ${secs} seconds.`
    }
    const parts = [`${occ} fast break${occ === 1 ? '' : 's'} this spell`, `latest ${secs} s regain to shot`]
    if (metres !== null) parts.push(`${metres} m advanced`)
    if (outcome) parts.push(outcome)
    return parts.join(' · ')
  }
  if (sl.pattern_type === 'overlap') {
    const dist = num(m, 'runner_distance_m')
    const secs = num(m, 'run_seconds')
    if (dist === null || secs === null) return sl.reason
    if (variant === 'discover') return `A team-mate ran ${dist} metres round the outside in ${secs} seconds to join the attack.`
    return `Overlapping run on the ${sl.subject}: ${dist} m in ${secs} s, from behind to ahead of the ball carrier`
  }
  return sl.reason
}

/** Analyst detail: which of the detector's own gates already pass (only for channel storylines). */
export function gatesLine(sl: Storyline): string | null {
  const passed = sl.metrics.gates_passed
  const pending = sl.metrics.gates_pending
  if (!Array.isArray(passed) || !Array.isArray(pending)) return null
  const total = passed.length + pending.length
  return pending.length === 0
    ? `All ${total} detector gates pass`
    : `${passed.length} of ${total} detector gates pass · waiting on ${pending.join(', ')}`
}
