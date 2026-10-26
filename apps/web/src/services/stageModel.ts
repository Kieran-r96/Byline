import type { WorldIndex } from './matchView'
import type { MomentView, PassOption } from './schemas'

/**
 * Pure geometry + label text for the tactical stage, derived only from a MomentView and the
 * match world (names, kits). Both renderers (Three.js scene and the SVG fallback) draw from
 * this, so the two can never disagree about what a step shows.
 *
 * World coordinates are pitch metres: x 0..105 along the length, y 0..68 from the far to the
 * near touchline (the broadcast camera sits on the y = 68 side).
 */

export const PITCH_LENGTH = 105
export const PITCH_WIDTH = 68

export type Vec2 = [number, number]
export type Audience = 'pro' | 'fan'
export type Tone = 'measured' | 'against' | 'hypo' | 'flood' | 'chalk'

export interface StagePlayer {
  pid: string
  teamId: string
  x: number
  y: number
  number: number
  /** Family name, as printed on a broadcast tag. */
  name: string
  /** "M. Lindqvist", as the captions write it. */
  fullName: string
  gk: boolean
  /** Disc fill and number colour (team kit; goalkeepers in the GK colour). */
  fill: string
  ink: string
  /** Collar and cuff colour on the shirt marker (kit secondary). */
  trim: string
  attacking: boolean
}

export interface StageOption {
  receiverId: string
  name: string
  to: Vec2
  rating: string
  clearance: number
  space: number
  progression: number
  bypassed: number
  bypassedIds: string[]
  offside: boolean
  /** Short chip on the pitch, e.g. "Haddad-Rhys · 3.3 m clear". */
  chip: string
}

/** A simulated next pass from the hypothetical receiver's frozen spot. */
export interface StageContinuationPass {
  receiverId: string
  name: string
  to: Vec2
  rating: string
  distance: number
  clearance: number
  space: number
  progression: number
  markerId: string | null
  markerName: string | null
  chip: string
}

/**
 * Simulated continuation for the best alternative: the receiver assumed on the ball where they stood,
 * everyone else frozen. Never history; drawn lilac and dotted, after the hypothetical step.
 */
export interface StageContinuation {
  fromId: string
  fromName: string
  from: Vec2
  label: string
  passes: StageContinuationPass[]
  shot: {
    centre: Vec2
    posts: [Vec2, Vec2]
    distance: number
    angle: number
    defenderIds: string[]
    keeperId: string | null
    keeper: Vec2 | null
    keeperInTriangle: boolean
    chip: string
  } | null
  cross: {
    channel: string
    targets: Array<{ pid: string; name: string; at: Vec2; markerId: string | null; markerName: string | null; markerDistance: number | null }>
    chip: string
  } | null
}

/** A player moved by the illustrative sketch: where the frame has them, and where the stated rules take them. */
export interface StageMover {
  pid: string
  name: string
  role: 'run' | 'close' | 'track'
  from: Vec2
  to: Vec2
  distance: number
}

/**
 * One illustrative way the best alternative could continue (ADR 10): rule-based moves from the frozen frame.
 * Never history and never a prediction; drawn as translucent ghost shirts with dotted trails, after the
 * hypothetical step, under its own "Illustrative" label.
 */
export interface StageIllustrative {
  fromId: string
  fromName: string
  from: Vec2
  label: string
  run: StageMover & { heldOnside: boolean }
  defenders: StageMover[]
  /** The ball in, from the receiver's spot to the end of the run. */
  delivery: { from: Vec2; to: Vec2; distance: number }
  /** At most two: a block near the receiver and the first defender who could reach the delivery point. */
  contests: Array<{ pid: string; name: string; kind: 'block' | 'intercept'; at: Vec2; gap: number }>
  /** Every defender who could reach the delivery point under the stated rules (names, for captions). */
  reachIds: string[]
  /** The published speeds, for the pro caption ("everyone 7 m/s, defenders react 0.3 s"). */
  speedsNote: string | null
}

