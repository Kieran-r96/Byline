import { useId, useState } from 'react'
import type { ReactNode } from 'react'
import { GraphicFrame } from '../../components/Broadcast/Graphic'
import type { BugData } from '../../components/Broadcast/Graphic'
import type { Filled } from '../../components/Broadcast/fill'
import { formatAvailability, resolveFormat } from '../../components/Broadcast/formats'
import { FORMAT_IDS } from '../../components/Broadcast/templates'
import type { FormatId, GraphicTemplate } from '../../components/Broadcast/templates'
import { TacticalStage } from '../../components/Stage/TacticalStage'
import type { StageStep } from '../../services/stageScript'
import type { MatchSessionStore } from '../../services/matchSession'
import type { WorldIndex } from '../../services/matchView'
import type { OverlayPacket } from '../../services/schemas'
import { useMomentView } from '../../services/useMomentView'
import { airBlock, statusLine, useOnAirShare, useReducedMotion } from './studioModel'

export type Cue = { cue: 'now' | 'next_stoppage' | 'delay'; delayMs?: number; durationMs?: number | null }
export type OverlayAction = (id: string, action: 'approve' | 'reject' | 'hide', cue?: Cue) => Promise<void>

/**
 * The animated tactical breakdown as a graphics-package asset: the moment's guided 3D steps, looping
 * at broadcast pace under the telestration plate. Only measured layers are shown as fact; the
 * hypothetical step keeps its dashed label. Under reduced motion it holds the measured-options step.
 */
export function ClipAsset({ matchId, momentId, world }: { matchId: string; momentId: string; world: WorldIndex }) {
  const { view, failed } = useMomentView(matchId, momentId)
  const reduced = useReducedMotion()
  const [step, setStep] = useState<{ n: number; title: string } | null>(null)
  if (!view) {
    return (
      <div className="clip clip--wait">
        <span>{failed ? 'The clip for this moment is unavailable.' : 'Loading the tactical clip…'}</span>
      </div>
    )
  }
  return (
    <div className="clip" data-moment={view.moment_id}>
      <TacticalStage
        key={view.moment_id}
        clip
        matchId={matchId}
        view={view}
        world={world}
        audience="pro"
        initialStep={reduced ? 2 : 0}
        onStepChange={(s: StageStep) => setStep({ n: s.n, title: s.title })}
      />
      {step && (
        <span className="clip__step" key={step.n} aria-hidden="true">
          <b className="numeric">{step.n}</b>
          {step.title}
        </span>
      )}
      <span className="clip__tag" aria-hidden="true">
        Animated breakdown · {view.display_clock}
      </span>
    </div>
  )
}

function Slate({ p }: { p: OverlayPacket }) {
  if (p.status === 'retracted')
    return (
      <div className="slate" data-kind="withdrawn" aria-hidden="true">
        <span>Withdrawn after a correction · cannot air</span>
      </div>
    )
  if (p.on_hold)
    return (
      <div className="slate" data-kind="held" aria-hidden="true">
        <span>Held · VAR check in progress</span>
      </div>
    )
  if (p.status === 'expired' || p.status === 'rejected' || p.status === 'hidden')
    return (
      <div className="slate" data-kind="done" aria-hidden="true">
        <span>{p.status === 'rejected' ? 'Rejected' : p.status === 'expired' ? 'Expired' : 'Taken off air'} · not on air</span>
      </div>
    )
  return null
}

/** Where each format puts the graphic on the frame, as a small 16:9 diagram. */
function FormatGlyph({ id }: { id: FormatId }) {
  return (
    <svg className="fmt__glyph" viewBox="0 0 32 18" aria-hidden="true">
      <rect x="0.75" y="0.75" width="30.5" height="16.5" rx="1.5" className="fmt__glyph-frame" />
      {id === 'lower' && <rect x="3" y="11.5" width="17" height="3.5" rx="0.6" />}
      {id === 'pip' && <rect x="18" y="3" width="11" height="7" rx="0.6" />}
      {id === 'spotlight' && <rect x="3" y="3" width="8" height="12" rx="0.6" />}
      {id === 'full' && <rect x="3" y="3" width="26" height="12" rx="0.6" />}
    </svg>
  )
}

