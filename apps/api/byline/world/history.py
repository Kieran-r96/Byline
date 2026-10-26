"""Match-by-match FICTIONAL fixture history for BYLINE's two synthetic clubs, behind a provider boundary.

Every result here is invented and deterministic (seeded). It is generated to agree EXACTLY with the
structured knowledge base in knowledge.py:

- each completed season's league W/D/L and goals for/against equal that club's ``SeasonRecord``;
- every derby fixture (league or cup) is one of the existing ``Meeting`` records (same date and score);
- the current season's nine league results before today are the published form line (facts.py);
- each club's cup run ends in the round its ``SeasonRecord.cup`` says.

A few results are AUTHORED (see ``AUTHORED_CONSTRAINTS``) so the history supports deliberate storylines;
they only decide where results fall in the calendar, never the totals.

``HistoryProvider`` is the boundary (like ingest/adapter.py for match data): records and context facts
read history only through it, so a licensed statistics provider could replace ``SyntheticHistoryProvider``.
"""

from __future__ import annotations

import datetime as dt
import random
from collections.abc import Callable
from dataclasses import dataclass
from typing import Literal, Protocol

from byline.world.knowledge import (
    CUP_ROUNDS,
    CURRENT_SEASON,
    GAMES_PER_SEASON,
    LOWER_LEAGUE,
    OTHER_CLUBS,
    PLAYED_THIS_SEASON,
    SEASONS,
    SEED,
    Career,
    KnowledgeBase,
    SeasonRecord,
    build,
    cup_round_reached,
)
from byline.world.models import World

Result = Literal["W", "D", "L"]
Venue = Literal["home", "away"]
SOURCE = "BYLINE fictional fixture history (synthetic, seeded; invented for this demo)"


@dataclass(frozen=True)
class Competition:
    competition_id: str
    name: str
    kind: Literal["league", "cup"]


LEAGUE = Competition("league", "BYLINE Synthetic League (fictional)", "league")
CUP = Competition("cup", "National Cup (fictional)", "cup")
COMPETITION_BY_MEETING = {"League": LEAGUE, "National Cup": CUP}  # Meeting.competition -> Competition

AUTHORED_CONSTRAINTS = (
    "Home club: no home league defeat on or after 1 February 2025 (through today); its last home league game "
    "before that date was a defeat.",
    "Away club: its four league games ending with the last one played in March 2020 were defeats (the games either "
    "side were not), and it has no other run of four or more consecutive league defeats in the record.",
)
FORTRESS_FROM = dt.date(2025, 2, 1)
SLUMP_MONTH = (2020, 3)
SLUMP_LENGTH = 4

OTHER_STADIUMS = {
    "Harlow Vale": "Vale Meadow", "Port Selwyn Rovers": "Dockside Park", "Kilbride Moor Town": "Moorgate",
    "Ashcombe United": "Combe Lane", "Calder Rise": "Rise Park", "Fenwick Cross Albion": "Albion Fields",
    "Larkhill Wanderers": "Lark Road", "St. Avery": "Abbey Green", "Easter Lunn": "Lunn Park",
    "Dunmore Quay": "The Quayside", "Thornbury Forge": "Forge Street", "Merrow Bay": "Bayview",
    "Oldcastle Athletic": "Castle Mount", "Wexley Park": "Wexley Common", "Brannock Town": "Brannock Road",
    "Silverdale Rangers": "Silverdale", "Coldharbour": "Harbour End", "Quarry End": "The Quarry",
    "Brackenfield": "Fern Lane", "Hollins Mill": "Mill Meadow", "Saltmarsh Town": "Marsh Road",
    "Greyhope": "Hope Street", "Ludworth Villa": "Ludworth Lane", "Penfold Rovers": "Penfold Lane",
}
PROMOTED = {"Ashcombe United": ("2023/24", "Brackenfield")}  # promoted club: (first top-flight season, replaced)


