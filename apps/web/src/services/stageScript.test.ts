import { describe, expect, it } from 'vitest'
import { DETAIL, VIEW_LINE_BREAK, VIEW_OPTION, VIEW_OPTION_ILL, VIEW_OVERLOAD, VIEW_PRESS, VIEW_SHAPE_CHANGE, VIEW_STRETCHED } from '../test/stageFixtures'
import { indexWorld } from './matchView'
import { MatchDetailSchema, MomentViewSchema } from './schemas'
import type { MomentView } from './schemas'
import { buildStageModel, convexHull } from './stageModel'
import { arrowCount, buildChoice, buildScript, IMAGINED_LAYERS, MAX_NAMES, namedIds, STEP_MIN_MS, stepHierarchy } from './stageScript'
import type { StageStep } from './stageScript'

const world = indexWorld(MatchDetailSchema.parse(DETAIL))
const parse = (v: unknown): MomentView => MomentViewSchema.parse(v)
const option = parse(VIEW_OPTION)
const ill = parse(VIEW_OPTION_ILL)
const press = parse(VIEW_PRESS)
const lineBreak = parse(VIEW_LINE_BREAK)
const overload = parse(VIEW_OVERLOAD)
const shape = parse(VIEW_SHAPE_CHANGE)
const stretched = parse(VIEW_STRETCHED)
const ALL = [option, ill, press, lineBreak, overload, shape, stretched]
/** The real 7' payload plus a shot window and a cross for the hypothetical receiver (synthetic, for the model). */
const LABEL = VIEW_OPTION.whatif.continuations[0]!.label
const withAll = parse({
  ...VIEW_OPTION,
  whatif: {
    ...VIEW_OPTION.whatif,
    continuations: [
      {
        kind: 'shot', from_id: 'NBA-11', from: [73.1, 7.4], label: LABEL,
        shot: { goal_centre: [105, 34], posts: [[105, 30.34], [105, 37.66]], distance_m: 18.0, angle_deg: 22.9, defenders_in_triangle: ['RVC-04'], goalkeeper_id: 'RVC-01', goalkeeper: [100.7, 34.9], goalkeeper_in_triangle: true },
      },
      {
        kind: 'cross', from_id: 'NBA-11', from: [73.1, 7.4], label: LABEL,
        cross: { channel: 'left', targets: [{ pid: 'NBA-09', x: 75.3, y: 36.5, nearest_marker_id: 'RVC-06', marker_distance_m: 4.1 }], offside_ids: [] },
      },
      ...VIEW_OPTION.whatif.continuations,
      { ...VIEW_OPTION.whatif.continuations[0]!, pass: { ...VIEW_OPTION.whatif.continuations[0]!.pass, receiver_id: 'NBA-10', rank: 2 } },
    ],
  },
})

/** Every number the view carries, at the precisions captions may print it (as given, 1 dp, whole). */
function allowedNumbers(view: MomentView): Set<string> {
  const out = new Set<string>()
  const add = (n: number) => {
    out.add(String(n))
    out.add((Math.round(n * 10) / 10).toFixed(1))
    out.add(String(Math.round(n)))
    out.add(String(Math.abs(n)))
  }
  const walk = (v: unknown) => {
    if (typeof v === 'number') add(v)
    else if (typeof v === 'string') for (const m of v.match(/\d+(?:\.\d+)?/g) ?? []) add(Number(m))
    else if (Array.isArray(v)) v.forEach(walk)
    else if (v && typeof v === 'object') Object.values(v).forEach(walk)
  }
  walk(view)
  // measured from the view's own lines: the back-to-midfield gap
  if (view.lines) add(Math.abs(view.lines.back_x - view.lines.mid_x))
  // counted from the frozen frame (players between the lines, opponents in the lane)
  for (let i = 0; i <= 11; i += 1) add(i)
  return out
}

const text = (s: StageStep) => [s.title, s.caption, ...s.notes, s.takeaway ?? ''].join(' ')

