import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { MatchSessionStore, SessionSnapshot } from '../../services/matchSession'
import { matchClock, momentText, periodLabel, scoreDisplay, teamName } from '../../services/matchView'
import type { WorldIndex } from '../../services/matchView'
import { PERIOD_SPOKEN } from '../../types/shell'
import { Icon } from '../icons/Icon'
import type { CameraMode } from './projection'
import { TheatreRenderer } from './renderer'
import type { HighlightSpec, RenderStatus } from './renderer'
import './MatchTheatre.css'

export interface HighlightLegend {
  count: number
  channel: string | null
  teamName: string
}

export interface MatchTheatreProps {
  store: MatchSessionStore
  snapshot: SessionSnapshot
  world: WorldIndex
  highlight: HighlightSpec | null
  legend: HighlightLegend | null
  onClearHighlight: () => void
  /** Compact in-theatre score/clock (mobile). */
  showCornerScore?: boolean
  /** Fan Classic: no moment chips, nothing but the match. */
  quiet?: boolean
}

const REDUCED = '(prefers-reduced-motion: reduce)'
function subscribeReduced(cb: () => void) {
  if (typeof window === 'undefined' || !window.matchMedia) return () => {}
  const mq = window.matchMedia(REDUCED)
  mq.addEventListener('change', cb)
  return () => mq.removeEventListener('change', cb)
}
function readReduced() {
  return typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia(REDUCED).matches
}

function describeBall(store: MatchSessionStore, world: WorldIndex): string {
  const tracking = store.tracking
  if (!tracking) return ''
  const out = { x: 0, y: 0, z: 0 }
  if (!tracking.sampleBall(store.playhead(), out)) return ''
  const dir = store.getSnapshot().state?.attacking_direction[world.homeId]
  if (!dir) return ''
  // The half a team defends is the one it attacks away from.
  const inLeftHalf = out.x < 52.5
  const homeDefendsLeft = dir === '+x'
  const owner = inLeftHalf === homeDefendsLeft ? world.homeId : world.awayId
  return `Ball in ${teamName(world, owner)}'s half.`
}

/**
 * Match Theatre: Canvas 2D broadcast render with crisp DOM overlays.
 * The canvas loop reads the store directly; this component only re-renders
 * when the (throttled) snapshot changes.
 */
