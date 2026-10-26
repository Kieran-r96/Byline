import type { MatchSessionStore } from '../../services/matchSession'
import { advanceRenderClock } from '../../services/playhead'
import type { RenderClock } from '../../services/playhead'
import type { MatchDetail } from '../../services/schemas'
import { createPose } from '../../services/tracking'
import type { Pose } from '../../services/tracking'
import { buildPitchLayer } from './pitchLayer'
import type { PitchLayer } from './pitchLayer'
import {
  BROADCAST_ZOOM,
  HEIGHT_FACTOR,
  PITCH_L,
  PITCH_W,
  cameraTarget,
  fitScale,
  planeBounds,
  project,
  stepCamera,
} from './projection'
import type { Bounds, Camera, CameraMode, PlanePoint, Viewport } from './projection'

/**
 * Canvas 2D match renderer. Owns its requestAnimationFrame loop and reads
 * the session store directly, so React never re-renders per frame.
 */

export type Channel = 'left' | 'centre' | 'right'

export interface HighlightSegment {
  n: number
  eventId: string
  kind: 'pass' | 'carry' | 'shot'
  from: { x: number; y: number }
  to: { x: number; y: number }
}

export interface HighlightSpec {
  segments: HighlightSegment[]
  channel: { channel: Channel; direction: '+x' | '-x' } | null
  /** Tracked path of a runner (overlap evidence), world metres, in time order. */
  runnerPath?: Array<{ x: number; y: number }> | null
  /** Players the evidence events name (most involved first): ringed and labelled on the pitch. */
  playerIds?: string[]
  /** performance.now() when the overlay appeared: evidence arrows are revealed one after another. */
  startedAt?: number
  /** Tactical explanation / What If? overlay (drawn on the frozen decision frame). */
  tactic?: TacticOverlay | null
}

export type TacticStep = 'moment' | 'happened' | 'whatif'

export interface TacticOverlay {
  step: TacticStep
  startedAt: number
  carrierId: string | null
  origin: { x: number; y: number } | null
  focusIds: string[]
  lines: { back_x: number; mid_x: number; offside_x: number } | null
  actual: { to: { x: number; y: number }; laneOpponentIds: string[]; interceptorId: string | null } | null
  alts: Array<{ receiverId: string; to: { x: number; y: number }; clearance: number; space: number; bypassedIds: string[] }>
  arrows: Array<{ from: { x: number; y: number }; to: { x: number; y: number } }>
}

const CORAL_RGB = '242, 108, 107'
const STEP_REVEAL_MS = 380

/** World-y band of a channel, relative to the attacking direction. */
export function channelBand(channel: Channel, direction: '+x' | '-x'): [number, number] {
  const third = PITCH_W / 3
  // Attacking +x, the right-hand side is the high-y touchline (y > 45.3).
  const right: [number, number] = direction === '+x' ? [PITCH_W - third, PITCH_W] : [0, third]
  const left: [number, number] = direction === '+x' ? [0, third] : [PITCH_W - third, PITCH_W]
  if (channel === 'right') return right
  if (channel === 'left') return left
  return [third, PITCH_W - third]
}

export type RenderStatus = 'loading' | 'ready'

export interface RendererInputs {
  store: MatchSessionStore
  getMode: () => CameraMode
  getHighlight: () => HighlightSpec | null
  reducedMotion: () => boolean
  onStatus: (s: RenderStatus) => void
}

interface EntityInfo {
  index: number
  id: string
  number: string
  name: string
  sprite: string
  numberColour: string
  isRef: boolean
}

/** How long (real time) a shot ping stays on the pitch, whatever the playback speed. */
const PING_REAL_MS = 1300
const CARRIER_RADIUS_M = 1.8

const SPRITE_R = 40
const GOLD = '#E7BA60'
const TEAL_RGB = '80, 201, 194'

function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16)
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!
}

function shade(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16)
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) =>
    Math.round(amount >= 0 ? v + (255 - v) * amount : v * (1 + amount)),
  )
  return `rgb(${ch[0]}, ${ch[1]}, ${ch[2]})`
}

