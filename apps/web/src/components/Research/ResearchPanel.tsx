import { useEffect, useId, useRef, useState } from 'react'
import type { CSSProperties, KeyboardEvent } from 'react'
import { getJson } from '../../services/api'
import type { WorldIndex } from '../../services/matchView'
import { prefs as prefsStore, usePrefs } from '../../services/prefs'
import { PlayerFactsSchema, TeamFactsSchema } from '../../services/schemas'
import type { Fact, PlayerFacts, TeamFacts } from '../../services/schemas'
import type { TeamId } from '../../types/shell'
import { Crest } from '../brand/Crest'
import './Research.css'

export type ResearchSubject = { kind: 'player'; id: string } | { kind: 'team'; id: TeamId }

const PLAYER_TABS = [
  { id: 'quick', label: 'Quick' },
  { id: 'records', label: 'Records' },
  { id: 'stories', label: 'Stories' },
  { id: 'rivalries', label: 'Rivalries' },
  { id: 'match', label: 'Match' },
] as const
/** Quick = the most relevant facts right now, whatever their section (contextual ranking from the API). */
const QUICK_COUNT = 4
const RIVALRY = new Set(['derby', 'connection'])

function inPlayerTab(f: Fact, tab: string): boolean {
  if (tab === 'rivalries') return RIVALRY.has(f.category ?? '')
  if (tab === 'stories') return f.fact_type === 'stories' && !RIVALRY.has(f.category ?? '')
  return f.fact_type === tab
}
const TEAM_TABS = [
  { id: 'today', label: 'Today' },
  { id: 'records', label: 'Records' },
  { id: 'rivalry', label: 'Rivalry' },
  { id: 'historical', label: 'Historical' },
  { id: 'unusual', label: 'Unusual' },
] as const

type Load = { status: 'loading' } | { status: 'error' } | { status: 'ready'; data: PlayerFacts | TeamFacts; seq: number }

export interface ResearchPanelProps {
  subject: ResearchSubject
  matchId: string
  /** Current session seq (live facts never show the future). */
  seq: number
  clock: string
  world: WorldIndex
  onToast: (message: string, undo: () => void) => void
  /** The host shows its own identity header (the Commentator's player file). */
  hideHeader?: boolean
  /** "top": the few most relevant facts first, no tabs, with every fact by topic one tap away. */
  variant?: 'full' | 'top'
  topCount?: number
}

function provenanceLabel(f: Fact): string {
  if (f.provenance === 'match_event_derived') return `From match events${f.event_source_ids.length ? ` · ${f.event_source_ids.join(', ')}` : ''}`
  if (f.provenance === 'fictional_seeded') return 'Fictional · seeded demo history'
  return f.source
}

/**
 * Research drawer body (T016): per-fact Mark used (toast + Undo), Pin to
 * top, a "Used" history. Content is fetched once on open and only refreshed
 * when the commentator asks, so it never shifts under them.
 */
const CATEGORY_LABEL: Record<string, string> = {
  season: 'This season',
  career: 'Career',
  milestone: 'Milestone',
  discipline: 'Discipline',
  connection: 'Connection',
  derby: 'Derby',
  injury: 'Fitness',
  club: 'Club',
  manager: 'Manager',
  referee: 'Referee',
  form: 'Form',
  honours: 'Honours',
  stadium: 'Stadium',
  live: 'Today',
}

