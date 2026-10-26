"""Live context facts for the signal engine: history-derived records that a match event makes relevant.

``context_facts(world, events)`` is a pure function of the released event log (ordered by seq) plus the
fictional history read through a ``HistoryProvider``. It never looks past the last event it is given:

- pre-match facts (trigger None): streaks entering today, head-to-head, managers, stadium, upcoming fixtures,
  and appearance milestones for confirmed starters (valid from that team's ``lineup.confirmed``);
- event facts: confirmed goals (from the reducer, so a goal ruled out by VAR never produces a scorer fact),
  substitutes' appearance milestones, card facts (re-using facts.match_facts' disciplinary logic);
- while the match is live, ONE conditional projection for the current confirmed score ("If it ends 2-1, ..."),
  never a claim about the outcome;
- at ``match.finished``: result-based records (streaks extended or ended, first derby win since, biggest
  win/defeat since).

Same events -> same facts, same ids. Everything is fictional and labelled as such.
"""

from __future__ import annotations

import datetime as dt
from collections.abc import Sequence
from dataclasses import asdict, dataclass
from typing import Any, Literal

from byline.events.models import MatchEvent
from byline.match_state.reducer import GoalRecord, MatchState, replay
from byline.world.facts import match_facts
from byline.world.history import (
    LEAGUE,
    ClubMatch,
    HistoryProvider,
    UpcomingFixture,
    Venue,
    synthetic_history,
)
from byline.world.knowledge import CURRENT_SEASON, PLAYED_THIS_SEASON
from byline.world.models import Player, Team, World
from byline.world.records import (
    APPEARANCE_MARKS,
    DERBY_GOAL_MARKS,
    GOAL_MARKS,
    Scope,
    StreakKind,
    Where,
    biggest,
    compare_scoreline,
    current_streak,
    days_between,
    describe,
    first_since,
    form,
    last_with,
    longest_run,
    milestones_crossed,
    previous_run_at_least,
    record,
    select,
)

Priority = Literal["alert", "insight", "quiet"]
MAX_TEXT = 140
SOURCE = "BYLINE fictional history and synthetic match events (invented for this demo)"
MONTHS = ("January", "February", "March", "April", "May", "June", "July", "August", "September", "October",
          "November", "December")
WORDS = ("zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten")


@dataclass(frozen=True)
class ContextFact:
    fact_id: str  # stable across rebuilds, e.g. "ctx-milestone-NBA-09-apps-100"
    priority: Literal["alert", "insight", "quiet"]
    category: str  # milestone, streak, record, head_to_head, form, fixtures, manager, stadium, discipline
    subject_kind: Literal["player", "team", "match"]
    subject_id: str
    short_text: str  # <= 140 chars, broadcast-ready, fictional data
    detail: str | None
    rule: str  # human-readable computation rule
    trigger_event_id: str | None  # the event that made it relevant (None = pre-match context)
    as_of_seq: int  # seq at which it becomes valid
    provenance: str = "fictional_seeded"
    source: str = SOURCE

    def to_json(self) -> dict[str, Any]:
        return asdict(self)


# ---------------------------------------------------------------- formatting


def fmt_date(iso: str) -> str:
    d = dt.date.fromisoformat(iso)
    return f"{d.day} {MONTHS[d.month - 1][:3]} {d.year}"


def fmt_month(iso: str) -> str:
    d = dt.date.fromisoformat(iso)
    return f"{MONTHS[d.month - 1]} {d.year}"


def ordinal(n: int) -> str:
    suffix = "th" if 11 <= n % 100 <= 13 else {1: "st", 2: "nd", 3: "rd"}.get(n % 10, "th")
    return f"{n}{suffix}"


def word(n: int) -> str:
    return WORDS[n] if 0 <= n < len(WORDS) else str(n)


def fit(*options: str) -> str:
    """First option within MAX_TEXT; otherwise the shortest, cut at a word boundary."""
    for o in options:
        if len(o) <= MAX_TEXT:
            return o
    short = min(options, key=len)
    return short[:MAX_TEXT - 1].rsplit(" ", 1)[0] + "…"


