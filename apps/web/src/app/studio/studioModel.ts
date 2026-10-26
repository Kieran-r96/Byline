import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { fillGraphic, teamKits } from '../../components/Broadcast/fill'
import type { Filled } from '../../components/Broadcast/fill'
import type { BugData } from '../../components/Broadcast/Graphic'
import type { FormatId } from '../../components/Broadcast/templates'
import { factCheck } from '../../components/Studio/factCheck'
import type { MatchSessionStore, SessionSnapshot } from '../../services/matchSession'
import { matchClock, scoreDisplay } from '../../services/matchView'
import type { WorldIndex } from '../../services/matchView'
import type { OverlayPacket } from '../../services/schemas'
import { useMomentView } from '../../services/useMomentView'

export type LaneKey = 'air' | 'next' | 'held' | 'review' | 'withdrawn'
export type Lane = { key: LaneKey; title: string; match: (p: OverlayPacket) => boolean; empty?: string }

export const LANES: Lane[] = [
  { key: 'air', title: 'On air', match: (p) => p.status === 'on_screen' },
  { key: 'next', title: 'Scheduled', match: (p) => p.status === 'approved' },
  { key: 'held', title: 'Held by VAR', match: (p) => p.status === 'proposed' && !!p.on_hold },
  { key: 'review', title: 'For review', match: (p) => p.status === 'proposed' && !p.on_hold, empty: 'Nothing waiting. Goals, substitutions, records and verified tactics arrive here.' },
  { key: 'withdrawn', title: 'Withdrawn after a correction', match: (p) => p.status === 'retracted' },
]
export const DONE = new Set(['expired', 'rejected', 'hidden'])

/** The air state of a graphic in a few words (never the withdrawal reason itself: that is shown once, in the inspector). */
export function statusLine(p: OverlayPacket, minuteOf: (ms: number) => string): string {
  // a withdrawal outranks a hold: a goal disallowed after its VAR check is withdrawn, not still held
  if (p.status === 'retracted') return 'Cannot air: its source was withdrawn'
  if (p.on_hold) return 'Held until the VAR decision'
  switch (p.status) {
    case 'proposed':
      return p.origin === 'producer' ? 'Requested from the analysis desk' : 'Proposed by BYLINE'
    case 'approved':
      return p.cue === 'next_stoppage' && p.display_from_ms == null ? 'Airs at the next stoppage' : p.display_from_ms != null ? `Airs at ${minuteOf(p.display_from_ms)}` : 'Approved'
    case 'on_screen':
      return 'On air now'
    case 'expired':
      return p.status_reason ?? 'Expired'
    case 'rejected':
      return 'Rejected by the producer'
    default:
      return 'Taken off air'
  }
}

/**
 * Why a graphic cannot be taken to air, or null when the producer may approve it. A VAR hold and a
 * withdrawal after an official correction can never be overridden from the desk (the backend refuses too).
 */
export function airBlock(p: OverlayPacket): string | null {
  if (p.status === 'retracted') return 'Withdrawn after an official correction: it cannot air.'
  if (p.on_hold) return 'Held by VAR: a goal graphic cannot air until the goal is confirmed.'
  if (p.status !== 'proposed') return 'Only a graphic waiting for review can be approved.'
  return null
}

/** The graphic the programme shows: on air and neither held by VAR nor withdrawn. */
export function programmePacket(packets: readonly OverlayPacket[]): OverlayPacket | null {
  return packets.find((p) => p.status === 'on_screen' && !p.on_hold) ?? null
}

/** A graphic a VAR check or an official correction has invalidated: if it is leaving the programme it is cut, never mixed out. */
export function invalidated(p: OverlayPacket | undefined | null): boolean {
  return !!p && (p.status === 'retracted' || !!p.on_hold)
}

/** The most recent graphic a VAR check or a correction pulled off air (shown on the programme transport). */
export function lastCut(packets: readonly OverlayPacket[]): OverlayPacket | null {
  return packets.find((p) => (p.status === 'hidden' && p.on_hold) || (p.status === 'retracted' && p.display_from_ms != null)) ?? null
}

