import type { WorldIndex } from './matchView'
import type { MomentView } from './schemas'
import { buildStageModel, directionSpot, fmt0, fmt1, fullName, isWindowKind, PITCH_LENGTH, PITCH_WIDTH } from './stageModel'
import type { Audience, StageModel, Vec2 } from './stageModel'

/**
 * The guided telestration script: up to seven steps over one frozen frame, one idea per step.
 *
 *   freeze        who is on the ball, which way they attack
 *   situation     the defending lines and who stands where
 *   happened      what actually happened (the real pass), on its own
 *   measured      the measured lanes on the same frame (the comparison step: the real pass stays, dimmed)
 *   hypothetical  one alternative, lilac and dashed, labelled "not what happened"
 *   continuation  "Then?": a simulated next action from that receiver's frozen spot (lilac, dotted)
 *   illustrative  "Then?" when the payload carries an illustrative sketch (ADR 10): the supporting run and the
 *                 defenders' response, as translucent ghost shirts on dotted trails (replaces `continuation`)
 *   illustrativeBall  "The ball in": the delivery and who could block or reach it first (still illustrative)
 *   takeaway      one plain sentence, the interpretation and what the data cannot tell us
 *
 * Every caption is assembled only from the MomentView (observed values, names, summary,
 * interpretation, unknowns, What If? labels and measurements) and the match world (names).
 * Nothing here invents an outcome, a probability or an intention.
 */

export type StageStepId = 'freeze' | 'situation' | 'happened' | 'measured' | 'hypothetical' | 'continuation' | 'illustrative' | 'illustrativeBall' | 'takeaway'

/** Visual layers a step can switch on. Each renderer maps these to its own drawing. */
export type StageLayer =
  | 'direction'
  | 'carrier'
  | 'focus'
  | 'lines'
  | 'gap'
  | 'between'
  | 'offside'
  | 'laneOpponents'
  | 'actualPass'
  | 'alternatives'
  | 'hypothetical'
  | 'bypassed'
  | 'evidence'
  | 'zone'
  | 'shape'
  | 'choices'
  /** Simulated continuation: the receiver assumed on the ball (marker + tag). */
  | 'contFrom'
  /** Simulated continuation: next pass(es), dotted lilac. */
  | 'contPass'
  /** Simulated continuation: the shooting window, a translucent triangle to the posts. */
  | 'contShot'
  /** Simulated continuation: the cross, a dotted arc into the box. */
  | 'contCross'
  /** The measured lane to the best alternative only (teal), for the takeaway beside the real pass. */
  | 'bestLane'
  /** Illustrative: the alternative receiver assumed on the ball (marker + tag). */
  | 'illFrom'
  /** Illustrative: the supporting run (ghost shirt along a dotted trail). */
  | 'illRun'
  /** Illustrative: the defenders' response (ghost shirts along dotted trails). */
  | 'illDefend'
  /** Illustrative: the ghost shirts standing where the sketch left them (no trails). */
  | 'illGhosts'
  /** Illustrative: the ball in (a dotted arc). */
  | 'illBall'
  /** Illustrative: who could block it or reach the delivery point first. */
  | 'illContest'

/** Layers that draw a pass-like arrow or a movement trail (for the per-step arrow budget). */
export const ARROW_LAYERS: readonly StageLayer[] = ['actualPass', 'alternatives', 'hypothetical', 'evidence', 'contPass', 'contCross', 'bestLane', 'illRun', 'illDefend', 'illBall']
/** Layers that draw something imagined (hypothetical, simulated or illustrative): never on screen with the real pass. */
export const IMAGINED_LAYERS: readonly StageLayer[] = ['hypothetical', 'contFrom', 'contPass', 'contShot', 'contCross', 'illFrom', 'illRun', 'illDefend', 'illGhosts', 'illBall', 'illContest']
/** Most player names on screen in one step (the step's idea, not a roll call). */
export const MAX_NAMES = 4

/** Autoplay never advances faster than this, whatever the caption length. */
export const STEP_MIN_MS = 7000
/** The scene reveals a step's new layers one at a time, one per beat. */
export const LAYER_BEAT_MS = 1150
const FLIGHT_BUDGET_MS = 1400

export interface StageCamera {
  /** Pitch metres the camera looks at. */
  target: Vec2
  /** Metres from the target at a 16:10 frame; the renderer pulls back further when `fit` needs it. */
  distance: number
  /** Degrees from straight down (0 = top-down, 90 = pitch level). */
  polar: number
  /** Degrees around the target: 0 = the main broadcast camera on the near touchline; negative swings towards x = 0. */
  azimuth: number
  /** World points that must stay in frame. */
  fit: Vec2[]
}

export interface StageStep {
  id: StageStepId
  /** 1-based position in this script. */
  n: number
  title: string
  caption: string
  /** Shown as a list under the caption (the uncertainty step). */
  notes: string[]
  /** Layers on, in reveal order: each fades in after the previous one. */
  layers: StageLayer[]
  /** Layers kept but quietened (context from an earlier step). */
  dim: StageLayer[]
  camera: StageCamera
  focusIds: string[]
  /** How long optional autoplay holds this step (>= STEP_MIN_MS); 0 when the step never auto-advances. */
  durationMs: number
  /** A plate that must stay on screen for the whole step (the hypothetical or simulated label). */
  banner: string | null
  /** Measured values shown as a broadcast stat plate (exactly as observed; pro audience). */
  stats: Array<{ label: string; value: string }>
  /** The last step's one-sentence takeaway in plain football language; null on every other step. */
  takeaway: string | null
}

