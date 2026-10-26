import type { ReactNode } from 'react'

/**
 * Hand-drawn line icons on a 24px grid, stroke 1.75, rendered at 18 or 20px.
 * Decorative by default (aria-hidden); the owning control supplies the label.
 */
export type IconName =
  | 'play'
  | 'pause'
  | 'restart'
  | 'settings'
  | 'dock'
  | 'close'
  | 'radar'
  | 'match'
  | 'stories'
  | 'teams'
  | 'view'
  | 'refresh'

const PATHS: Record<IconName, ReactNode> = {
  play: <path d="M8 5.5v13l10.5-6.5L8 5.5Z" />,
  pause: (
    <>
      <path d="M8.5 5.5v13" />
      <path d="M15.5 5.5v13" />
    </>
  ),
  restart: (
    <>
      <path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3" />
      <path d="M4.5 4.5v4h4" />
    </>
  ),
  settings: (
    <>
      <path d="M4 7h9M17 7h3M4 17h3M11 17h9" />
      <circle cx="15" cy="7" r="2" />
      <circle cx="9" cy="17" r="2" />
    </>
  ),
  dock: (
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
      <path d="M14.5 4.5v15" />
    </>
  ),
  close: <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />,
  radar: (
    <>
      <path d="M12 12l6.2-6.2" />
      <path d="M19.5 12A7.5 7.5 0 1 1 12 4.5" />
      <path d="M15.5 12A3.5 3.5 0 1 1 12 8.5" />
      <circle cx="12" cy="12" r="0.9" fill="currentColor" stroke="none" />
    </>
  ),
  match: (
    <>
      <rect x="3.5" y="5.5" width="17" height="13" rx="2" />
      <path d="M12 5.5v13" />
      <circle cx="12" cy="12" r="2.4" />
    </>
  ),
  stories: (
    <>
      <path d="M5 6.5h14M5 12h14M5 17.5h8" />
    </>
  ),
  teams: <path d="M5.5 5h13v6.5c0 4-2.9 6.7-6.5 8-3.6-1.3-6.5-4-6.5-8V5Z" />,
  view: (
    <>
      <path d="M2.8 12S6.2 6 12 6s9.2 6 9.2 6-3.4 6-9.2 6-9.2-6-9.2-6Z" />
      <circle cx="12" cy="12" r="2.6" />
    </>
  ),
  refresh: (
    <>
      <path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3" />
      <path d="M19.5 4.5v4h-4" />
    </>
  ),
}

export interface IconProps {
  name: IconName
  size?: 18 | 20
  className?: string
}

export function Icon({ name, size = 20, className }: IconProps) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  )
}
