import { useEffect, useId, useRef, useState } from 'react'
import type { BackendPhase } from '../../services/useBackendStatus'
import type { SystemStatus } from '../../services/api'
import type { Lang } from '../../services/prefs'
import type { MatchSummary } from '../../services/schemas'
import { Icon } from '../icons/Icon'
import './SettingsPopover.css'

export interface SettingsPopoverProps {
  phase: BackendPhase
  system: SystemStatus | null
  aiText: string
  matches?: readonly MatchSummary[]
  matchId?: string
  onMatch?: (matchId: string) => void
  lang?: Lang
  onLang?: (lang: Lang) => void
}

const SCENARIO_LABEL: Record<string, string> = {
  golden_story: 'Golden story',
  discipline_var: 'Discipline & VAR',
  ordinary_match: 'Ordinary match',
}

const PHASE_TEXT: Record<BackendPhase, string> = {
  connecting: 'Connecting',
  online: 'Connected',
  unavailable: 'Unavailable, retrying',
}

/**
 * Settings / system disclosure. For now it reports the honest system state
 * (scenario, service, AI provider, budget); preferences land here later.
 */
export function SettingsPopover({ phase, system, aiText, matches = [], matchId, onMatch, lang = 'en', onLang }: SettingsPopoverProps) {
  const [open, setOpen] = useState(false)
  const panelId = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    const onPointer = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false)
        buttonRef.current?.focus()
      }
    }
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const ai = system?.ai
  const rows: Array<[string, string]> = [
    ['Data', 'Synthetic, seeded scenario'],
    ['Match service', PHASE_TEXT[phase]],
    ['AI provider', aiText.replace(/^AI: /, '')],
    ['Model deployment', ai?.deployment ?? 'None'],
    [
      'Real model calls',
      ai ? (ai.calls_used >= ai.calls_cap ? `${ai.calls_used} made · no more allowed` : `${ai.calls_used} of ${ai.calls_cap} allowed`) : 'Not reported',
    ],
    ['Build', system?.version ?? 'Not reported'],
  ]

  return (
    <div className="settings" ref={rootRef}>
      <button
        ref={buttonRef}
        type="button"
        className="icon-button"
        aria-label="Settings and system status"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
      >
        <Icon name="settings" size={20} />
      </button>
      <div id={panelId} className="settings__panel" hidden={!open} role="region" aria-label="Settings and system status">
        {onMatch && matches.length > 1 && (
          <fieldset className="settings__group">
            <legend className="settings__heading label">Synthetic match</legend>
            {[...matches]
              .sort((a, b) => a.match_id.localeCompare(b.match_id))
              .map((m) => (
                <label key={m.match_id} className="settings__choice">
                  <input
                    type="radio"
                    name={`${panelId}-match`}
                    checked={m.match_id === matchId}
                    onChange={() => onMatch(m.match_id)}
                  />
                  <strong>{SCENARIO_LABEL[m.scenario_id] ?? m.title}</strong>
                  <span>{m.match_id}</span>
                </label>
              ))}
          </fieldset>
        )}
        {onLang && (
          <fieldset className="settings__group">
            <legend className="settings__heading label">AI insight language</legend>
            {(['en', 'es'] as const).map((l) => (
              <label key={l} className="settings__choice">
                <input type="radio" name={`${panelId}-lang`} checked={lang === l} onChange={() => onLang(l)} />
                <strong lang={l}>{l === 'en' ? 'English' : 'Español'}</strong>
                <span>{l === 'en' ? 'Reference version' : 'Recorded Foundry translation of verified insights and stories; the rest of the interface stays in English'}</span>
              </label>
            ))}
          </fieldset>
        )}
        <p className="settings__heading label">System</p>
        <dl className="settings__list">
          {rows.map(([k, v]) => (
            <div key={k} className="settings__row">
              <dt>{k}</dt>
              <dd className="tabular">{v}</dd>
            </div>
          ))}
        </dl>
        <p className="settings__foot">
          All clubs, players and events are fictional. No real match data is used.
        </p>
      </div>
    </div>
  )
}
