"""Fictional match-by-match history: consistent with the knowledge base, and pure record/streak rules."""

from __future__ import annotations

import datetime as dt
from collections import Counter

import pytest

from byline.storage.fixtures import MatchPackage
from byline.world.facts import seeded_facts
from byline.world.history import (
    CUP,
    LEAGUE,
    ClubMatch,
    HistoryProvider,
    SyntheticHistoryProvider,
    current_season_form,
    losing_runs_ok,
    synthetic_history,
)
from byline.world.knowledge import (
    CUP_ROUNDS,
    CURRENT_SEASON,
    GAMES_PER_SEASON,
    PLAYED_THIS_SEASON,
    SEASONS,
    build,
    cup_round_reached,
)
from byline.world.records import (
    biggest,
    compare_scoreline,
    current_streak,
    first_since,
    form,
    last_with,
    longest_run,
    milestones_crossed,
    previous_run_at_least,
    record,
    runs,
    select,
)

TEAMS = ("NBA", "RVC")


def iso(meeting_date: str) -> str:
    return dt.datetime.strptime(meeting_date, "%d %B %Y").date().isoformat()


@pytest.fixture(scope="module")
def prov(golden: MatchPackage) -> SyntheticHistoryProvider:
    return synthetic_history(golden.world)


# ---------------------------------------------------------------- consistency with the knowledge base


def test_league_seasons_equal_the_season_records_exactly(prov: SyntheticHistoryProvider) -> None:
    for t in TEAMS:
        for rec in prov.season_table(t):
            lg = [m for m in prov.fixtures(t) if m.season == rec.season and m.is_league]
            r = record(lg)
            assert (r.played, r.won, r.drawn, r.lost, r.goals_for, r.goals_against) == (
                GAMES_PER_SEASON, rec.won, rec.drawn, rec.lost, rec.goals_for, rec.goals_against), (t, rec.season)
            assert sum(m.venue == "home" for m in lg) == GAMES_PER_SEASON // 2
            # a double round robin: every other club twice, once at each ground
            opp = Counter(m.opponent for m in lg)
            assert len(opp) == 19 and set(opp.values()) == {2}


def test_every_club_hosts_nineteen_including_the_reversed_2025_26_derby(prov: SyntheticHistoryProvider) -> None:
    lg = [m for m in prov.fixtures("NBA") if m.season == "2025/26" and m.is_league and m.is_derby]
    assert [(m.date, m.venue) for m in lg] == [("2025-10-21", "away"), ("2026-04-18", "away")]


def test_derby_fixtures_are_exactly_the_existing_meetings(prov: SyntheticHistoryProvider) -> None:
    kb = prov.kb
    expected = sorted((iso(m.date), m.home, m.away, m.home_goals, m.away_goals,
                       "league" if m.competition == "League" else "cup", m.scorers) for m in kb.meetings)
    for t in TEAMS:
        got = sorted((m.date, t if m.venue == "home" else m.opponent_id, m.opponent_id if m.venue == "home" else t,
                      m.goals_for if m.venue == "home" else m.goals_against,
                      m.goals_against if m.venue == "home" else m.goals_for, m.competition.kind, m.scorers)
                     for m in prov.fixtures(t) if m.is_derby)
        assert got == expected
    assert len(expected) == 22
    keys = {t: {m.match_key for m in prov.fixtures(t) if m.is_derby} for t in TEAMS}
    assert keys["NBA"] == keys["RVC"]
    last = [m for m in prov.head_to_head("NBA", "RVC")][-1]
    assert (last.date, last.venue, last.score) == ("2026-04-18", "away", "2-2")


def test_dates_are_monotonic_and_before_today(prov: SyntheticHistoryProvider) -> None:
    today = prov.today()
    assert today == "2026-10-24"
    for t in TEAMS:
        dates = [dt.date.fromisoformat(m.date) for m in prov.fixtures(t)]
        assert all((b - a).days >= 2 for a, b in zip(dates, dates[1:], strict=False)), t
        assert max(dates) < dt.date.fromisoformat(today)
        assert len({m.match_key for m in prov.fixtures(t)}) == len(prov.fixtures(t))


def test_current_season_is_the_published_form_line(golden: MatchPackage, prov: SyntheticHistoryProvider) -> None:
    facts = seeded_facts(golden.world)
    for t in TEAMS:
        cur = [m for m in prov.fixtures(t) if m.season == CURRENT_SEASON]
        assert len(cur) == PLAYED_THIS_SEASON and all(m.is_league for m in cur)
        assert [m.result for m in cur] == current_season_form(t)
        form_fact = next(f for f in facts if f.subject_id == t and f.category == "form")
        assert "".join(m.result for m in cur[-5:]) in form_fact.short_text
        # the club scored at least as many league goals as its current squad is credited with this season
        squad = sum(prov.career(p.player_id).seasons[-1].goals for p in golden.world.team(t).players)
        assert sum(m.goals_for for m in cur) >= squad


