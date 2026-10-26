import type { WorldIndex } from '../../services/matchView'

export type ResearchFocus =
  | { kind: 'stats' }
  | { kind: 'player'; id: string }
  | { kind: 'club'; id: string }
  | { kind: 'h2h' }
  | { kind: 'match' }

export interface Hit {
  key: string
  label: string
  hint: string
  focus: ResearchFocus
}

/** Everything a commentator can look up, matched on any word. */
export function searchHits(world: WorldIndex, query: string, limit = 8): Hit[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const hits: Hit[] = []
  for (const t of world.teams.values()) {
    const manager = (t as { manager?: { name?: string } }).manager?.name ?? ''
    if (`${t.name} ${t.short_name} ${t.code}`.toLowerCase().includes(q))
      hits.push({ key: `c-${t.team_id}`, label: t.name, hint: 'Club', focus: { kind: 'club', id: t.team_id } })
    if (manager && manager.toLowerCase().includes(q))
      hits.push({ key: `m-${t.team_id}`, label: manager, hint: `Manager, ${t.short_name}`, focus: { kind: 'club', id: t.team_id } })
  }
  for (const p of world.players.values()) {
    const name = `${p.given_name} ${p.family_name}`
    if (name.toLowerCase().includes(q) || String(p.shirt_number) === q)
      hits.push({
        key: p.player_id,
        label: name,
        hint: `${world.teams.get(p.team_id)?.short_name ?? p.team_id} · ${p.shirt_number} · ${p.position}`,
        focus: { kind: 'player', id: p.player_id },
      })
  }
  if ('head to head derby h2h meetings rivalry'.includes(q) || q.includes('h2h') || q.includes('derby'))
    hits.push({ key: 'h2h', label: 'Head to head', hint: 'Every meeting in the record', focus: { kind: 'h2h' } })
  if ('stadium venue referee officials ground'.includes(q) || /stad|ref|venue/.test(q))
    hits.push({ key: 'match', label: 'Venue and officials', hint: 'Stadium, referee, competition', focus: { kind: 'match' } })
  return hits.slice(0, limit)
}

