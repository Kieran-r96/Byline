"""Investigator -> Analyst -> Verifier (-> one revision) -> deterministic validator.

Built as a Microsoft Agent Framework workflow graph: each role is an Executor wrapping its own
Agent (separate instructions, tools and structured output type). The typed InvestigationCase
travels along the edges; the verifier's conditional edge either loops back to the analyst
once or proceeds to finalisation. Agents never write match state: they return findings that
this module turns into a contract-valid Insight.
"""

from __future__ import annotations

import json
import os
import time
import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import Any, Literal, TypeVar

from agent_framework import (
    Agent,
    ChatContext,
    Executor,
    WorkflowBuilder,
    WorkflowContext,
    chat_middleware,
    handler,
)
from pydantic import BaseModel, ValidationError

from byline.agents import prompts
from byline.agents.budget import BudgetExceeded, BudgetGuard
from byline.agents.provider import redact
from byline.agents.schemas import DraftInsight, EvidenceDossier, VerifierDecision
from byline.agents.subject import TacticalSubject
from byline.agents.tools import CaseTools
from byline.agents.validator import validate_draft, validate_tactical_draft
from byline.events.models import MatchEvent
from byline.football.detectors.base import PatternCandidate
from byline.stories.models import (
    AgentStep,
    AgentTrace,
    AudienceVariants,
    FrameInterval,
    Insight,
    StudioVariant,
    Verification,
)
from byline.world.models import World

M = TypeVar("M", bound=BaseModel)
Stage = Literal["queued", "investigating", "analysing", "verifying", "validating", "verified", "tentative",
                "rejected", "failed"]
StageCallback = Callable[[str, Stage], Awaitable[None]]

TEMPLATES = {
    "repeated_channel_attack": "channel_pressure",
    "counterattack": "transition_breakdown",
    "overlap": "channel_pressure",
    "pressure_change": "channel_pressure",
}
INSIGHT_TTL_MS = 15 * 60_000
# gpt-4.1-mini global standard list price (Azure retail prices API, checked 2026-10-21), for estimates only
USD_PER_M_INPUT, USD_PER_M_OUTPUT = 0.40, 1.60


def log_call(record: dict[str, Any]) -> None:
    """Append one real model request to BYLINE_CALL_LOG (JSONL) when set: latency, tokens, success, cost."""
    path = os.environ.get("BYLINE_CALL_LOG")
    if not path:
        return
    tin, tout = int(record.get("input_tokens", 0)), int(record.get("output_tokens", 0))
    record["est_cost_usd"] = round(tin / 1e6 * USD_PER_M_INPUT + tout / 1e6 * USD_PER_M_OUTPUT, 6)
    with open(path, "a", encoding="utf-8") as fh:
        fh.write(json.dumps(record) + "\n")


@dataclass(frozen=True)
class CaseProfile:
    """What differs between case types: role instructions and how the evidence bundle is described.
    The workflow, budget, tools, verifier and validator discipline are shared."""

    noun: str
    bundle: str
    investigator: str
    analyst: str
    verifier: str


DETECTOR_PROFILE = CaseProfile("detector candidate", "detector metrics, evidence events, match context",
                               prompts.INVESTIGATOR, prompts.ANALYST, prompts.VERIFIER)
TACTICAL_PROFILE = CaseProfile("tactical moment", "moment facts and measured alternatives, evidence events, "
                               "match context", prompts.TACTICAL_INVESTIGATOR, prompts.TACTICAL_ANALYST,
                               prompts.TACTICAL_VERIFIER)


@dataclass
class InvestigationCase:
    case_id: str
    session_id: str
    candidate: PatternCandidate | TacticalSubject
    tools: CaseTools
    trace: AgentTrace
    dossier: EvidenceDossier | None = None
    draft: DraftInsight | None = None
    decision: VerifierDecision | None = None
    validator_issues: list[str] = field(default_factory=list)
    revisions: int = 0
    next: Literal["revise", "finalize"] = "finalize"
    insight: Insight | None = None
    tokens: int = 0
    error: str | None = None
    profile: CaseProfile = DETECTOR_PROFILE
    # one record per real model request (role, latency, tokens, response id, ledger slot): provenance
    call_records: list[dict[str, Any]] = field(default_factory=list)


