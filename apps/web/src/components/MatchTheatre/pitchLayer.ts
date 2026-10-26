import { HEIGHT_FACTOR, MARGIN_M, PITCH_L, PITCH_W, project } from './projection'
import type { Bounds } from './projection'

/**
 * Pre-renders the static broadcast pitch (grass stripes, texture, lighting,
 * markings, goals) into an offscreen canvas in plane space. Rebuilt only on
 * resize; each frame just blits it with the camera transform.
 */

const STRIPES = 12
const GRASS_LIGHT = '#1d6d4e'
const GRASS_DARK = '#175f43'
const RUNOFF = '#145439'
const LINE = 'rgba(246, 248, 240, 0.86)'
const LINE_W_M = 0.13

/** Deterministic PRNG so the grass texture is identical on every load. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.round(w))
  c.height = Math.max(1, Math.round(h))
  return c
}

function noiseTile(size: number): HTMLCanvasElement {
  const c = makeCanvas(size, size)
  const ctx = c.getContext('2d')
  if (!ctx) return c
  const img = ctx.createImageData(size, size)
  const rnd = mulberry32(2026)
  for (let i = 0; i < size * size; i += 1) {
    const n = rnd()
    const v = n > 0.5 ? 255 : 0
    img.data[i * 4] = v
    img.data[i * 4 + 1] = v
    img.data[i * 4 + 2] = v
    img.data[i * 4 + 3] = Math.round(Math.abs(n - 0.5) * 2 * 34)
  }
  ctx.putImageData(img, 0, 0)
  return c
}

export interface PitchLayer {
  canvas: HTMLCanvasElement
  /** Pixels per plane unit inside the layer canvas. */
  ppu: number
  bounds: Bounds
}

/** Map world (x, y, z) to layer pixels. */
function makeMapper(bounds: Bounds, ppu: number) {
  return (x: number, y: number, z = 0) => {
    const p = project(x, y)
    return { x: (p.u - bounds.minU) * ppu, y: (p.v - bounds.minV - z * p.s * HEIGHT_FACTOR) * ppu, s: p.s }
  }
}

