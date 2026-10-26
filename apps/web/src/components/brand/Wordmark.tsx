import './Wordmark.css'

export interface WordmarkProps {
  /** Hide the "MATCH INTELLIGENCE" line (compact headers). */
  compact?: boolean
  className?: string
}

/**
 * Original BYLINE wordmark: tracked geometric capitals sitting on a hairline
 * baseline that breaks upward into a short diagonal, like a line run off the
 * byline. The diagonal is the only gold in the header.
 */
export function Wordmark({ compact = false, className }: WordmarkProps) {
  return (
    <span
      className={['wordmark', compact ? 'wordmark--compact' : '', className ?? ''].join(' ').trim()}
      role="img"
      aria-label="BYLINE Match Intelligence"
    >
      <span className="wordmark__word" aria-hidden="true">
        BYLINE
      </span>
      <svg
        className="wordmark__rule"
        viewBox="0 0 120 8"
        preserveAspectRatio="none"
        aria-hidden="true"
        focusable="false"
      >
        <path d="M0 7.25H104" stroke="currentColor" strokeWidth="1" vectorEffect="non-scaling-stroke" />
        <path
          className="wordmark__kick"
          d="M106.5 7.25L114 0.75"
          strokeWidth="1.75"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      {!compact && (
        <span className="wordmark__sub" aria-hidden="true">
          Match Intelligence
        </span>
      )}
    </span>
  )
}
