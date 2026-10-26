import { useEffect, useMemo, useRef, useState } from 'react'
import { KeyMoments } from '../components/KeyMoments/KeyMoments'
import { ReplayControls } from '../components/ReplayControls/ReplayControls'
import { ScoreBug } from '../components/ScoreBug/ScoreBug'
import { Timeline } from '../components/Timeline/Timeline'
import type { MatchSessionStore, SessionSnapshot } from '../services/matchSession'
import { buildMarkers } from '../services/matchView'
import { useShowcase } from '../services/showcase'
import type { WorldIndex } from '../services/matchView'
import type { TeamId } from '../types/shell'
import { REPLAY_SPEEDS } from '../types/shell'
import type { ReplaySpeed, TimelineTick } from '../types/shell'
import { scoreBugData, usePlayheadSeconds } from './liveData'

export function LiveScoreBug({
  store,
  snap,
  world,
  variant,
  onCrest,
}: {
  store: MatchSessionStore
  snap: SessionSnapshot
  world: WorldIndex
  variant: 'default' | 'compact'
  onCrest?: (teamId: TeamId) => void
}) {
  const seconds = usePlayheadSeconds(store)
  return <ScoreBug {...scoreBugData(snap, world, seconds * 1000)} variant={variant} onCrest={onCrest} />
}

export function LiveTransport({
  store,
  snap,
  world,
  hideStories = false,
}: {
  store: MatchSessionStore
  snap: SessionSnapshot
  world: WorldIndex
  /** Fan Classic: official events only, no AI story markers. */
  hideStories?: boolean
}) {
  const seconds = usePlayheadSeconds(store)
  const [scrub, setScrub] = useState<number | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    [],
  )
  const durationSeconds = Math.round((snap.anchor?.duration_ms ?? snap.detail?.duration_ms ?? 90 * 60_000) / 1000)
  const h2 = snap.detail?.periods.find((p) => p.period === 'H2')?.start_ms
  const ticks: TimelineTick[] | undefined = useMemo(() => {
    if (h2 === undefined) return undefined
    const h2s = h2 / 1000
    return [
      { atSeconds: 0, label: 'KO' },
      { atSeconds: 15 * 60, label: "15'" },
      { atSeconds: 30 * 60, label: "30'" },
      { atSeconds: h2s, label: 'HT' },
      { atSeconds: h2s + 15 * 60, label: "60'" },
      { atSeconds: h2s + 30 * 60, label: "75'" },
      { atSeconds: durationSeconds, label: 'FT' },
    ]
  }, [h2, durationSeconds])
  const markers = useMemo(
    () => buildMarkers(snap.keyEvents, hideStories ? [] : snap.candidates, snap.insights, world),
    [snap.keyEvents, snap.candidates, snap.insights, world, hideStories],
  )
  const raw = snap.anchor?.speed ?? 12
  const speed: ReplaySpeed = (REPLAY_SPEEDS as readonly number[]).includes(raw) ? (raw as ReplaySpeed) : 12
  const position = scrub ?? seconds
  const ready = !!snap.sessionId && !!snap.anchor
  const showcase = useShowcase(store.matchId)
  const moments = useMemo(
    () => (showcase?.moments ?? []).filter((m) => !hideStories || m.kind === 'decision'),
    [showcase, hideStories],
  )

  return (
    <div className="transport">
      <Timeline
        markers={markers}
        durationSeconds={durationSeconds}
        positionSeconds={position}
        ticks={ticks}
        halfAtSeconds={h2 !== undefined ? h2 / 1000 : undefined}
        onSeek={(s, marker) => store.seek((s - (marker.kind === 'story' ? 8 : 5)) * 1000)}
      />
      <ReplayControls
        playing={snap.anchor?.playing ?? false}
        speed={speed}
        positionSeconds={position}
        durationSeconds={durationSeconds}
        disabled={!ready}
        onPlayPause={() => store.togglePlay()}
        onRestart={() => void store.restart()}
        onSpeedChange={(s) => store.setSpeed(s)}
        onScrub={(s) => {
          setScrub(s)
          if (timer.current) clearTimeout(timer.current)
          timer.current = setTimeout(() => {
            store.seek(s * 1000)
            setScrub(null)
          }, 140)
        }}
      />
      <div className="transport__extras">
        <KeyMoments
          moments={moments}
          disabled={!ready}
          onJump={(m) => {
            store.seek(m.jump_to_ms)
            store.play()
          }}
        />
      </div>
    </div>
  )
}
