import { useCallback, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { SIMULATED_NOTICE, TEMPLATES } from '../../components/Broadcast/templates'
import type { FormatId, GraphicTemplate, TemplateId } from '../../components/Broadcast/templates'
import type { MatchSessionStore, SessionSnapshot } from '../../services/matchSession'
import type { WorldIndex } from '../../services/matchView'
import type { SurfaceActions } from '../surfaceActions'
import { AnalysisDesk } from './AnalysisDesk'
import { FillPanel, TemplatePanel } from './Inspector'
import { Monitors } from './Monitors'
import type { OverlayAction } from './Monitors'
import { Queue } from './Queue'
import { airBlock, bugData, EMPTY_PACKAGES, invalidated, lastCut, programmePacket, useFill, useMatchClock, usePresence, useReducedMotion, useSurfaceInert } from './studioModel'
import type { Packages } from './studioModel'
import './Studio.css'

type Workspace = 'production' | 'analysis'

export interface StudioSurfaceProps extends SurfaceActions {
  store: MatchSessionStore
  snap: SessionSnapshot
  world: WorldIndex
  /** The simulated match feed, shown inside the programme monitor. */
  programme: ReactNode
  minuteOf: (ms: number) => string
}

function LiveProduction({
  snap,
  world,
  store,
  programme,
  minuteOf,
  actions,
  template,
  onTemplate,
  selectedId,
  setSelected,
  formatOf,
  onFormat,
  packageOrder,
}: {
  snap: SessionSnapshot
  world: WorldIndex
  store: MatchSessionStore
  programme: ReactNode
  minuteOf: (ms: number) => string
  actions: SurfaceActions
  template: GraphicTemplate
  onTemplate: (id: TemplateId) => void
  selectedId: string | null
  setSelected: (id: string) => void
  formatOf: (id: string) => FormatId | null
  onFormat: (id: string, f: FormatId) => void
  packageOrder: Map<string, { label: string; rank: number }>
}) {
  const packets = useMemo(() => Object.values(snap.overlays).sort((a, b) => b.match_elapsed_ms - a.match_elapsed_ms), [snap.overlays])
  const [message, setMessage] = useState<string | null>(null)
  const [guides, setGuides] = useState(false)
  const firstReview = packets.find((p) => p.status === 'proposed') ?? packets[0] ?? null
  const selected = (selectedId ? snap.overlays[selectedId] : undefined) ?? firstReview
  const live = programmePacket(packets)
  const next = packets.filter((p) => p.status === 'approved').sort((a, b) => (a.display_from_ms ?? Infinity) - (b.display_from_ms ?? Infinity))[0] ?? null
  const reduced = useReducedMotion()
  const presence = usePresence(live, reduced ? 200 : 460)
  // a graphic a VAR check or a correction invalidated is cut from the programme at once: no exit animation
  const air = presence.phase === 'out' && invalidated(presence.current ? snap.overlays[presence.current.id] : null) ? { current: null, phase: 'in' as const } : presence
  const inert = useSurfaceInert()
  const clock = useMatchClock(store, snap)

  const selectedFill = useFill(selected, snap, world, store.matchId, minuteOf)
  const onAirFill = useFill(air.current, snap, world, store.matchId, minuteOf)
  const bug = bugData(snap, world, clock)

  const onAction: OverlayAction = async (id, action, cue) => {
    const p = snap.overlays[id]
    const blocked = action === 'approve' && p ? airBlock(p) : null
    if (blocked) {
      setMessage(blocked)
      return
    }
    const err = await store.overlayAction(id, action, cue)
    setMessage(err)
  }

  return (
    <div className="prod">
      <Queue packets={packets} selected={selected?.id ?? null} onSelect={setSelected} minuteOf={minuteOf} snap={snap} world={world} matchId={store.matchId} template={template} formatOf={formatOf} packageOrder={packageOrder} />
      <div className="prod__main">
        <Monitors
          selected={selected}
          selectedFill={selectedFill}
          onAir={air.current}
          onAirFill={onAirFill}
          airPhase={air.phase}
          next={next}
          cut={lastCut(packets)}
          store={store}
          world={world}
          programme={programme}
          template={template}
          bug={bug}
          minuteOf={minuteOf}
          onAction={onAction}
          formatOf={formatOf}
          onFormat={onFormat}
          clips={!inert}
          guides={guides}
          belowPreview={
            selected && selectedFill ? (
              <FillPanel matchId={store.matchId} packet={selected} filled={selectedFill} snap={snap} world={world} minuteOf={minuteOf} template={template} actions={actions} message={message} />
            ) : (
              <p className="empty-block prod__empty">The rundown fills as the match unfolds: a goal, a substitution, a record or a measured tactical moment each arrives as a graphic for you to approve.</p>
            )
          }
          belowProgramme={<TemplatePanel filled={selectedFill ?? onAirFill} template={template} onTemplate={onTemplate} guides={guides} onGuides={setGuides} />}
        />
      </div>
    </div>
  )
}

export function StudioSurface(props: StudioSurfaceProps) {
  const [ws, setWs] = useState<Workspace>('production')
  const [pkgs, setPkgs] = useState<Packages>(EMPTY_PACKAGES)
  const [templateId, setTemplateId] = useState<TemplateId>('byline')
  const [selectedId, setSelected] = useState<string | null>(null)
  // the producer's layout per graphic: chosen in the preview, or in the analysis desk's package
  const [formats, setFormats] = useState<Record<string, FormatId>>({})
  const formatOf = useCallback((id: string) => formats[id] ?? null, [formats])
  const onFormat = useCallback((id: string, f: FormatId) => setFormats((m) => (m[id] === f ? m : { ...m, [id]: f })), [])
  const { snap } = props
  const review = Object.values(snap.overlays).filter((p) => p.status === 'proposed').length
  const held = Object.values(snap.overlays).filter((p) => p.on_hold && p.status !== 'retracted').length
  // each sent package item keeps its place: "Half-time package 2 of 4" in the production rundown
  const packageOrder = useMemo(() => {
    const m = new Map<string, { label: string; rank: number }>()
    ;(['pre', 'ht', 'ft'] as const).forEach((phase, k) => {
      const items = pkgs[phase]
      const name = phase === 'pre' ? 'Pre-match' : phase === 'ht' ? 'Half-time' : 'Full-time'
      items.forEach((it, i) => it.packetId && m.set(it.packetId, { label: `${name} package ${i + 1} of ${items.length}`, rank: k * 100 + i }))
    })
    return m
  }, [pkgs])
  const openInProduction = (packetId: string) => {
    setSelected(packetId)
    setWs('production')
  }
  return (
    <div className="studio" data-theme="night">
      <div className="studio__bar">
        <div className="studio__ws" role="tablist" aria-label="Studio workspace">
          <button type="button" role="tab" aria-selected={ws === 'production'} onClick={() => setWs('production')}>
            Live production{review ? <span className="studio__count numeric">{review}</span> : null}
          </button>
          <button type="button" role="tab" aria-selected={ws === 'analysis'} onClick={() => setWs('analysis')}>
            Analysis desk
          </button>
        </div>
        <ul className="studio__guards" aria-label="Safeguards">
          <li>A producer approves every graphic</li>
          <li data-active={held > 0}>{held ? `VAR hold on ${held} graphic${held > 1 ? 's' : ''}` : 'VAR holds goal graphics'}</li>
          <li>Demo output only</li>
        </ul>
        <p className="studio__sim">{SIMULATED_NOTICE}</p>
      </div>
      {ws === 'production' ? (
        <LiveProduction
          snap={snap}
          world={props.world}
          store={props.store}
          programme={props.programme}
          minuteOf={props.minuteOf}
          actions={props}
          template={TEMPLATES[templateId]}
          onTemplate={setTemplateId}
          selectedId={selectedId}
          setSelected={setSelected}
          formatOf={formatOf}
          onFormat={onFormat}
          packageOrder={packageOrder}
        />
      ) : (
        <AnalysisDesk
          store={props.store}
          snap={snap}
          world={props.world}
          actions={props}
          pkgs={pkgs}
          setPkgs={setPkgs}
          template={TEMPLATES[templateId]}
          minuteOf={props.minuteOf}
          formatOf={formatOf}
          onFormat={onFormat}
          onOpenInProduction={openInProduction}
        />
      )}
    </div>
  )
}
