import type { ReactNode } from 'react'

/**
 * Football glyphs for the match log and research views. Drawn for BYLINE (no third-party icon set).
 * Decorative by default: callers put the meaning in text next to them.
 */
export type GlyphName =
  | 'ball'
  | 'shot'
  | 'save'
  | 'corner'
  | 'throw'
  | 'foul'
  | 'offside'
  | 'card-y'
  | 'card-r'
  | 'sub'
  | 'goal'
  | 'var'
  | 'whistle'
  | 'free'

/** A real-looking football: central pentagon, five seam spokes, partial outer panels. */
export function BallGlyph({ size = 16, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" className={className}>
      <circle cx="12" cy="12" r="10.25" fill="#f7f6f1" stroke="#0b1214" strokeWidth="1.5" />
      <path d="M12 8.1 15.7 10.8 14.3 15.1H9.7L8.3 10.8Z" fill="#0b1214" />
      <path
        d="M12 8.1V2.2M15.7 10.8 21.2 9M14.3 15.1 17.6 20M9.7 15.1 6.4 20M8.3 10.8 2.8 9"
        stroke="#0b1214"
        strokeWidth="1.2"
        fill="none"
      />
      <path d="M9.2 2.4 12 2.2 14.8 2.4 13.4 4.3H10.6Z" fill="#0b1214" />
      <path d="M21.6 11.2 21.2 9 20.4 6.6 19.1 8.8 20 11.5Z" fill="#0b1214" />
      <path d="M2.4 11.2 2.8 9 3.6 6.6 4.9 8.8 4 11.5Z" fill="#0b1214" />
      <path d="M16.2 21.2 17.6 20 19 18.4 16.6 18.1 15.4 20.3Z" fill="#0b1214" />
      <path d="M7.8 21.2 6.4 20 5 18.4 7.4 18.1 8.6 20.3Z" fill="#0b1214" />
    </svg>
  )
}

const STROKE: Record<Exclude<GlyphName, 'ball' | 'goal' | 'card-y' | 'card-r'>, ReactNode> = {
  shot: (
    <>
      <path d="M3 18 15 8" />
      <path d="M11 7.5h4.5V12" />
      <path d="M17 4h4v16h-4" />
    </>
  ),
  save: (
    <>
      <path d="M4 20V6h16v14" />
      <path d="M9 14.5c0-2.5 1.2-4.5 3-4.5s3 2 3 4.5" />
      <path d="M8 14.5h8" />
    </>
  ),
  corner: (
    <>
      <path d="M6 21V3" />
      <path d="M6 4h11l-3 3.5 3 3.5H6" />
      <path d="M3 21h8" />
    </>
  ),
  throw: (
    <>
      <circle cx="12" cy="5.5" r="2.5" />
      <path d="M7 12c1-2.5 3-3.5 5-3.5s4 1 5 3.5" />
      <path d="M12 9v12" />
    </>
  ),
  foul: (
    <>
      <path d="M5 19 19 5" />
      <path d="M5 5l14 14" />
    </>
  ),
  offside: (
    <>
      <path d="M6 21V3" />
      <path d="M6 4h12v8H6" />
      <path d="M6 8h12M12 4v8" />
    </>
  ),
  sub: (
    <>
      <path d="M7 4v14" />
      <path d="M3.5 14.5 7 18l3.5-3.5" />
      <path d="M17 20V6" />
      <path d="M13.5 9.5 17 6l3.5 3.5" />
    </>
  ),
  var: (
    <>
      <rect x="3" y="5" width="18" height="12" rx="1.5" />
      <path d="M9 21h6M12 17v4" />
    </>
  ),
  whistle: (
    <>
      <circle cx="9" cy="14" r="5" />
      <path d="M13 11.5 21 8v4l-7.5 1.5" />
    </>
  ),
  free: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 8v8M8 12h8" />
    </>
  ),
}

export function Glyph({ name, size = 16, className }: { name: GlyphName; size?: number; className?: string }) {
  if (name === 'ball' || name === 'goal') return <BallGlyph size={size} className={className} />
  if (name === 'card-y' || name === 'card-r') {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" className={className}>
        <rect x="6.5" y="3" width="11" height="17" rx="1.6" fill={name === 'card-y' ? '#f4c430' : '#ef4b3f'} transform="rotate(8 12 12)" />
      </svg>
    )
  }
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {STROKE[name]}
    </svg>
  )
}
