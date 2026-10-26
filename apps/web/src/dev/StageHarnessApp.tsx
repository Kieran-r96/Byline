import { useEffect, useRef, useState } from 'react'
import { TacticalStage } from '../components/Stage/TacticalStage'
import type { TacticalStageHandle } from '../components/Stage/TacticalStage'
import { getJson } from '../services/api'
import { indexWorld } from '../services/matchView'
import type { WorldIndex } from '../services/matchView'
import { MatchDetailSchema } from '../services/schemas'
import type { MomentView } from '../services/schemas'
import { loadMomentView } from '../services/tactics'

/**
 * Dev harness for screenshots and frame timing: /stage.html?moment=<id>&audience=pro|fan&step=n&mode=explain|choose
 * Optional: &match=<id> (default BYLINE-01), &pick=<receiver id>&reveal=1 (choose mode), &stats=1 (frame timing
 * readout), &compact=1, &withdrawn=<reason>.
 * Sets window.__stage = { ready, handle } for Playwright.
 */

const MATCH = new URLSearchParams(window.location.search).get('match') ?? 'BYLINE-01'

declare global {
  interface Window {
    __stage?: { ready: boolean; handle: TacticalStageHandle | null; error?: string }
  }
}

export function StageHarnessApp() {
  const q = new URLSearchParams(window.location.search)
  const momentId = q.get('moment') ?? 'T-option-NBA-0180'
  const audience = q.get('audience') === 'fan' ? 'fan' : 'pro'
  const step = Math.max(1, Number(q.get('step') ?? '1')) - 1
  const mode = q.get('mode') === 'choose' ? 'choose' : 'explain'
  const reveal = q.get('reveal') === '1'
  const compact = q.get('compact') === '1'
  const withdrawnReason = q.get('withdrawn')
  const [data, setData] = useState<{ view: MomentView; world: WorldIndex } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [stats, setStats] = useState('')
  const handle = useRef<TacticalStageHandle | null>(null)

  useEffect(() => {
    window.__stage = { ready: false, handle: null }
    Promise.all([getJson(`/api/matches/${MATCH}`, MatchDetailSchema, { timeoutMs: 10000 }), loadMomentView(MATCH, momentId)])
      .then(([detail, view]) => setData({ view, world: indexWorld(detail) }))
      .catch((e: unknown) => {
        setError(String(e))
        window.__stage = { ready: false, handle: null, error: String(e) }
      })
  }, [momentId])

  useEffect(() => {
    if (!data) return undefined
    const t = window.setTimeout(() => {
      window.__stage = { ready: true, handle: handle.current }
    }, 400)
    return () => window.clearTimeout(t)
  }, [data])

  useEffect(() => {
    if (q.get('stats') !== '1') return undefined
    const t = window.setInterval(() => {
      const s = handle.current?.stats()
      if (s && s.frames) setStats(`${s.frames} frames · avg ${s.avgMs.toFixed(1)} ms · p95 ${s.p95Ms.toFixed(1)} ms · max ${s.maxMs.toFixed(1)} ms`)
    }, 500)
    return () => window.clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (error) return <p style={{ color: '#FF7A6B', fontFamily: 'system-ui', padding: 16 }}>Harness error: {error}</p>
  if (!data) return <p style={{ color: '#A9B4B3', fontFamily: 'system-ui', padding: 16 }}>Loading…</p>
  if (q.get('clip') === '1') {
    // a Studio picture-in-picture box: &w=320&h=180 (the clip fills its parent); &hold=1 holds `step`
    const w = Number(q.get('w') ?? '320')
    const h = Number(q.get('h') ?? '180')
    return (
      <div data-testid="clip-box" style={{ width: w, height: h, position: 'relative', overflow: 'hidden' }}>
        <TacticalStage
          ref={handle}
          clip
          clipStepMs={q.get('hold') === '1' ? 3_600_000 : undefined}
          matchId={MATCH}
          view={data.view}
          world={data.world}
          audience={audience}
          initialStep={step}
        />
      </div>
    )
  }
  return (
    <div style={{ padding: 'max(12px, 2vw)' }}>
      <TacticalStage
        ref={handle}
        matchId={MATCH}
        view={data.view}
        world={data.world}
        audience={audience}
        initialStep={step}
        mode={mode}
        revealed={mode === 'choose' && reveal ? true : undefined}
        compact={compact}
        withdrawn={withdrawnReason ? { reason: withdrawnReason } : null}
      />
      {stats && (
        <p data-testid="stage-stats" style={{ color: '#A9B4B3', fontFamily: 'system-ui', fontSize: 12 }}>
          {stats}
        </p>
      )}
    </div>
  )
}
