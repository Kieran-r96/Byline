"""V4 commentator research: dossiers, talking points and the extended match stats (deterministic, no future)."""

from __future__ import annotations

import itertools
import time
from collections import Counter
from typing import Any

import pytest
from fastapi.testclient import TestClient

from byline.api.app import app
from byline.events.models import MatchEvent
from byline.football.intelligence import context_for, moments_for, run_detectors
from byline.match_state.reducer import replay
from byline.storage.fixtures import MatchPackage
from byline.stories.recap import RECAP_STATS, recap_facts
from byline.world.context import MAX_TEXT, context_facts
from byline.world.dossier import (
    _similar,
    h2h_dossier,
    match_dossier,
    player_dossier,
    talking_points,
    team_dossier,
)
from byline.world.history import synthetic_history
from byline.world.knowledge import CURRENT_SEASON, build
from byline.world.models import World
from byline.world.records import biggest, record, select
from tests.conftest import EventFactory, kickoff_stream, pt

KINDS = {"player", "team", "h2h", "record", "streak", "milestone", "discipline", "manager", "stadium", "tactical",
         "storyline"}
SOURCES = {"fictional history", "this match", "tracking"}


def upto(pkg: MatchPackage, seq: int) -> list[MatchEvent]:
    return [e for e in pkg.events if e.seq <= seq]


def seq_at_minute(pkg: MatchPackage, period: str, minute: int) -> int:
    start = next(e for e in pkg.events if e.type == "period.started" and e.period == period).elapsed_ms
    return [e for e in pkg.events if e.period == period and e.elapsed_ms - start <= minute * 60_000][-1].seq


def tps_at(pkg: MatchPackage, seq: int, limit: int = 30) -> list[dict[str, Any]]:
    evs = tuple(upto(pkg, seq))
    mi = run_detectors(pkg.world, evs, tracking=pkg.tracking,
                       moments=moments_for(pkg.events_sha256, pkg.world, pkg.events, pkg.tracking),
                       context_source=context_for(pkg.events_sha256, pkg.world))
    return talking_points(pkg.world, evs, context_facts(pkg.world, evs), state=mi.state,
                          storylines=mi.storylines.snapshot(), moments=[m.to_json() for m in mi.moments],
                          limit=limit)


# ---------------------------------------------------------------- match stats (reducer, new keys only)


def test_new_stats_keys_count_the_event_log(golden: MatchPackage) -> None:
    st = replay(golden.world, list(golden.events))
    stats = st.snapshot()["stats"]
    evs = golden.events
    for t in ("NBA", "RVC"):
        s = stats[t]
        # the original keys are unchanged
        assert {"passes", "passes_completed", "shots", "shots_on_target", "fouls", "corners", "offsides"} <= set(s)
        awarded = Counter(e.payload["restart_type"] for e in evs if e.type == "restart.awarded"
                          and e.payload["awarded_to_team_id"] == t)
        assert s["throw_ins"] == awarded["throw_in"] > 0
        assert s["goal_kicks"] == awarded["goal_kick"]
        assert s["corners"] == awarded["corner"]
        assert s["free_kicks"] == awarded["direct_free_kick"] + awarded["indirect_free_kick"]
        assert s["saves"] == sum(1 for e in evs if e.type == "save" and e.team_id == t) > 0
        assert s["tackles"] == sum(1 for e in evs if e.type == "tackle" and e.team_id == t)
        assert s["interceptions"] == sum(1 for e in evs if e.type == "interception" and e.team_id == t)
        shots = Counter(e.payload["outcome"] for e in evs if e.type == "shot" and e.team_id == t)
        assert s["shots_blocked"] == shots["blocked"]
        assert s["shots_off_target"] == shots["off_target"] + shots["woodwork"]
        assert s["substitutions"] == sum(1 for e in evs if e.type == "substitution" and e.team_id == t)
        assert s["yellow_cards"] == sum(1 for c in st.cards if c.team_id == t and c.colour == "yellow")
        assert s["red_cards"] == sum(1 for c in st.cards if c.team_id == t and c.colour != "yellow")
    assert stats["NBA"]["possession_pct"] + stats["RVC"]["possession_pct"] == 100
    assert stats["RVC"]["red_cards"] == 1 and stats["NBA"]["offsides"] == 2


