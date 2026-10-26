import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from './api'
import type { SystemStatus } from './api'

export type BackendPhase = 'connecting' | 'online' | 'unavailable'

export interface BackendStatus {
  phase: BackendPhase
  system: SystemStatus | null
  /** Attempt index of the current retry series (0 when online). */
  attempt: number
  retryNow: () => void
}

const BASE_DELAY_MS = 1000
const MAX_DELAY_MS = 30_000

export function backoffDelay(attempt: number): number {
  return Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** Math.max(0, attempt))
}

/**
 * Calls /healthz and /api/system/status on mount. On any failure it marks the
 * backend unavailable and retries with exponential backoff (1s .. 30s).
 * Once online, it re-checks every 30s so the AI chip stays truthful.
 */
export function useBackendStatus(): BackendStatus {
  const [phase, setPhase] = useState<BackendPhase>('connecting')
  const [system, setSystem] = useState<SystemStatus | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [nonce, setNonce] = useState(0)
  const attemptRef = useRef(0)

  useEffect(() => {
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined

    const run = async () => {
      try {
        const [, status] = await Promise.all([
          api.health({ signal: controller.signal }),
          api.systemStatus({ signal: controller.signal }),
        ])
        if (controller.signal.aborted) return
        attemptRef.current = 0
        setAttempt(0)
        setSystem(status)
        setPhase('online')
        timer = setTimeout(run, MAX_DELAY_MS)
      } catch {
        if (controller.signal.aborted) return
        const current = attemptRef.current
        attemptRef.current = current + 1
        setAttempt(current + 1)
        setPhase('unavailable')
        timer = setTimeout(run, backoffDelay(current))
      }
    }

    void run()
    return () => {
      controller.abort()
      if (timer) clearTimeout(timer)
    }
  }, [nonce])

  const retryNow = useCallback(() => {
    attemptRef.current = 0
    setNonce((n) => n + 1)
  }, [])

  return { phase, system, attempt, retryNow }
}
