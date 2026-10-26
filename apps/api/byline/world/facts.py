"""Research facts for commentators, DERIVED from the structured fictional knowledge base (knowledge.py)
plus live match facts from the synthetic event log.

Seeded facts are invented for BYLINE's synthetic clubs and labelled as such; because they are
computed from one structured history (season-by-season careers, derby meetings, league tables),
totals, milestones and head-to-heads agree with each other. Live facts use official/observed
synthetic events up to the viewer's playhead only.
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict

from byline.events.models import MatchEvent
from byline.world.history import synthetic_history
from byline.world.knowledge import (
    BOOKINGS_FOR_BAN,
    CURRENT_SEASON,
    LEAGUE_RULES,
    PLAYED_THIS_SEASON,
    KnowledgeBase,
    build,
)
from byline.world.models import Player, Team, World

AS_OF = "2026-10-24"
SOURCE = "BYLINE fictional knowledge base v2 (synthetic, invented for this demo)"

FactType = Literal["quick", "records", "stories", "match", "today", "rivalry", "historical", "unusual"]
Category = Literal["profile", "season", "career", "milestone", "discipline", "connection", "derby", "injury",
                   "club", "manager", "referee", "form", "honours", "stadium", "live"]
POSITION_WORD = {"GK": "goalkeeper", "RB": "right-back", "LB": "left-back", "CB": "centre-back",
                 "DM": "holding midfielder", "CM": "central midfielder", "AM": "attacking midfielder",
                 "RW": "right winger", "LW": "left winger", "ST": "striker"}


class Fact(BaseModel):
    model_config = ConfigDict(frozen=True)
    fact_id: str
    subject_id: str
    subject_kind: Literal["player", "team"]
    fact_type: FactType
    category: Category = "profile"
    short_text: str
    extended_text: str | None = None
    provenance: Literal["fictional_seeded", "match_event_derived"]
    source: str
    event_source_ids: tuple[str, ...] = ()
    as_of: str
    certainty: Literal["fact_in_fiction", "derived_from_events"]
    relevance: float = 0.5
    relevance_reason: str | None = None


class _Builder:
    def __init__(self, subject_id: str, kind: Literal["player", "team"]) -> None:
        self.subject_id, self.kind, self.out = subject_id, kind, []  # type: ignore[var-annotated]

    def add(self, ftype: FactType, cat: Category, short: str, extended: str | None = None, rel: float = 0.5,
            reason: str | None = None) -> None:
        self.out.append(Fact(fact_id=f"F-{self.subject_id}-{cat}-{len(self.out) + 1:02d}", subject_id=self.subject_id,
                             subject_kind=self.kind, fact_type=ftype, category=cat, short_text=short,
                             extended_text=extended, provenance="fictional_seeded", source=SOURCE, as_of=AS_OF,
                             certainty="fact_in_fiction", relevance=rel, relevance_reason=reason))


def pl(n: int, word: str, plural: str | None = None) -> str:
    return f"{n} {word if n == 1 else (plural or word + 's')}"


def _nm(p: Player) -> str:
    return f"{p.given_name} {p.family_name}"


def _season_results(world: World, team_id: str) -> list[str]:
    """This season's league results before today (oldest first), read from the fixture history."""
    return [m.result for m in synthetic_history(world).fixtures(team_id)
            if m.season == CURRENT_SEASON and m.is_league]


