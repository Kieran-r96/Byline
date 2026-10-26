import { useMemo, useState } from 'react'
import { Shirt } from '../../components/Formation/Shirt'
import { useDossier } from '../../services/dossier'
import type { PlayerDossier } from '../../services/dossier'
import type { SessionSnapshot } from '../../services/matchSession'
import { teamLineup } from '../../services/matchView'
import type { WorldIndex } from '../../services/matchView'
import { playerMarks } from '../../services/playerMarks'
import type { Player, Team } from '../../services/schemas'
import { roleWords } from './fanData'
import { fanPrefs } from './fanPrefs'


export function PlayerShirt({ p, team, size }: { p: Player; team: Team | undefined; size: number }) {
  const kit = team?.kit
  const gk = p.position === 'GK'
  return <Shirt number={p.shirt_number} fill={(gk ? kit?.goalkeeper : kit?.primary) ?? '#888'} trim={kit?.secondary ?? '#fff'} ink={gk ? '#14171a' : (kit?.number ?? '#fff')} size={size} />
}

/**
 * Your player, in one line: who, what they have done so far, and a way to change. Choosing is a compact list of
 * the side's current eleven (shirt and surname), shown once after you pick a side and on demand afterwards.
 */
export function PlayerPick({ world, snap, matchId, side, playerId, autoOpen, onPlayer }: { world: WorldIndex; snap: SessionSnapshot; matchId: string; side: string; playerId: string | null; /** First visit: show the list straight away. */ autoOpen: boolean; onPlayer: (id: string) => void }) {
  const [open, setOpen] = useState<boolean | null>(null)
  const team = world.teams.get(side)
  const player = playerId ? world.players.get(playerId) : undefined
  const marks = useMemo(() => playerMarks(snap.keyEvents), [snap.keyEvents])
  const dossier = useDossier<PlayerDossier>(player ? `/api/matches/${matchId}/dossier/players/${player.player_id}` : null, snap.state?.seq ?? 0)
  const xi = teamLineup(side, snap.state, snap.keyEvents)
    .slots.map((s) => (s.playerId ? world.players.get(s.playerId) : undefined))
    .filter((p): p is Player => !!p)
  const squad = xi.length ? xi : (team?.players.slice(0, 11) ?? [])
  const choosing = open ?? (!player && autoOpen)

  const m = player ? marks.get(player.player_id) : undefined
  const t = dossier.status === 'ready' ? dossier.data.this_match : null
  const line = t
    ? [m?.goals.length ? `${m.goals.length} goal${m.goals.length > 1 ? 's' : ''}` : null, t.minutes_on_pitch ? `${t.minutes_on_pitch} min` : t.role === 'bench' ? 'on the bench' : null, t.shots.total ? `${t.shots.total} shot${t.shots.total > 1 ? 's' : ''}` : null, t.passes.attempted ? `${t.passes.completed}/${t.passes.attempted} passes` : null]
        .filter(Boolean)
        .join(' · ')
    : ''

  return (
    <div className="pp">
      {player ? (
        <div className="you">
          <PlayerShirt p={player} team={team} size={34} />
          <div className="you__text">
            <p className="you__name">{player.family_name}</p>
            <p className="you__line">{line || `No. ${player.shirt_number} · ${roleWords(player)}`}</p>
          </div>
          <button type="button" className="chip-btn" onClick={() => onPlayer(player.player_id)}>
            Their story
          </button>
          <button type="button" className="chip-btn" aria-expanded={choosing} aria-controls="pp-list" onClick={() => setOpen(!choosing)}>
            Change
          </button>
        </div>
      ) : choosing ? (
        <p className="pp__ask">Follow a player</p>
      ) : (
        <button type="button" className="chip-btn pp__open" aria-expanded={false} aria-controls="pp-list" onClick={() => setOpen(true)}>
          Pick a player to follow
        </button>
      )}
      {choosing && (
        <div className="pp__panel" id="pp-list">
          <ul className="pp__list" aria-label={`${team?.short_name ?? 'Team'} players`}>
            {squad.map((p) => (
              <li key={p.player_id}>
                <button
                  type="button"
                  className="follow__pick"
                  aria-pressed={playerId === p.player_id}
                  onClick={() => {
                    fanPrefs.setPlayer(p.player_id)
                    setOpen(false)
                  }}
                >
                  <PlayerShirt p={p} team={team} size={24} />
                  <span>{p.family_name}</span>
                </button>
              </li>
            ))}
          </ul>
          {!player && (
            <button type="button" className="link-btn link-btn--quiet pp__skip" onClick={() => setOpen(false)}>
              Not now
            </button>
          )}
        </div>
      )}
    </div>
  )
}