export interface StageArrow {
  from: Vec2
  to: Vec2
  type: string
  playerId: string | null
  tone: Tone
}

export interface StageModel {
  momentId: string
  kind: string
  clock: string
  label: string
  title: string
  direction: '+x' | '-x'
  teamId: string
  defendingId: string
  teamName: string
  defendingName: string
  players: StagePlayer[]
  ball: Vec2 | null
  carrierId: string | null
  /** Where passes start: the What If? origin, else the carrier or the ball. */
  origin: Vec2 | null
  lines: { back: number; mid: number; offside: number; gap: number } | null
  /** World y (in the run-off, just outside a touchline) for the line labels and the gap bracket. */
  labelY: number
  betweenIds: string[]
  laneOpponentIds: string[]
  actual: {
    from: Vec2
    to: Vec2
    receiverId: string | null
    interceptorId: string | null
    outcome: string | null
    clearance: number | null
    rating: string | null
  } | null
  options: StageOption[]
  best: StageOption | null
  /** What could come next from the best alternative's spot (simulated), or null when nothing is supported. */
  continuation: StageContinuation | null
  /** One illustrative continuation with moving players (rule-based), or null: then the stage stays geometry-only. */
  illustrative: StageIllustrative | null
  arrows: StageArrow[]
  zone: { centre: Vec2; radius: number; chip: string | null } | null
  hull: { teamId: string; points: Vec2[] } | null
  focusIds: string[]
  labels: {
    attacking: string
    backLine: string
    midLine: string
    gap: string | null
    offside: string
    intercepted: string | null
    hypoBanner: string
    hypoChip: string | null
    contBanner: string
    contTag: string
    illBanner: string
    illTag: string
    shape: string | null
  }
}

/** Most arrows a continuation adds (the dimmed hypothetical pass is the third on screen). */
export const MAX_CONTINUATION_ARROWS = 2

const WINDOW_KINDS = new Set(['press', 'stretched', 'shape_change', 'response'])

export function isWindowKind(kind: string): boolean {
  return WINDOW_KINDS.has(kind)
}

export const fmt1 = (n: number): string => (Math.round(n * 10) / 10).toFixed(1)
export const fmt0 = (n: number): string => String(Math.round(n))

export function fullName(world: WorldIndex, pid: string | null | undefined, fallback?: string): string {
  if (!pid) return fallback ?? 'a team-mate'
  const p = world.players.get(pid)
  return p ? `${p.given_name[0] ?? ''}. ${p.family_name}` : (fallback ?? pid)
}

export function teamShort(world: WorldIndex, id: string): string {
  const t = world.teams.get(id)
  return t?.short_name ?? t?.name ?? id
}

const pt = (xy: readonly number[]): Vec2 => [xy[0] ?? 0, xy[1] ?? 0]
const dist = (a: Vec2, b: Vec2) => Math.hypot(a[0] - b[0], a[1] - b[1])

/**
 * Where the attacking-direction chevrons sit: level with the ball (kept off the goal areas) and on
 * whichever touchline side has fewer players around. Shared by both renderers and the camera.
 */
export function directionSpot(m: Pick<StageModel, 'ball' | 'origin' | 'players'>): Vec2 {
  const cx = Math.max(34, Math.min(PITCH_LENGTH - 34, (m.ball ?? m.origin ?? [PITCH_LENGTH / 2, PITCH_WIDTH / 2])[0]))
  const crowd = (y: number) => m.players.filter((p) => Math.abs(p.x - cx) < 12 && Math.abs(p.y - y) < 7).length
  return [cx, crowd(PITCH_WIDTH - 7) <= crowd(7) ? PITCH_WIDTH - 7 : 7]
}

/** The best measured alternative: highest value when given, else the first listed. */
export function bestOption(options: readonly PassOption[]): PassOption | null {
  if (!options.length) return null
  return options.reduce((best, o) => ((o.value ?? -Infinity) > (best.value ?? -Infinity) ? o : best), options[0]!)
}

