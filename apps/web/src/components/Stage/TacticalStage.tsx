import '@fontsource-variable/archivo/wdth.css'
import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import type { Ref } from 'react'
import type { WorldIndex } from '../../services/matchView'
import type { MomentView } from '../../services/schemas'
import { buildStageModel } from '../../services/stageModel'
import type { Audience } from '../../services/stageModel'
import { buildChooseSteps, buildChoice, buildScript } from '../../services/stageScript'
import type { StageStep } from '../../services/stageScript'
import { loadReplay, sampleReplay } from './replay'
import type { ReplayData, ReplayPose } from './replay'
import { fallbackPercent } from './fallbackGeometry'
import { StageFallback } from './StageFallback'
import type { FrameStats, StageScene } from './scene'
import './Stage.css'

export interface TacticalStageHandle {
  /** Choose mode: show what actually happened. */
  reveal: () => void
  next: () => void
  prev: () => void
  /** 0-based step index. */
  goTo: (index: number) => void
  play: () => void
  pause: () => void
  /** Replay the real tracking for this moment, then settle back on the frozen frame. */
  replay: () => void
  /** Rough frame timing while animating (WebGL only). */
  stats: () => FrameStats | null
}

export interface TacticalStageProps {
  matchId: string
  view: MomentView
  world: WorldIndex
  audience: Audience
  /**
   * Start auto-advancing through the steps (never under reduced motion). Off by default: the viewer
   * moves on with Next; Auto-play holds each step at least STEP_MIN_MS and until its layers have landed.
   */
  autoplay?: boolean
  /**
   * Optional AI-verified read, shown on the takeaway step in amber (the only amber in the stage: verified
   * text, never drawn geometry). Pass only text from a real verified run, with its provenance label.
   */
  verified?: { text: string; label?: string } | null
  /** The moment was withdrawn (e.g. its evidence was ruled out): the picture is greyed and the plate struck. */
  withdrawn?: { reason: string } | null
  /** 0-based index of the first step shown. */
  initialStep?: number
  /** 'explain' = the guided steps; 'choose' = What would you do? */
  mode?: 'explain' | 'choose'
  onStepChange?: (step: StageStep, index: number) => void
  /** Choose mode: controlled reveal. Leave undefined to let the viewer reveal after picking. */
  revealed?: boolean
  /** Choose mode: the viewer picked a receiver. */
  onChoose?: (receiverId: string) => void
  compact?: boolean
  /**
   * Clip mode: a graphics-package asset. The picture only (no caption, rail, controls, title or stat
   * plates; the hypothetical label stays), filling its parent, playing the steps on a loop at broadcast
   * pace. Never autoplays under reduced motion: it holds `initialStep` instead.
   */
  clip?: boolean
  /** Clip mode: the longest a step is held before the next (ms). */
  clipStepMs?: number
  className?: string
  ref?: Ref<TacticalStageHandle>
}

/** Clip mode: how long the last step holds before the loop starts again. */
const CLIP_HOLD_MS = 1600

type Renderer = 'pending' | 'webgl' | 'svg'
type Speed = 0.5 | 1 | 1.5
const SPEEDS: Speed[] = [0.5, 1, 1.5]

function webglAvailable(): boolean {
  if (typeof window === 'undefined' || typeof document === 'undefined') return false
  if (/jsdom/i.test(navigator.userAgent)) return false
  try {
    const c = document.createElement('canvas')
    const gl = c.getContext('webgl2') ?? c.getContext('webgl')
    const ok = !!gl
    ;(gl as WebGLRenderingContext | null)?.getExtension('WEBGL_lose_context')?.loseContext()
    return ok
  } catch {
    return false
  }
}

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function useReducedMotion(): boolean {
  const [query] = useState(() =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-reduced-motion: reduce)') : null,
  )
  const [reduced, setReduced] = useState(() => query?.matches ?? false)
  useEffect(() => {
    if (!query) return undefined
    const on = () => setReduced(query.matches)
    query.addEventListener('change', on)
    return () => query.removeEventListener('change', on)
  }, [query])
  return reduced
}

