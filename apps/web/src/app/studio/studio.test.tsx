import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { fillGraphic } from '../../components/Broadcast/fill'
import { TEMPLATES } from '../../components/Broadcast/templates'
import type { MatchSessionStore } from '../../services/matchSession'
import { indexWorld } from '../../services/matchView'
import { MatchDetailSchema } from '../../services/schemas'
import type { OverlayPacket } from '../../services/schemas'
import { DETAIL } from '../../test/stageFixtures'
import { Monitors } from './Monitors'
import type { MonitorsProps } from './Monitors'
import { airBlock, invalidated, lastCut, moveItem, programmePacket } from './studioModel'

const world = indexWorld(MatchDetailSchema.parse(DETAIL))

function goal(extra: Partial<OverlayPacket> = {}): OverlayPacket {
  return {
    id: 'O-E0761',
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

const store = { matchId: 'demo', playhead: () => 0 } as unknown as MatchSessionStore
const bug = { home: { id: 'NBA', name: 'Northbridge', short: 'Northbridge', code: 'NBA', primary: '#8E1F3A', secondary: '#fff', number: '#fff' }, away: { id: 'RVC', name: 'Riverton', short: 'Riverton', code: 'RVC', primary: '#1F6FEB', secondary: '#fff', number: '#fff' }, score: { home: 1, away: 0, checking: false }, clock: "28'" }

function monitors(selected: OverlayPacket | null, onAir: OverlayPacket | null, extra: Partial<MonitorsProps> = {}) {
  const onAction = vi.fn(async () => {})
  const props: MonitorsProps = {
    selected,
    selectedFill: selected ? fillGraphic(selected, { world }) : null,
    onAir,
    onAirFill: onAir ? fillGraphic(onAir, { world }) : null,
    airPhase: 'in',
    next: null,
    cut: null,
    store,
    world,
    programme: <div className="feed-stub" />,
    template: TEMPLATES.byline,
    bug,
    minuteOf: () => "28'",
    onAction,
    formatOf: () => null,
    onFormat: () => {},
    clips: false,
    guides: false,
    ...extra,
  }
  return { ...render(<Monitors {...props} />), onAction }
}

describe('air safety: nothing invalidated by VAR or a correction can go to air', () => {
  it('a graphic held by a VAR check cannot be approved: every take and schedule action is disabled', () => {
    expect(airBlock(goal({ on_hold: true }))).toMatch(/Held by VAR/)
    monitors(goal({ on_hold: true }), null)
    expect(screen.getByRole('button', { name: 'Held by VAR' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'At the next stoppage' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'In 30 seconds' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Take to air now' })).toBeNull()
  })

  it('a graphic withdrawn after a correction offers no way to air: no take, no schedule, and a withdrawn slate', () => {
    const withdrawn = goal({ status: 'retracted', status_reason: 'Goal disallowed (offside, Law 11) at 72\'' })
    expect(airBlock(withdrawn)).toMatch(/Withdrawn/)
    const { container } = monitors(withdrawn, null)
    expect(screen.queryByRole('button', { name: 'Take to air now' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'At the next stoppage' })).toBeNull()
    expect(container.querySelector('.slate[data-kind="withdrawn"]')).toHaveTextContent(/cannot air/)
    expect(screen.getByText('Cannot air: its source was withdrawn')).toBeInTheDocument()
  })

  it('the programme never shows a graphic that is held or withdrawn, and one pulled by a correction is cut', () => {
    const onAir = goal({ status: 'on_screen', display_from_ms: 1_640_000 })
    expect(programmePacket([onAir])?.id).toBe('O-E0761')
    expect(programmePacket([{ ...onAir, on_hold: true }])).toBeNull()
    expect(programmePacket([{ ...onAir, status: 'retracted' }])).toBeNull()
    expect(invalidated({ ...onAir, status: 'retracted' })).toBe(true)
    expect(invalidated({ ...onAir, status: 'hidden', on_hold: true })).toBe(true)
    expect(invalidated({ ...onAir, status: 'hidden' })).toBe(false)
    expect(lastCut([{ ...onAir, status: 'hidden', on_hold: true }])?.id).toBe('O-E0761')
  })

  it('the programme transport says plainly when a VAR check cut a graphic from air', () => {
    monitors(null, null, { cut: goal({ status: 'hidden', on_hold: true }) })
    expect(screen.getByText(/Cut from air/)).toHaveTextContent('A VAR check is reviewing the goal.')
  })

  it('only a proposed graphic is approvable', () => {
    expect(airBlock(goal())).toBeNull()
    expect(airBlock(goal({ status: 'approved' }))).not.toBeNull()
    expect(airBlock(goal({ status: 'expired' }))).not.toBeNull()
  })
})

describe('programme monitor and formats', () => {
  it('labels the programme as simulated output and states the signal path (nothing connected)', () => {
    const { container } = monitors(goal(), goal({ status: 'on_screen' }))
    expect(screen.getByText('Demo output: simulated programme feed. No broadcast hardware or playout is connected.')).toBeInTheDocument()
    expect(screen.getByRole('list', { name: 'Signal path in this demo' })).toHaveTextContent(/A broadcaster's live feed would connect here/)
    expect(screen.getByRole('list', { name: 'Signal path in this demo' })).toHaveTextContent(/Programme outNot connected/)
    expect(container.querySelectorAll('.gframe__mark')).toHaveLength(2)
  })

  it('offers the template\'s four formats in preview; the producer\'s pick reaches the frame', () => {
    const onFormat = vi.fn()
    const { container, rerender } = render(<div />)
    const p = goal()
    const props = (fmt: 'pip' | null): MonitorsProps => ({
      selected: p,
      selectedFill: fillGraphic(p, { world }),
      onAir: null,
      onAirFill: null,
      airPhase: 'in',
      next: null,
      cut: null,
      store,
      world,
      programme: null,
      template: TEMPLATES.byline,
      bug,
      minuteOf: () => "28'",
      onAction: async () => {},
      formatOf: () => fmt,
      onFormat,
      clips: false,
      guides: false,
    })
    rerender(<Monitors {...props(null)} />)
    const group = screen.getByRole('group', { name: 'Format' })
    for (const name of ['Lower third', 'Corner box', 'Player spotlight', 'Full-screen analysis']) expect(screen.getByRole('radio', { name })).toBeInTheDocument()
    expect(group).toBeInTheDocument()
    expect(container.querySelector('.monitor[data-kind="pvw"] .gframe')).toHaveAttribute('data-format', 'lower')
    screen.getByRole('radio', { name: 'Corner box' }).click()
    expect(onFormat).toHaveBeenCalledWith('O-E0761', 'pip')
    rerender(<Monitors {...props('pip')} />)
    expect(container.querySelector('.monitor[data-kind="pvw"] .gframe')).toHaveAttribute('data-format', 'pip')
    expect(container.querySelector('.monitor[data-kind="pvw"] .fx-pip')).toHaveTextContent('Nico Vantreight')
  })

  it('locks the format while the graphic is on air', () => {
    monitors(goal({ status: 'on_screen' }), null)
    expect(screen.getByRole('radio', { name: 'Corner box' })).toBeDisabled()
    expect(screen.getByText(/format is locked/)).toBeInTheDocument()
  })
})

describe('package running order', () => {
  it('moves an item up or down and ignores moves past either end', () => {
    expect(moveItem(['a', 'b', 'c'], 2, -1)).toEqual(['a', 'c', 'b'])
    expect(moveItem(['a', 'b', 'c'], 0, 1)).toEqual(['b', 'a', 'c'])
    expect(moveItem(['a', 'b', 'c'], 0, -1)).toEqual(['a', 'b', 'c'])
    expect(moveItem(['a', 'b', 'c'], 2, 1)).toEqual(['a', 'b', 'c'])
  })
})
