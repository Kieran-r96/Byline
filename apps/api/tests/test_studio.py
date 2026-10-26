"""T018 / UX-07 / LAW-27: studio graphics queue — approval required, timing, expiry, retraction."""

from __future__ import annotations

import json

from fastapi.testclient import TestClient

from byline.api.app import app
from byline.config import REPO_ROOT
from byline.overlay.desk import ON_AIR_MS, PROPOSAL_TTL_MS, STOPPAGE_TYPES, StudioDesk
from byline.storage.fixtures import MatchPackage, load_package
from byline.stories.models import Insight


def _goal(pkg: MatchPackage, after_ms: int = 0) -> tuple[int, str]:
    ev = next(e for e in pkg.events if e.type == "goal.provisional" and e.elapsed_ms > after_ms)
    return ev.elapsed_ms, ev.event_id


def _play_to(sess, ms: int) -> None:  # type: ignore[no-untyped-def]
    sess.playing = True
    sess.speed = 60
    while sess.playhead_ms < ms:
        sess.tick(0.25)
    sess.playing = False


def test_goal_graphic_requires_approval_then_airs_and_expires() -> None:
    pkg = load_package("golden_story")
    t_goal, gid = _goal(pkg)
    with TestClient(app) as c:
        sid = c.post("/api/matches/BYLINE-01/sessions", json={"speed": 60}).json()["session_id"]
        sess = app.state.rt.sessions.get(sid)
        c.post(f"/api/sessions/{sid}/control", json={"action": "seek", "elapsed_ms": t_goal - 5000})
        _play_to(sess, t_goal + 1000)
        ov = {o["id"]: o for o in c.get(f"/api/sessions/{sid}/overlays").json()}
        p = ov[f"O-{gid}"]
        assert p["status"] == "proposed" and p["template_id"] == "goal_story" and p["requires_approval"] is True
        assert p["title"].startswith("GOAL · Northbridge 1–0")
        r = c.post(f"/api/sessions/{sid}/overlays/O-{gid}/approve?duration_ms={ON_AIR_MS}").json()
        assert r["status"] == "on_screen"  # approved at the current match time, timed
        _play_to(sess, sess.playhead_ms + ON_AIR_MS + 500)
        ov = {o["id"]: o for o in c.get(f"/api/sessions/{sid}/overlays").json()}
        assert ov[f"O-{gid}"]["status"] == "expired"
        assert c.post(f"/api/sessions/{sid}/overlays/O-{gid}/approve").status_code == 409
        assert c.post(f"/api/sessions/{sid}/overlays/nope/approve").status_code == 404


def test_unapproved_proposal_expires_and_reject_works() -> None:
    pkg = load_package("golden_story")
    desk = StudioDesk(pkg.world, pkg.match_id)
    ev = next(e for e in pkg.events if e.type == "goal.provisional")
    desk.on_event(ev, {"NBA": 0, "RVC": 0}, {"NBA": 1, "RVC": 0})
    pid = f"O-{ev.event_id}"
    desk.advance(ev.elapsed_ms + PROPOSAL_TTL_MS + 1)
    assert desk.packets[pid].status == "expired"
    desk2 = StudioDesk(pkg.world, pkg.match_id)
    desk2.on_event(ev, {"NBA": 0, "RVC": 0}, {"NBA": 1, "RVC": 0})
    assert desk2.act(pid, "reject", ev.elapsed_ms).status == "rejected"
    desk2.advance(ev.elapsed_ms + 1000)
    assert desk2.packets[pid].status == "rejected"


def test_var_disallowed_goal_retracts_goal_graphic() -> None:
    """LAW-27: VAR overturns a goal whose graphic was proposed (or approved) -> retracted with reason."""
    pkg = load_package("golden_story")
    t_goal, gid = _goal(pkg, after_ms=4_000_000)
    dis = next(e for e in pkg.events if e.type == "goal.disallowed")
    with TestClient(app) as c:
        sid = c.post("/api/matches/BYLINE-01/sessions", json={"speed": 60}).json()["session_id"]
        sess = app.state.rt.sessions.get(sid)
        c.post(f"/api/sessions/{sid}/control", json={"action": "seek", "elapsed_ms": t_goal - 3000})
        _play_to(sess, t_goal + 500)
        # the check starts within a second of the goal: the graphic is on hold and cannot be approved
        r = c.post(f"/api/sessions/{sid}/overlays/O-{gid}/approve")
        assert r.status_code == 409 and "on hold" in r.json()["detail"]
        _play_to(sess, dis.elapsed_ms + 500)
        ov = {o["id"]: o for o in c.get(f"/api/sessions/{sid}/overlays").json()}
        p = ov[f"O-{gid}"]
        assert p["status"] == "retracted"  # even after airing: audit trail shows it was withdrawn
        assert "Goal disallowed (offside" in p["status_reason"]
        # a decision graphic for the disallowed goal is proposed instead
        assert any(o["template_id"] == "referee_decision" and o["title"] == "GOAL DISALLOWED" for o in ov.values())


