"""Every historical / record claim the signal engine can surface, verified against the fictional records.

The sweep replays each scenario exactly as the signal engine does (context facts are recomputed at every
CONTEXT_TRIGGERS event, on the released prefix only) and checks every distinct context fact text. Each claim is
recomputed INDEPENDENTLY from the structured records - the itemised derby meetings and player careers in the
knowledge base, and the match-by-match fixture history - with the plain loops below, never with records.py or
the function that wrote the sentence. A fact family the verifier does not know fails the sweep, so a new kind
of claim cannot ship unverified.
"""

from __future__ import annotations

import datetime as dt
import re
from collections.abc import Callable, Sequence
from dataclasses import dataclass, field, replace

import pytest

from byline.events.models import MatchEvent
from byline.signals.engine import CONTEXT_TRIGGERS
from byline.storage.fixtures import MatchPackage, available_scenarios, load_package
from byline.world.context import ContextFact, context_facts
from byline.world.facts import seeded_facts
from byline.world.history import ClubMatch, SyntheticHistoryProvider, synthetic_history
from byline.world.knowledge import BOOKINGS_FOR_BAN, CURRENT_SEASON, LEAGUE_RULES, KnowledgeBase, build
from byline.world.models import World

MONTHS = ("January", "February", "March", "April", "May", "June", "July", "August", "September", "October",
          "November", "December")
WORDS = {"one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8, "nine": 9,
         "ten": 10}


# ---------------------------------------------------------------- independent helpers (no records.py)


def d_month(iso: str) -> str:
    d = dt.date.fromisoformat(iso)
    return f"{MONTHS[d.month - 1]} {d.year}"


def d_short(iso: str) -> str:
    d = dt.date.fromisoformat(iso)
    return f"{d.day} {MONTHS[d.month - 1][:3]} {d.year}"


def nth(n: int) -> str:
    return f"{n}{'th' if 11 <= n % 100 <= 13 else {1: 'st', 2: 'nd', 3: 'rd'}.get(n % 10, 'th')}"


def num(token: str) -> int:
    return WORDS[token] if token in WORDS else int(token)


def outcome(gf: int, ga: int) -> str:
    return "W" if gf > ga else "L" if gf < ga else "D"


TESTS: dict[str, Callable[[int, int], bool]] = {
    "unbeaten": lambda gf, ga: gf >= ga, "winning": lambda gf, ga: gf > ga, "losing": lambda gf, ga: gf < ga,
    "winless": lambda gf, ga: gf <= ga, "scoring": lambda gf, _ga: gf > 0,
}


def tail_run(seq: Sequence[tuple[str, int, int]], kind: str) -> tuple[int, str | None]:
    """(length, first date) of the run of `kind` ending with the newest match of (date, gf, ga) tuples."""
    n = 0
    for _d, gf, ga in reversed(seq):
        if not TESTS[kind](gf, ga):
            break
        n += 1
    return n, (seq[len(seq) - n][0] if n else None)


def earlier_runs(seq: Sequence[tuple[str, int, int]], kind: str) -> list[tuple[int, str]]:
    """(length, last date) of every maximal run of `kind` that is NOT the current one, oldest first."""
    out: list[tuple[int, str]] = []
    n = 0
    for i, (_d, gf, ga) in enumerate(seq):
        if TESTS[kind](gf, ga):
            n += 1
        elif n:
            out.append((n, seq[i - 1][0]))
            n = 0
    return out


