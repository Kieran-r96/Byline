"""D3: overlapping run on a flank, evidenced by tracking frames, linked to a chance.

At the moment a team-mate passes to a wide runner, look back over the preceding frames
(never ahead): the runner must start behind the passer, finish ahead of and wider than them
on the same flank, and cover ground at running speed. Only when a cross or shot follows within
a few seconds is a candidate raised. With no tracking the detector abstains.
"""

from __future__ import annotations

import bisect
import math
from dataclasses import dataclass
from typing import Any

from byline.events.models import MatchEvent
from byline.football.detectors.base import FrameInterval, PatternCandidate
from byline.football.geometry import to_attacking
from byline.match_state.reducer import MatchState


@dataclass(frozen=True)
class D3Config:
    lookback_ms: int = 6_000
    min_frames: int = 6
    behind_m: float = 1.5
    ahead_m: float = 3.0
    min_run_m: float = 12.0
    min_speed_ms: float = 5.0
    wide_from_centre_m: float = 17.0
    chance_window_ms: int = 9_000
    cooldown_ms: int = 5 * 60_000


@dataclass
class PendingOverlap:
    team_id: str
    pass_event: MatchEvent
    runner_id: str
    carrier_id: str
    start_ms: int
    metrics: dict[str, float | int | str | bool]


class TrackingIndex:
    def __init__(self, tracking: dict[str, Any]) -> None:
        self.frames: list[list[float | None]] = tracking["frames"]
        self.times = [int(f[0]) for f in self.frames]
        self.col = {pid: 4 + 2 * i for i, pid in enumerate(tracking["entities"])}

    def window(self, start_ms: int, end_ms: int) -> list[list[float | None]]:
        lo = bisect.bisect_left(self.times, start_ms)
        hi = bisect.bisect_right(self.times, end_ms)
        return self.frames[lo:hi]

    def pos(self, row: list[float | None], pid: str) -> tuple[float, float] | None:
        c = self.col.get(pid)
        if c is None or row[c] is None:
            return None
        return float(row[c]), float(row[c + 1])  # type: ignore[arg-type]


