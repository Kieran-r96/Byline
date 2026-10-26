import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { DecisionCard } from '../../components/Decisions/Decisions'
import '../../components/Decisions/Decisions.css'
import { Drawer } from '../../components/Drawer/Drawer'
import { ShirtPitch } from '../../components/Formation/ShirtPitch'
import { Glyph } from '../../components/glyphs/Glyph'
import { DISCOVERY_LABEL, discoveries, discoveryKind, keyAlerts, preMatch, readable, routineLog, signalText } from '../../services/commentary'
import { useDossier } from '../../services/dossier'
import type { MatchDossier, TalkingPointDto } from '../../services/dossier'
import type { MatchSessionStore, SessionSnapshot } from '../../services/matchSession'
import { insightText, isDetectorOnly, isRetracted, matchClock, pendingTitle, retractionReason, stageInfo } from '../../services/matchView'
import type { WorldIndex } from '../../services/matchView'
import { prefs, usePrefs } from '../../services/prefs'
import type { Signal } from '../../services/schemas'
import { useShowcase } from '../../services/showcase'
import { useTacticalInsight } from '../../services/tacticalInsight'
import type { TeamId } from '../../types/shell'
import { usePlayheadSeconds } from '../liveData'
import { signalAction } from '../surfaceActions'
import type { SurfaceActions } from '../surfaceActions'
import { ResearchColumn } from './ResearchColumn'
import type { ResearchFocus } from './research'
import { momentWords } from './momentText'
import { ClubFile, PlayerFile } from './SubjectFile'
import type { ClubSection, PlayerSection } from './SubjectFile'
import { Tool } from './Tools'
import { fromServer, rankTalkingPoints } from './talkingPoints'
import type { TalkingPoint } from './talkingPoints'
import './Commentator.css'

export interface CommentatorSurfaceProps extends SurfaceActions {
  store: MatchSessionStore
  snap: SessionSnapshot
  world: WorldIndex
  /** The simulated feed (the demo's data source), shown on request only. */
  feed: ReactNode
  onToast: (message: string, undo: () => void) => void
  /** A crest tapped in the score bug: open that club's file (n changes on every tap). */
  clubRequest?: { id: TeamId; n: number } | null
}

/** A moment stays the focus for this long, then settles into history. */
const MOMENT_FRESH_MS = 6 * 60_000
const OFFICIAL = new Set(['goal', 'card', 'substitution', 'var', 'penalty'])

type HistoryTab = 'events' | 'developing' | 'talk' | 'log'
type Panel =
  | { kind: 'player'; id: string; section?: PlayerSection }
  | { kind: 'club'; id: TeamId; section?: ClubSection }
  | { kind: 'tool'; tool: 'players' | 'clubs' | 'records' | 'fixtures' | 'managers' | 'decisions' | 'search' }
  | { kind: 'history'; tab: HistoryTab }
  | { kind: 'research'; focus: ResearchFocus }
  | { kind: 'decision'; id: string }
  | { kind: 'feed' }

/** What deserves the commentator's eye now: official events, measured tactical insights, records. */
function pickMoment(signals: readonly Signal[], playheadMs: number, hidden: (id: string) => boolean): Signal | null {
  const ranked = signals
    .filter(
      (s) =>
        s.at_ms > 0 &&
        s.status !== 'withdrawn' &&
        s.audiences.includes('commentator') &&
        (s.tier === 'alert' || (s.tier === 'insight' && s.kind === 'tactical')) &&
        !hidden(s.signal_id),
    )
    .sort((a, b) => b.at_ms - a.at_ms || b.seq - a.seq)
  const top = ranked[0]
  return top && playheadMs - top.at_ms <= MOMENT_FRESH_MS ? top : null
}

function useVerified(matchId: string, s: Signal) {
  const mid = (s.refs as Record<string, unknown>).moment_id
  return useTacticalInsight(matchId, typeof mid === 'string' ? mid : null)
}

function AgentLine({ matchId, s }: { matchId: string; s: Signal }) {
  const v = useVerified(matchId, s)
  const { lang } = usePrefs()
  if (!v?.insight) return null
  // the recorded Spanish is the agents' own translation of the verified line; English when none was recorded
  const es = lang === 'es' ? v.insight.audience.translations?.['es.commentator'] : undefined
  return (
    <p className="verified-line" lang={es ? 'es' : undefined}>
      <span>Verified by Foundry agents{es ? ' · Spanish translation' : ''}</span> {es ?? v.insight.audience.commentator}
    </p>
  )
}

