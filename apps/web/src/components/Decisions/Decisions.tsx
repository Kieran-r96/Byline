import { useState } from 'react'
import { compactParts, kindTone } from '../../services/decisionView'
import type { Decision } from '../../services/schemas'
import type { TeamId } from '../../types/shell'
import { Crest } from '../brand/Crest'
import './Decisions.css'

/**
 * Law-grounded decision explainers (T011). Deterministic, sourced from the
 * official synthetic decision events; BYLINE explains, it never officiates.
 */

function asTeam(id: string | null): TeamId | null {
  return id === 'NBA' || id === 'RVC' ? id : null
}

export function KindLabel({ decision }: { decision: Decision }) {
  const tone = kindTone(decision.kind)
  return (
    <span className={`kind kind--${tone}`}>
      <span className="kind__glyph" aria-hidden="true" />
      {decision.kind}
      {decision.provisional && <span className="kind__pending">Provisional</span>}
    </span>
  )
}

export interface DecisionCardProps {
  decision: Decision
  expanded: boolean
  onToggle: () => void
  used: boolean
  onToggleUsed?: () => void
  /** Show the Mark used control (Commentator). */
  showUsed?: boolean
  onSeekEvent?: (eventId: string) => void
  highlight?: boolean
}

export function DecisionCard({
  decision: d,
  expanded,
  onToggle,
  used,
  onToggleUsed,
  showUsed = true,
  highlight = false,
}: DecisionCardProps) {
  const team = asTeam(d.team_id)
  const bodyId = `dec-${d.decision_id}`
  return (
    <article
      className="decision"
      data-major={d.importance === 'major'}
      data-provisional={d.provisional}
      data-used={used}
      data-highlight={highlight}
      aria-labelledby={`${bodyId}-h`}
    >
      <header className="decision__meta">
        <KindLabel decision={d} />
        <span className="decision__clock numeric">{d.clock}</span>
        {team && <Crest teamId={team} size={20} label="" />}
      </header>
      <h3 className="decision__headline" id={`${bodyId}-h`}>
        {d.headline}
      </h3>
      <p className="decision__line">
        {compactParts(d).map((part, i) => (
          <span key={part}>
            {i > 0 && (
              <span className="decision__sep" aria-hidden="true">
                {' | '}
              </span>
            )}
            {part}
            {i < 3 && <span className="sr-only">.</span>}
          </span>
        ))}
      </p>
      <div className="decision__actions">
        <button
          type="button"
          className="decision__why"
          aria-expanded={expanded}
          aria-controls={bodyId}
          onClick={onToggle}
        >
          Why that decision?
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" className="decision__chev">
            <path d="M3 4.5 6 7.5 9 4.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </button>
        {showUsed && onToggleUsed && (
          <button type="button" className="decision__used" aria-pressed={used} onClick={onToggleUsed}>
            {used ? 'Used' : 'Mark used'}
          </button>
        )}
      </div>
      <div className="decision__explainer" id={bodyId} hidden={!expanded}>
        <p className="decision__label">
          <span className="decision__label-chip">Law-grounded explanation</span>
          <span>{d.ruleset_version}</span>
        </p>
        <ol className="decision__steps">
          <li>
            <span className="decision__step-n" aria-hidden="true">
              1
            </span>
            <div>
              <h4>What happened</h4>
              <p>{d.what_happened}</p>
            </div>
          </li>
          <li>
            <span className="decision__step-n" aria-hidden="true">
              2
            </span>
            <div>
              <h4>Which rule applies</h4>
              <ul className="decision__rules">
                {d.which_rule.map((r, i) => (
                  <li key={`${r.law}-${i}`}>
                    <strong>{r.title}</strong>
                    <span>{r.point}</span>
                    <a href={r.url} target="_blank" rel="noreferrer noopener">
                      Read {r.law} (IFAB)<span className="sr-only">, opens in a new tab</span>
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          </li>
          <li>
            <span className="decision__step-n" aria-hidden="true">
              3
            </span>
            <div>
              <h4>What changes now</h4>
              <p>{d.what_changes}</p>
            </div>
          </li>
        </ol>
        {d.caveats.length > 0 && (
          <ul className="decision__caveats" aria-label="Caveats">
            {d.caveats.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        )}
        <p className="decision__sources">
          Official events:{' '}
          {d.source_event_ids.map((id) => (
            <span key={id} className="decision__eid">
              {id}
            </span>
          ))}
        </p>
        <p className="decision__disclaimer">{d.disclaimer}</p>
      </div>
    </article>
  )
}

export interface DecisionsPanelProps {
  decisions: readonly Decision[]
  used: Readonly<Record<string, number>>
  onToggleUsed?: (id: string) => void
  showUsed?: boolean
  /** Expand this card (e.g. opened from a live callout). */
  focusId?: string | null
  /** Only major decisions (Fan Discover). */
  majorOnly?: boolean
}

export function DecisionsPanel({ decisions, used, onToggleUsed, showUsed = true, focusId = null, majorOnly = false }: DecisionsPanelProps) {
  const [open, setOpen] = useState<string | null>(focusId)
  const [prevFocus, setPrevFocus] = useState(focusId)
  if (focusId !== prevFocus) {
    setPrevFocus(focusId)
    if (focusId) setOpen(focusId)
  }
  const [filter, setFilter] = useState<'major' | 'all'>('major')
  const shown = [...decisions]
    .reverse()
    .filter((d) => (majorOnly || filter === 'major' ? d.importance === 'major' : true))

  if (decisions.length === 0) {
    return (
      <div className="decisions-empty">
        <h3>No official decisions yet</h3>
        <p>Cards, offsides, penalties and VAR checks appear here with a law-grounded explanation.</p>
      </div>
    )
  }

  return (
    <div className="decisions">
      {!majorOnly && (
        <div className="decisions__filter" role="group" aria-label="Filter decisions">
          <button type="button" aria-pressed={filter === 'major'} onClick={() => setFilter('major')}>
            Major <span className="numeric">{decisions.filter((d) => d.importance === 'major').length}</span>
          </button>
          <button type="button" aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>
            All <span className="numeric">{decisions.length}</span>
          </button>
        </div>
      )}
      <div className="decisions__list">
        {shown.map((d) => (
          <DecisionCard
            key={d.decision_id}
            decision={d}
            expanded={open === d.decision_id}
            onToggle={() => setOpen((cur) => (cur === d.decision_id ? null : d.decision_id))}
            used={!!used[d.decision_id]}
            onToggleUsed={onToggleUsed ? () => onToggleUsed(d.decision_id) : undefined}
            showUsed={showUsed}
            highlight={focusId === d.decision_id}
          />
        ))}
      </div>
    </div>
  )
}

/** Live prompt over the theatre when a major decision lands. */
export function DecisionCallout({ decision, onOpen, onDismiss }: { decision: Decision; onOpen: () => void; onDismiss: () => void }) {
  return (
    <div className="decision-callout" role="status">
      <KindLabel decision={decision} />
      <button type="button" className="decision-callout__open" onClick={onOpen}>
        Why that decision?
      </button>
      <button type="button" className="decision-callout__close" onClick={onDismiss} aria-label="Dismiss decision prompt">
        <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  )
}
