"""Verified insight (contracts/insight.schema.json v1.0.0) plus agent trace records."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

InsightStatus = Literal["pending", "verified", "tentative", "rejected", "retracted", "superseded"]
InsightType = Literal["repeated_channel_attack", "counterattack", "overlap", "pressure_change", "player_milestone",
                      "decision_explainer", "goal_story", "recap"]
Certainty = Literal["supported", "tentative", "insufficient"]


class Verification(BaseModel):
    model_config = ConfigDict(extra="forbid")
    verdict: Literal["approved", "needs_revision", "rejected"]
    issues: list[str] = Field(default_factory=list)
    checker_name: str
    agent_run_id: str | None = None


class StudioVariant(BaseModel):
    model_config = ConfigDict(extra="forbid")
    template_id: str
    headline: str = Field(max_length=80)
    subtitle: str = Field(max_length=140)
    requires_approval: Literal[True] = True


class AudienceVariants(BaseModel):
    model_config = ConfigDict(extra="forbid")
    commentator: str = Field(max_length=500)
    fan_discover: str = Field(max_length=400)
    fan_analyst: str = Field(max_length=900)
    studio: StudioVariant
    translations: dict[str, str] = Field(default_factory=dict)


class FrameInterval(BaseModel):
    model_config = ConfigDict(extra="forbid")
    start_ms: int = Field(ge=0)
    end_ms: int = Field(ge=0)


class Insight(BaseModel):
    model_config = ConfigDict(extra="forbid")
    schema_version: Literal["1.0.0"] = "1.0.0"
    insight_id: str = Field(min_length=2)
    match_id: str = Field(min_length=3)
    candidate_id: str = Field(min_length=2)
    version: int = Field(ge=1)
    status: InsightStatus
    insight_type: InsightType
    title: str = Field(min_length=3, max_length=110)
    canonical_claim: str = Field(min_length=3, max_length=600)
    why_it_matters: str = Field(min_length=3, max_length=800)
    uncertainty: str | None = Field(default=None, max_length=800)
    certainty: Certainty
    evidence_event_ids: list[str] = Field(min_length=1)
    frame_intervals: list[FrameInterval] = Field(default_factory=list)
    source_snapshot_seq: int = Field(ge=0)
    metric_provenance: dict[str, float | int | str | bool | None]
    verification: Verification
    audience_variants: AudienceVariants
    created_at_ms: int | None = Field(default=None, ge=0)
    expires_at_elapsed_ms: int | None = Field(default=None, ge=0)
    supersedes_insight_id: str | None = None
    retraction_reason: str | None = Field(default=None, max_length=500)

    @model_validator(mode="after")
    def _contract_rules(self) -> Insight:
        if len(set(self.evidence_event_ids)) != len(self.evidence_event_ids):
            raise ValueError("evidence_event_ids must be unique")
        if self.status == "verified":
            if self.verification.verdict != "approved":
                raise ValueError("verified insight requires approved verification")
            if self.certainty not in ("supported", "tentative"):
                raise ValueError("verified insight cannot be 'insufficient'")
        if self.status == "retracted" and not self.retraction_reason:
            raise ValueError("retracted insight requires retraction_reason")
        return self


class ToolCallRecord(BaseModel):
    name: str
    arguments: dict[str, Any]
    result_preview: str
    latency_ms: int
    prefetched: bool = False  # fetched deterministically into the brief (same tool, same bounds), not model-requested


class AgentStep(BaseModel):
    agent: Literal["investigator", "analyst", "verifier", "deterministic_validator", "translator", "recap_writer"]
    attempt: int = 1
    started_at: float
    latency_ms: int
    model_calls: int = 0
    input_tokens: int = 0
    output_tokens: int = 0
    response_ids: list[str] = Field(default_factory=list)
    tool_calls: list[ToolCallRecord] = Field(default_factory=list)
    output: dict[str, Any] | None = None
    error: str | None = None
    handoff_to: str | None = None


class AgentTrace(BaseModel):
    case_id: str
    candidate_id: str
    match_id: str
    provider: Literal["foundry", "mock_for_tests", "off"]
    model_deployment: str | None
    orchestration: str = "Microsoft Agent Framework WorkflowBuilder: investigator -> analyst -> verifier -> validator"
    stages: list[str] = Field(default_factory=list)
    steps: list[AgentStep] = Field(default_factory=list)
    outcome: str | None = None
    total_latency_ms: int = 0
    total_model_calls: int = 0
    total_tokens: int = 0
    cache_hit: bool = False
