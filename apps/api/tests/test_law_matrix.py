"""T010/T011: football-law matrix (QA_AND_EVALUATION.md section 3).

Each case feeds OFFICIAL synthetic decisions through the strict reducer and the decision
explainer. The official event is authoritative; BYLINE only explains it.
"""

from __future__ import annotations

from typing import Any

import pytest

from byline.football.decisions import DecisionCard
from byline.football.intelligence import MatchIntelligence, run_detectors
from byline.match_state.reducer import DomainError
from byline.storage.fixtures import MatchPackage
from byline.world.models import World
from tests.conftest import EventFactory, kickoff_stream, pt


class Match:
    def __init__(self, world: World) -> None:
        self.f = EventFactory()
        self.mi = MatchIntelligence(world, detectors=[])
        for ev in kickoff_stream(self.f, world):
            self.mi.ingest(ev)

    def __call__(self, etype: str, team: str | None = None, player: str | None = None, official: bool = False,
                 **payload: Any) -> str:
        ev = self.f(etype, team, player, official=official, **payload)
        self.mi.ingest(ev)
        return ev.event_id

    def foul(self, offender: str, victim: str, at: tuple[float, float], *, severity: str | None = "careless",
             foul_type: str = "trip", restart: str = "direct_free_kick", in_area: bool = False, **extra: Any) -> str:
        return self("foul.committed", offender[:3], offender, official=True, location=pt(*at), victim_player_id=victim,
                    foul_type=foul_type, severity=severity, restart_type=restart, in_offender_penalty_area=in_area,
                    **extra)

    def award(self, rtype: str, team: str, at: tuple[float, float], reason: str | None, law: str = "Law 13") -> str:
        return self("restart.awarded", official=True, restart_type=rtype, awarded_to_team_id=team, location=pt(*at),
                    reason_event_id=reason, law_ref=law)

    def card(self, colour: str, player: str, reason: str, foul_id: str | None) -> str:
        return self(f"card.{colour}", player[:3], player, official=True, reason=reason, foul_event_id=foul_id)

    @property
    def cards(self) -> list[DecisionCard]:
        return self.mi.explainer.cards

    @property
    def last(self) -> DecisionCard:
        return self.mi.explainer.cards[-1]


@pytest.fixture()
def m(world: World) -> Match:
    return Match(world)


def laws(card: DecisionCard) -> list[str]:
    return [c.law for c in card.which_rule]


def test_law01_careless_foul_is_dfk_without_card(m: Match) -> None:
    fid = m.foul("RVC-10", "NBA-10", (55, 36))
    m.award("direct_free_kick", "NBA", (55, 36), fid)
    c = m.last
    assert c.kind == "DIRECT FREE KICK" and "No card" in c.decision
    assert any("Careless" in r.point for r in c.which_rule)
    assert m.mi.state.cards == []


def test_law02_reckless_is_caution(m: Match) -> None:
    fid = m.foul("RVC-06", "NBA-07", (62, 57), severity="reckless", foul_type="tackle")
    m.card("yellow", "RVC-06", "reckless_foul", fid)
    m.award("direct_free_kick", "NBA", (62, 57), fid)
    assert m.last.kind == "YELLOW CARD" and any("Reckless" in r.point for r in m.last.which_rule)


def test_law03_excessive_force_straight_red_leaves_ten(m: Match) -> None:
    fid = m.foul("RVC-04", "NBA-09", (60, 30), severity="excessive_force", foul_type="tackle")
    m.card("red", "RVC-04", "serious_foul_play", fid)
    m.award("direct_free_kick", "NBA", (60, 30), fid)
    c = m.last
    assert c.kind == "RED CARD" and "continue with 10 players" in c.what_changes
    assert any("far exceeds" in r.point for r in c.which_rule)
    assert "RVC-04" not in m.mi.state.sheets["RVC"].on_pitch.values()


def test_law04_second_yellow_dismisses_and_blocks_actions(m: Match) -> None:
    f1 = m.foul("RVC-06", "NBA-07", (62, 57), severity="reckless")
    m.card("yellow", "RVC-06", "reckless_foul", f1)
    m.award("direct_free_kick", "NBA", (62, 57), f1)
    f2 = m.foul("RVC-06", "NBA-10", (58, 33), severity="reckless", foul_type="kick")
    m.card("second_yellow", "RVC-06", "second_caution", f2)
    m.award("direct_free_kick", "NBA", (58, 33), f2)
    assert m.last.kind == "SECOND YELLOW" and "10 players" in m.last.what_changes
    colours = [c.colour for c in m.mi.state.cards]
    assert colours == ["yellow", "second_yellow"]  # both cautions preserved
    with pytest.raises(DomainError, match="dismissed_player"):
        m("carry", "RVC", "RVC-06", start=pt(50, 30), end=pt(45, 30))