def _name(p: Player) -> str:
    return f"{p.given_name} {p.family_name}"


# ---------------------------------------------------------------- context


@dataclass
class _Ctx:
    world: World
    prov: HistoryProvider
    events: list[MatchEvent]
    state: MatchState

    @property
    def match_id(self) -> str:
        return self.world.fixture.match_id

    def team(self, team_id: str) -> Team:
        return self.world.team(team_id)

    def venue(self, team_id: str) -> Venue:
        return "home" if team_id == self.world.home.team_id else "away"

    def is_derby(self) -> bool:
        return bool(self.prov.head_to_head(self.world.home.team_id, self.world.away.team_id))

    def h2h(self, team_id: str) -> list[ClubMatch]:
        return self.prov.head_to_head(team_id, self.world.opponent_of(team_id))

    def window_label(self, team_id: str) -> str:
        hist = self.prov.fixtures(team_id)
        return hist[0].season if hist else CURRENT_SEASON

    def today_match(self, team_id: str, gf: int, ga: int) -> ClubMatch:
        opp = self.world.opponent_of(team_id)
        return ClubMatch(f"{self.match_id}-today", team_id, self.prov.today(), CURRENT_SEASON, LEAGUE,
                         f"Matchday {PLAYED_THIS_SEASON + 1}", self.venue(team_id), self.world.home.stadium,
                         self.team(opp).name, opp, gf, ga)

    def seq_of(self, event_id: str | None) -> int:
        return next((e.seq for e in self.events if e.event_id == event_id), 0)


def context_facts(world: World, events: Sequence[MatchEvent],
                  provider: HistoryProvider | None = None) -> list[ContextFact]:
    """Context facts valid after the last released event (deterministic; ids stable across rebuilds)."""
    evs = list(events)
    ctx = _Ctx(world, provider or synthetic_history(world), evs, replay(world, evs) if evs else MatchState(world))
    out: list[ContextFact] = []
    out += _pre_match(ctx)
    out += _lineup_facts(ctx)
    out += _goal_facts(ctx)
    out += _substitution_facts(ctx)
    out += _discipline_facts(ctx)
    if ctx.state.finished:
        out += _full_time(ctx)
    else:
        out += _projection(ctx)
    order = {f.fact_id: i for i, f in enumerate(out)}
    if len(order) != len(out):
        raise ValueError("duplicate context fact ids")
    return sorted(out, key=lambda f: (f.as_of_seq, order[f.fact_id]))


# ---------------------------------------------------------------- pre-match

ENTERING: tuple[tuple[StreakKind, Scope, int], ...] = (
    ("unbeaten", "league", 3), ("winning", "league", 3), ("losing", "league", 2), ("winless", "league", 3),
    ("scoring", "all", 5),
)


def _streak_text(short: str, kind: StreakKind, n: int, where_word: str) -> str:
    return {
        "unbeaten": f"{short} are unbeaten in {n} {where_word}league games",
        "winning": f"{short} have won {n} {where_word}league games in a row",
        "losing": f"{short} have lost {n} {where_word}league games in a row",
        "winless": f"{short} are without a win in {n} {where_word}league games",
        "scoring": f"{short} have scored in {n} straight {where_word}games in all competitions",
        "clean_sheet": f"{short} have kept {n} {where_word}clean sheets in a row",
    }[kind]


