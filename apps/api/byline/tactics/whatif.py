"""Tactical What If?: the decision instant, what actually happened, and one or two real alternatives.

Constrained by design:
  * history comes only from the event log and the tracking frame at the decision instant
  * alternatives are passing options measured on that same frame (lanes, markers, space, progression)
  * nothing after the instant is generated: no invented movement, no outcome, no probability

Simulated continuations (additive): for each alternative, the receiver is assumed to have the ball at
their frozen position while every other player stays exactly where the frame has them. From that same
frame only, three geometric checks are made: the next passes on (the options geometry again), a shooting
window (distance, the goal-mouth angle, opponents inside the ball-to-posts triangle) and a crossing option
(a wide channel in the final third with team-mates in the penalty area). Each item carries its
measurements and a label saying it is simulated. No outcome, probability or "what would happen" is given.
"""

from __future__ import annotations

import math
from typing import Any

from byline.events.models import MatchEvent
from byline.football.geometry import FINAL_THIRD_AX, L, W, in_penalty_area
from byline.tactics.frame import Body, Frame, Pitch, seg_distance
from byline.tactics.moments import TacticalMoment
from byline.tactics.options import (
    CONTESTED_LANE_M,
    CONTESTED_SPACE_M,
    OPEN_LANE_M,
    OPEN_SPACE_M,
    PassOption,
    option_value,
    options_for,
)
from byline.world.models import World

MAX_ALTERNATIVES = 2

# ---- simulated continuations: published thresholds
CONTINUATION_LABEL = ("Simulated continuation: a possible next action from the frozen positions. "
                      "Not what happened; everyone else is assumed still; no outcome is implied.")
MAX_NEXT_PASSES = 2  # per alternative receiver, best first by option_value
NEXT_PASS_MIN_PROGRESS_M = 0.0  # a continuation keeps the attack going: square or forward passes only
SHOT_MAX_DISTANCE_M = 25.0  # ball to the centre of the goal
SHOT_MIN_ANGLE_DEG = 12.0  # the angle the goal mouth (post to post) makes at the ball
SHOT_MAX_OUTFIELD_IN_TRIANGLE = 1  # outfield opponents inside the ball-to-posts triangle
GOAL_HALF_WIDTH_M = 7.32 / 2
WIDE_CHANNEL_M = 13.84  # wide channel: outside the width of the penalty area (touchline to box edge)


def _world_x(direction: str, ax: float) -> float:
    return ax if direction == "+x" else L - ax


def _players(frame: Frame, world: World) -> list[dict[str, Any]]:
    out = []
    for b in frame.bodies:
        p = world.player(b.pid)
        out.append({"pid": b.pid, "team_id": b.team_id, "x": round(b.x, 1), "y": round(b.y, 1), "gk": b.gk,
                    "number": p.shirt_number, "name": p.family_name})
    return out


def _option(o: PassOption, frame: Frame, team: str, origin: tuple[float, float]) -> dict[str, Any]:
    """An option as JSON, with the ids of the opponents it bypasses: the outfield opponents between the
    ball and the receiver along the attack (the same players `opponents_bypassed` counts)."""
    d = o.to_json()
    o_ax = frame.att(team, origin[0], origin[1])[0]
    r_ax = frame.att(team, o.x, o.y)[0]
    d["bypassed_ids"] = [b.pid for b in frame.opponents(team, outfield=True)
                         if o_ax < frame.att(team, b.x, b.y)[0] < r_ax]
    d["value"] = round(option_value(o), 1)
    return d


# ---------------------------------------------------------------- simulated continuations


def _world_point(direction: str, ax: float, ay: float) -> list[float]:
    x, y = (ax, ay) if direction == "+x" else (L - ax, W - ay)
    return [round(x, 2), round(y, 2)]


def _in_triangle(p: tuple[float, float], a: tuple[float, float], b: tuple[float, float],
                 c: tuple[float, float]) -> bool:
    """Point in triangle (edges count as inside)."""
    def side(p1: tuple[float, float], p2: tuple[float, float], p3: tuple[float, float]) -> float:
        return (p1[0] - p3[0]) * (p2[1] - p3[1]) - (p2[0] - p3[0]) * (p1[1] - p3[1])
    d1, d2, d3 = side(p, a, b), side(p, b, c), side(p, c, a)
    has_neg = d1 < 0 or d2 < 0 or d3 < 0
    has_pos = d1 > 0 or d2 > 0 or d3 > 0
    return not (has_neg and has_pos)