def test_retracted_proposal_cannot_be_approved() -> None:
    pkg = load_package("golden_story")
    desk = StudioDesk(pkg.world, pkg.match_id)
    goal = next(e for e in pkg.events if e.type == "goal.provisional" and e.elapsed_ms > 4_000_000)
    dis = next(e for e in pkg.events if e.type == "goal.disallowed")
    desk.on_event(goal, {"NBA": 1, "RVC": 1}, {"NBA": 2, "RVC": 1})
    desk.on_event(dis, {"NBA": 1, "RVC": 1}, {"NBA": 1, "RVC": 1})
    p = desk.packets[f"O-{goal.event_id}"]
    assert p.status == "retracted" and "Goal disallowed" in (p.status_reason or "") and p.version == 2
    try:
        desk.act(p.id, "approve", dis.elapsed_ms)
        raise AssertionError("approved a retracted graphic")
    except ValueError:
        pass


def test_verified_insight_offered_tentative_never() -> None:
    pkg = load_package("golden_story")
    run = json.loads((REPO_ROOT / "docs" / "evidence" / "foundry-run-20261020-212528.json").read_text())
    ins = Insight.model_validate(run["insight"])
    desk = StudioDesk(pkg.world, pkg.match_id)
    desk.offer_insight(ins.model_copy(update={"status": "tentative"}), 1_700_000)
    assert desk.packets == {}
    desk.offer_insight(ins, 1_700_000)
    p = next(iter(desk.packets.values()))
    assert p.template_id == "channel_pressure" and len(p.title) <= 55 and p.status == "proposed"
    assert set(p.source_event_ids) <= {e.event_id for e in pkg.events}


def test_goal_graphic_is_held_during_a_var_check_and_never_airs_a_checked_scoreline() -> None:
    """Blueprint: a scoreline never appears confirmed while a check is ongoing."""
    pkg = load_package("golden_story")
    goal = next(e for e in pkg.events if e.type == "goal.provisional" and e.elapsed_ms > 4_000_000)
    check = next(e for e in pkg.events if e.type == "var.review_started")
    dis = next(e for e in pkg.events if e.type == "goal.disallowed")
    desk = StudioDesk(pkg.world, pkg.match_id)
    desk.on_event(goal, {"NBA": 1, "RVC": 1}, {"NBA": 2, "RVC": 1})
    pid = f"O-{goal.event_id}"
    desk.on_event(check, {"NBA": 1, "RVC": 1}, {"NBA": 2, "RVC": 1})
    held = desk.packets[pid]
    assert held.on_hold and held.status == "proposed" and "VAR check in progress" in (held.status_reason or "")
    try:
        desk.act(pid, "approve", check.elapsed_ms)
        raise AssertionError("approved a goal graphic during its VAR check")
    except ValueError:
        pass
    desk.advance(check.elapsed_ms + 5000)
    assert desk.packets[pid].status == "proposed"  # nothing airs while held
    desk.on_event(dis, {"NBA": 1, "RVC": 1}, {"NBA": 1, "RVC": 1})
    assert desk.packets[pid].status == "retracted"


def test_on_air_goal_graphic_comes_off_when_a_check_starts_and_confirmation_releases_a_hold() -> None:
    from byline.events.models import MatchEvent

    pkg = load_package("golden_story")
    goal = next(e for e in pkg.events if e.type == "goal.provisional" and e.elapsed_ms > 4_000_000)
    check = next(e for e in pkg.events if e.type == "var.review_started")
    desk = StudioDesk(pkg.world, pkg.match_id)
    desk.on_event(goal, {"NBA": 1, "RVC": 1}, {"NBA": 2, "RVC": 1})
    pid = f"O-{goal.event_id}"
    desk.act(pid, "approve", goal.elapsed_ms)
    desk.advance(goal.elapsed_ms)
    assert desk.packets[pid].status == "on_screen"
    desk.on_event(check, {"NBA": 1, "RVC": 1}, {"NBA": 2, "RVC": 1})
    assert desk.packets[pid].status == "hidden" and "VAR check started" in (desk.packets[pid].status_reason or "")
    # a check that confirms the goal releases the hold (constructed confirmation for the same goal)
    desk2 = StudioDesk(pkg.world, pkg.match_id)
    desk2.on_event(goal, {"NBA": 1, "RVC": 1}, {"NBA": 2, "RVC": 1})
    desk2.on_event(check, {"NBA": 1, "RVC": 1}, {"NBA": 2, "RVC": 1})
    confirmed = MatchEvent.model_validate({**check.to_json_dict(), "type": "goal.confirmed", "event_id": "E9999",
                                           "team_id": goal.team_id,
                                           "payload": {"decision_route": "after_var_check",
                                                       "goal_event_id": goal.event_id}})
    desk2.on_event(confirmed, {"NBA": 2, "RVC": 1}, {"NBA": 2, "RVC": 1})
    assert not desk2.packets[pid].on_hold and desk2.act(pid, "approve", confirmed.elapsed_ms).status == "approved"


