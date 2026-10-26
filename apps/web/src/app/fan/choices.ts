import type { WorldIndex } from '../../services/matchView'
import type { MomentView, PassOption } from '../../services/schemas'

export interface Choice {
  id: string
  name: string
  played: boolean
  option: PassOption | null
}

export function openness(o: PassOption | null): string {
  if (!o) return 'We could not measure this lane.'
  const lane = o.lane_clearance_m
  const space = o.receiver_space_m
  const laneWords = lane < 1 ? 'an opponent was right in the way' : lane < 3 ? 'the lane was tight' : 'the lane was clear'
  const spaceWords = space < 2 ? 'with a marker tight' : space < 5 ? 'with a little room' : 'with plenty of room'
  return `${laneWords} (${lane.toFixed(1)} m), ${spaceWords} (${space.toFixed(1)} m).`
}

/** The real options on the frozen frame: the pass that was played and the measured alternatives, in a stable order. */
export function choicesFor(view: MomentView, world: WorldIndex): Choice[] {
  const w = view.whatif
  if (!w) return []
  const name = (id: string) => world.players.get(id)?.family_name ?? id
  const list: Choice[] = []
  if (w.actual.receiver_id) list.push({ id: w.actual.receiver_id, name: name(w.actual.receiver_id), played: true, option: w.actual.option })
  for (const alt of w.alternatives.slice(0, 2)) list.push({ id: alt.receiver_id, name: name(alt.receiver_id), played: false, option: alt })
  // stable, not alphabetical-by-answer: sort by shirt-independent name so the played option is not always first
  return list.sort((a, b) => a.name.localeCompare(b.name))
}

