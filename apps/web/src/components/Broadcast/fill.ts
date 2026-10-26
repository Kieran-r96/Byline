import type { WorldIndex } from '../../services/matchView'
import type { Decision, MatchEvent, MomentView, OverlayPacket, TacticalMoment } from '../../services/schemas'
import { heroNumber } from './formats'
import { familyOf } from './templates'
import type { Family, FieldKey, SourceKind } from './templates'

/**
 * Fill a graphic from verified data. The same result drives the on-air render and the inspector's
 * "Filled from verified data" list, so what the producer checks is exactly what is drawn.
 * Nothing here invents a value: every field is read from the packet, the official events, the team
 * sheet, the measured moment or the fictional history, and says which.
 */

export interface FillContext {
  world: WorldIndex
  /** Official key events so far (goals, disallowed goals, cards, substitutions). */
  events?: readonly MatchEvent[]
  decisions?: readonly Decision[]
  tactics?: Readonly<Record<string, TacticalMoment>>
  /** The drawable frame of a tactical moment, when loaded. */
  view?: MomentView | null
  /** The packet's facts were verified by Foundry agents (story graphics from insights). */
  foundryVerified?: boolean
  minuteOf?: (ms: number) => string
}

export interface FilledField {
  key: FieldKey
  value: string
  source: SourceKind
  /** The evidence id behind the value (an event, a moment, a signal, a player). */
  ref: string | null
}

export interface Kit {
  id: string
  name: string
  short: string
  code: string
  primary: string
  secondary: string
  number: string
}

export interface SubSide {
  id: string
  number: number | null
  given: string
  family: string
  position: string | null
}

export interface StatRow {
  key: string
  label: string
  home: number
  away: number
}

export interface Filled {
  family: Family
  fields: Partial<Record<FieldKey, FilledField>>
  /** The fields this family uses, in reading order. */
  order: FieldKey[]
  team: Kit | null
  home: Kit
  away: Kit
  player: { id: string | null; given: string; family: string; number: number | null; position: string | null } | null
  score: { home: number; away: number } | null
  sub: { on: SubSide | null; off: SubSide | null }
  rows: StatRow[]
  hero: string | null
  card: 'yellow' | 'second_yellow' | 'red' | null
  /** The on-air category word ("Goal", "Record", "Offside" ...). */
  tag: string
  /** The measured frame a tactical graphic draws its mini pitch from. */
  frame: MomentView | null
  /** A tactical graphic's measured facts, in the moment's own words and units. */
  observed: Array<{ label: string; value: number | string; unit: string }>
  /** The tactical moment's kind ('shape_change' draws the measured shape shift). */
  kind: string | null
}

const NEUTRAL: Kit = { id: '', name: '', short: '', code: '', primary: '#3b4a57', secondary: '#dfe5ea', number: '#ffffff' }

function kitOf(world: WorldIndex, teamId: string | null | undefined): Kit | null {
  const t = teamId ? world.teams.get(teamId) : undefined
  if (!t) return null
  return { id: t.team_id, name: t.name, short: t.short_name, code: t.code, primary: t.kit.primary, secondary: t.kit.secondary, number: t.kit.number }
}

/** A team named in free text (records often carry no team id). */
function kitInText(world: WorldIndex, text: string): Kit | null {
  for (const id of [world.homeId, world.awayId]) {
    const t = world.teams.get(id)
    if (t && (text.includes(t.short_name) || text.includes(t.name))) return kitOf(world, id)
  }
  return null
}

function scoreIn(text: string): { home: number; away: number } | null {
  const m = text.match(/(\d+)\s*[–-]\s*(\d+)/)
  return m ? { home: Number(m[1]), away: Number(m[2]) } : null
}

function fmt(v: unknown): string {
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(1)
  return String(v ?? '')
}

function playerOf(world: WorldIndex, id: string | null | undefined) {
  const p = id ? world.players.get(id) : undefined
  return p ? { id: p.player_id, given: p.given_name, family: p.family_name, number: p.shirt_number, position: p.position } : null
}

