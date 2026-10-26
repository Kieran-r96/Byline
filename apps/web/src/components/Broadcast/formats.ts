import type { Filled, Kit } from './fill'
import { FORMAT_IDS, SOURCE_DOT } from './templates'
import type { FormatId, GraphicTemplate, SourceKind } from './templates'

/** The record's hero number: an ordinal ("100th") first, else the largest count. Scorelines ("1-0") and seasons never count. */
export function heroNumber(text: string): string | null {
  const clean = text.replace(/\d+\s*[-–/]\s*\d+/g, ' ')
  const ordinal = clean.match(/(\d+)(st|nd|rd|th)(?![a-z])/)
  if (ordinal) return ordinal[1]! + ordinal[2]!
  const counts = [...clean.matchAll(/\d+/g)].map((m) => Number(m[0])).filter((n) => n >= 2 && n < 1900)
  return counts.length ? String(Math.max(...counts)) : null
}

// ---------------------------------------------------------------- formats (lower third, corner box, player spotlight, full frame)

/** Whether each format can carry this graphic: null when it can, else the reason it cannot (shown to the producer). */
export function formatAvailability(f: Filled): Record<FormatId, string | null> {
  return {
    lower: f.family === 'comparison' ? 'A stats panel needs the corner box or a full frame' : null,
    pip: null,
    spotlight: spotlightSubject(f) ? null : 'No named player on this graphic',
    full: null,
  }
}

/** The format a graphic airs in: the producer's pick when the graphic can carry it, else the template's default. */
export function resolveFormat(f: Filled, t: GraphicTemplate, picked?: FormatId | null): FormatId {
  const ok = formatAvailability(f)
  if (picked && ok[picked] === null) return picked
  const fallback = t.defaultFormat[f.family]
  return ok[fallback] === null ? fallback : (FORMAT_IDS.find((id) => ok[id] === null) ?? 'pip')
}

/**
 * The layout the frame draws. A tactical breakdown in full-screen analysis with its animated clip under
 * the picture keeps the telestration plate as a lower third over the clip.
 */
export function frameFormat(filled: Filled, template: GraphicTemplate, picked: FormatId | null | undefined, clip: boolean): FormatId {
  const fmt = resolveFormat(filled, template, picked)
  return fmt === 'full' && clip && filled.family === 'breakthrough' ? 'lower' : fmt
}

export interface Subject {
  kit: Kit | null
  number: number | null
  given: string
  family: string
  position: string | null
  /** Why this player is in the spotlight, in a word or two. */
  role: string
}

/** The player a spotlight is about: the scorer, the player coming on, the record holder or the player in a decision. */
export function spotlightSubject(f: Filled): Subject | null {
  if (f.family === 'change' && f.sub.on) {
    const s = f.sub.on
    return { kit: f.team, number: s.number, given: s.given, family: s.family, position: s.position, role: 'Coming on' }
  }
  if ((f.family === 'spotlight' || f.family === 'milestone' || f.family === 'decision') && f.player?.family) {
    const p = f.player
    return { kit: f.team, number: p.number, given: p.given, family: p.family, position: p.position, role: f.family === 'spotlight' ? 'Goal' : f.tag }
  }
  return null
}

export interface OnAirFact {
  key: string
  label: string
  value: string
  /** The provenance colour of the value (measured teal, verified amber, history). */
  tone: 'measured' | 'ai' | 'history'
}

const toneOf = (s: SourceKind) => SOURCE_DOT[s]
const num = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1))

