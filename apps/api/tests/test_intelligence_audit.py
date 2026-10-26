"""Priority 6 audit: every tactical observation must be compatible with the event and frame it cites.

The sweep here recomputes the play phase of each anchor event independently of byline.events.phase (a plain
backwards scan for the restart that put the ball in play), so a bug in the classifier cannot hide itself.
"""

from __future__ import annotations

from functools import cache

import pytest

from byline.events.models import MatchEvent
from byline.events.phase import play_phases
from byline.football.intelligence import context_for, moments_for, run_detectors
from byline.signals.engine import Signal
from byline.storage.fixtures import MatchPackage, available_scenarios, load_package
from byline.tactics.frame import Pitch
from byline.tactics.moments import TacticalMoment, tactical_moments
from byline.world.models import ScenarioRef
from byline.world.seed_world import build_world
from tests.conftest import EventFactory, kickoff_stream, pt

BALL = ("pass.completed", "pass.failed", "carry", "shot")
# the event type each per-event detector may anchor on (window kinds have no single anchor)
ANCHOR_TYPES: dict[str, tuple[str, ...]] = {
    "line_break": ("pass.completed",), "between_lines": ("pass.completed",), "run": ("pass.completed",),
    "overload": ("pass.completed", "carry"), "option": ("pass.failed",), "beaten": ("carry",),
    "foul_stops_attack": ("foul.committed",), "high_turnover": ("interception", "tackle", "ball_recovery"),
    "shape_change": ("substitution",),
}
OPEN_PLAY_KINDS = {"line_break", "between_lines", "run", "overload", "option", "beaten"}
FRAME_TOLERANCE_MS = 500  # 2 Hz tracking: the frame read is the one at or just before the event


@cache
def _pkg(sid: str) -> MatchPackage:
    return load_package(sid)


@cache
def _moments(sid: str) -> tuple[TacticalMoment, ...]:
    p = _pkg(sid)
    return tuple(tactical_moments(p.world, p.events, p.tracking))


@cache
def _signals(sid: str) -> dict[str, Signal]:
    p = _pkg(sid)
    mi = run_detectors(p.world, p.events, p.tracking, moments_for(p.events_sha256, p.world, p.events, p.tracking),
                       context_for(p.events_sha256, p.world))
    return dict(mi.signals.signals)


# ---------------------------------------------------------------- official corrections (VAR, offside, retakes)


def test_a_line_break_measured_on_the_pass_ruled_offside_is_withdrawn() -> None:
    """golden 71'-72': L. Ferrandi's pass E2002 to N. Vantreight was labelled a line-breaking pass; VAR then
    confirmed the offside offence on exactly that pass (E2010, decision_event_id E2002)."""
    s = _signals("golden_story")
    lb = s["sig-T-line_break-NBA-2002"]
    assert lb.status == "withdrawn" and "offside" in (lb.status_reason or "") and "E2010" in (lb.status_reason or "")
    assert "E2002" in (lb.status_reason or "")
    # the play BEFORE the offence was legal and stays: an offside withdrawal must cite the pass or later play
    for sig in s.values():
        if "offside" in (sig.status_reason or "") and sig.status == "withdrawn":
            assert any(e[1:].isdigit() and 2002 <= int(e[1:]) <= 2009 for e in sig.evidence_event_ids), sig.signal_id
    # every withdrawal cites the official decision that caused it
    for sig in s.values():
        if sig.kind == "tactical" and sig.status == "withdrawn":
            assert "ruled out" in (sig.status_reason or ""), sig.signal_id


def test_a_goal_confirmed_after_a_var_check_no_longer_reads_var_check() -> None:
    """discipline_var 52'-53': the goal stood after VAR, but the headline kept 'VAR CHECK · ...'."""
    g = _signals("discipline_var")["sig-goal-E1462"]
    assert g.status == "live" and g.status_reason == "Confirmed"
    assert g.headline.startswith("GOAL · ") and "VAR" not in g.headline
    assert "confirmed" in g.text["commentator"]


def test_a_penalty_ruled_out_for_a_double_touch_is_a_retake_not_a_foul() -> None:
    """discipline_var 63': the scored penalty was ruled out because the kicker touched it twice (Law 14) and
    retaken; the alert said 'ruled out for foul'."""
    g = _signals("discipline_var")["sig-goal-E1705"]
    text = " ".join([g.headline, g.status_reason or "", *g.text.values()])
    assert g.status == "corrected" and "foul" not in text
    assert "retaken" in text and "double touch" in text and "Law 14" in text


def _independent_phase(events: list[MatchEvent], i: int) -> str:
    """'open_play', or the restart whose first ball action event i is (the taker's delivery)."""
    ev = events[i]
    kind = ev.payload.get("pass_kind")
    if kind not in (None, "open_play", "cross"):
        return str(kind)
    for j in range(i - 1, -1, -1):
        p = events[j]
        if p.type in BALL:
            return "open_play"  # an earlier ball action since the restart: the restart was already taken
        if p.type in ("restart.taken", "kickoff", "penalty.taken"):
            return str(p.payload.get("restart_type", p.type.split(".")[0])) if p.team_id == ev.team_id else "open_play"
        if p.type in ("restart.awarded", "goal.provisional", "period.ended"):
            return "dead_ball"
    return "dead_ball"