/** The first one or two sentences of an official "what changes" line, without BYLINE's own housekeeping. */
function correctedState(text: string): string {
  const sentences = text.match(/[^.]+\.?/g)?.map((s) => s.trim()).filter(Boolean) ?? []
  return sentences
    .filter((s) => !/stories|withdrawn/i.test(s))
    .slice(0, 2)
    .join(' ')
}

function cardOf(kind: string): Filled['card'] {
  const k = kind.toUpperCase()
  if (k.includes('SECOND YELLOW')) return 'second_yellow'
  if (k.includes('RED')) return 'red'
  if (k.includes('YELLOW')) return 'yellow'
  return null
}

function sentence(word: string): string {
  const w = word.trim().toLowerCase()
  return w.charAt(0).toUpperCase() + w.slice(1)
}

/** Both teams' kits from the team sheet (a neutral slate when the world has not loaded). */
export function teamKits(world: WorldIndex): { home: Kit; away: Kit } {
  return {
    home: kitOf(world, world.homeId) ?? { ...NEUTRAL, id: world.homeId, short: world.homeId, code: world.homeId, name: world.homeId },
    away: kitOf(world, world.awayId) ?? { ...NEUTRAL, id: world.awayId, short: world.awayId, code: world.awayId, name: world.awayId },
  }
}

