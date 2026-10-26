import type { ReactNode } from 'react'
import { GraphicFrame } from '../../components/Broadcast/Graphic'
import { filledList } from '../../components/Broadcast/fill'
import type { Filled } from '../../components/Broadcast/fill'
import { SIMULATED_NOTICE, SOURCE_DOT, SOURCE_LABEL, TEMPLATE_IDS, TEMPLATES } from '../../components/Broadcast/templates'
import type { GraphicTemplate, TemplateId } from '../../components/Broadcast/templates'
import { factCheck } from '../../components/Studio/factCheck'
import { VerifiedRead } from '../../components/Tactics/VerifiedRead'
import type { SessionSnapshot } from '../../services/matchSession'
import type { WorldIndex } from '../../services/matchView'
import type { OverlayPacket } from '../../services/schemas'
import { useTacticalInsight } from '../../services/tacticalInsight'
import type { SurfaceActions } from '../surfaceActions'
import { statusLine } from './studioModel'

/** Hex colours in a value are shown with their swatch. */
function withSwatches(value: string): ReactNode {
  const parts = value.split(/(#[0-9a-fA-F]{6})/)
  return parts.map((part, i) =>
    i % 2 === 1 ? (
      <span key={i} className="fill__swatch">
        <i style={{ background: part }} aria-hidden="true" />
        {part.toUpperCase()}
      </span>
    ) : (
      part
    ),
  )
}

/**
 * The graphics package: which broadcaster template dresses the output, previewed live with the selected
 * graphic, plus the monitors' safe-area guides. Everything here is a local simulation.
 */
export function TemplatePanel({
  filled,
  template,
  onTemplate,
  guides,
  onGuides,
}: {
  filled: Filled | null
  template: GraphicTemplate
  onTemplate: (id: TemplateId) => void
  guides: boolean
  onGuides: (on: boolean) => void
}) {
  return (
    <section className="tpl" aria-label="Graphics template">
      <div className="tpl__head">
        <h3 className="insp__h">Graphics template</h3>
        <button type="button" className="chip-btn tpl__safe" aria-pressed={guides} onClick={() => onGuides(!guides)}>
          Safe areas
        </button>
      </div>
      <div className="tpl__cards" role="radiogroup" aria-label="Graphics template">
        {TEMPLATE_IDS.map((id) => {
          const t = TEMPLATES[id]
          return (
            <label key={id} className="tpl__card" data-checked={template.id === id}>
              <input type="radio" name="graphics-template" value={id} checked={template.id === id} onChange={() => onTemplate(id)} />
              <span className="tpl__thumb" aria-hidden="true">
                <GraphicFrame filled={filled} template={t} phase="still" />
              </span>
              <span className="tpl__name">{t.sample ? `Sample partner template: ${t.name} (fictional)` : t.name}</span>
              <span className="tpl__by">{t.sample ? 'Supplied by a fictional partner' : 'BYLINE house package'}</span>
            </label>
          )
        })}
      </div>
      <p className="tpl__note">{template.note}</p>
      <ol className="tpl__flow" aria-label="How a template is filled">
        <li>The broadcaster supplies the template</li>
        <li>BYLINE fills its fields from verified data</li>
        <li>The producer approves each one before it airs</li>
      </ol>
      <p className="tpl__sim">{SIMULATED_NOTICE}</p>
    </section>
  )
}

/** The selected graphic: every field the template shows, its value and where it came from; then the checks. */
export function FillPanel({
  matchId,
  packet,
  filled,
  snap,
  world,
  minuteOf,
  template,
  actions,
  message,
}: {
  matchId: string
  packet: OverlayPacket
  filled: Filled
  snap: SessionSnapshot
  world: WorldIndex
  minuteOf: (ms: number) => string
  template: GraphicTemplate
  actions: SurfaceActions
  message: string | null
}) {
  const facts = factCheck(packet, snap.insights)
  const verified = useTacticalInsight(matchId, packet.source_kind === 'tactical' ? packet.source_id : null)
  const candidate = packet.source_kind === 'insight' ? packet.source_id.replace(/^I-/, '') : null
  const rule = typeof packet.data?.rule === 'string' && packet.data.rule ? packet.data.rule : null
  const list = filledList(filled)
  const player = packet.player_ids[0] ? world.players.get(packet.player_ids[0]) : undefined
  return (
    <section className="insp" aria-label="Selected graphic">
      <header className="insp__head">
        <h2 className="insp__title">{packet.title}</h2>
        {message && (
          <p className="insp__msg" role="status">
            {message}
          </p>
        )}
      </header>

      <h3 className="insp__h">
        Filled from verified data <span className="insp__h-aside">{list.length} fields bound to {template.name}</span>
      </h3>
      <table className="fill">
        <thead>
          <tr>
            <th scope="col">{template.sample ? 'Template field' : 'Field'}</th>
            <th scope="col">Value</th>
            <th scope="col">Source</th>
          </tr>
        </thead>
        <tbody>
          {list.map((f) => (
            <tr key={f.key} data-source={f.source}>
              <th scope="row">
                <span className="fill__slot" data-code={template.sample}>
                  {template.slots[f.key]}
                </span>
              </th>
              <td className="fill__value">{withSwatches(f.value)}</td>
              <td>
                <span className="provenance" data-source={SOURCE_DOT[f.source]}>
                  {SOURCE_LABEL[f.source]}
                </span>
                {f.ref && <span className="fill__ref numeric">{f.ref}</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <dl className="insp__checks">
        <div data-ok={facts.ai || !facts.text.startsWith('Detector')}>
          <dt>Facts</dt>
          <dd>{facts.text}</dd>
        </div>
        <div data-ok={packet.status === 'on_screen' || packet.status === 'approved'}>
          <dt>Air</dt>
          <dd>{statusLine(packet, minuteOf)}</dd>
        </div>
        <div>
          <dt>Evidence</dt>
          <dd>
            {packet.source_event_ids.length ? `Official events ${packet.source_event_ids.slice(0, 4).join(', ')}` : packet.source_kind === 'stats' ? 'Official match counts' : 'Knowledge base'}
            {rule ? ` · rule: ${rule}` : ''}
          </dd>
        </div>
      </dl>
      {packet.status_reason && (
        <p className="insp__reason" data-status={packet.status}>
          {packet.status_reason}
        </p>
      )}
      {verified && (
        <div className="insp__verified">
          <VerifiedRead data={verified} audience="studio" />
        </div>
      )}
      <div className="insp__links">
        {packet.source_kind === 'tactical' && (
          <button type="button" className="link-btn" onClick={() => actions.onOpenTactic(packet.source_id)}>
            Open the tactical evidence
          </button>
        )}
        {candidate && (
          <button type="button" className="link-btn" onClick={() => actions.onOpenEvidence(candidate)}>
            Open the agents&apos; evidence
          </button>
        )}
        {player && <span className="insp__player">{`${player.given_name} ${player.family_name} · #${player.shirt_number}`}</span>}
      </div>
    </section>
  )
}