describe('buildScript: step structure', () => {
  it('an option moment gets seven steps, one idea each: what happened apart from the hypothetical and the simulated continuation', () => {
    const steps = buildScript(option, world, 'pro')
    expect(steps.map((s) => s.id)).toEqual(['freeze', 'situation', 'happened', 'measured', 'hypothetical', 'continuation', 'takeaway'])
    expect(steps.map((s) => s.n)).toEqual([1, 2, 3, 4, 5, 6, 7])
    const hypo = steps[4]!
    expect(hypo.banner).toBe('Hypothetical · not what happened')
    expect(hypo.caption).toMatch(/^Hypothetical, not what happened/)
    expect(hypo.layers).toContain('hypothetical')
    // the hypothetical is drawn only on its own step (the continuation keeps it as dimmed context)
    for (const s of steps) if (s.id !== 'hypothetical' && s.id !== 'continuation') expect([...s.layers, ...s.dim]).not.toContain('hypothetical')
    expect(steps[5]!.dim).toEqual(['hypothetical'])
  })

  it('never shows the real pass and a hypothetical, simulated or illustrative action together, and never more than three arrows', () => {
    for (const v of [...ALL, withAll]) {
      const m = buildStageModel(v, world, 'pro')
      for (const aud of ['pro', 'fan'] as const) {
        for (const s of buildScript(v, world, aud)) {
          const on = new Set([...s.layers, ...s.dim])
          if (on.has('actualPass')) for (const l of IMAGINED_LAYERS) expect(on.has(l), `${v.moment_id} ${s.id} ${l}`).toBe(false)
          expect(arrowCount(s, m), `${v.moment_id} ${s.id}`).toBeLessThanOrEqual(3)
          // names only for the 2-4 players the step is about, never a roll call
          expect(namedIds(s, m.carrierId).length, `${v.moment_id} ${s.id}`).toBeLessThanOrEqual(MAX_NAMES)
        }
      }
    }
  })

  it('moments without a What If? skip the hypothetical step', () => {
    for (const v of [press, lineBreak, overload, shape, stretched]) {
      const ids = buildScript(v, world, 'pro').map((s) => s.id)
      expect(ids).toEqual(['freeze', 'situation', 'measured', 'takeaway'])
    }
  })

  it('a press shows lines and shape, not passes', () => {
    const steps = buildScript(press, world, 'pro')
    const layers = new Set(steps.flatMap((s) => s.layers))
    expect(layers.has('shape')).toBe(true)
    expect(layers.has('lines')).toBe(true)
    expect(layers.has('actualPass')).toBe(false)
    expect(layers.has('alternatives')).toBe(false)
  })

  it("shape changes outline the subject team, never the other side's lines as theirs", () => {
    for (const v of [shape, stretched]) {
      const m = buildStageModel(v, world, 'pro')
      expect(m.lines).toBeNull()
      expect(m.hull?.teamId).toBe(v.team_id)
      expect(new Set(buildScript(v, world, 'pro').flatMap((s) => s.layers)).has('lines')).toBe(false)
    }
  })

  it('step 3 shows only what happened; step 4 the measured lanes beside the dimmed real pass', () => {
    const [, , happened, measured] = buildScript(option, world, 'pro')
    expect(happened!.layers).toEqual(['carrier', 'laneOpponents', 'actualPass'])
    expect(happened!.caption).toContain('N. Vantreight')
    expect(happened!.caption).toContain('0.3 m')
    expect(happened!.caption).toContain('intercepted by')
    expect(measured!.layers).toContain('alternatives')
    expect(measured!.dim).toEqual(['actualPass'])
    expect(measured!.caption).toContain('S. Haddad-Rhys 3.3 m clear (open)')
  })

  it('the continuation step is labelled simulated and built only from the payload numbers', () => {
    for (const aud of ['pro', 'fan'] as const) {
      const s = buildScript(option, world, aud).find((x) => x.id === 'continuation')!
      expect(s.title).toBe('Then?')
      expect(s.banner).toBe('Simulated · not what happened · no outcome implied')
      expect(s.layers).toEqual(['contFrom', 'contPass'])
      expect(s.caption).toMatch(/^Simulated/)
      expect(s.caption).toContain('N. Vantreight')
      for (const re of [/would/i, /chance/i, /%/, /xg/i, /certain/i, /goal!/i]) expect(s.caption).not.toMatch(re)
    }
    const pro = buildScript(option, world, 'pro').find((x) => x.id === 'continuation')!
    expect(pro.caption).toContain('lane 7.2 m clear, space 2.7 m (contested)')
    expect(pro.notes[0]).toMatch(/^Simulated continuation: .*Not what happened/)
    const fan = buildScript(option, world, 'fan').find((x) => x.id === 'continuation')!
    expect(fan.caption).toContain('a clear lane, with G. Ndiaye-Shaw 3 m away')
  })

  it('a shot window and a cross are drawn when the payload has them, with fewer passes to stay within three arrows', () => {
    const m = buildStageModel(withAll, world, 'pro')
    expect(m.continuation?.shot?.chip).toBe('Shot window · 18.0 m · 22.9°')
    expect(m.continuation?.cross?.targets.map((t) => t.pid)).toEqual(['NBA-09'])
    expect(m.continuation?.passes).toHaveLength(1)
    const s = buildScript(withAll, world, 'pro').find((x) => x.id === 'continuation')!
    expect(s.layers).toEqual(['contFrom', 'contPass', 'contShot', 'contCross'])
    expect(s.caption).toContain('Shooting window: 18.0 m to the centre of the goal, goal mouth 22.9° wide')
    expect(s.caption).toContain('Crossing option from the left channel: N. Vantreight (nearest marker 4.1 m) in the box')
  })

  it('no continuation step when the payload has none for the hypothetical receiver', () => {
    const none = parse({ ...VIEW_OPTION, whatif: { ...VIEW_OPTION.whatif, continuations: [] } })
    expect(buildScript(none, world, 'pro').map((s) => s.id)).not.toContain('continuation')
    const old = { ...VIEW_OPTION.whatif } as Record<string, unknown>
    delete old.continuations
    expect(parse({ ...VIEW_OPTION, whatif: old }).whatif?.continuations).toEqual([])
  })

  it('drops a malformed continuation item without losing the view or the others', () => {
    const v = parse({ ...VIEW_OPTION, whatif: { ...VIEW_OPTION.whatif, continuations: [{ kind: 'pass', from_id: 'NBA-11' }, ...VIEW_OPTION.whatif.continuations] } })
    expect(v.whatif?.continuations).toHaveLength(VIEW_OPTION.whatif.continuations.length)
  })

  it('window moments plate their observed values verbatim on the measured step (pro only)', () => {
    const pro = buildScript(shape, world, 'pro').find((s) => s.id === 'measured')!
    expect(pro.stats).toEqual([
      { label: 'Back-line height change', value: '-8.8 m' },
      { label: 'Team length change', value: '-9.5 m' },
      { label: 'Team width change', value: '-9.5 m' },
    ])
    expect(buildScript(shape, world, 'fan').every((s) => s.stats.length === 0)).toBe(true)
    // the option moment names its numbers on the pitch instead
    expect(buildScript(option, world, 'pro').every((s) => s.stats.length === 0)).toBe(true)
  })

  it('the last step carries the unknowns and no outcome', () => {
    const last = buildScript(option, world, 'pro').at(-1)!
    expect(last.id).toBe('takeaway')
    expect(last.notes).toEqual(option.unknowns)
    expect(last.caption).toBe(option.interpretation)
    expect(last.takeaway).toBe(option.plain)
  })

  it('every step has a camera and a sane duration', () => {
    for (const v of ALL) {
      for (const s of buildScript(v, world, 'fan')) {
        expect(s.camera.distance).toBeGreaterThan(40)
        expect(s.camera.polar).toBeGreaterThan(20)
        expect(s.camera.fit.length).toBeGreaterThan(0)
        expect(s.durationMs).toBeGreaterThanOrEqual(STEP_MIN_MS)
      }
    }
  })
})

