"""Deterministic realism pass over generated tracking (stage 2 of generation, not a display effect).

Stage 1 (engine.py) moves off-ball players "sprint to formation target, then stop", over-runs
(~16 km per player) and has an artefact where a failed cross leaves the intended target pinned in
the box for minutes. This pass rebuilds OFF-BALL movement while preserving every piece of evidence:

1. ENGAGED frames are untouched: any player within ENGAGED_S of an event that names them (actor,
   receiver, victim, opponent, goalkeeper, substitution) keeps the exact stage-1 position, so all
   event coordinates and tracking evidence (e.g. an overlapping run before a pass) are bit-for-bit
   identical. Detectors only read tracking for engaged players, so their outputs cannot change.
2. DISENGAGED frames follow a formation-anchored off-ball model: each player's anchor is their slot
   in the team shape, shifted with the ball and possession (lazier than stage 1), the nearest
   defender to the ball presses it, and movement is velocity-smoothed with jog/run speed limits.
   The path is computed forwards from the previous engaged position and backwards from the next
   one and cross-faded, so it leaves and rejoins the untouched windows continuously.
3. The ball is carried to restart spots during stoppages instead of appearing there.

Detectors and the UI both read the refined file, so what is displayed is what is analysed.
"""

from __future__ import annotations

import bisect
import math
from typing import Any

from byline.events.models import MatchEvent
from byline.world.models import World
from byline.world.seed_world import FORMATION_SLOTS

ENGAGED_S = 8.0
DT = 0.5
JOG_MS, RUN_MS, PRESS_MS = 2.2, 5.0, 5.5
ACCEL_TAU_S = 0.9
BALL_CARRY_MS = 9.0
PLAYER_KEYS = ("receiver_player_id", "victim_player_id", "opponent_player_id", "goalkeeper_id",
               "intended_receiver_player_id", "player_off_id", "player_on_id")
ON_BALL = {"pass.completed", "pass.failed", "carry", "shot", "interception", "ball_recovery", "tackle",
           "restart.taken", "kickoff", "penalty.taken", "save"}
L, W = 105.0, 68.0


def _engaged(events: list[MatchEvent]) -> dict[str, list[tuple[int, int]]]:
    out: dict[str, list[tuple[int, int]]] = {}
    w = int(ENGAGED_S * 1000)
    for ev in events:
        for pid in {ev.player_id, *(ev.payload.get(k) for k in PLAYER_KEYS)}:
            if isinstance(pid, str):
                out.setdefault(pid, []).append((ev.elapsed_ms - w, ev.elapsed_ms + w))
    return out


class MatchContext:
    """Per-time slot, attacking direction and possession reconstructed from the official events."""

    def __init__(self, world: World, events: list[MatchEvent]) -> None:
        self.formation = {t.team_id: t.formation for t in world.teams}
        self.slot_changes: list[tuple[int, str, str | None]] = []  # (t, pid, slot or None)
        self.dir_changes: list[tuple[int, dict[str, str]]] = []
        self.poss: list[tuple[int, str]] = []
        slot_of: dict[str, str] = {}
        for ev in events:
            if ev.type == "lineup.confirmed":
                for s in ev.payload["starters"]:
                    slot_of[s["player_id"]] = s["slot"]
                    self.slot_changes.append((ev.elapsed_ms, s["player_id"], s["slot"]))
            elif ev.type == "substitution":
                off, on = ev.payload["player_off_id"], ev.payload["player_on_id"]
                slot = slot_of.pop(off, None)
                self.slot_changes += [(ev.elapsed_ms, off, None), (ev.elapsed_ms, on, slot)]
                if slot:
                    slot_of[on] = slot
            elif ev.type in ("card.second_yellow", "card.red") and ev.player_id:
                slot_of.pop(ev.player_id, None)
                self.slot_changes.append((ev.elapsed_ms, ev.player_id, None))
            elif ev.type == "period.started":
                self.dir_changes.append((ev.elapsed_ms, dict(ev.payload["attacking_direction"])))
            if ev.type in ON_BALL and ev.team_id:
                self.poss.append((ev.elapsed_ms, ev.team_id))
        self._poss_t = [p[0] for p in self.poss]
        self._dir_t = [d[0] for d in self.dir_changes]

    def slot(self, pid: str, t: float) -> str | None:
        cur: str | None = None
        for tt, p, s in self.slot_changes:
            if tt > t:
                break
            if p == pid:
                cur = s
        return cur

    def direction(self, team: str, t: float) -> str:
        i = max(0, bisect.bisect_right(self._dir_t, t) - 1)
        return self.dir_changes[i][1][team] if self.dir_changes else "+x"

    def possession(self, t: float) -> str | None:
        i = bisect.bisect_right(self._poss_t, t) - 1
        return self.poss[i][1] if i >= 0 else None


