import type { ScoreBugData, TimelineMarker } from '../types/shell'

/**
 * SHELL PREVIEW DATA. Renders the app frame before the synthetic match stream
 * exists. It contains only the fixture identity and a pre-match state:
 * no events, no insights, no statistics. Replace with stream state (T003+).
 */
export const SHELL_PREVIEW_SCOREBUG: ScoreBugData = {
  home: { teamId: 'NBA', shortName: 'NBA', name: 'Northbridge Athletic', score: 0 },
  away: { teamId: 'RVC', shortName: 'RVC', name: 'Riverton City', score: 0 },
  clock: '00:00',
  period: 'PRE',
}

/** No events have happened before kick-off, so the timeline is empty. */
export const SHELL_PREVIEW_MARKERS: readonly TimelineMarker[] = []

export const SHELL_PREVIEW_DURATION_SECONDS = 90 * 60
