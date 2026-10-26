import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { StudioSurface } from '../app/studio/StudioSurface'
import { DecisionCard } from '../components/Decisions/Decisions'
import { compactLine, kindTone } from './decisionView'
import { MatchSessionStore } from './matchSession'
import { indexWorld, insightText, stageInfo, teamLineup } from './matchView'
import type { InsightEntry } from './matchSession'
import { PrefsStore } from './prefs'
import type { Decision, Insight, MatchEvent, MatchState, OverlayPacket } from './schemas'

// ---- fixtures (test-only, shapes from docs/api-contract.md v0.4-v0.6)

const DECISION: Decision = {
  decision_id: 'D-E1799',
  kind: 'SECOND YELLOW',
  clock: "64'",
  team_id: 'RVC',
  player_id: 'RVC-06',
  headline: '#6 kicked #10',
  decision: 'Direct free kick · Second yellow card: sent off.',
  reason: 'Reckless kick outside the penalty area',
  what_happened: 'Kick outside the area (E1799).',
  which_rule: [{ law: 'Law 12', title: 'Law 12: Fouls and Misconduct', url: 'https://example.invalid/law12', point: 'A second caution results in a sending-off.' }],
  what_changes: 'Riverton continue with 10 players.',
  caveats: [],
  provisional: false,
  source_event_ids: ['E1799', 'E1800'],
  ruleset_version: 'IFAB-2026/27',
  disclaimer: 'BYLINE explains official decisions; it does not officiate matches.',
  explanation_kind: 'law_grounded',
  importance: 'major',
}

function packet(id: string, status: OverlayPacket['status'], extra: Partial<OverlayPacket> = {}): OverlayPacket {
  return {
    id,
    source_kind: 'goal',
    source_id: 'E2006',
    version: 1,
    status,
    template_id: 'goal_story',
    match_elapsed_ms: 4_369_900,
    title: 'GOAL · Northbridge 2–1 Riverton',
    subtitle: 'Nico Vantreight 71’',
    player_ids: [],
    source_event_ids: ['E2006'],
    ...extra,
  }
}

const ev = (seq: number, type: string, team: string, payload: Record<string, unknown>): MatchEvent => ({
  event_id: `E${seq}`,
  seq,
  elapsed_ms: seq * 1000,
  period: 'H1',
  display_clock: "1'",
  team_id: team,
  player_id: null,
  type,
  payload,
})

describe('decision explainer (T011)', () => {
  it('builds the compact official line and a shape tone per kind', () => {
    expect(compactLine(DECISION)).toBe(
      'Decision: Direct free kick · Second yellow card: sent off | Reason: Reckless kick outside the penalty area | Law 12 | Official event E1799',
    )
    expect(kindTone('SECOND YELLOW')).toBe('second')
    expect(kindTone('VAR CHECK')).toBe('var')
    expect(kindTone('OFFSIDE POSITION · NO OFFENCE')).toBe('offside')
  })

  it('reveals the 3-step law-grounded explainer with its disclaimer on demand', async () => {
    const user = userEvent.setup()
    let expanded = false
    const { rerender } = render(
      <DecisionCard decision={DECISION} expanded={expanded} onToggle={() => (expanded = !expanded)} used={false} />,
    )
    expect(screen.getByText('What happened')).not.toBeVisible()
    await user.click(screen.getByRole('button', { name: /Why that decision/ }))
    rerender(<DecisionCard decision={DECISION} expanded={expanded} onToggle={() => {}} used={false} />)
    expect(screen.getByText('What happened')).toBeVisible()
    expect(screen.getByText('Law-grounded explanation')).toBeVisible()
    expect(screen.getByText(DECISION.disclaimer)).toBeVisible()
  })
})

