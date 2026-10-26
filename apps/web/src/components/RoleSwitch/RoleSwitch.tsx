import type { Role } from '../../types/shell'
import { SegmentedControl } from '../SegmentedControl/SegmentedControl'
import type { SegmentOption } from '../SegmentedControl/SegmentedControl'

export interface RoleSwitchProps {
  value: Role
  onChange: (role: Role) => void
  className?: string
}

const ROLE_OPTIONS: readonly SegmentOption<Role>[] = [
  { value: 'commentator', label: 'Commentator' },
  { value: 'studio', label: 'Studio' },
  { value: 'fan', label: 'Fan' },
]

/** Commentator | Studio | Fan — radiogroup with arrow-key navigation. */
export function RoleSwitch({ value, onChange, className }: RoleSwitchProps) {
  return (
    <SegmentedControl
      label="Viewing role"
      options={ROLE_OPTIONS}
      value={value}
      onChange={onChange}
      className={className}
    />
  )
}
