import { describe, expect, it } from 'vitest'
import { CHUNK_MS, TrackingCache, catmullRom, createPose, lastFrameAtOrBefore, toFrame } from './tracking'

// Synthetic test frames: ball + 2 entities. Row = [t, bx, by, bz, e1x, e1y, e2x, e2y]
const row = (t: number, e1x: number | null, e2x: number | null, bx = 50) =>
  toFrame([t, bx, 34, 0, e1x, e1x === null ? null : 10, e2x, e2x === null ? null : 20])!

function cacheWith(frames: ReturnType<typeof row>[]) {
  const cache = new TrackingCache({
    entityCount: 2,
    durationMs: 5_000_000,
    fetchChunk: () => Promise.reject(new Error('not used')),
  })
  const byChunk = new Map<number, typeof frames>()
  for (const f of frames) {
    const i = Math.floor(f.t / CHUNK_MS)
    byChunk.set(i, [...(byChunk.get(i) ?? []), f])
  }
  for (const [i, fs] of byChunk) cache.put(i, fs)
  return cache
}

describe('tracking interpolation', () => {
  it('binary search picks the frame at or before t', () => {
    const frames = [row(100, 1, 1), row(500, 2, 2), row(1000, 3, 3)]
    expect(lastFrameAtOrBefore(frames, 50)).toBe(-1)
    expect(lastFrameAtOrBefore(frames, 500)).toBe(1)
    expect(lastFrameAtOrBefore(frames, 999)).toBe(1)
  })

  it('Catmull-Rom passes through the two middle frames', () => {
    expect(catmullRom(0, 1, 2, 3, 0)).toBe(1)
    expect(catmullRom(0, 1, 2, 3, 1)).toBe(2)
    expect(catmullRom(0, 1, 2, 3, 0.5)).toBeCloseTo(1.5)
  })

  it('interpolates smoothly between the correct neighbouring frames', () => {
    const cache = cacheWith([row(0, 10, 0), row(500, 11, 0), row(1000, 12, 0), row(1500, 13, 0)])
    const pose = createPose(2)
    expect(cache.sample(750, pose)).toBe(true)
    expect(pose.xy[0]).toBeCloseTo(11.5)
    expect(pose.xy[1]).toBeCloseTo(10)
  })

  it('looks across chunk boundaries for neighbours', () => {
    const cache = cacheWith([row(59_000, 10, 0), row(59_500, 11, 0), row(60_000, 12, 0), row(60_500, 13, 0)])
    const pose = createPose(2)
    cache.sample(59_750, pose)
    expect(pose.xy[0]).toBeCloseTo(11.5)
  })

  it('handles nulls: off-pitch entities hide, entering ones appear only near their frame', () => {
    const cache = cacheWith([row(0, 10, null), row(500, 11, 30), row(1000, 12, 31)])
    const pose = createPose(2)
    cache.sample(100, pose)
    expect(Number.isNaN(pose.xy[2]!)).toBe(true) // entity 2 not yet on the pitch
    cache.sample(400, pose)
    expect(pose.xy[2]).toBe(30) // nearer to its first frame: shown there, no glide from nowhere
  })

  it('never glides across a teleport or a half-time gap', () => {
    const jump = cacheWith([row(0, 10, 0), row(500, 60, 0), row(1000, 61, 0)])
    const pose = createPose(2)
    jump.sample(200, pose)
    expect(pose.xy[0]).toBe(10)
    jump.sample(300, pose)
    expect(pose.xy[0]).toBe(60)
    const gap = cacheWith([row(2_821_000, 10, 0), row(2_826_300, 90, 0)])
    gap.sample(2_824_000, pose)
    expect(pose.xy[0]).toBe(10)
  })

  it('reports no frame when the chunk is not loaded', () => {
    const cache = cacheWith([row(0, 10, 0)])
    expect(cache.sample(10 * CHUNK_MS, createPose(2))).toBe(false)
  })
})
