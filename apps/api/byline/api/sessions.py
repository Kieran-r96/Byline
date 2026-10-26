"""Replay sessions: stream an immutable event log at a chosen speed through the live pipeline.

Each session owns its playhead and a MatchIntelligence instance (state + detectors). Live
ingestion here *is* the timed release of immutable synthetic events; nothing downstream knows
the future. Candidates go to the shared InsightService, whose results fan out to every
session watching that match.

Concurrency model: the ticker runs on the event loop; control routes run in FastAPI's
threadpool. A seek rebuilds state OUTSIDE the session lock and swaps it in, the ticker never
blocks on a busy session, and messages published from worker threads are handed to the loop.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import secrets
import threading
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any, Literal

from byline.events.models import MatchEvent
from byline.football.detectors.base import PatternCandidate
from byline.football.intelligence import MatchIntelligence, context_for, moments_for
from byline.football.storylines import Storyline
from byline.overlay.desk import OverlayPacket, StudioDesk
from byline.signals.engine import Signal
from byline.storage.fixtures import MatchPackage
from byline.tactics.moments import KIND_LABEL, TacticalMoment

log = logging.getLogger("byline.sessions")

ALLOWED_SPEEDS = (1, 4, 12, 30, 60)
TICK_S = 0.1
STATE_EVENT_TYPES = {
    "lineup.confirmed", "period.started", "period.ended", "kickoff", "goal.provisional", "goal.confirmed",
    "goal.disallowed", "card.yellow", "card.second_yellow", "card.red", "substitution", "var.review_started",
    "var.review_outcome", "restart.awarded", "penalty.outcome", "match.finished", "offside.offence_confirmed",
    "foul.committed", "advantage.applied",
}
MAX_SESSIONS = 200
MAX_SESSIONS_PER_CLIENT = 6
MAX_SUBSCRIBERS_PER_SESSION = 4
IDLE_TTL_S = 30 * 60
QUEUE_SIZE = 5000


class SessionLimit(RuntimeError):
    pass


@dataclass
class StreamMessage:
    event: Literal["match_event", "match_state", "pattern_candidate", "insight_update", "heartbeat",
                   "replay_reset", "tracking_hint", "decision", "recap", "overlay_update",
                   "storyline_update", "tactical_moment", "signal"]
    data: dict[str, Any]
    id: str | None = None


# sink(session, candidate, live): live=False when the candidate was re-derived by a seek/rebuild
CandidateSink = Callable[..., None]


@dataclass
class Rebuilt:
    intelligence: MatchIntelligence
    studio: StudioDesk
    cursor: int
    playhead_ms: int


@dataclass
class ReplaySession:
    session_id: str
    package: MatchPackage
    on_candidate: CandidateSink
    on_retract: CandidateSink = lambda s, c: None
    # (session, storyline, live) -> JSON; the insight service adds tier-1 reads (and may start one when live)
    storyline_view: Callable[..., dict[str, Any]] = lambda s, sl, live=False: sl.to_json()
    speed: int = 12
    playing: bool = False
    playhead_ms: int = 0
    cursor: int = 0  # number of events released
    client_key: str = "local"
    loop: asyncio.AbstractEventLoop | None = None
    intelligence: MatchIntelligence = field(init=False)
    subscribers: list[asyncio.Queue[StreamMessage]] = field(default_factory=list)
    overflowed: set[int] = field(default_factory=set)
    last_touch: float = field(default_factory=time.monotonic)
    _last_state_push: float = 0.0

    def __post_init__(self) -> None:
        self.lock = threading.RLock()
        self.intelligence = self.new_intelligence()
        self.studio = StudioDesk(self.package.world, self.package.match_id)

    # ---------------------------------------------------------------- pub/sub

    def new_intelligence(self) -> MatchIntelligence:
        p = self.package
        return MatchIntelligence(p.world, tracking=p.tracking,
                                 moments=moments_for(p.events_sha256, p.world, p.events, p.tracking),
                                 context_source=context_for(p.events_sha256, p.world))

    def touch(self) -> None:
        self.last_touch = time.monotonic()

    def subscribe(self) -> asyncio.Queue[StreamMessage]:
        if len(self.subscribers) >= MAX_SUBSCRIBERS_PER_SESSION:
            raise SessionLimit("too many streams for this session")
        q: asyncio.Queue[StreamMessage] = asyncio.Queue(maxsize=QUEUE_SIZE)
        self.subscribers.append(q)
        self.touch()
        return q

    def unsubscribe(self, q: asyncio.Queue[StreamMessage]) -> None:
        with contextlib.suppress(ValueError):
            self.subscribers.remove(q)
        self.overflowed.discard(id(q))

    def is_overflowed(self, q: asyncio.Queue[StreamMessage]) -> bool:
        return id(q) in self.overflowed

    def publish(self, msg: StreamMessage) -> None:
        loop = self.loop
        if loop is not None and loop.is_running():
            try:
                on_loop = asyncio.get_running_loop() is loop
            except RuntimeError:
                on_loop = False
            if not on_loop:
                loop.call_soon_threadsafe(self._publish_now, msg)
                return
        self._publish_now(msg)

    def _publish_now(self, msg: StreamMessage) -> None:
        for q in list(self.subscribers):
            try:
                q.put_nowait(msg)
            except asyncio.QueueFull:
                # slow consumer: end its stream so the browser reconnects and backfills via REST
                self.overflowed.add(id(q))
                with contextlib.suppress(ValueError):
                    self.subscribers.remove(q)

    # ---------------------------------------------------------------- playback

    @property
    def events(self) -> tuple[MatchEvent, ...]:
        return self.package.events

    @property
    def duration_ms(self) -> int:
        return self.events[-1].elapsed_ms

    def control(self, action: str, speed: int | None = None, elapsed_ms: int | None = None) -> None:
        self.touch()
        if action in ("seek", "reset") or (action == "play" and self.cursor >= len(self.events)):
            if action == "seek" and elapsed_ms is None:
                raise ValueError("seek requires elapsed_ms")
            target = elapsed_ms if action == "seek" else 0
            self.seek(int(target or 0), play_after=action == "play", stop=action == "reset")
            return
        with self.lock:
            if action == "play":
                self.playing = True
            elif action == "pause":
                self.playing = False
            elif action == "speed":
                if speed not in ALLOWED_SPEEDS:
                    raise ValueError(f"speed must be one of {ALLOWED_SPEEDS}")
                self.speed = speed
            else:
                raise ValueError(f"unknown action {action}")
            self.publish(self.heartbeat())

    def rebuild(self, elapsed_ms: int) -> Rebuilt:
        """Pure rebuild from the immutable log (no session state touched; safe without the lock)."""
        elapsed_ms = max(0, min(int(elapsed_ms), self.duration_ms))
        mi = self.new_intelligence()
        studio = StudioDesk(self.package.world, self.package.match_id)
        cursor = 0
        while cursor < len(self.events) and self.events[cursor].elapsed_ms <= elapsed_ms:
            ev = self.events[cursor]
            mi.ingest(ev)
            self._studio_observe(ev, mi, studio)
            cursor += 1
        studio.advance(elapsed_ms)
        studio.drain()
        return Rebuilt(mi, studio, cursor, elapsed_ms)

    def seek(self, elapsed_ms: int, play_after: bool = False, stop: bool = False) -> None:
        """Rebuild outside the lock, swap in, then re-announce everything the session may see."""
        built = self.rebuild(elapsed_ms)
        with self.lock:
            self.intelligence, self.studio = built.intelligence, built.studio
            self.cursor, self.playhead_ms = built.cursor, built.playhead_ms
            if play_after:
                self.playing = True
            if stop:
                self.playing = False
            self.publish(StreamMessage("replay_reset", {
                "playhead_ms": self.playhead_ms, "cursor": self.cursor,
                "last_seq": self.events[self.cursor - 1].seq if self.cursor else -1,
            }))
            self.publish(self.state_message())
            for cand in self.intelligence.candidates:
                self.publish(self.candidate_message(cand))
            for card in self.intelligence.explainer.cards:
                self.publish(StreamMessage("decision", card.model_dump(mode="json"), id=card.decision_id))
            for sl in self.intelligence.storylines.storylines:
                self.publish(self.storyline_message(sl))
            for m in self.intelligence.moments:
                self.publish(self.moment_message(m))
            for sig in self.intelligence.signals.signals.values():
                self.publish(self.signal_message(sig))
            # insights after the reset so clients keep them; seeks never start new model work
            for cand in self.intelligence.candidates:
                self.on_candidate(self, cand, live=False)
            self.publish(self.overlay_snapshot())
            self.publish(self.heartbeat())

    def _studio_observe(self, ev: MatchEvent, mi: MatchIntelligence | None = None,
                        studio: StudioDesk | None = None) -> None:
        mi = mi or self.intelligence
        studio = studio or self.studio
        st = mi.state
        studio.on_event(ev, st.score, st.provisional_score)
        for card in mi.new_decisions:
            studio.offer_decision(card, ev.elapsed_ms)
        for cid in mi.new_retractions:
            studio.retract_source(f"I-{cid}", mi.retractions[cid])
        if ev.type == "period.ended":
            label = "Half-time" if ev.period == "H1" else "Full-time"
            studio.offer_stats(label, st.snapshot()["stats"], dict(st.score), ev.elapsed_ms)
        by_id = {m.moment_id: m for m in mi.new_moments}
        for sig in mi.new_signals:
            if sig.kind in ("record", "milestone") and sig.tier != "quiet":
                self._offer_record(studio, sig, ev.elapsed_ms)
                continue
            mid = sig.refs.get("moment_id")
            if sig.kind != "tactical" or not mid:
                continue
            if sig.status == "withdrawn":
                studio.retract_source(str(mid), sig.status_reason or "Withdrawn after an official correction.")
            elif sig.tier == "insight" and mid in by_id:
                m = by_id[mid]
                # broadcast plate: a short title and one plain sentence (the measurements stay in Review)
                title = m.title if len(m.title) <= 55 else f"{KIND_LABEL.get(m.kind, 'Tactics')} · {m.display_clock}"
                studio.offer_tactical(m.moment_id, title, str(m.extra.get("plain", m.summary)), m.team_id,
                                      m.evidence_event_ids, m.focus_player_ids, ev.elapsed_ms)

    def _offer_record(self, studio: StudioDesk, sig: Signal, now_ms: int, origin: Literal["auto", "producer"] = "auto",
                      ) -> OverlayPacket | None:
        if sig.status == "withdrawn":
            studio.retract_source(sig.signal_id, sig.status_reason or "Withdrawn after an official correction.")
            return None
        if sig.status != "live":
            return None
        pid = sig.refs.get("player_id") or sig.refs.get("subject_id")
        rule = sig.refs.get("rule")
        return studio.offer_record(sig.signal_id, sig.kind, sig.headline, sig.text.get("studio", sig.headline),
                                   sig.team_id, pid if isinstance(pid, str) and self.package.world.has_player(pid) else None,
                                   sig.evidence_event_ids, now_ms, rule if isinstance(rule, str) else None, origin)

    def propose(self, kind: str, ref: str | None) -> tuple[OverlayPacket, bool]:
        """A producer asks for a graphic from the analysis desk. Only what has already happened can be proposed."""
        mi, studio, now = self.intelligence, self.studio, self.playhead_ms
        made: OverlayPacket | None
        pid: str
        if kind == "tactical":
            pid = f"O-{ref}"
            m = next((x for x in mi.moments if x.moment_id == ref), None)
            if m is None:
                raise KeyError(ref)
            title = m.title if len(m.title) <= 55 else f"{KIND_LABEL.get(m.kind, 'Tactics')} · {m.display_clock}"
            made = studio.offer_tactical(m.moment_id, title, str(m.extra.get("plain", m.summary)), m.team_id,
                                         m.evidence_event_ids, m.focus_player_ids, now, origin="producer")
        elif kind == "context":
            sig = mi.signals.signals.get(ref or "")
            if sig is None or sig.kind not in ("record", "milestone", "context"):
                raise KeyError(ref)
            pid = f"O-{sig.signal_id}"
            made = self._offer_record(studio, sig, now, origin="producer")
        elif kind == "stats":
            st = mi.state
            label = "Full-time" if st.snapshot().get("finished") else "Match stats"
            made = studio.offer_stats(label, st.snapshot()["stats"], dict(st.score), now, origin="producer")
            pid = made.id if made else ""
        else:
            raise KeyError(kind)
        if made is not None:
            return made, False
        standing = studio.packets.get(pid)
        if standing is None or standing.status == "retracted":
            raise ValueError("withdrawn after an official correction; it cannot be proposed again")
        return standing, True

    def flush_studio(self) -> None:
        for p in self.studio.drain():
            self.publish(StreamMessage("overlay_update", p.model_dump(mode="json"), id=f"{p.id}-v{p.version}"))

    def overlay_snapshot(self) -> StreamMessage:
        return StreamMessage("overlay_update", {"snapshot": self.studio.snapshot()}, id="overlay-snapshot")

    def tick(self, dt_s: float) -> None:
        # never block the event loop on a session that a worker thread is updating
        if not self.lock.acquire(blocking=False):
            return
        try:
            self._tick(dt_s)
        finally:
            self.lock.release()

    def _tick(self, dt_s: float) -> None:
        if not self.playing:
            return
        self.playhead_ms = min(self.duration_ms, self.playhead_ms + int(dt_s * 1000 * self.speed))
        pushed_state = False
        while self.cursor < len(self.events) and self.events[self.cursor].elapsed_ms <= self.playhead_ms:
            ev = self.events[self.cursor]
            found = self.intelligence.ingest(ev)
            self.cursor += 1
            self.publish(StreamMessage("match_event", ev.to_json_dict(), id=str(ev.seq)))
            if ev.type in STATE_EVENT_TYPES:
                self.publish(self.state_message())
                pushed_state = True
            for cand in found:
                self.publish(self.candidate_message(cand))
                self.on_candidate(self, cand, live=True)
            for card in self.intelligence.new_decisions:
                self.publish(StreamMessage("decision", card.model_dump(mode="json"), id=card.decision_id))
            self._studio_observe(ev)
            for cid in self.intelligence.new_retractions:
                cand = next(c for c in self.intelligence.candidates if c.candidate_id == cid)
                self.publish(self.candidate_message(cand))
                self.on_retract(self, cand)
            for sl in self.intelligence.new_storylines:
                self.publish(self.storyline_message(sl, live=True))
            for m in self.intelligence.new_moments:
                self.publish(self.moment_message(m))
            for sig in self.intelligence.new_signals:
                self.publish(self.signal_message(sig))
        self.studio.advance(self.playhead_ms)
        self.flush_studio()
        now = time.monotonic()
        if not pushed_state and now - self._last_state_push > 2.0:
            self.publish(self.state_message())
        if self.cursor >= len(self.events):
            self.playing = False
            self.publish(self.heartbeat())

    def candidate_message(self, cand: PatternCandidate) -> StreamMessage:
        view = self.intelligence.candidate_view(cand)
        return StreamMessage("pattern_candidate", view.model_dump(mode="json"), id=f"{cand.candidate_id}-{view.status}")

    def storyline_message(self, sl: Storyline, live: bool = False) -> StreamMessage:
        return StreamMessage("storyline_update", self.storyline_view(self, sl, live),
                             id=f"{sl.storyline_id}-v{sl.version}")

    def moment_message(self, m: TacticalMoment) -> StreamMessage:
        return StreamMessage("tactical_moment", m.to_json(), id=m.moment_id)

    def signal_message(self, sig: Signal) -> StreamMessage:
        return StreamMessage("signal", sig.to_json(), id=f"{sig.signal_id}-v{sig.version}")

    def heartbeat(self) -> StreamMessage:
        return StreamMessage("heartbeat", {
            "playhead_ms": self.playhead_ms, "speed": self.speed, "playing": self.playing, "cursor": self.cursor,
            "duration_ms": self.duration_ms, "server_time": time.time(),
        })

    def state_message(self) -> StreamMessage:
        with self.lock:
            self._last_state_push = time.monotonic()
            snap = self.intelligence.state.snapshot()
            snap["playhead_ms"] = self.playhead_ms
        return StreamMessage("match_state", snap, id=f"state-{snap['seq']}")


class SessionManager:
    def __init__(self) -> None:
        self.sessions: dict[str, ReplaySession] = {}
        self._task: asyncio.Task[None] | None = None
        self._lock = threading.Lock()
        self.loop: asyncio.AbstractEventLoop | None = None
        self.on_candidate: CandidateSink = lambda s, c, live=True: None
        self.on_retract: CandidateSink = lambda s, c: None
        self.storyline_view: Callable[..., dict[str, Any]] = lambda s, sl, live=False: sl.to_json()

    def create(self, package: MatchPackage, speed: int = 12, client_key: str = "local") -> ReplaySession:
        with self._lock:
            self._gc_locked()
            mine = sorted((s for s in self.sessions.values() if s.client_key == client_key),
                          key=lambda s: s.last_touch)
            if len(mine) >= MAX_SESSIONS_PER_CLIENT:
                idle = [s for s in mine if not s.subscribers]
                if not idle:
                    raise SessionLimit("too many active sessions from this client")
                self.sessions.pop(idle[0].session_id, None)
            if len(self.sessions) >= MAX_SESSIONS:
                idle_all = sorted((s for s in self.sessions.values() if not s.subscribers),
                                  key=lambda s: s.last_touch)
                if not idle_all:
                    raise SessionLimit("server is at capacity")
                self.sessions.pop(idle_all[0].session_id, None)  # never evict a session someone is watching
            sid = secrets.token_urlsafe(12)
            sess = ReplaySession(sid, package,
                                 on_candidate=lambda s, c, live=True: self.on_candidate(s, c, live=live),
                                 on_retract=lambda s, c: self.on_retract(s, c),
                                 storyline_view=lambda s, sl, live=False: self.storyline_view(s, sl, live),
                                 speed=speed,
                                 client_key=client_key, loop=self.loop)
            self.sessions[sid] = sess
            return sess

    def get(self, sid: str) -> ReplaySession:
        return self.sessions[sid]

    def gc(self) -> None:
        with self._lock:
            self._gc_locked()

    def _gc_locked(self) -> None:
        now = time.monotonic()
        for sid in [s.session_id for s in list(self.sessions.values())
                    if not s.subscribers and now - s.last_touch > IDLE_TTL_S]:
            self.sessions.pop(sid, None)

    async def run(self) -> None:
        last = time.monotonic()
        while True:
            await asyncio.sleep(TICK_S)
            now = time.monotonic()
            dt, last = now - last, now
            for sess in list(self.sessions.values()):
                try:
                    sess.tick(dt)
                except Exception:  # noqa: BLE001 - one bad session must never stop every other match
                    log.exception("session %s tick failed; pausing it", sess.session_id)
                    sess.playing = False

    def start(self) -> None:
        if self._task is None:
            self.loop = asyncio.get_running_loop()
            self._task = asyncio.create_task(self.run())

    async def stop(self) -> None:
        if self._task is not None:
            self._task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._task
            self._task = None
