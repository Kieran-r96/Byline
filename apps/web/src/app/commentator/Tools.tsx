import { useState } from 'react'
import type { CSSProperties } from 'react'
import { Crest } from '../../components/brand/Crest'
import { DecisionCard } from '../../components/Decisions/Decisions'
import { Shirt } from '../../components/Formation/Shirt'
import { useDossier } from '../../services/dossier'
import type { TeamDossier } from '../../services/dossier'
import type { SessionSnapshot } from '../../services/matchSession'
import type { WorldIndex } from '../../services/matchView'
import { prefs, usePrefs } from '../../services/prefs'
import type { TeamId } from '../../types/shell'
import { FormRow } from './Dossier'
import { fmtDate } from './dossierFormat'
import { searchHits } from './research'
import type { ResearchFocus } from './research'
import type { ClubSection } from './SubjectFile'
import type { TalkingPoint } from './talkingPoints'

export type ToolId = 'players' | 'clubs' | 'records' | 'fixtures' | 'managers' | 'decisions' | 'search'

interface ToolProps {
  tool: ToolId
  matchId: string
  seq: number
  world: WorldIndex
  snap: SessionSnapshot
  points: TalkingPoint[]
  onUsed: (id: string) => void
  onPlayer: (id: string) => void
  onClub: (id: TeamId, section?: ClubSection) => void
  onFocus: (f: ResearchFocus) => void
}

const RECORD_KINDS = new Set(['record', 'milestone', 'streak', 'h2h', 'discipline'])

