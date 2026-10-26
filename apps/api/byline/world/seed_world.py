"""Seeded fictional world. Every club, person and place here is invented for BYLINE."""

from __future__ import annotations

from byline.world.models import (
    Fixture,
    KitColours,
    Manager,
    Official,
    Player,
    Position,
    Ruleset,
    ScenarioRef,
    Team,
    World,
)

# (shirt, given, family, position, foot, starter_slot or None)
_NBA: list[tuple[int, str, str, Position, str, str | None]] = [
    (1, "Callum", "Hartwell", "GK", "right", "GK"),
    (2, "Dario", "Mensah-Lowe", "RB", "right", "RB"),
    (5, "Jonas", "Ekberg", "CB", "right", "RCB"),
    (6, "Remi", "Adeyemi-Clarke", "CB", "left", "LCB"),
    (3, "Felix", "Ward-Nakamura", "LB", "left", "LB"),
    (4, "Mateo", "Lindqvist", "DM", "right", "RDM"),
    (8, "Owen", "Achterberg", "CM", "right", "LDM"),
    (7, "Kofi", "Rennard", "RW", "left", "RW"),
    (10, "Luca", "Ferrandi", "AM", "right", "CAM"),
    (11, "Sami", "Haddad-Rhys", "LW", "right", "LW"),
    (9, "Nico", "Vantreight", "ST", "right", "ST"),
    (13, "Ben", "Oduya", "GK", "right", None),
    (15, "Tariq", "Belmonte", "CB", "right", None),
    (12, "Aled", "Pryce-Moreau", "RB", "right", None),
    (14, "Iker", "Solvang", "CM", "right", None),
    (16, "Joel", "Kastner", "DM", "left", None),
    (17, "Mika", "Thorne-Asante", "RW", "left", None),
    (19, "Rafael", "Domsky", "ST", "right", None),
    (20, "Theo", "Marchetti-Bose", "LW", "right", None),
    (22, "Yann", "Kovalenko", "AM", "left", None),
]

_RVC: list[tuple[int, str, str, Position, str, str | None]] = [
    (1, "Anders", "Moberg-Kale", "GK", "right", "GK"),
    (2, "Isaac", "Tremaine", "RB", "right", "RB"),
    (4, "Leon", "Fairweather", "CB", "right", "RCB"),
    (5, "Ruben", "Castellane", "CB", "left", "LCB"),
    (3, "Malik", "Osterholt", "LB", "left", "LB"),
    (6, "Gabriel", "Ndiaye-Shaw", "DM", "right", "DM"),
    (8, "Arlo", "Brennick", "CM", "right", "RCM"),
    (10, "Pavel", "Rostami", "CM", "left", "LCM"),
    (7, "Junior", "Okafor-Lisle", "RW", "left", "RW"),
    (11, "Enzo", "Villabrook", "LW", "right", "LW"),
    (9, "Marcus", "Delacroix-Hunt", "ST", "right", "ST"),
    (13, "Stefan", "Rowe", "GK", "right", None),
    (15, "Dominik", "Hale", "CB", "right", None),
    (12, "Ezra", "Quaye", "RB", "right", None),
    (14, "Hugo", "Ambrose", "CM", "right", None),
    (16, "Bastian", "Krell", "DM", "right", None),
    (17, "Silas", "Mbeki-Grant", "RW", "left", None),
    (19, "Jude", "Allardyce-Kim", "ST", "right", None),
    (20, "Mateus", "Corvin", "LW", "right", None),
    (18, "Noah", "Feldmann", "AM", "left", None),
]