describe('buildScript: the illustrative continuation (ADR 10)', () => {
  it('replaces the frozen continuation with two labelled illustrative steps: the run and response, then the ball in', () => {
    for (const aud of ['pro', 'fan'] as const) {
      const steps = buildScript(ill, world, aud)
      expect(steps.map((s) => s.id)).toEqual(['freeze', 'situation', 'happened', 'measured', 'hypothetical', 'illustrative', 'illustrativeBall', 'takeaway'])
      const [run, ball] = [steps[5]!, steps[6]!]
      for (const s of [run, ball]) {
        expect(s.banner).toBe('Illustrative · not what happened · no outcome implied')
        expect(s.caption).toMatch(/^Illustrative/)
        for (const re of [/would/i, /chance/i, /%/, /xg/i, /certain/i, /goal!/i, /\bscore/i, /predict/i]) expect(s.caption, `${aud} ${s.id}`).not.toMatch(re)
      }
      expect(run.layers).toEqual(['illFrom', 'illRun', 'illDefend'])
      expect(ball.layers).toEqual(['illFrom', 'illGhosts', 'illBall', 'illContest'])
      expect(run.caption).toContain('N. Vantreight')
      expect(run.caption).toContain('I. Tremaine')
      expect(run.caption).toContain('G. Ndiaye-Shaw')
      expect(ball.caption).toMatch(/block/)
    }
    const pro = buildScript(ill, world, 'pro')
    expect(pro[5]!.caption).toContain('runs 10.5 m and is held onside at the frozen line')
    expect(pro[5]!.notes.join(' ')).toMatch(/Assumed: pass 16 m\/s; .*every player 7 m\/s/)
    expect(pro[6]!.caption).toContain('30.4 m to the end of N. Vantreight')
    const fan = buildScript(ill, world, 'fan')
    expect(fan[6]!.caption).toContain('I. Tremaine is close enough to block it')
    expect(fan[6]!.caption).toContain('How it ends is unknown.')
  })

  it('draws ghosts for the moved players and darkens their frozen spots; the rest of the picture recedes', () => {
    const m = buildStageModel(ill, world, 'pro')
    expect(m.illustrative?.run.pid).toBe('NBA-09')
    expect(m.illustrative?.defenders.map((d) => d.pid)).toEqual(['RVC-02', 'RVC-06'])
    expect(m.illustrative?.contests.map((c) => [c.pid, c.kind])).toEqual([['RVC-02', 'block'], ['RVC-06', 'intercept']])
    const run = buildScript(ill, world, 'pro')[5]!
    const h = stepHierarchy(run, m)
    expect([...h.ghosted].sort()).toEqual(['NBA-09', 'RVC-02', 'RVC-06'])
    expect(h.about?.has('NBA-11')).toBe(true)
    expect(h.about?.has('NBA-04')).toBe(false)
  })

  it('a payload without a usable sketch keeps the geometry-only continuation', () => {
    const bad = parse({ ...VIEW_OPTION_ILL, whatif: { ...VIEW_OPTION_ILL.whatif, illustrative: { from_id: 'NBA-11' } } })
    expect(bad.whatif?.illustrative).toBeNull()
    expect(buildScript(bad, world, 'pro').map((s) => s.id)).toContain('continuation')
    const none = parse({ ...VIEW_OPTION_ILL, whatif: { ...VIEW_OPTION_ILL.whatif, illustrative: null } })
    expect(buildScript(none, world, 'fan').map((s) => s.id)).not.toContain('illustrative')
  })

  it('ends on one plain sentence beside the picture of the real pass and the open lane (no imagined layers)', () => {
    for (const v of [option, ill]) {
      for (const aud of ['pro', 'fan'] as const) {
        const last = buildScript(v, world, aud).at(-1)!
        expect(last.takeaway).toBe(v.plain)
        // one sentence (initials such as "S. Haddad-Rhys" are not sentence ends)
        expect(last.takeaway!.match(/(?<!\b[A-Z])[.!?](\s|$)/g)).toHaveLength(1)
        expect(last.layers).toEqual(['carrier', 'actualPass', 'bestLane'])
      }
    }
    for (const v of [press, lineBreak]) expect(buildScript(v, world, 'pro').at(-1)!.takeaway).toBeTruthy()
  })
})