/** Fill a packet's graphic from the verified data in the session (and the moment's frame for tactics). */
export function useFill(packet: OverlayPacket | null, snap: SessionSnapshot, world: WorldIndex, matchId: string, minuteOf: (ms: number) => string): Filled | null {
  const tactical = packet?.template_id === 'tactical_moment' ? packet.source_id : null
  const { view } = useMomentView(matchId, tactical)
  const foundry = packet ? factCheck(packet, snap.insights).ai : false
  return useMemo(
    () => (packet ? fillGraphic(packet, { world, events: snap.keyEvents, decisions: snap.decisions, tactics: snap.tactics, view, foundryVerified: foundry, minuteOf }) : null),
    [packet, world, snap.keyEvents, snap.decisions, snap.tactics, view, foundry, minuteOf],
  )
}

/**
 * Keep a graphic on screen while it plays its exit. A new graphic enters at once; when the current one
 * leaves (taken off air, expired, replaced) it is held for `exitMs` with phase 'out'.
 */
export function usePresence<T extends { id: string }>(item: T | null, exitMs: number): { current: T | null; phase: 'in' | 'out' } {
  const [shown, setShown] = useState<T | null>(item)
  const id = item?.id ?? null
  const leaving = shown !== null && shown.id !== id
  useEffect(() => {
    if ((shown?.id ?? null) === id) return undefined
    const t = window.setTimeout(() => setShown(item), leaving ? exitMs : 0)
    return () => window.clearTimeout(t)
  }, [id, item, shown, leaving, exitMs])
  return leaving ? { current: shown, phase: 'out' } : { current: item, phase: 'in' }
}

const reducedQuery = () => (typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-reduced-motion: reduce)') : null)
const subscribeReduced = (cb: () => void) => {
  const q = reducedQuery()
  q?.addEventListener('change', cb)
  return () => q?.removeEventListener('change', cb)
}
export const useReducedMotion = () => useSyncExternalStore(subscribeReduced, () => reducedQuery()?.matches ?? false, () => false)

/** True while a modal (research, recap, the analysis layer) makes the surface inert: monitors then drop their WebGL clips. */
const subscribeInert = (cb: () => void) => {
  const el = typeof document !== 'undefined' ? document.getElementById('surface') : null
  if (!el) return () => {}
  const mo = new MutationObserver(cb)
  mo.observe(el, { attributes: true, attributeFilter: ['inert'] })
  return () => mo.disconnect()
}
export const useSurfaceInert = () => useSyncExternalStore(subscribeInert, () => document.getElementById('surface')?.hasAttribute('inert') ?? false, () => false)

/** The programme bug's clock, ticking with the replay. */
export function useMatchClock(store: MatchSessionStore, snap: SessionSnapshot): string {
  const read = () => (typeof store.playhead === 'function' ? matchClock(store.playhead(), snap.detail, snap.state) : '')
  const [clock, setClock] = useState(read)
  useEffect(() => {
    const tick = () => setClock(typeof store.playhead === 'function' ? matchClock(store.playhead(), snap.detail, snap.state) : '')
    const t = window.setInterval(tick, 500)
    return () => window.clearInterval(t)
  }, [store, snap.detail, snap.state])
  return clock
}

/** Match time a graphic has been on air, as a share of its display window. */
export function useOnAirShare(store: MatchSessionStore, p: OverlayPacket | null): number {
  const read = () => {
    if (!p || p.display_from_ms == null || p.display_for_ms == null || typeof store.playhead !== 'function') return 0
    const span = p.display_for_ms
    return Math.max(0, Math.min(1, (store.playhead() - p.display_from_ms) / span))
  }
  const [share, setShare] = useState(read)
  useEffect(() => {
    if (!p) return undefined
    const tick = () => {
      if (p.display_from_ms == null || p.display_for_ms == null || typeof store.playhead !== 'function') return
      const span = p.display_for_ms
      setShare(Math.max(0, Math.min(1, (store.playhead() - p.display_from_ms) / span)))
    }
    const t = window.setInterval(tick, 200)
    return () => window.clearInterval(t)
  }, [store, p])
  return share
}

export function bugData(snap: SessionSnapshot, world: WorldIndex, clock: string): BugData {
  const sc = scoreDisplay(snap.state, world.homeId, world.awayId)
  return { ...teamKits(world), score: { home: sc.home, away: sc.away, checking: sc.checking }, clock, varReview: sc.varReview }
}

