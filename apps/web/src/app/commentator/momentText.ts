import { readable } from '../../services/commentary'
import type { WorldIndex } from '../../services/matchView'
import type { Signal } from '../../services/schemas'

/**
 * The words for a moment at a glance. A live goal leads with the scorer and keeps the server's score sentence as
 * its line, so a provisional goal still reads "awaiting confirmation" (the score bug shows the score itself).
 */
export function momentWords(s: Signal, world: WorldIndex): { headline: string; line: string | null; scorer: string | null } {
  const r = readable(s)
  const pid = (s.refs as Record<string, unknown>).player_id
  const player = typeof pid === 'string' ? world.players.get(pid) : undefined
  if (s.kind === 'goal' && s.status === 'live' && player) {
    // "N. Vantreight scores for Northbridge. Northbridge 1–0 Riverton, awaiting confirmation." → from the score on
    const text = r.line ?? ''
    const at = text.indexOf(r.headline)
    const rest = at > 0 ? text.slice(at).trim() : ''
    return { headline: `${player.family_name} scores`, line: rest || r.line, scorer: pid as string }
  }
  return { headline: r.headline, line: r.line, scorer: null }
}