/** A step before numbering and pacing; stats default to none (filled in by buildScript). */
type Draft = Omit<StageStep, 'n' | 'stats' | 'durationMs' | 'takeaway'> & { stats?: StageStep['stats']; takeaway?: string | null }

const dirWords = (d: '+x' | '-x') => (d === '+x' ? 'left to right' : 'right to left')

function readingMs(caption: string, notes: string[] = []): number {
  const words = `${caption} ${notes.join(' ')}`.split(/\s+/).filter(Boolean).length
  return Math.max(3500, Math.min(11000, 1800 + words * 260))
}

/**
 * How long autoplay holds a step: the camera flight and every layer's reveal, then time to read,
 * and never less than STEP_MIN_MS. Manual Next is the default; this only paces optional auto-advance.
 */
function paceMs(caption: string, notes: string[], layers: number): number {
  const reveal = FLIGHT_BUDGET_MS + layers * LAYER_BEAT_MS
  return Math.round(Math.min(20000, Math.max(STEP_MIN_MS, reveal + 2600, readingMs(caption, notes) + 1500)))
}

function bbox(points: Vec2[]): { cx: number; cy: number; w: number; h: number } {
  const xs = points.map((p) => p[0])
  const ys = points.map((p) => p[1])
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)
  return { cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, w: maxX - minX, h: maxY - minY }
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

/** Camera looking at the box around `points`, never closer than `minDistance`. */
function frame(points: Vec2[], polar: number, minDistance: number, pad = 4, azimuth = 0): StageCamera {
  const pts = points.length ? points : [[PITCH_LENGTH / 2, PITCH_WIDTH / 2] as Vec2]
  const b = bbox(pts)
  // a 30 degree vertical lens at 16:10 spans ~0.86 x distance across
  const across = (Math.max(b.w + pad * 2, (b.h + pad * 2) * 1.25) / 0.86)
  return {
    target: [clamp(b.cx, 0, PITCH_LENGTH), clamp(b.cy, 0, PITCH_WIDTH)],
    distance: Math.round(clamp(Math.max(minDistance, across), minDistance, 150)),
    polar,
    azimuth,
    fit: pts.map((p): Vec2 => [clamp(p[0], -2, PITCH_LENGTH + 2), clamp(p[1], -2, PITCH_WIDTH + 2)]),
  }
}

const RATING_FAN: Record<string, string> = { open: 'a clear lane', contested: 'a tight lane', blocked: 'a blocked lane' }

function listJoin(items: string[]): string {
  if (items.length <= 1) return items.join('')
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}

function numberWord(n: number): string {
  return ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'][n] ?? String(n)
}

/** "S. Haddad-Rhys and K. Rennard both had clear lanes." Options grouped by rating, in everyday words. */
function fanOptionWords(m: StageModel, world: WorldIndex): string {
  const groups = new Map<string, string[]>()
  for (const o of m.options) groups.set(o.rating, [...(groups.get(o.rating) ?? []), fullName(world, o.receiverId)])
  const plural: Record<string, string> = { open: 'clear lanes', contested: 'tight lanes', blocked: 'blocked lanes' }
  return [...groups.entries()]
    .map(([rating, names]) =>
      names.length === 1
        ? `${names[0]} had ${RATING_FAN[rating] ?? 'a lane'}.`
        : `${listJoin(names)} ${names.length === 2 ? 'both ' : 'all '}had ${plural[rating] ?? 'lanes'}.`,
    )
    .join(' ')
}

function freezeStep(m: StageModel, world: WorldIndex, fan: boolean): Draft {
  const carrier = m.carrierId ? fullName(world, m.carrierId) : null
  const dir = dirWords(m.direction)
  const caption = carrier
    ? fan
      ? `${m.clock}. ${carrier} has the ball for ${m.teamName}, who are attacking ${dir}.`
      : `${m.clock}. ${carrier} on the ball for ${m.teamName}, attacking ${dir}. Frozen on the tracking frame.`
    : fan
      ? `${m.clock}. ${m.teamName} are attacking ${dir}. This is the moment, frozen.`
      : `${m.clock}. ${m.teamName} attacking ${dir}; the frozen tracking frame for this moment.`
  const focus = m.ball ?? m.origin ?? ([PITCH_LENGTH / 2, PITCH_WIDTH / 2] as Vec2)
  // the direction chevrons and their label must stay in shot (they sit just inside a touchline)
  const chev = directionSpot(m)
  const chevLabel: Vec2 = [chev[0], chev[1] < PITCH_WIDTH / 2 ? chev[1] - 6 : chev[1] + 5]
  // the player on the ball and the players around him (about a third of the pitch), not the whole pitch
  const around: Vec2[] = [[focus[0] - 18, focus[1]], [focus[0] + 18, focus[1]], [focus[0], focus[1] - 10], [focus[0], focus[1] + 10]]
  return {
    id: 'freeze',
    title: carrier ? (fan ? 'On the ball' : 'The decision') : 'The frame',
    caption,
    notes: [],
    layers: carrier ? ['direction', 'carrier'] : ['direction'],
    dim: [],
    camera: frame([...around, focus, chev, chevLabel], 52, 64, 4),
    focusIds: m.carrierId ? [m.carrierId] : [],
    banner: null,
  }
}

