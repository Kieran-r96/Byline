import type { MatchEvent, MatchState, Signal } from './schemas'
import type { WorldIndex } from './matchView'

/**
 * Commentator surface logic (pure). Separates the few things worth saying now from routine match
 * information, so a commentator never scans twenty similar cards to find the moment that matters.
 */

export type DiscoveryKind = 'tactical' | 'story' | 'record' | 'context'

/** Alerts are official events (goals, cards, subs, VAR). The lead is the newest one, if recent. */
export const LEAD_FRESH_MS = 4 * 60_000

export function isLive(s: Signal): boolean {
  return s.status !== 'withdrawn'
}

export function signalText(s: Signal, audience: 'commentator' | 'studio' | 'fan' = 'commentator'): string {
  return s.text[audience] ?? s.text.commentator ?? s.headline
}

export function discoveryKind(s: Signal): DiscoveryKind {
  if (s.kind === 'tactical') return 'tactical'
  if (s.kind === 'storyline') return 'story'
  if (s.kind === 'record' || s.kind === 'milestone') return 'record'
  return 'context'
}

export const DISCOVERY_LABEL: Record<DiscoveryKind, string> = {
  tactical: 'Tactical · measured',
  story: 'Pattern',
  record: 'Record',
  context: 'Context',
}

function newestFirst(a: Signal, b: Signal): number {
  return b.at_ms - a.at_ms || b.seq - a.seq
}

/**
 * The lead: the newest official alert while it is fresh, otherwise the newest discovery.
 * Before kick-off there is no lead (the surface shows the pre-match brief instead).
 */
export function pickLead(signals: readonly Signal[], playheadMs: number): Signal | null {
  const forUs = signals.filter((s) => s.audiences.includes('commentator') && isLive(s) && s.at_ms > 0)
  const alerts = forUs.filter((s) => s.tier === 'alert').sort(newestFirst)
  const fresh = alerts.find((s) => playheadMs - s.at_ms <= LEAD_FRESH_MS)
  if (fresh) return fresh
  return forUs.filter((s) => s.tier === 'insight').sort(newestFirst)[0] ?? alerts[0] ?? null
}

/**
 * Developing play: measured tactical insights and patterns (not the lead), newest first. Records and context are
 * talking points, not discoveries, so they are ranked separately; quiet notes stay out of the way.
 */
export function discoveries(signals: readonly Signal[], leadId: string | null): Signal[] {
  return signals
    .filter(
      (s) =>
        // storylines are routed quiet but they are exactly the developing play, so they always belong here
        ((s.kind === 'tactical' && s.tier !== 'quiet') || s.kind === 'storyline') &&
        s.audiences.includes('commentator') &&
        s.signal_id !== leadId &&
        s.at_ms > 0,
    )
    .sort(newestFirst)
}

/** Official alerts (goals, cards, substitutions, VAR), newest first: the "key events" strip. */
const OFFICIAL = new Set(['goal', 'card', 'substitution', 'var', 'penalty'])

export function keyAlerts(signals: readonly Signal[]): Signal[] {
  return signals.filter((s) => OFFICIAL.has(s.kind) && s.at_ms > 0 && s.audiences.includes('commentator')).sort(newestFirst)
}

/**
 * Signal headlines are written for a broadcast ticker ("GOAL · Northbridge 1–0 Riverton", "RECORD"). For reading,
 * split the shouted category off as a kicker in sentence case; a bare category word means the text is the headline.
 */
/** "VAR CHECK" -> "VAR check": sentence case that keeps football's acronyms. */
function sentence(shout: string): string {
  return (shout.charAt(0) + shout.slice(1).toLowerCase()).replace(/\bvar\b/gi, 'VAR')
}