def _pre_match(c: _Ctx) -> list[ContextFact]:
    out: list[ContextFact] = []
    for team in c.world.teams:
        tid, short = team.team_id, team.short_name
        hist = c.prov.fixtures(tid)
        where: Where = c.venue(tid)
        lg = select(hist, "league")
        shown: set[StreakKind] = set()
        for kind, scope, thr in ENTERING:
            if kind == "winless" and "losing" in shown:
                continue
            sel = select(hist, scope)
            s = current_streak(sel, kind)
            if s.length < thr:
                continue
            shown.add(kind)
            other = current_streak(select(hist, "all" if scope == "league" else "league"), kind).length
            out.append(ContextFact(
                f"ctx-streak-{tid}-{kind}-{scope}", "insight", "streak", "team", tid,
                fit(f"{_streak_text(short, kind, s.length, '')} (since {fmt_date(s.since or c.prov.today())}).",
                    f"{_streak_text(short, kind, s.length, '')}."),
                f"{'All competitions' if scope == 'league' else 'League only'}: {other}.",
                f"{describe(kind, scope)}, entering today", None, 0))
        venue_kinds: tuple[StreakKind, ...] = ("unbeaten", "winless")
        for vk in venue_kinds:
            sel = select(hist, "league", where)
            s = current_streak(sel, vk)
            if s.length < 3:
                continue
            longest = longest_run(sel, vk)
            striking = s.length >= 10 and s.length >= longest
            note = f", their longest run in the record (since {c.window_label(tid)})" if striking else ""
            out.append(ContextFact(
                f"ctx-streak-{tid}-{vk}-league-{where}", "alert" if striking else "insight", "streak", "team", tid,
                fit(f"{_streak_text(short, vk, s.length, where + ' ')}{note}.",
                    f"{_streak_text(short, vk, s.length, where + ' ')}."),
                f"Run began {fmt_date(s.since or c.prov.today())}. Longest such run in the record "
                f"(since {c.window_label(tid)}): {longest}.",
                f"{describe(vk, 'league', where)}, entering today", None, 0))
            break
        cur = [m for m in lg if m.season == CURRENT_SEASON]
        at_venue = record(select(cur, "league", where))
        out.append(ContextFact(
            f"ctx-form-{tid}", "quiet", "form", "team", tid,
            f"{short} league form (newest last): {form(lg)}. {where.title()} this season: W{at_venue.won} "
            f"D{at_venue.drawn} L{at_venue.lost}.",
            f"Last ten league results: {form(lg, 10)}.",
            f"league only, last five results before today, newest last; {where} record in {CURRENT_SEASON}",
            None, 0))
        out.append(_manager_fact(c, tid))
        nxt = c.prov.upcoming(tid, 3)
        if nxt:
            def fx(u: UpcomingFixture) -> str:
                d = dt.date.fromisoformat(u.date)
                return f"{u.opponent} ({'H' if u.venue == 'home' else 'A'}) {d.day} {MONTHS[d.month - 1][:3]}"
            out.append(ContextFact(
                f"ctx-fixtures-{tid}", "quiet", "fixtures", "team", tid,
                fit(f"Next for {short}: " + ", ".join(fx(u) for u in nxt) + "."),
                "; ".join(f"{fmt_date(u.date)}: {u.competition.name}, {u.stage}, {u.stadium}" for u in nxt),
                "the next three fixtures after today, all competitions", None, 0))
    if c.is_derby():
        out += _h2h_pre_match(c)
    out.append(_stadium_fact(c))
    return out


def _manager_fact(c: _Ctx, tid: str) -> ContextFact:
    t = c.prov.manager(tid)
    team = c.team(tid)
    spell = [m for m in c.prov.fixtures(tid) if m.date >= t.start_date]
    rec = record(spell)
    derby = record([m for m in spell if m.is_derby])
    text = (f"{t.name} ({team.short_name} manager since {t.appointed_season}): {rec.short()} in all competitions; "
            f"derbies W{derby.won} D{derby.drawn} L{derby.lost}.")
    return ContextFact(
        f"ctx-manager-{tid}", "insight", "manager", "team", tid,
        fit(text, f"{t.name} since {t.appointed_season}: {rec.short()}; derbies W{derby.won} D{derby.drawn} "
                  f"L{derby.lost}."),
        f"Previously: {t.previous}. League only: {record(select(spell, 'league')).short()}.",
        f"all club matches (league + cup) on or after {t.start_date}, the start of the {t.appointed_season} "
        "appointment", None, 0)