function situationStep(m: StageModel, view: MomentView, world: WorldIndex, fan: boolean): Draft {
  const parts: string[] = []
  const layers: StageLayer[] = []
  const pts: Vec2[] = []
  if (m.origin) pts.push(m.origin)
  if (m.lines) {
    layers.push('lines', 'gap')
    const ly = m.ball ? m.ball[1] : PITCH_WIDTH / 2
    pts.push([m.lines.mid, clamp(ly - 18, 2, 66)], [m.lines.back, clamp(ly + 18, 2, 66)], [m.lines.mid, m.labelY], [m.lines.back, m.labelY])
    parts.push(
      fan
        ? `${m.defendingName}'s defence and midfield are ${fmt0(m.lines.gap)} m apart.`
        : `${m.defendingName}'s back line and midfield line are ${fmt1(m.lines.gap)} m apart on this frame.`,
    )
  }
  if (m.betweenIds.length) {
    layers.push('between')
    for (const pid of m.betweenIds) {
      const p = m.players.find((x) => x.pid === pid)
      if (p) pts.push([p.x, p.y])
    }
    const n = m.betweenIds.length
    parts.push(
      fan
        ? `${numberWord(n).replace(/^\w/, (c) => c.toUpperCase())} ${m.teamName} player${n === 1 ? ' is' : 's are'} in the space between them.`
        : `${n} ${m.teamName} player${n === 1 ? '' : 's'} between the lines.`,
    )
  }
  if (m.laneOpponentIds.length && m.actual) {
    layers.push('laneOpponents')
    const k = m.laneOpponentIds.length
    const recv = fullName(world, m.actual.receiverId)
    parts.push(
      fan
        ? `${numberWord(k).replace(/^\w/, (c) => c.toUpperCase())} opponent${k === 1 ? ' is' : 's are'} standing near the pass to ${recv}.`
        : `${k} opponent${k === 1 ? '' : 's'} in the lane to ${recv} (ringed).`,
    )
  }
  if (m.zone) {
    layers.push('zone')
    pts.push([m.zone.centre[0] - m.zone.radius, m.zone.centre[1]], [m.zone.centre[0] + m.zone.radius, m.zone.centre[1]])
    if (m.zone.chip) parts.push(fan ? `Count the players near the ball: ${m.zone.chip.replace(' v ', ' against ')}.` : `${m.zone.chip} of the ball.`)
  }
  if (m.hull) {
    layers.push('shape', 'focus')
    pts.push(...m.hull.points)
    parts.push(
      view.kind === 'press'
        ? fan
          ? `${m.teamName}'s players on this frame, with the players hunting the ball marked.`
          : `${m.teamName}'s outfield shape on this frame; the players behind the high defensive actions are marked.`
        : fan
          ? `How ${m.teamName} were spread out on this frame.`
          : `${m.teamName}'s outfield shape on this frame.`,
    )
  }
  if (!parts.length) parts.push(fan ? (view.plain ?? view.title) : view.summary)
  const caption = parts.slice(0, 3).join(' ')
  return {
    id: 'situation',
    title: m.hull ? (fan ? 'The shape' : 'Shape on the frame') : fan ? 'The defence' : 'Their lines',
    caption,
    notes: [],
    layers: ['carrier', ...layers],
    dim: [],
    // lines read as walls from behind the attacking team; shapes read best from the side
    camera: frame(pts, m.lines && !m.hull ? 52 : 50, 74, 6, m.lines && !m.hull ? (m.direction === '+x' ? -30 : 30) : 0),
    // the idea here is the gap: players between the lines are ringed, not named (names come with the passes)
    focusIds: m.hull ? m.focusIds : [],
    banner: null,
  }
}

/** The published lane threshold for "open", read from the payload's own rules (falls back to 3 m). */
function openLaneM(view: MomentView): number {
  const n = Number(/lane >= ([\d.]+) m/.exec(view.whatif?.rules.open ?? '')?.[1])
  return Number.isFinite(n) && n > 0 ? n : 3
}

const cap = (s: string) => s.replace(/^\w/, (c) => c.toUpperCase())

/** What actually happened, on its own: the real pass and the opponents near its lane. */
function happenedStep(m: StageModel, world: WorldIndex, fan: boolean): Draft | null {
  if (!m.actual || !m.origin) return null
  const a = m.actual
  const carrier = m.carrierId ? fullName(world, m.carrierId) : 'The passer'
  const recv = fullName(world, a.receiverId)
  const icpt = a.interceptorId ? fullName(world, a.interceptorId) : null
  const k = m.laneOpponentIds.length
  const cut = a.outcome === 'intercepted' && icpt ? `${icpt} cut it out` : null
  const outcomePro = cut ? `intercepted by ${icpt}` : a.outcome
  const near = k ? `${cap(numberWord(k))} opponent${k === 1 ? ' was' : 's were'} near the lane` : ''
  const caption = fan
    ? `${carrier} tried the pass to ${recv}.${near || cut ? ` ${[near, cut].filter(Boolean).join(' and ')}.` : ''}`
    : `Pass to ${recv}: nearest opponent ${a.clearance !== null ? `${fmt1(a.clearance)} m` : 'unknown'} from the lane${a.rating ? ` (${a.rating})` : ''}${outcomePro ? `, ${outcomePro}` : ''}.`
  const pts: Vec2[] = [m.origin, a.to]
  for (const pid of [...m.laneOpponentIds, a.receiverId, a.interceptorId]) {
    const p = m.players.find((x) => x.pid === pid)
    if (p) pts.push([p.x, p.y])
  }
  return {
    id: 'happened',
    title: 'What happened',
    caption,
    notes: [],
    layers: ['carrier', 'laneOpponents', 'actualPass'],
    dim: [],
    camera: frame(pts, 46, 60, 9, m.direction === '+x' ? -10 : 10),
    focusIds: [...(a.receiverId ? [a.receiverId] : [])],
    banner: null,
  }
}

