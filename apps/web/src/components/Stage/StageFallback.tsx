import type { ReactNode } from 'react'
import { directionSpot, PITCH_LENGTH, PITCH_WIDTH } from '../../services/stageModel'
import type { StageModel, Vec2 } from '../../services/stageModel'
import { LAYER_BEAT_MS, namedIds, stepHierarchy } from '../../services/stageScript'
import type { StageLayer, StageStep } from '../../services/stageScript'
import { FALLBACK_VIEWBOX } from './fallbackGeometry'
import type { ReplayPose } from './replay'

/**
 * 2D top-down fallback for the tactical stage (no WebGL, or jsdom): the same model and the same
 * layers per step, drawn as SVG in pitch metres. New layers fade in one at a time, in step order.
 */

const COL = {
  chalk: '#F2F0E8',
  measured: '#4FD1C5',
  hypo: '#B7A4FF',
  cont: '#DCD3FF',
  against: '#FF7A6B',
  night: '#0B1214',
}

const DIM = 0.26

export interface StageFallbackProps {
  model: StageModel
  step: StageStep
  label: string
  choices?: { ids: string[]; picked: string | null } | null
  pose?: ReplayPose | null
  /** No staggered fades. */
  reducedMotion?: boolean
}

/** A layer that is off renders nothing (so, in choose mode, nothing about the real pass is in the DOM). */
function Layer({ on, children, name, delayMs = 0 }: { on: number; children: ReactNode; name: string; delayMs?: number }) {
  return (
    <g
      className={`stage-svg__layer${on > 0 && on < 1 ? ' is-dim' : ''}`}
      data-layer={name}
      opacity={on}
      style={delayMs ? { transitionDelay: `${delayMs}ms` } : undefined}
    >
      {on > 0 ? children : null}
    </g>
  )
}

type TagStyle = 'solid' | 'dashed' | 'dotted' | 'ill'

function Tag({ x, y, text, fill, ink = COL.night, variant = 'solid' }: { x: number; y: number; text: string; fill: string; ink?: string; variant?: TagStyle }) {
  const w = Math.max(4, text.length * 0.95 + 1.6)
  // 'ill' (illustrative sketch) is a filled pale-lilac italic tag, like the 3D stage's
  const outlined = variant === 'dashed' || variant === 'dotted'
  return (
    <g className="stage-svg__tag" transform={`translate(${x} ${y})`}>
      <rect
        x={-w / 2}
        y={-2.6}
        width={w}
        height={2.6}
        rx={0.5}
        fill={outlined ? COL.night : fill}
        fillOpacity={outlined ? 0.88 : 1}
        stroke={outlined ? fill : 'none'}
        strokeWidth={0.18}
        strokeLinecap="round"
        strokeDasharray={variant === 'dashed' ? '0.6 0.4' : variant === 'dotted' ? '0.02 0.42' : undefined}
      />
      <text x={0} y={-0.75} textAnchor="middle" fontSize={1.7} fontWeight={700} fontStyle={variant === 'ill' ? 'italic' : undefined} fill={outlined ? fill : ink}>
        {text}
      </text>
    </g>
  )
}

/** An illustrative ghost shirt (top-down): a wash of the kit inside a dashed pale-lilac outline, number in lilac. */
function GhostShirt({ at, fill, n }: { at: Vec2; fill: string; n: number }) {
  return (
    <g transform={`translate(${at[0]} ${at[1]})`} data-ghost={n}>
      <circle r={2.3} fill="none" stroke={COL.cont} strokeWidth={0.26} strokeDasharray="0.7 0.5" />
      <path d={SHIRT_PATH} fill={fill} fillOpacity={0.35} stroke={COL.cont} strokeWidth={0.24} strokeDasharray="0.6 0.35" strokeLinejoin="round" />
      <text y={0.62} textAnchor="middle" fontSize={1.5} fontWeight={800} fill={COL.cont}>
        {n}
      </text>
    </g>
  )
}

