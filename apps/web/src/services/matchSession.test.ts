import { describe, expect, it, vi } from 'vitest'
import { MatchSessionStore } from './matchSession'

describe('MatchSessionStore playback controls', () => {
  it('sends controls one at a time, in order, so a pause can never be overtaken by an earlier play', async () => {
    const sent: string[] = []
    const answer: Array<() => void> = []
    const fetchImpl = vi.fn((_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { action: string }
      sent.push(body.action)
      const heartbeat = { playhead_ms: 1000, speed: 12, playing: body.action === 'play', cursor: 1, duration_ms: 5_000_000 }
      return new Promise<Response>((resolve) => answer.push(() => resolve(new Response(JSON.stringify(heartbeat), { status: 200, headers: { 'Content-Type': 'application/json' } }))))
    })
    const s = new MatchSessionStore({ log: () => {}, fetchImpl: fetchImpl as unknown as typeof fetch })
    ;(s as unknown as { set: (patch: object, immediate: boolean) => void }).set(
      { sessionId: 'S1', anchor: { playhead_ms: 1000, speed: 12, playing: false, duration_ms: 5_000_000, receivedAt: 0 } },
      true,
    )

    s.play()
    s.pause()
    await new Promise((r) => setTimeout(r, 10))
    // the pause waits until the play has been answered
    expect(sent).toEqual(['play'])
    answer[0]!()
    await vi.waitFor(() => expect(sent).toEqual(['play', 'pause']))
    answer[1]!()
    await vi.waitFor(() => expect(s.getSnapshot().anchor?.playing).toBe(false))
  })
})
