import { useEffect, useId, useRef, useState } from 'react'

import type { Moment } from '../../services/showcase'
import './KeyMoments.css'

export interface KeyMomentsProps {
  moments: readonly Moment[]
  onJump: (moment: Moment) => void
  disabled?: boolean
}

/**
 * Demo checkpoints (blueprint "showcase checkpoints"): jump the replay to just before a moment.
 * Jumping only seeks; the story still has to be detected live from the events.
 */
export function KeyMoments({ moments, onJump, disabled }: KeyMomentsProps) {
  const [open, setOpen] = useState(false)
  const listId = useId()
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false)
        trigger.current?.focus()
      }
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  if (moments.length === 0) return null
  return (
    <div className="moments" ref={root}>
      <button
        ref={trigger}
        type="button"
        className="moments__trigger"
        aria-expanded={open}
        aria-controls={listId}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
      >
        <svg width="18" height="18" viewBox="0 0 20 20" aria-hidden="true">
          <path d="M4 3.5v13M4 4h10l-2 3 2 3H4" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinejoin="round" />
        </svg>
        Key moments
      </button>
      {open && (
        <div className="moments__panel" role="dialog" aria-label="Key moments">
          <ul id={listId} className="moments__list">
            {moments.map((m) => (
              <li key={m.id}>
                <button
                  type="button"
                  className="moments__item"
                  onClick={() => {
                    setOpen(false)
                    onJump(m)
                  }}
                >
                  <span className="moments__clock numeric">{m.clock}</span>
                  <span className="moments__label">{m.label}</span>
                  {m.recorded_ai && <span className="moments__tag">AI verified</span>}
                </button>
              </li>
            ))}
          </ul>
          <p className="moments__note">Jumps to just before the moment. Stories are still detected live from the events.</p>
        </div>
      )}
    </div>
  )
}
