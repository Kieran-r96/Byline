import { useSyncExternalStore } from 'react'
import { ApiError, getJson } from './api'
import { extrapolatePlayhead } from './playhead'
import type { PlayheadAnchor } from './playhead'
import {
  EventsPageSchema,
  HeartbeatSchema,
  MatchDetailSchema,
  OverlayPacketSchema,
  SessionSchema,
  TrackingChunkSchema,
  parseStreamMessage,
} from './schemas'
import type {
  Decision,
  OverlayPacket,
  Recap,
  InsightUpdate,
  MatchDetail,
  MatchEvent,
  MatchState,
  PatternCandidate,
  Signal,
  Storyline,
  StreamEventName,
  TacticalMoment,
} from './schemas'
import { TrackingCache } from './tracking'

/**
 * Live match session store (plain TS + useSyncExternalStore).
 * - creates a replay session, opens the SSE stream, validates every frame
 * - keeps the latest state, a capped event buffer, key events for the
 *   timeline, candidates and insight updates (with the stages really seen)
 * - extrapolates the playhead between heartbeats
 * - reconnects with backoff; a vanished session is recreated at the last
 *   known playhead.
 */

export const MATCH_ID = 'BYLINE-01'
export const EVENT_BUFFER_CAP = 400
export const DEFAULT_SPEED = 12

/** Event types that drive timeline markers, moment chips and the VAR banner. */
export const KEY_EVENT_TYPES = new Set([
  'goal.provisional',
  'goal.confirmed',
  'goal.disallowed',
  'card.yellow',
  'card.second_yellow',
  'card.red',
  'penalty.outcome',
  'var.review_started',
  'var.review_outcome',
  'period.started',
  'period.ended',
  'match.finished',
  'substitution',
  'lineup.confirmed',
])

export const MOMENT_TYPES = new Set([
  'goal.confirmed',
  'goal.disallowed',
  'card.yellow',
  'card.second_yellow',
  'card.red',
  'penalty.outcome',
  'var.review_started',
])

export type ConnectionStatus = 'loading' | 'connecting' | 'live' | 'reconnecting' | 'error'

export interface InsightEntry {
  update: InsightUpdate
  /** Stages actually received for this candidate, in order. */
  stages: string[]
}

export interface Moment {
  id: string
  event: MatchEvent
}

export interface SessionSnapshot {
  status: ConnectionStatus
  error: string | null
  detail: MatchDetail | null
  sessionId: string | null
  state: MatchState | null
  anchor: PlayheadAnchor | null
  events: readonly MatchEvent[]
  keyEvents: readonly MatchEvent[]
  candidates: readonly PatternCandidate[]
  insights: Readonly<Record<string, InsightEntry>>
  moments: readonly Moment[]
  /** Law-grounded decision cards, in arrival (match) order. */
  decisions: readonly Decision[]
  /** Major decision that just arrived live (not as backfill after a seek). */
  liveDecision: { id: string; at: number } | null
  overlays: Readonly<Record<string, OverlayPacket>>
  /** Persistent storylines by id (latest version), deterministic server state. */
  storylines: Readonly<Record<string, Storyline>>
  /** Tactical moments released so far (deterministic geometry), by id. */
  tactics: Readonly<Record<string, TacticalMoment>>
  /** Prioritised signals (latest version per id). */
  signals: Readonly<Record<string, Signal>>
  /** The newest alert that arrived live (not as backfill after a seek), for the broadcast banner. */
  liveAlert: { id: string; at: number } | null
  recap: Recap | null
  /** Increments on each replay_reset (seek / restart). */
  resetCount: number
  invalidFrames: number
}

export interface MatchSessionOptions {
  matchId?: string
  fetchImpl?: typeof fetch
  EventSourceImpl?: typeof EventSource
  now?: () => number
  log?: (msg: string) => void
}

const STREAM_EVENTS: StreamEventName[] = [
  'match_event',
  'match_state',
  'heartbeat',
  'pattern_candidate',
  'insight_update',
  'replay_reset',
  'decision',
  'overlay_update',
  'recap',
  'storyline_update',
  'tactical_moment',
  'signal',
]

