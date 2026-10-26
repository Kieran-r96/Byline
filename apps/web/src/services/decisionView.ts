import type { Decision } from './schemas'

export type KindTone = 'yellow' | 'second' | 'red' | 'var' | 'offside' | 'penalty' | 'goal' | 'neutral'

export function kindTone(kind: string): KindTone {
  if (kind === 'YELLOW CARD') return 'yellow'
  if (kind === 'SECOND YELLOW') return 'second'
  if (kind === 'RED CARD') return 'red'
  if (kind === 'VAR CHECK' || kind === 'GOAL DISALLOWED') return 'var'
  if (kind.startsWith('OFFSIDE')) return 'offside'
  if (kind.startsWith('PENALTY')) return 'penalty'
  if (kind.startsWith('GOAL')) return 'goal'
  return 'neutral'
}

/** One-line summary parts: Decision, Reason, Law(s), Official event. */
export function compactParts(d: Decision): string[] {
  return compactLine(d).split(' | ')
}

/** One-line summary: "Decision: … | Reason: … | Law … | Official event E…". */
export function compactLine(d: Decision): string {
  const laws = [...new Set(d.which_rule.map((r) => r.law))].join(', ')
  // The decision id names its official event (D-E1799 -> E1799).
  const fromId = d.decision_id.replace(/^D-/, '')
  const official = d.source_event_ids.includes(fromId) ? fromId : d.source_event_ids[0]
  return [
    `Decision: ${d.decision.replace(/[.\s]+$/, '')}`,
    `Reason: ${d.reason}`,
    laws,
    official ? `Official event ${official}` : '',
  ]
    .filter(Boolean)
    .join(' | ')
}