/** The preview's format switcher: the template's four layouts; ones this graphic cannot carry say why. */
function FormatSwitch({ filled, template, picked, onPick, locked }: { filled: Filled; template: GraphicTemplate; picked: FormatId | null; onPick: (f: FormatId) => void; locked: boolean }) {
  const name = useId()
  const ok = formatAvailability(filled)
  const current = resolveFormat(filled, template, picked)
  const off = FORMAT_IDS.filter((id) => ok[id] !== null)
  const note = locked
    ? 'On air: the format is locked until the graphic comes off.'
    : `Format: ${template.formats[current].name.toLowerCase()}, ${template.formats[current].place.charAt(0).toLowerCase()}${template.formats[current].place.slice(1)}${off.length ? `. ${off.map((id) => `${template.formats[id].name}: ${ok[id]?.toLowerCase()}`).join('. ')}.` : '.'}`
  return (
    <fieldset className="fmt" disabled={locked}>
      <legend className="fmt__legend">Format</legend>
      <div className="fmt__opts">
        {FORMAT_IDS.map((id) => (
          <label key={id} className="fmt__opt" data-checked={current === id} data-off={ok[id] !== null}>
            <input type="radio" name={name} value={id} checked={current === id} disabled={ok[id] !== null} onChange={() => onPick(id)} />
            <FormatGlyph id={id} />
            <span>{template.formats[id].name}</span>
          </label>
        ))}
      </div>
      <p className="fmt__note">{note}</p>
    </fieldset>
  )
}

const TIMED_MS = 60_000

function PreviewTransport({ p, minuteOf, onAction }: { p: OverlayPacket | null; minuteOf: (ms: number) => string; onAction: OverlayAction }) {
  const [timed, setTimed] = useState(false)
  if (!p) return <div className="transport" data-kind="pvw" />
  const durationMs = timed ? TIMED_MS : null
  const held = !!p.on_hold && p.status !== 'retracted'
  const blocked = p.status === 'proposed' ? airBlock(p) : null
  return (
    <div className="transport" data-kind="pvw" data-status={held ? 'held' : p.status}>
      {p.status === 'proposed' ? (
        <>
          <div className="transport__actions" role="group" aria-label="Approve this graphic">
            <button type="button" className="btn btn--primary transport__take" disabled={!!blocked} onClick={() => onAction(p.id, 'approve', { cue: 'now', durationMs })}>
              {held ? 'Held by VAR' : 'Take to air now'}
            </button>
            <button type="button" className="btn" disabled={!!blocked} onClick={() => onAction(p.id, 'approve', { cue: 'next_stoppage', durationMs })}>
              At the next stoppage
            </button>
            <button type="button" className="btn" disabled={!!blocked} onClick={() => onAction(p.id, 'approve', { cue: 'delay', delayMs: 30_000, durationMs })}>
              In 30 seconds
            </button>
            <button type="button" className="btn btn--quiet transport__reject" onClick={() => onAction(p.id, 'reject')}>
              Reject
            </button>
          </div>
          <div className="transport__hold" role="radiogroup" aria-label="How long it stays on air">
            <button type="button" role="radio" aria-checked={!timed} className="chip-btn" onClick={() => setTimed(false)}>
              Until taken off
            </button>
            <button type="button" role="radio" aria-checked={timed} className="chip-btn" onClick={() => setTimed(true)}>
              For one match minute
            </button>
          </div>
          <p className="transport__note">{held ? 'A VAR check holds this goal graphic. It cannot be overridden: it clears only when the goal is confirmed.' : 'Nothing airs until you approve it.'}</p>
        </>
      ) : p.status === 'approved' ? (
        <>
          <p className="transport__state" data-tone="scheduled">
            <span className="transport__dot" aria-hidden="true" />
            {statusLine(p, minuteOf)}
          </p>
          <div className="transport__actions">
            <button type="button" className="btn btn--quiet" onClick={() => onAction(p.id, 'hide')}>
              Cancel the schedule
            </button>
          </div>
        </>
      ) : (
        <p className="transport__state" data-tone={p.status === 'on_screen' ? 'live' : p.status === 'retracted' ? 'against' : 'quiet'}>
          <span className="transport__dot" aria-hidden="true" />
          {p.status === 'on_screen' ? 'On air now: take it off from the programme monitor' : statusLine(p, minuteOf)}
        </p>
      )}
    </div>
  )
}