export function MatchTheatre({
  store,
  snapshot,
  world,
  highlight,
  legend,
  onClearHighlight,
  showCornerScore = false,
  quiet = false,
}: MatchTheatreProps) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rendererRef = useRef<TheatreRenderer | null>(null)
  const [mode, setMode] = useState<CameraMode>('broadcast')
  const [status, setStatus] = useState<RenderStatus>('loading')
  const reduced = useSyncExternalStore(subscribeReduced, readReduced, () => false)

  const modeRef = useRef(mode)
  const highlightRef = useRef(highlight)
  const reducedRef = useRef(reduced)
  useEffect(() => {
    modeRef.current = mode
    highlightRef.current = highlight
    reducedRef.current = reduced
  }, [mode, highlight, reduced])

  // Renderer lifecycle + resize (devicePixelRatio aware).
  useEffect(() => {
    const canvas = canvasRef.current
    const wrap = wrapRef.current
    if (!canvas || !wrap) return undefined
    let renderer: TheatreRenderer
    try {
      renderer = new TheatreRenderer(canvas, {
        store,
        getMode: () => modeRef.current,
        getHighlight: () => highlightRef.current,
        reducedMotion: () => reducedRef.current,
        onStatus: setStatus,
      })
    } catch {
      return undefined
    }
    rendererRef.current = renderer
    const fit = () => {
      const rect = wrap.getBoundingClientRect()
      renderer.resize(rect.width, rect.height, window.devicePixelRatio || 1)
    }
    fit()
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(fit)
    ro?.observe(wrap)
    renderer.start()
    const onVis = () => (document.hidden ? renderer.stop() : renderer.start())
    document.addEventListener('visibilitychange', onVis)
    return () => {
      ro?.disconnect()
      document.removeEventListener('visibilitychange', onVis)
      renderer.stop()
      rendererRef.current = null
    }
  }, [store])

  // Accessible summary on the canvas, refreshed once a second (not per frame).
  const worldRef = useRef(world)
  useEffect(() => {
    worldRef.current = world
  }, [world])
  useEffect(() => {
    const tick = () => {
      const canvas = canvasRef.current
      if (!canvas) return
      const snap = store.getSnapshot()
      const w = worldRef.current
      const sc = scoreDisplay(snap.state, w.homeId, w.awayId)
      const clock = matchClock(store.playhead(), snap.detail, snap.state)
      const period = PERIOD_SPOKEN[periodLabel(snap.state?.period)]
      const label = [
        'Synthetic match replay.',
        `${clock}, ${period}.`,
        `${teamName(w, w.homeId)} ${sc.home}, ${teamName(w, w.awayId)} ${sc.away}${sc.varReview ? ', VAR check in progress' : sc.checking ? ', goal awaiting confirmation' : ''}.`,
        snap.anchor?.playing ? 'Playing.' : 'Paused.',
        describeBall(store, w),
      ].join(' ')
      canvas.setAttribute('aria-label', label)
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [store])

  // Moment chips auto-dismiss after 4 s.
  const moments = snapshot.moments
  useEffect(() => {
    if (moments.length === 0) return undefined
    const timers = moments.map((m) => setTimeout(() => store.dismissMoment(m.id), 4000))
    return () => timers.forEach(clearTimeout)
  }, [moments, store])

  const state = snapshot.state
  const sc = scoreDisplay(state, world.homeId, world.awayId)
  // Only an OFFICIAL open review is a VAR check; a provisional goal awaiting confirmation is not.
  const varActive = !!state?.var_review
  const anchor = snapshot.anchor
  const atStart = !!anchor && !anchor.playing && anchor.playhead_ms < 1000
  const latestKey = snapshot.keyEvents[snapshot.keyEvents.length - 1]
  const liveText = latestKey ? `${latestKey.display_clock} ${momentText(latestKey, world).kicker}. ${momentText(latestKey, world).detail}` : ''
  const scenario = snapshot.detail?.world.fixture.scenario
  const loading = !snapshot.detail || status === 'loading'
  const legendCorner = legendCornerFor(highlight)

  return (
    <div className="mt" data-highlight={!!highlight} data-loading={loading}>
      <div ref={wrapRef} className="mt__stage">
        <canvas ref={canvasRef} className="mt__canvas" role="img" aria-label="Synthetic match replay loading" />
        <div className="mt__vignette" aria-hidden="true" />
      </div>

      {loading && (
        <div className="mt__skeleton" aria-hidden={!!snapshot.detail}>
          <div className="mt__skeleton-pitch" />
          <p className="mt__skeleton-text" role="status">
            {snapshot.status === 'error' ? 'Connecting to the match service…' : 'Loading synthetic match…'}
          </p>
        </div>
      )}

      <p className="mt__tag">
        <span className="mt__tag-dot" aria-hidden="true" />
        Synthetic <span aria-hidden="true">•</span> <span className="mt__tag-long">seeded scenario </span>
        {scenario?.version ?? 'v1'}
      </p>

      {showCornerScore && (
        <div className="mt__corner numeric" aria-hidden="true">
          <span>{world.teams.get(world.homeId)?.code ?? world.homeId}</span>
          <strong className={sc.provisionalSide === 'home' ? 'is-provisional' : undefined}>{sc.home}</strong>
          <span className="mt__corner-dash" />
          <strong className={sc.provisionalSide === 'away' ? 'is-provisional' : undefined}>{sc.away}</strong>
          <span>{world.teams.get(world.awayId)?.code ?? world.awayId}</span>
          <CornerClock store={store} snapshot={snapshot} />
        </div>
      )}

      {!reduced && !highlight && (
        <div className="mt__camera" role="group" aria-label="Camera">
          <button type="button" aria-pressed={mode === 'broadcast'} onClick={() => setMode('broadcast')}>
            Broadcast
          </button>
          <button type="button" aria-pressed={mode === 'full'} onClick={() => setMode('full')}>
            Full pitch
          </button>
        </div>
      )}

      {varActive && (
        <div className="mt__var" role="status">
          <span className="mt__var-kicker">VAR CHECK</span>
          <span className="mt__var-text">
            Score not confirmed · {state?.var_review?.reason}
          </span>
        </div>
      )}

      <ul className="mt__moments" aria-live="polite" aria-label="Match moments">
        {(quiet ? [] : moments).map((m) => {
          const text = momentText(m.event, world)
          const tone = m.event.type.startsWith('card.') ? (m.event.type === 'card.yellow' ? 'yellow' : 'red') : m.event.type.startsWith('var') || m.event.type === 'goal.disallowed' ? 'var' : 'goal'
          return (
            <li key={m.id} className={`mt__moment mt__moment--${tone}`}>
              <span className="mt__moment-glyph" aria-hidden="true" />
              <span className="mt__moment-kicker">
                <span className="numeric">{m.event.display_clock}</span> {text.kicker}
              </span>
              {text.detail && <span className="mt__moment-detail">{text.detail}</span>}
            </li>
          )
        })}
      </ul>

      {atStart && !loading && (
        <button type="button" className="mt__start" onClick={() => store.play()}>
          <span className="mt__start-icon">
            <Icon name="play" size={20} />
          </span>
          <span className="mt__start-text">
            <strong>Watch the match</strong>
            <span>Synthetic replay from kick-off</span>
          </span>
        </button>
      )}

      {legend && highlight && (
        <div className="mt__legend" data-corner={legendCorner} role="note" aria-label="Evidence overlay legend">
          <div className="mt__legend-row">
            <span className="mt__legend-arc" aria-hidden="true">1</span>
            <span>
              {legend.count} source action{legend.count === 1 ? '' : 's'}
              <span className="mt__legend-long">, numbered in order</span>
            </span>
          </div>
          {legend.channel && (
            <div className="mt__legend-row">
              <span className="mt__legend-band" aria-hidden="true" />
              <span>
                <span className="mt__legend-long">{legend.teamName}: </span>
                {legend.channel}
                {legend.channel.includes('run') ? '' : ' channel'}
              </span>
            </div>
          )}
          <button type="button" className="mt__legend-close" onClick={onClearHighlight}>
            Hide overlay
          </button>
        </div>
      )}

      <p className="sr-only" aria-live="polite">
        {liveText}
      </p>
    </div>
  )
}

/** Put the legend in the corner furthest from the highlighted play. */
function legendCornerFor(h: HighlightSpec | null): string {
  if (!h) return 'bottom-right'
  const pts: Array<{ x: number; y: number }> = [
    ...h.segments.flatMap((s) => [s.from, s.to]),
    ...(h.runnerPath ?? []),
  ]
  let cx = 52.5
  let cy = 34
  if (h.channel) {
    cx = h.channel.direction === '+x' ? 80 : 25
    const nearSide = (h.channel.direction === '+x') === (h.channel.channel === 'right')
    cy = h.channel.channel === 'centre' ? 34 : nearSide ? 60 : 8
  } else if (pts.length) {
    cx = pts.reduce((a, p) => a + p.x, 0) / pts.length
    cy = pts.reduce((a, p) => a + p.y, 0) / pts.length
  }
  return `${cy > 34 ? 'top' : 'bottom'}-${cx > 52.5 ? 'left' : 'right'}`
}

/** Clock that ticks a few times a second without re-rendering the theatre. */
function CornerClock({ store, snapshot }: { store: MatchSessionStore; snapshot: SessionSnapshot }) {
  const ref = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    const tick = () => {
      if (ref.current) ref.current.textContent = matchClock(store.playhead(), store.getSnapshot().detail, store.getSnapshot().state)
    }
    tick()
    const id = setInterval(tick, 250)
    return () => clearInterval(id)
  }, [store, snapshot.state])
  return <span ref={ref} className="mt__corner-clock" />
}
