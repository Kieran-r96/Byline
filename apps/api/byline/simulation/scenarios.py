"""Authored scenario beats on top of the generic simulator.

A beat steers play (who has the ball, where runs go, what the official decides) using the
engine's physical primitives. Beats also yield *evaluation labels* that are written to a
separate file and are never visible to runtime detectors.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

from byline.simulation.engine import Engine, dist
from byline.world.seed_world import AWAY_ID, HOME_ID

MIN = 60_000


@dataclass
class Label:
    pattern_type: str
    team_id: str
    start_ms: int
    end_ms: int
    note: str


@dataclass
class Beat:
    period: str
    at_min: float
    run: Callable[[Engine, list[Label]], None]


@dataclass
class Phase:
    """Time window in which a team's passing is biased toward a channel (attacking-frame ay)."""

    period: str
    start_min: float
    end_min: float
    team_id: str
    target_ay: float
    strength: float


@dataclass
class Scenario:
    scenario_id: str
    match_id: str
    seed: int
    version: str
    title: str
    description: str
    added: dict[str, int]
    beats: list[Beat] = field(default_factory=list)
    phases: list[Phase] = field(default_factory=list)


# ---------------------------------------------------------------- helpers


def chain(e: Engine, team: str, steps: list[tuple[str, float, float]], run_ms: int = 3000,
          height: str = "ground") -> list[str]:
    """Forced-success passes (or carries when the target is the current owner) in attacking frame."""
    ids: list[str] = []
    for slot, ax, ay in steps:
        pid = e.by_slot(team, slot)
        assert pid is not None, f"{team} has no {slot}"
        tgt = e.world_pt(team, ax, ay)
        if e.owner == pid:
            e.carry(tgt)
            continue
        e.prepare_run(pid, tgt, max_ms=run_ms)
        ids.append(e.pass_to(pid, end=tgt, success=True, height=height))
    return ids


def last_event_id(e: Engine, etype: str) -> str:
    for ev in reversed(e.events):
        if ev["type"] == etype:
            return str(ev["event_id"])
    raise LookupError(etype)


def confirm_goal(e: Engine, team: str, delay_ms: int = 9000) -> None:
    gid = last_event_id(e, "goal.provisional")
    scorer = next(ev["player_id"] for ev in e.events if ev["event_id"] == gid)
    e.advance(delay_ms)
    e.emit("goal.confirmed", team, scorer, {"goal_event_id": gid, "decision_route": "on_field"},
           official=True, correlation=gid)
    e.score[team] += 1
    e.kickoff(e.opp(team), "after_goal")


def card(e: Engine, offender: str, reason: str, foul_id: str | None) -> str:
    team = e.bodies[offender].team_id
    if offender in e.yellow and reason not in ("dogso", "serious_foul_play", "violent_conduct"):
        cid = e.emit("card.second_yellow", team, offender, {"reason": "second_caution", "foul_event_id": foul_id,
                                                            "law_ref": "Law 12"}, official=True, correlation=foul_id)
        e.dismiss(offender)
        return cid
    if reason in ("dogso", "serious_foul_play", "violent_conduct"):
        cid = e.emit("card.red", team, offender, {"reason": reason, "foul_event_id": foul_id, "law_ref": "Law 12"},
                     official=True, correlation=foul_id)
        e.dismiss(offender)
        return cid
    e.yellow.add(offender)
    return e.emit("card.yellow", team, offender, {"reason": reason, "foul_event_id": foul_id, "law_ref": "Law 12"},
                  official=True, correlation=foul_id)


