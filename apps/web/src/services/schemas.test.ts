import { describe, expect, it, vi } from 'vitest'
import { MatchSessionStore } from './matchSession'
import { parseStreamMessage } from './schemas'

// Test fixtures only (shapes copied from the live contract), not product data.
const EVENT = {
  event_id: 'E0005',
  seq: 5,
  elapsed_ms: 1500,
  period: 'H1',
  display_clock: "1'",
  team_id: 'NBA',
  player_id: 'NBA-09',
  type: 'pass.completed',
  truth_status: 'observed_synthetic',
  payload: { start: { x_m: 52.5, y_m: 34 }, end: { x_m: 32.6, y_m: 27 } },
  supersedes_event_id: null,
}
const HEARTBEAT = { playhead_ms: 1000, speed: 12, playing: true, cursor: 3, duration_ms: 5_766_500, server_time: 1 }

describe('stream payload validation', () => {
  it('accepts a valid match_event and heartbeat', () => {
    expect(parseStreamMessage('match_event', JSON.stringify(EVENT))?.event).toBe('match_event')
    expect(parseStreamMessage('heartbeat', JSON.stringify(HEARTBEAT))?.data).toMatchObject({ playing: true })
  })

  it('rejects malformed payloads and reports why', () => {
    const onInvalid = vi.fn()
    expect(parseStreamMessage('match_event', JSON.stringify({ ...EVENT, seq: 'five' }), onInvalid)).toBeNull()
    expect(parseStreamMessage('heartbeat', JSON.stringify({ ...HEARTBEAT, speed: -1 }), onInvalid)).toBeNull()
    expect(parseStreamMessage('insight_update', JSON.stringify({ candidate_id: 'X' }), onInvalid)).toBeNull()
    expect(parseStreamMessage('match_state', '{not json', onInvalid)).toBeNull()
    expect(onInvalid).toHaveBeenCalledTimes(4)
  })

  it('ignores unknown event names without error', () => {
    const onInvalid = vi.fn()
    expect(parseStreamMessage('tracking_hint', '{}', onInvalid)).toBeNull()
    expect(onInvalid).not.toHaveBeenCalled()
  })

  it('store drops invalid frames, never throws, and keeps valid state', () => {
    const log = vi.fn()
    const store = new MatchSessionStore({ log, now: () => 0, fetchImpl: vi.fn() as unknown as typeof fetch })
    expect(() => store.handleMessage('match_event', '{"event_id": 42}')).not.toThrow()
    store.handleMessage('match_event', JSON.stringify(EVENT))
    // duplicate / out-of-order delivery is deduplicated by seq
    store.handleMessage('match_event', JSON.stringify(EVENT))
    store.handleMessage('match_event', JSON.stringify({ ...EVENT, event_id: 'E0004', seq: 4 }))
    const snap = store.getSnapshot()
    expect(snap.invalidFrames).toBe(1)
    expect(log).toHaveBeenCalledWith(expect.stringContaining('dropped invalid stream payload'))
    expect(snap.events.map((e) => e.seq)).toEqual([4, 5])
  })

  it('replay_reset clears event buffers and later candidates', () => {
    const store = new MatchSessionStore({ log: () => {}, now: () => 0, fetchImpl: vi.fn(async () => new Response('{}', { status: 500 })) as unknown as typeof fetch })
    store.handleMessage('match_event', JSON.stringify(EVENT))
    const cand = {
      candidate_id: 'P-1',
      pattern_type: 'repeated_channel_attack',
      team_id: 'NBA',
      detected_at_ms: 1_633_200,
      display_clock: "28'",
      evidence_event_ids: ['E0005'],
      calculated_metrics: { channel: 'right' },
      factual_summary: 'x',
      confidence_band: 'tentative',
      unsupported_claims: [],
    }
    store.handleMessage('pattern_candidate', JSON.stringify(cand))
    store.handleMessage('pattern_candidate', JSON.stringify({ ...cand, candidate_id: 'P-0', detected_at_ms: 1000 }))
    store.handleMessage('replay_reset', JSON.stringify({ playhead_ms: 600_000, cursor: 10, last_seq: 9 }))
    const snap = store.getSnapshot()
    expect(snap.events).toHaveLength(0)
    expect(snap.candidates.map((c) => c.candidate_id)).toEqual(['P-0'])
    expect(snap.resetCount).toBe(1)
  })
})
