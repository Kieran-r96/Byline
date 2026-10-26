import * as THREE from 'three'

/** Canvas-generated textures for the stage. Everything is procedural: no image assets. */

export const RUNOFF_M = 7
export const AREA_L = 105 + RUNOFF_M * 2
export const AREA_W = 68 + RUNOFF_M * 2

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d')
  if (!ctx) throw new Error('2D canvas unavailable')
  return [c, ctx]
}

/** Seeded PRNG so the grass looks identical on every load (and in every screenshot). */
function rng(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Night grass: mowing stripes across the length, fine noise, soft mottling and floodlight pools,
 * covering the pitch plus run-off. Lines are geometry, not painted here, so they stay crisp.
 */
export function grassTexture(maxAnisotropy: number): THREE.CanvasTexture {
  const W = 2048
  const H = Math.round((W * AREA_W) / AREA_L)
  const [c, ctx] = canvas(W, H)
  const pxm = W / AREA_L
  const rand = rng(2026)

  // stripes: 20 bands over the 105 m, continuing into the run-off
  const band = 105 / 20
  for (let i = -2; i < 22; i += 1) {
    const x0 = (RUNOFF_M + i * band) * pxm
    ctx.fillStyle = i % 2 === 0 ? '#2c6343' : '#24573a'
    ctx.fillRect(Math.floor(x0), 0, Math.ceil(band * pxm) + 1, H)
  }
  // soft mottling (wear and growth), low contrast
  for (let i = 0; i < 900; i += 1) {
    const x = rand() * W
    const y = rand() * H
    const r = 6 + rand() * 40
    const g = ctx.createRadialGradient(x, y, 0, x, y, r)
    const light = rand() > 0.5
    g.addColorStop(0, light ? 'rgba(120, 170, 110, 0.05)' : 'rgba(5, 20, 10, 0.07)')
    g.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = g
    ctx.fillRect(x - r, y - r, r * 2, r * 2)
  }
  // fine per-pixel noise
  const img = ctx.getImageData(0, 0, W, H)
  const d = img.data
  for (let i = 0; i < d.length; i += 4) {
    const n = (rand() - 0.5) * 14
    d[i] = Math.max(0, Math.min(255, d[i]! + n * 0.6))
    d[i + 1] = Math.max(0, Math.min(255, d[i + 1]! + n))
    d[i + 2] = Math.max(0, Math.min(255, d[i + 2]! + n * 0.5))
  }
  ctx.putImageData(img, 0, 0)
  // floodlight pools from the four corners plus a gentle centre lift
  const pool = (x: number, y: number, r: number, a: number) => {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r)
    g.addColorStop(0, `rgba(255, 246, 220, ${a})`)
    g.addColorStop(1, 'rgba(255, 246, 220, 0)')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, W, H)
  }
  ctx.globalCompositeOperation = 'lighter'
  pool(W * 0.18, H * 0.2, W * 0.42, 0.05)
  pool(W * 0.82, H * 0.2, W * 0.42, 0.05)
  pool(W * 0.18, H * 0.85, W * 0.42, 0.045)
  pool(W * 0.82, H * 0.85, W * 0.42, 0.045)
  pool(W * 0.5, H * 0.5, W * 0.5, 0.035)
  ctx.globalCompositeOperation = 'source-over'
  // edge falloff into the night
  const v = ctx.createRadialGradient(W / 2, H / 2, H * 0.45, W / 2, H / 2, W * 0.62)
  v.addColorStop(0, 'rgba(6, 14, 12, 0)')
  v.addColorStop(1, 'rgba(6, 14, 12, 0.55)')
  ctx.fillStyle = v
  ctx.fillRect(0, 0, W, H)

  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = maxAnisotropy
  t.generateMipmaps = true
  t.minFilter = THREE.LinearMipmapLinearFilter
  return t
}