class AgentRunner:
    """Runs one role's Agent with budget charging, usage capture and one JSON-repair retry."""

    def __init__(self, client: Any, budget: BudgetGuard, deployment: str | None,
                 on_stage: StageCallback | None = None) -> None:
        self.client = client
        self.budget = budget
        self.deployment = deployment
        self.on_stage = on_stage

    async def stage(self, case: InvestigationCase, stage: Stage) -> None:
        case.trace.stages.append(stage)
        if self.on_stage is not None:
            await self.on_stage(case.candidate.candidate_id, stage)

    async def run(self, case: InvestigationCase, role: Literal["investigator", "analyst", "verifier"],
                  instructions: str, message: str, out_type: type[M], tools: list[Any],
                  tool_calls_from: int | None = None) -> M:
        step = AgentStep(agent=role, attempt=case.revisions + 1, started_at=time.time(), latency_ms=0)
        calls_before = len(case.tools.calls) if tool_calls_from is None else tool_calls_from
        runner = self

        @chat_middleware
        async def meter(context: ChatContext, call_next: Callable[[], Awaitable[None]]) -> None:
            runner.budget.charge(case.session_id, case.tokens)
            slot = runner.budget.ledger.last_slot if runner.budget.ledger is not None else None
            started = time.time()
            t0 = time.perf_counter()
            try:
                await call_next()
            except Exception as exc:
                runner.budget.record(False, int((time.perf_counter() - t0) * 1000))
                failed = {"t": time.time(), "case_id": case.case_id, "candidate_id": case.candidate.candidate_id,
                          "role": role, "attempt": step.attempt, "ok": False,
                          "latency_ms": int((time.perf_counter() - t0) * 1000), "error": type(exc).__name__}
                case.call_records.append({**failed, "started_at": started, "ledger_slot": slot})
                log_call(failed)
                raise
            ms = int((time.perf_counter() - t0) * 1000)
            res = context.result
            usage = getattr(res, "usage_details", None) or {}
            tin = int(usage.get("input_token_count") or 0)
            tout = int(usage.get("output_token_count") or 0)
            step.model_calls += 1
            step.input_tokens += tin
            step.output_tokens += tout
            case.tokens += tin + tout
            rid = getattr(res, "response_id", None)
            if rid:
                step.response_ids.append(str(rid))
            runner.budget.record(True, ms, tin + tout)
            done = {"t": time.time(), "case_id": case.case_id, "candidate_id": case.candidate.candidate_id,
                    "role": role, "attempt": step.attempt, "ok": True, "latency_ms": ms, "input_tokens": tin,
                    "output_tokens": tout, "response_id": str(rid) if rid else None}
            case.call_records.append({**done, "started_at": started, "ledger_slot": slot})
            log_call(done)

        agent = Agent(self.client, instructions, name=role, tools=tools or None, middleware=[meter])
        t0 = time.perf_counter()
        try:
            try:
                resp = await agent.run(message, options={"response_format": out_type, "temperature": 0.1})
                value = resp.value
            except (ValidationError, ValueError) as exc:
                if isinstance(exc, BudgetExceeded):
                    raise
                # AI-06: one bounded repair attempt, then fail closed
                repair = (f"{message}\n\nYour previous reply was not valid for the required JSON schema "
                          f"({type(exc).__name__}). Reply again with only valid JSON.")
                resp = await agent.run(repair, options={"response_format": out_type, "temperature": 0.0})
                value = resp.value
            if not isinstance(value, out_type):
                raise ValueError(f"{role} returned no structured output")
            step.output = value.model_dump(mode="json")
            return value
        except Exception as exc:
            step.error = redact(exc)
            raise
        finally:
            step.latency_ms = int((time.perf_counter() - t0) * 1000)
            step.tool_calls = case.tools.calls[calls_before:]
            case.trace.steps.append(step)


