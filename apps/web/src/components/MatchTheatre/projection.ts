/**
 * Broadcast projection for the synthetic pitch.
 *
 * World: metres, x 0..105 left->right, y 0..68 far->near touchline.
 * Plane: an elevated-camera image of the ground. A projective map (shared
 * denominator) makes the far touchline ~17% narrower and compresses depth,
 * so straight lines stay straight. Camera pan/zoom happens in plane space.
 */

export const PITCH_L = 105
export const PITCH_W = 68
/** Far-touchline width factor = 1 / (1 + K)  (K = 0.2 -> 0.83, ~17% foreshortening). */
export const PERSPECTIVE_K = 0.2
/** Depth compression of the ground plane at the near touchline. */
export const DEPTH = 0.8
/** Vertical size of a raised object (ball height) relative to ground scale. */
export const HEIGHT_FACTOR = 0.82
/** Run-off grass shown around the lines, metres. */
export const MARGIN_M = 4.5

const H = (PITCH_W * DEPTH) / (1 + PERSPECTIVE_K)

export interface PlanePoint {
  u: number
  v: number
  /** Local horizontal scale at this depth (1 at the near touchline). */
  s: number
}

export function project(x: number, y: number, out?: PlanePoint): PlanePoint {
  const t = y / PITCH_W
  const d = 1 + PERSPECTIVE_K * (1 - t)
  const p = out ?? { u: 0, v: 0, s: 1 }
  p.u = (x - PITCH_L / 2) / d
  p.v = (H * t) / d
  p.s = 1 / d
  return p
}

export interface Bounds {
  minU: number
  maxU: number
  minV: number
  maxV: number
}

export function planeBounds(margin = MARGIN_M): Bounds {
  const corners = [
    project(-margin, -margin),
    project(PITCH_L + margin, -margin),
    project(-margin, PITCH_W + margin),
    project(PITCH_L + margin, PITCH_W + margin),
  ]
  return {
    minU: Math.min(...corners.map((c) => c.u)),
    maxU: Math.max(...corners.map((c) => c.u)),
    // Leave headroom above the far touchline for goal frames / hoardings.
    minV: Math.min(...corners.map((c) => c.v)) - 3,
    maxV: Math.max(...corners.map((c) => c.v)),
  }
}

// ---------------------------------------------------------------- camera

export interface Camera {
  /** Plane-space centre. */
  u: number
  v: number
  zoom: number
  vu: number
  vv: number
  vz: number
}

export interface Viewport {
  width: number
  height: number
  /** px per plane unit at zoom 1 (fits the whole pitch). */
  fit: number
}

export function fitScale(width: number, height: number, b: Bounds): number {
  return Math.min(width / (b.maxU - b.minU), height / (b.maxV - b.minV))
}

/**
 * Clamp the camera centre so the visible window stays inside the pitch
 * bounds. When the window is larger than the bounds on an axis, centre it.
 */
export function clampCamera(u: number, v: number, zoom: number, vp: Viewport, b: Bounds): { u: number; v: number } {
  const halfW = vp.width / (2 * vp.fit * zoom)
  const halfH = vp.height / (2 * vp.fit * zoom)
  const cu = (b.minU + b.maxU) / 2
  const cv = (b.minV + b.maxV) / 2
  const outU = b.maxU - b.minU <= 2 * halfW ? cu : Math.min(b.maxU - halfW, Math.max(b.minU + halfW, u))
  const outV = b.maxV - b.minV <= 2 * halfH ? cv : Math.min(b.maxV - halfH, Math.max(b.minV + halfH, v))
  return { u: outU, v: outV }
}

/** Critically damped spring (Game Programming Gems 4, "SmoothDamp"). */
export function smoothDamp(
  current: number,
  target: number,
  velocity: number,
  smoothTime: number,
  dt: number,
): { value: number; velocity: number } {
  const st = Math.max(0.0001, smoothTime)
  const omega = 2 / st
  const x = omega * dt
  const exp = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x)
  const change = current - target
  const temp = (velocity + omega * change) * dt
  const nextVelocity = (velocity - omega * temp) * exp
  const value = target + (change + temp) * exp
  return { value, velocity: nextVelocity }
}

export type CameraMode = 'broadcast' | 'full'
export const BROADCAST_ZOOM = 1.35

export interface CameraTarget {
  u: number
  v: number
  zoom: number
}

export function cameraTarget(
  mode: CameraMode,
  ball: { x: number; y: number } | null,
  b: Bounds,
): CameraTarget {
  const cu = (b.minU + b.maxU) / 2
  const cv = (b.minV + b.maxV) / 2
  if (mode === 'full' || !ball) return { u: cu, v: cv, zoom: mode === 'full' ? 1 : BROADCAST_ZOOM }
  const p = project(ball.x, ball.y)
  // Broadcast cameras pan with play but only drift vertically.
  return { u: p.u, v: cv + (p.v - cv) * 0.55, zoom: BROADCAST_ZOOM }
}

export function stepCamera(cam: Camera, target: CameraTarget, dt: number, vp: Viewport, b: Bounds, snap: boolean): void {
  if (snap) {
    const c = clampCamera(target.u, target.v, target.zoom, vp, b)
    cam.u = c.u
    cam.v = c.v
    cam.zoom = target.zoom
    cam.vu = cam.vv = cam.vz = 0
    return
  }
  const z = smoothDamp(cam.zoom, target.zoom, cam.vz, 0.9, dt)
  cam.zoom = z.value
  cam.vz = z.velocity
  const c = clampCamera(target.u, target.v, cam.zoom, vp, b)
  const u = smoothDamp(cam.u, c.u, cam.vu, 0.85, dt)
  const v = smoothDamp(cam.v, c.v, cam.vv, 1.1, dt)
  cam.u = u.value
  cam.vu = u.velocity
  cam.v = v.value
  cam.vv = v.velocity
  const clamped = clampCamera(cam.u, cam.v, cam.zoom, vp, b)
  cam.u = clamped.u
  cam.v = clamped.v
}

/** Plane -> screen (CSS px). */
export function toScreen(p: PlanePoint, cam: Camera, vp: Viewport): { x: number; y: number; k: number } {
  const k = vp.fit * cam.zoom
  return { x: vp.width / 2 + (p.u - cam.u) * k, y: vp.height / 2 + (p.v - cam.v) * k, k }
}