/** Radial falloff (contact shadows, halos). */
export function radialTexture(inner: string, outer: string, size = 128, stops: Array<[number, string]> = []): THREE.CanvasTexture {
  const [c, ctx] = canvas(size, size)
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  g.addColorStop(0, inner)
  for (const [o, col] of stops) g.addColorStop(o, col)
  g.addColorStop(1, outer)
  ctx.fillStyle = g
  ctx.fillRect(0, 0, size, size)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

/** Vertical fade for the defensive-line curtains: solid at the grass, gone at the top. */
export function curtainTexture(): THREE.CanvasTexture {
  const [c, ctx] = canvas(4, 128)
  const g = ctx.createLinearGradient(0, 0, 0, 128)
  g.addColorStop(0, 'rgba(255,255,255,0)')
  g.addColorStop(0.55, 'rgba(255,255,255,0.35)')
  g.addColorStop(1, 'rgba(255,255,255,1)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 4, 128)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

/**
 * Fine grass detail (blades and soil specks), tiled every couple of metres over the pitch so close
 * shots have texture; the grass shader fades it out with distance to avoid shimmer.
 */
export function grassDetailTexture(maxAnisotropy: number): THREE.CanvasTexture {
  const S = 256
  const [c, ctx] = canvas(S, S)
  const rand = rng(68)
  ctx.fillStyle = 'rgb(128,128,128)'
  ctx.fillRect(0, 0, S, S)
  // short blades: thin strokes leaning mostly one way, light and dark
  for (let i = 0; i < 2600; i += 1) {
    const x = rand() * S
    const y = rand() * S
    const len = 3 + rand() * 7
    const a = -Math.PI / 2 + (rand() - 0.5) * 0.9
    const v = rand() > 0.5 ? 150 + rand() * 60 : 70 + rand() * 40
    ctx.strokeStyle = `rgba(${v},${v},${v},0.55)`
    ctx.lineWidth = 0.6 + rand() * 0.8
    ctx.beginPath()
    for (const dx of [0, S, -S]) {
      for (const dy of [0, S, -S]) {
        ctx.moveTo(x + dx, y + dy)
        ctx.lineTo(x + dx + Math.cos(a) * len, y + dy + Math.sin(a) * len)
      }
    }
    ctx.stroke()
  }
  const t = new THREE.CanvasTexture(c)
  t.wrapS = THREE.RepeatWrapping
  t.wrapT = THREE.RepeatWrapping
  t.colorSpace = THREE.NoColorSpace
  t.anisotropy = maxAnisotropy
  t.generateMipmaps = true
  t.minFilter = THREE.LinearMipmapLinearFilter
  return t
}

export const NUMBER_FONT = '"Archivo Variable", "Archivo", "Arial Narrow", system-ui, sans-serif'

/** Shirt texture aspect (width / height) and where the shirt's own outline sits inside it. */
export const SHIRT_ASPECT = 0.92

/**
 * A player's shirt, front view: kit colour with trim on the collar and cuffs, soft fabric shading,
 * a dark keyline for contrast on grass and a large condensed number. Drawn upright on a billboard,
 * so the number reads at every camera angle.
 */
export function shirtTexture(fill: string, trim: string, ink: string, n: number): THREE.CanvasTexture {
  const H = 256
  const Wd = Math.round(H * SHIRT_ASPECT)
  const [c, ctx] = canvas(Wd, H)
  const cx = Wd / 2
  // silhouette (fractions of the canvas): collar, shoulders, short sleeves, body
  const P = (x: number, y: number): [number, number] => [cx + x * Wd, y * H]
  const outline: Array<[number, number]> = [
    P(-0.12, 0.05), P(-0.3, 0.1), P(-0.47, 0.3), P(-0.36, 0.43), P(-0.29, 0.37),
    P(-0.29, 0.95), P(0.29, 0.95), P(0.29, 0.37), P(0.36, 0.43), P(0.47, 0.3), P(0.3, 0.1), P(0.12, 0.05),
  ]
  const path = () => {
    ctx.beginPath()
    outline.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)))
    // collar dip
    ctx.quadraticCurveTo(cx, H * 0.16, outline[0]![0], outline[0]![1])
    ctx.closePath()
  }
  ctx.lineJoin = 'round'
  // keyline: dark, then the kit colour on top
  path()
  ctx.lineWidth = 14
  ctx.strokeStyle = 'rgba(6, 10, 12, 0.82)'
  ctx.stroke()
  ctx.fillStyle = fill
  ctx.fill()
  ctx.save()
  path()
  ctx.clip()
  // fabric light: lit from the upper left, darker at the hem and sleeves
  const g = ctx.createLinearGradient(0, 0, Wd, H)
  g.addColorStop(0, 'rgba(255,255,255,0.22)')
  g.addColorStop(0.45, 'rgba(255,255,255,0.03)')
  g.addColorStop(1, 'rgba(0,0,0,0.3)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, Wd, H)
  // trim: collar band and sleeve cuffs
  ctx.strokeStyle = trim
  ctx.lineWidth = 9
  ctx.beginPath()
  ctx.moveTo(...P(-0.13, 0.04))
  ctx.quadraticCurveTo(cx, H * 0.175, ...P(0.13, 0.04))
  ctx.stroke()
  ctx.lineWidth = 10
  ctx.beginPath()
  ctx.moveTo(...P(-0.475, 0.295))
  ctx.lineTo(...P(-0.36, 0.43))
  ctx.moveTo(...P(0.475, 0.295))
  ctx.lineTo(...P(0.36, 0.43))
  ctx.stroke()
  ctx.restore()
  // the number: large, condensed, with a dark keyline so it reads on any kit
  const style = ctx as CanvasRenderingContext2D & { fontStretch?: string }
  if ('fontStretch' in style) style.fontStretch = 'condensed'
  ctx.font = `800 ${n >= 10 ? 122 : 138}px ${NUMBER_FONT}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.lineWidth = 10
  ctx.strokeStyle = 'rgba(6, 10, 12, 0.55)'
  ctx.strokeText(String(n), cx, H * 0.6)
  ctx.fillStyle = ink
  ctx.fillText(String(n), cx, H * 0.6)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 4
  t.generateMipmaps = true
  t.minFilter = THREE.LinearMipmapLinearFilter
  return t
}

/**
 * An illustrative "ghost" shirt: the same silhouette, a thin wash of the kit colour (identity) inside a dashed
 * pale-lilac outline, and the number in pale lilac. Reads at once as "a sketched position, not a real one".
 */
export function ghostShirtTexture(fill: string, n: number, line = '#DCD3FF'): THREE.CanvasTexture {
  const H = 256
  const Wd = Math.round(H * SHIRT_ASPECT)
  const [c, ctx] = canvas(Wd, H)
  const cx = Wd / 2
  const P = (x: number, y: number): [number, number] => [cx + x * Wd, y * H]
  const outline: Array<[number, number]> = [
    P(-0.12, 0.06), P(-0.3, 0.11), P(-0.46, 0.3), P(-0.36, 0.42), P(-0.29, 0.37),
    P(-0.29, 0.94), P(0.29, 0.94), P(0.29, 0.37), P(0.36, 0.42), P(0.46, 0.3), P(0.3, 0.11), P(0.12, 0.06),
  ]
  ctx.beginPath()
  outline.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)))
  ctx.quadraticCurveTo(cx, H * 0.17, outline[0]![0], outline[0]![1])
  ctx.closePath()
  ctx.globalAlpha = 0.42
  ctx.fillStyle = fill
  ctx.fill()
  ctx.globalAlpha = 0.55
  ctx.fillStyle = '#0B1214'
  ctx.fill()
  ctx.globalAlpha = 1
  ctx.lineJoin = 'round'
  ctx.lineWidth = 13
  ctx.setLineDash([22, 14])
  ctx.strokeStyle = line
  ctx.stroke()
  ctx.setLineDash([])
  const style = ctx as CanvasRenderingContext2D & { fontStretch?: string }
  if ('fontStretch' in style) style.fontStretch = 'condensed'
  ctx.font = `800 ${n >= 10 ? 118 : 132}px ${NUMBER_FONT}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = line
  ctx.fillText(String(n), cx, H * 0.6)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 4
  t.generateMipmaps = true
  t.minFilter = THREE.LinearMipmapLinearFilter
  return t
}

/** Top face of a player disc: kit colour, subtle dome shading and the shirt number. */
export function discTexture(fill: string, ink: string, n: number): THREE.CanvasTexture {
  const S = 192
  const [c, ctx] = canvas(S, S)
  ctx.fillStyle = fill
  ctx.beginPath()
  ctx.arc(S / 2, S / 2, S / 2, 0, Math.PI * 2)
  ctx.fill()
  const g = ctx.createRadialGradient(S * 0.38, S * 0.32, S * 0.05, S / 2, S / 2, S / 2)
  g.addColorStop(0, 'rgba(255,255,255,0.22)')
  g.addColorStop(0.6, 'rgba(255,255,255,0)')
  g.addColorStop(1, 'rgba(0,0,0,0.28)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, S, S)
  const style = ctx as CanvasRenderingContext2D & { fontStretch?: string; letterSpacing?: string }
  if ('fontStretch' in style) style.fontStretch = 'condensed'
  ctx.font = `800 ${n >= 10 ? 104 : 116}px ${NUMBER_FONT}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.lineWidth = 7
  ctx.strokeStyle = 'rgba(0,0,0,0.28)'
  ctx.strokeText(String(n), S / 2, S / 2 + 6)
  ctx.fillStyle = ink
  ctx.fillText(String(n), S / 2, S / 2 + 6)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 4
  return t
}
