import { describe, expect, it } from 'vitest'
import { VIEW_LINE_BREAK } from '../test/stageFixtures'
import { MomentViewSchema } from './schemas'
import type { MomentView } from './schemas'
import { findCarrier } from './stageModel'

const base = MomentViewSchema.parse(VIEW_LINE_BREAK)
const passer = base.arrows.find((a) => a.player_id)!.player_id!

/** The same moment with the tracked ball moved: as if the event were stamped before the ball arrived. */
function withBall(view: MomentView, ball: [number, number]): MomentView {
  return { ...view, ball }
}

describe('findCarrier: who is labelled "on the ball"', () => {
  it('names the passer of the official event when the tracking frame has the ball at his feet', () => {
    expect(findCarrier(base)).toBe(passer)
    const me = base.players.find((p) => p.pid === passer)!
    expect(Math.hypot(me.x - base.ball![0], me.y - base.ball![1])).toBeLessThanOrEqual(2)
  })

  it('names nobody when the tracked ball is with an opponent, never the wrong player', () => {
    const opp = base.players.find((p) => p.team_id !== base.team_id && !p.gk)!
    const arrow = base.arrows.find((a) => a.player_id === passer)!
    // the event still starts at the passer, but the tracked ball sits on an opponent 3 m away from him
    const me = base.players.find((p) => p.pid === passer)!
    const moved: MomentView = {
      ...withBall(base, [me.x + 2.5, me.y + 1.5]),
      players: base.players.map((p) => (p.pid === opp.pid ? { ...p, x: me.x + 2.6, y: me.y + 1.6 } : p)),
      arrows: [{ ...arrow, from: [me.x + 2.5, me.y + 1.5] }],
    }
    expect(findCarrier(moved)).toBeNull()
  })
})
