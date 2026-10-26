import type { Channel, HighlightSegment, HighlightSpec } from '../components/MatchTheatre/renderer'
import { ApiError, getJson } from './api'
import { AgentTraceSchema, EventsPageSchema, EvidenceSchema, TrackingChunkSchema, payloadPoint, payloadString } from './schemas'
import type { AgentTrace, Evidence, Insight, MatchDetail, MatchEvent, PatternCandidate } from './schemas'

/**
 * Evidence workspace data. Primary source is /api/insights/{id}/evidence.
 * If the backend has no record (e.g. a degraded AI run it chose to forget),
 * the same evidence is rebuilt from the candidate the stream already sent
 * plus the immutable event log, and labelled as such.
 */

export interface EvidenceBundle {
  evidence: Evidence
  /** 'insight' = from the evidence endpoint; 'event_log' = rebuilt locally. */
  source: 'insight' | 'event_log'
}

export async function loadEvidence(
  candidate: PatternCandidate,
  insight: Insight | null,
  matchId: string,
  signal?: AbortSignal,
  sessionId?: string | null,
): Promise<EvidenceBundle> {
  // With session_id the server applies this session's view (e.g. VAR retraction).
  const query = sessionId ? `?session_id=${encodeURIComponent(sessionId)}` : ''
  try {
    const evidence = await getJson(`/api/insights/${encodeURIComponent(candidate.candidate_id)}/evidence${query}`, EvidenceSchema, {
      signal,
      timeoutMs: 8000,
    })
    return { evidence, source: 'insight' }
  } catch (err) {
    if (!(err instanceof ApiError && err.status === 404)) throw err
  }
  const ids = new Set([...candidate.evidence_event_ids, ...(insight?.evidence_event_ids ?? [])])
  const upto = Math.ceil(candidate.detected_at_ms) + 1
  const from = candidate.window_start_ms ?? 0
  const collected: MatchEvent[] = []
  let after = -1
  for (let page = 0; page < 4; page += 1) {
    const res = await getJson(
      `/api/matches/${matchId}/events?after_seq=${after}&limit=2000&upto_ms=${upto}`,
      EventsPageSchema,
      { signal, timeoutMs: 10_000 },
    )
    for (const ev of res.events) if (ev.elapsed_ms >= from - 1 && ids.has(ev.event_id)) collected.push(ev)
    if (res.events.length < 2000) break
    after = res.last_seq
  }
  return { evidence: { candidate, events: collected, insight }, source: 'event_log' }
}

export async function loadTrace(candidateId: string, signal?: AbortSignal): Promise<AgentTrace | null> {
  try {
    return await getJson(`/api/insights/${encodeURIComponent(candidateId)}/trace`, AgentTraceSchema, {
      signal,
      timeoutMs: 8000,
    })
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null
    throw err
  }
}

/** The overlapping runner: the receiver of the first evidence pass, else the last actor. */
export function runnerId(candidate: PatternCandidate, events: readonly MatchEvent[]): string | null {
  if (candidate.pattern_type !== 'overlap') return null
  const sorted = [...events].sort((a, b) => a.seq - b.seq)
  const first = sorted[0]
  const receiver = first ? payloadString(first, 'receiver_player_id') : null
  return receiver ?? sorted[sorted.length - 1]?.player_id ?? null
}

/** Runner path from tracking frames in frame_intervals[0]. */
export async function loadRunnerPath(
  candidate: PatternCandidate,
  events: readonly MatchEvent[],
  detail: MatchDetail,
  matchId: string,
  signal?: AbortSignal,
): Promise<Array<{ x: number; y: number }> | null> {
  const interval = candidate.frame_intervals[0]
  const id = runnerId(candidate, events)
  if (!interval || !id) return null
  const idx = detail.tracking.entities.indexOf(id)
  if (idx < 0) return null
  const chunk = await getJson(
    `/api/matches/${matchId}/tracking?from_ms=${Math.floor(interval.start_ms)}&to_ms=${Math.ceil(interval.end_ms)}`,
    TrackingChunkSchema,
    { signal, timeoutMs: 8000 },
  )
  const o = 4 + idx * 2
  const path: Array<{ x: number; y: number }> = []
  for (const row of chunk.frames) {
    const x = row[o]
    const y = row[o + 1]
    if (typeof x === 'number' && typeof y === 'number') path.push({ x, y })
  }
  return path.length > 1 ? path : null
}

function isChannel(v: unknown): v is Channel {
  return v === 'left' || v === 'centre' || v === 'right'
}