def test_recap_fact_sheet_keeps_its_original_stats(golden: MatchPackage) -> None:
    """New stat keys must not widen the recap validator's allowed numbers (or change recorded recap sheets)."""
    st = replay(golden.world, list(golden.events))
    facts = recap_facts(st, list(golden.events), [])
    assert all(tuple(v) == RECAP_STATS for v in facts["stats"].values())


def test_possession_time_accrues_only_in_play(world: World, factory: EventFactory) -> None:
    evs = kickoff_stream(factory, world)
    evs.append(factory("pass.completed", "NBA", "NBA-09", dt=4000, start=pt(52.5, 34), end=pt(45, 30),
                       receiver_player_id="NBA-08"))
    evs.append(factory("interception", "RVC", "RVC-06", dt=2000, location=pt(50, 30)))
    st = replay(world, evs)
    stats = st.stats_view()
    # nothing accrues before kick-off; NBA then has the ball until the interception (4 s + 2 s)
    assert stats["NBA"]["possession_ms"] == 6000 and stats["RVC"]["possession_ms"] == 0
    assert (stats["NBA"]["possession_pct"], stats["RVC"]["possession_pct"]) == (100, 0)
    assert replay(world, evs[:2]).stats_view()["NBA"]["possession_pct"] is None


# ---------------------------------------------------------------- player dossier


def test_player_dossier_matches_the_knowledge_base(golden: MatchPackage) -> None:
    w = golden.world
    kb = build(w)
    d = player_dossier(w, golden.events, "NBA-09")
    car = kb.careers["NBA-09"]
    p = w.player("NBA-09")
    ident = d["player"]
    assert (ident["name"], ident["shirt_number"], ident["position"], ident["age"], ident["hometown"]) == (
        "Nico Vantreight", p.shirt_number, p.position, car.age, car.hometown)
    assert ident["club"]["team_id"] == "NBA" and ident["joined_season"] == car.joined_season
    assert d["totals"]["club"]["apps"] == sum(s.apps for s in car.at(w.home.name)) == 99
    assert d["totals"]["overall"]["goals"] == sum(r["goals"] for r in d["career"]["seasons"])
    assert len(d["career"]["seasons"]) == len(car.seasons)
    assert d["season"]["apps"] == car.seasons[-1].apps and d["season"]["season"] == CURRENT_SEASON
    assert len(d["derby"]["goals"]) == d["derby"]["goals_before_today"] == car.derby_goals
    assert f"{d['totals']['club']['apps']} league appearances" in d["profile_line"]
    assert str(car.age) in d["profile_line"] and car.hometown in d["profile_line"]
    assert d["milestones"][0]["text"] == "Today is his 100th league appearance for Northbridge."
    assert all(c["player_ids"].count("NBA-09") == 1 for c in d["connections"])
    assert d["facts"] and d["fictional"] is True
    for key in ("this_match", "season", "career", "totals", "derby"):
        assert d[key]["scope"], key
    # a goalkeeper gets clean sheets, an outfield player does not
    gk = player_dossier(w, golden.events, "NBA-01")
    assert gk["totals"]["club"]["clean_sheets"] is not None and d["totals"]["club"]["clean_sheets"] is None