describe('formation (T016)', () => {
  const lineup = ev(1, 'lineup.confirmed', 'RVC', {
    formation: '4-3-3',
    starters: [
      { player_id: 'RVC-06', slot: 'DM' },
      { player_id: 'RVC-11', slot: 'LW' },
    ],
  })
  const sub = ev(2, 'substitution', 'RVC', { player_off_id: 'RVC-11', player_on_id: 'RVC-16' })

  it('falls back to the confirmed line-up before kick-off', () => {
    const l = teamLineup('RVC', null, [lineup])
    expect(l.formation).toBe('4-3-3')
    expect(l.slots.map((s) => s.playerId)).toEqual(['RVC-06', 'RVC-11'])
  })

  it('keeps a sent-off slot empty (10-man shape) and flags substitutes in-slot', () => {
    const state = {
      teams: { RVC: { formation: '4-3-3', on_pitch: { LW: 'RVC-16' }, bench: [], used_subs: 1, off: ['RVC-11'], sent_off: ['RVC-06'] } },
    } as unknown as MatchState
    const l = teamLineup('RVC', state, [lineup, sub])
    expect(l.slots).toEqual([
      { slot: 'DM', playerId: null, sentOffId: 'RVC-06', subOn: false },
      { slot: 'LW', playerId: 'RVC-16', sentOffId: null, subOn: true },
    ])
  })
})

describe('preferences (T016/T017/T020)', () => {
  it('persists role, fan mode, language and per-fact used state with undo', () => {
    const mem = new Map<string, string>()
    const storage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) } as Storage
    const a = new PrefsStore(storage)
    a.setRole('fan')
    a.setFanMode('analyst')
    a.setLang('es')
    a.togglePin('F-1')
    a.markUsed('F-1')
    const b = new PrefsStore(storage)
    expect(b.get()).toMatchObject({ role: 'fan', fanMode: 'analyst', lang: 'es', pinned: [] })
    expect(b.get().used['F-1']).toBeTypeOf('number')
    b.unmarkUsed('F-1')
    expect(new PrefsStore(storage).get().used).toEqual({})
  })

  it('survives corrupted or blocked storage', () => {
    const broken = { getItem: () => '{not json', setItem: () => { throw new Error('quota') } } as unknown as Storage
    const p = new PrefsStore(broken)
    expect(p.get().role).toBe('commentator')
    expect(() => p.markUsed('x')).not.toThrow()
    expect(p.get().used.x).toBeDefined()
  })
})

describe('translations (T020)', () => {
  const insight = {
    title: 'English title',
    canonical_claim: 'English claim',
    audience_variants: { fan_discover: 'English fan text', translations: { 'es.title': 'Título' } },
  } as unknown as Insight

  it('falls back per field to English and flags it', () => {
    expect(insightText(insight, 'title', 'es')).toEqual({ text: 'Título', translated: true, englishOnly: false })
    expect(insightText(insight, 'fan_discover', 'es')).toEqual({ text: 'English fan text', translated: false, englishOnly: true })
    expect(insightText(insight, 'title', 'en').text).toBe('English title')
  })

  it('labels each detector-summary reason honestly', () => {
    const entry = (checker: string) =>
      ({ stages: ['tentative'], update: { stage: 'tentative', insight: { verification: { checker_name: checker } } } }) as unknown as InsightEntry
    expect(stageInfo(entry('deterministic_only (ai_cache_only)')).label).toBe('Detector summary · not AI-reviewed')
    expect(stageInfo(entry('deterministic_only (ai_skipped)')).label).toBe('Detector summary · skipped ahead')
  })
})