def test_squad_goals_never_exceed_the_clubs_season_goals(golden: MatchPackage,
                                                         prov: SyntheticHistoryProvider) -> None:
    for t in TEAMS:
        club = golden.world.team(t).name
        for rec in prov.season_table(t):
            squad = sum(s.goals for p in golden.world.team(t).players for s in prov.career(p.player_id).seasons
                        if s.season == rec.season and s.club == club)
            assert squad <= rec.goals_for, (t, rec.season)


def test_cup_runs_match_the_recorded_cup_field(prov: SyntheticHistoryProvider) -> None:
    for t in TEAMS:
        for rec in prov.season_table(t):
            cup = [m for m in prov.fixtures(t) if m.season == rec.season and m.competition == CUP]
            reached = cup_round_reached(rec.cup)
            assert [m.stage for m in cup] == list(CUP_ROUNDS[:reached + 1])
            assert all(m.result == "W" for m in cup[:-1])
            assert cup[-1].result == ("W" if rec.cup == "Winners" else "L")
            assert all(m.opponent_id is None or m.is_derby for m in cup)


def test_derby_cup_ties_agree_with_both_clubs_cup_runs(prov: SyntheticHistoryProvider) -> None:
    kb = prov.kb
    seasons = {t: {r.season: r for r in kb.seasons[t]} for t in TEAMS}
    for m in kb.meetings:
        if m.competition == "League":
            continue
        winner, loser = (m.home, m.away) if m.home_goals > m.away_goals else (m.away, m.home)
        assert cup_round_reached(seasons[winner][m.season].cup) > cup_round_reached(seasons[loser][m.season].cup)
    # the only reconciled value: Northbridge beat Riverton in the 2022/23 quarter-final, so reached the semis
    assert seasons["NBA"]["2022/23"].cup == "Semi-final" and seasons["RVC"]["2022/23"].cup == "Quarter-final"


def test_upcoming_fixtures_follow_today(prov: SyntheticHistoryProvider) -> None:
    for t in TEAMS:
        nxt = prov.upcoming(t)
        assert len(nxt) == 3
        assert [u.date for u in nxt] == sorted(u.date for u in nxt) and nxt[0].date > prov.today()
        assert all(u.competition == LEAGUE and u.opponent_id is None for u in nxt)
        played = {m.opponent for m in prov.fixtures(t) if m.season == CURRENT_SEASON}
        for u in nxt:  # second-half fixtures cannot come before the first meeting
            assert u.opponent not in played or u.venue != next(
                m.venue for m in prov.fixtures(t) if m.season == CURRENT_SEASON and m.opponent == u.opponent)
    # the two clubs never share an opponent on the same day
    for a, b in zip(prov.upcoming("NBA"), prov.upcoming("RVC"), strict=True):
        assert a.date == b.date and a.opponent != b.opponent


def test_manager_records_sum_and_start_with_the_appointment(prov: SyntheticHistoryProvider) -> None:
    for t in TEAMS:
        ten = prov.manager(t)
        assert ten.appointed_season == prov.kb.managers[t]["appointed"]
        assert ten.start_date == f"{ten.appointed_season[:4]}-07-01"
        spell = [m for m in prov.fixtures(t) if m.date >= ten.start_date]
        r = record(spell)
        assert r.played == r.won + r.drawn + r.lost == len(spell)
        assert spell[0].season == ten.appointed_season
        # whole seasons in charge reproduce the league table rows
        league = record([m for m in spell if m.is_league and m.season != CURRENT_SEASON])
        rows = [s for s in prov.season_table(t) if s.season >= ten.appointed_season]
        assert (league.won, league.drawn, league.lost) == (sum(s.won for s in rows), sum(s.drawn for s in rows),
                                                          sum(s.lost for s in rows))


def test_authored_records_hold(prov: SyntheticHistoryProvider) -> None:
    home = select(prov.fixtures("NBA"), "league", "home")
    assert not [m for m in home if m.date >= "2025-02-01" and m.result == "L"]
    last_loss = last_with(home, "L")
    assert last_loss is not None and last_loss.date < "2025-02-01" and last_loss.season == "2024/25"
    assert current_streak(home, "unbeaten").length == 31 == longest_run(home, "unbeaten")
    rvc = select(prov.fixtures("RVC"), "league")
    long_runs = [(s, e) for s, e in runs(rvc, "losing") if e - s + 1 >= 4]
    assert len(long_runs) == 1
    s, e = long_runs[0]
    assert e - s + 1 == 4 and rvc[e].date.startswith("2020-03")
    assert current_streak(rvc, "losing").length == 3
    assert losing_runs_ok([m.result for m in rvc], 1)


def test_history_is_deterministic(golden: MatchPackage) -> None:
    a = SyntheticHistoryProvider(golden.world)
    b = SyntheticHistoryProvider(golden.world)
    assert a.history == b.history
    assert build(golden.world).seasons["NBA"][0].season == SEASONS[0]