def test_player_this_match_counts_events(golden: MatchPackage) -> None:
    w = golden.world
    seq = seq_at_minute(golden, "H1", 30)
    evs = upto(golden, seq)
    d = player_dossier(w, evs, "NBA-09")["this_match"]
    mine = [e for e in evs if e.player_id == "NBA-09"]
    assert d["passes"]["attempted"] == sum(1 for e in mine if e.type in ("pass.completed", "pass.failed"))
    assert d["passes"]["completed"] == sum(1 for e in mine if e.type == "pass.completed")
    assert d["shots"]["total"] == sum(1 for e in mine if e.type == "shot")
    assert d["goals"] == 1 and d["goal_minutes"] == ["28'"]
    assert d["role"] == "starting_xi" and d["on_pitch_now"] is True
    assert d["minutes_on_pitch"] in (29, 30)
    # a substitute's minutes start when he comes on; the player he replaced stops at the same moment
    sub = next(e for e in golden.events if e.type == "substitution")
    after = upto(golden, sub.seq + 40)
    on = player_dossier(w, after, sub.payload["player_on_id"])["this_match"]
    off = player_dossier(w, after, sub.payload["player_off_id"])["this_match"]
    assert on["role"] == "bench" and on["substitution"]["on"]["event_id"] == sub.event_id
    assert on["ms_on_pitch"] == after[-1].elapsed_ms - sub.elapsed_ms
    assert off["substitution"]["off"]["replaced_by"] == sub.payload["player_on_id"] and not off["on_pitch_now"]
    # the dismissed player's clock stops at the red card
    red = next(e for e in golden.events if e.type == "card.second_yellow")
    sent = player_dossier(w, golden.events, red.player_id or "")["this_match"]
    assert not sent["on_pitch_now"] and any(c["colour"] == "second_yellow" for c in sent["cards"])
    start = next(e for e in golden.events if e.type == "period.started").elapsed_ms
    h1_end = next(e for e in golden.events if e.type == "period.ended").elapsed_ms
    h2 = [e for e in golden.events if e.type == "period.started"][-1].elapsed_ms
    assert sent["ms_on_pitch"] == (h1_end - start) + (red.elapsed_ms - h2)


def test_milestone_waits_for_the_lineup(golden: MatchPackage) -> None:
    lineup = next(e for e in golden.events if e.type == "lineup.confirmed" and e.team_id == "NBA")
    before = player_dossier(golden.world, upto(golden, lineup.seq - 1), "NBA-09")
    assert before["this_match"]["role"] is None
    assert [m["text"] for m in before["milestones"]] == ["1 short of 100 league appearances for Northbridge."]
    after = player_dossier(golden.world, upto(golden, lineup.seq), "NBA-09")
    assert after["milestones"][0]["status"] == "reached_today"


# ---------------------------------------------------------------- no look-ahead


@pytest.mark.parametrize("minute", [5, 30, 70])
def test_dossiers_on_a_prefix_ignore_the_future(golden: MatchPackage, minute: int) -> None:
    period = "H1" if minute <= 45 else "H2"
    seq = seq_at_minute(golden, period, minute if period == "H1" else minute - 45)
    prefix = upto(golden, seq)
    w = golden.world
    with TestClient(app) as c:
        for pid in ("NBA-09", "RVC-06", "NBA-10"):
            api = c.get(f"/api/matches/BYLINE-01/dossier/players/{pid}?upto_seq={seq}").json()
            assert api == player_dossier(w, prefix, pid)
        assert c.get(f"/api/matches/BYLINE-01/dossier/teams/RVC?upto_seq={seq}").json() == \
            team_dossier(w, prefix, "RVC")
        assert c.get(f"/api/matches/BYLINE-01/dossier/h2h?upto_seq={seq}").json() == h2h_dossier(w, prefix)
        api_tp = c.get(f"/api/matches/BYLINE-01/talking-points?upto_seq={seq}&limit=30").json()
    assert api_tp["talking_points"] == tps_at(golden, seq)
    assert api_tp["upto_seq"] == seq


def test_nothing_from_later_events_leaks(golden: MatchPackage) -> None:
    first_goal = next(e for e in golden.events if e.type == "goal.confirmed")
    seq = first_goal.seq - 1
    tps = tps_at(golden, seq)
    assert not [t for t in tps if "goal" in t["id"] or "ifends" in t["id"]]
    assert all(t["at_ms"] <= golden.events[seq].elapsed_ms for t in tps)
    d = player_dossier(golden.world, upto(golden, seq), "NBA-09")
    assert d["this_match"]["goals"] == 0 and d["season"]["including_today"]["goals"] == d["season"]["goals"]
    team = team_dossier(golden.world, upto(golden, seq), "NBA")
    assert team["this_match"]["score"] == 0
    assert team["this_match"]["stats"]["shots"] == sum(1 for e in upto(golden, seq)
                                                        if e.type == "shot" and e.team_id == "NBA")


# ---------------------------------------------------------------- team, h2h, match


