"""Simulated continuations on the What If? payload: pure geometry from the frozen frame, labelled, no outcomes."""

from __future__ import annotations

import json
import math
from typing import Any

import pytest

from byline.agents.subject import subject_from_moment
from byline.agents.tactical import _REAL_RECORDED_TACTICS, moment_inputs
from byline.storage.fixtures import MatchPackage, available_scenarios, load_package
from byline.tactics.frame import Body, Frame, Pitch
from byline.tactics.moments import TacticalMoment, tactical_moments
from byline.tactics.options import PassOption, options_for
from byline.tactics.whatif import (
    BLOCK_ZONE_M,
    CONTINUATION_LABEL,
    ILLUSTRATIVE_LABEL,
    MAX_NEXT_PASSES,
    ONSIDE_MARGIN_M,
    PLAYER_SPEED_MPS,
    REACH_M,
    REACTION_S,
    SHOT_MAX_DISTANCE_M,
    SHOT_MIN_ANGLE_DEG,
    WIDE_CHANNEL_M,
    build_continuations,
    build_whatif,
    crossing_option,
    illustrative_sequence,
    next_passes,
    shooting_window,
)

BANNED = ("would", "goal!", "chance", "%", "xg", "certain")


def _frame(bodies: list[Body]) -> Frame:
    return Frame(0, (50.0, 34.0, 0.0), bodies, {"A": "+x", "B": "-x"})


def _strings(v: Any) -> list[str]:
    if isinstance(v, str):
        return [v]
    if isinstance(v, dict):
        return [s for x in v.values() for s in _strings(x)]
    if isinstance(v, list):
        return [s for x in v for s in _strings(x)]
    return []


def _whatifs() -> list[tuple[str, TacticalMoment, dict[str, Any]]]:
    out = []
    for sid in available_scenarios():
        pkg = load_package(sid)
        pitch = Pitch(pkg.world, pkg.events, pkg.tracking)
        for m in tactical_moments(pkg.world, pkg.events, pkg.tracking):
            if m.whatif:
                w = build_whatif(m, pkg.world, list(pkg.events), pitch)
                assert w is not None
                out.append((sid, m, w))
    return out


# ---------------------------------------------------------------- shooting window


def _shot_frame(shooter: tuple[float, float], blockers: list[tuple[float, float]]) -> Frame:
    bodies = [Body("A1", "A", 50, 34, False), Body("A2", "A", *shooter, False),
              Body("BGK", "B", 103.5, 34.5, True), Body("B9", "B", 60, 10, False)]
    bodies += [Body(f"B{i}", "B", x, y, False) for i, (x, y) in enumerate(blockers, 1)]
    return _frame(bodies)


def test_shooting_window_geometry_on_a_synthetic_frame() -> None:
    f = _shot_frame((88.0, 34.0), [(95.0, 34.5)])
    s = shooting_window(f, "A", 88.0, 34.0)
    assert s is not None
    assert s["distance_m"] == 17.0
    # the goal mouth from 17 m straight out: 2 * atan(3.66 / 17)
    assert s["angle_deg"] == round(math.degrees(2 * math.atan(3.66 / 17)), 1)
    assert s["goal_centre"] == [105.0, 34.0] and s["posts"] == [[105.0, 30.34], [105.0, 37.66]]
    assert s["defenders_in_triangle"] == ["B1"]  # B9 is far away; the keeper is reported separately
    assert s["goalkeeper_id"] == "BGK" and s["goalkeeper"] == [103.5, 34.5] and s["goalkeeper_in_triangle"]


