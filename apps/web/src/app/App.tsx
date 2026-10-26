import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Wordmark } from '../components/brand/Wordmark'
import { Drawer } from '../components/Drawer/Drawer'
import { EvidenceWorkspace } from '../components/Evidence/EvidenceWorkspace'
import { MatchTheatre } from '../components/MatchTheatre/MatchTheatre'
import type { HighlightLegend } from '../components/MatchTheatre/MatchTheatre'
import type { HighlightSpec } from '../components/MatchTheatre/renderer'
import { RecapView } from '../components/Recap/Recap'
import { ResearchPanel } from '../components/Research/ResearchPanel'
import type { ResearchSubject } from '../components/Research/ResearchPanel'
import { RoleSwitch } from '../components/RoleSwitch/RoleSwitch'
import { ServiceBanner } from '../components/ServiceBanner/ServiceBanner'
import { SettingsPopover } from '../components/SettingsPopover/SettingsPopover'
import { AlertBanner } from '../components/Signals/AlertBanner'
import { Toast } from '../components/Toast/Toast'
import type { TeamId } from '../types/shell'
import type { ToastData } from '../components/Toast/Toast'
import { describeAi, getJson } from '../services/api'
import { matchSession, useMatchSession } from '../services/matchSession'
import type { InsightEntry } from '../services/matchSession'
import { footballMinute, indexWorld, matchClock } from '../services/matchView'
import { extrapolatePlayhead } from '../services/playhead'
import { prefs, usePrefs } from '../services/prefs'
import { MatchListSchema } from '../services/schemas'
import type { MatchSummary, PatternCandidate } from '../services/schemas'
import { ALERT_MS } from '../services/signals'
import { useBackendStatus } from '../services/useBackendStatus'
import type { Role } from '../types/shell'
import { AnalysisLayer } from './AnalysisLayer'
import { CommentatorSurface } from './commentator/CommentatorSurface'
import { FanSurface } from './fan/FanSurface'
import { LiveScoreBug, LiveTransport } from './Live'
import { StudioSurface } from './studio/StudioSurface'
import { useLayout } from './useLayout'
import '../components/Evidence/EvidenceWorkspace.css'
import './App.css'


function isControlTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false
  const tag = el.tagName
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    el.isContentEditable ||
    tag === 'BUTTON' ||
    tag === 'A' ||
    el.getAttribute('role') === 'radio' ||
    el.getAttribute('role') === 'tab'
  )
}

export type Analysis =
  | { kind: 'tactic'; id: string }
  | { kind: 'evidence'; candidate: PatternCandidate; entry?: InsightEntry }

/**
 * The shell: one engine, three products. A slim header (brand, score, role, settings), the role's own
 * surface, and the demo transport that drives the simulated match feed. Analysis opens as a layer
 * over the surface without stopping the match.
 */
