import { useMemo } from 'react'
import { MiniPitch } from '../../components/Fan/MiniPitch'
import { Shirt } from '../../components/Formation/Shirt'
import { VerifiedRead } from '../../components/Tactics/VerifiedRead'
import type { WorldIndex } from '../../services/matchView'
import { usePrefs } from '../../services/prefs'
import type { MomentView } from '../../services/schemas'
import { useTacticalInsight } from '../../services/tacticalInsight'
import { choicesFor, openness } from './choices'
import { fanPrefs, useFanPrefs } from './fanPrefs'

/**
 * "What would you do?": the fan sees the frozen moment, picks a pass, then sees what really happened and how
 * open each option measured. No option is called right or wrong, and nothing claims what would have followed.
 */
export function WouldYouDo({ view, world, matchId, onShowWhy }: { view: MomentView; world: WorldIndex; matchId: string; onShowWhy: () => void }) {
  const prefs = useFanPrefs()
  const { lang } = usePrefs()
  const verified = useTacticalInsight(matchId, view.moment_id)
  const choices = useMemo(() => choicesFor(view, world), [view, world])
  const picked = prefs.answers[view.moment_id] ?? null
  const carrier = view.whatif ? world.players.get(view.whatif.carrier_id) : undefined
  const played = choices.find((c) => c.played)
  const outcome = view.whatif?.actual.outcome
  const interceptor = view.whatif?.actual.interceptor_id ? world.players.get(view.whatif.actual.interceptor_id) : undefined
  if (choices.length < 2 || !carrier) return null
  const kit = world.teams.get(carrier.team_id)?.kit
  return (
    <div className="wyd" data-picked={!!picked}>
      <p className="wyd__q">
        You&apos;re <strong>{carrier.family_name}</strong>. Where does the pass go?
      </p>
      <div className="wyd__pitch" data-theme="night">
        <MiniPitch view={view} world={world} showWhatIf={!!picked} hideActual={!picked} />
      </div>
      <div className="wyd__choices" role="group" aria-label={`Pick a pass for ${carrier.family_name}`}>
        {choices.map((c) => {
          const p = world.players.get(c.id)
          return (
            <button key={c.id} type="button" className="wyd__choice" aria-pressed={picked === c.id} data-revealed={!!picked} data-played={c.played} onClick={() => fanPrefs.answer(view.moment_id, c.id)}>
              {p && <Shirt number={p.shirt_number} fill={kit?.primary ?? '#888'} trim={kit?.secondary ?? '#fff'} ink={kit?.number ?? '#fff'} size={44} />}
              <span className="wyd__name">{c.name}</span>
              {picked && <span className="wyd__tag">{c.played ? 'Played' : 'Open option'}</span>}
            </button>
          )
        })}
      </div>
      {picked && played && (
        <div className="wyd__reveal" aria-live="polite">
          <p className="wyd__answer">
            {picked === played.id ? `Same as ${carrier.family_name}.` : `${carrier.family_name} went another way.`} The pass went to {played.name}
            {outcome === 'intercepted' && interceptor ? ` and ${interceptor.family_name} cut it out.` : outcome ? ` (${outcome.replace(/_/g, ' ')}).` : '.'}
          </p>
          <ul className="wyd__measure">
            {choices.map((c) => (
              <li key={c.id} data-played={c.played}>
                <strong>{c.name}:</strong> {openness(c.option)}
              </li>
            ))}
          </ul>
          {verified && <VerifiedRead data={verified} audience="fan" lang={lang} />}
          <p className="wyd__honest">Measured from where everyone stood at that instant. Nobody can know what would have happened next.</p>
          <button type="button" className="btn btn--primary wyd__why" onClick={onShowWhy}>
            Show me why
          </button>
        </div>
      )}
    </div>
  )
}
