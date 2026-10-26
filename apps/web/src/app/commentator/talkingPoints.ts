import { signalText } from '../../services/commentary'
import type { WorldIndex } from '../../services/matchView'
import type { MatchEvent, Signal } from '../../services/schemas'
import type { TalkingPointDto } from '../../services/dossier'
import type { ResearchFocus } from './research'

export interface TalkingPoint {
  id: string
  text: string
  why: string
  source: string
  subject: ResearchFocus | null
  score: number
  /** More to say: the server's detail line (scope, dates, the rule behind a ban). */
  detail?: string | null
  /** The server's kind (record, milestone, h2h, storyline…), when it came from the server. */
  kind?: string
}

const CONTEXT_KINDS = new Set(['context', 'record', 'milestone'])
const RECENT_MS = 3 * 60_000

/**
 * Rank the knowledge-base talking points (records, milestones, streaks, head to head, managers)
 * by relevance now: about someone involved in the last few minutes first, then what has just
 * become true, then background. Deterministic; uses only signals and events already released.
 */
export function rankTalkingPoints(signals: readonly Signal[], events: readonly MatchEvent[], world: WorldIndex, playheadMs: number, limit = 6): TalkingPoint[] {
  const involved = new Map<string, number>()
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const e = events[i]!
    if (playheadMs - e.elapsed_ms > RECENT_MS) break
    if (e.player_id) involved.set(e.player_id, (involved.get(e.player_id) ?? 0) + 1)
  }
  const out: TalkingPoint[] = []
  const seen = new Set<string>()
  for (const s of signals) {
    if (!CONTEXT_KINDS.has(s.kind) || s.status === 'withdrawn' || !s.audiences.includes('commentator')) continue
    const text = signalText(s)
    if (seen.has(text)) continue
    seen.add(text)
    const refs = s.refs as Record<string, unknown>
    const sid = typeof refs.player_id === 'string' ? refs.player_id : typeof refs.subject_id === 'string' ? refs.subject_id : null
    const player = sid && world.players.has(sid) ? sid : null
    const club = sid && world.teams.has(sid) ? sid : null
    const touches = player ? (involved.get(player) ?? 0) : 0
    const age = playheadMs - s.at_ms
    let score = 0
    let why: string
    if (touches > 0) {
      score = 100 + touches * 4
      why = `${world.players.get(player!)?.family_name} has been involved in the last few minutes`
    } else if (s.at_ms > 0 && age <= 10 * 60_000) {
      score = 70 - age / 20_000
      why = `New at ${s.display_clock}`
    } else if (s.at_ms === 0) {
      score = 20
      why = 'Pre-match context'
    } else {
      score = 30 - age / 120_000
      why = `From ${s.display_clock}`
    }
    if (s.tier === 'alert') score += 10
    out.push({
      id: `tp:${s.signal_id}`,
      text,
      why,
      source: typeof refs.rule === 'string' || s.at_ms === 0 || s.kind !== 'context' ? 'Fictional history' : 'This match',
      subject: player ? { kind: 'player', id: player } : club ? { kind: 'club', id: club } : null,
      score,
    })
  }
  return out.sort((a, b) => b.score - a.score).slice(0, limit)
}

/** Server-ranked talking points (full event history, knowledge base) mapped for the surface. */
export function fromServer(points: readonly TalkingPointDto[], world: WorldIndex): TalkingPoint[] {
  return points.map((t) => {
    const sid = t.subject_ids.find((id) => world.players.has(id)) ?? t.subject_ids.find((id) => world.teams.has(id)) ?? null
    return {
      id: `tp:${t.id}`,
      text: t.text,
      why: t.why || 'Background',
      source: t.source === 'fictional history' ? 'Fictional history' : t.source === 'tracking' ? 'Measured from tracking' : 'This match',
      subject: sid ? (world.players.has(sid) ? { kind: 'player', id: sid } : { kind: 'club', id: sid }) : null,
      score: t.priority,
      detail: t.detail ?? null,
      kind: t.kind,
    }
  })
}
