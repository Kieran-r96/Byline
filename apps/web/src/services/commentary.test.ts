import { describe, expect, it } from 'vitest'
import { searchHits } from '../app/commentator/research'
import { choicesFor, openness } from '../app/fan/choices'
import { discoveries, keyAlerts, logRow, pickLead, readable, statRows } from './commentary'
import { indexWorld } from './matchView'
import { MatchEventSchema, MomentViewSchema, SignalSchema } from './schemas'
import type { MatchDetail, MatchState, Signal } from './schemas'

// Shapes copied from the live contract (cache-only backend, BYLINE-01), trimmed.
const detail = {
  world: {
    fixture: { home_team_id: 'NBA', away_team_id: 'RVC' },
    teams: [
      {
        team_id: 'NBA', name: 'Northbridge Athletic', short_name: 'Northbridge', code: 'NBA', formation: '4-2-3-1',
        kit: { primary: '#8E1F3A', secondary: '#F2E6D0', number: '#F2E6D0', goalkeeper: '#2F6B4F' },
        manager: { manager_id: 'MGR-NBA', name: 'Marta Kovacevic-Hale' },
        players: [
          { player_id: 'NBA-04', team_id: 'NBA', shirt_number: 4, given_name: 'Mateo', family_name: 'Lindqvist', position: 'DM' },
          { player_id: 'NBA-07', team_id: 'NBA', shirt_number: 7, given_name: 'Kofi', family_name: 'Rennard', position: 'RW' },
          { player_id: 'NBA-09', team_id: 'NBA', shirt_number: 9, given_name: 'Nico', family_name: 'Vantreight', position: 'ST' },
          { player_id: 'NBA-11', team_id: 'NBA', shirt_number: 11, given_name: 'Sami', family_name: 'Haddad-Rhys', position: 'LW' },
        ],
      },
      {
        team_id: 'RVC', name: 'Riverton City', short_name: 'Riverton', code: 'RVC', formation: '4-3-3',
        kit: { primary: '#1F4FA0', secondary: '#FFFFFF', number: '#FFFFFF', goalkeeper: '#D9A400' },
        manager: { manager_id: 'MGR-RVC', name: 'Tomas Ellery' },
        players: [{ player_id: 'RVC-06', team_id: 'RVC', shirt_number: 6, given_name: 'Gael', family_name: 'Ndiaye-Shaw', position: 'DM' }],
      },
    ],
  },
} as unknown as MatchDetail
const world = indexWorld(detail)

function sig(over: Partial<Signal> & { signal_id: string }): Signal {
  return SignalSchema.parse({
    kind: 'tactical', tier: 'insight', team_id: 'NBA', at_ms: 375_100, seq: 181, display_clock: "7'",
    headline: "S. Haddad-Rhys was open as M. Lindqvist's pass was cut out", text: { commentator: 'Lane 3.3 m clear.' },
    audiences: ['commentator', 'studio', 'fan'], refs: {}, version: 1, ...over,
  })
}