def test_law05_dogso_holding_in_area_is_penalty_and_red(m: Match) -> None:
    fid = m.foul("NBA-05", "RVC-09", (12, 34), foul_type="hold", restart="penalty", in_area=True,
                 denied_goal_scoring_opportunity=True, attempted_to_play_ball=False)
    m.card("red", "NBA-05", "dogso", fid)
    m.award("penalty", "RVC", (11, 34), fid, law="Law 14")
    c = m.last
    assert c.kind == "PENALTY" and "Red card" in c.decision
    assert any("DOGSO" in r.point for r in c.which_rule)
    assert any("holding" in cv for cv in c.caveats)


def test_law06_dogso_attempt_to_play_ball_reduced_to_yellow(m: Match) -> None:
    fid = m.foul("NBA-05", "RVC-09", (12, 34), foul_type="tackle", restart="penalty", in_area=True,
                 denied_goal_scoring_opportunity=True, attempted_to_play_ball=True)
    m.card("yellow", "NBA-05", "dogso_attempt_to_play_ball", fid)
    m.award("penalty", "RVC", (11, 34), fid, law="Law 14")
    c = m.last
    assert c.kind == "PENALTY" and "Yellow card" in c.decision
    assert "attempting to play the ball" in c.decision
    assert "NBA-05" in m.mi.state.sheets["NBA"].on_pitch.values()


def test_law07_advantage_no_second_restart_and_delayed_caution(m: Match) -> None:
    fid = m.foul("RVC-08", "NBA-08", (48, 30), severity="reckless", foul_type="tackle", advantage_played=True)
    m("advantage.applied", "NBA", None, official=True, foul_event_id=fid)
    assert m.last.kind == "ADVANTAGE" and m.mi.state.play_state == "ADVANTAGE_ACTIVE"
    m("pass.completed", "NBA", "NBA-08", start=pt(48, 30), end=pt(60, 36), receiver_player_id="NBA-10")
    out = m("pass.failed", "NBA", "NBA-10", start=pt(60, 36), end=pt(70, 68), outcome="out_of_play")
    m.award("throw_in", "RVC", (70, 68), out, law="Law 15")
    m.card("yellow", "RVC-08", "reckless_foul", fid)
    c = m.last
    assert c.kind == "YELLOW CARD" and "advantage" in c.reason
    assert not any(d.kind == "DIRECT FREE KICK" for d in m.cards)  # no invented restart for the foul


def test_law08_offside_position_not_involved_is_not_an_offence(m: Match) -> None:
    pid = m("pass.completed", "NBA", "NBA-04", start=pt(50, 40), end=pt(72, 60), receiver_player_id="NBA-07")
    m("offside.position_detected", "NBA", "NBA-09", location=pt(88, 30), pass_event_id=pid, involved=False,
      second_last_defender_x_m=86.5)
    c = m.last
    assert c.kind == "OFFSIDE POSITION · NO OFFENCE" and c.what_changes.startswith("No restart")
    assert any("not an offence" in r.point for r in c.which_rule)
    assert m.mi.state.stats["NBA"].offsides == 0


@pytest.mark.parametrize("kind", ["throw_in", "goal_kick", "corner"])
def test_law10_12_no_offside_directly_from_throw_in_goal_kick_corner(m: Match, kind: str) -> None:
    pid = m("pass.completed", "NBA", "NBA-02", start=pt(80, 68), end=pt(90, 40), receiver_player_id="NBA-09",
            pass_kind=kind)
    m("offside.position_detected", "NBA", "NBA-09", location=pt(90, 40), pass_event_id=pid, involved=False,
      second_last_defender_x_m=88.0)
    c = m.last
    assert kind.replace("_", "-") in c.reason
    assert any("goal kick, throw-in or corner" in r.point for r in c.which_rule)


def test_law13_offside_offence_is_indirect_free_kick_with_caveat(m: Match) -> None:
    pid = m("pass.completed", "NBA", "NBA-10", start=pt(62, 36), end=pt(90, 38), receiver_player_id="NBA-09")
    oid = m("offside.offence_confirmed", "NBA", "NBA-09", official=True, interference_type="interfering_with_play",
            decision_event_id=pid, location=pt(88, 38))
    m.award("indirect_free_kick", "RVC", (88, 38), oid, law="Law 11 / Law 13")
    c = m.last
    assert c.kind == "OFFSIDE" and c.decision == "Indirect free kick"
    assert "Riverton" in c.what_changes and any("player-centre" in cv for cv in c.caveats)
    assert m.mi.state.stats["NBA"].offsides == 1


