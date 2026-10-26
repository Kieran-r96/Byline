"""R3: the fictional knowledge base is rich AND internally consistent; facts are derived from it."""

from __future__ import annotations

import re

from byline.storage.fixtures import MatchPackage
from byline.world.facts import match_facts, seeded_facts
from byline.world.knowledge import BOOKINGS_FOR_BAN, CURRENT_SEASON, GAMES_PER_SEASON, SEASONS, build


def test_seasons_and_league_tables_add_up(golden: MatchPackage) -> None:
    kb = build(golden.world)
    for team, recs in kb.seasons.items():
        assert [r.season for r in recs] == SEASONS
        for r in recs:
            assert r.won + r.drawn + r.lost == GAMES_PER_SEASON and 1 <= r.position <= 20, (team, r)


def test_player_careers_are_consistent(golden: MatchPackage) -> None:
    kb = build(golden.world)
    w = golden.world
    for pid, car in kb.careers.items():
        assert car.seasons[-1].season == CURRENT_SEASON
        for s in car.seasons:
            assert 0 <= s.goals <= s.apps <= GAMES_PER_SEASON, (pid, s)
            assert s.yellows <= s.apps and s.reds <= 1
        joined = [s for s in car.seasons if s.club == w.team(w.player(pid).team_id).name]
        assert joined and joined[0].season == car.joined_season
        assert car.age - (len(car.seasons) - 1) >= 16  # debut age plausible
        assert car.seasons[-1].yellows < BOOKINGS_FOR_BAN  # nobody arrives already suspended


def test_derby_meetings_are_consistent_with_squads(golden: MatchPackage) -> None:
    kb = build(golden.world)
    names = {f"{p.given_name} {p.family_name}": p for t in golden.world.teams for p in t.players}
    for m in kb.meetings:
        assert sum(1 for t, _n, _mi in m.scorers if t == m.home) == m.home_goals
        assert sum(1 for t, _n, _mi in m.scorers if t == m.away) == m.away_goals
        for team, name, _mi in m.scorers:
            p = names.get(name)
            if p is not None:  # a current player can only have scored for his club after joining it
                assert p.team_id == team
                assert SEASONS.index(kb.careers[p.player_id].joined_season) <= SEASONS.index(m.season)
    last = kb.meetings[-1]
    assert (last.home, last.home_goals, last.away_goals, last.date) == ("RVC", 2, 2, "18 April 2026")


def test_derived_facts_match_the_history(golden: MatchPackage) -> None:
    kb = build(golden.world)
    facts = seeded_facts(golden.world)
    assert len(facts) > 200 and len({f.fact_id for f in facts}) == len(facts)
    assert all(f.provenance == "fictional_seeded" and "fictional" in f.source for f in facts)
    by = {f.subject_id: [] for f in facts}  # type: ignore[var-annotated]
    for f in facts:
        by[f.subject_id].append(f)
    # 100th appearance claim is true by construction
    nine = kb.careers["NBA-09"]
    assert sum(s.apps for s in nine.at("Northbridge Athletic")) == 99
    assert any("100th league appearance" in f.short_text for f in by["NBA-09"])
    # club-record fact equals the season sums
    for pid in ("NBA-09", "NBA-04", "RVC-10"):
        car = kb.careers[pid]
        club = golden.world.team(golden.world.player(pid).team_id)
        fact = next(f for f in by[pid] if f.category == "career" and "appearance" in f.short_text
                    and club.short_name in f.short_text)
        nums = [int(n) for n in re.findall(r"\d+", fact.short_text)[:2]]
        assert nums == [sum(s.goals for s in car.at(club.name)), sum(s.apps for s in car.at(club.name))]
    # derby-goal facts equal the meetings list
    for f in facts:
        if f.category == "derby" and f.subject_kind == "player":
            p = golden.world.player(f.subject_id)
            n = sum(1 for m in kb.meetings for (_t, name, _mi) in m.scorers if name == f"{p.given_name} {p.family_name}")
            assert f.short_text.startswith(f"{n} derby goal")
    # suspension-risk facts exist exactly for players on four bookings
    risk = {f.subject_id for f in facts if f.category == "discipline" and "one more means" in f.short_text}
    assert risk == {pid for pid, c in kb.careers.items() if c.seasons[-1].yellows == BOOKINGS_FOR_BAN - 1}
    assert "RVC-06" in risk
    # connections both ways and at least the two authored cross-river storylines
    kinds = {c.kind for c in kb.connections}
    assert {"crossed_the_river", "academy_rival", "former_teammates"} <= kinds


def test_live_discipline_facts_follow_the_rules(golden: MatchPackage) -> None:
    evs = list(golden.events)
    first = next(e for e in evs if e.type == "card.yellow" and e.player_id == "RVC-06")
    second = next(e for e in evs if e.type == "card.second_yellow" and e.player_id == "RVC-06")
    mid = match_facts(golden.world, "RVC-06", [e for e in evs if e.seq <= first.seq])
    assert any("booking number 5 this season brings a one-match ban" in f.short_text for f in mid)
    end = match_facts(golden.world, "RVC-06", [e for e in evs if e.seq <= second.seq])
    texts = " ".join(f.short_text for f in end)
    assert "no longer counts" in texts and "Sent off (second yellow)" in texts
    assert not any("brings a one-match ban" in f.short_text for f in end)


def test_facts_become_topical_after_match_events(golden: MatchPackage) -> None:
    from byline.world.facts import contextualise, ranked

    evs = list(golden.events)
    card = next(e for e in evs if e.type == "card.yellow" and e.player_id == "RVC-06")
    seeded = [f for f in seeded_facts(golden.world) if f.subject_id == "RVC-06"]
    before = contextualise(seeded, [e for e in evs if e.seq < card.seq], "RVC-06")
    after = contextualise(seeded, [e for e in evs if e.seq <= card.seq], "RVC-06")
    shown = ranked(match_facts(golden.world, "RVC-06", [e for e in evs if e.seq <= card.seq]) + after)
    assert shown[0]["category"] == "discipline" and "booking number 5" in shown[0]["short_text"]
    risk = next(f for f in after if "one more means" in f.short_text)
    assert risk.relevance_reason == "Pre-match; superseded today" and risk.relevance < 0.5
    assert any("one more means" in f.short_text and f.relevance > 0.9 for f in before)
    team = contextualise([f for f in seeded_facts(golden.world) if f.subject_id == "RVC"],
                         [e for e in evs if e.seq <= card.seq], "RVC")
    assert max(team, key=lambda f: f.relevance).category in ("discipline", "referee")
