import { useId, useMemo, useState } from 'react'
import type { CSSProperties, KeyboardEvent } from 'react'
import { ResearchPanel } from '../../components/Research/ResearchPanel'
import { statRows } from '../../services/commentary'
import type { MatchSessionStore, SessionSnapshot } from '../../services/matchSession'
import { matchClock } from '../../services/matchView'
import type { WorldIndex } from '../../services/matchView'
import type { TeamId } from '../../types/shell'
import { asTeam } from '../liveData'
import { Dossier } from './Dossier'
import { searchHits } from './research'
import type { ResearchFocus } from './research'

function StatsTable({ snap, world, matchId, onFocus }: { snap: SessionSnapshot; world: WorldIndex; matchId: string; onFocus: (f: ResearchFocus) => void }) {
  const rows = statRows(snap.state, snap.keyEvents, world.homeId, world.awayId)
  if (!rows.some((r) => r.key === 'shots')) {
    return (
      <div>
        <p className="empty-line">Match statistics start at kick-off. Until then, the venue and officials:</p>
        <Dossier kind="match" id="" matchId={matchId} seq={snap.state?.seq ?? 0} world={world} onFocus={onFocus} fallback={null} />
      </div>
    )
  }
  const home = world.teams.get(world.homeId)
  const away = world.teams.get(world.awayId)
  return (
    <div className="stats">
      <div className="stats__head">
        <span style={{ '--kit': home?.kit.primary } as CSSProperties}>{home?.short_name}</span>
        <span style={{ '--kit': away?.kit.primary } as CSSProperties}>{away?.short_name}</span>
      </div>
      <dl className="stats__rows">
        {rows.map((r) => {
          const total = r.home + r.away
          const share = r.percent ? r.home / Math.max(1, r.home + r.away) : total ? r.home / total : 0.5
          return (
            <div key={r.key} className="stats__row" style={{ '--h': home?.kit.primary, '--a': away?.kit.primary, '--share': share } as CSSProperties}>
              <dt>{r.label}</dt>
              <dd className="stats__v stats__v--h numeric" data-lead={r.home > r.away}>
                {r.home}
                {r.percent ? '%' : ''}
              </dd>
              <dd className="stats__bar" aria-hidden="true">
                <span />
              </dd>
              <dd className="stats__v stats__v--a numeric" data-lead={r.away > r.home}>
                {r.away}
                {r.percent ? '%' : ''}
              </dd>
            </div>
          )
        })}
      </dl>
      <p className="fine">Counted from the official synthetic event log up to this moment.</p>
    </div>
  )
}

const TABS: Array<{ id: ResearchFocus['kind']; label: string }> = [
  { id: 'stats', label: 'Stats' },
  { id: 'player', label: 'Player' },
  { id: 'club', label: 'Club' },
  { id: 'h2h', label: 'Head to head' },
]

export function ResearchColumn({
  store,
  snap,
  world,
  focus,
  onFocus,
}: {
  store: MatchSessionStore
  snap: SessionSnapshot
  world: WorldIndex
  focus: ResearchFocus
  onFocus: (f: ResearchFocus) => void
}) {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const [lastPlayer, setLastPlayer] = useState<string | null>(null)
  const [lastClub, setLastClub] = useState<string>(world.homeId)
  const listId = useId()
  const hits = useMemo(() => searchHits(world, query), [world, query])

  const go = (f: ResearchFocus) => {
    if (f.kind === 'player') setLastPlayer(f.id)
    if (f.kind === 'club') setLastClub(f.id)
    onFocus(f)
    setQuery('')
  }
  if (focus.kind === 'player' && focus.id !== lastPlayer) setLastPlayer(focus.id)
  if (focus.kind === 'club' && focus.id !== lastClub) setLastClub(focus.id)

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((i) => Math.min(hits.length - 1, i + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => Math.max(0, i - 1))
    } else if (e.key === 'Enter' && hits[active]) {
      e.preventDefault()
      go(hits[active]!.focus)
    } else if (e.key === 'Escape') setQuery('')
  }

  const tabFor = (k: ResearchFocus['kind']): ResearchFocus =>
    k === 'player' ? (lastPlayer ? { kind: 'player', id: lastPlayer } : { kind: 'player', id: '' }) : k === 'club' ? { kind: 'club', id: lastClub } : k === 'h2h' ? { kind: 'h2h' } : k === 'match' ? { kind: 'match' } : { kind: 'stats' }

  const seq = snap.state?.seq ?? -1
  return (
    <div className="rc">
      <div className="rc__search">
        <label htmlFor={`${listId}-q`} className="sr-only">
          Search players, clubs, managers, head to head
        </label>
        <input
          id={`${listId}-q`}
          type="search"
          role="combobox"
          aria-expanded={hits.length > 0}
          aria-controls={listId}
          aria-activedescendant={hits[active] ? `${listId}-${hits[active]!.key}` : undefined}
          aria-autocomplete="list"
          placeholder="Search a player, club, manager or 'derby'"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setActive(0)
          }}
          onKeyDown={onKey}
          autoComplete="off"
        />
        {hits.length > 0 && (
          <ul className="rc__hits" role="listbox" id={listId}>
            {hits.map((h, i) => (
              <li
                key={h.key}
                id={`${listId}-${h.key}`}
                role="option"
                aria-selected={i === active}
                onMouseDown={(e) => {
                  e.preventDefault()
                  go(h.focus)
                }}
              >
                <span>{h.label}</span>
                <span className="rc__hint">{h.hint}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="rc__tabs" role="tablist" aria-label="Research">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={focus.kind === t.id || (t.id === 'h2h' && focus.kind === 'match')}
            onClick={() => onFocus(tabFor(t.id))}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="rc__body" role="tabpanel">
        {focus.kind === 'stats' && <StatsTable snap={snap} world={world} matchId={store.matchId} onFocus={go} />}
        {focus.kind === 'player' &&
          (focus.id ? (
            <Dossier
              key={`p-${focus.id}`}
              kind="player"
              id={focus.id}
              matchId={store.matchId}
              seq={seq}
              world={world}
              onFocus={go}
              fallback={
                <ResearchPanel
                  subject={{ kind: 'player', id: focus.id }}
                  matchId={store.matchId}
                  seq={seq}
                  clock={matchClock(store.playhead(), snap.detail, snap.state)}
                  world={world}
                  onToast={() => {}}
                />
              }
            />
          ) : (
            <p className="empty-block">Pick a player from either team sheet, or search above. Their season, career, records and today&apos;s numbers open here.</p>
          ))}
        {focus.kind === 'club' && (
          <Dossier
            key={`c-${focus.id}`}
            kind="club"
            id={focus.id}
            matchId={store.matchId}
            seq={seq}
            world={world}
            onFocus={go}
            fallback={
              <ResearchPanel
                subject={{ kind: 'team', id: asTeam(focus.id) as TeamId }}
                matchId={store.matchId}
                seq={seq}
                clock={matchClock(store.playhead(), snap.detail, snap.state)}
                world={world}
                onToast={() => {}}
              />
            }
          />
        )}
        {(focus.kind === 'h2h' || focus.kind === 'match') && (
          <Dossier key={focus.kind} kind={focus.kind} id="" matchId={store.matchId} seq={seq} world={world} onFocus={go} fallback={null} />
        )}
      </div>
    </div>
  )
}
