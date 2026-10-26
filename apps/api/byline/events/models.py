"""Canonical immutable match-event envelope (contracts/match-event.schema.json v1.0.0).

Payloads are validated by per-type Pydantic models but stored as plain dicts so the
journal serialises byte-identically to the JSON contract.
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

SCHEMA_VERSION = "1.0.0"
PITCH_LENGTH_M = 105.0
PITCH_WIDTH_M = 68.0

Period = Literal["PRE", "H1", "HT", "H2", "FT", "ET1", "ET2", "PEN"]
Source = Literal["synthetic_fixture", "synthetic_generator", "derived_from_synthetic"]
TruthStatus = Literal["official_synthetic", "observed_synthetic", "derived", "model_interpretation"]
Direction = Literal["+x", "-x"]
RestartType = Literal[
    "direct_free_kick", "indirect_free_kick", "penalty", "corner", "goal_kick", "throw_in", "dropped_ball", "kickoff"
]

EventType = Literal[
    "fixture.created", "team_news.updated", "lineup.confirmed", "period.started", "kickoff", "period.ended",
    "match.finished", "pass.completed", "pass.failed", "carry", "ball_recovery", "turnover", "pressure",
    "challenge", "tackle", "interception", "shot", "save", "goal.provisional", "goal.confirmed",
    "goal.disallowed", "own_goal", "foul.committed", "advantage.applied", "advantage.recalled",
    "offside.position_detected", "offside.offence_confirmed", "card.yellow", "card.second_yellow", "card.red",
    "disciplinary.reviewed", "injury.stoppage", "restart.awarded", "restart.taken", "penalty.taken",
    "penalty.outcome", "substitution", "var.review_started", "var.review_outcome", "tracking.frame",
]


class Point(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")
    x_m: float = Field(ge=0, le=PITCH_LENGTH_M)
    y_m: float = Field(ge=0, le=PITCH_WIDTH_M)


# ---------------------------------------------------------------- typed payloads


class _Payload(BaseModel):
    model_config = ConfigDict(extra="allow", frozen=True)


class PeriodStartedPayload(_Payload):
    attacking_direction: dict[str, Direction]
    planned_added_minutes: int | None = None


class PeriodEndedPayload(_Payload):
    added_minutes: int = Field(ge=0, le=20)


class KickoffPayload(_Payload):
    location: Point
    reason: Literal["period_start", "after_goal"]


class LineupSlot(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")
    player_id: str
    slot: str


class LineupPayload(_Payload):
    formation: str
    starters: list[LineupSlot] = Field(min_length=11, max_length=11)
    bench: list[str]


class PassCompletedPayload(_Payload):
    start: Point
    end: Point
    receiver_player_id: str
    height: Literal["ground", "low", "high"] = "ground"
    pass_kind: Literal["open_play", "free_kick", "corner", "throw_in", "goal_kick", "kickoff", "cross"] = "open_play"
    under_pressure: bool = False


class PassFailedPayload(_Payload):
    start: Point
    end: Point
    intended_receiver_player_id: str | None = None
    outcome: Literal["intercepted", "out_of_play", "blocked", "overhit"]
    height: Literal["ground", "low", "high"] = "ground"
    pass_kind: Literal["open_play", "free_kick", "corner", "throw_in", "goal_kick", "kickoff", "cross"] = "open_play"


class CarryPayload(_Payload):
    start: Point
    end: Point


class LocatedPayload(_Payload):
    location: Point
    opponent_player_id: str | None = None


class ShotPayload(_Payload):
    location: Point
    end: Point
    # entered_goal: ball crossed the goal line but no goal can be awarded (e.g. untouched indirect free kick)
    outcome: Literal["goal", "saved", "off_target", "blocked", "woodwork", "entered_goal"]
    body_part: Literal["right_foot", "left_foot", "head", "other"] = "right_foot"
    situation: Literal["open_play", "free_kick", "penalty", "corner"] = "open_play"
    goalkeeper_id: str | None = None


class SavePayload(_Payload):
    location: Point
    shot_event_id: str
    held: bool


class GoalProvisionalPayload(_Payload):
    shot_event_id: str
    location: Point
    assist_player_id: str | None = None
    conceding_team_id: str


class GoalConfirmedPayload(_Payload):
    goal_event_id: str
    decision_route: Literal["on_field", "after_var_check"]


class GoalDisallowedPayload(_Payload):
    goal_event_id: str
    reason: Literal["offside", "foul", "handball", "ball_out_of_play", "indirect_free_kick_no_touch"]
    law_ref: str
    decision_route: Literal["on_field", "after_var_check", "after_on_field_review"]


Severity = Literal["careless", "reckless", "excessive_force"]


class FoulPayload(_Payload):
    location: Point
    victim_player_id: str | None = None
    foul_type: Literal[
        "trip", "kick", "push", "charge", "jump_at", "strike", "tackle", "hold", "handball", "impeding",
        "dangerous_play", "goalkeeper_possession",
    ]
    severity: Severity | None = None
    restart_type: Literal["direct_free_kick", "indirect_free_kick", "penalty"]
    in_offender_penalty_area: bool
    advantage_played: bool = False
    denied_goal_scoring_opportunity: bool = False
    stopped_promising_attack: bool = False
    attempted_to_play_ball: bool | None = None


class AdvantagePayload(_Payload):
    foul_event_id: str


class OffsidePositionPayload(_Payload):
    pass_event_id: str
    location: Point
    involved: bool
    second_last_defender_x_m: float
    note: str | None = None


class OffsideOffencePayload(_Payload):
    interference_type: Literal["interfering_with_play", "interfering_with_opponent", "gaining_advantage"]
    decision_event_id: str
    location: Point
    touch_nature: Literal["teammate_play", "rebound_from_post_or_keeper", "opponent_deflection"] = "teammate_play"


CardReason = Literal[
    "reckless_foul", "stopping_promising_attack", "dogso_attempt_to_play_ball", "dogso", "serious_foul_play",
    "violent_conduct", "second_caution", "unsporting_behaviour", "dissent", "delaying_restart",
]


class CardPayload(_Payload):
    reason: CardReason
    foul_event_id: str | None = None
    law_ref: str = "Law 12"


class DisciplinaryReviewedPayload(_Payload):
    card_event_id: str
    outcome: Literal["upheld", "rescinded", "upgraded"]


class RestartAwardedPayload(_Payload):
    restart_type: RestartType
    awarded_to_team_id: str
    location: Point
    reason_event_id: str | None = None
    law_ref: str


class RestartTakenPayload(_Payload):
    restart_type: RestartType
    location: Point


class PenaltyTakenPayload(_Payload):
    goalkeeper_id: str
    placement: Literal["bottom_left", "bottom_right", "top_left", "top_right", "centre"]
    location: Point


class PenaltyOutcomePayload(_Payload):
    penalty_event_id: str
    outcome: Literal["scored", "saved", "missed", "woodwork", "retake"]
    touch: Literal["normal", "accidental_double_touch", "deliberate_second_touch"] = "normal"


class SubstitutionPayload(_Payload):
    player_off_id: str
    player_on_id: str


class VarStartedPayload(_Payload):
    check_type: Literal["goal", "penalty", "direct_red_card", "mistaken_identity"]
    subject_event_id: str
    reason: str


class VarOutcomePayload(_Payload):
    subject_event_id: str
    recommendation: Literal["no_clear_error", "overturn"]
    on_field_review: bool
    final_decision: str


class InjuryPayload(_Payload):
    location: Point


class FinishedPayload(_Payload):
    final_score: dict[str, int]


PAYLOAD_MODELS: dict[str, type[_Payload]] = {
    "period.started": PeriodStartedPayload,
    "period.ended": PeriodEndedPayload,
    "kickoff": KickoffPayload,
    "lineup.confirmed": LineupPayload,
    "pass.completed": PassCompletedPayload,
    "pass.failed": PassFailedPayload,
    "carry": CarryPayload,
    "ball_recovery": LocatedPayload,
    "turnover": LocatedPayload,
    "pressure": LocatedPayload,
    "challenge": LocatedPayload,
    "tackle": LocatedPayload,
    "interception": LocatedPayload,
    "shot": ShotPayload,
    "save": SavePayload,
    "goal.provisional": GoalProvisionalPayload,
    "goal.confirmed": GoalConfirmedPayload,
    "goal.disallowed": GoalDisallowedPayload,
    "foul.committed": FoulPayload,
    "advantage.applied": AdvantagePayload,
    "advantage.recalled": AdvantagePayload,
    "offside.position_detected": OffsidePositionPayload,
    "offside.offence_confirmed": OffsideOffencePayload,
    "card.yellow": CardPayload,
    "card.second_yellow": CardPayload,
    "card.red": CardPayload,
    "disciplinary.reviewed": DisciplinaryReviewedPayload,
    "restart.awarded": RestartAwardedPayload,
    "restart.taken": RestartTakenPayload,
    "penalty.taken": PenaltyTakenPayload,
    "penalty.outcome": PenaltyOutcomePayload,
    "substitution": SubstitutionPayload,
    "var.review_started": VarStartedPayload,
    "var.review_outcome": VarOutcomePayload,
    "injury.stoppage": InjuryPayload,
    "match.finished": FinishedPayload,
}

# Types that must carry an acting team and player.
REQUIRES_ACTOR = {
    "pass.completed", "pass.failed", "carry", "ball_recovery", "interception", "tackle", "shot", "save",
    "goal.provisional", "foul.committed", "card.yellow", "card.second_yellow", "card.red", "penalty.taken",
    "offside.offence_confirmed", "offside.position_detected", "pressure", "challenge", "turnover",
}
REQUIRES_TEAM = REQUIRES_ACTOR | {
    "restart.taken", "substitution", "lineup.confirmed", "kickoff", "goal.confirmed", "goal.disallowed",
    "advantage.applied", "advantage.recalled", "penalty.outcome",
}
OFFICIAL_ONLY = {
    "goal.confirmed", "goal.disallowed", "offside.offence_confirmed", "card.yellow", "card.second_yellow",
    "card.red", "restart.awarded", "var.review_outcome", "disciplinary.reviewed", "foul.committed",
    "advantage.applied", "advantage.recalled", "penalty.outcome",
}


class MatchEvent(BaseModel):
    """Immutable event. Corrections are new events that reference earlier ids."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    schema_version: Literal["1.0.0"] = "1.0.0"
    event_id: str = Field(min_length=3, max_length=100, pattern=r"^[A-Za-z0-9][A-Za-z0-9_.:-]*$")
    match_id: str = Field(min_length=3, max_length=100)
    seq: int = Field(ge=0)
    elapsed_ms: int = Field(ge=0)
    period: Period
    display_clock: str | None = Field(default=None, max_length=30)
    team_id: str | None = None
    player_id: str | None = None
    type: EventType
    source: Source = "synthetic_generator"
    truth_status: TruthStatus = "observed_synthetic"
    correlation_id: str | None = Field(default=None, max_length=100)
    payload: dict[str, Any] = Field(default_factory=dict)
    supersedes_event_id: str | None = None

    @model_validator(mode="after")
    def _check(self) -> MatchEvent:
        model = PAYLOAD_MODELS.get(self.type)
        if model is not None:
            model.model_validate(self.payload)
        if self.type in REQUIRES_TEAM and not self.team_id:
            raise ValueError(f"{self.type} requires team_id")
        if self.type in REQUIRES_ACTOR and not self.player_id:
            raise ValueError(f"{self.type} requires player_id")
        if self.type in OFFICIAL_ONLY and self.truth_status != "official_synthetic":
            raise ValueError(f"{self.type} must be an official_synthetic decision")
        return self

    def typed_payload(self) -> Any:
        model = PAYLOAD_MODELS.get(self.type)
        return model.model_validate(self.payload) if model else self.payload

    def point(self, key: str = "location") -> Point | None:
        raw = self.payload.get(key)
        return Point.model_validate(raw) if raw is not None else None

    def to_json_dict(self) -> dict[str, Any]:
        return self.model_dump(mode="json")