function measuredStep(m: StageModel, view: MomentView, world: WorldIndex, fan: boolean): Draft {
  const pts: Vec2[] = []
  if (m.origin) pts.push(m.origin)
  if (view.whatif && m.options.length) {
    // the comparison step: measured lanes on the same frame, the real pass kept but dimmed
    for (const o of m.options) {
      const r = Math.min(o.space, 8)
      pts.push(o.to, [o.to[0], o.to[1] - r], [o.to[0], o.to[1] + r])
    }
    if (m.actual) pts.push(m.actual.to)
    const optsPro = m.options.map((o) => `${fullName(world, o.receiverId)} ${fmt1(o.clearance)} m clear (${o.rating})`)
    const lead = m.actual ? 'Other passes were on.' : 'At that instant these passes were on.'
    const caption = fan
      ? `${lead} ${fanOptionWords(m, world)}`
      : `Measured lanes on the same frame: ${listJoin(optsPro)}${m.actual && m.actual.clearance !== null ? `; the pass played had ${fmt1(m.actual.clearance)} m` : ''}.`
    const layers: StageLayer[] = ['carrier', 'alternatives']
    if (m.lines && m.options.some((o) => o.offside)) layers.push('offside')
    return {
      id: 'measured',
      title: fan ? 'The passes on' : 'Measured options',
      caption,
      notes: [],
      layers,
      dim: m.actual ? ['actualPass'] : [],
      camera: frame(pts, 46, 70, 8, m.direction === '+x' ? -10 : 10),
      // option receivers are named by their lane chips
      focusIds: [],
      banner: null,
    }
  }
  // not a What If? moment: the measured action itself (evidence arrows) or the measured window
  for (const a of m.arrows) pts.push(a.from, a.to)
  for (const pid of m.focusIds) {
    const p = m.players.find((x) => x.pid === pid)
    if (p) pts.push([p.x, p.y])
  }
  if (m.hull) pts.push(...m.hull.points)
  if (m.zone) pts.push(m.zone.centre)
  const caption = fan ? (view.plain ?? view.title) : view.summary
  const layers: StageLayer[] = ['carrier']
  // a pass or carry past their lines is read against those lines
  const crossesLines = !!m.lines && m.arrows.length > 0 && ['line_break', 'between_lines', 'beaten', 'run'].includes(view.kind)
  if (crossesLines) layers.push('lines')
  if (m.arrows.length) layers.push('evidence')
  if (m.hull) layers.push('shape')
  layers.push('focus')
  return {
    id: 'measured',
    title: m.arrows.length ? 'What happened' : fan ? 'What we saw' : 'What we measured',
    caption,
    notes: [],
    layers,
    dim: m.lines && !crossesLines ? ['lines'] : [],
    camera: frame(pts, 50, 72, 8),
    focusIds: m.focusIds,
    banner: null,
  }
}

function hypotheticalStep(m: StageModel, view: MomentView, world: WorldIndex, fan: boolean): Draft | null {
  const w = view.whatif
  if (!w || !m.best || !m.origin) return null
  const b = m.best
  const who = fullName(world, b.receiverId)
  const caption = fan
    ? `Not what happened: another pass that was on. ${who} had ${RATING_FAN[b.rating] ?? 'a lane'}, ${fmt0(b.space)} m of space and was ${fmt0(b.progression)} m further forward.${m.continuation ? '' : ' Where it leads is unknown.'}`
    : `Hypothetical, not what happened: the lane to ${who} was ${fmt1(b.clearance)} m clear, with ${fmt1(b.space)} m of space, ${fmt0(b.progression)} m further forward and ${b.bypassed} opponents bypassed.`
  return {
    id: 'hypothetical',
    title: 'What if?',
    caption,
    notes: fan ? [] : [w.labels.hypothetical],
    // the real pass is not on screen here: this step shows the alternative on its own
    layers: ['carrier', 'hypothetical', 'bypassed'],
    dim: [],
    camera: frame([m.origin, b.to, [b.to[0], b.to[1] + Math.min(b.space, 10)], [b.to[0], b.to[1] - Math.min(b.space, 10)]], 44, 64, 6),
    focusIds: [b.receiverId],
    banner: m.labels.hypoBanner,
  }
}