class OverlapDetector:
    pattern_type = "overlap"

    def __init__(self, tracking: dict[str, Any] | None, config: D3Config | None = None) -> None:
        self.cfg = config or D3Config()
        self.index = TrackingIndex(tracking) if tracking else None
        self.pending: list[PendingOverlap] = []
        self.last_fired: dict[str, int] = {}
        self.runs_without_chance = 0

    def observe(self, ev: MatchEvent, state: MatchState) -> list[PatternCandidate]:
        if self.index is None:
            return []  # DET-07: no positional frames -> never assert an overlap
        self.pending = [p for p in self.pending if ev.elapsed_ms - p.pass_event.elapsed_ms <= self.cfg.chance_window_ms]
        if ev.type == "pass.completed" and ev.team_id in state.attacking_direction:
            found = self._check_pass(ev, state)
            if found is not None:
                self.pending.append(found)
            if ev.payload.get("pass_kind") != "cross":
                return []
        if ev.type not in ("shot", "pass.completed") or not ev.team_id:
            return []
        is_chance = ev.type == "shot" or (ev.payload.get("pass_kind") == "cross")
        if not is_chance:
            return []
        for p in list(self.pending):
            if p.team_id == ev.team_id and ev.seq > p.pass_event.seq:
                self.pending.remove(p)
                return self._candidate(p, ev, state)
        return []

    def _check_pass(self, ev: MatchEvent, state: MatchState) -> PendingOverlap | None:
        assert self.index is not None and ev.team_id and ev.player_id
        cfg = self.cfg
        team, carrier, runner = ev.team_id, ev.player_id, ev.payload["receiver_player_id"]
        d = state.attacking_direction[team]
        rows = self.index.window(ev.elapsed_ms - cfg.lookback_ms, ev.elapsed_ms)
        if len(rows) < cfg.min_frames:
            return None
        track: list[tuple[int, tuple[float, float], tuple[float, float]]] = []
        for r in rows:
            rp, cp = self.index.pos(r, runner), self.index.pos(r, carrier)
            if rp is None or cp is None:
                return None
            track.append((int(r[0]), to_attacking(d, *rp), to_attacking(d, *cp)))  # type: ignore[arg-type]
        (t0, r0, c0), (t1, r1, c1) = track[0], track[-1]
        flank = 1 if r1[1] > 34 else -1
        if (r1[1] - 34) * flank < cfg.wide_from_centre_m or (c1[1] - 34) * flank < 8.0:
            return None  # both must be on the same flank, runner in the wide corridor
        if not (r0[0] < c0[0] - cfg.behind_m and r1[0] > c1[0] + cfg.ahead_m):
            return None  # runner starts behind the carrier and finishes ahead
        if (r1[1] - 34) * flank <= (c1[1] - 34) * flank:
            return None  # runner passes on the outside
        run = sum(math.dist(a[1], b[1]) for a, b in zip(track, track[1:], strict=False))
        secs = (t1 - t0) / 1000.0
        speed = run / secs if secs > 0 else 0.0
        if run < cfg.min_run_m or speed < cfg.min_speed_ms:
            return None
        return PendingOverlap(team, ev, runner, carrier, t0, {
            "runner_distance_m": round(run, 1), "runner_mean_speed_ms": round(speed, 1),
            "runner_start_behind_m": round(c0[0] - r0[0], 1), "runner_finish_ahead_m": round(r1[0] - c1[0], 1),
            "run_seconds": round(secs, 1), "flank": "right" if flank == 1 else "left",
            "frames_used": len(track), "tracking_precision": "player-centre synthetic, 2 Hz",
        })

    def _candidate(self, p: PendingOverlap, chance: MatchEvent, state: MatchState) -> list[PatternCandidate]:
        last = self.last_fired.get(p.team_id)
        if last is not None and chance.elapsed_ms - last < self.cfg.cooldown_ms:
            return []
        self.last_fired[p.team_id] = chance.elapsed_ms
        w = state.world
        team_name = w.team(p.team_id).name
        runner, carrier = w.player(p.runner_id), w.player(p.carrier_id)
        chance_kind = "shot" if chance.type == "shot" else "cross"
        metrics = {**p.metrics, "chance_type": chance_kind,
                   "seconds_pass_to_chance": round((chance.elapsed_ms - p.pass_event.elapsed_ms) / 1000.0, 1)}
        summary = (f"{team_name}: #{runner.shirt_number} {runner.display_name} ran from {p.metrics['runner_start_behind_m']} m "
                   f"behind #{carrier.shirt_number} {carrier.display_name} to {p.metrics['runner_finish_ahead_m']} m "
                   f"ahead on the outside of the {p.metrics['flank']} flank ({p.metrics['runner_distance_m']} m in "
                   f"{p.metrics['run_seconds']} s), received the pass, and a {chance_kind} followed.")
        evidence = [p.pass_event.event_id, chance.event_id]
        return [PatternCandidate(
            candidate_id=f"P-D3-{p.team_id}-{chance.seq:04d}",
            match_id=state.match_id, pattern_type="overlap", team_id=p.team_id,
            detected_at_seq=chance.seq, detected_at_ms=chance.elapsed_ms,
            display_clock=chance.display_clock or state.minute(),
            window_start_ms=p.start_ms, window_end_ms=chance.elapsed_ms,
            evidence_event_ids=tuple(evidence),
            frame_intervals=(FrameInterval(start_ms=p.start_ms, end_ms=p.pass_event.elapsed_ms),),
            calculated_metrics=metrics,
            score_components={"run": min(1.0, float(p.metrics["runner_distance_m"]) / 30.0),
                              "chance": 1.0 if chance_kind == "shot" else 0.7},
            score=0.7 if chance_kind == "shot" else 0.55,
            confidence_band="supported",
            novelty_key=f"overlap:{p.team_id}:{p.pass_event.event_id}",
            factual_summary=summary,
            allowed_claims=(
                "A possible overlapping run: the runner went from behind to ahead of the carrier on the outside "
                "and then received the ball.",
                "The overlap was followed by a chance (cross or shot).",
            ),
            unsupported_claims=(
                "Whether the run was rehearsed or instructed.",
                "What any defender intended or whether a defender was at fault.",
                "Exact body positions (tracking is player-centre only).",
            ),
            explanation_constraints=(
                "Derived from synthetic 2 Hz player-centre tracking over the 6 s before the pass, never later frames.",
                "Classified as a possible overlapping run; 'contributed to the chance' only because a cross or "
                "shot followed within 9 s.",
            ),
        )]