@dataclass
class Records:
    """Raw fictional records for one world, plus the released event prefix being checked."""

    world: World
    prov: SyntheticHistoryProvider
    kb: KnowledgeBase
    events: list[MatchEvent] = field(default_factory=list)

    # ---- teams and players
    def tid_by_short(self, short: str) -> str:
        return next(t.team_id for t in self.world.teams if t.short_name == short)

    def name(self, pid: str) -> str:
        p = self.world.player(pid)
        return f"{p.given_name} {p.family_name}"

    def club(self, pid: str) -> str:
        return self.world.team(self.world.player(pid).team_id).name

    def venue(self, tid: str) -> str:
        return "home" if tid == self.world.home.team_id else "away"

    # ---- match history (one club's side, oldest first)
    def matches(self, tid: str, league: bool, where: str = "any") -> list[ClubMatch]:
        return [m for m in self.prov.fixtures(tid) if (not league or m.competition.kind == "league")
                and (where == "any" or m.venue == where)]

    def seq(self, tid: str, league: bool, where: str = "any") -> list[tuple[str, int, int]]:
        return [(m.date, m.goals_for, m.goals_against) for m in self.matches(tid, league, where)]

    def first_season(self, tid: str) -> str:
        return self.prov.fixtures(tid)[0].season

    # ---- derbies, read from the itemised meetings (the primary derby record)
    def derbies(self, tid: str) -> list[tuple[str, str, int, int, str]]:
        """(iso date, venue for tid, goals for, goals against, season) per meeting, oldest first."""
        out = []
        for m in self.kb.meetings:
            iso = dt.datetime.strptime(m.date, "%d %B %Y").date().isoformat()
            home = m.home == tid
            out.append((iso, "home" if home else "away", m.home_goals if home else m.away_goals,
                        m.away_goals if home else m.home_goals, m.season))
        return sorted(out)

    def derby_goal_tally(self) -> dict[tuple[str, str], int]:
        tally: dict[tuple[str, str], int] = {}
        for m in self.kb.meetings:
            for t, n, _mi in m.scorers:
                tally[(t, n)] = tally.get((t, n), 0) + 1
        return tally

    # ---- careers (league only: the record has no per-player cup appearances or goals)
    def club_rows(self, pid: str) -> list[tuple[int, int, int]]:
        return [(s.apps, s.goals, s.yellows) for s in self.kb.careers[pid].seasons if s.club == self.club(pid)]

    def now(self, pid: str) -> tuple[str, str, int, int, int]:
        s = self.kb.careers[pid].seasons[-1]
        return s.season, s.club, s.apps, s.goals, s.yellows

    # ---- this match, from the raw event prefix (not the reducer)
    def confirmed_goals(self) -> list[tuple[MatchEvent, MatchEvent]]:
        """(provisional, confirmation) for goals confirmed and not later disallowed, in confirmation order."""
        prov = {e.event_id: e for e in self.events if e.type == "goal.provisional"}
        voided = {e.payload["goal_event_id"] for e in self.events if e.type == "goal.disallowed"}
        return [(prov[e.payload["goal_event_id"]], e) for e in self.events
                if e.type == "goal.confirmed" and e.payload["goal_event_id"] not in voided]

    def score(self) -> tuple[int, int]:
        h = sum(1 for g, _c in self.confirmed_goals() if g.team_id == self.world.home.team_id)
        return h, len(self.confirmed_goals()) - h

    def starters(self, tid: str) -> set[str]:
        lu = next((e for e in self.events if e.type == "lineup.confirmed" and e.team_id == tid), None)
        return {s["player_id"] for s in lu.payload["starters"]} if lu else set()

    def came_on(self, pid: str) -> MatchEvent | None:
        return next((e for e in self.events if e.type == "substitution" and e.payload["player_on_id"] == pid), None)


# ---------------------------------------------------------------- the sweep: every emitted text, every scenario


@dataclass(frozen=True)
class Emitted:
    scenario: str
    upto_seq: int
    fact: ContextFact


def _emitted(pkg: MatchPackage, sid: str) -> list[Emitted]:
    out: dict[tuple[str, str], Emitted] = {}
    evs = list(pkg.events)
    for i, e in enumerate(evs):
        if e.type not in CONTEXT_TRIGGERS:
            continue
        for f in context_facts(pkg.world, evs[: i + 1]):
            if f.category in ("form", "fixtures", "stadium", "head_to_head", "manager", "streak", "record",
                              "milestone", "goal", "discipline"):
                out.setdefault((f.fact_id, f.short_text), Emitted(sid, e.seq, f))
            else:
                raise AssertionError(f"unknown context category {f.category}: {f.fact_id}")
    return list(out.values())


@pytest.fixture(scope="module")
def packages() -> dict[str, MatchPackage]:
    return {sid: load_package(sid) for sid in available_scenarios()}


@pytest.fixture(scope="module")
def sweep(packages: dict[str, MatchPackage]) -> list[Emitted]:
    return [x for sid, pkg in packages.items() for x in _emitted(pkg, sid)]


def records_at(pkg: MatchPackage, upto_seq: int) -> Records:
    prov = synthetic_history(pkg.world)
    return Records(pkg.world, prov, build(pkg.world), [e for e in pkg.events if e.seq <= upto_seq])


# ---------------------------------------------------------------- per-family verifiers


def v_pre_streak(r: Records, f: ContextFact) -> None:
    m = re.fullmatch(r"ctx-streak-(\w+)-(unbeaten|winning|losing|winless|scoring)-(all|league)(?:-(home|away))?",
                     f.fact_id)
    assert m, f.fact_id
    tid, kind, scope, where = m.group(1), m.group(2), m.group(3), m.group(4) or "any"
    seq = r.seq(tid, scope == "league", where)
    n, since = tail_run(seq, kind)
    assert re.search(rf"\b{n} (?:{'home ' if where == 'home' else 'away ' if where == 'away' else ''})"
                     r"(?:league games|straight games|clean)", f.short_text), (f.short_text, n)
    if "(since " in f.short_text and "record" not in f.short_text:
        assert since is not None and f"(since {d_short(since)})" in f.short_text, (f.short_text, since)
    if "longest run in the record" in f.short_text:
        assert all(length < n for length, _end in earlier_runs(seq, kind)), f.short_text
        assert f"(since {r.first_season(tid)})" in f.short_text
    if "in all competitions" in f.short_text:
        assert scope == "all"


def v_form(r: Records, f: ContextFact) -> None:
    tid = f.fact_id.removeprefix("ctx-form-")
    lg = r.matches(tid, league=True)
    last5 = " ".join(outcome(m.goals_for, m.goals_against) for m in lg[-5:])
    where = r.venue(tid)
    cur = [outcome(m.goals_for, m.goals_against) for m in lg if m.season == CURRENT_SEASON and m.venue == where]
    assert f.short_text == (f"{r.world.team(tid).short_name} league form (newest last): {last5}. {where.title()} this "
                            f"season: W{cur.count('W')} D{cur.count('D')} L{cur.count('L')}.")