export function buildPitchLayer(bounds: Bounds, ppu: number): PitchLayer {
  const w = (bounds.maxU - bounds.minU) * ppu
  const h = (bounds.maxV - bounds.minV) * ppu
  const canvas = makeCanvas(w, h)
  const ctx = canvas.getContext('2d')
  if (!ctx) return { canvas, ppu, bounds }
  const P = makeMapper(bounds, ppu)

  const poly = (pts: Array<[number, number]>) => {
    ctx.beginPath()
    pts.forEach(([x, y], i) => {
      const p = P(x, y)
      if (i === 0) ctx.moveTo(p.x, p.y)
      else ctx.lineTo(p.x, p.y)
    })
    ctx.closePath()
  }

  const m = MARGIN_M
  // ---- run-off surround
  poly([
    [-m, -m],
    [PITCH_L + m, -m],
    [PITCH_L + m, PITCH_W + m],
    [-m, PITCH_W + m],
  ])
  ctx.fillStyle = RUNOFF
  ctx.fill()

  // ---- mown stripes (extend slightly into the run-off, like a real cut)
  const band = PITCH_L / STRIPES
  for (let i = -1; i <= STRIPES; i += 1) {
    const x0 = Math.max(-m + 1, i * band)
    const x1 = Math.min(PITCH_L + m - 1, (i + 1) * band)
    if (x1 <= x0) continue
    poly([
      [x0, -m + 1],
      [x1, -m + 1],
      [x1, PITCH_W + m - 1],
      [x0, PITCH_W + m - 1],
    ])
    ctx.fillStyle = (i + STRIPES) % 2 === 0 ? GRASS_LIGHT : GRASS_DARK
    ctx.fill()
  }

  // ---- fine procedural texture
  const tile = noiseTile(128)
  const pattern = ctx.createPattern(tile, 'repeat')
  if (pattern) {
    ctx.save()
    poly([
      [-m, -m],
      [PITCH_L + m, -m],
      [PITCH_L + m, PITCH_W + m],
      [-m, PITCH_W + m],
    ])
    ctx.clip()
    ctx.globalAlpha = 0.5
    ctx.globalCompositeOperation = 'soft-light'
    ctx.fillStyle = pattern
    ctx.fillRect(0, 0, w, h)
    ctx.restore()
  }

  // ---- floodlight falloff: brighter centre, darker corners and far side
  ctx.save()
  poly([
    [-m, -m],
    [PITCH_L + m, -m],
    [PITCH_L + m, PITCH_W + m],
    [-m, PITCH_W + m],
  ])
  ctx.clip()
  const centre = P(PITCH_L / 2, PITCH_W * 0.55)
  const light = ctx.createRadialGradient(centre.x, centre.y, 0, centre.x, centre.y, w * 0.62)
  light.addColorStop(0, 'rgba(255, 252, 230, 0.10)')
  light.addColorStop(0.55, 'rgba(255, 252, 230, 0.02)')
  light.addColorStop(1, 'rgba(0, 8, 6, 0.30)')
  ctx.fillStyle = light
  ctx.fillRect(0, 0, w, h)
  const far = ctx.createLinearGradient(0, P(0, -m).y, 0, P(0, PITCH_W * 0.45).y)
  far.addColorStop(0, 'rgba(2, 10, 12, 0.32)')
  far.addColorStop(1, 'rgba(2, 10, 12, 0)')
  ctx.fillStyle = far
  ctx.fillRect(0, 0, w, h)
  ctx.restore()

  // ---- markings
  ctx.strokeStyle = LINE
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  const lw = (y: number) => Math.max(1, LINE_W_M * ppu * P(0, y).s)

  const line = (pts: Array<[number, number]>, closed = false) => {
    // Width varies with depth: draw segment by segment.
    for (let i = 0; i < pts.length - (closed ? 0 : 1); i += 1) {
      const a = pts[i]!
      const b = pts[(i + 1) % pts.length]!
      const pa = P(a[0], a[1])
      const pb = P(b[0], b[1])
      ctx.lineWidth = lw((a[1] + b[1]) / 2)
      ctx.beginPath()
      ctx.moveTo(pa.x, pa.y)
      ctx.lineTo(pb.x, pb.y)
      ctx.stroke()
    }
  }
  const arc = (cx: number, cy: number, r: number, a0: number, a1: number, steps = 48) => {
    const pts: Array<[number, number]> = []
    for (let i = 0; i <= steps; i += 1) {
      const a = a0 + ((a1 - a0) * i) / steps
      pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)])
    }
    line(pts)
  }
  const spot = (x: number, y: number, r = 0.22) => {
    const p = P(x, y)
    ctx.fillStyle = LINE
    ctx.beginPath()
    ctx.ellipse(p.x, p.y, Math.max(1.2, r * ppu * p.s), Math.max(1, r * ppu * p.s * 0.75), 0, 0, Math.PI * 2)
    ctx.fill()
  }

  line(
    [
      [0, 0],
      [PITCH_L, 0],
      [PITCH_L, PITCH_W],
      [0, PITCH_W],
    ],
    true,
  )
  line([
    [PITCH_L / 2, 0],
    [PITCH_L / 2, PITCH_W],
  ])
  arc(PITCH_L / 2, PITCH_W / 2, 9.15, 0, Math.PI * 2, 96)
  spot(PITCH_L / 2, PITCH_W / 2, 0.3)

  const paW = 40.32
  const gaW = 18.32
  const top = (PITCH_W - paW) / 2
  const gTop = (PITCH_W - gaW) / 2
  const arcAngle = Math.acos((16.5 - 11) / 9.15)
  for (const side of [0, 1] as const) {
    const gx = side === 0 ? 0 : PITCH_L
    const dir = side === 0 ? 1 : -1
    line([
      [gx, top],
      [gx + dir * 16.5, top],
      [gx + dir * 16.5, top + paW],
      [gx, top + paW],
    ])
    line([
      [gx, gTop],
      [gx + dir * 5.5, gTop],
      [gx + dir * 5.5, gTop + gaW],
      [gx, gTop + gaW],
    ])
    spot(gx + dir * 11, PITCH_W / 2)
    const base = side === 0 ? 0 : Math.PI
    arc(gx + dir * 11, PITCH_W / 2, 9.15, base - arcAngle, base + arcAngle, 32)
  }
  // corner arcs (1 m)
  arc(0, 0, 1, 0, Math.PI / 2, 10)
  arc(PITCH_L, 0, 1, Math.PI / 2, Math.PI, 10)
  arc(0, PITCH_W, 1, -Math.PI / 2, 0, 10)
  arc(PITCH_L, PITCH_W, 1, Math.PI, 1.5 * Math.PI, 10)

  // ---- goals with depth (7.32 m x 2.44 m, net 2 m deep)
  for (const side of [0, 1] as const) drawGoal(ctx, P, side, ppu)

  return { canvas, ppu, bounds }
}