def test_shooting_window_thresholds() -> None:
    # two outfield opponents in the triangle: no window
    assert shooting_window(_shot_frame((88.0, 34.0), [(95.0, 34.5), (99.0, 33.5)]), "A", 88.0, 34.0) is None
    # a defender just outside the triangle does not count
    assert shooting_window(_shot_frame((88.0, 34.0), [(95.0, 34.5), (99.0, 40.0)]), "A", 88.0, 34.0) is not None
    # too far: 30 m straight out
    assert shooting_window(_shot_frame((75.0, 34.0), []), "A", 75.0, 34.0) is None
    # inside 25 m but the goal mouth is too narrow from near the byline
    s = (100.0, 10.0)
    assert math.hypot(105 - s[0], 34 - s[1]) <= SHOT_MAX_DISTANCE_M
    assert shooting_window(_shot_frame(s, []), "A", *s) is None
    # a 12-degree goal mouth is reached about 34.8 m out centrally, so the 25 m limit binds there
    assert SHOT_MAX_DISTANCE_M == 25.0 and SHOT_MIN_ANGLE_DEG == 12.0


def test_shooting_window_follows_the_attacking_direction() -> None:
    f = _frame([Body("B2", "B", 12.0, 34.0, False), Body("AGK", "A", 1.0, 34.0, True), Body("A5", "A", 30, 20, False)])
    s = shooting_window(f, "B", 12.0, 34.0)
    assert s is not None and s["goal_centre"] == [0.0, 34.0] and s["distance_m"] == 12.0
    assert s["goalkeeper_id"] == "AGK" and s["defenders_in_triangle"] == []


# ---------------------------------------------------------------- crossing option


def _cross_frame(crosser: tuple[float, float]) -> Frame:
    return _frame([
        Body("A1", "A", 60, 34, False), Body("A3", "A", *crosser, False),
        Body("A4", "A", 95.0, 30.0, False),  # in the box, onside
        Body("A5", "A", 101.0, 40.0, False),  # in the box, beyond the second-last opponent: offside
        Body("A6", "A", 80.0, 34.0, False),  # outside the box
        Body("B1", "B", 96.0, 32.0, False), Body("B2", "B", 99.0, 36.0, False), Body("B3", "B", 85.0, 20.0, False),
        Body("BGK", "B", 104.0, 34.0, True),
    ])


def test_crossing_option_lists_onside_targets_with_their_nearest_marker() -> None:
    c = crossing_option(_cross_frame((82.0, 5.0)), "A", "A3", 82.0, 5.0)
    assert c is not None and c["channel"] == "left"
    assert [t["pid"] for t in c["targets"]] == ["A4"]
    t = c["targets"][0]
    assert t["nearest_marker_id"] == "B1" and t["marker_distance_m"] == round(math.hypot(1.0, 2.0), 1)
    assert c["offside_ids"] == ["A5"]
    right = crossing_option(_cross_frame((82.0, 64.0)), "A", "A3", 82.0, 64.0)
    assert right is not None and right["channel"] == "right"


def test_crossing_option_needs_a_wide_channel_in_the_final_third_and_a_target() -> None:
    assert crossing_option(_cross_frame((60.0, 5.0)), "A", "A3", 60.0, 5.0) is None  # not the final third
    inside = WIDE_CHANNEL_M + 2
    assert crossing_option(_cross_frame((82.0, inside)), "A", "A3", 82.0, inside) is None  # not wide
    no_target = _frame([Body("A3", "A", 82.0, 5.0, False), Body("A6", "A", 80.0, 34.0, False),
                        Body("B1", "B", 96.0, 32.0, False), Body("BGK", "B", 104.0, 34.0, True)])
    assert crossing_option(no_target, "A", "A3", 82.0, 5.0) is None


# ---------------------------------------------------------------- next passes and the whole block


