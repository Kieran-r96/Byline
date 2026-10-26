import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { indexWorld } from '../../services/matchView'
import { MatchDetailSchema, MomentViewSchema } from '../../services/schemas'
import type { Decision, MatchEvent, OverlayPacket } from '../../services/schemas'
import { DETAIL, VIEW_OPTION } from '../../test/stageFixtures'
import { fillGraphic, filledList } from './fill'
import { formatAvailability, heading, onAirFacts, resolveFormat, shapeShift } from './formats'
import { GraphicFrame } from './Graphic'
import { familyOf, FORMAT_IDS, SIMULATED_NOTICE, SOURCE_LABEL, TEMPLATE_IDS, TEMPLATES } from './templates'
import type { FieldKey } from './templates'

const world = indexWorld(MatchDetailSchema.parse(DETAIL))
const view = MomentViewSchema.parse(VIEW_OPTION)

function packet(extra: Partial<OverlayPacket>): OverlayPacket {
  return {
    id: 'O-X',
    source_kind: 'goal',
    source_id: 'E0761',
    version: 1,
    status: 'proposed',
    template_id: 'goal_story',
    match_elapsed_ms: 1_633_600,
    title: 'GOAL · Northbridge 1–0 Riverton',
    subtitle: "Nico Vantreight 28'",
    team_id: 'NBA',
    player_ids: ['NBA-09'],
    source_event_ids: ['E0761'],
    ...extra,
  }
}

const ev = (id: string, type: string, ms: number, payload: Record<string, unknown> = {}, player: string | null = 'NBA-09'): MatchEvent => ({
  event_id: id,
  seq: Number(id.slice(1)),
  elapsed_ms: ms,
  period: 'H1',
  display_clock: `${Math.floor(ms / 60000) + 1}'`,
  team_id: 'NBA',
  player_id: player,
  type,
  payload,
})

describe('graphics templates (typed data)', () => {
  it('binds a named slot for every verified field in every package, and marks the partner as a fictional sample', () => {
    const keys: FieldKey[] = ['headline', 'strap', 'player', 'number', 'metric', 'lane', 'rule', 'decision', 'corrected', 'team', 'kit', 'clock', 'score', 'on', 'off', 'shape', 'rows']
    for (const id of TEMPLATE_IDS) {
      for (const k of keys) expect(TEMPLATES[id].slots[k]).toBeTruthy()
    }
    expect(TEMPLATES.byline.sample).toBe(false)
    expect(TEMPLATES.northgate.sample).toBe(true)
    expect(TEMPLATES.northgate.supplier).toMatch(/fictional/)
    expect(SIMULATED_NOTICE).toBe('Simulated output · local demo · no broadcast integration')
  })

  it('maps every studio template id to one of seven families', () => {
    expect(new Set(['goal_story', 'tactical_moment', 'player_record', 'substitution', 'stat_comparison', 'referee_decision', 'channel_pressure'].map(familyOf)).size).toBe(7)
    expect(familyOf('something_new')).toBe('story')
  })
})