describe('session store: decisions + overlays (T011/T018)', () => {
  function store(now: { t: number }) {
    return new MatchSessionStore({ log: () => {}, now: () => now.t, fetchImpl: vi.fn() as unknown as typeof fetch })
  }

  it('flags only live major decisions (not the replay burst) and dedupes re-sends', () => {
    const now = { t: 10_000 }
    const s = store(now)
    s.handleMessage('replay_reset', JSON.stringify({ playhead_ms: 3_900_000, cursor: 10, last_seq: 9 }))
    s.handleMessage('decision', JSON.stringify(DECISION), true)
    expect(s.getSnapshot().liveDecision).toBeNull()
    now.t += 5000
    s.handleMessage('decision', JSON.stringify({ ...DECISION, decision_id: 'D-E2007', kind: 'VAR CHECK', provisional: true }), true)
    s.handleMessage('decision', JSON.stringify(DECISION), true)
    expect(s.getSnapshot().liveDecision?.id).toBe('D-E2007')
    expect(s.getSnapshot().decisions.map((d) => d.decision_id)).toEqual(['D-E2007', 'D-E1799'])
    s.handleMessage('decision', JSON.stringify({ decision_id: 'broken' }), true)
    expect(s.getSnapshot().invalidFrames).toBe(1)
  })

  it('applies overlay snapshots then single packet updates, and clears on reset', () => {
    const s = store({ t: 0 })
    s.handleMessage('overlay_update', JSON.stringify({ snapshot: [packet('O-1', 'proposed'), packet('O-2', 'expired')] }))
    s.handleMessage('overlay_update', JSON.stringify(packet('O-1', 'retracted', { status_reason: 'Goal disallowed (offside, Law 11) at 72’' })))
    expect(s.getSnapshot().overlays['O-1']?.status).toBe('retracted')
    expect(Object.keys(s.getSnapshot().overlays)).toHaveLength(2)
    s.handleMessage('replay_reset', JSON.stringify({ playhead_ms: 0, cursor: 0, last_seq: -1 }))
    expect(s.getSnapshot().overlays).toEqual({})
    expect(s.getSnapshot().decisions).toEqual([])
  })
})

describe('live production desk (T018, V4)', () => {
  const world = indexWorld(null)

  function renderDesk(overlays: Record<string, OverlayPacket>) {
    const base = new MatchSessionStore({ fetchImpl: vi.fn() as unknown as typeof fetch }).getSnapshot()
    const overlayAction = vi.fn(async () => null)
    const store = { matchId: 'BYLINE-01', overlayAction, proposeGraphic: vi.fn() } as unknown as MatchSessionStore
    render(
      <StudioSurface
        store={store}
        snap={{ ...base, overlays }}
        world={world}
        programme={<div />}
        minuteOf={() => "71'"}
        onOpenTactic={vi.fn()}
        onOpenEvidence={vi.fn()}
        onReplayAt={vi.fn()}
      />,
    )
    return overlayAction
  }

  it('labels the output as demo only, approves only proposals (now or at the next stoppage) and shows withdrawal reasons', async () => {
    const user = userEvent.setup()
    const overlayAction = renderDesk({
      A: packet('A', 'proposed', { title: 'Proposed graphic' }),
      B: packet('B', 'retracted', { title: 'Withdrawn graphic', status_reason: 'Goal disallowed after VAR' }),
    })
    expect(screen.getByText(/No broadcast hardware or playout is connected/)).toBeInTheDocument()
    expect(screen.getByText('A producer approves every graphic')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /At the next stoppage/ }))
    expect(overlayAction).toHaveBeenCalledWith('A', 'approve', { cue: 'next_stoppage', durationMs: null })
    await user.click(screen.getByRole('button', { name: /Withdrawn graphic/ }))
    expect(screen.getByText('Goal disallowed after VAR')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Take to air now' })).not.toBeInTheDocument()
  })

  it('fills the selected graphic into the chosen broadcaster template and shows where every field came from', async () => {
    const user = userEvent.setup()
    renderDesk({ A: packet('A', 'proposed', { title: 'GOAL · Northbridge 2–1 Riverton' }) })
    expect(screen.getByText('Simulated output · local demo · no broadcast integration', { selector: '.studio__sim' })).toBeInTheDocument()
    const pvw = () => document.querySelector('.monitor[data-kind="pvw"] .gframe')
    expect(pvw()).toHaveAttribute('data-template', 'byline')
    expect(screen.getByRole('table')).toHaveTextContent('Official match event')
    await user.click(screen.getByRole('radio', { name: /Sample partner template: Northgate Sports \(fictional\)/ }))
    expect(pvw()).toHaveAttribute('data-template', 'northgate')
    expect(screen.getByRole('table')).toHaveTextContent('NAME_SUPER')
    expect(screen.getByRole('table')).toHaveTextContent('SCORE_TXT')
  })

  it('never lets a graphic held by VAR be approved', () => {
    renderDesk({ H: packet('H', 'proposed', { title: 'GOAL · held', on_hold: true }) })
    expect(screen.getByRole('button', { name: 'Held by VAR' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'At the next stoppage' })).toBeDisabled()
  })
})
