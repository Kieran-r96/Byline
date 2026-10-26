import { useState } from 'react'
import type { CSSProperties } from 'react'
import { heroNumber } from '../../components/Broadcast/formats'
import { Crest } from '../../components/brand/Crest'
import { MiniPitch } from '../../components/Fan/MiniPitch'
import { BallGlyph, Glyph } from '../../components/glyphs/Glyph'
import type { InsightEntry } from '../../services/matchSession'
import { insightText, isRetracted, retractionReason } from '../../services/matchView'
import type { WorldIndex } from '../../services/matchView'
import type { PatternCandidate, Signal, TacticalMoment } from '../../services/schemas'
import { useMomentView } from '../../services/useMomentView'
import { asTeam } from '../liveData'
import { isRed, runClock, runSummary } from './feed'
import { fanText, momentIdOf, refsOf, roleWords } from './fanData'
import { WouldYouDo } from './WouldYouDo'

const kitOf = (world: WorldIndex, team: string | null | undefined) => (team ? world.teams.get(team)?.kit.primary : undefined) ?? '#888'

// ---------------------------------------------------------------- goals

/** The loudest moment: the scoring side's colour, the score, the scorer, and a replay. */
export function GoalMoment({ s, world, mine, onReplay }: { s: Signal; world: WorldIndex; mine: boolean; onReplay: () => void }) {
  const corrected = s.status !== 'live'
  return (
    <article className="m-goal" data-status={s.status} data-mine={mine} style={{ '--kit': kitOf(world, s.team_id) } as CSSProperties}>
      <div className="m-goal__top">
        <BallGlyph size={26} />
        <span className="m-goal__word">{corrected ? 'No goal' : 'Goal'}</span>
        <span className="m-goal__clock">{s.display_clock}</span>
      </div>
      <p className="m-goal__score">{s.headline.replace(/^(NO )?GOAL\s*·\s*/, '')}</p>
      <p className="m-goal__text">{corrected && s.status_reason ? s.status_reason : fanText(s)}</p>
      <button type="button" className="btn m-goal__btn" onClick={onReplay}>
        Watch it again
      </button>
    </article>
  )
}

/** A goal further down the stream: still in the scorer's colour, one line. */
export function GoalLine({ s, world, onReplay }: { s: Signal; world: WorldIndex; onReplay: () => void }) {
  return (
    <article className="m-goalline" data-status={s.status} style={{ '--kit': kitOf(world, s.team_id) } as CSSProperties}>
      <span className="m-row__clock">{s.display_clock}</span>
      <BallGlyph size={18} />
      <p className="m-row__text">
        <strong>{s.status !== 'live' ? 'No goal' : 'Goal'}</strong> {s.status !== 'live' && s.status_reason ? s.status_reason : fanText(s)}
      </p>
      <button type="button" className="chip-btn" onClick={onReplay}>
        Watch
      </button>
    </article>
  )
}

// ---------------------------------------------------------------- cards, changes, VAR

const glyphOf = (s: Signal) => (s.kind === 'card' ? (isRed(s) ? 'card-r' : 'card-y') : s.kind === 'substitution' ? 'sub' : 'var')

export function EventLine({ s }: { s: Signal }) {
  return (
    <article className="m-line" data-status={s.status}>
      <span className="m-row__clock">{s.display_clock}</span>
      <Glyph name={glyphOf(s)} size={18} />
      <p className="m-line__text">{s.status !== 'live' && s.status_reason ? s.status_reason : fanText(s)}</p>
    </article>
  )
}

/** Several routine events in a row, folded into one line; open it to see each. */
export function RunLine({ items }: { items: Signal[] }) {
  return (
    <details className="m-run">
      <summary>
        <span className="m-row__clock">{runClock(items)}</span>
        <span className="m-run__glyphs" aria-hidden="true">
          {items.slice(0, 4).map((s) => (
            <Glyph key={s.signal_id} name={glyphOf(s)} size={16} />
          ))}
        </span>
        <span className="m-run__text">{runSummary(items)}</span>
      </summary>
      <div className="m-run__items">
        {items.map((s) => (
          <EventLine key={s.signal_id} s={s} />
        ))}
      </div>
    </details>
  )
}

// ---------------------------------------------------------------- did you know

