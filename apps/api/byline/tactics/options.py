"""Passing options at one instant: pure geometry, no probabilities.

For the player on the ball, every team-mate is measured against the opponents' real positions:
  * lane clearance: the closest opponent to the straight passing lane (excluding the last 1.5 m at
    the receiver, where a marker always stands close)
  * receiver space: distance from the receiver to the nearest opponent
  * progression: metres gained towards the opponent goal
  * opponents bypassed: opponent outfield players between the ball and the receiver (taken out of play)
  * offside position: ahead of the ball and the second-last opponent, in the opponent half
The rating is a deterministic category with published thresholds. It is not a pass success probability
and says nothing about what would have happened next.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any, Literal

from byline.tactics.frame import Frame, seg_distance

Rating = Literal["open", "contested", "blocked", "offside"]

# Published thresholds (metres)
OPEN_LANE_M = 3.0
OPEN_SPACE_M = 4.0
CONTESTED_LANE_M = 1.5
CONTESTED_SPACE_M = 2.0
MAX_PASS_M = 45.0
RECEIVER_ZONE_M = 1.5


@dataclass(frozen=True)
class PassOption:
    receiver_id: str
    x: float
    y: float
    distance_m: float
    progression_m: float
    lane_clearance_m: float
    lane_blocker_id: str | None
    lane_opponents: tuple[str, ...]  # every opponent within the contested distance of the lane
    receiver_space_m: float
    nearest_marker_id: str | None
    opponents_bypassed: int
    beyond_back_line: bool
    between_lines: bool
    offside_position: bool
    rating: Rating

    def to_json(self) -> dict[str, Any]:
        d = asdict(self)
        for k, v in d.items():
            if isinstance(v, float):
                d[k] = round(v, 1)
        return d


def options_for(frame: Frame, carrier_id: str, origin: tuple[float, float] | None = None) -> list[PassOption]:
    """Every team-mate as a passing option for `carrier_id`, best first (open > contested > blocked)."""
    carrier = frame.get(carrier_id)
    if carrier is None:
        return []
    team = carrier.team_id
    ox, oy = origin if origin is not None else (carrier.x, carrier.y)
    o_ax, _ = frame.att(team, ox, oy)
    opp = frame.opponents(team)
    opp_out = frame.opponents(team, outfield=True)
    defending = opp[0].team_id if opp else ""
    lines = frame.lines(defending, team) if defending else None
    out: list[PassOption] = []
    for mate in frame.team(team):
        if mate.pid == carrier_id or mate.gk:
            continue
        dist = ((mate.x - ox) ** 2 + (mate.y - oy) ** 2) ** 0.5
        if dist < 3 or dist > MAX_PASS_M:
            continue
        r_ax, _ = frame.att(team, mate.x, mate.y)
        lane, blocker = 99.0, None
        in_lane: list[tuple[float, str]] = []
        for o in opp:
            d, u = seg_distance(o.x, o.y, ox, oy, mate.x, mate.y)
            if u * dist > dist - RECEIVER_ZONE_M:
                continue  # the receiver's own marker is measured as space, not as a lane block
            if d < CONTESTED_LANE_M:
                in_lane.append((d, o.pid))
            if d < lane:
                lane, blocker = d, o.pid
        space, marker = 99.0, None
        for o in opp:
            d = ((o.x - mate.x) ** 2 + (o.y - mate.y) ** 2) ** 0.5
            if d < space:
                space, marker = d, o.pid
        bypassed = sum(1 for o in opp_out if o_ax < frame.att(team, o.x, o.y)[0] < r_ax)
        offside = bool(lines and r_ax > 52.5 and r_ax > o_ax and r_ax > lines.second_last_ax)
        beyond = bool(lines and r_ax > lines.back_ax and not offside)
        between = bool(lines and lines.mid_ax < r_ax < lines.back_ax)
        if offside:
            rating: Rating = "offside"
        elif lane >= OPEN_LANE_M and space >= OPEN_SPACE_M:
            rating = "open"
        elif lane >= CONTESTED_LANE_M and space >= CONTESTED_SPACE_M:
            rating = "contested"
        else:
            rating = "blocked"
        out.append(PassOption(mate.pid, mate.x, mate.y, dist, r_ax - o_ax, lane, blocker,
                              tuple(pid for _d, pid in sorted(in_lane)), space, marker, bypassed,
                              beyond, between, offside, rating))
    order = {"open": 0, "contested": 1, "blocked": 2, "offside": 3}
    return sorted(out, key=lambda o: (order[o.rating], -o.progression_m))


def option_value(o: PassOption) -> float:
    """Deterministic ordering for 'most dangerous available option' (documented, not a probability):
    progression and opponents taken out of play, only for open or contested lanes."""
    if o.rating not in ("open", "contested"):
        return -1.0
    return o.progression_m + 4.0 * o.opponents_bypassed + (6.0 if o.beyond_back_line else 0.0) + \
        (3.0 if o.between_lines else 0.0) - (4.0 if o.rating == "contested" else 0.0)
