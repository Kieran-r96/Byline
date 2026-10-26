import { useEffect, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { Crest } from '../../components/brand/Crest'
import { Shirt } from '../../components/Formation/Shirt'
import { ResearchPanel } from '../../components/Research/ResearchPanel'
import '../../components/Research/Research.css'
import { getJson } from '../../services/api'
import { readable } from '../../services/commentary'
import { useDossier } from '../../services/dossier'
import type { H2HDossier, PlayerDossier, TeamDossier } from '../../services/dossier'
import type { SessionSnapshot } from '../../services/matchSession'
import type { WorldIndex } from '../../services/matchView'
import { prefs, usePrefs } from '../../services/prefs'
import { PlayerFactsSchema, TeamFactsSchema } from '../../services/schemas'
import type { Fact } from '../../services/schemas'
import type { TeamId } from '../../types/shell'
import { signalAction } from '../surfaceActions'
import type { SurfaceActions } from '../surfaceActions'
import { Figures, FormRow, Section } from './Dossier'
import { STREAK, fmtDate } from './dossierFormat'
import './SubjectFile.css'

type Toast = (message: string, undo: () => void) => void

/** Facts for a player or club as of the current seq (rounded down, never the future). */
function useFacts(kind: 'player' | 'team', id: string, matchId: string, seq: number): Fact[] | null {
  const bucket = Math.floor(Math.max(0, seq) / 10) * 10
  const url = `/api/matches/${matchId}/${kind === 'player' ? 'players' : 'teams'}/${encodeURIComponent(id)}/facts?upto_seq=${bucket}`
  const [state, setState] = useState<{ url: string; facts: Fact[] } | null>(null)
  useEffect(() => {
    const ctrl = new AbortController()
    getJson(url, kind === 'player' ? PlayerFactsSchema : TeamFactsSchema, { signal: ctrl.signal, timeoutMs: 8000 })
      .then((d) => setState({ url, facts: d.facts }))
      .catch(() => {})
    return () => ctrl.abort()
  }, [url, kind])
  return state?.facts ?? null
}

/** The one thing worth saying, large: pinned first, then the most relevant fact not yet used. */
function HeroFact({ facts, onToast, more }: { facts: Fact[] | null; onToast: Toast; more: number }) {
  const p = usePrefs()
  if (!facts) return <p className="hero-fact hero-fact--loading">Finding the best thing to say…</p>
  const open = facts.filter((f) => !p.used[f.fact_id])
  const top = [...open].sort((a, b) => Number(p.pinned.includes(b.fact_id)) - Number(p.pinned.includes(a.fact_id)) || (b.relevance ?? 0) - (a.relevance ?? 0))[0]
  if (!top) return <p className="hero-fact hero-fact--done">Every fact here is used. More arrive as the match develops.</p>
  const pinned = p.pinned.includes(top.fact_id)
  return (
    <section className="hero-fact" aria-label="Worth saying now" data-pinned={pinned}>
      <p className="hero-fact__text">{top.short_text}</p>
      <p className="hero-fact__why">
        {pinned ? 'Pinned · ' : ''}
        {top.provenance === 'match_event_derived' ? 'From this match' : 'Fictional history'}
        {top.relevance_reason ? ` · ${top.relevance_reason}` : ''}
      </p>
      <div className="hero-fact__actions">
        <button
          type="button"
          className="btn btn--primary"
          onClick={() => {
            prefs.markUsed(top.fact_id)
            onToast('Marked as used', () => prefs.unmarkUsed(top.fact_id))
          }}
        >
          Mark used
        </button>
        <button type="button" className="btn" aria-pressed={pinned} onClick={() => prefs.togglePin(top.fact_id)}>
          {pinned ? 'Pinned' : 'Pin'}
        </button>
        {more > 1 && <span className="hero-fact__more">{more - 1} more in All facts</span>}
      </div>
    </section>
  )
}

function Big({ value, label }: { value: ReactNode; label: string }) {
  return (
    <div className="big">
      <dd className="big__v numeric">{value}</dd>
      <dt className="big__l">{label}</dt>
    </div>
  )
}

/** Contextual actions: one section open at a time, so the file never becomes a long list. */
function Actions<T extends string>({ label, items, value, onChange }: { label: string; items: Array<[T, string]>; value: T; onChange: (t: T) => void }) {
  return (
    <div className="ctx" role="group" aria-label={label}>
      {items.map(([id, name]) => (
        <button key={id} type="button" className="ctx__btn" aria-pressed={value === id} onClick={() => onChange(id)}>
          {name}
        </button>
      ))}
    </div>
  )
}

interface Involvement {
  key: string
  atMs: number
  clock: string
  kind: string
  text: string
  status: string
  tactical: boolean
  action: { label: string; run: () => void } | null
}

/** What this player has been part of today: official events naming them and measured tactical moments featuring them. */
function involvement(playerId: string, snap: SessionSnapshot, actions: SurfaceActions): Involvement[] {
  const out: Involvement[] = []
  for (const s of Object.values(snap.signals)) {
    const refs = s.refs as Record<string, unknown>
    if (refs.player_id !== playerId || s.at_ms <= 0 || !['goal', 'card', 'substitution', 'penalty', 'var'].includes(s.kind)) continue
    const r = readable(s)
    out.push({ key: s.signal_id, atMs: s.at_ms, clock: s.display_clock, kind: r.kicker ?? s.kind, text: r.headline, status: s.status, tactical: false, action: signalAction(s, actions) })
  }
  for (const m of Object.values(snap.tactics)) {
    if (!m.focus_player_ids.includes(playerId)) continue
    const withdrawn = snap.signals[`sig-${m.moment_id}`]?.status === 'withdrawn'
    out.push({ key: m.moment_id, atMs: m.at_ms, clock: m.display_clock, kind: `${m.label} · measured`, text: m.title, status: withdrawn ? 'withdrawn' : 'live', tactical: true, action: { label: 'Show why', run: () => actions.onOpenTactic(m.moment_id) } })
  }
  return out.sort((a, b) => a.atMs - b.atMs)
}

function InvolvementList({ rows, empty }: { rows: Involvement[]; empty: string }) {
  if (rows.length === 0) return <p className="dz__muted">{empty}</p>
  return (
    <ol className="sf__inv">
      {rows.map((m) => (
        <li key={m.key} className="sf__inv-row" data-status={m.status}>
          <span className="numeric sf__inv-clock">{m.clock}</span>
          <span className="sf__inv-body">
            <span className="sf__inv-kind">{m.kind}</span>
            <span className="sf__inv-text">{m.text}</span>
          </span>
          {m.action && (
            <button type="button" className="link-btn" onClick={m.action.run}>
              {m.action.label}
            </button>
          )}
        </li>
      ))}
    </ol>
  )
}

export type PlayerSection = 'impact' | 'season' | 'career' | 'milestones' | 'opponent' | 'tactics' | 'facts'

/**
 * The player file: identity, the one thing worth saying now (Mark used, Pin), big numbers, then contextual
 * actions that open one section at a time. It opens beside the match, which keeps playing.
 */
export function PlayerFile({ playerId, matchId, seq, clock, world, snap, actions, onToast, initialSection = 'impact' }: { playerId: string; matchId: string; seq: number; clock: string; world: WorldIndex; snap: SessionSnapshot; actions: SurfaceActions; onToast: Toast; initialSection?: PlayerSection }) {
  const p = world.players.get(playerId)
  const team = p ? world.teams.get(p.team_id) : undefined
  const d = useDossier<PlayerDossier>(`/api/matches/${matchId}/dossier/players/${encodeURIComponent(playerId)}`, seq)
  const facts = useFacts('player', playerId, matchId, seq)
  const prefsNow = usePrefs()
  const [section, setSection] = useState<PlayerSection>(initialSection)
  if (!p) return null
  const gk = p.position === 'GK'
  const kit = team?.kit
  const dossier = d.status === 'ready' ? d.data : null
  const t = dossier?.this_match
  const rows = involvement(playerId, snap, actions)
  const opponentId = p.team_id === world.homeId ? world.awayId : world.homeId
  const opponent = world.teams.get(opponentId)?.short_name ?? 'this opponent'
  const rivalryFacts = (facts ?? []).filter((f) => (f.category === 'derby' || f.category === 'connection') && !prefsNow.used[f.fact_id])
  const openFacts = (facts ?? []).filter((f) => !prefsNow.used[f.fact_id])
  const status = t ? (t.on_pitch_now ? `On the pitch · ${t.minutes_on_pitch} min` : t.role === 'bench' ? 'On the bench' : `${t.minutes_on_pitch} min played`) : null
  const items: Array<[PlayerSection, string]> = [
    ['impact', 'Match impact'],
    ['season', 'This season'],
    ['career', 'Career'],
    ...(dossier && dossier.milestones.length + dossier.connections.length > 0 ? ([['milestones', 'Milestones']] as Array<[PlayerSection, string]>) : []),
    ...(dossier && (dossier.derby.goals_before_today > 0 || rivalryFacts.length > 0) ? ([['opponent', `Against ${opponent}`]] as Array<[PlayerSection, string]>) : []),
    ...(rows.some((r) => r.tactical) ? ([['tactics', 'Tactical involvement']] as Array<[PlayerSection, string]>) : []),
    ['facts', `All facts${facts ? ` (${openFacts.length})` : ''}`],
  ]
  return (
    <article className="sf" style={{ '--kit': kit?.primary ?? '#888' } as CSSProperties}>
      <header className="sf__head">
        <Shirt number={p.shirt_number} fill={(gk ? kit?.goalkeeper : kit?.primary) ?? '#55606a'} trim={kit?.secondary ?? '#fff'} ink={gk ? '#14171a' : (kit?.number ?? '#fff')} size={88} />
        <div className="sf__who">
          <p className="sf__given">{p.given_name}</p>
          <h3 className="sf__name">{p.family_name}</h3>
          <p className="sf__line">
            {dossier ? `${dossier.player.position_word[0]!.toUpperCase()}${dossier.player.position_word.slice(1)} · ${dossier.player.age} · ` : ''}
            {team?.short_name}
            {status ? ` · ${status}` : ''}
          </p>
        </div>
      </header>

      <HeroFact facts={facts} onToast={onToast} more={openFacts.length} />

      {dossier && t && (
        <dl className="bigs">
          {gk ? <Big value={t.saves} label="Saves today" /> : <Big value={t.goals} label={t.goals === 1 ? 'Goal today' : 'Goals today'} />}
          <Big value={t.passes.attempted ? `${t.passes.completed}/${t.passes.attempted}` : 0} label="Passes found" />
          <Big value={t.tackles + t.interceptions} label="Ball won back" />
          <Big value={dossier.season.including_today?.goals ?? dossier.season.goals} label="Goals this season" />
        </dl>
      )}

      {dossier && t && (
        <>
          <Actions label={`${p.family_name}: explore`} items={items} value={section} onChange={setSection} />
          <div className="sf__panel">
            {section === 'impact' && (
              <>
                <Section title={`Today, up to ${dossier.as_of.minute}`} scope={t.scope}>
                  <Figures
                    items={[
                      ['Shots', `${t.shots.total} · ${t.shots.on_target} on target`],
                      ['Assists', t.assists],
                      ['Fouls', `${t.fouls_committed} committed · ${t.fouls_won} won`],
                      ['Minutes', t.minutes_on_pitch],
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
                <Section title="In this match" scope="Official events naming this player and measured tactical moments featuring them, up to now">
                  <InvolvementList rows={rows} empty="Not yet part of an official event or a measured tactical moment." />
                </Section>
              </>
            )}
            {section === 'season' && (
              <Section title={`${dossier.season.season} season`} scope={dossier.season.scope}>
                <Figures
                  items={[
                    ['Appearances', dossier.season.including_today ? `${dossier.season.apps} → ${dossier.season.including_today.apps} today` : dossier.season.apps],
                    ['Goals', dossier.season.including_today ? `${dossier.season.goals} → ${dossier.season.including_today.goals} today` : dossier.season.goals],
                    ['Assists', dossier.season.assists],
                    [gk ? 'Clean sheets' : 'Bookings', gk ? (dossier.season.clean_sheets ?? 0) : `${dossier.season.yellows} yellow · ${dossier.season.reds} red`],
                  ]}
                />
                {dossier.season.one_booking_from_ban && <p className="sf__flag">One booking from a ban</p>}
              </Section>
            )}
            {section === 'career' && (
              <Section title="Career" scope={dossier.career.scope}>
                <Figures
                  items={[
                    [`For ${dossier.player.club.short_name} since ${dossier.totals.club.since}`, `${dossier.totals.club.apps} apps · ${dossier.totals.club.goals} goals`],
                    ['All clubs', `${dossier.totals.overall.apps} apps · ${dossier.totals.overall.goals} goals`],
                  ]}
                />
                <div className="dz__table-wrap">
                  <table className="dz__table">
                    <thead>
                      <tr>
                        <th scope="col">Season</th>
                        <th scope="col">Club</th>
                        <th scope="col">Apps</th>
                        <th scope="col">{gk ? 'Clean sheets' : 'Goals'}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...dossier.career.seasons].reverse().map((s) => (
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
                <p className="dz__note">
                  Joined {dossier.player.joined_season} · {dossier.player.fee_note}
                  {dossier.player.academy_graduate ? ' · academy graduate' : ''}
                </p>
              </Section>
            )}
            {section === 'milestones' && (
              <Section title="Milestones and background">
                <ul className="dz__flags">
                  {dossier.milestones.map((m) => (
                    <li key={m.text} data-today={m.status === 'reached_today'}>
                      {m.text}
                    </li>
                  ))}
                  {dossier.connections.map((c) => (
                    <li key={c.text}>{c.text}</li>
                  ))}
                </ul>
              </Section>
            )}
            {section === 'opponent' && (
              <Section title={`Against ${opponent}`} scope={dossier.derby.scope}>
                <Figures items={[['Derby goals before today', dossier.derby.goals_before_today], ['Today', dossier.derby.goals_today]]} />
                <ul className="dz__flags">
                  {rivalryFacts.map((f) => (
                    <li key={f.fact_id}>{f.short_text}</li>
                  ))}
                </ul>
              </Section>
            )}
            {section === 'tactics' && (
              <Section title="Tactical involvement" scope="Measured tactical moments featuring this player, up to now">
                <InvolvementList rows={rows.filter((r) => r.tactical)} empty="No measured tactical moment features this player yet." />
              </Section>
            )}
            {section === 'facts' && <ResearchPanel subject={{ kind: 'player', id: playerId }} matchId={matchId} seq={seq} clock={clock} world={world} onToast={onToast} hideHeader />}
          </div>
        </>
      )}
      <p className="fine">{dossier?.notice ?? 'Fictional player for a synthetic demo.'}</p>
    </article>
  )
}

export type ClubSection = 'form' | 'manager' | 'records' | 'rivalry' | 'facts'

/**
 * The club file (opened from a crest): identity and manager, the one thing worth saying, big numbers, then form and
 * fixtures, manager, records, rivalry and every fact one action away. Every block states its scope.
 */
export function ClubFile({ teamId, matchId, seq, clock, world, onToast, onPlayer, initialSection = 'form' }: { teamId: TeamId; matchId: string; seq: number; clock: string; world: WorldIndex; onToast: Toast; onPlayer: (id: string) => void; initialSection?: ClubSection }) {
  const team = world.teams.get(teamId)
  const d = useDossier<TeamDossier>(`/api/matches/${matchId}/dossier/teams/${teamId}`, seq)
  const facts = useFacts('team', teamId, matchId, seq)
  const prefsNow = usePrefs()
  const [section, setSection] = useState<ClubSection>(initialSection)
  const h2h = useDossier<H2HDossier>(section === 'rivalry' ? `/api/matches/${matchId}/dossier/h2h` : null, seq)
  const dossier = d.status === 'ready' ? d.data : null
  const other = teamId === world.homeId ? world.awayId : world.homeId
  const otherName = world.teams.get(other)?.short_name ?? 'them'
  const form = dossier ? [...dossier.form.matches].reverse() : []
  const streak = dossier?.streaks.current.find((s) => s.is_longest_in_record) ?? dossier?.streaks.current[0]
  const openFacts = (facts ?? []).filter((f) => !prefsNow.used[f.fact_id])
  const items: Array<[ClubSection, string]> = [
    ['form', 'Form and fixtures'],
    ['manager', 'Manager'],
    ['records', 'Records'],
    ['rivalry', `Against ${otherName}`],
    ['facts', `All facts${facts ? ` (${openFacts.length})` : ''}`],
  ]
  return (
    <article className="sf" style={{ '--kit': team?.kit.primary ?? '#888' } as CSSProperties}>
      <header className="sf__head">
        <Crest teamId={teamId} size={76} label="" />
        <div className="sf__who">
          <h3 className="sf__name">{team?.name ?? teamId}</h3>
          <p className="sf__line">{dossier ? `${dossier.club.stadium} · ${dossier.club.formation} · manager ${dossier.manager.name}` : ''}</p>
        </div>
      </header>

      <HeroFact facts={facts} onToast={onToast} more={openFacts.length} />

      {dossier && (
        <dl className="bigs">
          <Big value={dossier.current_season.points} label={`Points from ${dossier.current_season.played}`} />
          <Big
            value={
              <span className="sf__form" role="img" aria-label={`Last five, oldest first: ${form.map((m) => (m.result === 'W' ? 'won' : m.result === 'D' ? 'drew' : 'lost')).join(', ')}`}>
                {form.map((m) => (
                  <span key={`${m.date}-${m.opponent}`} className="dz__res" data-r={m.result}>
                    {m.result}
                  </span>
                ))}
              </span>
            }
            label="Form"
          />
          {streak && <Big value={streak.length} label={`${STREAK[streak.kind] ?? streak.kind} run`} />}
          <Big value={dossier.manager.derby_record.line.replace(/^P\d+ /, '')} label="Manager in derbies" />
        </dl>
      )}

      {dossier && (
        <>
          <Actions label={`${team?.short_name ?? 'Club'}: explore`} items={items} value={section} onChange={setSection} />
          <div className="sf__panel">
            {section === 'form' && (
              <>
                <Section title="Last five results" scope={dossier.form.scope}>
                  <ol className="dz__matches">
                    {form.map((x) => (
                      <FormRow key={`${x.date}-${x.opponent}`} m={x} />
                    ))}
                  </ol>
                </Section>
                <Section title="Next up" scope={dossier.upcoming.scope}>
                  <ul className="dz__list">
                    {dossier.upcoming.fixtures.map((f) => (
                      <li key={f.date}>
                        {fmtDate(f.date)} · {f.opponent} ({f.venue === 'home' ? 'home' : 'away'}) <span className="dz__muted">· {f.stage ?? f.competition}</span>
                      </li>
                    ))}
                  </ul>
                </Section>
              </>
            )}
            {section === 'manager' && (
              <>
                <Section title={dossier.manager.name} scope={dossier.manager.record.scope}>
                  <p className="dz__lead">
                    In charge since {dossier.manager.appointed_season}; previously {dossier.manager.previous}.
                  </p>
                  <Figures
                    items={[
                      ['All games', `${dossier.manager.record.line} · ${dossier.manager.record.win_pct}% won`],
                      ['League', dossier.manager.league_record.line],
                      ['Derbies', dossier.manager.derby_record.line],
                    ]}
                  />
                </Section>
                {dossier.streaks.current.length > 0 && (
                  <Section title="Running now" scope={dossier.streaks.scope}>
                    <ul className="dz__list">
                      {dossier.streaks.current.map((s) => (
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
              </>
            )}
            {section === 'records' && (
              <>
                <Section title="Honours and biggest results" scope={`${dossier.honours.scope}; ${dossier.biggest.scope}`}>
                  <Figures
                    items={[
                      ['League titles', dossier.honours.league_titles.length ? dossier.honours.league_titles.join(', ') : 'None in the record'],
                      ['Cups', dossier.honours.cups.length ? dossier.honours.cups.join(', ') : 'None in the record'],
                      ['Best league finish', dossier.honours.best_league_finish],
                    ]}
                  />
                  <ul className="dz__list">
                    {dossier.biggest.win_all_competitions && (
                      <li>
                        Biggest win: {dossier.biggest.win_all_competitions.score} v {dossier.biggest.win_all_competitions.opponent}, {fmtDate(dossier.biggest.win_all_competitions.date)}
                      </li>
                    )}
                    {dossier.biggest.defeat_all_competitions && (
                      <li>
                        Heaviest defeat: {dossier.biggest.defeat_all_competitions.score} v {dossier.biggest.defeat_all_competitions.opponent}, {fmtDate(dossier.biggest.defeat_all_competitions.date)}
                      </li>
                    )}
                  </ul>
                </Section>
                <Section title="League seasons" scope={dossier.seasons.scope}>
                  <div className="dz__table-wrap">
                    <table className="dz__table">
                      <thead>
                        <tr>
                          <th scope="col">Season</th>
                          <th scope="col">Pos</th>
                          <th scope="col">Pts</th>
                          <th scope="col">Top scorer</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[...dossier.seasons.rows].reverse().map((r) => (
                          <tr key={r.season}>
                            <td className="numeric">{r.season}</td>
                            <td className="numeric">{r.position}</td>
                            <td className="numeric">{r.points}</td>
                            <td>{r.top_scorer}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Section>
              </>
            )}
            {section === 'rivalry' &&
              (h2h.status !== 'ready' ? (
                <p className="dz__muted">{h2h.status === 'error' ? 'The derby record is unavailable right now.' : 'Loading the derby record…'}</p>
              ) : (
                <>
                  <Section title={h2h.data.rivalry} scope={h2h.data.all_time.scope}>
                    <Figures
                      items={[
                        ['Meetings, all time', h2h.data.all_time.meetings],
                        [`${team?.short_name} wins`, h2h.data.all_time.wins[teamId] ?? 0],
                        [`${otherName} wins`, h2h.data.all_time.wins[other] ?? 0],
                        ['Draws', h2h.data.all_time.draws],
                      ]}
                    />
                  </Section>
                  <Section title="Last meetings" scope={h2h.data.last_meetings.scope}>
                    <ol className="dz__list dz__meetings">
                      {h2h.data.last_meetings.meetings.slice(0, 5).map((m) => (
                        <li key={m.date}>
                          <span className="dz__muted">{m.date}</span>{' '}
                          <strong>
                            {m.home} {m.score} {m.away}
                          </strong>
                          {m.scorers.length > 0 && <span className="dz__scorers">{m.scorers.map((s) => `${s.name.split(' ').slice(-1)[0]} ${s.minute}'`).join(', ')}</span>}
                        </li>
                      ))}
                    </ol>
                  </Section>
                  <Section title="Derby scorers in today's squad" scope={h2h.data.leading_scorers.scope}>
                    <ol className="dz__list">
                      {h2h.data.leading_scorers.players
                        .filter((s) => s.team_id === teamId)
                        .slice(0, 5)
                        .map((s) => (
                          <li key={s.player_id}>
                            <button type="button" className="link-btn" onClick={() => onPlayer(s.player_id)}>
                              {s.name}
                            </button>{' '}
                            <strong className="numeric">{s.derby_goals_before_today}</strong>
                            {s.goals_today ? <span className="dz__muted"> + {s.goals_today} today</span> : null}
                          </li>
                        ))}
                    </ol>
                  </Section>
                </>
              ))}
            {section === 'facts' && <ResearchPanel subject={{ kind: 'team', id: teamId }} matchId={matchId} seq={seq} clock={clock} world={world} onToast={onToast} hideHeader />}
          </div>
        </>
      )}
      <p className="fine">{dossier?.notice ?? 'Fictional club for a synthetic demo.'}</p>
    </article>
  )
}
