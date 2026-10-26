"""Commentator research dossiers and ranked talking points (V4), DERIVED from BYLINE's synthetic data only.

Sources, and nothing else:

- the fictional knowledge base (knowledge.py: careers, season tables, derby meetings, referee, stadium),
- the fictional fixture history behind the ``HistoryProvider`` boundary (history.py) and the pure record
  functions over it (records.py),
- the history-derived context facts (context.py) and research facts (facts.py),
- the synthetic match event log up to ``upto_seq`` and the reducer state built from it.

Every function is a pure function of (world, events released so far, history). Events after the last one
passed in can never change a result (no look-ahead). Each block carries a ``scope`` label (league only vs
league + cup, record window, before today vs this match) and everything is fictional.
"""

from __future__ import annotations

import re
from collections.abc import Sequence
from dataclasses import asdict
from typing import Any, Literal

from byline.events.models import MatchEvent
from byline.match_state.reducer import MatchState, replay
from byline.world.context import ContextFact, fit, fmt_month, ordinal
from byline.world.facts import (
    POSITION_WORD,
    Fact,
    contextualise,
    match_facts,
    ranked,
    seeded_facts,
)
from byline.world.history import ClubMatch, HistoryProvider, UpcomingFixture, synthetic_history
from byline.world.knowledge import (
    BOOKINGS_FOR_BAN,
    CURRENT_SEASON,
    GAMES_PER_SEASON,
    LEAGUE_RULES,
    PLAYED_THIS_SEASON,
    SEASONS,
    Career,
    KnowledgeBase,
    Meeting,
    PlayerSeason,
    build,
)
from byline.world.models import Player, World
from byline.world.records import (
    APPEARANCE_MARKS,
    DERBY_GOAL_MARKS,
    GOAL_MARKS,
    Scope,
    StreakKind,
    Where,
    biggest,
    current_streak,
    days_between,
    describe,
    last_with,
    longest_run,
    previous_run_at_least,
    record,
    select,
)

NOTICE = ("Fictional clubs, players, officials and history for a synthetic demo. Every figure is computed from "
          "BYLINE's seeded data and the synthetic match events released so far.")
RECORD_WINDOW = f"{SEASONS[0]} to {SEASONS[-1]}"
SCOPE_CAREER = "league appearances only (the fictional record has no cup appearances per player)"
SCOPE_SEASON = f"league, {CURRENT_SEASON}, before today"
SCOPE_DERBY = f"derbies in league + cup, record window {RECORD_WINDOW}"
SCOPE_MATCH = "this match, synthetic events released so far"
APPEARANCE_REACH = 5  # an appearance mark is "within reach" when at most this many away
GOAL_REACH = 3
DERBY_REACH = 2
CLEAN_SHEET_MARKS = (25, 50, 75, 100, 150)
INVOLVEMENT_WINDOW_MS = 180_000  # "involved recently" = the last three match minutes before upto_seq
MIN_PLAYER_RELEVANCE = 0.7  # only a strong research fact (milestone, derby, discipline, connection) earns a point
FRESH_MS = 600_000  # triggered facts and storylines lose their recency boost over ten match minutes
ON_BALL = ("pass.completed", "pass.failed", "carry", "shot", "interception", "ball_recovery", "tackle",
           "restart.taken", "save", "penalty.taken", "kickoff")

TPKind = Literal["player", "team", "h2h", "record", "streak", "milestone", "discipline", "manager", "stadium",
                 "tactical", "storyline"]
TPSource = Literal["fictional history", "this match", "tracking"]
CONTEXT_KIND: dict[str, TPKind] = {
    "milestone": "milestone", "goal": "player", "streak": "streak", "record": "record", "head_to_head": "h2h",
    "form": "team", "fixtures": "team", "manager": "manager", "stadium": "stadium", "discipline": "discipline",
}
FACT_KIND: dict[str, TPKind] = {
    "milestone": "milestone", "discipline": "discipline", "derby": "h2h", "manager": "manager",
    "stadium": "stadium", "form": "team", "club": "team", "honours": "record", "referee": "discipline",
}
TRIGGER_WORD = {
    "goal.confirmed": "the goal", "substitution": "the substitution", "card.yellow": "the booking",
    "card.second_yellow": "the sending-off", "card.red": "the sending-off", "match.finished": "full time",
    "disciplinary.reviewed": "the disciplinary review",
}


# ---------------------------------------------------------------- shared helpers


def _name(p: Player) -> str:
    return f"{p.given_name} {p.family_name}"


def _pl(n: int, word: str, plural: str | None = None) -> str:
    return f"{n} {word if n == 1 else (plural or word + 's')}"


def _state(world: World, events: Sequence[MatchEvent], state: MatchState | None) -> MatchState:
    if state is not None:
        return state
    return replay(world, list(events)) if events else MatchState(world)


def _clock(state: MatchState, events: Sequence[MatchEvent]) -> dict[str, Any]:
    return {"upto_seq": events[-1].seq if events else -1, "elapsed_ms": state.elapsed_ms, "period": state.period,
            "minute": state.minute() if state.period not in ("PRE", "HT", "FT") else state.period}


_SEEDED: dict[str, list[Fact]] = {}


def _seeded(world: World) -> list[Fact]:
    """facts.seeded_facts is a pure function of the (fixed) world: computed once per match id."""
    key = world.fixture.match_id
    if key not in _SEEDED:
        _SEEDED[key] = seeded_facts(world)
    return _SEEDED[key]