def test_team_dossier_is_consistent_with_history(golden: MatchPackage) -> None:
    w = golden.world
    prov = synthetic_history(w)
    kb = build(w)
    d = team_dossier(w, golden.events, "NBA")
    assert d["club"]["name"] == w.home.name and d["club"]["founded"] == w.home.founded
    tenure = prov.manager("NBA")
    spell = [m for m in prov.fixtures("NBA") if m.date >= tenure.start_date]
    r = record(spell)
    assert (d["manager"]["record"]["played"], d["manager"]["record"]["won"]) == (r.played, r.won)
    assert d["manager"]["record"]["win_pct"] == round(100 * r.won / r.played, 1)
    hist = prov.fixtures("NBA")
    assert [m["date"] for m in d["form"]["matches"]] == [m.date for m in reversed(hist[-5:])]
    rows = d["seasons"]["rows"]
    assert [(x["season"], x["position"], x["points"]) for x in rows] == [
        (s.season, s.position, s.points) for s in kb.seasons["NBA"]]
    assert d["honours"]["cups"] == [s.season for s in kb.seasons["NBA"] if s.cup == "Winners"] == ["2018/19"]
    assert d["honours"]["league_titles"] == [s.season for s in kb.seasons["NBA"] if s.position == 1]
    big = biggest(hist, "W")
    assert big is not None and d["biggest"]["win_all_competitions"]["date"] == big.date
    assert len(d["upcoming"]["fixtures"]) == 3
    assert len(d["squad"]["players"]) == len(w.home.players)
    assert sum(1 for p in d["squad"]["players"] if p["today"] == "starting_xi") == 11
    assert d["this_match"]["stats"] == replay(w, list(golden.events)).stats_view()["NBA"]
    home_unbeaten = next(s for s in d["streaks"]["current"]
                         if (s["kind"], s["scope"], s["where"]) == ("unbeaten", "league", "home"))
    assert home_unbeaten["is_longest_in_record"] and home_unbeaten["first_since_note"].startswith("no run as long")
    for key in ("manager", "form", "streaks", "seasons", "honours", "biggest", "upcoming", "this_match"):
        assert "scope" in d[key] or "scope" in d[key].get("record", {}), key


def test_h2h_dossier_counts_meetings(golden: MatchPackage) -> None:
    w = golden.world
    kb = build(w)
    prov = synthetic_history(w)
    d = h2h_dossier(w, golden.events)
    h2h = prov.head_to_head("NBA", "RVC")
    r = record(h2h)
    assert (d["record_window"]["played"], d["record_window"]["won"], d["record_window"]["lost"]) == (
        r.played, r.won, r.lost)
    assert d["all_time"]["meetings"] == kb.all_time["meetings"]
    last = d["last_meetings"]["meetings"]
    assert len(last) == 6 and last[0]["date"] == kb.meetings[-1].date and last[0]["score"] == "2-2"
    assert {s["name"] for s in last[0]["scorers"]} == {n for _t, n, _m in kb.meetings[-1].scorers}
    for s in d["leading_scorers"]["players"]:
        assert s["derby_goals_before_today"] == kb.careers[s["player_id"]].derby_goals
    assert d["leading_scorers"]["players"][0]["player_id"] == "NBA-10"
    nba_big = biggest(h2h, "W")
    assert nba_big is not None and d["teams"]["NBA"]["biggest_win"]["date"] == nba_big.date
    assert d["teams"]["RVC"]["at_home"]["played"] == len(select(prov.head_to_head("RVC", "NBA"), "all", "home"))
    assert d["today"]["score"] == {"NBA": 2, "RVC": 1}


def test_match_dossier(golden: MatchPackage) -> None:
    w = golden.world
    kb = build(w)
    ctx = context_facts(w, golden.events)
    d = match_dossier(w, ctx)
    assert d["stadium"]["capacity"] == kb.stadium["capacity"]
    assert d["stadium"]["record_attendance"] == kb.stadium["record_attendance"]
    ref = next(o for o in d["officials"] if o["role"] == "referee")
    assert ref["record"]["yellows_this_season"] == kb.referee.yellows_this_season
    assert len(d["officials"]) == len(w.fixture.officials)
    assert d["context"] and all(c["trigger_event_id"] is None for c in d["context"])
    assert d["ruleset"]["max_substitutions"] == 5 and d["ruleset"]["notes"]