def shooting_window(frame: Frame, team: str, x: float, y: float) -> dict[str, Any] | None:
    """The shot from (x, y) at the opponent goal, measured on the frame. Returned only when the published
    thresholds hold: close enough, a wide enough goal mouth, at most one outfield opponent in the way."""
    ax, ay = frame.att(team, x, y)
    if ax >= L:
        return None
    gx, gy = L, W / 2
    p1, p2 = (gx, gy - GOAL_HALF_WIDTH_M), (gx, gy + GOAL_HALF_WIDTH_M)
    dist = math.hypot(gx - ax, gy - ay)
    angle = math.degrees(abs(math.atan2(p2[1] - ay, p2[0] - ax) - math.atan2(p1[1] - ay, p1[0] - ax)))
    inside = [b for b in frame.opponents(team) if _in_triangle(frame.att(team, b.x, b.y), (ax, ay), p1, p2)]
    outfield = sorted(b.pid for b in inside if not b.gk)
    keeper = next((b for b in frame.opponents(team) if b.gk), None)
    if dist > SHOT_MAX_DISTANCE_M or angle < SHOT_MIN_ANGLE_DEG or len(outfield) > SHOT_MAX_OUTFIELD_IN_TRIANGLE:
        return None
    d = frame.directions[team]
    return {
        "goal_centre": _world_point(d, gx, gy),
        "posts": [_world_point(d, *p1), _world_point(d, *p2)],
        "distance_m": round(dist, 1),
        "angle_deg": round(angle, 1),
        "defenders_in_triangle": outfield,
        "goalkeeper_id": keeper.pid if keeper else None,
        "goalkeeper": [round(keeper.x, 1), round(keeper.y, 1)] if keeper else None,
        "goalkeeper_in_triangle": bool(keeper and any(b.pid == keeper.pid for b in inside)),
    }


def crossing_option(frame: Frame, team: str, pid: str, x: float, y: float) -> dict[str, Any] | None:
    """A cross from (x, y): only from a wide channel inside the final third, and only when at least one
    team-mate stands onside in the penalty area. Lists each target and the distance to their nearest marker."""
    ax, ay = frame.att(team, x, y)
    if ax < FINAL_THIRD_AX or WIDE_CHANNEL_M < ay < W - WIDE_CHANNEL_M:
        return None
    opp = frame.opponents(team)
    defending = opp[0].team_id if opp else ""
    second_last = frame.lines(defending, team).second_last_ax if defending else L
    targets: list[dict[str, Any]] = []
    offside: list[str] = []
    for mate in frame.team(team):
        if mate.pid == pid or mate.gk:
            continue
        max_, may = frame.att(team, mate.x, mate.y)
        if not in_penalty_area(max_, may):
            continue
        if max_ > ax and max_ > second_last:
            offside.append(mate.pid)
            continue
        marker = min(opp, key=lambda o: (math.hypot(o.x - mate.x, o.y - mate.y), o.pid), default=None)
        targets.append({
            "pid": mate.pid, "x": round(mate.x, 1), "y": round(mate.y, 1),
            "nearest_marker_id": marker.pid if marker else None,
            "marker_distance_m": round(math.hypot(marker.x - mate.x, marker.y - mate.y), 1) if marker else None,
        })
    if not targets:
        return None
    targets.sort(key=lambda t: (-(t["marker_distance_m"] or 0.0), t["pid"]))
    return {"channel": "left" if ay <= WIDE_CHANNEL_M else "right", "targets": targets,
            "offside_ids": sorted(offside)}


def next_passes(frame: Frame, team: str, pid: str, exclude: set[str]) -> list[PassOption]:
    """The best open or contested square/forward passes for `pid` on the same frame."""
    opts = [o for o in options_for(frame, pid) if o.receiver_id not in exclude
            and o.rating in ("open", "contested") and o.progression_m >= NEXT_PASS_MIN_PROGRESS_M]
    return sorted(opts, key=lambda o: (-option_value(o), o.receiver_id))[:MAX_NEXT_PASSES]


