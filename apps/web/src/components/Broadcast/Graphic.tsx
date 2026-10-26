import { useEffect, useId, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import type { MomentView } from '../../services/schemas'
import type { Filled, Kit } from './fill'
import { frameFormat, heading, onAirFacts, shapeShift, sourceLine, spotlightSubject } from './formats'
import type { FormatId, GraphicTemplate } from './templates'
import '@fontsource/barlow-condensed/600.css'
import '@fontsource/barlow-condensed/700.css'
import '@fontsource/manrope/500.css'
import '@fontsource/manrope/700.css'
import './Graphic.css'
import './Northgate.css'

/**
 * BYLINE broadcast graphics: seven families, drawn for BYLINE (original design, no broadcaster's styling
 * copied). Every size is in container units so one design renders as a queue thumbnail, a preview monitor
 * and a programme monitor. A graphic draws only what `fillGraphic` filled from verified data; the template
 * supplies type, colour, layout and motion.
 *
 * Motion: `phase` 'in' plays the template's on-air choreography (wipes from the notch, masked lines,
 * staged children), 'out' plays its exit, 'still' draws the end state (thumbnails). Reduced motion turns
 * both into short fades.
 */

export type Phase = 'in' | 'out' | 'still'

type Vars = CSSProperties & Record<`--${string}`, string | number>

function tplVars(t: GraphicTemplate): Vars {
  const k = t.tokens
  return {
    '--tpl-plate': k.plate,
    '--tpl-plate-ink': k.plateInk,
    '--tpl-strap': k.strap,
    '--tpl-strap-ink': k.strapInk,
    '--tpl-accent': k.accent,
    '--tpl-accent-ink': k.accentInk,
    '--tpl-rule': k.rule,
    '--tpl-display': k.display,
    '--tpl-text': k.text,
    '--tpl-stretch': k.displayStretch,
    '--tpl-weight': k.displayWeight,
    '--tpl-radius': k.radius,
  }
}

function kitVars(k: Kit | null, prefix = 'kit'): Vars {
  return k ? { [`--${prefix}`]: k.primary, [`--${prefix}-2`]: k.secondary, [`--${prefix}-n`]: k.number } : {}
}

const teamLabel = (t: GraphicTemplate, k: Kit | null) => (k ? (t.layout.teamLabel === 'code' ? k.code : k.short) : '')

/** A masked line: the text rises into place on entry (index = stagger order). */
function L({ i = 0, className, children }: { i?: number; className?: string; children: ReactNode }) {
  return (
    <span className={`gx-l${className ? ` ${className}` : ''}`} style={{ '--i': i } as Vars}>
      <span className="gx-l__in">{children}</span>
    </span>
  )
}

/** Numbers in a measured line are set in the measured colour. */
function Measured({ text }: { text: string }) {
  const parts = text.split(/(\d+(?:\.\d+)?(?:\s?m)?)/)
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <b key={i} className="gx-num">
            {part}
          </b>
        ) : (
          part
        ),
      )}
    </>
  )
}

