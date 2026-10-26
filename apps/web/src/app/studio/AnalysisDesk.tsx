import { useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import { GraphicFrame } from '../../components/Broadcast/Graphic'
import { formatAvailability, resolveFormat } from '../../components/Broadcast/formats'
import { FORMAT_IDS, TEMPLATES } from '../../components/Broadcast/templates'
import type { Family, FormatId, GraphicTemplate } from '../../components/Broadcast/templates'
import { TacticalStage } from '../../components/Stage/TacticalStage'
import { preMatch, signalText } from '../../services/commentary'
import type { MatchSessionStore, SessionSnapshot } from '../../services/matchSession'
import { playerLabel } from '../../services/matchView'
import type { WorldIndex } from '../../services/matchView'
import type { MomentView, OverlayPacket, PassOption, TacticalMoment } from '../../services/schemas'
import { useMomentView } from '../../services/useMomentView'
import type { SurfaceActions } from '../surfaceActions'
import { draftPacket, moveItem, useFill } from './studioModel'
import type { PackageItem, PackagePhase, Packages } from './studioModel'

const KIND_NAME: Record<string, string> = {
  option: 'Better option on',
  line_break: 'Line-breaking pass',
  overload: 'Overload',
  foul_stops_attack: 'Foul stops an attack',
  beaten: 'Defenders beaten',
  high_turnover: 'High turnover',
  between_lines: 'Between the lines',
  run: 'Run opens a lane',
  shape_change: 'Shape after a change',
  press: 'Pressing intensity',
  stretched: 'Lines stretched',
  response: 'Defensive response',
}

type Phase = PackagePhase

const PACKAGE_FAMILY: Record<PackageItem['kind'], Family> = { tactical: 'breakthrough', context: 'milestone', stats: 'comparison' }

function isFirstHalf(m: TacticalMoment, htMs: number | null): boolean {
  return htMs === null || m.at_ms <= htMs
}

/**
 * What happened against the measured alternatives, as a compact chart: one row per option, three
 * measured columns with bars scaled per column. The played option is solid chalk; the alternatives are
 * hypothetical, so they are lilac and dashed. Geometry only: no outcome is implied for an alternative.
 */
function Comparison({ view, world }: { view: MomentView; world: WorldIndex }) {
  const w = view.whatif
  if (!w) return null
  const intended = w.actual.option as PassOption | null
  const name = (id: string | null | undefined) => (id ? (world.players.get(id)?.family_name ?? id) : 'n/a')
  const alts = w.alternatives.slice(0, 2)
  const all = [intended, ...alts].filter((o): o is PassOption => !!o)
  const max = {
    lane: Math.max(1, ...all.map((o) => o.lane_clearance_m)),
    space: Math.max(1, ...all.map((o) => o.receiver_space_m)),
    gain: Math.max(1, ...all.map((o) => Math.abs(o.progression_m))),
  }
  const cell = (v: number | null, m: number, unit: string, sign = false) =>
    v == null ? (
      <td className="numeric">–</td>
    ) : (
      <td>
        <span className="cmp__cell">
          <span className="cmp__bar" aria-hidden="true">
            <i style={{ '--w': Math.max(0.04, Math.abs(v) / m) } as CSSProperties} />
          </span>
          <span className="numeric cmp__v">
            {sign && v > 0 ? '+' : ''}
            {unit === 'gain' ? Math.round(v) : v.toFixed(1)} m
          </span>
        </span>
      </td>
    )
  return (
    <section className="cmp" aria-label="What happened, and the measured alternatives">
      <div className="cmp__head">
        <h3 className="cmp__title">What happened, and the measured alternatives</h3>
        <p className="cmp__legend">
          <span data-kind="actual">Played</span>
          <span data-kind="hypo">Hypothetical</span>
        </p>
      </div>
      <table className="cmp__table">
        <thead>
          <tr>
            <th scope="col">Option</th>
            <th scope="col">Lane clear</th>
            <th scope="col">Space</th>
            <th scope="col">Ground gained</th>
          </tr>
        </thead>
        <tbody>
          <tr data-kind="actual">
            <th scope="row">
              <span className="cmp__name">{name(w.actual.receiver_id)}</span> <span className="cmp__tag">played · {w.actual.outcome ?? 'n/a'}</span>
            </th>
            {cell(intended?.lane_clearance_m ?? null, max.lane, 'lane')}
            {cell(intended?.receiver_space_m ?? null, max.space, 'space')}
            {cell(intended?.progression_m ?? null, max.gain, 'gain', true)}
          </tr>
          {alts.map((alt) => (
            <tr key={alt.receiver_id} data-kind="hypo">
              <th scope="row">
                <span className="cmp__name">{name(alt.receiver_id)}</span> <span className="cmp__tag cmp__tag--hypo">hypothetical · {alt.rating}</span>
              </th>
              {cell(alt.lane_clearance_m, max.lane, 'lane')}
              {cell(alt.receiver_space_m, max.space, 'space')}
              {cell(alt.progression_m, max.gain, 'gain', true)}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="fine">Geometry on the frozen frame only: no outcome or probability is implied for the alternatives.</p>
    </section>
  )
}

/** A package row's graphic: the production packet once sent, else a draft filled from the same session data. */
function RowGraphic({
  item,
  packet,
  snap,
  world,
  matchId,
  minuteOf,
  template,
  format,
  phase = 'still',
  mark = false,
}: {
  item: PackageItem
  packet: OverlayPacket | undefined
  snap: SessionSnapshot
  world: WorldIndex
  matchId: string
  minuteOf: (ms: number) => string
  template: GraphicTemplate
  format: FormatId | null
  phase?: 'in' | 'still'
  mark?: boolean
}) {
  const draft = useMemo(() => (packet ? null : draftPacket(item, snap, world)), [packet, item, snap, world])
  const filled = useFill(packet ?? draft, snap, world, matchId, minuteOf)
  if (!filled) return <span className="rundown__draft">No preview yet</span>
  return <GraphicFrame filled={filled} template={template} phase={phase} format={format} mark={mark} graphicKey={`${item.key}:${format ?? 'auto'}:${template.id}`} />
}

const PHASE_LABEL: Record<PackagePhase, string> = { pre: 'Pre-match', ht: 'Half-time', ft: 'Full-time' }

function rowState(item: PackageItem, packet: OverlayPacket | undefined): string {
  if (!packet) return item.sent ?? 'Draft · not sent yet'
  if (packet.status === 'retracted') return 'Withdrawn after a correction · cannot air'
  if (packet.on_hold) return 'In production · held by VAR'
  return `In production · ${packet.status === 'proposed' ? 'waiting for the producer' : packet.status === 'on_screen' ? 'on air now' : packet.status === 'approved' ? 'approved, scheduled' : packet.status === 'expired' ? 'expired' : packet.status === 'rejected' ? 'rejected by the producer' : 'taken off air'}`
}

/**
 * The package builder: a running order for one programme segment. Each item can be previewed in its
 * format, moved up or down, sent on its own or with the whole package. Sending only proposes: the
 * producer still approves every graphic, and a VAR hold or a correction still stops it airing.
 */
function PackageBuilder({
  phase,
  items,
  setItems,
  snap,
  world,
  store,
  template,
  minuteOf,
  formatOf,
  onFormat,
  onOpenInProduction,
  onAddStats,
}: {
  phase: PackagePhase
  items: PackageItem[]
  setItems: (fn: (p: PackageItem[]) => PackageItem[]) => void
  snap: SessionSnapshot
  world: WorldIndex
  store: MatchSessionStore
  template: GraphicTemplate
  minuteOf: (ms: number) => string
  formatOf: (id: string) => FormatId | null
  onFormat: (id: string, f: FormatId) => void
  onOpenInProduction: (packetId: string) => void
  onAddStats: (() => void) | null
}) {
  const [previewKey, setPreviewKey] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const preview = items.find((x) => x.key === previewKey) ?? items[0] ?? null
  const previewPacket = preview?.packetId ? snap.overlays[preview.packetId] : undefined
  const previewDraft = useMemo(() => (preview && !previewPacket ? draftPacket(preview, snap, world) : null), [preview, previewPacket, snap, world])
  const previewFill = useFill(previewPacket ?? previewDraft, snap, world, store.matchId, minuteOf)
  const fmtOf = (it: PackageItem) => (it.packetId ? (formatOf(it.packetId) ?? it.format ?? null) : (it.format ?? null))
  const unsent = items.filter((x) => !x.packetId)

  const setFormat = (it: PackageItem, f: FormatId) => {
    setItems((p) => p.map((x) => (x.key === it.key ? { ...x, format: f } : x)))
    if (it.packetId) onFormat(it.packetId, f)
  }
  const sendOne = async (it: PackageItem): Promise<boolean> => {
    const r = await store.proposeGraphic(it.kind, it.ref)
    if (r.id) {
      const id = r.id
      setItems((p) => p.map((x) => (x.key === it.key ? { ...x, sent: r.message, packetId: id } : x)))
      if (it.format) onFormat(id, it.format)
    }
    setMsg(r.message)
    return !!r.id
  }
  const sendAll = async () => {
    setBusy(true)
    let ok = 0
    for (const it of unsent) if (await sendOne(it)) ok += 1
    setBusy(false)
    setMsg(`Sent ${ok} of ${unsent.length} to the production queue, in running order. The producer approves each one.`)
  }
  const move = (i: number, by: -1 | 1) => setItems((p) => moveItem(p, i, by))

  return (
    <section className="adesk__pkg pkg" aria-label={`${PHASE_LABEL[phase]} package`}>
      <h3 className="adesk__h">
        {PHASE_LABEL[phase]} package <span className="numeric adesk__h-count">{items.length ? `${items.length} item${items.length > 1 ? 's' : ''}` : ''}</span>
      </h3>
      {items.length === 0 ? (
        <p className="adesk__pkg-empty">
          {phase === 'pre' ? 'Add records and context from the library.' : 'Add measured moments from the library, or a stats panel.'} Order them, preview each in its format, then send the package to production. A producer still approves every graphic.
        </p>
      ) : (
        <>
          {preview && (
            <div className="pkg__preview">
              <div className="pkg__monitor">
                <RowGraphic item={preview} packet={previewPacket} snap={snap} world={world} matchId={store.matchId} minuteOf={minuteOf} template={template} format={fmtOf(preview)} phase="in" mark />
              </div>
              <p className="pkg__caption">
                <b>{String(items.indexOf(preview) + 1).padStart(2, '0')}</b> {previewPacket ? 'As sent to production' : 'Draft preview, filled from the match data so far'}
              </p>
              {previewFill && (
                <div className="pkg__formats" role="radiogroup" aria-label={`Format for ${preview.title}`}>
                  {FORMAT_IDS.map((id) => {
                    const why = formatAvailability(previewFill)[id]
                    const on = resolveFormat(previewFill, template, fmtOf(preview)) === id
                    return (
                      <button key={id} type="button" role="radio" aria-checked={on} className="pkg__fmt" disabled={!!why || previewPacket?.status === 'on_screen'} title={why ?? template.formats[id].place} onClick={() => setFormat(preview, id)}>
                        {template.formats[id].name}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          )}
          <ol className="rundown" aria-label={`${PHASE_LABEL[phase]} running order`}>
            {items.map((item, i) => {
              const packet = item.packetId ? snap.overlays[item.packetId] : undefined
              const isPreview = preview?.key === item.key
              return (
                <li key={item.key} className="rundown__row" data-state={packet ? (packet.on_hold && packet.status !== 'retracted' ? 'held' : packet.status) : 'draft'} data-preview={isPreview}>
                  <span className="rundown__n numeric">{String(i + 1).padStart(2, '0')}</span>
                  <button type="button" className="rundown__thumb" aria-pressed={isPreview} onClick={() => setPreviewKey(item.key)}>
                    <span aria-hidden="true">
                      <RowGraphic item={item} packet={packet} snap={snap} world={world} matchId={store.matchId} minuteOf={minuteOf} template={template} format={fmtOf(item)} />
                    </span>
                    <span className="sr-only">Preview {item.title}</span>
                  </button>
                  <span className="rundown__main">
                    <span className="rundown__family">
                      {template.families[PACKAGE_FAMILY[item.kind]]}
                      {item.format ? ` · ${template.formats[item.format].name.toLowerCase()}` : ''}
                    </span>
                    <span className="rundown__title">{item.title}</span>
                    <span className="rundown__state">{rowState(item, packet)}</span>
                  </span>
                  <span className="rundown__order" role="group" aria-label={`Move ${item.title}`}>
                    <button type="button" className="rundown__move" aria-label={`Move ${item.title} up`} aria-disabled={i === 0} onClick={() => i > 0 && move(i, -1)}>
                      <svg viewBox="0 0 12 12" aria-hidden="true">
                        <path d="M6 2.5 L10.5 8.5 H1.5 Z" />
                      </svg>
                    </button>
                    <button type="button" className="rundown__move" aria-label={`Move ${item.title} down`} aria-disabled={i === items.length - 1} onClick={() => i < items.length - 1 && move(i, 1)}>
                      <svg viewBox="0 0 12 12" aria-hidden="true">
                        <path d="M6 9.5 L1.5 3.5 H10.5 Z" />
                      </svg>
                    </button>
                  </span>
                  <span className="rundown__actions">
                    {packet ? (
                      <button type="button" className="chip-btn" onClick={() => onOpenInProduction(packet.id)}>
                        Open in production
                      </button>
                    ) : (
                      <>
                        <button type="button" className="chip-btn rundown__send" disabled={busy} onClick={() => sendOne(item)}>
                          Send to production
                        </button>
                        <button type="button" className="chip-btn" onClick={() => setItems((p) => p.filter((x) => x.key !== item.key))} aria-label={`Remove ${item.title}`}>
                          Remove
                        </button>
                      </>
                    )}
                  </span>
                </li>
              )
            })}
          </ol>
        </>
      )}
      <div className="pkg__actions">
        {unsent.length > 0 && (
          <button type="button" className="btn btn--primary pkg__send" disabled={busy} onClick={sendAll}>
            Send package to production ({unsent.length})
          </button>
        )}
        {onAddStats && (
          <button type="button" className="btn btn--quiet adesk__stats" onClick={onAddStats}>
            Add a stats panel
          </button>
        )}
      </div>
      {msg && (
        <p className="adesk__msg" role="status">
          {msg}
        </p>
      )}
    </section>
  )
}

export function AnalysisDesk({
  store,
  snap,
  world,
  actions,
  pkgs,
  setPkgs,
  template = TEMPLATES.byline,
  minuteOf = () => '',
  formatOf = () => null,
  onFormat = () => {},
  onOpenInProduction = () => {},
}: {
  store: MatchSessionStore
  snap: SessionSnapshot
  world: WorldIndex
  actions: SurfaceActions
  /** One running order per segment (pre-match, half-time, full-time). */
  pkgs: Packages
  setPkgs: (fn: (p: Packages) => Packages) => void
  /** The graphics package the production desk is using (for previews). */
  template?: GraphicTemplate
  minuteOf?: (ms: number) => string
  formatOf?: (packetId: string) => FormatId | null
  onFormat?: (packetId: string, f: FormatId) => void
  onOpenInProduction?: (packetId: string) => void
}) {
  const ht = snap.keyEvents.find((e) => e.type === 'period.ended' && e.period === 'H1')
  const htMs = ht ? ht.elapsed_ms : null
  const finished = !!snap.state?.finished
  const [phase, setPhase] = useState<Phase>(finished ? 'ft' : htMs !== null ? 'ht' : 'pre')
  const [kind, setKind] = useState<string>('all')
  const moments = useMemo(() => Object.values(snap.tactics).sort((a, b) => a.at_ms - b.at_ms), [snap.tactics])
  const inPhase = moments.filter((m) => (phase === 'ht' ? isFirstHalf(m, htMs) : phase === 'ft' ? true : false))
  const shown = inPhase.filter((m) => kind === 'all' || m.kind === kind)
  const [selId, setSel] = useState<string | null>(null)
  const sel = (selId ? snap.tactics[selId] : undefined) ?? shown.find((m) => m.kind === 'option') ?? shown[0] ?? null
  const { view } = useMomentView(store.matchId, sel?.moment_id ?? null)
  const [included, setIncluded] = useState<Record<string, boolean>>({})
  const kinds = [...new Set(inPhase.map((m) => m.kind))]
  const notes = preMatch(Object.values(snap.signals))

  const pkg = pkgs[phase]
  const setPkg = (fn: (p: PackageItem[]) => PackageItem[]) => setPkgs((all) => ({ ...all, [phase]: fn(all[phase]) }))
  const add = (item: PackageItem) => setPkg((p) => (p.some((x) => x.key === item.key) ? p : [...p, { ...item, format: item.format ?? template.defaultFormat[PACKAGE_FAMILY[item.kind]] }]))

  const phaseLabel: Record<Phase, string> = { pre: 'Pre-match', ht: 'Half-time', ft: 'Full-time' }
  const available: Record<Phase, boolean> = { pre: true, ht: htMs !== null, ft: finished }
  const ticked = sel ? sel.observed.filter((_, i) => included[`${sel.moment_id}:${i}`]).length : 0

  return (
    <div className="adesk">
      <aside className="adesk__lib" aria-label="Analysis library">
        <div className="adesk__phases" role="tablist" aria-label="Programme segment">
          {(['pre', 'ht', 'ft'] as Phase[]).map((p) => (
            <button key={p} type="button" role="tab" aria-selected={phase === p} onClick={() => setPhase(p)} data-ready={available[p]}>
              {phaseLabel[p]}
            </button>
          ))}
        </div>
        {phase === 'pre' ? (
          <>
            <p className="adesk__hint">Build the pre-match package from the fictional history: form, head to head, managers, the venue.</p>
            <ul className="adesk__notes">
              {notes.map((s) => (
                <li key={s.signal_id}>
                  <p className="adesk__note-head">{s.headline.charAt(0) + s.headline.slice(1).toLowerCase()}</p>
                  <p className="adesk__note">{signalText(s, 'studio')}</p>
                  <button type="button" className="chip-btn" onClick={() => add({ key: s.signal_id, kind: 'context', ref: s.signal_id, title: signalText(s, 'studio') })}>
                    Add to package
                  </button>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <>
            {!available[phase] && <p className="adesk__hint">{phase === 'ht' ? 'The first half has not finished yet: this shows everything so far.' : 'The match is still on: this shows everything so far.'}</p>}
            <label className="adesk__filter">
              <span>Show</span>
              <select value={kind} onChange={(e) => setKind(e.target.value)}>
                <option value="all">All measured moments ({inPhase.length})</option>
                {kinds.map((k) => (
                  <option key={k} value={k}>
                    {KIND_NAME[k] ?? k} ({inPhase.filter((m) => m.kind === k).length})
                  </option>
                ))}
              </select>
            </label>
            <ol className="adesk__list">
              {shown.map((m) => {
                const team = m.team_id ? world.teams.get(m.team_id) : undefined
                const queued = pkg.some((x) => x.key === m.moment_id)
                return (
                  <li key={m.moment_id}>
                    <button type="button" className="adesk__item" aria-pressed={sel?.moment_id === m.moment_id} onClick={() => setSel(m.moment_id)} style={{ '--kit': team?.kit.primary ?? '#888' } as CSSProperties}>
                      <span className="numeric adesk__clock">{m.display_clock}</span>
                      <span className="adesk__item-main">
                        <span className="adesk__kind">
                          {KIND_NAME[m.kind] ?? m.kind}
                          {m.whatif ? <span className="adesk__has-whatif"> · what if</span> : null}
                        </span>
                        <span className="adesk__item-title">{m.title}</span>
                      </span>
                      {queued && (
                        <span className="adesk__in-pkg">
                          <span className="sr-only">In the package</span>
                        </span>
                      )}
                    </button>
                  </li>
                )
              })}
              {shown.length === 0 && <li className="empty-line">Measured moments appear as the match is played.</li>}
            </ol>
          </>
        )}
      </aside>

      <section className="adesk__stage" aria-label="Breakdown">
        {phase !== 'pre' && sel ? (
          <>
            <div className="adesk__stage-head">
              <div>
                <p className="adesk__kind">
                  {KIND_NAME[sel.kind] ?? sel.kind} · <span className="numeric">{sel.display_clock}</span> · measured from tracking
                </p>
                <h2 className="adesk__title">{sel.title}</h2>
              </div>
              <div className="adesk__stage-actions">
                <button type="button" className="btn btn--quiet" onClick={() => actions.onOpenTactic(sel.moment_id)}>
                  Open full screen
                </button>
                <button type="button" className="btn btn--primary" onClick={() => add({ key: sel.moment_id, kind: 'tactical', ref: sel.moment_id, title: sel.title })}>
                  Add to package
                </button>
              </div>
            </div>
            <div className="adesk__pitch">
              {view ? <TacticalStage key={view.moment_id} matchId={store.matchId} view={view} world={world} audience="pro" /> : <div className="adesk__pitch-wait">Loading the frame…</div>}
            </div>
            {view && <Comparison view={view} world={world} />}
          </>
        ) : phase === 'pre' ? (
          <div className="adesk__pre">
            <h2 className="adesk__title">Pre-match package</h2>
            <p className="empty-line">Pick the context you want on air before kick-off. Every line is computed from the synthetic club history, with its rule attached.</p>
          </div>
        ) : (
          <p className="empty-block">Pick a moment from the library to break it down.</p>
        )}
      </section>

      <aside className="adesk__compose" aria-label="Package and talking points">
        <PackageBuilder
          key={phase}
          phase={phase}
          items={pkg}
          setItems={setPkg}
          snap={snap}
          world={world}
          store={store}
          template={template}
          minuteOf={minuteOf}
          formatOf={formatOf}
          onFormat={onFormat}
          onOpenInProduction={onOpenInProduction}
          onAddStats={phase !== 'pre' ? () => add({ key: `stats-${phase}`, kind: 'stats', title: `${phaseLabel[phase]} stats panel` }) : null}
        />

        {phase !== 'pre' && sel && (
          <section className="adesk__points">
            <h3 className="adesk__h">
              Talking points <span className="numeric adesk__h-count">{ticked ? `${ticked} ticked` : ''}</span>
            </h3>
            <p className="fine adesk__fine">Measured on the frozen frame. Tick what you will use.</p>
            <ul className="adesk__facts">
              {sel.observed.map((o, i) => {
                const key = `${sel.moment_id}:${i}`
                const label = String((o as Record<string, unknown>).label ?? '')
                const value = (o as Record<string, unknown>).value
                const unit = String((o as Record<string, unknown>).unit ?? '')
                return (
                  <li key={key}>
                    <label>
                      <input type="checkbox" checked={!!included[key]} onChange={(e) => setIncluded((s) => ({ ...s, [key]: e.target.checked }))} />
                      <span className="adesk__fact-label">{label}</span>
                      <strong className="numeric adesk__fact-v">
                        {typeof value === 'number' ? (Number.isInteger(value) ? value : value.toFixed(1)) : String(value)}
                        {unit ? ` ${unit}` : ''}
                      </strong>
                    </label>
                  </li>
                )
              })}
            </ul>
            <p className="adesk__interp">{sel.interpretation}</p>
            {sel.unknowns.length > 0 && (
              <div className="adesk__unknown">
                <p className="adesk__unknown-h">What the data cannot show</p>
                <ul>
                  {sel.unknowns.map((u) => (
                    <li key={u}>{u}</li>
                  ))}
                </ul>
              </div>
            )}
            {sel.focus_player_ids.length > 0 && <p className="fine">Players: {sel.focus_player_ids.map((id) => playerLabel(world, id)).join(', ')}</p>}
          </section>
        )}
      </aside>
    </div>
  )
}