// ---------------------------------------------------------------- analysis-desk packages

export type PackagePhase = 'pre' | 'ht' | 'ft'

export interface PackageItem {
  key: string
  kind: 'tactical' | 'context' | 'stats'
  ref?: string
  title: string
  sent?: string
  /** The production packet it became, once sent. */
  packetId?: string
  /** The layout the analyst picked for it (carried to the production preview when sent). */
  format?: FormatId
}

/** One running order per programme segment: pre-match, half-time and full-time are built separately. */
export type Packages = Record<PackagePhase, PackageItem[]>
export const EMPTY_PACKAGES: Packages = { pre: [], ht: [], ft: [] }

/** Move an item one place up (-1) or down (+1) in the running order; out of range is a no-op. */
export function moveItem<T>(list: readonly T[], index: number, by: -1 | 1): T[] {
  const to = index + by
  if (index < 0 || index >= list.length || to < 0 || to >= list.length) return [...list]
  const out = [...list]
  const [it] = out.splice(index, 1)
  out.splice(to, 0, it as T)
  return out
}

const STAT_ROWS: Array<[string, string]> = [
  ['shots', 'Shots'],
  ['shots_on_target', 'On target'],
  ['corners', 'Corners'],
  ['fouls', 'Fouls'],
  ['offsides', 'Offsides'],
  ['passes_completed', 'Passes completed'],
]

/**
 * A package item as a draft graphic, for its preview before it is sent. It is filled from the same session
 * data the production desk uses (the measured moment, the history signal, the official counts so far);
 * once sent, the production desk's own packet replaces it.
 */
export function draftPacket(item: PackageItem, snap: SessionSnapshot, world: WorldIndex): OverlayPacket | null {
  const base = { id: `draft-${item.key}`, version: 1, status: 'proposed' as const, player_ids: [] as string[], source_event_ids: [] as string[], origin: 'producer' as const }
  if (item.kind === 'tactical' && item.ref) {
    const m = snap.tactics[item.ref]
    if (!m) return null
    return { ...base, source_kind: 'tactical', source_id: m.moment_id, template_id: 'tactical_moment', match_elapsed_ms: m.at_ms, title: m.title, subtitle: m.summary, team_id: m.team_id, player_ids: m.focus_player_ids, source_event_ids: m.evidence_event_ids }
  }
  if (item.kind === 'context' && item.ref) {
    const s = snap.signals[item.ref]
    if (!s) return null
    const pid = typeof s.refs.player_id === 'string' && world.players.has(s.refs.player_id) ? s.refs.player_id : null
    const title = s.headline === s.headline.toUpperCase() && !s.headline.trim().includes(' ') ? s.headline.charAt(0) + s.headline.slice(1).toLowerCase() : s.headline
    return {
      ...base,
      source_kind: 'context',
      source_id: s.signal_id,
      template_id: 'player_record',
      match_elapsed_ms: s.at_ms,
      title,
      subtitle: s.text.studio ?? s.headline,
      team_id: s.team_id ?? null,
      player_ids: pid ? [pid] : [],
      source_event_ids: s.evidence_event_ids,
      data: { kind: s.kind, rule: typeof s.refs.rule === 'string' ? s.refs.rule : '' },
    }
  }
  if (item.kind === 'stats') {
    const stats = snap.state?.stats ?? {}
    const sc = scoreDisplay(snap.state, world.homeId, world.awayId)
    const label = snap.state?.finished ? 'Full-time' : 'Match stats'
    const home = world.teams.get(world.homeId)?.short_name ?? world.homeId
    const away = world.teams.get(world.awayId)?.short_name ?? world.awayId
    const rows = STAT_ROWS.map(([key, lab]) => ({ key, label: lab, home: Number(stats[world.homeId]?.[key] ?? 0), away: Number(stats[world.awayId]?.[key] ?? 0) }))
    return { ...base, source_kind: 'stats', source_id: `draft-stats`, template_id: 'stat_comparison', match_elapsed_ms: snap.state?.playhead_ms ?? 0, title: `${label.toUpperCase()} · ${home} ${sc.home}–${sc.away} ${away}`, subtitle: 'Counted from the official match events', team_id: null, data: { label, rows } }
  }
  return null
}