/** A shirt in the team's kit, seen from the back: name across the shoulders, number below. */
export function Shirt({ kit, number, name }: { kit: Kit | null; number: number | null; name: string }) {
  const id = useId().replace(/:/g, '')
  const body = kit?.primary ?? '#3b4a57'
  const trim = kit?.secondary ?? '#dfe5ea'
  const ink = kit?.number ?? '#ffffff'
  return (
    <svg className="gx-shirt" viewBox="0 0 120 120" aria-hidden="true">
      <defs>
        <linearGradient id={`${id}-sh`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0.16" />
          <stop offset="0.45" stopColor="#fff" stopOpacity="0" />
          <stop offset="1" stopColor="#000" stopOpacity="0.32" />
        </linearGradient>
      </defs>
      <path d="M38 10 L50 6 Q60 13 70 6 L82 10 L110 30 L99 52 L88 46 L88 112 Q60 117 32 112 L32 46 L21 52 L10 30 Z" fill={body} />
      <path d="M10 30 L21 52 L26 49 L15 27 Z M110 30 L99 52 L94 49 L105 27 Z" fill={trim} opacity="0.9" />
      <path d="M50 6 Q60 13 70 6 L72 8 Q60 18 48 8 Z" fill={trim} />
      <path d="M38 10 L50 6 Q60 13 70 6 L82 10 L110 30 L99 52 L88 46 L88 112 Q60 117 32 112 L32 46 L21 52 L10 30 Z" fill={`url(#${id}-sh)`} />
      <text x="60" y="38" textAnchor="middle" className="gx-shirt__name" fill={ink}>
        {name.toUpperCase()}
      </text>
      <text x="60" y="90" textAnchor="middle" className="gx-shirt__num" fill={ink}>
        {number ?? ''}
      </text>
    </svg>
  )
}

/** The measured frame as a chalkboard: players, the played pass and the measured open lane. */
export function MiniPitch({ view, home, away }: { view: MomentView | null; home: Kit; away: Kit }) {
  const id = useId().replace(/:/g, '')
  const w = view?.whatif ?? null
  const open = w?.alternatives.find((a) => a.rating === 'open') ?? null
  const origin = w?.origin ?? view?.ball ?? null
  const focus = new Set(view?.focus_player_ids ?? [])
  const colour = (team: string) => (team === home.id ? home.primary : away.primary)
  const end = w && w.actual.end.length >= 2 ? ([w.actual.end[0] ?? 0, w.actual.end[1] ?? 0] as const) : null
  return (
    <svg className="gx-pitch" viewBox="-3 -3 111 74" aria-hidden="true">
      <defs>
        <pattern id={`${id}-mow`} width="10.5" height="68" patternUnits="userSpaceOnUse">
          <rect width="5.25" height="68" fill="rgba(255,255,255,0.035)" />
        </pattern>
        <marker id={`${id}-tip`} viewBox="0 0 6 6" refX="5" refY="3" markerWidth="4" markerHeight="4" orient="auto-start-reverse">
          <path d="M0 0 L6 3 L0 6 Z" fill="currentColor" />
        </marker>
      </defs>
      <rect className="gx-pitch__grass" x="-3" y="-3" width="111" height="74" rx="1.5" />
      <rect x="0" y="0" width="105" height="68" fill={`url(#${id}-mow)`} />
      <g className="gx-pitch__lines">
        <rect x="0" y="0" width="105" height="68" />
        <path d="M52.5 0v68M0 13.84h16.5v40.32H0M105 13.84H88.5v40.32H105M0 24.84h5.5v18.32H0M105 24.84h-5.5v18.32H105" />
        <circle cx="52.5" cy="34" r="9.15" />
      </g>
      {view?.lines && <path className="gx-pitch__line" d={`M${view.lines.back_x} 2V66`} />}
      {open && origin && <path className="gx-pitch__lane" d={`M${origin[0]} ${origin[1]}L${open.x} ${open.y}`} />}
      {!w &&
        view?.arrows.map((a) => (
          <path key={a.event_id} className="gx-pitch__arrow" d={`M${a.from[0]} ${a.from[1]}L${a.to[0]} ${a.to[1]}`} markerEnd={`url(#${id}-tip)`} />
        ))}
      {w && origin && end && <path className="gx-pitch__pass" d={`M${origin[0]} ${origin[1]}L${end[0]} ${end[1]}`} markerEnd={w.actual.outcome === 'intercepted' ? undefined : `url(#${id}-tip)`} />}
      {view?.players.map((pl) => (
        <circle key={pl.pid} cx={pl.x} cy={pl.y} r={focus.has(pl.pid) ? 1.9 : 1.45} fill={colour(pl.team_id)} className="gx-pitch__dot" data-focus={focus.has(pl.pid)} />
      ))}
      {open && <circle className="gx-pitch__ring" cx={open.x} cy={open.y} r="3.4" />}
      {w && end && w.actual.outcome === 'intercepted' && <path className="gx-pitch__cut" d={`M${end[0] - 1.8} ${end[1] - 1.8}l3.6 3.6m0 -3.6l-3.6 3.6`} />}
      {origin && <circle className="gx-pitch__ball" cx={origin[0]} cy={origin[1]} r="1.1" />}
    </svg>
  )
}

function CardGlyph({ card }: { card: Filled['card'] }) {
  if (!card) return null
  return (
    <span className="gx-card" data-card={card} aria-hidden="true">
      <i />
      {card === 'second_yellow' && <i />}
    </span>
  )
}

// ---------------------------------------------------------------- families

function Spotlight({ f, t, run }: { f: Filled; t: GraphicTemplate; run: boolean }) {
  const pl = f.player
  const s = f.score
  const scorerHome = f.team?.id === f.home.id
  return (
    <div className="gx gx-flash" data-art={t.layout.playerArt}>
      <div className="gx-art">
        {t.layout.playerArt === 'shirt' ? (
          <Shirt kit={f.team} number={pl?.number ?? null} name={pl?.family ?? ''} />
        ) : (
          <span className="gx-numeral">
            <span>{pl?.number ?? ''}</span>
          </span>
        )}
      </div>
      <div className="gx-body">
        <div className="gx-tabs">
          <span className="gx-tab gx-tab--kit">
            <L>{f.tag}</L>
          </span>
          {s && (
            <span className="gx-tab gx-tab--score">
              <L i={1}>
                <span className="gx-score">
                  <span className="gx-score__code" style={kitVars(f.home, 'side')}>
                    {teamLabel(t, f.home)}
                  </span>
                  <b data-lead={scorerHome}>{scorerHome ? <Roll to={s.home} run={run} /> : s.home}</b>
                  <span className="gx-score__dash">–</span>
                  <b data-lead={!scorerHome}>{!scorerHome ? <Roll to={s.away} run={run} /> : s.away}</b>
                  <span className="gx-score__code" style={kitVars(f.away, 'side')}>
                    {teamLabel(t, f.away)}
                  </span>
                </span>
              </L>
            </span>
          )}
        </div>
        <div className="gx-plate">
          <span className="gx-notch" aria-hidden="true" />
          <span className="gx-name">
            {pl?.given && (
              <L i={2} className="gx-given">
                {pl.given}
              </L>
            )}
            <L i={3} className="gx-family">
              {pl?.family ?? f.fields.player?.value}
            </L>
          </span>
          {f.fields.clock && (
            <L i={4} className="gx-minute">
              {f.fields.clock.value}
            </L>
          )}
        </div>
        {f.fields.metric && (
          <div className="gx-strap">
            <L i={5}>
              {f.fields.metric.value}
              {f.team ? <span className="gx-strap__team"> · {f.team.name}</span> : null}
            </L>
          </div>
        )}
      </div>
    </div>
  )
}

function Breakthrough({ f, t, clip }: { f: Filled; t: GraphicTemplate; clip: boolean }) {
  return (
    <div className="gx gx-tele" data-clip={clip}>
      {!clip && (
        <div className="gx-art gx-art--pitch">
          <MiniPitch view={f.frame} home={f.home} away={f.away} />
        </div>
      )}
      <div className="gx-body">
        <div className="gx-tabs">
          <span className="gx-tab gx-tab--measured">
            <L>{t.id === 'northgate' ? 'Tactics' : `${f.tag} · measured`}</L>
          </span>
          {f.fields.clock && (
            <span className="gx-tab gx-tab--clock">
              <L i={1}>{f.fields.clock.value}</L>
            </span>
          )}
        </div>
        <div className="gx-plate">
          <span className="gx-notch" aria-hidden="true" />
          <L i={2} className="gx-headline">
            {f.fields.headline?.value}
          </L>
        </div>
        {f.fields.metric && (
          <div className="gx-strap gx-strap--measured">
            <L i={3}>
              <Measured text={f.fields.metric.value} />
            </L>
          </div>
        )}
      </div>
    </div>
  )
}

function Milestone({ f, t, run }: { f: Filled; t: GraphicTemplate; run: boolean }) {
  const who = f.fields.player?.value ?? (f.team ? f.team.name : null)
  return (
    <div className="gx gx-record" data-hero={!!f.hero}>
      <div className="gx-art gx-art--hero">
        <span className="gx-hero">
          <L>{f.hero ? <CountUp value={f.hero} run={run} /> : (f.team?.code ?? '')}</L>
        </span>
      </div>
      <div className="gx-body">
        <div className="gx-tabs">
          <span className="gx-tab gx-tab--kit">
            <L>{f.tag}</L>
          </span>
          {who && (
            <span className="gx-tab gx-tab--plain">
              <L i={1}>{t.layout.teamLabel === 'code' && f.team && !f.fields.player ? f.team.code : who}</L>
            </span>
          )}
        </div>
        <div className="gx-plate gx-plate--copy">
          <span className="gx-notch" aria-hidden="true" />
          <span className="gx-copy">
            {f.fields.headline && (
              <L i={2} className="gx-copy__head">
                {f.fields.headline.value}
              </L>
            )}
            <L i={3} className="gx-copy__text">
              {f.fields.strap?.value}
            </L>
          </span>
        </div>
        <div className="gx-foot">
          <L i={4}>Fictional history · rule attached</L>
        </div>
      </div>
    </div>
  )
}

function Change({ f, t }: { f: Filled; t: GraphicTemplate }) {
  const row = (side: 'on' | 'off', i: number) => {
    const s = f.sub[side]
    return (
      <div className="gx-sub__row" data-side={side} style={{ '--i': i } as Vars}>
        <span className="gx-sub__dir">
          <svg viewBox="0 0 12 12" aria-hidden="true">
            <path d={side === 'on' ? 'M6 1.5 L11 8.5 H1 Z' : 'M6 10.5 L1 3.5 H11 Z'} />
          </svg>
          {side === 'on' ? 'On' : 'Off'}
        </span>
        <span className="gx-sub__art">
          {t.layout.playerArt === 'shirt' ? <Shirt kit={f.team} number={s?.number ?? null} name="" /> : <span className="gx-numeral gx-numeral--small">{s?.number ?? ''}</span>}
        </span>
        <span className="gx-sub__name">
          <L i={i + 1} className="gx-given">
            {s?.given}
          </L>
          <L i={i + 2} className="gx-family">
            {s?.family}
          </L>
        </span>
        {s?.position && <span className="gx-sub__pos">{s.position}</span>}
      </div>
    )
  }
  return (
    <div className="gx gx-sub">
      <div className="gx-sub__head">
        <span className="gx-notch" aria-hidden="true" />
        <L className="gx-sub__team">{teamLabel(t, f.team)}</L>
        <L i={1} className="gx-sub__word">
          {f.tag}
        </L>
        {f.fields.clock && (
          <L i={1} className="gx-sub__clock">
            {f.fields.clock.value}
          </L>
        )}
      </div>
      {row('on', 1)}
      {row('off', 2)}
      {f.fields.shape && (
        <div className="gx-strap">
          <L i={4}>{f.fields.shape.value}</L>
        </div>
      )}
    </div>
  )
}

function Comparison({ f, t }: { f: Filled; t: GraphicTemplate }) {
  return (
    <div className="gx gx-stats" style={{ ...kitVars(f.home, 'h'), ...kitVars(f.away, 'a') }}>
      <div className="gx-stats__head">
        <span className="gx-stats__team" data-side="home">
          <i aria-hidden="true" />
          <L>{t.layout.teamLabel === 'code' ? f.home.code : f.home.short}</L>
        </span>
        <span className="gx-stats__score">
          <L i={1}>
            <span className="numeric">{f.score ? `${f.score.home}–${f.score.away}` : ''}</span>
          </L>
        </span>
        <span className="gx-stats__team" data-side="away">
          <L>{t.layout.teamLabel === 'code' ? f.away.code : f.away.short}</L>
          <i aria-hidden="true" />
        </span>
      </div>
      <p className="gx-stats__title">
        <L i={2}>{f.tag}</L>
      </p>
      <div className="gx-stats__rows">
        {f.rows.map((r, i) => {
          const max = Math.max(1, r.home, r.away)
          return (
            <div key={r.key} className="gx-stats__row" style={{ '--i': i, '--wh': r.home / max, '--wa': r.away / max } as Vars}>
              <span className="gx-stats__v" data-lead={r.home > r.away}>
                {r.home}
              </span>
              <span className="gx-stats__bar" data-side="home" aria-hidden="true">
                <i />
              </span>
              <span className="gx-stats__label">{r.label}</span>
              <span className="gx-stats__bar" data-side="away" aria-hidden="true">
                <i />
              </span>
              <span className="gx-stats__v" data-lead={r.away > r.home}>
                {r.away}
              </span>
            </div>
          )
        })}
      </div>
      <p className="gx-stats__foot">
        <L i={3}>Counted from the official match events</L>
      </p>
    </div>
  )
}

function Decision({ f, t }: { f: Filled; t: GraphicTemplate }) {
  const rule = f.fields.rule?.value ?? ''
  const [lawNo, lawTitle] = rule.includes(':') ? rule.split(/:\s*/, 2) : [rule, '']
  const corrected = f.fields.corrected?.value ?? ''
  const stays = corrected.match(/^Score stays (\d+\s*[–-]\s*\d+)\.?\s*(.*)$/)
  const var_ = /disallowed|var/i.test(f.fields.decision?.value ?? '')
  return (
    <div className="gx gx-decision">
      <div className="gx-art gx-art--law">
        <span className="gx-law">
          <span className="gx-law__kicker">Laws of the Game</span>
          <L className="gx-law__no">{lawNo}</L>
          {lawTitle && (
            <L i={1} className="gx-law__title">
              {lawTitle}
            </L>
          )}
        </span>
      </div>
      <div className="gx-body">
        <div className="gx-tabs">
          <span className="gx-tab gx-tab--ref">
            <L>{var_ ? 'VAR decision' : t.id === 'northgate' ? 'Ref watch' : 'Referee decision'}</L>
          </span>
          {f.fields.clock && (
            <span className="gx-tab gx-tab--clock">
              <L i={1}>{f.fields.clock.value}</L>
            </span>
          )}
        </div>
        <div className="gx-plate">
          <span className="gx-notch" aria-hidden="true" />
          <CardGlyph card={f.card} />
          <L i={2} className="gx-headline">
            {f.tag}
          </L>
          {f.player && (
            <L i={3} className="gx-plate__aside">
              {f.player.family}
            </L>
          )}
        </div>
        {f.fields.strap && (
          <div className="gx-strap">
            <L i={4}>{f.fields.strap.value}</L>
          </div>
        )}
        {corrected && (
          <div className="gx-corrected">
            <L i={5}>
              {stays ? (
                <>
                  <span className="gx-corrected__score">Score stays {stays[1]}</span> {stays[2]}
                </>
              ) : (
                corrected
              )}
            </L>
          </div>
        )}
      </div>
    </div>
  )
}

function Story({ f }: { f: Filled }) {
  const foundry = f.fields.headline?.source === 'foundry'
  return (
    <div className="gx gx-story">
      <div className="gx-body">
        <div className="gx-plate">
          <span className="gx-notch" aria-hidden="true" />
          <L className="gx-headline">{f.fields.headline?.value}</L>
        </div>
        {f.fields.strap && (
          <div className="gx-strap">
            <L i={1}>{f.fields.strap.value}</L>
            {foundry && <span className="gx-strap__src">Verified analysis</span>}
          </div>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- builds shared by every format

const prefersReduced = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

/** The scoring side's number turns over from the old score to the new one as the graphic builds. */
function Roll({ to, run }: { to: number; run: boolean }) {
  if (!run || to < 1) return <>{to}</>
  return (
    <span className="fx-roll">
      <span className="fx-roll__in" aria-hidden="true">
        <span>{to - 1}</span>
        <span>{to}</span>
      </span>
      <span className="sr-only">{to}</span>
    </span>
  )
}

/** A record's number counts up to its value as the graphic builds (an ordinal keeps its suffix). */
function CountUp({ value, run }: { value: string; run: boolean }) {
  const m = value.match(/^(\d+)(\D*)$/)
  const target = m ? Number(m[1]) : null
  const [n, setN] = useState<number | null>(null)
  useEffect(() => {
    if (!run || target === null || prefersReduced()) return undefined
    let raf = 0
    const t0 = performance.now()
    const tick = (now: number) => {
      const k = Math.min(1, Math.max(0, (now - t0 - 200) / 760))
      setN(Math.round(target * (1 - (1 - k) ** 3)))
      if (k < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [run, target])
  if (target === null || !m) return <>{value}</>
  const shown = run && n !== null ? n : target
  return (
    <>
      <span aria-hidden="true" className="fx-count">
        {shown}
        {m[2]}
      </span>
      <span className="sr-only">{value}</span>
    </>
  )
}

/** A player pictured the template's way: a shirt in kit colours, or a numeral block. */
function PlayerArt({ t, kit, number, name, small = false }: { t: GraphicTemplate; kit: Kit | null; number: number | null; name: string; small?: boolean }) {
  return t.layout.playerArt === 'shirt' ? (
    <Shirt kit={kit} number={number} name={name} />
  ) : (
    <span className={`gx-numeral fx-numeral${small ? ' gx-numeral--small' : ''}`} style={kitVars(kit)}>
      <span>{number ?? ''}</span>
    </span>
  )
}

/** The substitution: the player going off greys out and steps down as the player coming on lifts in. */
function Swap({ f, t }: { f: Filled; t: GraphicTemplate }) {
  const side = (k: 'on' | 'off') => {
    const s = f.sub[k]
    return (
      <span className="fx-swap__side" data-side={k}>
        <span className="fx-swap__art">
          <PlayerArt t={t} kit={f.team} number={s?.number ?? null} name={s?.family ?? ''} small />
        </span>
        <span className="fx-swap__dir">
          <svg viewBox="0 0 12 12" aria-hidden="true">
            <path d={k === 'on' ? 'M6 1.5 L11 8.5 H1 Z' : 'M6 10.5 L1 3.5 H11 Z'} />
          </svg>
          {k === 'on' ? 'On' : 'Off'}
        </span>
      </span>
    )
  }
  return (
    <span className="fx-swap">
      {side('off')}
      <svg className="fx-swap__arrow" viewBox="0 0 40 16" aria-hidden="true">
        <path d="M2 5 H32 L27 1 M38 11 H8 L13 15" />
      </svg>
      {side('on')}
    </span>
  )
}

/** A measured shape change: each dimension's change after the substitution, as a bar either side of no change. */
function ShapeShift({ f }: { f: Filled }) {
  const rows = shapeShift(f)
  const max = Math.max(3, ...rows.map((r) => Math.abs(r.delta)))
  return (
    <span className="fx-shape">
      <span className="fx-shape__key">
        <span>Change after the substitution, metres</span>
      </span>
      {rows.map((r, i) => (
        <span key={r.label} className="fx-shape__row" style={{ '--i': i, '--d': Math.abs(r.delta) / max } as Vars} data-dir={r.delta >= 0 ? 'up' : 'down'}>
          <span className="fx-shape__label">{r.label}</span>
          <span className="fx-shape__bar" aria-hidden="true">
            <i />
          </span>
          <span className="fx-shape__v">
            <b className="numeric">
              {r.delta > 0 ? '+' : ''}
              {r.delta.toFixed(1)} m
            </b>{' '}
            {r.word}
          </span>
        </span>
      ))}
    </span>
  )
}

function LawArt({ f }: { f: Filled }) {
  const rule = f.fields.rule?.value ?? ''
  const [lawNo, lawTitle] = rule.includes(':') ? rule.split(/:\s*/, 2) : [rule, '']
  return (
    <span className="gx-law fx-law">
      <span className="gx-law__kicker">Laws of the Game</span>
      <span className="gx-law__no">{lawNo}</span>
      {lawTitle && <span className="gx-law__title">{lawTitle}</span>}
      <CardGlyph card={f.card} />
    </span>
  )
}

function RowsArt({ f, max }: { f: Filled; max: number }) {
  return (
    <span className="fx-rows" style={{ ...kitVars(f.home, 'h'), ...kitVars(f.away, 'a') }}>
      {f.rows.slice(0, max).map((r, i) => {
        const top = Math.max(1, r.home, r.away)
        return (
          <span key={r.key} className="fx-rows__row" style={{ '--i': i, '--wh': r.home / top, '--wa': r.away / top } as Vars}>
            <b className="numeric" data-lead={r.home > r.away}>
              {r.home}
            </b>
            <span className="fx-rows__bar" data-side="home" aria-hidden="true">
              <i />
            </span>
            <span className="fx-rows__label">{r.label}</span>
            <span className="fx-rows__bar" data-side="away" aria-hidden="true">
              <i />
            </span>
            <b className="numeric" data-lead={r.away > r.home}>
              {r.away}
            </b>
          </span>
        )
      })}
    </span>
  )
}

/** The picture a larger format carries: shirt, swap, record number, pitch, shape, law, stats or team. */
function Art({ f, t, run }: { f: Filled; t: GraphicTemplate; run: boolean }) {
  switch (f.family) {
    case 'spotlight':
      return (
        <span className="fx-art__player">
          <PlayerArt t={t} kit={f.team} number={f.player?.number ?? null} name={f.player?.family ?? ''} />
        </span>
      )
    case 'change':
      return <Swap f={f} t={t} />
    case 'milestone':
      return <span className="fx-hero">{f.hero ? <CountUp value={f.hero} run={run} /> : (f.team?.code ?? '')}</span>
    case 'breakthrough':
      return f.kind === 'shape_change' && shapeShift(f).length ? <ShapeShift f={f} /> : <MiniPitch view={f.frame} home={f.home} away={f.away} />
    case 'decision':
      return <LawArt f={f} />
    case 'comparison':
      return <RowsArt f={f} max={3} />
    default:
      return <span className="fx-team">{f.team ? (t.layout.teamLabel === 'code' ? f.team.code : f.team.short) : 'Story'}</span>
  }
}

function Facts({ f, max }: { f: Filled; max: number }) {
  const facts = onAirFacts(f).slice(0, max)
  if (!facts.length) return null
  return (
    <dl className="fx-facts">
      {facts.map((x, i) => (
        <div key={x.key} className="fx-facts__row" data-tone={x.tone} style={{ '--i': i } as Vars}>
          <dt>{x.label}</dt>
          <dd>{f.family === 'breakthrough' ? <Measured text={x.value} /> : x.value}</dd>
        </div>
      ))}
    </dl>
  )
}

// ---------------------------------------------------------------- formats

/** Upper-right corner box over the live picture: the picture (or the animated breakdown) with a caption strip. */
function Pip({ f, t, media, run }: { f: Filled; t: GraphicTemplate; media?: ReactNode; run: boolean }) {
  const h = heading(f, t)
  const fact = onAirFacts(f)[0]
  return (
    <div className="gx fx fx-pip" data-family={f.family} data-media={!!media}>
      <div className="fx-pip__box" data-art={f.family}>
        {media ?? <Art f={f} t={t} run={run} />}
      </div>
      <div className="fx-pip__cap">
        <span className="fx-kicker">
          <L>
            {h.kicker}
            {h.clock ? <span className="fx-kicker__clock numeric"> · {h.clock}</span> : null}
          </L>
        </span>
        <L i={1} className="fx-pip__title">
          {h.title}
        </L>
        {fact && f.family !== 'comparison' && (
          <span className="fx-pip__fact" data-tone={fact.tone}>
            <L i={2}>
              <span className="fx-pip__label">{fact.label}</span> {f.family === 'breakthrough' ? <Measured text={fact.value} /> : fact.value}
            </L>
          </span>
        )}
      </div>
    </div>
  )
}

/** A full-height player card: the shirt in kit colours, the name, and the verified facts about this moment. */
function Spot({ f, t, run }: { f: Filled; t: GraphicTemplate; run: boolean }) {
  const p = spotlightSubject(f)
  const h = heading(f, t)
  if (!p) return null
  return (
    <div className="gx fx fx-spot" data-family={f.family} style={kitVars(p.kit)}>
      <div className="fx-spot__art">
        <span className="fx-spot__no numeric" aria-hidden="true">
          {p.number ?? ''}
        </span>
        <PlayerArt t={t} kit={p.kit} number={p.number} name={p.family} />
      </div>
      <div className="fx-spot__body">
        <span className="fx-kicker">
          <L>
            {p.role}
            {h.clock ? <span className="fx-kicker__clock numeric"> · {h.clock}</span> : null}
          </L>
        </span>
        <span className="fx-spot__name">
          {p.given && (
            <L i={1} className="fx-spot__given">
              {p.given}
            </L>
          )}
          <L i={2} className="fx-spot__family">
            {p.family}
          </L>
        </span>
        <span className="fx-spot__meta">
          <L i={3}>{[p.number != null ? `No. ${p.number}` : null, p.position, p.kit?.name].filter(Boolean).join(' · ')}</L>
        </span>
        {f.family === 'milestone' && f.hero ? (
          <span className="fx-spot__hero">
            <CountUp value={f.hero} run={run} />
          </span>
        ) : null}
        <Facts f={f} max={3} />
        <span className="fx-foot">{sourceLine(f)}</span>
      </div>
    </div>
  )
}

/** Full-screen analysis: the picture gives way to a board with the art large and the verified facts beside it. */
function Full({ f, t, run }: { f: Filled; t: GraphicTemplate; run: boolean }) {
  const h = heading(f, t)
  return (
    <div className="gx fx fx-full" data-family={f.family} data-kind={f.kind ?? undefined}>
      <span className="fx-full__wipe" aria-hidden="true" />
      <div className="fx-full__panel">
        <header className="fx-full__head">
          <span className="gx-notch" aria-hidden="true" />
          <span className="fx-full__titles">
            <span className="fx-kicker">
              <L>{h.kicker}</L>
            </span>
            <L i={1} className="fx-full__title">
              {h.title}
            </L>
          </span>
          {h.clock && (
            <L i={2} className="fx-full__clock numeric">
              {h.clock}
            </L>
          )}
        </header>
        <div className="fx-full__body">
          <div className="fx-full__art" data-art={f.family}>
            <Art f={f} t={t} run={run} />
          </div>
          <Facts f={f} max={f.family === 'comparison' ? 6 : 4} />
        </div>
        <footer className="fx-full__foot">{sourceLine(f)}</footer>
      </div>
    </div>
  )
}

export function Graphic({
  filled,
  template,
  phase = 'in',
  clip = false,
  format,
  media,
}: {
  filled: Filled
  template: GraphicTemplate
  phase?: Phase
  clip?: boolean
  /** The layout to draw; when absent or unavailable for this graphic, the template's default. */
  format?: FormatId | null
  /** A moving picture for the corner box (the animated tactical breakdown). */
  media?: ReactNode
}) {
  const run = phase === 'in'
  const fmt = frameFormat(filled, template, format, clip)
  const body = (() => {
    if (fmt === 'pip') return <Pip f={filled} t={template} media={media} run={run} />
    if (fmt === 'spotlight') return <Spot f={filled} t={template} run={run} />
    if (fmt === 'full' && filled.family !== 'comparison') return <Full f={filled} t={template} run={run} />
    switch (filled.family) {
      case 'spotlight':
        return <Spotlight f={filled} t={template} run={run} />
      case 'breakthrough':
        return <Breakthrough f={filled} t={template} clip={clip} />
      case 'milestone':
        return <Milestone f={filled} t={template} run={run} />
      case 'change':
        return <Change f={filled} t={template} />
      case 'comparison':
        return <Comparison f={filled} t={template} />
      case 'decision':
        return <Decision f={filled} t={template} />
      default:
        return <Story f={filled} />
    }
  })()
  return (
    <div className="gslot" data-family={filled.family} data-format={fmt} data-phase={phase} data-align={template.layout.align} data-kit={!!filled.team} style={kitVars(filled.team)}>
      {body}
    </div>
  )
}


// ---------------------------------------------------------------- frame

export interface BugData {
  home: Kit
  away: Kit
  score: { home: number; away: number; checking: boolean }
  clock: string
  /** An official VAR review is open (from the match state, never inferred). */
  varReview?: boolean
}

/** The score and clock bug in the template's style. */
export function ScoreBug({ bug, template }: { bug: BugData; template: GraphicTemplate }) {
  const code = (k: Kit) => k.code || k.short
  return (
    <div className="sbug" data-side={template.layout.bug} aria-hidden="true">
      <span className="sbug__team" style={kitVars(bug.home, 'side')}>
        <i />
        {code(bug.home)}
      </span>
      <span className="sbug__score numeric" data-checking={bug.score.checking}>
        {bug.score.home}
        <span>–</span>
        {bug.score.away}
      </span>
      <span className="sbug__team" data-away style={kitVars(bug.away, 'side')}>
        {code(bug.away)}
        <i />
      </span>
      <span className="sbug__clock numeric">{bug.clock}</span>
      {bug.varReview && <span className="sbug__var">VAR check</span>}
    </div>
  )
}

/** A still broadcast plate for the preview monitor: a floodlit wide shot of an empty pitch. */
export function StandInPlate() {
  return (
    <div className="plate" aria-hidden="true">
      <div className="plate__stand" />
      <div className="plate__boards" />
      <div className="plate__pitch">
        <svg viewBox="0 0 105 68" preserveAspectRatio="none">
          <g className="plate__lines">
            <rect x="0.4" y="0.4" width="104.2" height="67.2" />
            <path d="M52.5 0v68M0 13.84h16.5v40.32H0M105 13.84H88.5v40.32H105M0 24.84h5.5v18.32H0M105 24.84h-5.5v18.32H105" />
            <circle cx="52.5" cy="34" r="9.15" />
            <circle cx="52.5" cy="34" r="0.5" className="plate__spot" />
          </g>
        </svg>
      </div>
      <div className="plate__flare" />
    </div>
  )
}

export interface GraphicFrameProps {
  filled: Filled | null
  template: GraphicTemplate
  background?: ReactNode
  phase?: Phase
  /** A tactical clip plays under the plate: the plate drops its mini pitch. */
  clip?: boolean
  bug?: BugData | null
  /** Draw the action-safe and title-safe guides. */
  guides?: boolean
  /** The simulated-output mark in the frame. */
  mark?: boolean
  /** A slate over the picture (held, withdrawn). */
  slate?: ReactNode
  /** Remounts the graphic (replays its entry) when this changes. */
  graphicKey?: string
  /** The producer's layout for this graphic (lower third, corner box, player spotlight, full screen). */
  format?: FormatId | null
  /** A moving picture for the corner box (the animated tactical breakdown). */
  media?: ReactNode
}

/** A 16:9 broadcast frame: picture, graphic in the title-safe area, bug, simulated mark and safe-area guides. */
export function GraphicFrame({ filled, template, background, phase = 'in', clip = false, bug, guides = false, mark = false, slate, graphicKey, format, media }: GraphicFrameProps) {
  const fmt = filled ? frameFormat(filled, template, format, clip) : null
  return (
    <div
      className="gframe"
      data-template={template.id}
      data-family={filled?.family ?? 'none'}
      data-format={fmt ?? 'none'}
      data-full={fmt === 'full'}
      data-phase={filled ? phase : undefined}
      style={{ ...tplVars(template), '--fx-ms': `${fmt ? template.formats[fmt].ms : 460}ms` } as Vars}
    >
      <div className="gframe__bg">{background ?? <StandInPlate />}</div>
      {bug && <ScoreBug bug={bug} template={template} />}
      {filled && (
        <div className="gframe__safe" key={graphicKey}>
          <Graphic filled={filled} template={template} phase={phase} clip={clip} format={format} media={media} />
        </div>
      )}
      {mark && (
        <span className="gframe__mark" data-side={template.layout.bug === 'left' ? 'right' : 'left'} aria-hidden="true">
          Simulated output
        </span>
      )}
      {slate}
      {guides && (
        <span className="gframe__guides" aria-hidden="true">
          <i className="gframe__action" />
          <i className="gframe__title" />
          <i className="gframe__cross" />
        </span>
      )}
    </div>
  )
}
