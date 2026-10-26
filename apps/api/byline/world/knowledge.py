"""Structured FICTIONAL football history for BYLINE's synthetic world.

Everything here is invented and deterministic (fixed seed). Facts shown to users are DERIVED from
these structures (facts.py), never typed as free text, so totals, dates, head-to-heads and
milestones stay internally consistent and can be tested.

The competition, clubs, players, referees and history are fictional.
"""

from __future__ import annotations

import random
from dataclasses import dataclass, field, replace

from byline.world.models import Player, World

SEED = 1889
CURRENT_SEASON = "2026/27"
SEASONS = [f"{y}/{str(y + 1)[2:]}" for y in range(2016, 2026)]  # ten completed seasons
GAMES_PER_SEASON = 38
PLAYED_THIS_SEASON = 9  # league games before today's fixture
BOOKINGS_FOR_BAN = 5
LEAGUE_RULES = (
    "BYLINE Synthetic League (fictional) disciplinary rule: five cautions in league matches bring a one-match "
    "ban; a sending-off brings a one-match ban, and the two cautions of a second-yellow dismissal do not count "
    "towards the five-booking total."
)
OTHER_CLUBS = [
    "Harlow Vale", "Port Selwyn Rovers", "Kilbride Moor Town", "Ashcombe United", "Calder Rise", "Fenwick Cross "
    "Albion", "Larkhill Wanderers", "St. Avery", "Easter Lunn", "Dunmore Quay", "Thornbury Forge", "Merrow Bay",
    "Oldcastle Athletic", "Wexley Park", "Brannock Town", "Silverdale Rangers", "Coldharbour", "Quarry End",
]
LOWER_LEAGUE = ["Brackenfield", "Hollins Mill", "Saltmarsh Town", "Greyhope", "Ludworth Villa", "Penfold Rovers"]


@dataclass(frozen=True)
class SeasonRecord:
    season: str
    position: int
    won: int
    drawn: int
    lost: int
    goals_for: int
    goals_against: int
    top_scorer: str
    cup: str  # e.g. "Winners", "Final", "Semi-final", "Round 4"

    @property
    def points(self) -> int:
        return 3 * self.won + self.drawn


@dataclass(frozen=True)
class Meeting:
    date: str
    season: str
    competition: str
    home: str
    away: str
    home_goals: int
    away_goals: int
    scorers: tuple[tuple[str, str, int], ...]  # (team_id, player name, minute)
    sent_off: tuple[str, ...]
    referee: str
    attendance: int


@dataclass
class PlayerSeason:
    season: str
    club: str
    apps: int
    goals: int
    assists: int
    yellows: int
    reds: int
    clean_sheets: int = 0


@dataclass
class Career:
    player_id: str
    age: int
    hometown: str
    academy: bool
    joined_season: str
    fee_note: str
    seasons: list[PlayerSeason] = field(default_factory=list)
    injuries: list[str] = field(default_factory=list)
    derby_goals: int = 0

    def at(self, club: str) -> list[PlayerSeason]:
        return [s for s in self.seasons if s.club == club]


@dataclass(frozen=True)
class Connection:
    kind: str
    player_ids: tuple[str, ...]
    text: str


@dataclass(frozen=True)
class RefereeRecord:
    name: str
    games_this_season: int
    yellows_this_season: int
    reds_this_season: int
    penalties_this_season: int
    career_games: int


@dataclass
class KnowledgeBase:
    seasons: dict[str, list[SeasonRecord]]
    meetings: list[Meeting]
    careers: dict[str, Career]
    connections: list[Connection]
    referee: RefereeRecord
    managers: dict[str, dict[str, str | int]]
    stadium: dict[str, str | int]
    all_time: dict[str, int]


def _season_records(rng: random.Random, strength: float, top_scorer: dict[str, str],
                    cup_wins: set[str]) -> list[SeasonRecord]:
    out = []
    for s in SEASONS:
        w = max(5, min(28, int(rng.gauss(16 + strength * 6, 3))))
        d = max(4, min(38 - w - 2, int(rng.gauss(10, 2))))
        lo = GAMES_PER_SEASON - w - d
        gf = max(25, int(w * 1.9 + d * 0.9 + rng.gauss(4, 5)))
        ga = max(18, int(lo * 1.8 + d * 0.9 + rng.gauss(4, 5)))
        pts = 3 * w + d
        pos = max(1, min(20, int(round(21 - (pts - 28) / 3.1 + rng.gauss(0, 0.8)))))
        cup = "Winners" if s in cup_wins else rng.choice(["Round 3", "Round 4", "Round 5", "Quarter-final",
                                                          "Semi-final"])
        out.append(SeasonRecord(s, pos, w, d, lo, gf, ga, top_scorer[s], cup))
    return out


