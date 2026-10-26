/** Shared UI types for the BYLINE app shell (props-driven, no backend coupling). */

export type TeamId = 'NBA' | 'RVC'

export type Role = 'commentator' | 'studio' | 'fan'

/** Broadcast period codes: pre-match, first half, half-time, second half, full-time. */
export type MatchPeriod = 'PRE' | '1H' | 'HT' | '2H' | 'FT'

export const PERIOD_SPOKEN: Record<MatchPeriod, string> = {
  PRE: 'pre-match',
  '1H': 'first half',
  HT: 'half-time',
  '2H': 'second half',
  FT: 'full-time',
}

export interface ScoreBugSide {
  teamId: TeamId
  /** Three-letter broadcast code, e.g. "NBA". */
  shortName: string
  /** Full fictional club name, used for accessible labels. */
  name: string
  score: number
}

export interface ScoreBugData {
  home: ScoreBugSide
  away: ScoreBugSide
  /** Match clock as displayed, e.g. "00:00" or "45+2". */
  clock: string
  period: MatchPeriod
  /** A goal is provisional / under VAR review: the score is not confirmed. */
  checking?: boolean
  /** Official VAR review open (distinct from a provisional goal awaiting confirmation). */
  varReview?: boolean
  provisionalSide?: 'home' | 'away' | null
}

export type TimelineMarkerKind = 'goal' | 'yellow' | 'red' | 'var' | 'penalty' | 'story'

export interface TimelineMarker {
  id: string
  kind: TimelineMarkerKind
  /** Match time in seconds from kick-off. */
  atSeconds: number
  /** Short human title for tooltip, e.g. "Goal — Northbridge Athletic". */
  title: string
  /** Optional team the marker belongs to (tints the marker edge). */
  teamId?: TeamId
  /** Official display clock (e.g. "45+2'"); overrides the computed minute. */
  minuteLabel?: string
}

export interface TimelineTick {
  atSeconds: number
  label: string
}

export type ReplaySpeed = 1 | 4 | 12 | 30

export const REPLAY_SPEEDS: readonly ReplaySpeed[] = [1, 4, 12, 30] as const