def _brief(case: InvestigationCase) -> str:
    c = case.candidate
    if isinstance(c, TacticalSubject):
        return json.dumps({
            "case_id": case.case_id, "moment_id": c.moment_id, "kind": c.pattern_type, "team_id": c.team_id,
            "title": c.title, "detected_at": c.display_clock, "factual_summary": c.factual_summary,
            "evidence_event_ids": list(c.evidence_event_ids), "players_in_moment": c.facts.get("players_in_moment"),
            "allowed_claims": list(c.allowed_claims), "unsupported_claims": list(c.unsupported_claims),
            "constraints": list(c.explanation_constraints),
        }, indent=1)
    return json.dumps({
        "case_id": case.case_id, "candidate_id": c.candidate_id, "pattern_type": c.pattern_type, "team_id": c.team_id,
        "detected_at": c.display_clock, "factual_summary": c.factual_summary,
        "evidence_event_ids": list(c.evidence_event_ids), "allowed_claims": list(c.allowed_claims),
        "unsupported_claims": list(c.unsupported_claims),
    }, indent=1)


# Role messages (shared by the workflow and the operator tools' prompt-size plans, so a plan sizes the real thing)


def investigator_message(case: InvestigationCase, bundle: str) -> str:
    p = case.profile
    return (f"Investigate this {p.noun} and return an EvidenceDossier.\n" + _brief(case)
            + f"\n\nPre-fetched evidence ({p.bundle}):\n" + bundle)


def analyst_message(case: InvestigationCase) -> str:
    assert case.dossier is not None
    metrics = json.dumps(case.candidate.calculated_metrics)
    msg = (f"Case brief:\n{_brief(case)}\n\nAuthoritative metrics: {metrics}\n\n"
           f"Investigator dossier:\n{case.dossier.model_dump_json(indent=1)}")
    if case.revisions > 0 and (case.decision or case.validator_issues):
        issues = (case.decision.issues if case.decision else []) + case.validator_issues
        msg += "\n\nPrevious draft:\n" + (case.draft.model_dump_json(indent=1) if case.draft else "{}")
        msg += "\n\n" + prompts.revision_note(issues, case.decision.revision_instructions if case.decision
                                              else None)
    return msg


def verifier_message(case: InvestigationCase, bundle: str) -> str:
    assert case.draft is not None
    return (f"Case brief:\n{_brief(case)}\n\nDraft to verify:\n{case.draft.model_dump_json(indent=1)}"
            f"\n\nIndependently fetched for you (authoritative metrics, the draft's cited events, match context):"
            f"\n{bundle}")


class InvestigatorExecutor(Executor):
    def __init__(self, runner: AgentRunner) -> None:
        super().__init__(id="investigator")
        self.runner = runner

    @handler
    async def investigate(self, case: InvestigationCase, ctx: WorkflowContext[InvestigationCase]) -> None:
        await self.runner.stage(case, "investigating")
        start = len(case.tools.calls)
        bundle = case.tools.prefetch(list(case.candidate.evidence_event_ids), context=True)
        case.dossier = await self.runner.run(
            case, "investigator", case.profile.investigator, investigator_message(case, bundle),
            EvidenceDossier, case.tools.investigator_extra_tools(), tool_calls_from=start)
        case.trace.steps[-1].handoff_to = "analyst"
        await ctx.send_message(case)


class AnalystExecutor(Executor):
    def __init__(self, runner: AgentRunner) -> None:
        super().__init__(id="analyst")
        self.runner = runner

    @handler
    async def analyse(self, case: InvestigationCase, ctx: WorkflowContext[InvestigationCase]) -> None:
        assert case.dossier is not None
        await self.runner.stage(case, "analysing")
        case.draft = await self.runner.run(case, "analyst", case.profile.analyst, analyst_message(case),
                                           DraftInsight, [])
        case.trace.steps[-1].handoff_to = "verifier"
        await ctx.send_message(case)


