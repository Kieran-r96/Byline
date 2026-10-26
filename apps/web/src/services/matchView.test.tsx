import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ScoreBug } from '../components/ScoreBug/ScoreBug'
import type { InsightEntry } from './matchSession'
import { buildMarkers, footballMinute, indexWorld, sanitiseIssue, scoreDisplay, stageInfo } from './matchView'
import type { MatchEvent, MatchState } from './schemas'

// Minimal state fixture for tests (not product data).
const STATE = {
  seq: 2006,
  elapsed_ms: 4_370_000,
  period: 'H2',
  phase: 'SECOND_HALF_ACTIVE',
  play_state: 'VAR_REVIEW',
  clock: '71:40',
  minute: "72'",
  score: { NBA: 1, RVC: 1 },
  provisional_score: { NBA: 2, RVC: 1 },
  goals: [],
  cards: [],
  possession_team: null,
  attacking_direction: { NBA: '-x', RVC: '+x' },
  teams: {},
  var_review: { subject_event_id: 'E2006', check_type: 'goal', reason: 'Possible offside' },
} as unknown as MatchState

describe('score display rule', () => {
  it('shows the provisional score flagged as checking during VAR', () => {
    const sc = scoreDisplay(STATE, 'NBA', 'RVC')
    expect(sc).toEqual({ home: 2, away: 1, checking: true, varReview: true, provisionalSide: 'home' })
  })

  it('a provisional goal WITHOUT an official review is "confirming", never a VAR check', () => {
    const sc = scoreDisplay({ ...STATE, var_review: null }, 'NBA', 'RVC')
    expect(sc).toEqual({ home: 2, away: 1, checking: true, varReview: false, provisionalSide: 'home' })
    render(
      <ScoreBug
        home={{ teamId: 'NBA', shortName: 'NBA', name: 'Northbridge Athletic', score: 2 }}
        away={{ teamId: 'RVC', shortName: 'RVC', name: 'Riverton City', score: 1 }}
        clock="27:20"
        period="1H"
        checking
        varReview={false}
        provisionalSide="home"
      />,
    )
    expect(screen.getByText('CONFIRMING')).toBeInTheDocument()
    expect(screen.queryByText('VAR CHECK')).not.toBeInTheDocument()
  })

  it('is plain confirmed score when nothing is under review', () => {
    const sc = scoreDisplay({ ...STATE, provisional_score: { NBA: 1, RVC: 1 }, var_review: null }, 'NBA', 'RVC')
    expect(sc).toEqual({ home: 1, away: 1, checking: false, varReview: false, provisionalSide: null })
  })

  it('ScoreBug never presents a provisional goal as confirmed', () => {
    render(
      <ScoreBug
        home={{ teamId: 'NBA', shortName: 'NBA', name: 'Northbridge Athletic', score: 2 }}
        away={{ teamId: 'RVC', shortName: 'RVC', name: 'Riverton City', score: 1 }}
        clock="71:40"
        period="2H"
        checking
        varReview
        provisionalSide="home"
      />,
    )
    expect(screen.getByText('VAR CHECK')).toBeInTheDocument()
    expect(screen.getByText(/score not confirmed/)).toBeInTheDocument()
  })
})

describe('story stages', () => {
  const entry = (stage: string, checker?: string): InsightEntry =>
    ({
      stages: [stage],
      update: {
        stage,
        insight: checker ? { verification: { checker_name: checker, verdict: 'approved', issues: [] } } : null,
      },
    }) as unknown as InsightEntry

  it('labels real stages honestly', () => {
    expect(stageInfo(entry('investigating')).label).toBe('Investigating')
    expect(stageInfo(entry('verified', 'verifier_agent')).label).toBe('Verified')
    expect(stageInfo(entry('tentative', 'deterministic_only (ai_off)')).label).toBe('Detector summary · AI off')
    expect(stageInfo(entry('tentative', 'deterministic_only (ai_unavailable)')).label).toBe(
      'Detector summary · AI unavailable',
    )
    expect(stageInfo(entry('retracted')).label).toBe('Withdrawn')
  })

  it('never leaks raw provider errors', () => {
    expect(sanitiseIssue('ChatClientException: ("<class ...> Error code: 400 tenant')).toBe(
      'AI provider unavailable (ChatClientException).',
    )
  })
})

describe('timeline markers', () => {
  it('maps official events to marker kinds', () => {
    const ev = (event_id: string, type: string, elapsed_ms: number): MatchEvent => ({
      event_id,
      seq: Number(event_id.slice(1)),
      elapsed_ms,
      period: 'H2',
      display_clock: "71'",
      team_id: 'NBA',
      player_id: 'NBA-09',
      type,
      payload: {},
    })
    const markers = buildMarkers(
      [ev('E1', 'goal.confirmed', 1000), ev('E2', 'goal.disallowed', 2000), ev('E3', 'card.second_yellow', 3000), ev('E4', 'goal.provisional', 500)],
      [],
      {},
      indexWorld(null),
    )
    expect(markers.map((m) => m.kind)).toEqual(['goal', 'var', 'red'])
  })
})

describe('footballMinute', () => {
  const detail = { periods: [{ period: 'H1', start_ms: 0 }, { period: 'H2', start_ms: 2_826_200 }] } as unknown as Parameters<typeof footballMinute>[1]
  it('follows the minute convention used everywhere else, including stoppage time', () => {
    expect(footballMinute(374_100, detail)).toBe("7'")
    expect(footballMinute(2_820_000, detail)).toBe("45+3'")
    expect(footballMinute(2_826_200 + 60_000, detail)).toBe("47'")
    expect(footballMinute(2_826_200 + 45 * 60_000 + 61_000, detail)).toBe("90+2'")
  })
})
