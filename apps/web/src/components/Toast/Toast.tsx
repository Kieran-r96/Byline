import { useEffect, useState } from 'react'
import './Toast.css'

export interface ToastData {
  id: number
  message: string
  actionLabel?: string
  onAction?: () => void
}

/**
 * Single polite toast with an optional Undo. Auto-dismisses after 6 s, but
 * the timer pauses while the toast has focus or hover (WCAG 2.2.1).
 */
export function Toast({ toast, onDone }: { toast: ToastData | null; onDone: () => void }) {
  const [held, setHeld] = useState(false)
  useEffect(() => {
    if (!toast || held) return undefined
    const id = setTimeout(onDone, 6000)
    return () => clearTimeout(id)
  }, [toast, onDone, held])

  return (
    <div className="toast-region" aria-live="polite" role="status">
      {toast && (
        <div
          className="toast"
          key={toast.id}
          onFocus={() => setHeld(true)}
          onBlur={() => setHeld(false)}
          onMouseEnter={() => setHeld(true)}
          onMouseLeave={() => setHeld(false)}
        >
          <span className="toast__mark" aria-hidden="true" />
          <span className="toast__msg">{toast.message}</span>
          {toast.onAction && (
            <button
              type="button"
              className="toast__action"
              onClick={() => {
                toast.onAction?.()
                onDone()
              }}
            >
              {toast.actionLabel ?? 'Undo'}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