/** The verified facts a larger format lists, in reading order, each with its provenance tone. */
export function onAirFacts(f: Filled): OnAirFact[] {
  const out: OnAirFact[] = []
  const add = (key: keyof Filled['fields'], label: string) => {
    const field = f.fields[key]
    if (field?.value) out.push({ key, label, value: field.value, tone: toneOf(field.source) })
  }
  switch (f.family) {
    case 'spotlight':
      add('score', 'Score')
      add('clock', 'Minute')
      add('metric', 'This match')
      break
    case 'breakthrough':
      f.observed.forEach((o, i) => {
        const signed = f.kind === 'shape_change' && typeof o.value === 'number' && o.value > 0 ? '+' : ''
        const v = typeof o.value === 'number' ? num(o.value) : o.value
        out.push({ key: `obs${i}`, label: o.label, value: `${signed}${v}${o.unit ? ` ${o.unit}` : ''}`, tone: 'measured' })
      })
      if (!f.observed.length) add('metric', 'Measured')
      if (f.kind !== 'shape_change') add('lane', 'On the frozen frame')
      break
    case 'milestone':
      add('strap', f.tag || 'Record')
      add('rule', 'Rule')
      add('player', 'Player')
      break
    case 'change':
      add('on', 'On')
      add('off', 'Off')
      add('shape', 'Shape')
      break
    case 'comparison':
      for (const r of f.rows.slice(0, 6)) out.push({ key: r.key, label: r.label, value: `${r.home}–${r.away}`, tone: 'measured' })
      break
    case 'decision':
      add('strap', 'Call')
      add('rule', 'Law')
      add('corrected', 'What changes')
      break
    default:
      add('strap', 'Detail')
  }
  return out
}

/** The kicker, title and clock a larger format leads with. */
export function heading(f: Filled, t: GraphicTemplate): { kicker: string; title: string; clock: string | null } {
  const clock = f.fields.clock?.value ?? null
  const team = (k: Kit) => (t.layout.teamLabel === 'code' ? k.code : k.short)
  const line = f.score ? `${team(f.home)} ${f.score.home}–${f.score.away} ${team(f.away)}` : null
  switch (f.family) {
    case 'spotlight':
      return { kicker: line ? `Goal · ${line}` : 'Goal', title: [f.player?.given, f.player?.family].filter(Boolean).join(' '), clock }
    case 'breakthrough':
      return { kicker: `${f.tag} · measured`, title: f.fields.headline?.value ?? f.tag, clock }
    case 'milestone': {
      // a record's own sentence is its fact; the title is a short headline when there is one, else who it is about
      const head = f.fields.headline?.value
      const short = head && head.length <= 56 && head !== f.fields.strap?.value ? head : null
      const who = f.player ? [f.player.given, f.player.family].filter(Boolean).join(' ') : (f.team?.name ?? null)
      return { kicker: f.tag, title: short ?? who ?? f.tag, clock: null }
    }
    case 'change': {
      const on = f.sub.on?.family
      const off = f.sub.off?.family
      return { kicker: f.team ? `Substitution · ${f.team.name}` : 'Substitution', title: on && off ? `${on} on, ${off} off` : f.tag, clock }
    }
    case 'comparison':
      return { kicker: f.tag, title: line ?? f.tag, clock: null }
    case 'decision':
      return { kicker: /disallowed|var/i.test(f.fields.decision?.value ?? '') ? 'VAR decision' : 'Referee decision', title: f.tag, clock }
    default:
      return { kicker: 'Story', title: f.fields.headline?.value ?? '', clock }
  }
}

/** Where the graphic's facts come from, as a single on-air credit line. */
export function sourceLine(f: Filled): string {
  switch (f.family) {
    case 'spotlight':
      return 'Official match events · team sheet'
    case 'breakthrough':
      return 'Measured from 2 Hz player tracking'
    case 'milestone':
      return 'Fictional history · rule attached'
    case 'change':
      return 'Official substitution · team sheet'
    case 'comparison':
      return 'Counted from the official match events'
    case 'decision':
      return 'Official decision · IFAB Laws of the Game'
    default:
      return f.fields.headline?.source === 'foundry' ? 'Verified analysis' : 'Measured from the match data'
  }
}

/** A measured shape change, read from a 'shape_change' moment's three observed deltas (metres, after minus before). */
export function shapeShift(f: Filled): Array<{ label: string; delta: number; word: string }> {
  if (f.kind !== 'shape_change') return []
  const words: Array<[RegExp, string, string, string]> = [
    [/back-line/i, 'Back line', 'higher', 'deeper'],
    [/length/i, 'Team length', 'longer', 'shorter'],
    [/width/i, 'Team width', 'wider', 'narrower'],
  ]
  return f.observed
    .filter((o): o is { label: string; value: number; unit: string } => typeof o.value === 'number')
    .map((o) => {
      const w = words.find(([re]) => re.test(o.label))
      const d = o.value
      return { label: w?.[1] ?? o.label, delta: d, word: Math.abs(d) < 0.05 ? 'unchanged' : d > 0 ? (w?.[2] ?? 'up') : (w?.[3] ?? 'down') }
    })
}