def test_law15_golden_var_offside_reversal(golden: MatchPackage) -> None:
    mi = run_detectors(golden.world, golden.events, tracking=golden.tracking)
    var = [c for c in mi.explainer.cards if c.kind == "VAR CHECK"]
    dis = [c for c in mi.explainer.cards if c.kind == "GOAL DISALLOWED"]
    assert len(var) == 1 and var[0].provisional is True  # LAW-26: a check is not a ruling
    assert len(dis) == 1 and "Score stays 1–1" in dis[0].what_changes
    assert "Law 11" in laws(dis[0]) and "VAR protocol" in laws(dis[0])
    assert not any(c.kind == "OFFSIDE" and c.clock.startswith("72") for c in mi.explainer.cards)


def test_law17_untouched_indirect_free_kick_into_goal_is_goal_kick(m: Match) -> None:
    fid = m.foul("RVC-05", "NBA-09", (85, 34), severity=None, foul_type="dangerous_play",
                 restart="indirect_free_kick")
    m.award("indirect_free_kick", "NBA", (85, 34), fid)
    m("restart.taken", "NBA", "NBA-10", restart_type="indirect_free_kick", location=pt(85, 34))
    sid = m("shot", "NBA", "NBA-10", location=pt(85, 34), end=pt(105, 34), outcome="entered_goal",
            situation="free_kick")
    m.award("goal_kick", "RVC", (99.5, 30), sid, law="Law 13 / Law 16")
    c = m.last
    assert c.kind == "GOAL KICK" and "score unchanged" in c.what_changes
    assert m.mi.state.score == {"NBA": 0, "RVC": 0}


def test_law18_penalty_for_dfk_offence_in_own_area(m: Match) -> None:
    fid = m.foul("RVC-05", "NBA-09", (93.5, 38), restart="penalty", in_area=True, attempted_to_play_ball=True)
    m.award("penalty", "NBA", (94, 34), fid, law="Law 14")
    assert m.last.kind == "PENALTY" and "Law 14" in laws(m.last)


def test_law22_accidental_double_touch_scored_is_retake(m: Match) -> None:
    fid = m.foul("RVC-05", "NBA-09", (93.5, 38), restart="penalty", in_area=True)
    m.award("penalty", "NBA", (94, 34), fid, law="Law 14")
    pk = m("penalty.taken", "NBA", "NBA-10", goalkeeper_id="RVC-01", placement="bottom_left", location=pt(94, 34))
    sid = m("shot", "NBA", "NBA-10", location=pt(94, 34), end=pt(105, 31), outcome="goal", situation="penalty")
    gid = m("goal.provisional", "NBA", "NBA-10", official=True, shot_event_id=sid, location=pt(94, 34),
            conceding_team_id="RVC")
    m("penalty.outcome", "NBA", "NBA-10", official=True, penalty_event_id=pk, outcome="retake",
      touch="accidental_double_touch")
    m("goal.disallowed", "NBA", "NBA-10", official=True, goal_event_id=gid, reason="foul", law_ref="Law 14",
      decision_route="on_field")
    c = m.last
    assert c.kind == "PENALTY RETAKE" and any("accidentally touches" in r.point for r in c.which_rule)
    assert m.mi.state.score == {"NBA": 0, "RVC": 0}


def test_law23_accidental_double_touch_not_scored_is_ifk(m: Match) -> None:
    fid = m.foul("RVC-05", "NBA-09", (93.5, 38), restart="penalty", in_area=True)
    m.award("penalty", "NBA", (94, 34), fid, law="Law 14")
    pk = m("penalty.taken", "NBA", "NBA-10", goalkeeper_id="RVC-01", placement="bottom_left", location=pt(94, 34))
    m("shot", "NBA", "NBA-10", location=pt(94, 34), end=pt(105, 25), outcome="off_target", situation="penalty")
    po = m("penalty.outcome", "NBA", "NBA-10", official=True, penalty_event_id=pk, outcome="missed",
           touch="accidental_double_touch")
    m.award("indirect_free_kick", "RVC", (94, 34), po, law="Law 14")
    assert m.last.kind == "INDIRECT FREE KICK" and "did not go in" in m.last.reason


def test_every_card_carries_ruleset_sources_and_disclaimer(golden: MatchPackage) -> None:
    cards = run_detectors(golden.world, golden.events).explainer.cards
    assert len(cards) >= 10
    ids = {e.event_id for e in golden.events}
    for c in cards:
        assert c.ruleset_version == "IFAB-2026/27" and c.which_rule
        assert c.disclaimer.startswith("BYLINE explains official decisions")
        assert all(r.url.startswith("https://theifab.com/") for r in c.which_rule)
        assert set(c.source_event_ids) <= ids