def test_next_passes_exclude_the_passer_and_backward_or_blocked_lanes() -> None:
    f = _frame([
        Body("A1", "A", 40, 34, False),  # the original passer, behind
        Body("A2", "A", 55, 34, False),  # the alternative receiver, now on the ball
        Body("A3", "A", 70, 20, False), Body("A4", "A", 68, 50, False), Body("A5", "A", 66, 34, False),
        Body("A6", "A", 45, 10, False),  # backwards
        Body("B1", "B", 60.5, 34.2, False),  # blocks the lane to A5
        Body("B2", "B", 80, 30, False), Body("B3", "B", 82, 40, False), Body("BGK", "B", 104, 34, True),
    ])
    got = next_passes(f, "A", "A2", {"A1"})
    ids = [o.receiver_id for o in got]
    assert len(got) <= MAX_NEXT_PASSES and "A1" not in ids and "A5" not in ids and "A6" not in ids
    assert all(o.rating in ("open", "contested") and o.progression_m >= 0 for o in got)
    every = {o.receiver_id: o for o in options_for(f, "A2")}
    assert every["A5"].rating == "blocked"
    assert set(ids) == {"A3", "A4"}


def test_build_continuations_is_empty_when_the_geometry_supports_nothing() -> None:
    # the receiver is deep in their own half, every team-mate behind or marked, far from goal
    f = _frame([
        Body("A1", "A", 30, 34, False), Body("A2", "A", 20, 10, False), Body("A3", "A", 15, 30, False),
        Body("B1", "B", 21, 11, False), Body("BGK", "B", 104, 34, True),
    ])
    alts = [o for o in options_for(f, "A1") if o.receiver_id == "A2"]
    assert alts and build_continuations(f, "A", "A1", alts) == []
    assert build_continuations(f, "A", "A1", []) == []


def test_continuation_items_carry_label_measurements_and_no_banned_words() -> None:
    seen = {"pass": 0, "shot": 0, "cross": 0}
    for sid, m, w in _whatifs():
        assert isinstance(w["continuations"], list) and w["continuation_rules"]
        alt_ids = [a["receiver_id"] for a in w["alternatives"]]
        for c in w["continuations"]:
            seen[c["kind"]] += 1
            assert c["label"] == CONTINUATION_LABEL and "Not what happened" in c["label"]
            assert c["from_id"] in alt_ids, (sid, m.moment_id)
            body = c[c["kind"]]
            if c["kind"] == "pass":
                assert body["receiver_id"] not in (c["from_id"], w["carrier_id"])
                assert body["rating"] in ("open", "contested") and body["progression_m"] >= 0
                assert len(body["bypassed_ids"]) == body["opponents_bypassed"]
            elif c["kind"] == "shot":
                assert body["distance_m"] <= 25 and body["angle_deg"] >= 12 and len(body["defenders_in_triangle"]) <= 1
            else:
                assert body["targets"] and all(t["marker_distance_m"] is not None for t in body["targets"])
        text = " ".join(_strings(w["continuations"]) + _strings(w["continuation_rules"])).lower()
        for banned in BANNED:
            assert banned not in text, (sid, m.moment_id, banned)
    # the synthetic matches exercise all three kinds
    assert seen["pass"] and seen["shot"] and seen["cross"], seen


def test_signature_continuation_from_haddad_rhys(golden: MatchPackage) -> None:
    m = next(x for x in tactical_moments(golden.world, golden.events, golden.tracking) if x.moment_id == "T-option-NBA-0180")
    w = build_whatif(m, golden.world, list(golden.events), Pitch(golden.world, golden.events, golden.tracking))
    assert w is not None
    first = w["continuations"][0]
    assert first["kind"] == "pass" and first["from_id"] == "NBA-11" and first["from"] == [73.1, 7.4]
    p = first["pass"]
    assert (p["receiver_id"], p["rating"], p["lane_clearance_m"], p["receiver_space_m"], p["nearest_marker_id"]) == \
        ("NBA-09", "contested", 7.2, 2.7, "RVC-06")
    assert p["rank"] == 1 and p["progression_m"] == 2.2
    # Haddad-Rhys is wide in the final third, but no team-mate is in the box and the goal is 41 m away
    assert not any(c["kind"] in ("shot", "cross") for c in w["continuations"])
    # the alternative's bypassed opponents are the three between the ball and Haddad-Rhys (as counted)
    alt = w["alternatives"][0]
    assert sorted(alt["bypassed_ids"]) == ["RVC-06", "RVC-08", "RVC-10"] and alt["opponents_bypassed"] == 3


