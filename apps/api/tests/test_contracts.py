"""T002: world/fixture/event contracts."""

from __future__ import annotations

import json

import jsonschema
import pytest
from pydantic import ValidationError

from byline.config import REPO_ROOT
from byline.events.models import MatchEvent
from byline.storage.fixtures import MatchPackage
from byline.world.clock import broadcast_clock, minute_label
from byline.world.models import Player, Team
from byline.world.seed_world import build_teams

SCHEMA = json.loads((REPO_ROOT / "contracts" / "match-event.schema.json").read_text(encoding="utf-8"))


def base(**over: object) -> dict[str, object]:
    ev: dict[str, object] = {
        "event_id": "E0001", "match_id": "BYLINE-01", "seq": 1, "elapsed_ms": 1000, "period": "H1",
        "team_id": "NBA", "player_id": "NBA-09", "type": "pass.completed",
        "payload": {"start": {"x_m": 50, "y_m": 30}, "end": {"x_m": 60, "y_m": 40}, "receiver_player_id": "NBA-10"},
    }
    ev.update(over)
    return ev


def test_fixture_events_validate_against_json_schema(golden: MatchPackage) -> None:
    validator = jsonschema.Draft202012Validator(SCHEMA)
    errors = [(e.event_id, list(validator.iter_errors(e.to_json_dict()))) for e in golden.events]
    assert [x for x in errors if x[1]] == []


def test_sample_fixture_validates(golden: MatchPackage) -> None:
    assert golden.world.fixture.synthetic is True
    assert golden.world.fixture.ruleset.ruleset_version == "IFAB-2026/27"
    assert {t.team_id for t in golden.world.teams} == {"NBA", "RVC"}
    assert all(len(t.players) >= 18 for t in golden.world.teams)


def test_invalid_coordinates_fail() -> None:
    with pytest.raises(ValidationError):
        MatchEvent.model_validate(base(payload={"start": {"x_m": 106, "y_m": 30}, "end": {"x_m": 60, "y_m": 40},
                                                "receiver_player_id": "NBA-10"}))
    with pytest.raises(ValidationError):
        MatchEvent.model_validate(base(payload={"start": {"x_m": 10, "y_m": -1}, "end": {"x_m": 60, "y_m": 40},
                                                "receiver_player_id": "NBA-10"}))


def test_pass_requires_actor_and_receiver() -> None:
    with pytest.raises(ValidationError):
        MatchEvent.model_validate(base(player_id=None))
    with pytest.raises(ValidationError):
        MatchEvent.model_validate(base(payload={"start": {"x_m": 50, "y_m": 30}, "end": {"x_m": 60, "y_m": 40}}))


def test_official_decisions_must_be_official_truth() -> None:
    with pytest.raises(ValidationError):
        MatchEvent.model_validate(base(type="goal.confirmed", payload={"goal_event_id": "E1",
                                                                      "decision_route": "on_field"}))
    ok = MatchEvent.model_validate(base(type="goal.confirmed", truth_status="official_synthetic",
                                        payload={"goal_event_id": "E1", "decision_route": "on_field"}))
    assert ok.truth_status == "official_synthetic"


def test_restart_requires_type_and_team() -> None:
    with pytest.raises(ValidationError):
        MatchEvent.model_validate(base(type="restart.awarded", team_id=None, player_id=None,
                                       truth_status="official_synthetic",
                                       payload={"restart_type": "free_kick", "awarded_to_team_id": "NBA",
                                                "location": {"x_m": 1, "y_m": 1}, "law_ref": "Law 13"}))


def test_events_are_immutable() -> None:
    ev = MatchEvent.model_validate(base())
    with pytest.raises(ValidationError):
        ev.seq = 5  # type: ignore[misc]


def test_unknown_fields_rejected() -> None:
    with pytest.raises(ValidationError):
        MatchEvent.model_validate(base(extra_field=1))


def test_team_rejects_foreign_or_duplicate_players() -> None:
    home, _ = build_teams()
    stranger = Player(player_id="RVC-99", team_id="RVC", shirt_number=99, given_name="A", family_name="B",
                      position="ST")
    with pytest.raises(ValidationError):
        Team.model_validate({**home.model_dump(), "players": [*home.model_dump()["players"], stranger.model_dump()]})
    dup = home.players[0].model_dump()
    with pytest.raises(ValidationError):
        Team.model_validate({**home.model_dump(), "players": [*home.model_dump()["players"], dup]})


@pytest.mark.parametrize(("period", "ms", "label", "clock"), [
    ("H1", 0, "1'", "00:00"),
    ("H1", 59_999, "1'", "00:59"),
    ("H1", 22 * 60_000 + 14_000, "23'", "22:14"),
    ("H1", 45 * 60_000 + 1, "45+1'", "45:00"),
    ("H1", 47 * 60_000 + 5_000, "45+3'", "47:05"),
    ("H2", 0, "46'", "45:00"),
    ("H2", 46 * 60_000, "90+2'", "91:00"),
    ("HT", 0, "HT", "HT"),
])
def test_clock_labels(period: str, ms: int, label: str, clock: str) -> None:
    assert minute_label(period, ms) == label
    assert broadcast_clock(period, ms) == clock