class VerifierExecutor(Executor):
    def __init__(self, runner: AgentRunner, world: World, known_events: dict[str, MatchEvent],
                 state: dict[str, Any]) -> None:
        super().__init__(id="verifier")
        self.runner = runner
        self.world = world
        self.known = known_events
        self.state = state

    @handler
    async def verify(self, case: InvestigationCase, ctx: WorkflowContext[InvestigationCase]) -> None:
        assert case.draft is not None
        await self.runner.stage(case, "verifying")
        start = len(case.tools.calls)
        # fetched fresh for the verifier from the draft's own citations, independent of the investigator's dossier
        bundle = case.tools.prefetch(list(dict.fromkeys(case.draft.evidence_event_ids)), context=True)
        case.decision = await self.runner.run(case, "verifier", case.profile.verifier,
                                              verifier_message(case, bundle), VerifierDecision,
                                              [], tool_calls_from=start)  # everything it checks is attached
        await self.runner.stage(case, "validating")
        t0 = time.perf_counter()
        if isinstance(case.candidate, TacticalSubject):
            case.validator_issues = validate_tactical_draft(case.draft, case.candidate, self.known,
                                                            case.tools.fetched_ids, self.state, self.world)
        else:
            case.validator_issues = validate_draft(case.draft, case.candidate, self.known, case.tools.fetched_ids,
                                                   self.state, self.world,
                                                   tracking_used=case.tools.tracking is not None)
        case.trace.steps.append(AgentStep(
            agent="deterministic_validator", attempt=case.revisions + 1, started_at=time.time(),
            latency_ms=int((time.perf_counter() - t0) * 1000),
            output={"issues": case.validator_issues, "verifier_verdict": case.decision.verdict},
        ))
        clean = not case.validator_issues
        if case.decision.verdict == "approved" and clean:
            case.next = "finalize"
        elif case.revisions == 0 and case.decision.verdict != "rejected":
            case.revisions += 1
            case.next = "revise"
            case.trace.steps[-1].handoff_to = "analyst (revision)"
        elif case.revisions == 0 and case.decision.verdict == "rejected" and clean:
            # verifier rejected but nothing deterministic is wrong: still allow the single revision
            case.revisions += 1
            case.next = "revise"
            case.trace.steps[-1].handoff_to = "analyst (revision)"
        else:
            case.next = "finalize"
        await ctx.send_message(case)


class FinalizeExecutor(Executor):
    def __init__(self) -> None:
        super().__init__(id="finalize")

    @handler
    async def finalize(self, case: InvestigationCase, ctx: WorkflowContext[Any, InvestigationCase]) -> None:
        assert case.draft is not None and case.decision is not None
        if isinstance(case.candidate, TacticalSubject):
            # tactical results are built by byline.agents.tactical from the draft, decision and validator issues
            await ctx.yield_output(case)
            return
        approved = case.decision.verdict == "approved" and not case.validator_issues
        if approved:
            case.insight = insight_from_draft(case)
        else:
            issues = case.decision.issues + case.validator_issues
            case.insight = deterministic_insight(case.candidate, reason="ai_rejected", issues=issues,
                                                 run_id=case.case_id)
        await ctx.yield_output(case)


def build_workflow(runner: AgentRunner, world: World, known: dict[str, MatchEvent], state: dict[str, Any]) -> Any:
    inv = InvestigatorExecutor(runner)
    ana = AnalystExecutor(runner)
    ver = VerifierExecutor(runner, world, known, state)
    fin = FinalizeExecutor()
    return (
        WorkflowBuilder(max_iterations=12, name="byline-investigation", start_executor=inv)
        .add_edge(inv, ana)
        .add_edge(ana, ver)
        .add_edge(ver, ana, condition=lambda c: isinstance(c, InvestigationCase) and c.next == "revise")
        .add_edge(ver, fin, condition=lambda c: isinstance(c, InvestigationCase) and c.next == "finalize")
        .build()
    )