@dataclass(frozen=True)
class ClubMatch:
    """One completed match from one club's perspective (a derby appears once for each club, same key)."""

    match_key: str
    team_id: str
    date: str  # ISO yyyy-mm-dd
    season: str
    competition: Competition
    stage: str  # "Matchday 7", "Round 4", "Final"
    venue: Venue
    stadium: str
    opponent: str
    opponent_id: str | None  # set when the opponent is the other BYLINE club (a derby)
    goals_for: int
    goals_against: int
    scorers: tuple[tuple[str, str, int], ...] = ()  # (team_id, name, minute); recorded for derbies only

    @property
    def result(self) -> Result:
        return "W" if self.goals_for > self.goals_against else "L" if self.goals_for < self.goals_against else "D"

    @property
    def is_derby(self) -> bool:
        return self.opponent_id is not None

    @property
    def is_league(self) -> bool:
        return self.competition.kind == "league"

    @property
    def score(self) -> str:
        return f"{self.goals_for}-{self.goals_against}"


@dataclass(frozen=True)
class UpcomingFixture:
    team_id: str
    date: str
    season: str
    competition: Competition
    stage: str
    venue: Venue
    stadium: str
    opponent: str
    opponent_id: str | None


@dataclass(frozen=True)
class ManagerTenure:
    team_id: str
    name: str
    appointed_season: str
    start_date: str  # ISO; every club match on or after it counts towards the manager's record
    previous: str


@dataclass
class History:
    today: str
    matches: dict[str, list[ClubMatch]]
    upcoming: dict[str, list[UpcomingFixture]]
    tenures: dict[str, ManagerTenure]


class HistoryProvider(Protocol):
    """What BYLINE needs from any history source (synthetic now; a licensed statistics service later)."""

    provider: str

    def today(self) -> str: ...  # ISO date of today's fixture

    def fixtures(self, team_id: str) -> list[ClubMatch]: ...  # completed matches before today, oldest first

    def upcoming(self, team_id: str, n: int = 3) -> list[UpcomingFixture]: ...  # after today, soonest first

    def season_table(self, team_id: str) -> list[SeasonRecord]: ...  # completed league seasons

    def career(self, player_id: str) -> Career: ...

    def head_to_head(self, team_id: str, opponent_id: str) -> list[ClubMatch]: ...  # from team_id's side

    def manager(self, team_id: str) -> ManagerTenure: ...

    def stadium(self) -> dict[str, str | int]: ...  # today's venue

    def all_time_head_to_head(self) -> dict[str, int]: ...


class SyntheticHistoryProvider:
    """The only implemented provider: BYLINE's seeded fictional history."""

    provider = "byline-synthetic-history"

    def __init__(self, world: World) -> None:
        self.world = world
        self.kb: KnowledgeBase = build(world)
        self.history: History = _history(world, self.kb)

    def today(self) -> str:
        return self.history.today

    def fixtures(self, team_id: str) -> list[ClubMatch]:
        return list(self.history.matches[team_id])

    def upcoming(self, team_id: str, n: int = 3) -> list[UpcomingFixture]:
        return self.history.upcoming[team_id][:n]

    def season_table(self, team_id: str) -> list[SeasonRecord]:
        return list(self.kb.seasons[team_id])

    def career(self, player_id: str) -> Career:
        return self.kb.careers[player_id]

    def head_to_head(self, team_id: str, opponent_id: str) -> list[ClubMatch]:
        return [m for m in self.history.matches[team_id] if m.opponent_id == opponent_id]

    def manager(self, team_id: str) -> ManagerTenure:
        return self.history.tenures[team_id]

    def stadium(self) -> dict[str, str | int]:
        return dict(self.kb.stadium)

    def all_time_head_to_head(self) -> dict[str, int]:
        return dict(self.kb.all_time)


_PROVIDERS: dict[str, SyntheticHistoryProvider] = {}


def synthetic_history(world: World) -> SyntheticHistoryProvider:
    """Deterministic; cached per match id like knowledge.build."""
    key = world.fixture.match_id
    if key not in _PROVIDERS:
        _PROVIDERS[key] = SyntheticHistoryProvider(world)
    return _PROVIDERS[key]


def current_season_form(team_id: str) -> list[Result]:
    """The published current-season league results before today (oldest first). Seeded exactly as the
    original form line in facts.py so existing facts are unchanged."""
    r = random.Random(f"form-{team_id}")
    out: list[Result] = []
    for _ in range(PLAYED_THIS_SEASON):
        c = r.choice("WWDDL" if team_id == "NBA" else "WDDLL")
        out.append("W" if c == "W" else "D" if c == "D" else "L")
    return out