describe('fillGraphic: every field from verified data, with its source', () => {
  it('player spotlight: scorer from the official event, shirt from the team sheet, goals counted without disallowed ones', () => {
    const events = [ev('E0761', 'goal.provisional', 1_633_600), ev('E0900', 'goal.provisional', 2_000_000), ev('E0901', 'goal.disallowed', 2_040_000, { goal_event_id: 'E0900' }), ev('E1000', 'goal.provisional', 2_500_000)]
    const f = fillGraphic(packet({ source_id: 'E1000', source_event_ids: ['E1000'], match_elapsed_ms: 2_500_000, title: 'GOAL · Northbridge 2–0 Riverton' }), { world, events })
    expect(f.family).toBe('spotlight')
    expect(f.fields.player).toMatchObject({ value: 'Nico Vantreight', source: 'official', ref: 'E1000' })
    expect(f.fields.number).toMatchObject({ value: '9', source: 'teamsheet' })
    expect(f.fields.metric).toMatchObject({ value: '2 goals in this match', source: 'counted', ref: 'E0761, E1000' })
    expect(f.score).toEqual({ home: 2, away: 0 })
    expect(f.team?.primary).toBe('#8E1F3A')
  })

  it('tactical breakthrough: the measured title and facts, and the measured open lane from the frozen frame', () => {
    const f = fillGraphic(packet({ template_id: 'tactical_moment', source_kind: 'tactical', source_id: view.moment_id, title: "Better option on · 7'", subtitle: 'x' }), { world, view })
    expect(f.family).toBe('breakthrough')
    expect(f.fields.headline).toMatchObject({ value: view.title, source: 'measured', ref: view.moment_id })
    expect(f.fields.metric?.value).toBe('Intended lane: nearest opponent 0.3 m · Open lane: nearest opponent 3.3 m')
    expect(f.fields.lane?.value).toBe('Played pass intercepted · open lane to Haddad-Rhys, 3.3 m clear')
    expect(f.frame?.moment_id).toBe(view.moment_id)
    // every number on the plate is one that was measured
    for (const n of f.fields.metric!.value.match(/\d+(\.\d+)?/g)!) expect(view.observed.map((o) => String(o.value))).toContain(n)
  })

  it('refereeing decision: law, call and the corrected state, without BYLINE housekeeping', () => {
    const d: Decision = {
      decision_id: 'D-E2009',
      kind: 'GOAL DISALLOWED',
      clock: "72'",
      team_id: 'NBA',
      player_id: 'NBA-09',
      headline: 'Goal disallowed: offside',
      decision: 'No goal',
      reason: 'Offside',
      what_happened: '',
      which_rule: [{ law: 'Law 11', title: 'Law 11: Offside', url: 'https://example.invalid', point: '' }],
      what_changes: 'Score stays 1–1. Indirect free kick to Riverton. Stories built on this attack are withdrawn.',
      caveats: [],
      provisional: false,
      source_event_ids: ['E2006', 'E2009'],
      ruleset_version: 'IFAB-2026/27',
      disclaimer: '',
      explanation_kind: 'law_grounded',
      importance: 'major',
    }
    const f = fillGraphic(packet({ template_id: 'referee_decision', source_kind: 'decision', source_id: 'D-E2009', title: 'GOAL DISALLOWED', subtitle: 'No goal · Law 11' }), { world, decisions: [d] })
    expect(f.fields.rule).toMatchObject({ value: 'Law 11: Offside', source: 'official', ref: 'IFAB-2026/27' })
    expect(f.fields.corrected?.value).toBe('Score stays 1–1. Indirect free kick to Riverton.')
    expect(f.fields.clock?.value).toBe("72'")
  })

  it('substitution: both players and a shape line from the team sheet', () => {
    const f = fillGraphic(
      packet({
        template_id: 'substitution',
        source_kind: 'substitution',
        source_id: 'E1958',
        title: 'SUBSTITUTION · Northbridge',
        subtitle: '',
        player_ids: ['NBA-20', 'NBA-11'],
        data: { on: { id: 'NBA-20', number: 20, name: 'Theo Marchetti-Bose' }, off: { id: 'NBA-11', number: 11, name: 'Sami Haddad-Rhys' }, clock: "70'" },
      }),
      { world },
    )
    expect(f.fields.on?.value).toBe('20 Theo Marchetti-Bose')
    expect(f.fields.off?.value).toBe('11 Sami Haddad-Rhys')
    expect(f.fields.shape).toMatchObject({ value: '4-2-3-1 at kick-off · like for like (LW)', source: 'teamsheet' })
  })

  it('story lower third: credited to Foundry only when the insight was verified', () => {
    const p = packet({ template_id: 'channel_pressure', source_kind: 'insight', source_id: 'I-1', title: 'Northbridge attacks concentrated on the right', subtitle: '91% of entries', team_id: null })
    expect(fillGraphic(p, { world, foundryVerified: true }).fields.headline?.source).toBe('foundry')
    expect(fillGraphic(p, { world, foundryVerified: false }).fields.headline?.source).toBe('measured')
    expect(fillGraphic(p, { world }).team?.id).toBe('NBA')
  })
})

