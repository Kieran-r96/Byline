import type { CSSProperties, ReactNode } from 'react'
import { useDossier } from '../../services/dossier'
import type { ClubMatch, H2HDossier, MatchDossier, PlayerDossier, TeamDossier } from '../../services/dossier'
import type { WorldIndex } from '../../services/matchView'
import { STREAK, fmtDate } from './dossierFormat'
import type { ResearchFocus } from './research'

export interface DossierProps {
  kind: 'player' | 'club' | 'h2h' | 'match'
  id: string
  matchId: string
  seq: number
  world: WorldIndex
  onFocus: (f: ResearchFocus) => void
  /** Shown if the dossier service is unavailable. */
  fallback: ReactNode
}


export function Scope({ children }: { children: ReactNode }) {
  return <p className="dz__scope">{children}</p>
}

export function Figures({ items }: { items: Array<[string, ReactNode]> }) {
  return (
    <dl className="dz__figs">
      {items.map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd className="numeric">{v}</dd>
        </div>
      ))}
    </dl>
  )
}

export function Section({ title, scope, children }: { title: string; scope?: string; children: ReactNode }) {
  return (
    <section className="dz__sec">
      <h3 className="dz__h">{title}</h3>
      {children}
      {scope && <Scope>{scope}</Scope>}
    </section>
  )
}

export function FormRow({ m }: { m: ClubMatch }) {
  return (
    <li className="dz__match">
      <span className="dz__res" data-r={m.result}>
        {m.result}
      </span>
      <span className="dz__opp">
        {m.opponent} <span className="dz__muted">({m.venue === 'home' ? 'H' : 'A'})</span>
      </span>
      <span className="numeric">{m.score}</span>
      <span className="dz__muted dz__date">{fmtDate(m.date)}</span>
    </li>
  )
}

