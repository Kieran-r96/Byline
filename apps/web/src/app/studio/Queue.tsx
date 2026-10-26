import { useState } from 'react'
import { GraphicFrame } from '../../components/Broadcast/Graphic'
import { familyOf } from '../../components/Broadcast/templates'
import type { FormatId, GraphicTemplate } from '../../components/Broadcast/templates'
import type { SessionSnapshot } from '../../services/matchSession'
import type { WorldIndex } from '../../services/matchView'
import type { OverlayPacket } from '../../services/schemas'
import { DONE, LANES, statusLine, useFill } from './studioModel'
import type { LaneKey } from './studioModel'

export interface QueueProps {
  packets: OverlayPacket[]
  selected: string | null
  onSelect: (id: string) => void
  minuteOf: (ms: number) => string
  snap: SessionSnapshot
  world: WorldIndex
  matchId: string
  template: GraphicTemplate
  /** The producer's layout per graphic, so each thumbnail shows the format it will air in. */
  formatOf?: (id: string) => FormatId | null
  /** Graphics sent from an analysis-desk package, with their place in it. */
  packageOrder?: Map<string, { label: string; rank: number }>
}

const StateGlyph = ({ lane }: { lane: LaneKey | 'done' }) => {
  switch (lane) {
    case 'air':
      return <span className="q__lamp" aria-hidden="true" />
    case 'next':
      return (
        <svg className="q__glyph" viewBox="0 0 16 16" aria-hidden="true">
          <circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <path d="M8 4.6V8l2.4 1.6" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      )
    case 'held':
      return (
        <svg className="q__glyph" viewBox="0 0 16 16" aria-hidden="true">
          <rect x="3.2" y="7" width="9.6" height="7" rx="1.4" fill="currentColor" />
          <path d="M5.4 7V5.3a2.6 2.6 0 0 1 5.2 0V7" fill="none" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      )
    case 'withdrawn':
      return (
        <svg className="q__glyph" viewBox="0 0 16 16" aria-hidden="true">
          <circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <path d="M3.8 12.2 12.2 3.8" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      )
    default:
      return null
  }
}

function Thumb({ p, snap, world, matchId, minuteOf, template, format }: { p: OverlayPacket; snap: SessionSnapshot; world: WorldIndex; matchId: string; minuteOf: (ms: number) => string; template: GraphicTemplate; format: FormatId | null }) {
  const filled = useFill(p, snap, world, matchId, minuteOf)
  return (
    <span className="q__thumb" aria-hidden="true">
      <GraphicFrame filled={filled} template={template} phase="still" format={format} />
    </span>
  )
}

function Item({ p, lane, props }: { p: OverlayPacket; lane: LaneKey | 'done'; props: QueueProps }) {
  const { selected, onSelect, minuteOf, template } = props
  const live = lane !== 'done'
  return (
    <li>
      <button
        type="button"
        className="q__item"
        aria-pressed={selected === p.id}
        data-status={p.on_hold && p.status !== 'retracted' ? 'held' : p.status}
        data-lane={lane}
        data-origin={p.origin ?? 'auto'}
        onClick={() => onSelect(p.id)}
      >
        <span className="q__minute numeric">{minuteOf(p.match_elapsed_ms)}</span>
        {live && <Thumb p={p} snap={props.snap} world={props.world} matchId={props.matchId} minuteOf={minuteOf} template={template} format={props.formatOf?.(p.id) ?? null} />}
        <span className="q__main">
          <span className="q__title">{p.title}</span>
          <span className="q__meta">
            <span className="q__family">{template.families[familyOf(p.template_id)]}</span>
            <span className="q__status">{statusLine(p, minuteOf)}</span>
            {props.packageOrder?.get(p.id) && <span className="q__pkg">{props.packageOrder.get(p.id)?.label}</span>}
          </span>
        </span>
        <StateGlyph lane={lane} />
      </button>
    </li>
  )
}

/** The rundown: lanes by air state, most urgent first, then the history. */
export function Queue(props: QueueProps) {
  const { packets } = props
  const [history, setHistory] = useState(false)
  const done = packets.filter((p) => DONE.has(p.status))
  return (
    <nav className="q" aria-label="Graphics queue">
      <p className="q__head">
        Rundown <span className="numeric">{packets.length - done.length}</span>
      </p>
      {LANES.map((lane) => {
        // graphics sent as a package keep the package's running order within their lane
        const rank = (id: string) => props.packageOrder?.get(id)?.rank ?? Infinity
        const items = packets.filter(lane.match).sort((a, b) => (rank(a.id) === Infinity && rank(b.id) === Infinity ? 0 : rank(a.id) - rank(b.id)))
        if (!items.length && !lane.empty) return null
        return (
          <section key={lane.key} className="q__lane" data-lane={lane.key} data-empty={!items.length}>
            <h2 className="q__lane-title">
              {lane.title} <span className="numeric q__count">{items.length || ''}</span>
            </h2>
            {items.length ? (
              <ul className="q__list">
                {items.map((p) => (
                  <Item key={p.id} p={p} lane={lane.key} props={props} />
                ))}
              </ul>
            ) : (
              <p className="q__empty">{lane.empty}</p>
            )}
          </section>
        )
      })}
      {done.length > 0 && (
        <section className="q__lane q__lane--history">
          <button type="button" className="q__history" aria-expanded={history} onClick={() => setHistory((v) => !v)}>
            {history ? 'Hide' : 'Show'} aired, expired and rejected <span className="numeric">({done.length})</span>
          </button>
          {history && (
            <ul className="q__list">
              {done.map((p) => (
                <Item key={p.id} p={p} lane="done" props={props} />
              ))}
            </ul>
          )}
        </section>
      )}
    </nav>
  )
}
