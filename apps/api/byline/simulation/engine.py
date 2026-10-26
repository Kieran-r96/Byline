"""Deterministic lock-step football simulator.

Every player is a body that moves toward a target (formation shape, press, or an explicit
run) under a speed limit. Events are emitted from the bodies' actual positions, so the
event log and the 2 Hz tracking frames are physically consistent: a receiver is where the
pass ends, at the time it arrives.

Randomness flows only through ``self.rng`` (seeded) so the same seed yields byte-identical
output. Scenario beats (scenarios.py) steer play using the same primitives; they never write
labels into the event stream.
"""

from __future__ import annotations

import math
import random
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from byline.world.clock import minute_label
from byline.world.models import World
from byline.world.seed_world import FORMATION_SLOTS, bench, starting_slots

STEP_MS = 100
FRAME_MS = 500
L, W = 105.0, 68.0

LAW = {
    "throw_in": "Law 15", "goal_kick": "Law 16", "corner": "Law 17", "direct_free_kick": "Law 13",
    "indirect_free_kick": "Law 13", "penalty": "Law 14", "kickoff": "Law 8", "dropped_ball": "Law 8",
}


def clamp(v: float, lo: float, hi: float) -> float:
    return lo if v < lo else hi if v > hi else v


def dist(a: tuple[float, float], b: tuple[float, float]) -> float:
    return math.hypot(a[0] - b[0], a[1] - b[1])


@dataclass
class Body:
    pid: str
    team_id: str
    slot: str
    x: float = 52.5
    y: float = 34.0
    on_pitch: bool = False
    pin: tuple[float, float] | None = None
    pin_speed: float = 7.5
    index: int = 0


@dataclass
class Flight:
    sx: float
    sy: float
    ex: float
    ey: float
    t0: int
    dur: int
    apex: float