def test_continuations_are_deterministic_and_use_only_the_frozen_frame(golden: MatchPackage) -> None:
    m = next(x for x in tactical_moments(golden.world, golden.events, golden.tracking) if x.moment_id == "T-option-NBA-0180")
    events = list(golden.events)
    full = build_whatif(m, golden.world, events, Pitch(golden.world, golden.events, golden.tracking))
    again = build_whatif(m, golden.world, events, Pitch(golden.world, golden.events, golden.tracking))
    assert full is not None and again is not None
    assert json.dumps(full["continuations"], sort_keys=True) == json.dumps(again["continuations"], sort_keys=True)
    # no look-ahead: tracking cut at the decision frame, and events cut where the moment is released, change nothing
    cut = dict(golden.tracking)
    cut["frames"] = [f for f in golden.tracking["frames"] if int(f[0]) <= full["frame_ms"]]
    prefix = [e for e in events if e.seq <= m.available_seq]
    part = build_whatif(m, golden.world, prefix, Pitch(golden.world, prefix, cut))
    assert part is not None and part["continuations"] == full["continuations"]
    assert full["illustrative"] is not None and part["illustrative"] == full["illustrative"]
    assert json.dumps(full["illustrative"], sort_keys=True) == json.dumps(again["illustrative"], sort_keys=True)


@pytest.mark.parametrize("drop", [("continuations", "continuation_rules"),
                                  ("continuations", "continuation_rules", "illustrative", "illustrative_rules")])
def test_continuations_do_not_change_the_recorded_agent_case(golden: MatchPackage, drop: tuple[str, ...]) -> None:
    """The agents' case is built from the What If? payload: the additive keys must not change it, so the
    recorded real Foundry run for the 7' moment is still served."""
    inputs = moment_inputs(golden, "T-option-NBA-0180")
    assert inputs.whatif is not None and inputs.whatif["continuations"]
    bare = {k: v for k, v in inputs.whatif.items() if k not in drop}
    assert subject_from_moment(inputs.moment, bare, golden.world) == inputs.subject
    assert (_REAL_RECORDED_TACTICS / f"{inputs.key}.json").exists()


# ---------------------------------------------------------------- illustrative continuation (moving players)


def test_illustrative_sequence_on_the_signature_moment(golden: MatchPackage) -> None:
    """7': the switch to Haddad-Rhys, Vantreight's run held onside, Tremaine closing, Ndiaye-Shaw tracking, and the
    ball in towards the edge of the box, which Tremaine could block and Ndiaye-Shaw could reach first."""
    m = next(x for x in tactical_moments(golden.world, golden.events, golden.tracking) if x.moment_id == "T-option-NBA-0180")
    w = build_whatif(m, golden.world, list(golden.events), Pitch(golden.world, golden.events, golden.tracking))
    assert w is not None
    il = w["illustrative"]
    assert il is not None and il["from_id"] == "NBA-11" and il["label"] == ILLUSTRATIVE_LABEL
    assert "Not what happened" in il["label"] and "no outcome is implied" in il["label"]
    assert il["pass"]["from"] == w["origin"] and il["pass"]["to"] == [73.1, 7.4] and il["pass"]["distance_m"] == 37.3
    run = il["run"]
    assert run["pid"] == "NBA-09" and run["from"] == [75.3, 36.5] and run["held_onside"]
    # the offside line is held where it stood (86.2 m): the run stops half a metre short of it, outside the box
    assert run["offside_x"] == w["lines"]["offside_x"] == 86.2
    assert run["to"][0] == pytest.approx(86.2 - ONSIDE_MARGIN_M, abs=0.01) and run["to"][0] < 88.5
    roles = {d["role"]: d for d in il["defenders"]}
    assert roles["close"]["pid"] == "RVC-02" and roles["close"]["reached"]  # Haddad-Rhys's nearest marker
    assert roles["track"]["pid"] == "RVC-06" and roles["track"]["reached"]  # Vantreight's nearest opponent
    assert il["delivery"]["from"] == [73.1, 7.4] and il["delivery"]["to"] == run["to"]
    first, second = il["contests"][:2]
    assert (first["pid"], first["kind"]) == ("RVC-02", "block") and first["gap_m"] <= REACH_M
    assert (second["pid"], second["kind"]) == ("RVC-06", "intercept")