def _att(d: str, x: float, y: float) -> tuple[float, float]:
    return (x, y) if d == "+x" else (L - x, W - y)


def _world(d: str, ax: float, ay: float) -> tuple[float, float]:
    ax, ay = min(L - 0.5, max(0.5, ax)), min(W - 0.5, max(0.5, ay))
    return (ax, ay) if d == "+x" else (L - ax, W - ay)


def anchor(formation: str, slot: str, d: str, in_pos: bool, ball: tuple[float, float]) -> tuple[float, float]:
    bax, bay = _att(d, *ball)
    if slot == "GK":
        return _world(d, 4.0 + max(0.0, bax - 35.0) * 0.1, 34.0 + (bay - 34.0) * 0.18)
    bx, by = FORMATION_SLOTS[formation].get(slot, (40.0, 34.0))
    shift = (bax - 50.0) * (0.5 if in_pos else 0.42) + (4.0 if in_pos else -3.0)
    if in_pos:
        ax = bx + shift
        ay = 34.0 + (by - 34.0) * 1.08 + (bay - 34.0) * 0.22
    else:
        # out of possession the block compresses (narrower and shorter) and slides towards the ball
        ax = 30.0 + (bx - 30.0) * 0.78 + shift
        ay = 34.0 + (by - 34.0) * 0.68 + (bay - 34.0) * 0.42
    if slot in ("RB", "LB", "RCB", "LCB"):
        ax = min(ax, 68.0)
    return _world(d, ax, ay)


def _follow(start: tuple[float, float], targets: list[tuple[float, float]], speeds: list[float]) -> list[tuple[float, float]]:
    """Velocity-smoothed pursuit of a moving target with per-frame speed limits."""
    x, y = start
    vx = vy = 0.0
    a = 1.0 - math.exp(-DT / ACCEL_TAU_S)
    out = []
    for (tx, ty), vmax in zip(targets, speeds, strict=True):
        dx, dy = tx - x, ty - y
        dist = math.hypot(dx, dy)
        want = 0.0 if dist < 0.6 else min(vmax, 0.6 * dist)
        dvx, dvy = (dx / dist * want, dy / dist * want) if dist > 1e-6 else (0.0, 0.0)
        vx += a * (dvx - vx)
        vy += a * (dvy - vy)
        x = min(L, max(0.0, x + vx * DT))
        y = min(W, max(0.0, y + vy * DT))
        out.append((x, y))
    return out