class Engine:
    def __init__(self, world: World, seed: int) -> None:
        self.world = world
        self.match_id = world.fixture.match_id
        self.rng = random.Random(seed)
        self.home = world.fixture.home_team_id
        self.away = world.fixture.away_team_id
        self.events: list[dict[str, Any]] = []
        self.frames: list[list[float | None]] = []
        self.t = 0
        self.next_frame_t = 0
        self.period = "PRE"
        self.period_start = 0
        self.dirs: dict[str, str] = {self.home: "+x", self.away: "-x"}
        self.possession = self.home
        self.owner: str | None = None
        self.ball = [52.5, 34.0, 0.0]
        self.flight: Flight | None = None
        self.bias: dict[str, tuple[float, float]] = {}
        self.yellow: set[str] = set()
        self.score = {self.home: 0, self.away: 0}
        self.bodies: dict[str, Body] = {}
        self.slots: dict[str, dict[str, str]] = {}
        order: list[str] = []
        for team in world.teams:
            self.slots[team.team_id] = starting_slots(team.team_id)
            slot_of = {pid: s for s, pid in self.slots[team.team_id].items()}
            for p in sorted(team.players, key=lambda p: p.shirt_number):
                order.append(p.player_id)
                self.bodies[p.player_id] = Body(
                    pid=p.player_id, team_id=team.team_id, slot=slot_of.get(p.player_id, "BENCH"),
                    on_pitch=p.player_id in slot_of, index=len(order),
                )
        self.entity_order = order
        self.ref = Body(pid="REF", team_id="", slot="REF", x=50.0, y=28.0, on_pitch=True)
        self.formation = {t.team_id: t.formation for t in world.teams}
        self.at_next_stoppage: list[Callable[[], None]] = []

    # ------------------------------------------------------------------ geometry

    def opp(self, team: str) -> str:
        return self.away if team == self.home else self.home

    def att(self, team: str, x: float, y: float) -> tuple[float, float]:
        return (x, y) if self.dirs[team] == "+x" else (L - x, W - y)

    def world_pt(self, team: str, ax: float, ay: float) -> tuple[float, float]:
        ax, ay = clamp(ax, 0.3, L - 0.3), clamp(ay, 0.3, W - 0.3)
        return (ax, ay) if self.dirs[team] == "+x" else (L - ax, W - ay)

    def pos(self, pid: str) -> tuple[float, float]:
        b = self.bodies[pid]
        return (b.x, b.y)

    def ball_att(self, team: str) -> tuple[float, float]:
        return self.att(team, self.ball[0], self.ball[1])

    def on_pitch(self, team: str) -> list[Body]:
        return [b for b in self.bodies.values() if b.on_pitch and b.team_id == team]

    def by_slot(self, team: str, slot: str) -> str | None:
        return self.slots[team].get(slot)

    def gk(self, team: str) -> str:
        pid = self.slots[team].get("GK")
        assert pid is not None
        return pid

    def nearest(self, team: str, pt: tuple[float, float], exclude: set[str] | None = None,
                no_gk: bool = False) -> Body:
        best: Body | None = None
        bd = 1e9
        for b in self.on_pitch(team):
            if exclude and b.pid in exclude:
                continue
            if no_gk and b.slot == "GK":
                continue
            d = dist((b.x, b.y), pt)
            if d < bd:
                best, bd = b, d
        assert best is not None
        return best

    def second_last_defender_ax(self, attacking_team: str) -> float:
        """Attacking-frame x of the second-last opponent (offside line, centre coordinates)."""
        xs = sorted((self.att(attacking_team, b.x, b.y)[0] for b in self.on_pitch(self.opp(attacking_team))),
                    reverse=True)
        return xs[1] if len(xs) > 1 else 52.5

    # ------------------------------------------------------------------ shape

    def formation_target(self, b: Body) -> tuple[float, float]:
        team = b.team_id
        bax, bay = self.ball_att(team)
        in_pos = self.possession == team
        if b.slot == "GK":
            ax = 4.0 + max(0.0, bax - 30.0) * 0.12
            ay = 34.0 + (bay - 34.0) * 0.2
            return self.world_pt(team, ax, ay)
        base = FORMATION_SLOTS[self.formation[team]].get(b.slot, (40.0, 34.0))
        shift = (bax - 50.0) * (0.6 if in_pos else 0.5) + (5.0 if in_pos else -3.0)
        ax = base[0] + shift
        ay = base[1] + (bay - 34.0) * (0.25 if in_pos else 0.4)
        if in_pos:
            ay = 34.0 + (ay - 34.0) * 1.15
            if b.slot in ("RW", "LW"):
                ax += 4.0
        if b.slot in ("RB", "LB", "RCB", "LCB"):
            ax = min(ax, 70.0)
        ph = b.index * 1.7
        ax += 1.4 * math.sin(self.t / 1000.0 * 0.31 + ph)
        ay += 1.1 * math.cos(self.t / 1000.0 * 0.27 + ph * 1.3)
        return self.world_pt(team, ax, ay)

    def kickoff_target(self, b: Body) -> tuple[float, float]:
        if b.slot == "GK":
            return self.world_pt(b.team_id, 5.0, 34.0)
        base = FORMATION_SLOTS[self.formation[b.team_id]].get(b.slot, (40.0, 34.0))
        return self.world_pt(b.team_id, min(base[0] * 0.8, 49.0), base[1])

    # ------------------------------------------------------------------ physics

    def _move(self, b: Body, tx: float, ty: float, vmax: float, dt: float) -> None:
        dx, dy = tx - b.x, ty - b.y
        d = math.hypot(dx, dy)
        if d < 1e-6:
            return
        speed = min(vmax, d * 1.6)
        step = min(d, speed * dt)
        b.x = clamp(b.x + dx / d * step, 0.0, L)
        b.y = clamp(b.y + dy / d * step, 0.0, W)

    def _step(self) -> None:
        dt = STEP_MS / 1000.0
        defending = self.opp(self.possession)
        ball_pt = (self.ball[0], self.ball[1])
        press: dict[str, tuple[float, float]] = {}
        if self.owner is not None and self.flight is None:
            presser = self.nearest(defending, ball_pt, no_gk=True)
            if presser.pin is None:
                press[presser.pid] = ball_pt
        for b in self.bodies.values():
            if not b.on_pitch:
                continue
            if b.pid == self.owner and b.pin is None:
                continue
            if b.pin is not None:
                self._move(b, b.pin[0], b.pin[1], b.pin_speed, dt)
            elif b.pid in press:
                tx, ty = press[b.pid]
                ox, oy = self.world_pt(defending, 0.0, 34.0)
                d = math.hypot(ox - tx, oy - ty) or 1.0
                self._move(b, tx + (ox - tx) / d * 1.8, ty + (oy - ty) / d * 1.8, 6.2, dt)
            else:
                tx, ty = self.formation_target(b)
                self._move(b, tx, ty, 4.4, dt)
        # referee shadows play on a diagonal
        rx = clamp(self.ball[0] - 9.0, 8.0, L - 8.0)
        ry = clamp(self.ball[1] + (9.0 if self.ball[1] < 34 else -9.0), 4.0, W - 4.0)
        self._move(self.ref, rx, ry, 5.5, dt)
        # ball
        if self.flight is not None:
            f = self.flight
            s = clamp((self.t - f.t0) / max(f.dur, 1), 0.0, 1.0)
            self.ball[0] = f.sx + (f.ex - f.sx) * s
            self.ball[1] = f.sy + (f.ey - f.sy) * s
            self.ball[2] = 4.0 * f.apex * s * (1.0 - s)
        elif self.owner is not None:
            ob = self.bodies[self.owner]
            fx, _ = self.world_pt(ob.team_id, 1.0, 34.0)
            lead = 0.7 if fx < L / 2 else -0.7
            self.ball[0] = clamp(ob.x + lead, 0.0, L)
            self.ball[1] = ob.y
            self.ball[2] = 0.0

    def _record_frame(self) -> None:
        row: list[float | None] = [float(self.t), round(self.ball[0], 2), round(self.ball[1], 2),
                                   round(self.ball[2], 1)]
        for pid in self.entity_order:
            b = self.bodies[pid]
            if b.on_pitch:
                row.extend((round(b.x, 1), round(b.y, 1)))
            else:
                row.extend((None, None))
        row.extend((round(self.ref.x, 1), round(self.ref.y, 1)))
        self.frames.append(row)

    def advance(self, ms: int) -> None:
        ms = max(STEP_MS, int(round(ms / STEP_MS)) * STEP_MS)
        end = self.t + ms
        while self.t < end:
            self.t += STEP_MS
            self._step()
            if self.t >= self.next_frame_t:
                self._record_frame()
                self.next_frame_t += FRAME_MS

    def teleport_all(self, fn: Callable[[Body], tuple[float, float]]) -> None:
        for b in self.bodies.values():
            if b.on_pitch:
                b.x, b.y = fn(b)
                b.pin = None

    # ------------------------------------------------------------------ events

    def emit(self, etype: str, team: str | None, player: str | None, payload: dict[str, Any],
             official: bool = False, correlation: str | None = None) -> str:
        seq = len(self.events)
        eid = f"E{seq:04d}"
        self.events.append({
            "schema_version": "1.0.0",
            "event_id": eid,
            "match_id": self.match_id,
            "seq": seq,
            "elapsed_ms": self.t,
            "period": self.period,
            "display_clock": minute_label(self.period, self.t - self.period_start)
            if self.period in ("H1", "H2") else self.period,
            "team_id": team,
            "player_id": player,
            "type": etype,
            "source": "synthetic_generator",
            "truth_status": "official_synthetic" if official else "observed_synthetic",
            "correlation_id": correlation,
            "payload": payload,
            "supersedes_event_id": None,
        })
        return eid

    @staticmethod
    def pt(p: tuple[float, float] | list[float]) -> dict[str, float]:
        return {"x_m": round(clamp(p[0], 0.0, L), 1), "y_m": round(clamp(p[1], 0.0, W), 1)}

    def ball_pt(self) -> dict[str, float]:
        return self.pt((self.ball[0], self.ball[1]))

    # ------------------------------------------------------------------ primitives

    def give(self, pid: str) -> None:
        self.owner = pid
        self.possession = self.bodies[pid].team_id
        self.flight = None
        b = self.bodies[pid]
        self.ball[0], self.ball[1], self.ball[2] = b.x, b.y, 0.0

    def hold(self, ms: int, drift: float = 1.2) -> None:
        """Owner keeps the ball for ms, drifting slightly forward."""
        if self.owner is None:
            self.advance(ms)
            return
        b = self.bodies[self.owner]
        ax, ay = self.att(b.team_id, b.x, b.y)
        b.pin = self.world_pt(b.team_id, ax + drift * ms / 1000.0, ay)
        b.pin_speed = 2.5
        self.advance(ms)
        b.pin = None

    def prepare_run(self, pid: str, target: tuple[float, float], max_ms: int = 4000, speed: float = 7.2) -> None:
        b = self.bodies[pid]
        need = dist((b.x, b.y), target) / speed * 1000.0
        b.pin, b.pin_speed = target, speed
        if need > 600:
            self.hold(int(min(need, max_ms)), drift=1.5)

    def pass_success_p(self, start: tuple[float, float], end: tuple[float, float], height: str) -> float:
        team = self.possession
        eax, _ = self.att(team, end[0], end[1])
        d = dist(start, end)
        p = 0.92 - 0.006 * max(0.0, d - 12.0)
        if eax > 70:
            p -= 0.08
        if eax > 88:
            p -= 0.10
        if height == "high":
            p -= 0.05
        nd = dist((self.nearest(self.opp(team), end).x, self.nearest(self.opp(team), end).y), end)
        if nd < 3.0:
            p -= 0.15
        return clamp(p, 0.35, 0.97)

    def pass_to(self, receiver: str, end: tuple[float, float] | None = None, kind: str = "open_play",
                height: str = "ground", success: bool | None = None, interceptor: str | None = None) -> str:
        """Play a pass from the current owner. Returns the pass event id."""
        passer = self.owner
        assert passer is not None and receiver != passer
        team = self.bodies[passer].team_id
        start = (self.ball[0], self.ball[1])
        rb = self.bodies[receiver]
        if end is None:
            rax, ray = self.att(team, rb.x, rb.y)
            end = self.world_pt(team, rax + self.rng.uniform(1.0, 4.0), ray)
        speed = {"ground": 15.0, "low": 17.0, "high": 19.0}[height]
        dur_s = clamp(dist(start, end) / speed + 0.15, 0.4, 3.2)
        reach = 7.0 * dur_s + 1.0
        dr = dist((rb.x, rb.y), end)
        if dr > reach:
            end = (rb.x + (end[0] - rb.x) * reach / dr, rb.y + (end[1] - rb.y) * reach / dr)
        end = (clamp(end[0], 0.5, L - 0.5), clamp(end[1], 0.5, W - 0.5))
        dur_s = clamp(dist(start, end) / speed + 0.15, 0.4, 3.2)
        opp_near_passer = self.nearest(self.opp(team), start)
        under_pressure = dist((opp_near_passer.x, opp_near_passer.y), start) < 3.0
        ok = success if success is not None else self.rng.random() < self.pass_success_p(start, end, height)
        apex = {"ground": 0.0, "low": 1.2, "high": 5.5}[height]
        if ok:
            eid = self.emit("pass.completed", team, passer, {
                "start": self.pt(start), "end": self.pt(end), "receiver_player_id": receiver,
                "height": height, "pass_kind": kind, "under_pressure": under_pressure,
            })
            self._fly(start, end, int(dur_s * 1000), apex)
            rb.pin, rb.pin_speed = end, 7.5
            self.advance(int(dur_s * 1000))
            rb.pin = None
            self.give(receiver)
            self._maybe_pressure(receiver)
            return eid
        return self._failed_pass(passer, team, start, end, receiver, dur_s, apex, height, kind, interceptor)

    def _failed_pass(self, passer: str, team: str, start: tuple[float, float], end: tuple[float, float],
                     receiver: str, dur_s: float, apex: float, height: str, kind: str,
                     interceptor: str | None) -> str:
        defending = self.opp(team)
        eax, eay = self.att(team, end[0], end[1])
        if interceptor is None and (eay < 5 or eay > 63) and self.rng.random() < 0.35:
            # over the touchline -> throw-in to the opponents
            out = self.world_pt(team, eax, 0.0 if eay < 34 else W)
            eid = self.emit("pass.failed", team, passer, {
                "start": self.pt(start), "end": self.pt(out), "intended_receiver_player_id": receiver,
                "outcome": "out_of_play", "height": height, "pass_kind": kind,
            })
            self._fly(start, out, int(dur_s * 1000), apex)
            self.advance(int(dur_s * 1000))
            self.owner = None
            self.restart("throw_in", defending, out, eid)
            return eid
        frac = self.rng.uniform(0.55, 0.92)
        ip = (start[0] + (end[0] - start[0]) * frac, start[1] + (end[1] - start[1]) * frac)
        ib = self.bodies[interceptor] if interceptor else self.nearest(defending, ip)
        eid = self.emit("pass.failed", team, passer, {
            "start": self.pt(start), "end": self.pt(ip), "intended_receiver_player_id": receiver,
            "outcome": "intercepted", "height": height, "pass_kind": kind,
        })
        t_ms = int(dur_s * frac * 1000)
        self._fly(start, ip, t_ms, apex * frac)
        ib.pin, ib.pin_speed = ip, 8.0
        self.advance(t_ms)
        ib.pin = None
        ib.x, ib.y = ip if dist((ib.x, ib.y), ip) < 2.5 else (ib.x, ib.y)
        self.give(ib.pid)
        self.emit("interception", defending, ib.pid, {"location": self.ball_pt(), "opponent_player_id": passer},
                  correlation=eid)
        return eid

    def _fly(self, start: tuple[float, float], end: tuple[float, float], dur_ms: int, apex: float) -> None:
        self.owner = None
        self.flight = Flight(start[0], start[1], end[0], end[1], self.t, max(dur_ms, STEP_MS), apex)

    def _maybe_pressure(self, receiver: str) -> None:
        team = self.bodies[receiver].team_id
        rp = self.pos(receiver)
        nb = self.nearest(self.opp(team), rp)
        if dist((nb.x, nb.y), rp) < 4.0 and self.rng.random() < 0.55:
            self.emit("pressure", nb.team_id, nb.pid, {"location": self.pt(rp), "opponent_player_id": receiver})

    def carry(self, target: tuple[float, float], speed: float = 5.2, tackle_risk: float = 0.0) -> bool:
        """Owner dribbles toward target. Returns False if dispossessed."""
        pid = self.owner
        assert pid is not None
        b = self.bodies[pid]
        start = (b.x, b.y)
        target = (clamp(target[0], 0.5, L - 0.5), clamp(target[1], 0.5, W - 0.5))
        d = dist(start, target)
        if tackle_risk > 0 and self.rng.random() < tackle_risk:
            frac = self.rng.uniform(0.3, 0.8)
            mid = (start[0] + (target[0] - start[0]) * frac, start[1] + (target[1] - start[1]) * frac)
            b.pin, b.pin_speed = mid, speed
            self.advance(int(d * frac / speed * 1000))
            b.pin = None
            tk = self.nearest(self.opp(b.team_id), (b.x, b.y), no_gk=True)
            if d * frac >= 3.0:
                self.emit("carry", b.team_id, pid, {"start": self.pt(start), "end": self.pt((b.x, b.y))})
            tk.pin, tk.pin_speed = (b.x, b.y), 8.0
            self.advance(300)
            tk.pin = None
            self.give(tk.pid)
            self.emit("tackle", tk.team_id, tk.pid, {"location": self.ball_pt(), "opponent_player_id": pid})
            return False
        if d >= 3.0:
            self.emit("carry", b.team_id, pid, {"start": self.pt(start), "end": self.pt(target)})
        b.pin, b.pin_speed = target, speed
        self.advance(int(d / speed * 1000))
        b.pin = None
        return True

    def shoot(self, outcome: str, body_part: str = "right_foot", situation: str = "open_play",
              assist: str | None = None, placement_ay: float | None = None) -> str:
        pid = self.owner
        assert pid is not None
        team = self.bodies[pid].team_id
        defending = self.opp(team)
        start = (self.ball[0], self.ball[1])
        gk = self.gk(defending)
        if outcome in ("goal", "entered_goal"):
            ay = placement_ay if placement_ay is not None else self.rng.choice([30.9, 31.4, 36.6, 37.1])
            end = self.world_pt(team, 104.9, ay)
        elif outcome == "saved":
            end = self.pos(gk)
        elif outcome == "off_target":
            end = self.world_pt(team, 104.9, self.rng.choice([27.0, 28.4, 39.6, 41.0]))
        elif outcome == "woodwork":
            end = self.world_pt(team, 104.9, 30.4)
        else:
            blocker = self.nearest(defending, start, no_gk=True)
            end = (blocker.x, blocker.y)
        sid = self.emit("shot", team, pid, {
            "location": self.pt(start), "end": self.pt(end), "outcome": outcome, "body_part": body_part,
            "situation": situation, "goalkeeper_id": gk,
        })
        dur = int(clamp(dist(start, end) / 24.0, 0.3, 1.6) * 1000)
        self._fly(start, end, dur, 1.4 if body_part != "head" else 0.6)
        if outcome == "saved":
            self.bodies[gk].pin, self.bodies[gk].pin_speed = end, 6.0
        self.advance(dur)
        self.bodies[gk].pin = None
        if outcome == "goal":
            self.emit("goal.provisional", team, pid, {
                "shot_event_id": sid, "location": self.pt(start), "assist_player_id": assist,
                "conceding_team_id": defending,
            }, official=True, correlation=sid)
            self.owner = None
        elif outcome == "saved":
            held = self.rng.random() < 0.55
            self.give(gk)
            self.emit("save", defending, gk, {"location": self.ball_pt(), "shot_event_id": sid, "held": held},
                      correlation=sid)
            if not held:
                self.owner = None
                corner_ay = 0.0 if self.att(team, start[0], start[1])[1] < 34 else W
                self.restart("corner", team, self.world_pt(team, L, corner_ay), sid)
        elif outcome == "entered_goal":
            # e.g. an indirect free kick into the goal untouched: no goal; goal kick (Law 13)
            self.owner = None
            self.restart("goal_kick", defending, self.world_pt(defending, 5.5, 34.0 + self.rng.choice([-9, 9])),
                         sid, law="Law 13 / Law 16")
        elif outcome in ("off_target", "woodwork"):
            self.owner = None
            self.restart("goal_kick", defending, self.world_pt(defending, 5.5, 34.0 + self.rng.choice([-9, 9])),
                         sid)
        else:
            blocker = self.nearest(defending, end, no_gk=True)
            if self.rng.random() < 0.5:
                self.owner = None
                corner_ay = 0.0 if self.att(team, start[0], start[1])[1] < 34 else W
                self.restart("corner", team, self.world_pt(team, L, corner_ay), sid)
            else:
                self.give(blocker.pid)
                self.emit("ball_recovery", defending, blocker.pid, {"location": self.ball_pt()}, correlation=sid)
        return sid

    def restart(self, rtype: str, team: str, loc: tuple[float, float], reason: str | None,
                taker: str | None = None, wait_ms: int | None = None, law: str | None = None) -> str:
        """Award + take a restart. Positions settle, taker walks to the ball, then restart.taken."""
        self.flight = None
        self.owner = None
        self.ball[0], self.ball[1], self.ball[2] = loc[0], loc[1], 0.0
        self.possession = team
        aid = self.emit("restart.awarded", None, None, {
            "restart_type": rtype, "awarded_to_team_id": team, "location": self.pt(loc), "reason_event_id": reason,
            "law_ref": law or LAW[rtype],
        }, official=True, correlation=reason)
        pending, self.at_next_stoppage = self.at_next_stoppage, []
        for action in pending:
            action()
        if taker is None:
            taker = self._default_taker(rtype, team, loc)
        tb = self.bodies[taker]
        tb.pin, tb.pin_speed = loc, 6.5
        need = dist((tb.x, tb.y), loc) / 6.0 * 1000
        base = {"throw_in": 3500, "goal_kick": 6000, "corner": 9000, "direct_free_kick": 7000,
                "indirect_free_kick": 6000, "penalty": 45000, "kickoff": 8000, "dropped_ball": 4000}[rtype]
        self.advance(int(max(need + 600, wait_ms if wait_ms is not None else base)))
        tb.pin = None
        tb.x, tb.y = loc
        self.give(taker)
        if rtype not in ("kickoff", "penalty"):
            self.emit("restart.taken", team, taker, {"restart_type": rtype, "location": self.pt(loc)},
                      correlation=aid)
        return aid

    def _default_taker(self, rtype: str, team: str, loc: tuple[float, float]) -> str:
        if rtype == "goal_kick":
            return self.gk(team)
        if rtype == "corner":
            _, ay = self.att(team, loc[0], loc[1])
            for slot in (("RW", "CAM", "RCM") if ay > 34 else ("LW", "CAM", "LCM")):
                pid = self.by_slot(team, slot)
                if pid:
                    return pid
        if rtype == "kickoff":
            return self.by_slot(team, "ST") or self.nearest(team, loc, no_gk=True).pid
        return self.nearest(team, loc, no_gk=True).pid

    # ------------------------------------------------------------------ phases

    def start_period(self, period: str, kickoff_team: str, planned_added: int) -> None:
        self.period = period
        self.period_start = self.t
        if period == "H2":
            self.dirs = {self.home: "-x", self.away: "+x"}
        self.emit("period.started", None, None, {"attacking_direction": dict(self.dirs),
                                                  "planned_added_minutes": planned_added})
        self.teleport_all(self.kickoff_target)
        self.kickoff(kickoff_team, "period_start")

    def kickoff(self, team: str, reason: str) -> None:
        st = self.by_slot(team, "ST") or self.nearest(team, (52.5, 34.0), no_gk=True).pid
        centre = (52.5, 34.0)
        self.possession = team
        for b in self.bodies.values():
            if b.on_pitch:
                b.pin, b.pin_speed = self.kickoff_target(b), 4.0
        self.bodies[st].pin = centre
        if reason == "after_goal":
            self.restart("kickoff", team, centre, None, taker=st, wait_ms=24000)
        else:
            self.advance(1500)
        for b in self.bodies.values():
            b.pin = None
        self.bodies[st].x, self.bodies[st].y = centre
        self.give(st)
        self.emit("kickoff", team, st, {"location": self.pt(centre), "reason": reason})
        mate = self.by_slot(team, "LDM") or self.by_slot(team, "DM") or self.nearest(team, centre, {st}).pid
        self.pass_to(mate, success=True)

    def end_period(self, added: int) -> None:
        self.flight = None
        # Announced added time is a minimum: the whistle keeps the true clock of the moment it is blown,
        # so it can never be stamped earlier than the play that preceded it.
        self.emit("period.ended", None, None, {"added_minutes": added})

    # ------------------------------------------------------------------ generic play

    def choose_receiver(self) -> str:
        owner = self.owner
        assert owner is not None
        team = self.possession
        bax, bay = self.ball_att(team)
        bias = self.bias.get(team)
        cands: list[tuple[str, float]] = []
        for b in self.on_pitch(team):
            if b.pid == owner or (b.slot == "GK" and bax > 35):
                continue
            cax, cay = self.att(team, b.x, b.y)
            d = dist((b.x, b.y), (self.ball[0], self.ball[1]))
            if d < 4.0 or d > 45.0:
                continue
            prog = cax - bax
            score = math.exp(-(((d - 16.0) / 14.0) ** 2))
            score *= (1.0 + 0.03 * prog) if prog > 0 else math.exp(0.035 * prog)
            od = min(dist((o.x, o.y), (b.x, b.y)) for o in self.on_pitch(self.opp(team)))
            score *= min(1.6, 0.35 + od / 6.0)
            if bax > 40 and abs(cay - 34.0) > 14:
                score *= 1.9  # width: most final-third entries in real football come via the flanks
            if b.slot == "ST" and bax < 60:
                score *= 0.6
            if bias is not None:
                target_ay, strength = bias
                score *= math.exp(-(((cay - target_ay) / 16.0) ** 2) * strength) * (1.0 + strength * 0.5)
            cands.append((b.pid, max(score, 1e-4)))
        if not cands:
            return self.nearest(team, (self.ball[0], self.ball[1]), {owner}).pid
        total = sum(s for _, s in cands)
        r = self.rng.random() * total
        for pid, s in cands:
            r -= s
            if r <= 0:
                return pid
        return cands[-1][0]

    def generic_action(self) -> None:
        if self.owner is None:
            nb = self.nearest(self.possession, (self.ball[0], self.ball[1]))
            self.give(nb.pid)
            self.emit("ball_recovery", nb.team_id, nb.pid, {"location": self.ball_pt()})
            return
        team = self.possession
        owner = self.owner
        ob = self.bodies[owner]
        bax, bay = self.ball_att(team)
        self.hold(self.rng.randint(5, 16) * 100)
        r = self.rng.random()
        if ob.slot == "GK":
            target = next((p for p in (self.by_slot(team, s) for s in ("RCB", "LCB", "RB", "LB")) if p),
                          self.choose_receiver())
            self.pass_to(target)
            return
        if bax > 86 and abs(bay - 34.0) < 18 and r < 0.17:
            self.shoot(self.rng.choices(["saved", "off_target", "blocked"], [0.38, 0.40, 0.22])[0],
                       body_part=self.rng.choice(["right_foot", "left_foot"]))
            return
        if bax > 76 and (bay < 16 or bay > 52) and r < 0.35:
            self.cross()
            return
        if r < 0.16 and bax < 85:
            step = self.rng.uniform(5.0, 13.0)
            if self.rng.random() < 0.04 and bax < 80:
                self.generic_foul()
                return
            self.carry(self.world_pt(team, bax + step, bay + self.rng.uniform(-4.0, 4.0)), tackle_risk=0.12)
            return
        self.pass_to(self.choose_receiver())

    def cross(self, target_pid: str | None = None, outcome: str | None = None, success: bool | None = None,
              assist_for_goal: bool = False) -> None:
        team = self.possession
        if target_pid is None:
            box = [b for b in self.on_pitch(team)
                   if b.slot in ("ST", "CAM", "LW", "RW", "LCM", "RCM") and b.pid != self.owner]
            target_pid = self.rng.choice(box).pid if box else self.choose_receiver()
        crosser = self.owner
        tgt = self.world_pt(team, self.rng.uniform(93.0, 99.0), self.rng.uniform(29.0, 39.0))
        self.prepare_run(target_pid, tgt, max_ms=2500)
        ok = success if success is not None else self.rng.random() < 0.42
        eid = self.pass_to(target_pid, end=tgt, kind="cross", height="high", success=ok)
        if self.possession == team and self.owner == target_pid:
            self.shoot(outcome or self.rng.choices(["saved", "off_target", "blocked"], [0.4, 0.45, 0.15])[0],
                       body_part="head", assist=crosser if assist_for_goal else None)
        _ = eid

    def generic_foul(self) -> None:
        """Careless foul in open play outside the penalty area: direct free kick, no card."""
        victim = self.owner
        assert victim is not None
        team = self.possession
        bax, _ = self.ball_att(team)
        if bax > 80:
            return
        offender = self.nearest(self.opp(team), self.pos(victim), no_gk=True)
        offender.pin, offender.pin_speed = self.pos(victim), 7.0
        self.advance(500)
        offender.pin = None
        fid = self.emit("foul.committed", offender.team_id, offender.pid, {
            "location": self.ball_pt(), "victim_player_id": victim,
            "foul_type": self.rng.choice(["trip", "push", "charge", "kick"]), "severity": "careless",
            "restart_type": "direct_free_kick", "in_offender_penalty_area": False,
        }, official=True)
        self.restart("direct_free_kick", team, (self.ball[0], self.ball[1]), fid, law="Law 12 / Law 13")

    def play_until(self, t_stop: int) -> None:
        while self.t < t_stop:
            self.generic_action()

    def gain_possession(self, team: str, max_ms: int = 120_000, own_half: bool = False) -> None:
        """Let natural play run until `team` has the ball (optionally in its own half)."""
        deadline = self.t + max_ms
        while self.t < deadline:
            if self.possession == team and self.owner is not None and                     (not own_half or self.ball_att(team)[0] < 52.5):
                return
            self.generic_action()
        if self.possession != team or self.owner is None:
            # force a natural interception by the nearest player
            receiver = self.choose_receiver() if self.owner else None
            if self.owner and receiver:
                ib = self.nearest(team, (self.ball[0], self.ball[1]), no_gk=True)
                self.pass_to(receiver, success=False, interceptor=ib.pid)
            else:
                nb = self.nearest(team, (self.ball[0], self.ball[1]))
                self.give(nb.pid)
                self.emit("ball_recovery", team, nb.pid, {"location": self.ball_pt()})

    def kick_out(self, over: str) -> str:
        """Owner's clearance goes out over the touchline ('touch') nearest the ball; returns pass id."""
        pid = self.owner
        assert pid is not None
        team = self.bodies[pid].team_id
        start = (self.ball[0], self.ball[1])
        out = (clamp(start[0] + self.rng.uniform(-6, 6), 2.0, L - 2.0), 0.0 if start[1] < W / 2 else W)
        eid = self.emit("pass.failed", team, pid, {
            "start": self.pt(start), "end": self.pt(out), "outcome": "out_of_play", "height": "low",
            "pass_kind": "open_play", "intended_receiver_player_id": None})
        self._fly(start, out, 900, 1.5)
        self.advance(900)
        self.owner = None
        _ = over
        return eid

    def injury_stoppage(self, injured: str) -> None:
        """Referee stops play for an injury with no offence; dropped ball to the team in possession (Law 8)."""
        team = self.possession
        loc = (self.ball[0], self.ball[1])
        self.emit("injury.stoppage", None, None, {"location": self.pt(self.pos(injured)), "player_id": injured},
                  official=True)
        self.owner = None
        self.restart("dropped_ball", team, loc, None, wait_ms=40_000)

    def substitute(self, team: str, off: str, on: str) -> None:
        ob, nb = self.bodies[off], self.bodies[on]
        slot = ob.slot
        ob.on_pitch, nb.on_pitch = False, True
        nb.slot, ob.slot = slot, "OFF"
        nb.x, nb.y = 52.5, W if self.dirs[team] == "+x" else 0.0
        self.slots[team][slot] = on
        if self.owner == off:
            self.owner = None
        self.emit("substitution", team, on, {"player_off_id": off, "player_on_id": on}, official=True)

    def dismiss(self, pid: str) -> None:
        b = self.bodies[pid]
        team = b.team_id
        b.on_pitch = False
        self.slots[team] = {s: p for s, p in self.slots[team].items() if p != pid}
        b.slot = "OFF"
        if self.owner == pid:
            self.owner = None

    def lineups(self) -> None:
        for team in (self.home, self.away):
            self.emit("lineup.confirmed", team, None, {
                "formation": self.formation[team],
                "starters": [{"player_id": pid, "slot": slot} for slot, pid in self.slots[team].items()],
                "bench": bench(team),
            }, official=True)


def tracking_header(engine: Engine) -> dict[str, Any]:
    return {
        "match_id": engine.match_id,
        "interval_ms": FRAME_MS,
        "layout": "t, ball_x, ball_y, ball_z, then x,y per entity (null when off pitch)",
        "entities": [*engine.entity_order, "REF"],
        "source": "synthetic",
        "precision": "player-centre, 0.1 m; not suitable for marginal offside adjudication",
    }