describe('buildScript: truthful captions', () => {
  it('prints only numbers measured or counted in the view', () => {
    for (const v of ALL) {
      const ok = allowedNumbers(v)
      for (const aud of ['pro', 'fan'] as const) {
        for (const s of buildScript(v, world, aud)) {
          for (const n of text(s).match(/\d+(?:\.\d+)?/g) ?? []) {
            expect(ok.has(n), `${v.moment_id} ${aud} step ${s.n} prints ${n}`).toBe(true)
          }
        }
      }
    }
  })

  it('never claims an outcome, a chance or a probability', () => {
    const banned = [/would have scored/i, /\bchance/i, /%/, /probab/i, /\bshould have\b/i, /\bmistake\b(?!: the passer)/i, /\bgoal\b.*\bwould\b/i]
    for (const v of ALL) {
      for (const aud of ['pro', 'fan'] as const) {
        for (const s of buildScript(v, world, aud)) {
          // the view's own interpretation may say "not a mistake"; our own words never judge
          const ours = s.caption.replace(v.interpretation, '')
          for (const re of banned) expect(ours, `${v.moment_id} ${aud} ${s.id}`).not.toMatch(re)
        }
      }
    }
  })

  it('fan wording avoids analyst jargon', () => {
    const jargon = [/rating/i, /progression/i, /clearance/i, /\bm clear\b/i, /per .*defensive action/i, /\bbypassed\b/i, /\(open\)|\(contested\)|\(blocked\)/]
    for (const v of ALL) {
      for (const s of buildScript(v, world, 'fan')) {
        for (const re of jargon) expect(s.caption, `${v.moment_id} ${s.id}`).not.toMatch(re)
      }
    }
  })

  it('pro and fan differ in wording but not in structure', () => {
    const pro = buildScript(option, world, 'pro')
    const fan = buildScript(option, world, 'fan')
    expect(fan.map((s) => s.id)).toEqual(pro.map((s) => s.id))
    expect(fan[2]!.caption).not.toEqual(pro[2]!.caption)
    expect(fan[0]!.caption).toContain('M. Lindqvist has the ball')
  })
})