def _lineup(events: Sequence[MatchEvent], team_id: str) -> MatchEvent | None:
    return next((e for e in events if e.type == "lineup.confirmed" and e.team_id == team_id), None)


def _role_today(events: Sequence[MatchEvent], player: Player) -> str | None:
    """starting_xi / bench / not_in_squad from the team's confirmed line-up; None before it is confirmed."""
    lu = _lineup(events, player.team_id)
    if lu is None:
        return None
    if any(s["player_id"] == player.player_id for s in lu.payload["starters"]):
        return "starting_xi"
    return "bench" if player.player_id in lu.payload["bench"] else "not_in_squad"


def _active_windows(events: Sequence[MatchEvent], now_ms: int) -> list[tuple[int, int]]:
    out: list[tuple[int, int]] = []
    start: int | None = None
    for e in events:
        if e.type == "period.started":
            start = e.elapsed_ms
        elif e.type == "period.ended" and start is not None:
            out.append((start, e.elapsed_ms))
            start = None
    if start is not None:
        out.append((start, now_ms))
    return out


def _cm(m: ClubMatch) -> dict[str, Any]:
    return {"date": m.date, "season": m.season, "competition": m.competition.name, "stage": m.stage,
            "venue": m.venue, "stadium": m.stadium, "opponent": m.opponent, "opponent_id": m.opponent_id,
            "score": m.score, "goals_for": m.goals_for, "goals_against": m.goals_against, "result": m.result,
            "derby": m.is_derby}


def _upcoming(u: UpcomingFixture) -> dict[str, Any]:
    return {"date": u.date, "season": u.season, "competition": u.competition.name, "stage": u.stage,
            "venue": u.venue, "stadium": u.stadium, "opponent": u.opponent, "opponent_id": u.opponent_id}


def _rec(matches: Sequence[ClubMatch]) -> dict[str, Any]:
    r = record(matches)
    return {"played": r.played, "won": r.won, "drawn": r.drawn, "lost": r.lost, "goals_for": r.goals_for,
            "goals_against": r.goals_against,
            "win_pct": round(100 * r.won / r.played, 1) if r.played else None, "line": r.short()}


# ---------------------------------------------------------------- player dossier


def _player_match(world: World, events: Sequence[MatchEvent], state: MatchState, pid: str) -> dict[str, Any]:
    p = world.player(pid)
    tid = p.team_id
    mine = [e for e in events if e.player_id == pid]

    def n(*types: str) -> int:
        return sum(1 for e in mine if e.type in types)

    passes = [e for e in mine if e.type in ("pass.completed", "pass.failed")]
    completed = sum(1 for e in passes if e.type == "pass.completed")
    shots = [e for e in mine if e.type == "shot"]
    by_id = {e.event_id: e for e in events}
    goals = [g for g in state.goals if g.scorer_id == pid and g.team_id == tid]
    confirmed = [g for g in goals if g.status == "confirmed"]
    assists = [g for g in state.goals if g.status == "confirmed" and g.goal_event_id in by_id
               and by_id[g.goal_event_id].payload.get("assist_player_id") == pid]
    sub_on = next((e for e in events if e.type == "substitution" and e.payload["player_on_id"] == pid), None)
    sub_off = next((e for e in events if e.type == "substitution" and e.payload["player_off_id"] == pid), None)
    cards = [c for c in state.cards if c.player_id == pid]
    dismissal = next((c for c in cards if c.status == "active" and c.colour in ("second_yellow", "red")), None)
    role = _role_today(events, p)
    # minutes on the pitch: on-intervals (start / came on -> went off / sent off / now) clipped to live periods
    now = events[-1].elapsed_ms if events else 0
    start: int | None = 0 if role == "starting_xi" else None
    intervals: list[tuple[int, int]] = []
    if sub_on is not None:
        start = sub_on.elapsed_ms
    ends = [x.elapsed_ms for x in (sub_off,) if x is not None]
    if dismissal is not None and dismissal.card_event_id in by_id:
        ends.append(by_id[dismissal.card_event_id].elapsed_ms)
    if start is not None:
        intervals.append((start, min(ends) if ends else now))
    on_ms = sum(max(0, min(b, wb) - max(a, wa)) for a, b in intervals for wa, wb in _active_windows(events, now))
    last = next((e for e in reversed(mine) if e.type in ON_BALL), None)
    return {
        "scope": SCOPE_MATCH,
        "role": role,
        "on_pitch_now": state.on_pitch(pid),
        "minutes_on_pitch": on_ms // 60_000,
        "ms_on_pitch": on_ms,
        "minutes_rule": "event clock while on the pitch during live periods (added time included)",
        "passes": {"completed": completed, "attempted": len(passes),
                   "pct": round(100 * completed / len(passes)) if passes else None},
        "shots": {"total": len(shots),
                  "on_target": sum(1 for e in shots if e.payload["outcome"] in ("goal", "saved")),
                  "off_target": sum(1 for e in shots if e.payload["outcome"] in ("off_target", "woodwork")),
                  "blocked": sum(1 for e in shots if e.payload["outcome"] == "blocked")},
        "goals": len(confirmed),
        "goal_minutes": [g.minute for g in confirmed],
        "goals_disallowed": [g.minute for g in goals if g.status == "disallowed"],
        "goals_awaiting_decision": [g.minute for g in goals if g.status == "provisional"],
        "assists": len(assists),
        "tackles": n("tackle"),
        "interceptions": n("interception"),
        "ball_recoveries": n("ball_recovery"),
        "carries": n("carry"),
        "pressures": n("pressure"),
        "fouls_committed": n("foul.committed"),
        "fouls_won": sum(1 for e in events if e.type == "foul.committed"
                         and e.payload.get("victim_player_id") == pid),
        "offsides": n("offside.offence_confirmed"),
        "saves": n("save"),
        "cards": [{"colour": c.colour, "minute": c.minute, "reason": c.reason, "status": c.status,
                   "event_id": c.card_event_id} for c in cards],
        "substitution": {
            "on": {"minute": sub_on.display_clock, "replaced": sub_on.payload["player_off_id"],
                   "event_id": sub_on.event_id} if sub_on else None,
            "off": {"minute": sub_off.display_clock, "replaced_by": sub_off.payload["player_on_id"],
                    "event_id": sub_off.event_id} if sub_off else None,
        },
        "last_on_ball": {"minute": last.display_clock, "type": last.type, "event_id": last.event_id}
        if last else None,
    }