function insertBySeq(list: MatchEvent[], ev: MatchEvent): MatchEvent[] {
  if (list.length === 0 || list[list.length - 1]!.seq < ev.seq) return [...list, ev]
  if (list.some((e) => e.seq === ev.seq)) return list
  return [...list, ev].sort((a, b) => a.seq - b.seq)
}

export class MatchSessionStore {
  private snap: SessionSnapshot
  private listeners = new Set<() => void>()
  private flushTimer: ReturnType<typeof setTimeout> | null = null
  private es: EventSource | null = null
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private attempt = 0
  private running = false
  private generation = 0
  private needsBackfill = true
  /** Local time of the last stream open / reset: frames soon after are backfill. */
  private quietUntil = 0
  private abort = new AbortController()
  private opts: Required<Omit<MatchSessionOptions, 'EventSourceImpl'>> & {
    EventSourceImpl: typeof EventSource | undefined
  }
  tracking: TrackingCache | null = null

  constructor(options: MatchSessionOptions = {}) {
    this.opts = {
      matchId: options.matchId ?? MATCH_ID,
      fetchImpl: options.fetchImpl ?? ((...args) => fetch(...args)),
      EventSourceImpl: options.EventSourceImpl ?? (typeof EventSource === 'undefined' ? undefined : EventSource),
      now: options.now ?? (() => performance.now()),
      log: options.log ?? ((msg) => console.warn(`[byline] ${msg}`)),
    }
    this.snap = MatchSessionStore.empty()
  }

  private static empty(): SessionSnapshot {
    return {
      status: 'loading',
      error: null,
      detail: null,
      sessionId: null,
      state: null,
      anchor: null,
      events: [],
      keyEvents: [],
      candidates: [],
      insights: {},
      moments: [],
      decisions: [],
      liveDecision: null,
      overlays: {},
      storylines: {},
      tactics: {},
      signals: {},
      liveAlert: null,
      recap: null,
      resetCount: 0,
      invalidFrames: 0,
    }
  }

  get matchId(): string {
    return this.opts.matchId
  }

  /** Switch to another synthetic match: new session, clean buffers. */
  switchMatch(matchId: string): void {
    if (matchId === this.opts.matchId) return
    this.stop()
    this.tracking?.dispose()
    this.tracking = null
    this.opts = { ...this.opts, matchId }
    this.attempt = 0
    this.generation += 1
    this.snap = MatchSessionStore.empty()
    this.flush()
    this.start()
  }

  // ------------------------------------------------------------ store API

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  getSnapshot = (): SessionSnapshot => this.snap

  private set(patch: Partial<SessionSnapshot>, immediate = false): void {
    this.snap = { ...this.snap, ...patch }
    if (immediate) {
      this.flush()
      return
    }
    // Coalesce bursts (fast playback streams ~10 events/s) to <= 10 renders/s.
    if (!this.flushTimer) this.flushTimer = setTimeout(() => this.flush(), 100)
  }

