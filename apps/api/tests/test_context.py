"""Live context facts: history-derived records made relevant by match events (deterministic, no future)."""

from __future__ import annotations

import copy
from collections.abc import Sequence

import pytest
from fastapi.testclient import TestClient

from byline.api.app import app
from byline.events.models import MatchEvent
from byline.storage.fixtures import MatchPackage
from byline.world.context import MAX_TEXT, ContextFact, context_facts
from byline.world.history import SyntheticHistoryProvider, synthetic_history
from byline.world.knowledge import Career
from byline.world.models import World
from byline.world.records import current_streak, select
from tests.conftest import EventFactory, kickoff_stream, pt


def by_id(facts: Sequence[ContextFact]) -> dict[str, ContextFact]:
    return {f.fact_id: f for f in facts}


def upto(pkg: MatchPackage, seq: int) -> list[MatchEvent]:
    return [e for e in pkg.events if e.seq <= seq]


@pytest.fixture(scope="module")
def final(golden: MatchPackage) -> list[ContextFact]:
    return context_facts(golden.world, golden.events)


def test_golden_full_time_headline_facts(golden: MatchPackage, final: list[ContextFact]) -> None:
    f = by_id(final)
    fin = next(e for e in golden.events if e.type == "match.finished")
    lineup = next(e for e in golden.events if e.type == "lineup.confirmed" and e.team_id == "NBA")
    # the 100th appearance (pre-match, valid from the confirmed line-up)
    m = f["ctx-milestone-NBA-09-apps-100"]
    assert (m.priority, m.trigger_event_id, m.as_of_seq) == ("alert", None, lineup.seq)
    assert "100th league appearance" in m.short_text  # the record holds league appearances only
    # striking streak extended at full time, consistent with the history
    home = select(synthetic_history(golden.world).fixtures("NBA"), "league", "home")
    run = current_streak(home, "unbeaten").length
    s = f["ctx-ft-streak-NBA-unbeaten-league-home"]
    assert (s.priority, s.trigger_event_id, s.as_of_seq) == ("alert", fin.event_id, fin.seq)
    assert f"unbeaten in {run + 1} home league games" in s.short_text and "longest run in the record" in s.short_text
    # a "first ... since <year>" record at full time
    r = f["ctx-ft-streak-RVC-losing-league"]
    assert r.priority == "alert" and r.category == "record"
    assert "four league games in a row for the first time since March 2020" in r.short_text
    # head-to-head context
    assert f["ctx-h2h-window"].short_text.startswith("Last 22 derbies")
    assert "first derby win since 21 Apr 2025" in f["ctx-ft-h2h-NBA-first-win"].short_text
    # goal milestones come from confirmed goals
    assert "10th derby goal" in f["ctx-milestone-NBA-10-derbygoals-10"].short_text
    assert f["ctx-milestone-RVC-09-derbygoals-5"].trigger_event_id == "E1473"
    # no conditional projection once the result is final
    assert not [x for x in final if x.fact_id.startswith("ctx-ifends")]


def test_all_facts_are_well_formed(golden: MatchPackage, final: list[ContextFact]) -> None:
    ids = {e.event_id: e.seq for e in golden.events}
    assert len({f.fact_id for f in final}) == len(final)
    for f in final:
        assert f.priority in ("alert", "insight", "quiet")
        assert f.subject_kind in ("player", "team", "match")
        assert 0 < len(f.short_text) <= MAX_TEXT, f.short_text
        assert f.provenance == "fictional_seeded" and "fictional" in f.source
        assert f.rule and f.fact_id.startswith("ctx-")
        if f.trigger_event_id is not None:
            assert ids[f.trigger_event_id] == f.as_of_seq
    cats = {f.category for f in final}
    assert {"milestone", "streak", "record", "head_to_head", "manager", "stadium", "fixtures", "form", "goal",
            "discipline"} <= cats
    assert [f.as_of_seq for f in final] == sorted(f.as_of_seq for f in final)


def test_deterministic_and_ids_stable_across_rebuilds(golden: MatchPackage, final: list[ContextFact]) -> None:
    again = context_facts(golden.world, list(golden.events))
    assert again == final
    fresh = context_facts(golden.world, golden.events, provider=SyntheticHistoryProvider(golden.world))
    assert [f.fact_id for f in fresh] == [f.fact_id for f in final] and fresh == final


@pytest.mark.parametrize("seq", [0, 2, 761, 762, 1472, 1473, 2006, 2009, 2345, 2346, 2580])
def test_no_future_leak(golden: MatchPackage, final: list[ContextFact], seq: int) -> None:
    now = context_facts(golden.world, upto(golden, seq))
    past = {e.event_id for e in golden.events if e.seq <= seq}
    end = by_id(final)
    for f in now:
        assert f.as_of_seq <= seq
        assert f.trigger_event_id is None or f.trigger_event_id in past
        assert not f.fact_id.startswith("ctx-ft-")  # nothing about the result before match.finished
        if f.fact_id.startswith("ctx-ifends"):
            assert f.short_text.startswith("If it ends ")  # projections are conditional only
        elif f.category != "discipline":  # card text legitimately updates when a later card follows
            assert end[f.fact_id] == f  # everything else said early stays true at full time