def _season_row(s: PlayerSeason, gk: bool) -> dict[str, Any]:
    d = asdict(s)
    d["clean_sheets"] = s.clean_sheets if gk else None
    return d


def _totals(rows: Sequence[PlayerSeason], gk: bool) -> dict[str, Any]:
    return {"seasons": len(rows), "apps": sum(s.apps for s in rows), "goals": sum(s.goals for s in rows),
            "assists": sum(s.assists for s in rows), "yellows": sum(s.yellows for s in rows),
            "reds": sum(s.reds for s in rows),
            "clean_sheets": sum(s.clean_sheets for s in rows) if gk else None}


def _derby_goal_list(kb: KnowledgeBase, name: str, team_id: str) -> list[dict[str, Any]]:
    out = []
    for m in kb.meetings:
        for t, n, minute in m.scorers:
            if n == name and t == team_id:
                out.append({"date": m.date, "season": m.season, "competition": m.competition, "minute": minute,
                            "match": f"{m.home} {m.home_goals}-{m.away_goals} {m.away}"})
    return out


def _milestones(*, short: str, gk: bool, appeared: bool, club_apps: int, career_apps: int, multi_club: bool,
                club_goals: int, career_goals: int, goals_today: int, derby_goals: int, derby_today: int,
                club_clean_sheets: int) -> list[dict[str, Any]]:
    """Marks reached today, or within reach (APPEARANCE_REACH / GOAL_REACH / DERBY_REACH). Counts are the
    fictional record before today plus what has happened in this match so far."""
    out: list[dict[str, Any]] = []

    def check(metric: str, scope: str, before: int, today: int, marks: Sequence[int], reach: int,
              reached_text: str, short_text: str, skip_first: bool = False) -> None:
        now = before + today
        for mark in marks:
            if today and before < mark <= now:
                out.append({"metric": metric, "mark": mark, "status": "reached_today", "current": now,
                            "scope": scope, "text": reached_text.format(nth=ordinal(mark), mark=mark)})
            elif 0 < mark - now <= reach and not (skip_first and mark == 1):
                out.append({"metric": metric, "mark": mark, "status": "within_reach", "current": now,
                            "short_by": mark - now, "scope": scope,
                            "text": short_text.format(d=mark - now, mark=mark)})

    a = 1 if appeared else 0
    check("club_appearances", f"league appearances for {short}", club_apps, a, APPEARANCE_MARKS, APPEARANCE_REACH,
          f"Today is his {{nth}} league appearance for {short}.",
          f"{{d}} short of {{mark}} league appearances for {short}.")
    if multi_club:
        check("career_appearances", "league appearances, all clubs", career_apps, a, APPEARANCE_MARKS,
              APPEARANCE_REACH, "Today is his {nth} league appearance in his career.",
              "{d} short of {mark} career league appearances.")
    if not gk:
        check("club_goals", f"league goals for {short}", club_goals, goals_today, GOAL_MARKS, GOAL_REACH,
              f"His {{nth}} league goal for {short} came today.",
              f"{{d}} short of {{mark}} league goals for {short}.")
        if multi_club:
            check("career_goals", "league goals, all clubs", career_goals, goals_today, GOAL_MARKS, GOAL_REACH,
                  "His {nth} career league goal came today.", "{d} short of {mark} career league goals.")
        check("derby_goals", SCOPE_DERBY, derby_goals, derby_today, DERBY_GOAL_MARKS, DERBY_REACH,
              "His {nth} derby goal came today.", "{d} short of {mark} derby goals.", skip_first=True)
    else:
        check("club_clean_sheets", f"league clean sheets for {short}, before today", club_clean_sheets, 0,
              CLEAN_SHEET_MARKS, 2, "", f"{{d}} short of {{mark}} league clean sheets for {short}.")
    return out


def _profile_line(p: Player, car: Career, short: str, club_rows: Sequence[PlayerSeason]) -> str:
    apps = sum(s.apps for s in club_rows)
    tail = (f"{_pl(sum(s.clean_sheets for s in club_rows), 'clean sheet')}" if p.position == "GK"
            else f"{_pl(sum(s.goals for s in club_rows), 'goal')}")
    return (f"{car.age}-year-old {POSITION_WORD[p.position]} from {car.hometown}; {car.fee_note}. "
            f"{_pl(apps, 'league appearance')} and {tail} for {short} before today.")