export function DidYouKnow({ s, world }: { s: Signal; world: WorldIndex }) {
  const text = fanText(s)
  const big = heroNumber(`${s.headline} ${text}`)
  return (
    <article className="m-dyk" style={{ '--kit': s.team_id ? kitOf(world, s.team_id) : 'var(--chalk-3)' } as CSSProperties}>
      {big && <p className="m-dyk__num">{big}</p>}
      <div>
        <p className="m-dyk__label">Did you know?</p>
        <p className="m-dyk__text">{text}</p>
      </div>
    </article>
  )
}

// ---------------------------------------------------------------- play

/** The full play card: What would you do? on the real frozen frame, or how it happened with Show me why. */
export function PlayMoment({ s, world, matchId, analyst, onShowWhy, onClose }: { s: Signal; world: WorldIndex; matchId: string; analyst: boolean; onShowWhy: (id: string) => void; onClose?: () => void }) {
  const mid = momentIdOf(s)
  const { view } = useMomentView(matchId, mid)
  const option = !!view?.whatif && view.whatif.alternatives.length > 0
  return (
    <article className="m-play" data-kind={option ? 'game' : 'why'}>
      <div className="m-play__top">
        <p className="m-play__kicker">
          <span className="m-play__clock">{s.display_clock}</span> {option ? 'What would you do?' : 'How it happened'}
        </p>
        {onClose && (
          <button type="button" className="link-btn m-play__close" aria-expanded={true} onClick={onClose}>
            Show less
          </button>
        )}
      </div>
      {option && view ? (
        <WouldYouDo view={view} world={world} matchId={matchId} onShowWhy={() => mid && onShowWhy(mid)} />
      ) : (
        <>
          <h3 className="m-play__headline">{s.headline}</h3>
          <p className="m-play__text">{analyst ? (s.text.commentator ?? fanText(s)) : fanText(s)}</p>
          {view && (
            <button type="button" className="m-play__pitch" data-theme="night" onClick={() => mid && onShowWhy(mid)} aria-label={`Show me why: ${s.headline}`}>
              <MiniPitch view={view} world={world} showWhatIf={false} />
              <span className="m-play__cta">Show me why</span>
            </button>
          )}
        </>
      )}
    </article>
  )
}

/** A play moment further down the stream: one line, opened in place on demand. */
export function PlayRow({ s, world, matchId, game, answered, analyst, onShowWhy }: { s: Signal; world: WorldIndex; matchId: string; game: boolean; answered: string | null; analyst: boolean; onShowWhy: (id: string) => void }) {
  const [open, setOpen] = useState(false)
  const mid = momentIdOf(s)
  if (open) return <PlayMoment s={s} world={world} matchId={matchId} analyst={analyst} onShowWhy={onShowWhy} onClose={() => setOpen(false)} />
  const picked = answered ? world.players.get(answered)?.family_name : null
  return (
    <article className="m-row" data-kind={game ? 'game' : 'why'} style={{ '--kit': kitOf(world, s.team_id) } as CSSProperties}>
      <span className="m-row__clock">{s.display_clock}</span>
      {s.team_id ? <Crest teamId={asTeam(s.team_id)} size={20} label="" /> : <span />}
      <p className="m-row__text">
        <span className="m-row__kicker">{game ? 'What would you do?' : 'How it happened'}</span> {fanText(s)}
        {picked && <span className="m-row__picked"> You picked {picked}.</span>}
      </p>
      {game ? (
        <button type="button" className="chip-btn m-row__go" aria-expanded={false} onClick={() => setOpen(true)}>
          {picked ? 'See it again' : 'Play it'}
        </button>
      ) : (
        <button type="button" className="chip-btn m-row__go" onClick={() => mid && onShowWhy(mid)}>
          Show me why
        </button>
      )}
    </article>
  )
}

// ---------------------------------------------------------------- AI-verified stories

export function StoryMoment({ c, entry, world, analyst, lang, onOpenEvidence }: { c: PatternCandidate; entry: InsightEntry | undefined; world: WorldIndex; analyst: boolean; lang: 'en' | 'es'; onOpenEvidence: (id: string) => void }) {
  const retracted = isRetracted(c, entry)
  return (
    <article className="m-play m-play--story" data-status={retracted ? 'withdrawn' : 'live'} style={{ '--kit': kitOf(world, c.team_id) } as CSSProperties}>
      <p className="m-play__kicker">
        <span className="m-play__clock">{c.display_clock}</span> A pattern in the play
      </p>
      <h3 className="m-play__headline">{insightText(entry?.update.insight, 'title', lang).text ?? ''}</h3>
      <p className="m-play__text">{retracted ? retractionReason(c, entry) : insightText(entry?.update.insight, analyst ? 'fan_analyst' : 'fan_discover', lang).text}</p>
      <button type="button" className="link-btn" onClick={() => onOpenEvidence(c.candidate_id)}>
        Show me why
      </button>
    </article>
  )
}