def _h2h_pre_match(c: _Ctx) -> list[ContextFact]:
    home, away = c.world.home, c.world.away
    h2h = c.h2h(home.team_id)
    rec = record(h2h)
    first, last = h2h[0].date[:4], h2h[-1].date[:4]
    at = c.prov.all_time_head_to_head()
    out = [ContextFact(
        "ctx-h2h-window", "insight", "head_to_head", "match", c.match_id,
        f"Last {rec.played} derbies ({first}-{last}): {home.short_name} {rec.won} wins, {away.short_name} "
        f"{rec.lost}, {rec.drawn} draws.",
        f"All-time: {at['meetings']} meetings, {home.short_name} {at[home.team_id]}, {away.short_name} "
        f"{at[away.team_id]}, {at['draws']} draws.",
        "league + cup derbies in the record window, result from the home club's side", None, 0)]
    for team in (home, away):
        mine = c.h2h(team.team_id)
        lw, big = last_with(mine, "W"), biggest(mine, "W")
        if lw is None or big is None:
            continue
        where = "at home" if lw.venue == "home" else f"at {lw.stadium}"
        out.append(ContextFact(
            f"ctx-h2h-{team.team_id}", "insight", "head_to_head", "team", team.team_id,
            fit(f"{team.short_name}'s last derby win: {lw.score} {where}, {fmt_date(lw.date)}. Biggest since "
                f"{first}: {big.score} ({fmt_date(big.date)}).",
                f"{team.short_name}'s last derby win: {lw.score}, {fmt_date(lw.date)}. Biggest: {big.score} "
                f"({fmt_date(big.date)})."),
            f"{lw.competition.name}, {lw.stage}." + (" Scorers: " + ", ".join(
                f"{n} {mi}'" for t, n, mi in lw.scorers if t == team.team_id) + "." if lw.scorers else ""),
            "derbies in the record window; biggest = largest margin, then most goals scored, then most recent",
            None, 0))
    return out


def _stadium_fact(c: _Ctx) -> ContextFact:
    home = c.world.home
    st = c.prov.stadium()
    hist = c.prov.fixtures(home.team_id)
    rec = record(select(hist, "league", "home"))
    return ContextFact(
        "ctx-stadium", "quiet", "stadium", "match", c.match_id,
        fit(f"{st['name']} ({int(st['capacity']):,}): {home.short_name}'s home league record since "
            f"{c.window_label(home.team_id)} is W{rec.won} D{rec.drawn} L{rec.lost}."),
        f"Record attendance {int(st['record_attendance']):,}, for {st['record_match']}.",
        "home league matches in the record window", None, 0)


# ---------------------------------------------------------------- lineups, goals, substitutions, cards


def _club_apps(c: _Ctx, pid: str) -> int:
    team = c.team(c.world.player(pid).team_id)
    return sum(s.apps for s in c.prov.career(pid).at(team.name))


def _appearance_facts(c: _Ctx, pid: str, trigger: MatchEvent, as_sub: bool) -> list[ContextFact]:
    p = c.world.player(pid)
    team = c.team(p.team_id)
    before = _club_apps(c, pid)
    out = []
    how = "comes on for" if as_sub else "starts for"
    rule = ("club league appearances recorded in the fictional knowledge base before today, plus today's "
            + ("appearance as a substitute" if as_sub else "start (from the confirmed line-up)"))
    for mark in milestones_crossed(before, before + 1, APPEARANCE_MARKS):
        out.append(ContextFact(
            f"ctx-milestone-{pid}-apps-{mark}", "alert", "milestone", "player", pid,
            fit(f"{_name(p)} makes his {ordinal(mark)} league appearance for {team.short_name} today.",
                f"{p.display_name}: {ordinal(mark)} {team.short_name} league appearance today."),
            f"{_name(p)} {how} {team.short_name}; {before} league appearances for the club before today "
            f"(since {c.prov.career(pid).joined_season}).",
            rule, None if not as_sub else trigger.event_id, trigger.seq))
    if c.prov.career(pid).seasons[-1].apps == 0:
        out.append(ContextFact(
            f"ctx-milestone-{pid}-first-app-{CURRENT_SEASON[:4]}", "insight", "milestone", "player", pid,
            fit(f"{_name(p)}'s first league appearance of the season for {team.short_name}."),
            None, f"league appearances in {CURRENT_SEASON} before today = 0",
            None if not as_sub else trigger.event_id, trigger.seq))
    return out


