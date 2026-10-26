import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { directionSpot, PITCH_LENGTH, PITCH_WIDTH } from '../../services/stageModel'
import type { StageModel, StageMover, StageOption, Vec2 } from '../../services/stageModel'
import { LAYER_BEAT_MS, namedIds, stepHierarchy } from '../../services/stageScript'
import type { StageCamera, StageLayer, StageStep } from '../../services/stageScript'
import type { Frame } from '../../services/tracking'
import { BALL_R, makeBall } from './ball'
import type { BallRig } from './ball'
import { sampleReplay } from './replay'
import type { ReplayPose } from './replay'
import { AREA_L, AREA_W, curtainTexture, ghostShirtTexture, grassDetailTexture, grassTexture, radialTexture, SHIRT_ASPECT, shirtTexture } from './textures'

/**
 * BYLINE tactical stage: an imperative Three.js scene for guided telestration on one frozen frame.
 *
 * Render-on-demand: nothing runs while the picture is still. Camera flights, layer reveals, the
 * ghost ball and the real-tracking replay request frames only while they animate.
 * Labels are HTML, positioned each rendered frame by projecting 3D anchors.
 *
 * Visual encodings (one meaning each):
 *   observed       solid; coral where it went wrong (the intercepted pass)
 *   measured       teal (lanes, gaps, rings, zones)
 *   hypothetical   lilac, dashed, with a travelling ghost ball
 *   simulated      paler lilac, dotted and thinner, with an "assumed ball" marker (continuations)
 *   illustrative   ghost shirts (dashed pale-lilac outline, a wash of the kit) moving along dotted trails,
 *                  filled pale-lilac italic tags; the real shirts stay on their frozen spots, darkened
 *   AI-verified    never drawn on the pitch: amber is kept for verified text in the dock
 *   withdrawn      the whole picture greyed and the plate struck (TacticalStage)
 *
 * Hierarchy: players a step is not about are darkened (never hidden), so its one idea is the brightest thing.
 */

const COL = {
  night: '#0B1214',
  chalk: '#F2F0E8',
  measured: '#4FD1C5',
  hypo: '#B7A4FF',
  cont: '#DCD3FF',
  against: '#FF7A6B',
}

const HALF_L = PITCH_LENGTH / 2
const HALF_W = PITCH_WIDTH / 2
const W = (x: number, y: number, h = 0) => new THREE.Vector3(x - HALF_L, h, y - HALF_W)

const DIM = 0.26
/** Footprint radius of a player marker on the grass (rings and clearances are measured from it). */
const TOKEN_R = 0.95
/** Shirt marker size at scale 1, in metres (exaggerated for legibility, standing on the exact spot). */
const SHIRT_H = 2.05
const SHIRT_W = SHIRT_H * SHIRT_ASPECT
const SHIRT_LIFT = 0.12
/** Camera moves are slow and eased: the picture glides to the next idea rather than cutting. */
const FLIGHT_MS = 1600
const FADE_MS = 560
/**
 * Players a step is not about: their shirts are darkened to this (a linear-space colour multiply, about half
 * brightness on screen; they stay solid and readable).
 */
const RECEDE = 0.22
/** Clip mode: at most this many name tags, nothing else. */
const CLIP_NAMES = 3

type LabelKind = 'name' | 'name-carrier' | 'line' | 'chip-measured' | 'chip-against' | 'chip-hypo' | 'chip-cont' | 'chip-ill' | 'chip-chalk' | 'direction'

interface Label {
  el: HTMLDivElement
  /** Written into the element only when first shown (nothing hidden sits in the DOM, e.g. before a reveal). */
  text: string
  anchor: () => THREE.Vector3
  fade: string
  priority: number
  /** Pixels above the projected anchor the label's bottom edge sits. */
  lift: number
  w: number
  h: number
}

interface Fade {
  value: number
  from: number
  to: number
  start: number
  dur: number
  apply: (v: number) => void
}

interface Grow {
  p: number
  start: number
  dur: number
  apply: (p: number) => void
}

interface Token {
  pid: string
  group: THREE.Group
  shirt: THREE.Sprite
  mats: Array<THREE.Material & { opacity: number }>
  rings: Record<'focus' | 'named' | 'lane' | 'between' | 'choice' | 'picked', THREE.Mesh>
  home: Vec2
  at: Vec2
  focus: number
  /** Colour multiply on the shirt and base: 1 = the step is about this player, RECEDE = background. */
  shade: number
  shadeTarget: number
  /** Opacity (1, or lower while a ghost stands in for this player or they are bypassed). */
  alpha: number
  alphaTarget: number
  fill: THREE.Color
}

/** An illustrative stand-in for a player: a ghost shirt that walks from the frozen spot along a dotted trail. */
interface Ghost {
  mover: StageMover
  group: THREE.Group
  mat: THREE.SpriteMaterial
  ring: THREE.MeshBasicMaterial
  /** 0 = on the frozen spot, 1 = where the sketch takes them. */
  p: number
  /** Visibility from each layer that shows it (the trail layer, or illGhosts once the trail has gone). */
  vis: Record<string, number>
}

export interface StageSceneOptions {
  reducedMotion: boolean
  /** Clip mode (a corner picture-in-picture): thicker lines, tighter margins, names only. */
  clip?: boolean
  /** Called after each rendered frame (the React shell uses it for tracked HTML elements). */
  onFrame?: () => void
}

export interface TrackedElement {
  el: HTMLElement
  at: Vec2
  /** Pixels above the projected point. */
  lift?: number
}

export interface FrameStats {
  frames: number
  avgMs: number
  p95Ms: number
  maxMs: number
}

interface CamState {
  x: number
  y: number
  distance: number
  polar: number
  azimuth: number
}

const ease = (u: number) => (u < 0.5 ? 4 * u * u * u : 1 - (-2 * u + 2) ** 3 / 2)
const clamp01 = (u: number) => Math.max(0, Math.min(1, u))

// ---------------------------------------------------------------- geometry helpers (ground plane)

function ribbon(a: Vec2, b: Vec2, width: number, h = 0): THREE.BufferGeometry {
  const dx = b[0] - a[0]
  const dz = b[1] - a[1]
  const len = Math.hypot(dx, dz)
  const g = new THREE.PlaneGeometry(len, width).rotateX(-Math.PI / 2).rotateY(-Math.atan2(dz, dx))
  g.translate((a[0] + b[0]) / 2 - HALF_L, h, (a[1] + b[1]) / 2 - HALF_W)
  return g
}

/** Arc on the ground, angles measured in world terms (from +x towards +y). */
function arc(c: Vec2, r: number, width: number, fromDeg: number, toDeg: number, h = 0): THREE.BufferGeometry {
  const len = ((toDeg - fromDeg) * Math.PI) / 180
  const g = new THREE.RingGeometry(r - width / 2, r + width / 2, Math.max(12, Math.ceil(r * 10)), 1, (-toDeg * Math.PI) / 180, len)
  g.rotateX(-Math.PI / 2)
  g.translate(c[0] - HALF_L, h, c[1] - HALF_W)
  return g
}

function disc(c: Vec2, r: number, h = 0): THREE.BufferGeometry {
  return new THREE.CircleGeometry(r, 24).rotateX(-Math.PI / 2).translate(c[0] - HALF_L, h, c[1] - HALF_W)
}

function dashedRing(r: number, width: number, dashes: number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = []
  const step = (Math.PI * 2) / dashes
  for (let i = 0; i < dashes; i += 1) {
    parts.push(new THREE.RingGeometry(r - width / 2, r + width / 2, 6, 1, i * step, step * 0.55).rotateX(-Math.PI / 2))
  }
  return mergeGeometries(parts)!
}

function dashedRibbon(a: Vec2, b: Vec2, width: number, dash: number, gap: number, h = 0): THREE.BufferGeometry {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1])
  const parts: THREE.BufferGeometry[] = []
  for (let s = 0; s < len; s += dash + gap) {
    const e = Math.min(len, s + dash)
    const p = (t: number): Vec2 => [a[0] + ((b[0] - a[0]) * t) / len, a[1] + ((b[1] - a[1]) * t) / len]
    parts.push(ribbon(p(s), p(e), width, h))
  }
  return mergeGeometries(parts)!
}

/**
 * Material for lanes/tubes that can be drawn progressively and dashed (uv.x runs along the path).
 * `duty` is the drawn share of each dash period: ~0.56 reads as dashes, ~0.3 with many periods as dots.
 */
function laneMaterial(color: string, opacity: number, dashes = 0, duty = 0.56): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uOpacity: { value: opacity },
      uProgress: { value: 0 },
      uDashes: { value: dashes },
      uDuty: { value: duty },
      uShade: { value: 1 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vN;
      void main() {
        vUv = uv;
        vN = normalize(normalMatrix * normal);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uOpacity;
      uniform float uProgress;
      uniform float uDashes;
      uniform float uDuty;
      uniform float uShade;
      varying vec2 vUv;
      varying vec3 vN;
      void main() {
        if (vUv.x > uProgress) discard;
        if (uDashes > 0.0 && fract(vUv.x * uDashes) > uDuty) discard;
        float l = mix(1.0, 0.62 + 0.5 * max(dot(normalize(vN), normalize(vec3(-0.3, 1.0, 0.5))), 0.0), uShade);
        gl_FragColor = vec4(uColor * l, uOpacity);
        #include <colorspace_fragment>
      }`,
    transparent: true,
    depthWrite: false,
  })
}

/**
 * Night grass: the baked stripes and pools, plus fine blade detail that fades with distance, mowing
 * stripes that catch the floodlights differently depending on where the camera looks from, and a
 * gentle falloff from the lit centre to the run-off. Colour only: positions are never touched.
 */
function grassMaterial(map: THREE.Texture, detail: THREE.Texture): THREE.ShaderMaterial {
  const mat = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      { uMap: { value: null }, uDetail: { value: null }, uCam: { value: new THREE.Vector3(0, 80, 80) } },
    ]) as Record<string, THREE.IUniform>,
    vertexShader: /* glsl */ `
      #include <fog_pars_vertex>
      varying vec2 vUv;
      varying vec3 vWorld;
      void main() {
        vUv = uv;
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorld = wp.xyz;
        vec4 mvPosition = viewMatrix * wp;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      #include <fog_pars_fragment>
      uniform sampler2D uMap;
      uniform sampler2D uDetail;
      uniform vec3 uCam;
      varying vec2 vUv;
      varying vec3 vWorld;
      void main() {
        vec3 col = texture2D(uMap, vUv).rgb;
        float dist = length(uCam - vWorld);
        // blades, tiled every 2.2 m, gone by 150 m so wide shots stay calm
        float d = texture2D(uDetail, vWorld.xz / 2.2).r - 0.5;
        col *= 1.0 + d * 0.34 * (1.0 - smoothstep(35.0, 150.0, dist));
        // mown bands lean alternately towards and away from the near touchline
        float band = mod(floor((vWorld.x + ${HALF_L.toFixed(1)}) / ${(PITCH_LENGTH / 20).toFixed(3)}), 2.0) * 2.0 - 1.0;
        vec3 v = normalize(uCam - vWorld);
        col *= 1.0 + band * v.z * 0.06;
        // floodlit centre, darker run-off
        float r = length(vWorld.xz / vec2(60.0, 40.0));
        col *= mix(1.05, 0.84, smoothstep(0.7, 1.35, r));
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
    fog: true,
  })
  // merge() clones uniform values, so the textures are attached afterwards (never cloned)
  mat.uniforms.uMap!.value = map
  mat.uniforms.uDetail!.value = detail
  return mat
}

/** Flat strip from a to b with uv.x along it (for corridors), widening from w0 to w1. */
function corridor(a: Vec2, b: Vec2, w0: number, w1: number, h: number): THREE.BufferGeometry {
  const dx = b[0] - a[0]
  const dz = b[1] - a[1]
  const len = Math.hypot(dx, dz) || 1
  const nx = -dz / len
  const nz = dx / len
  const pos = new Float32Array([
    a[0] + nx * w0, h, a[1] + nz * w0,
    a[0] - nx * w0, h, a[1] - nz * w0,
    b[0] + nx * w1, h, b[1] + nz * w1,
    b[0] - nx * w1, h, b[1] - nz * w1,
  ])
  for (let i = 0; i < 4; i += 1) {
    pos[i * 3] = pos[i * 3]! - HALF_L
    pos[i * 3 + 2] = pos[i * 3 + 2]! - HALF_W
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 0, 1, 1, 0, 1, 1]), 2))
  g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0]), 3))
  g.setIndex([0, 2, 1, 1, 2, 3])
  return g
}