def foul(e: Engine, team: str, victim_slot: str, offender_id: str, at: tuple[float, float], *,
         severity: str | None, foul_type: str, card_reason: str | None = None, restart: str = "direct_free_kick",
         advantage: bool = False, dogso: bool = False, spa: bool = False, attempted: bool | None = None,
         approach: list[tuple[str, float, float]] | None = None) -> str:
    """Victim's team attacks to `at` (attacking frame) where the offender commits an official foul."""
    e.gain_possession(team)
    steps = list(approach or [])
    steps.append((victim_slot, at[0], at[1]))
    chain(e, team, steps)
    victim = e.owner
    assert victim is not None
    ob = e.bodies[offender_id]
    ob.pin, ob.pin_speed = e.pos(victim), 8.0
    e.prepare_run(offender_id, e.pos(victim), max_ms=2500, speed=8.0)
    ob.pin = None
    in_area = e.ball_att(team)[0] >= 88.5 and 13.84 <= e.ball_att(team)[1] <= 54.16
    fid = e.emit("foul.committed", ob.team_id, offender_id, {
        "location": e.ball_pt(), "victim_player_id": victim, "foul_type": foul_type, "severity": severity,
        "restart_type": restart, "in_offender_penalty_area": in_area, "advantage_played": advantage,
        "denied_goal_scoring_opportunity": dogso, "stopped_promising_attack": spa,
        "attempted_to_play_ball": attempted,
    }, official=True)
    if advantage:
        e.emit("advantage.applied", team, None, {"foul_event_id": fid}, official=True, correlation=fid)
        if card_reason:
            def caution_at_stoppage() -> None:
                card(e, offender_id, card_reason, fid)

            e.at_next_stoppage.append(caution_at_stoppage)
        return fid
    if card_reason:
        card(e, offender_id, card_reason, fid)
    if restart != "penalty":
        e.restart(restart, team, (e.ball[0], e.ball[1]), fid, law="Law 12 / Law 13")
    return fid


def penalty_kick(e: Engine, team: str, taker_slot: str, foul_id: str, outcome: str, placement: str,
                 touch: str = "normal") -> str:
    defending = e.opp(team)
    spot = e.world_pt(team, 94.0, 34.0)
    taker = e.by_slot(team, taker_slot)
    assert taker is not None
    gk = e.gk(defending)
    # everyone except taker and keeper outside the area, behind the ball
    k = 0
    for b in e.bodies.values():
        if not b.on_pitch or b.pid in (taker, gk):
            continue
        if b.slot == "GK":
            continue
        k += 1
        b.pin, b.pin_speed = e.world_pt(team, 84.5 - (k % 3) * 1.5, 18.0 + (k * 1.7) % 32.0), 3.5
    e.bodies[gk].pin = e.world_pt(team, 104.6, 34.0)
    e.restart("penalty", team, spot, foul_id, taker=taker, law="Law 14")
    for b in e.bodies.values():
        b.pin = None
    pk = e.emit("penalty.taken", team, taker, {"goalkeeper_id": gk, "placement": placement,
                                               "location": e.pt(spot)}, correlation=foul_id)
    ay = {"bottom_left": 31.0, "bottom_right": 37.0, "top_left": 31.2, "top_right": 36.8, "centre": 34.0}[placement]
    shot_outcome = {"scored": "goal", "saved": "saved", "missed": "off_target", "woodwork": "woodwork",
                    "retake": "goal"}[outcome]
    e.shoot(shot_outcome, situation="penalty", placement_ay=ay)
    if outcome == "retake":
        # Accidental double touch and the ball went in: the kick is retaken (IFAB 2026/27 clarification).
        gid = last_event_id(e, "goal.provisional")
        e.emit("penalty.outcome", team, taker, {"penalty_event_id": pk, "outcome": "retake",
                                                "touch": touch}, official=True, correlation=pk)
        e.emit("goal.disallowed", team, taker, {"goal_event_id": gid, "reason": "foul", "law_ref": "Law 14",
                                                 "decision_route": "on_field"}, official=True, correlation=pk)
        return pk
    e.emit("penalty.outcome", team, taker, {"penalty_event_id": pk, "outcome": outcome, "touch": touch},
           official=True, correlation=pk)
    if outcome == "scored":
        confirm_goal(e, team)
    return pk