def _lineup_facts(c: _Ctx) -> list[ContextFact]:
    out: list[ContextFact] = []
    for e in c.events:
        if e.type == "lineup.confirmed":
            for s in e.payload["starters"]:
                out += _appearance_facts(c, s["player_id"], e, as_sub=False)
    return out


def _substitution_facts(c: _Ctx) -> list[ContextFact]:
    out: list[ContextFact] = []
    for e in c.events:
        if e.type == "substitution":
            out += _appearance_facts(c, e.payload["player_on_id"], e, as_sub=True)
    return out


def _confirmed_goals(c: _Ctx) -> list[GoalRecord]:
    """Goals the reducer has CONFIRMED (VAR-disallowed and still-provisional goals excluded), in order."""
    gs = [g for g in c.state.goals if g.status == "confirmed"]
    return sorted(gs, key=lambda g: c.seq_of(g.decided_by_event_id))


def _derby_goals_before(c: _Ctx) -> dict[tuple[str, str], int]:
    """(team_id, scorer name) -> derby goals in the record window (each derby read from the home side)."""
    counts: dict[tuple[str, str], int] = {}
    for m in c.h2h(c.world.home.team_id):
        for t, n, _mi in m.scorers:
            counts[(t, n)] = counts.get((t, n), 0) + 1
    return counts


def _goal_facts(c: _Ctx) -> list[ContextFact]:
    out: list[ContextFact] = []
    derby = c.is_derby()
    tally = _derby_goals_before(c) if derby else {}
    today: dict[str, int] = {}
    for g in _confirmed_goals(c):
        if g.scorer_id is None or c.world.player(g.scorer_id).team_id != g.team_id:
            continue  # own goals carry no scorer record
        pid = g.scorer_id
        p = c.world.player(pid)
        team = c.team(p.team_id)
        car = c.prov.career(pid)
        today[pid] = today.get(pid, 0) + 1
        n = today[pid]
        season = car.seasons[-1].goals + n
        club_before = sum(s.goals for s in car.at(team.name)) + n - 1
        trig, seq = g.decided_by_event_id, c.seq_of(g.decided_by_event_id)
        milestone = False
        for mark in milestones_crossed(club_before, club_before + 1, GOAL_MARKS):
            milestone = True
            out.append(ContextFact(
                f"ctx-milestone-{pid}-goals-{mark}", "alert", "milestone", "player", pid,
                fit(f"{_name(p)} scores his {ordinal(mark)} league goal for {team.short_name}."),
                f"Goal at {g.minute}.", "club league goals in the fictional record before today plus confirmed "
                "goals today (VAR-disallowed goals excluded)", trig, seq))
        derby_note = ""
        if derby:
            key = (p.team_id, _name(p))
            before = tally.get(key, 0)
            tally[key] = before + 1
            leader = max(tally.values())
            leads = tally[key] == leader and sum(1 for v in tally.values() if v == leader) == 1
            for mark in milestones_crossed(before, before + 1, DERBY_GOAL_MARKS):
                milestone = True
                lead = (f", the most by any player in derbies since {c.window_label(p.team_id)}" if leads
                        else "")
                text = (f"{_name(p)} scores his first derby goal." if mark == 1
                        else f"{_name(p)}'s {ordinal(mark)} derby goal{lead}.")
                out.append(ContextFact(
                    f"ctx-milestone-{pid}-derbygoals-{mark}", "alert", "milestone", "player", pid,
                    fit(text, f"{_name(p)}'s {ordinal(mark)} derby goal."),
                    f"Goal at {g.minute}. Derby scorers counted over the {len(c.h2h(p.team_id))} derbies since "
                    f"{c.window_label(p.team_id)} plus today's confirmed goals.",
                    "derby goals (league + cup) in the record window plus confirmed goals today; VAR-disallowed "
                    "goals excluded", trig, seq))
            derby_note = f", {ordinal(before + 1)} in derbies"
        out.append(ContextFact(
            f"ctx-goal-{pid}-{g.goal_event_id}", "quiet" if milestone else "insight", "goal", "player", pid,
            fit(f"{_name(p)}: {ordinal(season)} league goal of the season, {ordinal(club_before + 1)} for "
                f"{team.short_name}{derby_note}.",
                f"{p.display_name}: {ordinal(season)} league goal this season{derby_note}."),
            f"Goal at {g.minute}" + (" (penalty)." if g.situation == "penalty" else "."),
            "league goals this season and club league goals from the fictional record before today, plus "
            "confirmed goals today (VAR-disallowed goals excluded)", trig, seq))
    return out


