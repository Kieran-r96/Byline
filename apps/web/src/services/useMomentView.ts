import { useEffect, useState } from 'react'
import type { MomentView } from './schemas'
import { loadMomentView } from './tactics'

const views = new Map<string, MomentView | 'error'>()

/** Lazily loads (and caches per match) the drawable frame of a released tactical moment. */
export function useMomentView(matchId: string, momentId: string | null): { view: MomentView | null; failed: boolean } {
  const key = momentId ? `${matchId}:${momentId}` : ''
  const cached = key ? views.get(key) : undefined
  const [, bump] = useState(0)
  useEffect(() => {
    if (!momentId || views.has(key)) return undefined
    const ctrl = new AbortController()
    loadMomentView(matchId, momentId, ctrl.signal)
      .then((v) => {
        views.set(key, v)
        bump((n) => n + 1)
      })
      .catch(() => {
        if (!ctrl.signal.aborted) {
          views.set(key, 'error')
          bump((n) => n + 1)
        }
      })
    return () => ctrl.abort()
  }, [matchId, momentId, key])
  return { view: cached && cached !== 'error' ? cached : null, failed: cached === 'error' }
}
