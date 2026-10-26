import { useMemo } from 'react'
import type { CSSProperties } from 'react'
import { playerMarks } from '../../services/playerMarks'
import type { PlayerMarks } from '../../services/playerMarks'
import { teamLineup } from '../../services/matchView'
import type { WorldIndex } from '../../services/matchView'
import type { MatchEvent, MatchState, Player } from '../../services/schemas'
import type { TeamId } from '../../types/shell'
import { Crest } from '../brand/Crest'
import { BallGlyph } from '../glyphs/Glyph'
import { Shirt } from './Shirt'
import './ShirtPitch.css'

/** Where each slot sits on a vertical pitch (attacking upward), percent of width and height. */
const SLOT_POS: Record<string, [number, number]> = {
  GK: [50, 90],
  RB: [85, 70],
  RCB: [62, 76],
  CB: [50, 76],
  LCB: [38, 76],
  LB: [15, 70],
  RWB: [87, 58],
  LWB: [13, 58],
  DM: [50, 58],
  RDM: [65, 57],
  LDM: [35, 57],
  RCM: [71, 44],
  CM: [50, 44],
  LCM: [29, 44],
  RM: [85, 42],
  LM: [15, 42],
  CAM: [50, 36],
  RW: [82, 22],
  LW: [18, 22],
  RF: [63, 16],
  LF: [37, 16],
  ST: [50, 13],
  CF: [50, 13],
}

function slotPos(slot: string, formation: string, index: number): [number, number] {
  // a 4-2-3-1's wide men sit in the attacking-midfield line, deeper than a 4-3-3's wingers
  if (formation === '4-2-3-1' && (slot === 'RW' || slot === 'LW')) return [slot === 'RW' ? 82 : 18, 33]
  return SLOT_POS[slot] ?? [15 + ((index * 23) % 70), 30 + ((index * 17) % 40)]
}

function luminance(hex: string): number {
  const n = hex.replace('#', '')
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16) / 255)
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
}

function kitFor(world: WorldIndex, p: Player): { fill: string; trim: string; ink: string } {
  const kit = world.teams.get(p.team_id)?.kit
  const gk = p.position === 'GK'
  const fill = (gk ? kit?.goalkeeper : kit?.primary) ?? '#55606a'
  const ink = gk ? (luminance(fill) > 0.5 ? '#14171a' : '#f4f1ea') : (kit?.number ?? '#ffffff')
  return { fill, trim: kit?.secondary ?? '#ffffff', ink }
}

/** Spoken after the visible surname, so the button's name starts with what is on screen. */
function describe(p: Player, slot: string | null, m: PlayerMarks | undefined): string {
  const bits = [`, ${p.given_name} ${p.family_name}, number ${p.shirt_number}`, slot ?? p.position]
  if (m?.goals.length) bits.push(`${m.goals.length === 1 ? 'goal' : `${m.goals.length} goals`} ${m.goals.join(', ')}`)
  if (m?.red) bits.push(`sent off ${m.red}`)
  else if (m?.yellow) bits.push(`booked ${m.yellow}`)
  if (m?.on) bits.push(`came on ${m.on}`)
  if (m?.off) bits.push(`went off ${m.off}`)
  return `${bits.join(', ')}. Open the player file`
}

function Marks({ m }: { m: PlayerMarks | undefined }) {
  if (!m) return null
  return (
    <span className="sp__marks" aria-hidden="true">
      {m.goals.map((_, i) => (
        <BallGlyph key={i} size={14} className="sp__ball" />
      ))}
      {(m.red || m.yellow) && <span className="sp__card" data-red={!!m.red} />}
      {m.on && <span className="sp__on">▲</span>}
    </span>
  )
}

export interface ShirtPitchProps {
  world: WorldIndex
  state: MatchState | null
  keyEvents: readonly MatchEvent[]
  team: TeamId
  onTeam: (team: TeamId) => void
  onPlayer: (playerId: string) => void
  onClub: (team: TeamId) => void
  selected?: string | null
}

/**
 * The starting XI as shirts on a pitch: the primary way to browse a team. Tap a shirt for the player file,
 * the crest for the club file. Substitutes and players who have gone off sit alongside as the bench.
 */