def _discipline_facts(c: _Ctx) -> list[ContextFact]:
    """Re-uses facts.match_facts (the fictional league's booking-ban rule) rather than re-implementing it."""
    out: list[ContextFact] = []
    cache: dict[str, list[Any]] = {}
    for e in c.events:
        if not e.type.startswith("card.") or e.player_id is None:
            continue
        pid = e.player_id
        if pid not in cache:
            cache[pid] = match_facts(c.world, pid, c.events)
        f = next((f for f in cache[pid] if f.category == "discipline" and f.event_source_ids
                  and f.event_source_ids[-1] == e.event_id), None)
        if f is None:
            continue
        p = c.world.player(pid)
        serious = "ban" in f.short_text or "Sent off" in f.short_text
        out.append(ContextFact(
            f"ctx-discipline-{e.event_id}", "alert" if serious else "insight", "discipline", "player", pid,
            fit(f"{_name(p)}: {f.short_text}", f"{p.display_name}: {f.short_text}", f.short_text),
            f.extended_text, "fictional league disciplinary rule (facts.match_facts) applied to this season's "
            "recorded bookings and the cards shown so far today", e.event_id, e.seq))
    return out


# ---------------------------------------------------------------- results: full time and projections


@dataclass(frozen=True)
class _Consequence:
    key: str
    team_id: str
    priority: Priority
    category: str
    final: str
    conditional: str
    rule: str
    detail: str | None
    weight: tuple[int, int]


WATCH: tuple[tuple[StreakKind, bool, int], ...] = (
    # (kind, only matches at today's venue (home for the home club, away for the visitors), threshold)
    ("unbeaten", False, 5), ("winning", False, 3), ("losing", False, 3), ("winless", False, 5),
    ("unbeaten", True, 5), ("winless", True, 5),
)


def _since_note(prev: ClubMatch | None, today: str, window: str, losing: bool) -> tuple[str, bool, int]:
    """(phrase, notable, age in days). Notable = no earlier run as long in the record, or none in a year."""
    if prev is None:
        return ((" for the first time in the record (since " + window + ")") if losing
                else f", their longest run in the record (since {window})"), True, 10 ** 5
    age = days_between(prev.date, today)
    if age < 365:
        return "", False, age
    return ((f" for the first time since {fmt_month(prev.date)}") if losing
            else f", their longest since {fmt_month(prev.date)}"), True, age


