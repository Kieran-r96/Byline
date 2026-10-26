import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { MomentViewSchema, SignalSchema } from '../../services/schemas'
import type { Signal } from '../../services/schemas'
import { feedFor } from '../../services/signals'
import { tacticHighlight } from '../../services/tactics'
import { AlertBanner } from './AlertBanner'

// Shapes copied from the live contract (GET /api/matches/BYLINE-01/signals), not product data.
function sig(over: Partial<Signal> & { signal_id: string }): Signal {
  return SignalSchema.parse({
    kind: 'tactical', tier: 'insight', team_id: 'NBA', at_ms: 375_100, seq: 181, display_clock: "7'",
    headline: 'S. Haddad-Rhys was open as M. Lindqvist\'s pass was cut out',
    text: { commentator: 'Lane 3.3 m clear.', studio: 'Open option', fan: 'Haddad-Rhys was free.' },
    audiences: ['commentator', 'studio', 'fan'], refs: { moment_id: 'T-option-NBA-0180', tactic: 'option' },
    version: 1, actions: ['show_why', 'what_if'], ...over,
  })
}

describe('signal routing', () => {
  it('splits quiet notes from what matters and keeps newest first', () => {
    const all = [
      sig({ signal_id: 'a', at_ms: 1 }),
      sig({ signal_id: 'b', at_ms: 3, tier: 'alert', kind: 'goal' }),
      sig({ signal_id: 'q', at_ms: 2, tier: 'quiet', audiences: ['commentator'] }),
    ]
    const c = feedFor(all, 'commentator')
    expect(c.main.map((s) => s.signal_id)).toEqual(['b', 'a'])
    expect(c.quiet.map((s) => s.signal_id)).toEqual(['q'])
    expect(feedFor(all, 'fan').quiet).toEqual([]) // quiet notes are not routed to fans
  })

  it('follow-a-player keeps only signals that involve them', () => {
    const all = [sig({ signal_id: 'p', refs: { player_id: 'NBA-09' } }), sig({ signal_id: 'x' })]
    expect(feedFor(all, 'commentator', 'NBA-09').main.map((s) => s.signal_id)).toEqual(['p'])
  })
})

describe('AlertBanner', () => {
  it('is a dismissible status plate in the audience wording', async () => {
    const onDismiss = vi.fn()
    render(<AlertBanner signal={sig({ signal_id: 'g', kind: 'goal', tier: 'alert', headline: 'GOAL · Northbridge 1–0 Riverton',
      text: { commentator: 'Vantreight scores.', fan: 'Goal for Northbridge!' } })} audience="fan" onDismiss={onDismiss} />)
    expect(screen.getByRole('status')).toHaveTextContent('Northbridge 1–0 Riverton')
    expect(screen.getByText('Goal for Northbridge!')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss alert' }))
    expect(onDismiss).toHaveBeenCalled()
  })
})

describe('tactic overlay', () => {
  const view = MomentViewSchema.parse({
    moment_id: 'T-option-NBA-0180', kind: 'option', label: 'Better option on', team_id: 'NBA', at_ms: 374_100, seq: 180,
    display_clock: "7'", title: 't', observed: [], summary: 's', interpretation: 'i', unknowns: ['u'], evidence_event_ids: ['E0180'],
    focus_player_ids: ['NBA-04', 'NBA-11'], frame_ms: 374_000, significance: 40, available_ms: 375_100,
    available_seq: 181, direction: '+x', defending_team_id: 'RVC', players: [], ball: null, arrows: [],
    lines: { back_x: 80, mid_x: 66, offside_x: 82 }, replay: { from_ms: 368_000, to_ms: 376_600 },
    whatif: {
      moment_id: 'T-option-NBA-0180', team_id: 'NBA', defending_team_id: 'RVC', frame_ms: 374_000, carrier_id: 'NBA-04',
      origin: [60.1, 42.4],
      actual: { kind: 'pass', receiver_id: 'NBA-09', end: [72.6, 38.5], outcome: 'intercepted', interceptor_id: 'RVC-06',
        option: null, event_id: 'E0180' },
      alternatives: [{ receiver_id: 'NBA-11', x: 73, y: 12, distance_m: 20, progression_m: 13, lane_clearance_m: 3.3,
        lane_blocker_id: null, lane_opponents: [], receiver_space_m: 9.3, nearest_marker_id: null, opponents_bypassed: 3,
        beyond_back_line: false, between_lines: true, offside_position: false, rating: 'open', bypassed_ids: ['RVC-04'] }],
      lines: null, labels: { history: 'h', hypothetical: 'Not what happened' }, rules: { open: 'r' },
    },
  })
  it('keeps history and hypothesis as separate layers', () => {
    const spec = tacticHighlight(view, 'whatif', 0)
    expect(spec.tactic?.actual?.interceptorId).toBe('RVC-06')
    expect(spec.tactic?.alts[0]).toMatchObject({ receiverId: 'NBA-11', clearance: 3.3, space: 9.3, bypassedIds: ['RVC-04'] })
    expect(tacticHighlight(view, 'moment', 0).tactic?.step).toBe('moment')
  })
})