def v_fixtures(r: Records, f: ContextFact) -> None:
    tid = f.fact_id.removeprefix("ctx-fixtures-")
    nxt = r.prov.upcoming(tid, 3)
    assert all(u.date > r.prov.today() for u in nxt) and [u.date for u in nxt] == sorted(u.date for u in nxt)
    # "all competitions": the fictional National Cup starts in January, so nothing else can come first
    assert all(u.date < f"{r.prov.today()[:4]}-12-31" for u in nxt)
    parts = [f"{u.opponent} ({'H' if u.venue == 'home' else 'A'}) {dt.date.fromisoformat(u.date).day} "
             f"{MONTHS[dt.date.fromisoformat(u.date).month - 1][:3]}" for u in nxt]
    assert f.short_text == f"Next for {r.world.team(tid).short_name}: " + ", ".join(parts) + "."


def v_manager(r: Records, f: ContextFact) -> None:
    tid = f.fact_id.removeprefix("ctx-manager-")
    mgr = r.kb.managers[tid]
    spell = [m for m in r.prov.fixtures(tid) if m.season >= str(mgr["appointed"])]
    res = [outcome(m.goals_for, m.goals_against) for m in spell]
    der = [outcome(m.goals_for, m.goals_against) for m in spell if m.opponent_id]
    assert f.short_text == (f"{mgr['name']} ({r.world.team(tid).short_name} manager since {mgr['appointed']}): "
                            f"P{len(res)} W{res.count('W')} D{res.count('D')} L{res.count('L')} in all competitions; "
                            f"derbies W{der.count('W')} D{der.count('D')} L{der.count('L')}.")


def v_h2h(r: Records, f: ContextFact) -> None:
    home, away = r.world.home, r.world.away
    if f.fact_id == "ctx-h2h-window":
        d = r.derbies(home.team_id)
        res = [outcome(gf, ga) for _iso, _v, gf, ga, _s in d]
        assert f.short_text == (f"Last {len(d)} derbies ({d[0][0][:4]}-{d[-1][0][:4]}): {home.short_name} "
                                f"{res.count('W')} wins, {away.short_name} {res.count('L')}, {res.count('D')} draws.")
        at = r.kb.all_time
        assert at["meetings"] == at[home.team_id] + at[away.team_id] + at["draws"] >= len(d)
        return
    tid = f.fact_id.removeprefix("ctx-h2h-")
    d = r.derbies(tid)
    wins = [x for x in d if x[2] > x[3]]
    last = wins[-1]
    big = max(wins, key=lambda x: (x[2] - x[3], x[2], x[0]))  # margin, goals scored, most recent
    stadium = r.world.team(tid).stadium if last[1] == "home" else r.world.team(r.world.opponent_of(tid)).stadium
    where = "at home" if last[1] == "home" else f"at {stadium}"
    short = r.world.team(tid).short_name
    assert f.short_text == (f"{short}'s last derby win: {last[2]}-{last[3]} {where}, {d_short(last[0])}. Biggest since "
                            f"{d[0][0][:4]}: {big[2]}-{big[3]} ({d_short(big[0])}).")


def v_stadium(r: Records, f: ContextFact) -> None:
    home = r.world.home
    res = [outcome(gf, ga) for _d, gf, ga in r.seq(home.team_id, league=True, where="home")]
    st = r.kb.stadium
    assert st["name"] == home.stadium
    assert f.short_text == (f"{st['name']} ({int(st['capacity']):,}): {home.short_name}'s home league record since "
                            f"{r.first_season(home.team_id)} is W{res.count('W')} D{res.count('D')} "
                            f"L{res.count('L')}.")


def v_appearance(r: Records, f: ContextFact) -> None:
    m = re.fullmatch(r"ctx-milestone-(\w+-\d+)-(apps-(\d+)|first-app-(\d{4}))", f.fact_id)
    assert m, f.fact_id
    pid = m.group(1)
    tid = r.world.player(pid).team_id
    sub = r.came_on(pid)
    # he plays today: in the CONFIRMED starting XI (pre-match fact) or the substitution that triggered it
    if f.trigger_event_id is None:
        assert pid in r.starters(tid), f"{pid} is not in the confirmed XI"
        lu = next(e for e in r.events if e.type == "lineup.confirmed" and e.team_id == tid)
        assert f.as_of_seq == lu.seq
    else:
        assert sub is not None and sub.event_id == f.trigger_event_id
    season, club, apps_now, _g, _y = r.now(pid)
    if m.group(3):
        mark = int(m.group(3))
        assert sum(a for a, _g, _y in r.club_rows(pid)) == mark - 1
        # league appearances only: the record holds no per-player cup appearances
        assert f.short_text == f"{r.name(pid)} makes his {nth(mark)} league appearance for " \
                               f"{r.world.team(tid).short_name} today."
    else:
        assert (season, club, apps_now) == (CURRENT_SEASON, r.club(pid), 0)
        assert f.short_text == (f"{r.name(pid)}'s first league appearance of the season for "
                                f"{r.world.team(tid).short_name}.")