export function fillGraphic(p: OverlayPacket, ctx: FillContext): Filled {
  const { world } = ctx
  const family = familyOf(p.template_id)
  const { home, away } = teamKits(world)
  const fields: Partial<Record<FieldKey, FilledField>> = {}
  const put = (key: FieldKey, value: string | null | undefined, source: SourceKind, ref: string | null) => {
    if (value != null && value !== '') fields[key] = { key, value, source, ref }
  }
  const minute = ctx.minuteOf ? ctx.minuteOf(p.match_elapsed_ms) : null
  const firstEvent = p.source_event_ids[0] ?? null
  const out: Filled = {
    family,
    fields,
    order: [],
    team: kitOf(world, p.team_id),
    home,
    away,
    player: null,
    score: null,
    sub: { on: null, off: null },
    rows: [],
    hero: null,
    card: null,
    tag: '',
    frame: null,
    observed: [],
    kind: null,
  }
  const putKit = (k: Kit | null) => k && put('kit', `${k.name} · ${k.primary} / ${k.secondary}`, 'teamsheet', k.id)

  switch (family) {
    case 'spotlight': {
      const ev = ctx.events?.find((e) => e.event_id === p.source_id)
      const pl = playerOf(world, p.player_ids[0])
      const fallbackName = p.subtitle.replace(/\s*\d+(\+\d+)?['’]\s*$/, '').trim()
      out.player = pl ?? { id: null, given: '', family: fallbackName, number: null, position: null }
      out.score = scoreIn(p.title)
      out.tag = 'Goal'
      const clock = ev?.display_clock ?? p.subtitle.match(/(\d+(?:\+\d+)?['’])\s*$/)?.[1] ?? minute
      // goals by this player so far, from the official log; a disallowed goal does not count
      const voided = new Set((ctx.events ?? []).filter((e) => e.type === 'goal.disallowed').map((e) => String(e.payload.goal_event_id ?? '')))
      const at = ev?.elapsed_ms ?? p.match_elapsed_ms
      const goals = (ctx.events ?? []).filter((e) => e.type === 'goal.provisional' && e.player_id === p.player_ids[0] && e.elapsed_ms <= at && !voided.has(e.event_id))
      const count = Math.max(1, goals.length)
      put('player', pl ? `${pl.given} ${pl.family}` : fallbackName, 'official', p.source_id)
      put('number', pl ? String(pl.number) : null, 'teamsheet', pl?.id ?? null)
      put('score', p.title.replace(/^GOAL\s*·\s*/i, ''), 'official', p.source_id)
      put('clock', clock, 'official', p.source_id)
      put('metric', `${count} ${count === 1 ? 'goal' : 'goals'} in this match`, 'counted', goals.map((g) => g.event_id).join(', ') || p.source_id)
      putKit(out.team)
      out.order = ['player', 'number', 'score', 'clock', 'metric', 'kit']
      break
    }
    case 'breakthrough': {
      const m = ctx.tactics?.[p.source_id] ?? ctx.view ?? null
      out.tag = m?.label ?? 'Tactics'
      out.frame = ctx.view && ctx.view.moment_id === p.source_id ? ctx.view : null
      const obs = (m?.observed ?? []) as Array<Record<string, unknown>>
      out.kind = m?.kind ?? null
      out.observed = obs
        .filter((o) => typeof o.value === 'number' || typeof o.value === 'string')
        .slice(0, 3)
        .map((o) => ({ label: String(o.label ?? ''), value: o.value as number | string, unit: String(o.unit ?? '') }))
      const facts = obs.slice(0, 2).map((o) => `${String(o.label ?? '')} ${fmt(o.value)}${o.unit ? ` ${String(o.unit)}` : ''}`.trim())
      const metric = facts.length === 2 && facts.join(' · ').length <= 78 ? facts.join(' · ') : (facts[0] ?? p.subtitle)
      // the moment's own measured title reads better on air than the short queue label, when it fits
      put('headline', m && m.title.length <= 64 ? m.title : p.title, 'measured', p.source_id)
      put('metric', metric, 'measured', p.source_id)
      const w = ctx.view?.whatif
      const open = w?.alternatives.find((a) => a.rating === 'open')
      const name = (id: string | null | undefined) => (id ? (world.players.get(id)?.family_name ?? id) : '')
      const lane = w
        ? `${w.actual.outcome ? `Played pass ${w.actual.outcome}` : 'Played pass'}${open ? ` · open lane to ${name(open.receiver_id)}, ${open.lane_clearance_m.toFixed(1)} m clear` : ''}`
        : ctx.view
          ? 'Event arrows on the frozen frame'
          : null
      put('lane', lane, 'measured', p.source_id)
      put('clock', m?.display_clock ?? minute, 'official', m?.evidence_event_ids?.[0] ?? firstEvent)
      putKit(out.team)
      out.order = ['headline', 'metric', 'lane', 'clock', 'kit']
      break
    }
    case 'milestone': {
      const data = (p.data ?? {}) as { kind?: string; rule?: string; text?: string }
      const text = `${p.title} ${p.subtitle}`
      out.hero = heroNumber(text)
      const pl = playerOf(world, p.player_ids[0])
      out.player = pl
      out.team = out.team ?? (pl ? kitOf(world, world.players.get(pl.id ?? '')?.team_id) : null) ?? kitInText(world, text)
      const kind = data.kind ?? (/milestone/i.test(p.title) ? 'milestone' : 'record')
      out.tag = sentence(kind)
      const headline = p.title.includes(' ') ? p.title : null
      put('headline', headline, 'history', p.source_id)
      put('strap', p.subtitle, 'history', p.source_id)
      put('metric', out.hero, 'history', p.source_id)
      put('player', pl ? `${pl.given} ${pl.family}` : null, 'teamsheet', pl?.id ?? null)
      put('rule', data.rule || null, 'history', p.source_id)
      putKit(out.team)
      out.order = ['metric', 'headline', 'strap', 'player', 'rule', 'kit']
      break
    }
    case 'change': {
      const data = (p.data ?? {}) as { on?: { id?: string; number?: number; name?: string }; off?: { id?: string; number?: number; name?: string }; clock?: string }
      const side = (s: typeof data.on): SubSide | null => {
        if (!s) return null
        const pl = playerOf(world, s.id)
        const [given, ...rest] = (s.name ?? '').split(' ')
        return { id: s.id ?? '', number: s.number ?? pl?.number ?? null, given: pl?.given ?? given ?? '', family: pl?.family ?? rest.join(' '), position: pl?.position ?? null }
      }
      out.sub = { on: side(data.on), off: side(data.off) }
      out.tag = 'Substitution'
      const team = p.team_id ? world.teams.get(p.team_id) : undefined
      const on = out.sub.on
      const off = out.sub.off
      put('team', team?.name ?? null, 'official', p.source_id)
      put('on', on ? `${on.number ?? ''} ${on.given} ${on.family}`.trim() : null, 'official', p.source_id)
      put('off', off ? `${off.number ?? ''} ${off.given} ${off.family}`.trim() : null, 'official', p.source_id)
      put('clock', data.clock ?? minute, 'official', p.source_id)
      if (team && on?.position && off?.position) {
        const like = on.position === off.position ? `like for like (${on.position})` : `${on.position} on for ${off.position}`
        put('shape', `${team.formation} at kick-off · ${like}`, 'teamsheet', team.team_id)
      }
      putKit(out.team)
      out.order = ['team', 'on', 'off', 'clock', 'shape', 'kit']
      break
    }
    case 'comparison': {
      const data = (p.data ?? {}) as { label?: string; rows?: StatRow[] }
      out.rows = data.rows ?? []
      out.score = scoreIn(p.title)
      out.tag = data.label ?? sentence(p.title.split('·')[0] ?? 'Match stats')
      put('headline', out.tag, 'official', null)
      put('score', p.title.split('·')[1]?.trim() ?? null, 'official', null)
      put(
        'rows',
        out.rows.length ? out.rows.slice(0, 3).map((r) => `${r.label} ${r.home}–${r.away}`).join(' · ') + (out.rows.length > 3 ? ` · +${out.rows.length - 3} more` : '') : null,
        'counted',
        null,
      )
      put('kit', `${home.short} ${home.primary} · ${away.short} ${away.primary}`, 'teamsheet', `${home.id}, ${away.id}`)
      out.order = ['headline', 'score', 'rows', 'kit']
      break
    }
    case 'decision': {
      const d = ctx.decisions?.find((x) => x.decision_id === p.source_id)
      const [call, law] = p.subtitle.split(' · ')
      out.card = cardOf(p.title)
      out.tag = sentence(p.title)
      const pl = playerOf(world, d?.player_id ?? p.player_ids[0])
      out.player = pl
      const ruleTitle = d?.which_rule[0]?.title ?? law ?? null
      put('decision', p.title, 'official', d?.source_event_ids.join(', ') ?? firstEvent)
      put('strap', d?.reason ?? call ?? null, 'official', d?.decision_id ?? p.source_id)
      put('rule', ruleTitle, 'official', d?.ruleset_version ?? 'IFAB Laws of the Game')
      put('corrected', d ? correctedState(d.what_changes) || d.decision : call ?? null, 'official', d?.decision_id ?? p.source_id)
      put('player', pl ? `${pl.number} ${pl.given} ${pl.family}` : null, 'teamsheet', pl?.id ?? null)
      put('clock', d?.clock ?? minute, 'official', firstEvent)
      putKit(out.team)
      out.order = ['decision', 'strap', 'rule', 'corrected', 'player', 'clock', 'kit']
      break
    }
    default: {
      out.team = out.team ?? kitInText(world, `${p.title} ${p.subtitle}`)
      out.tag = 'Story'
      const source: SourceKind = ctx.foundryVerified ? 'foundry' : 'measured'
      put('headline', p.title, source, p.source_id)
      put('strap', p.subtitle, source, p.source_id)
      put('clock', minute, 'official', firstEvent)
      putKit(out.team)
      out.order = ['headline', 'strap', 'clock', 'kit']
    }
  }
  return out
}

/** The filled fields in reading order (only those that have a value). */
export function filledList(f: Filled): FilledField[] {
  return f.order.map((k) => f.fields[k]).filter((x): x is FilledField => !!x)
}
