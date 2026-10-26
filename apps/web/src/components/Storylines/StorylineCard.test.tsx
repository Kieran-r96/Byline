import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { MatchSessionStore } from '../../services/matchSession'
import { StorylineSchema } from '../../services/schemas'
import type { Storyline } from '../../services/schemas'
import { measuredLine, visibleStorylines } from '../../services/storylines'
import { StorylineCard } from './StorylineCard'

// Shapes copied from the live contract (GET /api/matches/BYLINE-01/storylines), not product data.
function sl(over: Partial<Storyline> & { storyline_id: string; state: Storyline['state'] }): Storyline {
  return StorylineSchema.parse({
    match_id: 'BYLINE-01',
    pattern_type: 'repeated_channel_attack',
    team_id: 'NBA',
    subject: 'right',
    version: 1,
    opened_at_ms: 1_380_000,
    updated_at_ms: 1_380_000,
    display_clock: "23'",
    headline: 'Northbridge Athletic: attacks through the right channel',
    reason: '6 of 8 final-third entries in the last 10 minutes.',
    metrics: { window_minutes: 10, channel_entries: 7, total_entries: 8, distinct_possessions: 5, dangerous_entries: 0,
      gates_passed: ['baseline', 'possessions', 'share', 'unusual', 'volume'], gates_pending: ['danger'] },
    history: [{ version: 1, state: 'OBSERVING', at_ms: 1_380_000, seq: 700, display_clock: "23'", reason: 'Watching.' }],
    ...over,
  })
}

const developing = sl({
  storyline_id: 'SL-dev',
  state: 'DEVELOPING',
  version: 2,
  updated_at_ms: 1_500_000,
  display_clock: "25'",
  ai_read: { line: 'Northbridge are building down the right, 7 of 8 entries, no dangerous one yet.', caveat: 'Counts only.' },
  history: [
    { version: 1, state: 'OBSERVING', at_ms: 1_380_000, seq: 700, display_clock: "23'", reason: 'Watching.' },
    { version: 2, state: 'DEVELOPING', at_ms: 1_500_000, seq: 720, display_clock: "25'", reason: 'Developing.' },
  ],
})
const watching = sl({ storyline_id: 'SL-watch', state: 'OBSERVING' })

function within(text: string): HTMLElement {
  return screen.getByText(text).closest('.storyline__layer') as HTMLElement
}

describe('StorylineCard', () => {
  it('shows the rail with the clock each step was reached, then labelled measured and AI layers', () => {
    render(<ul><StorylineCard storyline={developing} variant="commentator" /></ul>)
    const rail = screen.getByRole('list', { name: 'Storyline progress' })
    expect(rail).toHaveTextContent("Watching23'")
    expect(rail).toHaveTextContent("Developing25'")
    expect(rail).toHaveTextContent('Strong–')
    expect(within('Measured')).toHaveTextContent('7 of 8 final-third entries down the right in 10 min · 5 possessions · 0 dangerous')
    expect(within('AI read')).toHaveTextContent('Foundry · rule-checked')
    expect(screen.getByText(/Not a story yet/)).toBeInTheDocument()
  })

  it('a published story replaces the AI read and the provisional headline', () => {
    render(<ul><StorylineCard storyline={{ ...developing, state: 'STRONG' }} variant="commentator" story={<p>VERIFIED STORY</p>} /></ul>)
    expect(screen.getByText('VERIFIED STORY')).toBeInTheDocument()
    expect(screen.queryByText(/AI read/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Not a story yet/)).not.toBeInTheDocument()
  })

  it('Fan Discover gets plain words and no technical history; Analyst gets the gates', async () => {
    const { unmount } = render(<ul><StorylineCard storyline={developing} variant="discover" /></ul>)
    expect(screen.getByText('7 of their last 8 attacks into the final third went down the right.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /History/ })).not.toBeInTheDocument()
    unmount()
    render(<ul><StorylineCard storyline={developing} variant="analyst" /></ul>)
    expect(screen.getByText('5 of 6 detector gates pass · waiting on danger')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'History (2)' }))
    expect(screen.getByText(/v2 · 25'/)).toBeInTheDocument()
  })

  it('role visibility: Discover hides watch-only storylines; resolved ones leave the live list', () => {
    const resolved = sl({ storyline_id: 'SL-done', state: 'RESOLVED' })
    expect(visibleStorylines([watching, developing, resolved], 'commentator').map((s) => s.storyline_id)).toEqual(['SL-dev', 'SL-watch'])
    expect(visibleStorylines([watching, developing], 'discover').map((s) => s.storyline_id)).toEqual(['SL-dev'])
  })

  it('after a VAR correction the rail shows the step-back instead of the reverted Confirmed', () => {
    const corrected = sl({ storyline_id: 'SL-var', state: 'STRONG', pattern_type: 'counterattack', subject: 'transition',
      withdrawn_candidate_ids: ['P-2'], candidate_ids: ['P-1', 'P-2'],
      history: [
        { version: 1, state: 'STRONG', at_ms: 1, seq: 1, display_clock: "57'", reason: 'Published.' },
        { version: 2, state: 'CONFIRMED', at_ms: 2, seq: 2, display_clock: "71'", reason: '2 in this spell.' },
        { version: 3, state: 'STRONG', at_ms: 3, seq: 3, display_clock: "72'", reason: 'One linked story withdrawn.' },
      ] })
    render(<ul><StorylineCard storyline={corrected} variant="commentator" /></ul>)
    const steps = screen.getByRole('list', { name: 'Storyline progress' }).querySelectorAll('li')
    expect(steps[2]).toHaveAttribute('data-current', 'true')
    expect(steps[3]).toHaveAttribute('data-reverted', 'true')
    expect(screen.getByText('Corrected by VAR')).toBeInTheDocument()
  })

  it('counter-attack and overlap measurements read naturally for fans', () => {
    const counter = sl({ storyline_id: 'SL-c', state: 'STRONG', pattern_type: 'counterattack', subject: 'transition',
      metrics: { occurrences: 2, seconds_regain_to_shot: 12, metres_advanced: 36.3, shot_outcome: 'goal' } })
    expect(measuredLine(counter, 'discover')).toBe('2 fast breaks: the latest went from winning the ball to a goal in 12 seconds.')
    expect(measuredLine(counter, 'commentator')).toBe('2 fast breaks this spell · latest 12 s regain to shot · 36.3 m advanced · goal')
  })
})

describe('storyline_update in the session store', () => {
  it('keeps the newest version and clears on replay_reset', () => {
    const store = new MatchSessionStore({
      log: () => {},
      now: () => 0,
      fetchImpl: vi.fn(async () => new Response('{}', { status: 500 })) as unknown as typeof fetch,
    })
    store.handleMessage('storyline_update', JSON.stringify(developing))
    store.handleMessage('storyline_update', JSON.stringify({ ...developing, version: 1, state: 'OBSERVING' }))
    expect(store.getSnapshot().storylines['SL-dev']?.state).toBe('DEVELOPING')
    store.handleMessage('replay_reset', JSON.stringify({ playhead_ms: 0, cursor: 0, last_seq: -1 }))
    expect(store.getSnapshot().storylines).toEqual({})
  })
})