def _goal_context(r: Records, goal_event_id: str) -> tuple[str, int, int]:
    """(scorer pid, nth confirmed goal by him today, nth confirmed derby goal today at this point)."""
    goals = r.confirmed_goals()
    assert goal_event_id in [g.event_id for g, _c in goals], f"{goal_event_id} is not a confirmed goal"
    upto = goals[: [g.event_id for g, _c in goals].index(goal_event_id) + 1]
    pid = upto[-1][0].player_id
    assert pid is not None and r.world.player(pid).team_id == upto[-1][0].team_id  # not an own goal
    return pid, sum(1 for g, _c in upto if g.player_id == pid), len(upto)


def v_goal(r: Records, f: ContextFact) -> None:
    m = re.fullmatch(r"ctx-goal-(\w+-\d+)-(E\d+)", f.fact_id)
    assert m, f.fact_id
    pid, today_n, _ = _goal_context(r, m.group(2))
    assert pid == m.group(1)
    _s, _c, _a, season_goals, _y = r.now(pid)
    club_goals = sum(g for _a, g, _y in r.club_rows(pid))
    derby = r.derby_goal_tally().get((r.world.player(pid).team_id, r.name(pid)), 0)
    short = r.world.team(r.world.player(pid).team_id).short_name
    assert f.short_text == (f"{r.name(pid)}: {nth(season_goals + today_n)} league goal of the season, "
                            f"{nth(club_goals + today_n)} for {short}, {nth(derby + today_n)} in derbies.")


def v_goal_milestone(r: Records, f: ContextFact) -> None:
    m = re.fullmatch(r"ctx-milestone-(\w+-\d+)-(derbygoals|goals)-(\d+)", f.fact_id)
    assert m, f.fact_id
    pid, family, mark = m.group(1), m.group(2), int(m.group(3))
    assert f.trigger_event_id is not None
    goal_id = next(c.payload["goal_event_id"] for c in r.events if c.event_id == f.trigger_event_id)
    scorer, today_n, _ = _goal_context(r, goal_id)
    assert scorer == pid
    tid = r.world.player(pid).team_id
    if family == "goals":
        assert sum(g for _a, g, _y in r.club_rows(pid)) + today_n == mark
        assert f.short_text == f"{r.name(pid)} scores his {nth(mark)} league goal for {r.world.team(tid).short_name}."
        return
    tally = r.derby_goal_tally()
    goals = r.confirmed_goals()
    for g, _c in goals[: [x.event_id for x, _c in goals].index(goal_id) + 1]:
        if g.player_id and r.world.player(g.player_id).team_id == g.team_id:
            key = (g.team_id or "", r.name(g.player_id))
            tally[key] = tally.get(key, 0) + 1
    mine = tally[(tid, r.name(pid))]
    assert mine == mark, (f.short_text, mine)
    if "the most by any player in derbies since" in f.short_text:
        assert all(v < mine for k, v in tally.items() if k != (tid, r.name(pid))), "not the sole leader"
        assert f.short_text.endswith(f"since {r.first_season(tid)}.")
    expected = f"{r.name(pid)} scores his first derby goal." if mark == 1 else f"{r.name(pid)}'s {nth(mark)} derby goal"
    assert f.short_text.startswith(expected)


def v_discipline(r: Records, f: ContextFact) -> None:
    card = next(e for e in r.events if e.event_id == f.fact_id.removeprefix("ctx-discipline-"))
    pid = card.player_id
    assert pid is not None and f.trigger_event_id == card.event_id
    mine = [e for e in r.events if e.player_id == pid and e.type.startswith("card.")]
    assert {e.type for e in mine} <= {"card.yellow", "card.second_yellow", "card.red"}
    _s, _c, _a, _g, yellows_before = r.now(pid)
    count = yellows_before + sum(1 for e in mine if e.type == "card.yellow" and e.seq <= card.seq)
    second = next((e for e in mine if e.type == "card.second_yellow"), None)
    text = f.short_text.split(": ", 1)[1] if f.short_text.startswith(r.name(pid) + ": ") else f.short_text
    if card.type == "card.yellow" and second is not None:
        assert text == (f"Booked at {card.display_clock}; it would have been booking number {count}, but it no "
                        f"longer counts after his {second.display_clock} second-yellow dismissal.")
        assert "two cautions of a second-yellow dismissal do not count" in LEAGUE_RULES
    elif card.type == "card.yellow" and count >= BOOKINGS_FOR_BAN:
        assert text == f"Booked at {card.display_clock}: booking number {count} this season brings a one-match ban."
        assert f"{WORDS_INV[BOOKINGS_FOR_BAN]} cautions in league matches bring a one-match ban" in LEAGUE_RULES
    elif card.type == "card.yellow":
        assert text == f"Booked at {card.display_clock} ({count} league bookings this season)."
    else:
        kind = "second yellow" if card.type == "card.second_yellow" else "straight red"
        assert text == f"Sent off ({kind}) at {card.display_clock}: a one-match ban follows."
        # the ban length is the fictional league's recorded rule (one rule for every kind of sending-off)
        assert "a sending-off brings a one-match ban" in LEAGUE_RULES


