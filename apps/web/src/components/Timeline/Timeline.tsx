import { useId, useState } from 'react'
import type { CSSProperties } from 'react'
import type { TimelineMarker, TimelineMarkerKind, TimelineTick } from '../../types/shell'
import { MARKER_LABEL, formatMatchMinute } from '../../lib/format'
import { TEAMS } from '../brand/teams'
import './Timeline.css'

export interface TimelineProps {
  markers: readonly TimelineMarker[]
  /** Full match length in seconds (default 90 minutes). */
  durationSeconds?: number
  /** Current playhead in seconds, if a replay is loaded. */
  positionSeconds?: number
  onSeek: (seconds: number, marker: TimelineMarker) => void
  /** Custom tick labels (e.g. aligned to real period starts). */
  ticks?: readonly TimelineTick[]
  /** Where the half-time divider sits; defaults to the middle. */
  halfAtSeconds?: number
  className?: string
}

const DEFAULT_TICKS: TimelineTick[] = [0, 15, 30, 45, 60, 75, 90].map((m) => ({
  atSeconds: m * 60,
  label: m === 45 ? 'HT' : m === 0 ? 'KO' : m === 90 ? 'FT' : `${m}'`,
}))

function MarkerGlyph({ kind }: { kind: TimelineMarkerKind }) {
  // Shape differs per kind so meaning never depends on colour alone.
  switch (kind) {
    case 'goal':
      return <circle cx="6" cy="6" r="4.25" />
    case 'yellow':
    case 'red':
      return <rect x="3.25" y="1.75" width="5.5" height="8.5" rx="1" />
    case 'var':
      return <rect x="1.75" y="2.75" width="8.5" height="6.5" rx="1.5" />
    case 'penalty':
      return <path d="M6 1.5 10.5 6 6 10.5 1.5 6Z" />
    case 'story':
      return <path d="M6 1.25 7.4 4.6l3.35.2-2.6 2.15.85 3.3L6 8.4 3 10.25l.85-3.3-2.6-2.15 3.35-.2Z" />
  }
}

/**
 * Thin match timeline. Markers are real buttons (Tab reachable) with a
 * tooltip on hover and focus; activating one calls onSeek with its time.
 */
export function Timeline({
  markers,
  durationSeconds = 90 * 60,
  positionSeconds,
  onSeek,
  ticks,
  halfAtSeconds,
  className,
}: TimelineProps) {
  const [active, setActive] = useState<string | null>(null)
  const tooltipBase = useId()
  const pct = (s: number) => `${Math.min(100, Math.max(0, (s / durationSeconds) * 100))}%`

  return (
    <div className={['timeline', className ?? ''].join(' ').trim()}>
      <div className="timeline__track" role="group" aria-label="Match timeline">
        <div className="timeline__rail" aria-hidden="true">
          <span
            className="timeline__half"
            style={{ left: halfAtSeconds === undefined ? '50%' : pct(halfAtSeconds) }}
          />
          {positionSeconds !== undefined && (
            <span className="timeline__progress" style={{ width: pct(positionSeconds) }} />
          )}
        </div>

        {markers.length === 0 && (
          <p className="timeline__empty">Key moments appear here as they happen.</p>
        )}

        <ul className="timeline__markers">
          {markers.map((marker) => {
            const label = MARKER_LABEL[marker.kind]
            const minute = marker.minuteLabel ?? formatMatchMinute(marker.atSeconds)
            const tooltipId = `${tooltipBase}-${marker.id}`
            const isActive = active === marker.id
            const kit = marker.teamId ? TEAMS[marker.teamId].primary : undefined
            const fraction = marker.atSeconds / durationSeconds
            const edge = fraction < 0.15 ? 'start' : fraction > 0.85 ? 'end' : 'mid'
            return (
              <li
                key={marker.id}
                className="timeline__marker-item"
                data-lane={marker.kind === 'story' ? 'story' : 'event'}
                style={{ left: pct(marker.atSeconds) }}
              >
                <button
                  type="button"
                  className={`timeline__marker timeline__marker--${marker.kind}`}
                  style={kit ? ({ '--kit': kit } as CSSProperties) : undefined}
                  aria-label={`${label}, ${minute}: ${marker.title}. Jump to moment`}
                  aria-describedby={isActive ? tooltipId : undefined}
                  data-kind={marker.kind}
                  onClick={() => onSeek(marker.atSeconds, marker)}
                  onMouseEnter={() => setActive(marker.id)}
                  onMouseLeave={() => setActive((cur) => (cur === marker.id ? null : cur))}
                  onFocus={() => setActive(marker.id)}
                  onBlur={() => setActive((cur) => (cur === marker.id ? null : cur))}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') setActive(null)
                  }}
                >
                  <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
                    <MarkerGlyph kind={marker.kind} />
                  </svg>
                </button>
                {isActive && (
                  <span role="tooltip" id={tooltipId} className="timeline__tooltip" data-edge={edge}>
                    <span className="timeline__tooltip-meta">
                      <span className="numeric">{minute}</span> {label}
                    </span>
                    <span className="timeline__tooltip-title">{marker.title}</span>
                  </span>
                )}
              </li>
            )
          })}
        </ul>
      </div>

      <div className="timeline__ticks" aria-hidden="true">
        {(ticks ?? DEFAULT_TICKS).map((t) => (
          <span key={t.label} className="timeline__tick numeric" style={{ left: pct(t.atSeconds) }}>
            {t.label}
          </span>
        ))}
      </div>
    </div>
  )
}