def open_case(candidate: PatternCandidate | TacticalSubject, *, session_id: str, world: World,
              events: tuple[MatchEvent, ...], state: dict[str, Any], provider: str, deployment: str | None,
              prior_titles: list[str], tracking: dict[str, Any] | None = None) -> InvestigationCase:
    case_id = f"C-{candidate.candidate_id}-{uuid.uuid4().hex[:6]}"
    tools = CaseTools(world=world, events=events, snapshot_seq=candidate.detected_at_seq, candidate=candidate,
                      state_snapshot=state, prior_insight_titles=prior_titles, tracking=tracking)
    trace = AgentTrace(case_id=case_id, candidate_id=candidate.candidate_id, match_id=candidate.match_id,
                       provider=provider, model_deployment=deployment)
    profile = TACTICAL_PROFILE if isinstance(candidate, TacticalSubject) else DETECTOR_PROFILE
    return InvestigationCase(case_id=case_id, session_id=session_id, candidate=candidate, tools=tools, trace=trace,
                             profile=profile)


async def run_workflow(case: InvestigationCase, *, world: World, events: tuple[MatchEvent, ...],
                       state: dict[str, Any], client: Any, budget: BudgetGuard,
                       on_stage: StageCallback | None = None) -> tuple[InvestigationCase, float]:
    """Runs the shared workflow; model, network and budget failures are captured in case.error, never raised.
    Returns the case and the perf-counter start (for the caller's total latency)."""
    runner = AgentRunner(client, budget, case.trace.model_deployment, on_stage)
    known = {e.event_id: e for e in events if e.seq <= case.candidate.detected_at_seq}
    t0 = time.perf_counter()
    await runner.stage(case, "queued")
    try:
        async with budget.semaphore:
            wf = build_workflow(runner, world, known, state)
            result = await wf.run(case)
            outputs = result.get_outputs()
            if outputs:
                case = outputs[-1]
    except BudgetExceeded as exc:
        case.error = f"budget: {exc}"
    except Exception as exc:  # noqa: BLE001 - model/network failure degrades to deterministic output
        case.error = redact(exc)  # never broadcast raw provider errors (may contain tenant/resource names)
    return case, t0


def close_trace(case: InvestigationCase, t0: float, outcome: str) -> None:
    trace = case.trace
    trace.total_latency_ms = int((time.perf_counter() - t0) * 1000)
    trace.total_model_calls = sum(s.model_calls for s in trace.steps)
    trace.total_tokens = sum(s.input_tokens + s.output_tokens for s in trace.steps)
    trace.outcome = outcome if case.error is None else f"degraded ({case.error})"


async def investigate(candidate: PatternCandidate, *, session_id: str, world: World, events: tuple[MatchEvent, ...],
                      state: dict[str, Any], client: Any, budget: BudgetGuard, provider: str,
                      deployment: str | None, prior_titles: list[str], tracking: dict[str, Any] | None = None,
                      on_stage: StageCallback | None = None) -> InvestigationCase:
    case = open_case(candidate, session_id=session_id, world=world, events=events, state=state, provider=provider,
                     deployment=deployment, prior_titles=prior_titles, tracking=tracking)
    case, t0 = await run_workflow(case, world=world, events=events, state=state, client=client, budget=budget,
                                  on_stage=on_stage)
    if case.insight is None:
        case.insight = deterministic_insight(candidate, reason="ai_unavailable", issues=[case.error or "no output"],
                                             run_id=case.case_id)
    close_trace(case, t0, case.insight.status)
    return case


# ---------------------------------------------------------------- insight builders


