import type { Player, Signal } from '../../services/schemas'

/** Small pure helpers shared by the fan components (kept apart so components stay refresh-friendly). */

export const refsOf = (s: Signal) => s.refs as Record<string, unknown>
export const fanText = (s: Signal) => s.text.fan ?? s.text.commentator ?? s.headline
export const momentIdOf = (s: Signal) => (typeof refsOf(s).moment_id === 'string' ? (refsOf(s).moment_id as string) : null)

const ROLE: Record<string, string> = {
  GK: 'goalkeeper',
  RB: 'right-back',
  LB: 'left-back',
  CB: 'centre-back',
  DM: 'holding midfielder',
  CM: 'central midfielder',
  AM: 'attacking midfielder',
  RW: 'right winger',
  LW: 'left winger',
  ST: 'striker',
}

export const roleWords = (p: Player) => ROLE[p.position] ?? p.position

export type Stats = Record<string, number | null | undefined>
export interface Row {
  key: string
  label: string
  l: number
  r: number
  pct?: boolean
}

const n = (v: number | null | undefined) => (typeof v === 'number' ? v : 0)

/** Only what the match state measures (state.stats from the official events); nothing derived beyond simple sums. */
export function compareRows(stats: Record<string, Stats> | undefined, left: string, right: string, analyst: boolean): Row[] {
  const L = stats?.[left] ?? {}
  const R = stats?.[right] ?? {}
  const rows: Row[] = []
  if (typeof L.possession_pct === 'number' && typeof R.possession_pct === 'number') rows.push({ key: 'possession', label: 'Time on the ball', l: L.possession_pct, r: R.possession_pct, pct: true })
  rows.push({ key: 'passes_completed', label: 'Passes completed', l: n(L.passes_completed), r: n(R.passes_completed) })
  if (n(L.passes) + n(R.passes) > 0) {
    const acc = (s: Stats) => (n(s.passes) ? Math.round((100 * n(s.passes_completed)) / n(s.passes)) : 0)
    rows.push({ key: 'pass_pct', label: 'Pass accuracy', l: acc(L), r: acc(R), pct: true })
  }
  rows.push({ key: 'shots', label: 'Shots', l: n(L.shots), r: n(R.shots) })
  rows.push({ key: 'shots_on_target', label: 'On target', l: n(L.shots_on_target), r: n(R.shots_on_target) })
  rows.push({ key: 'won_back', label: 'Won the ball back', l: n(L.tackles) + n(L.interceptions), r: n(R.tackles) + n(R.interceptions) })
  rows.push({ key: 'corners', label: 'Corners', l: n(L.corners), r: n(R.corners) })
  if (analyst) {
    rows.push({ key: 'tackles', label: 'Tackles', l: n(L.tackles), r: n(R.tackles) })
    rows.push({ key: 'interceptions', label: 'Interceptions', l: n(L.interceptions), r: n(R.interceptions) })
    rows.push({ key: 'saves', label: 'Saves', l: n(L.saves), r: n(R.saves) })
    rows.push({ key: 'fouls', label: 'Fouls', l: n(L.fouls), r: n(R.fouls) })
    rows.push({ key: 'offsides', label: 'Offsides', l: n(L.offsides), r: n(R.offsides) })
    rows.push({ key: 'yellow_cards', label: 'Yellow cards', l: n(L.yellow_cards), r: n(R.yellow_cards) })
    rows.push({ key: 'red_cards', label: 'Sent off', l: n(L.red_cards), r: n(R.red_cards) })
  } else rows.push({ key: 'fouls', label: 'Fouls', l: n(L.fouls), r: n(R.fouls) })
  return rows
}