# ---------------------------------------------------------------- talking points


@pytest.mark.parametrize("minute", [1, 30, 45, 64, 90])
def test_talking_points_are_well_formed_and_deduplicated(golden: MatchPackage, minute: int) -> None:
    period = "H1" if minute <= 45 else "H2"
    seq = seq_at_minute(golden, period, minute if period == "H1" else minute - 45)
    tps = tps_at(golden, seq)
    assert tps and len({t["id"] for t in tps}) == len(tps)
    assert [t["priority"] for t in tps] == sorted((t["priority"] for t in tps), reverse=True)
    for t in tps:
        assert len(t["text"]) <= MAX_TEXT and t["kind"] in KINDS and t["source"] in SOURCES and t["why"]
        assert t["fictional"] is True
    for a, b in itertools.combinations(tps, 2):
        assert not _similar(a["text"], b["text"]), (a["text"], b["text"])
    assert tps == tps_at(golden, seq)  # deterministic


def test_talking_points_favour_recent_events(golden: MatchPackage) -> None:
    seq = seq_at_minute(golden, "H1", 30)
    tps = tps_at(golden, seq, limit=8)
    # the 28' goal is the freshest event-made context: it leads, and says why
    assert tps[0]["id"] == "tp-ctx-goal-NBA-09-E0761" and "Vantreight" in tps[0]["text"]
    assert tps[0]["why"].startswith("N. Vantreight")
    assert any(t["id"] == "tp-ctx-milestone-NBA-09-apps-100" for t in tps)
    # background (manager / h2h / stadium) ranks below what this match made relevant
    assert all(t["why"] != "Pre-match background" for t in tps[:5])
    # pre-kick-off: no line-up yet, so no starter milestone and nothing from the match
    pre = tps_at(golden, 0)
    assert all(t["why"] == "Pre-match background" for t in pre)
    assert not any("100th" in t["text"] for t in pre)


def test_talking_points_limit_and_unknown_ids() -> None:
    with TestClient(app) as c:
        r = c.get("/api/matches/BYLINE-01/talking-points?upto_seq=823&limit=3").json()
        assert len(r["talking_points"]) == 3 and r["fictional"] is True
        assert c.get("/api/matches/BYLINE-01/talking-points?limit=0").status_code == 422
        assert c.get("/api/matches/NOPE/talking-points").status_code == 404
        assert c.get("/api/matches/NOPE/dossier/match").status_code == 404
        assert c.get("/api/matches/NOPE/dossier/h2h").status_code == 404
        assert c.get("/api/matches/BYLINE-01/dossier/players/NBA-99").status_code == 404
        assert c.get("/api/matches/BYLINE-01/dossier/teams/XYZ").status_code == 404
        assert c.get("/api/matches/BYLINE-01/dossier/players/NBA-09?upto_seq=-1").json()["this_match"][
            "role"] is None


def test_endpoints_are_fast_after_the_first_call() -> None:
    urls = ["/api/matches/BYLINE-01/dossier/players/NBA-09?upto_seq=900",
            "/api/matches/BYLINE-01/dossier/teams/NBA?upto_seq=900", "/api/matches/BYLINE-01/dossier/h2h?upto_seq=900",
            "/api/matches/BYLINE-01/dossier/match", "/api/matches/BYLINE-01/talking-points?upto_seq=900"]
    with TestClient(app) as c:
        for u in urls:
            assert c.get(u).status_code == 200
        for u in urls:
            t = time.perf_counter()
            assert c.get(u).status_code == 200
            assert (time.perf_counter() - t) < 0.15, u


def test_every_match_builds(golden: MatchPackage, ordinary: MatchPackage) -> None:
    for pkg in (golden, ordinary):
        w = pkg.world
        for t in w.teams:
            assert team_dossier(w, pkg.events, t.team_id)["squad"]["lineup_confirmed"]
            for p in t.players:
                player_dossier(w, pkg.events, p.player_id)
        assert tps_at(pkg, pkg.events[-1].seq)