WORDS_INV = {v: k for k, v in WORDS.items()}


# ---- result clauses (full time and "If it ends ...")


def _after(r: Records, tid: str, where: str, gf: int, ga: int) -> list[tuple[str, int, int]]:
    return [*r.seq(tid, True, where), (r.prov.today(), gf, ga)]


def _check_note(r: Records, tid: str, seq: Sequence[tuple[str, int, int]], kind: str, n: int, note: str) -> None:
    """The ', their longest ...' / ' for the first time since ...' tail, against the earlier runs."""
    prev = [end for length, end in earlier_runs(seq, kind) if length >= n]
    if "in the record (since" in note:
        assert not prev and f"(since {r.first_season(tid)})" in note, note
    elif "since" in note:
        assert prev and note.endswith(d_month(prev[-1])), (note, prev[-1:])
        assert (dt.date.fromisoformat(r.prov.today()) - dt.date.fromisoformat(prev[-1])).days >= 365
    else:
        assert prev and (dt.date.fromisoformat(r.prov.today()) - dt.date.fromisoformat(prev[-1])).days < 365, (
            "a run with no earlier equal in the record, or none for a year, would carry a note", n)


CLAUSES: list[tuple[str, str, int]] = [
    # (regex, kind, 1 = extends a run / 0 = ends a run)
    (r"(?P<t>\w+) are now unbeaten in (?P<n>\d+) (?P<w>home |away )?league games(?P<note>.*)", "unbeaten", 1),
    (r"(?P<t>\w+)'s unbeaten (?P<w>home |away )?league run reaches (?P<n>\d+)(?P<note>.*)", "unbeaten", 1),
    (r"(?P<t>\w+) have now won (?P<n>\d+) (?P<w>home |away )?league games in a row(?P<note>.*)", "winning", 1),
    (r"(?P<t>\w+) make it (?P<n>\d+) (?P<w>home |away )?league wins in a row(?P<note>.*)", "winning", 1),
    (r"(?P<t>\w+) (?:have lost|lose) (?P<n>\w+) (?P<w>home |away )?league games in a row(?P<note>.*)", "losing", 1),
    (r"(?P<t>\w+) are without a win in (?P<n>\d+) (?P<w>home |away )?league games(?P<note>.*)", "winless", 1),
    (r"(?P<t>\w+)'s winless (?P<w>home |away )?league run reaches (?P<n>\d+)(?P<note>.*)", "winless", 1),
    (r"(?P<t>\w+)'s (?P<n>\d+)-game (?P<k>unbeaten|winning|winless) (?P<w>home |away )?league run (?:is over|ends)",
     "", 0),
    (r"(?P<t>\w+) end a run of (?P<n>\d+) straight (?P<w>home |away )?league defeats", "losing", 0),
]


def verify_result_clause(r: Records, clause: str, hg: int, ag: int) -> None:
    clause = clause.removesuffix(".")
    home, away = r.world.home.team_id, r.world.away.team_id
    m = re.fullmatch(r"(?:it is )?(?P<t>\w+)'s first derby win(?P<at> at [\w ]+?)? since (?P<d>\d+ \w+ \d{4})"
                     r"(?: \((?P<gap>\w+) derb(?:y|ies) without one\))?", clause)
    if m:
        tid = r.tid_by_short(m.group("t"))
        gf, ga = (hg, ag) if tid == home else (ag, hg)
        assert gf > ga
        d = [x for x in r.derbies(tid) if not m.group("at") or x[1] == r.venue(tid)]
        if m.group("at"):
            assert m.group("at") == f" at {r.world.home.stadium}"  # today's venue
        last_win = max(i for i, x in enumerate(d) if x[2] > x[3])
        assert d_short(d[last_win][0]) == m.group("d")
        if m.group("gap"):
            assert num(m.group("gap")) == len(d) - 1 - last_win >= 1
        return
    m = re.fullmatch(r"(?P<who>[\w -]+)'s (?P<nth>\d+\w\w) derby win as (?P<t>\w+) manager \(W(?P<w>\d+) D(?P<d>\d+) "
                     r"L(?P<l>\d+)\)", clause)
    if m:
        tid = r.tid_by_short(m.group("t"))
        mgr = r.kb.managers[tid]
        assert mgr["name"] == m.group("who")
        gf, ga = (hg, ag) if tid == home else (ag, hg)
        res = [outcome(x[2], x[3]) for x in r.derbies(tid) if x[4] >= str(mgr["appointed"])] + [outcome(gf, ga)]
        assert (int(m.group("w")), int(m.group("d")), int(m.group("l"))) == (res.count("W"), res.count("D"),
                                                                             res.count("L"))
        assert m.group("nth") == nth(res.count("W")) and res[-1] == "W"
        return
    for rx, kind, extends in CLAUSES:
        m = re.fullmatch(rx, clause)
        if not m:
            continue
        tid = r.tid_by_short(m.group("t"))
        assert tid in (home, away)
        gf, ga = (hg, ag) if tid == home else (ag, hg)
        where = (m.group("w") or "any").strip()
        if where != "any":
            assert where == r.venue(tid)  # a venue run only counts today's venue
        kind = kind or m.group("k")
        n = num(m.group("n"))
        if extends:
            seq = _after(r, tid, where, gf, ga)
            assert tail_run(seq, kind)[0] == n, (clause, tail_run(seq, kind))
            _check_note(r, tid, seq, kind, n, m.group("note"))
        else:
            assert not TESTS[kind](gf, ga) and tail_run(r.seq(tid, True, where), kind)[0] == n, clause
        return
    raise AssertionError(f"unverified result clause: {clause!r}")


