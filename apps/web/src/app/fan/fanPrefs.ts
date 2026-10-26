import { useSyncExternalStore } from 'react'

/** The fan's own choices (team, player, answered questions). Local to this browser only. */
export interface FanPrefs {
  /** The side the fan follows (and sees the match from), 'neutral', or null before choosing. */
  team: string | null
  player: string | null
  /** The player last followed on each side, so flipping sides and back keeps your player. */
  players: Record<string, string>
  answers: Record<string, string>
}

const KEY = 'byline.fan.v4'
let state: FanPrefs = load()
const listeners = new Set<() => void>()

function load(): FanPrefs {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(KEY) : null
    const parsed = raw ? (JSON.parse(raw) as Partial<FanPrefs>) : {}
    return { team: parsed.team ?? null, player: parsed.player ?? null, players: parsed.players ?? {}, answers: parsed.answers ?? {} }
  } catch {
    return { team: null, player: null, players: {}, answers: {} }
  }
}

function save(next: FanPrefs) {
  state = next
  try {
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    /* private mode: keep it in memory */
  }
  listeners.forEach((l) => l())
}

/** Player ids carry their team prefix (NBA-09), so a player belongs to a side without a lookup. */
const onSide = (player: string | null | undefined, team: string | null) => !!player && !!team && player.startsWith(`${team}-`)

export const fanPrefs = {
  get: () => state,
  setTeam: (team: string | null) => {
    const players = { ...state.players }
    if (state.team && state.player && onSide(state.player, state.team)) players[state.team] = state.player
    const remembered = team ? players[team] : undefined
    const player = remembered && onSide(remembered, team) ? remembered : onSide(state.player, team) ? state.player : null
    save({ ...state, team, player, players })
  },
  setPlayer: (player: string | null) => {
    const players = { ...state.players }
    if (player && state.team && onSide(player, state.team)) players[state.team] = player
    save({ ...state, player, players })
  },
  answer: (id: string, choice: string) => save({ ...state, answers: { ...state.answers, [id]: choice } }),
  reset: () => save({ team: null, player: null, players: {}, answers: {} }),
}

export function useFanPrefs(): FanPrefs {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => state,
    () => state,
  )
}
