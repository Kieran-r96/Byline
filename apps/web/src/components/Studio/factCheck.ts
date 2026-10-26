import type { InsightEntry } from '../../services/matchSession'
import { isDetectorOnly } from '../../services/matchView'
import type { OverlayPacket } from '../../services/schemas'

/** Who checked the graphic's facts. Separate from the human decision to put it on air. */
export function factCheck(p: OverlayPacket, insights: Readonly<Record<string, InsightEntry>>): { text: string; ai: boolean } {
  if (p.on_hold) return { text: 'Official match event · VAR check in progress', ai: false }
  if (p.source_kind === 'tactical') return { text: 'Measured from tracking and events (deterministic)', ai: false }
  if (p.source_kind === 'context') return { text: 'Computed from the fictional club history, rule attached', ai: false }
  if (p.source_kind === 'stats') return { text: 'Counted from the official match events', ai: false }
  if (p.source_kind !== 'insight') return { text: 'Official match event', ai: false }
  const entry = insights[p.source_id.replace(/^I-/, '')]
  const insight = entry?.update.insight
  if (insight?.status === 'verified' && !isDetectorOnly(entry)) {
    return { text: 'Verified by Foundry agents and rule check', ai: true }
  }
  return { text: 'Detector measurement, not AI-reviewed', ai: false }
}