def player_dossier(world: World, events: Sequence[MatchEvent], player_id: str,
                   state: MatchState | None = None) -> dict[str, Any]:
    """Raises KeyError for a player who is not in either squad."""
    p = world.player(player_id)
    st = _state(world, events, state)
    team = world.team(p.team_id)
    kb = build(world)
    car = kb.careers[player_id]
    gk = p.position == "GK"
    club_rows = car.at(team.name)
    now_row = car.seasons[-1]
    match = _player_match(world, events, st, player_id)
    appeared = match["role"] == "starting_xi" or match["substitution"]["on"] is not None
    derby = bool(synthetic_history(world).head_to_head(world.home.team_id, world.away.team_id))
    derby_today = match["goals"] if derby else 0
    club, overall = _totals(club_rows, gk), _totals(car.seasons, gk)
    evs = list(events)
    facts = ranked(match_facts(world, player_id, evs)
                   + contextualise([f for f in _seeded(world) if f.subject_id == player_id], evs, player_id))
    return {
        "match_id": world.fixture.match_id,
        "as_of": _clock(st, events),
        "player": {
            "player_id": p.player_id, "name": _name(p), "display_name": p.display_name,
            "shirt_number": p.shirt_number, "position": p.position, "position_word": POSITION_WORD[p.position],
            "preferred_foot": p.preferred_foot, "age": car.age, "hometown": car.hometown,
            "academy_graduate": car.academy, "joined_season": car.joined_season, "fee_note": car.fee_note,
            "club": {"team_id": team.team_id, "name": team.name, "short_name": team.short_name},
        },
        "profile_line": _profile_line(p, car, team.short_name, club_rows),
        "this_match": match,
        "season": {
            "scope": SCOPE_SEASON, "season": CURRENT_SEASON, "club": now_row.club, "apps": now_row.apps,
            "goals": now_row.goals, "assists": now_row.assists, "yellows": now_row.yellows, "reds": now_row.reds,
            "clean_sheets": now_row.clean_sheets if gk else None,
            "team_league_games_before_today": PLAYED_THIS_SEASON,
            "one_booking_from_ban": now_row.yellows == BOOKINGS_FOR_BAN - 1,
            "including_today": {"apps": now_row.apps + (1 if appeared else 0),
                                "goals": now_row.goals + match["goals"],
                                "scope": "league, before today plus this match so far (confirmed goals only)"},
        },
        "career": {"scope": SCOPE_CAREER, "seasons": [_season_row(s, gk) for s in car.seasons]},
        "totals": {"scope": f"{SCOPE_CAREER}; includes {CURRENT_SEASON} before today",
                   "club": {**club, "club": team.name, "since": car.joined_season}, "overall": overall,
                   "clubs": list(dict.fromkeys(s.club for s in car.seasons))},
        "derby": {"scope": SCOPE_DERBY, "goals_before_today": car.derby_goals,
                  "goals": _derby_goal_list(kb, _name(p), p.team_id), "goals_today": derby_today},
        "milestones": _milestones(short=team.short_name, gk=gk, appeared=appeared, club_apps=club["apps"],
                                  career_apps=overall["apps"], multi_club=len(set(s.club for s in car.seasons)) > 1,
                                  club_goals=club["goals"], career_goals=overall["goals"],
                                  goals_today=match["goals"], derby_goals=car.derby_goals, derby_today=derby_today,
                                  club_clean_sheets=club["clean_sheets"] or 0),
        "injuries": list(car.injuries),
        "connections": [{"kind": c.kind, "player_ids": list(c.player_ids), "text": c.text}
                        for c in kb.connections if player_id in c.player_ids],
        "facts": facts,
        "fictional": True,
        "notice": NOTICE,
    }


# ---------------------------------------------------------------- team dossier

STREAK_KINDS: tuple[StreakKind, ...] = ("unbeaten", "winless", "winning", "losing", "scoring", "clean_sheet")
STREAK_SCOPES: tuple[tuple[Scope, Where], ...] = (("all", "any"), ("league", "any"), ("league", "home"),
                                                  ("league", "away"))


def _streaks(hist: Sequence[ClubMatch], today: str) -> list[dict[str, Any]]:
    """Current runs entering today. `first_since_note` only when the run is at least two long and no run as
    long ended within the year before today (otherwise "longest since" is not worth saying)."""
    out = []
    for scope, where in STREAK_SCOPES:
        sel = select(hist, scope, where)
        for kind in STREAK_KINDS:
            s = current_streak(sel, kind)
            if s.length == 0:
                continue
            prev = previous_run_at_least(sel, kind, s.length)
            longest = longest_run(sel, kind)
            out.append({"kind": kind, "scope": scope, "where": where, "length": s.length, "since": s.since,
                        "rule": describe(kind, scope, where) + ", before today",
                        "longest_in_record": longest, "is_longest_in_record": s.length >= longest,
                        "previous_run_as_long_ended": prev.date if prev else None,
                        "first_since_note": None if s.length < 2 else
                        f"longest such run since {fmt_month(prev.date)}"
                        if prev is not None and days_between(prev.date, today) >= 365 else None if prev is not None
                        else f"no run as long in the record (since {hist[0].season})"})
    return out


