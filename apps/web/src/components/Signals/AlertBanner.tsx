import type { Signal } from '../../services/schemas'
import type { TeamId } from '../../types/shell'
import { Crest } from '../brand/Crest'
import './AlertBanner.css'

const KICKER: Record<string, string> = {
  goal: 'Goal', card: 'Card', substitution: 'Substitution', var: 'VAR', penalty: 'Penalty', milestone: 'Milestone',
  record: 'Record', context: 'Did you know?',
}

/**
 * Broadcast-style plate for a live alert: brief, dismissible, top-left of the pitch so it never covers the
 * goalmouth or the decision prompt. Corrections (VAR) re-use the same plate in their corrected wording.
 */
export function AlertBanner({ signal, audience, onDismiss, onOpen }: {
  signal: Signal
  audience: 'commentator' | 'fan'
  onDismiss: () => void
  onOpen?: () => void
}) {
  const team: TeamId | null = signal.team_id === 'NBA' || signal.team_id === 'RVC' ? signal.team_id : null
  const text = signal.text[audience] ?? signal.text.commentator ?? ''
  const headline = signal.headline.replace(/^(GOAL|NO GOAL|VAR CHECK|YELLOW CARD|RED CARD|SUBSTITUTION|SECOND YELLOW · SENT OFF) · /, '')
  const kicker = signal.status === 'corrected' && signal.kind === 'goal' ? 'No goal' : signal.headline.startsWith('VAR CHECK') ? 'VAR check' : (KICKER[signal.kind] ?? 'Alert')
  return (
    <div className="alert-plate" role="status" data-kind={signal.kind} data-status={signal.status} key={`${signal.signal_id}-${signal.version}`}>
      <span className="alert-plate__edge" aria-hidden="true" />
      <div className="alert-plate__body">
        <p className="alert-plate__kicker">
          {team && <Crest teamId={team} size={16} label="" />}
          {kicker}
          <span className="numeric">{signal.display_clock}</span>
        </p>
        <p className="alert-plate__headline">{headline}</p>
        {text && text !== signal.headline && <p className="alert-plate__text">{text}</p>}
      </div>
      <div className="alert-plate__actions">
        {onOpen && (
          <button type="button" onClick={onOpen}>
            More
          </button>
        )}
        <button type="button" onClick={onDismiss} aria-label="Dismiss alert" className="alert-plate__close">
          <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>
      </div>
    </div>
  )
}