export function App() {
  const layout = useLayout()
  const backend = useBackendStatus()
  const store = matchSession
  const snap = useMatchSession(store)
  const p = usePrefs()
  const role = p.role
  const world = useMemo(() => indexWorld(snap.detail), [snap.detail])

  const [analysis, setAnalysis] = useState<Analysis | null>(null)
  const [highlight, setHighlight] = useState<HighlightSpec | null>(null)
  const [research, setResearch] = useState<ResearchSubject | null>(null)
  const [toast, setToast] = useState<ToastData | null>(null)
  // a crest in the score bug opens that club's file in the Commentator
  const [clubRequest, setClubRequest] = useState<{ id: TeamId; n: number } | null>(null)
  const [recapOpen, setRecapOpen] = useState(false)
  const [matches, setMatches] = useState<MatchSummary[]>([])
  const [replay, setReplay] = useState<{ until: number; speed: number } | null>(null)
  const replayArmed = useRef(false)
  const [now, setNow] = useState(() => performance.now())
  // where the viewer was when analysis opened: restored exactly on "Back to match"
  const returnTo = useRef<{ ms: number; playing: boolean; speed: number } | null>(null)

  useEffect(() => {
    store.start()
    return () => store.stop()
  }, [store])

  // side panels stop above the demo transport, which stays usable beneath them
  const demobarRef = useRef<HTMLElement>(null)
  useEffect(() => {
    const el = demobarRef.current
    if (!el || typeof ResizeObserver === 'undefined') return undefined
    const ro = new ResizeObserver(() => document.documentElement.style.setProperty('--demobar-h', `${el.offsetHeight}px`))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    const ctrl = new AbortController()
    getJson('/api/matches', MatchListSchema, { signal: ctrl.signal, timeoutMs: 8000 })
      .then(setMatches)
      .catch(() => {})
    return () => ctrl.abort()
  }, [backend.phase])

  // Keyboard: Space = play/pause, arrows = scrub ±10 s (not while in a control or the analysis layer).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || analysis) return
      if (e.key === ' ' && !isControlTarget(e.target)) {
        e.preventDefault()
        store.togglePlay()
      } else if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !isControlTarget(e.target)) {
        e.preventDefault()
        store.seek(store.playhead() + (e.key === 'ArrowLeft' ? -10_000 : 10_000))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [store, analysis])

  // ---- proactive notifications: the newest live alert and live decision, briefly
  const liveAlert = snap.liveAlert
  useEffect(() => {
    if (!liveAlert) return undefined
    const id = setTimeout(() => setNow(performance.now()), ALERT_MS + 50)
    return () => clearTimeout(id)
  }, [liveAlert])
  const [seenAlert, setSeenAlert] = useState<string | null>(null)
  const alertKey = liveAlert ? `${liveAlert.id}@${liveAlert.at}` : null
  if (alertKey && alertKey !== seenAlert) {
    setSeenAlert(alertKey)
    setNow(liveAlert!.at)
  }
  const classic = role === 'fan' && p.fanMode === 'classic'
  // the Commentator's own moment card is its notification; fans get a brief plate
  const notify = role === 'fan' && !classic && !analysis
  const alertSignal = notify && liveAlert && now - liveAlert.at < ALERT_MS ? (snap.signals[liveAlert.id] ?? null) : null

  // ---- evidence replay (AI stories): play the evidence window, then pause and restore the speed
  const startReplay = useCallback(
    (fromMs: number, toMs: number, speed: number) => {
      replayArmed.current = false
      setReplay({ until: toMs, speed: store.getSnapshot().anchor?.speed ?? 12 })
      store.setSpeed(speed)
      store.seek(fromMs)
      store.play()
    },
    [store],
  )
  const stopReplay = useCallback(() => {
    if (!replay) return
    store.pause()
    store.setSpeed(replay.speed)
    setReplay(null)
  }, [replay, store])
  useEffect(() => {
    if (!replay) return undefined
    const timer = window.setInterval(() => {
      const a = store.getSnapshot().anchor
      if (!a) return
      const at = extrapolatePlayhead(a, performance.now())
      if (!replayArmed.current) {
        if (at < replay.until) replayArmed.current = true
      } else if (at >= replay.until || !a.playing) stopReplay()
    }, 200)
    return () => window.clearInterval(timer)
  }, [replay, store, stopReplay])

  const remember = useCallback(() => {
    const a = store.getSnapshot().anchor
    if (!returnTo.current) returnTo.current = { ms: store.playhead(), playing: !!a?.playing, speed: a?.speed ?? 12 }
  }, [store])
  const openTactic = useCallback(
    (id: string) => {
      remember()
      setHighlight(null)
      setAnalysis({ kind: 'tactic', id })
      // hold the match where it is while the viewer studies the moment; Back to match restores it
      if (store.getSnapshot().anchor?.playing) store.pause()
    },
    [remember, store],
  )
  const openEvidence = useCallback(
    (id: string) => {
      const s = store.getSnapshot()
      const candidate = s.candidates.find((c) => c.candidate_id === id)
      if (!candidate) return
      remember()
      setHighlight(null)
      setAnalysis({ kind: 'evidence', candidate, entry: s.insights[id] })
      if (s.anchor?.playing) store.pause()
    },
    [remember, store],
  )
  const closeAnalysis = useCallback(() => {
    if (replay) setReplay(null)
    setHighlight(null)
    setAnalysis(null)
    // back to exactly where the viewer was: same moment, same speed, playing only if it was
    const back = returnTo.current
    returnTo.current = null
    if (back) {
      const a = store.getSnapshot().anchor
      if (a && Math.abs(store.playhead() - back.ms) > 1500) store.seek(back.ms)
      store.setSpeed(back.speed)
      if (back.playing) store.play()
      else store.pause()
    }
  }, [replay, store])
  const replayAt = useCallback(
    (ms: number) => {
      store.seek(ms)
      store.play()
    },
    [store],
  )

  const onRoleChange = useCallback(
    (next: Role) => {
      prefs.setRole(next)
      closeAnalysis()
    },
    [closeAnalysis],
  )
  const showToast = useCallback((message: string, undo: () => void) => {
    setToast({ id: Date.now(), message, actionLabel: 'Undo', onAction: undo })
  }, [])

  const ai = backend.system?.ai ?? null
  const aiInfo = backend.phase === 'unavailable' && !backend.system ? { text: 'AI: unavailable', tone: 'neutral' as const } : describeAi(ai)
  const finished = !!snap.state?.finished || snap.state?.period === 'FT'
  const minuteOf = (ms: number) => footballMinute(ms, snap.detail)
  const banner = backend.phase === 'unavailable' || snap.status === 'error'
  const modalOpen = !!research || recapOpen || !!analysis

  const evidenceCandidate =
    analysis?.kind === 'evidence' ? (snap.candidates.find((c) => c.candidate_id === analysis.candidate.candidate_id) ?? analysis.candidate) : null
  const evidenceEntry = evidenceCandidate ? (snap.insights[evidenceCandidate.candidate_id] ?? (analysis?.kind === 'evidence' ? analysis.entry : undefined)) : undefined
  const legend: HighlightLegend | null =
    highlight && evidenceCandidate
      ? {
          count: highlight.segments.length,
          channel: highlight.channel ? highlight.channel.channel : highlight.runnerPath ? 'overlapping run (teal)' : null,
          teamName: world.teams.get(evidenceCandidate.team_id ?? '')?.name ?? '',
        }
      : null

  // One match theatre at a time: the analysis layer borrows it while open.
  const theatre = (opts: { quiet?: boolean; withHighlight?: boolean }) => (
    <div className="theatre-box" data-theme="night">
    <MatchTheatre
      store={store}
      snapshot={snap}
      world={world}
      highlight={opts.withHighlight ? highlight : null}
      legend={opts.withHighlight ? legend : null}
      onClearHighlight={() => setHighlight(null)}
      showCornerScore={false}
      quiet={opts.quiet ?? false}
    />
    </div>
  )
  const evidencePanel = evidenceCandidate ? (
    <EvidenceWorkspace
      key={evidenceCandidate.candidate_id}
      candidate={evidenceCandidate}
      entry={evidenceEntry}
      world={world}
      detail={snap.detail}
      matchId={store.matchId}
      sessionId={snap.sessionId}
      onClose={closeAnalysis}
      onSeek={(ms) => store.seek(ms)}
      onReplay={startReplay}
      onStopReplay={stopReplay}
      replaying={!!replay}
      onHighlight={setHighlight}
      closeLabel="Back to match"
    />
  ) : null

  const surfaceTheatre = analysis ? <div className="theatre-parked" aria-hidden="true" /> : theatre({ quiet: true })

  return (
    <div className={`app app--${layout}`} data-theme="night" data-role={role} data-fan={role === 'fan' ? p.fanMode : undefined} data-banner={banner}>
      <a className="skip-link" href="#surface">
        Skip to content
      </a>

      <header className="topbar" inert={modalOpen}>
        <div className="topbar__brand">
          <Wordmark compact={layout !== 'desktop'} />
        </div>
        <div className="topbar__score">
          <LiveScoreBug store={store} snap={snap} world={world} variant="compact" onCrest={role === 'commentator' ? (id) => setClubRequest((r) => ({ id, n: (r?.n ?? 0) + 1 })) : undefined} />
        </div>
        <div className="topbar__actions">
          <RoleSwitch value={role} onChange={onRoleChange} className="topbar__roles" />
          <SettingsPopover
            phase={backend.phase}
            system={backend.system}
            aiText={aiInfo.text}
            matches={matches}
            matchId={store.matchId}
            onMatch={(id) => {
              closeAnalysis()
              setResearch(null)
              setRecapOpen(false)
              store.switchMatch(id)
            }}
            lang={p.lang}
            onLang={(l) => prefs.setLang(l)}
          />
        </div>
      </header>

      {banner && (
        <div className="banner-slot">
          <ServiceBanner onRetry={backend.retryNow} />
        </div>
      )}

      <main id="surface" className="surface" tabIndex={-1} inert={modalOpen}>
        <h1 className="sr-only">
          BYLINE {role === 'commentator' ? 'Commentator' : role === 'studio' ? 'Studio' : 'Fan'}: {world.teams.get(world.homeId)?.name ?? 'Home'} v {world.teams.get(world.awayId)?.name ?? 'Away'}
        </h1>
        {role === 'commentator' && (
          <CommentatorSurface
            store={store}
            snap={snap}
            world={world}
            feed={surfaceTheatre}
            onToast={showToast}
            clubRequest={clubRequest}
            onOpenTactic={openTactic}
            onOpenEvidence={openEvidence}
            onReplayAt={replayAt}
          />
        )}
        {role === 'studio' && (
          <StudioSurface
            store={store}
            snap={snap}
            world={world}
            programme={surfaceTheatre}
            minuteOf={minuteOf}
            onOpenTactic={openTactic}
            onOpenEvidence={openEvidence}
            onReplayAt={replayAt}
          />
        )}
        {role === 'fan' && (
          <FanSurface
            store={store}
            snap={snap}
            world={world}
            fanMode={p.fanMode}
            pitch={surfaceTheatre}
            onOpenTactic={openTactic}
            onOpenEvidence={openEvidence}
            onReplayAt={replayAt}
            onPlayer={(id) => setResearch({ kind: 'player', id })}
            onRecap={() => setRecapOpen(true)}
            finished={finished}
          />
        )}
      </main>

      <footer className="demobar" ref={demobarRef} inert={modalOpen} aria-label="Simulated match feed controls">
        <LiveTransport store={store} snap={snap} world={world} hideStories={classic} />
        {role !== 'fan' && (
          <button type="button" className="btn btn--quiet demobar__recap" data-ready={finished} onClick={() => setRecapOpen(true)}>
            {finished ? 'Read the recap' : 'Recap so far'}
          </button>
        )}
      </footer>

      {alertSignal && (
        <div className="notify" aria-live="polite">
          <AlertBanner signal={alertSignal} audience="fan" onDismiss={() => store.dismissLiveAlert()} />
        </div>
      )}

      {analysis && (
        <AnalysisLayer
          analysis={analysis}
          role={role}
          matchId={store.matchId}
          world={world}
          theatre={theatre({ withHighlight: true })}
          evidencePanel={evidencePanel}
          onClose={closeAnalysis}
          withdrawnReason={(() => {
            const sig = analysis.kind === 'tactic' ? snap.signals[`sig-${analysis.id}`] : undefined
            return sig?.status === 'withdrawn' ? (sig.status_reason ?? 'Withdrawn after an official correction.') : null
          })()}
        />
      )}

      <Drawer side={layout === 'mobile' ? 'bottom' : 'right'} title={research?.kind === 'team' ? 'Club facts' : 'Player facts'} open={!!research} onClose={() => setResearch(null)}>
        {research && (
          <ResearchPanel
            key={`${research.kind}-${research.id}`}
            subject={research}
            matchId={store.matchId}
            seq={snap.state?.seq ?? -1}
            clock={matchClock(store.playhead(), snap.detail, snap.state)}
            world={world}
            onToast={showToast}
          />
        )}
      </Drawer>

      {recapOpen && <RecapView sessionId={snap.sessionId} pushed={snap.recap} world={world} finished={finished} onClose={() => setRecapOpen(false)} />}

      <Toast toast={toast} onDone={() => setToast(null)} />
    </div>
  )
}
