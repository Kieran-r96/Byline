import type { MatchEvent } from './schemas'

export interface PlayerMarks {
  goals: string[]
  yellow: string | null
  red: string | null
  off: string | null
  on: string | null
}

/** Goals, cards and substitutions per player, from the official key events (never the future). */
export function playerMarks(keyEvents: readonly MatchEvent[]): Map<string, PlayerMarks> {
  const marks = new Map<string, PlayerMarks>()
  const get = (id: string) => {
    let m = marks.get(id)
    if (!m) {
      m = { goals: [], yellow: null, red: null, off: null, on: null }
      marks.set(id, m)
    }
    return m
  }
  for (const e of keyEvents) {
    const clock = e.display_clock ?? ''
    if (e.type === 'goal.confirmed' && e.player_id) get(e.player_id).goals.push(clock)
    else if (e.type === 'goal.disallowed' && e.player_id) {
      const m = get(e.player_id)
      m.goals = m.goals.slice(0, -1)
    } else if (e.type === 'card.yellow' && e.player_id) get(e.player_id).yellow = clock
    else if ((e.type === 'card.second_yellow' || e.type === 'card.red') && e.player_id) get(e.player_id).red = clock
    else if (e.type === 'substitution') {
      const p = e.payload as Record<string, unknown>
      if (typeof p.player_off_id === 'string') get(p.player_off_id).off = clock
      if (typeof p.player_on_id === 'string') get(p.player_on_id).on = clock
    }
  }
  return marks
}