function Moment({
  moment,
  world,
  matchId,
  actions,
  decisionId,
  onDecision,
  onResearch,
  onUsed,
  onDismiss,
}: {
  moment: Signal
  world: WorldIndex
  matchId: string
  actions: SurfaceActions
  decisionId: string | null
  onDecision: (id: string) => void
  onResearch: (id: string, section?: PlayerSection) => void
  onUsed: () => void
  onDismiss: () => void
}) {
  const r = readable(moment)
  const verified = useVerified(matchId, moment)
  const team = moment.team_id ? world.teams.get(moment.team_id) : undefined
  const act = signalAction(moment, actions)
  const corrected = moment.status !== 'live'
  const major = OFFICIAL.has(moment.kind)
  const subject = (moment.refs as Record<string, unknown>).player_id
  const player = typeof subject === 'string' ? world.players.get(subject) : undefined
  const kind = r.kicker ?? (moment.kind === 'tactical' ? 'Tactical insight · measured' : DISCOVERY_LABEL[discoveryKind(moment)])
  // a goal leads with the scorer and keeps its confirmation state; a tactical moment's commentator text is the full
  // measurement, so at a glance the plain sentence is enough
  const words = momentWords(moment, world)
  const headline = words.headline
  const line = words.scorer ? words.line : moment.kind === 'tactical' ? (verified?.insight ? null : (moment.text.fan ?? r.line)) : r.line
  return (
    <article className="moment" data-major={major} data-status={moment.status} key={`${moment.signal_id}-${moment.version}`} style={{ '--kit': team?.kit.primary ?? 'var(--chalk-3)' } as CSSProperties} aria-labelledby="moment-h">
      <div className="moment__meta">
        <span className="moment__clock numeric">{moment.display_clock}</span>
        {team && <span className="moment__team">{team.short_name}</span>}
        <span className="moment__kind">{corrected ? (moment.status === 'corrected' ? 'Corrected' : 'Withdrawn') : kind}</span>
        <span className="moment__spacer" />
        <button type="button" className="chip-btn" onClick={onUsed}>
          Mark used
        </button>
        <button type="button" className="chip-btn" onClick={onDismiss} aria-label="Dismiss this moment">
          Dismiss
        </button>
      </div>
      <h2 id="moment-h" className="moment__headline">
        {headline}
      </h2>
      {(corrected && moment.status_reason) || line ? <p className="moment__line">{corrected && moment.status_reason ? moment.status_reason : line}</p> : null}
      {moment.kind === 'tactical' && !corrected && <AgentLine matchId={matchId} s={moment} />}
      {(act || decisionId || player) && (
        <div className="moment__actions">
          {act && (
            <button type="button" className="btn btn--primary" onClick={act.run}>
              {act.label}
            </button>
          )}
          {decisionId && (
            <button type="button" className="btn" onClick={() => onDecision(decisionId)}>
              Why that decision?
            </button>
          )}
          {player && typeof subject === 'string' && (
            <>
              {smartActions(moment.kind, player.family_name).map(([label, section]) => (
                <button key={label} type="button" className="btn" onClick={() => onResearch(subject, section)}>
                  {label}
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </article>
  )
}

/** The shortcuts a live event deserves: a goal opens the scorer's records, a booking the discipline, a change the new man. */
function smartActions(kind: string, name: string): Array<[string, PlayerSection]> {
  if (kind === 'goal') return [[`${name}'s records`, 'career'], ['Goals this season', 'season']]
  if (kind === 'card') return [['Disciplinary record', 'season'], [`${name}'s file`, 'impact']]
  if (kind === 'substitution') return [[`${name}'s profile`, 'impact'], ['Season contribution', 'season']]
  return [[`${name}'s file`, 'impact']]
}

function Calm({ last, onHistory }: { last: Signal | null; onHistory: () => void }) {
  return (
    <div className="calm">
      <h2 id="moment-h" className="calm__text">
        No new moment{last ? ` since ${last.display_clock}` : ' yet'}
      </h2>
      {last && (
        <button type="button" className="link-btn link-btn--quiet" onClick={onHistory}>
          Last: {readable(last).headline}
        </button>
      )}
    </div>
  )
}

function PreMatch({ world, matchId, notes, onStart, firstStory }: { world: WorldIndex; matchId: string; notes: Signal[]; onStart: () => void; firstStory: { clock: string; run: () => void } | null }) {
  const md = useDossier<MatchDossier>(`/api/matches/${matchId}/dossier/match`, 0)
  const fixture = md.status === 'ready' ? md.data : null
  const referee = fixture?.officials.find((o) => o.role === 'referee')
  const home = world.teams.get(world.homeId)
  const away = world.teams.get(world.awayId)
  const derby = notes.find((s) => /derby|h2h|head/i.test(String((s.refs as Record<string, unknown>).category ?? '') + s.headline))
  return (
    <article className="moment moment--pre" aria-labelledby="moment-h">
      <div className="moment__meta">
        <span className="moment__kind">Before kick-off</span>
      </div>
      <h2 id="moment-h" className="moment__headline">
        {home?.short_name ?? 'Home'} v {away?.short_name ?? 'Away'}
      </h2>
      {fixture && (
        <p className="moment__fixture">
          {fixture.competition.replace(/ \(fictional\)$/, '')}, matchday {fixture.matchday} · {fixture.stadium.name}
          {referee ? ` · referee ${referee.name}` : ''}
        </p>
      )}
      {derby && <p className="moment__line">{signalText(derby)}</p>}
      <div className="moment__actions">
        <button type="button" className="btn btn--primary" onClick={onStart}>
          Start the match
        </button>
        {firstStory && (
          <button type="button" className="btn" onClick={firstStory.run}>
            Jump to the first AI-verified story ({firstStory.clock})
          </button>
        )}
      </div>
    </article>
  )
}

function SayThis({ points, ranked, onUsed, onOpen, onMore }: { points: TalkingPoint[]; ranked: 'server' | 'local'; onUsed: (id: string) => void; onOpen: (f: ResearchFocus) => void; onMore: () => void }) {
  const p = usePrefs()
  const [open, setOpen] = useState<string | null>(null)
  return (
    <section className="say" aria-labelledby="say-h">
      <div className="block-head">
        <h2 id="say-h" className="block-head__title">
          Worth saying
        </h2>
        <button type="button" className="link-btn link-btn--quiet" onClick={onMore}>
          All talking points
        </button>
      </div>
      {points.length === 0 ? (
        <p className="empty-line">Every talking point is used. New ones arrive as the match develops.</p>
      ) : (
        <ol className="say__list" data-ranked={ranked}>
          {points.map((t) => {
            const pinned = p.pinned.includes(t.id)
            const expanded = open === t.id
            return (
              <li key={t.id} className="say__item" data-pinned={pinned}>
                <p className="say__text">{t.text}</p>
                <div className="say__foot">
                  <p className="say__why">
                    {pinned && <span className="say__pin">Pinned · </span>}
                    {t.why} · {t.source}
                  </p>
                  <div className="say__actions">
                    <button type="button" className="chip-btn" aria-pressed={pinned} onClick={() => prefs.togglePin(t.id)}>
                      {pinned ? 'Pinned' : 'Pin'}
                    </button>
                    <button type="button" className="chip-btn" onClick={() => onUsed(t.id)}>
                      Mark used
                    </button>
                    <button type="button" className="chip-btn" aria-expanded={expanded} onClick={() => setOpen(expanded ? null : t.id)}>
                      Detail
                    </button>
                  </div>
                </div>
                {expanded && (
                  <div className="say__detail">
                    <p>{t.detail || `${t.why}. Source: ${t.source.toLowerCase()}.`}</p>
                    {t.subject && (
                      <button type="button" className="link-btn" onClick={() => onOpen(t.subject!)}>
                        {t.subject.kind === 'club' ? 'Open the club file' : 'Open the player file'}
                      </button>
                    )}
                  </div>
                )}
              </li>
            )
          })}
        </ol>
      )}
    </section>
  )
}

const STATE_ORDER = ['Watching', 'Building', 'Story', 'Confirmed']

type StoryEntry = { c: SessionSnapshot['candidates'][number]; entry: SessionSnapshot['insights'][string] | undefined }

/** Agent-verified stories (and ones withdrawn after a correction), newest first. */
function verifiedStories(snap: SessionSnapshot): StoryEntry[] {
  return snap.candidates
    .map((c) => ({ c, entry: snap.insights[c.candidate_id] }))
    .filter(({ entry }) => entry?.update.insight && (stageInfo(entry).tone === 'verified' || (stageInfo(entry).tone === 'withdrawn' && !isDetectorOnly(entry))))
}

function StoryLine({ c, entry, actions, compact = false }: StoryEntry & { actions: SurfaceActions; compact?: boolean }) {
  const p = usePrefs()
  const retracted = isRetracted(c, entry)
  return (
    <li className="dev dev--story" data-kind="ai-story" data-status={retracted ? 'withdrawn' : 'live'}>
      <span className="dev__clock numeric">{c.display_clock}</span>
      <span className="dev__body">
        <span className="dev__kind dev__kind--ai">Deep analysis · verified by Foundry agents{retracted ? ' · withdrawn' : ''}</span>
        <span className="dev__headline">{insightText(entry?.update.insight, 'title', p.lang).text ?? pendingTitle(c)}</span>
        {(!compact || retracted) && <span className="dev__line">{retracted ? retractionReason(c, entry) : insightText(entry?.update.insight, 'commentator', p.lang).text}</span>}
      </span>
      <button type="button" className="link-btn" data-evidence-for={c.candidate_id} onClick={() => actions.onOpenEvidence(c.candidate_id)}>
        See the evidence
      </button>
    </li>
  )
}

const TOOL_TITLE = { players: 'Players', clubs: 'Clubs', records: 'Records', fixtures: 'Fixtures', managers: 'Managers', decisions: 'Decisions', search: 'Search' } as const

const NUDGE_MS = 8000
const NUDGE_FRESH_MS = 45_000

/** Worth a brief notification: official events, measured tactics, and patterns that have just become a story. */
function nudgeWorthy(s: Signal): boolean {
  if (s.at_ms <= 0 || s.status !== 'live' || !s.audiences.includes('commentator')) return false
  if (s.tier === 'alert') return true
  if (s.kind === 'tactical') return s.tier === 'insight'
  if (s.kind === 'storyline') return ['Story', 'Confirmed'].includes(readable(s).kicker ?? '')
  return false
}

/** A brief, unobtrusive notification with one clear action; it settles away on its own and never takes focus. */
function Nudge({ s, world, actions, onFile, onClose }: { s: Signal; world: WorldIndex; actions: SurfaceActions; onFile: (id: string) => void; onClose: () => void }) {
  const r = readable(s)
  const words = momentWords(s, world)
  const team = s.team_id ? world.teams.get(s.team_id) : undefined
  const act = signalAction(s, actions)
  const pid = (s.refs as Record<string, unknown>).player_id
  const player = typeof pid === 'string' ? world.players.get(pid) : undefined
  return (
    <div className="nudge" style={{ '--kit': team?.kit.primary ?? 'var(--chalk-3)' } as CSSProperties}>
      <p className="nudge__text">
        <span className="nudge__meta">
          <span className="numeric">{s.display_clock}</span> {r.kicker ?? (s.kind === 'tactical' ? 'Tactical · measured' : DISCOVERY_LABEL[discoveryKind(s)])}
        </span>{' '}
        {words.scorer ? `${words.headline}. ${words.line ?? ''}` : words.headline}
      </p>
      <div className="nudge__actions">
        {act ? (
          <button
            type="button"
            className="btn btn--primary btn--sm"
            onClick={() => {
              act.run()
              onClose()
            }}
          >
            {act.label}
          </button>
        ) : (
          player &&
          typeof pid === 'string' && (
            <button
              type="button"
              className="btn btn--primary btn--sm"
              onClick={() => {
                onFile(pid)
                onClose()
              }}
            >
              {player.family_name}&apos;s file
            </button>
          )
        )}
        <button type="button" className="chip-btn" onClick={onClose}>
          Later
        </button>
      </div>
    </div>
  )
}

function DevelopingLine({ s, actions }: { s: Signal; actions: SurfaceActions }) {
  const r = readable(s)
  const act = signalAction(s, actions)
  const level = s.kind === 'storyline' ? Math.max(0, STATE_ORDER.indexOf(r.kicker ?? '')) : -1
  return (
    <li className="dev" data-kind={s.kind}>
      <span className="dev__clock numeric">{s.display_clock}</span>
      <span className="dev__body">
        <span className="dev__kind">
          {s.kind === 'storyline' ? (
            <>
              <span className="dev__dots" role="img" aria-label={`Pattern stage: ${r.kicker ?? 'developing'}`}>
                {STATE_ORDER.map((st, i) => (
                  <span key={st} data-on={i <= level} />
                ))}
              </span>
              Pattern · {r.kicker ?? 'developing'}
            </>
          ) : (
            'Tactical · measured'
          )}
        </span>
        <span className="dev__headline">{r.headline}</span>
      </span>
      {act && (
        <button type="button" className="link-btn" onClick={act.run}>
          {act.label}
        </button>
      )}
    </li>
  )
}

function History({ tab, onTab, snap, world, signals, points, actions, onUsed }: { tab: HistoryTab; onTab: (t: HistoryTab) => void; snap: SessionSnapshot; world: WorldIndex; signals: Signal[]; points: TalkingPoint[]; actions: SurfaceActions; onUsed: (id: string) => void }) {
  const p = usePrefs()
  const events = keyAlerts(signals)
  const dev = discoveries(signals, null)
  const stories = verifiedStories(snap)
  const log = useMemo(() => routineLog(snap.events, world, 80), [snap.events, world])
  const tabs: Array<[HistoryTab, string]> = [
    ['events', 'Key events'],
    ['developing', 'Developing'],
    ['talk', 'Talking points'],
    ['log', 'Match log'],
  ]
  return (
    <div className="hist">
      <div className="seg" role="tablist" aria-label="Match so far">
        {tabs.map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => onTab(id)}>
            {label}
          </button>
        ))}
      </div>
      {tab === 'events' && (
        <ol className="hist__list">
          {events.length === 0 && <li className="empty-line">Goals, cards, substitutions and VAR decisions collect here.</li>}
          {events.map((s) => {
            const act = signalAction(s, actions)
            return (
              <li key={s.signal_id} className="hist__row" data-status={s.status}>
                <span className="numeric hist__clock">{s.display_clock}</span>
                <span className="hist__text">
                  <strong className="hist__headline">{s.headline}</strong>
                  {s.status !== 'live' && s.status_reason ? <span className="hist__reason">{s.status_reason}</span> : null}
                </span>
                {act && (
                  <button type="button" className="link-btn" onClick={act.run}>
                    {act.label}
                  </button>
                )}
              </li>
            )
          })}
        </ol>
      )}
      {tab === 'developing' && (
        <>
          <ul className="dev-list">
            {stories.map((st) => (
              <StoryLine key={st.c.candidate_id} {...st} actions={actions} />
            ))}
            {dev.map((s) => (
              <DevelopingLine key={s.signal_id} s={s} actions={actions} />
            ))}
          </ul>
          {dev.length === 0 && stories.length === 0 && <p className="empty-line">Measured tactical moments and patterns collect here.</p>}
        </>
      )}
      {tab === 'talk' && (
        <ol className="say__list say__list--all">
          {points.map((t) => {
            const used = !!p.used[t.id]
            return (
              <li key={t.id} className="say__item" data-used={used}>
                <p className="say__text">{t.text}</p>
                <p className="say__why">
                  {t.why} · {t.source}
                </p>
                {t.detail && <p className="say__why">{t.detail}</p>}
                <div className="say__actions">
                  {!used && (
                    <button type="button" className="chip-btn" aria-pressed={p.pinned.includes(t.id)} onClick={() => prefs.togglePin(t.id)}>
                      {p.pinned.includes(t.id) ? 'Pinned' : 'Pin'}
                    </button>
                  )}
                  <button type="button" className="chip-btn" aria-pressed={used} onClick={() => (used ? prefs.unmarkUsed(t.id) : onUsed(t.id))}>
                    {used ? 'Used' : 'Mark used'}
                  </button>
                </div>
              </li>
            )
          })}
        </ol>
      )}
      {tab === 'log' && (
        <ol className="log">
          {log.length === 0 && <li className="empty-line">Shots, saves, corners, throw-ins and fouls are logged here.</li>}
          {log.map((r) => {
            const team = r.teamId ? world.teams.get(r.teamId) : undefined
            return (
              <li key={r.id} className="log__row" data-important={r.important} style={{ '--kit': team?.kit.primary ?? 'var(--chalk-3)' } as CSSProperties}>
                <span className="log__clock numeric">{r.clock}</span>
                <Glyph name={r.icon} size={14} className="log__glyph" />
                <span className="log__text">{r.text}</span>
              </li>
            )
          })}
        </ol>
      )}
    </div>
  )
}

/**
 * The Commentator: glance down, get one thing worth saying, look back at the match. One focal column (Now: the
 * current moment; what is developing; what is worth saying) beside the line-up as shirts. Files, history, stats
 * and research open beside it on demand without hiding the live moment; brief notifications cover what happens
 * while a file is open.
 */
export function CommentatorSurface(props: CommentatorSurfaceProps) {
  const { store, snap, world, clubRequest } = props
  const p = usePrefs()
  const seconds = usePlayheadSeconds(store)
  const playheadMs = seconds * 1000
  const [team, setTeam] = useState<TeamId>(world.homeId)
  const [panel, setPanel] = useState<Panel | null>(null)
  const [dismissed, setDismissed] = useState<Record<string, true>>({})
  const signals = useMemo(() => Object.values(snap.signals), [snap.signals])
  const hidden = (id: string) => !!dismissed[id] || !!p.used[`moment:${id}`]
  const moment = pickMoment(signals, playheadMs, hidden)
  const lastSettled = useMemo(() => keyAlerts(signals)[0] ?? null, [signals])
  const pre = useMemo(() => preMatch(signals), [signals])
  const served = useDossier<{ talking_points: TalkingPointDto[] }>(`/api/matches/${store.matchId}/talking-points?limit=12`, snap.state?.seq ?? 0)
  const local = useMemo(() => rankTalkingPoints(signals, snap.events, world, playheadMs, 12), [signals, snap.events, world, playheadMs])
  const allPoints = served.status === 'ready' ? fromServer(served.data.talking_points, world) : local
  // pinned points stay on top until used; then the most relevant now (patterns and tactics live under Developing)
  const points = allPoints
    .filter((t) => !p.used[t.id] && t.kind !== 'storyline' && t.kind !== 'tactical')
    .sort((a, b) => Number(p.pinned.includes(b.id)) - Number(p.pinned.includes(a.id)))
    .slice(0, 3)
  const dev = useMemo(() => discoveries(signals, moment?.signal_id ?? null), [signals, moment])
  const stories = verifiedStories(snap)
  // developing: newest first, verified stories alongside measured tactics and patterns; a pattern the agents have
  // already verified shows once, as the verified story
  const storyIds = new Set(stories.map((st) => st.c.candidate_id))
  const coveredByStory = (s: Signal) => {
    const ids = (s.refs as Record<string, unknown>).candidate_ids
    return s.kind === 'storyline' && Array.isArray(ids) && ids.some((id) => storyIds.has(String(id)))
  }
  const developing: Array<{ at: number; node: ReactNode }> = [
    ...stories.map((st) => ({ at: st.c.detected_at_ms, node: <StoryLine key={st.c.candidate_id} {...st} actions={props} compact /> })),
    ...dev.filter((s) => !coveredByStory(s)).map((s) => ({ at: s.at_ms, node: <DevelopingLine key={s.signal_id} s={s} actions={props} /> })),
  ]
    .sort((a, b) => b.at - a.at)
    .slice(0, 2)
  const showcase = useShowcase(store.matchId)
  const first = showcase?.first_verified_ai_story ?? null
  const started = (snap.state?.seq ?? 0) > 3 && playheadMs > 0
  const decisionFor = (s: Signal) => snap.decisions.find((d) => d.source_event_ids.some((e) => s.evidence_event_ids.includes(e)))?.decision_id ?? null
  const [expandedDecision, setExpandedDecision] = useState(true)

  // a crest tapped in the score bug opens that club's file
  const [clubSeen, setClubSeen] = useState(0)
  if (clubRequest && clubRequest.n !== clubSeen) {
    setClubSeen(clubRequest.n)
    setPanel({ kind: 'club', id: clubRequest.id })
  }

  // brief notifications: something important the moment card is not already showing (or a file is open)
  const nudgeCandidate = useMemo(
    () => signals.filter((s) => nudgeWorthy(s) && playheadMs - s.at_ms >= 0 && playheadMs - s.at_ms <= NUDGE_FRESH_MS).sort((a, b) => b.at_ms - a.at_ms || b.seq - a.seq)[0] ?? null,
    [signals, playheadMs],
  )
  const nudgeKey = nudgeCandidate ? `${nudgeCandidate.signal_id}@${nudgeCandidate.version}` : null
  const [nudgeSeen, setNudgeSeen] = useState<string | null>(null)
  const [nudge, setNudge] = useState<Signal | null>(null)
  if (nudgeKey && nudgeKey !== nudgeSeen) {
    setNudgeSeen(nudgeKey)
    const onCard = !panel && moment?.signal_id === nudgeCandidate!.signal_id
    if (!onCard && started) setNudge(nudgeCandidate)
  }
  useEffect(() => {
    if (!nudge) return undefined
    const id = window.setTimeout(() => setNudge(null), NUDGE_MS)
    return () => window.clearTimeout(id)
  }, [nudge])

  // a new moment is announced politely for screen readers (the moment card itself stays in view)
  const announce = useRef<HTMLParagraphElement>(null)
  const lastId = useRef<string | null>(null)
  useEffect(() => {
    if (moment && moment.signal_id !== lastId.current && announce.current) announce.current.textContent = `${moment.display_clock} ${readable(moment).headline}`
    lastId.current = moment?.signal_id ?? null
  }, [moment])

  const open = (next: Panel) => setPanel(next)
  const close = () => setPanel(null)
  const openFocus = (f: ResearchFocus) => (f.kind === 'player' ? open({ kind: 'player', id: f.id }) : f.kind === 'club' ? open({ kind: 'club', id: f.id as TeamId }) : open({ kind: 'research', focus: f }))
  const markUsed = (id: string) => {
    prefs.markUsed(id)
    props.onToast('Marked as used', () => prefs.unmarkUsed(id))
  }
  const seq = snap.state?.seq ?? -1
  const clock = matchClock(store.playhead(), snap.detail, snap.state)
  const panelTitle =
    panel?.kind === 'player'
      ? 'Player file'
      : panel?.kind === 'club'
        ? 'Club file'
        : panel?.kind === 'history'
          ? 'Match so far'
          : panel?.kind === 'research'
            ? 'Research'
            : panel?.kind === 'decision'
              ? 'Why that decision'
              : panel?.kind === 'tool'
                ? TOOL_TITLE[panel.tool]
                : 'Simulated match feed'
  const decision = panel?.kind === 'decision' ? snap.decisions.find((d) => d.decision_id === panel.id) : undefined

  return (
    <div className="cm">
      <p className="sr-only" aria-live="polite" ref={announce} />
      <section className="cm__now" aria-label="Now">
        <nav className="tools" aria-label="Quick access">
          <div className="tools__top">
            <button type="button" className="tools__search" onClick={() => open({ kind: 'tool', tool: 'search' })}>
              <span aria-hidden="true">⌕</span> Search players, clubs, managers
            </button>
            <button type="button" className="tool tool--quiet" onClick={() => open({ kind: 'history', tab: 'events' })}>
              Match so far
            </button>
            <button type="button" className="tool tool--quiet" onClick={() => open({ kind: 'feed' })}>
              Match feed
            </button>
          </div>
          <div className="tools__row">
            <button type="button" className="tool" onClick={() => open({ kind: 'tool', tool: 'players' })}>
              Players
            </button>
            <button type="button" className="tool" onClick={() => open({ kind: 'tool', tool: 'clubs' })}>
              Clubs
            </button>
            <button type="button" className="tool" onClick={() => open({ kind: 'history', tab: 'developing' })}>
              Tactics<span className="tool__n numeric">{Object.keys(snap.tactics).length || ''}</span>
            </button>
            <button type="button" className="tool" onClick={() => open({ kind: 'research', focus: { kind: 'stats' } })}>
              Match stats
            </button>
            <button type="button" className="tool" onClick={() => open({ kind: 'tool', tool: 'records' })}>
              Records
            </button>
            <button type="button" className="tool" onClick={() => open({ kind: 'tool', tool: 'fixtures' })}>
              Fixtures
            </button>
            <button type="button" className="tool" onClick={() => open({ kind: 'tool', tool: 'managers' })}>
              Managers
            </button>
            <button type="button" className="tool" onClick={() => open({ kind: 'tool', tool: 'decisions' })}>
              Decisions<span className="tool__n numeric">{snap.decisions.length || ''}</span>
            </button>
          </div>
        </nav>

        {!started ? (
          <PreMatch
            world={world}
            matchId={store.matchId}
            notes={pre}
            onStart={() => store.play()}
            firstStory={
              first
                ? {
                    clock: first.clock,
                    run: () => {
                      store.seek(first.jump_to_ms)
                      store.play()
                    },
                  }
                : null
            }
          />
        ) : moment ? (
          <Moment
            moment={moment}
            world={world}
            matchId={store.matchId}
            actions={props}
            decisionId={decisionFor(moment)}
            onDecision={(id) => open({ kind: 'decision', id })}
            onResearch={(id, section) => open({ kind: 'player', id, section })}
            onUsed={() => markUsed(`moment:${moment.signal_id}`)}
            onDismiss={() => setDismissed((d) => ({ ...d, [moment.signal_id]: true }))}
          />
        ) : (
          <Calm last={lastSettled} onHistory={() => open({ kind: 'history', tab: 'events' })} />
        )}

        {started && developing.length > 0 && (
          <section className="devbox" aria-labelledby="dev-h">
            <div className="block-head">
              <h2 id="dev-h" className="block-head__title">
                Developing
              </h2>
              <button type="button" className="link-btn link-btn--quiet" onClick={() => open({ kind: 'history', tab: 'developing' })}>
                See all ({dev.length + stories.length})
              </button>
            </div>
            <ul className="dev-list">{developing.map((r) => r.node)}</ul>
          </section>
        )}
        <SayThis points={points} ranked={served.status === 'ready' ? 'server' : 'local'} onUsed={markUsed} onOpen={openFocus} onMore={() => open({ kind: 'history', tab: 'talk' })} />
      </section>

      <aside className="cm__xi" aria-label="Line-ups">
        <ShirtPitch
          world={world}
          state={snap.state}
          keyEvents={snap.keyEvents}
          team={team}
          onTeam={setTeam}
          onPlayer={(id) => open({ kind: 'player', id })}
          onClub={(id) => open({ kind: 'club', id })}
          selected={panel?.kind === 'player' ? panel.id : null}
        />
      </aside>

      <div className="nudge-slot" aria-live="polite">
        {nudge && <Nudge key={nudge.signal_id} s={nudge} world={world} actions={props} onFile={(id) => open({ kind: 'player', id })} onClose={() => setNudge(null)} />}
      </div>

      <Drawer side="right" modal={false} wide title={panelTitle} open={!!panel} onClose={close} closeLabel="Close and return to the match">
        {panel?.kind === 'player' && <PlayerFile key={`${panel.id}-${panel.section ?? ''}`} initialSection={panel.section} playerId={panel.id} matchId={store.matchId} seq={seq} clock={clock} world={world} snap={snap} actions={props} onToast={props.onToast} />}
        {panel?.kind === 'club' && <ClubFile key={`${panel.id}-${panel.section ?? ''}`} initialSection={panel.section} teamId={panel.id} matchId={store.matchId} seq={seq} clock={clock} world={world} onToast={props.onToast} onPlayer={(id) => open({ kind: 'player', id })} />}
        {panel?.kind === 'tool' && (
          <Tool
            tool={panel.tool}
            matchId={store.matchId}
            seq={seq}
            world={world}
            snap={snap}
            points={allPoints}
            onUsed={markUsed}
            onPlayer={(id) => open({ kind: 'player', id })}
            onClub={(id, section) => open({ kind: 'club', id, section })}
            onFocus={openFocus}
          />
        )}
        {panel?.kind === 'history' && (
          <History tab={panel.tab} onTab={(t) => open({ kind: 'history', tab: t })} snap={snap} world={world} signals={signals} points={allPoints} actions={props} onUsed={markUsed} />
        )}
        {panel?.kind === 'research' && (
          <div className="cm__research">
            <ResearchColumn store={store} snap={snap} world={world} focus={panel.focus} onFocus={(f) => (f.kind === 'player' ? open({ kind: 'player', id: f.id }) : open({ kind: 'research', focus: f }))} />
          </div>
        )}
        {panel?.kind === 'decision' && decision && (
          <div className="cm__decision">
            <DecisionCard decision={decision} expanded={expandedDecision} onToggle={() => setExpandedDecision((v) => !v)} used={!!p.used[decision.decision_id]} onToggleUsed={() => (p.used[decision.decision_id] ? prefs.unmarkUsed(decision.decision_id) : markUsed(decision.decision_id))} />
          </div>
        )}
        {panel?.kind === 'feed' && (
          <div className="cm__feed">
            <div className="cm__feed-box">{props.feed}</div>
            <p className="fine">The simulated match is BYLINE&apos;s demo data source. In use, you watch the real broadcast while BYLINE reads the official data feed.</p>
          </div>
        )}
      </Drawer>
    </div>
  )
}
