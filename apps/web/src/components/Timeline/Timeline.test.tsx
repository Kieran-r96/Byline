import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { TimelineMarker } from '../../types/shell'
import { formatMatchMinute } from '../../lib/format'
import { Timeline } from './Timeline'

// Test fixture only: not product data.
const MARKERS: TimelineMarker[] = [
  { id: 'm1', kind: 'goal', atSeconds: 1234, title: 'Test goal marker', teamId: 'NBA' },
  { id: 'm2', kind: 'yellow', atSeconds: 3000, title: 'Test caution marker' },
  { id: 'm3', kind: 'var', atSeconds: 5000, title: 'Test VAR marker' },
]

describe('Timeline', () => {
  it('calls onSeek with the marker time when a marker is clicked', async () => {
    const user = userEvent.setup()
    const onSeek = vi.fn()
    render(<Timeline markers={MARKERS} onSeek={onSeek} />)
    await user.click(screen.getByRole('button', { name: /^Goal, 21': Test goal marker/ }))
    expect(onSeek).toHaveBeenCalledTimes(1)
    expect(onSeek).toHaveBeenCalledWith(1234, MARKERS[0])
  })

  it('shows a tooltip on focus and seeks with the keyboard', async () => {
    const user = userEvent.setup()
    const onSeek = vi.fn()
    render(<Timeline markers={MARKERS} onSeek={onSeek} />)
    await user.tab()
    await user.tab()
    const tooltip = screen.getByRole('tooltip')
    expect(tooltip).toHaveTextContent('Yellow card')
    expect(tooltip).toHaveTextContent('Test caution marker')
    await user.keyboard('{Enter}')
    expect(onSeek).toHaveBeenCalledWith(3000, MARKERS[1])
  })

  it('renders an honest empty state with no markers', () => {
    render(<Timeline markers={[]} onSeek={() => {}} />)
    expect(screen.getByText(/Key moments appear here/)).toBeInTheDocument()
    expect(screen.queryAllByRole('button')).toHaveLength(0)
  })

  it('formats football minutes', () => {
    expect(formatMatchMinute(0)).toBe("1'")
    expect(formatMatchMinute(59)).toBe("1'")
    expect(formatMatchMinute(60)).toBe("2'")
    expect(formatMatchMinute(90 * 60 + 130)).toBe("90+3'")
  })
})