/** "Then?": the simulated continuation from the hypothetical receiver's frozen spot, from the payload's numbers only. */
function continuationStep(m: StageModel, view: MomentView, world: WorldIndex, fan: boolean): Draft | null {
  const c = m.continuation
  if (!c || !m.best) return null
  const from = fullName(world, c.fromId)
  const clearLane = openLaneM(view)
  const parts: string[] = []
  const layers: StageLayer[] = ['contFrom']
  // headroom on the far side of the receiver for the "Simulated continuation" tag above their shirt
  const pts: Vec2[] = [c.from, [c.from[0], c.from[1] - 9]]
  const focus = new Set<string>([c.fromId])
  if (c.passes.length) {
    layers.push('contPass')
    for (const p of c.passes) {
      pts.push(p.to)
      focus.add(p.receiverId)
    }
    if (fan) {
      const each = c.passes.map((p) => {
        const lane = p.clearance >= clearLane ? 'a clear lane' : 'a tight lane'
        const marker = p.markerName ? `${fullName(world, p.markerId)} ${fmt0(p.space)} m away` : `${fmt0(p.space)} m of space`
        return `${fullName(world, p.receiverId)}: ${lane}, with ${marker}`
      })
      parts.push(`The next pass on from there: ${listJoin(each)}.`)
    } else {
      const each = c.passes.map(
        (p) => `${fullName(world, p.receiverId)} ${fmt1(p.distance)} m, lane ${fmt1(p.clearance)} m clear, space ${fmt1(p.space)} m (${p.rating}), ${p.progression >= 0 ? '+' : ''}${fmt1(p.progression)} m`,
      )
      parts.push(`Next pass${c.passes.length > 1 ? 'es' : ''}: ${listJoin(each)}.`)
    }
  }
  if (c.shot) {
    layers.push('contShot')
    const s = c.shot
    pts.push(s.posts[0], s.posts[1])
    const inWay = s.defenderIds.map((id) => fullName(world, id))
    const keeper = s.keeperId ? fullName(world, s.keeperId) : null
    parts.push(
      fan
        ? `There is sight of goal: ${fmt0(s.distance)} m out, with ${inWay.length ? `${inWay[0]} in the way` : 'no defender in the way'}${keeper && s.keeperInTriangle ? ` and ${keeper} covering` : ''}.`
        : `Shooting window: ${fmt1(s.distance)} m to the centre of the goal, goal mouth ${fmt1(s.angle)}° wide, ${inWay.length} outfield opponent${inWay.length === 1 ? '' : 's'} in the triangle${inWay.length ? ` (${listJoin(inWay)})` : ''}${keeper ? `; goalkeeper ${keeper} ${s.keeperInTriangle ? 'inside it' : 'outside it'}` : ''}.`,
    )
  }
  if (c.cross) {
    layers.push('contCross')
    const t = c.cross.targets
    for (const x of t) {
      pts.push(x.at)
      focus.add(x.pid)
    }
    const who = t.map((x) =>
      fan
        ? `${fullName(world, x.pid)}${x.markerDistance !== null ? ` (nearest defender ${fmt0(x.markerDistance)} m)` : ''}`
        : `${fullName(world, x.pid)}${x.markerDistance !== null ? ` (nearest marker ${fmt1(x.markerDistance)} m)` : ''}`,
    )
    parts.push(
      fan
        ? `From out wide a cross is on: ${listJoin(who)} in the box.`
        : `Crossing option from the ${c.cross.channel} channel: ${listJoin(who)} in the box.`,
    )
  }
  const lead = fan
    ? `Simulated, not what happened. Give ${from} the ball where they stood and freeze everyone else.`
    : `Simulated continuation from ${from}'s frozen spot, everyone else still.`
  const tail = fan ? 'How it ends is unknown.' : 'No outcome implied.'
  const caption = `${lead} ${parts.join(' ')} ${tail}`
  return {
    id: 'continuation',
    title: 'Then?',
    caption,
    notes: fan ? [] : [c.label],
    layers,
    // the hypothetical pass stays as quiet context: how the ball would get there is the step before
    dim: ['hypothetical'],
    camera: frame(pts, 46, 62, 8, m.direction === '+x' ? -8 : 8),
    focusIds: [...focus],
    banner: m.labels.contBanner,
  }
}

/** "Then?" when the payload carries an illustrative sketch: the supporting run and the defenders' response. */
function illustrativeStep(m: StageModel, world: WorldIndex, fan: boolean): Draft | null {
  const il = m.illustrative
  if (!il || !m.best) return null
  const recv = fullName(world, il.fromId)
  const runner = fullName(world, il.run.pid)
  const closer = il.defenders.find((d) => d.role === 'close')
  const tracker = il.defenders.find((d) => d.role === 'track')
  const parts: string[] = []
  if (fan) {
    parts.push(`Illustrative, not what happened. Say the pass reaches ${recv}.`)
    parts.push(`${runner} runs towards the box${il.run.heldOnside ? ', stopping level with the defence to stay onside' : ''}.`)
    const resp = [closer && `${fullName(world, closer.pid)} closes ${recv} down`, tracker && `${fullName(world, tracker.pid)} goes with ${runner}`].filter(Boolean)
    if (resp.length) parts.push(`${cap(listJoin(resp as string[]))}.`)
  } else {
    parts.push(`Illustrative, not what happened: rule-based moves from the frozen frame, with ${recv} assumed on the ball.`)
    parts.push(`${runner} runs ${fmt1(il.run.distance)} m${il.run.heldOnside ? ' and is held onside at the frozen line' : ' towards the penalty spot'}.`)
    const resp = [
      closer && `${fullName(world, closer.pid)} closes ${fmt1(closer.distance)} m to goal-side of ${recv}`,
      tracker && `${fullName(world, tracker.pid)} tracks ${runner} ${fmt1(tracker.distance)} m`,
    ].filter(Boolean)
    if (resp.length) parts.push(`${cap(listJoin(resp as string[]))}. Everyone else is held still.`)
  }
  const pts: Vec2[] = [il.from, il.run.from, il.run.to, ...il.defenders.flatMap((d) => [d.from, d.to]), [il.from[0], il.from[1] - 8]]
  return {
    id: 'illustrative',
    title: 'Then?',
    caption: parts.join(' '),
    notes: fan
      ? ['Sketched with simple rules: every player runs at the same speed, and everyone not moving stays where they were.']
      : [il.label, ...(il.speedsNote ? [`Assumed: ${il.speedsNote}.`] : [])],
    layers: ['illFrom', 'illRun', 'illDefend'],
    dim: [],
    camera: frame(pts, 46, 60, 7, m.direction === '+x' ? -8 : 8),
    focusIds: [il.fromId, il.run.pid, ...il.defenders.map((d) => d.pid)],
    banner: m.labels.illBanner,
  }
}