function ProgrammeTransport({
  onAir,
  next,
  cut,
  store,
  template,
  format,
  filled,
  minuteOf,
  onAction,
}: {
  onAir: OverlayPacket | null
  next: OverlayPacket | null
  cut: OverlayPacket | null
  store: MatchSessionStore
  template: GraphicTemplate
  format: FormatId | null
  filled: Filled | null
  minuteOf: (ms: number) => string
  onAction: OverlayAction
}) {
  const share = useOnAirShare(store, onAir)
  if (!onAir) {
    return (
      <div className="transport" data-kind="pgm" data-status="clean">
        <p className="transport__state" data-tone={cut ? 'against' : 'quiet'}>
          <span className="transport__dot" aria-hidden="true" />
          {cut ? (
            <span>
              Cut from air: <b>{cut.title}</b>. {cut.status === 'retracted' ? 'Its source was withdrawn by an official correction.' : 'A VAR check is reviewing the goal.'}
            </span>
          ) : next ? (
            <span>
              Clean programme · next: <b>{next.title}</b>, {statusLine(next, minuteOf).toLowerCase()}
            </span>
          ) : (
            'Clean programme: no graphic on air'
          )}
        </p>
      </div>
    )
  }
  return (
    <div className="transport" data-kind="pgm" data-status="live">
      <p className="transport__state" data-tone="live">
        <span className="transport__dot" aria-hidden="true" />
        On air · {filled ? template.families[filled.family] : 'graphic'}
        {format ? ` · ${template.formats[format].name.toLowerCase()}` : ''}
      </p>
      {onAir.display_for_ms == null ? (
        <span className="transport__hold-note">Until you take it off</span>
      ) : (
      <span className="transport__meter" aria-hidden="true">
        <i style={{ transform: `scaleX(${share})` }} />
      </span>
      )}
      <div className="transport__actions">
        <button type="button" className="btn btn--primary" onClick={() => onAction(onAir.id, 'hide')}>
          Take off air
        </button>
      </div>
    </div>
  )
}

/** Where the programme picture comes from and where it would go: stated plainly, because none of it is connected. */
function SignalPath({ template }: { template: GraphicTemplate }) {
  return (
    <ol className="sigpath" aria-label="Signal path in this demo">
      <li data-state="sim">
        <b>Picture in</b>
        <span>Simulated match from tracking data. A broadcaster&apos;s live feed would connect here.</span>
      </li>
      <li data-state="ok">
        <b>Graphics</b>
        <span>{template.name} template, filled by BYLINE, approved by you</span>
      </li>
      <li data-state="off">
        <b>Programme out</b>
        <span>Not connected</span>
      </li>
    </ol>
  )
}

export interface MonitorsProps {
  selected: OverlayPacket | null
  selectedFill: Filled | null
  onAir: OverlayPacket | null
  onAirFill: Filled | null
  airPhase: 'in' | 'out'
  next: OverlayPacket | null
  /** The last graphic a VAR check or an official correction pulled off air (cut, not mixed). */
  cut: OverlayPacket | null
  store: MatchSessionStore
  world: WorldIndex
  programme: ReactNode
  template: GraphicTemplate
  bug: BugData
  minuteOf: (ms: number) => string
  onAction: OverlayAction
  /** The producer's format for a graphic (by packet id). */
  formatOf: (id: string) => FormatId | null
  onFormat: (id: string, f: FormatId) => void
  /** WebGL clips are dropped while a modal covers the studio. */
  clips: boolean
  /** Draw the safe-area guides on both monitors. */
  guides: boolean
  /** Under the preview: everything about the selected graphic. */
  belowPreview?: ReactNode
  /** Under the programme: the graphics package. */
  belowProgramme?: ReactNode
}

/** How a tactical graphic carries its animated clip in a format: in the corner box, or under the whole frame. */
function clipPlacement(p: OverlayPacket | null, filled: Filled | null, template: GraphicTemplate, picked: FormatId | null, clips: boolean): 'pip' | 'full' | null {
  if (!clips || !p || !filled || p.template_id !== 'tactical_moment') return null
  const f = resolveFormat(filled, template, picked)
  return f === 'pip' ? 'pip' : f === 'full' ? 'full' : null
}

