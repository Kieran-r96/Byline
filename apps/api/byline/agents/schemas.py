"""Typed hand-off payloads between agents (structured outputs requested from the model)."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class ObservedFact(BaseModel):
    model_config = ConfigDict(extra="forbid")
    statement: str = Field(description="A plain factual statement observed in the events")
    event_ids: list[str] = Field(description="Event ids that directly show this fact")


class EvidenceDossier(BaseModel):
    """Investigator output."""

    model_config = ConfigDict(extra="forbid")
    candidate_finding: str = Field(description="One sentence: what the evidence shows, no causation")
    key_event_ids: list[str] = Field(description="Most relevant event ids, all retrieved via tools")
    observed_facts: list[ObservedFact]
    match_context: list[str] = Field(description="Relevant scoreline, clock, cards or personnel context")
    alternative_explanations: list[str]
    cannot_establish: list[str] = Field(description="Things the data cannot show (e.g. intent, off-ball positions)")


class DraftInsight(BaseModel):
    """Analyst output (and revised output)."""

    model_config = ConfigDict(extra="forbid")
    title: str = Field(description="Verb-led headline, max 10 words / 70 characters")
    canonical_claim: str = Field(description="The single factual claim, using only provided numbers")
    why_it_matters: str
    uncertainty: str = Field(description="What this does NOT establish")
    certainty: Literal["supported", "tentative", "insufficient"]
    evidence_event_ids: list[str]
    commentator: str = Field(description="Glanceable line for a live commentator, max 35 words")
    fan_discover: str = Field(description="Friendly plain-English explanation for a casual fan, max 30 words")
    fan_analyst: str = Field(description="Denser analyst explanation citing the metrics, max 90 words")
    studio_headline: str = Field(description="On-screen graphic headline, max 55 characters")
    studio_subtitle: str = Field(description="On-screen graphic subtitle, max 100 characters")


class ClaimCheck(BaseModel):
    model_config = ConfigDict(extra="forbid")
    claim: str
    supported: bool
    event_ids: list[str]
    note: str


class VerifierDecision(BaseModel):
    model_config = ConfigDict(extra="forbid")
    verdict: Literal["approved", "needs_revision", "rejected"]
    checks: list[ClaimCheck]
    issues: list[str]
    revision_instructions: str | None = None