// ---------------------------------------------------------------- before the first moment

/**
 * Before kick-off and until the first moment: the matchup, your side and player, and what to look out for.
 * Built only from the pre-match facts the backend publishes and the confirmed line-ups.
 */
export function Matchup({ world, side, playerId, pre }: { world: WorldIndex; side: string | null; playerId: string | null; pre: readonly Signal[] }) {
  const home = world.teams.get(world.homeId)
  const away = world.teams.get(world.awayId)
  const derby = pre.find((s) => !s.team_id && /derb/i.test(fanText(s)))
  const player = playerId ? world.players.get(playerId) : undefined
  const playerFact = player ? pre.find((s) => refsOf(s).player_id === player.player_id) : undefined
  const sideFact = side && side !== 'neutral' ? pre.find((s) => s.team_id === side && s.kind === 'record') : undefined
  return (
    <section className="matchup" aria-labelledby="matchup-h">
      <h2 id="matchup-h" className="matchup__h">
        The matchup
      </h2>
      <p className="matchup__shapes">
        {[home, away].map((t, i) =>
          t ? (
            <span key={t.team_id} className="matchup__side" data-mine={side === t.team_id} style={{ '--kit': t.kit.primary } as CSSProperties}>
              {i === 1 && (
                <span className="matchup__v">v</span>
              )}
              <span className="matchup__name">{t.short_name}</span> <span className="matchup__shape">{t.formation}</span>
            </span>
          ) : null,
        )}
      </p>
      <ul className="matchup__facts">
        {derby && <li>{fanText(derby)}</li>}
        {sideFact && <li>{fanText(sideFact)}</li>}
        {player && (
          <li>
            Your player: <strong>{player.family_name}</strong>, No. {player.shirt_number}, {roleWords(player)}.{playerFact ? ` ${fanText(playerFact)}` : ''}
          </li>
        )}
      </ul>
      <p className="matchup__next">
        <span className="matchup__next-k">Look out for</span> a frozen frame when the tracking measures a better-placed team-mate: you pick the pass, then see what really happened.
      </p>
    </section>
  )
}

// ---------------------------------------------------------------- Analyst: measured moments

const fmt = (v: number | string, unit: string) => (typeof v === 'number' ? `${Number.isInteger(v) ? v : v.toFixed(1)}${unit ? ` ${unit}` : ''}` : v)

/** Each measured moment with its own numbers (label, value, unit as the detector published them). */
export function MeasuredMoments({ tactics, world, onShowWhy }: { tactics: readonly TacticalMoment[]; world: WorldIndex; onShowWhy: (id: string) => void }) {
  const [all, setAll] = useState(false)
  const shown = all ? tactics : tactics.slice(0, 5)
  return (
    <section className="am" aria-labelledby="am-h">
      <h2 id="am-h" className="fan__h">
        Measured moments
      </h2>
      <ol className="am__list">
        {shown.map((m) => (
          <li key={m.moment_id} className="am__item" style={{ '--kit': kitOf(world, m.team_id) } as CSSProperties}>
            <span className="m-row__clock">{m.display_clock}</span>
            <Crest teamId={asTeam(m.team_id)} size={20} label={world.teams.get(m.team_id)?.short_name ?? m.team_id} />
            <div className="am__body">
              <p className="am__title">
                <span className="am__kind">{m.label}</span> {m.title}
              </p>
              <ul className="am__nums">
                {m.observed.map((o) => (
                  <li key={o.label}>
                    <span>{o.label}</span> <strong>{fmt(o.value, o.unit)}</strong>
                  </li>
                ))}
              </ul>
              <button type="button" className="link-btn" onClick={() => onShowWhy(m.moment_id)}>
                Show me why
              </button>
            </div>
          </li>
        ))}
      </ol>
      {tactics.length > 5 && (
        <button type="button" className="btn btn--quiet" aria-expanded={all} onClick={() => setAll(!all)}>
          {all ? 'Show fewer' : `Show all ${tactics.length}`}
        </button>
      )}
    </section>
  )
}
