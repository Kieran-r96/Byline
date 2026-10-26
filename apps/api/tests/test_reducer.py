"""T004: event-sourced state, idempotency, gaps, seeking and invariants (EVT-01..12)."""

from __future__ import annotations

import pytest

from byline.events.journal import EventJournal, JournalConflict
from byline.events.models import MatchEvent
from byline.match_state.reducer import DomainError, MatchState, SequenceGap, replay
from byline.storage.fixtures import MatchPackage
from byline.world.models import World
from tests.conftest import EventFactory, kickoff_stream, pt


def started(world: World, factory: EventFactory) -> MatchState:
    st = MatchState(world)
    for ev in kickoff_stream(factory, world):
        st.apply(ev)
    return st


def test_duplicate_event_is_exactly_once(golden: MatchPackage) -> None:
    """EVT-01."""
    st = MatchState(golden.world)
    goal_seq = next(e.seq for e in golden.events if e.type == "goal.confirmed")
    for ev in golden.events[: goal_seq + 1]:
        st.apply(ev)
    assert st.score["NBA"] == 1
    assert st.apply(golden.events[goal_seq]) == "duplicate"
    assert st.score["NBA"] == 1


def test_reused_id_or_seq_conflicts(golden: MatchPackage) -> None:
    st = MatchState(golden.world)
    for ev in golden.events[:10]:
        st.apply(ev)
    forged = golden.events[5].model_copy(update={"event_id": "FORGED"})
    with pytest.raises(DomainError, match="seq_conflict"):
        st.apply(forged)


def test_gap_raises_and_journal_buffers_out_of_order(golden: MatchPackage) -> None:
    """EVT-02: later event before earlier one is buffered and released in order."""
    st = MatchState(golden.world)
    with pytest.raises(SequenceGap):
        st.apply(golden.events[1])
    j = EventJournal(golden.match_id)
    assert j.ingest(golden.events[2])[0] == "buffered"
    assert j.ingest(golden.events[1])[0] == "buffered"
    assert j.missing_seqs == [0]
    result, released = j.ingest(golden.events[0])
    assert result == "appended" and [e.seq for e in released] == [0, 1, 2]
    assert j.ingest(golden.events[1])[0] == "duplicate"
    with pytest.raises(JournalConflict):
        j.ingest(golden.events[1].model_copy(update={"elapsed_ms": 999_999}))


def test_seek_backwards_rebuilds_without_duplicates(golden: MatchPackage) -> None:
    """EVT-07: seek after goal and cards then rebuild."""
    full = replay(golden.world, list(golden.events))
    second_yellow = next(e.seq for e in golden.events if e.type == "card.second_yellow")
    mid = replay(golden.world, list(golden.events), upto_seq=second_yellow - 1).snapshot()
    assert mid["score"] == {"NBA": 1, "RVC": 1}
    assert [c["colour"] for c in mid["cards"]] == ["yellow"]
    assert mid["teams"]["RVC"]["sent_off"] == []
    again = replay(golden.world, list(golden.events)).snapshot()
    assert again == full.snapshot()


def test_var_reversal_is_append_only(golden: MatchPackage) -> None:
    """EVT-11 / LAW-15: provisional goal shown, VAR disallows, score reverts, audit kept."""
    prov = next(e for e in golden.events if e.type == "goal.provisional" and e.elapsed_ms > 70 * 60_000)
    dis = next(e for e in golden.events if e.type == "goal.disallowed")
    during = replay(golden.world, list(golden.events), upto_seq=prov.seq + 1).snapshot()
    assert during["score"] == {"NBA": 1, "RVC": 1}
    assert during["provisional_score"] == {"NBA": 2, "RVC": 1}
    assert during["var_review"] is not None and during["play_state"] == "VAR_REVIEW"
    after = replay(golden.world, list(golden.events), upto_seq=dis.seq).snapshot()
    assert after["score"] == {"NBA": 1, "RVC": 1} == after["provisional_score"]
    goal = next(g for g in after["goals"] if g["goal_event_id"] == prov.event_id)
    assert goal["status"] == "disallowed" and goal["decided_by_event_id"] == dis.event_id


