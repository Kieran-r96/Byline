import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import type { WorldIndex } from '../services/matchView'
import type { Role } from '../types/shell'
import type { Analysis } from './App'
import { TacticAnalysis } from './TacticAnalysis'

/**
 * Analysis opens over the role's surface. A measured moment opens the guided 3D explanation (it never moves the
 * live match); an AI story opens its evidence beside the match picture. Escape or Close returns to exactly
 * where the user was, with focus back on the control that opened it.
 */
export function AnalysisLayer({
  analysis,
  role,
  matchId,
  world,
  theatre,
  evidencePanel,
  onClose,
  withdrawnReason,
}: {
  analysis: Analysis
  role: Role
  matchId: string
  world: WorldIndex
  theatre: ReactNode
  evidencePanel: ReactNode
  onClose: () => void
  /** Set when the moment's signal was withdrawn after an official correction. */
  withdrawnReason?: string | null
}) {
  const ref = useRef<HTMLDivElement>(null)
  const opener = useRef<Element | null>(null)
  useEffect(() => {
    opener.current = document.activeElement
    ref.current?.querySelector<HTMLElement>('[data-autofocus], button')?.focus()
    // capture phase: the analysis layer is on top, so Escape closes it and nothing underneath
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      if (opener.current instanceof HTMLElement && opener.current.isConnected) opener.current.focus()
    }
  }, [onClose])

  if (analysis.kind === 'tactic') {
    return (
      <div className="analysis analysis--tactic" data-theme="night" role="dialog" aria-modal="true" aria-label="Tactical analysis" ref={ref}>
        <TacticAnalysis key={analysis.id} momentId={analysis.id} matchId={matchId} world={world} role={role} onClose={onClose} withdrawnReason={withdrawnReason} />
      </div>
    )
  }
  return (
    <div className="analysis" data-theme="night" role="dialog" aria-modal="true" aria-label="Story evidence" ref={ref}>
      <div className="analysis__visual">{theatre}</div>
      <div className="analysis__panel">{evidencePanel}</div>
    </div>
  )
}
