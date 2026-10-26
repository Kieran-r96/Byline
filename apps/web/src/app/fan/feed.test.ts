import { describe, expect, it } from 'vitest'
import type { Signal } from '../../services/schemas'
import { collapsed, feedItems, groupRuns, pickFocal, runClock, runSummary } from './feed'
import type { FeedItem } from './feed'

let seq = 0
function sig(kind: string, minute: number, extra: Partial<Signal> = {}): Signal {
  seq += 1
  return {
    signal_id: `S-${kind}-${minute}-${seq}`,
    kind,
    tier: 'insight',
    team_id: 'NBA',
    at_ms: minute * 60_000,
    seq,
    display_clock: `${minute}'`,
    headline: kind.toUpperCase(),
    text: { fan: `${kind} at ${minute}` },
    audiences: ['fan'],
    refs: {},
    evidence_event_ids: [],
    status: 'live',
    version: 1,
    folded: 0,
    actions: [],
    ...extra,
  } as Signal
}

const newestFirst = (xs: Signal[]) => [...xs].sort((a, b) => b.at_ms - a.at_ms)
const notGame = () => false

describe('fan feed', () => {
  it('leads with a goal for a while, then with the newer play-along frame', () => {
    const wyd = sig('tactical', 7, { refs: { moment_id: 'T-7' } })
    const goal = sig('goal', 28)
    const press = sig('tactical', 30, { refs: { moment_id: 'T-30' } })
    const items = feedItems({ signals: newestFirst([wyd, goal, press]), stories: [], filter: 'all', side: 'NBA', player: null, isGame: (s) => s === wyd })
    expect(pickFocal(items)?.key).toBe(goal.signal_id)
    const later = sig('tactical', 41, { refs: { moment_id: 'T-41' } })
    const items2 = feedItems({ signals: newestFirst([wyd, goal, press, later]), stories: [], filter: 'all', side: 'NBA', player: null, isGame: (s) => s === later })
    expect(pickFocal(items2)?.key).toBe(later.signal_id)
  })

  it('never leads with routine events or facts', () => {
    const items = feedItems({ signals: newestFirst([sig('card', 42), sig('record', 43)]), stories: [], filter: 'all', side: null, player: null, isGame: notGame })
    expect(pickFocal(items)).toBeNull()
  })

  it('rations Did you know? to three in For you, but not under its own filter', () => {
    const facts = [1, 2, 3, 4, 5].map((m) => sig('record', m))
    const all = feedItems({ signals: newestFirst(facts), stories: [], filter: 'all', side: null, player: null, isGame: notGame })
    expect(all).toHaveLength(3)
    expect(all.map((i) => i.at)).toEqual([5, 4, 3].map((m) => m * 60_000))
    const dyk = feedItems({ signals: newestFirst(facts), stories: [], filter: 'dyk', side: null, player: null, isGame: notGame })
    expect(dyk).toHaveLength(5)
  })

  it('For you keeps your side’s play moments; the other side’s wait under Play the moments', () => {
    const mine = sig('tactical', 20, { team_id: 'NBA' })
    const theirs = sig('tactical', 39, { team_id: 'RVC' })
    const goal = sig('goal', 51, { team_id: 'RVC' })
    const forYou = feedItems({ signals: newestFirst([mine, theirs, goal]), stories: [], filter: 'all', side: 'NBA', player: null, isGame: notGame })
    expect(forYou.map((i) => i.key)).toEqual([goal.signal_id, mine.signal_id])
    const flipped = feedItems({ signals: newestFirst([mine, theirs, goal]), stories: [], filter: 'all', side: 'RVC', player: null, isGame: notGame })
    expect(flipped.map((i) => i.key)).toEqual([goal.signal_id, theirs.signal_id])
    const play = feedItems({ signals: newestFirst([mine, theirs, goal]), stories: [], filter: 'play', side: 'NBA', player: null, isGame: notGame })
    expect(play).toHaveLength(2)
  })

  it('folds consecutive cards and changes into one line and keeps a lone one as a line', () => {
    const a = sig('substitution', 70)
    const b = sig('substitution', 70)
    const c = sig('card', 64, { headline: 'SECOND YELLOW · SENT OFF · G. Ndiaye-Shaw' })
    const goal = sig('goal', 51)
    const d = sig('card', 42, { headline: 'YELLOW CARD · G. Ndiaye-Shaw' })
    const items = feedItems({ signals: newestFirst([a, b, c, goal, d]), stories: [], filter: 'all', side: null, player: null, isGame: notGame })
    const grouped = groupRuns(items)
    expect(grouped.map((i) => i.type)).toEqual(['run', 'goal', 'event'])
    const run = grouped[0] as Extract<FeedItem<unknown>, { type: 'run' }>
    expect(run.items).toHaveLength(3)
    expect(runSummary(run.items)).toBe('2 changes and a sending-off')
    expect(runClock(run.items)).toBe("64'–70'")
    expect(runSummary([d])).toBe('A booking')
  })
})

describe('collapsed stream', () => {
  it('shows the first few and never hides a goal or a verified story behind More', () => {
    const rows = [1, 2, 3, 4, 5, 6, 7].map((m) => ({ type: 'event' as const, key: `e${m}`, at: m, s: sig('card', m) }))
    const goal = { type: 'goal' as const, key: 'g', at: 0, s: sig('goal', 0) }
    const story = { type: 'story' as const, key: 'st', at: 0, team: null, story: {} }
    const out = collapsed<unknown>([...rows, goal, story], 5)
    expect(out.map((i) => i.key)).toEqual(['e1', 'e2', 'e3', 'e4', 'e5', 'g', 'st'])
  })
})
