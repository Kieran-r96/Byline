import type { CSSProperties } from 'react'
import { Crest } from '../../components/brand/Crest'
import type { SessionSnapshot } from '../../services/matchSession'
import type { WorldIndex } from '../../services/matchView'
import { gatesLine, measuredLine, STATE_LABEL, storylineCategory, visibleStorylines } from '../../services/storylines'
import { asTeam } from '../liveData'
import { compareRows } from './fanData'
import type { Stats } from './fanData'

/**
 * Side by side: your side first. The measured numbers, then the patterns the detectors have spotted for either
 * side, in plain words (Analyst adds the detector gates and the evidence).
 */
export function Compare({ snap, world, side, analyst, onOpenEvidence }: { snap: SessionSnapshot; world: WorldIndex; side: string | null; analyst: boolean; onOpenEvidence: (candidateId: string) => void }) {
  const left = side && side !== 'neutral' ? side : world.homeId
  const right = left === world.homeId ? world.awayId : world.homeId
  const lt = world.teams.get(left)
  const rt = world.teams.get(right)
  const rows = compareRows(snap.state?.stats as Record<string, Stats> | undefined, left, right, analyst)
  const all = Object.values(snap.storylines)
  const patterns = (analyst ? [...all].sort((a, b) => b.updated_at_ms - a.updated_at_ms) : visibleStorylines(all, 'discover')).slice(0, analyst ? 6 : 3)
  const mine = !!side && side !== 'neutral'
  return (
    <div className="tcmp" style={{ '--l': lt?.kit.primary ?? '#888', '--r': rt?.kit.primary ?? '#888' } as CSSProperties}>
      <div className="tcmp__head">
        <span className="tcmp__team">
          <Crest teamId={asTeam(left)} size={28} label="" />
          <span>
            {lt?.short_name}
            {mine && <span className="tcmp__you"> (your side)</span>}
          </span>
        </span>
        <span className="tcmp__team tcmp__team--r">
          <span>{rt?.short_name}</span>
          <Crest teamId={asTeam(right)} size={28} label="" />
        </span>
      </div>
      <dl className="tcmp__rows">
        {rows.map((r) => {
          const share = r.pct ? r.l / Math.max(1, r.l + r.r) : r.l + r.r ? r.l / (r.l + r.r) : 0.5
          return (
            <div key={r.key} className="tcmp__row" style={{ '--share': share } as CSSProperties}>
              <dt>{r.label}</dt>
              <dd className="tcmp__l">
                {r.l}
                {r.pct ? '%' : ''}
              </dd>
              <dd className="tcmp__bar" aria-hidden="true">
                <span />
              </dd>
              <dd className="tcmp__r">
                {r.r}
                {r.pct ? '%' : ''}
              </dd>
            </div>
          )
        })}
      </dl>
      <p className="fine">Counted from the official synthetic events up to now. Time on the ball is approximate: in-play time between events while a team had it.</p>
      {patterns.length > 0 && (
        <section className="tcmp__patterns" aria-label="Patterns spotted">
          <h3 className="tcmp__h">Patterns spotted</h3>
          <ul>
            {patterns.map((sl) => {
              const gates = analyst ? gatesLine(sl) : null
              const cid = sl.candidate_ids[sl.candidate_ids.length - 1]
              return (
                <li key={sl.storyline_id} className="tcmp__pattern" data-state={sl.state}>
                  <Crest teamId={asTeam(sl.team_id)} size={22} label={world.teams.get(sl.team_id)?.short_name ?? sl.team_id} />
                  <div>
                    <p className="tcmp__pattern-top">
                      <strong>{storylineCategory(sl)}</strong> <span className="tcmp__state">{STATE_LABEL[sl.state]} · {sl.display_clock}</span>
                    </p>
                    <p>{measuredLine(sl, analyst ? 'analyst' : 'discover')}</p>
                    {gates && <p className="tcmp__gates">{gates}</p>}
                    {analyst && cid && (
                      <button type="button" className="link-btn" onClick={() => onOpenEvidence(cid)}>
                        See the evidence
                      </button>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        </section>
      )}
    </div>
  )
}