def _streak_consequences(c: _Ctx, tid: str, gf: int, ga: int) -> list[_Consequence]:
    out: list[_Consequence] = []
    short = c.team(tid).short_name
    hist = c.prov.fixtures(tid)
    today = c.today_match(tid, gf, ga)
    for kind, at_venue, thr in WATCH:
        where: Where = c.venue(tid) if at_venue else "any"
        ww = "" if where == "any" else f"{where} "
        sel = select(hist, "league", where)
        before = current_streak(sel, kind).length
        after_seq = [*sel, today]
        after = current_streak(after_seq, kind).length
        key = f"{tid}-{kind}-league" + ("" if where == "any" else f"-{where}")
        rule = describe(kind, "league", where) + "; today's result appended to the record"
        if after > before and after >= thr:
            prev = previous_run_at_least(after_seq, kind, after)
            note, notable, age = _since_note(prev, c.prov.today(), c.window_label(tid), kind == "losing")
            pri: Priority = "alert" if notable and after >= 4 else "insight"
            n = word(after) if kind == "losing" and notable else str(after)
            final, cond = {
                "unbeaten": (f"{short} are now unbeaten in {after} {ww}league games{note}.",
                             f"{short}'s unbeaten {ww}league run reaches {after}{note}"),
                "winning": (f"{short} have now won {after} {ww}league games in a row{note}.",
                            f"{short} make it {after} {ww}league wins in a row{note}"),
                "losing": (f"{short} have lost {n} {ww}league games in a row{note}.",
                           f"{short} lose {n} {ww}league games in a row{note}"),
                "winless": (f"{short} are without a win in {after} {ww}league games{note}.",
                            f"{short}'s winless {ww}league run reaches {after}{note}"),
            }.get(kind, (f"{short}: {kind} run {after}.", f"{short}'s {kind} run reaches {after}"))
            detail = (f"Previous run as long ended {fmt_date(prev.date)}." if prev is not None
                      else f"No run as long since {c.window_label(tid)}.")
            out.append(_Consequence(f"streak-{key}", tid, pri, "record" if notable else "streak", final, cond,
                                    rule, detail, (2 if pri == "alert" else 1, age)))
        elif after == 0 and before >= thr:
            pri = "alert" if before >= 10 else "insight"
            label = {"unbeaten": "unbeaten", "winning": "winning", "losing": "losing", "winless": "winless"}.get(
                kind, kind)
            final = (f"{short}'s {before}-game {label} {ww}league run is over." if kind != "losing"
                     else f"{short} end a run of {before} straight {ww}league defeats.")
            cond = (f"{short}'s {before}-game {label} {ww}league run ends" if kind != "losing"
                    else f"{short} end a run of {before} straight {ww}league defeats")
            out.append(_Consequence(f"streak-{key}", tid, pri, "streak", final, cond, rule,
                                    f"The run began {fmt_date(current_streak(sel, kind).since or c.prov.today())}.",
                                    (2 if pri == "alert" else 1, before)))
    return out


def _result_consequences(c: _Ctx, tid: str, gf: int, ga: int) -> list[_Consequence]:
    out = _streak_consequences(c, tid, gf, ga)
    team = c.team(tid)
    short = team.short_name
    today = c.prov.today()
    # biggest league win / defeat since
    cmp = compare_scoreline(select(c.prov.fixtures(tid), "league"), gf, ga)
    if cmp is not None and (cmp.previous is None or days_between(cmp.previous.date, today) >= 365):
        what = "win" if cmp.result == "W" else "defeat"
        since = (f"since {fmt_month(cmp.previous.date)}" if cmp.previous is not None
                 else f"in the record (since {c.window_label(tid)})")
        out.append(_Consequence(
            f"biggest-{tid}-league-{what}", tid, "alert", "record",
            f"{short}'s biggest league {what} {since}.", f"it is {short}'s biggest league {what} {since}",
            "a match counts as at least as big if its margin is larger, or equal with at least as many goals "
            f"({'scored' if what == 'win' else 'conceded'}); league only",
            f"Previous: {cmp.previous.score} v {cmp.previous.opponent}, {fmt_date(cmp.previous.date)}."
            if cmp.previous is not None else None, (2, 10 ** 5 if cmp.previous is None else
                                                    days_between(cmp.previous.date, today))))
    if not c.is_derby():
        return out
    h2h = c.h2h(tid)
    dcmp = compare_scoreline(h2h, gf, ga)
    if dcmp is not None and dcmp.matches_since >= 4:
        what = "win" if dcmp.result == "W" else "defeat"
        since = (f"since {fmt_month(dcmp.previous.date)}" if dcmp.previous is not None
                 else f"in the record (since {c.window_label(tid)})")
        out.append(_Consequence(
            f"biggest-{tid}-derby-{what}", tid, "alert", "record",
            f"{short}'s biggest derby {what} {since}.", f"it is {short}'s biggest derby {what} {since}",
            "derbies only; bigger = larger margin, or equal margin with at least as many goals", None,
            (2, dcmp.matches_since * 100)))
    if gf > ga:
        for venue_only in (False, True):
            sel = select(h2h, "all", c.venue(tid) if venue_only else "any")
            fs = first_since(sel, "W")
            if fs is None or fs[1] < 1:
                continue
            prev, gap = fs
            where = f" at {c.world.home.stadium}" if venue_only else ""
            since = f"since {fmt_date(prev.date)}" if prev is not None else f"in the record (since {c.window_label(tid)})"
            age = days_between(prev.date, today) if prev is not None else 10 ** 5
            pri: Priority = "alert" if age >= 730 else "insight"
            out.append(_Consequence(
                f"h2h-{tid}-first-win" + ("-venue" if venue_only else ""), tid, pri, "head_to_head",
                f"{short}'s first derby win{where} {since} ({word(gap)} derb{'y' if gap == 1 else 'ies'} "
                "without one).",
                f"it is {short}'s first derby win{where} {since}",
                "derbies (league + cup) in the record window" + (", at today's venue" if venue_only else "")
                + "; emitted only when at least one derby in between was not a win",
                None, (2 if pri == "alert" else 1, age)))
    return out