  private flush(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer)
      this.flushTimer = null
    }
    for (const fn of this.listeners) fn()
  }

  /** Extrapolated playhead in ms (call from rAF; does not touch React). */
  playhead(now = this.opts.now()): number {
    const a = this.snap.anchor
    return a ? extrapolatePlayhead(a, now) : 0
  }

  get durationMs(): number {
    return this.snap.anchor?.duration_ms ?? this.snap.detail?.duration_ms ?? 0
  }

  // ------------------------------------------------------------ lifecycle

  start(): void {
    if (this.running) return
    this.running = true
    this.abort = new AbortController()
    void this.boot()
  }

  stop(): void {
    this.running = false
    this.abort.abort()
    this.closeStream()
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.reconnectTimer = null
  }

  private async boot(): Promise<void> {
    try {
      if (!this.snap.detail) {
        const detail = await getJson(`/api/matches/${this.opts.matchId}`, MatchDetailSchema, {
          signal: this.abort.signal,
          timeoutMs: 10_000,
          fetchImpl: this.opts.fetchImpl,
        })
        this.tracking?.dispose()
        this.tracking = new TrackingCache({
          entityCount: detail.tracking.entities.length,
          durationMs: detail.duration_ms,
          fetchChunk: (from, to, signal) =>
            getJson(
              `/api/matches/${this.opts.matchId}/tracking?from_ms=${Math.floor(from)}&to_ms=${Math.floor(to)}`,
              TrackingChunkSchema,
              { signal, timeoutMs: 10_000, fetchImpl: this.opts.fetchImpl },
            ),
          onError: (i) => this.opts.log(`tracking chunk ${i} failed; will retry`),
        })
        this.set({ detail }, true)
      }
      if (!this.running) return
      if (!this.snap.sessionId) await this.createSession(0, false, DEFAULT_SPEED)
      if (!this.running) return
      this.openStream()
    } catch (err) {
      if (!this.running) return
      this.set({ status: 'error', error: describeError(err) }, true)
      this.scheduleReconnect()
    }
  }

  private async createSession(seekMs: number, play: boolean, speed: number): Promise<void> {
    const res = await this.post(`/api/matches/${this.opts.matchId}/sessions`, { speed })
    const session = SessionSchema.parse(res)
    this.set(
      {
        sessionId: session.session_id,
        anchor: {
          playhead_ms: seekMs,
          speed: session.speed,
          playing: false,
          duration_ms: session.duration_ms,
          receivedAt: this.opts.now(),
        },
      },
      true,
    )
    if (seekMs > 0) await this.post(`/api/sessions/${session.session_id}/control`, { action: 'seek', elapsed_ms: Math.round(seekMs) })
    if (play) await this.post(`/api/sessions/${session.session_id}/control`, { action: 'play' })
  }

  private openStream(): void {
    const ES = this.opts.EventSourceImpl
    const sid = this.snap.sessionId
    if (!ES || !sid) return
    this.closeStream()
    this.set({ status: this.attempt > 0 ? 'reconnecting' : 'connecting' }, true)
    this.needsBackfill = true
    this.quietUntil = this.opts.now() + 1500
    const es = new ES(`/api/sessions/${sid}/stream`)
    this.es = es
    es.onopen = () => {
      this.attempt = 0
      this.set({ status: 'live', error: null }, true)
    }
    for (const name of STREAM_EVENTS) {
      es.addEventListener(name, (e) => this.handleMessage(name, (e as MessageEvent<string>).data, true))
    }
    es.onerror = () => {
      // EventSource hides the HTTP status; close and run our own recovery.
      if (this.es !== es) return
      this.closeStream()
      if (!this.running) return
      this.set({ status: 'reconnecting' }, true)
      this.scheduleReconnect()
    }
  }

  private closeStream(): void {
    if (this.es) {
      this.es.onerror = null
      this.es.close()
      this.es = null
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer || !this.running) return
    const delay = Math.min(15_000, 1000 * 2 ** Math.min(this.attempt, 4))
    this.attempt += 1
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      void this.recover()
    }, delay)
  }

  /** Reconnect; if the session expired (404) create a new one at the last playhead. */
  private async recover(): Promise<void> {
    if (!this.running) return
    const sid = this.snap.sessionId
    try {
      if (!this.snap.detail || !sid) {
        await this.boot()
        return
      }
      const res = await this.opts.fetchImpl(`/api/sessions/${sid}/state`, { signal: this.abort.signal })
      if (res.status === 404) {
        const anchor = this.snap.anchor
        await this.createSession(this.playhead(), anchor?.playing ?? false, anchor?.speed ?? DEFAULT_SPEED)
      } else if (!res.ok) {
        throw new ApiError('http', `session check returned ${res.status}`, res.status)
      }
      this.openStream()
    } catch (err) {
      if (!this.running) return
      this.set({ status: 'reconnecting', error: describeError(err) }, true)
      this.scheduleReconnect()
    }
  }

  // ------------------------------------------------------------ messages

  /** Validate and apply one stream frame. Invalid payloads are dropped and logged. */
  handleMessage(event: StreamEventName, raw: string, live = false): void {
    const msg = parseStreamMessage(event, raw, (reason) => {
      this.opts.log(`dropped invalid stream payload (${reason})`)
      this.set({ invalidFrames: this.snap.invalidFrames + 1 })
    })
    if (!msg) return
    switch (msg.event) {
      case 'heartbeat': {
        const hb = msg.data
        this.set({
          anchor: {
            playhead_ms: hb.playhead_ms,
            speed: hb.speed,
            playing: hb.playing,
            duration_ms: hb.duration_ms,
            receivedAt: this.opts.now(),
          },
        })
        if (this.needsBackfill) {
          this.needsBackfill = false
          void this.backfill(hb.playhead_ms)
        }
        return
      }
      case 'match_state':
        this.set({ state: msg.data })
        return
      case 'match_event': {
        const ev = msg.data
        const events = insertBySeq(this.snap.events as MatchEvent[], ev)
        const patch: Partial<SessionSnapshot> = {
          events: events.length > EVENT_BUFFER_CAP ? events.slice(-EVENT_BUFFER_CAP) : events,
        }
        if (KEY_EVENT_TYPES.has(ev.type)) {
          patch.keyEvents = insertBySeq(this.snap.keyEvents as MatchEvent[], ev)
          if (live && MOMENT_TYPES.has(ev.type)) {
            patch.moments = [...this.snap.moments.slice(-3), { id: `${ev.event_id}-${this.snap.resetCount}`, event: ev }]
          }
        }
        this.set(patch)
        return
      }
      case 'pattern_candidate': {
        const c = msg.data
        const idx = this.snap.candidates.findIndex((x) => x.candidate_id === c.candidate_id)
        const candidates = [...this.snap.candidates]
        if (idx >= 0) candidates[idx] = c
        else candidates.push(c)
        this.set({ candidates })
        return
      }
      case 'insight_update': {
        const u = msg.data
        const prev = this.snap.insights[u.candidate_id]
        const stages = prev ? [...prev.stages] : []
        if (stages[stages.length - 1] !== u.stage) stages.push(u.stage)
        this.set({ insights: { ...this.snap.insights, [u.candidate_id]: { update: u, stages } } })
        return
      }
      case 'decision': {
        const d = msg.data
        const list = this.snap.decisions.filter((x) => x.decision_id !== d.decision_id)
        const isNew = list.length === this.snap.decisions.length
        const patch: Partial<SessionSnapshot> = { decisions: [...list, d] }
        if (live && isNew && d.importance === 'major' && this.opts.now() > this.quietUntil) {
          patch.liveDecision = { id: d.decision_id, at: this.opts.now() }
        }
        this.set(patch)
        return
      }
      case 'overlay_update': {
        const u = msg.data
        if ('snapshot' in u && Array.isArray(u.snapshot)) {
          this.set({ overlays: Object.fromEntries(u.snapshot.map((p) => [p.id, p])) })
        } else {
          const p = u as OverlayPacket
          this.set({ overlays: { ...this.snap.overlays, [p.id]: p } })
        }
        return
      }
      case 'recap':
        this.set({ recap: msg.data })
        return
      case 'tactical_moment': {
        const m = msg.data
        this.set({ tactics: { ...this.snap.tactics, [m.moment_id]: m } })
        return
      }
      case 'signal': {
        const s = msg.data
        const prev = this.snap.signals[s.signal_id]
        if (prev && prev.version > s.version) return
        const patch: Partial<SessionSnapshot> = { signals: { ...this.snap.signals, [s.signal_id]: s } }
        const changedTier = !prev || prev.status !== s.status || prev.headline !== s.headline
        if (live && s.tier === 'alert' && changedTier && this.opts.now() > this.quietUntil) {
          patch.liveAlert = { id: s.signal_id, at: this.opts.now() }
        }
        this.set(patch)
        return
      }
      case 'storyline_update': {
        const sl = msg.data
        const prev = this.snap.storylines[sl.storyline_id]
        if (prev && prev.version > sl.version) return
        this.set({ storylines: { ...this.snap.storylines, [sl.storyline_id]: sl } })
        return
      }
      case 'replay_reset': {
        const r = msg.data
        this.generation += 1
        this.quietUntil = this.opts.now() + 1500
        const keepCandidates = this.snap.candidates.filter((c) => c.detected_at_ms <= r.playhead_ms)
        // The server re-sends insight updates for re-derived candidates just
        // before replay_reset, so filter by time rather than by known candidates.
        const insights = Object.fromEntries(
          Object.entries(this.snap.insights).filter(([, e]) => e.update.detected_at_ms <= r.playhead_ms),
        )
        this.set(
          {
            events: [],
            keyEvents: [],
            moments: [],
            decisions: [],
            liveDecision: null,
            overlays: {},
            storylines: {},
            tactics: {},
            signals: {},
            liveAlert: null,
            recap: null,
            candidates: keepCandidates,
            insights,
            resetCount: this.snap.resetCount + 1,
            anchor: this.snap.anchor
              ? { ...this.snap.anchor, playhead_ms: r.playhead_ms, receivedAt: this.opts.now() }
              : null,
          },
          true,
        )
        this.tracking?.ensure(r.playhead_ms)
        void this.backfill(r.playhead_ms)
        return
      }
    }
  }

  /** REST backfill of events up to the playhead (after connect / seek). */
  private async backfill(uptoMs: number): Promise<void> {
    const gen = this.generation
    let after = -1
    const collected: MatchEvent[] = []
    try {
      for (let page = 0; page < 5; page += 1) {
        const res = await getJson(
          `/api/matches/${this.opts.matchId}/events?after_seq=${after}&limit=2000&upto_ms=${Math.floor(uptoMs)}`,
          EventsPageSchema,
          { signal: this.abort.signal, timeoutMs: 10_000, fetchImpl: this.opts.fetchImpl },
        )
        collected.push(...res.events)
        if (res.events.length < 2000) break
        after = res.last_seq
      }
    } catch (err) {
      this.opts.log(`event backfill failed: ${describeError(err)}`)
      return
    }
    if (gen !== this.generation) return
    let events = this.snap.events as MatchEvent[]
    let keyEvents = this.snap.keyEvents as MatchEvent[]
    const tail = collected.slice(-EVENT_BUFFER_CAP)
    for (const ev of tail) events = insertBySeq(events, ev)
    for (const ev of collected) if (KEY_EVENT_TYPES.has(ev.type)) keyEvents = insertBySeq(keyEvents, ev)
    this.set({ events: events.slice(-EVENT_BUFFER_CAP), keyEvents })
  }

  // ------------------------------------------------------------ controls

  private async post(path: string, body: unknown): Promise<unknown> {
    const res = await this.opts.fetchImpl(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
      signal: this.abort.signal,
    })
    if (!res.ok) throw new ApiError('http', `${path} returned ${res.status}`, res.status)
    return res.json()
  }

  /**
   * Controls go to the server strictly in order, one at a time: "Back to match" sends seek, speed and pause in
   * quick succession, and parallel requests could arrive (or answer) out of order, leaving a paused match playing.
   */
  private controlChain: Promise<void> = Promise.resolve()

  private control(body: Record<string, unknown>): Promise<void> {
    const run = () => this.sendControl(body)
    const next = this.controlChain.then(run, run)
    this.controlChain = next.catch(() => {})
    return next
  }

  private async sendControl(body: Record<string, unknown>): Promise<void> {
    const sid = this.snap.sessionId
    if (!sid) return
    try {
      const hb = HeartbeatSchema.safeParse(await this.post(`/api/sessions/${sid}/control`, body))
      if (hb.success) {
        this.set(
          {
            anchor: {
              playhead_ms: hb.data.playhead_ms,
              speed: hb.data.speed,
              playing: hb.data.playing,
              duration_ms: hb.data.duration_ms,
              receivedAt: this.opts.now(),
            },
          },
          true,
        )
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        // Session expired: rebuild at the intended position, then retry.
        const a = this.snap.anchor
        this.closeStream()
        await this.createSession(this.playhead(), false, a?.speed ?? DEFAULT_SPEED)
        this.openStream()
        await this.sendControl(body)
        return
      }
      this.opts.log(`control ${String(body.action)} failed: ${describeError(err)}`)
    }
  }

  /** Optimistic local update so the UI responds before the server echoes. */
  private optimistic(patch: Partial<PlayheadAnchor>): void {
    const a = this.snap.anchor
    if (!a) return
    const now = this.opts.now()
    this.set({ anchor: { ...a, playhead_ms: extrapolatePlayhead(a, now), receivedAt: now, ...patch } }, true)
  }

  play(): void {
    this.optimistic({ playing: true })
    void this.control({ action: 'play' })
  }

  pause(): void {
    this.optimistic({ playing: false })
    void this.control({ action: 'pause' })
  }

  togglePlay(): void {
    if (this.snap.anchor?.playing) this.pause()
    else this.play()
  }

  setSpeed(speed: number): void {
    this.optimistic({ speed })
    void this.control({ action: 'speed', speed })
  }

  seek(ms: number): void {
    const target = Math.max(0, Math.min(this.durationMs || ms, Math.round(ms)))
    this.optimistic({ playhead_ms: target })
    this.tracking?.ensure(target)
    void this.control({ action: 'seek', elapsed_ms: target })
  }

  async restart(): Promise<void> {
    this.optimistic({ playhead_ms: 0, playing: false })
    await this.control({ action: 'reset' })
    this.play()
  }

  /** Studio desk action. Returns an error message on refusal (e.g. 409), else null. */
  async overlayAction(
    id: string,
    action: 'approve' | 'reject' | 'hide',
    cue: { cue: 'now' | 'next_stoppage' | 'delay'; delayMs?: number; durationMs?: number | null } = { cue: 'now' },
  ): Promise<string | null> {
    const sid = this.snap.sessionId
    if (!sid) return 'No active session'
    const params = new URLSearchParams()
    if (action === 'approve' && cue.cue !== 'now') params.set('cue', cue.cue)
    if (action === 'approve' && cue.cue === 'delay') params.set('delay_ms', String(cue.delayMs ?? 30_000))
    // no duration = on air until the producer takes it off
    if (action === 'approve' && cue.durationMs) params.set('duration_ms', String(cue.durationMs))
    const q = params.size ? `?${params.toString()}` : ''
    try {
      const res = await this.opts.fetchImpl(`/api/sessions/${sid}/overlays/${encodeURIComponent(id)}/${action}${q}`, {
        method: 'POST',
        headers: { Accept: 'application/json' },
        signal: this.abort.signal,
      })
      if (res.status === 409) return 'This graphic can no longer be changed.'
      if (!res.ok) return 'The studio desk did not accept that action. Please try again.'
      const body: unknown = await res.json().catch(() => null)
      const parsed = OverlayPacketSchema.safeParse(body)
      if (parsed.success) this.set({ overlays: { ...this.snap.overlays, [parsed.data.id]: parsed.data } }, true)
      return null
    } catch {
      return 'The studio desk is temporarily unavailable.'
    }
  }

  /** A producer asks for a graphic from the analysis desk (still needs approval to air). */
  async proposeGraphic(kind: 'tactical' | 'context' | 'stats', ref?: string): Promise<{ id: string | null; message: string }> {
    const sid = this.snap.sessionId
    if (!sid) return { id: null, message: 'No active session' }
    try {
      const res = await this.opts.fetchImpl(`/api/sessions/${sid}/overlays/propose`, {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind, ref: ref ?? null }),
        signal: this.abort.signal,
      })
      if (res.status === 404) return { id: null, message: 'That has not happened yet at this point of the match.' }
      if (res.status === 409) return { id: null, message: 'Withdrawn after an official correction, so it cannot be proposed.' }
      if (!res.ok) return { id: null, message: 'The production desk did not accept that request.' }
      const body = (await res.json().catch(() => null)) as { already_queued?: boolean } | null
      const parsed = OverlayPacketSchema.safeParse(body)
      if (!parsed.success) return { id: null, message: 'The production desk sent an unexpected reply.' }
      this.set({ overlays: { ...this.snap.overlays, [parsed.data.id]: parsed.data } }, true)
      return { id: parsed.data.id, message: body?.already_queued ? 'Already in the production queue.' : 'Sent to the production queue for approval.' }
    } catch {
      return { id: null, message: 'The production desk is temporarily unavailable.' }
    }
  }

  dismissLiveDecision(): void {
    this.set({ liveDecision: null })
  }

  dismissLiveAlert(): void {
    this.set({ liveAlert: null })
  }

  dismissMoment(id: string): void {
    this.set({ moments: this.snap.moments.filter((m) => m.id !== id) })
  }
}

function describeError(err: unknown): string {
  if (err instanceof ApiError) return err.kind === 'http' ? `HTTP ${err.status ?? ''}`.trim() : err.kind
  return err instanceof Error ? err.name : 'unknown'
}

export const matchSession = new MatchSessionStore()

export function useMatchSession(store: MatchSessionStore = matchSession): SessionSnapshot {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
}