/** "The ball in": the delivery to the end of the run, and who could block it or get there first. */
function illustrativeBallStep(m: StageModel, world: WorldIndex, fan: boolean): Draft | null {
  const il = m.illustrative
  if (!il) return null
  const recv = fullName(world, il.fromId)
  const runner = fullName(world, il.run.pid)
  const block = il.contests.find((c) => c.kind === 'block')
  const first = il.contests.find((c) => c.kind === 'intercept')
  const parts: string[] = []
  if (fan) {
    parts.push(`Illustrative. ${recv} plays the ball in towards ${runner}.`)
    const who = [block && `${fullName(world, block.pid)} is close enough to block it`, first && `${fullName(world, first.pid)} could get there first`].filter(Boolean)
    parts.push(who.length ? `${cap(listJoin(who as string[]))}.` : 'Under these simple rules no defender gets there first.')
    parts.push('How it ends is unknown.')
  } else {
    parts.push(`Illustrative: the ball in from ${recv}'s spot, ${fmt1(il.delivery.distance)} m to the end of ${runner}'s run.`)
    if (block) parts.push(`${fullName(world, block.pid)} is ${fmt1(block.gap)} m from its path (a block).`)
    const reach = il.reachIds.map((id) => fullName(world, id))
    parts.push(reach.length ? `${listJoin(reach)} could reach the delivery point before the ball.` : 'No defender reaches the delivery point first under these rules.')
    parts.push('No outcome implied.')
  }
  const pts: Vec2[] = [il.delivery.from, il.delivery.to, ...il.contests.map((c) => c.at), il.run.to, [il.from[0], il.from[1] - 8]]
  // the defenders who could get to it are named by their own tags ("Could block it · Tremaine")
  const focus = new Set<string>([il.fromId, il.run.pid])
  return {
    id: 'illustrativeBall',
    title: 'The ball in',
    caption: parts.join(' '),
    notes: fan ? [] : [il.label],
    layers: ['illFrom', 'illGhosts', 'illBall', 'illContest'],
    dim: [],
    camera: frame(pts, 46, 60, 7, m.direction === '+x' ? -8 : 8),
    focusIds: [...focus],
    banner: m.labels.illBanner,
  }
}

/** The one-sentence takeaway: the view's plain line, else its first summary sentence. */
function takeawayLine(view: MomentView): string {
  if (view.plain) return view.plain
  const first = /^.*?[.!?](?=\s|$)/.exec(view.summary)?.[0]
  return first ?? view.summary
}

function takeawayStep(m: StageModel, view: MomentView, fan: boolean): Draft {
  const takeaway = takeawayLine(view)
  // fan: the plain line is the caption (shown once, as the headline); pro: the interpretation follows it
  const caption = fan ? (view.whatif ? takeaway : view.interpretation) : view.interpretation
  const layers: StageLayer[] = ['carrier']
  const dim: StageLayer[] = []
  const notes = view.unknowns.slice(0, 3)
  if (m.actual && m.best && m.origin) {
    // the whole story in one picture: the pass played (coral, cut out) beside the measured lane that was open (teal)
    layers.push('actualPass', 'bestLane')
    if (m.lines) dim.push('lines')
    const pts: Vec2[] = [m.origin, m.actual.to, m.best.to]
    const icpt = m.players.find((p) => p.pid === m.actual?.interceptorId)
    if (icpt) pts.push([icpt.x, icpt.y])
    return {
      id: 'takeaway',
      title: fan ? 'In short' : 'Takeaway',
      caption,
      notes,
      layers,
      dim,
      camera: frame(pts, 50, 66, 9, m.direction === '+x' ? -8 : 8),
      focusIds: m.actual.receiverId ? [m.actual.receiverId] : [],
      banner: null,
      takeaway,
    }
  }
  if (m.actual) dim.push('actualPass')
  if (m.options.length) dim.push('alternatives')
  if (m.arrows.length) dim.push('evidence')
  if (m.hull) dim.push('shape')
  if (m.lines) dim.push('lines')
  const focus = m.ball ?? m.origin ?? ([PITCH_LENGTH / 2, PITCH_WIDTH / 2] as Vec2)
  const cx = clamp(focus[0], 34, PITCH_LENGTH - 34)
  return {
    id: 'takeaway',
    title: fan ? 'In short' : 'Takeaway',
    caption,
    notes,
    layers,
    dim,
    camera: frame([[cx - 26, focus[1] - 18], [cx + 26, focus[1] + 18], focus], 54, 80),
    focusIds: [],
    banner: null,
    takeaway,
  }
}