def test_kickoff_after_goal_by_conceding_team(golden: MatchPackage) -> None:
    """EVT-09."""
    confirmed = [e for e in golden.events if e.type == "goal.confirmed"]
    for g in confirmed:
        k = next(e for e in golden.events if e.seq > g.seq and e.type == "kickoff")
        assert k.team_id != g.team_id


def test_substituted_player_cannot_act(world: World, factory: EventFactory) -> None:
    """EVT-05."""
    st = started(world, factory)
    st.apply(factory("substitution", "NBA", "NBA-17", official=True, player_off_id="NBA-07", player_on_id="NBA-17"))
    bad = factory("pass.completed", "NBA", "NBA-07", start=pt(50, 30), end=pt(60, 30), receiver_player_id="NBA-10")
    with pytest.raises(DomainError, match="substituted_player"):
        st.apply(bad)
    assert st.last_seq == bad.seq - 1  # state untouched


def test_dismissed_player_cannot_act_and_formation_shrinks(world: World, factory: EventFactory) -> None:
    """EVT-06 / LAW-04."""
    st = started(world, factory)
    st.apply(factory("card.yellow", "RVC", "RVC-06", official=True, reason="reckless_foul"))
    st.apply(factory("card.second_yellow", "RVC", "RVC-06", official=True, reason="second_caution"))
    assert "RVC-06" in st.sheets["RVC"].sent_off
    assert len(st.sheets["RVC"].on_pitch) == 10
    with pytest.raises(DomainError, match="dismissed_player"):
        st.apply(factory("pass.completed", "RVC", "RVC-06", start=pt(50, 30), end=pt(40, 30),
                         receiver_player_id="RVC-08"))


def test_second_caution_must_be_second_yellow(world: World, factory: EventFactory) -> None:
    st = started(world, factory)
    st.apply(factory("card.yellow", "RVC", "RVC-06", official=True, reason="reckless_foul"))
    with pytest.raises(DomainError, match="second_caution_as_yellow"):
        st.apply(factory("card.yellow", "RVC", "RVC-06", official=True, reason="reckless_foul"))


def test_second_yellow_without_first_rejected(world: World, factory: EventFactory) -> None:
    st = started(world, factory)
    with pytest.raises(DomainError, match="second_yellow_without_first"):
        st.apply(factory("card.second_yellow", "NBA", "NBA-04", official=True, reason="second_caution"))


def test_dismissed_player_cannot_score(world: World, factory: EventFactory) -> None:
    st = started(world, factory)
    st.apply(factory("card.red", "NBA", "NBA-09", official=True, reason="serious_foul_play"))
    with pytest.raises(DomainError):
        st.apply(factory("goal.provisional", "NBA", "NBA-09", official=True, shot_event_id="X1",
                         location=pt(95, 34), conceding_team_id="RVC"))


def test_goal_cannot_be_confirmed_while_var_open(world: World, factory: EventFactory) -> None:
    st = started(world, factory)
    shot = factory("shot", "NBA", "NBA-09", location=pt(95, 34), end=pt(105, 33), outcome="goal")
    st.apply(shot)
    goal = factory("goal.provisional", "NBA", "NBA-09", official=True, shot_event_id=shot.event_id,
                   location=pt(95, 34), conceding_team_id="RVC")
    st.apply(goal)
    st.apply(factory("var.review_started", official=True, check_type="goal", subject_event_id=goal.event_id,
                     reason="possible foul"))
    with pytest.raises(DomainError, match="var_pending"):
        st.apply(factory("goal.confirmed", "NBA", "NBA-09", official=True, goal_event_id=goal.event_id,
                         decision_route="on_field"))