def wait_for_opponent_ball(e: Engine, team: str, lo: float, hi: float, max_ms: int = 180_000) -> None:
    """Run play until the OPPONENT has the ball between lo..hi of the opponent's attacking frame."""
    other = e.opp(team)
    deadline = e.t + max_ms
    e.gain_possession(other)
    while e.t < deadline:
        if e.possession == other and e.owner is not None and lo <= e.ball_att(other)[0] <= hi:
            return
        e.generic_action()


def counterattack(e: Engine, team: str, steps: list[tuple[str, float, float]], finish: str,
                  labels: list[Label], note: str) -> None:
    wait_for_opponent_ball(e, team, 50.0, 78.0)
    t0 = e.t
    receiver = e.choose_receiver()
    mid = ((e.ball[0] + e.pos(receiver)[0]) / 2, (e.ball[1] + e.pos(receiver)[1]) / 2)
    interceptor = e.nearest(team, mid, no_gk=True)
    e.pass_to(receiver, success=False, interceptor=interceptor.pid)
    chain(e, team, steps, run_ms=700)
    e.hold(300)
    e.shoot(finish, body_part="right_foot")
    labels.append(Label("counterattack", team, t0, e.t, note))
    if finish == "goal":
        confirm_goal(e, team)


def offside_line_run(e: Engine, team: str, pid: str, margin: float, ay: float) -> float:
    """Move pid to `margin` metres beyond the second-last defender; returns actual margin."""
    actual = 0.0
    for _ in range(12):
        line = e.second_last_defender_ax(team)
        e.bodies[pid].pin, e.bodies[pid].pin_speed = e.world_pt(team, line + margin, ay), 6.5
        e.hold(400, drift=0.5)
        actual = e.att(team, *e.pos(pid))[0] - e.second_last_defender_ax(team)
        if (margin > 0 and actual > 0.15) or (margin <= 0 and actual <= -0.5):
            break
    return round(actual, 2)


# ---------------------------------------------------------------- golden story beats


def b_careless_trip(e: Engine, labels: list[Label]) -> None:
    foul(e, HOME_ID, "CAM", "RVC-10", (56.0, 36.0), severity="careless", foul_type="trip",
         approach=[("LDM", 45.0, 28.0)])


def b_offside_position_not_involved(e: Engine, labels: list[Label]) -> None:
    e.gain_possession(HOME_ID)
    chain(e, HOME_ID, [("RDM", 50.0, 40.0)])
    st = e.by_slot(HOME_ID, "ST")
    assert st is not None
    margin = offside_line_run(e, HOME_ID, st, 1.5, 30.0)
    pid = chain(e, HOME_ID, [("RW", 72.0, 60.0)])[0]
    e.emit("offside.position_detected", HOME_ID, st, {
        "pass_event_id": pid, "location": e.pt(e.pos(st)), "involved": False,
        "second_last_defender_x_m": round(e.second_last_defender_ax(HOME_ID), 1),
        "note": f"Centre-coordinate margin {margin} m; not involved in active play, so no offence.",
    })
    e.bodies[st].pin = None


def b_right_channel_goal(e: Engine, labels: list[Label]) -> None:
    e.gain_possession(HOME_ID)
    chain(e, HOME_ID, [("RB", 55.0, 60.0), ("RW", 79.0, 61.0)])
    e.carry(e.world_pt(HOME_ID, 89.0, 61.0))
    st = e.by_slot(HOME_ID, "ST")
    e.cross(target_pid=st, outcome="goal", success=True, assist_for_goal=True)
    confirm_goal(e, HOME_ID)


def b_rvc_counter_saved(e: Engine, labels: list[Label]) -> None:
    counterattack(e, AWAY_ID, [("LCM", 52.0, 26.0), ("RW", 74.0, 52.0), ("ST", 89.0, 37.0)], "saved", labels,
                  "Interception then three passes to a saved shot")


def b_reckless_yellow(e: Engine, labels: list[Label]) -> None:
    foul(e, HOME_ID, "RW", "RVC-06", (62.0, 57.0), severity="reckless", foul_type="tackle",
         card_reason="reckless_foul")


