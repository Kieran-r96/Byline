import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { formatClock } from '../../lib/format'
import { ReplayControls } from './ReplayControls'
import type { ReplayControlsProps } from './ReplayControls'

function setup(overrides: Partial<ReplayControlsProps> = {}) {
  const props: ReplayControlsProps = {
    playing: false,
    speed: 1,
    positionSeconds: 754,
    durationSeconds: 5400,
    onPlayPause: vi.fn(),
    onRestart: vi.fn(),
    onSpeedChange: vi.fn(),
    onScrub: vi.fn(),
    ...overrides,
  }
  render(<ReplayControls {...props} />)
  return props
}

describe('ReplayControls', () => {
  it('calls onSpeedChange when a speed is clicked', async () => {
    const user = userEvent.setup()
    const props = setup()
    await user.click(screen.getByRole('radio', { name: '12 times speed' }))
    expect(props.onSpeedChange).toHaveBeenCalledWith(12)
  })

  it('supports keyboard speed selection via arrow keys', async () => {
    const user = userEvent.setup()
    const props = setup({ speed: 4 })
    screen.getByRole('radio', { name: '4 times speed' }).focus()
    await user.keyboard('{ArrowRight}')
    expect(props.onSpeedChange).toHaveBeenLastCalledWith(12)
    await user.keyboard('{End}')
    expect(props.onSpeedChange).toHaveBeenLastCalledWith(30)
  })

  it('toggles play/pause and restart with accessible names', async () => {
    const user = userEvent.setup()
    const props = setup()
    await user.click(screen.getByRole('button', { name: 'Play replay' }))
    expect(props.onPlayPause).toHaveBeenCalledTimes(1)
    await user.click(screen.getByRole('button', { name: 'Restart replay' }))
    expect(props.onRestart).toHaveBeenCalledTimes(1)
  })

  it('exposes the scrub slider with a spoken value', () => {
    setup()
    const slider = screen.getByRole('slider', { name: 'Replay position' })
    expect(slider).toHaveAttribute('aria-valuetext', '12 minutes 34 seconds of 90 minutes 0 seconds')
    expect(formatClock(754)).toBe('12:34')
  })
})