/** The quick-access tools: each opens beside the match using data BYLINE already has. */
export function Tool(props: ToolProps) {
  const { tool, world } = props
  const teams = [world.homeId, world.awayId] as TeamId[]
  if (tool === 'search') return <Search {...props} />
  if (tool === 'players') {
    return (
      <div className="toolp">
        {teams.map((id) => {
          const t = world.teams.get(id)
          return (
            <section key={id} className="toolp__team" style={{ '--kit': t?.kit.primary ?? '#888' } as CSSProperties} aria-label={t?.name ?? id}>
              <h3 className="toolp__h">
                <Crest teamId={id} size={22} label="" /> {t?.short_name}
              </h3>
              <ul className="toolp__grid">
                {(t?.players ?? []).map((p) => (
                  <li key={p.player_id}>
                    <button type="button" className="toolp__player" onClick={() => props.onPlayer(p.player_id)}>
                      <Shirt number={p.shirt_number} fill={(p.position === 'GK' ? t?.kit.goalkeeper : t?.kit.primary) ?? '#55606a'} trim={t?.kit.secondary ?? '#fff'} ink={p.position === 'GK' ? '#14171a' : (t?.kit.number ?? '#fff')} size={30} />
                      <span>{p.family_name}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )
        })}
      </div>
    )
  }
  if (tool === 'clubs') {
    return (
      <div className="toolp toolp--clubs">
        {teams.map((id) => (
          <button key={id} type="button" className="toolp__club" onClick={() => props.onClub(id)}>
            <Crest teamId={id} size={72} label="" />
            <span>{world.teams.get(id)?.name}</span>
          </button>
        ))}
      </div>
    )
  }
  if (tool === 'records') return <Records {...props} />
  if (tool === 'fixtures' || tool === 'managers') {
    return (
      <div className="toolp">
        {teams.map((id) => (
          <ClubSummary key={id} id={id} kind={tool} {...props} />
        ))}
      </div>
    )
  }
  return <Decisions {...props} />
}

function Search({ world, onFocus }: ToolProps) {
  const [q, setQ] = useState('')
  const hits = searchHits(world, q, 10)
  return (
    <div className="toolp">
      <label className="toolp__search">
        <span className="sr-only">Search players, clubs and managers</span>
        {/* eslint-disable-next-line jsx-a11y/no-autofocus -- the panel exists to type into */}
        <input autoFocus type="search" value={q} placeholder="A player, a club, a manager…" onChange={(e) => setQ(e.target.value)} />
      </label>
      <ul className="toolp__hits">
        {hits.map((h) => (
          <li key={h.key}>
            <button type="button" className="toolp__hit" onClick={() => onFocus(h.focus)}>
              <strong>{h.label}</strong> <span>{h.hint}</span>
            </button>
          </li>
        ))}
      </ul>
      {q && hits.length === 0 && <p className="dz__muted">Nothing matches “{q}”.</p>}
    </div>
  )
}

function Records({ points, onUsed }: ToolProps) {
  const p = usePrefs()
  const list = points.filter((t) => RECORD_KINDS.has(t.kind ?? '') && !p.used[t.id])
  if (list.length === 0) return <p className="toolp dz__muted">Records, milestones and streaks appear here as they become relevant.</p>
  return (
    <ol className="toolp toolp__records">
      {list.map((t) => {
        const pinned = p.pinned.includes(t.id)
        return (
          <li key={t.id} className="toolp__record" data-pinned={pinned}>
            <p className="toolp__record-text">{t.text}</p>
            {t.detail && <p className="toolp__record-detail">{t.detail}</p>}
            <div className="say__actions">
              <button type="button" className="chip-btn" aria-pressed={pinned} onClick={() => prefs.togglePin(t.id)}>
                {pinned ? 'Pinned' : 'Pin'}
              </button>
              <button type="button" className="chip-btn" onClick={() => onUsed(t.id)}>
                Mark used
              </button>
            </div>
          </li>
        )
      })}
    </ol>
  )
}

function ClubSummary({ id, kind, matchId, seq, world, onClub }: ToolProps & { id: TeamId; kind: 'fixtures' | 'managers' }) {
  const d = useDossier<TeamDossier>(`/api/matches/${matchId}/dossier/teams/${id}`, seq)
  const t = world.teams.get(id)
  const x = d.status === 'ready' ? d.data : null
  return (
    <section className="toolp__team" style={{ '--kit': t?.kit.primary ?? '#888' } as CSSProperties} aria-label={t?.name ?? id}>
      <h3 className="toolp__h">
        <Crest teamId={id} size={22} label="" /> {t?.short_name}
      </h3>
      {!x ? (
        <p className="dz__muted">Loading…</p>
      ) : kind === 'managers' ? (
        <>
          <p className="toolp__big">{x.manager.name}</p>
          <p className="toolp__line">
            Since {x.manager.appointed_season} · {x.manager.record.line} · {x.manager.record.win_pct}% won · derbies {x.manager.derby_record.line.replace(/^P\d+ /, '')}
          </p>
          <p className="dz__muted">Previously {x.manager.previous}.</p>
        </>
      ) : (
        <>
          <ol className="dz__matches">
            {[...x.form.matches].reverse().map((m) => (
              <FormRow key={`${m.date}-${m.opponent}`} m={m} />
            ))}
          </ol>
          <p className="toolp__line">
            Next: {x.upcoming.fixtures.map((f) => `${f.opponent} (${f.venue === 'home' ? 'H' : 'A'}) ${fmtDate(f.date)}`).join(' · ')}
          </p>
        </>
      )}
      <button type="button" className="link-btn" onClick={() => onClub(id, kind === 'managers' ? 'manager' : 'form')}>
        {t?.short_name} club file
      </button>
    </section>
  )
}

function Decisions({ snap }: ToolProps) {
  const p = usePrefs()
  const [open, setOpen] = useState<string | null>(null)
  if (snap.decisions.length === 0) return <p className="toolp dz__muted">Referee decisions are explained here as they happen.</p>
  return (
    <div className="toolp cm__decision">
      {[...snap.decisions].reverse().map((d) => (
        <DecisionCard
          key={d.decision_id}
          decision={d}
          expanded={open === d.decision_id}
          onToggle={() => setOpen(open === d.decision_id ? null : d.decision_id)}
          used={!!p.used[d.decision_id]}
          onToggleUsed={() => (p.used[d.decision_id] ? prefs.unmarkUsed(d.decision_id) : prefs.markUsed(d.decision_id))}
        />
      ))}
    </div>
  )
}
