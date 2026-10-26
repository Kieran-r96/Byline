import type { TrackingChunk } from './schemas'

/**
 * Tracking cache + interpolation.
 *
 * Frames arrive as `[t, bx, by, bz, e1x, e1y, e2x, e2y, ...]` (entity order =
 * match detail `tracking.entities`; `null` pairs = off the pitch). Frames are
 * nominally 500 ms apart but not on a fixed grid (period offsets, half-time
 * gap), so lookups are by binary search over each chunk's sorted times.
 */

export interface Frame {
  t: number
  /** [bx, by, bz, e1x, e1y, ...]; NaN where the source had null. */
  v: Float32Array
}

export const CHUNK_MS = 60_000
/** Frames further apart than this are a discontinuity (half-time, data gap). */
export const MAX_FRAME_GAP_MS = 1500
/** A player cannot move this far in one frame: treat it as a teleport. */
export const PLAYER_MAX_STEP_M = 12
export const BALL_MAX_STEP_M = 30

export function toFrame(row: ReadonlyArray<number | null>): Frame | null {
  const t = row[0]
  if (typeof t !== 'number' || !Number.isFinite(t)) return null
  const v = new Float32Array(row.length - 1)
  for (let i = 1; i < row.length; i += 1) {
    const value = row[i]
    v[i - 1] = typeof value === 'number' && Number.isFinite(value) ? value : Number.NaN
  }
  return { t, v }
}

export function chunkIndexFor(ms: number): number {
  return Math.max(0, Math.floor(ms / CHUNK_MS))
}

