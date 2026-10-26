import { findCarrier } from './stageModel'
import type { HighlightSpec, TacticStep } from '../components/MatchTheatre/renderer'
import { getJson } from './api'
import { MomentViewSchema } from './schemas'
import type { MomentView } from './schemas'

/** A released tactical moment as a drawable frame (positions, evidence arrows, lines, optional What If?). */
export function loadMomentView(matchId: string, momentId: string, signal?: AbortSignal): Promise<MomentView> {
  return getJson(`/api/matches/${matchId}/tactics/${encodeURIComponent(momentId)}/view`, MomentViewSchema, {
    signal,
    timeoutMs: 8000,
  })
}

const pt = (xy: readonly number[]) => ({ x: xy[0] ?? 0, y: xy[1] ?? 0 })

/** The canvas overlay for one step of the explanation. History and hypothesis are separate layers. */
export function tacticHighlight(view: MomentView, step: TacticStep, startedAt: number): HighlightSpec {
  const w = view.whatif
  return {
    segments: [],
    channel: null,
    playerIds: [],
    tactic: {
      step,
      startedAt,
      carrierId: findCarrier(view),
      origin: w ? pt(w.origin) : view.arrows[0] ? pt(view.arrows[0].from) : null,
      focusIds: view.focus_player_ids.slice(0, 4),
      lines: view.lines,
      actual:
        w && w.actual.kind === 'pass'
          ? {
              to: pt(w.actual.end),
              laneOpponentIds: w.actual.option?.lane_opponents ?? [],
              interceptorId: w.actual.interceptor_id,
            }
          : null,
      alts: (w?.alternatives ?? []).map((a) => ({
        receiverId: a.receiver_id,
        to: { x: a.x, y: a.y },
        clearance: a.lane_clearance_m,
        space: a.receiver_space_m,
        bypassedIds: a.bypassed_ids,
      })),
      arrows: view.arrows.map((a) => ({ from: pt(a.from), to: pt(a.to) })),
    },
  }
}