/** The view's observations, printed exactly as measured. */
export function observedStats(view: MomentView): Array<{ label: string; value: string }> {
  return view.observed.map((o) => ({ label: o.label, value: `${o.value}${o.unit ? ` ${o.unit}` : ''}` }))
}

/** Arrows a step puts on screen (on or dimmed), for the "never more than three" budget. */
export function arrowCount(step: StageStep, m: StageModel): number {
  const per: Partial<Record<StageLayer, number>> = {
    actualPass: m.actual ? 1 : 0,
    alternatives: m.options.length,
    hypothetical: m.best ? 1 : 0,
    evidence: m.arrows.length,
    contPass: m.continuation?.passes.length ?? 0,
    contCross: m.continuation?.cross ? 1 : 0,
    bestLane: m.best ? 1 : 0,
    illRun: m.illustrative ? 1 : 0,
    illDefend: m.illustrative?.defenders.length ?? 0,
    illBall: m.illustrative ? 1 : 0,
  }
  return [...new Set([...step.layers, ...step.dim])].reduce((n, l) => n + (per[l] ?? 0), 0)
}

/**
 * Visual hierarchy for a step, shared by both renderers: `about` = the players the step is about (everyone else
 * is darkened; null = nobody recedes), `ghosted` = players an illustrative ghost stands in for (their frozen
 * spot fades), `bypassed` = opponents the hypothetical pass goes past (faded on that step).
 */
export function stepHierarchy(step: Pick<StageStep, 'id' | 'layers' | 'dim' | 'focusIds'>, m: StageModel): { about: Set<string> | null; ghosted: Set<string>; bypassed: Set<string> } {
  const on = new Set([...step.layers, ...step.dim])
  const about = new Set<string>(namedIds(step, m.carrierId))
  const add = (ids: Array<string | null | undefined>) => ids.forEach((id) => id && about.add(id))
  let recede = true
  switch (step.id) {
    case 'freeze':
    case 'situation':
      recede = false
      break
    case 'happened':
      add([m.actual?.receiverId, m.actual?.interceptorId, ...m.laneOpponentIds])
      break
    case 'measured':
      if (!m.options.length || on.has('choices')) recede = false
      add([...m.options.map((o) => o.receiverId), m.actual?.receiverId])
      break
    case 'hypothetical':
      add([m.best?.receiverId, ...(m.best?.bypassedIds ?? [])])
      break
    case 'continuation': {
      const c = m.continuation
      add([c?.fromId, ...(c?.passes.map((p) => p.receiverId) ?? []), ...(c?.cross?.targets.map((t) => t.pid) ?? []), ...(c?.shot?.defenderIds ?? []), c?.shot?.keeperId])
      break
    }
    case 'illustrative':
    case 'illustrativeBall': {
      const il = m.illustrative
      add([il?.fromId, il?.run.pid, ...(il?.defenders.map((d) => d.pid) ?? []), ...(il?.contests.map((c) => c.pid) ?? [])])
      break
    }
    case 'takeaway':
      if (!m.actual || !m.best) recede = false
      add([m.actual?.receiverId, m.actual?.interceptorId, m.best?.receiverId])
      break
  }
  const ghosted = new Set<string>()
  const il = m.illustrative
  if (il && (on.has('illRun') || on.has('illGhosts'))) ghosted.add(il.run.pid)
  if (il && (on.has('illDefend') || on.has('illGhosts'))) for (const d of il.defenders) ghosted.add(d.pid)
  const bypassed = new Set(step.layers.includes('bypassed') ? (m.best?.bypassedIds ?? []) : [])
  return { about: recede ? about : null, ghosted, bypassed }
}

/** The players a step names: its focus, plus the carrier when the carrier layer is on, at most MAX_NAMES. */
export function namedIds(step: Pick<StageStep, 'focusIds' | 'layers'>, carrierId: string | null): string[] {
  const out = [...(carrierId && step.layers.includes('carrier') ? [carrierId] : []), ...step.focusIds]
  return [...new Set(out)].slice(0, MAX_NAMES)
}

export function buildScript(view: MomentView, world: WorldIndex, audience: Audience): StageStep[] {
  const fan = audience === 'fan'
  const m = buildStageModel(view, world, audience)
  const steps: Draft[] = [freezeStep(m, world, fan), situationStep(m, view, world, fan)]
  const happened = view.whatif ? happenedStep(m, world, fan) : null
  if (happened) steps.push(happened)
  steps.push(measuredStep(m, view, world, fan))
  const hypo = hypotheticalStep(m, view, world, fan)
  if (hypo) {
    steps.push(hypo)
    // an illustrative sketch (moving players) replaces the frozen continuation; without one, geometry only
    const ill = illustrativeStep(m, world, fan)
    const illBall = ill ? illustrativeBallStep(m, world, fan) : null
    if (ill && illBall) steps.push(ill, illBall)
    else {
      const cont = continuationStep(m, view, world, fan)
      if (cont) steps.push(cont)
    }
  }
  steps.push(takeawayStep(m, view, fan))
  return steps.map((s, i) => {
    const before = new Set(i > 0 ? steps[i - 1]!.layers : [])
    const fresh = s.layers.filter((l) => !before.has(l)).length
    // names are for the step's idea: with the carrier's own tag, never more than MAX_NAMES in all
    const carrierNamed = !!m.carrierId && s.layers.includes('carrier') && !s.focusIds.includes(m.carrierId)
    return {
      ...s,
      n: i + 1,
      focusIds: [...new Set(s.focusIds)].slice(0, MAX_NAMES - (carrierNamed ? 1 : 0)),
      durationMs: paceMs(s.caption, s.notes, fresh),
      // non-What If? moments: the measured values back the "what happened / what we measured" step
      stats: s.stats ?? (!fan && s.id === 'measured' && !view.whatif ? observedStats(view) : []),
      takeaway: s.takeaway ?? null,
    }
  })
}