def refine(tracking: dict[str, Any], events: list[MatchEvent], world: World) -> dict[str, Any]:
    frames = [list(f) for f in tracking["frames"]]
    ents: list[str] = tracking["entities"]
    times = [float(f[0]) for f in frames]
    _carry_ball_to_restarts(frames, times, events)
    _centre_ball_for_kickoffs(frames, times, events)
    ctx = MatchContext(world, events)
    team_of = {p.player_id: t.team_id for t in world.teams for p in t.players}
    col = {pid: 4 + 2 * i for i, pid in enumerate(ents)}
    # nearest outfield defender to the ball presses it (taken from stage 1, where pressing is modelled)
    presser: list[str | None] = []
    for k, f in enumerate(frames):
        poss = ctx.possession(times[k])
        best, bd = None, 12.0
        for pid in ents:
            if pid == "REF" or f[col[pid]] is None or team_of.get(pid) in (poss, None):
                continue
            dd = math.hypot(f[col[pid]] - f[1], f[col[pid] + 1] - f[2])
            if dd < bd and ctx.slot(pid, times[k]) != "GK":
                best, bd = pid, dd
        presser.append(best)
    engaged = _engaged(events)
    for pid in ents:
        if pid == "REF":
            continue
        c = col[pid]
        team = team_of[pid]
        wins = engaged.get(pid, [])
        free = [f[c] is not None and not any(a <= times[k] <= b for a, b in wins) for k, f in enumerate(frames)]
        k = 0
        n = len(frames)
        while k < n:
            if not free[k]:
                k += 1
                continue
            s = k
            while k < n and free[k] and times[k] - times[k - 1 if k > s else k] <= 600:
                k += 1
            e = k  # [s, e) disengaged run
            if e - s < 3:
                continue
            tgts, spd = [], []
            for j in range(s, e):
                t = times[j]
                slot = ctx.slot(pid, t)
                ball = (float(frames[j][1]), float(frames[j][2]))
                if slot is None:
                    tgts.append((float(frames[j][c]), float(frames[j][c + 1])))
                    spd.append(JOG_MS)
                    continue
                d = ctx.direction(team, t)
                if presser[j] == pid:
                    ox, oy = _world(d, 0.0, 34.0)
                    dd = math.hypot(ox - ball[0], oy - ball[1]) or 1.0
                    tgts.append((ball[0] + (ox - ball[0]) / dd * 2.0, ball[1] + (oy - ball[1]) / dd * 2.0))
                    spd.append(PRESS_MS)
                    continue
                a = anchor(ctx.formation[team], slot, d, ctx.possession(t) == team, ball)
                px, py = float(frames[j][c]), float(frames[j][c + 1])
                tgts.append(a)
                spd.append(RUN_MS if math.hypot(a[0] - px, a[1] - py) > 12 else JOG_MS)
            start = (float(frames[s][c]), float(frames[s][c + 1]))
            if s > 0 and frames[s - 1][c] is not None and times[s] - times[s - 1] <= 600:
                start = (float(frames[s - 1][c]), float(frames[s - 1][c + 1]))
            # rejoin only a time-contiguous engaged frame (never across half-time or a substitution gap)
            rejoin = e < n and frames[e][c] is not None and times[e] - times[e - 1] <= 600
            fwd = _follow(start, tgts, spd)
            if rejoin:
                end = (float(frames[e][c]), float(frames[e][c + 1]))
                bwd = _follow(end, tgts[::-1], spd[::-1])[::-1]
            else:
                bwd = fwd
            m = e - s
            for i in range(m):
                wb = (i + 1) / (m + 1)  # cross-fade: leave from the previous window, rejoin the next
                wb = wb * wb * (3 - 2 * wb)
                x = fwd[i][0] * (1 - wb) + bwd[i][0] * wb
                y = fwd[i][1] * (1 - wb) + bwd[i][1] * wb
                frames[s + i][c], frames[s + i][c + 1] = round(x, 1), round(y, 1)
    return {**tracking, "frames": frames,
            "realism_pass": {"engaged_s": ENGAGED_S, "jog_ms": JOG_MS, "run_ms": RUN_MS, "press_ms": PRESS_MS,
                             "accel_tau_s": ACCEL_TAU_S, "ball_carry_ms": BALL_CARRY_MS}}


def _carry_ball_to_restarts(frames: list[list[Any]], times: list[float], events: list[MatchEvent]) -> None:
    """During a stoppage the ball travels to the restart spot instead of appearing there."""
    for idx, ev in enumerate(events):
        if ev.type != "restart.awarded":
            continue
        nxt = next((e.elapsed_ms for e in events[idx + 1:] if e.elapsed_ms > ev.elapsed_ms), None)
        i0 = bisect.bisect_left(times, ev.elapsed_ms)
        # the jump to the restart spot happens in one of the next frames: find the largest one
        cand = [j for j in range(max(1, i0), min(len(frames), i0 + 3)) if times[j] - times[j - 1] <= 600]
        if not cand:
            continue
        i = max(cand, key=lambda j: math.hypot(frames[j][1] - frames[j - 1][1], frames[j][2] - frames[j - 1][2]))
        x0, y0 = float(frames[i - 1][1]), float(frames[i - 1][2])
        x1, y1 = float(frames[i][1]), float(frames[i][2])
        d = math.hypot(x1 - x0, y1 - y0)
        if d < 3.0:
            continue
        n = max(1, math.ceil(d / (BALL_CARRY_MS * DT)))
        if nxt is not None:
            room = bisect.bisect_left(times, nxt) - i - 1
            n = max(1, min(n, room))
        for k in range(n):
            j = i + k
            if j >= len(frames) or (k > 0 and times[j] - times[j - 1] > 600):
                break
            f = (k + 1) / (n + 1) if k < n - 1 else 1.0
            if k < n - 1:
                frames[j][1], frames[j][2], frames[j][3] = (round(x0 + (x1 - x0) * f, 2),
                                                             round(y0 + (y1 - y0) * f, 2), 0.0)


def _centre_ball_for_kickoffs(frames: list[list[Any]], times: list[float], events: list[MatchEvent]) -> None:
    """Between a period starting and its kick-off the ball is dead on the centre spot."""
    for idx, ev in enumerate(events):
        if ev.type != "period.started":
            continue
        ko = next((e.elapsed_ms for e in events[idx + 1:] if e.type == "kickoff"), None)
        if ko is None:
            continue
        for j in range(bisect.bisect_left(times, ev.elapsed_ms), bisect.bisect_right(times, ko)):
            frames[j][1], frames[j][2], frames[j][3] = 52.5, 34.0, 0.0
