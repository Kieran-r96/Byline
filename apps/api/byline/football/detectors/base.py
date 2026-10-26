"""Shared detector contract: PatternCandidate."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

PatternType = Literal["repeated_channel_attack", "counterattack", "overlap", "pressure_change"]


class FrameInterval(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")
    start_ms: int = Field(ge=0)
    end_ms: int = Field(ge=0)


class PatternCandidate(BaseModel):
    """Deterministic detector output. Score is editorial priority, not a calibrated probability."""

    model_config = ConfigDict(frozen=True, extra="forbid")
    candidate_id: str
    match_id: str
    pattern_type: PatternType
    team_id: str
    detected_at_seq: int
    detected_at_ms: int
    display_clock: str
    window_start_ms: int
    window_end_ms: int
    evidence_event_ids: tuple[str, ...] = Field(min_length=1)
    frame_intervals: tuple[FrameInterval, ...] = ()
    calculated_metrics: dict[str, float | int | str | bool]
    score_components: dict[str, float]
    score: float
    confidence_band: Literal["supported", "tentative"]
    novelty_key: str
    factual_summary: str
    allowed_claims: tuple[str, ...]
    unsupported_claims: tuple[str, ...]
    explanation_constraints: tuple[str, ...]
    status: Literal["discovered", "retracted"] = "discovered"
    retraction_reason: str | None = None