def v_full_time(r: Records, f: ContextFact) -> None:
    assert any(e.type == "match.finished" for e in r.events) and f.trigger_event_id is not None
    fin = next(e for e in r.events if e.type == "match.finished")
    hg, ag = r.score()
    assert fin.payload["final_score"] == {r.world.home.team_id: hg, r.world.away.team_id: ag}
    verify_result_clause(r, f.short_text, hg, ag)


def v_projection(r: Records, f: ContextFact) -> None:
    m = re.fullmatch(r"If it ends (\d+)-(\d+), (.+)", f.short_text)
    assert m and f.fact_id == f"ctx-ifends-{m.group(1)}-{m.group(2)}"
    assert not any(e.type == "match.finished" for e in r.events)
    hg, ag = int(m.group(1)), int(m.group(2))
    assert (hg, ag) == r.score()  # conditional on the CONFIRMED score at this point only
    verify_result_clause(r, m.group(3), hg, ag)


FAMILIES: list[tuple[str, Callable[[Records, ContextFact], None]]] = [
    (r"ctx-streak-.+", v_pre_streak), (r"ctx-form-\w+", v_form), (r"ctx-fixtures-\w+", v_fixtures),
    (r"ctx-manager-\w+", v_manager), (r"ctx-h2h-\w+", v_h2h), (r"ctx-stadium", v_stadium),
    (r"ctx-milestone-\w+-\d+-(apps|first-app)-\d+", v_appearance), (r"ctx-goal-.+", v_goal),
    (r"ctx-milestone-\w+-\d+-(derbygoals|goals)-\d+", v_goal_milestone), (r"ctx-discipline-E\d+", v_discipline),
    (r"ctx-ft-.+", v_full_time), (r"ctx-ifends-\d+-\d+", v_projection),
]


def verify(pkg: MatchPackage, x: Emitted) -> None:
    r = records_at(pkg, x.upto_seq)
    fn = next((fn for rx, fn in FAMILIES if re.fullmatch(rx, x.fact.fact_id)), None)
    assert fn is not None, f"no verifier for {x.fact.fact_id}: {x.fact.short_text}"
    fn(r, x.fact)


def test_every_emitted_historical_fact_matches_the_records(packages: dict[str, MatchPackage],
                                                           sweep: list[Emitted]) -> None:
    failures = []
    for x in sweep:
        try:
            verify(packages[x.scenario], x)
        except AssertionError as err:
            failures.append(f"[{x.scenario} @seq {x.upto_seq}] {x.fact.fact_id}: {x.fact.short_text} -> {err}")
    assert not failures, "\n".join(failures)
    # the sweep really covers every family in every scenario (no silent shrinkage)
    assert {x.scenario for x in sweep} == {"golden_story", "discipline_var", "ordinary_match"}
    for sid in ("golden_story", "discipline_var", "ordinary_match"):
        fams = {x.fact.category for x in sweep if x.scenario == sid}
        assert {"form", "fixtures", "manager", "head_to_head", "stadium", "streak", "milestone", "goal"} <= fams
    assert sum(1 for x in sweep if x.fact.fact_id.startswith("ctx-ft-")) >= 15
    assert sum(1 for x in sweep if x.fact.fact_id.startswith("ctx-ifends-")) >= 6


def _rejects(pkg: MatchPackage, x: Emitted, text: str) -> bool:
    try:
        verify(pkg, Emitted(x.scenario, x.upto_seq, replace(x.fact, short_text=text)))
    except AssertionError:
        return True
    return False


def test_the_verifier_rejects_perturbed_claims(packages: dict[str, MatchPackage], sweep: list[Emitted]) -> None:
    """The sweep is not vacuous: nudging ANY number in an emitted claim by one, or attaching a record note the
    history does not support, is caught."""
    nudged = 0
    for x in sweep:
        m = re.search(r"\d+", x.fact.short_text)
        if m is None:
            continue
        wrong = x.fact.short_text[:m.start()] + str(int(m.group()) + 1) + x.fact.short_text[m.end():]
        assert _rejects(packages[x.scenario], x, wrong), f"perturbed claim accepted: {wrong}"
        nudged += 1
    assert nudged >= 60
    by = {(x.scenario, x.fact.fact_id): x for x in sweep}
    g = packages["golden_story"]
    dh = by[("golden_story", "ctx-milestone-RVC-09-derbygoals-5")]  # Rostami (7) and Ferrandi lead him
    assert _rejects(g, dh, dh.fact.short_text.removesuffix(".") + ", the most by any player in derbies since 2016/17.")
    ft = by[("golden_story", "ctx-ft-streak-NBA-unbeaten-league")]  # a 13-game run ended in May 2026
    assert _rejects(g, ft, ft.fact.short_text.removesuffix(".") + ", their longest run in the record (since 2016/17).")
    lose = by[("golden_story", "ctx-ft-streak-RVC-losing-league")]
    assert _rejects(g, lose, lose.fact.short_text.replace("March 2020", "April 2020"))
    old = by[("ordinary_match", "ctx-milestone-NBA-09-apps-100")]
    assert _rejects(packages["ordinary_match"], old, "Nico Vantreight makes his 100th appearance for Northbridge today.")