@pytest.mark.parametrize("sid", available_scenarios())
def test_every_tactical_moment_anchor_is_compatible_with_its_claim(sid: str) -> None:
    pkg = _pkg(sid)
    events = list(pkg.events)
    index = {e.event_id: i for i, e in enumerate(events)}
    pitch = Pitch(pkg.world, pkg.events, pkg.tracking)
    bad: list[str] = []
    for m in _moments(sid):
        allowed = ANCHOR_TYPES.get(m.kind)
        if allowed is None:
            continue  # window moments (press, stretched, response) aggregate 10 minutes, no single anchor
        anchor = events[index[m.evidence_event_ids[0]]]
        if anchor.type not in allowed:
            bad.append(f"{m.moment_id}: anchored on {anchor.type}")
        if anchor.seq != m.seq or anchor.elapsed_ms != m.at_ms:
            bad.append(f"{m.moment_id}: label not on its anchor event ({anchor.event_id})")
        if m.kind in OPEN_PLAY_KINDS:
            phase = _independent_phase(events, index[anchor.event_id])
            if phase != "open_play":
                bad.append(f"{m.moment_id} {m.display_clock}: {m.kind} on a {phase} ({anchor.event_id})")
            frame = pitch.at(anchor.elapsed_ms)
            assert frame is not None
            if not 0 <= anchor.elapsed_ms - frame.t_ms <= FRAME_TOLERANCE_MS:
                bad.append(f"{m.moment_id}: frame {frame.t_ms} not within {FRAME_TOLERANCE_MS} ms of the event")
        if m.kind == "line_break":
            assert anchor.payload.get("pass_kind") == "open_play", m.moment_id
        if m.kind == "high_turnover":  # regain -> shot must be one passage of open play
            shot = events[index[m.evidence_event_ids[1]]]
            between = events[index[anchor.event_id]:index[shot.event_id]]
            if shot.type != "shot" or any(e.type in ("restart.awarded", "goal.provisional") for e in between):
                bad.append(f"{m.moment_id}: regain and shot are not one passage of play")
    assert not bad, bad


def test_play_phase_classifies_restart_deliveries_by_sequence_not_by_pass_kind(factory: EventFactory) -> None:
    f, w = factory, build_world("T-MATCH", ScenarioRef(scenario_id="t", seed=1, version="t", title="t", description="t"))

    def pas(team: str, pid: str, to: str, kind: str = "open_play") -> MatchEvent:
        return f("pass.completed", team, pid, start=pt(60, 30), end=pt(80, 30), receiver_player_id=to, height="ground",
                 pass_kind=kind)

    def award(rtype: str, team: str) -> MatchEvent:
        return f("restart.awarded", official=True, restart_type=rtype, awarded_to_team_id=team, location=pt(105, 0),
                 reason_event_id=None, law_ref="Law 17")

    evs = kickoff_stream(f, w)
    first = pas("NBA", "NBA-09", "NBA-06")  # the kick-off pass
    second = pas("NBA", "NBA-06", "NBA-04")
    corner = [award("corner", "RVC"), f("restart.taken", "RVC", "RVC-11", restart_type="corner", location=pt(105, 0)),
              pas("RVC", "RVC-11", "RVC-09", kind="cross")]  # the feed stamps the corner delivery 'cross'
    after = pas("RVC", "RVC-09", "RVC-10")
    throw = [award("throw_in", "NBA"), f("restart.taken", "NBA", "NBA-02", restart_type="throw_in", location=pt(40, 0)),
             f("pressure", "RVC", "RVC-07", location=pt(40, 1), opponent_player_id="NBA-02"),
             pas("NBA", "NBA-02", "NBA-07")]  # an opponent's pressure does not end the restart
    goal = f("goal.provisional", "NBA", "NBA-09", official=True, shot_event_id="X", location=pt(95, 34),
             assist_player_id=None, conceding_team_id="RVC")
    ph = play_phases([*evs, first, second, *corner, after, *throw, goal])
    assert ph[evs[-1].event_id] == "kickoff" and ph[first.event_id] == "kickoff" and ph[second.event_id] == "open_play"
    assert ph[corner[0].event_id] == "dead_ball" and ph[corner[2].event_id] == "corner"
    assert ph[after.event_id] == "open_play"
    assert ph[throw[3].event_id] == "throw_in" and ph[goal.event_id] == "dead_ball"
    assert ph[evs[0].event_id] == "dead_ball"  # line-ups before kick-off


def test_owner_report_reproduced_corner_and_throw_in_are_not_tactical_sequences(golden: MatchPackage,
                                                                               ordinary: MatchPackage) -> None:
    """The reported bug: a tactical label on the visible corner (and a line-breaking 'pass' that was a throw-in)."""
    g = {m.moment_id for m in _moments("golden_story")}
    o = {m.moment_id for m in _moments("ordinary_match")}
    # 33': RVC-11's corner (restart.taken E0899) was labelled "Run creates the option"
    corner = next(e for e in golden.events if e.seq == 899)
    assert corner.type == "restart.taken" and corner.payload["restart_type"] == "corner"
    assert "T-run-RVC-0900" not in g
    # 78': NBA-20's throw-in was labelled "receives between the lines"
    assert "T-between_lines-NBA-2164" not in g
    # 64': RVC-03's throw-in was labelled a "Line-breaking pass"
    throw = next(e for e in ordinary.events if e.seq == 1794)
    assert throw.type == "restart.taken" and throw.payload["restart_type"] == "throw_in"
    assert "T-line_break-RVC-1795" not in o
    # discipline_var 22': the goalkeeper's goal kick was labelled "receives between the lines"
    assert "T-between_lines-RVC-0576" not in {m.moment_id for m in _moments("discipline_var")}
