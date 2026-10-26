import './StoryRadar.css'

export interface StoryRadarEmptyProps {
  /** First story with a recorded real verified AI run, if the match has one (from /showcase). */
  firstStory?: { clock: string; label: string } | null
  onJumpFirstStory?: () => void
  /** Under live storylines: only the demo shortcut, no full empty state. */
  compact?: boolean
}

/**
 * Story Radar empty state: says what is happening, offers one useful action, invents nothing.
 */
export function StoryRadarEmpty({ firstStory, onJumpFirstStory, compact = false }: StoryRadarEmptyProps) {
  if (compact) {
    return firstStory && onJumpFirstStory ? (
      <button type="button" className="radar-empty__jump radar-empty__jump--compact" onClick={onJumpFirstStory}>
        Jump to the first AI-verified story
        <span className="radar-empty__jump-meta numeric">
          {firstStory.label} · {firstStory.clock}
        </span>
      </button>
    ) : null
  }
  return (
    <div className="radar-empty">
      <svg className="radar-empty__art" width="96" height="96" viewBox="0 0 112 112" aria-hidden="true">
        <circle cx="56" cy="56" r="52" />
        <circle cx="56" cy="56" r="36" />
        <circle cx="56" cy="56" r="20" />
        <path d="M56 4v104M4 56h104" className="radar-empty__cross" />
        <path d="M56 56 92.8 19.2" className="radar-empty__sweep" />
        <circle cx="56" cy="56" r="3" className="radar-empty__hub" />
      </svg>

      <h3 className="radar-empty__title">Watching the match</h3>
      <p className="radar-empty__body">A story appears when the events show a pattern strong enough to evidence.</p>

      {firstStory && onJumpFirstStory && (
        <button type="button" className="radar-empty__jump" onClick={onJumpFirstStory}>
          Jump to the first AI-verified story
          <span className="radar-empty__jump-meta numeric">
            {firstStory.label} · {firstStory.clock}
          </span>
        </button>
      )}
    </div>
  )
}
