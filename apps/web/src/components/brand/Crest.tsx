import { useId } from 'react'
import type { TeamId } from '../../types/shell'
import { TEAMS } from './teams'

export interface CrestProps {
  teamId: TeamId
  /** Rendered height in px. <= 32 switches to a simplified small-size drawing. */
  size?: number
  /** Override the accessible name; pass "" to mark decorative. */
  label?: string
  className?: string
}

/**
 * Original fictional crests, drawn for BYLINE.
 * - Northbridge Athletic: garnet shield, cream keyline, through-arch bridge, "NA" monogram.
 * - Riverton City: electric-blue roundel, ice keyline, three river waves, "RC" monogram.
 * Small sizes drop the monogram and fine detail so the silhouette stays crisp at 20px.
 */
/** A centred river wave built from alternating quadratic segments. */
function wave(cx: number, y: number, halfPeriods: number, half: number, amp: number) {
  const x0 = cx - (halfPeriods * half) / 2
  let d = `M${x0} ${y}q${half / 2} ${-amp * 2} ${half} 0`
  for (let i = 1; i < halfPeriods; i += 1) d += `t${half} 0`
  return d
}

export function Crest({ teamId, size = 40, label, className }: CrestProps) {
  const gradientId = `rvc-depth-${useId().replace(/:/g, '')}`
  const team = TEAMS[teamId]
  const compact = size <= 32
  const accessibleName = label ?? `${team.name} crest`
  const a11y =
    accessibleName === ''
      ? ({ 'aria-hidden': true } as const)
      : ({ role: 'img', 'aria-label': accessibleName } as const)

  if (teamId === 'NBA') {
    return (
      <svg
        className={className}
        width={(size * 64) / 72}
        height={size}
        viewBox="0 0 64 72"
        fill="none"
        data-team={teamId}
        {...a11y}
      >
        {/* Shield body */}
        <path
          d="M7 5h50v29c0 16.5-11.6 27.7-25 33.6C18.6 61.7 7 50.5 7 34V5Z"
          fill={team.primary}
        />
        {/* Subtle lower shade for depth */}
        <path
          d="M7 38h50c-1.6 14.4-12.4 24.3-25 29.6C19.4 62.3 8.6 52.4 7 38Z"
          fill="#000"
          opacity={0.14}
        />
        {/* Cream keyline */}
        <path
          d={
            compact
              ? 'M12.5 10.5h39V34c0 13.2-9.1 22.6-19.5 27.6C21.6 56.6 12.5 47.2 12.5 34V10.5Z'
              : 'M11.5 9.5h41V34c0 14-9.6 23.9-20.5 29.1C21.1 57.9 11.5 48 11.5 34V9.5Z'
          }
          stroke={team.secondary}
          strokeWidth={compact ? 3.2 : 1.6}
          strokeLinejoin="round"
        />
        {compact ? (
          <g stroke={team.secondary} strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 49Q32 21 45 49" strokeWidth={5} />
            <path d="M16.5 40.5h31" strokeWidth={4} />
          </g>
        ) : (
          <g stroke={team.secondary} strokeLinejoin="round">
            {/* Monogram N A */}
            <path
              d="M21 30V16.5l8.2 13.5V16.5"
              strokeWidth={3}
              strokeLinecap="square"
            />
            <path d="M33.4 30l5.3-13.5L44 30M35.4 25.2h6.6" strokeWidth={3} strokeLinecap="square" />
            {/* Through-arch bridge */}
            <path d="M20 51Q32 25 44 51" strokeWidth={2.6} strokeLinecap="round" />
            <path d="M16 44.5h32" strokeWidth={2.2} strokeLinecap="round" />
            <path d="M26 44.5v-4.4M32 44.5v-6M38 44.5v-4.4" strokeWidth={1.4} strokeLinecap="round" />
            {/* Waterline beneath the span */}
            <path d="M24 55.5h16" strokeWidth={1.4} strokeLinecap="round" opacity={0.7} />
          </g>
        )}
      </svg>
    )
  }

  // Riverton City roundel
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      data-team={teamId}
      {...a11y}
    >
      <circle cx="32" cy="32" r="30.5" fill={team.primary} />
      <circle cx="32" cy="32" r="30.5" fill={`url(#${gradientId})`} />
      <circle
        cx="32"
        cy="32"
        r={compact ? 25.5 : 26.25}
        stroke={team.secondary}
        strokeWidth={compact ? 3 : 1.5}
      />
      <defs>
        <radialGradient id={gradientId} cx="0.5" cy="0.3" r="0.75">
          <stop offset="0" stopColor="#fff" stopOpacity="0.08" />
          <stop offset="1" stopColor="#001433" stopOpacity="0.35" />
        </radialGradient>
      </defs>
      {compact ? (
        <g stroke={team.secondary} strokeLinecap="round" strokeWidth={4.2}>
          <path d={wave(32, 23.5, 6, 6, 1.9)} />
          <path d={wave(32, 32.5, 6, 6, 1.9)} />
          <path d={wave(32, 41.5, 5, 6, 1.9)} />
        </g>
      ) : (
        <g stroke={team.secondary} strokeLinejoin="round">
          {/* Monogram R C */}
          <path
            d="M21.5 31V17.5h5.2a3.9 3.9 0 0 1 0 7.8h-5.2M26.2 25.3L30 31"
            strokeWidth={2.8}
            strokeLinecap="square"
          />
          <path d="M42.6 19.2A6.9 6.9 0 1 0 42.6 29.3" strokeWidth={2.8} strokeLinecap="square" />
          {/* Three river waves */}
          <g strokeLinecap="round" strokeWidth={2.3}>
            <path d={wave(32, 38.5, 8, 4.1, 1.25)} />
            <path d={wave(32, 44.5, 7, 3.9, 1.2)} />
            <path d={wave(32, 50.5, 5, 3.9, 1.2)} />
          </g>
        </g>
      )}
    </svg>
  )
}