def _player_facts(p: Player, team: Team, world: World, kb: KnowledgeBase) -> list[Fact]:
    car = kb.careers[p.player_id]
    b = _Builder(p.player_id, "player")
    club = car.at(team.name)
    now = car.seasons[-1]
    club_apps, club_goals = sum(s.apps for s in club), sum(s.goals for s in club)
    car_apps, car_goals = sum(s.apps for s in car.seasons), sum(s.goals for s in car.seasons)
    clubs = list(dict.fromkeys(s.club for s in car.seasons))
    b.add("quick", "profile", f"{car.age}-year-old {POSITION_WORD[p.position]} from {car.hometown}; {car.fee_note}.",
          rel=0.6)
    if p.position == "GK":
        b.add("quick", "season", f"{pl(now.clean_sheets, 'clean sheet')} in {pl(now.apps, 'league game')} this "
              "season.", rel=0.65)
        cs = sum(s.clean_sheets for s in club)
        b.add("records", "career", f"{cs} clean sheets in {club_apps} league appearances for {team.short_name}.",
              rel=0.55)
    else:
        b.add("quick", "season", f"This season: {pl(now.goals, 'goal')} and {pl(now.assists, 'assist')} in "
              f"{pl(now.apps, 'league game')} (before today).", rel=0.65)
        b.add("records", "career", f"{pl(club_goals, 'goal')} in {pl(club_apps, 'league appearance')} for {team.short_name} "
              f"since {car.joined_season}.",
              f"Career: {pl(car_goals, 'goal')} in {pl(car_apps, 'league appearance')} across "
              f"{pl(len(clubs), 'club')} ({', '.join(clubs)}).", rel=0.55)
        best = max(car.seasons[:-1], key=lambda s: s.goals, default=None)
        if best and best.goals >= 5:
            b.add("records", "career", f"Best season: {best.goals} goals in {best.apps} games for {best.club} "
                  f"({best.season}).", rel=0.45)
    # milestones (only when genuinely within reach)
    if club_apps == 99:
        b.add("records", "milestone", f"Today is his 100th league appearance for {team.short_name}.", rel=0.95,
              reason="Milestone today")
    for mark in (25, 50, 75, 100, 150):
        if p.position != "GK" and 0 < mark - club_goals <= 2:
            b.add("records", "milestone", f"{mark - club_goals} league goal{'s' if mark - club_goals > 1 else ''} "
                  f"away from {mark} for {team.short_name}.", rel=0.9, reason="Milestone within reach today")
            break
    # discipline
    if now.yellows == BOOKINGS_FOR_BAN - 1:
        b.add("records", "discipline", f"On {now.yellows} league bookings this season: one more means a one-match "
              "ban.", LEAGUE_RULES, rel=0.92, reason="Suspension risk today")
    yc, rc = sum(s.yellows for s in car.seasons), sum(s.reds for s in car.seasons)
    if yc >= 10 or rc:
        b.add("records", "discipline", f"Career discipline: {pl(yc, 'caution')} and {pl(rc, 'sending-off')} in "
              f"{pl(car_apps, 'league game')}.", rel=0.45)
    # stories
    for inj in car.injuries[-1:]:
        b.add("stories", "injury", f"Has come back from {inj}.", rel=0.4)
    for c in kb.connections:
        if p.player_id in c.player_ids:
            b.add("stories", "connection", c.text, rel=0.75 if c.kind in ("crossed_the_river", "academy_rival")
                  else 0.6, reason="Connection to today's opponents")
    derby = [m for m in kb.meetings for (_t, n, _mi) in m.scorers if n == _nm(p)]
    if derby:
        # newest first, one entry per derby (a brace is one meeting, not two)
        latest = list(dict.fromkeys(reversed(derby)))[:3]
        dates = ", ".join(f"{m.date} ({m.home} {m.home_goals}-{m.away_goals} {m.away})" for m in latest)
        b.add("stories", "derby", f"{len(derby)} derby goal{'s' if len(derby) > 1 else ''} against "
              f"{world.team(world.opponent_of(team.team_id)).short_name} in the last ten seasons.",
              f"Most recent: {dates}.", rel=0.85, reason="Derby record")
    return b.out