def b_offside_offence(e: Engine, labels: list[Label]) -> None:
    e.gain_possession(HOME_ID)
    chain(e, HOME_ID, [("CAM", 62.0, 36.0)])
    st = e.by_slot(HOME_ID, "ST")
    assert st is not None
    offside_line_run(e, HOME_ID, st, 2.2, 38.0)
    at_pass = e.pos(st)
    pid = e.pass_to(st, success=True)
    e.bodies[st].pin = None
    oid = e.emit("offside.offence_confirmed", HOME_ID, st, {
        "interference_type": "interfering_with_play", "decision_event_id": pid, "location": e.pt(at_pass),
        "touch_nature": "teammate_play",
    }, official=True, correlation=pid)
    e.restart("indirect_free_kick", AWAY_ID, at_pass, oid, law="Law 11 / Law 13")


def b_rvc_counter_goal(e: Engine, labels: list[Label]) -> None:
    counterattack(e, AWAY_ID, [("RCM", 55.0, 44.0), ("LW", 76.0, 16.0), ("ST", 90.0, 31.0)], "goal", labels,
                  "Midfield interception, fast break, goal")


def b_overlap(e: Engine, labels: list[Label]) -> None:
    e.gain_possession(HOME_ID)
    rw, rb, st = (e.by_slot(HOME_ID, s) for s in ("RW", "RB", "ST"))
    assert rw and rb and st
    chain(e, HOME_ID, [("RDM", 52.0, 44.0), ("RW", 66.0, 57.0)])
    e.prepare_run(rb, e.world_pt(HOME_ID, 58.0, 63.0), max_ms=3500)
    t0 = e.t
    e.bodies[rb].pin, e.bodies[rb].pin_speed = e.world_pt(HOME_ID, 85.0, 64.5), 7.8
    e.carry(e.world_pt(HOME_ID, 71.0, 53.0), speed=2.1)
    e.hold(500, drift=0.3)
    e.pass_to(rb, end=e.world_pt(HOME_ID, 86.0, 63.5), success=True)
    e.bodies[rb].pin = None
    e.hold(400)
    e.cross(target_pid=st, outcome="saved", success=True)
    labels.append(Label("overlap", HOME_ID, t0, e.t, "Right-back overlaps the right winger, crosses, saved header"))


def b_second_yellow(e: Engine, labels: list[Label]) -> None:
    foul(e, HOME_ID, "CAM", "RVC-06", (58.0, 33.0), severity="reckless", foul_type="kick",
         card_reason="reckless_foul")


def b_subs_66(e: Engine, labels: list[Label]) -> None:
    e.at_next_stoppage.append(lambda: e.substitute(AWAY_ID, "RVC-11", "RVC-16"))
    e.at_next_stoppage.append(lambda: e.substitute(HOME_ID, "NBA-11", "NBA-20"))


def b_var_disallowed(e: Engine, labels: list[Label]) -> None:
    e.gain_possession(HOME_ID)
    chain(e, HOME_ID, [("LDM", 50.0, 30.0), ("CAM", 66.0, 34.0)])
    st = e.by_slot(HOME_ID, "ST")
    assert st is not None
    margin = offside_line_run(e, HOME_ID, st, 0.45, 36.0)
    at_pass = e.pos(st)
    sax, say = e.att(HOME_ID, *at_pass)
    pass_id = e.pass_to(st, end=e.world_pt(HOME_ID, sax + 7.0, say), success=True)
    e.bodies[st].pin = None
    e.carry(e.world_pt(HOME_ID, sax + 11.0, say - 1.0))
    e.shoot("goal", assist=e.by_slot(HOME_ID, "CAM"))
    gid = last_event_id(e, "goal.provisional")
    e.advance(6000)
    e.emit("var.review_started", None, None, {
        "check_type": "goal", "subject_event_id": gid,
        "reason": "Possible offside in the attacking phase of play",
    }, official=True, correlation=gid)
    e.possession = AWAY_ID
    e.advance(64_000)
    e.emit("var.review_outcome", None, None, {
        "subject_event_id": gid, "recommendation": "overturn", "on_field_review": False,
        "final_decision": "Goal disallowed: offside (factual decision, no on-field review)",
    }, official=True, correlation=gid)
    e.emit("goal.disallowed", HOME_ID, st, {"goal_event_id": gid, "reason": "offside", "law_ref": "Law 11",
                                             "decision_route": "after_var_check"}, official=True, correlation=gid)
    oid = e.emit("offside.offence_confirmed", HOME_ID, st, {
        "interference_type": "interfering_with_play", "decision_event_id": pass_id, "location": e.pt(at_pass),
        "touch_nature": "teammate_play", "centre_coordinate_margin_m": margin,
    }, official=True, correlation=gid)
    e.restart("indirect_free_kick", AWAY_ID, at_pass, oid, law="Law 11 / Law 13")