# ---------------------------------------------------------------- generation


def season_start_year(season: str) -> int:
    return int(season[:4])


def _meeting_date(text: str) -> dt.date:
    return dt.datetime.strptime(text, "%d %B %Y").date()


def _first_weekday_on_or_after(d: dt.date, weekday: int) -> dt.date:
    return d + dt.timedelta(days=(weekday - d.weekday()) % 7)


def _nth_saturday(year: int, month: int, n: int) -> dt.date:
    return _first_weekday_on_or_after(dt.date(year, month, 1), 5) + dt.timedelta(weeks=n - 1)


def league_dates(y0: int, fixed: list[dt.date]) -> list[dt.date]:
    """38 league matchdays: Saturdays from the first on/after 6 August, skipping four international-break
    weekends (1st Saturday of September, 2nd of October and November, 4th of March); each fixed derby date
    replaces the matchday nearest to it."""
    breaks = {_nth_saturday(y0, 9, 1), _nth_saturday(y0, 10, 2), _nth_saturday(y0, 11, 2),
              _nth_saturday(y0 + 1, 3, 4)}
    d = _first_weekday_on_or_after(dt.date(y0, 8, 6), 5)
    out: list[dt.date] = []
    while len(out) < GAMES_PER_SEASON:
        if d not in breaks:
            out.append(d)
        d += dt.timedelta(weeks=1)
    for f in fixed:
        i = min(range(len(out)), key=lambda k: abs((out[k] - f).days))
        out[i] = f
    if out != sorted(set(out)):
        raise ValueError(f"league calendar {y0} not strictly increasing")
    return out


