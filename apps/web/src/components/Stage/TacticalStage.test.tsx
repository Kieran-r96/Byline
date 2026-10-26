import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { createRef } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { indexWorld } from '../../services/matchView'
import { MatchDetailSchema, MomentViewSchema } from '../../services/schemas'
import { DETAIL, VIEW_OPTION, VIEW_OPTION_ILL, VIEW_PRESS } from '../../test/stageFixtures'
import { TacticalStage } from './TacticalStage'
import type { TacticalStageHandle } from './TacticalStage'

const world = indexWorld(MatchDetailSchema.parse(DETAIL))
const option = MomentViewSchema.parse(VIEW_OPTION)
const ill = MomentViewSchema.parse(VIEW_OPTION_ILL)
const press = MomentViewSchema.parse(VIEW_PRESS)

const layer = (container: HTMLElement, name: string) => container.querySelector(`[data-layer="${name}"]`)
const current = () => screen.getByRole('list', { name: 'Steps' }).querySelector('[aria-current="step"]')

afterEach(() => {
  vi.useRealTimers()
})

describe('TacticalStage (SVG fallback in jsdom)', () => {
  it('renders the accessible 2D fallback with the step rail and the first step', () => {
    const { container } = render(<TacticalStage matchId="BYLINE-01" view={option} world={world} audience="pro" />)
    const stage = screen.getByRole('region', { name: /Tactical stage/ })
    expect(stage).toHaveAttribute('data-renderer', 'svg')
    expect(screen.getByRole('img')).toHaveAccessibleName(/Step 1 of 7: The decision/)
    const rail = screen.getByRole('list', { name: 'Steps' })
    expect(within(rail).getAllByRole('button')).toHaveLength(7)
    expect(current()).toHaveTextContent('The decision')
    expect(screen.getByRole('button', { name: /^Back\s*to the previous step$/ })).toBeDisabled()
    // the big Next names the step it leads to
    expect(screen.getByRole('button', { name: /^Next:\s*Their lines$/ })).toBeInTheDocument()
    // step 1 draws the direction, not the passes
    expect(layer(container, 'direction')).toHaveAttribute('opacity', '1')
    expect(layer(container, 'actualPass')).toHaveAttribute('opacity', '0')
    expect(layer(container, 'hypothetical')).toHaveAttribute('opacity', '0')
  })

  it('does not advance on its own: the viewer moves on with Next', () => {
    vi.useFakeTimers()
    render(<TacticalStage matchId="BYLINE-01" view={option} world={world} audience="fan" />)
    expect(screen.getByRole('button', { name: 'Auto-play' })).toHaveAttribute('aria-pressed', 'false')
    act(() => {
      vi.advanceTimersByTime(60_000)
    })
    expect(current()).toHaveTextContent('On the ball')
  })

  it('steps forward and back; what happened, the measured lanes and the hypothetical are separate steps', () => {
    const onStepChange = vi.fn()
    const { container } = render(<TacticalStage matchId="BYLINE-01" view={option} world={world} audience="pro" onStepChange={onStepChange} />)
    const live = container.querySelector('[aria-live="polite"]')!
    const next = () => fireEvent.click(screen.getByRole('button', { name: /^Next:/ }))
    next()
    expect(current()).toHaveTextContent('Their lines')
    expect(live).toHaveTextContent('18.5 m apart')
    expect(layer(container, 'lines')).toHaveAttribute('opacity', '1')
    next()
    expect(live).toHaveTextContent('What happened')
    expect(layer(container, 'actualPass')).toHaveAttribute('opacity', '1')
    expect(layer(container, 'alternatives')).toHaveAttribute('opacity', '0')
    next()
    expect(live).toHaveTextContent('Measured options')
    expect(layer(container, 'alternatives')).toHaveAttribute('opacity', '1')
    expect(layer(container, 'actualPass')).toHaveAttribute('opacity', '0.26')
    next()
    expect(layer(container, 'hypothetical')).toHaveAttribute('opacity', '1')
    expect(layer(container, 'actualPass')).toHaveAttribute('opacity', '0')
    fireEvent.click(screen.getByRole('button', { name: /^Back\s*to the previous step$/ }))
    expect(current()).toHaveTextContent('Measured options')
    expect(onStepChange).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'measured' }), 3)
  })

  it('labels the hypothetical step and draws it only there', () => {
    const { container } = render(<TacticalStage matchId="BYLINE-01" view={option} world={world} audience="pro" initialStep={4} />)
    const live = container.querySelector('[aria-live="polite"]')!
    expect(live).toHaveTextContent('Hypothetical · not what happened')
    expect(layer(container, 'hypothetical')).toHaveAttribute('opacity', '1')
    expect(screen.getByRole('img')).toHaveAccessibleName(/Hypothetical · not what happened/)
    fireEvent.click(screen.getByRole('button', { name: /Takeaway/ }))
    expect(layer(container, 'hypothetical')).toHaveAttribute('opacity', '0')
    expect(live).toHaveTextContent("What the data can't tell us")
    expect(live).toHaveTextContent('Whether the passer could see the open player')
    // from the last step the big button starts again
    fireEvent.click(screen.getByRole('button', { name: 'Start again' }))
    expect(current()).toHaveTextContent('The decision')
  })

  it('shows the simulated continuation after the hypothetical, dotted and labelled', () => {
    const { container } = render(<TacticalStage matchId="BYLINE-01" view={option} world={world} audience="fan" initialStep={5} />)
    const live = container.querySelector('[aria-live="polite"]')!
    expect(current()).toHaveTextContent('Then?')
    expect(live).toHaveTextContent('Simulated · not what happened · no outcome implied')
    expect(live).toHaveTextContent('N. Vantreight')
    expect(layer(container, 'contFrom')).toHaveAttribute('opacity', '1')
    expect(layer(container, 'contPass')).toHaveAttribute('opacity', '1')
    expect(layer(container, 'hypothetical')).toHaveAttribute('opacity', '0.26')
    expect(layer(container, 'actualPass')).toHaveAttribute('opacity', '0')
    expect(layer(container, 'contFrom')).toHaveTextContent('Simulated continuation')
    expect(layer(container, 'contPass')?.querySelector('path')).toHaveAttribute('stroke-dasharray', '0.02 0.75')
  })

  it('walks the illustrative sketch step by step, labelled, apart from the real pass, and ends on one sentence', () => {
    const { container } = render(<TacticalStage matchId="BYLINE-01" view={ill} world={world} audience="fan" initialStep={4} />)
    const live = container.querySelector('[aria-live="polite"]')!
    expect(within(screen.getByRole('list', { name: 'Steps' })).getAllByRole('button')).toHaveLength(8)
    const next = () => fireEvent.click(screen.getByRole('button', { name: /^Next:/ }))
    next()
    expect(current()).toHaveTextContent('Then?')
    expect(live).toHaveTextContent('Illustrative · not what happened · no outcome implied')
    expect(screen.getByRole('img')).toHaveAccessibleName(/Illustrative · not what happened/)
    expect(layer(container, 'illRun')).toHaveAttribute('opacity', '1')
    expect(layer(container, 'illDefend')).toHaveAttribute('opacity', '1')
    expect(layer(container, 'actualPass')).toHaveAttribute('opacity', '0')
    expect(layer(container, 'hypothetical')).toHaveAttribute('opacity', '0')
    // ghost shirts for the three moved players; their frozen spots stay drawn (faded)
    expect(container.querySelectorAll('[data-layer="illGhostShirts"] [data-ghost]')).toHaveLength(3)
    expect(layer(container, 'illFrom')).toHaveTextContent('Illustrative')
    next()
    expect(current()).toHaveTextContent('The ball in')
    expect(layer(container, 'illBall')).toHaveAttribute('opacity', '1')
    expect(layer(container, 'illContest')).toHaveTextContent('Could block it · Tremaine')
    expect(layer(container, 'illContest')).toHaveTextContent('Could get there first · Ndiaye-Shaw')
    next()
    expect(current()).toHaveTextContent('In short')
    expect(container.querySelector('.stage__takeaway')).toHaveTextContent('S. Haddad-Rhys was free with an open passing lane, but the ball went to N. Vantreight and was cut out.')
    expect(layer(container, 'actualPass')).toHaveAttribute('opacity', '1')
    expect(layer(container, 'bestLane')).toHaveAttribute('opacity', '1')
    for (const l of ['illRun', 'illBall', 'illContest', 'hypothetical']) expect(layer(container, l)).toHaveAttribute('opacity', '0')
    expect(container.querySelector('[data-layer="illGhostShirts"]')).toBeNull()
  })

  it('takes arrow keys when the stage has focus', () => {
    render(<TacticalStage matchId="BYLINE-01" view={option} world={world} audience="fan" />)
    const stage = screen.getByRole('region', { name: /Tactical stage/ })
    stage.focus()
    fireEvent.keyDown(stage, { key: 'ArrowRight' })
    fireEvent.keyDown(stage, { key: 'ArrowRight' })
    expect(current()).toHaveTextContent('What happened')
    fireEvent.keyDown(stage, { key: 'ArrowLeft' })
    expect(current()).toHaveTextContent('The defence')
  })

  it('auto-play is optional, holds each step at least seven seconds, and space pauses it', () => {
    vi.useFakeTimers()
    render(<TacticalStage matchId="BYLINE-01" view={option} world={world} audience="pro" autoplay />)
    expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument()
    act(() => {
      vi.advanceTimersByTime(6_500)
    })
    expect(current()).toHaveTextContent('The decision')
    act(() => {
      vi.advanceTimersByTime(14_000)
    })
    expect(current()).not.toHaveTextContent('The decision')
    const stage = screen.getByRole('region', { name: /Tactical stage/ })
    fireEvent.keyDown(stage, { key: ' ' })
    expect(screen.getByRole('button', { name: 'Auto-play' })).toBeInTheDocument()
    const at = current()?.textContent
    act(() => {
      vi.advanceTimersByTime(30_000)
    })
    expect(current()?.textContent).toBe(at)
  })

  it('greys a withdrawn moment, strikes its title and shows the verified read only as text', () => {
    const { container } = render(
      <TacticalStage matchId="BYLINE-01" view={option} world={world} audience="pro" initialStep={6} withdrawn={{ reason: 'Evidence ruled out by VAR.' }} />,
    )
    expect(screen.getByRole('region', { name: /Tactical stage/ })).toHaveClass('stage--withdrawn')
    expect(container.querySelector('[aria-live="polite"]')).toHaveTextContent('Withdrawn Evidence ruled out by VAR.')
    expect(container.querySelector('.stage__caption-title s')).toHaveTextContent('Takeaway')
    const verified = render(<TacticalStage matchId="BYLINE-01" view={option} world={world} audience="pro" initialStep={6} verified={{ text: 'A verified line.', label: 'Deep analysis · verified' }} />)
    expect(verified.container.querySelector('.stage__verified')).toHaveTextContent('Deep analysis · verifiedA verified line.')
  })

  it('adapts a press: four steps, shape and lines, no passes', () => {
    const { container } = render(<TacticalStage matchId="BYLINE-01" view={press} world={world} audience="pro" initialStep={1} />)
    expect(within(screen.getByRole('list', { name: 'Steps' })).getAllByRole('button')).toHaveLength(4)
    expect(layer(container, 'shape')).toHaveAttribute('opacity', '1')
    expect(layer(container, 'lines')).toHaveAttribute('opacity', '1')
    expect(layer(container, 'actualPass')).toBeNull()
  })
})

