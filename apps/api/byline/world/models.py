"""Fictional world entities: clubs, players, officials, fixture and competition ruleset."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

Position = Literal["GK", "RB", "CB", "LB", "DM", "CM", "AM", "RW", "LW", "ST"]


class Player(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")
    player_id: str
    team_id: str
    shirt_number: int = Field(ge=1, le=99)
    given_name: str
    family_name: str
    position: Position
    preferred_foot: Literal["right", "left"] = "right"

    @property
    def display_name(self) -> str:
        return f"{self.given_name[0]}. {self.family_name}"


class Manager(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")
    manager_id: str
    name: str


class KitColours(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")
    primary: str = Field(pattern=r"^#[0-9A-Fa-f]{6}$")
    secondary: str = Field(pattern=r"^#[0-9A-Fa-f]{6}$")
    number: str = Field(pattern=r"^#[0-9A-Fa-f]{6}$")
    goalkeeper: str = Field(pattern=r"^#[0-9A-Fa-f]{6}$")


class Team(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")
    team_id: str = Field(min_length=2, max_length=8)
    name: str
    short_name: str
    code: str = Field(min_length=3, max_length=3)
    kit: KitColours
    manager: Manager
    stadium: str
    founded: int
    formation: str
    players: tuple[Player, ...]

    @model_validator(mode="after")
    def _players_belong(self) -> Team:
        ids = [p.player_id for p in self.players]
        if len(ids) != len(set(ids)):
            raise ValueError(f"duplicate player ids in {self.team_id}")
        numbers = [p.shirt_number for p in self.players]
        if len(numbers) != len(set(numbers)):
            raise ValueError(f"duplicate shirt numbers in {self.team_id}")
        for p in self.players:
            if p.team_id != self.team_id:
                raise ValueError(f"player {p.player_id} not in team {self.team_id}")
        return self


class Official(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")
    official_id: str
    name: str
    role: Literal["referee", "assistant_1", "assistant_2", "fourth", "var", "avar"]


class Ruleset(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")
    ruleset_version: Literal["IFAB-2026/27"] = "IFAB-2026/27"
    competition_modifiers: dict[str, str | int | bool] = Field(default_factory=dict)
    max_substitutions: int = 5
    substitution_windows: int = 3
    var_in_use: bool = True
    yellow_accumulation_dismissal: int = 2
    period_minutes: int = 45


class ScenarioRef(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")
    scenario_id: str
    seed: int
    version: str
    title: str
    description: str


class Fixture(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")
    match_id: str
    competition: str
    kickoff_local: str
    timezone: str
    venue: str
    home_team_id: str
    away_team_id: str
    officials: tuple[Official, ...]
    ruleset: Ruleset
    scenario: ScenarioRef
    synthetic: Literal[True] = True
    data_notice: str = "Synthetic data. Fictional clubs, players and officials. Seeded scenario."


class World(BaseModel):
    """Everything static about a match: fixture plus both squads."""

    model_config = ConfigDict(frozen=True, extra="forbid")
    fixture: Fixture
    teams: tuple[Team, Team]

    @model_validator(mode="after")
    def _teams_match_fixture(self) -> World:
        ids = {t.team_id for t in self.teams}
        if ids != {self.fixture.home_team_id, self.fixture.away_team_id}:
            raise ValueError("fixture teams do not match squads")
        return self

    def team(self, team_id: str) -> Team:
        for t in self.teams:
            if t.team_id == team_id:
                return t
        raise KeyError(team_id)

    def player(self, player_id: str) -> Player:
        for t in self.teams:
            for p in t.players:
                if p.player_id == player_id:
                    return p
        raise KeyError(player_id)

    def has_player(self, player_id: str) -> bool:
        return any(p.player_id == player_id for t in self.teams for p in t.players)

    @property
    def home(self) -> Team:
        return self.team(self.fixture.home_team_id)

    @property
    def away(self) -> Team:
        return self.team(self.fixture.away_team_id)

    def opponent_of(self, team_id: str) -> str:
        return self.fixture.away_team_id if team_id == self.fixture.home_team_id else self.fixture.home_team_id