def build_continuations(frame: Frame, team: str, carrier_id: str, alternatives: list[PassOption]) -> list[dict[str, Any]]:
    """Simulated continuations for each alternative receiver, from the frozen frame only (no look-ahead).
    Returns [] when the geometry supports nothing."""
    out: list[dict[str, Any]] = []
    for alt in alternatives:
        body = frame.get(alt.receiver_id)
        if body is None or alt.offside_position:
            continue
        base: dict[str, Any] = {"from_id": body.pid, "from": [round(body.x, 1), round(body.y, 1)],
                                "label": CONTINUATION_LABEL}
        shot = shooting_window(frame, team, body.x, body.y)
        if shot:
            out.append({"kind": "shot", **base, "shot": shot})
        cross = crossing_option(frame, team, body.pid, body.x, body.y)
        if cross:
            out.append({"kind": "cross", **base, "cross": cross})
        for rank, o in enumerate(next_passes(frame, team, body.pid, {carrier_id}), 1):
            out.append({"kind": "pass", **base, "pass": {**_option(o, frame, team, (body.x, body.y)), "rank": rank}})
    return out


# ---------------------------------------------------------------- illustrative continuation (moving players)

ILLUSTRATIVE_LABEL = ("Illustrative: one way the play could continue, sketched with simple stated rules from the "
                      "frozen positions. Not what happened and not a prediction; no outcome is implied.")
PASS_SPEED_MPS = 16.0  # the alternative pass: average ball speed
CONTROL_S = 1.0  # the receiver controls and looks up before playing the ball in
PLAYER_SPEED_MPS = 7.0  # every mover, attacker or defender, runs at this speed
REACTION_S = 0.3  # defenders start moving this long after each ball is played (the runner goes with the pass)
DELIVERY_SPEED_MPS = 18.0  # the ball in from the wing: average ball speed
ONSIDE_MARGIN_M = 0.5  # the run stops this far short of the offside line, which is held where it stood
MIN_RUN_M = 3.0  # shorter than this is not a run worth drawing
CLOSE_GAP_M = 1.5  # the defender closing the receiver aims to stand this far away, goal-side
TRACK_GAP_M = 1.0  # the defender tracking the runner aims to stand this far away, goal-side
REACH_M = 1.0  # a defender can touch the ball this far from where they stand
BLOCK_ZONE_M = 3.0  # the ball is low for its first 3 m (a block) and in the air until the delivery point
PENALTY_SPOT_AX = L - 11.0


def _unit(dx: float, dy: float) -> tuple[float, float, float]:
    n = math.hypot(dx, dy)
    return (dx / n, dy / n, n) if n > 1e-9 else (0.0, 0.0, 0.0)


def _move(start: tuple[float, float], target: tuple[float, float], seconds: float) -> tuple[tuple[float, float], bool]:
    """Straight-line move at PLAYER_SPEED_MPS for `seconds`: the end point and whether the target was reached."""
    ux, uy, n = _unit(target[0] - start[0], target[1] - start[1])
    step = PLAYER_SPEED_MPS * max(0.0, seconds)
    if step >= n:
        return target, True
    return (start[0] + ux * step, start[1] + uy * step), False


def _goal_side(of: tuple[float, float], gap: float) -> tuple[float, float]:
    """The point `gap` metres from `of` towards the centre of the goal being attacked (attacking coordinates)."""
    ux, uy, _ = _unit(L - of[0], W / 2 - of[1])
    return of[0] + ux * gap, of[1] + uy * gap


