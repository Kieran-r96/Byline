import { useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { ApiError, getJson } from '../../services/api'
import type { WorldIndex } from '../../services/matchView'
import { RecapSchema } from '../../services/schemas'
import type { Recap } from '../../services/schemas'
import type { TeamId } from '../../types/shell'
import { Crest } from '../brand/Crest'
import { Icon } from '../icons/Icon'
import './Recap.css'

// ---------------------------------------------------------------- stats comparison

const STAT_ROWS: Array<{ key: string; label: string }> = [
  { key: 'passes', label: 'Passes' },
  { key: 'passes_completed', label: 'Passes completed' },
  { key: 'shots', label: 'Shots' },
  { key: 'shots_on_target', label: 'On target' },
  { key: 'corners', label: 'Corners' },
  { key: 'fouls', label: 'Fouls' },
  { key: 'offsides', label: 'Offsides' },
]

export interface StatsComparisonProps {
  home: { name: string; code: string; colour: string; stats: Record<string, unknown> | undefined }
  away: { name: string; code: string; colour: string; stats: Record<string, unknown> | undefined }
}

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0
}

/** Head-to-head bars from match_state.stats; numbers are always printed. */
export function StatsComparison({ home, away }: StatsComparisonProps) {
  return (
    <table className="stats">
      <caption className="sr-only">
        Match statistics, {home.name} versus {away.name}
      </caption>
      <thead>
        <tr>
          <th scope="col" className="stats__team" style={{ '--kit': home.colour } as CSSProperties}>
            {home.code}
          </th>
          <th scope="col" className="sr-only">
            Statistic
          </th>
          <th scope="col" className="stats__team stats__team--away" style={{ '--kit': away.colour } as CSSProperties}>
            {away.code}
          </th>
        </tr>
      </thead>
      <tbody>
        {STAT_ROWS.map((r) => {
          const h = num(home.stats?.[r.key])
          const a = num(away.stats?.[r.key])
          const total = h + a || 1
          return (
            <tr key={r.key}>
              <td className="stats__v numeric">{h}</td>
              <th scope="row" className="stats__label">
                <span>{r.label}</span>
                <span className="stats__bar" aria-hidden="true">
                  <span style={{ width: `${(h / total) * 100}%`, background: home.colour }} />
                  <span style={{ width: `${(a / total) * 100}%`, background: away.colour }} />
                </span>
              </th>
              <td className="stats__v stats__v--away numeric">{a}</td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

// ---------------------------------------------------------------- recap

type Load = { status: 'loading' } | { status: 'not_ready' } | { status: 'error' } | { status: 'ready'; recap: Recap }

export interface RecapViewProps {
  sessionId: string | null
  /** A recap pushed over SSE (e.g. a later validated model recap) wins. */
  pushed: Recap | null
  world: WorldIndex
  finished: boolean
  onClose: () => void
  onSeekEvent?: (eventId: string) => void
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

export function RecapView({ sessionId, pushed, world, finished, onClose }: RecapViewProps) {
  const [load, setLoad] = useState<Load>({ status: 'loading' })
  const [nonce, setNonce] = useState(0)
  const [sources, setSources] = useState(false)
  const closeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    closeRef.current?.focus()
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    if (!sessionId) return undefined
    const ctrl = new AbortController()
    getJson(`/api/sessions/${sessionId}/recap`, RecapSchema, { signal: ctrl.signal, timeoutMs: 10_000 })
      .then((recap) => !ctrl.signal.aborted && setLoad({ status: 'ready', recap }))
      .catch((err: unknown) => {
        if (ctrl.signal.aborted) return
        setLoad(err instanceof ApiError && err.status === 409 ? { status: 'not_ready' } : { status: 'error' })
      })
    return () => ctrl.abort()
  }, [sessionId, nonce, finished])

  const recap = pushed ?? (load.status === 'ready' ? load.recap : null)
  const home = world.teams.get(world.homeId)
  const away = world.teams.get(world.awayId)
  const scoreOf = (t: typeof home) => (t ? (recap?.final_score[t.short_name] ?? recap?.final_score[t.team_id]) : undefined)
  const statsOf = (t: typeof home) => (t ? (recap?.stats[t.short_name] ?? recap?.stats[t.team_id]) : undefined)

  return (
    <div className="recap" role="dialog" aria-modal="true" aria-labelledby="recap-title">
      <div className="recap__bar">
        <p className="label">Match recap · synthetic match</p>
        <button ref={closeRef} type="button" className="icon-button" onClick={onClose} aria-label="Close recap">
          <Icon name="close" size={20} />
        </button>
      </div>
      <div className="recap__scroll">
        {!recap && (
          <div className="recap__state">
            <h2 id="recap-title" className="recap__state-title">
              {load.status === 'not_ready' ? 'Recap available at full time' : load.status === 'error' ? 'Recap temporarily unavailable' : 'Preparing recap…'}
            </h2>
            <p>
              {load.status === 'not_ready'
                ? 'The editorial recap is built from the official events once the match has finished.'
                : load.status === 'error'
                  ? 'Match events remain available. Please try again in a moment.'
                  : ''}
            </p>
            {load.status === 'error' && (
              <button type="button" className="recap__retry" onClick={() => setNonce((n) => n + 1)}>
                Try again
              </button>
            )}
          </div>
        )}
        {recap && home && away && (
          <article className="recap__article">
            <header className="recap__cover">
              <p className="recap__kicker">Full time</p>
              <div className="recap__score">
                <span className="recap__side">
                  <Crest teamId={home.team_id as TeamId} size={72} label="" />
                  <span>{home.name}</span>
                </span>
                <span className="recap__digits numeric">
                  {scoreOf(home)}
                  <span className="recap__dash" aria-hidden="true" />
                  {scoreOf(away)}
                </span>
                <span className="recap__side">
                  <Crest teamId={away.team_id as TeamId} size={72} label="" />
                  <span>{away.name}</span>
                </span>
              </div>
              <h2 id="recap-title" className="recap__headline">
                {recap.headline}
              </h2>
              <p className="recap__summary">{recap.summary}</p>
              <p className="recap__by">
                {recap.generated_by === 'foundry_recap_writer'
                  ? 'Written by the Foundry recap-writer agent and checked against the official events'
                  : 'Deterministic recap generated from the official synthetic events (no AI)'}
                {recap.synthetic_notice ? ` · ${recap.synthetic_notice}` : ''}
              </p>
            </header>

            <section className="recap__section" aria-labelledby="recap-tp">
              <h3 id="recap-tp" className="recap__h">
                Turning points
              </h3>
              <ol className="recap__points">
                {recap.turning_points.map((t) => (
                  <li key={`${t.minute}-${t.text}`}>
                    <span className="recap__minute numeric">{t.minute}</span>
                    <span className="recap__point">{t.text}</span>
                  </li>
                ))}
              </ol>
            </section>

            {recap.disallowed.length > 0 && (
              <section className="recap__section recap__section--note" aria-labelledby="recap-dis">
                <h3 id="recap-dis" className="recap__h">
                  Disallowed
                </h3>
                {recap.disallowed.map((d) => (
                  <p key={str(d.event_id)}>
                    <span className="numeric recap__minute">{str(d.minute)}</span> {str(d.scorer)}: goal{' '}
                    {d.why ? str(d.why) : 'ruled out'} (official event {str(d.decided_by)}).
                  </p>
                ))}
              </section>
            )}

            <div className="recap__grid">
              <section className="recap__section" aria-labelledby="recap-disc">
                <h3 id="recap-disc" className="recap__h">
                  Discipline
                </h3>
                {recap.discipline.length === 0 ? (
                  <p className="recap__muted">No cards shown.</p>
                ) : (
                  <ol className="recap__cards">
                    {recap.discipline.map((c) => (
                      <li key={str(c.event_id)} data-card={str(c.card)}>
                        <span className="recap__card" aria-hidden="true" />
                        <span className="numeric recap__minute">{str(c.minute)}</span>
                        <span>
                          {str(c.player)}
                          <span className="recap__card-kind">
                            {' '}
                            · {str(c.card) === 'second_yellow' ? 'second yellow, sent off' : str(c.card) === 'red' ? 'red card' : 'yellow card'}
                          </span>
                        </span>
                      </li>
                    ))}
                  </ol>
                )}
              </section>
              <section className="recap__section" aria-labelledby="recap-stats">
                <h3 id="recap-stats" className="recap__h">
                  Match stats
                </h3>
                <StatsComparison
                  home={{ name: home.name, code: home.code, colour: home.kit.primary, stats: statsOf(home) }}
                  away={{ name: away.name, code: away.code, colour: away.kit.primary, stats: statsOf(away) }}
                />
              </section>
            </div>

            {recap.stories.length > 0 && (
              <section className="recap__section" aria-labelledby="recap-stories">
                <h3 id="recap-stories" className="recap__h">
                  Verified stories
                </h3>
                <ul className="recap__stories">
                  {recap.stories.map((s) => (
                    <li key={str(s.insight_id)}>
                      <strong>{str(s.title)}</strong>
                      <span>{str(s.claim)}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <section className="recap__section">
              <button type="button" className="recap__sources" aria-expanded={sources} onClick={() => setSources((v) => !v)}>
                Sources <span className="numeric">{recap.source_event_ids.length}</span>
              </button>
              {sources && (
                <p className="recap__eids">
                  {recap.source_event_ids.map((e) => (
                    <span key={e}>{e}</span>
                  ))}
                </p>
              )}
              {recap.validation_issues.length > 0 && (
                <p className="recap__muted">Validation notes: {recap.validation_issues.join('; ')}</p>
              )}
            </section>
          </article>
        )}
      </div>
    </div>
  )
}