def insight_from_draft(case: InvestigationCase) -> Insight:
    d, c = case.draft, case.candidate
    assert d is not None and isinstance(c, PatternCandidate)
    return Insight(
        insight_id=f"I-{c.candidate_id}", match_id=c.match_id, candidate_id=c.candidate_id, version=1,
        status="verified", insight_type=c.pattern_type, title=d.title, canonical_claim=d.canonical_claim,
        why_it_matters=d.why_it_matters, uncertainty=d.uncertainty,
        certainty="supported" if d.certainty == "supported" else "tentative",
        evidence_event_ids=list(dict.fromkeys(d.evidence_event_ids)),
        frame_intervals=[FrameInterval(start_ms=f.start_ms, end_ms=f.end_ms) for f in c.frame_intervals],
        source_snapshot_seq=c.detected_at_seq, metric_provenance=dict(c.calculated_metrics),
        verification=Verification(verdict="approved", issues=[], checker_name="verifier_agent+deterministic_validator",
                                  agent_run_id=case.case_id),
        audience_variants=AudienceVariants(
            commentator=d.commentator, fan_discover=d.fan_discover, fan_analyst=d.fan_analyst,
            studio=StudioVariant(template_id=TEMPLATES.get(c.pattern_type, "channel_pressure"),
                                 headline=d.studio_headline[:80], subtitle=d.studio_subtitle[:140]),
        ),
        created_at_ms=c.detected_at_ms, expires_at_elapsed_ms=c.detected_at_ms + INSIGHT_TTL_MS,
    )


DETERMINISTIC_TITLES = {
    "repeated_channel_attack": "Repeated attacks down one channel",
    "counterattack": "Quick break after winning the ball",
    "overlap": "Possible overlapping run on the flank",
    "pressure_change": "More high ball recoveries",
}


def deterministic_insight(c: PatternCandidate, *, reason: Literal["ai_unavailable", "ai_rejected", "ai_off", "ai_cache_only", "ai_skipped"],
                          issues: list[str], run_id: str | None = None) -> Insight:
    """Factual detector summary, clearly labelled as not model-generated."""
    note = {
        "ai_unavailable": "Live AI insight is temporarily unavailable. This summary comes straight from the event data.",
        "ai_rejected": "The AI draft did not pass verification, so only the detector's factual summary is shown.",
        "ai_off": "AI analysis is switched off. This summary comes straight from the event data.",
        "ai_cache_only": "Not investigated by the AI agents in this demo (model budget protected). This summary "
                         "comes straight from the event data.",
        "ai_skipped": "Reached by skipping ahead in the replay, so the AI agents did not investigate it live. This "
                      "summary comes straight from the event data.",
    }[reason]
    title = DETERMINISTIC_TITLES.get(c.pattern_type, "Pattern detected")
    short = c.factual_summary if len(c.factual_summary) <= 380 else c.factual_summary[:377] + "..."
    return Insight(
        insight_id=f"I-{c.candidate_id}", match_id=c.match_id, candidate_id=c.candidate_id, version=1,
        status="tentative", insight_type=c.pattern_type, title=title, canonical_claim=c.factual_summary[:600],
        why_it_matters=note, uncertainty="; ".join(c.unsupported_claims)[:800],
        certainty="tentative", evidence_event_ids=list(dict.fromkeys(c.evidence_event_ids)),
        source_snapshot_seq=c.detected_at_seq, metric_provenance=dict(c.calculated_metrics),
        verification=Verification(verdict="rejected" if reason == "ai_rejected" else "approved",
                                  issues=[i[:300] for i in issues][:12],
                                  checker_name=f"deterministic_only ({reason})", agent_run_id=run_id),
        audience_variants=AudienceVariants(
            commentator=short[:500], fan_discover=title, fan_analyst=c.factual_summary[:900],
            studio=StudioVariant(template_id=TEMPLATES.get(c.pattern_type, "channel_pressure"),
                                 headline=title[:80], subtitle="Detector summary - not reviewed by AI"),
        ),
        created_at_ms=c.detected_at_ms, expires_at_elapsed_ms=c.detected_at_ms + INSIGHT_TTL_MS,
    )
