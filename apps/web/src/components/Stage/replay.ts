import { getJson } from '../../services/api'
import { MatchDetailSchema, TrackingChunkSchema } from '../../services/schemas'
import type { MomentView } from '../../services/schemas'
import { BALL_MAX_STEP_M, lastFrameAtOrBefore, PLAYER_MAX_STEP_M, sampleBallZ, samplePair, toFrame } from '../../services/tracking'
import type { Frame, Neighbours } from '../../services/tracking'

/** The real tracking for a moment's replay window, sampled smoothly between the 2 Hz frames. */

export interface ReplayData {
  frames: Frame[]
  /** pid -> entity index in the match's tracking entity order. */
  entityMap: Map<string, number>
  from: number
  to: number
}

export interface ReplayPose {
  ball: { x: number; y: number; z: number; visible: boolean }
  pos: Map<string, { x: number; y: number }>
}

/** Longest stretch of real play the stage replays (window moments can span minutes). */
export const MAX_REPLAY_MS = 12_000

/** Replay window: the view's window, clamped to lead into the frozen frame and finish shortly after. */
export function replayWindow(view: MomentView): { from: number; to: number } {
  const from = Math.max(view.replay.from_ms, view.frame_ms - 8000)
  const to = Math.min(view.replay.to_ms, from + MAX_REPLAY_MS)
  return { from, to: Math.max(to, Math.min(view.replay.to_ms, view.frame_ms + 500)) }
}

export function neighboursAt(frames: readonly Frame[], t: number): Neighbours {
  const i = lastFrameAtOrBefore(frames, t)
  const at = (k: number): Frame | null => (k >= 0 && k < frames.length ? frames[k]! : null)
  return [at(i - 1), at(i), at(i + 1), at(i + 2)]
}

export function sampleReplay(data: ReplayData, t: number, out: ReplayPose): ReplayPose {
  const n = neighboursAt(data.frames, t)
  const s = { x: 0, y: 0 }
  if (samplePair(n, t, 0, BALL_MAX_STEP_M, s)) {
    out.ball.x = s.x
    out.ball.y = s.y
    out.ball.z = sampleBallZ(n, t)
    out.ball.visible = true
  } else {
    out.ball.visible = false
  }
  for (const [pid, idx] of data.entityMap) {
    if (samplePair(n, t, 3 + idx * 2, PLAYER_MAX_STEP_M, s)) out.pos.set(pid, { x: s.x, y: s.y })
    else out.pos.delete(pid)
  }
  return out
}

let entitiesCache: { matchId: string; entities: string[] } | null = null

/** Fetch the entity order (match detail) and the tracking frames for the window. */
export async function loadReplay(matchId: string, view: MomentView, signal?: AbortSignal): Promise<ReplayData> {
  const { from, to } = replayWindow(view)
  let entities = entitiesCache?.matchId === matchId ? entitiesCache.entities : null
  if (!entities) {
    const detail = await getJson(`/api/matches/${matchId}`, MatchDetailSchema, { signal, timeoutMs: 8000 })
    entities = detail.tracking.entities
    entitiesCache = { matchId, entities }
  }
  const chunk = await getJson(
    `/api/matches/${matchId}/tracking?from_ms=${Math.floor(from - 1000)}&to_ms=${Math.ceil(to + 1000)}`,
    TrackingChunkSchema,
    { signal, timeoutMs: 8000 },
  )
  const width = 3 + entities.length * 2
  const frames: Frame[] = []
  for (const row of chunk.frames) {
    if (row.length !== width + 1) continue
    const f = toFrame(row)
    if (f) frames.push(f)
  }
  frames.sort((a, b) => a.t - b.t)
  const entityMap = new Map<string, number>()
  const present = new Set(view.players.map((p) => p.pid))
  entities.forEach((id, i) => {
    if (present.has(id)) entityMap.set(id, i)
  })
  return { frames, entityMap, from, to }
}
