import type { Signal } from './schemas'

export type FeedAudience = 'commentator' | 'studio' | 'fan'

const TIER_RANK: Record<Signal['tier'], number> = { alert: 0, insight: 1, quiet: 2 }

function involves(s: Signal, pid: string): boolean {
  const refs = s.refs as Record<string, unknown>
  if (refs.player_id === pid || refs.subject_id === pid) return true
  return s.headline.includes(pid) || Object.values(s.text).some((t) => t.includes(pid))
}

/**
 * Route the shared signal stream to one audience: newest first, withdrawn items kept (struck through) so a
 * correction is never silent, quiet notes separated so they never compete with what matters.
 */
export function feedFor(
  all: readonly Signal[],
  audience: FeedAudience,
  followId: string | null = null,
  followName: string | null = null,
): { main: Signal[]; quiet: Signal[] } {
  const mine = all.filter((s) => s.audiences.includes(audience))
  const followed = followId
    ? mine.filter((s) => involves(s, followId) || (followName ? s.headline.includes(followName) || Object.values(s.text).some((t) => t.includes(followName)) : false))
    : mine
  const byTime = [...followed].sort((a, b) => b.at_ms - a.at_ms || TIER_RANK[a.tier] - TIER_RANK[b.tier])
  return {
    main: byTime.filter((s) => s.tier !== 'quiet'),
    quiet: byTime.filter((s) => s.tier === 'quiet'),
  }
}

/** Studio / commentator alert banner: only the newest live alert, for a few seconds. */
export const ALERT_MS = 7000