def test_projection_tracks_the_confirmed_score_only(golden: MatchPackage) -> None:
    def proj(seq: int) -> list[ContextFact]:
        return [f for f in context_facts(golden.world, upto(golden, seq)) if f.fact_id.startswith("ctx-ifends")]

    assert proj(761) == []  # provisional goal: no score yet
    assert [f.fact_id for f in proj(762)] == ["ctx-ifends-1-0"]
    assert [f.fact_id for f in proj(1473)] == ["ctx-ifends-1-1"]
    # NBA's provisional goal at 71' (E2006) and its VAR disallowal (E2009) leave the projection at 1-1
    assert [f.fact_id for f in proj(2006)] == ["ctx-ifends-1-1"]
    assert [f.fact_id for f in proj(2009)] == ["ctx-ifends-1-1"]
    late = proj(2346)
    assert [f.fact_id for f in late] == ["ctx-ifends-2-1"] and late[0].trigger_event_id == "E2346"


def test_var_disallowed_goal_produces_no_scorer_fact(golden: MatchPackage, final: list[ContextFact]) -> None:
    for seq in (2006, 2008, 2009):
        facts = context_facts(golden.world, upto(golden, seq))
        assert not [f for f in facts if f.trigger_event_id in ("E2006", "E2008", "E2009")]
    nine = [f for f in final if f.subject_id == "NBA-09" and f.category in ("goal", "milestone")
            and f.trigger_event_id is not None]
    assert [f.trigger_event_id for f in nine] == ["E0762"]  # only the confirmed 28' goal counts
    assert "2nd league goal of the season" in nine[0].short_text


class FiftyGoalProvider(SyntheticHistoryProvider):
    """A replacement provider (same protocol): NBA-09 arrives on 49 club goals."""

    def career(self, player_id: str) -> Career:
        car = super().career(player_id)
        if player_id != "NBA-09":
            return car
        car = copy.deepcopy(car)
        club = [s for s in car.seasons if s.club == "Northbridge Athletic"]
        club[-2].goals += 49 - sum(s.goals for s in club)
        return car


def _goal_stream(world: World, decision: str) -> list[MatchEvent]:
    f = EventFactory("T-MATCH")
    evs = kickoff_stream(f, world)
    shot = f("shot", "NBA", "NBA-09", location=pt(95, 34), end=pt(105, 33), outcome="goal")
    goal = f("goal.provisional", "NBA", "NBA-09", official=True, shot_event_id=shot.event_id, location=pt(95, 34),
             conceding_team_id="RVC")
    evs += [shot, goal]
    if decision == "confirmed":
        evs.append(f("goal.confirmed", "NBA", "NBA-09", official=True, goal_event_id=goal.event_id,
                     decision_route="on_field"))
    else:
        evs.append(f("goal.disallowed", "NBA", "NBA-09", official=True, goal_event_id=goal.event_id,
                     reason="offside", law_ref="Law 11", decision_route="after_var_check"))
    return evs


def test_goal_milestone_needs_a_confirmed_goal_and_reads_through_the_provider(world: World) -> None:
    prov = FiftyGoalProvider(world)
    ok = by_id(context_facts(world, _goal_stream(world, "confirmed"), provider=prov))
    assert "ctx-milestone-NBA-09-goals-50" in ok
    assert ok["ctx-milestone-NBA-09-goals-50"].short_text == "Nico Vantreight scores his 50th league goal for Northbridge."
    ruled_out = context_facts(world, _goal_stream(world, "disallowed"), provider=prov)
    assert not [f for f in ruled_out if "goals-50" in f.fact_id or f.category == "goal"]
    assert not [f for f in ruled_out if f.fact_id.startswith("ctx-ifends")]
    # the default provider has him on 38, so the same confirmed goal is not a milestone
    stream = _goal_stream(world, "confirmed")
    plain = by_id(context_facts(world, stream))
    provisional = next(e for e in stream if e.type == "goal.provisional")
    assert "ctx-milestone-NBA-09-goals-50" not in plain
    assert "39th for Northbridge" in plain[f"ctx-goal-NBA-09-{provisional.event_id}"].short_text


def test_pre_match_facts_without_events(golden: MatchPackage) -> None:
    facts = context_facts(golden.world, [])
    assert facts and all(f.trigger_event_id is None and f.as_of_seq == 0 for f in facts)
    assert not [f for f in facts if f.category == "milestone"]  # starters are unknown before the line-up
    assert "ctx-streak-NBA-unbeaten-league-home" in by_id(facts)


def test_other_scenarios_end_streaks(ordinary: MatchPackage) -> None:
    f = by_id(context_facts(ordinary.world, ordinary.events))
    assert "31-game unbeaten home league run is over" in f["ctx-ft-streak-NBA-unbeaten-league-home"].short_text
    assert f["ctx-ft-streak-NBA-unbeaten-league-home"].priority == "alert"
    assert "first derby win at The Ironworks since 21 Oct 2022" in f["ctx-ft-h2h-RVC-first-win-venue"].short_text


def test_context_endpoint() -> None:
    with TestClient(app) as c:
        early = c.get("/api/matches/BYLINE-01/context", params={"upto_seq": 800}).json()
        ids = [f["fact_id"] for f in early]
        assert "ctx-ifends-1-0" in ids and "ctx-milestone-NBA-09-apps-100" in ids
        assert not [i for i in ids if i.startswith("ctx-ft-")]
        assert all(f["as_of_seq"] <= 800 and f["provenance"] == "fictional_seeded" for f in early)
        full = c.get("/api/matches/BYLINE-01/context").json()
        assert "ctx-ft-streak-RVC-losing-league" in [f["fact_id"] for f in full]
        assert c.get("/api/matches/NOPE/context").status_code == 404