/** Andrew's monotone chain. */
export function convexHull(points: readonly Vec2[]): Vec2[] {
  const p = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1])
  if (p.length < 3) return p
  const cross = (o: Vec2, a: Vec2, b: Vec2) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
  const lower: Vec2[] = []
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, q) <= 0) lower.pop()
    lower.push(q)
  }
  const upper: Vec2[] = []
  for (let i = p.length - 1; i >= 0; i -= 1) {
    const q = p[i]!
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, q) <= 0) upper.pop()
    upper.push(q)
  }
  upper.pop()
  lower.pop()
  return lower.concat(upper)
}

/**
 * The carrier: What If? carrier, else the evidence player at the ball, else the nearest attacker to the ball. Only
 * named "on the ball" when the tracking frame agrees: an event can be stamped a moment before the tracked ball
 * reaches the player (a turnover won from the goalkeeper's hands), and then nobody is labelled rather than the
 * wrong player.
 */
export function findCarrier(view: MomentView): string | null {
  if (view.whatif) return view.whatif.carrier_id
  const ball = view.ball ? pt(view.ball) : null
  if (!ball) return null
  const onBall = (pid: string): boolean => {
    const me = view.players.find((p) => p.pid === pid)
    if (!me) return false
    const mine = dist([me.x, me.y], ball)
    const theirs = Math.min(...view.players.filter((p) => p.team_id !== me.team_id).map((p) => dist([p.x, p.y], ball)), Infinity)
    return mine <= CARRIER_MAX_M && mine <= theirs + CONTEST_MARGIN_M
  }
  const near = view.arrows.find((a) => a.player_id && dist(pt(a.from), ball) <= 3)
  if (near?.player_id) return onBall(near.player_id) ? near.player_id : null
  if (isWindowKind(view.kind)) return null
  let best: { pid: string; d: number } | null = null
  for (const p of view.players) {
    if (p.team_id !== view.team_id) continue
    const d = dist([p.x, p.y], ball)
    if (d <= 4 && (!best || d < best.d)) best = { pid: p.pid, d }
  }
  return best && onBall(best.pid) ? best.pid : null
}

/** "On the ball" needs the tracked ball within 2 m, and no opponent clearly closer (a contest is fine). */
const CARRIER_MAX_M = 2
const CONTEST_MARGIN_M = 0.5

function optionChip(o: PassOption, name: string, audience: Audience): string {
  if (audience === 'fan') {
    const words = o.rating === 'open' ? 'clear lane' : o.rating === 'contested' ? 'tight lane' : 'blocked lane'
    return `${name} · ${words}`
  }
  return `${name} · ${fmt1(o.lane_clearance_m)} m clear`
}

function observedNumber(view: MomentView, re: RegExp): number | null {
  const o = view.observed.find((x) => re.test(x.label))
  return o && typeof o.value === 'number' ? o.value : null
}