function buildSprite(fill: string, keyline: string, dpr: number): HTMLCanvasElement {
  const R = SPRITE_R * Math.min(2, dpr)
  const size = Math.ceil(R * 3.2)
  const c = document.createElement('canvas')
  c.width = size
  c.height = size
  const ctx = c.getContext('2d')
  if (!ctx) return c
  const cx = size / 2
  const cy = size / 2
  // soft ground shadow, cast down-right from the floodlights
  ctx.save()
  ctx.filter = `blur(${R * 0.16}px)`
  ctx.fillStyle = 'rgba(0, 0, 0, 0.42)'
  ctx.beginPath()
  ctx.ellipse(cx + R * 0.22, cy + R * 0.62, R * 1.02, R * 0.46, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
  // body with radial highlight and darker rim
  const g = ctx.createRadialGradient(cx - R * 0.38, cy - R * 0.45, R * 0.08, cx, cy, R)
  g.addColorStop(0, shade(fill, 0.34))
  g.addColorStop(0.55, fill)
  g.addColorStop(1, shade(fill, -0.42))
  ctx.fillStyle = g
  ctx.beginPath()
  ctx.arc(cx, cy, R, 0, Math.PI * 2)
  ctx.fill()
  ctx.lineWidth = R * 0.1
  ctx.strokeStyle = shade(fill, -0.55)
  ctx.beginPath()
  ctx.arc(cx, cy, R * 0.95, 0, Math.PI * 2)
  ctx.stroke()
  // crisp keyline for separation from the grass
  ctx.lineWidth = R * 0.075
  ctx.strokeStyle = keyline
  ctx.beginPath()
  ctx.arc(cx, cy, R * 1.04, 0, Math.PI * 2)
  ctx.stroke()
  return c
}

export class TheatreRenderer {
  private readonly canvas: HTMLCanvasElement
  private readonly ctx: CanvasRenderingContext2D
  private readonly inputs: RendererInputs
  private raf = 0
  private lastNow = 0
  private vp: Viewport = { width: 1, height: 1, fit: 1 }
  private dpr = 1
  private bounds: Bounds = planeBounds()
  private layer: PitchLayer | null = null
  private sprites = new Map<string, HTMLCanvasElement>()
  private entities: EntityInfo[] = []
  private entityDetail: MatchDetail | null = null
  private pose: Pose | null = null
  private clock: RenderClock = { t: 0, initialised: false }
  private cam: Camera = { u: 0, v: 0, zoom: 1, vu: 0, vv: 0, vz: 0 }
  private camInit = false
  private status: RenderStatus | null = null
  private readonly pp: PlanePoint = { u: 0, v: 0, s: 1 }
  private readonly trailPt = { x: 0, y: 0, z: 0 }
  private lastResetCount = -1
  private lastEnsure = 0
  private order: number[] = []

  constructor(canvas: HTMLCanvasElement, inputs: RendererInputs) {
    const ctx = canvas.getContext('2d', { alpha: false })
    if (!ctx) throw new Error('Canvas 2D unavailable')
    this.canvas = canvas
    this.ctx = ctx
    this.inputs = inputs
  }

  resize(width: number, height: number, dpr: number): void {
    if (width < 2 || height < 2) return
    this.dpr = Math.min(dpr || 1, 2)
    this.canvas.width = Math.round(width * this.dpr)
    this.canvas.height = Math.round(height * this.dpr)
    this.bounds = planeBounds()
    this.vp = { width, height, fit: fitScale(width, height, this.bounds) }
    // Pre-render the static layer at the highest zoom we use, capped for memory.
    const span = this.bounds.maxU - this.bounds.minU
    const ppu = Math.min(this.vp.fit * BROADCAST_ZOOM * this.dpr, 4096 / span)
    this.layer = buildPitchLayer(this.bounds, ppu)
    this.sprites.clear()
    this.entityDetail = null
    this.camInit = false
    this.draw(performance.now())
  }

  start(): void {
    if (this.raf) return
    const loop = (now: number) => {
      this.raf = requestAnimationFrame(loop)
      this.draw(now)
    }
    this.raf = requestAnimationFrame(loop)
  }

  stop(): void {
    cancelAnimationFrame(this.raf)
    this.raf = 0
  }

  private setStatus(s: RenderStatus): void {
    if (s !== this.status) {
      this.status = s
      this.inputs.onStatus(s)
    }
  }

  private prepareEntities(detail: MatchDetail): void {
    if (this.entityDetail === detail && this.sprites.size) return
    this.entityDetail = detail
    this.sprites.clear()
    const players = new Map(detail.world.teams.flatMap((t) => t.players.map((p) => [p.player_id, p] as const)))
    const teams = new Map(detail.world.teams.map((t) => [t.team_id, t]))
    for (const t of detail.world.teams) {
      const keyline = 'rgba(246, 244, 236, 0.75)'
      this.sprites.set(`${t.team_id}:out`, buildSprite(t.kit.primary, keyline, this.dpr))
      this.sprites.set(`${t.team_id}:gk`, buildSprite(t.kit.goalkeeper, keyline, this.dpr))
    }
    this.sprites.set('REF', buildSprite('#1a222b', 'rgba(242, 214, 92, 0.85)', this.dpr))
    this.entities = detail.tracking.entities.map((id, index) => {
      // the referee: a full-size official's chip marked R, never a small dark dot that reads as a second ball
      if (id === 'REF') return { index, id, number: 'R', name: '', sprite: 'REF', numberColour: '#F2D65C', isRef: true }
      const p = players.get(id)
      const team = p ? teams.get(p.team_id) : undefined
      const gk = p?.position === 'GK'
      const kitFill = team ? (gk ? team.kit.goalkeeper : team.kit.primary) : '#888888'
      const numberColour = gk
        ? luminance(kitFill) > 0.35
          ? '#0d1e2d'
          : '#ffffff'
        : (team?.kit.number ?? '#ffffff')
      return {
        index,
        id,
        name: p?.family_name ?? '',
        number: p ? String(p.shirt_number) : '',
        sprite: team ? `${team.team_id}:${gk ? 'gk' : 'out'}` : 'REF',
        numberColour,
        isRef: false,
      }
    })
    this.pose = createPose(this.entities.length)
    this.order = this.entities.map((_, i) => i)
  }

  private draw(now: number): void {
    const { ctx, vp } = this
    const dt = this.lastNow ? Math.min(0.1, (now - this.lastNow) / 1000) : 0
    this.lastNow = now
    const store = this.inputs.store
    const snap = store.getSnapshot()
    const detail = snap.detail
    const anchor = snap.anchor
    const reduced = this.inputs.reducedMotion()

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
    // stadium surround
    const bg = ctx.createLinearGradient(0, 0, 0, vp.height)
    bg.addColorStop(0, '#060f17')
    bg.addColorStop(0.5, '#0a1a17')
    bg.addColorStop(1, '#050c12')
    ctx.fillStyle = bg
    ctx.fillRect(0, 0, vp.width, vp.height)

    // playhead
    const target = store.playhead(now)
    const speed = anchor?.speed ?? 1
    const playing = anchor?.playing ?? false
    let { t, snapped } = advanceRenderClock(this.clock, target, dt * 1000, playing, speed)
    if (snap.resetCount !== this.lastResetCount) {
      this.lastResetCount = snap.resetCount
      this.clock.t = target
      t = target
      snapped = true
    }

    const tracking = store.tracking
    if (tracking && now - this.lastEnsure > 250) {
      this.lastEnsure = now
      tracking.ensure(t, speed)
    }
    if (detail) this.prepareEntities(detail)
    const pose = this.pose
    const haveFrame = !!(detail && tracking && pose && tracking.sample(t, pose))

    // camera
    const highlight = this.inputs.getHighlight()
    const mode: CameraMode = reduced || highlight ? 'full' : this.inputs.getMode()
    const ball = haveFrame && pose?.ball.visible ? pose.ball : null
    const camTarget = cameraTarget(mode, ball, this.bounds)
    stepCamera(this.cam, camTarget, dt, vp, this.bounds, !this.camInit || snapped || reduced)
    this.camInit = true

    const k = vp.fit * this.cam.zoom
    const sx = (u: number) => vp.width / 2 + (u - this.cam.u) * k
    const sy = (v: number) => vp.height / 2 + (v - this.cam.v) * k

    // static pitch
    if (this.layer) {
      const b = this.layer.bounds
      ctx.imageSmoothingEnabled = true
      ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(this.layer.canvas, sx(b.minU), sy(b.minV), (b.maxU - b.minU) * k, (b.maxV - b.minV) * k)
    }

    const P = (x: number, y: number, z = 0) => {
      const p = project(x, y, this.pp)
      return { x: sx(p.u), y: sy(p.v - z * p.s * HEIGHT_FACTOR), s: p.s }
    }

    if (highlight?.channel) this.drawChannel(P, highlight.channel.channel, highlight.channel.direction)

    if (!haveFrame || !pose) {
      this.setStatus('loading')
      return
    }
    this.setStatus('ready')

    // players, far to near so nearer chips overlap correctly
    const xy = pose.xy
    this.order.sort((a, b) => (xy[a * 2 + 1]! || 0) - (xy[b * 2 + 1]! || 0))
    const baseR = Math.max(6, 1.2 * k)
    const carrier = this.carrierIndex(pose)
    const named = new Set([...(highlight?.playerIds ?? []), ...(highlight?.tactic?.focusIds ?? [])])
    if (!reduced) this.drawPings(P, t, speed, k)
    // ground rings under the ball carrier and the players the evidence names (drawn before the chips)
    for (const i of this.order) {
      const e = this.entities[i]!
      const ring = i === carrier ? 'carrier' : named.has(e.id) ? 'named' : null
      if (!ring) continue
      const p = P(xy[i * 2]!, xy[i * 2 + 1]!)
      const r = Math.max(6, baseR * p.s) * 1.55
      ctx.lineWidth = Math.max(1.5, r * 0.16)
      ctx.strokeStyle = ring === 'named' ? 'rgba(231, 186, 96, 0.95)' : 'rgba(246, 244, 236, 0.8)'
      ctx.beginPath()
      ctx.ellipse(p.x, p.y, r, r * 0.42, 0, 0, Math.PI * 2)
      ctx.stroke()
    }
    for (const i of this.order) {
      const x = xy[i * 2]!
      const y = xy[i * 2 + 1]!
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue
      const e = this.entities[i]!
      const p = P(x, y)
      const r = Math.max(e.isRef ? 5 : 6, baseR * p.s * (e.isRef ? 0.82 : 1))
      // chip stands on its ground point: centre lifted so the shadow sits underneath
      const cy = p.y - r * 0.4
      const sprite = this.sprites.get(e.sprite)
      if (sprite) {
        const scale = r / (SPRITE_R * Math.min(2, this.dpr))
        const size = sprite.width * scale
        ctx.drawImage(sprite, p.x - size / 2, cy - size / 2, size, size)
      }
      if (e.number && r >= 4.6) {
        ctx.fillStyle = e.numberColour
        ctx.font = `700 ${Math.round(r * 1.12)}px "Archivo Variable", system-ui, sans-serif`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(e.number, p.x, cy + r * 0.06)
      }
    }

    // ball trail (sampled back in match time; deterministic, no state)
    if (pose.ball.visible) {
      const trail: Array<{ x: number; y: number }> = []
      for (let s = 0; s <= 9; s += 1) {
        if (!tracking.sampleBall(t - s * 45, this.trailPt)) break
        const q = P(this.trailPt.x, this.trailPt.y, this.trailPt.z)
        trail.push({ x: q.x, y: q.y })
      }
      if (trail.length > 2) {
        const first = trail[0]!
        const last = trail[trail.length - 1]!
        if (Math.hypot(first.x - last.x, first.y - last.y) > 6) {
          ctx.lineCap = 'round'
          for (let s = 0; s < trail.length - 1; s += 1) {
            const a = trail[s]!
            const b = trail[s + 1]!
            const f = 1 - s / (trail.length - 1)
            ctx.strokeStyle = `rgba(255, 250, 232, ${0.55 * f * f})`
            ctx.lineWidth = Math.max(0.6, 2.6 * f)
            ctx.beginPath()
            ctx.moveTo(a.x, a.y)
            ctx.lineTo(b.x, b.y)
            ctx.stroke()
          }
        }
      }
      this.drawBall(P, pose.ball.x, pose.ball.y, pose.ball.z, k)
    }

    if (highlight?.runnerPath && highlight.runnerPath.length > 1) this.drawRunner(P, highlight.runnerPath, k)
    if (highlight && highlight.segments.length) {
      // progressive: one action at a time, so the sequence reads in order instead of as a tangle
      const shown = highlight.startedAt === undefined || reduced
        ? highlight.segments.length
        : Math.min(highlight.segments.length, 1 + Math.floor((now - highlight.startedAt) / STEP_REVEAL_MS))
      this.drawSegments(P, highlight.segments.slice(0, shown), k)
    }
    if (highlight?.tactic) this.drawTactic(P, highlight.tactic, k, reduced ? Number.POSITIVE_INFINITY : now, pose)

    // name labels last, on top of everything: the ball carrier, and the evidence's players
    for (const i of this.order) {
      const e = this.entities[i]!
      if (!e.name || (i !== carrier && !named.has(e.id))) continue
      const p = P(xy[i * 2]!, xy[i * 2 + 1]!)
      const r = Math.max(6, baseR * p.s)
      this.drawLabel(e.name, p.x, p.y + r * 0.95, named.has(e.id))
    }
  }

  private posOf(pose: Pose, pid: string): { x: number; y: number } | null {
    const i = this.entities.findIndex((e) => e.id === pid)
    if (i < 0) return null
    const x = pose.xy[i * 2]!
    const y = pose.xy[i * 2 + 1]!
    return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null
  }

  /** Tactical explanation on the decision frame: lines, the real pass, then clearly labelled alternatives. */
  private drawTactic(
    P: (x: number, y: number, z?: number) => { x: number; y: number; s: number },
    t: TacticOverlay,
    k: number,
    now: number,
    pose: Pose,
  ): void {
    const { ctx } = this
    const age = now - t.startedAt
    const ease = (ms: number) => {
      const u = Math.max(0, Math.min(1, ms / 900))
      return 1 - (1 - u) ** 3
    }
    ctx.save()
    // the defending team's lines across the pitch (measured from their positions on this frame)
    if (t.lines) {
      ctx.setLineDash([8, 7])
      ctx.lineWidth = 1.4
      for (const [x, label] of [[t.lines.back_x, 'Back line'], [t.lines.mid_x, 'Midfield line']] as const) {
        const a = P(x, 0)
        const b = P(x, PITCH_W)
        ctx.strokeStyle = 'rgba(245, 242, 233, 0.55)'
        ctx.beginPath()
        ctx.moveTo(a.x, a.y)
        ctx.lineTo(b.x, b.y)
        ctx.stroke()
        this.drawTag(label, b.x, b.y - 24, 'rgba(7, 18, 29, 0.78)', '#F5F2E9')
      }
      ctx.setLineDash([])
    }
    // the ball carrier
    const carrier = t.carrierId ? this.posOf(pose, t.carrierId) : null
    const origin = t.origin ?? carrier
    if (carrier) {
      const c = P(carrier.x, carrier.y)
      const pulse = 1 + 0.12 * Math.sin(now / 260)
      ctx.lineWidth = 2.5
      ctx.strokeStyle = 'rgba(231, 186, 96, 0.95)'
      ctx.beginPath()
      ctx.ellipse(c.x, c.y, 2.2 * k * c.s * pulse, 0.95 * k * c.s * pulse, 0, 0, Math.PI * 2)
      ctx.stroke()
    }
    // plain evidence arrows (non-what-if moments): revealed one by one
    if (t.step !== 'moment' && t.arrows.length && !t.actual) {
      const shown = Math.min(t.arrows.length, 1 + Math.floor(age / STEP_REVEAL_MS))
      t.arrows.slice(0, shown).forEach((a, i) => {
        const last = i === shown - 1
        this.drawLane(P, a.from, a.to, k, '231, 186, 96', last ? ease(age - i * STEP_REVEAL_MS) : 1, false)
      })
    }
    if (origin && t.actual && t.step !== 'moment') {
      const faded = t.step === 'whatif'
      // every opponent in the chosen lane, ringed, then the pass itself
      for (const pid of t.actual.laneOpponentIds) {
        const o = this.posOf(pose, pid)
        if (!o) continue
        const q = P(o.x, o.y)
        ctx.lineWidth = 2.2
        ctx.strokeStyle = `rgba(${CORAL_RGB}, ${faded ? 0.45 : 0.95})`
        ctx.beginPath()
        ctx.ellipse(q.x, q.y, 1.9 * k * q.s, 0.8 * k * q.s, 0, 0, Math.PI * 2)
        ctx.stroke()
      }
      this.drawLane(P, origin, t.actual.to, k, '231, 186, 96', faded ? 1 : ease(age), false, faded ? 0.35 : 1)
      if (ease(age) >= 1 || faded) {
        const e = P(t.actual.to.x, t.actual.to.y)
        const r = Math.max(5, 0.55 * k)
        ctx.lineWidth = 3
        ctx.strokeStyle = `rgba(${CORAL_RGB}, ${faded ? 0.45 : 1})`
        ctx.beginPath()
        ctx.moveTo(e.x - r, e.y - r)
        ctx.lineTo(e.x + r, e.y + r)
        ctx.moveTo(e.x + r, e.y - r)
        ctx.lineTo(e.x - r, e.y + r)
        ctx.stroke()
        if (!faded) this.drawTag('Intercepted', e.x, e.y + r + 4, `rgba(${CORAL_RGB}, 0.95)`, '#07121D')
      }
    }
    if (origin && t.step === 'whatif') {
      t.alts.forEach((alt, i) => {
        const delay = i * 500
        const p = ease(age - delay)
        if (p <= 0) return
        // opponents this option would take out of play, dimmed
        for (const pid of alt.bypassedIds) {
          const o = this.posOf(pose, pid)
          if (!o) continue
          const q = P(o.x, o.y)
          ctx.fillStyle = `rgba(7, 18, 29, ${0.45 * p})`
          ctx.beginPath()
          ctx.arc(q.x, q.y - 0.5 * k * q.s, 1.25 * k * q.s, 0, Math.PI * 2)
          ctx.fill()
        }
        // the open corridor: as wide as the measured clearance (capped), then the lane itself
        this.drawCorridor(P, origin, alt.to, Math.min(alt.clearance, 6), p)
        this.drawLane(P, origin, alt.to, k, TEAL_RGB, p, true)
        const r = P(alt.to.x, alt.to.y)
        const sr = Math.min(alt.space, 12)
        ctx.lineWidth = 1.6
        ctx.setLineDash([4, 4])
        ctx.strokeStyle = `rgba(${TEAL_RGB}, ${0.85 * p})`
        ctx.fillStyle = `rgba(${TEAL_RGB}, ${0.1 * p})`
        ctx.beginPath()
        ctx.ellipse(r.x, r.y, sr * k * r.s, sr * 0.42 * k * r.s, 0, 0, Math.PI * 2)
        ctx.fill()
        ctx.stroke()
        ctx.setLineDash([])
        if (p >= 1) {
          // above the receiver, or below when that would leave the top of the frame
          const above = r.y - 2.6 * k * r.s - 18
          const y = above < 28 ? r.y + 1.4 * k * r.s + 6 : above
          this.drawTag(`WHAT IF · lane ${alt.clearance.toFixed(1)} m clear · ${alt.space.toFixed(1)} m space`,
            r.x, y, `rgba(${TEAL_RGB}, 0.95)`, '#07121D')
        }
      })
      if (t.lines) {
        const a = P(t.lines.offside_x, 0)
        const b = P(t.lines.offside_x, PITCH_W)
        ctx.setLineDash([2, 6])
        ctx.lineWidth = 1.2
        ctx.strokeStyle = 'rgba(242, 108, 107, 0.6)'
        ctx.beginPath()
        ctx.moveTo(a.x, a.y)
        ctx.lineTo(b.x, b.y)
        ctx.stroke()
        ctx.setLineDash([])
        const mid = P(t.lines.offside_x, PITCH_W * 0.72)
        this.drawTag('Offside line', mid.x, mid.y, 'rgba(7, 18, 29, 0.78)', '#F5F2E9')
      }
    }
    ctx.restore()
  }

  private drawLane(
    P: (x: number, y: number, z?: number) => { x: number; y: number; s: number },
    from: { x: number; y: number },
    to: { x: number; y: number },
    k: number,
    rgb: string,
    progress: number,
    dashed: boolean,
    alpha = 1,
  ): void {
    if (progress <= 0) return
    const { ctx } = this
    const a = P(from.x, from.y)
    const end = { x: from.x + (to.x - from.x) * progress, y: from.y + (to.y - from.y) * progress }
    const b = P(end.x, end.y)
    ctx.save()
    ctx.lineCap = 'round'
    ctx.shadowColor = 'rgba(0, 0, 0, 0.5)'
    ctx.shadowBlur = 5
    ctx.strokeStyle = `rgba(${rgb}, ${alpha})`
    ctx.lineWidth = Math.max(2.4, 0.3 * k)
    ctx.setLineDash(dashed ? [10, 7] : [])
    ctx.beginPath()
    ctx.moveTo(a.x, a.y)
    ctx.lineTo(b.x, b.y)
    ctx.stroke()
    ctx.setLineDash([])
    if (progress >= 1) {
      const ang = Math.atan2(b.y - a.y, b.x - a.x)
      const ah = Math.max(8, 0.85 * k)
      ctx.fillStyle = `rgba(${rgb}, ${alpha})`
      ctx.beginPath()
      ctx.moveTo(b.x, b.y)
      ctx.lineTo(b.x - ah * Math.cos(ang - 0.42), b.y - ah * Math.sin(ang - 0.42))
      ctx.lineTo(b.x - ah * Math.cos(ang + 0.42), b.y - ah * Math.sin(ang + 0.42))
      ctx.closePath()
      ctx.fill()
    }
    ctx.restore()
  }

  private drawCorridor(
    P: (x: number, y: number) => { x: number; y: number },
    from: { x: number; y: number },
    to: { x: number; y: number },
    half: number,
    progress: number,
  ): void {
    const len = Math.hypot(to.x - from.x, to.y - from.y)
    if (len < 1) return
    const nx = (-(to.y - from.y) / len) * half
    const ny = ((to.x - from.x) / len) * half
    const pts = [
      P(from.x + nx * 0.25, from.y + ny * 0.25), P(to.x + nx, to.y + ny), P(to.x - nx, to.y - ny),
      P(from.x - nx * 0.25, from.y - ny * 0.25),
    ]
    const { ctx } = this
    ctx.fillStyle = `rgba(${TEAL_RGB}, ${0.16 * progress})`
    ctx.beginPath()
    pts.forEach((q, i) => (i === 0 ? ctx.moveTo(q.x, q.y) : ctx.lineTo(q.x, q.y)))
    ctx.closePath()
    ctx.fill()
  }

  private drawTag(text: string, x: number, y: number, bg: string, fg: string): void {
    const { ctx } = this
    ctx.save()
    ctx.font = '800 10.5px "Archivo Variable", system-ui, sans-serif'
    const w = ctx.measureText(text).width + 12
    const left = Math.max(4, Math.min(this.vp.width - w - 4, x - w / 2))
    ctx.fillStyle = bg
    ctx.beginPath()
    ctx.roundRect(left, y, w, 17, 4)
    ctx.fill()
    ctx.fillStyle = fg
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    ctx.fillText(text, left + 6, y + 9)
    ctx.restore()
  }

  /** The player on the ball: nearest outfield or keeper chip within 1.8 m of a ball on the ground. */
  private carrierIndex(pose: Pose): number {
    const b = pose.ball
    if (!b.visible || b.z > 1.2) return -1
    let best = -1
    let bestD = CARRIER_RADIUS_M
    for (let i = 0; i < this.entities.length; i += 1) {
      if (this.entities[i]!.isRef) continue
      const d = Math.hypot(pose.xy[i * 2]! - b.x, pose.xy[i * 2 + 1]! - b.y)
      if (d < bestD) {
        bestD = d
        best = i
      }
    }
    return best
  }

  private drawLabel(text: string, x: number, y: number, gold: boolean): void {
    const { ctx } = this
    ctx.font = '700 11px "Archivo Variable", system-ui, sans-serif'
    const w = ctx.measureText(text).width + 10
    const h = 16
    ctx.fillStyle = 'rgba(7, 18, 29, 0.82)'
    ctx.beginPath()
    ctx.roundRect(x - w / 2, y, w, h, 4)
    ctx.fill()
    if (gold) {
      ctx.fillStyle = '#E7BA60'
      ctx.fillRect(x - w / 2 + 3, y + h - 2, w - 6, 1.5)
    }
    ctx.fillStyle = '#F5F2E9'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(text, x, y + h / 2 + 0.5)
  }

  /** A short ring where each recent shot was taken (from the event's own location); gold for a goal. */
  private drawPings(
    P: (x: number, y: number) => { x: number; y: number; s: number },
    t: number,
    speed: number,
    k: number,
  ): void {
    const { ctx } = this
    const window = PING_REAL_MS * Math.max(1, speed)
    const events = this.inputs.store.getSnapshot().events
    for (let i = events.length - 1; i >= 0; i -= 1) {
      const ev = events[i]!
      const age = t - ev.elapsed_ms
      if (age > window) break
      if (age < 0 || ev.type !== 'shot') continue
      const loc = ev.payload.location as { x_m?: number; y_m?: number } | undefined
      if (typeof loc?.x_m !== 'number' || typeof loc.y_m !== 'number') continue
      const f = age / window
      const goal = ev.payload.outcome === 'goal'
      const p = P(loc.x_m, loc.y_m)
      const r = (goal ? 3.2 : 2.2) * k * p.s * (0.35 + f)
      ctx.lineWidth = Math.max(1.5, (goal ? 0.38 : 0.26) * k * (1 - f))
      ctx.strokeStyle = goal ? `rgba(231, 186, 96, ${1 - f})` : `rgba(246, 244, 236, ${0.85 * (1 - f)})`
      ctx.beginPath()
      ctx.ellipse(p.x, p.y, r, r * 0.42, 0, 0, Math.PI * 2)
      ctx.stroke()
    }
  }

  private drawRunner(
    P: (x: number, y: number) => { x: number; y: number },
    path: Array<{ x: number; y: number }>,
    k: number,
  ): void {
    const { ctx } = this
    const pts = path.map((p) => P(p.x, p.y))
    ctx.save()
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.shadowColor = 'rgba(0, 0, 0, 0.5)'
    ctx.shadowBlur = 4
    ctx.strokeStyle = `rgba(${TEAL_RGB}, 0.95)`
    ctx.lineWidth = Math.max(2, 0.28 * k)
    ctx.beginPath()
    pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)))
    ctx.stroke()
    ctx.shadowBlur = 0
    // 2 Hz tracking samples as small beads (shows the real data density)
    ctx.fillStyle = '#F5F2E9'
    for (const p of pts) {
      ctx.beginPath()
      ctx.arc(p.x, p.y, Math.max(1.4, 0.13 * k), 0, Math.PI * 2)
      ctx.fill()
    }
    const a = pts[pts.length - 2]!
    const b = pts[pts.length - 1]!
    const ang = Math.atan2(b.y - a.y, b.x - a.x)
    const ah = Math.max(7, 0.8 * k)
    ctx.fillStyle = `rgb(${TEAL_RGB})`
    ctx.beginPath()
    ctx.moveTo(b.x + Math.cos(ang) * ah * 0.6, b.y + Math.sin(ang) * ah * 0.6)
    ctx.lineTo(b.x - ah * Math.cos(ang - 0.45), b.y - ah * Math.sin(ang - 0.45))
    ctx.lineTo(b.x - ah * Math.cos(ang + 0.45), b.y - ah * Math.sin(ang + 0.45))
    ctx.closePath()
    ctx.fill()
    ctx.restore()
  }

  private drawBall(
    P: (x: number, y: number, z?: number) => { x: number; y: number; s: number },
    x: number,
    y: number,
    z: number,
    k: number,
  ): void {
    const { ctx } = this
    const ground = P(x, y)
    const lifted = P(x, y, z)
    const r = Math.max(3.8, Math.min(7.5, 0.44 * k * ground.s))
    // shadow fades and spreads as the ball rises
    const lift = Math.min(1, z / 6)
    ctx.fillStyle = `rgba(0, 0, 0, ${0.45 - lift * 0.25})`
    ctx.beginPath()
    ctx.ellipse(ground.x + r * 0.3, ground.y + r * 0.35, r * (1 + lift * 0.6), r * (0.5 + lift * 0.25), 0, 0, Math.PI * 2)
    ctx.fill()
    // soft halo so the ball reads instantly against any part of the pitch
    const halo = ctx.createRadialGradient(lifted.x, lifted.y, r * 0.8, lifted.x, lifted.y, r * 2.6)
    halo.addColorStop(0, 'rgba(255, 255, 255, 0.35)')
    halo.addColorStop(1, 'rgba(255, 255, 255, 0)')
    ctx.fillStyle = halo
    ctx.beginPath()
    ctx.arc(lifted.x, lifted.y, r * 2.6, 0, Math.PI * 2)
    ctx.fill()
    const g = ctx.createRadialGradient(lifted.x - r * 0.35, lifted.y - r * 0.4, r * 0.1, lifted.x, lifted.y, r)
    g.addColorStop(0, '#ffffff')
    g.addColorStop(0.7, '#ffffff')
    g.addColorStop(1, '#d9dedb')
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.arc(lifted.x, lifted.y, r, 0, Math.PI * 2)
    ctx.fill()
    // a real football: a central black pentagon and five partial panels at the rim, so it never reads as a dot
    if (r >= 4.5) {
      ctx.save()
      ctx.beginPath()
      ctx.arc(lifted.x, lifted.y, r, 0, Math.PI * 2)
      ctx.clip()
      ctx.fillStyle = '#0b1214'
      const spin = (x + y) * 0.35 // rolls as it moves
      const pent = (cx: number, cy: number, pr: number, rot: number) => {
        ctx.beginPath()
        for (let i = 0; i < 5; i += 1) {
          const a = rot + (i * 2 * Math.PI) / 5
          const px = cx + pr * Math.cos(a)
          const py = cy + pr * Math.sin(a)
          if (i === 0) ctx.moveTo(px, py)
          else ctx.lineTo(px, py)
        }
        ctx.closePath()
        ctx.fill()
      }
      pent(lifted.x, lifted.y, r * 0.42, spin - Math.PI / 2)
      for (let i = 0; i < 5; i += 1) {
        const a = spin - Math.PI / 2 + Math.PI / 5 + (i * 2 * Math.PI) / 5
        pent(lifted.x + Math.cos(a) * r * 1.02, lifted.y + Math.sin(a) * r * 1.02, r * 0.36, a + Math.PI / 5)
      }
      ctx.restore()
    }
    ctx.lineWidth = 1.5
    ctx.strokeStyle = 'rgba(7, 18, 29, 0.95)'
    ctx.beginPath()
    ctx.arc(lifted.x, lifted.y, r, 0, Math.PI * 2)
    ctx.stroke()
  }

  private drawChannel(
    P: (x: number, y: number) => { x: number; y: number },
    channel: Channel,
    direction: '+x' | '-x',
  ): void {
    const { ctx } = this
    const [y0, y1] = channelBand(channel, direction)
    const half = PITCH_L / 2
    const goal = direction === '+x' ? PITCH_L : 0
    const thirdStart = direction === '+x' ? PITCH_L - 35 : 35
    const quad = (xa: number, xb: number) => {
      const a = P(xa, y0)
      const b = P(xb, y0)
      const c = P(xb, y1)
      const d = P(xa, y1)
      ctx.beginPath()
      ctx.moveTo(a.x, a.y)
      ctx.lineTo(b.x, b.y)
      ctx.lineTo(c.x, c.y)
      ctx.lineTo(d.x, d.y)
      ctx.closePath()
    }
    ctx.save()
    quad(half, goal)
    ctx.fillStyle = `rgba(${TEAL_RGB}, 0.10)`
    ctx.fill()
    quad(thirdStart, goal)
    ctx.fillStyle = `rgba(${TEAL_RGB}, 0.12)`
    ctx.fill()
    ctx.setLineDash([6, 6])
    ctx.lineWidth = 1.2
    ctx.strokeStyle = `rgba(${TEAL_RGB}, 0.6)`
    for (const y of [y0, y1]) {
      if (y <= 0.01 || y >= PITCH_W - 0.01) continue
      const a = P(half, y)
      const b = P(goal, y)
      ctx.beginPath()
      ctx.moveTo(a.x, a.y)
      ctx.lineTo(b.x, b.y)
      ctx.stroke()
    }
    ctx.restore()
  }

  private drawSegments(
    P: (x: number, y: number, z?: number) => { x: number; y: number; s: number },
    segments: HighlightSegment[],
    k: number,
  ): void {
    const { ctx } = this
    ctx.save()
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    for (const seg of segments) {
      const a = P(seg.from.x, seg.from.y)
      const b = P(seg.to.x, seg.to.y)
      const len = Math.hypot(b.x - a.x, b.y - a.y)
      if (len < 2) continue
      // passes arc up off the turf; carries run along it
      const lift = seg.kind === 'pass' ? Math.min(3.5, Math.hypot(seg.to.x - seg.from.x, seg.to.y - seg.from.y) * 0.12) : 0
      const mid = P((seg.from.x + seg.to.x) / 2, (seg.from.y + seg.to.y) / 2, lift * 2)
      ctx.shadowColor = 'rgba(0, 0, 0, 0.55)'
      ctx.shadowBlur = 4
      ctx.strokeStyle = seg.kind === 'carry' ? 'rgba(231, 186, 96, 0.85)' : GOLD
      ctx.lineWidth = Math.max(1.6, 0.22 * k)
      ctx.setLineDash(seg.kind === 'carry' ? [5, 5] : [])
      ctx.beginPath()
      ctx.moveTo(a.x, a.y)
      ctx.quadraticCurveTo(mid.x, mid.y, b.x, b.y)
      ctx.stroke()
      ctx.setLineDash([])
      // arrowhead along the final tangent
      const ang = Math.atan2(b.y - mid.y, b.x - mid.x)
      const ah = Math.max(6, 0.7 * k)
      ctx.fillStyle = GOLD
      ctx.beginPath()
      ctx.moveTo(b.x, b.y)
      ctx.lineTo(b.x - ah * Math.cos(ang - 0.42), b.y - ah * Math.sin(ang - 0.42))
      ctx.lineTo(b.x - ah * Math.cos(ang + 0.42), b.y - ah * Math.sin(ang + 0.42))
      ctx.closePath()
      ctx.fill()
      ctx.shadowBlur = 0
      // numbered badge at the start
      const br = Math.max(6.5, 0.52 * k)
      ctx.fillStyle = GOLD
      ctx.beginPath()
      ctx.arc(a.x, a.y, br, 0, Math.PI * 2)
      ctx.fill()
      ctx.lineWidth = 1.5
      ctx.strokeStyle = '#07121D'
      ctx.stroke()
      ctx.fillStyle = '#07121D'
      ctx.font = `800 ${Math.round(br * 1.2)}px "Archivo Variable", system-ui, sans-serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(String(seg.n), a.x, a.y + 0.5)
    }
    ctx.restore()
  }
}