def b_subs_78(e: Engine, labels: list[Label]) -> None:
    e.at_next_stoppage.append(lambda: e.substitute(HOME_ID, "NBA-09", "NBA-19"))
    e.at_next_stoppage.append(lambda: e.substitute(AWAY_ID, "RVC-07", "RVC-17"))


def b_penalty_scored(e: Engine, labels: list[Label]) -> None:
    fid = foul(e, HOME_ID, "ST", "RVC-05", (93.5, 38.0), severity="careless", foul_type="trip",
               restart="penalty", attempted=True, approach=[("CAM", 72.0, 36.0)])
    penalty_kick(e, HOME_ID, "CAM", fid, "scored", "bottom_right")


def b_advantage_then_caution(e: Engine, labels: list[Label]) -> None:
    foul(e, HOME_ID, "LDM", "RVC-08", (48.0, 30.0), severity="reckless", foul_type="tackle",
         card_reason="reckless_foul", advantage=True)
    chain(e, HOME_ID, [("CAM", 60.0, 36.0)])


GOLDEN = Scenario(
    scenario_id="golden_story",
    match_id="BYLINE-01",
    seed=2026,
    version="v1",
    title="Golden Story: Northbridge Athletic v Riverton City",
    description="Showcase match: right-channel pressure, counters, an overlap, a dismissal, a VAR reversal and a "
                "late penalty.",
    added={"H1": 2, "H2": 4},
    phases=[Phase("H1", 16.0, 29.5, HOME_ID, 59.0, 2.4)],
    beats=[
        Beat("H1", 8.5, b_careless_trip),
        Beat("H1", 13.0, b_offside_position_not_involved),
        Beat("H1", 27.0, b_right_channel_goal),
        Beat("H1", 35.5, b_rvc_counter_saved),
        Beat("H1", 41.0, b_reckless_yellow),
        Beat("H1", 45.6, b_offside_offence),
        Beat("H2", 5.5, b_rvc_counter_goal),
        Beat("H2", 10.5, b_overlap),
        Beat("H2", 17.5, b_second_yellow),
        Beat("H2", 20.0, b_subs_66),
        Beat("H2", 25.0, b_var_disallowed),
        Beat("H2", 32.0, b_subs_78),
        Beat("H2", 38.5, b_penalty_scored),
        Beat("H2", 45.4, b_advantage_then_caution),
    ],
)


# ---------------------------------------------------------------- ordinary match


def o_long_range_goal(e: Engine, labels: list[Label]) -> None:
    e.gain_possession(AWAY_ID)
    chain(e, AWAY_ID, [("LCM", 60.0, 30.0), ("RCM", 76.0, 38.0)])
    e.shoot("goal", body_part="right_foot")
    confirm_goal(e, AWAY_ID)


def o_careless_foul(e: Engine, labels: list[Label]) -> None:
    foul(e, AWAY_ID, "LCM", "NBA-08", (50.0, 30.0), severity="careless", foul_type="push")


def o_subs(e: Engine, labels: list[Label]) -> None:
    e.at_next_stoppage.append(lambda: e.substitute(HOME_ID, "NBA-07", "NBA-17"))
    e.at_next_stoppage.append(lambda: e.substitute(AWAY_ID, "RVC-09", "RVC-19"))