describe('GraphicFrame', () => {
  it('draws the same verified fields in both packages, with the package tokens and the simulated mark', () => {
    const f = fillGraphic(packet({}), { world })
    const { container, rerender } = render(<GraphicFrame filled={f} template={TEMPLATES.byline} mark phase="still" />)
    expect(container.querySelector('.gframe')).toHaveAttribute('data-template', 'byline')
    expect(container.querySelector('.gx-flash')).toHaveTextContent('Vantreight')
    expect(screen.getByText('Simulated output')).toBeInTheDocument()
    expect(container.querySelector('.gx-shirt')).not.toBeNull()
    rerender(<GraphicFrame filled={f} template={TEMPLATES.northgate} mark phase="still" />)
    expect(container.querySelector('.gframe')).toHaveAttribute('data-template', 'northgate')
    expect(container.querySelector('.gx-flash')).toHaveTextContent('Vantreight')
    expect(container.querySelector('.gx-numeral')).toHaveTextContent('9')
    expect(container.textContent).not.toMatch(/undefined|null|NaN/)
  })

  it('lists only filled fields, each with a known source label', () => {
    const f = fillGraphic(packet({}), { world })
    const list = filledList(f)
    expect(list.map((x) => x.key)).toEqual(['player', 'number', 'score', 'clock', 'metric', 'kit'])
    for (const x of list) expect(SOURCE_LABEL[x.source]).toBeTruthy()
  })
})