/** Index of the last frame with time <= t, or -1 if t precedes all frames. */
export function lastFrameAtOrBefore(frames: readonly Frame[], t: number): number {
  let lo = 0
  let hi = frames.length - 1
  let ans = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (frames[mid]!.t <= t) {
      ans = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  return ans
}

/** Four frames around t: f1.t <= t < f2.t, f0 before f1, f3 after f2. */
export type Neighbours = [Frame | null, Frame | null, Frame | null, Frame | null]

export function catmullRom(p0: number, p1: number, p2: number, p3: number, u: number): number {
  const u2 = u * u
  const u3 = u2 * u
  return (
    0.5 *
    (2 * p1 + (-p0 + p2) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u2 + (-p0 + 3 * p1 - 3 * p2 + p3) * u3)
  )
}

function finitePair(f: Frame | null, o: number): boolean {
  return f !== null && Number.isFinite(f.v[o]!) && Number.isFinite(f.v[o + 1]!)
}

function dist(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(ax - bx, ay - by)
}

/**
 * Interpolated position of one x/y pair at offset `o` of the frame vector.
 * Returns false (and leaves `out` untouched) when the entity is off the pitch.
 * Rules: hold across discontinuities; snap (never glide) across teleports;
 * entities entering/leaving appear at the nearer frame only.
 */
export function samplePair(
  n: Neighbours,
  t: number,
  o: number,
  maxStep: number,
  out: { x: number; y: number },
): boolean {
  const [f0, f1, f2, f3] = n
  if (!f1) {
    if (f2 && finitePair(f2, o)) {
      out.x = f2.v[o]!
      out.y = f2.v[o + 1]!
      return true
    }
    return false
  }
  const hasA = finitePair(f1, o)
  if (!f2 || f2.t - f1.t > MAX_FRAME_GAP_MS) {
    if (!hasA) return false
    out.x = f1.v[o]!
    out.y = f1.v[o + 1]!
    return true
  }
  const hasB = finitePair(f2, o)
  const u = Math.min(1, Math.max(0, (t - f1.t) / (f2.t - f1.t)))
  if (!hasA && !hasB) return false
  if (!hasA || !hasB) {
    const use = !hasA ? (u >= 0.5 ? f2 : null) : u < 0.5 ? f1 : null
    if (!use) return false
    out.x = use.v[o]!
    out.y = use.v[o + 1]!
    return true
  }
  const ax = f1.v[o]!
  const ay = f1.v[o + 1]!
  const bx = f2.v[o]!
  const by = f2.v[o + 1]!
  if (dist(ax, ay, bx, by) > maxStep) {
    out.x = u < 0.5 ? ax : bx
    out.y = u < 0.5 ? ay : by
    return true
  }
  let px = 2 * ax - bx
  let py = 2 * ay - by
  if (f0 && f1.t - f0.t <= MAX_FRAME_GAP_MS && finitePair(f0, o)) {
    const cx = f0.v[o]!
    const cy = f0.v[o + 1]!
    if (dist(cx, cy, ax, ay) <= maxStep) {
      px = cx
      py = cy
    }
  }
  let qx = 2 * bx - ax
  let qy = 2 * by - ay
  if (f3 && f3.t - f2.t <= MAX_FRAME_GAP_MS && finitePair(f3, o)) {
    const cx = f3.v[o]!
    const cy = f3.v[o + 1]!
    if (dist(cx, cy, bx, by) <= maxStep) {
      qx = cx
      qy = cy
    }
  }
  out.x = catmullRom(px, ax, bx, qx, u)
  out.y = catmullRom(py, ay, by, qy, u)
  return true
}

/** Ball height (z) by linear interpolation, clamped at the ground. */
export function sampleBallZ(n: Neighbours, t: number): number {
  const [, f1, f2] = n
  if (!f1) return f2 && Number.isFinite(f2.v[2]!) ? Math.max(0, f2.v[2]!) : 0
  const a = Number.isFinite(f1.v[2]!) ? f1.v[2]! : 0
  if (!f2 || f2.t - f1.t > MAX_FRAME_GAP_MS) return Math.max(0, a)
  const b = Number.isFinite(f2.v[2]!) ? f2.v[2]! : 0
  const u = Math.min(1, Math.max(0, (t - f1.t) / (f2.t - f1.t)))
  return Math.max(0, a + (b - a) * u)
}

export interface Pose {
  /** Ball x, y, z (z in metres above the ground). NaN x when unknown. */
  ball: { x: number; y: number; z: number; visible: boolean }
  /** Per entity: x, y pairs; NaN when off the pitch. Same order as entities. */
  xy: Float32Array
}

export function createPose(entityCount: number): Pose {
  return { ball: { x: Number.NaN, y: Number.NaN, z: 0, visible: false }, xy: new Float32Array(entityCount * 2) }
}

export type ChunkFetcher = (fromMs: number, toMs: number, signal: AbortSignal) => Promise<TrackingChunk>

export interface TrackingCacheOptions {
  fetchChunk: ChunkFetcher
  entityCount: number
  durationMs: number
  onError?: (index: number, error: unknown) => void
  onLoad?: (index: number) => void
}

/**
 * Caches 60 s chunks keyed by chunk index. `ensure(playhead)` loads the
 * current chunk immediately and prefetches ahead; `sample(t)` interpolates.
 */
export class TrackingCache {
  readonly chunks = new Map<number, Frame[]>()
  private readonly pending = new Map<number, AbortController>()
  private readonly failedAt = new Map<number, number>()
  private readonly opts: TrackingCacheOptions
  private readonly scratch = { x: 0, y: 0 }

  constructor(opts: TrackingCacheOptions) {
    this.opts = opts
  }

  get lastIndex(): number {
    return chunkIndexFor(this.opts.durationMs)
  }

  has(t: number): boolean {
    return this.chunks.has(chunkIndexFor(t))
  }

  isLoading(index: number): boolean {
    return this.pending.has(index)
  }

  /** Request what the playhead needs; prefetch further ahead at high speed. */
  ensure(playheadMs: number, speed = 1, now = Date.now()): void {
    const idx = chunkIndexFor(playheadMs)
    const ahead = speed >= 12 ? 2 : 1
    for (let i = idx; i <= Math.min(this.lastIndex, idx + ahead); i += 1) this.load(i, now)
    // Also make sure the frame before the boundary is present for interpolation.
    if (idx > 0 && playheadMs - idx * CHUNK_MS < 2000) this.load(idx - 1, now)
    // Keep memory bounded: drop chunks well away from the playhead.
    for (const key of [...this.chunks.keys()]) {
      if (key < idx - 2 || key > idx + 4) this.chunks.delete(key)
    }
    for (const [key, ctrl] of [...this.pending]) {
      if (key < idx - 1 || key > idx + ahead + 1) {
        ctrl.abort()
        this.pending.delete(key)
      }
    }
  }

  private load(index: number, now: number): void {
    if (this.chunks.has(index) || this.pending.has(index)) return
    const failed = this.failedAt.get(index)
    if (failed !== undefined && now - failed < 3000) return
    const ctrl = new AbortController()
    this.pending.set(index, ctrl)
    const from = index * CHUNK_MS
    const to = Math.min(this.opts.durationMs, from + CHUNK_MS - 1)
    this.opts
      .fetchChunk(from, to, ctrl.signal)
      .then((chunk) => {
        if (ctrl.signal.aborted) return
        const width = 3 + this.opts.entityCount * 2
        const frames: Frame[] = []
        for (const row of chunk.frames) {
          if (row.length !== width + 1) continue
          const f = toFrame(row)
          if (f) frames.push(f)
        }
        frames.sort((a, b) => a.t - b.t)
        this.chunks.set(index, frames)
        this.failedAt.delete(index)
        this.opts.onLoad?.(index)
      })
      .catch((err: unknown) => {
        if (ctrl.signal.aborted) return
        this.failedAt.set(index, Date.now())
        this.opts.onError?.(index, err)
      })
      .finally(() => {
        if (this.pending.get(index) === ctrl) this.pending.delete(index)
      })
  }

  /** Directly insert frames (tests, or pre-parsed data). */
  put(index: number, frames: Frame[]): void {
    this.chunks.set(index, [...frames].sort((a, b) => a.t - b.t))
  }

  neighbours(t: number): Neighbours {
    const idx = chunkIndexFor(t)
    const cur = this.chunks.get(idx)
    if (!cur || cur.length === 0) return [null, null, null, null]
    const prev = this.chunks.get(idx - 1)
    const next = this.chunks.get(idx + 1)
    const at = (i: number): Frame | null => {
      if (i >= 0 && i < cur.length) return cur[i]!
      if (i < 0 && prev && prev.length + i >= 0) return prev[prev.length + i]!
      if (i >= cur.length && next && i - cur.length < next.length) return next[i - cur.length]!
      return null
    }
    const i = lastFrameAtOrBefore(cur, t)
    return [at(i - 1), at(i), at(i + 1), at(i + 2)]
  }

  /** Fill `pose` for time t. Returns false when no tracking is loaded for t. */
  sample(t: number, pose: Pose): boolean {
    const n = this.neighbours(t)
    if (!n[1] && !n[2]) return false
    const s = this.scratch
    if (samplePair(n, t, 0, BALL_MAX_STEP_M, s)) {
      pose.ball.x = s.x
      pose.ball.y = s.y
      pose.ball.z = sampleBallZ(n, t)
      pose.ball.visible = true
    } else {
      pose.ball.visible = false
    }
    const count = this.opts.entityCount
    for (let e = 0; e < count; e += 1) {
      if (samplePair(n, t, 3 + e * 2, PLAYER_MAX_STEP_M, s)) {
        pose.xy[e * 2] = s.x
        pose.xy[e * 2 + 1] = s.y
      } else {
        pose.xy[e * 2] = Number.NaN
        pose.xy[e * 2 + 1] = Number.NaN
      }
    }
    return true
  }

  /** Ball only, for the trail. */
  sampleBall(t: number, out: { x: number; y: number; z: number }): boolean {
    const n = this.neighbours(t)
    if (!samplePair(n, t, 0, BALL_MAX_STEP_M, this.scratch)) return false
    out.x = this.scratch.x
    out.y = this.scratch.y
    out.z = sampleBallZ(n, t)
    return true
  }

  dispose(): void {
    for (const ctrl of this.pending.values()) ctrl.abort()
    this.pending.clear()
    this.chunks.clear()
  }
}