describe('TacticalStage choose mode (What would you do?)', () => {
  it('offers the measured options without giving away the real pass, then reveals on request', () => {
    const onChoose = vi.fn()
    const { container } = render(<TacticalStage matchId="BYLINE-01" view={option} world={world} audience="fan" mode="choose" onChoose={onChoose} />)
    const live = container.querySelector('[aria-live="polite"]')!
    expect(live).toHaveTextContent("You're M. Lindqvist")
    expect(layer(container, 'actualPass')).toHaveAttribute('opacity', '0')
    const choices = screen.getAllByRole('button', { name: /^Pass to/ })
    expect(choices.map((b) => b.textContent)).toEqual(['Pass to Haddad-Rhys', 'Pass to Vantreight', 'Pass to Rennard'])
    expect(container.textContent).not.toMatch(/intercept|cut it out/i)
    const reveal = screen.getByRole('button', { name: 'Show what happened' })
    expect(reveal).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Pass to Haddad-Rhys' }))
    expect(onChoose).toHaveBeenCalledWith('NBA-11')
    expect(screen.getByRole('button', { name: 'Pass to Haddad-Rhys' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(reveal)
    expect(live).toHaveTextContent('The real pass went to N. Vantreight')
    expect(live).toHaveTextContent('You picked S. Haddad-Rhys')
    expect(layer(container, 'actualPass')).toHaveAttribute('opacity', '1')
  })

  it('can be revealed by the parent (prop or handle)', () => {
    const ref = createRef<TacticalStageHandle>()
    const { container, rerender } = render(<TacticalStage ref={ref} matchId="BYLINE-01" view={option} world={world} audience="fan" mode="choose" revealed={false} />)
    expect(screen.queryByRole('button', { name: 'Show what happened' })).toBeNull()
    rerender(<TacticalStage ref={ref} matchId="BYLINE-01" view={option} world={world} audience="fan" mode="choose" revealed />)
    expect(container.querySelector('[aria-live="polite"]')).toHaveTextContent('The real pass went to N. Vantreight')

    const other = render(<TacticalStage ref={ref} matchId="BYLINE-01" view={option} world={world} audience="fan" mode="choose" />)
    act(() => ref.current?.reveal())
    expect(other.container.querySelector('[aria-live="polite"]')).toHaveTextContent('The real pass went to')
  })
})

describe('TacticalStage clip mode (a graphics-package asset)', () => {
  it('draws the picture only: no caption, rail or controls, and it is not a tab stop', () => {
    // step 5 of 7 (decision, lines, what happened, measured options, What if?, Then?, takeaway) is the hypothetical
    const { container } = render(<TacticalStage clip matchId="BYLINE-01" view={option} world={world} audience="pro" initialStep={4} />)
    const clip = screen.getByRole('region', { name: /Tactical clip/ })
    expect(clip).not.toHaveAttribute('tabindex')
    expect(screen.queryByRole('list', { name: 'Steps' })).toBeNull()
    expect(screen.queryAllByRole('button')).toHaveLength(0)
    expect(container.querySelector('[aria-live]')).toBeNull()
    // the hypothetical step keeps its label inside the clip
    expect(clip).toHaveTextContent('Hypothetical · not what happened')
    expect(layer(container, 'hypothetical')).toHaveAttribute('opacity', '1')
  })

  it('plays the steps on a loop at clip pace and starts again after the last', () => {
    vi.useFakeTimers()
    const onStepChange = vi.fn()
    render(<TacticalStage clip clipStepMs={2000} matchId="BYLINE-01" view={option} world={world} audience="pro" onStepChange={onStepChange} />)
    const clip = screen.getByRole('region', { name: /Tactical clip/ })
    expect(clip).toHaveAttribute('data-step', 'freeze')
    act(() => vi.advanceTimersByTime(2000))
    expect(clip).toHaveAttribute('data-step', 'situation')
    for (let i = 0; i < 5; i += 1) act(() => vi.advanceTimersByTime(2000))
    expect(clip).toHaveAttribute('data-step', 'takeaway')
    act(() => vi.advanceTimersByTime(1700))
    expect(clip).toHaveAttribute('data-step', 'freeze')
    expect(onStepChange).toHaveBeenCalledWith(expect.objectContaining({ id: 'takeaway' }), 6)
  })

  it('keeps the illustrative label inside the clip', () => {
    render(<TacticalStage clip matchId="BYLINE-01" view={ill} world={world} audience="pro" initialStep={5} />)
    const clip = screen.getByRole('region', { name: /Tactical clip/ })
    expect(clip).toHaveAttribute('data-step', 'illustrative')
    expect(clip).toHaveTextContent('Illustrative · not what happened · no outcome implied')
  })
})