_CACHE: dict[str, KnowledgeBase] = {}


def build(world: World) -> KnowledgeBase:
    """Deterministic; cached per match id (the world is fixed per synthetic match)."""
    key = world.fixture.match_id
    if key not in _CACHE:
        _CACHE[key] = _build(world)
    return _CACHE[key]


def _build(world: World) -> KnowledgeBase:
    rng = random.Random(SEED)
    home, away = world.home, world.away
    careers: dict[str, Career] = {}
    towns = ["Ashcombe", "Kilbride Moor", "Port Selwyn", "Thornbury", "Easter Lunn", "Dunmore Quay", "Calder Rise",
             "Fenwick Cross", "Larkhill", "St. Avery", "Merrow Bay", "Northbridge", "Riverton"]
    rate = {"ST": 0.42, "LW": 0.24, "RW": 0.24, "AM": 0.2, "CM": 0.09, "DM": 0.05, "CB": 0.04, "RB": 0.03,
            "LB": 0.03, "GK": 0.0}
    yrate = {"DM": 0.24, "CB": 0.2, "CM": 0.16, "RB": 0.15, "LB": 0.15, "AM": 0.1, "RW": 0.08, "LW": 0.08,
             "ST": 0.09, "GK": 0.03}
    for team in world.teams:
        for p in team.players:
            r = random.Random(f"{SEED}-{p.player_id}")
            age = r.randint(19, 34)
            debut_age = r.randint(17, 21)
            first_season_idx = max(0, len(SEASONS) - (age - debut_age))
            academy = r.random() < 0.35 or first_season_idx >= len(SEASONS)  # debut season: academy graduate
            # seasons at the current club: joined somewhere in the window (or this season)
            join_idx = (first_season_idx if academy
                        else r.randint(first_season_idx, len(SEASONS) - 1))
            car = Career(p.player_id, age, r.choice(towns), academy, SEASONS[join_idx] if join_idx < len(SEASONS)
                         else CURRENT_SEASON, "")
            prev_clubs = [] if academy else r.sample(OTHER_CLUBS + LOWER_LEAGUE, k=r.randint(1, 2))
            starter = p.player_id in {s for s in _starting_ids(world)}
            for i in range(first_season_idx, len(SEASONS)):
                club_name = team.name if i >= join_idx else prev_clubs[min(len(prev_clubs) - 1, (join_idx - i) // 3)]
                apps = r.randint(18, 36) if (starter or i < join_idx) else r.randint(4, 24)
                if i == first_season_idx:
                    apps = r.randint(3, 14)
                if r.random() < 0.12:  # an injury-hit season
                    weeks = r.randint(8, 30)
                    apps = max(2, apps - weeks // 2)
                    car.injuries.append(f"{weeks} weeks out with a {r.choice(['hamstring', 'knee ligament', 'ankle', 'groin', 'calf'])} injury in {SEASONS[i]}")
                goals = int(round(apps * rate[p.position] * r.uniform(0.5, 1.4)))
                assists = int(round(apps * (0.12 if p.position in ('RW', 'LW', 'AM') else 0.05) * r.uniform(0.4, 1.4)))
                yellows = int(round(apps * yrate[p.position] * r.uniform(0.6, 1.4)))
                reds = 1 if r.random() < 0.04 + (0.05 if p.position in ("DM", "CB") else 0) else 0
                cs = int(apps * r.uniform(0.22, 0.4)) if p.position == "GK" else 0
                car.seasons.append(PlayerSeason(SEASONS[i], club_name, apps, goals, assists, yellows, reds, cs))
            # current season to date (before today's match)
            apps_now = r.randint(6, PLAYED_THIS_SEASON) if starter else r.randint(0, 5)
            car.seasons.append(PlayerSeason(
                CURRENT_SEASON, team.name, apps_now,
                int(round(apps_now * rate[p.position] * r.uniform(0.4, 1.6))),
                int(round(apps_now * 0.06 * r.uniform(0.3, 1.5))),
                min(BOOKINGS_FOR_BAN - 1, int(round(apps_now * yrate[p.position] * r.uniform(0.4, 1.6)))), 0,
                int(apps_now * r.uniform(0.2, 0.4)) if p.position == "GK" else 0))
            before = [s.club for s in car.seasons if s.club != team.name]
            car.fee_note = ("came through the club academy" if academy else
                            f"joined from {before[-1]} in {car.joined_season}" if before else
                            f"signed from {prev_clubs[0]}'s youth set-up in {car.joined_season}")
            careers[p.player_id] = car
    _authored_storylines(world, careers)
    meetings = _meetings(world, careers, rng)  # per-leg seeded RNGs: independent of the season records below
    _reconcile_derby_goals(world, careers, meetings)
    nba_seasons = _season_records(random.Random(f"{SEED}-NBA"), 0.6, _top_scorers(world, careers, home.name,
                                  ["Elliot Brammer", "Joaquim Sallow"]), {"2018/19"})
    rvc_seasons = _season_records(random.Random(f"{SEED}-RVC"), 0.35, _top_scorers(world, careers, away.name,
                                  ["Tomas Wirral", "Kwame Ashdown"]), set())
    nba_seasons, rvc_seasons = _reconcile_cup_runs(meetings, {home.team_id: nba_seasons,
                                                              away.team_id: rvc_seasons})
    for m in meetings:
        for _team, name, _minute in m.scorers:
            pid = _pid_by_name(world, name)
            if pid:
                careers[pid].derby_goals += 1
    connections = _connections(world, careers)
    ref = RefereeRecord("Imogen Castell", games_this_season=7, yellows_this_season=26, reds_this_season=1,
                        penalties_this_season=2, career_games=212)
    managers: dict[str, dict[str, str | int]] = {
        home.team_id: {"name": home.manager.name, "appointed": "2023/24",
                       "previous": "Ashcombe United (2019-2023), promoted twice"},
        away.team_id: {"name": away.manager.name, "appointed": "2021/22",
                       "previous": "Harlow Vale (2016-2021)"},
    }
    stadium: dict[str, str | int] = {"name": home.stadium, "capacity": 31450, "record_attendance": 38912,
               "record_match": "Northbridge v Riverton in 1964, before the stands were rebuilt as all-seater"}
    all_time = {"meetings": 214, "NBA": 88, "RVC": 71, "draws": 55}
    return KnowledgeBase({home.team_id: nba_seasons, away.team_id: rvc_seasons}, meetings, careers, connections,
                         ref, managers, stadium, all_time)


CUP_ROUNDS = ("Round 3", "Round 4", "Round 5", "Quarter-final", "Semi-final", "Final")


def cup_round_reached(cup: str) -> int:
    """Index into CUP_ROUNDS of the last round played ("Winners" played, and won, the final)."""
    return len(CUP_ROUNDS) - 1 if cup == "Winners" else CUP_ROUNDS.index(cup)


def _reconcile_cup_runs(meetings: list[Meeting], seasons: dict[str, list[SeasonRecord]]
                        ) -> tuple[list[SeasonRecord], list[SeasonRecord]]:
    """A derby cup tie is a round of BOTH clubs' cup runs: the loser went out in the round recorded as its
    cup exit, so the winner must have reached at least the next round. Where the independently seeded cup
    field says otherwise it is moved forward to that next round (league W/D/L and goals are untouched)."""
    out = {t: list(recs) for t, recs in seasons.items()}
    for m in meetings:
        if m.competition == "League" or m.home_goals == m.away_goals:
            continue
        winner, loser = (m.home, m.away) if m.home_goals > m.away_goals else (m.away, m.home)
        lrec = next(r for r in out[loser] if r.season == m.season)
        tie_round = cup_round_reached(lrec.cup)
        idx, wrec = next((i, r) for i, r in enumerate(out[winner]) if r.season == m.season)
        if cup_round_reached(wrec.cup) <= tie_round:
            nxt = tie_round + 1
            out[winner][idx] = replace(wrec, cup="Winners" if nxt >= len(CUP_ROUNDS) else CUP_ROUNDS[nxt])
    ids = list(seasons)
    return out[ids[0]], out[ids[1]]


def _reconcile_derby_goals(world: World, careers: dict[str, Career], meetings: list[Meeting]) -> None:
    """A season's league goals include its league derby goals: where the independently seeded season total is
    lower than the goals itemised in that season's LEAGUE derbies, it is raised to that count (cup derby goals
    are not league goals; apps are untouched)."""
    for pid, car in careers.items():
        name = _name(world.player(pid))
        for s in car.seasons:
            itemised = sum(1 for m in meetings if m.season == s.season and m.competition == "League"
                           for _t, n, _mi in m.scorers if n == name)
            s.goals = max(s.goals, itemised)


def _top_scorers(world: World, careers: dict[str, Career], club: str, former: list[str]) -> dict[str, str]:
    """Each season's top scorer is the current-squad player with most goals AT THIS CLUB that season, unless a
    (named, fictional) former player is recorded with more."""
    out = {}
    for i, s in enumerate(SEASONS):
        best = max(((ps.goals, pid) for pid, car in careers.items() for ps in car.seasons
                    if ps.season == s and ps.club == club), default=(0, ""))
        if best[0] >= 8 and best[1]:
            out[s] = f"{_name(world.player(best[1]))} ({best[0]})"
        else:
            out[s] = f"{former[i % len(former)]} ({max(9, best[0] + 2)})"
    return out


def _name(p: Player) -> str:
    return f"{p.given_name} {p.family_name}"


def _pid_by_name(world: World, name: str) -> str | None:
    for t in world.teams:
        for p in t.players:
            if _name(p) == name:
                return p.player_id
    return None


def _season_index(season: str) -> int:
    return SEASONS.index(season) if season in SEASONS else len(SEASONS)


def _starting_ids(world: World) -> set[str]:
    from byline.world.seed_world import starting_slots

    return {pid for t in world.teams for pid in starting_slots(t.team_id).values()}


def _authored_storylines(world: World, careers: dict[str, Career]) -> None:
    """A few deliberate, consistent storylines layered onto the generated careers."""
    # Vantreight: today is his 100th appearance for Northbridge (make club totals land on 99 before today)
    c = careers["NBA-09"]
    home = world.home.name
    # extend his Northbridge spell backwards until his club appearances before today can total 99
    while sum(min(38, max(s.apps, 30)) for s in c.seasons if s.club == home) < 99:
        earlier = [s for s in c.seasons if s.club != home]
        if not earlier:
            break
        earlier[-1].club = home
    c.joined_season = next(s.season for s in c.seasons if s.club == home)
    prev = [s.club for s in c.seasons if s.club != home]
    c.fee_note = f"joined from {prev[-1]} in {c.joined_season}" if prev else "came through the club academy"
    club = [s for s in c.seasons if s.club == home]
    diff = 99 - sum(s.apps for s in club)
    for s in reversed(club[:-1]):  # spread over completed seasons, max 38 each
        step = max(1 - s.apps, min(38 - s.apps, diff))
        s.apps += step
        diff -= step
        if diff == 0:
            break
    # Ndiaye-Shaw: four bookings this season (one away from a ban) and a disciplinary record
    six = careers["RVC-06"]
    six.seasons[-1].yellows = BOOKINGS_FOR_BAN - 1
    six.seasons[-1].apps = max(six.seasons[-1].apps, 8)
    # Lindqvist played for Riverton before crossing the river
    lq = careers["NBA-04"]
    lq.academy = False
    for s in lq.seasons:
        if s.club != world.home.name:
            s.club = world.away.name
    lq.fee_note = f"joined from {world.away.name} in {lq.joined_season}"
    # Rostami came through Northbridge's academy before moving to Riverton
    ro = careers["RVC-10"]
    ro.fee_note = f"joined from {world.home.name} in {ro.joined_season} after coming through their academy"


def _meetings(world: World, careers: dict[str, Career], rng: random.Random) -> list[Meeting]:
    """Two league derbies per completed season (plus one cup tie), scorers drawn from players at the
    clubs that season (current squad where their careers allow, otherwise named former players)."""
    former = {"NBA": ["Elliot Brammer", "Joaquim Sallow", "Dev Okonkwo-Hart", "Rhys Pennant"],
              "RVC": ["Tomas Wirral", "Kwame Ashdown", "Lars Fennick", "Owain Pryde"]}
    refs = ["Imogen Castell", "Martin Selby-Oakes", "Ruth Adair", "Colm Ferriday"]
    out: list[Meeting] = []
    month = {0: "October", 1: "April"}
    for si, season in enumerate(SEASONS):
        y0 = 2016 + si
        legs = [(0, "NBA", "RVC"), (1, "RVC", "NBA")] if si % 2 == 0 else [(0, "RVC", "NBA"), (1, "NBA", "RVC")]
        if season in ("2018/19", "2022/23"):
            legs.append((2, "NBA", "RVC"))
        for leg, h, a in legs:
            r = random.Random(f"{SEED}-derby-{season}-{leg}")
            hg, ag = r.choice([0, 1, 1, 2, 2, 3]), r.choice([0, 0, 1, 1, 2, 2])
            scorers = []
            for team, goals in ((h, hg), (a, ag)):
                pool = [p for t in world.teams if t.team_id == team for p in t.players
                        if p.position in ("ST", "RW", "LW", "AM", "CM")
                        and _season_index(careers[p.player_id].joined_season) <= si]
                for _ in range(goals):
                    name = _name(r.choice(pool)) if pool and r.random() < 0.7 else r.choice(former[team])
                    scorers.append((team, name, r.randint(2, 90)))
            sent_off = tuple([r.choice(former[a])] if r.random() < 0.15 else [])
            comp = "National Cup" if leg == 2 else "League"
            date = f"{'14 February' if leg == 2 else ('21 ' + month[leg])} {y0 if leg == 0 else y0 + 1}"
            out.append(Meeting(date, season, comp, h, a, hg, ag, tuple(sorted(scorers, key=lambda s: s[2])),
                               sent_off, r.choice(refs), r.randint(24000, 31450)))
    # the most recent meeting (April 2026) ended 2-2 at Riverton, as published in team news
    last = out[-1]
    if (last.home, last.home_goals, last.away_goals) != ("RVC", 2, 2):
        out[-1] = Meeting("18 April 2026", "2025/26", "League", "RVC", "NBA", 2, 2,
                          (("NBA", _name(world.player("NBA-09")), 34), ("RVC", _name(world.player("RVC-09")), 51),
                           ("RVC", "Kwame Ashdown", 77), ("NBA", _name(world.player("NBA-07")), 88)),
                          (), "Imogen Castell", 29874)
    return out


def _connections(world: World, careers: dict[str, Career]) -> list[Connection]:
    out = [
        Connection("crossed_the_river", ("NBA-04",),
                   f"{_name(world.player('NBA-04'))} played for {world.away.name} before joining {world.home.name}."),
        Connection("academy_rival", ("RVC-10",),
                   f"{_name(world.player('RVC-10'))} came through {world.home.name}'s academy before moving to "
                   f"{world.away.name}."),
    ]
    # former team-mates at the same previous club in the same season, on opposite sides today
    by_club_season: dict[tuple[str, str], list[str]] = {}
    for pid, car in careers.items():
        for s in car.seasons:
            if s.club not in (world.home.name, world.away.name):
                by_club_season.setdefault((s.club, s.season), []).append(pid)
    seen: set[frozenset[str]] = set()
    for (club, season), pids in sorted(by_club_season.items()):
        teams = {world.player(p).team_id for p in pids}
        if len(teams) < 2:
            continue
        a = next(p for p in pids if world.player(p).team_id == world.home.team_id)
        b = next(p for p in pids if world.player(p).team_id == world.away.team_id)
        key = frozenset((a, b))
        if key in seen:
            continue
        seen.add(key)
        out.append(Connection("former_teammates", (a, b),
                              f"{_name(world.player(a))} and {_name(world.player(b))} were team-mates at {club} "
                              f"in {season}; they face each other today."))
    # same hometown across the divide
    town: dict[str, list[str]] = {}
    for pid, car in careers.items():
        town.setdefault(car.hometown, []).append(pid)
    for t, pids in sorted(town.items()):
        sides = {world.player(p).team_id for p in pids}
        if len(sides) == 2:
            a = next(p for p in pids if world.player(p).team_id == world.home.team_id)
            b = next(p for p in pids if world.player(p).team_id == world.away.team_id)
            out.append(Connection("same_hometown", (a, b),
                                  f"{_name(world.player(a))} and {_name(world.player(b))} both grew up in {t}."))
    return out