/** Preview and programme monitors, as a multiviewer pair with their transport controls. */
export function Monitors(props: MonitorsProps) {
  const { selected, selectedFill, onAir, onAirFill, airPhase, template, bug, world, store, clips, guides, formatOf } = props
  const pvwFormat = selected ? formatOf(selected.id) : null
  const pgmFormat = onAir ? formatOf(onAir.id) : null
  const pvwClip = clipPlacement(selected, selectedFill, template, pvwFormat, clips)
  const pgmClip = clipPlacement(onAir, onAirFill, template, pgmFormat, clips)
  const live = !!onAir && airPhase === 'in'
  const pgmShown = onAirFill ? resolveFormat(onAirFill, template, pgmFormat) : null
  const pvwClipAsset = pvwClip && selected ? <ClipAsset matchId={store.matchId} momentId={selected.source_id} world={world} /> : null
  const pgmClipAsset = pgmClip && onAir ? <ClipAsset matchId={store.matchId} momentId={onAir.source_id} world={world} /> : null
  return (
    <div className="monitors" data-guides={guides}>
      <figure className="monitor" data-kind="pvw" data-state={selected ? (selected.on_hold && selected.status !== 'retracted' ? 'held' : selected.status) : 'empty'}>
        <div className="monitor__head">
          <span className="monitor__tally" aria-hidden="true" />
          <span className="gframe__label">PREVIEW</span>
          <span className="monitor__src">{selectedFill ? template.families[selectedFill.family] : 'No graphic selected'}</span>
        </div>
        <GraphicFrame
          filled={selectedFill}
          template={template}
          background={pvwClip === 'full' ? pvwClipAsset : undefined}
          media={pvwClip === 'pip' ? pvwClipAsset : undefined}
          clip={pvwClip === 'full'}
          format={pvwFormat}
          bug={bug}
          guides={guides}
          mark
          slate={selected ? <Slate p={selected} /> : null}
          graphicKey={selected ? `${selected.id}:${template.id}:${pvwFormat ?? 'auto'}` : undefined}
        />
        {selected && selectedFill && (
          <FormatSwitch filled={selectedFill} template={template} picked={pvwFormat} onPick={(f) => props.onFormat(selected.id, f)} locked={selected.status === 'on_screen'} />
        )}
        <PreviewTransport p={selected} minuteOf={props.minuteOf} onAction={props.onAction} />
        <figcaption className="monitor__cap sr-only">{selected ? 'Preview: the graphic as it would air over the programme.' : 'Select a graphic in the rundown to preview it.'}</figcaption>
      </figure>
      <figure className="monitor" data-kind="pgm" data-live={live}>
        <div className="monitor__head">
          <span className="monitor__tally" aria-hidden="true" />
          <span className="gframe__label">{live ? 'PROGRAMME · ON AIR' : 'PROGRAMME'}</span>
          <span className="monitor__src">{onAirFill ? template.families[onAirFill.family] : 'Simulated feed · no graphic'}</span>
        </div>
        <div className="feed" data-phase={onAir ? airPhase : 'clean'} data-format={pgmShown ?? 'none'}>
          <GraphicFrame
            filled={onAirFill}
            template={template}
            background={
              <>
                {props.programme}
                {pgmClip === 'full' ? pgmClipAsset : null}
              </>
            }
            media={pgmClip === 'pip' ? pgmClipAsset : undefined}
            phase={airPhase}
            clip={pgmClip === 'full'}
            format={pgmFormat}
            bug={bug}
            guides={guides}
            mark
            graphicKey={onAir ? `${onAir.id}:${template.id}` : undefined}
          />
        </div>
        <ProgrammeTransport
          onAir={live ? onAir : null}
          next={props.next}
          cut={live ? null : props.cut}
          store={store}
          template={template}
          format={pgmShown}
          filled={onAirFill}
          minuteOf={props.minuteOf}
          onAction={props.onAction}
        />
        <figcaption className="monitor__cap">
          <SignalPath template={template} />
          <span className="monitor__sim">Demo output: simulated programme feed. No broadcast hardware or playout is connected.</span>
        </figcaption>
      </figure>
      <div className="monitors__below" data-kind="pvw">
        {props.belowPreview}
      </div>
      <div className="monitors__below" data-kind="pgm">
        {props.belowProgramme}
      </div>
    </div>
  )
}
