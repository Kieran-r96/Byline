import { useSyncExternalStore } from 'react'
import type { MatchSessionStore } from '../services/matchSession'
import type { SessionSnapshot } from '../services/matchSession'
import { matchClock, periodLabel, scoreDisplay } from '../services/matchView'
import type { WorldIndex } from '../services/matchView'
import type { ScoreBugData, TeamId } from '../types/shell'

export function asTeam(id: string): TeamId {
  return id === 'RVC' ? 'RVC' : 'NBA'
}

export function scoreBugData(snap: SessionSnapshot, world: WorldIndex, playheadMs: number): ScoreBugData {
  const sc = scoreDisplay(snap.state, world.homeId, world.awayId)
  const home = world.teams.get(world.homeId)
  const away = world.teams.get(world.awayId)
  return {
    home: { teamId: asTeam(world.homeId), shortName: home?.code ?? world.homeId, name: home?.name ?? 'Home', score: sc.home },
    away: { teamId: asTeam(world.awayId), shortName: away?.code ?? world.awayId, name: away?.name ?? 'Away', score: sc.away },
    clock: matchClock(playheadMs, snap.detail, snap.state),
    period: periodLabel(snap.state?.period),
    checking: sc.checking,
    varReview: sc.varReview,
    provisionalSide: sc.provisionalSide,
  }
}

/** Re-render a few times a second with the extrapolated playhead (seconds). */
export function usePlayheadSeconds(store: MatchSessionStore): number {
  return useSyncExternalStore(
    (cb) => {
      const id = setInterval(cb, 200)
      return () => clearInterval(id)
    },
    () => Math.floor(store.playhead() / 1000),
    () => 0,
  )
}