const Icon = {
  prev: (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path d="M14.5 6 8.5 12l6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  next: (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path d="m9.5 6 6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  play: (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path d="M8 5.5v13l10.5-6.5z" fill="currentColor" />
    </svg>
  ),
  pause: (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path d="M7.5 5.5h3v13h-3zM13.5 5.5h3v13h-3z" fill="currentColor" />
    </svg>
  ),
  replay: (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <path d="M5 12a7 7 0 1 0 2.05-4.95M5 4.5v3.5h3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
}

/**
 * BYLINE tactical stage: a guided, step-by-step 3D telestration of one frozen moment, with a
 * real-tracking replay. Three.js is loaded on demand; without WebGL an SVG fallback draws the
 * same layers per step.
 */
export function TacticalStage({
  matchId,
  view,
  world,
  audience,
  autoplay = false,
  verified = null,
  withdrawn = null,
  initialStep = 0,
  mode = 'explain',
  onStepChange,
  revealed: revealedProp,
  onChoose,
  compact = false,
  clip = false,
  clipStepMs = 3200,
  className,
  ref,
}: TacticalStageProps) {
  const reduced = useReducedMotion()
  const model = useMemo(() => buildStageModel(view, world, audience), [view, world, audience])
  const script = useMemo(() => buildScript(view, world, audience), [view, world, audience])
  const chooseSteps = useMemo(() => (mode === 'choose' ? buildChooseSteps(view, world, audience) : null), [mode, view, world, audience])
  const choiceSet = useMemo(() => (mode === 'choose' ? buildChoice(view, world, audience) : null), [mode, view, world, audience])
  const choosing = mode === 'choose' && !!chooseSteps && !!choiceSet

  const [index, setIndex] = useState(() => Math.max(0, Math.min(script.length - 1, initialStep)))
  const [playing, setPlaying] = useState(() => (autoplay || clip) && !prefersReducedMotion())
  const [speed, setSpeed] = useState<Speed>(1)
  const [renderer, setRenderer] = useState<Renderer>(() => (webglAvailable() ? 'pending' : 'svg'))
  /** Bumped each time a scene is (re)created so step effects re-run against it. */
  const [sceneGen, setSceneGen] = useState(0)
  const [replayState, setReplayState] = useState<'idle' | 'loading' | 'playing' | 'error'>('idle')
  const [pose, setPose] = useState<ReplayPose | null>(null)
  const [picked, setPicked] = useState<string | null>(null)
  const [revealedState, setRevealedState] = useState(false)
  const revealed = revealedProp ?? revealedState

  const rootRef = useRef<HTMLDivElement>(null)
  const viewportRef = useRef<HTMLDivElement>(null)
  const sceneRef = useRef<StageScene | null>(null)
  const firstApply = useRef(true)
  const replayRef = useRef<ReplayData | null>(null)

  const safeIndex = Math.min(index, script.length - 1)
  const step: StageStep = choosing ? (revealed ? chooseSteps.after(picked) : chooseSteps.before) : script[safeIndex]!
  const isPlaying = playing && !choosing && replayState === 'idle'
  const atEnd = safeIndex >= script.length - 1
  const nextStep = atEnd ? null : script[safeIndex + 1]!
  const stepLabel = choosing ? step.title : `Step ${step.n} of ${script.length}: ${step.title}`
  const ariaLabel = `${withdrawn ? 'Withdrawn. ' : ''}${view.display_clock} ${view.label}. ${stepLabel}. ${step.caption}${step.banner ? ` ${step.banner}.` : ''}`

  // ---- renderer: Three.js on demand, else the SVG fallback
  useEffect(() => {
    const host = viewportRef.current
    if (!host || renderer === 'svg') return undefined
    let cancelled = false
    let scene: StageScene | null = null
    import('./scene')
      .then(({ StageScene: Scene }) => {
        if (cancelled) return
        try {
          scene = new Scene(host, model, { reducedMotion: reduced, clip })
          sceneRef.current = scene
          // a new scene opens on its step without a flight; later steps animate
          firstApply.current = true
          setRenderer('webgl')
          setSceneGen((g) => g + 1)
        } catch {
          setRenderer('svg')
        }
      })
      .catch(() => !cancelled && setRenderer('svg'))
    return () => {
      cancelled = true
      scene?.dispose()
      sceneRef.current = null
    }
    // the scene is rebuilt only when the moment or wording changes; reduced motion is pushed separately
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model])

  useEffect(() => {
    sceneRef.current?.setReducedMotion(reduced)
  }, [reduced, sceneGen])

  // ---- push the current step to the scene
  useEffect(() => {
    const scene = sceneRef.current
    if (!scene || renderer !== 'webgl') return
    scene.setChoices(choosing && choiceSet ? { ids: choiceSet.choices.map((c) => c.receiverId), picked } : null)
    scene.setStep(step, { instant: firstApply.current })
    firstApply.current = false
    scene.canvas.setAttribute('role', 'img')
    scene.canvas.setAttribute('aria-label', ariaLabel)
  }, [renderer, sceneGen, step, choosing, choiceSet, picked, ariaLabel])


  // ---- choice buttons follow their players
  useEffect(() => {
    const scene = sceneRef.current
    if (!scene || renderer !== 'webgl' || !choosing || !choiceSet) {
      scene?.track([])
      return
    }
    const host = viewportRef.current
    const list = choiceSet.choices
      .map((c) => ({ el: host?.querySelector<HTMLElement>(`[data-choice="${c.receiverId}"]`) ?? null, at: c.at, lift: 26 }))
      .filter((x): x is { el: HTMLElement; at: [number, number]; lift: number } => !!x.el)
    scene.track(list)
  }, [renderer, sceneGen, choosing, choiceSet, revealed])

  useEffect(() => {
    onStepChange?.(step, choosing ? (revealed ? 1 : 0) : safeIndex)
    // only when the step itself changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step])

  // ---- autoplay (a clip loops: it holds the last step, then starts again)
  const stepMs = clip ? Math.min(step.durationMs, clipStepMs) : step.durationMs
  useEffect(() => {
    if (!isPlaying) return undefined
    if (safeIndex >= script.length - 1) {
      const t = clip ? window.setTimeout(() => setIndex(0), CLIP_HOLD_MS) : window.setTimeout(() => setPlaying(false), 0)
      return () => window.clearTimeout(t)
    }
    const t = window.setTimeout(() => setIndex((i) => Math.min(script.length - 1, i + 1)), stepMs / speed)
    return () => window.clearTimeout(t)
  }, [isPlaying, safeIndex, script.length, stepMs, speed, clip])

  const goTo = useCallback((i: number) => setIndex(Math.max(0, Math.min(script.length - 1, i))), [script.length])
  const next = useCallback(() => setIndex((i) => Math.min(script.length - 1, i + 1)), [script.length])
  /** The big Next: advance, or from the last step start again. */
  const advance = useCallback(() => {
    setPlaying(false)
    setIndex((i) => (i >= script.length - 1 ? 0 : i + 1))
  }, [script.length])
  const prev = useCallback(() => setIndex((i) => Math.max(0, i - 1)), [])
  const togglePlay = useCallback(() => {
    setPlaying((p) => {
      if (!p && safeIndex >= script.length - 1) setIndex(0)
      return !p
    })
  }, [safeIndex, script.length])

  // ---- real replay
  const replay = useCallback(async () => {
    if (replayState === 'loading' || replayState === 'playing') return
    setPlaying(false)
    setReplayState('loading')
    try {
      const data = replayRef.current ?? (await loadReplay(matchId, view))
      replayRef.current = data
      setReplayState('playing')
      const scene = sceneRef.current
      if (scene && renderer === 'webgl') {
        await scene.playReal(data.frames, data.entityMap, speed, { from: data.from, to: data.to })
      } else {
        await new Promise<void>((resolve) => {
          const p: ReplayPose = { ball: { x: 0, y: 0, z: 0, visible: false }, pos: new Map() }
          let start = 0
          let last = 0
          const tick = (now: number) => {
            if (!start) start = now
            const t = data.from + (now - start) * speed
            if (now - last > 33) {
              last = now
              sampleReplay(data, Math.min(t, data.to), p)
              setPose({ ball: { ...p.ball }, pos: new Map(p.pos) })
            }
            if (t < data.to) requestAnimationFrame(tick)
            else resolve()
          }
          requestAnimationFrame(tick)
        })
        setPose(null)
      }
      setReplayState('idle')
    } catch {
      setReplayState('error')
    }
  }, [replayState, matchId, view, renderer, speed])

  const reveal = useCallback(() => setRevealedState(true), [])

  useImperativeHandle(
    ref,
    () => ({
      reveal,
      next,
      prev,
      goTo,
      play: () => setPlaying(true),
      pause: () => setPlaying(false),
      replay: () => void replay(),
      stats: () => sceneRef.current?.stats() ?? null,
    }),
    [reveal, next, prev, goTo, replay],
  )

  // ---- keyboard: left/right = prev/next, space = play/pause, when the stage has focus
  useEffect(() => {
    const root = rootRef.current
    if (!root) return undefined
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return
      const target = e.target as HTMLElement
      const onControl = target !== root && /^(BUTTON|INPUT|SELECT|TEXTAREA|A)$/.test(target.tagName)
      if (choosing) return
      if (e.key === 'ArrowRight') {
        e.preventDefault()
        setPlaying(false)
        next()
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        setPlaying(false)
        prev()
      } else if ((e.key === ' ' || e.key === 'Spacebar') && !onControl) {
        e.preventDefault()
        togglePlay()
      }
    }
    root.addEventListener('keydown', onKey)
    return () => root.removeEventListener('keydown', onKey)
  }, [choosing, next, prev, togglePlay])

  const pick = (id: string) => {
    if (revealed) return
    setPicked(id)
    onChoose?.(id)
  }

  /** Choice buttons: tracked over the 3D players by the scene, or placed by percent over the SVG. */
  const choiceButtons = (placement: 'tracked' | 'percent') =>
    choosing && choiceSet && !revealed ? (
      <div className="stage__choices">
        {choiceSet.choices.map((c) => {
          const pos = placement === 'percent' ? fallbackPercent(c.at) : null
          return (
            <button
              key={c.receiverId}
              type="button"
              data-choice={c.receiverId}
              className="stage__choice"
              data-state={picked === c.receiverId ? 'picked' : 'open'}
              data-placement={placement}
              style={pos ? { left: pos.left, top: pos.top } : undefined}
              aria-pressed={picked === c.receiverId}
              onClick={() => pick(c.receiverId)}
            >
              <span className="stage__choice-verb">Pass to</span> {c.name}
            </button>
          )
        })}
      </div>
    ) : null

  const showPlate = !clip && (!compact || renderer === 'svg')
  const classes = ['stage', compact ? 'stage--compact' : '', clip ? 'stage--clip' : '', renderer === 'svg' ? 'stage--svg' : '', withdrawn ? 'stage--withdrawn' : '', className ?? ''].filter(Boolean).join(' ')
  const autoMs = Math.round(step.durationMs / speed)

  if (clip) {
    return (
      <section className={classes} data-audience={audience} data-mode={mode} data-step={step.id} data-renderer={renderer} aria-label={`Tactical clip: ${view.title}`}>
        <div className="stage__viewport" ref={viewportRef}>
          {renderer === 'svg' && (
            <div className="stage__svgbox">
              <StageFallback model={model} step={step} label={ariaLabel} choices={null} pose={null} reducedMotion={reduced} />
            </div>
          )}
          {renderer === 'pending' && <p className="stage__loading">Setting up the pitch…</p>}
          {step.banner && (
            <p className="stage__banner" data-kind={step.id} aria-hidden="true">
              {step.banner}
            </p>
          )}
        </div>
      </section>
    )
  }

  return (
    // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- the stage takes arrow/space shortcuts when focused
    <section ref={rootRef} className={classes} data-audience={audience} data-mode={mode} data-step={step.id} data-renderer={renderer} aria-label={`Tactical stage: ${view.title}`} tabIndex={0}>
      <div className="stage__viewport" ref={viewportRef}>
        {renderer === 'svg' && (
          <div className="stage__svgbox">
            <StageFallback model={model} step={step} label={ariaLabel} choices={choosing && choiceSet ? { ids: choiceSet.choices.map((c) => c.receiverId), picked } : null} pose={pose} reducedMotion={reduced} />
            {choiceButtons('percent')}
          </div>
        )}
        {renderer === 'pending' && <p className="stage__loading">Setting up the pitch…</p>}
        {showPlate && (
          <div className="stage__plate" aria-hidden="true">
            <span className="stage__kicker">
              <span className="numeric">{view.display_clock}</span> · {view.label}
              {withdrawn && <span className="stage__withdrawn-tag">Withdrawn</span>}
            </span>
            <span className="stage__plate-title">
              {!choosing && <span className="stage__plate-n numeric">{step.n}</span>}
              {withdrawn ? <s>{step.title}</s> : step.title}
            </span>
          </div>
        )}
        {step.banner && replayState !== 'playing' && (
          <p className="stage__banner" data-kind={step.id} aria-hidden="true">
            {step.banner}
          </p>
        )}
        {step.stats.length > 0 && replayState !== 'playing' && (
          <dl className="stage__stats" aria-hidden="true">
            {step.stats.map((s) => (
              <div key={s.label}>
                <dt>{s.label}</dt>
                <dd className="numeric">{s.value}</dd>
              </div>
            ))}
          </dl>
        )}
        {replayState === 'playing' && (
          <p className="stage__badge" aria-hidden="true">
            Real tracking · {speed}x
          </p>
        )}
        {renderer !== 'svg' && choiceButtons('tracked')}
      </div>

      <div className="stage__dock">
        <div className="stage__caption" aria-live="polite">
          {withdrawn && (
            <p className="stage__withdrawn">
              <span className="stage__withdrawn-tag">Withdrawn</span> {withdrawn.reason}
            </p>
          )}
          <h3 className="stage__caption-title">
            {!choosing && <span className="stage__caption-n numeric">{step.n}</span>}
            {withdrawn ? <s>{step.title}</s> : step.title}
            {step.banner && (
              <span className="stage__caption-hypo" data-kind={step.id}>
                {step.banner}
              </span>
            )}
          </h3>
          {step.takeaway && <p className="stage__takeaway">{step.takeaway}</p>}
          {step.caption !== step.takeaway && <p className="stage__caption-text">{step.caption}</p>}
          {step.stats.length > 0 && (
            <ul className="stage__sr-only">
              {step.stats.map((s) => (
                <li key={s.label}>
                  {s.label}: {s.value}
                </li>
              ))}
            </ul>
          )}
          {step.notes.length > 0 && (
            <div className="stage__notes">
              <p className="stage__notes-h">{step.id === 'takeaway' ? "What the data can't tell us" : 'How to read this'}</p>
              <ul>
                {step.notes.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            </div>
          )}
          {verified && step.id === 'takeaway' && !withdrawn && (
            <div className="stage__verified">
              <p className="stage__verified-h">{verified.label ?? 'AI-verified read'}</p>
              <p className="stage__verified-text">{verified.text}</p>
            </div>
          )}
          {replayState === 'error' && <p className="stage__error">The real tracking for this moment is unavailable right now.</p>}
        </div>

        {choosing ? (
          <div className="stage__controls">
            {!revealed && revealedProp === undefined && (
              <button type="button" className="stage__btn stage__btn--primary" disabled={!picked} onClick={reveal}>
                Show what happened
              </button>
            )}
            {revealed && (
              <button type="button" className="stage__btn" onClick={() => void replay()} disabled={replayState === 'loading' || replayState === 'playing'}>
                {Icon.replay} Replay the real play
              </button>
            )}
          </div>
        ) : (
          <>
            <div className="stage__nav" role="group" aria-label="Step navigation">
              <button type="button" className="stage__back" disabled={safeIndex === 0} onClick={() => { setPlaying(false); prev() }}>
                {Icon.prev}
                <span className="stage__back-t">Back</span>{' '}
                <span className="sr-only">to the previous step</span>
              </button>
              <button type="button" className="stage__next" onClick={advance}>
                <span className="stage__next-k">{atEnd ? 'Start again' : 'Next'}</span>
                {nextStep && !atEnd && <span className="sr-only">: </span>}
                {nextStep && <span className="stage__next-t">{nextStep.title}</span>}
                {atEnd ? Icon.replay : Icon.next}
                {isPlaying && !atEnd && <span key={`${safeIndex}-${speed}`} className="stage__next-progress" style={{ animationDuration: `${autoMs}ms` }} aria-hidden="true" />}
              </button>
            </div>
            <ol className="stage__rail" aria-label="Steps">
              {script.map((s, i) => (
                <li key={s.id}>
                  <button
                    type="button"
                    className="stage__rail-step"
                    aria-current={i === safeIndex ? 'step' : undefined}
                    data-kind={s.id}
                    onClick={() => {
                      setPlaying(false)
                      goTo(i)
                    }}
                  >
                    <span className="stage__rail-n numeric">{s.n}</span>
                    <span className="stage__rail-t">{s.title}</span>
                  </button>
                </li>
              ))}
            </ol>
            <div className="stage__controls" role="group" aria-label="Playback">
              <button type="button" className="stage__btn stage__auto" aria-pressed={isPlaying} onClick={togglePlay}>
                {isPlaying ? Icon.pause : Icon.play}
                <span>{isPlaying ? 'Pause' : 'Auto-play'}</span>
              </button>
              <button type="button" className="stage__btn" onClick={() => void replay()} disabled={replayState === 'loading' || replayState === 'playing'}>
                {Icon.replay}
                {replayState === 'loading' ? 'Loading…' : replayState === 'playing' ? 'Replaying…' : 'Replay the real play'}
              </button>
              <div className="stage__speed" role="group" aria-label="Speed">
                {SPEEDS.map((s) => (
                  <button key={s} type="button" aria-pressed={speed === s} onClick={() => setSpeed(s)}>
                    <span className="numeric">{s}x</span>
                  </button>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </section>
  )
}