/** A pass as a low arc between two pitch points, stopping short of the target. */
function passCurve(a: Vec2, b: Vec2, shortBy: number, lift = 1): THREE.QuadraticBezierCurve3 {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1
  const k = Math.max(0, (len - shortBy) / len)
  const end: Vec2 = [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k]
  const startK = Math.min(0.9, 1.1 / len)
  const start: Vec2 = [a[0] + (b[0] - a[0]) * startK, a[1] + (b[1] - a[1]) * startK]
  const h = Math.min(3.2, 0.5 + len * 0.055) * lift
  return new THREE.QuadraticBezierCurve3(
    W(start[0], start[1], 0.35),
    W((start[0] + end[0]) / 2, (start[1] + end[1]) / 2, h),
    W(end[0], end[1], 0.35),
  )
}

function disposeObject(root: THREE.Object3D): void {
  root.traverse((o) => {
    const m = o as THREE.Mesh
    m.geometry?.dispose()
    const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : []
    for (const mat of mats) {
      for (const v of Object.values(mat as unknown as Record<string, unknown>)) if (v instanceof THREE.Texture) v.dispose()
      if (mat instanceof THREE.ShaderMaterial) for (const u of Object.values(mat.uniforms)) if (u.value instanceof THREE.Texture) u.value.dispose()
      mat.dispose()
    }
  })
}

// ---------------------------------------------------------------- the scene

export class StageScene {
  readonly canvas: HTMLCanvasElement
  private readonly host: HTMLElement
  private readonly overlay: HTMLDivElement
  private readonly renderer: THREE.WebGLRenderer
  private readonly scene = new THREE.Scene()
  private readonly camera = new THREE.PerspectiveCamera(30, 1.6, 1, 900)
  private readonly probe = new THREE.PerspectiveCamera(30, 1.6, 1, 900)
  private model: StageModel
  private reduced: boolean
  private readonly onFrame: (() => void) | undefined
  private width = 1
  private height = 1
  private raf = 0
  private disposed = false
  private readonly fades = new Map<string, Fade>()
  private readonly grows = new Map<string, Grow>()
  private readonly labels: Label[] = []
  private tracked: TrackedElement[] = []
  private readonly tokens = new Map<string, Token>()
  private ball!: BallRig
  private ghost!: BallRig
  private assumed!: BallRig
  private grassMat: THREE.ShaderMaterial | null = null
  private ghostCurve: THREE.QuadraticBezierCurve3 | null = null
  private ghostAnim: { start: number; dur: number } | null = null
  private cam: CamState = { x: HALF_L, y: HALF_W, distance: 120, polar: 56, azimuth: 0 }
  private flight: { from: CamState; to: CamState; start: number; dur: number } | null = null
  private stepCamera: StageCamera | null = null
  private step: StageStep | null = null
  private replay: { stop: () => void } | null = null
  private readonly frameTimes: number[] = []
  private lastFrameAt = 0
  private readonly resizeObserver: ResizeObserver
  private readonly world = new THREE.Group()
  private readonly clip: boolean
  /** Line thickness multiplier: 1 on the full stage; thicker in a clip so nothing vanishes when scaled down. */
  private readonly thick: number
  /** HTML plates over the picture (title, banner, stats) that labels must not cover, in viewport pixels. */
  private obstacles: Array<{ x0: number; y0: number; x1: number; y1: number }> = []
  private readonly ghosts = new Map<string, Ghost>()
  private lastTick = 0

  constructor(host: HTMLElement, model: StageModel, opts: StageSceneOptions) {
    this.host = host
    this.model = model
    this.reduced = opts.reducedMotion
    this.onFrame = opts.onFrame
    this.clip = !!opts.clip
    this.thick = this.clip ? 3 : 1
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.setClearColor(COL.night)
    this.canvas = this.renderer.domElement
    this.canvas.className = 'stage__canvas'
    this.overlay = document.createElement('div')
    this.overlay.className = 'stage__labels'
    this.overlay.setAttribute('aria-hidden', 'true')
    host.append(this.canvas, this.overlay)

    this.scene.background = new THREE.Color(COL.night)
    this.scene.fog = new THREE.Fog(COL.night, 190, 420)
    this.scene.add(this.world)
    this.buildLights()
    this.buildPitch()
    this.buildTokens()
    this.buildBall()
    this.buildLayers()

    this.resizeObserver = new ResizeObserver(() => this.resize())
    this.resizeObserver.observe(host)
    this.resize()
    // the font may arrive after first paint: redraw numbers and re-measure labels when it does
    if (document.fonts && document.fonts.status !== 'loaded') {
      void document.fonts.ready.then(() => {
        if (this.disposed) return
        this.refreshDiscs()
        for (const l of this.labels) l.w = 0
        this.invalidate()
      })
    }
  }

  // ------------------------------------------------------------ public API

  setStep(step: StageStep, opts: { instant?: boolean } = {}): void {
    const instant = !!opts.instant || this.reduced
    this.step = step
    if (this.replay) return
    const now = performance.now()
    const flightMs = instant ? 0 : FLIGHT_MS
    this.flyTo(step.camera, flightMs)
    const want = new Map<string, number>()
    for (const l of step.layers) want.set(l, 1)
    for (const l of step.dim) if (!want.has(l)) want.set(l, DIM)
    // names for the step's idea only (at most four; three in a clip)
    const names = new Set(namedIds(step, this.model.carrierId).slice(0, this.clip ? CLIP_NAMES : undefined))
    for (const pid of names) want.set(`name:${pid}`, 1)
    this.applyHierarchy(step, instant)
    this.refreshObstacles()
    // newly revealed layers come in one at a time, in the step's order, as the camera arrives: each
    // waits until the previous one has finished drawing, so only one new idea lands at once.
    // Name tags arrive with the first of them.
    const base = instant ? 0 : flightMs * 0.6
    const delays = new Map<string, number>()
    let at = base
    for (const key of [...step.layers, ...[...names].map((pid) => `name:${pid}`)]) {
      const f = this.fades.get(key)
      if (!f || f.value >= 0.05 || f.to >= 0.05) continue
      if (key.startsWith('name:')) {
        delays.set(key, base)
        continue
      }
      delays.set(key, at)
      // empty layers (registered no-ops) take no beat
      if (this.growers.has(key) || this.drawn.has(key)) at += Math.max(LAYER_BEAT_MS, this.growMs(key) + 350)
    }
    for (const [key, fade] of this.fades) {
      const target = want.get(key) ?? 0
      const delay = delays.get(key)
      if (delay !== undefined) {
        this.setFade(key, target, now + (instant ? 0 : delay), instant ? 0 : FADE_MS)
        this.startGrow(key, now + (instant ? 0 : delay), instant)
      } else if (Math.abs(fade.to - target) > 0.001 || instant) {
        this.setFade(key, target, now, instant ? 0 : FADE_MS * 0.7)
      }
    }
    const hypoDelay = delays.get('hypothetical')
    if (want.get('hypothetical') === 1 && !instant && hypoDelay !== undefined) {
      this.ghostAnim = { start: now + hypoDelay + this.growMs('hypothetical') + 200, dur: 2200 }
    } else {
      this.ghostAnim = null
      this.ghost.setOpacity(0)
    }
    this.invalidate()
  }

  /** How long a layer takes to draw itself in (0 for a plain fade). */
  private growMs(key: string): number {
    if (!this.growers.has(key)) return FADE_MS
    // a sketched run or response is walked at a readable pace, not at match speed
    if (key === 'illRun' || key === 'illDefend') return 1700
    const n = key === 'alternatives' ? Math.max(1, this.model.options.length)
      : key === 'evidence' ? Math.max(1, this.model.arrows.length)
        : key === 'contPass' ? Math.max(1, this.model.continuation?.passes.length ?? 1) : 1
    return 950 * n
  }

  /**
   * The players this step is about stay bright; the rest are darkened (never hidden). Bypassed opponents fade
   * on the hypothetical step; a player a ghost stands in for is darkened and faded on their frozen spot.
   */
  private applyHierarchy(step: StageStep, instant: boolean): void {
    const { about, ghosted, bypassed } = stepHierarchy(step, this.model)
    for (const t of this.tokens.values()) {
      t.shadeTarget = !about || about.has(t.pid) ? 1 : RECEDE
      t.alphaTarget = ghosted.has(t.pid) ? 0.42 : bypassed.has(t.pid) ? 0.32 : 1
      if (ghosted.has(t.pid)) t.shadeTarget = RECEDE
      if (instant) {
        t.shade = t.shadeTarget
        t.alpha = t.alphaTarget
        this.paintToken(t)
      }
    }
  }

  private paintToken(t: Token): void {
    const [base, rim, shadow, shirt] = t.mats as [THREE.MeshBasicMaterial, THREE.MeshBasicMaterial, THREE.MeshBasicMaterial, THREE.SpriteMaterial]
    base.color.copy(t.fill).multiplyScalar(t.shade)
    rim.color.setScalar(0.95 * t.shade)
    shirt.color.setScalar(t.shade)
    for (const mm of [base, rim, shirt]) mm.opacity = t.alpha
    shadow.opacity = t.alpha
    this.paintNameRing(t)
  }

  /** The chalk ring under a named player; faint on a frozen spot while a ghost stands in (the name goes with it). */
  private paintNameRing(t: Token): void {
    const carrier = t.pid === this.model.carrierId
    const ring = carrier ? t.rings.focus : t.rings.named
    const stand = Math.min(t.alpha, t.alphaTarget) < 0.9 ? 0.15 : 1
    ;(ring.material as THREE.MeshBasicMaterial).opacity = (carrier ? 0.95 : 0.75) * t.focus * stand
  }

  /** HTML plates over the picture that labels must avoid (measured when a step lands and on resize). */
  private refreshObstacles(): void {
    const host = this.host.getBoundingClientRect()
    this.obstacles = [...this.host.querySelectorAll<HTMLElement>('.stage__plate, .stage__banner, .stage__stats, .stage__badge')].map((el) => {
      const r = el.getBoundingClientRect()
      return { x0: r.left - host.left - 4, y0: r.top - host.top - 4, x1: r.right - host.left + 4, y1: r.bottom - host.top + 4 }
    }).filter((r) => r.x1 > r.x0 && r.y1 > r.y0)
  }

  /** "What would you do?": which options are offered, the viewer's pick and whether it is revealed. */
  setChoices(state: { ids: string[]; picked: string | null } | null): void {
    for (const t of this.tokens.values()) {
      const offered = !!state && state.ids.includes(t.pid)
      t.rings.choice.visible = offered && state?.picked !== t.pid
      t.rings.picked.visible = offered && state?.picked === t.pid
    }
    this.invalidate()
  }

  /** HTML elements (e.g. choice buttons) the scene keeps positioned over pitch points. */
  track(elements: TrackedElement[]): void {
    this.tracked = elements
    this.invalidate()
  }

  setReducedMotion(reduced: boolean): void {
    this.reduced = reduced
  }

  /** Project a pitch point to CSS pixels in the stage viewport. */
  project(x: number, y: number, h = 0): { x: number; y: number; visible: boolean } {
    const v = W(x, y, h).project(this.camera)
    return { x: ((v.x + 1) / 2) * this.width, y: ((1 - v.y) / 2) * this.height, visible: v.z < 1 && Math.abs(v.x) < 1.2 && Math.abs(v.y) < 1.2 }
  }

