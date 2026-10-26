import { describe, expect, it } from 'vitest'
import { advanceRenderClock, extrapolatePlayhead } from './playhead'

const anchor = { playhead_ms: 60_000, speed: 12, playing: true, duration_ms: 100_000, receivedAt: 1000 }

describe('playhead extrapolation', () => {
  it('advances by elapsed wall time x speed while playing', () => {
    expect(extrapolatePlayhead(anchor, 1000)).toBe(60_000)
    expect(extrapolatePlayhead(anchor, 1500)).toBe(66_000)
  })

  it('holds still while paused', () => {
    expect(extrapolatePlayhead({ ...anchor, playing: false }, 9000)).toBe(60_000)
  })

  it('clamps to the match duration and never runs backwards', () => {
    expect(extrapolatePlayhead(anchor, 100_000)).toBe(100_000)
    expect(extrapolatePlayhead(anchor, 0)).toBe(60_000)
  })

  it('render clock snaps on a seek but eases small heartbeat jitter', () => {
    const clock = { t: 0, initialised: false }
    expect(advanceRenderClock(clock, 10_000, 16, true, 1).snapped).toBe(true)
    const eased = advanceRenderClock(clock, 10_100, 16, true, 1)
    expect(eased.snapped).toBe(false)
    expect(eased.t).toBeGreaterThan(10_000)
    expect(eased.t).toBeLessThan(10_100)
    expect(advanceRenderClock(clock, 900_000, 16, true, 1).snapped).toBe(true)
  })
})