def team_dossier(world: World, events: Sequence[MatchEvent], team_id: str, state: MatchState | None = None,
                 provider: HistoryProvider | None = None) -> dict[str, Any]:
    """Raises KeyError for a team not in this fixture."""
    team = world.team(team_id)
    st = _state(world, events, state)
    prov = provider or synthetic_history(world)
    kb = build(world)
    hist = prov.fixtures(team_id)
    lg = select(hist, "league")
    tenure = prov.manager(team_id)
    spell = [m for m in hist if m.date >= tenure.start_date]
    seasons = prov.season_table(team_id)
    cur = [m for m in lg if m.season == CURRENT_SEASON]
    cur_rec = record(cur)
    sv = st.stats_view()
    lu = _lineup(events, team_id)
    starters = {s["player_id"]: s["slot"] for s in lu.payload["starters"]} if lu else {}
    bench = set(lu.payload["bench"]) if lu else set()
    sheet = st.sheets[team_id]
    squad = []
    for p in sorted(team.players, key=lambda x: x.shirt_number):
        now_row = kb.careers[p.player_id].seasons[-1]
        squad.append({
            "player_id": p.player_id, "shirt_number": p.shirt_number, "name": _name(p),
            "display_name": p.display_name, "position": p.position,
            "season_apps": now_row.apps, "season_goals": now_row.goals,
            "today": None if lu is None else ("starting_xi" if p.player_id in starters
                                              else "bench" if p.player_id in bench else "not_in_squad"),
            "slot": starters.get(p.player_id), "on_pitch": st.on_pitch(p.player_id),
            "subbed_off": p.player_id in sheet.off, "sent_off": p.player_id in sheet.sent_off,
        })
    win_big, loss_big = biggest(hist, "W"), biggest(hist, "L")
    lwin, lloss = biggest(lg, "W"), biggest(lg, "L")
    return {
        "match_id": world.fixture.match_id,
        "as_of": _clock(st, events),
        "club": {"team_id": team.team_id, "name": team.name, "short_name": team.short_name, "code": team.code,
                 "founded": team.founded, "stadium": team.stadium, "formation": team.formation,
                 "kit": team.kit.model_dump(mode="json"),
                 "today": "home" if team_id == world.fixture.home_team_id else "away"},
        "manager": {
            "name": tenure.name, "appointed_season": tenure.appointed_season, "tenure_start": tenure.start_date,
            "previous": tenure.previous,
            "record": {**_rec(spell), "scope": f"all competitions, club matches from {tenure.start_date} to before "
                                               "today"},
            "league_record": {**_rec(select(spell, "league")), "scope": "league only, same period"},
            "derby_record": {**_rec([m for m in spell if m.is_derby]), "scope": "derbies (league + cup), same "
                                                                                "period"},
        },
        "form": {"scope": "all competitions, last five before today (newest first)",
                 "matches": [_cm(m) for m in reversed(hist[-5:])], "line": " ".join(m.result for m in hist[-5:])},
        "league_form": {"scope": "league only, last five before today (newest first)",
                        "matches": [_cm(m) for m in reversed(lg[-5:])], "line": " ".join(m.result for m in lg[-5:])},
        "streaks": {"scope": f"record window {hist[0].season if hist else CURRENT_SEASON} to before today",
                    "current": _streaks(hist, prov.today())},
        "current_season": {"scope": f"league, {CURRENT_SEASON}, before today (league position not recorded)",
                           "played": cur_rec.played, "won": cur_rec.won, "drawn": cur_rec.drawn,
                           "lost": cur_rec.lost, "goals_for": cur_rec.goals_for,
                           "goals_against": cur_rec.goals_against, "points": 3 * cur_rec.won + cur_rec.drawn},
        "seasons": {"scope": f"completed league seasons {RECORD_WINDOW} (fictional); cup = National Cup run",
                    "rows": [{"season": s.season, "position": s.position, "played": GAMES_PER_SEASON,
                              "won": s.won, "drawn": s.drawn, "lost": s.lost, "goals_for": s.goals_for,
                              "goals_against": s.goals_against, "goal_difference": s.goals_for - s.goals_against,
                              "points": s.points, "top_scorer": s.top_scorer, "cup": s.cup} for s in seasons]},
        "honours": {"scope": f"record window {RECORD_WINDOW} only (no older honours in the fictional record)",
                    "league_titles": [s.season for s in seasons if s.position == 1],
                    "cups": [s.season for s in seasons if s.cup == "Winners"],
                    "best_league_finish": min((s.position for s in seasons), default=None)},
        "biggest": {
            "scope": "biggest = largest margin, then most goals (scored for a win, conceded for a defeat), then "
                     "most recent",
            "win_all_competitions": _cm(win_big) if win_big else None,
            "defeat_all_competitions": _cm(loss_big) if loss_big else None,
            "win_league": _cm(lwin) if lwin else None,
            "defeat_league": _cm(lloss) if lloss else None,
        },
        "upcoming": {"scope": "next three fixtures after today, all competitions",
                     "fixtures": [_upcoming(u) for u in prov.upcoming(team_id, 3)]},
        "squad": {"lineup_confirmed": lu is not None, "formation": sheet.formation or team.formation,
                  "players": squad},
        "this_match": {"scope": SCOPE_MATCH, "score": st.score[team_id],
                       "conceded": st.score[world.opponent_of(team_id)], "stats": sv[team_id],
                       "opponent_stats": sv[world.opponent_of(team_id)],
                       "possession_rule": "share of in-play time between events while the team had the ball "
                                          "(approximate; restarts and stoppages excluded)"},
        "fictional": True,
        "notice": NOTICE,
    }


# ---------------------------------------------------------------- head to head


def _meeting(world: World, m: Meeting) -> dict[str, Any]:
    names = {t.team_id: t for t in world.teams}

    def pid(team_id: str, name: str) -> str | None:
        return next((p.player_id for p in names[team_id].players if _name(p) == name), None) \
            if team_id in names else None

    return {"date": m.date, "season": m.season, "competition": m.competition, "home_id": m.home,
            "away_id": m.away, "home": names[m.home].name if m.home in names else m.home,
            "away": names[m.away].name if m.away in names else m.away,
            "venue": names[m.home].stadium if m.home in names else None,
            "score": f"{m.home_goals}-{m.away_goals}", "home_goals": m.home_goals, "away_goals": m.away_goals,
            "scorers": [{"team_id": t, "name": n, "minute": mi, "player_id": pid(t, n),
                         "current_squad": pid(t, n) is not None} for t, n, mi in m.scorers],
            "sent_off": list(m.sent_off), "referee": m.referee, "attendance": m.attendance}