def test_unknown_player_and_wrong_team_rejected(world: World, factory: EventFactory) -> None:
    """EVT-12."""
    st = started(world, factory)
    with pytest.raises(DomainError, match="unknown_player"):
        st.apply(factory("pass.completed", "NBA", "NBA-10", start=pt(50, 30), end=pt(60, 30),
                         receiver_player_id="NBA-77"))
    f2 = EventFactory()
    st2 = MatchState(world)
    for ev in kickoff_stream(f2, world):
        st2.apply(ev)
    with pytest.raises(DomainError, match="player_team_mismatch"):
        st2.apply(f2("carry", "RVC", "NBA-10", start=pt(50, 30), end=pt(55, 30)))


def test_penalty_requires_offence_inside_area(world: World, factory: EventFactory) -> None:
    """LAW-19: ordinary foul outside the area is never a penalty."""
    st = started(world, factory)
    with pytest.raises(DomainError, match="penalty_outside_area"):
        st.apply(factory("foul.committed", "RVC", "RVC-05", official=True, location=pt(80, 30),
                         victim_player_id="NBA-09", foul_type="trip", severity="careless", restart_type="penalty",
                         in_offender_penalty_area=False))


def test_substitution_limits(world: World, factory: EventFactory) -> None:
    st = started(world, factory)
    pairs = [("NBA-07", "NBA-17"), ("NBA-09", "NBA-19"), ("NBA-11", "NBA-20"), ("NBA-10", "NBA-22"),
             ("NBA-08", "NBA-14")]
    for off, on in pairs:
        st.apply(factory("substitution", "NBA", on, official=True, player_off_id=off, player_on_id=on))
    with pytest.raises(DomainError, match="too_many_subs"):
        st.apply(factory("substitution", "NBA", "NBA-16", official=True, player_off_id="NBA-04",
                         player_on_id="NBA-16"))
    # a substituted player can never return
    f = EventFactory()
    st2 = MatchState(world)
    for ev in kickoff_stream(f, world):
        st2.apply(ev)
    st2.apply(f("substitution", "NBA", "NBA-17", official=True, player_off_id="NBA-07", player_on_id="NBA-17"))
    with pytest.raises(DomainError, match="sub_on_not_on_bench"):
        st2.apply(f("substitution", "NBA", "NBA-07", official=True, player_off_id="NBA-17", player_on_id="NBA-07"))


def test_match_finished_requires_matching_score(world: World, factory: EventFactory) -> None:
    st = started(world, factory)
    st.apply(factory("period.ended", added_minutes=0))
    st.apply(factory("period.started", period="H2", attacking_direction={"NBA": "-x", "RVC": "+x"}))
    st.apply(factory("period.ended", period="H2", added_minutes=0))
    with pytest.raises(DomainError, match="final_score_mismatch"):
        st.apply(factory("match.finished", period="FT", official=True, final_score={"NBA": 1, "RVC": 0}))
    factory.seq -= 1  # the rejected event never entered the log
    st.apply(factory("match.finished", period="FT", official=True, final_score={"NBA": 0, "RVC": 0}))
    assert st.finished


def test_snapshot_is_deterministic(golden: MatchPackage) -> None:
    a = replay(golden.world, list(golden.events), upto_seq=1500).snapshot()
    b = replay(golden.world, list(golden.events), upto_seq=1500).snapshot()
    assert a == b and a["seq"] == 1500


def test_event_after_full_time_rejected(golden: MatchPackage) -> None:
    st = replay(golden.world, list(golden.events))
    late = MatchEvent(event_id="LATE", match_id=golden.match_id, seq=st.last_seq + 1, elapsed_ms=st.elapsed_ms + 1,
                      period="FT", type="injury.stoppage", payload={"location": pt(1, 1)})
    with pytest.raises(DomainError, match="after_full_time"):
        st.apply(late)
