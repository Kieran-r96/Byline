from __future__ import annotations

import os
from typing import Any

# Default test runs never reach a real model; the opt-in foundry_live test builds its own Settings.
os.environ["BYLINE_AI_PROVIDER"] = "off"
os.environ["BYLINE_AI_CACHE_ONLY"] = "false"  # tests must not depend on a developer's local .env

import pytest

from byline.events.models import MatchEvent
from byline.storage.fixtures import MatchPackage, load_package
from byline.world.models import ScenarioRef, World
from byline.world.seed_world import build_world


@pytest.fixture(autouse=True)
def _no_rate_limit(monkeypatch: pytest.MonkeyPatch) -> None:
    """The anonymous-client rate limiter is exercised by its own test; lift it for the rest."""
    import byline.api.app as app_module

    monkeypatch.setattr(app_module, "RATE_PER_S", 1e9)
    monkeypatch.setattr(app_module, "RATE_BURST", 1e9)
    app_module._buckets.clear()


@pytest.fixture(scope="session")
def golden() -> MatchPackage:
    return load_package("golden_story")


@pytest.fixture(scope="session")
def ordinary() -> MatchPackage:
    return load_package("ordinary_match")


@pytest.fixture()
def world() -> World:
    return build_world("T-MATCH", ScenarioRef(scenario_id="t", seed=1, version="t", title="t", description="t"))


class EventFactory:
    """Builds a minimal legal event stream for hand-written reducer/law tests."""

    def __init__(self, match_id: str = "T-MATCH") -> None:
        self.match_id = match_id
        self.seq = 0
        self.t = 0

    def __call__(self, etype: str, team: str | None = None, player: str | None = None, dt: int = 1000,
                 official: bool = False, period: str = "H1", **payload: Any) -> MatchEvent:
        self.t += dt
        ev = MatchEvent(
            event_id=f"X{self.seq:04d}", match_id=self.match_id, seq=self.seq, elapsed_ms=self.t, period=period,
            team_id=team, player_id=player, type=etype,  # type: ignore[arg-type]
            truth_status="official_synthetic" if official else "observed_synthetic", payload=payload,
        )
        self.seq += 1
        return ev


def pt(x: float, y: float) -> dict[str, float]:
    return {"x_m": x, "y_m": y}


def kickoff_stream(f: EventFactory, w: World) -> list[MatchEvent]:
    from byline.world.seed_world import bench, starting_slots

    evs = []
    for team in ("NBA", "RVC"):
        evs.append(f("lineup.confirmed", team, None, official=True, period="PRE", formation=w.team(team).formation,
                     starters=[{"player_id": p, "slot": s} for s, p in starting_slots(team).items()],
                     bench=bench(team)))
    evs.append(f("period.started", period="H1", attacking_direction={"NBA": "+x", "RVC": "-x"},
                 planned_added_minutes=2))
    evs.append(f("kickoff", "NBA", "NBA-09", location=pt(52.5, 34), reason="period_start"))
    return evs


@pytest.fixture()
def factory() -> EventFactory:
    return EventFactory()