def illustrative_sequence(frame: Frame, team: str, carrier_id: str, origin: tuple[float, float],
                          alt: PassOption) -> dict[str, Any] | None:
    """One illustrative way the best alternative could continue, from the frozen frame and stated constants only.

    Sketched only when the alternative receiver is in a crossing position (a wide channel in the final third):
    the pass arrives, a central team-mate runs towards the penalty spot (stopping onside: the offside line is
    held where it stood), the receiver's nearest marker closes goal-side and the runner's nearest opponent tracks
    him, then the ball is played in to where the run ends. Everyone else stays where the frame has them. Lists
    the defenders who could block the ball or reach the delivery point first. Returns None when the geometry
    does not support it (no crossing position, no onside central runner, no meaningful run, nobody to respond).
    """
    recv = frame.get(alt.receiver_id)
    if recv is None or alt.offside_position:
        return None
    d = frame.directions[team]
    rx, ry = frame.att(team, recv.x, recv.y)
    if rx < FINAL_THIRD_AX or WIDE_CHANNEL_M < ry < W - WIDE_CHANNEL_M:
        return None
    opp_out = frame.opponents(team, outfield=True)
    if not opp_out:
        return None
    offside_ax = frame.lines(opp_out[0].team_id, team).second_last_ax
    cap_ax = offside_ax - ONSIDE_MARGIN_M
    ox, oy = frame.att(team, origin[0], origin[1])
    pass_m = math.hypot(rx - ox, ry - oy)
    t_ball_in = pass_m / PASS_SPEED_MPS + CONTROL_S  # when the ball is played in

    def at(b: Body) -> tuple[float, float]:
        return frame.att(team, b.x, b.y)

    # the runner: the most advanced onside outfield team-mate in the central channel
    central = [b for b in frame.team(team, outfield=True) if b.pid not in (carrier_id, recv.pid)
               and WIDE_CHANNEL_M <= at(b)[1] <= W - WIDE_CHANNEL_M and at(b)[0] <= cap_ax]
    if not central:
        return None
    runner = max(central, key=lambda b: (at(b)[0], b.pid))
    sx, sy = at(runner)
    ux, uy, to_spot = _unit(PENALTY_SPOT_AX - sx, W / 2 - sy)
    to_line = (cap_ax - sx) / ux if ux > 1e-9 else math.inf
    run_m = max(0.0, min(PLAYER_SPEED_MPS * t_ball_in, to_spot, to_line))
    if run_m < MIN_RUN_M:
        return None
    end = (sx + ux * run_m, sy + uy * run_m)
    held_onside = to_line <= min(PLAYER_SPEED_MPS * t_ball_in, to_spot) + 1e-9

    # defender responses: the receiver's nearest marker closes goal-side; the runner's nearest opponent tracks him
    closer = frame.get(alt.nearest_marker_id) if alt.nearest_marker_id else None
    if closer is None or closer.gk or closer.team_id == team:
        closer = min(opp_out, key=lambda b: (math.hypot(at(b)[0] - rx, at(b)[1] - ry), b.pid))
    trackers = [b for b in opp_out if b.pid != closer.pid]
    if not trackers:
        return None
    tracker = min(trackers, key=lambda b: (math.hypot(at(b)[0] - sx, at(b)[1] - sy), b.pid))
    budget = t_ball_in - REACTION_S
    close_to, close_reached = _move(at(closer), _goal_side((rx, ry), CLOSE_GAP_M), budget)
    track_to, track_reached = _move(at(tracker), _goal_side(end, TRACK_GAP_M), budget)
    moved = {closer.pid: close_to, tracker.pid: track_to}

    # the ball in, and who could get to it first (positions at the moment it is played)
    dlen = math.hypot(end[0] - rx, end[1] - ry)
    flight_s = dlen / DELIVERY_SPEED_MPS
    contests: list[dict[str, Any]] = []
    for b in frame.opponents(team):
        p = moved.get(b.pid, at(b))
        gap, u = seg_distance(p[0], p[1], rx, ry, end[0], end[1])
        if u * dlen <= BLOCK_ZONE_M and gap <= REACH_M:
            contests.append({"pid": b.pid, "kind": "block", "at": _world_point(d, *p), "gap_m": round(gap, 1),
                             "arrive_s": 0.0})
            continue
        to_point = math.hypot(p[0] - end[0], p[1] - end[1])
        arrive = REACTION_S + max(0.0, to_point - REACH_M) / PLAYER_SPEED_MPS if to_point > REACH_M else 0.0
        if arrive <= flight_s:
            contests.append({"pid": b.pid, "kind": "intercept", "at": _world_point(d, *p),
                             "gap_m": round(to_point, 1), "arrive_s": round(arrive, 2)})
    contests.sort(key=lambda c: (c["kind"] != "block", c["arrive_s"], c["gap_m"], c["pid"]))

    def mover(b: Body, role: str, to: tuple[float, float], reached: bool) -> dict[str, Any]:
        f = at(b)
        return {"pid": b.pid, "role": role, "from": _world_point(d, *f), "to": _world_point(d, *to),
                "distance_m": round(math.hypot(to[0] - f[0], to[1] - f[1]), 1), "reached": reached}

    return {
        "from_id": recv.pid, "label": ILLUSTRATIVE_LABEL,
        "pass": {"from": _world_point(d, ox, oy), "to": _world_point(d, rx, ry), "distance_m": round(pass_m, 1),
                 "seconds": round(pass_m / PASS_SPEED_MPS, 1)},
        "run": {**mover(runner, "run", end, True), "held_onside": held_onside,
                "offside_x": _world_point(d, offside_ax, 0.0)[0]},
        "defenders": [mover(closer, "close", close_to, close_reached), mover(tracker, "track", track_to, track_reached)],
        "delivery": {"from": _world_point(d, rx, ry), "to": _world_point(d, *end), "distance_m": round(dlen, 1),
                     "seconds": round(flight_s, 1)},
        "contests": contests,
        "seconds_to_ball_in": round(t_ball_in, 2),
    }


