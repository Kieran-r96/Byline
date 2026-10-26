import { useMemo, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { Crest } from '../../components/brand/Crest'
import { Drawer } from '../../components/Drawer/Drawer'
import '../../components/Fan/Fan.css'
import { Glyph } from '../../components/glyphs/Glyph'
import { SegmentedControl } from '../../components/SegmentedControl/SegmentedControl'
import type { InsightEntry, MatchSessionStore, SessionSnapshot } from '../../services/matchSession'
import { isDetectorOnly, matchClock, scoreDisplay, stageInfo } from '../../services/matchView'
import type { WorldIndex } from '../../services/matchView'
import { prefs, usePrefs } from '../../services/prefs'
import type { FanMode } from '../../services/prefs'
import type { PatternCandidate, Signal } from '../../services/schemas'
import { asTeam, usePlayheadSeconds } from '../liveData'
import type { SurfaceActions } from '../surfaceActions'
import { Compare } from './Compare'
import { CrestRadios } from './CrestPick'
import { BIG, collapsed, feedItems, groupRuns, pickFocal } from './feed'
import type { FeedItem, Filter, StoryEntry } from './feed'
import { fanPrefs, useFanPrefs } from './fanPrefs'
import { momentIdOf } from './fanData'
import { DidYouKnow, EventLine, GoalLine, GoalMoment, Matchup, MeasuredMoments, PlayMoment, PlayRow, RunLine, StoryMoment } from './Moments'
import { PlayerPick } from './PlayerPick'
import './FanSurface.css'

const FAN_MODES = [
  { value: 'classic' as const, label: 'Classic' },
  { value: 'discover' as const, label: 'Discover' },
  { value: 'analyst' as const, label: 'Analyst' },
]

/** What each mode is for, said once, beside the switch. */
const MODE_LINE: Record<FanMode, string> = {
  classic: 'Score, clock and the big events. Nothing else.',
  discover: 'The big moments, explained as they happen.',
  analyst: 'Patterns, numbers and the evidence behind them.',
}

type Story = { c: PatternCandidate; entry: InsightEntry | undefined }

export interface FanSurfaceProps extends SurfaceActions {
  store: MatchSessionStore
  snap: SessionSnapshot
  world: WorldIndex
  fanMode: FanMode
  pitch: ReactNode
  onPlayer: (id: string) => void
  onRecap: () => void
  finished: boolean
}

// ---------------------------------------------------------------- scoreboard

function Scoreboard({ snap, world, store, side }: { snap: SessionSnapshot; world: WorldIndex; store: MatchSessionStore; side: string | null }) {
  const seconds = usePlayheadSeconds(store)
  const score = scoreDisplay(snap.state, world.homeId, world.awayId)
  const clock = seconds > 0 ? matchClock(seconds * 1000, snap.detail, snap.state) : 'Kick-off soon'
  const half = (id: string, goals: number) => {
    const t = world.teams.get(id)
    return (
      <div className="sb__side" data-mine={side === id} style={{ '--kit': t?.kit.primary ?? '#888' } as CSSProperties}>
        <Crest teamId={asTeam(id)} size={52} label="" />
        <span className="sb__name">{t?.short_name}</span>
        <span className="sb__goals">{goals}</span>
      </div>
    )
  }
  return (
    <header className="sb" aria-label="Score" style={{ '--h': world.teams.get(world.homeId)?.kit.primary, '--a': world.teams.get(world.awayId)?.kit.primary } as CSSProperties}>
      {half(world.homeId, score.home ?? 0)}
      <span className="sb__clock">{score.varReview ? 'VAR check' : clock}</span>
      {half(world.awayId, score.away ?? 0)}
    </header>
  )
}

// ---------------------------------------------------------------- your side

/**
 * Crests first: before a choice the two crests are the picker; afterwards the same two crests stay as the switch
 * that flips the whole view to the other side, beside your player and the comparison.
 */
function Side({ world, snap, matchId, onPlayer, onCompare }: { world: WorldIndex; snap: SessionSnapshot; matchId: string; onPlayer: (id: string) => void; onCompare?: () => void }) {
  const fan = useFanPrefs()
  const picking = !fan.team
  const side = fan.team && fan.team !== 'neutral' ? fan.team : null
  return (
    <section className="side" data-state={picking ? 'pick' : 'set'} aria-label={picking ? undefined : 'Your side'} aria-labelledby={picking ? 'side-h' : undefined}>
      {picking && (
        <h2 id="side-h" className="side__q">
          Who are you with today?
        </h2>
      )}
      <div className="side__row">
        <div className="side__switch">
          {!picking && (
            <span className="side__label" aria-hidden="true">
              Your side
            </span>
          )}
          <CrestRadios world={world} size={picking ? 'big' : 'compact'} label={picking ? 'Your team' : 'Your side'} value={side} onChange={(id) => fanPrefs.setTeam(id)} />
        </div>
        {!picking && onCompare && (
          <button type="button" className="btn btn--quiet side__cmp" aria-haspopup="dialog" onClick={onCompare}>
            Compare the teams
          </button>
        )}
        {picking ? (
          <button type="button" className="link-btn side__neutral" onClick={() => fanPrefs.setTeam('neutral')}>
            Just here for the football
          </button>
        ) : side ? (
          <PlayerPick world={world} snap={snap} matchId={matchId} side={side} playerId={fan.player} autoOpen={!fan.player && Object.keys(fan.players).length === 0} onPlayer={onPlayer} />
        ) : (
          <p className="side__hint">Neutral. Tap a crest to see the match from that side.</p>
        )}
      </div>
    </section>
  )
}

// ---------------------------------------------------------------- surface

/**
 * Fan: a second screen that takes seconds, not minutes. Classic is the score and the big events. Discover leads
 * with one moment you can understand or play with, then a short stream. Analyst puts the measurements first.
 */
export function FanSurface(props: FanSurfaceProps) {
  const { snap, world, store, fanMode } = props
  const fan = useFanPrefs()
  const { lang } = usePrefs()
  const [filter, setFilter] = useState<Filter>('all')
  const [compare, setCompare] = useState(false)
  const [more, setMore] = useState(false)
  const analyst = fanMode === 'analyst'
  const side = fan.team && fan.team !== 'neutral' ? fan.team : null
  const fanSignals = useMemo(() => Object.values(snap.signals).filter((s) => s.audiences.includes('fan') && s.tier !== 'quiet' && s.status !== 'withdrawn'), [snap.signals])
  const signals = useMemo(() => fanSignals.filter((s) => s.at_ms > 0).sort((a, b) => b.at_ms - a.at_ms || b.seq - a.seq), [fanSignals])
  const pre = useMemo(() => fanSignals.filter((s) => s.at_ms === 0), [fanSignals])
  const stories = useMemo<StoryEntry<Story>[]>(
    () =>
      snap.candidates
        .map((c) => ({ c, entry: snap.insights[c.candidate_id] }))
        .filter(({ entry }) => entry?.update.insight && (stageInfo(entry).tone === 'verified' || (stageInfo(entry).tone === 'withdrawn' && !isDetectorOnly(entry))))
        .map((story) => ({ key: story.c.candidate_id, at: story.c.detected_at_ms, team: story.c.team_id, story })),
    [snap.candidates, snap.insights],
  )
  const replay = (s: Signal) => props.onReplayAt(Math.max(0, s.at_ms - 9000))
  const modeSwitch = (
    <div className="fan__mode">
      <SegmentedControl label="Fan view" size="sm" options={FAN_MODES} value={fanMode} onChange={(m) => prefs.setFanMode(m)} className="fan__modes" />
      <p className="fan__mode-line">{MODE_LINE[fanMode]}</p>
    </div>
  )

  if (fanMode === 'classic') {
    return (
      <div className="fan fan--classic">
        <div className="fan__col fan__col--wide">
          <div className="fan__top">{modeSwitch}</div>
          <Scoreboard snap={snap} world={world} store={store} side={side} />
          <div className="fan__pitch">{props.pitch}</div>
          <ol className="classic-events" aria-label="Goals, cards and changes">
            {signals
              .filter((s) => BIG.has(s.kind))
              .map((s) => (
                <li key={s.signal_id} data-status={s.status}>
                  <span className="numeric">{s.display_clock}</span>
                  <Glyph name={s.kind === 'goal' ? 'goal' : s.kind === 'card' ? (/red|sent off|second/i.test(s.headline) ? 'card-r' : 'card-y') : s.kind === 'substitution' ? 'sub' : 'var'} size={16} />
                  <span>{s.headline}</span>
                </li>
              ))}
          </ol>
        </div>
      </div>
    )
  }

  const isGame = (s: Signal) => {
    const mid = momentIdOf(s)
    return !!mid && !!snap.tactics[mid]?.whatif
  }
  const feedFor = (f: Filter) => feedItems<Story>({ signals, stories, filter: f, side, player: fan.player, isGame })
  const filters = (
    [
      ['all', 'For you'],
      ['play', 'Play the moments'],
      ['big', 'Goals and cards'],
      ['dyk', 'Did you know?'],
      ...(fan.player ? [['mine', world.players.get(fan.player)?.family_name ?? 'My player']] : []),
    ] as Array<[Filter, string]>
  ).filter(([f]) => f === 'all' || feedFor(f).length > 0)
  const active: Filter = filters.some(([f]) => f === filter) ? filter : 'all'
  const items = feedFor(active)
  const focal = active === 'all' && !analyst ? pickFocal(items) : null
  const stream = groupRuns(items.filter((i) => i !== focal))
  const short = collapsed(stream)
  const shown = more ? stream.slice(0, 30) : short
  const hidden = Math.min(30, stream.length) - short.length

  const render = (it: FeedItem<Story>, lead: boolean) => {
    switch (it.type) {
      case 'goal':
        return lead ? <GoalMoment key={it.key} s={it.s} world={world} mine={side === it.s.team_id} onReplay={() => replay(it.s)} /> : <GoalLine key={it.key} s={it.s} world={world} onReplay={() => replay(it.s)} />
      case 'event':
        return <EventLine key={it.key} s={it.s} />
      case 'run':
        return <RunLine key={it.key} items={it.items} />
      case 'dyk':
        return <DidYouKnow key={it.key} s={it.s} world={world} />
      case 'play':
        return lead ? (
          <PlayMoment key={it.key} s={it.s} world={world} matchId={store.matchId} analyst={analyst} onShowWhy={props.onOpenTactic} />
        ) : (
          <PlayRow key={it.key} s={it.s} world={world} matchId={store.matchId} game={it.game} answered={fan.answers[momentIdOf(it.s) ?? ''] ?? null} analyst={analyst} onShowWhy={props.onOpenTactic} />
        )
      case 'story':
        return <StoryMoment key={it.key} c={it.story.c} entry={it.story.entry} world={world} analyst={analyst} lang={lang} onOpenEvidence={props.onOpenEvidence} />
    }
  }

  const tactics = Object.values(snap.tactics).sort((a, b) => b.at_ms - a.at_ms)

  return (
    <div className="fan" data-mode={fanMode}>
      <div className="fan__col">
        <div className="fan__top">{modeSwitch}</div>
        <Scoreboard snap={snap} world={world} store={store} side={side} />
        <Side world={world} snap={snap} matchId={store.matchId} onPlayer={props.onPlayer} onCompare={analyst ? undefined : () => setCompare(true)} />

        {analyst ? (
          <section className="fan__cmp" aria-labelledby="cmp-h">
            <h2 id="cmp-h" className="fan__h">
              Side by side
            </h2>
            <Compare snap={snap} world={world} side={side} analyst onOpenEvidence={props.onOpenEvidence} />
          </section>
        ) : focal ? (
          <section className="focal" aria-labelledby="focal-h">
            <h2 id="focal-h" className="focal__h">
              Latest moment
            </h2>
            {render(focal, true)}
          </section>
        ) : (
          active === 'all' && <Matchup world={world} side={side} playerId={fan.player} pre={pre} />
        )}

        {analyst && tactics.length > 0 && <MeasuredMoments tactics={tactics} world={world} onShowWhy={props.onOpenTactic} />}

        {stream.length > 0 && (
          <section className="stream" aria-labelledby="stream-h">
            <h2 id="stream-h" className="fan__h">
              {analyst ? 'Key events and stories' : focal ? 'Earlier' : 'The match so far'}
            </h2>
            {filters.length > 1 && (
              <div className="fan__filters" role="group" aria-label="Show">
                {filters.map(([id, label]) => (
                  <button key={id} type="button" className="fan__filter" aria-pressed={active === id} onClick={() => setFilter(id)}>
                    {label}
                  </button>
                ))}
              </div>
            )}
            <div className="fan__feed">{shown.map((it) => render(it, false))}</div>
            {(more || hidden > 0) && (
              <button type="button" className="btn btn--quiet fan__more" aria-expanded={more} onClick={() => setMore(!more)}>
                {more ? 'Show fewer' : `Show ${hidden} more`}
              </button>
            )}
          </section>
        )}
        <button type="button" className="btn btn--quiet fan__recap" onClick={props.onRecap}>
          {props.finished ? 'Read the full-time story' : 'Catch up on the story so far'}
        </button>
      </div>
      {!analyst && (
        <Drawer side="right" title="Compare the teams" open={compare} onClose={() => setCompare(false)}>
          {compare && <Compare snap={snap} world={world} side={side} analyst={false} onOpenEvidence={props.onOpenEvidence} />}
        </Drawer>
      )}
    </div>
  )
}