def h2h_dossier(world: World, events: Sequence[MatchEvent], state: MatchState | None = None,
                provider: HistoryProvider | None = None) -> dict[str, Any]:
    st = _state(world, events, state)
    prov = provider or synthetic_history(world)
    kb = build(world)
    home, away = world.home, world.away
    h2h = prov.head_to_head(home.team_id, away.team_id)
    window = f"{h2h[0].season} to {h2h[-1].season}" if h2h else RECORD_WINDOW
    # leading derby scorers among the current squads (record window), plus confirmed goals today
    tally: dict[str, list[str]] = {}
    for m in kb.meetings:
        for t, n, _mi in m.scorers:
            p = next((x for x in world.team(t).players if _name(x) == n), None)
            if p is not None:
                tally.setdefault(p.player_id, []).append(m.date)
    today: dict[str, int] = {}
    for g in st.goals:
        if g.status == "confirmed" and g.scorer_id and world.player(g.scorer_id).team_id == g.team_id:
            today[g.scorer_id] = today.get(g.scorer_id, 0) + 1
    scorers = [{"player_id": pid, "name": _name(world.player(pid)), "team_id": world.player(pid).team_id,
                "derby_goals_before_today": len(dates), "last_derby_goal": dates[-1],
                "goals_today": today.get(pid, 0)}
               for pid, dates in sorted(tally.items(), key=lambda kv: (-len(kv[1]), kv[0]))]
    teams = {}
    for club in (home, away):
        mine = prov.head_to_head(club.team_id, world.opponent_of(club.team_id))
        big, lw = biggest(mine, "W"), last_with(mine, "W")
        runs = {k: current_streak(mine, k) for k in ("unbeaten", "winless", "winning", "losing")}
        teams[club.team_id] = {
            "record": _rec(mine), "at_home": _rec(select(mine, "all", "home")),
            "away_from_home": _rec(select(mine, "all", "away")),
            "biggest_win": _cm(big) if big else None, "last_win": _cm(lw) if lw else None,
            "current_run": [{"kind": k, "length": s.length, "since": s.since} for k, s in runs.items()
                            if s.length > 0],
        }
    at = prov.all_time_head_to_head()
    return {
        "match_id": world.fixture.match_id,
        "as_of": _clock(st, events),
        "rivalry": "Wend Bridge Derby",
        "all_time": {"scope": "all-time, as published in the fictional club records (not itemised)",
                     "meetings": at["meetings"], "wins": {home.team_id: at[home.team_id],
                                                          away.team_id: at[away.team_id]}, "draws": at["draws"]},
        "record_window": {"scope": f"league + cup derbies {window} (itemised), from {home.short_name}'s side",
                          **_rec(h2h)},
        "teams": teams,
        "last_meetings": {"scope": "most recent first", "meetings": [_meeting(world, m)
                                                                     for m in reversed(kb.meetings[-6:])]},
        "leading_scorers": {"scope": f"current squads, {SCOPE_DERBY}; goals_today = confirmed goals in this match",
                            "players": scorers[:8]},
        "today": {"scope": SCOPE_MATCH, "score": dict(st.score)},
        "fictional": True,
        "notice": NOTICE,
    }


# ---------------------------------------------------------------- match dossier


def match_dossier(world: World, context: Sequence[ContextFact], provider: HistoryProvider | None = None
                  ) -> dict[str, Any]:
    """`context` = context facts for the full released log; only pre-match ones (no trigger event) are used."""
    prov = provider or synthetic_history(world)
    kb = build(world)
    fx = world.fixture
    ref = kb.referee
    ref_derbies = [m for m in kb.meetings if m.referee == ref.name]
    hist = prov.fixtures(world.home.team_id)
    home_league = record(select(hist, "league", "home"))
    rs = fx.ruleset
    return {
        "match_id": fx.match_id,
        "competition": fx.competition, "season": CURRENT_SEASON, "matchday": PLAYED_THIS_SEASON + 1,
        "kickoff_local": fx.kickoff_local, "timezone": fx.timezone, "venue": fx.venue,
        "home": {"team_id": world.home.team_id, "name": world.home.name},
        "away": {"team_id": world.away.team_id, "name": world.away.name},
        "stadium": {**prov.stadium(), "home_club": world.home.name,
                    "home_league_record": {"won": home_league.won, "drawn": home_league.drawn,
                                           "lost": home_league.lost, "played": home_league.played,
                                           "scope": f"{world.home.short_name} home league matches, record window "
                                                    f"{hist[0].season if hist else RECORD_WINDOW} to before today"}},
        "officials": [{**o.model_dump(mode="json"),
                       **({"record": {**asdict(ref), "cautions_per_game": round(ref.yellows_this_season
                                                                                / ref.games_this_season, 1),
                                      "scope": "league games this season, before today; career_games all-time",
                                      "derbies_in_record": len(ref_derbies),
                                      "last_derby": ref_derbies[-1].date if ref_derbies else None}}
                          if o.role == "referee" and o.name == ref.name else {})}
                      for o in fx.officials],
        "context": [f.to_json() for f in context if f.trigger_event_id is None],
        "ruleset": {**rs.model_dump(mode="json"),
                    "notes": [f"Laws of the Game version {rs.ruleset_version}.",
                              f"Up to {rs.max_substitutions} substitutes in {rs.substitution_windows} windows "
                              "(half-time does not count as a window)."
                              if rs.competition_modifiers.get("substitution_windows_exclude_half_time")
                              else f"Up to {rs.max_substitutions} substitutes in {rs.substitution_windows} "
                                   "windows.",
                              "VAR in use." if rs.var_in_use else "No VAR.",
                              f"{rs.yellow_accumulation_dismissal} cautions in a match mean a sending-off.",
                              f"Two halves of {rs.period_minutes} minutes plus added time."],
                    "league_disciplinary_rule": LEAGUE_RULES},
        "scenario": fx.scenario.model_dump(mode="json"),
        "data_notice": fx.data_notice,
        "fictional": True,
        "notice": NOTICE,
    }