# ---------------------------------------------------------------- V4 production desk


def test_substitution_board_is_proposed_with_both_players() -> None:
    pkg = load_package("golden_story")
    sub_ev = next(e for e in pkg.events if e.type == "substitution")
    with TestClient(app) as c:
        sid = c.post("/api/matches/BYLINE-01/sessions", json={"speed": 60}).json()["session_id"]
        sess = app.state.rt.sessions.get(sid)
        c.post(f"/api/sessions/{sid}/control", json={"action": "seek", "elapsed_ms": sub_ev.elapsed_ms - 3000})
        _play_to(sess, sub_ev.elapsed_ms + 500)
        ov = {o["id"]: o for o in c.get(f"/api/sessions/{sid}/overlays").json()}
        p = ov[f"O-{sub_ev.event_id}"]
        assert p["template_id"] == "substitution" and p["status"] == "proposed"
        assert p["data"]["on"]["id"] == sub_ev.payload["player_on_id"]
        assert p["data"]["off"]["id"] == sub_ev.payload["player_off_id"]


def test_scheduled_graphic_airs_at_the_next_stoppage_not_before() -> None:
    pkg = load_package("golden_story")
    t_goal, gid = _goal(pkg)
    with TestClient(app) as c:
        sid = c.post("/api/matches/BYLINE-01/sessions", json={"speed": 60}).json()["session_id"]
        sess = app.state.rt.sessions.get(sid)
        c.post(f"/api/sessions/{sid}/control", json={"action": "seek", "elapsed_ms": t_goal - 3000})
        _play_to(sess, t_goal + 20_000)
        r = c.post(f"/api/sessions/{sid}/overlays/O-{gid}/approve?cue=next_stoppage").json()
        assert r["status"] == "approved" and r["cue"] == "next_stoppage" and r["display_from_ms"] is None
        # the playhead advances in steps: find the first stoppage after where approval actually happened
        stop = next(e for e in pkg.events if e.elapsed_ms > sess.playhead_ms and e.type in STOPPAGE_TYPES)
        sess.speed = 1
        while sess.playhead_ms < stop.elapsed_ms - 400:
            sess.playing = True
            sess.tick(min(0.25, (stop.elapsed_ms - 400 - sess.playhead_ms) / 1000))
        sess.playing = False
        assert {o["id"]: o for o in c.get(f"/api/sessions/{sid}/overlays").json()}[f"O-{gid}"]["status"] == "approved"
        _play_to(sess, stop.elapsed_ms + 600)
        p = {o["id"]: o for o in c.get(f"/api/sessions/{sid}/overlays").json()}[f"O-{gid}"]
        assert p["status"] == "on_screen" and p["display_from_ms"] == stop.elapsed_ms


def test_delayed_graphic_waits_for_its_slot() -> None:
    pkg = load_package("golden_story")
    t_goal, gid = _goal(pkg)
    with TestClient(app) as c:
        sid = c.post("/api/matches/BYLINE-01/sessions", json={"speed": 60}).json()["session_id"]
        sess = app.state.rt.sessions.get(sid)
        c.post(f"/api/sessions/{sid}/control", json={"action": "seek", "elapsed_ms": t_goal - 3000})
        _play_to(sess, t_goal + 1000)
        now = sess.playhead_ms
        r = c.post(f"/api/sessions/{sid}/overlays/O-{gid}/approve?cue=delay&delay_ms=20000").json()
        assert r["status"] == "approved" and r["display_from_ms"] == now + 20_000
        _play_to(sess, now + 21_000)
        p = {o["id"]: o for o in c.get(f"/api/sessions/{sid}/overlays").json()}[f"O-{gid}"]
        assert p["status"] == "on_screen"


