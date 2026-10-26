import { useId } from 'react'
import type { CSSProperties } from 'react'
import { REPLAY_SPEEDS } from '../../types/shell'
import type { ReplaySpeed } from '../../types/shell'
import { formatClock, spokenTime } from '../../lib/format'
import { Icon } from '../icons/Icon'
import { SegmentedControl } from '../SegmentedControl/SegmentedControl'
import './ReplayControls.css'

export interface ReplayControlsProps {
  playing: boolean
  speed: ReplaySpeed
  /** Replay position in seconds of match time. */
  positionSeconds: number
  durationSeconds: number
  /** Optional match-clock label shown beside elapsed (e.g. "45+2"). */
  clockLabel?: string
  onPlayPause: () => void
  onRestart: () => void
  onSpeedChange: (speed: ReplaySpeed) => void
  onScrub: (seconds: number) => void
  disabled?: boolean
  className?: string
}

const SPEED_OPTIONS = REPLAY_SPEEDS.map((value) => ({
  value,
  label: `${value}x`,
  ariaLabel: `${value} times speed`,
}))

/**
 * Transport bar for the synthetic replay. Entirely props-driven.
 * Keyboard: Tab between controls; slider uses native Arrow/Page/Home/End;
 * speed is a radiogroup with arrow keys.
 */
export function ReplayControls({
  playing,
  speed,
  positionSeconds,
  durationSeconds,
  clockLabel,
  onPlayPause,
  onRestart,
  onSpeedChange,
  onScrub,
  disabled = false,
  className,
}: ReplayControlsProps) {
  const sliderId = useId()
  const progress = durationSeconds > 0 ? (positionSeconds / durationSeconds) * 100 : 0

  return (
    <div
      className={['replay', className ?? ''].join(' ').trim()}
      role="group"
      aria-label="Replay controls"
    >
      <div className="replay__buttons">
        <button
          type="button"
          className="replay__btn"
          onClick={onRestart}
          disabled={disabled}
          aria-label="Restart replay"
          title="Restart"
        >
          <Icon name="restart" size={20} />
        </button>
        <button
          type="button"
          className="replay__btn replay__btn--primary"
          onClick={onPlayPause}
          disabled={disabled}
          aria-label={playing ? 'Pause replay' : 'Play replay'}
          title={playing ? 'Pause' : 'Play'}
        >
          <Icon name={playing ? 'pause' : 'play'} size={20} />
        </button>
      </div>

      <div className="replay__scrub">
        <label htmlFor={sliderId} className="sr-only">
          Replay position
        </label>
        <input
          id={sliderId}
          className="replay__slider"
          type="range"
          min={0}
          max={durationSeconds}
          step={1}
          value={Math.min(positionSeconds, durationSeconds)}
          disabled={disabled}
          aria-valuetext={`${spokenTime(positionSeconds)} of ${spokenTime(durationSeconds)}`}
          onChange={(e) => onScrub(Number(e.currentTarget.value))}
          style={{ '--progress': `${progress}%` } as CSSProperties}
        />
      </div>

      <div className="replay__time numeric" aria-hidden="true">
        <span className="replay__elapsed">{formatClock(positionSeconds)}</span>
        <span className="replay__total"> / {formatClock(durationSeconds)}</span>
        {clockLabel && <span className="replay__clock">{clockLabel}</span>}
      </div>

      <SegmentedControl
        label="Replay speed"
        size="sm"
        options={SPEED_OPTIONS}
        value={speed}
        onChange={onSpeedChange}
        disabled={disabled}
        className="replay__speed"
      />
    </div>
  )
}
