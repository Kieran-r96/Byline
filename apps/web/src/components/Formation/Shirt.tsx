import { useId } from 'react'

/**
 * A football shirt in the club's kit: body and sleeves in the primary colour, collar and cuffs in the
 * secondary, the number in the kit's number colour. Drawn for BYLINE (no club or kit-maker artwork).
 */
export function Shirt({
  number,
  fill,
  trim,
  ink,
  size = 48,
  className,
}: {
  number: number | string
  fill: string
  trim: string
  ink: string
  size?: number
  className?: string
}) {
  const id = useId().replace(/:/g, '')
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <defs>
        <linearGradient id={`sh-${id}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0.22" />
          <stop offset="0.55" stopColor="#fff" stopOpacity="0" />
          <stop offset="1" stopColor="#000" stopOpacity="0.18" />
        </linearGradient>
      </defs>
      <path
        d="M21 5 11 9.5 2.5 20.5 9.5 29 16 25.2V58.5c0 1 .8 1.5 1.8 1.5h28.4c1 0 1.8-.5 1.8-1.5V25.2l6.5 3.8 7-8.5L53 9.5 43 5c-2.2 4.6-6.4 7.4-11 7.4S23.2 9.6 21 5Z"
        fill={fill}
        stroke="rgba(0,0,0,0.35)"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      <path
        d="M21 5 11 9.5 2.5 20.5 9.5 29 16 25.2V58.5c0 1 .8 1.5 1.8 1.5h28.4c1 0 1.8-.5 1.8-1.5V25.2l6.5 3.8 7-8.5L53 9.5 43 5c-2.2 4.6-6.4 7.4-11 7.4S23.2 9.6 21 5Z"
        fill={`url(#sh-${id})`}
      />
      <path d="M21 5c2.2 4.6 6.4 7.4 11 7.4S40.8 9.6 43 5" fill="none" stroke={trim} strokeWidth="2.6" strokeLinecap="round" />
      <path d="M3.6 19.2 10.4 27.4M60.4 19.2 53.6 27.4" stroke={trim} strokeWidth="2.4" strokeLinecap="round" />
      <text
        x="32"
        y="44"
        textAnchor="middle"
        fontFamily="'Archivo Variable', 'Archivo', system-ui, sans-serif"
        fontWeight="800"
        fontSize={String(number).length > 1 ? 21 : 23}
        style={{ fontStretch: '80%' }}
        fill={ink}
      >
        {number}
      </text>
    </svg>
  )
}