/** Pitch highlight for an insight: numbered source actions + channel band. */
export function buildHighlight(
  candidate: PatternCandidate,
  events: readonly MatchEvent[],
  runnerPath: Array<{ x: number; y: number }> | null = null,
): HighlightSpec {
  const segments: HighlightSegment[] = []
  const sorted = [...events].sort((a, b) => a.elapsed_ms - b.elapsed_ms || a.seq - b.seq)
  for (const ev of sorted) {
    let kind: HighlightSegment['kind'] | null = null
    let from = payloadPoint(ev, 'start')
    const to = payloadPoint(ev, 'end')
    if (ev.type.startsWith('pass.')) kind = 'pass'
    else if (ev.type === 'carry') kind = 'carry'
    else if (ev.type === 'shot') {
      kind = 'shot'
      from = payloadPoint(ev, 'location')
    }
    if (kind && from && to) {
      segments.push({ n: segments.length + 1, eventId: ev.event_id, kind, from: { x: from.x_m, y: from.y_m }, to: { x: to.x_m, y: to.y_m } })
    }
  }
  const m = candidate.calculated_metrics
  const channel = m.channel
  const dir = m.attacking_direction
  const involved = new Map<string, number>()
  for (const ev of sorted) {
    for (const pid of [ev.player_id, payloadString(ev, 'receiver_player_id')]) {
      if (pid) involved.set(pid, (involved.get(pid) ?? 0) + 1)
    }
  }
  return {
    segments,
    channel: isChannel(channel) && (dir === '+x' || dir === '-x') ? { channel, direction: dir } : null,
    runnerPath,
    playerIds: [...involved.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([pid]) => pid),
    startedAt: typeof performance !== 'undefined' ? performance.now() : 0,
  }
}

export interface MetricChip {
  label: string
  value: string
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

/** Human metric chips from metric_provenance / calculated_metrics. */
export function metricChips(metrics: Record<string, unknown>): MetricChip[] {
  const chips: MetricChip[] = []
  const entries = num(metrics.channel_entries)
  const total = num(metrics.total_entries)
  if (entries !== null && total !== null) chips.push({ label: 'Entries', value: `${entries} of ${total}` })
  const share = num(metrics.channel_share)
  if (share !== null) chips.push({ label: 'Channel share', value: `${Math.round(share * 100)}%` })
  const base = num(metrics.baseline_channel_share)
  if (base !== null) chips.push({ label: 'Earlier share', value: `${Math.round(base * 100)}%` })
  const poss = num(metrics.distinct_possessions)
  if (poss !== null) chips.push({ label: 'Possessions', value: String(poss) })
  const win = num(metrics.window_minutes)
  if (win !== null) chips.push({ label: 'Window', value: `${win} min` })
  const secs = num(metrics.seconds_regain_to_shot)
  if (secs !== null) chips.push({ label: 'Regain to shot', value: `${secs.toFixed(1)} s` })
  const metres = num(metrics.metres_advanced)
  if (metres !== null) chips.push({ label: 'Advanced', value: `${Math.round(metres)} m` })
  const actions = num(metrics.passes_and_carries)
  if (actions !== null) chips.push({ label: 'Passes + carries', value: String(actions) })
  if (typeof metrics.shot_outcome === 'string') chips.push({ label: 'Shot', value: metrics.shot_outcome })
  const dist = num(metrics.runner_distance_m)
  if (dist !== null) chips.push({ label: 'Run distance', value: `${dist.toFixed(1)} m` })
  const spd = num(metrics.runner_mean_speed_ms)
  if (spd !== null) chips.push({ label: 'Mean speed', value: `${spd.toFixed(1)} m/s` })
  const behind = num(metrics.runner_start_behind_m)
  const ahead = num(metrics.runner_finish_ahead_m)
  if (behind !== null && ahead !== null) chips.push({ label: 'Behind to ahead', value: `${behind.toFixed(1)} m to ${ahead.toFixed(1)} m` })
  const run = num(metrics.run_seconds)
  if (run !== null) chips.push({ label: 'Run time', value: `${run.toFixed(1)} s` })
  if (metrics.attacking_direction === '+x') chips.push({ label: 'Direction', value: 'Attacking left to right' })
  if (metrics.attacking_direction === '-x') chips.push({ label: 'Direction', value: 'Attacking right to left' })
  return chips
}

const REPLAY_SPEEDS = [1, 4, 12, 30]
const REPLAY_MAX_MS = 25_000

/** The evidence window as a short replay: a few seconds of lead-in, then the slowest speed that fits in 25 s. */
export function replayPlan(
  c: PatternCandidate,
  events: readonly MatchEvent[],
): { from: number; to: number; speed: number } | null {
  const start = c.window_start_ms ?? c.detected_at_ms
  const first = events.length ? Math.min(...events.map((e) => e.elapsed_ms)) : start
  const from = Math.max(0, Math.min(first, start) - 4000)
  const to = c.detected_at_ms + 2500
  if (to <= from) return null
  const speed = REPLAY_SPEEDS.find((s) => (to - from) / s <= REPLAY_MAX_MS) ?? 30
  return { from, to, speed }
}