def _round_robin(rng: random.Random, clubs: list[str]) -> list[list[tuple[str, str]]]:
    """Single round robin by the circle method: (home, away) pairs per round. Venues alternate round to
    round for (almost) every club: the pivot's pair alternates by round, other pairs by board parity
    (every non-pivot club moves one board per round)."""
    t = clubs[:]
    rng.shuffle(t)
    n = len(t)
    rounds = []
    for r in range(n - 1):
        pairs = []
        for i in range(n // 2):
            a, b = t[i], t[n - 1 - i]
            first_home = r % 2 == 0 if i == 0 else i % 2 == 0
            pairs.append((a, b) if first_home else (b, a))
        rounds.append(pairs)
        t = [t[0], t[-1], *t[1:-1]]
    return rounds


def league_schedule(rng: random.Random, clubs: list[str], home_id: str, away_id: str, first_idx: int,
                    second_idx: int, first_home: str, second_home: str) -> list[list[tuple[str, str]]]:
    """Double round robin (second half mirrors the first with venues swapped), rounds ordered so the derby
    falls on matchdays ``first_idx`` (hosted by ``first_home``) and ``second_idx`` (hosted by
    ``second_home``).

    The recorded 2025/26 derbies were BOTH at Weir Lane. When the recorded second derby venue contradicts
    the mirror, that derby is reversed and one other pair of fixtures against a third club X is reversed too
    (X v lost -> lost v X, gained v X -> X v gained), so every club still hosts exactly 19 league games."""
    first = _round_robin(rng, clubs)
    rd = next(i for i, rnd in enumerate(first) if any({h, a} == {home_id, away_id} for h, a in rnd))
    if next(h for h, a in first[rd] if {h, a} == {home_id, away_id}) != first_home:
        first = [[(a, h) for h, a in rnd] for rnd in first]
    second = [[(a, h) for h, a in rnd] for rnd in first]
    k = len(first)
    # rotate (not shuffle) each half so the round-to-round venue alternation survives
    o1 = [(rd - first_idx + j) % k for j in range(k)]
    o2 = [(rd - (second_idx - k) + j) % k for j in range(k)]
    out = [first[i] for i in o1] + [list(second[i]) for i in o2]
    if second_home == first_home:
        gained = second_home
        lost = home_id if gained == away_id else away_id
        out[second_idx] = [(gained, lost) if {h, a} == {home_id, away_id} else (h, a) for h, a in out[second_idx]]
        second_half = range(k, 2 * k)
        hosts_lost = {h: md for md in second_half for h, a in out[md] if a == lost and h != gained}
        hosted_by_gained = {a: md for md in second_half for h, a in out[md] if h == gained and a != lost}
        x = sorted(set(hosts_lost) & set(hosted_by_gained))[0]
        md1, md2 = hosts_lost[x], hosted_by_gained[x]
        out[md1] = [(lost, x) if (h, a) == (x, lost) else (h, a) for h, a in out[md1]]
        out[md2] = [(x, gained) if (h, a) == (gained, x) else (h, a) for h, a in out[md2]]
    return out


def league_members(season: str, home_id: str, away_id: str) -> list[str]:
    out = [home_id, away_id]
    for club in OTHER_CLUBS:
        promo = PROMOTED.get(club)
        before_promotion = promo is not None and season in SEASONS and SEASONS.index(season) < SEASONS.index(promo[0])
        out.append(promo[1] if promo is not None and before_promotion else club)
    return out


def _assign_outcomes(rng: random.Random, allowed: list[str], counts: dict[str, int]) -> list[str] | None:
    """Place exactly counts[W/D/L] results into slots, each slot limited to its allowed results."""
    res = [a if len(a) == 1 else "" for a in allowed]
    need = dict(counts)
    for r in res:
        if r:
            need[r] -= 1
    if any(v < 0 for v in need.values()):
        return None
    free = [i for i, r in enumerate(res) if not r]
    rng.shuffle(free)
    for o in ("L", "W"):
        picks = [i for i in free if o in allowed[i]][:need[o]]
        if len(picks) < need[o]:
            return None
        for i in picks:
            res[i] = o
        free = [i for i in free if not res[i]]
    if any("D" not in allowed[i] for i in free) or len(free) != need["D"]:
        return None
    for i in free:
        res[i] = "D"
    return res


def _fill_scores(rng: random.Random, outcomes: list[str], gf: int, ga: int) -> list[tuple[int, int]]:
    """Scorelines for the given results whose goals sum EXACTLY to gf / ga (each result stays valid)."""
    s = [[1, 0] if o == "W" else [0, 1] if o == "L" else [0, 0] for o in outcomes]
    rf, ra = gf - sum(x[0] for x in s), ga - sum(x[1] for x in s)
    if rf < 0 or ra < 0:
        raise ValueError(f"goal totals {gf}-{ga} cannot fit results {outcomes}")
    draws = [i for i, o in enumerate(outcomes) if o == "D"]
    pairs = min(rf, ra, int(len(draws) * rng.uniform(0.5, 1.1)))
    for _ in range(pairs):
        i = rng.choice(draws)
        if s[i][0] < 3:
            s[i][0] += 1
            s[i][1] += 1
            rf, ra = rf - 1, ra - 1
    for cap in (4, 6, 99):
        guard = 0
        while (rf or ra) and guard < 5000:
            guard += 1
            if rf and (not ra or rng.random() < rf / (rf + ra)):
                opts = [i for i, o in enumerate(outcomes) if (o == "W" and s[i][0] < cap)
                        or (o == "L" and s[i][0] + 1 < s[i][1])]
                if opts:
                    s[rng.choice(opts)][0] += 1
                    rf -= 1
                    continue
            if ra:
                opts = [i for i, o in enumerate(outcomes) if (o == "L" and s[i][1] < cap)
                        or (o == "W" and s[i][1] + 1 < s[i][0])]
                if opts:
                    s[rng.choice(opts)][1] += 1
                    ra -= 1
                    continue
            if rf and not ra:
                continue
        if not (rf or ra):
            break
    if rf or ra:
        raise ValueError("could not place goals")
    return [(a, b) for a, b in s]


def _current_scores(rng: random.Random, outcomes: list[str], min_goals_for: int) -> list[tuple[int, int]]:
    """Current-season scorelines (no published totals yet): natural scores, then extra goals in wins until the
    club has scored at least as many as its squad's recorded league goals this season (+ own goals/others)."""
    s: list[list[int]] = []
    for o in outcomes:
        g = rng.choice([0, 1, 1, 2, 2])
        s.append([g + rng.choice([1, 1, 2]), g] if o == "W" else [g, g + rng.choice([1, 1, 2])] if o == "L"
                 else [g, g])
    wins = [i for i, o in enumerate(outcomes) if o == "W"]
    while sum(x[0] for x in s) < min_goals_for:
        i = rng.choice(wins) if wins else rng.randrange(len(s))
        s[i][0] += 1
        if outcomes[i] != "W":
            s[i][1] += 1  # keep a draw a draw / a defeat a defeat
    return [(a, b) for a, b in s]


def _cup_dates(y0: int, league: list[dt.date], derby: tuple[int, dt.date] | None) -> list[dt.date]:
    """National Cup round dates (midweek; the final the Saturday after the league ends)."""
    r3 = _first_weekday_on_or_after(dt.date(y0 + 1, 1, 7), 2)
    base = [r3, r3 + dt.timedelta(days=21), r3 + dt.timedelta(days=42), r3 + dt.timedelta(days=63),
            r3 + dt.timedelta(days=98), league[-1] + dt.timedelta(days=7)]
    for i in range(len(base) - 1):  # keep clear of the league calendar (derby matchdays can be midweek)
        while any(abs((base[i] - d).days) <= 1 for d in league):
            base[i] -= dt.timedelta(days=7)
    if derby is not None:
        k, d = derby
        base[k] = d
        for i in range(k - 1, -1, -1):
            base[i] = min(base[i], base[i + 1] - dt.timedelta(days=7))
        for i in range(k + 1, len(base)):
            base[i] = max(base[i], base[i - 1] + dt.timedelta(days=7))
    if base != sorted(set(base)) or any(abs((c - d).days) <= 1 for c in base[:-1] for d in league
                                        if derby is None or c != derby[1]):
        raise ValueError(f"cup calendar {y0} invalid")
    return base


def _slug(key: str) -> str:
    return "".join(ch for ch in key.upper() if ch.isalnum())[:8]


def _history(world: World, kb: KnowledgeBase) -> History:
    home_id, away_id = world.home.team_id, world.away.team_id
    ours = {home_id: world.home, away_id: world.away}
    today = dt.date.fromisoformat(world.fixture.kickoff_local[:10])

    def name(key: str) -> str:
        return ours[key].name if key in ours else key

    def stadium(key: str) -> str:
        return ours[key].stadium if key in ours else OTHER_STADIUMS.get(key, f"{key} Ground")

    matches: dict[str, list[ClubMatch]] = {home_id: [], away_id: []}
    upcoming: dict[str, list[UpcomingFixture]] = {home_id: [], away_id: []}
    league_timeline: dict[str, list[str]] = {home_id: [], away_id: []}
    current_form = {t: current_season_form(t) for t in (home_id, away_id)}

    def club_match(key: str, team: str, date: dt.date, season: str, comp: Competition, stage: str,
                   home: str, away: str, hg: int, ag: int,
                   scorers: tuple[tuple[str, str, int], ...] = ()) -> ClubMatch:
        is_home = team == home
        opp = away if is_home else home
        return ClubMatch(key, team, date.isoformat(), season, comp, stage, "home" if is_home else "away",
                         stadium(home), name(opp), opp if opp in ours else None, hg if is_home else ag,
                         ag if is_home else hg, scorers)

    all_seasons = [*SEASONS, CURRENT_SEASON]
    for si, season in enumerate(all_seasons):
        y0 = season_start_year(season)
        current = season == CURRENT_SEASON
        rng = random.Random(f"{SEED}-history-{season}")
        derbies = [m for m in kb.meetings if m.season == season]
        league_derbies = sorted((m for m in derbies if m.competition == "League"),
                                key=lambda m: _meeting_date(m.date))
        if current:
            first_home, second_home = home_id, away_id  # today's fixture, and the return fixture in April
            fixed = [today, dt.date(y0 + 1, 4, 21)]
        else:
            first_home, second_home = league_derbies[0].home, league_derbies[1].home
            fixed = [_meeting_date(m.date) for m in league_derbies]
        dates = league_dates(y0, fixed)
        idx = [dates.index(f) for f in fixed]
        if current and idx[0] != PLAYED_THIS_SEASON:
            raise ValueError("today's fixture must be the matchday after the games already played")
        clubs = league_members(season, home_id, away_id)
        schedule = league_schedule(rng, clubs, home_id, away_id, idx[0], idx[1], first_home, second_home)
        # each club's league slots
        slots: dict[str, list[tuple[int, str, str]]] = {}
        for t in (home_id, away_id):
            slots[t] = [(md, h, a) for md, rnd in enumerate(schedule) for h, a in rnd if t in (h, a)]
        derby_by_date = {_meeting_date(m.date): m for m in league_derbies}
        results: dict[str, list[tuple[int, int]]] = {}
        for t in (home_id, away_id):
            n_played = PLAYED_THIS_SEASON if current else GAMES_PER_SEASON
            sl = slots[t][:n_played]
            allowed: list[str] = []
            fixed_score: dict[int, tuple[int, int]] = {}
            for i, (md, h, a) in enumerate(sl):
                m = derby_by_date.get(dates[md])
                if m is not None:
                    if (h, a) != (m.home, m.away):
                        raise ValueError(f"schedule venue for the {m.date} derby contradicts the meeting")
                    gf, ga = (m.home_goals, m.away_goals) if m.home == t else (m.away_goals, m.home_goals)
                    fixed_score[i] = (gf, ga)
                    allowed.append("W" if gf > ga else "L" if gf < ga else "D")
                elif current:
                    allowed.append(current_form[t][i])
                else:
                    allowed.append(_authored(t, home_id, away_id, dates[md], h == t, sl, dates, i))
            if current:
                outcomes = list(allowed)
                squad_goals = sum(kb.careers[p.player_id].seasons[-1].goals for p in ours[t].players)
                fill = _current_scores(rng, outcomes, squad_goals + 1 + rng.randint(0, 2))
            else:
                rec = next(r for r in kb.seasons[t] if r.season == season)
                counts = {"W": rec.won, "D": rec.drawn, "L": rec.lost}
                tail: list[str] = list(current_form[t]) if season == SEASONS[-1] else []
                authored_runs = int(si >= SEASONS.index(SLUMP_SEASON)) if t == away_id else None
                outcomes = _pick_outcomes(rng, allowed, counts, league_timeline[t], tail, authored_runs)
                free = [i for i in range(len(sl)) if i not in fixed_score]
                fill_free = _fill_scores(rng, [outcomes[i] for i in free],
                                         rec.goals_for - sum(g for g, _ in fixed_score.values()),
                                         rec.goals_against - sum(g for _, g in fixed_score.values()))
                fill = [(0, 0)] * len(sl)
                for i, sc in fixed_score.items():
                    fill[i] = sc
                for i, sc in zip(free, fill_free, strict=True):
                    fill[i] = sc
            league_timeline[t].extend(outcomes)
            results[t] = fill
        for t in (home_id, away_id):
            n_played = PLAYED_THIS_SEASON if current else GAMES_PER_SEASON
            for i, (md, h, a) in enumerate(slots[t]):
                stage = f"Matchday {md + 1}"
                key = f"{y0}-L{md + 1:02d}-{_slug(h)}-{_slug(a)}"
                if i >= n_played:
                    if dates[md] > today:
                        opp = a if h == t else h
                        upcoming[t].append(UpcomingFixture(t, dates[md].isoformat(), season, LEAGUE, stage,
                                                           "home" if h == t else "away", stadium(h), name(opp),
                                                           opp if opp in ours else None))
                    continue
                gf, ga = results[t][i]
                hg, ag = (gf, ga) if h == t else (ga, gf)
                m = derby_by_date.get(dates[md])
                matches[t].append(club_match(key, t, dates[md], season, LEAGUE, stage, h, a, hg, ag,
                                             m.scorers if m else ()))
        if not current:
            _cup_season(rng, season, y0, dates, clubs, kb, home_id, away_id, club_match, matches)
    for t in matches:
        matches[t].sort(key=lambda m: (m.date, m.match_key))
        upcoming[t].sort(key=lambda u: u.date)
    tenures = {}
    for t, mgr in kb.managers.items():
        appointed = str(mgr["appointed"])
        tenures[t] = ManagerTenure(t, str(mgr["name"]), appointed, f"{season_start_year(appointed)}-07-01",
                                   str(mgr["previous"]))
    return History(today.isoformat(), matches, upcoming, tenures)


def _authored(t: str, home_id: str, away_id: str, date: dt.date, at_home: bool,
              sl: list[tuple[int, str, str]], dates: list[dt.date], i: int) -> str:
    """Allowed results for one non-derby league slot under AUTHORED_CONSTRAINTS."""
    if t == home_id and at_home:
        if date >= FORTRESS_FROM:
            return "WD"
        home_dates = [dates[md] for md, h, _a in sl if h == t and dates[md] < FORTRESS_FROM]
        if home_dates and date == max(home_dates) and dates[0] < FORTRESS_FROM <= dates[-1]:
            return "L"
    if t == away_id:
        in_month = [k for k, (md, _h, _a) in enumerate(sl)
                    if (dates[md].year, dates[md].month) == SLUMP_MONTH]
        if in_month:
            last = in_month[-1]
            if last - SLUMP_LENGTH < i <= last:
                return "L"
            if i in (last - SLUMP_LENGTH, last + 1):
                return "WD"
    return "WDL"


SLUMP_SEASON = f"{SLUMP_MONTH[0] - 1}/{str(SLUMP_MONTH[0])[2:]}"


def losing_runs_ok(seq: list[str], authored_runs: int) -> bool:
    """No losing run longer than SLUMP_LENGTH, and exactly `authored_runs` runs that reach it."""
    run = best = reached = 0
    for o in seq:
        run = run + 1 if o == "L" else 0
        reached += run == SLUMP_LENGTH
        best = max(best, run)
    return best <= SLUMP_LENGTH and reached == authored_runs


def _pick_outcomes(rng: random.Random, allowed: list[str], counts: dict[str, int], before: list[str],
                   after: list[str], authored_runs: int | None) -> list[str]:
    for _ in range(5000):
        res = _assign_outcomes(rng, allowed, counts)
        if res is None:
            continue
        if authored_runs is not None and not losing_runs_ok(before + res + after, authored_runs):
            continue
        return res
    raise ValueError("no outcome assignment satisfies the authored constraints")


def _cup_season(rng: random.Random, season: str, y0: int, league: list[dt.date], clubs: list[str],
                kb: KnowledgeBase, home_id: str, away_id: str, club_match: Callable[..., ClubMatch],
                matches: dict[str, list[ClubMatch]]) -> None:
    cup_derby = next((m for m in kb.meetings if m.season == season and m.competition != "League"), None)
    reached = {t: cup_round_reached(next(r for r in kb.seasons[t] if r.season == season).cup)
               for t in (home_id, away_id)}
    won = {t: next(r for r in kb.seasons[t] if r.season == season).cup == "Winners" for t in (home_id, away_id)}
    derby_round = None
    if cup_derby is not None:
        loser = cup_derby.away if cup_derby.home_goals > cup_derby.away_goals else cup_derby.home
        derby_round = reached[loser]
    if min(reached.values()) == len(CUP_ROUNDS) - 1 and derby_round is None:
        raise ValueError("both clubs cannot reach the final without meeting")
    dates = _cup_dates(y0, league, (derby_round, _meeting_date(cup_derby.date))
                       if cup_derby is not None and derby_round is not None else None)
    lower = [c for c in LOWER_LEAGUE if c not in clubs]
    top = [c for c in clubs if c not in (home_id, away_id)]
    used: dict[str, set[str]] = {home_id: set(), away_id: set()}
    for k, stage in enumerate(CUP_ROUNDS):
        taken: set[str] = set()
        for t in (home_id, away_id):
            if k > reached[t]:
                continue
            if cup_derby is not None and k == derby_round:
                m = cup_derby
                matches[t].append(club_match(f"{y0}-C{k + 3}-{_slug(m.home)}-{_slug(m.away)}", t, dates[k],
                                             season, CUP, stage, m.home, m.away, m.home_goals, m.away_goals,
                                             m.scorers))
                continue
            pool = [c for c in (lower + top if k == 0 else top) if c not in used[t] and c not in taken]
            opp = rng.choice(pool)
            used[t].add(opp)
            taken.add(opp)
            win = k < reached[t] or won[t]
            g = rng.choice([1, 1, 2, 2, 2, 3, 4])
            o = rng.choice([x for x in range(g) if x <= 2])
            gf, ga = (g, o) if win else (o, g)
            at_home = stage != "Final" and rng.random() < 0.5
            h, a = (t, opp) if at_home else (opp, t)
            hg, ag = (gf, ga) if at_home else (ga, gf)
            matches[t].append(club_match(f"{y0}-C{k + 3}-{_slug(h)}-{_slug(a)}", t, dates[k], season, CUP,
                                         stage, h, a, hg, ag))
