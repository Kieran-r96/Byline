"""V3 tactics: geometry, detectors, What If? and no look-ahead. Deterministic, no model calls."""

from __future__ import annotations

from fastapi.testclient import TestClient

from byline.api.app import app
from byline.football.intelligence import moments_for, run_detectors
from byline.storage.fixtures import MatchPackage, available_scenarios, load_package
from byline.tactics.frame import Body, Frame, Pitch
from byline.tactics.moments import tactical_moments
from byline.tactics.options import options_for
from byline.tactics.whatif import build_whatif


def _frame(bodies: list[Body]) -> Frame:
    return Frame(0, (50.0, 34.0, 0.0), bodies, {"A": "+x", "B": "-x"})


def test_option_geometry_lanes_space_offside() -> None:
    f = _frame([
        Body("A1", "A", 50, 34, False), Body("A2", "A", 70, 34, False), Body("A3", "A", 66, 20, False),
        Body("A4", "A", 90, 50, False),
        Body("B1", "B", 60, 34.4, False),  # sits in the A1 -> A2 lane
        Body("B2", "B", 80, 40, False), Body("B3", "B", 82, 30, False), Body("BGK", "B", 104, 34, True),
    ])
    opts = {o.receiver_id: o for o in options_for(f, "A1")}
    assert opts["A2"].lane_clearance_m < 0.5 and opts["A2"].lane_blocker_id == "B1" and opts["A2"].rating == "blocked"
    assert opts["A3"].rating == "open" and opts["A3"].receiver_space_m > 4
    # A4 is beyond the second-last opponent (B3 at x=82) and ahead of the ball in the opponent half
    assert opts["A4"].offside_position and opts["A4"].rating == "offside"


def test_signature_moment_7_minutes_is_measured_and_consistent(golden: MatchPackage) -> None:
    ms = tactical_moments(golden.world, golden.events, golden.tracking)
    m = next(x for x in ms if x.kind == "option" and x.display_clock == "7'")
    assert m.team_id == "NBA" and m.whatif
    assert m.extra["intended"] == "NBA-09" and m.extra["best"] == "NBA-11"
    pitch = Pitch(golden.world, golden.events, golden.tracking)
    w = build_whatif(m, golden.world, list(golden.events), pitch)
    assert w is not None
    actual = w["actual"]
    assert actual["outcome"] == "intercepted" and actual["option"]["rating"] == "blocked"
    # the geometry and the event log agree: the player who cut it out was in the lane
    assert actual["interceptor_id"] in actual["option"]["lane_opponents"]
    assert len(actual["option"]["lane_opponents"]) == 2
    alt = w["alternatives"][0]
    assert alt["receiver_id"] == "NBA-11" and alt["rating"] == "open" and alt["lane_clearance_m"] >= 3
    # history is the frame at the instant; nothing after it is generated
    assert w["frame_ms"] <= m.at_ms and set(w) >= {"labels", "unknowns", "rules"}
    assert "Not what happened" in w["labels"]["hypothetical"]
    assert all(p["x"] == p["x"] for p in w["players"]) and len(w["players"]) == 22


def test_no_look_ahead_moments_on_a_prefix_equal_released_full_moments(golden: MatchPackage) -> None:
    full = tactical_moments(golden.world, golden.events, golden.tracking)
    for cut in (800, 1500, 2200):
        prefix = [e for e in golden.events if e.seq <= cut]
        part = tactical_moments(golden.world, prefix, golden.tracking)
        released = [m.moment_id for m in full if m.available_seq <= cut]
        assert [m.moment_id for m in part if m.available_seq <= cut] == released


def test_shape_change_waits_for_the_data_it_measures(golden: MatchPackage) -> None:
    for m in tactical_moments(golden.world, golden.events, golden.tracking):
        if m.kind == "shape_change":
            assert m.available_ms - m.at_ms >= 7 * 60_000
        if m.kind == "line_break":
            ev = next(e for e in golden.events if e.seq == m.seq)
            assert ev.payload["pass_kind"] == "open_play" and ev.player_id not in ("NBA-01", "RVC-01")