ILLUSTRATIVE_RULES = {
    "when": (f"only when the alternative receiver is in a wide channel (within {WIDE_CHANNEL_M} m of the touchline) "
             "in the final third, with an onside team-mate in the central channel"),
    "speeds": (f"pass {PASS_SPEED_MPS:.0f} m/s; {CONTROL_S:.0f} s to control; every player {PLAYER_SPEED_MPS:.0f} m/s; "
               f"defenders react {REACTION_S} s after each ball; ball in {DELIVERY_SPEED_MPS:.0f} m/s"),
    "run": (f"the most advanced onside central team-mate runs towards the penalty spot and stops "
            f"{ONSIDE_MARGIN_M} m short of the offside line, which is held where it stood"),
    "defenders": (f"the receiver's nearest marker closes to {CLOSE_GAP_M} m goal-side; the runner's nearest "
                  f"opponent tracks him to {TRACK_GAP_M} m goal-side; everyone else stays still"),
    "contest": (f"a block: within {REACH_M} m of the ball's first {BLOCK_ZONE_M:.0f} m; a possible interception: "
                "able to reach the delivery point before the ball"),
}


CONTINUATION_RULES = {
    "pass": (f"open or contested (same lane and space rules), square or forward, not back to the passer; "
             f"best {MAX_NEXT_PASSES} by ground gained and opponents bypassed"),
    "shot": (f"<= {SHOT_MAX_DISTANCE_M:.0f} m to the centre of the goal, goal mouth >= {SHOT_MIN_ANGLE_DEG:.0f} degrees "
             f"wide from the ball, at most {SHOT_MAX_OUTFIELD_IN_TRIANGLE} outfield opponent in the ball-to-posts triangle"),
    "cross": (f"from a wide channel (within {WIDE_CHANNEL_M} m of the touchline) in the final third, "
              "with at least one team-mate onside in the penalty area"),
}


