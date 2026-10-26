"""Deterministic record and streak computations over ``ClubMatch`` sequences (oldest first).

Every function is pure and states its rule. They work on any sequence of matches, so the same code runs
on the fictional history, on hand-made test sequences, or on history plus a hypothetical result today.
"""

from __future__ import annotations

import datetime as dt
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from typing import Literal

from byline.world.history import ClubMatch, Result

StreakKind = Literal["winning", "unbeaten", "losing", "winless", "scoring", "clean_sheet"]
Scope = Literal["all", "league"]
Where = Literal["any", "home", "away"]

STREAK_TEST: dict[StreakKind, Callable[[ClubMatch], bool]] = {
    "winning": lambda m: m.result == "W",
    "unbeaten": lambda m: m.result != "L",
    "losing": lambda m: m.result == "L",
    "winless": lambda m: m.result != "W",
    "scoring": lambda m: m.goals_for > 0,
    "clean_sheet": lambda m: m.goals_against == 0,
}
STREAK_RULE: dict[StreakKind, str] = {
    "winning": "consecutive wins",
    "unbeaten": "consecutive matches without defeat",
    "losing": "consecutive defeats",
    "winless": "consecutive matches without a win",
    "scoring": "consecutive matches with at least one goal",
    "clean_sheet": "consecutive matches without conceding",
}
SCOPE_RULE: dict[Scope, str] = {"all": "league + cup", "league": "league only"}
APPEARANCE_MARKS = (50, 100, 150, 200, 250, 300)
GOAL_MARKS = (25, 50, 100, 150, 200)
DERBY_GOAL_MARKS = (1, 5, 10, 15, 20)


def select(matches: Sequence[ClubMatch], scope: Scope = "all", where: Where = "any",
           derby_only: bool = False) -> list[ClubMatch]:
    return [m for m in matches if (scope == "all" or m.is_league) and (where == "any" or m.venue == where)
            and (not derby_only or m.is_derby)]


def describe(kind: StreakKind, scope: Scope, where: Where = "any") -> str:
    venue = "" if where == "any" else f", {where} matches only"
    return f"{SCOPE_RULE[scope]}{venue}, {STREAK_RULE[kind]}"


@dataclass(frozen=True)
class Streak:
    kind: StreakKind
    length: int
    since: str | None  # date of the first match of the run


def current_streak(matches: Sequence[ClubMatch], kind: StreakKind) -> Streak:
    """Length of the run of `kind` that includes the most recent match (0 if the last match breaks it)."""
    test = STREAK_TEST[kind]
    n = 0
    for m in reversed(matches):
        if not test(m):
            break
        n += 1
    return Streak(kind, n, matches[len(matches) - n].date if n else None)


def runs(matches: Sequence[ClubMatch], kind: StreakKind) -> list[tuple[int, int]]:
    """Maximal runs of `kind` as (start index, end index) inclusive, oldest first."""
    test = STREAK_TEST[kind]
    out: list[tuple[int, int]] = []
    start: int | None = None
    for i, m in enumerate(matches):
        if test(m):
            start = i if start is None else start
        elif start is not None:
            out.append((start, i - 1))
            start = None
    if start is not None:
        out.append((start, len(matches) - 1))
    return out


def previous_run_at_least(matches: Sequence[ClubMatch], kind: StreakKind, length: int) -> ClubMatch | None:
    """The last match of the most recent EARLIER run (not the current one) of `kind` with at least `length`
    matches; None if no such run exists in the sequence."""
    rs = runs(matches, kind)
    if rs and rs[-1][1] == len(matches) - 1:
        rs = rs[:-1]
    for start, end in reversed(rs):
        if end - start + 1 >= length:
            return matches[end]
    return None


def longest_run(matches: Sequence[ClubMatch], kind: StreakKind) -> int:
    return max((e - s + 1 for s, e in runs(matches, kind)), default=0)


def form(matches: Sequence[ClubMatch], n: int = 5) -> str:
    """Last n results, newest LAST, e.g. 'W D W L W'."""
    return " ".join(m.result for m in matches[-n:])


@dataclass(frozen=True)
class Record:
    played: int
    won: int
    drawn: int
    lost: int
    goals_for: int
    goals_against: int

    def short(self) -> str:
        return f"P{self.played} W{self.won} D{self.drawn} L{self.lost}"


def record(matches: Sequence[ClubMatch]) -> Record:
    res = [m.result for m in matches]
    return Record(len(res), res.count("W"), res.count("D"), res.count("L"), sum(m.goals_for for m in matches),
                  sum(m.goals_against for m in matches))


def last_with(matches: Sequence[ClubMatch], result: Result) -> ClubMatch | None:
    return next((m for m in reversed(matches) if m.result == result), None)


def _size(gf: int, ga: int, result: Result) -> tuple[int, int]:
    """(margin, tie-break goals): a win's size uses goals scored, a defeat's uses goals conceded."""
    return (abs(gf - ga), gf if result == "W" else ga)


def biggest(matches: Sequence[ClubMatch], result: Literal["W", "L"]) -> ClubMatch | None:
    """Biggest win/defeat: largest margin, tie-break most goals (scored for a win, conceded for a defeat),
    then the most recent."""
    best: ClubMatch | None = None
    for m in matches:
        if m.result == result and (best is None or _size(m.goals_for, m.goals_against, result)
                                   >= _size(best.goals_for, best.goals_against, result)):
            best = m
    return best


@dataclass(frozen=True)
class Comparison:
    result: Literal["W", "L"]
    margin: int
    goals: int
    previous: ClubMatch | None  # most recent earlier match at least as big (None: biggest in the sequence)
    matches_since: int  # eligible matches after `previous` (or all of them)


def compare_scoreline(history: Sequence[ClubMatch], goals_for: int, goals_against: int) -> Comparison | None:
    """Would this scoreline (today) be the biggest win/defeat since some date? An earlier match counts as at
    least as big if its margin is larger, or equal with at least as many goals (scored for a win, conceded for
    a defeat). Draws return None."""
    if goals_for == goals_against:
        return None
    result: Literal["W", "L"] = "W" if goals_for > goals_against else "L"
    size = _size(goals_for, goals_against, result)
    for i in range(len(history) - 1, -1, -1):
        m = history[i]
        if m.result == result and _size(m.goals_for, m.goals_against, result) >= size:
            return Comparison(result, size[0], size[1], m, len(history) - 1 - i)
    return Comparison(result, size[0], size[1], None, len(history))


def first_since(history: Sequence[ClubMatch], result: Result) -> tuple[ClubMatch | None, int] | None:
    """If today's match had `result`: the most recent earlier match with that result and how many matches
    came in between without it. None when the previous match already had it (so it is not a 'first since')
    or when history is empty."""
    if not history or history[-1].result == result:
        return None
    gap = 0
    for m in reversed(history):
        if m.result == result:
            return m, gap
        gap += 1
    return None, gap


def milestones_crossed(before: int, after: int, marks: Sequence[int]) -> list[int]:
    """Marks reached by going from `before` to `after` (e.g. 99 -> 100 crosses 100)."""
    return [m for m in marks if before < m <= after]


def days_between(a: str, b: str) -> int:
    return abs((dt.date.fromisoformat(b) - dt.date.fromisoformat(a)).days)
