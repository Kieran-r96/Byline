import { useEffect, useState } from 'react'
import { z } from 'zod'
import { getJson } from './api'

/**
 * Research dossiers (GET /api/matches/{id}/dossier/... and /talking-points). Every block carries its scope
 * and every payload is fictional and labelled so. Only the fields the UI reads are typed here.
 */

export interface Line {
  played: number
  won: number
  drawn: number
  lost: number
  goals_for?: number
  goals_against?: number
  win_pct?: number
  line: string
  scope?: string
}

export interface ClubMatch {
  date: string
  season: string
  competition: string
  stage?: string
  venue: string
  stadium?: string
  opponent: string
  score: string
  result?: 'W' | 'D' | 'L'
  derby?: boolean
}

export interface PlayerDossier {
  as_of: { minute: string }
  player: {
    player_id: string
    name: string
    shirt_number: number
    position: string
    position_word: string
    preferred_foot: string
    age: number
    hometown: string
    academy_graduate: boolean
    joined_season: string
    fee_note: string
    club: { team_id: string; name: string; short_name: string }
  }
  profile_line: string
  this_match: {
    scope: string
    role: string
    on_pitch_now: boolean
    minutes_on_pitch: number
    passes: { completed: number; attempted: number; pct: number }
    shots: { total: number; on_target: number }
    goals: number
    goal_minutes: string[]
    assists: number
    tackles: number
    interceptions: number
    fouls_committed: number
    fouls_won: number
    saves: number
    cards: Array<{ type?: string; minute?: string }>
    substitution: { on: string | null; off: string | null }
  }
  season: { scope: string; season: string; apps: number; goals: number; assists: number; yellows: number; reds: number; clean_sheets: number | null; one_booking_from_ban: boolean; including_today?: { apps: number; goals: number } }
  career: { scope: string; seasons: Array<{ season: string; club: string; apps: number; goals: number; assists: number; yellows: number; reds: number; clean_sheets: number | null }> }
  totals: { scope: string; club: { apps: number; goals: number; since: string; club: string }; overall: { apps: number; goals: number; seasons: number }; clubs: string[] }
  derby: { scope: string; goals_before_today: number; goals_today: number }
  milestones: Array<{ text: string; status: string }>
  injuries: string[]
  connections: Array<{ text: string }>
  facts: Array<{ fact_id: string; short_text: string; category?: string }>
  notice: string
}

export interface TeamDossier {
  club: { team_id: string; name: string; short_name: string; founded: number; stadium: string; formation: string; today: string }
  manager: { name: string; appointed_season: string; previous: string; record: Line; league_record: Line; derby_record: Line }
  form: { scope: string; matches: ClubMatch[]; line: string }
  streaks: { scope: string; current: Array<{ kind: string; scope: string; where: string; length: number; since: string; rule: string; longest_in_record: number; is_longest_in_record: boolean }> }
  current_season: { scope: string; played: number; won: number; drawn: number; lost: number; goals_for: number; goals_against: number; points: number }
  seasons: { scope: string; rows: Array<{ season: string; position: number; points: number; top_scorer: string; cup: string }> }
  honours: { scope: string; league_titles: string[]; cups: string[]; best_league_finish: number }
  biggest: { scope: string; win_all_competitions: ClubMatch | null; defeat_all_competitions: ClubMatch | null }
  upcoming: { scope: string; fixtures: ClubMatch[] }
  notice: string
}

export interface H2HDossier {
  rivalry: string
  all_time: { scope: string; meetings: number; wins: Record<string, number>; draws: number }
  record_window: Line & { scope: string }
  teams: Record<string, { record: Line; at_home: Line; away_from_home: Line; biggest_win: ClubMatch | null }>
  last_meetings: { scope: string; meetings: Array<{ date: string; competition: string; home: string; away: string; venue: string; score: string; scorers: Array<{ name: string; minute: number; team_id: string }>; referee: string; attendance: number }> }
  leading_scorers: { scope: string; players: Array<{ player_id: string; name: string; team_id: string; derby_goals_before_today: number; goals_today: number }> }
  notice: string
}

export interface MatchDossier {
  competition: string
  season: string
  matchday: number
  kickoff_local: string
  venue: string
  stadium: { name: string; capacity: number; record_attendance: number; record_match: string; home_league_record: Line }
  officials: Array<{ name: string; role: string; record?: { games_this_season: number; yellows_this_season: number; reds_this_season: number; penalties_this_season: number; career_games: number; cautions_per_game: number; scope: string } }>
  context: Array<{ fact_id: string; category: string; short_text: string; rule: string }>
  notice: string
}

export interface TalkingPointDto {
  id: string
  text: string
  detail?: string | null
  kind: string
  subject_ids: string[]
  why: string
  source: string
  at_ms: number
  priority: number
}

const Loose = z.looseObject({ match_id: z.string() })

type Load<T> = { status: 'loading' } | { status: 'error' } | { status: 'ready'; data: T }

/**
 * Fetch a dossier as of the current seq, rounded DOWN to a multiple of 10 so it refreshes every few events
 * rather than on every pass. Never rounded up: a dossier must not include events the viewer has not reached.
 */
export function useDossier<T>(path: string | null, seq: number): Load<T> {
  const bucket = Math.floor(Math.max(0, seq) / 10) * 10 // before the session starts: kick-off state, never the full log
  const [state, setState] = useState<Load<T> & { key?: string }>({ status: 'loading' })
  const key = path ? `${path}@${bucket}` : ''
  useEffect(() => {
    if (!path) return undefined
    const ctrl = new AbortController()
    const sep = path.includes('?') ? '&' : '?'
    getJson(`${path}${sep}upto_seq=${bucket}`, Loose, { signal: ctrl.signal, timeoutMs: 8000 })
      .then((d) => setState({ status: 'ready', data: d as unknown as T, key }))
      .catch(() => {
        if (!ctrl.signal.aborted) setState({ status: 'error', key })
      })
    return () => ctrl.abort()
  }, [path, bucket, key])
  if (state.key !== key && state.status !== 'loading') return state.status === 'ready' ? state : { status: 'loading' }
  return state
}