/** A sketched move: a dotted trail on the grass from the frozen spot, ending in a chevron short of the ghost. */
function Trail({ from, to }: { from: Vec2; to: Vec2 }) {
  const len = Math.hypot(to[0] - from[0], to[1] - from[1]) || 1
  const ux = (to[0] - from[0]) / len
  const uy = (to[1] - from[1]) / len
  const a: Vec2 = [from[0] + ux * 1.6, from[1] + uy * 1.6]
  const b: Vec2 = [to[0] - ux * 2.6, to[1] - uy * 2.6]
  const ang = (Math.atan2(uy, ux) * 180) / Math.PI
  return (
    <g>
      <path d={`M${a[0]} ${a[1]} L${b[0]} ${b[1]}`} stroke={COL.cont} strokeWidth={0.42} strokeDasharray="0.55 0.55" strokeLinecap="round" fill="none" />
      <path d="M0.8 0 L-0.7 0.8 L-0.35 0 L-0.7 -0.8 Z" fill={COL.cont} transform={`translate(${b[0]} ${b[1]}) rotate(${ang}) scale(1.3)`} />
    </g>
  )
}

const arrowPath = (a: Vec2, b: Vec2, shortBy = 0) => {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1
  const k = Math.max(0, (len - shortBy) / len)
  return `M${a[0]} ${a[1]} L${a[0] + (b[0] - a[0]) * k} ${a[1] + (b[1] - a[1]) * k}`
}

/** A top-down curve for a cross: bowed sideways by a fraction of its length. */
const arcPath = (a: Vec2, b: Vec2, shortBy = 0, bow = 0.22) => {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1
  const k = Math.max(0, (len - shortBy) / len)
  const e: Vec2 = [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k]
  const mx = (a[0] + e[0]) / 2 - ((e[1] - a[1]) / len) * len * bow
  const my = (a[1] + e[1]) / 2 + ((e[0] - a[0]) / len) * len * bow
  return `M${a[0]} ${a[1]} Q${mx} ${my} ${e[0]} ${e[1]}`
}

/** A shirt seen from above, centred on the player's spot (metres). */
const SHIRT_PATH = 'M-0.45 -1.4 L-1 -1.2 L-1.55 -0.5 L-1.08 -0.12 L-0.92 -0.36 L-0.92 1.4 L0.92 1.4 L0.92 -0.36 L1.08 -0.12 L1.55 -0.5 L1 -1.2 L0.45 -1.4 Q0 -0.8 -0.45 -1.4 Z'
const SHIRT_HALF = 1.55

/** The ball nudged just outside any shirt it would sit under, towards the attack (as the 3D stage does). */
function ballSpot(m: StageModel, at: Vec2): Vec2 {
  const clear = SHIRT_HALF + 0.75
  let spot: Vec2 = [...at]
  for (let pass = 0; pass < 2; pass += 1) {
    for (const p of m.players) {
      const dx = spot[0] - p.x
      const dy = spot[1] - p.y
      const d = Math.hypot(dx, dy)
      if (d >= clear) continue
      const dir = m.direction === '+x' ? 1 : -1
      spot = d > 0.05 ? [p.x + (dx / d) * clear, p.y + (dy / d) * clear] : [p.x + dir * clear, p.y]
    }
  }
  return spot
}

