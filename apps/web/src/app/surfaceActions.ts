import type { Signal } from '../services/schemas'

export interface SurfaceActions {
  /** Open the guided tactical explanation for a measured moment. */
  onOpenTactic: (momentId: string) => void
  /** Open the evidence for an AI-verified story. */
  onOpenEvidence: (candidateId: string) => void
  /** Replay the match from just before a moment. */
  onReplayAt: (ms: number) => void
}

/** What a signal can open: a measured moment, an AI story's evidence, or a replay of the event. */
export function signalAction(s: Signal, actions: SurfaceActions): { label: string; run: () => void } | null {
  const refs = s.refs as Record<string, unknown>
  if (typeof refs.moment_id === 'string') {
    const id = refs.moment_id
    return { label: 'Show the play', run: () => actions.onOpenTactic(id) }
  }
  const cids = Array.isArray(refs.candidate_ids) ? (refs.candidate_ids as string[]) : []
  const cid = cids[cids.length - 1]
  if (cid) return { label: 'See the evidence', run: () => actions.onOpenEvidence(cid) }
  if (s.tier === 'alert' && s.at_ms > 0 && s.kind !== 'record' && s.kind !== 'milestone')
    return { label: 'Replay it', run: () => actions.onReplayAt(Math.max(0, s.at_ms - 9000)) }
  return null
}

