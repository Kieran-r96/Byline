import { useRef } from 'react'
import type { KeyboardEvent, ReactNode } from 'react'
import './SegmentedControl.css'

export interface SegmentOption<T extends string | number> {
  value: T
  label: ReactNode
  /** Accessible name when label is not plain text. */
  ariaLabel?: string
}

export interface SegmentedControlProps<T extends string | number> {
  /** Accessible name of the radiogroup. */
  label: string
  options: readonly SegmentOption<T>[]
  value: T
  onChange: (value: T) => void
  size?: 'md' | 'sm'
  className?: string
  disabled?: boolean
}

/**
 * Single-select segmented control with WAI-ARIA radiogroup semantics:
 * one tab stop (roving tabindex), Arrow keys move + select, Home/End jump.
 */
export function SegmentedControl<T extends string | number>({
  label,
  options,
  value,
  onChange,
  size = 'md',
  className,
  disabled = false,
}: SegmentedControlProps<T>) {
  const refs = useRef<Array<HTMLButtonElement | null>>([])
  const selectedIndex = Math.max(
    0,
    options.findIndex((o) => o.value === value),
  )

  const moveTo = (index: number) => {
    const count = options.length
    const next = ((index % count) + count) % count
    const option = options[next]
    if (!option) return
    onChange(option.value)
    refs.current[next]?.focus()
  }

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        event.preventDefault()
        moveTo(index + 1)
        break
      case 'ArrowLeft':
      case 'ArrowUp':
        event.preventDefault()
        moveTo(index - 1)
        break
      case 'Home':
        event.preventDefault()
        moveTo(0)
        break
      case 'End':
        event.preventDefault()
        moveTo(options.length - 1)
        break
      default:
        break
    }
  }

  return (
    <div
      role="radiogroup"
      aria-label={label}
      aria-disabled={disabled || undefined}
      className={['segmented', `segmented--${size}`, className ?? ''].join(' ').trim()}
    >
      {options.map((option, index) => {
        const checked = index === selectedIndex
        return (
          <button
            key={String(option.value)}
            ref={(el) => {
              refs.current[index] = el
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            aria-label={option.ariaLabel}
            tabIndex={checked ? 0 : -1}
            disabled={disabled}
            className="segmented__option"
            onClick={() => onChange(option.value)}
            onKeyDown={(event) => onKeyDown(event, index)}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
