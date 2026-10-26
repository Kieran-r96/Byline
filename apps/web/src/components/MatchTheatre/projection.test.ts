import { describe, expect, it } from 'vitest'
import { channelBand } from './renderer'
import { BROADCAST_ZOOM, PITCH_L, clampCamera, fitScale, planeBounds, project } from './projection'

describe('broadcast projection and camera', () => {
  it('foreshortens the far touchline by roughly 15-20%', () => {
    const far = project(PITCH_L, 0).u - project(0, 0).u
    const near = project(PITCH_L, 68).u - project(0, 68).u
    const ratio = far / near
    expect(ratio).toBeGreaterThan(0.8)
    expect(ratio).toBeLessThan(0.86)
  })

  it('clamps the zoomed camera window inside the pitch bounds', () => {
    const b = planeBounds()
    const vp = { width: 1000, height: 562, fit: fitScale(1000, 562, b) }
    const halfW = vp.width / (2 * vp.fit * BROADCAST_ZOOM)
    const left = clampCamera(b.minU - 50, 0, BROADCAST_ZOOM, vp, b)
    expect(left.u).toBeCloseTo(b.minU + halfW)
    const right = clampCamera(b.maxU + 50, 0, BROADCAST_ZOOM, vp, b)
    expect(right.u).toBeCloseTo(b.maxU - halfW)
    const mid = clampCamera(0, (b.minV + b.maxV) / 2, BROADCAST_ZOOM, vp, b)
    expect(mid.u).toBe(0)
  })

  it('centres the camera when the window is larger than the pitch', () => {
    const b = planeBounds()
    const vp = { width: 1000, height: 562, fit: fitScale(1000, 562, b) }
    const c = clampCamera(30, 30, 1, vp, b)
    expect(c.u).toBeCloseTo((b.minU + b.maxU) / 2)
  })

  it('maps channels relative to the attacking direction', () => {
    expect(channelBand('right', '+x')[0]).toBeCloseTo(45.33, 1)
    expect(channelBand('right', '-x')[1]).toBeCloseTo(22.67, 1)
    expect(channelBand('centre', '+x')).toEqual(channelBand('centre', '-x'))
  })
})
