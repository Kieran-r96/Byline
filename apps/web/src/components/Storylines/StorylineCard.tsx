import { useState } from 'react'
import type { ReactNode } from 'react'

import type { Storyline } from '../../services/schemas'
import { gatesLine, measuredLine, RAIL, railClocks, STATE_LABEL, storylineCategory } from '../../services/storylines'
import type { TeamId } from '../../types/shell'
import { Crest } from '../brand/Crest'
import type { StoryVariant } from '../StoryRadar/StoryRadar'
import './StorylineCard.css'

export interface StorylineCardProps {
  storyline: Storyline
  variant: StoryVariant
  /** The published story for this storyline (rendered by the radar), if one exists. */
  story?: ReactNode
  priority?: boolean
}

function asTeam(id: string): TeamId | null {
  return id === 'NBA' || id === 'RVC' ? id : null
}

/**
 * One evolving storyline: where it is on the rail, what was measured (deterministic), what the AI read
 * says (Foundry, rule-checked) and, once published, the verified story itself. Each layer is labelled.
 */
export function StorylineCard({ storyline: sl, variant, story, priority = false }: StorylineCardProps) {
  const [historyOpen, setHistoryOpen] = useState(false)
  const team = asTeam(sl.team_id)
  const clocks = railClocks(sl)
  const reachedIdx = Math.max(...RAIL.map((s, i) => (clocks[s] ? i : -1)))
  // after a correction a storyline can step back (e.g. Confirmed -> Strong): later steps show as reverted
  const currentIdx = RAIL.includes(sl.state) ? RAIL.indexOf(sl.state) : reachedIdx
  const pro = variant !== 'discover'
  const gates = variant === 'analyst' ? gatesLine(sl) : null
  // A verified story is the interpretation; the tier-1 read only fills the gap before one exists.
  const read = !story && sl.ai_read ? sl.ai_read : null
  const corrected = sl.withdrawn_candidate_ids.length > 0
  return (
    <li className="storyline" data-state={sl.state} data-priority={priority} aria-label={`${storylineCategory(sl)}, ${STATE_LABEL[sl.state]}`}>
      <header className="storyline__top">
        {team && <Crest teamId={team} size={18} label="" />}
        <span className="storyline__cat">{storylineCategory(sl)}</span>
        <span className="storyline__clock numeric">{sl.display_clock}</span>
      </header>

      <ol className="storyline__rail" aria-label="Storyline progress">
        {RAIL.map((st, i) => {
          const at = clocks[st]
          return (
            <li
              key={st}
              data-reached={!!at && i <= currentIdx}
              data-reverted={!!at && i > currentIdx}
              data-current={i === currentIdx && sl.state !== 'WEAKENING'}
            >
              <span className="storyline__rail-label">{STATE_LABEL[st]}</span>
              <span className="storyline__rail-clock numeric">{at ?? '–'}</span>
            </li>
          )
        })}
      </ol>
      {sl.state === 'WEAKENING' && <p className="storyline__fading">Fading: the pattern has dropped below the bar</p>}

      {!story && <h3 className="storyline__headline">{sl.headline}</h3>}
      {story}

      <div className="storyline__layer storyline__layer--measured">
        <span className="storyline__kicker">Measured</span>
        <p>{measuredLine(sl, variant)}</p>
        {gates && <p className="storyline__gates">{gates}</p>}
      </div>

      {read && (
        <div className="storyline__layer storyline__layer--read">
          <span className="storyline__kicker">
            AI read <span className="storyline__by">Foundry · rule-checked</span>
          </span>
          <p>{read.line}</p>
          {pro && read.caveat && <p className="storyline__caveat">{read.caveat}</p>}
        </div>
      )}
      {!story && <p className="storyline__note">Not a story yet: measurements only, nothing has been published.</p>}

      {(pro || corrected || sl.linked_storyline_ids.length > 0) && (
        <footer className="storyline__foot">
          {pro && sl.history.length > 1 && (
            <button type="button" className="storyline__btn" aria-expanded={historyOpen} onClick={() => setHistoryOpen((v) => !v)}>
              {historyOpen ? 'Hide history' : `History (${sl.history.length})`}
            </button>
          )}
          {sl.linked_storyline_ids.length > 0 && <span className="storyline__tag">Linked</span>}
          {corrected && <span className="storyline__tag storyline__tag--var">Corrected by VAR</span>}
          <span className="storyline__ver numeric">v{sl.version}</span>
        </footer>
      )}
      {historyOpen && (
        <ol className="storyline__history">
          {sl.history.map((v) => (
            <li key={v.version}>
              <span className="numeric">
                v{v.version} · {v.display_clock}
              </span>{' '}
              <strong>{STATE_LABEL[v.state]}</strong> {v.reason}
            </li>
          ))}
        </ol>
      )}
    </li>
  )
}
