"""The pitch at one instant: who is where, which way each team attacks, and where each team's lines sit.

Everything is read from the 2 Hz player-centre tracking and the event log; nothing is inferred about
intent. Positions are in world metres (105 x 68); `ax`/`ay` are the same point in a team's attacking frame.
"""

from __future__ import annotations

import bisect
import math
from collections.abc import Sequence
from dataclasses import dataclass, field
from typing import Any

from byline.events.models import MatchEvent
from byline.football.geometry import L, to_attacking
from byline.world.models import World


@dataclass(frozen=True)
class Body:
    pid: str
    team_id: str
    x: float
    y: float
    gk: bool


@dataclass
class Frame:
    t_ms: int
    ball: tuple[float, float, float]
    bodies: list[Body]
    directions: dict[str, str]  # team -> '+x' / '-x' in this period
    _by_id: dict[str, Body] = field(default_factory=dict)

    def __post_init__(self) -> None:
        self._by_id = {b.pid: b for b in self.bodies}

    def get(self, pid: str) -> Body | None:
        return self._by_id.get(pid)

    def team(self, team_id: str, outfield: bool = False) -> list[Body]:
        return [b for b in self.bodies if b.team_id == team_id and not (outfield and b.gk)]

    def opponents(self, team_id: str, outfield: bool = False) -> list[Body]:
        return [b for b in self.bodies if b.team_id != team_id and not (outfield and b.gk)]

    def att(self, team_id: str, x: float, y: float) -> tuple[float, float]:
        return to_attacking(self.directions[team_id], x, y)

    def lines(self, defending_team: str, attacking_team: str) -> DefensiveLines:
        """The defending team's shape seen from the attacking team's direction of play."""
        xs = sorted(self.att(attacking_team, b.x, b.y)[0] for b in self.team(defending_team, outfield=True))
        # deepest (highest attacking-x) first: back line, then midfield
        deep = sorted(xs, reverse=True)
        back = deep[:4]
        mid = deep[4:8]
        everyone = sorted((self.att(attacking_team, b.x, b.y)[0] for b in self.team(defending_team)), reverse=True)
        second_last = everyone[1] if len(everyone) > 1 else L
        return DefensiveLines(
            back_ax=sum(back) / len(back) if back else L,
            mid_ax=sum(mid) / len(mid) if mid else L / 2,
            last_outfield_ax=deep[0] if deep else L,
            second_last_ax=second_last,
            length_m=(deep[0] - deep[-1]) if deep else 0.0,
        )


@dataclass(frozen=True)
class DefensiveLines:
    back_ax: float  # mean attacking-x of the four deepest outfield defenders
    mid_ax: float  # mean of the next four
    last_outfield_ax: float
    second_last_ax: float  # the offside line (second-last opponent, goalkeeper included)
    length_m: float  # deepest to highest outfield player

    @property
    def gap_m(self) -> float:
        return self.back_ax - self.mid_ax


class Pitch:
    """Frame access for one match package (tracking + event log + world)."""

    def __init__(self, world: World, events: Sequence[MatchEvent], tracking: dict[str, Any]) -> None:
        self.world = world
        self.frames: list[list[Any]] = tracking["frames"]
        self.times = [int(f[0]) for f in self.frames]
        self.entities: list[str] = tracking["entities"]
        self.team_of: dict[str, str] = {p.player_id: t.team_id for t in world.teams for p in t.players}
        self.gk: set[str] = {p.player_id for t in world.teams for p in t.players if p.position == "GK"}
        self.periods = [(e.elapsed_ms, dict(e.payload["attacking_direction"]))
                        for e in events if e.type == "period.started"]

    def directions(self, t_ms: int) -> dict[str, str]:
        dirs = self.periods[0][1] if self.periods else {}
        for start, d in self.periods:
            if t_ms >= start:
                dirs = d
        return dirs

    def at(self, t_ms: int) -> Frame | None:
        """The nearest tracking frame at or before t (2 Hz, so within 0.5 s)."""
        i = bisect.bisect_right(self.times, t_ms) - 1
        if i < 0:
            return None
        row = self.frames[i]
        bodies = []
        for k, pid in enumerate(self.entities):
            x, y = row[4 + 2 * k], row[5 + 2 * k]
            if pid == "REF" or x is None or y is None or pid not in self.team_of:
                continue
            bodies.append(Body(pid, self.team_of[pid], float(x), float(y), pid in self.gk))
        bx, by, bz = row[1], row[2], row[3]
        ball = (float(bx) if bx is not None else math.nan, float(by) if by is not None else math.nan,
                float(bz or 0.0))
        return Frame(int(row[0]), ball, bodies, self.directions(t_ms))

    def window(self, start_ms: int, end_ms: int, step_ms: int = 500) -> list[Frame]:
        out = []
        t = start_ms
        while t <= end_ms:
            f = self.at(t)
            if f is not None:
                out.append(f)
            t += step_ms
        return out


def seg_distance(px: float, py: float, ax: float, ay: float, bx: float, by: float) -> tuple[float, float]:
    """Distance from P to segment AB, and how far along AB (0..1) the closest point lies."""
    dx, dy = bx - ax, by - ay
    n = dx * dx + dy * dy
    if n == 0:
        return math.hypot(px - ax, py - ay), 0.0
    u = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / n))
    return math.hypot(px - (ax + u * dx), py - (ay + u * dy)), u