ORDINARY = Scenario(
    scenario_id="ordinary_match",
    match_id="BYLINE-03",
    seed=7341,
    version="v1",
    title="Ordinary Match: Northbridge Athletic v Riverton City",
    description="Control seed with few stories. Detectors should stay quiet.",
    added={"H1": 1, "H2": 3},
    beats=[
        Beat("H1", 22.0, o_careless_foul),
        Beat("H2", 18.0, o_long_range_goal),
        Beat("H2", 28.0, o_subs),
    ],
)

# ---------------------------------------------------------------- discipline & VAR showcase


def d_throw_in_no_offside(e: Engine, labels: list[Label]) -> None:
    """LAW-10: attacker beyond the second-last defender receives directly from a throw-in: no offence."""
    e.gain_possession(AWAY_ID, own_half=True)
    chain(e, AWAY_ID, [("RB", 30.0, 60.0)])
    e.kick_out("touch")
    out_loc = (e.ball[0], e.ball[1])
    st = e.by_slot(HOME_ID, "ST")
    rb = e.by_slot(HOME_ID, "RB")
    assert st and rb
    reason = last_event_id(e, "pass.failed")
    e.restart("throw_in", HOME_ID, out_loc, reason, taker=rb, wait_ms=6000)
    margin = offside_line_run(e, HOME_ID, st, 1.8, 50.0)
    pid = e.pass_to(st, kind="throw_in", height="low", success=True)
    e.emit("offside.position_detected", HOME_ID, st, {
        "pass_event_id": pid, "location": e.pt(e.pos(st)), "involved": True,
        "second_last_defender_x_m": round(e.second_last_defender_ax(HOME_ID), 1),
        "note": f"Centre-coordinate margin {margin} m, received directly from a throw-in: no offside offence.",
    })
    e.bodies[st].pin = None


def d_straight_red(e: Engine, labels: list[Label]) -> None:
    foul(e, HOME_ID, "LW", "RVC-04", (60.0, 12.0), severity="excessive_force", foul_type="tackle",
         card_reason="serious_foul_play")


def d_dogso_holding_penalty_saved(e: Engine, labels: list[Label]) -> None:
    """LAW-05: holding in the area denying an obvious chance, no attempt to play the ball -> penalty + red."""
    fid = foul(e, AWAY_ID, "ST", "NBA-05", (92.5, 33.0), severity=None, foul_type="hold", restart="penalty",
               dogso=True, attempted=False, card_reason="dogso", approach=[("RCM", 66.0, 40.0)])
    penalty_kick(e, AWAY_ID, "ST", fid, "saved", "bottom_left")


def d_injury_dropped_ball(e: Engine, labels: list[Label]) -> None:
    e.gain_possession(HOME_ID)
    chain(e, HOME_ID, [("LDM", 45.0, 30.0)])
    victim = e.by_slot(AWAY_ID, "LCM") or e.nearest(AWAY_ID, (e.ball[0], e.ball[1]), no_gk=True).pid
    e.injury_stoppage(victim)


def d_ifk_direct_into_goal(e: Engine, labels: list[Label]) -> None:
    """LAW-17: indirect free kick enters the goal untouched -> goal kick, no goal."""
    foul(e, HOME_ID, "CAM", "RVC-05", (84.0, 36.0), severity=None, foul_type="dangerous_play",
         restart="indirect_free_kick", approach=[("LDM", 62.0, 33.0)])
    e.shoot("entered_goal", situation="free_kick", placement_ay=37.0)