def test_illustrative_sequences_respect_their_published_kinematics() -> None:
    """Across every What If?: nobody moves faster than the stated speed, runs end onside against the held line,
    and every contest is an opponent who can get there under the stated rules."""
    seen = 0
    for sid, m, w in _whatifs():
        il = w["illustrative"]
        assert w["illustrative_rules"]
        if il is None:
            continue
        seen += 1
        t = il["seconds_to_ball_in"]
        assert il["run"]["distance_m"] <= PLAYER_SPEED_MPS * t + 0.2, (sid, m.moment_id)
        for d in il["defenders"]:
            assert d["distance_m"] <= PLAYER_SPEED_MPS * (t - REACTION_S) + 0.2, (sid, m.moment_id, d)
        sign = 1 if w["direction"] == "+x" else -1
        assert sign * il["run"]["to"][0] <= sign * il["run"]["offside_x"] - ONSIDE_MARGIN_M + 0.05, (sid, m.moment_id)
        opponents = {p["pid"] for p in w["players"] if p["team_id"] != w["team_id"]}
        assert {d["pid"] for d in il["defenders"]} <= opponents and {c["pid"] for c in il["contests"]} <= opponents
        for c in il["contests"]:
            assert c["kind"] in ("block", "intercept")
            if c["kind"] == "block":
                assert c["gap_m"] <= REACH_M
            else:
                assert c["arrive_s"] <= il["delivery"]["seconds"] + 0.05
        text = " ".join(_strings(il) + _strings(w["illustrative_rules"])).lower()
        for banned in BANNED:
            assert banned not in text, (sid, m.moment_id, banned)
    assert seen >= 3 and BLOCK_ZONE_M == 3.0


def _opt_for(f: Frame, carrier: str, receiver: str) -> PassOption:
    return next(o for o in options_for(f, carrier) if o.receiver_id == receiver)


def test_illustrative_sequence_needs_a_crossing_position_and_a_central_runner() -> None:
    base = [Body("A1", "A", 60, 40, False), Body("A9", "A", 76, 34, False),
            Body("B2", "B", 82, 12, False), Body("B6", "B", 74, 35, False), Body("B4", "B", 87, 30, False),
            Body("B5", "B", 86, 40, False), Body("BGK", "B", 103, 34, True)]
    wide = _frame([*base, Body("A11", "A", 74, 6, False)])
    il = illustrative_sequence(wide, "A", "A1", (60.0, 40.0), _opt_for(wide, "A1", "A11"))
    assert il is not None and il["run"]["pid"] == "A9" and il["run"]["held_onside"]
    assert [d["pid"] for d in il["defenders"]] == ["B2", "B6"]
    # the receiver central, not in a wide channel: nothing is sketched (geometry only)
    central = _frame([*base, Body("A11", "A", 74, 24, False)])
    assert illustrative_sequence(central, "A", "A1", (60.0, 40.0), _opt_for(central, "A1", "A11")) is None
    # wide but outside the final third: nothing is sketched
    deep = _frame([*base, Body("A11", "A", 62, 6, False)])
    assert illustrative_sequence(deep, "A", "A1", (60.0, 40.0), _opt_for(deep, "A1", "A11")) is None
    # no onside central team-mate to make the run: nothing is sketched
    alone = _frame([b for b in base if b.pid != "A9"] + [Body("A11", "A", 74, 6, False)])
    assert illustrative_sequence(alone, "A", "A1", (60.0, 40.0), _opt_for(alone, "A1", "A11")) is None
