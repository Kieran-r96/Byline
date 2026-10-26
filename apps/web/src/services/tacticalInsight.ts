import { useEffect, useState } from 'react'
import { z } from 'zod'
import { getJson } from './api'

/** GET /api/matches/{id}/tactics/{moment_id}/insight: a recorded, verified Foundry read of a measured moment. */
export const TacticalInsightSchema = z.looseObject({
  state: z.enum(['verified', 'tentative', 'rejected', 'not_run']),
  insight: z
    .looseObject({
      title: z.string(),
      canonical_claim: z.string(),
      why_it_matters: z.string().optional(),
      uncertainty: z.string(),
      evidence_event_ids: z.array(z.string()).default([]),
      audience: z.looseObject({
        commentator: z.string(),
        studio_title: z.string(),
        studio_subtitle: z.string(),
        fan_plain: z.string(),
        fan_analyst: z.string().optional(),
        translations: z.record(z.string(), z.string()).optional(),
      }),
      hypothetical_label: z.string().optional(),
      verifier: z.looseObject({ verdict: z.string(), checks: z.array(z.looseObject({ claim: z.string(), supported: z.boolean(), note: z.string().optional() })).default([]) }).optional(),
      validator: z.looseObject({ passed: z.boolean(), checker: z.string().optional(), attempts: z.array(z.array(z.string())).default([]) }).optional(),
    })
    .nullable(),
  provenance: z
    .looseObject({
      provider: z.string(),
      model_deployment: z.string(),
      prompt_version: z.string(),
      model_calls: z.number(),
      input_tokens: z.number(),
      output_tokens: z.number(),
      total_latency_ms: z.number(),
      est_cost_usd: z.number(),
      finished_at_iso: z.string().optional(),
      calls: z.array(z.looseObject({ role: z.string(), latency_ms: z.number(), input_tokens: z.number(), output_tokens: z.number(), ok: z.boolean() })).default([]),
    })
    .nullable(),
  notice: z.string().optional(),
})
export type TacticalInsight = z.infer<typeof TacticalInsightSchema>

const cache = new Map<string, TacticalInsight | 'none'>()

/** The verified read for a moment, if a real recorded run exists. Never triggers model work. */
export function useTacticalInsight(matchId: string, momentId: string | null): TacticalInsight | null {
  const key = momentId ? `${matchId}:${momentId}` : ''
  const [, bump] = useState(0)
  useEffect(() => {
    if (!momentId || cache.has(key)) return undefined
    const ctrl = new AbortController()
    getJson(`/api/matches/${matchId}/tactics/${encodeURIComponent(momentId)}/insight`, TacticalInsightSchema, { signal: ctrl.signal, timeoutMs: 8000 })
      .then((d) => {
        cache.set(key, d.state === 'verified' && d.insight ? d : 'none')
        bump((n) => n + 1)
      })
      .catch(() => {
        if (!ctrl.signal.aborted) cache.set(key, 'none')
      })
    return () => ctrl.abort()
  }, [matchId, momentId, key])
  const v = key ? cache.get(key) : undefined
  return v && v !== 'none' ? v : null
}