export function ResearchPanel({ subject, matchId, seq, clock, world, onToast, hideHeader = false, variant = 'full', topCount = 3 }: ResearchPanelProps) {
  const p = usePrefs()
  const tabs = subject.kind === 'player' ? PLAYER_TABS : TEAM_TABS
  const [tab, setTab] = useState<string>(tabs[0].id)
  const [load, setLoad] = useState<Load>({ status: 'loading' })
  const [reqSeq, setReqSeq] = useState(seq)
  const [asOfClock, setAsOfClock] = useState(clock)
  const [showUsed, setShowUsed] = useState(false)
  const [nonce, setNonce] = useState(0)
  const [expanded, setExpanded] = useState(variant !== 'top')
  const tabsId = useId()

  useEffect(() => {
    const ctrl = new AbortController()
    const url =
      subject.kind === 'player'
        ? `/api/matches/${matchId}/players/${encodeURIComponent(subject.id)}/facts?upto_seq=${Math.max(-1, reqSeq)}`
        : `/api/matches/${matchId}/teams/${encodeURIComponent(subject.id)}/facts?upto_seq=${Math.max(-1, reqSeq)}`
    const schema = subject.kind === 'player' ? PlayerFactsSchema : TeamFactsSchema
    getJson(url, schema, { signal: ctrl.signal, timeoutMs: 8000 })
      .then((data) => !ctrl.signal.aborted && setLoad({ status: 'ready', data, seq: reqSeq }))
      .catch(() => !ctrl.signal.aborted && setLoad({ status: 'error' }))
    return () => ctrl.abort()
  }, [subject.kind, subject.id, matchId, reqSeq, nonce])

  const facts = load.status === 'ready' ? load.data.facts : []
  const used = facts.filter((f) => p.used[f.fact_id])
  const open = facts.filter((f) => !p.used[f.fact_id])
  const byRelevance = [...open].sort((a, b) => (b.relevance ?? 0) - (a.relevance ?? 0))
  const tabFacts = (id: string): Fact[] => {
    if (subject.kind !== 'player') return open.filter((f) => f.fact_type === id)
    if (id === 'quick') return byRelevance.slice(0, QUICK_COUNT)
    return open.filter((f) => inPlayerTab(f, id))
  }
  const pinnedFirst = (list: Fact[]) =>
    [...list].sort((a, b) => Number(p.pinned.includes(b.fact_id)) - Number(p.pinned.includes(a.fact_id)))
  const inTab = expanded ? pinnedFirst(tabFacts(tab)) : pinnedFirst(byRelevance).slice(0, topCount)
  const counts = Object.fromEntries(tabs.map((t) => [t.id, tabFacts(t.id).length]))

  const rootRef = useRef<HTMLDivElement>(null)
  const markUsed = (f: Fact) => {
    prefsStore.markUsed(f.fact_id)
    onToast('Marked as used', () => prefsStore.unmarkUsed(f.fact_id))
    // The card disappears; keep keyboard focus in the panel (next fact, else the Used list).
    requestAnimationFrame(() => {
      const root = rootRef.current
      const next = root?.querySelector<HTMLElement>('.fact__use') ?? root?.querySelector<HTMLElement>('.research__used > button')
      next?.focus()
    })
  }

  const onTabKey = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const dir = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
    if (!dir) return
    e.preventDefault()
    const next = tabs[(i + dir + tabs.length) % tabs.length]!
    setTab(next.id)
    document.getElementById(`${tabsId}-${next.id}`)?.focus()
  }

  return (
    <div className="research" ref={rootRef}>
      {!hideHeader && <ResearchHeader subject={subject} world={world} data={load.status === 'ready' ? load.data : null} />}

      {expanded && (
      <div className="research__tabs" role="tablist" aria-label={subject.kind === 'player' ? 'Player facts' : 'Club facts'}>
        {tabs.map((t, i) => (
          <button
            key={t.id}
            id={`${tabsId}-${t.id}`}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            aria-controls={`${tabsId}-panel`}
            tabIndex={tab === t.id ? 0 : -1}
            onClick={() => setTab(t.id)}
            onKeyDown={(e) => onTabKey(e, i)}
          >
            {t.label}
            {load.status === 'ready' && <span className="research__count numeric">{counts[t.id]}</span>}
          </button>
        ))}
      </div>
      )}

      <div className="research__body" {...(expanded ? { role: 'tabpanel', id: `${tabsId}-panel`, 'aria-labelledby': `${tabsId}-${tab}` } : {})}>
        {load.status === 'loading' && (
          <div className="research__skeleton" aria-label="Loading facts">
            <span />
            <span />
          </div>
        )}
        {load.status === 'error' && (
          <div className="research__error" role="status">
            <p>Facts are temporarily unavailable. Match events remain available.</p>
            <button type="button" onClick={() => setNonce((n) => n + 1)}>
              Try again
            </button>
          </div>
        )}
        {load.status === 'ready' && (
          <>
            <div className="research__asof">
              <span>
                {subject.kind === 'player' ? `Live facts as of ${asOfClock}` : 'Club facts'} · {load.data.notice ?? 'Synthetic demo data'}
              </span>
              {subject.kind === 'player' && seq > load.seq && (
                <button
                  type="button"
                  onClick={() => {
                    setAsOfClock(clock)
                    setReqSeq(seq)
                  }}
                >
                  Update to {clock}
                </button>
              )}
            </div>
            {inTab.length === 0 ? (
              <p className="research__none">
                {used.length > 0 && facts.length > 0 ? 'All facts here are marked used.' : 'No facts in this section yet.'}
              </p>
            ) : (
              <ul className="research__facts">
                {inTab.map((f) => {
                  const pinned = p.pinned.includes(f.fact_id)
                  return (
                    <li key={f.fact_id} className="fact" data-pinned={pinned} data-live={f.provenance === 'match_event_derived'}>
                      <p className="fact__top">
                        {f.category && f.category !== 'profile' && (
                          <span className="fact__kicker">{CATEGORY_LABEL[f.category] ?? f.category}</span>
                        )}
                        {pinned && (
                          <span className="fact__pinned">
                            <svg width="12" height="12" viewBox="0 0 24 24" aria-hidden="true">
                              <path d="M9 3h6l-1 6 4 4H6l4-4-1-6Zm3 10v8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
                            </svg>
                            Pinned
                          </span>
                        )}
                      </p>
                      <p className="fact__text">{f.short_text}</p>
                      {f.extended_text && <p className="fact__more">{f.extended_text}</p>}
                      <div className="fact__foot">
                      <p className="fact__prov">
                        <span className={`fact__dot fact__dot--${f.provenance === 'match_event_derived' ? 'match' : 'seed'}`} aria-hidden="true" />
                        {provenanceLabel(f)}
                        {f.relevance_reason ? ` · ${f.relevance_reason}` : ''}
                      </p>
                      <div className="fact__actions">
                        <button type="button" aria-pressed={pinned} onClick={() => prefsStore.togglePin(f.fact_id)}>
                          {pinned ? 'Pinned' : 'Pin to top'}
                        </button>
                        <button type="button" className="fact__use" onClick={() => markUsed(f)}>
                          Mark used
                        </button>
                      </div>
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
            {!expanded && open.length > inTab.length && (
              <button type="button" className="link-btn research__all" onClick={() => setExpanded(true)}>
                All {open.length} facts by topic
              </button>
            )}
            {used.length > 0 && (
              <div className="research__used">
                <button type="button" aria-expanded={showUsed} onClick={() => setShowUsed((v) => !v)}>
                  Used <span className="numeric">{used.length}</span>
                </button>
                {showUsed && (
                  <ul>
                    {used.map((f) => (
                      <li key={f.fact_id}>
                        <span>{f.short_text}</span>
                        <button type="button" onClick={() => prefsStore.unmarkUsed(f.fact_id)}>
                          Undo
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function ResearchHeader({ subject, world, data }: { subject: ResearchSubject; world: WorldIndex; data: PlayerFacts | TeamFacts | null }) {
  if (subject.kind === 'team') {
    const team = world.teams.get(subject.id)
    return (
      <div className="ident">
        <Crest teamId={subject.id} size={56} label="" />
        <div className="ident__text">
          <p className="label">Fictional club</p>
          <h3 className="ident__name">{team?.name ?? subject.id}</h3>
          <p className="ident__meta">
            {[team?.stadium, team?.founded ? `founded ${team.founded}` : null].filter(Boolean).join(' · ')}
          </p>
        </div>
      </div>
    )
  }
  const fromWorld = world.players.get(subject.id)
  const fetched = data && subject.kind === 'player' ? (data as PlayerFacts).player : undefined
  const player: { given_name: string; family_name: string; shirt_number: number; position: string; preferred_foot?: string } | undefined =
    fetched ?? fromWorld
  const team = world.teams.get(fromWorld?.team_id ?? '')
  const initials = player ? `${player.given_name[0] ?? ''}${player.family_name[0] ?? ''}` : '?'
  return (
    <div className="ident">
      <span
        className="ident__card"
        style={{ '--fill': team?.kit.primary ?? '#13283a', '--num': team?.kit.number ?? '#fff' } as CSSProperties}
        aria-hidden="true"
      >
        <span className="ident__initials">{initials}</span>
        <span className="ident__shirt numeric">{player?.shirt_number ?? ''}</span>
      </span>
      <div className="ident__text">
        <p className="label">{team?.name ?? 'Fictional player'}</p>
        <h3 className="ident__name">{player ? `${player.given_name} ${player.family_name}` : subject.id}</h3>
        <p className="ident__meta">
          <span className="numeric">#{player?.shirt_number}</span> · {player?.position}
          {player?.preferred_foot ? ` · ${player.preferred_foot}-footed` : ''}
        </p>
      </div>
    </div>
  )
}