def d_var_goal_confirmed(e: Engine, labels: list[Label]) -> None:
    """LAW-26: goal provisional while VAR checks; confirmed after no clear and obvious error."""
    e.gain_possession(HOME_ID)
    chain(e, HOME_ID, [("RDM", 52.0, 40.0), ("RW", 76.0, 58.0), ("ST", 91.0, 35.0)])
    e.shoot("goal", assist=e.by_slot(HOME_ID, "RW"))
    gid = last_event_id(e, "goal.provisional")
    e.advance(5000)
    e.emit("var.review_started", None, None, {"check_type": "goal", "subject_event_id": gid,
                                               "reason": "Possible handball by the scorer"}, official=True,
           correlation=gid)
    e.advance(48_000)
    e.emit("var.review_outcome", None, None, {"subject_event_id": gid, "recommendation": "no_clear_error",
                                               "on_field_review": False, "final_decision": "Goal stands"},
           official=True, correlation=gid)
    scorer = next(ev["player_id"] for ev in e.events if ev["event_id"] == gid)
    e.emit("goal.confirmed", HOME_ID, scorer, {"goal_event_id": gid, "decision_route": "after_var_check"},
           official=True, correlation=gid)
    e.score[HOME_ID] += 1
    e.kickoff(AWAY_ID, "after_goal")


def d_dogso_attempt_penalty_retake(e: Engine, labels: list[Label]) -> None:
    """LAW-06 + LAW-22: DOGSO while attempting to play the ball in the area -> penalty + caution;
    accidental double touch and the ball goes in -> retake; retake scored."""
    fid = foul(e, HOME_ID, "ST", "RVC-05", (93.0, 36.0), severity="careless", foul_type="tackle",
               restart="penalty", dogso=True, attempted=True, card_reason="dogso_attempt_to_play_ball",
               approach=[("CAM", 70.0, 34.0)])
    penalty_kick(e, HOME_ID, "CAM", fid, "retake", "bottom_right", touch="accidental_double_touch")
    penalty_kick(e, HOME_ID, "CAM", fid, "scored", "top_left")


def d_rvc_goal(e: Engine, labels: list[Label]) -> None:
    e.gain_possession(AWAY_ID)
    chain(e, AWAY_ID, [("LCM", 58.0, 28.0), ("LW", 80.0, 12.0), ("ST", 92.0, 32.0)])
    e.shoot("goal", assist=e.by_slot(AWAY_ID, "LW"))
    confirm_goal(e, AWAY_ID)


def d_subs(e: Engine, labels: list[Label]) -> None:
    e.at_next_stoppage.append(lambda: e.substitute(HOME_ID, "NBA-07", "NBA-15"))
    e.at_next_stoppage.append(lambda: e.substitute(AWAY_ID, "RVC-11", "RVC-15"))


DISCIPLINE = Scenario(
    scenario_id="discipline_var",
    match_id="BYLINE-02",
    seed=5150,
    version="v1",
    title="Discipline & VAR: Northbridge Athletic v Riverton City",
    description="Referee showcase: throw-in offside exception, straight red, DOGSO penalties (holding vs attempt to "
                "play), injury dropped ball, indirect free kick into goal, VAR-confirmed goal, penalty retake.",
    added={"H1": 3, "H2": 5},
    beats=[
        Beat("H1", 6.0, d_throw_in_no_offside),
        Beat("H1", 13.0, d_straight_red),
        Beat("H1", 21.0, d_dogso_holding_penalty_saved),
        Beat("H1", 30.0, d_injury_dropped_ball),
        Beat("H1", 37.0, d_ifk_direct_into_goal),
        Beat("H2", 6.0, d_var_goal_confirmed),
        Beat("H2", 14.0, d_subs),
        Beat("H2", 16.0, d_dogso_attempt_penalty_retake),
        Beat("H2", 27.0, d_rvc_goal),
    ],
)

SCENARIOS: dict[str, Scenario] = {s.scenario_id: s for s in (GOLDEN, ORDINARY, DISCIPLINE)}


def labels_to_json(labels: list[Label]) -> list[dict[str, Any]]:
    return [
        {"label_id": f"L{i:02d}", "pattern_type": lb.pattern_type, "team_id": lb.team_id, "start_ms": lb.start_ms,
         "end_ms": lb.end_ms, "note": lb.note}
        for i, lb in enumerate(labels, 1)
    ]


__all__ = ["SCENARIOS", "Scenario", "Label", "MIN", "dist"]