# Base slot positions in the team's ATTACKING frame: ax 0 = own goal line, ay 0 = team's left touchline.
FORMATION_SLOTS: dict[str, dict[str, tuple[float, float]]] = {
    "4-2-3-1": {
        "GK": (5.0, 34.0), "RB": (31.0, 59.0), "RCB": (24.0, 43.0), "LCB": (24.0, 25.0), "LB": (31.0, 9.0),
        "RDM": (39.0, 41.0), "LDM": (39.0, 27.0), "RW": (58.0, 60.0), "CAM": (55.0, 34.0), "LW": (58.0, 8.0),
        "ST": (66.0, 34.0),
    },
    "4-3-3": {
        "GK": (5.0, 34.0), "RB": (31.0, 59.0), "RCB": (24.0, 43.0), "LCB": (24.0, 25.0), "LB": (31.0, 9.0),
        "DM": (37.0, 34.0), "RCM": (47.0, 45.0), "LCM": (47.0, 23.0), "RW": (63.0, 60.0), "LW": (63.0, 8.0),
        "ST": (68.0, 34.0),
    },
}

HOME_ID = "NBA"
AWAY_ID = "RVC"


def _squad(team_id: str, rows: list[tuple[int, str, str, Position, str, str | None]]) -> tuple[Player, ...]:
    return tuple(
        Player(
            player_id=f"{team_id}-{shirt:02d}",
            team_id=team_id,
            shirt_number=shirt,
            given_name=given,
            family_name=family,
            position=pos,
            preferred_foot="left" if foot == "left" else "right",
        )
        for shirt, given, family, pos, foot, _slot in rows
    )


def starting_slots(team_id: str) -> dict[str, str]:
    """slot -> player_id for the seeded starting XI."""
    rows = _NBA if team_id == HOME_ID else _RVC
    return {slot: f"{team_id}-{shirt:02d}" for shirt, *_rest, slot in rows if slot is not None}


def bench(team_id: str) -> list[str]:
    rows = _NBA if team_id == HOME_ID else _RVC
    return [f"{team_id}-{shirt:02d}" for shirt, *_rest, slot in rows if slot is None]


def build_teams() -> tuple[Team, Team]:
    home = Team(
        team_id=HOME_ID,
        name="Northbridge Athletic",
        short_name="Northbridge",
        code="NBA",
        kit=KitColours(primary="#8E1F3A", secondary="#F2E6D0", number="#F2E6D0", goalkeeper="#2F6B4F"),
        manager=Manager(manager_id="MGR-NBA", name="Marta Kovacevic-Hale"),
        stadium="The Ironworks",
        founded=1889,
        formation="4-2-3-1",
        players=_squad(HOME_ID, _NBA),
    )
    away = Team(
        team_id=AWAY_ID,
        name="Riverton City",
        short_name="Riverton",
        code="RVC",
        kit=KitColours(primary="#1F6FEB", secondary="#DCEBFF", number="#FFFFFF", goalkeeper="#E0A82E"),
        manager=Manager(manager_id="MGR-RVC", name="Duncan Arrowsmith"),
        stadium="Weir Lane",
        founded=1902,
        formation="4-3-3",
        players=_squad(AWAY_ID, _RVC),
    )
    return home, away


OFFICIALS = (
    Official(official_id="OFF-REF", name="Imogen Castell", role="referee"),
    Official(official_id="OFF-AR1", name="David Ruane", role="assistant_1"),
    Official(official_id="OFF-AR2", name="Priya Lomax", role="assistant_2"),
    Official(official_id="OFF-4TH", name="Owen Teale-Barker", role="fourth"),
    Official(official_id="OFF-VAR", name="Samuel Rourke", role="var"),
    Official(official_id="OFF-AVAR", name="Lena Fitch", role="avar"),
)


def build_world(match_id: str, scenario: ScenarioRef) -> World:
    home, away = build_teams()
    fixture = Fixture(
        match_id=match_id,
        competition="BYLINE Synthetic League (fictional)",
        kickoff_local="2026-10-24T17:30:00+01:00",
        timezone="Europe/London",
        venue="The Ironworks, Northbridge (fictional)",
        home_team_id=home.team_id,
        away_team_id=away.team_id,
        officials=OFFICIALS,
        ruleset=Ruleset(competition_modifiers={"substitution_windows_exclude_half_time": True}),
        scenario=scenario,
    )
    return World(fixture=fixture, teams=(home, away))