def build_whatif(m: TacticalMoment, world: World, events: list[MatchEvent], pitch: Pitch) -> dict[str, Any] | None:
    if not m.whatif:
        return None
    ev = next((e for e in events if e.seq == m.seq), None)
    frame = pitch.at(m.frame_ms)
    if ev is None or frame is None:
        return None
    carrier = ev.player_id if ev.type != "foul.committed" else str(ev.payload.get("victim_player_id"))
    body = frame.get(carrier or "")
    if body is None:
        return None
    team = body.team_id
    loc = ev.payload.get("start") or ev.payload.get("location")
    origin = (float(loc["x_m"]), float(loc["y_m"])) if isinstance(loc, dict) else (body.x, body.y)
    opts = options_for(frame, body.pid, origin)
    intended = ev.payload.get("intended_receiver_player_id")
    actual_opt = next((o for o in opts if o.receiver_id == intended), None)
    alts = sorted((o for o in opts if o.receiver_id != intended and o.rating in ("open", "contested")),
                  key=option_value, reverse=True)[:MAX_ALTERNATIVES]
    defending = next((b.team_id for b in frame.opponents(team)), "")
    lines = frame.lines(defending, team) if defending else None
    d = frame.directions[team]
    interceptor = None
    if ev.type == "pass.failed":
        nxt = next((x for x in events if x.seq > ev.seq and x.type == "interception"), None)
        interceptor = nxt.player_id if nxt else None
    actual: dict[str, Any]
    if ev.type == "pass.failed":
        end = ev.payload["end"]
        actual = {"kind": "pass", "receiver_id": intended, "end": [end["x_m"], end["y_m"]],
                  "outcome": ev.payload.get("outcome"), "interceptor_id": interceptor,
                  "option": actual_opt.to_json() if actual_opt else None,
                  "event_id": ev.event_id}
    else:
        actual = {"kind": "foul", "receiver_id": None, "end": list(origin), "outcome": "foul",
                  "interceptor_id": None, "option": None, "event_id": ev.event_id,
                  "fouler_id": ev.player_id}
    return {
        "moment_id": m.moment_id, "kind": m.kind, "team_id": team, "defending_team_id": defending,
        "display_clock": m.display_clock, "frame_ms": frame.t_ms, "at_ms": m.at_ms,
        "pitch": {"length": L, "width": W}, "direction": d,
        "ball": [round(frame.ball[0], 1), round(frame.ball[1], 1)] if frame.ball[0] == frame.ball[0] else None,
        "players": _players(frame, world),
        "carrier_id": body.pid, "origin": [round(origin[0], 1), round(origin[1], 1)],
        "actual": actual,
        "alternatives": [_option(o, frame, team, origin) for o in alts],
        # additive: kept out of "labels" and "rules", which feed the recorded agent cases
        "continuations": build_continuations(frame, team, body.pid, alts),
        "continuation_rules": CONTINUATION_RULES,
        # additive, also outside "labels" and "rules": one illustrative sequence for the best alternative (ADR 10)
        "illustrative": illustrative_sequence(frame, team, body.pid, origin, alts[0]) if alts else None,
        "illustrative_rules": ILLUSTRATIVE_RULES,
        "lines": None if lines is None else {
            "back_x": round(_world_x(d, lines.back_ax), 1), "mid_x": round(_world_x(d, lines.mid_ax), 1),
            "offside_x": round(_world_x(d, lines.second_last_ax), 1)},
        "replay": {"from_ms": max(0, m.at_ms - 6000), "to_ms": m.at_ms + 1500},
        "observed": m.observed, "summary": m.summary, "interpretation": m.interpretation, "unknowns": m.unknowns,
        "labels": {
            "history": "What happened: event log + tracking at this instant",
            "hypothetical": "What if: other options on the same frame. Not what happened; no outcome is implied.",
        },
        "rules": {"open": f"lane >= {OPEN_LANE_M} m from every opponent and >= {OPEN_SPACE_M} m of space",
                  "contested": f"lane >= {CONTESTED_LANE_M} m and >= {CONTESTED_SPACE_M} m of space",
                  "blocked": "anything tighter", "offside": "ahead of the ball and the second-last opponent"},
    }


def build_view(m: TacticalMoment, world: World, events: list[MatchEvent], pitch: Pitch) -> dict[str, Any] | None:
    """Any tactical moment as a drawable frame: positions at the instant, evidence arrows, lines, focus players.
    Includes the What If? block when the moment has real alternatives."""
    frame = pitch.at(m.frame_ms)
    if frame is None or m.team_id not in frame.directions:
        return None
    by_id = {e.event_id: e for e in events}
    arrows = []
    for eid in m.evidence_event_ids:
        ev = by_id.get(eid)
        if ev is None:
            continue
        s = ev.payload.get("start") or ev.payload.get("location")
        e = ev.payload.get("end")
        if isinstance(s, dict) and isinstance(e, dict):
            arrows.append({"event_id": eid, "type": ev.type, "from": [s["x_m"], s["y_m"]], "to": [e["x_m"], e["y_m"]],
                           "player_id": ev.player_id})
    defending = next((b.team_id for b in frame.opponents(m.team_id)), "")
    d = frame.directions[m.team_id]
    lines = frame.lines(defending, m.team_id) if defending else None
    view: dict[str, Any] = {
        **m.to_json(), "frame_ms": frame.t_ms, "direction": d, "defending_team_id": defending,
        "players": _players(frame, world),
        "ball": [round(frame.ball[0], 1), round(frame.ball[1], 1)] if frame.ball[0] == frame.ball[0] else None,
        "arrows": arrows,
        "lines": None if lines is None else {"back_x": round(_world_x(d, lines.back_ax), 1),
                                             "mid_x": round(_world_x(d, lines.mid_ax), 1),
                                             "offside_x": round(_world_x(d, lines.second_last_ax), 1)},
        "replay": {"from_ms": max(0, m.at_ms - 6000), "to_ms": m.available_ms + 1500},
        "whatif": build_whatif(m, world, events, pitch) if m.whatif else None,
    }
    return view
