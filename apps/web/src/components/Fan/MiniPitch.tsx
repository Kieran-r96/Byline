import { useId } from 'react'

import type { WorldIndex } from '../../services/matchView'
import type { MomentView } from '../../services/schemas'

const L = 105
const W = 68

/**
 * A small broadcast-style frame of a real moment: every player where the tracking puts them, the key action
 * in gold, and (when one exists) the best open alternative as a dashed teal lane labelled as hypothetical.
 */
export function MiniPitch({ view, world, showWhatIf = true, hideActual = false }: { view: MomentView; world: WorldIndex; showWhatIf?: boolean; /** What would you do?: keep the real pass hidden until the fan has chosen. */ hideActual?: boolean }) {
  const uid = useId().replace(/:/g, '')
  const focus = new Set(view.focus_player_ids)
  const kit = (team: string, gk: boolean) => {
    const t = world.teams.get(team)
    return t ? (gk ? t.kit.goalkeeper : t.kit.primary) : '#888'
  }
  const w = view.whatif
  const alt = showWhatIf && w ? w.alternatives[0] : null
  const origin = w ? { x: w.origin[0], y: w.origin[1] } : null
  const actualTo = !hideActual && w && w.actual.kind === 'pass' ? { x: w.actual.end[0] ?? 0, y: w.actual.end[1] ?? 0 } : null
  const arrows = w ? [] : view.arrows.slice(0, 6)
  return (
    <svg className="mini-pitch" viewBox={`-2 -2 ${L + 4} ${W + 4}`} role="img" aria-label={`Pitch at ${view.display_clock}: ${view.title}`}>
      <defs>
        <pattern id={`mow-${uid}`} width="10.5" height={W} patternUnits="userSpaceOnUse">
          <rect width="5.25" height={W} fill="#1d6b4c" />
          <rect x="5.25" width="5.25" height={W} fill="#1a6246" />
        </pattern>
        <marker id={`gold-${uid}`} viewBox="0 0 10 10" refX="7" refY="5" markerWidth="4" markerHeight="4" orient="auto-start-reverse">
          <path d="M0 0 10 5 0 10z" fill="#E7BA60" />
        </marker>
        <marker id={`teal-${uid}`} viewBox="0 0 10 10" refX="7" refY="5" markerWidth="4" markerHeight="4" orient="auto-start-reverse">
          <path d="M0 0 10 5 0 10z" fill="#50C9C2" />
        </marker>
      </defs>
      <rect x="0" y="0" width={L} height={W} rx="1.5" fill={`url(#mow-${uid})`} />
      <g fill="none" stroke="rgba(245,242,233,0.55)" strokeWidth="0.35">
        <rect x="0" y="0" width={L} height={W} />
        <line x1={L / 2} y1="0" x2={L / 2} y2={W} />
        <circle cx={L / 2} cy={W / 2} r="9.15" />
        <rect x="0" y={W / 2 - 20.16} width="16.5" height="40.32" />
        <rect x={L - 16.5} y={W / 2 - 20.16} width="16.5" height="40.32" />
      </g>
      {view.lines && (
        <g stroke="rgba(245,242,233,0.45)" strokeWidth="0.4" strokeDasharray="1.6 1.4">
          <line x1={view.lines.back_x} y1="1" x2={view.lines.back_x} y2={W - 1} />
          <line x1={view.lines.mid_x} y1="1" x2={view.lines.mid_x} y2={W - 1} />
        </g>
      )}
      {alt && origin && (
        <g>
          <line x1={origin.x} y1={origin.y} x2={alt.x} y2={alt.y} stroke="#50C9C2" strokeWidth="0.9" strokeDasharray="2.2 1.6" markerEnd={`url(#teal-${uid})`} />
          <circle cx={alt.x} cy={alt.y} r={Math.min(alt.receiver_space_m, 10)} fill="rgba(80,201,194,0.14)" stroke="rgba(80,201,194,0.7)" strokeWidth="0.35" strokeDasharray="1 1" />
        </g>
      )}
      {actualTo && origin && (
        <line x1={origin.x} y1={origin.y} x2={actualTo.x} y2={actualTo.y} stroke="#E7BA60" strokeWidth="0.9" markerEnd={`url(#gold-${uid})`} opacity={alt ? 0.75 : 1} />
      )}
      {arrows.map((a) => (
        <line key={a.event_id} x1={a.from[0]} y1={a.from[1]} x2={a.to[0]} y2={a.to[1]} stroke="#E7BA60" strokeWidth="0.8" markerEnd={`url(#gold-${uid})`} />
      ))}
      {view.players.map((p) => (
        <g key={p.pid}>
          {focus.has(p.pid) && <circle cx={p.x} cy={p.y} r="2.6" fill="none" stroke="#E7BA60" strokeWidth="0.5" />}
          <circle cx={p.x} cy={p.y} r="1.55" fill={kit(p.team_id, p.gk)} stroke="rgba(245,242,233,0.85)" strokeWidth="0.3" />
        </g>
      ))}
      {view.ball && <circle cx={view.ball[0]} cy={view.ball[1]} r="0.85" fill="#fff" stroke="#07121d" strokeWidth="0.3" />}
    </svg>
  )
}