describe('commentator: what matters now', () => {
  const goal = sig({ signal_id: 'g', kind: 'goal', tier: 'alert', at_ms: 1_690_000, headline: 'GOAL · Northbridge 1–0 Riverton', text: { commentator: 'Vantreight scores.' } })
  const tactic = sig({ signal_id: 't' })
  const record = sig({ signal_id: 'r', kind: 'record', tier: 'insight', at_ms: 1_690_500, headline: 'RECORD', text: { commentator: 'Unbeaten home run reaches 32 if it ends 1-0.' } })
  const pre = sig({ signal_id: 'p', kind: 'context', tier: 'alert', at_ms: 0, headline: 'STREAK', text: { commentator: 'Unbeaten in 11.' } })

  it('leads with a fresh official alert, then falls back to the newest discovery', () => {
    expect(pickLead([goal, tactic, record], 1_700_000)?.signal_id).toBe('g')
    expect(pickLead([goal, tactic, record], 1_690_000 + 10 * 60_000)?.signal_id).toBe('r')
  })

  it('keeps pre-match notes and records out of the key events strip and out of Developing', () => {
    expect(keyAlerts([goal, pre, record]).map((s) => s.signal_id)).toEqual(['g'])
    expect(discoveries([goal, tactic, record, pre], null).map((s) => s.signal_id)).toEqual(['t'])
  })

  it('turns shouted ticker headlines into a kicker and a readable headline', () => {
    expect(readable(goal)).toEqual({ kicker: 'Goal', headline: 'Northbridge 1–0 Riverton', line: 'Vantreight scores.' })
    expect(readable(record)).toEqual({ kicker: 'Record', headline: 'Unbeaten home run reaches 32 if it ends 1-0.', line: null })
    expect(readable(tactic).kicker).toBeNull()
    expect(readable(sig({ signal_id: 'v', kind: 'goal', tier: 'alert', headline: 'VAR CHECK · Northbridge 2–1 Riverton' })).kicker).toBe('VAR check')
    const line = sig({ signal_id: 's', kind: 'storyline', headline: 'Building · Northbridge Athletic: attacks through the right channel' })
    expect(readable(line)).toMatchObject({ kicker: 'Building', headline: 'Northbridge Athletic: attacks through the right channel' })
  })
})

