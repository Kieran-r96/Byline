import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { Icon } from '../icons/Icon'
import './Drawer.css'

export interface DrawerProps {
  open: boolean
  onClose: () => void
  title: string
  /** "right" = tablet slide-over, "bottom" = mobile sheet. */
  side: 'right' | 'bottom'
  headerExtra?: ReactNode
  children: ReactNode
  id?: string
  /** Non-modal: no scrim, the page beside it stays usable (the Commentator keeps the live moment in view). */
  modal?: boolean
  /** Wider panel for files and research. */
  wide?: boolean
  /** Label of the close control (defaults to "Close <title>"). */
  closeLabel?: string
}

/**
 * Slide-over (350ms). Right = modal drawer (tablet); bottom = non-modal sheet
 * that keeps the mobile bottom nav usable. Always mounted so it can animate;
 * inert when closed. Escape and scrim close it; focus moves to the close
 * button on open and returns to the opener on close.
 */
export function Drawer({ open, onClose, title, side, headerExtra, children, id, modal: modalProp, wide = false, closeLabel }: DrawerProps) {
  const closeRef = useRef<HTMLButtonElement>(null)
  const returnFocus = useRef<HTMLElement | null>(null)
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  useEffect(() => {
    if (!open) return undefined
    returnFocus.current = document.activeElement as HTMLElement | null
    closeRef.current?.focus({ preventScroll: true })
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented) onCloseRef.current()
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      returnFocus.current?.focus({ preventScroll: true })
      returnFocus.current = null
    }
  }, [open])

  const modal = modalProp ?? side === 'right'

  return (
    <div className={`drawer drawer--${side}`} data-open={open} data-modal={modal} data-wide={wide} inert={!open}>
      {modal && <div className="drawer__scrim" onClick={onClose} aria-hidden="true" />}
      <div
        id={id}
        className="drawer__panel"
        role="dialog"
        aria-modal={modal}
        aria-label={title}
      >
        {side === 'bottom' && <span className="drawer__handle" aria-hidden="true" />}
        <div className="drawer__header">
          <h2 className="drawer__title">{title}</h2>
          {headerExtra}
          <button ref={closeRef} type="button" className="icon-button" onClick={onClose} aria-label={closeLabel ?? `Close ${title}`}>
            <Icon name="close" size={20} />
          </button>
        </div>
        <div className="drawer__body">{children}</div>
      </div>
    </div>
  )
}