def test_provider_satisfies_the_protocol(prov: SyntheticHistoryProvider) -> None:
    p: HistoryProvider = prov
    for name in ("today", "fixtures", "upcoming", "season_table", "career", "head_to_head", "manager", "stadium",
                 "all_time_head_to_head"):
        assert callable(getattr(p, name))
    assert p.provider == "byline-synthetic-history"
    assert p.head_to_head("RVC", "NBA")[0].team_id == "RVC"


# ---------------------------------------------------------------- pure record rules on hand-made sequences


def mk(spec: str, start: str = "2020-01-04", venue: str = "home", comp: str = "league") -> list[ClubMatch]:
    """'2-0 1-1 0-1 ...' -> ClubMatch list a week apart."""
    d0 = dt.date.fromisoformat(start)
    out = []
    for i, sc in enumerate(spec.split()):
        gf, ga = (int(x) for x in sc.split("-"))
        out.append(ClubMatch(f"k{i}", "T", (d0 + dt.timedelta(weeks=i)).isoformat(), "2019/20",
                             LEAGUE if comp == "league" else CUP, f"Matchday {i + 1}",
                             "home" if venue == "home" or (venue == "alt" and i % 2 == 0) else "away",
                             "Ground", "Opp", None, gf, ga))
    return out


def test_streaks_on_hand_made_sequences() -> None:
    ms = mk("1-0 0-1 2-2 3-1 1-0 0-0")
    assert current_streak(ms, "unbeaten").length == 4 and current_streak(ms, "unbeaten").since == ms[2].date
    assert current_streak(ms, "winning").length == 0
    assert current_streak(ms, "scoring").length == 0 and current_streak(ms, "clean_sheet").length == 2
    assert current_streak(ms, "winless").length == 1 and current_streak(ms, "losing").length == 0
    assert form(ms) == "L D W W D" and form(ms, 2) == "W D"
    assert runs(ms, "unbeaten") == [(0, 0), (2, 5)] and longest_run(ms, "unbeaten") == 4
    assert current_streak([], "winning").length == 0


def test_home_away_and_league_filters() -> None:
    ms = mk("1-0 0-1 2-0 0-2", venue="alt") + mk("3-0", start="2020-03-07", comp="cup")
    assert [m.score for m in select(ms, "league", "home")] == ["1-0", "2-0"]
    assert [m.score for m in select(ms, "all", "away")] == ["0-1", "0-2"]
    assert current_streak(select(ms, "league"), "losing").length == 1
    assert current_streak(ms, "winning").length == 1  # all competitions includes the cup win


def test_previous_run_is_the_most_recent_earlier_one() -> None:
    ms = mk("0-1 0-1 0-1 0-1 1-0 0-1 0-1 1-1 0-1 0-1 0-1")
    assert current_streak(ms, "losing").length == 3
    prev = previous_run_at_least(ms, "losing", 3)
    assert prev is not None and prev.match_key == "k3"  # the 4-game run ended at index 3
    prev2 = previous_run_at_least(ms, "losing", 2)
    assert prev2 is not None and prev2.match_key == "k6"
    assert previous_run_at_least(ms, "losing", 5) is None


def test_biggest_and_scoreline_comparison_rules() -> None:
    ms = mk("3-0 4-1 1-0 0-3 2-0 1-2")
    big = biggest(ms, "W")
    assert big is not None and big.score == "4-1"  # same margin as 3-0, more goals scored
    worst = biggest(ms, "L")
    assert worst is not None and worst.score == "0-3"
    c = compare_scoreline(ms, 2, 0)
    assert c is not None and c.previous is not None and c.previous.score == "2-0" and c.matches_since == 1
    c = compare_scoreline(ms, 5, 2)  # margin 3, five scored: beats 4-1 on the tie-break
    assert c is not None and c.previous is None and c.matches_since == len(ms)
    c = compare_scoreline(ms, 4, 1)  # equal to 4-1 counts as at least as big
    assert c is not None and c.previous is not None and c.previous.score == "4-1"
    c = compare_scoreline(ms, 1, 4)
    assert c is not None and c.result == "L" and c.previous is None
    assert compare_scoreline(ms, 2, 2) is None


def test_first_since_requires_a_gap() -> None:
    ms = mk("2-1 0-0 0-1")
    fs = first_since(ms, "W")
    assert fs is not None and fs[0] is not None and fs[0].score == "2-1" and fs[1] == 2
    assert first_since(mk("2-1"), "W") is None  # previous match was already a win
    fs = first_since(mk("0-0 0-1"), "W")
    assert fs == (None, 2)


def test_milestones_crossed() -> None:
    assert milestones_crossed(99, 100, (50, 100, 150)) == [100]
    assert milestones_crossed(48, 50, (25, 50, 100)) == [50]
    assert milestones_crossed(100, 101, (50, 100)) == []
    assert milestones_crossed(0, 1, (1, 5, 10)) == [1]