function PlayerView({ d, world }: { d: PlayerDossier; world: WorldIndex }) {
  const p = d.player
  const kit = world.teams.get(p.club.team_id)?.kit.primary ?? '#888'
  const t = d.this_match
  const gk = p.position === 'GK'
  return (
    <article className="dz" style={{ '--kit': kit } as CSSProperties}>
      <header className="dz__head">
        <span className="dz__num numeric">{p.shirt_number}</span>
        <div>
          <h2 className="dz__name">{p.name}</h2>
          <p className="dz__sub">
            {p.position_word} · {p.age} · {p.hometown} · {p.preferred_foot} foot
          </p>
        </div>
      </header>
      <p className="dz__lead">{d.profile_line}</p>
      {d.milestones.length > 0 && (
        <ul className="dz__flags">
          {d.milestones.map((m) => (
            <li key={m.text} data-today={m.status === 'reached_today'}>
              {m.text}
            </li>
          ))}
          {d.season.one_booking_from_ban && <li data-warn>One booking from a ban</li>}
        </ul>
      )}
      <Section title={`Today · ${d.as_of.minute}`} scope={t.scope}>
        <Figures
          items={[
            ['Minutes', t.minutes_on_pitch],
            ...(gk ? ([['Saves', t.saves]] as Array<[string, ReactNode]>) : []),
            ['Passes', `${t.passes.completed}/${t.passes.attempted}`],
            ['Shots', `${t.shots.total} (${t.shots.on_target} on)`],
            ['Goals', t.goals ? `${t.goals} · ${t.goal_minutes.join(', ')}` : 0],
            ['Tackles', t.tackles],
            ['Interceptions', t.interceptions],
            ['Fouls', `${t.fouls_committed} / won ${t.fouls_won}`],
          ]}
        />
        {(t.substitution.on || t.substitution.off || t.cards.length > 0) && (
          <p className="dz__note">
            {t.substitution.on ? `Came on ${t.substitution.on}. ` : ''}
            {t.substitution.off ? `Went off ${t.substitution.off}. ` : ''}
            {t.cards.map((c) => `${c.type ?? 'Card'} ${c.minute ?? ''}`).join(', ')}
          </p>
        )}
      </Section>
      <Section title={`${d.season.season} season`} scope={d.season.scope}>
        <Figures
          items={[
            ['Apps', d.season.including_today ? `${d.season.apps} → ${d.season.including_today.apps}` : d.season.apps],
            ['Goals', d.season.including_today ? `${d.season.goals} → ${d.season.including_today.goals}` : d.season.goals],
            ['Assists', d.season.assists],
            [gk ? 'Clean sheets' : 'Cards', gk ? (d.season.clean_sheets ?? 0) : `${d.season.yellows}Y ${d.season.reds}R`],
          ]}
        />
      </Section>
      <Section title="Career" scope={d.totals.scope}>
        <Figures
          items={[
            [`For ${p.club.short_name}`, `${d.totals.club.apps} apps · ${d.totals.club.goals} goals`],
            ['Overall', `${d.totals.overall.apps} apps · ${d.totals.overall.goals} goals`],
            ['Derby goals', `${d.derby.goals_before_today}${d.derby.goals_today ? ` + ${d.derby.goals_today} today` : ''}`],
          ]}
        />
        <div className="dz__table-wrap">
          <table className="dz__table">
            <thead>
              <tr>
                <th scope="col">Season</th>
                <th scope="col">Club</th>
                <th scope="col">Apps</th>
                <th scope="col">{gk ? 'CS' : 'Gls'}</th>
              </tr>
            </thead>
            <tbody>
              {[...d.career.seasons].reverse().map((s) => (
                <tr key={`${s.season}-${s.club}`}>
                  <td className="numeric">{s.season}</td>
                  <td>{s.club}</td>
                  <td className="numeric">{s.apps}</td>
                  <td className="numeric">{gk ? (s.clean_sheets ?? 0) : s.goals}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
      {(d.injuries.length > 0 || d.connections.length > 0) && (
        <Section title="Background">
          <ul className="dz__list">
            {d.connections.map((c) => (
              <li key={c.text}>{c.text}</li>
            ))}
            {d.injuries.map((i) => (
              <li key={i}>{i}</li>
            ))}
            <li className="dz__muted">
              Joined {d.player.joined_season} · {d.player.fee_note}
              {d.player.academy_graduate ? ' · academy graduate' : ''}
            </li>
          </ul>
        </Section>
      )}
      <p className="fine">{d.notice}</p>
    </article>
  )
}

function TeamView({ d, world, onFocus }: { d: TeamDossier; world: WorldIndex; onFocus: (f: ResearchFocus) => void }) {
  const kit = world.teams.get(d.club.team_id)?.kit.primary ?? '#888'
  const m = d.manager
  return (
    <article className="dz" style={{ '--kit': kit } as CSSProperties}>
      <header className="dz__head dz__head--club">
        <div>
          <h2 className="dz__name">{d.club.name}</h2>
          <p className="dz__sub">
            Founded {d.club.founded} · {d.club.stadium} · {d.club.formation}
          </p>
        </div>
      </header>
      <Section title={`Manager · ${m.name}`} scope={m.record.scope}>
        <p className="dz__lead">
          In charge since {m.appointed_season}, previously {m.previous}.
        </p>
        <Figures
          items={[
            ['All games', `${m.record.line} · ${m.record.win_pct}%`],
            ['League', m.league_record.line],
            ['Derbies', m.derby_record.line],
          ]}
        />
      </Section>
      <Section title={`Form · ${d.form.line}`} scope={d.form.scope}>
        <ol className="dz__matches">
          {[...d.form.matches].reverse().map((x) => (
            <FormRow key={`${x.date}-${x.opponent}`} m={x} />
          ))}
        </ol>
      </Section>
      {d.streaks.current.length > 0 && (
        <Section title="Running now" scope={d.streaks.scope}>
          <ul className="dz__list">
            {d.streaks.current.map((s) => (
              <li key={`${s.kind}-${s.scope}-${s.where}`}>
                <strong className="numeric">{s.length}</strong> {STREAK[s.kind] ?? s.kind}
                <span className="dz__muted">
                  {' '}
                  · {s.rule}
                  {s.is_longest_in_record ? ' · the longest in the record' : ` · record ${s.longest_in_record}`}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      )}
      <Section title="This season" scope={d.current_season.scope}>
        <Figures
          items={[
            ['Played', d.current_season.played],
            ['W-D-L', `${d.current_season.won}-${d.current_season.drawn}-${d.current_season.lost}`],
            ['Goals', `${d.current_season.goals_for}:${d.current_season.goals_against}`],
            ['Points', d.current_season.points],
          ]}
        />
      </Section>
      <Section title="Records" scope={d.biggest.scope}>
        <ul className="dz__list">
          {d.biggest.win_all_competitions && (
            <li>
              Biggest win {d.biggest.win_all_competitions.score} v {d.biggest.win_all_competitions.opponent}, {fmtDate(d.biggest.win_all_competitions.date)}
            </li>
          )}
          {d.biggest.defeat_all_competitions && (
            <li>
              Heaviest defeat {d.biggest.defeat_all_competitions.score} v {d.biggest.defeat_all_competitions.opponent}, {fmtDate(d.biggest.defeat_all_competitions.date)}
            </li>
          )}
          <li>
            Honours in the record: {d.honours.cups.length ? `cup ${d.honours.cups.join(', ')}` : 'no cups'}
            {d.honours.league_titles.length ? `, league ${d.honours.league_titles.join(', ')}` : `, best league finish ${d.honours.best_league_finish}`}
          </li>
        </ul>
      </Section>
      <Section title="Next up" scope={d.upcoming.scope}>
        <ul className="dz__list">
          {d.upcoming.fixtures.map((f) => (
            <li key={f.date}>
              {fmtDate(f.date)} · {f.opponent} ({f.venue === 'home' ? 'H' : 'A'})
            </li>
          ))}
        </ul>
      </Section>
      <button type="button" className="link-btn" onClick={() => onFocus({ kind: 'h2h' })}>
        Head to head with {world.teams.get(d.club.team_id === world.homeId ? world.awayId : world.homeId)?.short_name}
      </button>
      <p className="fine">{d.notice}</p>
    </article>
  )
}

function H2HView({ d, world, onFocus }: { d: H2HDossier; world: WorldIndex; onFocus: (f: ResearchFocus) => void }) {
  const h = world.teams.get(world.homeId)
  const a = world.teams.get(world.awayId)
  return (
    <article className="dz">
      <header className="dz__head dz__head--club">
        <div>
          <h2 className="dz__name">{d.rivalry}</h2>
          <p className="dz__sub">
            {d.all_time.meetings} meetings all time: {h?.short_name} {d.all_time.wins[world.homeId]}, {a?.short_name} {d.all_time.wins[world.awayId]}, {d.all_time.draws} draws
          </p>
        </div>
      </header>
      <Section title={`Since 2016/17 · ${h?.short_name} ${d.record_window.line}`} scope={d.record_window.scope}>
        <Figures
          items={[
            [`${h?.short_name} at home`, d.teams[world.homeId]?.at_home.line ?? '–'],
            [`${h?.short_name} away`, d.teams[world.homeId]?.away_from_home.line ?? '–'],
          ]}
        />
      </Section>
      <Section title="Last meetings" scope={d.last_meetings.scope}>
        <ol className="dz__list dz__meetings">
          {d.last_meetings.meetings.slice(0, 6).map((m) => (
            <li key={m.date}>
              <span className="dz__muted">{m.date}</span>{' '}
              <strong>
                {m.home} {m.score} {m.away}
              </strong>
              <span className="dz__muted"> · {m.venue}</span>
              {m.scorers.length > 0 && <span className="dz__scorers">{m.scorers.map((s) => `${s.name.split(' ').slice(-1)[0]} ${s.minute}'`).join(', ')}</span>}
            </li>
          ))}
        </ol>
      </Section>
      <Section title="Derby scorers in today's squads" scope={d.leading_scorers.scope}>
        <ol className="dz__list">
          {d.leading_scorers.players.slice(0, 6).map((p) => (
            <li key={p.player_id}>
              <button type="button" className="link-btn" onClick={() => onFocus({ kind: 'player', id: p.player_id })}>
                {p.name}
              </button>{' '}
              <strong className="numeric">{p.derby_goals_before_today}</strong>
              {p.goals_today ? <span className="dz__muted"> + {p.goals_today} today</span> : null}
            </li>
          ))}
        </ol>
      </Section>
      <p className="fine">{d.notice}</p>
    </article>
  )
}

function MatchView({ d }: { d: MatchDossier }) {
  const ref = d.officials.find((o) => o.role === 'referee')
  return (
    <article className="dz">
      <header className="dz__head dz__head--club">
        <div>
          <h2 className="dz__name">{d.stadium.name}</h2>
          <p className="dz__sub">
            {d.competition} · {d.season} · matchday {d.matchday}
          </p>
        </div>
      </header>
      <Section title="The ground" scope={d.stadium.home_league_record.scope}>
        <Figures
          items={[
            ['Capacity', d.stadium.capacity.toLocaleString('en-GB')],
            ['Record crowd', d.stadium.record_attendance.toLocaleString('en-GB')],
            ['Home record', d.stadium.home_league_record.line],
          ]}
        />
        <p className="dz__note">{d.stadium.record_match}</p>
      </Section>
      {ref?.record && (
        <Section title={`Referee · ${ref.name}`} scope={ref.record.scope}>
          <Figures
            items={[
              ['Games', ref.record.games_this_season],
              ['Cautions/game', ref.record.cautions_per_game],
              ['Reds', ref.record.reds_this_season],
              ['Penalties', ref.record.penalties_this_season],
            ]}
          />
        </Section>
      )}
      <Section title="Pre-match context">
        <ul className="dz__list">
          {d.context.slice(0, 10).map((c) => (
            <li key={c.fact_id}>
              {c.short_text} <span className="dz__muted">· {c.rule}</span>
            </li>
          ))}
        </ul>
      </Section>
      <p className="fine">{d.notice}</p>
    </article>
  )
}

/** Research dossier: player, club, head to head, venue. Everything computed from the fictional records. */
export function Dossier({ kind, id, matchId, seq, world, onFocus, fallback }: DossierProps) {
  const path =
    kind === 'player'
      ? `/api/matches/${matchId}/dossier/players/${encodeURIComponent(id)}`
      : kind === 'club'
        ? `/api/matches/${matchId}/dossier/teams/${encodeURIComponent(id)}`
        : kind === 'h2h'
          ? `/api/matches/${matchId}/dossier/h2h`
          : `/api/matches/${matchId}/dossier/match`
  const load = useDossier<PlayerDossier & TeamDossier & H2HDossier & MatchDossier>(path, seq)
  if (load.status === 'loading') return <p className="empty-block" aria-busy="true">Opening the file…</p>
  if (load.status === 'error') return fallback ? <>{fallback}</> : <p className="empty-block">The research service is not answering. Try again in a moment.</p>
  const d = load.data
  return (
    <div className="dossier">
      {kind === 'player' && <PlayerView d={d} world={world} />}
      {kind === 'club' && <TeamView d={d} world={world} onFocus={onFocus} />}
      {kind === 'h2h' && <H2HView d={d} world={world} onFocus={onFocus} />}
      {kind === 'match' && <MatchView d={d} />}
      {kind === 'h2h' && (
        <button type="button" className="link-btn" onClick={() => onFocus({ kind: 'match' })}>
          Venue and officials
        </button>
      )}
    </div>
  )
}