  /**
   * Animate the real tracking for the replay window (players and ball, smoothly interpolated between
   * the 2 Hz frames), then settle back on the frozen frame and restore the current step.
   */
  playReal(frames: Frame[], entityMap: Map<string, number>, speed: number, window?: { from: number; to: number }): Promise<void> {
    this.stopReplay()
    if (!frames.length) return Promise.resolve()
    const from = window?.from ?? frames[0]!.t
    const to = window?.to ?? frames[frames.length - 1]!.t
    const data = { frames, entityMap, from, to }
    const pose: ReplayPose = { ball: { x: 0, y: 0, z: 0, visible: false }, pos: new Map() }
    // tactical layers make way for the real play
    const now0 = performance.now()
    for (const key of this.fades.keys()) this.setFade(key, 0, now0, 300)
    // the real play: every player at full strength, no sketch
    for (const t of this.tokens.values()) {
      t.shadeTarget = 1
      t.alphaTarget = 1
    }
    this.ghostAnim = null
    this.ghost.setOpacity(0)
    this.flyTo({ target: [this.cam.x, this.cam.y], distance: 96, polar: 55, azimuth: 0, fit: [] }, this.reduced ? 0 : 700)
    return new Promise<void>((resolve) => {
      let cancelled = false
      let start = 0
      const prevBall = new THREE.Vector3()
      const settle = () => {
        this.replay = null
        const t0 = performance.now()
        const starts = new Map<string, Vec2>()
        for (const tk of this.tokens.values()) starts.set(tk.pid, [...tk.at])
        const ballStart: Vec2 = [this.ball.group.position.x + HALF_L, this.ball.group.position.z + HALF_W]
        const ballHome = this.ballSpot(this.ballScaleAt || 1.45)
        const dur = this.reduced ? 0 : 900
        const tick = () => {
          const u = dur ? ease(clamp01((performance.now() - t0) / dur)) : 1
          for (const tk of this.tokens.values()) {
            const s = starts.get(tk.pid) ?? tk.home
            this.placeToken(tk, [s[0] + (tk.home[0] - s[0]) * u, s[1] + (tk.home[1] - s[1]) * u])
          }
          if (ballHome) {
            this.ball.group.position.copy(W(ballStart[0] + (ballHome[0] - ballStart[0]) * u, ballStart[1] + (ballHome[1] - ballStart[1]) * u))
            this.ball.sphere.position.y = BALL_R
            this.ball.halo.position.y = BALL_R
          }
          this.invalidate()
          if (u < 1 && !this.disposed) this.queue(tick)
          else {
            if (this.step) this.setStep(this.step)
            resolve()
          }
        }
        tick()
      }
      const frame = (now: number) => {
        if (cancelled || this.disposed) return
        if (!start) start = now
        const t = from + (now - start) * speed
        sampleReplay(data, Math.min(t, to), pose)
        for (const tk of this.tokens.values()) {
          const p = pose.pos.get(tk.pid)
          if (p) this.placeToken(tk, [p.x, p.y])
        }
        if (pose.ball.visible) {
          const pos = W(pose.ball.x, pose.ball.y)
          const moved = pos.distanceTo(prevBall)
          if (moved > 0 && moved < 30) {
            const axis = new THREE.Vector3(pos.z - prevBall.z, 0, -(pos.x - prevBall.x)).normalize()
            this.ball.sphere.rotateOnWorldAxis(axis, moved / BALL_R)
          }
          prevBall.copy(pos)
          this.ball.group.position.copy(pos)
          this.ball.sphere.position.y = BALL_R + pose.ball.z
          this.ball.halo.position.y = BALL_R + pose.ball.z
          if (!this.reduced) {
            // a broadcast camera pans with play and drifts only gently in depth
            this.cam.x += (pose.ball.x - this.cam.x) * 0.06
            this.cam.y += (Math.max(18, Math.min(50, pose.ball.y)) - this.cam.y) * 0.03
            if (!this.flight) this.applyCamera()
          }
        }
        this.invalidate()
        if (t >= to) settle()
        else this.queue(frame)
      }
      this.replay = {
        stop: () => {
          cancelled = true
          settle()
        },
      }
      this.queue(frame)
    })
  }

  stopReplay(): void {
    this.replay?.stop()
  }

  get replaying(): boolean {
    return this.replay !== null
  }

  stats(): FrameStats {
    const t = [...this.frameTimes].sort((a, b) => a - b)
    if (!t.length) return { frames: 0, avgMs: 0, p95Ms: 0, maxMs: 0 }
    return {
      frames: t.length,
      avgMs: t.reduce((s, v) => s + v, 0) / t.length,
      p95Ms: t[Math.floor(t.length * 0.95)] ?? 0,
      maxMs: t[t.length - 1] ?? 0,
    }
  }

  resetStats(): void {
    this.frameTimes.length = 0
  }

  dispose(): void {
    this.disposed = true
    this.replay = null
    if (this.raf) cancelAnimationFrame(this.raf)
    this.raf = 0
    this.resizeObserver.disconnect()
    disposeObject(this.scene)
    this.renderer.dispose()
    this.renderer.forceContextLoss()
    this.canvas.remove()
    this.overlay.remove()
  }

  // ------------------------------------------------------------ frame loop

  private queued: Array<(now: number) => void> = []

  private queue(fn: (now: number) => void): void {
    this.queued.push(fn)
    this.invalidate()
  }

  invalidate(): void {
    if (this.raf || this.disposed) return
    this.raf = requestAnimationFrame((now) => this.tick(now))
  }

  private tick(now: number): void {
    this.raf = 0
    if (this.disposed) return
    if (this.lastFrameAt && now - this.lastFrameAt < 100) this.frameTimes.push(now - this.lastFrameAt)
    if (this.frameTimes.length > 600) this.frameTimes.splice(0, 300)
    const jobs = this.queued
    this.queued = []
    for (const j of jobs) j(now)
    let active = jobs.length > 0 || this.queued.length > 0
    if (this.flight) {
      const u = this.flight.dur ? clamp01((now - this.flight.start) / this.flight.dur) : 1
      const e = ease(u)
      const { from, to } = this.flight
      this.cam = {
        x: from.x + (to.x - from.x) * e,
        y: from.y + (to.y - from.y) * e,
        distance: from.distance + (to.distance - from.distance) * e,
        polar: from.polar + (to.polar - from.polar) * e,
        azimuth: from.azimuth + (to.azimuth - from.azimuth) * e,
      }
      this.applyCamera()
      if (u >= 1) this.flight = null
      else active = true
    }
    for (const f of this.fades.values()) {
      if (now < f.start) {
        active = true
        continue
      }
      const u = f.dur ? clamp01((now - f.start) / f.dur) : 1
      const v = f.from + (f.to - f.from) * ease(u)
      if (v !== f.value) {
        f.value = v
        f.apply(v)
      }
      if (u < 1) active = true
    }
    for (const [key, g] of this.grows) {
      if (now < g.start) {
        active = true
        continue
      }
      const u = g.dur ? clamp01((now - g.start) / g.dur) : 1
      g.p = u
      g.apply(ease(u))
      if (u < 1) active = true
      else this.grows.delete(key)
    }
    if (this.ghostAnim && this.ghostCurve) {
      const u = (now - this.ghostAnim.start) / this.ghostAnim.dur
      if (u < 0) {
        this.ghost.setOpacity(0)
        active = true
      } else if (u <= 1.25) {
        const p = this.ghostCurve.getPoint(clamp01(ease(clamp01(u))))
        this.ghost.group.position.set(p.x, 0, p.z)
        this.ghost.sphere.position.y = Math.max(BALL_R, p.y)
        this.ghost.halo.position.y = this.ghost.sphere.position.y
        // fade out as it nears the receiver: the travel shows the lane, never an arrival
        const o = u < 0.12 ? u / 0.12 : u > 0.8 ? Math.max(0, 1 - (u - 0.8) / 0.4) : 1
        this.ghost.setOpacity(o * 0.85)
        this.ghost.sphere.rotation.z -= 0.18
        active = true
      } else {
        this.ghost.setOpacity(0)
        this.ghostAnim = null
      }
    }
    // hierarchy: darken / restore players smoothly (instant under reduced motion)
    const dt = this.lastTick ? Math.min(64, now - this.lastTick) : 16
    this.lastTick = now
    const k = this.reduced ? 1 : 1 - Math.exp(-dt / 240)
    for (const t of this.tokens.values()) {
      if (Math.abs(t.shade - t.shadeTarget) > 0.004 || Math.abs(t.alpha - t.alphaTarget) > 0.004) {
        t.shade += (t.shadeTarget - t.shade) * k
        t.alpha += (t.alphaTarget - t.alpha) * k
        if (Math.abs(t.shade - t.shadeTarget) <= 0.004) t.shade = t.shadeTarget
        if (Math.abs(t.alpha - t.alphaTarget) <= 0.004) t.alpha = t.alphaTarget
        this.paintToken(t)
        active = true
      }
    }
    this.updateTokenScale()
    this.renderer.render(this.scene, this.camera)
    this.layoutLabels()
    this.onFrame?.()
    this.lastFrameAt = active ? now : 0
    if (active) this.invalidate()
  }

  // ------------------------------------------------------------ camera

  private resize(): void {
    const w = Math.max(1, this.host.clientWidth)
    const h = Math.max(1, this.host.clientHeight)
    if (w === this.width && h === this.height) return
    this.width = w
    this.height = h
    this.renderer.setSize(w, h, false)
    this.canvas.style.width = `${w}px`
    this.canvas.style.height = `${h}px`
    const portrait = w / h < 1.05
    this.camera.fov = portrait ? 40 : 30
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
    this.probe.fov = this.camera.fov
    this.probe.aspect = this.camera.aspect
    this.probe.updateProjectionMatrix()
    if (this.stepCamera) {
      this.flight = null
      this.cam = this.solveCamera(this.stepCamera)
    }
    this.applyCamera()
    this.refreshObstacles()
    for (const l of this.labels) l.w = 0
    this.invalidate()
  }

  private place(cam: PerspectiveLike, target: { x: number; y: number }, distance: number, polarDeg: number, azimuthDeg = 0): void {
    const phi = (polarDeg * Math.PI) / 180
    const th = (azimuthDeg * Math.PI) / 180
    const t = W(target.x, target.y)
    cam.position.set(t.x + distance * Math.sin(phi) * Math.sin(th), t.y + distance * Math.cos(phi), t.z + distance * Math.sin(phi) * Math.cos(th))
    cam.lookAt(t)
    cam.updateMatrixWorld()
  }

  private applyCamera(): void {
    this.place(this.camera, this.cam, this.cam.distance, this.cam.polar, this.cam.azimuth)
    this.grassMat?.uniforms.uCam!.value.copy(this.camera.position)
  }

