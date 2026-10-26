import { useSyncExternalStore } from 'react'
import type { Role } from '../types/shell'

/**
 * Viewer preferences, persisted per browser in localStorage (all access is
 * guarded: private windows or blocked storage just fall back to memory).
 * "Used" and "pinned" are tracked per fact_id / decision_id, never per player.
 */

export type FanMode = 'classic' | 'discover' | 'analyst'
export type Lang = 'en' | 'es'

export interface Prefs {
  role: Role
  fanMode: FanMode
  lang: Lang
  /** fact_id or decision_id -> local time it was marked used. */
  used: Record<string, number>
  pinned: string[]
}

const KEY = 'byline.prefs.v1'
const DEFAULTS: Prefs = { role: 'commentator', fanMode: 'classic', lang: 'en', used: {}, pinned: [] }

function load(storage: Storage | null): Prefs {
  try {
    const raw = storage?.getItem(KEY)
    if (!raw) return DEFAULTS
    const v = JSON.parse(raw) as Partial<Prefs>
    return {
      role: v.role === 'studio' || v.role === 'fan' || v.role === 'commentator' ? v.role : DEFAULTS.role,
      fanMode: v.fanMode === 'discover' || v.fanMode === 'analyst' || v.fanMode === 'classic' ? v.fanMode : 'classic',
      lang: v.lang === 'es' ? 'es' : 'en',
      used: v.used && typeof v.used === 'object' ? v.used : {},
      pinned: Array.isArray(v.pinned) ? v.pinned.filter((x): x is string => typeof x === 'string') : [],
    }
  } catch {
    return DEFAULTS
  }
}

function safeStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}

export class PrefsStore {
  private value: Prefs
  private listeners = new Set<() => void>()
  private readonly storage: Storage | null

  constructor(storage: Storage | null = safeStorage()) {
    this.storage = storage
    this.value = load(storage)
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  get = (): Prefs => this.value

  private update(patch: Partial<Prefs>): void {
    this.value = { ...this.value, ...patch }
    try {
      this.storage?.setItem(KEY, JSON.stringify(this.value))
    } catch {
      /* storage full or blocked: keep in memory */
    }
    for (const fn of this.listeners) fn()
  }

  setRole(role: Role): void {
    this.update({ role })
  }

  setFanMode(fanMode: FanMode): void {
    this.update({ fanMode })
  }

  setLang(lang: Lang): void {
    this.update({ lang })
  }

  markUsed(id: string): void {
    this.update({ used: { ...this.value.used, [id]: Date.now() }, pinned: this.value.pinned.filter((p) => p !== id) })
  }

  unmarkUsed(id: string): void {
    const used = { ...this.value.used }
    delete used[id]
    this.update({ used })
  }

  togglePin(id: string): void {
    const pinned = this.value.pinned.includes(id)
      ? this.value.pinned.filter((p) => p !== id)
      : [id, ...this.value.pinned]
    this.update({ pinned })
  }
}

export const prefs = new PrefsStore()

export function usePrefs(store: PrefsStore = prefs): Prefs {
  return useSyncExternalStore(store.subscribe, store.get, store.get)
}