export function ShirtPitch({ world, state, keyEvents, team, onTeam, onPlayer, onClub, selected }: ShirtPitchProps) {
  const t = world.teams.get(team)
  const lineup = useMemo(() => teamLineup(team, state, keyEvents), [team, state, keyEvents])
  const marks = useMemo(() => playerMarks(keyEvents), [keyEvents])
  const onIds = new Set(lineup.slots.map((s) => s.playerId).filter(Boolean) as string[])
  const squad = t?.players ?? []
  const off = squad.filter((p) => !onIds.has(p.player_id) && (marks.get(p.player_id)?.off || marks.get(p.player_id)?.red))
  const bench = squad.filter((p) => !onIds.has(p.player_id) && !off.includes(p))
  const manager = (t as { manager?: { name?: string } } | undefined)?.manager?.name
  const down = state?.teams[team]?.sent_off.length ?? 0

  const shirtButton = (p: Player, slot: string | null, small = false) => {
    const k = kitFor(world, p)
    const m = marks.get(p.player_id)
    return (
      <button
        type="button"
        className="sp__player"
        data-small={small}
        aria-pressed={selected === p.player_id}
        data-off={!!(m?.off || m?.red) && !onIds.has(p.player_id)}
        onClick={() => onPlayer(p.player_id)}
      >
        <span className="sp__shirt">
          <Shirt number={p.shirt_number} fill={k.fill} trim={k.trim} ink={k.ink} size={small ? 34 : 50} />
          <Marks m={m} />
        </span>
        <span className="sp__name">{p.family_name}</span>
        <span className="sr-only">{describe(p, slot, m)}</span>
      </button>
    )
  }

  return (
    <section className="sp" data-theme="night" aria-label={`${t?.name ?? team} line-up`} style={{ '--kit': t?.kit.primary ?? '#888' } as CSSProperties}>
      <div className="sp__switch" role="radiogroup" aria-label="Club">
        {[world.homeId, world.awayId].map((id) => {
          const tm = world.teams.get(id)
          return (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={team === id}
              className="sp__club"
              style={{ '--kit': tm?.kit.primary ?? '#888' } as CSSProperties}
              onClick={() => onTeam(id as TeamId)}
            >
              <Crest teamId={id as TeamId} size={28} label="" />
              <span>{tm?.short_name ?? id}</span>
            </button>
          )
        })}
      </div>

      <div className="sp__meta">
        <button type="button" className="sp__clubfile" onClick={() => onClub(team)}>
          <Crest teamId={team} size={22} label="" />
          {t?.name ?? team}
          <span className="sr-only">, open the club file</span>
        </button>
        <span className="sp__shape">
          <span className="numeric">{lineup.formation || t?.formation}</span>
          {down > 0 && <span className="sp__down">{11 - down} players</span>}
          {manager && <span>· {manager}</span>}
        </span>
      </div>

      <div className="sp__pitch">
        <svg className="sp__lines" viewBox="0 0 68 105" preserveAspectRatio="none" aria-hidden="true">
          <rect x="1" y="1" width="66" height="103" rx="0.6" />
          <path d="M1 52.5h66" />
          <circle cx="34" cy="52.5" r="9.15" />
          <rect x="13.85" y="1" width="40.3" height="16.5" />
          <rect x="24.85" y="1" width="18.3" height="5.5" />
          <rect x="13.85" y="87.5" width="40.3" height="16.5" />
          <rect x="24.85" y="98.5" width="18.3" height="5.5" />
          <path d="M26.7 17.5a9.15 9.15 0 0 0 14.6 0M26.7 87.5a9.15 9.15 0 0 1 14.6 0" />
        </svg>
        {lineup.slots.length === 0 ? (
          <p className="sp__empty">Line-ups are confirmed shortly before kick-off.</p>
        ) : (
          <ol className="sp__xi" key={team}>
            {lineup.slots.map((s, i) => {
              const [x, y] = slotPos(s.slot, lineup.formation, i)
              const style = { left: `${x}%`, top: `${y}%`, '--i': i } as CSSProperties
              const p = s.playerId ? world.players.get(s.playerId) : undefined
              if (!p) {
                const gone = s.sentOffId ? world.players.get(s.sentOffId) : undefined
                return (
                  <li key={s.slot} className="sp__slot sp__slot--empty" style={style}>
                    <span className="sp__gap" aria-hidden="true" />
                    <span className="sp__name">{gone ? `${gone.family_name} sent off` : 'Sent off'}</span>
                  </li>
                )
              }
              return (
                <li key={s.slot} className="sp__slot" style={style} data-sub={s.subOn}>
                  {shirtButton(p, s.slot)}
                </li>
              )
            })}
          </ol>
        )}
        <span className="sp__dir" aria-hidden="true">
          Attacking
        </span>
      </div>

      <div className="sp__bench">
        <h3 className="sp__bench-title">Bench</h3>
        <ul className="sp__bench-list">
          {bench.map((p) => (
            <li key={p.player_id}>{shirtButton(p, null, true)}</li>
          ))}
        </ul>
        {off.length > 0 && (
          <>
            <h3 className="sp__bench-title">Off the pitch</h3>
            <ul className="sp__bench-list">
              {off.map((p) => (
                <li key={p.player_id}>{shirtButton(p, null, true)}</li>
              ))}
            </ul>
          </>
        )}
      </div>
    </section>
  )
}