export function buildStageModel(view: MomentView, world: WorldIndex, audience: Audience): StageModel {
  const fan = audience === 'fan'
  const direction: '+x' | '-x' = view.direction === '-x' ? '-x' : '+x'
  const teamName = teamShort(world, view.team_id)
  const defendingName = teamShort(world, view.defending_team_id)
  const kitOf = (teamId: string, gk: boolean) => {
    const kit = world.teams.get(teamId)?.kit
    const fallback = teamId === view.team_id ? '#8E1F3A' : '#1F6FEB'
    return {
      fill: (gk ? kit?.goalkeeper : kit?.primary) ?? fallback,
      ink: gk ? '#0B1214' : (kit?.number ?? '#F2F0E8'),
      trim: gk ? '#0B1214' : (kit?.secondary ?? '#F2F0E8'),
    }
  }
  const players: StagePlayer[] = view.players.map((p) => {
    const k = kitOf(p.team_id, p.gk)
    return {
      pid: p.pid,
      teamId: p.team_id,
      x: p.x,
      y: p.y,
      number: p.number,
      name: world.players.get(p.pid)?.family_name ?? p.name,
      fullName: fullName(world, p.pid, p.name),
      gk: p.gk,
      fill: k.fill,
      ink: k.ink,
      trim: k.trim,
      attacking: p.team_id === view.team_id,
    }
  })
  const byId = new Map(players.map((p) => [p.pid, p]))
  const has = (pid: string | null | undefined): pid is string => !!pid && byId.has(pid)
  const nameOf = (pid: string | null | undefined) => (pid ? (byId.get(pid)?.name ?? fullName(world, pid)) : '')

  const ball = view.ball ? pt(view.ball) : null
  const carrierId = findCarrier(view)
  const w = view.whatif
  const carrier = carrierId ? byId.get(carrierId) : undefined
  const origin: Vec2 | null = w ? pt(w.origin) : carrier ? [carrier.x, carrier.y] : ball

  const windowKind = isWindowKind(view.kind)
  // For window kinds about the subject team's own shape the view's lines belong to the other side,
  // so they are not drawn as if they were the subject's (press keeps them: the pressed team's lines).
  const showLines = view.lines && view.kind !== 'stretched' && view.kind !== 'shape_change'
  const lines = showLines && view.lines
    ? { back: view.lines.back_x, mid: view.lines.mid_x, offside: view.lines.offside_x, gap: Math.abs(view.lines.back_x - view.lines.mid_x) }
    : null

  // line labels and the gap bracket sit just outside a touchline, in the run-off where no one stands:
  // the near side (larger on screen) unless players crowd it
  let labelY = PITCH_WIDTH + 2.5
  if (lines) {
    const lo = Math.min(lines.back, lines.mid) - 4
    const hi = Math.max(lines.back, lines.mid) + 4
    const crowd = (y: number) => players.filter((p) => p.x > lo && p.x < hi && Math.abs(p.y - y) < 6).length
    if (crowd(PITCH_WIDTH + 2.5) > crowd(-2.5)) labelY = -2.5
  }

  const betweenIds: string[] = []
  if (lines && !windowKind) {
    const lo = Math.min(lines.back, lines.mid)
    const hi = Math.max(lines.back, lines.mid)
    for (const p of players) if (p.attacking && !p.gk && p.x > lo && p.x < hi) betweenIds.push(p.pid)
  }

  const actualOpt = w?.actual.option ?? null
  const actual = w && w.actual.kind === 'pass' && origin
    ? {
        from: origin,
        to: pt(w.actual.end),
        receiverId: w.actual.receiver_id,
        interceptorId: has(w.actual.interceptor_id) ? w.actual.interceptor_id : null,
        outcome: w.actual.outcome,
        clearance: actualOpt?.lane_clearance_m ?? null,
        rating: actualOpt?.rating ?? null,
      }
    : null
  const laneOpponentIds = (actualOpt?.lane_opponents ?? []).filter(has)

  const toOption = (o: PassOption): StageOption => ({
    receiverId: o.receiver_id,
    name: nameOf(o.receiver_id),
    to: [o.x, o.y],
    rating: o.rating,
    clearance: o.lane_clearance_m,
    space: o.receiver_space_m,
    progression: o.progression_m,
    bypassed: o.opponents_bypassed,
    bypassedIds: o.bypassed_ids.filter(has),
    offside: o.offside_position,
    chip: optionChip(o, nameOf(o.receiver_id), audience),
  })
  const options = (w?.alternatives ?? []).map(toOption)
  const bestRaw = bestOption(w?.alternatives ?? [])
  const best = bestRaw ? (options.find((o) => o.receiverId === bestRaw.receiver_id) ?? null) : null

  // the continuation follows the hypothetical: only the best alternative's receiver, only what the payload measured
  let continuation: StageContinuation | null = null
  const items = best ? (w?.continuations ?? []).filter((c) => c.from_id === best.receiverId && has(c.from_id)) : []
  if (best && items.length) {
    const shotItem = items.find((c) => c.kind === 'shot')?.shot
    const crossItem = items.find((c) => c.kind === 'cross')?.cross
    const crossTargets = (crossItem?.targets ?? []).filter((t) => has(t.pid))
    const cross = crossItem && crossTargets.length
      ? {
          channel: crossItem.channel,
          targets: crossTargets.map((t) => ({
            pid: t.pid,
            name: nameOf(t.pid),
            at: [t.x, t.y] as Vec2,
            markerId: has(t.nearest_marker_id) ? t.nearest_marker_id : null,
            markerName: has(t.nearest_marker_id) ? nameOf(t.nearest_marker_id) : null,
            markerDistance: t.marker_distance_m,
          })),
          chip: fan ? 'Cross into the box' : `Cross · ${crossTargets.length} in the box`,
        }
      : null
    const passes: StageContinuationPass[] = items
      .flatMap((c) => (c.kind === 'pass' && c.pass && has(c.pass.receiver_id) ? [c.pass] : []))
      .sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99))
      .slice(0, MAX_CONTINUATION_ARROWS - (cross ? 1 : 0))
      .map((p) => ({
        receiverId: p.receiver_id,
        name: nameOf(p.receiver_id),
        to: [p.x, p.y] as Vec2,
        rating: p.rating,
        distance: p.distance_m,
        clearance: p.lane_clearance_m,
        space: p.receiver_space_m,
        progression: p.progression_m,
        markerId: has(p.nearest_marker_id) ? p.nearest_marker_id : null,
        markerName: has(p.nearest_marker_id) ? nameOf(p.nearest_marker_id) : null,
        chip: fan
          ? `${nameOf(p.receiver_id)} · defender ${fmt0(p.receiver_space_m)} m away`
          : `${nameOf(p.receiver_id)} · lane ${fmt1(p.lane_clearance_m)} m · space ${fmt1(p.receiver_space_m)} m`,
      }))
    const shot = shotItem
      ? {
          centre: pt(shotItem.goal_centre),
          posts: [pt(shotItem.posts[0]), pt(shotItem.posts[1])] as [Vec2, Vec2],
          distance: shotItem.distance_m,
          angle: shotItem.angle_deg,
          defenderIds: shotItem.defenders_in_triangle.filter(has),
          keeperId: has(shotItem.goalkeeper_id) ? shotItem.goalkeeper_id : null,
          keeper: shotItem.goalkeeper ? pt(shotItem.goalkeeper) : null,
          keeperInTriangle: shotItem.goalkeeper_in_triangle,
          chip: fan ? `Sight of goal · ${fmt0(shotItem.distance_m)} m out` : `Shot window · ${fmt1(shotItem.distance_m)} m · ${fmt1(shotItem.angle_deg)}°`,
        }
      : null
    if (passes.length || shot || cross) {
      continuation = {
        fromId: best.receiverId,
        fromName: best.name,
        from: pt(items[0]!.from),
        label: items[0]!.label,
        passes,
        shot,
        cross,
      }
    }
  }

  // the illustrative sketch follows the hypothetical: only for the best alternative, only with every player known
  let illustrative: StageIllustrative | null = null
  const il = w?.illustrative
  if (best && il && il.from_id === best.receiverId && has(il.run.pid) && il.defenders.every((d) => has(d.pid))) {
    const mover = (d: { pid: string; role: string; from: readonly number[]; to: readonly number[]; distance_m: number }): StageMover => ({
      pid: d.pid,
      name: nameOf(d.pid),
      role: d.role === 'close' ? 'close' : d.role === 'track' ? 'track' : 'run',
      from: pt(d.from),
      to: pt(d.to),
      distance: d.distance_m,
    })
    const contests = il.contests.filter((c) => has(c.pid))
    const block = contests.find((c) => c.kind === 'block')
    const reach = contests.filter((c) => c.kind === 'intercept')
    const speeds = w?.illustrative_rules?.speeds
    illustrative = {
      fromId: il.from_id,
      fromName: nameOf(il.from_id),
      from: pt(il.pass.to),
      label: il.label,
      run: { ...mover(il.run), role: 'run', heldOnside: il.run.held_onside },
      defenders: il.defenders.map(mover),
      delivery: { from: pt(il.delivery.from), to: pt(il.delivery.to), distance: il.delivery.distance_m },
      contests: [...(block ? [block] : []), ...reach.slice(0, 1)].map((c) => ({ pid: c.pid, name: nameOf(c.pid), kind: c.kind, at: pt(c.at), gap: c.gap_m })),
      reachIds: reach.map((c) => c.pid),
      speedsNote: speeds ?? null,
    }
  }

  // window kinds cite many events as provenance; none of them is "the" action to draw
  const arrows: StageArrow[] = w || windowKind
    ? []
    : view.arrows.map((a) => ({
        from: pt(a.from),
        to: pt(a.to),
        type: a.type,
        playerId: a.player_id,
        tone: a.type.endsWith('.failed') ? 'against' : 'measured',
      }))

  // overload: the radius the observation names ("within 12 m"), centred on the ball
  let zone: StageModel['zone'] = null
  const zoneObs = view.observed.find((o) => /within (\d+(?:\.\d+)?) m/i.test(o.label))
  const zoneR = zoneObs ? Number(/within (\d+(?:\.\d+)?) m/i.exec(zoneObs.label)?.[1]) : NaN
  if (ball && Number.isFinite(zoneR) && zoneR > 0) {
    const a = observedNumber(view, /^attackers/i)
    const d = observedNumber(view, /^defenders/i)
    zone = { centre: ball, radius: zoneR, chip: a !== null && d !== null ? `${a} v ${d} within ${zoneR} m` : null }
  }

  let hull: StageModel['hull'] = null
  if (windowKind) {
    const pts = players.filter((p) => p.teamId === view.team_id && !p.gk).map((p): Vec2 => [p.x, p.y])
    if (pts.length >= 3) hull = { teamId: view.team_id, points: convexHull(pts) }
  }

  const focusIds = [...new Set([...(carrierId ? [carrierId] : []), ...view.focus_player_ids])].filter(has)

  const hypoChip = best
    ? fan
      ? `${fmt0(best.progression)} m further forward`
      : `+${fmt0(best.progression)} m · ${best.bypassed} bypassed · ${fmt1(best.space)} m space`
    : null

  return {
    momentId: view.moment_id,
    kind: view.kind,
    clock: view.display_clock,
    label: view.label,
    title: view.title,
    direction,
    teamId: view.team_id,
    defendingId: view.defending_team_id,
    teamName,
    defendingName,
    players,
    ball,
    carrierId,
    origin,
    lines,
    labelY,
    betweenIds,
    laneOpponentIds,
    actual,
    options,
    best,
    continuation,
    illustrative,
    arrows,
    zone,
    hull,
    focusIds,
    labels: {
      attacking: `${teamName} attacking`,
      backLine: `${defendingName} back line`,
      midLine: `${defendingName} midfield line`,
      gap: lines ? (fan ? `${fmt0(lines.gap)} m gap` : `${fmt1(lines.gap)} m gap`) : null,
      offside: 'Offside line',
      intercepted: actual?.outcome === 'intercepted' && actual.interceptorId ? `Intercepted · ${nameOf(actual.interceptorId)}` : null,
      hypoBanner: 'Hypothetical · not what happened',
      hypoChip,
      contBanner: 'Simulated · not what happened · no outcome implied',
      contTag: 'Simulated continuation',
      illBanner: 'Illustrative · not what happened · no outcome implied',
      illTag: 'Illustrative',
      shape: hull ? `${teamName} shape · this frame` : null,
    },
  }
}
