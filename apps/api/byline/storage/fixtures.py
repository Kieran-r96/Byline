"""Load checked-in synthetic match packages (world + events + tracking)."""

from __future__ import annotations

import gzip
import hashlib
import json
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any

from byline.config import FIXTURE_DIR
from byline.events.models import MatchEvent
from byline.world.models import World


@dataclass(frozen=True)
class MatchPackage:
    scenario_id: str
    world: World
    events: tuple[MatchEvent, ...]
    tracking: dict[str, Any]
    events_sha256: str

    @property
    def match_id(self) -> str:
        return self.world.fixture.match_id


def available_scenarios(fixture_dir: Path = FIXTURE_DIR) -> list[str]:
    return sorted(p.name.removesuffix(".events.jsonl") for p in fixture_dir.glob("*.events.jsonl"))


@lru_cache(maxsize=8)
def load_package(scenario_id: str, fixture_dir: Path = FIXTURE_DIR) -> MatchPackage:
    raw = (fixture_dir / f"{scenario_id}.events.jsonl").read_bytes()
    events = tuple(MatchEvent.model_validate_json(line) for line in raw.splitlines() if line.strip())
    world = World.model_validate_json((fixture_dir / f"{scenario_id}.world.json").read_text(encoding="utf-8"))
    with gzip.open(fixture_dir / f"{scenario_id}.tracking.json.gz", "rb") as fh:
        tracking = json.loads(fh.read())
    return MatchPackage(scenario_id, world, events, tracking, hashlib.sha256(raw).hexdigest())


def package_for_match(match_id: str) -> MatchPackage:
    for sid in available_scenarios():
        pkg = load_package(sid)
        if pkg.match_id == match_id:
            return pkg
    raise KeyError(match_id)