def _team_facts(team: Team, world: World, kb: KnowledgeBase) -> list[Fact]:
    tid = team.team_id
    other = world.team(world.opponent_of(tid))
    b = _Builder(tid, "team")
    hist = kb.seasons[tid]
    mgr = kb.managers[tid]
    res = _season_results(world, tid)
    w, d, lo = res.count("W"), res.count("D"), res.count("L")
    home_side = tid == world.home.team_id
    b.add("today", "club", f"{team.name} {'host' if home_side else 'visit'} {other.short_name} at "
          f"{world.home.stadium} in the {kb_rivalry_name()}.", rel=0.8)
    b.add("today", "form", f"{3 * w + d} points from {PLAYED_THIS_SEASON} league games ({w}W {d}D {lo}L); last five "
          f"(newest last): {''.join(res[-5:])}.", rel=0.7)
    b.add("today", "manager", f"Manager {mgr['name']}, appointed {mgr['appointed']}, sets up in a {team.formation}.",
          f"Previously: {mgr['previous']}.", rel=0.6)
    ref = kb.referee
    last = kb.meetings[-1]
    b.add("today", "referee", f"Referee {ref.name}: {ref.yellows_this_season} cautions and {ref.reds_this_season} "
          f"sending-off in {ref.games_this_season} league games this season "
          f"({ref.yellows_this_season / ref.games_this_season:.1f} cautions per game).",
          f"She also refereed the last derby ({last.date}, {last.home} {last.home_goals}-{last.away_goals} "
          f"{last.away})." if last.referee == ref.name else None, rel=0.6)
    watch = [world.player(pid) for pid, c in kb.careers.items()
             if world.player(pid).team_id == tid and c.seasons[-1].yellows == BOOKINGS_FOR_BAN - 1]
    if watch:
        b.add("today", "discipline", "One booking from a ban: " + ", ".join(f"#{p.shirt_number} {_nm(p)}"
                                                                         for p in watch) + ".",
              LEAGUE_RULES, rel=0.85, reason="Suspension risk today")
    hundreds = [world.player(pid) for pid, c in kb.careers.items() if world.player(pid).team_id == tid
                and sum(s.apps for s in c.at(team.name)) == 99]
    for p in hundreds:
        b.add("today", "milestone", f"#{p.shirt_number} {_nm(p)} makes his 100th {team.short_name} league appearance.",
              rel=0.9, reason="Milestone today")
    # records
    cups = [s.season for s in hist if s.cup == "Winners"]
    best = min(hist, key=lambda s: s.position)
    b.add("records", "honours", f"Best league finish in the last ten seasons: {best.position}"
          f"{_ordinal(best.position)} ({best.season}, {best.points} points).",
          ("National Cup winners in " + ", ".join(cups) + ".") if cups else "No major trophy in the last ten seasons.",
          rel=0.55)
    ls = hist[-1]
    b.add("records", "club", f"Last season: {ls.position}{_ordinal(ls.position)} with {ls.points} points; top "
          f"scorer {ls.top_scorer}.", rel=0.6)
    # rivalry, all derived from the meetings list
    at = kb.all_time
    b.add("rivalry", "derby", f"{kb_rivalry_name()}: {at['meetings']} meetings, Northbridge {at['NBA']} wins, "
          f"Riverton {at['RVC']}, {at['draws']} draws.", rel=0.75)
    b.add("rivalry", "derby", f"Last meeting: {last.home} {last.home_goals}-{last.away_goals} {last.away} "
          f"({last.date}).", "Scorers: " + ", ".join(f"{n} {m}'" for _t, n, m in last.scorers) + ".", rel=0.8)
    recent = kb.meetings[-5:]
    wins = sum(1 for m in recent if (m.home == tid and m.home_goals > m.away_goals)
               or (m.away == tid and m.away_goals > m.home_goals))
    draws = sum(1 for m in recent if m.home_goals == m.away_goals)
    b.add("rivalry", "derby", f"Last five derbies: {wins} win{'s' if wins != 1 else ''}, {draws} draw"
          f"{'s' if draws != 1 else ''}, {5 - wins - draws} defeat{'s' if 5 - wins - draws != 1 else ''}.",
          "; ".join(f"{m.date}: {m.home} {m.home_goals}-{m.away_goals} {m.away}" for m in recent), rel=0.7)
    late = sum(1 for m in kb.meetings if any(mi >= 80 for _t, _n, mi in m.scorers))
    b.add("unusual", "derby", f"{late} of the last {len(kb.meetings)} derbies have had a goal in the 80th minute "
          "or later.", rel=0.5)
    home_derbies = [m for m in kb.meetings if m.home == tid]
    unbeaten = 0
    for m in reversed(home_derbies):
        if m.home_goals >= m.away_goals:
            unbeaten += 1
        else:
            break
    if unbeaten >= 2:
        b.add("unusual", "derby", f"Unbeaten in their last {unbeaten} home derbies.", rel=0.6)
    b.add("historical", "club", f"Founded {team.founded}; {('formed by workers from the Northbridge rail-bridge foundry' if tid == 'NBA' else 'founded by rowing-club members on the River Wend')}.",
          rel=0.4)
    if home_side:
        st = kb.stadium
        b.add("historical", "stadium", f"{st['name']} holds {st['capacity']:,}; the record attendance is "
              f"{st['record_attendance']:,}, for {st['record_match']}.", rel=0.45)
    return b.out