  /** Step camera at this viewport: pull back until every `fit` point is inside the safe frame. */
  private solveCamera(spec: StageCamera): CamState {
    const aspect = this.width / this.height
    const portrait = aspect < 1.05
    // phones: look more steeply down so the pitch's depth fills the tall frame
    const polar = portrait ? spec.polar - 12 : spec.polar
    const target = { x: spec.target[0], y: spec.target[1] }
    let d = spec.distance * Math.min(1, aspect / 1.6)
    if (spec.fit.length) {
      // keep clear of the title plate, of chips/buttons drawn above points and of a bottom banner on phones
      const choices = this.step?.layers.includes('choices') ?? false
      const bannerBottom = portrait && !!this.step?.banner
      const statsPlate = (this.step?.stats.length ?? 0) > 0 ? 18 + (this.step?.stats.length ?? 0) * 38 : 0
      // a clip has no title plate: a slim top margin (room for name tags) and its banner along the bottom
      const mx = this.clip ? (2 * Math.max(8, this.width * 0.05)) / this.width : (2 * 22) / this.width
      const top = this.clip ? 2 * 0.16 : (2 * (76 + (choices ? 48 : 0))) / this.height
      const bottom = this.clip ? 2 * (this.step?.banner ? 0.2 : 0.06) : (2 * (26 + Math.max(bannerBottom ? 50 : 0, statsPlate))) / this.height
      // narrow frames keep the centre of the action and let the far wings go
      const k = Math.max(0.5, Math.min(1, aspect / 1.6))
      const pts = spec.fit.flatMap((p) => {
        const x = target.x + (p[0] - target.x) * k
        return [W(x, p[1], 0), W(x, p[1], 2.4)]
      })
      const v = new THREE.Vector3()
      const fits = (dist: number) => {
        this.place(this.probe, target, dist, polar, spec.azimuth)
        return pts.every((p) => {
          v.copy(p).project(this.probe)
          return v.z < 1 && v.x >= -1 + mx && v.x <= 1 - mx && v.y >= -1 + bottom && v.y <= 1 - top
        })
      }
      const solve = (start: number) => {
        if (fits(start)) return start
        let lo = start
        let hi = 520
        for (let i = 0; i < 22; i += 1) {
          const mid = (lo + hi) / 2
          if (fits(mid)) hi = mid
          else lo = mid
        }
        return hi
      }
      const base = d
      const tanHalf = Math.tan((this.probe.fov * Math.PI) / 360)
      const fwd = new THREE.Vector3()
      const right = new THREE.Vector3()
      const up = new THREE.Vector3(0, 1, 0)
      // centre the action in the safe band, then pull back only as far as needed (a few passes converge)
      for (let pass = 0; pass < 4; pass += 1) {
        d = solve(base)
        this.place(this.probe, target, d, polar, spec.azimuth)
        let x0 = Infinity
        let x1 = -Infinity
        let y0 = Infinity
        let y1 = -Infinity
        for (const p of pts) {
          v.copy(p).project(this.probe)
          x0 = Math.min(x0, v.x)
          x1 = Math.max(x1, v.x)
          y0 = Math.min(y0, v.y)
          y1 = Math.max(y1, v.y)
        }
        const errY = (-1 + bottom + (1 - top)) / 2 - (y0 + y1) / 2
        const errX = -(x0 + x1) / 2
        if (Math.abs(errY) < 0.02 && Math.abs(errX) < 0.02) break
        fwd.copy(W(target.x, target.y)).sub(this.probe.position).setY(0).normalize()
        right.crossVectors(fwd, up).normalize()
        const depthPerNdc = (d * tanHalf) / Math.max(0.35, Math.cos((polar * Math.PI) / 180))
        const widthPerNdc = d * tanHalf * aspect
        // content too low on screen -> look nearer; too far right -> look further right
        const shift = fwd.multiplyScalar(-errY * depthPerNdc * 0.85).add(right.multiplyScalar(-errX * widthPerNdc * 0.85))
        target.x = Math.max(-8, Math.min(PITCH_LENGTH + 8, target.x + shift.x))
        target.y = Math.max(-8, Math.min(PITCH_WIDTH + 8, target.y + shift.z))
      }
    }
    return { x: target.x, y: target.y, distance: d, polar, azimuth: spec.azimuth }
  }

  private flyTo(spec: StageCamera, ms: number): void {
    if (spec.fit.length) this.stepCamera = spec
    const to = spec.fit.length
      ? this.solveCamera(spec)
      : { x: spec.target[0], y: spec.target[1], distance: spec.distance, polar: spec.polar, azimuth: spec.azimuth }
    if (!ms) {
      this.flight = null
      this.cam = to
      this.applyCamera()
      return
    }
    this.flight = { from: { ...this.cam }, to, start: performance.now(), dur: ms }
  }

  // ------------------------------------------------------------ fades and labels

  private register(key: string, apply: (v: number) => void): void {
    this.fades.set(key, { value: 0, from: 0, to: 0, start: 0, dur: 0, apply })
    apply(0)
  }

  private setFade(key: string, to: number, start: number, dur: number): void {
    const f = this.fades.get(key)
    if (!f) return
    f.from = f.value
    f.to = to
    f.start = start
    f.dur = dur
    if (!dur && start <= performance.now()) {
      f.value = to
      f.apply(to)
    }
  }

  private growers = new Map<string, (p: number) => void>()
  /** Layers that put something on the pitch (each takes a beat in the reveal). */
  private readonly drawn = new Set<string>()

  private startGrow(key: string, start: number, instant: boolean): void {
    const apply = this.growers.get(key)
    if (!apply) return
    if (instant) {
      this.grows.delete(key)
      apply(1)
      return
    }
    apply(0)
    this.grows.set(key, { p: 0, start, dur: this.growMs(key), apply })
  }

  private label(kind: LabelKind, text: string, anchor: () => THREE.Vector3, fade: string, priority: number, lift = 10): Label {
    const el = document.createElement('div')
    el.className = `stage-label stage-label--${kind}`
    el.style.opacity = '0'
    this.overlay.append(el)
    const l: Label = { el, text, anchor, fade, priority, lift, w: 0, h: 0 }
    this.labels.push(l)
    return l
  }

