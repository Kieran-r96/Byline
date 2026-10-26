/**
 * Playhead maths. The server sends a heartbeat about once a second; between
 * heartbeats the client extrapolates `playhead += dt * speed` while playing.
 */

export interface PlayheadAnchor {
  playhead_ms: number
  speed: number
  playing: boolean
  duration_ms: number
  /** Local clock (performance.now() ms) when the heartbeat was received. */
  receivedAt: number
}

export function extrapolatePlayhead(anchor: PlayheadAnchor, now: number): number {
  const base = Math.min(Math.max(anchor.playhead_ms, 0), anchor.duration_ms)
  if (!anchor.playing) return base
  const dt = Math.max(0, now - anchor.receivedAt)
  return Math.min(anchor.duration_ms, base + dt * anchor.speed)
}

/**
 * Smoothed render clock. Heartbeats arrive with network jitter, so the raw
 * extrapolation can step back or forward a little. The render clock advances
 * on its own and eases toward the target; big jumps (seeks) snap.
 */
export interface RenderClock {
  t: number
  initialised: boolean
}

export const SNAP_THRESHOLD_MS = 4000

export function advanceRenderClock(
  clock: RenderClock,
  target: number,
  dtMs: number,
  playing: boolean,
  speed: number,
): { t: number; snapped: boolean } {
  if (!clock.initialised) {
    clock.t = target
    clock.initialised = true
    return { t: target, snapped: true }
  }
  const tolerance = Math.max(SNAP_THRESHOLD_MS, speed * 400)
  if (Math.abs(target - clock.t) > tolerance) {
    clock.t = target
    return { t: target, snapped: true }
  }
  if (playing) {
    const predicted = clock.t + Math.min(dtMs, 100) * speed
    // Ease 12% of the error per frame toward the authoritative extrapolation.
    clock.t = predicted + (target - predicted) * 0.12
  } else {
    clock.t = clock.t + (target - clock.t) * 0.35
    if (Math.abs(target - clock.t) < 1) clock.t = target
  }
  return { t: clock.t, snapped: false }
}