// ---------------------------------------------------------------- "What would you do?"

export interface StageChoice {
  receiverId: string
  name: string
  fullName: string
  at: Vec2
  rating: string
  clearance: number
  space: number
  progression: number
  /** The pass that was actually played. Hidden from the viewer until the reveal. */
  isActual: boolean
}

export interface ChoiceSet {
  prompt: string
  choices: StageChoice[]
  /** Caption after the reveal, given the viewer's pick (or null if they did not pick). */
  revealCaption: (pickedId: string | null) => string
}

/** The real measured options from the frozen frame, ordered by position so the order gives nothing away. */
export function buildChoice(view: MomentView, world: WorldIndex, audience: Audience): ChoiceSet | null {
  const w = view.whatif
  if (!w || w.actual.kind !== 'pass' || !w.actual.option || !w.alternatives.length) return null
  const fan = audience === 'fan'
  const all = [
    { o: w.actual.option, isActual: true },
    ...w.alternatives.filter((a) => a.receiver_id !== w.actual.option?.receiver_id).map((o) => ({ o, isActual: false })),
  ]
  const players = new Map(view.players.map((p) => [p.pid, p]))
  const choices: StageChoice[] = all
    .map(({ o, isActual }) => ({
      receiverId: o.receiver_id,
      name: world.players.get(o.receiver_id)?.family_name ?? players.get(o.receiver_id)?.name ?? o.receiver_id,
      fullName: fullName(world, o.receiver_id, players.get(o.receiver_id)?.name),
      at: [o.x, o.y] as Vec2,
      rating: o.rating,
      clearance: o.lane_clearance_m,
      space: o.receiver_space_m,
      progression: o.progression_m,
      isActual,
    }))
    .sort((a, b) => a.at[1] - b.at[1])
  const carrier = fullName(world, w.carrier_id)
  const prompt = fan
    ? `You're ${carrier}, on the ball at ${view.display_clock}. Where would you pass?`
    : `${carrier} on the ball at ${view.display_clock}. Pick the pass.`
  const actual = choices.find((c) => c.isActual)!
  const icpt = w.actual.interceptor_id ? fullName(world, w.actual.interceptor_id) : null
  const revealCaption = (pickedId: string | null) => {
    const real = fan
      ? `The real pass went to ${actual.fullName}${w.actual.outcome === 'intercepted' && icpt ? ` and ${icpt} cut it out` : ''}.`
      : `Actual: ${actual.fullName}, lane ${fmt1(actual.clearance)} m clear (${actual.rating})${w.actual.outcome === 'intercepted' && icpt ? `, intercepted by ${icpt}` : ''}.`
    const picked = pickedId ? choices.find((c) => c.receiverId === pickedId) : null
    let yours = ''
    if (picked && picked.isActual) yours = fan ? ' You picked the same pass.' : ' Your pick matches the real pass.'
    else if (picked)
      yours = fan
        ? ` You picked ${picked.fullName}: ${RATING_FAN[picked.rating] ?? 'a lane'} and ${fmt0(picked.space)} m of space. How it would go is unknown.`
        : ` Your pick, ${picked.fullName}: lane ${fmt1(picked.clearance)} m clear, ${fmt1(picked.space)} m space (${picked.rating}). No outcome is implied.`
    return `${real}${yours}`
  }
  return { prompt, choices, revealCaption }
}

/**
 * The two pictures of "What would you do?": the frozen frame with the options offered (nothing
 * about the real pass shown), and after the reveal the real pass beside the measured lanes.
 */
export function buildChooseSteps(view: MomentView, world: WorldIndex, audience: Audience): { before: StageStep; after: (pickedId: string | null) => StageStep } | null {
  const set = buildChoice(view, world, audience)
  if (!set) return null
  const m = buildStageModel(view, world, audience)
  const pts: Vec2[] = [...(m.origin ? [m.origin] : []), ...set.choices.map((c) => c.at)]
  const before: StageStep = {
    id: 'freeze',
    n: 1,
    title: audience === 'fan' ? 'What would you do?' : 'Pick the pass',
    caption: set.prompt,
    notes: [],
    layers: ['direction', 'carrier', 'choices'],
    dim: [],
    camera: frame(pts, 48, 72, 9),
    focusIds: [],
    durationMs: 0,
    banner: null,
    stats: [],
    takeaway: null,
  }
  const after = (pickedId: string | null): StageStep => ({
    id: 'measured',
    n: 2,
    title: audience === 'fan' ? 'What happened' : 'The real pass',
    caption: set.revealCaption(pickedId),
    notes: [],
    layers: ['carrier', 'laneOpponents', 'actualPass', 'alternatives', 'choices'],
    dim: [],
    camera: frame([...pts, ...(m.actual ? [m.actual.to] : [])], 46, 70, 9),
    focusIds: m.actual?.receiverId ? [m.actual.receiverId] : [],
    durationMs: 0,
    banner: null,
    stats: [],
    takeaway: null,
  })
  return { before, after }
}

export { isWindowKind }