def kb_rivalry_name() -> str:
    return "Wend Bridge Derby"


def _ordinal(n: int) -> str:
    return "th" if 11 <= n % 100 <= 13 else {1: "st", 2: "nd", 3: "rd"}.get(n % 10, "th")


def seeded_facts(world: World) -> list[Fact]:
    kb = build(world)
    out: list[Fact] = []
    for team in world.teams:
        out.extend(_team_facts(team, world, kb))
        for p in team.players:
            out.extend(_player_facts(p, team, world, kb))
    return out


def match_facts(world: World, player_id: str, events: list[MatchEvent]) -> list[Fact]:
    """Live facts for one player from the synthetic event log so far (combined with the fictional history)."""
    kb = build(world)
    p = world.player(player_id)
    team = world.team(p.team_id)
    car = kb.careers[player_id]
    passes = [e for e in events if e.player_id == player_id and e.type in ("pass.completed", "pass.failed")]
    done = [e for e in passes if e.type == "pass.completed"]
    shots = [e for e in events if e.player_id == player_id and e.type == "shot"]
    goals = [e for e in events if e.type == "goal.confirmed" and e.player_id == player_id]
    cards = [e for e in events if e.player_id == player_id and e.type.startswith("card.")]
    sub_on = next((e for e in events if e.type == "substitution" and e.payload["player_on_id"] == player_id), None)
    sub_off = next((e for e in events if e.type == "substitution" and e.payload["player_off_id"] == player_id), None)
    out: list[Fact] = []

    def add(short: str, ids: list[str], rel: float, reason: str | None = None,
            cat: Category = "live", extended: str | None = None) -> None:
        out.append(Fact(fact_id=f"M-{player_id}-{len(out) + 1:02d}-{(ids or ['x'])[-1]}", subject_id=player_id,
                        subject_kind="player", fact_type="match", category=cat, short_text=short,
                        extended_text=extended, provenance="match_event_derived",
                        source="Synthetic match events + fictional knowledge base",
                        event_source_ids=tuple(ids[-12:]), as_of="live", certainty="derived_from_events",
                        relevance=rel, relevance_reason=reason))

    if passes:
        add(f"{len(done)}/{len(passes)} passes completed today.", [e.event_id for e in passes], 0.5)
    if shots:
        on = sum(1 for e in shots if e.payload["outcome"] in ("goal", "saved"))
        add(f"{len(shots)} shot{'s' if len(shots) > 1 else ''} today, {on} on target.", [e.event_id for e in shots], 0.65)
    club_goals = sum(s.goals for s in car.at(team.name))
    for i, g in enumerate(goals, start=1):
        total = club_goals + i
        extra = f" That is goal number {total} for {team.short_name}." if total % 5 == 0 or total in (1, 10) else ""
        add(f"Scored at {g.display_clock}; {car.seasons[-1].goals + i} league goals this season.{extra}", [g.event_id],
            0.9, "Scored today")
    season_yellows = car.seasons[-1].yellows
    dismissed_2y = next((c for c in cards if c.type == "card.second_yellow"), None)
    for c in cards:
        if c.type == "card.yellow" and dismissed_2y is not None:
            add(f"Booked at {c.display_clock}; it would have been booking number {season_yellows + 1}, but it no "
                f"longer counts after his {dismissed_2y.display_clock} second-yellow dismissal.", [c.event_id], 0.8,
                "Disciplinary record today", "discipline", LEAGUE_RULES)
            continue
        if c.type == "card.yellow":
            season_yellows += 1
            if season_yellows >= BOOKINGS_FOR_BAN:
                add(f"Booked at {c.display_clock}: booking number {season_yellows} this season brings a one-match ban.",
                    [c.event_id], 0.95, "Suspension triggered today", "discipline", LEAGUE_RULES)
            else:
                add(f"Booked at {c.display_clock} ({season_yellows} league bookings this season).", [c.event_id], 0.85,
                    "Disciplinary record today", "discipline")
        else:
            kind = "second yellow" if c.type == "card.second_yellow" else "straight red"
            add(f"Sent off ({kind}) at {c.display_clock}: a one-match ban follows.", [c.event_id], 0.95,
                "Dismissed today", "discipline",
                LEAGUE_RULES + (" His two cautions today therefore do not count towards the five-booking total."
                                if c.type == "card.second_yellow" else ""))
    if sub_on is not None:
        add(f"Came on at {sub_on.display_clock} ({car.seasons[-1].apps} league appearances this season before today).",
            [sub_on.event_id], 0.8, "Relevant because they were just substituted on")
    if sub_off is not None:
        add(f"Substituted at {sub_off.display_clock}.", [sub_off.event_id], 0.4)
    _ = CURRENT_SEASON
    return out


