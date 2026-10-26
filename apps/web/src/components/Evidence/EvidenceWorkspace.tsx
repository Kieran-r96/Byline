import { useEffect, useRef, useState } from 'react'
import { buildHighlight, loadEvidence, loadRunnerPath, loadTrace, metricChips, replayPlan, runnerId } from '../../services/evidence'
import type { EvidenceBundle } from '../../services/evidence'
import type { InsightEntry } from '../../services/matchSession'
import {
  categoryLabel,
  eventWords,
  insightText,
  isDetectorOnly,
  matchClock,
  isRetracted,
  pendingTitle,
  playerLabel,
  retractionReason,
  sanitiseIssue,
  teamName,
} from '../../services/matchView'
import type { WorldIndex } from '../../services/matchView'
import { usePrefs } from '../../services/prefs'
import { payloadString } from '../../services/schemas'
import type { AgentTrace, MatchDetail, MatchEvent, PatternCandidate } from '../../services/schemas'
import type { HighlightSpec } from '../MatchTheatre/renderer'
import { Icon } from '../icons/Icon'
import { StagePill } from '../StoryRadar/StoryRadar'
import { AgentRun } from './AgentRun'
import './EvidenceWorkspace.css'

export interface EvidenceWorkspaceProps {
  candidate: PatternCandidate
  entry: InsightEntry | undefined
  world: WorldIndex
  detail: MatchDetail | null
  matchId: string
  sessionId?: string | null
  onClose: () => void
  onSeek: (ms: number) => void
  onHighlight: (spec: HighlightSpec | null) => void
  /** Mobile: hide the dialog but keep the pitch overlay. */
  onViewOnPitch?: () => void
  closeLabel?: string
  /** Play the evidence window (from, to, speed) and pause at the end. */
  onReplay?: (fromMs: number, toMs: number, speed: number) => void
  onStopReplay?: () => void
  replaying?: boolean
}

type Load<T> = { status: 'loading' } | { status: 'ready'; data: T } | { status: 'error' }

/** Broadcast clock (the score bug's clock), not raw elapsed time, so evidence and score bug agree. */
function clockOf(ev: MatchEvent, detail: MatchDetail | null): string {
  return matchClock(ev.elapsed_ms, detail, null)
}

function eventPeople(ev: MatchEvent, world: WorldIndex): string {
  const who = playerLabel(world, ev.player_id)
  const to = payloadString(ev, 'receiver_player_id')
  const toLabel = to ? playerLabel(world, to) : null
  if (who && toLabel) return `${who} to ${toLabel}`
  return who ?? teamName(world, ev.team_id)
}

function ms(v: number | null | undefined): string {
  if (v === null || v === undefined) return 'n/a'
  return v >= 1000 ? `${(v / 1000).toFixed(1)} s` : `${Math.round(v)} ms`
}

const EVENTS_SHOWN = 5

/**
 * Evidence workspace: what we know, the exact source events, verification,
 * what we cannot establish and the agent trace. Opening it lights up the
 * pitch overlay (numbered source actions + channel band / runner path).
 */