  private layoutLabels(): void {
    // the title plate, banner and stat plate are taken first: no label is ever drawn under them
    const placed: Array<{ x0: number; y0: number; x1: number; y1: number }> = [...this.obstacles]
    const v = new THREE.Vector3()
    const items: Array<{ l: Label; o: number; x: number; y: number }> = []
    for (const l of this.labels) {
      // labels belong to fully-on layers: a quietened (dimmed) layer keeps its marks, not its words
      const raw = this.fades.get(l.fade)?.value ?? 0
      const o = clamp01((raw - DIM) / (1 - DIM))
      // a clip carries one label set only: player names (its banner says what kind of picture it is)
      const clipHidden = this.clip && !l.el.classList.contains('stage-label--name') && !l.el.classList.contains('stage-label--name-carrier')
      if (o < 0.02 || clipHidden) {
        if (l.el.style.opacity !== '0') l.el.style.opacity = '0'
        continue
      }
      v.copy(l.anchor()).project(this.camera)
      if (v.z >= 1 || Math.abs(v.x) > 1.1 || Math.abs(v.y) > 1.1) {
        l.el.style.opacity = '0'
        continue
      }
      items.push({ l, o, x: ((v.x + 1) / 2) * this.width, y: ((1 - v.y) / 2) * this.height })
    }
    items.sort((a, b) => b.l.priority - a.l.priority)
    const pad = 3
    for (const it of items) {
      const { l } = it
      if (!l.el.textContent) {
        l.el.textContent = l.text
        l.w = 0
      }
      if (!l.w) {
        l.w = l.el.offsetWidth
        l.h = l.el.offsetHeight
      }
      // above the anchor first, then stacked higher or nudged sideways, and only then below the shirt
      // (each candidate clamped into the frame); a label never covers the player it names if it can help it
      const up = l.h + 4
      const side = l.w / 2 + 12
      const below = l.h + l.lift + 14
      const tries: Array<[number, number]> = [[0, 0], [0, -up], [side, 0], [-side, 0], [side, -up], [-side, -up], [0, -2 * up], [0, below], [side, below], [-side, below]]
      let chosen: { x: number; y: number } | null = null
      for (const [dx, dy] of tries) {
        const x0 = Math.max(4, Math.min(this.width - l.w - 4, it.x - l.w / 2 + dx))
        const y0 = Math.max(2, Math.min(this.height - l.h - 2, it.y - l.lift - l.h + dy))
        const box = { x0: x0 - pad, y0: y0 - pad, x1: x0 + l.w + pad, y1: y0 + l.h + pad }
        if (!placed.some((b) => box.x0 < b.x1 && box.x1 > b.x0 && box.y0 < b.y1 && box.y1 > b.y0)) {
          chosen = { x: x0, y: y0 }
          placed.push(box)
          break
        }
      }
      // a label with nowhere free to go is dropped rather than drawn over another (or under a plate)
      const o = chosen === null ? 0 : it.o
      const at = chosen ?? { x: Math.max(4, it.x - l.w / 2), y: Math.max(2, it.y - l.lift - l.h) }
      l.el.style.transform = `translate3d(${Math.round(at.x)}px, ${Math.round(at.y)}px, 0)`
      l.el.style.opacity = o.toFixed(3)
    }
    for (const t of this.tracked) {
      const p = W(t.at[0], t.at[1], 0.4).project(this.camera)
      const x = ((p.x + 1) / 2) * this.width
      const y = ((1 - p.y) / 2) * this.height - (t.lift ?? 0)
      t.el.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0) translate(-50%, -100%)`
    }
  }

  // ------------------------------------------------------------ building

  private buildLights(): void {
    this.scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x0b1a12, 1.15))
    const key = new THREE.DirectionalLight(0xfff1d6, 1.6)
    key.position.set(-45, 90, 60)
    const fill = new THREE.DirectionalLight(0xd6e2ff, 0.7)
    fill.position.set(60, 70, -50)
    this.scene.add(key, fill)
  }

  private buildPitch(): void {
    const aniso = this.renderer.capabilities.getMaxAnisotropy()
    // surround (night) and the grass
    const surround = new THREE.Mesh(
      new THREE.PlaneGeometry(900, 900).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: '#0d1916' }),
    )
    surround.position.y = -0.06
    this.grassMat = grassMaterial(grassTexture(aniso), grassDetailTexture(aniso))
    const grass = new THREE.Mesh(new THREE.PlaneGeometry(AREA_L, AREA_W).rotateX(-Math.PI / 2), this.grassMat)
    this.world.add(surround, grass)

    // floodlight haze hanging over the far stand and the ends: depth behind the pitch, never on it
    const hazeTex = (() => {
      const c = document.createElement('canvas')
      c.width = 4
      c.height = 128
      const ctx = c.getContext('2d')
      if (ctx) {
        const g = ctx.createLinearGradient(0, 0, 0, 128)
        g.addColorStop(0, 'rgba(255,255,255,0)')
        g.addColorStop(0.7, 'rgba(255,255,255,0.35)')
        g.addColorStop(1, 'rgba(255,255,255,0.75)')
        ctx.fillStyle = g
        ctx.fillRect(0, 0, 4, 128)
      }
      const t = new THREE.CanvasTexture(c)
      t.colorSpace = THREE.SRGBColorSpace
      return t
    })()
    const hazeMat = new THREE.MeshBasicMaterial({ color: '#2f4a44', map: hazeTex, transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending, fog: false })
    const hazeFar = new THREE.Mesh(new THREE.PlaneGeometry(PITCH_LENGTH + 140, 30), hazeMat)
    hazeFar.position.copy(W(PITCH_LENGTH / 2, -38, 15))
    hazeFar.renderOrder = -1
    this.world.add(hazeFar)

    // chalk markings at the true 105 x 68 dimensions
    const lw = 0.14
    const h = 0.012
    const g: THREE.BufferGeometry[] = []
    const L = PITCH_LENGTH
    const Wd = PITCH_WIDTH
    const line = (a: Vec2, b: Vec2) => g.push(ribbon(a, b, lw, h))
    line([-lw / 2, 0], [L + lw / 2, 0])
    line([-lw / 2, Wd], [L + lw / 2, Wd])
    line([0, 0], [0, Wd])
    line([L, 0], [L, Wd])
    line([L / 2, 0], [L / 2, Wd])
    g.push(arc([L / 2, Wd / 2], 9.15, lw, 0, 360, h), disc([L / 2, Wd / 2], 0.22, h))
    for (const side of [0, 1] as const) {
      const x0 = side ? L : 0
      const s = side ? -1 : 1
      const pa = 16.5
      const pw = 20.16
      const ga = 5.5
      const gw = 9.16
      line([x0 + s * pa, Wd / 2 - pw], [x0 + s * pa, Wd / 2 + pw])
      line([x0, Wd / 2 - pw], [x0 + s * pa, Wd / 2 - pw])
      line([x0, Wd / 2 + pw], [x0 + s * pa, Wd / 2 + pw])
      line([x0 + s * ga, Wd / 2 - gw], [x0 + s * ga, Wd / 2 + gw])
      line([x0, Wd / 2 - gw], [x0 + s * ga, Wd / 2 - gw])
      line([x0, Wd / 2 + gw], [x0 + s * ga, Wd / 2 + gw])
      g.push(disc([x0 + s * 11, Wd / 2], 0.18, h))
      const a = (Math.acos(5.5 / 9.15) * 180) / Math.PI
      g.push(side ? arc([x0 - 11, Wd / 2], 9.15, lw, 180 - a, 180 + a, h) : arc([x0 + 11, Wd / 2], 9.15, lw, -a, a, h))
    }
    g.push(arc([0, 0], 1, lw, 0, 90, h), arc([L, 0], 1, lw, 90, 180, h), arc([L, Wd], 1, lw, 180, 270, h), arc([0, Wd], 1, lw, 270, 360, h))
    const chalk = new THREE.MeshBasicMaterial({ color: COL.chalk, transparent: true, opacity: 0.88, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 })
    const markings = new THREE.Mesh(mergeGeometries(g)!, chalk)
    markings.renderOrder = 1
    this.world.add(markings)

    // goals with nets
    const post = new THREE.MeshStandardMaterial({ color: '#f4f3ee', roughness: 0.35 })
    const netMat = new THREE.LineBasicMaterial({ color: '#e9ecef', transparent: true, opacity: 0.32 })
    for (const side of [0, 1] as const) {
      const gx = side ? L : 0
      const s = side ? 1 : -1
      const goal = new THREE.Group()
      const r = 0.07
      const hw = 7.32 / 2
      const gh = 2.44
      const depth = 2.0
      for (const yy of [-hw, hw]) {
        const p = new THREE.Mesh(new THREE.CylinderGeometry(r, r, gh, 12), post)
        p.position.copy(W(gx, Wd / 2 + yy, gh / 2))
        goal.add(p)
      }
      const bar = new THREE.Mesh(new THREE.CylinderGeometry(r, r, hw * 2 + r * 2, 12).rotateX(Math.PI / 2), post)
      bar.position.copy(W(gx, Wd / 2, gh))
      goal.add(bar)
      const pts: THREE.Vector3[] = []
      const back = gx + s * depth
      const top = 1.9
      for (let yy = -hw; yy <= hw + 0.01; yy += 0.4) {
        pts.push(W(back, Wd / 2 + yy, 0), W(back, Wd / 2 + yy, top))
        pts.push(W(gx, Wd / 2 + yy, gh), W(back, Wd / 2 + yy, top))
      }
      for (let hh = 0; hh <= top + 0.01; hh += 0.4) pts.push(W(back, Wd / 2 - hw, hh), W(back, Wd / 2 + hw, hh))
      for (const yy of [-hw, hw]) {
        for (let d = 0; d <= depth + 0.01; d += 0.4) {
          const hx = gh + ((top - gh) * d) / depth
          pts.push(W(gx + s * d, Wd / 2 + yy, 0), W(gx + s * d, Wd / 2 + yy, hx))
        }
        for (let hh = 0; hh <= gh; hh += 0.4) pts.push(W(gx, Wd / 2 + yy, hh), W(back, Wd / 2 + yy, Math.min(hh, top)))
      }
      const net = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts), netMat)
      goal.add(net)
      this.world.add(goal)
    }

    // low perimeter boards on the far side and the ends, for depth
    const boardMat = new THREE.MeshStandardMaterial({ color: '#121B1E', roughness: 0.9 })
    const stripMat = new THREE.MeshBasicMaterial({ color: '#2b3a3d' })
    const board = (a: Vec2, b: Vec2) => {
      const len = Math.hypot(b[0] - a[0], b[1] - a[1])
      const m = new THREE.Mesh(new THREE.BoxGeometry(len, 0.9, 0.18), boardMat)
      m.position.copy(W((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, 0.45))
      m.rotation.y = -Math.atan2(b[1] - a[1], b[0] - a[0])
      const strip = new THREE.Mesh(new THREE.BoxGeometry(len, 0.05, 0.2), stripMat)
      strip.position.y = 0.45
      m.add(strip)
      this.world.add(m)
    }
    board([-5, -5.5], [L + 5, -5.5])
    board([-6, -5], [-6, Wd + 5])
    board([L + 6, -5], [L + 6, Wd + 5])

    // a quiet stand silhouette behind the far touchline and the ends, fading into the night
    const standMat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide })
    const low = new THREE.Color('#16222a')
    const high = new THREE.Color(COL.night)
    const rake = (len: number, depth: number, rise: number) => {
      const g = new THREE.PlaneGeometry(len, Math.hypot(depth, rise), 1, 6)
      g.rotateX(-Math.PI / 2 + Math.atan2(rise, depth))
      // lit low down by the floodlights, fading into the night at the top
      const pos = g.getAttribute('position')
      const cols = new Float32Array(pos.count * 3)
      const c = new THREE.Color()
      for (let i = 0; i < pos.count; i += 1) {
        const u = (pos.getY(i) + rise / 2) / rise
        c.copy(low).lerp(high, Math.max(0, Math.min(1, u)))
        cols.set([c.r, c.g, c.b], i * 3)
      }
      g.setAttribute('color', new THREE.BufferAttribute(cols, 3))
      return g
    }
    const far = new THREE.Mesh(rake(L + 40, 26, 14), standMat)
    far.position.copy(W(L / 2, -9 - 13, 7))
    const endL = new THREE.Mesh(rake(Wd + 24, 22, 11), standMat)
    endL.rotation.y = Math.PI / 2
    endL.position.copy(W(-10 - 11, Wd / 2, 5.5))
    const endR = new THREE.Mesh(rake(Wd + 24, 22, 11), standMat)
    endR.rotation.y = -Math.PI / 2
    endR.position.copy(W(L + 10 + 11, Wd / 2, 5.5))
    this.world.add(far, endL, endR)
  }

  private refreshDiscs(): void {
    for (const p of this.model.players) {
      const t = this.tokens.get(p.pid)
      if (!t) continue
      const mat = t.shirt.material
      mat.map?.dispose()
      mat.map = shirtTexture(p.fill, p.trim, p.ink, p.number)
      mat.needsUpdate = true
    }
  }

  /**
   * Players as shirt markers: an upright, camera-facing shirt in the kit colour with a large number,
   * standing on a small base disc at the player's exact tracked spot (rings and lanes use the base).
   */
  private buildTokens(): void {
    const shadowTex = radialTexture('rgba(0,0,0,0.62)', 'rgba(0,0,0,0)', 64, [[0.45, 'rgba(0,0,0,0.3)']])
    const R = TOKEN_R
    const ringGeo = (a: number, b: number) => new THREE.RingGeometry(a, b, 48).rotateX(-Math.PI / 2)
    const baseGeo = new THREE.CircleGeometry(R * 0.62, 32).rotateX(-Math.PI / 2)
    const rimGeo = ringGeo(R * 0.62, R * 0.62 + 0.14)
    const shadowGeo = new THREE.PlaneGeometry(3.2, 3.2).rotateX(-Math.PI / 2)
    for (const p of this.model.players) {
      const group = new THREE.Group()
      const mk = <M extends THREE.Material & { opacity: number }>(m: M): M => {
        m.transparent = true
        return m
      }
      const base = mk(new THREE.MeshBasicMaterial({ color: p.fill, depthWrite: false }))
      const rim = mk(new THREE.MeshBasicMaterial({ color: COL.chalk, depthWrite: false }))
      const shadow = mk(new THREE.MeshBasicMaterial({ map: shadowTex, depthWrite: false }))
      const shirtMat = mk(new THREE.SpriteMaterial({ map: shirtTexture(p.fill, p.trim, p.ink, p.number), alphaTest: 0.04, depthWrite: true }))
      const mShadow = new THREE.Mesh(shadowGeo, shadow)
      mShadow.position.y = 0.02
      mShadow.renderOrder = 2
      const mBase = new THREE.Mesh(baseGeo, base)
      mBase.position.y = 0.035
      mBase.renderOrder = 3
      const mRim = new THREE.Mesh(rimGeo, rim)
      mRim.position.y = 0.036
      mRim.renderOrder = 3
      const shirt = new THREE.Sprite(shirtMat)
      shirt.center.set(0.5, 0)
      shirt.position.y = SHIRT_LIFT
      shirt.scale.set(SHIRT_W, SHIRT_H, 1)
      shirt.renderOrder = 9
      const ring = (geo: THREE.BufferGeometry, color: string, opacity = 0.95) => {
        const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false }))
        m.position.y = 0.03
        m.renderOrder = 3
        m.visible = false
        group.add(m)
        return m
      }
      const rings = {
        // the player on the ball: a bold chalk ring; other named players: a thin one
        focus: ring(ringGeo(R + 0.3, R + 0.66), COL.chalk),
        named: ring(ringGeo(R + 0.3, R + 0.46), COL.chalk, 0.8),
        lane: ring(ringGeo(R + 0.4, R + 0.75), COL.against),
        between: ring(ringGeo(R + 0.4, R + 0.62), COL.measured),
        choice: ring(dashedRing(R + 0.9, 0.26, 14), COL.chalk, 0.9),
        picked: ring(ringGeo(R + 0.7, R + 1.05), COL.chalk),
      }
      group.add(mShadow, mBase, mRim, shirt)
      const t: Token = {
        pid: p.pid, group, shirt, mats: [base, rim, shadow, shirtMat], rings, home: [p.x, p.y], at: [p.x, p.y], focus: 0,
        shade: 1, shadeTarget: 1, alpha: 1, alphaTarget: 1, fill: new THREE.Color(p.fill),
      }
      this.placeToken(t, [p.x, p.y])
      this.tokens.set(p.pid, t)
      this.world.add(group)
    }
  }

  private placeToken(t: Token, at: Vec2): void {
    t.at = at
    t.group.position.copy(W(at[0], at[1]))
  }


  private updateTokenScale(): void {
    // shirts grow a little on wide shots, and never drop below a legible height on screen (the
    // number is about half the shirt): ~24 px on phones, ~27 px on desktop
    const ppm = this.height / (2 * this.cam.distance * Math.tan((this.camera.fov * Math.PI) / 360))
    // a clip scales with its frame (a corner picture-in-picture must not become a wall of shirts)
    const minPx = this.clip ? Math.max(13, this.height * 0.085) : this.width < 600 ? 24 : 27
    const s = this.clip
      ? Math.max(0.7, Math.min(2.8, minPx / (SHIRT_H * ppm)))
      : Math.max(0.85, Math.min(2.8, Math.max(this.cam.distance / 92, minPx / (SHIRT_H * ppm))))
    for (const t of this.tokens.values()) t.group.scale.setScalar(s * (1 + 0.14 * t.focus))
    for (const g of this.ghosts.values()) g.group.scale.setScalar(s * 1.06)
    const bs = Math.max(1.1, s * 1.05)
    this.ball.group.scale.setScalar(bs)
    this.ghost.group.scale.setScalar(bs)
    this.assumed.group.scale.setScalar(bs * 0.9)
    if (!this.replay && Math.abs(s - this.ballScaleAt) > 0.01) {
      this.ballScaleAt = s
      const spot = this.ballSpot(s)
      if (spot) this.ball.group.position.copy(W(spot[0], spot[1]))
      const from = this.assumedAt()
      if (from) {
        const a = this.ballSpot(s, from)
        if (a) this.assumed.group.position.copy(W(a[0], a[1]))
      }
    }
  }

  /** Where a continuation or an illustrative sketch assumes the ball: the alternative receiver's frozen spot. */
  private assumedAt(): Vec2 | null {
    return this.model.continuation?.from ?? this.model.illustrative?.from ?? null
  }

  private ballScaleAt = 0

  /**
   * Where the ball is drawn on the frozen frame: its tracked spot, nudged just outside any marker it
   * would hide under (a shirt is drawn far wider than a player), towards the attacking direction.
   * `at` draws another ball (the simulated continuation's assumed ball) by the same rule.
   */
  private ballSpot(scale = 1.45, at?: Vec2): Vec2 | null {
    const b = at ?? this.model.ball
    if (!b) return null
    const clear = TOKEN_R * scale * 1.05 + BALL_R * Math.max(1.1, scale * 1.05) + 0.15
    let spot: Vec2 = [...b]
    for (let pass = 0; pass < 2; pass += 1) {
      for (const p of this.model.players) {
        const dx = spot[0] - p.x
        const dy = spot[1] - p.y
        const d = Math.hypot(dx, dy)
        if (d >= clear) continue
        const dir = this.model.direction === '+x' ? 1 : -1
        const ux = d > 0.05 ? dx / d : dir
        const uy = d > 0.05 ? dy / d : 0
        spot = [p.x + ux * clear, p.y + uy * clear]
      }
    }
    return spot
  }

  private buildBall(): void {
    // a neutral chalk halo: amber is reserved for AI-verified text, never drawn geometry
    this.ball = makeBall({ halo: 'rgba(250, 248, 240, 0.6)' })
    const spot = this.ballSpot()
    if (spot) this.ball.group.position.copy(W(spot[0], spot[1]))
    this.ball.setOpacity(this.model.ball ? 1 : 0)
    this.world.add(this.ball.group)
    this.ghost = makeBall({ halo: 'rgba(183, 164, 255, 0.6)', tint: new THREE.Color(0.74, 0.66, 1.0), opacity: 0.62 })
    this.ghost.setOpacity(0)
    this.world.add(this.ghost.group)
    // the continuation's assumed ball: paler still, standing at the hypothetical receiver's feet
    this.assumed = makeBall({ halo: 'rgba(220, 211, 255, 0.5)', tint: new THREE.Color(0.86, 0.82, 1.0), opacity: 0.7 })
    this.assumed.setOpacity(0)
    const from = this.assumedAt()
    const a = from ? this.ballSpot(1.45, from) : null
    if (a) this.assumed.group.position.copy(W(a[0], a[1]))
    this.world.add(this.assumed.group)
  }

  /**
   * Label anchor on a player: `h` = 1 is the top of the shirt (labels sit above it). While an illustrative ghost
   * stands in for the player, the name follows the ghost (where the step's idea is).
   */
  private tokenAnchor(pid: string, h = 1): () => THREE.Vector3 {
    const v = new THREE.Vector3()
    return () => {
      const g = this.ghosts.get(pid)
      if (g && g.group.visible && Math.max(...Object.values(g.vis)) > 0.5) {
        return v.set(g.group.position.x, (SHIRT_LIFT + SHIRT_H * h) * g.group.scale.y, g.group.position.z)
      }
      const t = this.tokens.get(pid)
      if (!t) return v.set(0, -999, 0)
      return v.set(t.group.position.x, (SHIRT_LIFT + SHIRT_H * h) * t.group.scale.y, t.group.position.z)
    }
  }

  private fixed(x: number, y: number, h = 0): () => THREE.Vector3 {
    const v = W(x, y, h)
    return () => v
  }

  /**
   * Anchor that slides along a line across the pitch (constant x) to the first point that is in
   * shot, starting from the preferred touchline: labels stay on screen whatever the camera frames.
   */
  private alongLine(x: number, preferY: number, h: number): () => THREE.Vector3 {
    const v = new THREE.Vector3()
    const p = new THREE.Vector3()
    const ys: number[] = []
    for (let y = 0; y <= PITCH_WIDTH; y += 3) ys.push(y)
    if (preferY > HALF_W) ys.reverse()
    return () => {
      for (const y of ys) {
        p.copy(W(x, y, h)).project(this.camera)
        if (p.z < 1 && Math.abs(p.x) < 0.9 && p.y < 0.72 && p.y > -0.9) return v.copy(W(x, y, h))
      }
      return v.copy(W(x, preferY, h))
    }
  }

  private ringsLayer(key: StageLayer, ids: string[], ring: keyof Token['rings']): void {
    const toks = ids.map((id) => this.tokens.get(id)).filter((t): t is Token => !!t)
    if (toks.length) this.drawn.add(key)
    this.register(key, (v) => {
      for (const t of toks) {
        const r = t.rings[ring]
        r.visible = v > 0.01
        ;(r.material as THREE.MeshBasicMaterial).opacity = 0.95 * v
        r.scale.setScalar(0.75 + 0.25 * Math.min(1, v * 1.4))
      }
    })
  }

  private meshLayer(key: StageLayer, group: THREE.Object3D, mats: Array<{ m: THREE.Material & { opacity: number }; base: number }>): void {
    this.world.add(group)
    this.drawn.add(key)
    this.register(key, (v) => {
      group.visible = v > 0.01
      for (const { m, base } of mats) {
        if (m instanceof THREE.ShaderMaterial) m.uniforms.uOpacity!.value = base * v
        else m.opacity = base * v
      }
    })
  }

  private buildLayers(): void {
    const m = this.model
    const labelSideFar = m.labelY < PITCH_WIDTH / 2

    // name tags for every player who may be focused (cheap; only shown when a step asks)
    for (const p of m.players) {
      const key = `name:${p.pid}`
      const tk = this.tokens.get(p.pid)!
      const isCarrier = p.pid === m.carrierId
      const ring = isCarrier ? tk.rings.focus : tk.rings.named
      this.register(key, (v) => {
        tk.focus = v
        // a bold chalk ring for the player on the ball, a thin one for every other named player
        ring.visible = v > 0.01
        this.paintNameRing(tk)
      })
      this.label(isCarrier ? 'name-carrier' : 'name', isCarrier ? `${p.name} · on the ball` : p.name, this.tokenAnchor(p.pid), key, isCarrier ? 70 : 40, 6)
    }

    // ---- direction: chevrons on the grass + label
    {
      const g = new THREE.Group()
      const mat = new THREE.MeshBasicMaterial({ color: COL.chalk, transparent: true, opacity: 0.6, depthWrite: false })
      const shape = new THREE.Shape()
      shape.moveTo(-1.3, 1.9)
      shape.lineTo(0.35, 0)
      shape.lineTo(-1.3, -1.9)
      shape.lineTo(-2.15, -1.9)
      shape.lineTo(-0.5, 0)
      shape.lineTo(-2.15, 1.9)
      shape.closePath()
      const s = m.direction === '+x' ? 1 : -1
      const [cx, cy] = directionSpot(m)
      const mats: Array<{ m: THREE.MeshBasicMaterial; base: number }> = []
      for (let i = 0; i < 3; i += 1) {
        const mm = mat.clone()
        const geo = new THREE.ShapeGeometry(shape).rotateX(-Math.PI / 2)
        const c = new THREE.Mesh(geo, mm)
        c.position.copy(W(cx + s * (i - 1) * 3.1, cy, 0.02))
        if (s < 0) c.rotation.y = Math.PI
        c.renderOrder = 2
        g.add(c)
        mats.push({ m: mm, base: 0.32 + i * 0.16 })
      }
      this.meshLayer('direction', g, mats)
      this.label('direction', `${m.labels.attacking} ${s > 0 ? '→' : '←'}`, this.fixed(cx, cy + (cy < HALF_W ? -3.2 : 3.8), 0), 'direction', 30, 4)
    }

    // ---- carrier: the ball stays; a flood ring marks the player on it (via name tag fade)
    this.register('carrier', () => {})

    // ---- lines: translucent curtains across the pitch width + ground lines
    if (m.lines) {
      const g = new THREE.Group()
      const tex = curtainTexture()
      const mats: Array<{ m: THREE.Material & { opacity: number }; base: number }> = []
      for (const [x, label] of [[m.lines.back, m.labels.backLine], [m.lines.mid, m.labels.midLine]] as const) {
        const cm = new THREE.MeshBasicMaterial({ color: COL.chalk, map: tex, transparent: true, depthWrite: false, side: THREE.DoubleSide })
        const curtain = new THREE.Mesh(new THREE.PlaneGeometry(PITCH_WIDTH, 3), cm)
        curtain.rotation.y = Math.PI / 2
        curtain.position.copy(W(x, HALF_W, 1.5))
        curtain.renderOrder = 4
        const lm = new THREE.MeshBasicMaterial({ color: COL.chalk, transparent: true, depthWrite: false })
        const ground = new THREE.Mesh(ribbon([x, 0], [x, PITCH_WIDTH], 0.24, 0.02), lm)
        ground.renderOrder = 2
        const tm = new THREE.MeshBasicMaterial({ color: COL.chalk, transparent: true, depthWrite: false })
        const top = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, PITCH_WIDTH), tm)
        top.position.copy(W(x, HALF_W, 3))
        g.add(curtain, ground, top)
        mats.push({ m: cm, base: 0.42 }, { m: lm, base: 0.9 }, { m: tm, base: 0.5 })
        this.label('line', label, this.alongLine(x, m.labelY, 3.1), 'lines', 55, 6)
      }
      this.meshLayer('lines', g, mats)

      // the gap, measured: a teal dimension bracket between the two lines
      const gg = new THREE.Group()
      const gm = new THREE.MeshBasicMaterial({ color: COL.measured, transparent: true, depthWrite: false })
      const gy = m.labelY
      const geo = mergeGeometries([
        ribbon([m.lines.mid, gy], [m.lines.back, gy], 0.22, 0.04),
        ribbon([m.lines.mid, gy - 1.1], [m.lines.mid, gy + 1.1], 0.22, 0.04),
        ribbon([m.lines.back, gy - 1.1], [m.lines.back, gy + 1.1], 0.22, 0.04),
      ])!
      const bracket = new THREE.Mesh(geo, gm)
      bracket.renderOrder = 3
      gg.add(bracket)
      this.meshLayer('gap', gg, [{ m: gm, base: 0.95 }])
      if (m.labels.gap) this.label('chip-measured', m.labels.gap, this.fixed((m.lines.mid + m.lines.back) / 2, gy, 0.05), 'gap', 65, 6)

      // offside line: dashed chalk on the grass
      const og = new THREE.Group()
      const om = new THREE.MeshBasicMaterial({ color: COL.chalk, transparent: true, depthWrite: false })
      const off = new THREE.Mesh(dashedRibbon([m.lines.offside, 0], [m.lines.offside, PITCH_WIDTH], 0.16, 1.1, 0.9, 0.025), om)
      off.renderOrder = 2
      og.add(off)
      this.meshLayer('offside', og, [{ m: om, base: 0.8 }])
      this.label('line', m.labels.offside, this.alongLine(m.lines.offside, labelSideFar ? 0 : PITCH_WIDTH, 0.1), 'offside', 35, 6)
    } else {
      for (const k of ['lines', 'gap', 'offside'] as const) this.register(k, () => {})
    }

    // ---- players between the lines, opponents in the lane
    this.ringsLayer('between', m.betweenIds, 'between')
    this.ringsLayer('laneOpponents', m.laneOpponentIds, 'lane')

    // ---- the actual pass: coral arc to the interception marker
    if (m.actual) {
      const g = new THREE.Group()
      const curve = passCurve(m.actual.from, m.actual.to, 0.2, 0.8)
      const tm = laneMaterial(COL.against, 1)
      const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 64, 0.16 * this.thick, 10), tm)
      tube.renderOrder = 7
      const xm = new THREE.MeshBasicMaterial({ color: COL.against, transparent: true, depthWrite: false })
      const cross = new THREE.Mesh(
        mergeGeometries([new THREE.PlaneGeometry(2.2, 0.36).rotateZ(Math.PI / 4), new THREE.PlaneGeometry(2.2, 0.36).rotateZ(-Math.PI / 4)])!.rotateX(-Math.PI / 2),
        xm,
      )
      cross.position.copy(W(m.actual.to[0], m.actual.to[1], 0.05))
      cross.renderOrder = 8
      cross.visible = false
      g.add(tube, cross)
      this.meshLayer('actualPass', g, [{ m: tm, base: 1 }, { m: xm, base: 1 }])
      this.growers.set('actualPass', (p) => {
        tm.uniforms.uProgress!.value = p
        cross.visible = p > 0.97
        cross.scale.setScalar(p > 0.97 ? 1 : 0.4)
      })
      tm.uniforms.uProgress!.value = 1
      cross.visible = true
      if (m.labels.intercepted) this.label('chip-against', m.labels.intercepted, this.fixed(m.actual.to[0], Math.min(PITCH_WIDTH + 2, m.actual.to[1] + 4.5), 0), 'actualPass', 75, 0)
    } else {
      this.register('actualPass', () => {})
    }

    // ---- measured alternatives: teal lanes, corridors and receiver-space rings
    const optionLanes = (key: 'alternatives' | 'bestLane', options: StageOption[]) => {
      const g = new THREE.Group()
      const mats: Array<{ m: THREE.Material & { opacity: number }; base: number }> = []
      const parts: Array<(p: number) => void> = []
      options.forEach((o: StageOption) => {
        const half = Math.min(o.clearance, 6)
        const cm = laneMaterial(COL.measured, 0.17, 0)
        cm.uniforms.uShade!.value = 0
        const cor = new THREE.Mesh(corridor(m.origin!, o.to, half * 0.22, half, 0.05), cm)
        cor.renderOrder = 3
        const lm = laneMaterial(COL.measured, 1, 0)
        const lane = new THREE.Mesh(new THREE.TubeGeometry(passCurve(m.origin!, o.to, TOKEN_R + 1.2, 0.55), 64, 0.1 * this.thick, 8), lm)
        lane.renderOrder = 6
        const sr = Math.min(o.space, 14)
        const rm = new THREE.MeshBasicMaterial({ color: COL.measured, transparent: true, depthWrite: false })
        const fm = new THREE.MeshBasicMaterial({ color: COL.measured, transparent: true, depthWrite: false })
        const ring = new THREE.Mesh(new THREE.RingGeometry(sr - 0.11, sr, 96).rotateX(-Math.PI / 2), rm)
        const fill = new THREE.Mesh(new THREE.CircleGeometry(sr, 96).rotateX(-Math.PI / 2), fm)
        const ringG = new THREE.Group()
        ringG.add(fill, ring)
        ringG.position.copy(W(o.to[0], o.to[1], 0.035))
        ring.renderOrder = 3
        fill.renderOrder = 2
        g.add(cor, lane, ringG)
        mats.push({ m: cm, base: 0.17 }, { m: lm, base: 1 }, { m: rm, base: 0.6 }, { m: fm, base: 0.05 })
        parts.push((p) => {
          cm.uniforms.uProgress!.value = p
          lm.uniforms.uProgress!.value = p
          const s = clamp01((p - 0.6) / 0.4)
          ringG.scale.setScalar(Math.max(0.001, s))
          ringG.visible = s > 0
        })
        parts[parts.length - 1]!(1)
        this.label('chip-measured', o.chip, this.tokenAnchor(o.receiverId), key, 60, 6)
      })
      this.meshLayer(key, g, mats)
      this.growers.set(key, (p) => {
        const n = parts.length
        parts.forEach((fn, i) => fn(clamp01(p * n - i)))
      })
    }
    if (m.origin && m.options.length) optionLanes('alternatives', m.options)
    else this.register('alternatives', () => {})
    // the takeaway: only the best measured lane, beside the real pass
    if (m.origin && m.best) optionLanes('bestLane', [m.best])
    else this.register('bestLane', () => {})

    // ---- the hypothetical: lilac, dashed, with a ghost ball; bypassed opponents dimmed
    if (m.origin && m.best) {
      const b = m.best
      const g = new THREE.Group()
      const curve = passCurve(m.origin, b.to, TOKEN_R + 1.3, 0.7)
      this.ghostCurve = passCurve(m.origin, b.to, TOKEN_R + 0.6, 0.7)
      const len = curve.getLength()
      const hm = laneMaterial(COL.hypo, 1, Math.max(6, Math.round(len / (1.5 * this.thick))))
      const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 96, 0.15 * this.thick, 10), hm)
      tube.renderOrder = 7
      const head = new THREE.Mesh(new THREE.ConeGeometry(0.55 * this.thick, 1.4 * this.thick, 16), new THREE.MeshBasicMaterial({ color: COL.hypo, transparent: true }))
      const end = curve.getPoint(1)
      const tan = curve.getTangent(1)
      head.position.copy(end)
      head.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), tan)
      head.visible = false
      const rm = new THREE.MeshBasicMaterial({ color: COL.hypo, transparent: true, depthWrite: false })
      const ring = new THREE.Mesh(dashedRing(Math.min(b.space, 14), 0.2 * this.thick, 40), rm)
      ring.position.copy(W(b.to[0], b.to[1], 0.04))
      ring.renderOrder = 3
      g.add(tube, head, ring)
      this.meshLayer('hypothetical', g, [{ m: hm, base: 1 }, { m: head.material as THREE.MeshBasicMaterial, base: 1 }, { m: rm, base: 0.85 }])
      this.growers.set('hypothetical', (p) => {
        hm.uniforms.uProgress!.value = p
        head.visible = p > 0.98
        ring.scale.setScalar(Math.max(0.001, clamp01((p - 0.5) / 0.5)))
      })
      hm.uniforms.uProgress!.value = 1
      head.visible = true
      if (m.labels.hypoChip) this.label('chip-hypo', m.labels.hypoChip, this.tokenAnchor(b.receiverId), 'hypothetical', 62, 30)
      // bypassed opponents fade on their spots: applyHierarchy sets their opacity (one owner for token paint)
      if (b.bypassedIds.some((id) => this.tokens.has(id))) this.drawn.add('bypassed')
      this.register('bypassed', () => {})
    } else {
      this.register('hypothetical', () => {})
      this.register('bypassed', () => {})
    }

    this.buildContinuation()
    this.buildIllustrative()

    // ---- evidence arrows (non-What If? moments)
    if (m.arrows.length) {
      const g = new THREE.Group()
      const mats: Array<{ m: THREE.Material & { opacity: number }; base: number }> = []
      const parts: Array<(p: number) => void> = []
      for (const a of m.arrows) {
        const color = a.tone === 'against' ? COL.against : COL.measured
        const curve = passCurve(a.from, a.to, 0.6, a.type === 'carry' ? 0.15 : 0.8)
        const am = laneMaterial(color, 1, a.type === 'carry' ? Math.max(4, Math.round(curve.getLength() / 1.2)) : 0)
        const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 64, 0.15 * this.thick, 10), am)
        tube.renderOrder = 7
        const hmat = new THREE.MeshBasicMaterial({ color, transparent: true })
        const head = new THREE.Mesh(new THREE.ConeGeometry(0.55, 1.4, 16), hmat)
        head.position.copy(curve.getPoint(1))
        head.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), curve.getTangent(1))
        g.add(tube, head)
        mats.push({ m: am, base: 1 }, { m: hmat, base: 1 })
        parts.push((p) => {
          am.uniforms.uProgress!.value = p
          head.visible = p > 0.98
        })
        parts[parts.length - 1]!(1)
      }
      this.meshLayer('evidence', g, mats)
      this.growers.set('evidence', (p) => parts.forEach((fn, i) => fn(clamp01(p * parts.length - i))))
    } else {
      this.register('evidence', () => {})
    }

    // ---- overload zone around the ball
    if (m.zone) {
      const g = new THREE.Group()
      const rm = new THREE.MeshBasicMaterial({ color: COL.measured, transparent: true, depthWrite: false })
      const fm = new THREE.MeshBasicMaterial({ color: COL.measured, transparent: true, depthWrite: false })
      const ring = new THREE.Mesh(new THREE.RingGeometry(m.zone.radius - 0.18, m.zone.radius, 128).rotateX(-Math.PI / 2), rm)
      const fill = new THREE.Mesh(new THREE.CircleGeometry(m.zone.radius, 128).rotateX(-Math.PI / 2), fm)
      g.add(fill, ring)
      g.position.copy(W(m.zone.centre[0], m.zone.centre[1], 0.03))
      ring.renderOrder = 3
      this.meshLayer('zone', g, [{ m: rm, base: 0.85 }, { m: fm, base: 0.08 }])
      if (m.zone.chip) {
        const c = m.zone.centre
        const yy = c[1] + (c[1] < PITCH_WIDTH / 2 ? m.zone.radius : -m.zone.radius)
        this.label('chip-measured', m.zone.chip, this.fixed(c[0], yy, 0.1), 'zone', 64, 6)
      }
    } else {
      this.register('zone', () => {})
    }

    // ---- team shape on this frame (window moments)
    if (m.hull && m.hull.points.length >= 3) {
      const g = new THREE.Group()
      const shape = new THREE.Shape(m.hull.points.map((p) => new THREE.Vector2(p[0] - HALF_L, -(p[1] - HALF_W))))
      const fm = new THREE.MeshBasicMaterial({ color: COL.chalk, transparent: true, depthWrite: false, side: THREE.DoubleSide })
      const fill = new THREE.Mesh(new THREE.ShapeGeometry(shape).rotateX(-Math.PI / 2), fm)
      fill.position.y = 0.025
      fill.renderOrder = 2
      const om = new THREE.MeshBasicMaterial({ color: COL.chalk, transparent: true, depthWrite: false })
      const pts = m.hull.points
      const edges = pts.map((p, i) => ribbon(p, pts[(i + 1) % pts.length]!, 0.2, 0.03))
      const outline = new THREE.Mesh(mergeGeometries(edges)!, om)
      outline.renderOrder = 3
      g.add(fill, outline)
      this.meshLayer('shape', g, [{ m: fm, base: 0.08 }, { m: om, base: 0.75 }])
      const topmost = pts.reduce((a, p) => (p[1] < a[1] ? p : a), pts[0]!)
      if (m.labels.shape) this.label('chip-chalk', m.labels.shape, this.fixed(topmost[0], topmost[1], 0.1), 'shape', 50, 22)
    } else {
      this.register('shape', () => {})
    }

    // ---- choices (What would you do?): rings are toggled by setChoices, faded with the layer
    {
      const toks = [...this.tokens.values()]
      this.register('choices', (v) => {
        for (const t of toks) {
          for (const r of [t.rings.choice, t.rings.picked]) (r.material as THREE.MeshBasicMaterial).opacity = 0.95 * v
        }
      })
      for (const t of toks) {
        t.rings.choice.visible = false
        t.rings.picked.visible = false
      }
    }
  }

  /** A dotted ring that lives in a player's marker group (so it scales with the shirt). */
  private dottedRing(pid: string, r: number, mat: THREE.MeshBasicMaterial): THREE.Mesh | null {
    const t = this.tokens.get(pid)
    if (!t) return null
    const ring = new THREE.Mesh(dashedRing(r, 0.17, Math.max(14, Math.round(r * 9))), mat)
    ring.position.y = 0.045
    ring.renderOrder = 3
    ring.visible = false
    t.group.add(ring)
    return ring
  }

  private paintGhost(g: Ghost): void {
    const v = Math.max(0, ...Object.values(g.vis))
    // while its trail is on, the ghost walks with it; otherwise it stands where the sketch left it
    const walking = (g.vis.illRun ?? 0) > 0.01 || (g.vis.illDefend ?? 0) > 0.01
    const p = walking ? g.p : 1
    const a = g.mover.from
    const b = g.mover.to
    g.group.position.copy(W(a[0] + (b[0] - a[0]) * p, a[1] + (b[1] - a[1]) * p))
    g.group.visible = v > 0.01
    g.mat.opacity = 0.95 * v
    g.ring.opacity = 0.9 * v
  }

  /**
   * Illustrative continuation (ADR 10): the alternative receiver assumed on the ball, a ghost shirt for each
   * player the sketch moves (walking from the frozen spot along a dotted trail to a chevron), the ball in as a
   * high dotted arc, and rings with tags on who could block it or get there first. Real shirts stay put.
   */
  private buildIllustrative(): void {
    const il = this.model.illustrative
    if (!il) {
      for (const k of ['illFrom', 'illRun', 'illDefend', 'illGhosts', 'illBall', 'illContest'] as const) this.register(k, () => {})
      return
    }
    const mat = () => new THREE.MeshBasicMaterial({ color: COL.cont, transparent: true, depthWrite: false })

    // ---- the receiver assumed on the ball
    {
      const rm = mat()
      const ring = this.dottedRing(il.fromId, TOKEN_R + 0.75, rm)
      const hasBall = !!this.model.ball
      this.drawn.add('illFrom')
      this.register('illFrom', (v) => {
        if (ring) ring.visible = v > 0.01
        rm.opacity = 0.95 * v
        this.assumed.setOpacity(v)
        this.ball.setOpacity(hasBall ? 1 - 0.62 * v : 0)
      })
      // the tag introduces the sketch on its first step; after that the banner carries the label
      this.label('chip-ill', this.model.labels.illTag, this.tokenAnchor(il.fromId), 'illRun', 66, 36)
    }

    // ---- ghosts: one per moved player
    for (const mv of [il.run, ...il.defenders]) {
      const p = this.model.players.find((x) => x.pid === mv.pid)
      if (!p) continue
      const group = new THREE.Group()
      const smat = new THREE.SpriteMaterial({ map: ghostShirtTexture(p.fill, p.number), transparent: true, depthWrite: false, opacity: 0 })
      const sprite = new THREE.Sprite(smat)
      sprite.center.set(0.5, 0)
      sprite.position.y = SHIRT_LIFT
      sprite.scale.set(SHIRT_W, SHIRT_H, 1)
      sprite.renderOrder = 10
      const rmat = mat()
      rmat.opacity = 0
      const ring = new THREE.Mesh(dashedRing(TOKEN_R + 0.35, 0.2 * Math.min(this.thick, 1.6), 14), rmat)
      ring.position.y = 0.045
      ring.renderOrder = 3
      group.add(ring, sprite)
      group.visible = false
      this.world.add(group)
      const g: Ghost = { mover: mv, group, mat: smat, ring: rmat, p: 0, vis: {} }
      this.ghosts.set(mv.pid, g)
      this.paintGhost(g)
    }

    // ---- trails (ground, dotted) ending in a chevron; the ghost walks along as the trail draws
    const trailLayer = (key: 'illRun' | 'illDefend', movers: StageMover[]) => {
      const g = new THREE.Group()
      const parts: Array<(u: number) => void> = []
      const mats: THREE.ShaderMaterial[] = []
      const heads: THREE.MeshBasicMaterial[] = []
      for (const mv of movers) {
        const [ax, ay] = mv.from
        const [bx, by] = mv.to
        const len = Math.hypot(bx - ax, by - ay) || 1
        const dir: Vec2 = [(bx - ax) / len, (by - ay) / len]
        const a: Vec2 = [ax + dir[0] * TOKEN_R, ay + dir[1] * TOKEN_R]
        const b: Vec2 = [bx - dir[0] * TOKEN_R * 1.6, by - dir[1] * TOKEN_R * 1.6]
        const tm = laneMaterial(COL.cont, 1, Math.max(4, Math.round(len / (1.0 * this.thick))), 0.5)
        tm.uniforms.uShade!.value = 0
        const trail = new THREE.Mesh(corridor(a, b, 0.17 * this.thick, 0.17 * this.thick, 0.05), tm)
        trail.renderOrder = 5
        const hm = mat()
        const head = new THREE.Mesh(chevronGeo(b, dir, 1.5 * Math.min(this.thick, 1.8)), hm)
        head.renderOrder = 5
        g.add(trail, head)
        mats.push(tm)
        heads.push(hm)
        const ghost = this.ghosts.get(mv.pid)
        parts.push((u) => {
          tm.uniforms.uProgress!.value = u
          head.visible = u > 0.96
          if (ghost) {
            ghost.p = u
            this.paintGhost(ghost)
          }
        })
      }
      this.world.add(g)
      this.drawn.add(key)
      this.register(key, (v) => {
        g.visible = v > 0.01
        for (const m of mats) m.uniforms.uOpacity!.value = 0.95 * v
        for (const h of heads) h.opacity = 0.95 * v
        for (const mv of movers) {
          const ghost = this.ghosts.get(mv.pid)
          if (ghost) {
            ghost.vis[key] = v
            this.paintGhost(ghost)
          }
        }
      })
      this.growers.set(key, (u) => parts.forEach((fn) => fn(u)))
      parts.forEach((fn) => fn(1))
    }
    trailLayer('illRun', [il.run])
    trailLayer('illDefend', il.defenders)

    // ---- the ghosts on their own (the ball-in step): standing where the sketch left them
    this.register('illGhosts', (v) => {
      for (const ghost of this.ghosts.values()) {
        ghost.vis.illGhosts = v
        this.paintGhost(ghost)
      }
    })

    // ---- the ball in: a high dotted arc to the end of the run (the runner's ghost marks where it is aimed)
    {
      const g = new THREE.Group()
      const curve = passCurve(il.delivery.from, il.delivery.to, TOKEN_R + 1.15, 2.4)
      const pm = laneMaterial(COL.cont, 1, Math.max(12, Math.round(curve.getLength() / (0.85 * this.thick))), 0.4)
      const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 128, 0.11 * this.thick, 8), pm)
      tube.renderOrder = 7
      g.add(tube)
      this.world.add(g)
      this.drawn.add('illBall')
      this.register('illBall', (v) => {
        g.visible = v > 0.01
        pm.uniforms.uOpacity!.value = v
      })
      this.growers.set('illBall', (u) => {
        pm.uniforms.uProgress!.value = u
      })
      pm.uniforms.uProgress!.value = 1
    }

    // ---- who could block it or get there first: a solid ring on them and a tag
    {
      const cm = mat()
      const rings: THREE.Mesh[] = []
      for (const c of il.contests) {
        const host = this.ghosts.get(c.pid)?.group ?? this.tokens.get(c.pid)?.group
        if (!host) continue
        const ring = new THREE.Mesh(new THREE.RingGeometry(TOKEN_R + 0.75, TOKEN_R + 0.75 + 0.3 * Math.min(this.thick, 1.6), 48).rotateX(-Math.PI / 2), cm)
        ring.position.y = 0.05
        ring.renderOrder = 4
        ring.visible = false
        host.add(ring)
        rings.push(ring)
        const text = c.kind === 'block' ? `Could block it · ${c.name}` : `Could get there first · ${c.name}`
        this.label('chip-ill', text, this.tokenAnchor(c.pid), 'illContest', 64, 8)
      }
      if (rings.length) this.drawn.add('illContest')
      this.register('illContest', (v) => {
        cm.opacity = 0.95 * v
        for (const r of rings) r.visible = v > 0.01
      })
    }
  }

  /**
   * Simulated continuation ("Then?"): paler lilac, dotted and thinner than the hypothetical, starting
   * from an assumed ball at the hypothetical receiver. The next pass ends in an open dotted ring (not an
   * arrowhead), the shooting window is a translucent triangle to the posts and the cross a high dotted arc.
   */
  private buildContinuation(): void {
    const c = this.model.continuation
    if (!c) {
      for (const k of ['contFrom', 'contPass', 'contShot', 'contCross'] as const) this.register(k, () => {})
      return
    }
    const cm = () => new THREE.MeshBasicMaterial({ color: COL.cont, transparent: true, depthWrite: false })

    // ---- the receiver assumed on the ball
    {
      const rm = cm()
      const ring = this.dottedRing(c.fromId, TOKEN_R + 0.75, rm)
      const hasBall = !!this.model.ball
      this.drawn.add('contFrom')
      this.register('contFrom', (v) => {
        if (ring) ring.visible = v > 0.01
        rm.opacity = 0.95 * v
        this.assumed.setOpacity(v)
        // the real ball stays where it was, quietened: this picture assumes it elsewhere
        this.ball.setOpacity(hasBall ? 1 - 0.62 * v : 0)
      })
      this.label('chip-cont', this.model.labels.contTag, this.tokenAnchor(c.fromId), 'contFrom', 66, 36)
    }

    // ---- next pass(es): thin dotted tubes, open rings at the end
    if (c.passes.length) {
      const g = new THREE.Group()
      const mats: Array<{ m: THREE.Material & { opacity: number }; base: number }> = []
      const parts: Array<(p: number) => void> = []
      const ends: THREE.Mesh[] = []
      const em = cm()
      for (const p of c.passes) {
        const curve = passCurve(c.from, p.to, TOKEN_R + 1.15, 0.6)
        const pm = laneMaterial(COL.cont, 1, Math.max(10, Math.round(curve.getLength() / (0.8 * this.thick))), 0.34)
        const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 128, 0.085 * this.thick, 8), pm)
        tube.renderOrder = 7
        g.add(tube)
        mats.push({ m: pm, base: 1 })
        const end = this.dottedRing(p.receiverId, TOKEN_R + 0.55, em)
        if (end) ends.push(end)
        parts.push((u) => {
          pm.uniforms.uProgress!.value = u
          if (end) end.scale.setScalar(Math.max(0.001, clamp01((u - 0.85) / 0.15)))
        })
        parts[parts.length - 1]!(1)
        this.label('chip-cont', p.chip, this.tokenAnchor(p.receiverId), 'contPass', 61, 36)
      }
      mats.push({ m: em, base: 0.95 })
      this.world.add(g)
      this.drawn.add('contPass')
      this.register('contPass', (v) => {
        g.visible = v > 0.01
        for (const { m, base } of mats) {
          if (m instanceof THREE.ShaderMaterial) m.uniforms.uOpacity!.value = base * v
          else m.opacity = base * v
        }
        for (const e of ends) e.visible = v > 0.01
      })
      this.growers.set('contPass', (u) => parts.forEach((fn, i) => fn(clamp01(u * parts.length - i))))
    } else {
      this.register('contPass', () => {})
    }

    // ---- shooting window: a translucent triangle from the ball to the posts, dotted sides, solid mouth
    if (c.shot) {
      const s = c.shot
      const g = new THREE.Group()
      const tri = [c.from, s.posts[0], s.posts[1]]
      const shape = new THREE.Shape(tri.map((p) => new THREE.Vector2(p[0] - HALF_L, -(p[1] - HALF_W))))
      const fm = new THREE.MeshBasicMaterial({ color: COL.cont, transparent: true, depthWrite: false, side: THREE.DoubleSide })
      const fill = new THREE.Mesh(new THREE.ShapeGeometry(shape).rotateX(-Math.PI / 2), fm)
      fill.position.y = 0.03
      fill.renderOrder = 2
      const sm = cm()
      const sides = new THREE.Mesh(mergeGeometries([
        dashedRibbon(c.from, s.posts[0], 0.16, 0.32, 0.5, 0.045),
        dashedRibbon(c.from, s.posts[1], 0.16, 0.32, 0.5, 0.045),
      ])!, sm)
      sides.renderOrder = 3
      const mm = cm()
      const mouth = new THREE.Mesh(ribbon(s.posts[0], s.posts[1], 0.3, 0.05), mm)
      mouth.renderOrder = 3
      g.add(fill, sides, mouth)
      this.meshLayer('contShot', g, [{ m: fm, base: 0.17 }, { m: sm, base: 0.95 }, { m: mm, base: 0.95 }])
      const mid: Vec2 = [(c.from[0] + s.centre[0]) / 2, (c.from[1] + s.centre[1]) / 2]
      this.label('chip-cont', s.chip, this.fixed(mid[0], mid[1], 0.1), 'contShot', 63, 6)
    } else {
      this.register('contShot', () => {})
    }

    // ---- cross: a high dotted arc into the box, the target ringed
    if (c.cross && c.cross.targets.length) {
      const t = c.cross.targets[0]!
      const g = new THREE.Group()
      // a cross bends: the control point is lifted and pushed towards the goal being attacked
      const base = passCurve(c.from, t.at, TOKEN_R + 1.15, 2.6)
      const goalX = this.model.direction === '+x' ? PITCH_LENGTH : 0
      const len = Math.hypot(t.at[0] - c.from[0], t.at[1] - c.from[1])
      const ctrl = base.v1.clone()
      ctrl.x += Math.sign(goalX - (c.from[0] + t.at[0]) / 2) * len * 0.22
      const curve = new THREE.QuadraticBezierCurve3(base.v0, ctrl, base.v2)
      const pm = laneMaterial(COL.cont, 1, Math.max(12, Math.round(curve.getLength() / 0.8)), 0.34)
      const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 128, 0.085, 8), pm)
      tube.renderOrder = 7
      g.add(tube)
      const em = cm()
      const rings = c.cross.targets.map((x) => this.dottedRing(x.pid, TOKEN_R + 0.55, em)).filter((r): r is THREE.Mesh => !!r)
      this.world.add(g)
      this.drawn.add('contCross')
      this.register('contCross', (v) => {
        g.visible = v > 0.01
        pm.uniforms.uOpacity!.value = v
        em.opacity = 0.95 * v
        for (const r of rings) r.visible = v > 0.01
      })
      this.growers.set('contCross', (u) => {
        pm.uniforms.uProgress!.value = u
        for (const r of rings) r.scale.setScalar(Math.max(0.001, clamp01((u - 0.85) / 0.15)))
      })
      pm.uniforms.uProgress!.value = 1
      const apex = curve.getPoint(0.5)
      this.label('chip-cont', c.cross.chip, () => apex, 'contCross', 63, 8)
    } else {
      this.register('contCross', () => {})
    }
  }
}

/** A flat chevron on the grass at `at`, pointing along `dir` (world xz), for the end of a sketched move. */
function chevronGeo(at: Vec2, dir: Vec2, size: number): THREE.BufferGeometry {
  const s = new THREE.Shape()
  s.moveTo(size * 0.55, 0)
  s.lineTo(-size * 0.45, size * 0.5)
  s.lineTo(-size * 0.2, 0)
  s.lineTo(-size * 0.45, -size * 0.5)
  s.closePath()
  const g = new THREE.ShapeGeometry(s).rotateX(-Math.PI / 2)
  g.rotateY(-Math.atan2(dir[1], dir[0]))
  g.translate(at[0] - HALF_L, 0.05, at[1] - HALF_W)
  return g
}

type PerspectiveLike = THREE.PerspectiveCamera