# ---------------------------------------------------------------- talking points

_STOP = {"the", "a", "an", "of", "in", "for", "and", "to", "his", "their", "is", "are", "at", "on", "since", "with",
         "today", "this", "has", "have"}


def _tokens(text: str) -> set[str]:
    return {w for w in re.findall(r"[a-z0-9]+", text.lower()) if w not in _STOP}


def _similar(a: str, b: str) -> bool:
    ta, tb = _tokens(a), _tokens(b)
    if not ta or not tb:
        return a.strip().lower() == b.strip().lower()
    return len(ta & tb) / len(ta | tb) >= 0.7


def _possessions(events: Sequence[MatchEvent]) -> list[tuple[str, int, set[str]]]:
    """(team, last elapsed_ms, players) per possession: maximal run of on-ball events by one team (a restart or
    kick-off starts a new one)."""
    out: list[tuple[str, int, set[str]]] = []
    for e in events:
        if e.type not in ON_BALL or e.team_id is None:
            continue
        if out and out[-1][0] == e.team_id and e.type not in ("restart.taken", "kickoff", "penalty.taken"):
            team, _ms, players = out[-1]
            if e.player_id:
                players.add(e.player_id)
            out[-1] = (team, e.elapsed_ms, players)
        else:
            out.append((e.team_id, e.elapsed_ms, {e.player_id} if e.player_id else set()))
    return out


def recent_involvement(world: World, events: Sequence[MatchEvent]) -> dict[str, dict[str, Any]]:
    """Players involved in events in the last INVOLVEMENT_WINDOW_MS of match time before the last event."""
    if not events:
        return {}
    now = events[-1].elapsed_ms
    lo = now - INVOLVEMENT_WINDOW_MS
    out: dict[str, dict[str, Any]] = {}
    for e in events:
        if e.elapsed_ms < lo or e.player_id is None or not world.has_player(e.player_id):
            continue
        d = out.setdefault(e.player_id, {"actions": 0, "shots": [], "last_ms": 0, "events": []})
        if e.type in ON_BALL:
            d["actions"] += 1
        if e.type == "shot":
            d["shots"].append(f"{e.display_clock} ({e.payload['outcome'].replace('_', ' ')})")
        d["last_ms"] = max(d["last_ms"], e.elapsed_ms)
        d["events"].append(e.event_id)
    poss = [x for x in _possessions(events) if x[1] >= lo]
    for pid, d in out.items():
        team = world.player(pid).team_id
        mine = [x for x in poss if x[0] == team][-5:]
        d["possessions"] = (sum(1 for x in mine if pid in x[2]), len(mine))
    return out


def _why_involved(world: World, pid: str, d: dict[str, Any]) -> str | None:
    p = world.player(pid)
    short = world.team(p.team_id).short_name
    if d["shots"]:
        return f"{p.display_name} had a shot at {d['shots'][-1]} in the last 3 minutes"
    k, n = d.get("possessions", (0, 0))
    if n >= 3 and k >= 2:
        return f"{p.display_name} was involved in {k} of {short}'s last {n} possessions"
    if d["actions"] >= 3:
        return f"{p.display_name} has had {d['actions']} on-ball actions in the last 3 minutes"
    return None


def _fresh(now_ms: int, at_ms: int) -> float:
    return max(0.0, 1.0 - (now_ms - at_ms) / FRESH_MS) if at_ms <= now_ms else 0.0