def test_producer_proposals_only_for_what_has_happened() -> None:
    with TestClient(app) as c:
        sid = c.post("/api/matches/BYLINE-01/sessions", json={"speed": 60}).json()["session_id"]
        sess = app.state.rt.sessions.get(sid)
        c.post(f"/api/sessions/{sid}/control", json={"action": "seek", "elapsed_ms": 60_000})
        # the 7' tactical moment has not happened yet at 1'
        assert c.post(f"/api/sessions/{sid}/overlays/propose", json={"kind": "tactical", "ref": "T-option-NBA-0180"}).status_code == 404
        _play_to(sess, 400_000)
        # it was proposed automatically when it happened; asking again does not duplicate it
        auto = {o["id"]: o for o in c.get(f"/api/sessions/{sid}/overlays").json()}["O-T-option-NBA-0180"]
        assert auto["origin"] == "auto"
        r = c.post(f"/api/sessions/{sid}/overlays/propose", json={"kind": "tactical", "ref": "T-option-NBA-0180"})
        assert r.status_code == 200 and r.json()["already_queued"] is True
        # once rejected, a producer can ask for it again as a new version
        c.post(f"/api/sessions/{sid}/overlays/O-T-option-NBA-0180/reject")
        p = c.post(f"/api/sessions/{sid}/overlays/propose", json={"kind": "tactical", "ref": "T-option-NBA-0180"}).json()
        assert p["origin"] == "producer" and p["template_id"] == "tactical_moment" and p["status"] == "proposed"
        assert p["version"] > auto["version"] and p["already_queued"] is False
        assert p["requires_approval"] is True and p["demo_only"] is True
        stats = c.post(f"/api/sessions/{sid}/overlays/propose", json={"kind": "stats"}).json()
        assert stats["template_id"] == "stat_comparison"
        shots = next(r for r in stats["data"]["rows"] if r["key"] == "shots")
        state = sess.intelligence.state.snapshot()["stats"]
        assert shots["home"] == state["NBA"]["shots"] and shots["away"] == state["RVC"]["shots"]
        assert c.post(f"/api/sessions/{sid}/overlays/propose", json={"kind": "context", "ref": "nope"}).status_code == 404


def test_half_time_stats_panel_is_offered_at_the_whistle() -> None:
    pkg = load_package("golden_story")
    ht = next(e for e in pkg.events if e.type == "period.ended" and e.period == "H1")
    with TestClient(app) as c:
        sid = c.post("/api/matches/BYLINE-01/sessions", json={"speed": 60}).json()["session_id"]
        sess = app.state.rt.sessions.get(sid)
        c.post(f"/api/sessions/{sid}/control", json={"action": "seek", "elapsed_ms": ht.elapsed_ms - 2000})
        _play_to(sess, ht.elapsed_ms + 500)
        ov = {o["id"]: o for o in c.get(f"/api/sessions/{sid}/overlays").json()}
        assert ov["O-stats-half-time"]["template_id"] == "stat_comparison"
        assert ov["O-stats-half-time"]["title"].startswith("HALF-TIME")


def test_scheduled_desk_unit_expires_without_a_stoppage() -> None:
    pkg = load_package("golden_story")
    desk = StudioDesk(pkg.world, "BYLINE-01")
    m = next(e for e in pkg.events if e.type == "goal.provisional")
    desk.on_event(m, {"NBA": 0, "RVC": 0}, {"NBA": 1, "RVC": 0})
    pid = f"O-{m.event_id}"
    desk.act(pid, "approve", m.elapsed_ms + 1000, cue="next_stoppage")
    desk.advance(m.elapsed_ms + PROPOSAL_TTL_MS + 5000)
    assert desk.packets[pid].status == "expired"


def test_on_air_graphic_stays_until_taken_off_and_a_correction_withdraws_it_from_air() -> None:
    """A graphic does not vanish on its own: persistent until Take off; a correction pulls it from air."""
    pkg = load_package("golden_story")
    t_goal, gid = _goal(pkg)
    with TestClient(app) as c:
        sid = c.post("/api/matches/BYLINE-01/sessions", json={"speed": 60}).json()["session_id"]
        sess = app.state.rt.sessions.get(sid)
        c.post(f"/api/sessions/{sid}/control", json={"action": "seek", "elapsed_ms": t_goal - 5000})
        _play_to(sess, t_goal + 1000)
        assert c.post(f"/api/sessions/{sid}/overlays/O-{gid}/approve").json()["status"] == "on_screen"
        _play_to(sess, sess.playhead_ms + 5 * 60_000)  # five match minutes later: still on air
        ov = {o["id"]: o for o in c.get(f"/api/sessions/{sid}/overlays").json()}
        assert ov[f"O-{gid}"]["status"] == "on_screen"
        assert c.post(f"/api/sessions/{sid}/overlays/O-{gid}/hide").json()["status"] == "hidden"
        # a correction withdraws a graphic that is on air
        c.post(f"/api/sessions/{sid}/overlays/O-{gid}/hide")
        p = sess.studio.packets[f"O-{gid}"]
        sess.studio._put(p.model_copy(update={"status": "on_screen", "version": p.version + 1}))
        sess.studio.retract(f"O-{gid}", "Goal disallowed after a VAR check")
        assert sess.studio.packets[f"O-{gid}"].status == "retracted"