describe('formats: lower third, corner box, player spotlight, full-screen analysis', () => {
  const sub = packet({
    template_id: 'substitution',
    source_kind: 'substitution',
    source_id: 'E1958',
    title: 'SUBSTITUTION · Northbridge',
    subtitle: '',
    player_ids: ['NBA-20', 'NBA-11'],
    data: { on: { id: 'NBA-20', number: 20, name: 'Theo Marchetti-Bose' }, off: { id: 'NBA-11', number: 11, name: 'Sami Haddad-Rhys' }, clock: "70'" },
  })
  const story = packet({ template_id: 'channel_pressure', source_kind: 'insight', source_id: 'I-1', title: 'Northbridge attacks concentrated on the right', subtitle: '91% of entries', team_id: null, player_ids: [] })

  it('every template defines all four formats, each with a take transition of 600 ms or less, and a default per family', () => {
    for (const id of TEMPLATE_IDS) {
      const t = TEMPLATES[id]
      for (const f of FORMAT_IDS) {
        expect(t.formats[f].name).toBeTruthy()
        expect(t.formats[f].ms).toBeLessThanOrEqual(600)
      }
      expect(t.defaultFormat.breakthrough).toBe('pip')
      expect(t.defaultFormat.comparison).toBe('full')
    }
    // the partner names its own formats: the model stays template-driven
    expect(TEMPLATES.northgate.formats.pip.name).not.toBe(TEMPLATES.byline.formats.pip.name)
  })

  it('a player spotlight needs a named player; a stats panel needs a corner box or a full frame', () => {
    expect(formatAvailability(fillGraphic(packet({}), { world })).spotlight).toBeNull()
    expect(formatAvailability(fillGraphic(sub, { world })).spotlight).toBeNull()
    expect(formatAvailability(fillGraphic(story, { world })).spotlight).toMatch(/No named player/)
    const stats = fillGraphic(packet({ template_id: 'stat_comparison', source_kind: 'stats', title: 'HALF-TIME · Northbridge 1–0 Riverton', data: { label: 'Half-time', rows: [{ key: 'shots', label: 'Shots', home: 7, away: 15 }] } }), { world })
    expect(formatAvailability(stats).lower).not.toBeNull()
    // an unavailable pick falls back to the template's default
    expect(resolveFormat(fillGraphic(story, { world }), TEMPLATES.byline, 'spotlight')).toBe('lower')
    expect(resolveFormat(stats, TEMPLATES.byline, 'lower')).toBe('full')
  })

  it('draws each format from the same verified fields, with the simulated mark', () => {
    const f = fillGraphic(packet({}), { world })
    const { container, rerender } = render(<GraphicFrame filled={f} template={TEMPLATES.byline} format="pip" mark phase="still" />)
    expect(container.querySelector('.gframe')).toHaveAttribute('data-format', 'pip')
    expect(container.querySelector('.fx-pip')).toHaveTextContent('Nico Vantreight')
    rerender(<GraphicFrame filled={f} template={TEMPLATES.byline} format="spotlight" mark phase="still" />)
    expect(container.querySelector('.fx-spot .gx-shirt')).not.toBeNull()
    expect(container.querySelector('.fx-spot')).toHaveTextContent(/Vantreight/)
    expect(container.querySelector('.fx-spot')).toHaveTextContent(/1 goal in this match/)
    rerender(<GraphicFrame filled={f} template={TEMPLATES.byline} format="full" mark phase="still" />)
    expect(container.querySelector('.gframe')).toHaveAttribute('data-full', 'true')
    expect(container.querySelector('.fx-full')).toHaveTextContent('Official match events · team sheet')
    expect(screen.getByText('Simulated output')).toBeInTheDocument()
    // the partner template pictures players as a numeral block in every format
    rerender(<GraphicFrame filled={f} template={TEMPLATES.northgate} format="spotlight" mark phase="still" />)
    expect(container.querySelector('.fx-spot .fx-numeral')).toHaveTextContent('9')
    expect(container.textContent).not.toMatch(/undefined|null|NaN/)
  })

  it('the corner box carries a moving picture when given one (the animated tactical breakdown)', () => {
    const f = fillGraphic(packet({ template_id: 'tactical_moment', source_kind: 'tactical', source_id: view.moment_id, title: "Better option on · 7'", subtitle: 'x' }), { world, view })
    const { container } = render(<GraphicFrame filled={f} template={TEMPLATES.byline} media={<div className="clip-stub">clip</div>} phase="still" />)
    expect(container.querySelector('.gframe')).toHaveAttribute('data-format', 'pip')
    expect(container.querySelector('.fx-pip__box .clip-stub')).not.toBeNull()
    expect(container.querySelector('.fx-pip__cap')).toHaveTextContent(view.title)
  })

  it('a substitution swaps the shirts: the player going off and the player coming on, both from the official event', () => {
    const f = fillGraphic(sub, { world })
    const { container } = render(<GraphicFrame filled={f} template={TEMPLATES.byline} format="full" phase="still" />)
    expect(container.querySelector('.fx-swap__side[data-side="off"]')).toHaveTextContent(/11/)
    expect(container.querySelector('.fx-swap__side[data-side="on"]')).toHaveTextContent(/20/)
    expect(heading(f, TEMPLATES.byline).title).toBe('Marchetti-Bose on, Haddad-Rhys off')
  })

  it('a tactical change shows the measured shape shift, with a direction word and no inferred intent', () => {
    const f = fillGraphic(packet({ template_id: 'tactical_moment', source_kind: 'tactical', source_id: 'T-shape' }), {
      world,
      tactics: {
        'T-shape': {
          moment_id: 'T-shape', kind: 'shape_change', label: 'Shape after substitution', team_id: 'NBA', at_ms: 4_200_000, seq: 1, display_clock: "70'", title: 'Northbridge after Marchetti-Bose replaces Haddad-Rhys',
          observed: [{ label: 'Back-line height change', value: 4.2, unit: 'm' }, { label: 'Team length change', value: -3.1, unit: 'm' }, { label: 'Team width change', value: 0.4, unit: 'm' }],
          summary: '', interpretation: '', unknowns: [], evidence_event_ids: [], focus_player_ids: [], frame_ms: 0, significance: 0, whatif: false, available_ms: 0, available_seq: 0,
        },
      },
    })
    expect(shapeShift(f).map((r) => `${r.label} ${r.word}`)).toEqual(['Back line higher', 'Team length shorter', 'Team width wider'])
    const { container } = render(<GraphicFrame filled={f} template={TEMPLATES.byline} format="full" phase="still" />)
    expect(container.querySelector('.fx-shape')).toHaveTextContent('+4.2 m higher')
    expect(container.querySelector('.fx-shape')).toHaveTextContent('-3.1 m shorter')
    expect(container.textContent).not.toMatch(/instruct|intend|wanted|would have/i)
  })

  it('every larger format lists only filled facts, each with a provenance tone', () => {
    for (const p of [packet({}), sub, story]) {
      for (const x of onAirFacts(fillGraphic(p, { world }))) {
        expect(x.value).toBeTruthy()
        expect(['measured', 'ai', 'history']).toContain(x.tone)
      }
    }
  })
})