export function EvidenceWorkspace({
  candidate,
  entry,
  world,
  detail,
  matchId,
  sessionId = null,
  onClose,
  onSeek,
  onReplay,
  onStopReplay,
  replaying = false,
  onHighlight,
  onViewOnPitch,
  closeLabel = 'Back to stories',
}: EvidenceWorkspaceProps) {
  const insight = entry?.update.insight ?? null
  const [bundle, setBundle] = useState<Load<EvidenceBundle>>({ status: 'loading' })
  const [trace, setTrace] = useState<Load<AgentTrace | null>>({ status: 'loading' })
  const [nonce, setNonce] = useState(0)
  const [allEvents, setAllEvents] = useState(false)
  const backRef = useRef<HTMLButtonElement>(null)
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  // Move focus into the workspace when it opens; Escape closes it (unless a
  // drawer or the recap is layered above it and handles Escape itself).
  useEffect(() => {
    backRef.current?.focus({ preventScroll: true })
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      if (document.querySelector('.drawer[data-open="true"] [aria-modal="true"], .recap')) return
      onCloseRef.current()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])
  const cid = candidate.candidate_id

  useEffect(() => {
    const ctrl = new AbortController()
    loadEvidence(candidate, insight, matchId, ctrl.signal, sessionId)
      .then(async (b) => {
        if (ctrl.signal.aborted) return
        setBundle({ status: 'ready', data: b })
        onHighlight(buildHighlight(b.evidence.candidate, b.evidence.events))
        if (detail && b.evidence.candidate.frame_intervals.length) {
          const path = await loadRunnerPath(b.evidence.candidate, b.evidence.events, detail, matchId, ctrl.signal).catch(
            () => null,
          )
          if (!ctrl.signal.aborted && path) onHighlight(buildHighlight(b.evidence.candidate, b.evidence.events, path))
        }
      })
      .catch(() => {
        if (!ctrl.signal.aborted) setBundle({ status: 'error' })
      })
    loadTrace(cid, ctrl.signal)
      .then((t) => !ctrl.signal.aborted && setTrace({ status: 'ready', data: t }))
      .catch(() => !ctrl.signal.aborted && setTrace({ status: 'error' }))
    return () => ctrl.abort()
    // Reload when the candidate, its insight version or a retry changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cid, insight?.version, insight?.status, nonce, matchId, detail, sessionId])

  const ev = bundle.status === 'ready' ? bundle.data.evidence : null
  const shownInsight = ev?.insight ?? insight
  const { lang } = usePrefs()
  const tTitle = insightText(shownInsight, 'title', lang)
  const tClaim = insightText(shownInsight, 'canonical_claim', lang)
  const events = ev ? [...ev.events].sort((a, b) => a.elapsed_ms - b.elapsed_ms || a.seq - b.seq) : []
  const highlight = ev ? buildHighlight(ev.candidate, ev.events) : null
  const numbered = new Map<string, number>(highlight?.segments.map((seg) => [seg.eventId, seg.n]) ?? [])
  const metrics = (shownInsight?.metric_provenance ?? candidate.calculated_metrics) as Record<string, unknown>
  const chips = metricChips(metrics)
  const retracted = isRetracted(candidate, entry)
  const reason = retractionReason(candidate, entry)
  const detectorOnly = isDetectorOnly(entry)
  const unsupported = candidate.unsupported_claims.length
    ? candidate.unsupported_claims
    : (shownInsight?.uncertainty ?? '')
        .split(/;\s+/)
        .map((s) => s.trim())
        .filter(Boolean)
  const runner = runnerId(candidate, events)
  const summary = entry?.update.trace_summary ?? null
  const verification = shownInsight?.verification
  const plan = replayPlan(candidate, events)
  const shownEvents = allEvents ? events : events.slice(0, EVENTS_SHOWN)
  const aiVerified = !detectorOnly && shownInsight?.status === 'verified'

  return (
    <div className="evidence" data-retracted={retracted}>
      <div className="evidence__head">
        <button ref={backRef} type="button" className="evidence__back" onClick={onClose}>
          <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M14.5 6 8.5 12l6 6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          {closeLabel}
        </button>
        {onViewOnPitch && (
          <button type="button" className="evidence__pitch" onClick={onViewOnPitch}>
            <Icon name="match" size={18} />
            View on pitch
          </button>
        )}
      </div>

      <div className="evidence__scroll">
        <div className="evidence__title-block">
          <p className="label">
            Evidence · {categoryLabel(candidate)} · <span className="numeric evidence__clock">{candidate.display_clock}</span>
          </p>
          <h2 className="evidence__title" lang={tTitle.translated ? 'es' : 'en'}>
            {tTitle.text ?? pendingTitle(candidate)}
          </h2>
          <StagePill entry={entry} candidate={candidate} />
        </div>

        {onReplay && plan && (
          <div className="evidence__replay">
            <button
              type="button"
              className="evidence__replay-btn"
              data-active={replaying}
              onClick={() => (replaying ? onStopReplay?.() : onReplay(plan.from, plan.to, plan.speed))}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
                {replaying ? (
                  <path d="M4 3h3v10H4zM9 3h3v10H9z" fill="currentColor" />
                ) : (
                  <path d="M4.5 2.8v10.4L13 8z" fill="currentColor" />
                )}
              </svg>
              {replaying ? 'Stop replay' : 'Replay evidence'}
            </button>
            <span className="evidence__replay-meta numeric">
              {matchClock(plan.from, detail, null)} to {matchClock(plan.to, detail, null)} · {plan.speed}× ·{' '}
              {events.length} source action{events.length === 1 ? '' : 's'} on the pitch
            </span>
          </div>
        )}

        {retracted && (
          <div className="evidence__retraction" role="note">
            <strong>Withdrawn{reason ? ` · ${reason.replace(/[.\s]+$/, '')}` : ''}</strong>
            <span>The story is kept for the record but is no longer offered for broadcast.</span>
          </div>
        )}

        <section className="evidence__section" aria-labelledby={`${cid}-know`}>
          <h3 id={`${cid}-know`} className="evidence__h">
            What we know
          </h3>
          <p className="evidence__prov" data-ai={aiVerified}>
            {aiVerified
              ? 'Verified story · Foundry agents, independent verifier and rule check'
              : 'Detector summary · measured, not AI-reviewed'}
          </p>
          <p className="evidence__claim" lang={tClaim.translated ? 'es' : 'en'}>
            {tClaim.text ?? candidate.factual_summary}
          </p>
          {lang === 'es' && (
            <p className="evidence__source" lang="es">
              {tClaim.translated || tTitle.translated
                ? 'Traducción automática · el inglés es la versión de referencia'
                : 'Solo en inglés'}
            </p>
          )}
          {chips.length > 0 && (
            <ul className="evidence__chips" aria-label="Calculated metrics">
              {chips.map((c) => (
                <li key={c.label}>
                  <span>{c.label}</span>
                  <strong className="numeric">{c.value}</strong>
                </li>
              ))}
            </ul>
          )}
          <p className="evidence__source">
            Numbers calculated by the deterministic detector from the synthetic event log
            {candidate.frame_intervals.length ? ' and 2 Hz tracking frames' : ''}.
          </p>
        </section>

        <section className="evidence__section" aria-labelledby={`${cid}-events`}>
          <h3 id={`${cid}-events`} className="evidence__h">
            Source events
            {events.length > 0 && <span className="evidence__count">{events.length}</span>}
          </h3>
          {bundle.status === 'loading' && (
            <div className="evidence__skeleton" aria-label="Loading source events">
              <span />
              <span />
              <span />
            </div>
          )}
          {bundle.status === 'error' && (
            <div className="evidence__error" role="status">
              <p>Evidence is temporarily unavailable. Match events remain available.</p>
              <button type="button" onClick={() => setNonce((n) => n + 1)}>
                Try again
              </button>
            </div>
          )}
          {bundle.status === 'ready' && (
            <>
              <ol className="evidence__events">
                {shownEvents.map((e) => {
                  const n = numbered.get(e.event_id)
                  return (
                    <li key={e.event_id}>
                      <button
                        type="button"
                        className="evidence__event"
                        onClick={() => onSeek(Math.max(0, e.elapsed_ms - 3000))}
                      >
                        <span className="evidence__num" data-has={n !== undefined} aria-hidden="true">
                          {n ?? ''}
                        </span>
                        <span className="evidence__time numeric">{clockOf(e, detail)}</span>
                        <span className="evidence__what">
                          <strong>{eventWords(e.type)}</strong>
                          <span>{eventPeople(e, world)}</span>
                        </span>
                        <span className="evidence__id">{e.event_id}</span>
                        <span className="sr-only">. Replay from 3 seconds before</span>
                      </button>
                    </li>
                  )
                })}
              </ol>
              {events.length > EVENTS_SHOWN && (
                <button type="button" className="evidence__more" aria-expanded={allEvents} onClick={() => setAllEvents((v) => !v)}>
                  {allEvents ? 'Show fewer' : `Show all ${events.length} source events`}
                </button>
              )}
              {runner && (
                <p className="evidence__source">
                  Teal path on the pitch: {playerLabel(world, runner)} from tracking frames, {candidate.display_clock}.
                </p>
              )}
              {bundle.data.source === 'event_log' && (
                <p className="evidence__source">Rebuilt from the immutable event log for this candidate.</p>
              )}
              <p className="evidence__hint">Select an event to replay from 3 seconds before it.</p>
            </>
          )}
        </section>

        <section className="evidence__section" aria-labelledby={`${cid}-verify`}>
          <h3 id={`${cid}-verify`} className="evidence__h">
            Verification
          </h3>
          {verification ? (
            <dl className="evidence__dl">
              <div>
                <dt>Verdict</dt>
                <dd>{detectorOnly ? 'Not reviewed by AI' : verification.verdict.replace(/_/g, ' ')}</dd>
              </div>
              <div>
                <dt>Checker</dt>
                <dd>{detectorOnly ? 'Deterministic detector only' : verification.checker_name}</dd>
              </div>
              {verification.issues.length > 0 && (
                <div>
                  <dt>Notes</dt>
                  <dd>
                    <ul className="evidence__issues">
                      {[...new Set(verification.issues.map(sanitiseIssue))].map((i) => (
                        <li key={i}>{i}</li>
                      ))}
                    </ul>
                  </dd>
                </div>
              )}
            </dl>
          ) : (
            <p className="evidence__muted">Waiting for the agent workflow. No verdict yet.</p>
          )}
        </section>

        <section className="evidence__section evidence__section--quiet" aria-labelledby={`${cid}-cannot`}>
          <h3 id={`${cid}-cannot`} className="evidence__h evidence__h--quiet">
            What we cannot establish
          </h3>
          {unsupported.length ? (
            <ul className="evidence__cannot">
              {unsupported.map((u) => (
                <li key={u}>{u}</li>
              ))}
            </ul>
          ) : (
            <p className="evidence__muted">No limitations recorded for this candidate.</p>
          )}
        </section>

        <section className="evidence__section" aria-labelledby={`${cid}-trace`}>
          <h3 id={`${cid}-trace`} className="evidence__h">
            How the AI checked it
          </h3>
          {trace.status === 'loading' && <p className="evidence__muted">Checking for an AI run…</p>}
          {trace.status === 'error' && <p className="evidence__muted">Trace temporarily unavailable.</p>}
          {trace.status === 'ready' && trace.data && <AgentRun trace={trace.data} insight={shownInsight} />}
          {trace.status === 'ready' && !trace.data && (
            <div className="evidence__noai">
              <strong>No AI run: detector summary.</strong>
              <span>
                {summary && summary.model_calls === 0 && summary.agents.length
                  ? `The ${summary.agents.join(', ')} step started but made no model calls (${ms(summary.latency_ms)}).`
                  : entry?.update.provider === 'off'
                    ? 'AI is switched off for this demo run, so no model was called.'
                    : 'No agent trace is stored for this story.'}
              </span>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