def ranked(facts: list[Fact], used: set[str] | None = None) -> list[dict[str, Any]]:
    used = used or set()
    order = sorted(facts, key=lambda f: (f.fact_id in used, -f.relevance))
    return [{**f.model_dump(mode="json"), "used": f.fact_id in used} for f in order]


CONTEXT_WINDOW_MS = 5 * 60_000
BOOSTS: dict[str, tuple[tuple[str, ...], str]] = {
    "goal.confirmed": (("derby", "career", "milestone", "season"), "scored"),
    "card.yellow": (("discipline",), "was booked"),
    "card.second_yellow": (("discipline",), "was sent off"),
    "card.red": (("discipline",), "was sent off"),
    "substitution": (("profile", "season", "connection"), "came on"),
}
TEAM_BOOSTS: dict[str, tuple[tuple[str, ...], str]] = {
    "goal.confirmed": (("derby", "form"), "a goal"),
    "card.yellow": (("discipline", "referee"), "a booking"),
    "card.second_yellow": (("discipline", "referee"), "a sending-off"),
    "card.red": (("discipline", "referee"), "a sending-off"),
    "var.review_outcome": (("referee",), "the VAR review"),
    "penalty.outcome": (("referee",), "the penalty"),
}


def contextualise(facts: list[Fact], events: list[MatchEvent], subject_id: str) -> list[Fact]:
    """Raise the relevance of facts that the latest match events make topical (decays over 5 match minutes)."""
    if not events:
        return facts
    now = events[-1].elapsed_ms
    recent = [e for e in events if now - e.elapsed_ms <= CONTEXT_WINDOW_MS]
    booked_today = any(e.player_id == subject_id and e.type.startswith("card.") for e in events)
    out = []
    for f in facts:
        if booked_today and f.category == "discipline" and "one more means" in f.short_text:
            # pre-match risk is superseded by today's booking (the live fact carries the current position)
            out.append(f.model_copy(update={"relevance": 0.2, "relevance_reason": "Pre-match; superseded today"}))
            continue
        best: tuple[float, str] | None = None
        for e in recent:
            if f.subject_kind == "player":
                about = e.player_id == subject_id or (e.type == "substitution" and e.payload.get("player_on_id")
                                                       == subject_id)
                rule = BOOSTS.get(e.type)
            else:
                about = e.team_id == subject_id or e.type in ("var.review_outcome",)
                rule = TEAM_BOOSTS.get(e.type)
            if not about or rule is None or f.category not in rule[0]:
                continue
            fresh = 1.0 - (now - e.elapsed_ms) / CONTEXT_WINDOW_MS
            score = min(0.99, f.relevance + 0.4 * fresh)
            if best is None or score > best[0]:
                best = (score, f"Relevant now: {rule[1]} at {e.display_clock}")
        out.append(f.model_copy(update={"relevance": round(best[0], 3), "relevance_reason": best[1]})
                   if best and best[0] > f.relevance else f)
    return out