describe('commentator: routine log and stats', () => {
  const ev = (type: string, payload: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
    MatchEventSchema.parse({
      schema_version: '1.0.0', event_id: 'E1', match_id: 'BYLINE-01', seq: 1, elapsed_ms: 300_000, period: 'H1', display_clock: "5'",
      team_id: 'NBA', player_id: 'NBA-09', type, source: 'synthetic_generator', truth_status: 'observed_synthetic', payload, ...extra,
    })
  it('writes one plain line per routine event and skips passes and duplicate free kicks', () => {
    expect(logRow(ev('restart.awarded', { restart_type: 'throw_in' }), world)?.text).toBe('Throw-in · Northbridge')
    // the real feed: an official award has team_id null and names the team in awarded_to_team_id
    const corner = logRow(ev('restart.awarded', { restart_type: 'corner', awarded_to_team_id: 'RVC' }, { team_id: null, player_id: null }), world)
    expect(corner).toMatchObject({ text: 'Corner · Riverton', teamId: 'RVC', icon: 'corner' })
    expect(logRow(ev('restart.awarded', { restart_type: 'penalty', awarded_to_team_id: 'NBA' }, { team_id: null, player_id: null }), world)?.text).toBe('Penalty · Northbridge')
    expect(logRow(ev('shot', { outcome: 'off_target' }), world)?.text).toBe('Shot · Vantreight, off target')
    expect(logRow(ev('pass.completed', {}), world)).toBeNull()
    expect(logRow(ev('restart.awarded', { restart_type: 'direct_free_kick' }), world)).toBeNull()
    expect(logRow(ev('substitution', { player_on_id: 'NBA-07', player_off_id: 'NBA-11' }), world)?.text).toBe('Northbridge change · Rennard on, Haddad-Rhys off')
  })
  it('shows only stats the state has, plus cards and substitutions counted from key events', () => {
    const state = { stats: { NBA: { shots: 6, throw_ins: 1, passes: 260, passes_completed: 205 }, RVC: { shots: 5, throw_ins: 5, passes: 299, passes_completed: 245 } } } as unknown as MatchState
    const rows = statRows(state, [ev('card.yellow', {}, { team_id: 'RVC' })], 'NBA', 'RVC')
    expect(rows.find((r) => r.key === 'throw_ins')).toMatchObject({ home: 1, away: 5 })
    expect(rows.find((r) => r.key === 'corners')).toBeUndefined() // not in the state: not shown as zero
    expect(rows.find((r) => r.key === 'yellow')).toMatchObject({ home: 0, away: 1 })
    expect(rows.find((r) => r.key === 'pass_share')).toMatchObject({ home: 47, away: 53 })
  })
})

describe('research search', () => {
  it('finds players by name or shirt, clubs, managers, the derby and the venue', () => {
    expect(searchHits(world, 'vant')[0]?.focus).toEqual({ kind: 'player', id: 'NBA-09' })
    expect(searchHits(world, '11').map((h) => h.focus)).toContainEqual({ kind: 'player', id: 'NBA-11' })
    expect(searchHits(world, 'kovacevic')[0]?.focus).toEqual({ kind: 'club', id: 'NBA' })
    expect(searchHits(world, 'derby')[0]?.focus).toEqual({ kind: 'h2h' })
    expect(searchHits(world, 'referee')[0]?.focus).toEqual({ kind: 'match' })
    expect(searchHits(world, '')).toEqual([])
  })
})

describe('fan: what would you do?', () => {
  const opt = (receiver_id: string, lane: number, space: number) => ({
    receiver_id, x: 70, y: 20, distance_m: 20, progression_m: 10, lane_clearance_m: lane, lane_blocker_id: null, lane_opponents: [],
    receiver_space_m: space, nearest_marker_id: null, opponents_bypassed: 2, beyond_back_line: false, between_lines: true,
    offside_position: false, rating: 'open', bypassed_ids: [],
  })
  const view = MomentViewSchema.parse({
    moment_id: 'T-option-NBA-0180', kind: 'option', label: 'Better option on', team_id: 'NBA', at_ms: 374_100, seq: 180,
    display_clock: "7'", title: 't', observed: [], summary: 's', interpretation: 'i', unknowns: [], evidence_event_ids: [],
    focus_player_ids: [], frame_ms: 374_000, significance: 40, available_ms: 375_100, available_seq: 181, direction: '+x',
    defending_team_id: 'RVC', players: [], ball: null, arrows: [], lines: null, replay: { from_ms: 0, to_ms: 1 },
    whatif: {
      moment_id: 'T-option-NBA-0180', team_id: 'NBA', defending_team_id: 'RVC', frame_ms: 374_000, carrier_id: 'NBA-04', origin: [60, 42],
      actual: { kind: 'pass', receiver_id: 'NBA-09', end: [72, 38], outcome: 'intercepted', interceptor_id: 'RVC-06', option: opt('NBA-09', 0.3, 1.2), event_id: 'E0180' },
      alternatives: [opt('NBA-11', 3.3, 9.3), opt('NBA-07', 6.5, 13.8)], lines: null, labels: { history: 'h', hypothetical: 'x' }, rules: {},
    },
  })
  it('offers only the real measured options, with the played pass not always first', () => {
    const c = choicesFor(view, world)
    expect(c.map((x) => x.id).sort()).toEqual(['NBA-07', 'NBA-09', 'NBA-11'])
    expect(c.filter((x) => x.played).map((x) => x.id)).toEqual(['NBA-09'])
    expect(c[0]!.id).not.toBe('NBA-09')
  })
  it('describes openness from the measurements only, never an outcome', () => {
    expect(openness(view.whatif!.actual.option)).toBe('an opponent was right in the way (0.3 m), with a marker tight (1.2 m).')
    expect(openness(view.whatif!.alternatives[1]!)).toMatch(/clear \(6\.5 m\), with plenty of room \(13\.8 m\)/)
    for (const c of choicesFor(view, world)) expect(openness(c.option)).not.toMatch(/score|goal|chance|%|would/)
  })
})

describe('record plate hero number', () => {
  it('prefers an ordinal, never a scoreline or a season', async () => {
    const { heroNumber } = await import('../components/Broadcast/formats')
    expect(heroNumber("If it ends 1-0, Northbridge's unbeaten home league run reaches 32, their longest in the record (since 2016/17).")).toBe('32')
    expect(heroNumber('Nico Vantreight makes his 100th appearance for Northbridge today.')).toBe('100th')
    expect(heroNumber('Draw at 1–1.')).toBeNull()
  })
})