export function StageFallback({ model: m, step, label, choices, pose, reducedMotion = false }: StageFallbackProps) {
  const level = (l: StageLayer) => (pose ? 0 : step.layers.includes(l) ? 1 : step.dim.includes(l) ? DIM : 0)
  // one idea at a time: each newly-on layer fades in after the previous one
  const delay = (l: StageLayer) => {
    if (reducedMotion) return 0
    const i = step.layers.indexOf(l)
    return i > 0 ? i * LAYER_BEAT_MS * 0.8 : 0
  }
  // the same names (at most four) and the same hierarchy as the 3D stage
  const names = new Set(pose ? [] : namedIds(step, m.carrierId))
  const at = (pid: string): Vec2 | null => {
    const live = pose?.pos.get(pid)
    if (live) return [live.x, live.y]
    const p = m.players.find((x) => x.pid === pid)
    return p ? [p.x, p.y] : null
  }
  const h = pose ? { about: null, ghosted: new Set<string>(), bypassed: new Set<string>() } : stepHierarchy(step, m)
  const bypassed = h.bypassed
  const c = m.continuation
  const il = m.illustrative
  const contOn = level('contFrom') > 0 || level('illFrom') > 0
  const assumedAt = c?.from ?? il?.from ?? null
  const ghostOn = level('illRun') > 0 || level('illDefend') > 0 || level('illGhosts') > 0
  const ghostAt = (pid: string): Vec2 | null => {
    if (!il || !ghostOn) return null
    const mv = [il.run, ...il.defenders].find((x) => x.pid === pid)
    return mv ? mv.to : null
  }
  const ball: Vec2 | null = pose?.ball.visible ? [pose.ball.x, pose.ball.y] : m.ball ? ballSpot(m, m.ball) : null
  const vb = FALLBACK_VIEWBOX
  const stripes = Array.from({ length: 20 }, (_, i) => i)
  const ly = m.labelY
  const arrowHead = (id: string, color: string) => (
    <marker id={id} viewBox="0 0 10 10" refX="6" refY="5" markerWidth="4" markerHeight="4" orient="auto-start-reverse">
      <path d="M0 0 L10 5 L0 10 z" fill={color} />
    </marker>
  )
  const dir = m.direction === '+x' ? 1 : -1
  const [cx, cy] = directionSpot(m)
  const dots = { strokeDasharray: '0.02 0.75', strokeLinecap: 'round' as const }

  return (
    <svg className="stage-svg" viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`} role="img" aria-label={label} preserveAspectRatio="xMidYMid meet">
      <defs>
        {arrowHead('stage-ah-against', COL.against)}
        {arrowHead('stage-ah-measured', COL.measured)}
        {arrowHead('stage-ah-hypo', COL.hypo)}
        <radialGradient id="stage-halo">
          <stop offset="0" stopColor={COL.chalk} stopOpacity="0.6" />
          <stop offset="1" stopColor={COL.chalk} stopOpacity="0" />
        </radialGradient>
        {/* players a step is not about: darkened, never hidden (as the 3D stage does) */}
        <filter id="stage-recede">
          <feColorMatrix type="matrix" values="0.22 0 0 0 0  0 0.22 0 0 0  0 0 0.22 0 0  0 0 0 1 0" />
        </filter>
        <radialGradient id="stage-light" cx="50%" cy="48%" r="62%">
          <stop offset="0.55" stopColor="#000" stopOpacity="0" />
          <stop offset="1" stopColor="#000" stopOpacity="0.38" />
        </radialGradient>
      </defs>
      <rect x={vb.x} y={vb.y} width={vb.w} height={vb.h} fill="#1d4a31" />
      {stripes.map((i) => (
        <rect key={i} x={(i * PITCH_LENGTH) / 20} y={vb.y} width={PITCH_LENGTH / 20} height={vb.h} fill={i % 2 ? '#24573a' : '#2c6343'} />
      ))}
      <rect x={vb.x} y={vb.y} width={vb.w} height={vb.h} fill="url(#stage-light)" />
      <g fill="none" stroke={COL.chalk} strokeOpacity={0.85} strokeWidth={0.22}>
        <rect x={0} y={0} width={PITCH_LENGTH} height={PITCH_WIDTH} />
        <line x1={52.5} y1={0} x2={52.5} y2={PITCH_WIDTH} />
        <circle cx={52.5} cy={34} r={9.15} />
        <rect x={0} y={13.84} width={16.5} height={40.32} />
        <rect x={88.5} y={13.84} width={16.5} height={40.32} />
        <rect x={0} y={24.84} width={5.5} height={18.32} />
        <rect x={99.5} y={24.84} width={5.5} height={18.32} />
        <rect x={-2} y={30.34} width={2} height={7.32} strokeOpacity={0.6} />
        <rect x={105} y={30.34} width={2} height={7.32} strokeOpacity={0.6} />
      </g>

      <Layer on={level('direction')} name="direction">
        {[-1, 0, 1].map((i) => (
          <path
            key={i}
            d={`M${cx + i * 3.1 * dir - 1.3 * dir} ${cy - 1.9} L${cx + i * 3.1 * dir + 0.35 * dir} ${cy} L${cx + i * 3.1 * dir - 1.3 * dir} ${cy + 1.9}`}
            fill="none"
            stroke={COL.chalk}
            strokeWidth={0.7}
            strokeOpacity={0.4 + (i + 1) * 0.18}
          />
        ))}
        <text x={cx} y={cy + (cy < 34 ? -3 : 4.6)} textAnchor="middle" fontSize={1.9} fontWeight={700} fill={COL.chalk}>
          {`${m.labels.attacking} ${dir > 0 ? '→' : '←'}`}
        </text>
      </Layer>

      {m.hull && (
        <Layer on={level('shape')} name="shape" delayMs={delay('shape')}>
          <polygon points={m.hull.points.map((p) => p.join(',')).join(' ')} fill={COL.chalk} fillOpacity={0.08} stroke={COL.chalk} strokeOpacity={0.75} strokeWidth={0.25} />
          {m.labels.shape && <Tag x={m.hull.points.reduce((a, p) => (p[1] < a[1] ? p : a))[0]} y={m.hull.points.reduce((a, p) => (p[1] < a[1] ? p : a))[1] - 1} text={m.labels.shape} fill={COL.chalk} />}
        </Layer>
      )}

      {m.lines && (
        <>
          <Layer on={level('lines')} name="lines" delayMs={delay('lines')}>
            {[[m.lines.back, m.labels.backLine], [m.lines.mid, m.labels.midLine]].map(([x, t]) => (
              <g key={String(t)}>
                <rect x={Number(x) - 0.6} y={0} width={1.2} height={PITCH_WIDTH} fill={COL.chalk} fillOpacity={0.14} />
                <line x1={x} y1={0} x2={x} y2={PITCH_WIDTH} stroke={COL.chalk} strokeWidth={0.3} />
                <text x={Number(x)} y={ly < 34 ? 2.6 : 66.2} textAnchor="middle" fontSize={1.7} fill={COL.chalk} fontWeight={600}>
                  {String(t)}
                </text>
              </g>
            ))}
          </Layer>
          <Layer on={level('gap')} name="gap" delayMs={delay('gap')}>
            <path
              d={`M${m.lines.mid} ${ly - 1.1} v2.2 M${m.lines.mid} ${ly} H${m.lines.back} M${m.lines.back} ${ly - 1.1} v2.2`}
              stroke={COL.measured}
              strokeWidth={0.3}
              fill="none"
            />
            {m.labels.gap && <Tag x={(m.lines.mid + m.lines.back) / 2} y={ly - 0.5} text={m.labels.gap} fill={COL.measured} />}
          </Layer>
          <Layer on={level('offside')} name="offside" delayMs={delay('offside')}>
            <line x1={m.lines.offside} y1={0} x2={m.lines.offside} y2={PITCH_WIDTH} stroke={COL.chalk} strokeWidth={0.22} strokeDasharray="1.1 0.9" />
          </Layer>
        </>
      )}

      {m.zone && (
        <Layer on={level('zone')} name="zone" delayMs={delay('zone')}>
          <circle cx={m.zone.centre[0]} cy={m.zone.centre[1]} r={m.zone.radius} fill={COL.measured} fillOpacity={0.08} stroke={COL.measured} strokeWidth={0.25} />
          {m.zone.chip && <Tag x={m.zone.centre[0]} y={m.zone.centre[1] - m.zone.radius - 0.5} text={m.zone.chip} fill={COL.measured} />}
        </Layer>
      )}

      {m.origin && m.options.length > 0 && (
        <Layer on={level('alternatives')} name="alternatives" delayMs={delay('alternatives')}>
          {m.options.map((o) => (
            <g key={o.receiverId}>
              <circle cx={o.to[0]} cy={o.to[1]} r={Math.min(o.space, 14)} fill={COL.measured} fillOpacity={0.07} stroke={COL.measured} strokeOpacity={0.8} strokeWidth={0.2} />
              <path d={arrowPath(m.origin!, o.to, 2)} stroke={COL.measured} strokeWidth={0.35} markerEnd="url(#stage-ah-measured)" />
              <Tag x={o.to[0]} y={o.to[1] - 2.2} text={o.chip} fill={COL.measured} />
            </g>
          ))}
        </Layer>
      )}

      {m.origin && m.best && (
        <Layer on={level('bestLane')} name="bestLane" delayMs={delay('bestLane')}>
          <circle cx={m.best.to[0]} cy={m.best.to[1]} r={Math.min(m.best.space, 14)} fill={COL.measured} fillOpacity={0.07} stroke={COL.measured} strokeOpacity={0.8} strokeWidth={0.2} />
          <path d={arrowPath(m.origin, m.best.to, 2)} stroke={COL.measured} strokeWidth={0.4} markerEnd="url(#stage-ah-measured)" />
          <Tag x={m.best.to[0]} y={m.best.to[1] - 2.2} text={m.best.chip} fill={COL.measured} />
        </Layer>
      )}

      {m.actual && (
        <Layer on={level('actualPass')} name="actualPass" delayMs={delay('actualPass')}>
          <path d={arrowPath(m.actual.from, m.actual.to)} stroke={COL.against} strokeWidth={0.45} />
          <path d={`M${m.actual.to[0] - 0.9} ${m.actual.to[1] - 0.9} l1.8 1.8 m0 -1.8 l-1.8 1.8`} stroke={COL.against} strokeWidth={0.4} />
          {m.labels.intercepted && <Tag x={m.actual.to[0]} y={m.actual.to[1] + 4.6} text={m.labels.intercepted} fill={COL.against} />}
        </Layer>
      )}

      {m.origin && m.best && (
        <Layer on={level('hypothetical')} name="hypothetical" delayMs={delay('hypothetical')}>
          <path d={arrowPath(m.origin, m.best.to, 2)} stroke={COL.hypo} strokeWidth={0.4} strokeDasharray="1.2 0.8" markerEnd="url(#stage-ah-hypo)" />
          <circle cx={m.best.to[0]} cy={m.best.to[1]} r={Math.min(m.best.space, 14)} fill="none" stroke={COL.hypo} strokeWidth={0.22} strokeDasharray="1 0.8" />
          {m.labels.hypoChip && <Tag x={m.best.to[0]} y={m.best.to[1] + 4.6} text={m.labels.hypoChip} fill={COL.hypo} variant="dashed" />}
        </Layer>
      )}

      {c && (
        <>
          <Layer on={level('contShot')} name="contShot" delayMs={delay('contShot')}>
            {c.shot && (
              <g>
                <polygon points={[c.from, ...c.shot.posts].map((p) => p.join(',')).join(' ')} fill={COL.cont} fillOpacity={0.16} stroke={COL.cont} strokeWidth={0.3} {...dots} />
                <line x1={c.shot.posts[0][0]} y1={c.shot.posts[0][1]} x2={c.shot.posts[1][0]} y2={c.shot.posts[1][1]} stroke={COL.cont} strokeWidth={0.45} />
                <Tag x={(c.from[0] + c.shot.centre[0]) / 2} y={(c.from[1] + c.shot.centre[1]) / 2} text={c.shot.chip} fill={COL.cont} variant="dotted" />
              </g>
            )}
          </Layer>
          <Layer on={level('contCross')} name="contCross" delayMs={delay('contCross')}>
            {c.cross && c.cross.targets[0] && (
              <g>
                <path d={arcPath(c.from, c.cross.targets[0].at, 2.2, c.from[1] < 34 ? 0.18 : -0.18)} fill="none" stroke={COL.cont} strokeWidth={0.38} {...dots} />
                {c.cross.targets.map((t) => (
                  <circle key={t.pid} cx={t.at[0]} cy={t.at[1]} r={2.3} fill="none" stroke={COL.cont} strokeWidth={0.3} {...dots} />
                ))}
                <Tag x={c.cross.targets[0].at[0]} y={c.cross.targets[0].at[1] + 5} text={c.cross.chip} fill={COL.cont} variant="dotted" />
              </g>
            )}
          </Layer>
          <Layer on={level('contPass')} name="contPass" delayMs={delay('contPass')}>
            {c.passes.map((p) => (
              <g key={p.receiverId}>
                <path d={arrowPath(c.from, p.to, 2.3)} stroke={COL.cont} strokeWidth={0.38} {...dots} />
                <circle cx={p.to[0]} cy={p.to[1]} r={2.3} fill="none" stroke={COL.cont} strokeWidth={0.3} {...dots} />
                <Tag x={p.to[0]} y={p.to[1] + 5} text={p.chip} fill={COL.cont} variant="dotted" />
              </g>
            ))}
          </Layer>
          <Layer on={level('contFrom')} name="contFrom">
            <circle cx={c.from[0]} cy={c.from[1]} r={2.7} fill="none" stroke={COL.cont} strokeWidth={0.32} {...dots} />
            <Tag x={c.from[0]} y={c.from[1] - 3.2} text={m.labels.contTag} fill={COL.cont} variant="dotted" />
          </Layer>
        </>
      )}

      {il && (
        <>
          <Layer on={level('illRun')} name="illRun" delayMs={delay('illRun')}>
            <Trail from={il.run.from} to={il.run.to} />
          </Layer>
          <Layer on={level('illDefend')} name="illDefend" delayMs={delay('illDefend')}>
            {il.defenders.map((d) => (
              <Trail key={d.pid} from={d.from} to={d.to} />
            ))}
          </Layer>
          <Layer on={level('illBall')} name="illBall" delayMs={delay('illBall')}>
            <path d={arcPath(il.delivery.from, il.delivery.to, 2.6, il.delivery.from[1] < 34 ? 0.14 : -0.14)} fill="none" stroke={COL.cont} strokeWidth={0.46} {...dots} />
          </Layer>
          <Layer on={level('illFrom')} name="illFrom">
            <circle cx={il.from[0]} cy={il.from[1]} r={2.7} fill="none" stroke={COL.cont} strokeWidth={0.32} {...dots} />
            {level('illRun') > 0 && <Tag x={il.from[0]} y={il.from[1] - 3.2} text={m.labels.illTag} fill={COL.cont} variant="ill" />}
          </Layer>
        </>
      )}

      {m.arrows.length > 0 && (
        <Layer on={level('evidence')} name="evidence" delayMs={delay('evidence')}>
          {m.arrows.map((a, i) => (
            <path
              key={i}
              d={arrowPath(a.from, a.to, 1)}
              stroke={a.tone === 'against' ? COL.against : COL.measured}
              strokeWidth={0.4}
              strokeDasharray={a.type === 'carry' ? '1 0.7' : undefined}
              markerEnd={`url(#stage-ah-${a.tone === 'against' ? 'against' : 'measured'})`}
            />
          ))}
        </Layer>
      )}

      {m.players.map((p) => {
        const pos = at(p.pid)
        if (!pos) return null
        const ghost = ghostAt(p.pid)
        const focus = names.has(p.pid)
        const ring =
          level('laneOpponents') > 0 && m.laneOpponentIds.includes(p.pid)
            ? COL.against
            : level('between') > 0 && m.betweenIds.includes(p.pid)
              ? COL.measured
              : focus && !ghost
                ? COL.chalk
                : null
        const offered = choices?.ids.includes(p.pid)
        const carrier = p.pid === m.carrierId
        // hierarchy: the step's players bright, the rest darkened; a frozen spot a ghost stands in for fades
        const receded = h.about !== null && !h.about.has(p.pid)
        const opacity = ghost ? 0.4 : bypassed.has(p.pid) ? 0.32 : 1
        return (
          <g key={p.pid} transform={`translate(${pos[0]} ${pos[1]})`} opacity={opacity} filter={receded || ghost ? 'url(#stage-recede)' : undefined} data-receded={receded || undefined}>
            {ring && <circle r={2.2} fill="none" stroke={ring} strokeWidth={carrier && focus ? 0.5 : 0.32} />}
            {offered && <circle r={2.7} fill="none" stroke={COL.chalk} strokeWidth={choices?.picked === p.pid ? 0.5 : 0.3} strokeDasharray={choices?.picked === p.pid ? undefined : '0.8 0.6'} />}
            <path d={SHIRT_PATH} transform={focus && !ghost ? 'scale(1.12)' : undefined} fill={p.fill} stroke={COL.night} strokeOpacity={0.85} strokeWidth={0.22} strokeLinejoin="round" />
            <text y={0.62} textAnchor="middle" fontSize={1.5} fontWeight={800} fill={p.ink} stroke={COL.night} strokeOpacity={0.35} strokeWidth={0.12} paintOrder="stroke">
              {p.number}
            </text>
            {focus && !offered && !ghost && <Tag x={0} y={-2.1} text={carrier ? `${p.name} · on the ball` : p.name} fill={carrier ? COL.chalk : COL.night} ink={carrier ? COL.night : COL.chalk} />}
          </g>
        )
      })}

      {il && ghostOn && (
        <g data-layer="illGhostShirts">
          {[il.run, ...il.defenders].map((mv) => {
            const p = m.players.find((x) => x.pid === mv.pid)
            if (!p) return null
            return (
              <g key={mv.pid}>
                <GhostShirt at={mv.to} fill={p.fill} n={p.number} />
                {names.has(mv.pid) && <Tag x={mv.to[0]} y={mv.to[1] - 2.1} text={p.name} fill={COL.night} ink={COL.chalk} />}
              </g>
            )
          })}
        </g>
      )}

      {il && (
        <Layer on={level('illContest')} name="illContest" delayMs={delay('illContest')}>
          {il.contests.map((cn, i) => (
            <g key={cn.pid}>
              <circle cx={cn.at[0]} cy={cn.at[1]} r={2.9} fill="none" stroke={COL.cont} strokeWidth={0.42} />
              <Tag x={cn.at[0]} y={cn.at[1] + (i % 2 ? 6.2 : -3.4)} text={cn.kind === 'block' ? `Could block it · ${cn.name}` : `Could get there first · ${cn.name}`} fill={COL.cont} variant="ill" />
            </g>
          ))}
        </Layer>
      )}

      {ball && (
        <g transform={`translate(${ball[0]} ${ball[1]})`} opacity={contOn ? 0.4 : 1}>
          <circle r={1.8} fill="url(#stage-halo)" />
          <circle r={0.6} fill="#F6F6F2" stroke="#0B1214" strokeWidth={0.22} />
          <circle r={0.22} fill="#0B1214" />
        </g>
      )}
      {assumedAt && contOn && (
        <g transform={`translate(${ballSpot(m, assumedAt)[0]} ${ballSpot(m, assumedAt)[1]})`} data-layer-ball="assumed">
          <circle r={0.6} fill={COL.cont} fillOpacity={0.75} stroke={COL.night} strokeWidth={0.2} />
        </g>
      )}
    </svg>
  )
}
