import { useEffect, useState } from 'react'
import { z } from 'zod'

import { getJson } from './api'

/** Key-moment jump points computed by the backend from detector + official-decision outputs. */
export const MomentSchema = z.object({
  kind: z.enum(['story', 'decision']),
  id: z.string(),
  label: z.string(),
  team_id: z.string().nullable(),
  clock: z.string(),
  at_ms: z.number(),
  jump_to_ms: z.number(),
  recorded_ai: z.boolean(),
  retracted_later: z.boolean(),
})
export type Moment = z.infer<typeof MomentSchema>

export const ShowcaseSchema = z.object({
  match_id: z.string(),
  moments: z.array(MomentSchema),
  first_verified_ai_story: MomentSchema.nullable(),
})
export type Showcase = z.infer<typeof ShowcaseSchema>

export function useShowcase(matchId: string | null): Showcase | null {
  const [data, setData] = useState<Showcase | null>(null)
  useEffect(() => {
    if (!matchId) return
    const ctrl = new AbortController()
    getJson(`/api/matches/${encodeURIComponent(matchId)}/showcase`, ShowcaseSchema, { signal: ctrl.signal })
      .then(setData)
      .catch(() => setData(null))
    return () => ctrl.abort()
  }, [matchId])
  return data && data.match_id === matchId ? data : null
}
