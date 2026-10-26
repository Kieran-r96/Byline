"""Match clocks never run backwards: every event's displayed minute is >= the one before it in its period."""

from __future__ import annotations

import re

import pytest

from byline.events.models import MatchEvent
from byline.simulation.generate import generate
from byline.simulation.scenarios import SCENARIOS
from byline.storage.fixtures import available_scenarios, load_package

MINUTE = re.compile(r"(\d+)(?:\+(\d+))?'")


def regressions(events: list[MatchEvent]) -> list[str]:
    best: dict[str, tuple[int, int]] = {}
    out = []
    for e in events:
        m = MINUTE.fullmatch(e.display_clock or "")
        if m is None:
            continue
        k = (int(m[1]), int(m[2] or 0))
        if e.period in best and k < best[e.period]:
            out.append(f"{e.event_id} {e.type} {e.display_clock} after {best[e.period]}")
        best[e.period] = max(best.get(e.period, k), k)
    return out


@pytest.mark.parametrize("scenario", available_scenarios())
def test_committed_fixtures_are_chronological(scenario: str) -> None:
    pkg = load_package(scenario)
    assert regressions(list(pkg.events)) == []
    ends = [e for e in pkg.events if e.type == "period.ended"]
    for end in ends:  # the whistle is the last event of its period and never precedes the play
        last_play = max(e.elapsed_ms for e in pkg.events if e.period == end.period and e.type != "period.ended")
        assert end.elapsed_ms >= last_play


@pytest.mark.parametrize("seed", [11, 22])
def test_generated_matches_are_chronological(seed: int) -> None:
    for scen in ("golden_story", "ordinary_match"):
        g = generate(SCENARIOS[scen], seed=seed)
        assert regressions([MatchEvent.model_validate(e) for e in g.events]) == []