def test_every_moment_separates_observed_interpretation_unknowns() -> None:
    for sid in available_scenarios():
        pkg = load_package(sid)
        ms = tactical_moments(pkg.world, pkg.events, pkg.tracking)
        assert 30 <= len(ms) <= 90, (sid, len(ms))
        for m in ms:
            assert m.observed and m.summary and m.interpretation and m.unknowns, m.moment_id
            text = (m.summary + m.interpretation).lower()
            for banned in ("deliberately", "intended to", "wanted to", "will score", "would have scored", "chance of"):
                assert banned not in text, (m.moment_id, banned)


def test_tactics_and_whatif_endpoints() -> None:
    with TestClient(app) as c:
        early = c.get("/api/matches/BYLINE-01/tactics", params={"upto_seq": 150}).json()
        later = c.get("/api/matches/BYLINE-01/tactics", params={"upto_seq": 200}).json()
        assert all(m["available_seq"] <= 150 for m in early)
        sig = next(m for m in later if m["kind"] == "option")
        assert c.get(f"/api/matches/BYLINE-01/tactics/{sig['moment_id']}/whatif", params={"upto_seq": 150}).status_code == 404
        w = c.get(f"/api/matches/BYLINE-01/tactics/{sig['moment_id']}/whatif", params={"upto_seq": 200}).json()
        assert w["alternatives"] and w["actual"]["kind"] == "pass"


def test_signal_stream_alerts_var_corrections_and_suppression(golden: MatchPackage) -> None:
    mi = run_detectors(golden.world, golden.events, tracking=golden.tracking,
                       moments=moments_for(golden.events_sha256, golden.world, golden.events, golden.tracking))
    sigs = list(mi.signals.signals.values())
    goals = [s for s in sigs if s.kind == "goal"]
    assert len(goals) == 4
    var = next(s for s in goals if s.status == "corrected")
    assert var.headline.startswith("NO GOAL") and "VAR" in (var.status_reason or "") and var.version >= 3
    # the tactical moment built on the voided goal is withdrawn, not deleted
    withdrawn = [s for s in sigs if s.kind == "tactical" and s.status == "withdrawn"]
    assert withdrawn and all("ruled out" in (s.status_reason or "") for s in withdrawn)
    # one alert per official event; penalties scored are covered by the goal alert
    assert not any(s.kind == "penalty" for s in sigs)
    # suppression: no two unfolded quiet tactical signals of the same kind and team within 6 minutes
    quiet = sorted((s for s in sigs if s.kind == "tactical" and s.tier == "quiet"), key=lambda s: s.at_ms)
    for a, b in zip(quiet, quiet[1:], strict=False):
        if a.refs["tactic"] == b.refs["tactic"] and a.team_id == b.team_id:
            assert b.at_ms - a.at_ms >= 6 * 60_000
    # deterministic: a second run gives identical ids and versions
    again = run_detectors(golden.world, golden.events, tracking=golden.tracking,
                          moments=moments_for(golden.events_sha256, golden.world, golden.events, golden.tracking))
    assert {(s.signal_id, s.version) for s in sigs} == {(s.signal_id, s.version) for s in again.signals.signals.values()}


def test_context_signals_version_changed_facts_and_withdraw_stale_projections(golden: MatchPackage) -> None:
    from byline.football.intelligence import context_for

    mi = run_detectors(golden.world, golden.events, tracking=golden.tracking,
                       moments=moments_for(golden.events_sha256, golden.world, golden.events, golden.tracking),
                       context_source=context_for(golden.events_sha256, golden.world))
    sigs = {s.signal_id: s for s in mi.signals.signals.values()}
    # computed history surfaces once, with the rule that produced it
    hundred = sigs["sig-ctx-milestone-NBA-09-apps-100"]
    assert hundred.tier == "alert" and hundred.version == 1 and hundred.refs["player_id"] == "NBA-09"
    record = sigs["sig-ctx-ft-streak-RVC-losing-league"]
    assert "first time since March 2020" in record.text["commentator"] and record.refs["rule"]
    # conditional projections are withdrawn once the score moves on; none stays live at full time
    projections = [s for k, s in sigs.items() if k.startswith("sig-ctx-ifends")]
    assert projections and all(s.status == "withdrawn" for s in projections)
    # a fact whose wording changes (booking superseded by a sending-off) is a new version, not a duplicate
    booking = sigs["sig-ctx-discipline-E1138"]
    assert booking.version == 2 and "no longer counts" in booking.text["commentator"]