def talking_points(world: World, events: Sequence[MatchEvent], context: Sequence[ContextFact],
                   state: MatchState | None = None, storylines: Sequence[dict[str, Any]] = (),
                   moments: Sequence[dict[str, Any]] = (), limit: int = 8) -> list[dict[str, Any]]:
    """Ranked, deduplicated talking points as of the last released event. `context`, `storylines` and `moments`
    must have been computed from the same released events (no look-ahead). Deterministic."""
    st = _state(world, events, state)
    kb = build(world)
    by_id = {e.event_id: e for e in events}
    by_seq = {e.seq: e for e in events}
    now = events[-1].elapsed_ms if events else 0
    lineup_seqs = {e.seq for e in events if e.type == "lineup.confirmed"}
    involved = recent_involvement(world, events)
    why_inv = {pid: w for pid, d in involved.items() if (w := _why_involved(world, pid, d)) is not None}
    # strongest recent involvement first (deterministic tie-break on player id)
    top_players = sorted(why_inv, key=lambda pid: (-len(involved[pid]["shots"]), -involved[pid]["actions"],
                                                   pid))[:3]
    out: list[dict[str, Any]] = []

    def add(tp_id: str, text: str, detail: str | None, kind: TPKind, subjects: list[str], why: str,
            source: TPSource, at_ms: int, priority: float) -> None:
        out.append({"id": tp_id, "text": fit(text), "detail": detail, "kind": kind, "subject_ids": subjects,
                    "why": why, "source": source, "at_ms": at_ms, "priority": round(priority, 1),
                    "fictional": True})

    # 1. context facts (history made relevant by this match), newest first in rank
    tier = {"alert": 50.0, "insight": 38.0, "quiet": 22.0}
    covered: set[str] = set()
    for f in context:
        trig = by_id.get(f.trigger_event_id) if f.trigger_event_id else None
        subjects = [f.subject_id] if f.subject_kind != "match" else [world.home.team_id, world.away.team_id]
        pri = tier[f.priority]
        if trig is not None:
            at = trig.elapsed_ms
            pri += 10 + 35 * _fresh(now, at)
            why = f"New at {trig.display_clock}: follows {TRIGGER_WORD.get(trig.type, trig.type)}"
        elif f.as_of_seq in lineup_seqs:
            at = by_seq[f.as_of_seq].elapsed_ms
            why = "From the confirmed line-up"
        else:
            at = 0
            why = "Pre-match background"
        if f.subject_kind == "player" and f.subject_id in why_inv:
            pri += 15
            why = why_inv[f.subject_id]
            covered.add(f.subject_id)
        elif f.subject_kind == "player" and trig is None and st.on_pitch(f.subject_id):
            why = "On the pitch now"
        source: TPSource = "this match" if f.category == "discipline" else "fictional history"
        add(f"tp-{f.fact_id}", f.short_text, f.detail, CONTEXT_KIND.get(f.category, "record"), subjects, why,
            source, at, pri)

    # 2. players involved in the last three match minutes: their best research fact
    seeded = _seeded(world)
    for pid in top_players:
        if pid in covered:
            continue
        p = world.player(pid)
        live = match_facts(world, pid, list(events))
        pool = sorted((x for x in [*seeded, *live] if x.subject_id == pid and x.relevance >= MIN_PLAYER_RELEVANCE),
                      key=lambda x: (-x.relevance, x.fact_id))
        if not pool:
            continue
        best = pool[0]
        add(f"tp-player-{pid}-{best.fact_id}", f"{p.display_name}: {best.short_text}", best.extended_text,
            FACT_KIND.get(best.category, "player"), [pid], why_inv[pid],
            "this match" if best.provenance == "match_event_derived" else "fictional history",
            involved[pid]["last_ms"], 30 + 25 * best.relevance + 2 * min(involved[pid]["actions"], 5))

    # 3. players on a caution (this match), more pressing when also one booking from a league ban
    for c in st.cards:
        if c.colour != "yellow" or c.status != "active" or not st.on_pitch(c.player_id):
            continue
        p = world.player(c.player_id)
        at = by_id[c.card_event_id].elapsed_ms if c.card_event_id in by_id else now
        add(f"tp-yellow-{c.card_event_id}",
            f"{_name(p)} has been on a yellow card since {c.minute}; a second caution means a sending-off.",
            None, "discipline", [c.player_id], "On a caution and on the pitch now", "this match", at,
            34 + 12 * _fresh(now, at))

    # 4. storylines and tactical moments released by now
    for s in storylines:
        if s["state"] not in ("DEVELOPING", "STRONG", "CONFIRMED"):
            continue
        base = {"CONFIRMED": 44.0, "STRONG": 40.0, "DEVELOPING": 28.0}[s["state"]]
        add(f"tp-storyline-{s['storyline_id']}", s["headline"], s.get("reason"), "storyline", [s["team_id"]],
            f"Storyline {s['state'].lower()} at {s['display_clock']}", "this match", s["updated_at_ms"],
            base + 25 * _fresh(now, s["updated_at_ms"]))
    recent_moments = sorted((m for m in moments if now - m["at_ms"] <= 300_000 and m["significance"] >= 30),
                            key=lambda m: (-m["significance"], m["moment_id"]))[:2]
    for m in recent_moments:
        add(f"tp-moment-{m['moment_id']}", m["title"], m.get("summary"), "tactical",
            list(dict.fromkeys(m["focus_player_ids"])), f"Tactical moment at {m['display_clock']}", "tracking",
            m["at_ms"], 22 + m["significance"] / 5 + 15 * _fresh(now, m["at_ms"]))

    # 5. the referee (fictional season record, plus cards shown today)
    ref = kb.referee
    cards_today = [c for c in st.cards if c.status == "active"]
    recent_card = max((by_id[c.card_event_id].elapsed_ms for c in cards_today if c.card_event_id in by_id),
                      default=None)
    add("tp-referee", f"Referee {ref.name}: {ref.yellows_this_season} cautions in {ref.games_this_season} league "
        f"games this season ({ref.yellows_this_season / ref.games_this_season:.1f} per game).",
        f"Cards shown today so far: {_pl(len(cards_today), 'card')}." if events else None, "discipline", [],
        "Cards shown in the last 5 minutes" if recent_card is not None and now - recent_card <= 300_000
        else "Pre-match background", "fictional history", recent_card or 0,
        20 + (15 if recent_card is not None and now - recent_card <= 300_000 else 0))

    # rank, deduplicate (near-identical wording keeps the higher-ranked one), cut
    out.sort(key=lambda t: (-t["priority"], t["id"]))
    kept: list[dict[str, Any]] = []
    for t in out:
        if any(t["id"] == k["id"] or _similar(t["text"], k["text"]) for k in kept):
            continue
        kept.append(t)
    return kept[:limit]
