import type { TimelineMarkerKind } from '../types/shell'

/** mm:ss for replay elapsed time. */
export function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds))
  const minutes = Math.floor(s / 60)
  const seconds = s % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

/** "12 minutes 34 seconds" for screen readers. */
export function spokenTime(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds))
  const m = Math.floor(s / 60)
  const sec = s % 60
  return `${m} minute${m === 1 ? '' : 's'} ${sec} second${sec === 1 ? '' : 's'}`
}

/** Football convention: 0:00-0:59 is the 1st minute; beyond 90 shows stoppage. */
export function formatMatchMinute(seconds: number): string {
  const minute = Math.floor(Math.max(0, seconds) / 60) + 1
  return minute > 90 ? `90+${minute - 90}'` : `${minute}'`
}

export const MARKER_LABEL: Record<TimelineMarkerKind, string> = {
  goal: 'Goal',
  yellow: 'Yellow card',
  red: 'Red card',
  var: 'VAR check',
  penalty: 'Penalty',
  story: 'Story',
}
