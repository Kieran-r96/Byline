import { describe, expect, it } from 'vitest'
import type { WorldIndex } from '../../services/matchView'
import type { Signal } from '../../services/schemas'
import { momentWords } from './momentText'

const world = { players: new Map([['NBA-09', { family_name: 'Vantreight' }]]), teams: new Map() } as unknown as WorldIndex

function goal(text: string, status: Signal['status'] = 'live'): Signal {
  return {
    signal_id: 'sig-goal-E1',
    kind: 'goal',
    tier: 'alert',
    status,
    headline: 'GOAL · Northbridge 1–0 Riverton',
    text: { commentator: text },
    refs: { player_id: 'NBA-09' },
  } as unknown as Signal
}

describe('momentWords', () => {
  it('a provisional goal leads with the scorer but still reads awaiting confirmation', () => {
    const w = momentWords(goal('N. Vantreight scores for Northbridge. Northbridge 1–0 Riverton, awaiting confirmation.'), world)
    expect(w.headline).toBe('Vantreight scores')
    expect(w.line).toBe('Northbridge 1–0 Riverton, awaiting confirmation.')
  })

  it('a confirmed goal says when it was confirmed', () => {
    const w = momentWords(goal("N. Vantreight scores for Northbridge. Northbridge 1–0 Riverton, confirmed at 28'."), world)
    expect(w.line).toBe("Northbridge 1–0 Riverton, confirmed at 28'.")
  })

  it('a disallowed goal keeps the official wording, never the scorer-led headline', () => {
    const w = momentWords(goal('Goal ruled out for offside after a VAR check. Score stays Northbridge 1–0 Riverton.', 'corrected'), world)
    expect(w.headline).not.toContain('scores')
  })
})