export function readable(s: Signal, audience: 'commentator' | 'studio' | 'fan' = 'commentator'): { kicker: string | null; headline: string; line: string | null } {
  const text = signalText(s, audience)
  // storylines lead with their state word ("Building · Northbridge Athletic: …"): that is the kicker too
  const m = s.headline.match(/^([A-Z][A-Z' -]{1,30}?)\s*·\s*(.+)$/) ?? (s.kind === 'storyline' ? s.headline.match(/^([A-Z][a-z]+)\s*·\s*(.+)$/) : null)
  if (m) return { kicker: sentence(m[1]!), headline: m[2]!, line: text }
  if (/^[A-Z][A-Z' -]{1,30}$/.test(s.headline)) return { kicker: sentence(s.headline), headline: text, line: null }
  return { kicker: null, headline: s.headline, line: text }
}

/** Pre-match context notes (at_ms 0): form, fixtures, managers, head to head, stadium. */
export function preMatch(signals: readonly Signal[]): Signal[] {
  return signals.filter((s) => s.at_ms === 0 && s.audiences.includes('commentator') && isLive(s))
}

// ---------------------------------------------------------------- routine log

export interface LogRow {
  id: string
  clock: string
  atMs: number
  teamId: string | null
  icon: 'shot' | 'save' | 'corner' | 'throw' | 'foul' | 'offside' | 'card-y' | 'card-r' | 'sub' | 'goal' | 'var' | 'whistle' | 'free'
  text: string
  important: boolean
}

function who(world: WorldIndex, id: unknown): string {
  if (typeof id !== 'string') return ''
  const p = world.players.get(id)
  return p ? p.family_name : ''
}

function short(world: WorldIndex, teamId: string | null | undefined): string {
  if (!teamId) return ''
  return world.teams.get(teamId)?.short_name ?? teamId
}

/** One plain line per routine event. Passes, carries and pressures are left out: they are not commentary. */
export function logRow(ev: MatchEvent, world: WorldIndex): LogRow | null {
  const p = ev.payload as Record<string, unknown>
  const base = { id: ev.event_id, clock: ev.display_clock ?? '', atMs: ev.elapsed_ms, teamId: ev.team_id ?? null }
  const name = who(world, ev.player_id)
  const team = short(world, ev.team_id)
  switch (ev.type) {
    case 'shot': {
      const outcome = typeof p.outcome === 'string' ? p.outcome.replace(/_/g, ' ') : ''
      return { ...base, icon: 'shot', text: `Shot · ${name || team}${outcome ? `, ${outcome}` : ''}`, important: false }
    }
    case 'save':
      return { ...base, icon: 'save', text: `Save · ${name || team}`, important: false }
    case 'restart.awarded': {
      const r = String(p.restart_type ?? '')
      // an official award has no acting team: the team it goes to is in the payload
      const to = ev.team_id ?? (typeof p.awarded_to_team_id === 'string' ? p.awarded_to_team_id : null)
      const row = { ...base, teamId: to }
      if (r === 'corner') return { ...row, icon: 'corner', text: `Corner · ${short(world, to)}`, important: false }
      if (r === 'throw_in') return { ...row, icon: 'throw', text: `Throw-in · ${short(world, to)}`, important: false }
      // free kicks follow a foul or an offside, which already have their own line
      if (r === 'penalty_kick' || r === 'penalty') return { ...row, icon: 'free', text: `Penalty · ${short(world, to)}`, important: true }
      return null
    }
    case 'foul.committed':
      return { ...base, icon: 'foul', text: `Foul · ${name || team}`, important: false }
    case 'offside.offence_confirmed':
      return { ...base, icon: 'offside', text: `Offside · ${name || team}`, important: false }
    case 'card.yellow':
      return { ...base, icon: 'card-y', text: `Yellow card · ${name}`, important: true }
    case 'card.second_yellow':
    case 'card.red':
      return { ...base, icon: 'card-r', text: `Sent off · ${name}`, important: true }
    case 'substitution':
      return {
        ...base,
        icon: 'sub',
        text: `${team} change · ${who(world, p.player_on_id)} on, ${who(world, p.player_off_id)} off`,
        important: true,
      }
    case 'goal.confirmed':
      return { ...base, icon: 'goal', text: `Goal · ${name} (${team})`, important: true }
    case 'goal.disallowed':
      return { ...base, icon: 'var', text: `Goal ruled out · ${team}`, important: true }
    case 'var.review_started':
      return { ...base, icon: 'var', text: 'VAR check', important: true }
    case 'period.started':
      return { ...base, icon: 'whistle', text: ev.period === 'H2' ? 'Second half under way' : 'Kick-off', important: false }
    case 'period.ended':
      return { ...base, icon: 'whistle', text: ev.period === 'H1' ? 'Half-time' : 'Full-time', important: false }
    default:
      return null
  }
}

export function routineLog(events: readonly MatchEvent[], world: WorldIndex, limit = 40): LogRow[] {
  const rows: LogRow[] = []
  for (let i = events.length - 1; i >= 0 && rows.length < limit; i -= 1) {
    const row = logRow(events[i]!, world)
    if (row) rows.push(row)
  }
  return rows
}

// ---------------------------------------------------------------- statistics

export interface StatRow {
  key: string
  label: string
  home: number
  away: number
  /** Shown as a percentage (passing accuracy). */
  percent?: boolean
}

type TeamStats = Record<string, number | undefined>

function n(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0
}

/**
 * Match statistics up to the playhead. Team totals come from the official match state; cards and
 * substitutions are counted from the key events (which are never trimmed). Stats missing from the
 * state are omitted rather than shown as zero.
 */
export function statRows(state: MatchState | null, keyEvents: readonly MatchEvent[], homeId: string, awayId: string): StatRow[] {
  const stats = (state?.stats ?? {}) as Record<string, TeamStats>
  const h = stats[homeId] ?? {}
  const a = stats[awayId] ?? {}
  const rows: StatRow[] = []
  const add = (key: string, label: string) => {
    if (h[key] === undefined && a[key] === undefined) return
    rows.push({ key, label, home: n(h[key]), away: n(a[key]) })
  }
  add('shots', 'Shots')
  add('shots_on_target', 'On target')
  add('saves', 'Saves')
  add('corners', 'Corners')
  add('fouls', 'Fouls')
  add('throw_ins', 'Throw-ins')
  add('offsides', 'Offsides')
  const count = (team: string, types: string[]) => keyEvents.filter((e) => e.team_id === team && types.includes(e.type)).length
  rows.push({ key: 'yellow', label: 'Yellow cards', home: count(homeId, ['card.yellow', 'card.second_yellow']), away: count(awayId, ['card.yellow', 'card.second_yellow']) })
  rows.push({ key: 'red', label: 'Sent off', home: count(homeId, ['card.second_yellow', 'card.red']), away: count(awayId, ['card.second_yellow', 'card.red']) })
  rows.push({ key: 'subs', label: 'Substitutions', home: count(homeId, ['substitution']), away: count(awayId, ['substitution']) })
  add('passes', 'Passes')
  if (h.passes !== undefined && a.passes !== undefined) {
    const pct = (s: TeamStats) => (n(s.passes) ? Math.round((100 * n(s.passes_completed)) / n(s.passes)) : 0)
    rows.push({ key: 'pass_pct', label: 'Pass accuracy', home: pct(h), away: pct(a), percent: true })
    const total = n(h.passes) + n(a.passes)
    if (total > 0) {
      const hp = Math.round((100 * n(h.passes)) / total)
      rows.push({ key: 'pass_share', label: 'Share of passes', home: hp, away: 100 - hp, percent: true })
    }
  }
  return rows
}
