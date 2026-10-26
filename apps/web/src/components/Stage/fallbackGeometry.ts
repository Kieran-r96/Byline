import { PITCH_LENGTH, PITCH_WIDTH } from '../../services/stageModel'
import type { Vec2 } from '../../services/stageModel'

/** The SVG fallback's viewBox in pitch metres (the pitch plus 5 m of run-off). */
export const FALLBACK_VIEWBOX = { x: -5, y: -5, w: PITCH_LENGTH + 10, h: PITCH_WIDTH + 10 }

/** Percent position of a pitch point inside the fallback viewport (for HTML overlays). */
export function fallbackPercent(p: Vec2): { left: string; top: string } {
  return {
    left: `${(((p[0] - FALLBACK_VIEWBOX.x) / FALLBACK_VIEWBOX.w) * 100).toFixed(2)}%`,
    top: `${(((p[1] - FALLBACK_VIEWBOX.y) / FALLBACK_VIEWBOX.h) * 100).toFixed(2)}%`,
  }
}