type Mapper = ReturnType<typeof makeMapper>

function drawGoal(ctx: CanvasRenderingContext2D, P: Mapper, side: 0 | 1, ppu: number) {
  const gx = side === 0 ? 0 : PITCH_L
  const back = side === 0 ? -2 : PITCH_L + 2
  const y0 = PITCH_W / 2 - 3.66
  const y1 = PITCH_W / 2 + 3.66
  const hgt = 2.44
  const backH = 1.6

  // net body (translucent)
  ctx.save()
  ctx.fillStyle = 'rgba(235, 240, 236, 0.09)'
  const faces: Array<Array<[number, number, number]>> = [
    // back
    [
      [back, y0, 0],
      [back, y1, 0],
      [back, y1, backH],
      [back, y0, backH],
    ],
    // roof
    [
      [gx, y0, hgt],
      [gx, y1, hgt],
      [back, y1, backH],
      [back, y0, backH],
    ],
    // far side
    [
      [gx, y0, 0],
      [back, y0, 0],
      [back, y0, backH],
      [gx, y0, hgt],
    ],
  ]
  for (const f of faces) {
    ctx.beginPath()
    f.forEach(([x, y, z], i) => {
      const p = P(x, y, z)
      if (i === 0) ctx.moveTo(p.x, p.y)
      else ctx.lineTo(p.x, p.y)
    })
    ctx.closePath()
    ctx.fill()
  }
  // net mesh
  ctx.strokeStyle = 'rgba(235, 240, 236, 0.16)'
  ctx.lineWidth = 0.6
  for (let i = 1; i < 8; i += 1) {
    const y = y0 + ((y1 - y0) * i) / 8
    const a = P(gx, y, hgt)
    const b = P(back, y, backH)
    const c = P(back, y, 0)
    ctx.beginPath()
    ctx.moveTo(a.x, a.y)
    ctx.lineTo(b.x, b.y)
    ctx.lineTo(c.x, c.y)
    ctx.stroke()
  }
  for (let j = 1; j < 4; j += 1) {
    const z = (backH * j) / 4
    const a = P(back, y0, z)
    const b = P(back, y1, z)
    ctx.beginPath()
    ctx.moveTo(a.x, a.y)
    ctx.lineTo(b.x, b.y)
    ctx.stroke()
  }
  ctx.restore()

  // frame: posts and crossbar
  const post = (y: number) => {
    const a = P(gx, y, 0)
    const b = P(gx, y, hgt)
    ctx.beginPath()
    ctx.moveTo(a.x, a.y)
    ctx.lineTo(b.x, b.y)
    ctx.stroke()
  }
  ctx.save()
  ctx.strokeStyle = 'rgba(250, 250, 246, 0.95)'
  ctx.lineCap = 'round'
  ctx.lineWidth = Math.max(1.4, 0.16 * ppu * P(0, PITCH_W / 2).s)
  ctx.shadowColor = 'rgba(0,0,0,0.45)'
  ctx.shadowBlur = 3
  ctx.shadowOffsetY = 1
  post(y0)
  post(y1)
  const c0 = P(gx, y0, hgt)
  const c1 = P(gx, y1, hgt)
  ctx.beginPath()
  ctx.moveTo(c0.x, c0.y)
  ctx.lineTo(c1.x, c1.y)
  ctx.stroke()
  ctx.restore()
}