describe('buildChoice: What would you do?', () => {
  it('offers the real pass and the measured alternatives, ordered by position', () => {
    const set = buildChoice(option, world, 'fan')!
    expect(set.choices.map((c) => c.receiverId).sort()).toEqual(['NBA-07', 'NBA-09', 'NBA-11'])
    const ys = set.choices.map((c) => c.at[1])
    expect([...ys].sort((a, b) => a - b)).toEqual(ys)
    expect(set.choices.filter((c) => c.isActual).map((c) => c.receiverId)).toEqual(['NBA-09'])
    expect(set.prompt).toMatch(/Where would you pass\?/)
  })

  it('the reveal tells what happened and never claims how the pick would have gone', () => {
    const set = buildChoice(option, world, 'fan')!
    const c = set.revealCaption('NBA-11')
    expect(c).toContain('The real pass went to N. Vantreight')
    expect(c).toContain('You picked S. Haddad-Rhys')
    expect(c).not.toMatch(/would have|chance|%/i)
    expect(set.revealCaption('NBA-09')).toContain('You picked the same pass')
  })

  it('is not offered for moments without measured options', () => {
    expect(buildChoice(press, world, 'fan')).toBeNull()
    expect(buildChoice(lineBreak, world, 'fan')).toBeNull()
  })
})

describe('stage model', () => {
  it('colours players by kit and goalkeepers by the GK colour', () => {
    const m = buildStageModel(option, world, 'pro')
    const gk = m.players.find((p) => p.pid === 'NBA-01')!
    const outfield = m.players.find((p) => p.pid === 'NBA-04')!
    expect(gk.fill).toBe(world.teams.get('NBA')!.kit.goalkeeper)
    expect(outfield.fill).toBe(world.teams.get('NBA')!.kit.primary)
    expect(m.carrierId).toBe('NBA-04')
    expect(m.best?.receiverId).toBe('NBA-11')
    expect(m.laneOpponentIds).toEqual(['RVC-10', 'RVC-06'])
    expect(m.labels.intercepted).toBe('Intercepted · Ndiaye-Shaw')
  })

  it('finds an overload zone from the observation radius', () => {
    const m = buildStageModel(overload, world, 'pro')
    expect(m.zone?.radius).toBe(12)
    expect(m.zone?.chip).toBe('3 v 1 within 12 m')
  })

  it('convex hull keeps only the outline', () => {
    const h = convexHull([[0, 0], [10, 0], [10, 10], [0, 10], [5, 5]])
    expect(h).toHaveLength(4)
  })
})