# ---------------------------------------------------------------- targeted regressions


def test_the_100th_appearance_is_a_league_count_for_a_confirmed_starter(packages: dict[str, MatchPackage]) -> None:
    """Fix: the record holds league appearances only, while Northbridge played cup ties in his spell, so the
    claim must say 'league appearance'. Vantreight is in every scenario's confirmed XI and has 99 before today."""
    for pkg in packages.values():
        r = records_at(pkg, max(e.seq for e in pkg.events))
        assert sum(a for a, _g, _y in r.club_rows("NBA-09")) == 99
        assert "NBA-09" in r.starters("NBA")
        spell_cup = [m for m in r.prov.fixtures("NBA") if m.competition.kind == "cup"
                     and m.season >= r.kb.careers["NBA-09"].joined_season]
        assert spell_cup  # cup matches exist that his (league-only) record cannot account for
        f = next(f for f in context_facts(pkg.world, pkg.events) if f.fact_id == "ctx-milestone-NBA-09-apps-100")
        assert f.short_text == "Nico Vantreight makes his 100th league appearance for Northbridge today."
    seeded = {f.short_text for f in seeded_facts(next(iter(packages.values())).world)}
    assert "Today is his 100th league appearance for Northbridge." in seeded
    assert "#9 Nico Vantreight makes his 100th Northbridge league appearance." in seeded
    assert not [t for t in seeded if re.search(r"100th (Northbridge )?appearance", t)]


def test_season_league_goals_include_the_itemised_league_derby_goals(golden: MatchPackage) -> None:
    """Fix: five players had more LEAGUE derby goals in a season than league goals that season (e.g. Ferrandi
    2018/19: one league goal, two league derby goals), so 'Nth for Northbridge' contradicted the meetings."""
    kb = build(golden.world)
    for pid, car in kb.careers.items():
        p = golden.world.player(pid)
        name = f"{p.given_name} {p.family_name}"
        for s in car.seasons:
            league_derby = [m for m in kb.meetings if m.season == s.season and m.competition == "League"
                            and any(n == name for _t, n, _mi in m.scorers)]
            goals = sum(1 for m in league_derby for _t, n, _mi in m.scorers if n == name)
            assert goals <= s.goals <= s.apps, (pid, s.season, goals, s.goals)
            assert len(league_derby) <= s.apps  # he played in every league derby he scored in
            if league_derby:
                assert s.club == golden.world.team(p.team_id).name
    ferrandi = kb.careers["NBA-10"]
    assert next(s.goals for s in ferrandi.seasons if s.season == "2018/19") == 2
    assert sum(s.goals for s in ferrandi.at("Northbridge Athletic")) == 42
    # top scorers are derived after the reconciliation, so every named current-squad top scorer agrees
    for tid, rows in kb.seasons.items():
        club = golden.world.team(tid).name
        for row in rows:
            ts = re.fullmatch(r"(.+) \((\d+)\)", row.top_scorer)
            assert ts is not None, row.top_scorer
            name, n = ts.groups()
            pid = next((x.player_id for x in golden.world.team(tid).players
                        if f"{x.given_name} {x.family_name}" == name), None)
            if pid is not None:
                assert next(s.goals for s in kb.careers[pid].seasons if s.season == row.season
                            and s.club == club) == int(n)


def test_ferrandi_goal_counts_once_and_the_retaken_penalty_is_his_43rd(packages: dict[str, MatchPackage]) -> None:
    """discipline_var: E1705 (penalty, disallowed for a retake) never counts; the retake E1711 counts once.
    golden_story: the VAR-disallowed 71' goal (E2006) counts in no tally, streak or projection."""
    dv = packages["discipline_var"]
    facts = context_facts(dv.world, dv.events)
    ferrandi = [f for f in facts if f.subject_id == "NBA-10" and f.category in ("goal", "milestone")]
    assert {f.fact_id for f in ferrandi} == {"ctx-goal-NBA-10-E1711", "ctx-milestone-NBA-10-derbygoals-10"}
    assert next(f for f in ferrandi if f.category == "goal").short_text == (
        "Luca Ferrandi: 3rd league goal of the season, 43rd for Northbridge, 10th in derbies.")
    assert not [f for f in facts if "E1705" in f.fact_id or f.trigger_event_id in ("E1705", "E1707")]
    g = packages["golden_story"]
    for upto in (2006, 2009, max(e.seq for e in g.events)):
        evs = [e for e in g.events if e.seq <= upto]
        fs = context_facts(g.world, evs)
        assert not [f for f in fs if "E2006" in f.fact_id or f.trigger_event_id in ("E2006", "E2009")]
        assert records_at(g, upto).score() == ((1, 1) if upto < 2346 else (2, 1))
    nine = [f for f in context_facts(g.world, g.events) if f.fact_id.startswith("ctx-goal-NBA-09")]
    assert [f.short_text for f in nine] == [
        "Nico Vantreight: 2nd league goal of the season, 39th for Northbridge, 2nd in derbies."]


