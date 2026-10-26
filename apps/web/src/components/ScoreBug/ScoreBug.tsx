import type { CSSProperties } from 'react'
import { PERIOD_SPOKEN } from '../../types/shell'
import type { ScoreBugData, ScoreBugSide } from '../../types/shell'
import { Crest } from '../brand/Crest'
import { TEAMS } from '../brand/teams'
import './ScoreBug.css'

export type ScoreBugProps = ScoreBugData & {
  /** "compact" drops crest sizes for narrow headers. */
  variant?: 'default' | 'compact'
  className?: string
  /** When given, each crest is a button that opens that club's file. */
  onCrest?: (teamId: ScoreBugSide['teamId']) => void
}

function Side({ side, align, crestSize, onCrest }: { side: ScoreBugSide; align: 'home' | 'away'; crestSize: number; onCrest?: (teamId: ScoreBugSide['teamId']) => void }) {
  const kit = TEAMS[side.teamId].primary
  return (
    <div className={`scorebug__side scorebug__side--${align}`}>
      {onCrest ? (
        <button type="button" className="scorebug__crest" aria-label={`${side.name} club file`} onClick={() => onCrest(side.teamId)}>
          <Crest teamId={side.teamId} size={crestSize} label="" />
        </button>
      ) : (
        <Crest teamId={side.teamId} size={crestSize} label="" />
      )}
      <span className="scorebug__code" aria-hidden="true" style={{ '--kit': kit } as CSSProperties}>
        {side.shortName}
      </span>
    </div>
  )
}

/**
 * Broadcast score bug: crest + code | score | code + crest, then clock/period.
 * Renders purely from props. Kit colour appears only as a thin flag.
 * While a goal is provisional the affected digit is outlined and a CHECKING
 * tag replaces the period, so a provisional goal never reads as confirmed.
 */
export function ScoreBug({
  home,
  away,
  clock,
  period,
  checking = false,
  varReview = false,
  provisionalSide = null,
  variant = 'default',
  className,
  onCrest,
}: ScoreBugProps) {
  const crestSize = variant === 'compact' ? 26 : 30
  const status = varReview
    ? 'VAR check in progress, score not confirmed'
    : checking
      ? 'goal awaiting confirmation'
      : PERIOD_SPOKEN[period]
  // Spoken summary changes only when score/period changes (not every clock tick).
  const summary = `${home.name} ${home.score}, ${away.name} ${away.score}. ${status}.`

  return (
    <div
      className={['scorebug', `scorebug--${variant}`, className ?? ''].join(' ').trim()}
      role="group"
      aria-label="Score"
      data-checking={checking}
    >
      <span className="sr-only" aria-live="polite">
        {summary}
      </span>
      <div className="scorebug__plate" aria-hidden={onCrest ? undefined : true}>
        <Side side={home} align="home" crestSize={crestSize} onCrest={onCrest} />
        <div className="scorebug__score numeric" aria-hidden="true">
          <span className={provisionalSide === 'home' ? 'scorebug__digit--provisional' : undefined}>{home.score}</span>
          <span className="scorebug__dash" />
          <span className={provisionalSide === 'away' ? 'scorebug__digit--provisional' : undefined}>{away.score}</span>
        </div>
        <Side side={away} align="away" crestSize={crestSize} onCrest={onCrest} />
      </div>
      <div className="scorebug__time" aria-hidden="true">
        <span className="scorebug__clock numeric">{clock}</span>
        {varReview ? (
          <span className="scorebug__period scorebug__period--checking">VAR CHECK</span>
        ) : checking ? (
          <span className="scorebug__period scorebug__period--checking">CONFIRMING</span>
        ) : (
          <span className="scorebug__period">{period}</span>
        )}
      </div>
    </div>
  )
}
