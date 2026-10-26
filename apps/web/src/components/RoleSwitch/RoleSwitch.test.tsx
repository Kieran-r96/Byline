import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { Role } from '../../types/shell'
import { RoleSwitch } from './RoleSwitch'

function Harness({ onChange }: { onChange: (r: Role) => void }) {
  const [role, setRole] = useState<Role>('commentator')
  return (
    <RoleSwitch
      value={role}
      onChange={(r) => {
        setRole(r)
        onChange(r)
      }}
    />
  )
}

describe('RoleSwitch', () => {
  it('exposes radiogroup semantics with a single tab stop', () => {
    render(<Harness onChange={() => {}} />)
    expect(screen.getByRole('radiogroup', { name: 'Viewing role' })).toBeInTheDocument()
    const radios = screen.getAllByRole('radio')
    expect(radios).toHaveLength(3)
    expect(screen.getByRole('radio', { name: 'Commentator' })).toHaveAttribute('aria-checked', 'true')
    expect(radios.filter((r) => r.tabIndex === 0)).toHaveLength(1)
  })

  it('moves selection and focus with arrow keys, wrapping, plus Home/End', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)

    await user.tab()
    expect(screen.getByRole('radio', { name: 'Commentator' })).toHaveFocus()

    await user.keyboard('{ArrowRight}')
    const studio = screen.getByRole('radio', { name: 'Studio' })
    expect(studio).toHaveFocus()
    expect(studio).toHaveAttribute('aria-checked', 'true')
    expect(onChange).toHaveBeenLastCalledWith('studio')

    await user.keyboard('{ArrowRight}{ArrowRight}')
    expect(screen.getByRole('radio', { name: 'Commentator' })).toHaveFocus()
    expect(onChange).toHaveBeenLastCalledWith('commentator')

    await user.keyboard('{ArrowLeft}')
    expect(screen.getByRole('radio', { name: 'Fan' })).toHaveFocus()
    expect(onChange).toHaveBeenLastCalledWith('fan')

    await user.keyboard('{Home}')
    expect(onChange).toHaveBeenLastCalledWith('commentator')
    await user.keyboard('{End}')
    expect(onChange).toHaveBeenLastCalledWith('fan')
    expect(screen.getByRole('radio', { name: 'Fan' })).toHaveAttribute('tabindex', '0')
  })
})