def test_dismissal_bans_rest_on_the_recorded_league_rule(packages: dict[str, MatchPackage]) -> None:
    """Every 'one-match ban' claim is the fictional league's recorded rule (knowledge.LEAGUE_RULES): any sending-off
    (straight red for serious foul play or DOGSO, or a second yellow) brings one match; the cautions of a
    second-yellow dismissal do not count towards the five-booking total."""
    dv = packages["discipline_var"]
    texts = {f.fact_id: f.short_text for f in context_facts(dv.world, dv.events) if f.category == "discipline"}
    reasons = {e.event_id: e.payload["reason"] for e in dv.events if e.type == "card.red"}
    assert reasons == {"E0382": "serious_foul_play", "E0579": "dogso"}
    assert texts["ctx-discipline-E0382"] == "Leon Fairweather: Sent off (straight red) at 14': a one-match ban follows."
    assert texts["ctx-discipline-E0579"] == "Jonas Ekberg: Sent off (straight red) at 22': a one-match ban follows."
    assert texts["ctx-discipline-E1699"] == "Ruben Castellane: Booked at 62' (3 league bookings this season)."
    g = packages["golden_story"]
    gt = {f.fact_id: f.short_text for f in context_facts(g.world, g.events) if f.category == "discipline"}
    assert gt["ctx-discipline-E1138"] == ("Gabriel Ndiaye-Shaw: Booked at 42'; it would have been booking number 5, "
                                          "but it no longer counts after his 64' second-yellow dismissal.")
    assert gt["ctx-discipline-E1800"] == "Gabriel Ndiaye-Shaw: Sent off (second yellow) at 64': a one-match ban follows."
    assert gt["ctx-discipline-E2512"] == "Arlo Brennick: Booked at 90+2' (3 league bookings this season)."
    kb = build(g.world)
    assert [kb.careers[p].seasons[-1].yellows for p in ("RVC-06", "RVC-05", "RVC-08")] == [4, 2, 2]
    for clause in ("five cautions in league matches bring a one-match ban", "a sending-off brings a one-match ban",
                   "the two cautions of a second-yellow dismissal do not count towards the five-booking total"):
        assert clause in LEAGUE_RULES
    assert BOOKINGS_FOR_BAN == 5


def test_headline_records_recomputed_from_the_raw_history(golden: MatchPackage) -> None:
    """The specific numbers broadcast pre-match and at full time, recomputed with plain loops."""
    r = records_at(golden, -1)
    home_league = r.seq("NBA", True, "home")
    assert tail_run(home_league, "unbeaten") == (31, "2025-02-08")
    assert max(n for n, _e in earlier_runs(home_league, "unbeaten")) < 31  # longest in the record
    assert tail_run(r.seq("NBA", False), "scoring") == (11, "2026-05-16")
    assert tail_run(r.seq("NBA", True), "winning") == (3, "2026-09-26")
    rvc = r.seq("RVC", True)
    assert tail_run(rvc, "losing") == (3, "2026-09-26")
    assert [(n, end[:7]) for n, end in earlier_runs(rvc, "losing") if n >= 4] == [(4, "2020-03")]
    d = r.derbies("NBA")
    assert len(d) == 22 and [outcome(x[2], x[3]) for x in d].count("W") == 11
    rvc_away = [x for x in r.derbies("RVC") if x[1] == "away"]
    last = max(i for i, x in enumerate(rvc_away) if x[2] > x[3])
    assert (rvc_away[last][0], len(rvc_away) - 1 - last) == ("2022-10-21", 3)


def test_derby_goal_list_labelled_most_recent_is_newest_first_one_entry_per_derby(golden: MatchPackage) -> None:
    """Coordinator finding: 'Most recent: <dates>' listed the derbies oldest-first (e.g. L. Ferrandi's)."""
    w, kb = golden.world, build(golden.world)
    checked = 0
    for f in seeded_facts(w):
        if f.category != "derby" or not (f.extended_text or "").startswith("Most recent: "):
            continue
        p = w.player(f.subject_id)
        name = f"{p.given_name} {p.family_name}"
        scored = [m for m in kb.meetings if any(n == name for _t, n, _mi in m.scorers)]
        newest = sorted(scored, key=lambda m: dt.datetime.strptime(m.date, "%d %B %Y"), reverse=True)[:3]
        expected = ", ".join(f"{m.date} ({m.home} {m.home_goals}-{m.away_goals} {m.away})" for m in newest)
        assert f.extended_text == f"Most recent: {expected}.", (f.subject_id, f.extended_text)
        goals = sum(1 for m in kb.meetings for _t, n, _mi in m.scorers if n == name)
        assert f.short_text.startswith(f"{goals} derby goal"), (f.subject_id, f.short_text)
        checked += 1
    assert checked >= 5
