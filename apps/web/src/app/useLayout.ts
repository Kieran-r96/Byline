import { useSyncExternalStore } from 'react'

export type LayoutMode = 'desktop' | 'tablet' | 'mobile'

const MOBILE = '(max-width: 767.98px)'
const TABLET = '(min-width: 768px) and (max-width: 1023.98px)'
const NARROW_DESKTOP = '(min-width: 1024px) and (max-width: 1279.98px)'

function read(): LayoutMode {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 'desktop'
  if (window.matchMedia(MOBILE).matches) return 'mobile'
  if (window.matchMedia(TABLET).matches) return 'tablet'
  return 'desktop'
}

function subscribe(onChange: () => void) {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {}
  const queries = [window.matchMedia(MOBILE), window.matchMedia(TABLET)]
  queries.forEach((q) => q.addEventListener('change', onChange))
  return () => queries.forEach((q) => q.removeEventListener('change', onChange))
}

/** Breakpoints: mobile < 768 <= tablet < 1024 <= desktop (narrow below 1280). Mirrors App.css. */
export function useLayout(): LayoutMode {
  return useSyncExternalStore(subscribe, read, () => 'desktop')
}

function readNarrow(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(NARROW_DESKTOP).matches
}

function subscribeNarrow(onChange: () => void) {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {}
  const q = window.matchMedia(NARROW_DESKTOP)
  q.addEventListener('change', onChange)
  return () => q.removeEventListener('change', onChange)
}

/** Laptop widths (1024-1279): desktop dock layout with a slimmer header. */
export function useNarrowDesktop(): boolean {
  return useSyncExternalStore(subscribeNarrow, readNarrow, () => false)
}
