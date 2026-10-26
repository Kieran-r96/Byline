import type { Signal } from '../../services/schemas'

/**
 * Fan feed logic (pure). One focal moment leads; the rest is a short, varied stream where runs of routine
 * events fold into a single line and Did you know? is rationed, so a fan never scrolls similar cards.
 */

export type Filter = 'all' | 'play' | 'big' | 'dyk' | 'mine'
export const BIG = new Set(['goal', 'card', 'substitution', 'var', 'penalty'])
export const DYK = new Set(['context', 'record', 'milestone'])
export const DYK_LIMIT = 3
/** How many stream items show before "Show more". */
export const STREAM_FIRST = 5

export type FeedItem<T> =
  | { type: 'goal'; key: string; at: number; s: Signal }
  | { type: 'event'; key: string; at: number; s: Signal }
  | { type: 'run'; key: string; at: number; items: Signal[] }
  | { type: 'dyk'; key: string; at: number; s: Signal }
  | { type: 'play'; key: string; at: number; s: Signal; game: boolean }
  | { type: 'story'; key: string; at: number; team: string | null; story: T }

export interface StoryEntry<T> {
  key: string
  at: number
  team: string | null
  story: T
}

export interface FeedInput<T> {
  /** Fan signals, newest first. */
  signals: readonly Signal[]
  stories: readonly StoryEntry<T>[]
  filter: Filter
  /** The side the fan follows; null when neutral. "For you" shows that side's play moments. */
  side: string | null
  player: string | null
  /** Does this tactical signal carry a What would you do? frame? */
  isGame: (s: Signal) => boolean
}

const refsOf = (s: Signal) => s.refs as Record<string, unknown>

export function involves(s: Signal, pid: string): boolean {
  const r = refsOf(s)
  return r.player_id === pid || r.subject_id === pid || (Array.isArray(r.player_ids) && (r.player_ids as unknown[]).includes(pid))
}

function toItem<T>(s: Signal, isGame: (s: Signal) => boolean): FeedItem<T> {
  const base = { key: s.signal_id, at: s.at_ms, s }
  if (s.kind === 'goal') return { type: 'goal', ...base }
  if (BIG.has(s.kind)) return { type: 'event', ...base }
  if (DYK.has(s.kind)) return { type: 'dyk', ...base }
  return { type: 'play', ...base, game: isGame(s) }
}

/** The filtered feed, newest first. Did you know? is rationed to the newest three in "For you". */
export function feedItems<T>({ signals, stories, filter, side, player, isGame }: FeedInput<T>): FeedItem<T>[] {
  const firstDyk = new Set(signals.filter((s) => DYK.has(s.kind)).slice(0, DYK_LIMIT).map((s) => s.signal_id))
  const kept = signals.filter((s) => {
    if (filter === 'big') return BIG.has(s.kind)
    if (filter === 'play') return s.kind === 'tactical'
    if (filter === 'dyk') return DYK.has(s.kind)
    if (filter === 'mine') return !!player && involves(s, player)
    if (s.kind === 'storyline') return false
    if (DYK.has(s.kind)) return firstDyk.has(s.signal_id)
    // your side's play moments; the other side's wait behind "Play the moments"
    if (s.kind === 'tactical' && side && s.team_id && s.team_id !== side) return false
    return true
  })
  const items: FeedItem<T>[] = kept.map((s) => toItem<T>(s, isGame))
  if (filter === 'all' || filter === 'play') for (const st of stories) items.push({ type: 'story', ...st })
  return items.sort((a, b) => b.at - a.at || seqOf(b) - seqOf(a))
}

const seqOf = <T,>(i: FeedItem<T>) => ('s' in i ? i.s.seq : 0)

/** Recency bonus by importance: a goal stays the lead for a while; a play-along frame for a little less. */
const BONUS_MS = { goal: 8 * 60_000, game: 4 * 60_000, other: 0 }

/** The one moment that leads the screen: a goal, a play-along frame, a measured moment or a verified story. */
export function pickFocal<T>(items: readonly FeedItem<T>[]): FeedItem<T> | null {
  let best: FeedItem<T> | null = null
  let bestScore = -Infinity
  for (const it of items) {
    if (it.type !== 'goal' && it.type !== 'play' && it.type !== 'story') continue
    if (it.type === 'goal' && it.s.status === 'withdrawn') continue
    const bonus = it.type === 'goal' ? BONUS_MS.goal : it.type === 'play' && it.game ? BONUS_MS.game : BONUS_MS.other
    const score = it.at + bonus
    if (score > bestScore) {
      best = it
      bestScore = score
    }
  }
  return best
}

/** Fold two or more consecutive cards / changes / VAR checks into one line. */
export function groupRuns<T>(items: readonly FeedItem<T>[]): FeedItem<T>[] {
  const out: FeedItem<T>[] = []
  let run: Signal[] = []
  const flush = () => {
    const head = run[0]
    if (head && run.length === 1) out.push({ type: 'event', key: head.signal_id, at: head.at_ms, s: head })
    else if (head) out.push({ type: 'run', key: `run-${head.signal_id}`, at: head.at_ms, items: run })
    run = []
  }
  for (const it of items) {
    if (it.type === 'event') run.push(it.s)
    else {
      flush()
      out.push(it)
    }
  }
  flush()
  return out
}

/** The collapsed stream: the first few items, plus every goal and verified story (never hidden behind More). */
export function collapsed<T>(stream: readonly FeedItem<T>[], first = STREAM_FIRST): FeedItem<T>[] {
  return stream.filter((it, i) => i < first || it.type === 'goal' || it.type === 'story')
}

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : `${n} ${many}`
}

export function isRed(s: Signal): boolean {
  return s.kind === 'card' && /red|sent off|second/i.test(s.headline)
}

/** "2 changes and a booking" — what a folded run holds, in plain words. */
export function runSummary(items: readonly Signal[]): string {
  const subs = items.filter((s) => s.kind === 'substitution').length
  const reds = items.filter(isRed).length
  const yellows = items.filter((s) => s.kind === 'card' && !isRed(s)).length
  const vars = items.filter((s) => s.kind === 'var').length
  const pens = items.filter((s) => s.kind === 'penalty').length
  const parts = [
    subs ? plural(subs, 'a change', 'changes') : null,
    yellows ? plural(yellows, 'a booking', 'bookings') : null,
    reds ? plural(reds, 'a sending-off', 'sendings-off') : null,
    vars ? plural(vars, 'a VAR check', 'VAR checks') : null,
    pens ? plural(pens, 'a penalty', 'penalties') : null,
  ].filter((p): p is string => !!p)
  const text = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : (parts[0] ?? '')
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/** "64'–70'" for a run (items are newest first). */
export function runClock(items: readonly Signal[]): string {
  const first = items[items.length - 1]?.display_clock ?? ''
  const last = items[0]?.display_clock ?? ''
  return first === last ? first : `${first}–${last}`
}
