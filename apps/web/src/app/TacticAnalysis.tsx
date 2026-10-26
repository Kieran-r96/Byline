import { useState } from 'react'
import { TacticalStage } from '../components/Stage/TacticalStage'
import { VerifiedRead } from '../components/Tactics/VerifiedRead'
import type { WorldIndex } from '../services/matchView'
import { usePrefs } from '../services/prefs'
import type { StageStep } from '../services/stageScript'
import { useTacticalInsight } from '../services/tacticalInsight'
import type { TacticalInsight } from '../services/tacticalInsight'
import { useMomentView } from '../services/useMomentView'
import type { Role } from '../types/shell'

/**
 * The guided tactical explanation: the 3D stage on the left (frozen real frame, one layer per step), the
 * measurements, what the data cannot show, and the verified Foundry read on the right. It never moves the
 * live match: the stage renders the frozen frame and replays tracking on its own.
 */
/** The verified line for the stage's takeaway, in Spanish when the agents' recorded translation exists. */
function verifiedLine(ins: NonNullable<TacticalInsight['insight']>, audience: 'fan' | 'commentator', lang: 'en' | 'es'): { text: string; label: string } {
  const es = lang === 'es' ? ins.audience.translations?.[audience === 'fan' ? 'es.fan_plain' : 'es.commentator'] : undefined
  return { text: es ?? (audience === 'fan' ? ins.audience.fan_plain : ins.audience.commentator), label: es ? 'Verified by Foundry agents · Spanish translation' : 'Verified by Foundry agents' }
}

export function TacticAnalysis({ momentId, matchId, world, role, onClose, withdrawnReason }: { momentId: string; matchId: string; world: WorldIndex; role: Role; onClose: () => void; withdrawnReason?: string | null }) {
  const { view, failed } = useMomentView(matchId, momentId)
  const verified = useTacticalInsight(matchId, momentId)
  const { lang } = usePrefs()
  const [step, setStep] = useState<StageStep | null>(null)
  const audience = role === 'fan' ? 'fan' : 'pro'
  return (
    <div className="ta">
      <div className="ta__stage">
        {view ? (
          <TacticalStage
            matchId={matchId}
            view={view}
            world={world}
            audience={audience}
            onStepChange={(s) => setStep(s)}
            verified={verified?.insight ? verifiedLine(verified.insight, role === 'fan' ? 'fan' : 'commentator', lang) : undefined}
            withdrawn={withdrawnReason ? { reason: withdrawnReason } : undefined}
          />
        ) : (
          <p className="empty-block">{failed ? 'This moment could not be loaded. Close and try again.' : 'Freezing the frame…'}</p>
        )}
      </div>
      <aside className="ta__panel" aria-label="What we measured">
        <div className="ta__head">
          <p className="ta__kind">
            {view?.label ?? 'Tactics'} · <span className="numeric">{view?.display_clock ?? ''}</span>
          </p>
          <button type="button" className="btn btn--back" onClick={onClose} data-autofocus>
            <span aria-hidden="true">←</span> Back to match
          </button>
        </div>
        <h2 className="ta__title">{view?.title ?? ''}</h2>
        {step && <p className="ta__step">Now showing: {step.title}</p>}
        {view && (
          <>
            <section className="ta__sec">
              <h3 className="ta__h">Measured from tracking and events</h3>
              <dl className="ta__facts">
                {view.observed.map((o, i) => {
                  const rec = o as Record<string, unknown>
                  const v = rec.value
                  return (
                    <div key={i}>
                      <dt>{String(rec.label ?? '')}</dt>
                      <dd className="numeric">
                        {typeof v === 'number' ? (Number.isInteger(v) ? v : v.toFixed(1)) : String(v)} {String(rec.unit ?? '')}
                      </dd>
                    </div>
                  )
                })}
              </dl>
              <p className="ta__interp">{view.interpretation}</p>
            </section>
            {view.unknowns.length > 0 && (
              <section className="ta__sec">
                <h3 className="ta__h">What the data cannot show</h3>
                <ul className="ta__unknowns">
                  {view.unknowns.map((u) => (
                    <li key={u}>{u}</li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
        {verified && (
          <section className="ta__sec">
            <VerifiedRead data={verified} audience={role === 'fan' ? 'fan' : role === 'studio' ? 'studio' : 'commentator'} lang={lang} />
          </section>
        )}
      </aside>
    </div>
  )
}