def _all_consequences(c: _Ctx, home_goals: int, away_goals: int) -> list[_Consequence]:
    h, a = c.world.home.team_id, c.world.away.team_id
    out = _result_consequences(c, h, home_goals, away_goals) + _result_consequences(c, a, away_goals, home_goals)
    return sorted(out, key=lambda x: x.weight, reverse=True)


def _projection(c: _Ctx) -> list[ContextFact]:
    goals = _confirmed_goals(c)
    if not goals:
        return []
    last = goals[-1]
    hg, ag = c.state.score[c.world.home.team_id], c.state.score[c.world.away.team_id]
    cons = _all_consequences(c, hg, ag)
    if not cons:
        return []
    top = cons[0]
    prefix = f"If it ends {hg}-{ag}, "
    return [ContextFact(
        f"ctx-ifends-{hg}-{ag}", "insight", "record", "match", c.match_id,
        fit(prefix + top.conditional + "."),
        ("Also: " + "; ".join(x.conditional for x in cons[1:3]) + ".") if len(cons) > 1 else None,
        "conditional on the current CONFIRMED score being the final score; " + top.rule,
        last.decided_by_event_id, c.seq_of(last.decided_by_event_id))]


def _full_time(c: _Ctx) -> list[ContextFact]:
    fin = next(e for e in c.events if e.type == "match.finished")
    hg, ag = c.state.score[c.world.home.team_id], c.state.score[c.world.away.team_id]
    out = [ContextFact(f"ctx-ft-{x.key}", x.priority, x.category, "team", x.team_id, fit(x.final), x.detail,
                       x.rule, fin.event_id, fin.seq) for x in _all_consequences(c, hg, ag)]
    if c.is_derby() and hg != ag:
        winner = c.world.home.team_id if hg > ag else c.world.away.team_id
        t = c.prov.manager(winner)
        spell = [m for m in c.h2h(winner) if m.date >= t.start_date]
        rec = record(spell)
        out.append(ContextFact(
            f"ctx-ft-manager-{winner}-derby", "insight", "manager", "team", winner,
            fit(f"{t.name}'s {ordinal(rec.won + 1)} derby win as {c.team(winner).short_name} manager "
                f"(W{rec.won + 1} D{rec.drawn} L{rec.lost})."),
            f"In charge since {t.appointed_season}.",
            f"derbies (league + cup) on or after {t.start_date}, including today's result", fin.event_id,
            fin.seq))
    return out
