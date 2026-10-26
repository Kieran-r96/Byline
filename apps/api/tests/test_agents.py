"""T007/T008 with TEST MOCKS ONLY: real Agent Framework workflow, scripted model replies.

These prove orchestration, handoffs, tool use, validation and budget logic. They are not
evidence of model quality; the opt-in foundry_live test covers real inference.
"""

from __future__ import annotations

from typing import Any

import pytest

from byline.agents.budget import BudgetGuard
from byline.agents.orchestrator import investigate
from byline.agents.schemas import DraftInsight
from byline.agents.validator import validate_draft
from byline.football.detectors.base import PatternCandidate
from byline.football.intelligence import run_detectors
from byline.match_state.reducer import replay
from byline.storage.fixtures import MatchPackage
from tests.agent_mocks import ScriptedChatClient, approve, dossier, draft


@pytest.fixture(scope="module")
def case_inputs(golden: MatchPackage) -> tuple[PatternCandidate, dict[str, Any]]:
    mi = run_detectors(golden.world, golden.events)
    cand = mi.candidates[0]
    state = replay(golden.world, list(golden.events), upto_seq=cand.detected_at_seq).snapshot()
    return cand, state


def good_claim(c: PatternCandidate) -> str:
    m = c.calculated_metrics
    pct = round(float(m["channel_share"]) * 100)
    return (f"{m['channel_entries']} of Northbridge's last {m['total_entries']} final-third entries "
            f"({pct}%) came through the right channel in {m['window_minutes']} minutes.")


def budget(**over: Any) -> BudgetGuard:
    kw: dict[str, Any] = {"max_calls_per_session": 30, "max_calls_per_day": 100, "max_tokens_per_case": 50_000}
    kw.update(over)
    return BudgetGuard(**kw)


async def run_case(golden: MatchPackage, cand: PatternCandidate, state: dict[str, Any], client: ScriptedChatClient,
                   b: BudgetGuard | None = None) -> Any:
    stages: list[str] = []

    async def on_stage(cid: str, stage: str) -> None:
        stages.append(stage)

    case = await investigate(cand, session_id="s1", world=golden.world, events=golden.events, state=state,
                             client=client, budget=b or budget(), provider="mock_for_tests", deployment=None,
                             prior_titles=[], on_stage=on_stage)
    return case, stages


async def test_happy_path_handoffs_tools_and_verified_insight(golden, case_inputs) -> None:  # type: ignore[no-untyped-def]
    cand, state = case_inputs
    ids = list(cand.evidence_event_ids)
    client = ScriptedChatClient({
        "INVESTIGATOR": [("call", "get_player", {"player_id": "NBA-09"}), dossier(ids)],
        "ANALYST": [draft(ids, good_claim(cand))],
        "VERIFIER": [approve(ids)],
    })
    case, stages = await run_case(golden, cand, state, client)
    assert case.error is None
    ins = case.insight
    assert ins.status == "verified" and ins.verification.verdict == "approved"
    assert set(ins.evidence_event_ids) <= {e.event_id for e in golden.events}
    assert stages == ["queued", "investigating", "analysing", "verifying", "validating"]
    roles = [s.agent for s in case.trace.steps]
    assert roles == ["investigator", "analyst", "verifier", "deterministic_validator"]
    assert [s.handoff_to for s in case.trace.steps[:2]] == ["analyst", "verifier"]
    inv = case.trace.steps[0]
    # the standard bundle is prefetched (recorded, marked), then the model's own requests follow
    assert [(t.name, t.prefetched) for t in inv.tool_calls] == [
        ("get_detector_metrics", True), ("get_events", True), ("get_match_context", True), ("get_player", False)]
    assert inv.model_calls == 2 and inv.input_tokens == 200
    assert case.trace.total_model_calls == 4
    assert client.calls == ["INVESTIGATOR"] * 2 + ["ANALYST"] + ["VERIFIER"]


async def test_prefetched_bundle_needs_one_call_per_role_and_keeps_every_check(golden, case_inputs) -> None:  # type: ignore[no-untyped-def]
    """V3: no tool round-trips when the model needs nothing extra; verifier and validator still run."""
    cand, state = case_inputs
    ids = list(cand.evidence_event_ids)
    client = ScriptedChatClient({
        "INVESTIGATOR": [dossier(ids)],
        "ANALYST": [draft(ids, good_claim(cand))],
        "VERIFIER": [approve(ids)],
    })
    case, _stages = await run_case(golden, cand, state, client)
    assert case.error is None and case.insight.status == "verified"
    assert client.calls == ["INVESTIGATOR", "ANALYST", "VERIFIER"]
    ver = next(s for s in case.trace.steps if s.agent == "verifier")
    assert [t.name for t in ver.tool_calls] == ["get_detector_metrics", "get_events", "get_match_context"]
    assert all(t.prefetched for t in ver.tool_calls)
    val = case.trace.steps[-1]
    assert val.agent == "deterministic_validator" and val.output["issues"] == []


async def test_bad_number_rejected_then_revised(golden, case_inputs) -> None:  # type: ignore[no-untyped-def]
    """AI-02 / T007 acceptance: a wrong count is caught deterministically even if the verifier approves."""
    cand, state = case_inputs
    ids = list(cand.evidence_event_ids)
    wrong = good_claim(cand).replace(f"{cand.calculated_metrics['channel_entries']} of",
                                     f"{int(cand.calculated_metrics['channel_entries']) + 3} of")
    client = ScriptedChatClient({
        "INVESTIGATOR": [dossier(ids)],
        "ANALYST": [draft(ids, wrong), draft(ids, good_claim(cand))],
        "VERIFIER": [approve(ids), approve(ids)],
    })
    case, _ = await run_case(golden, cand, state, client)
    assert case.revisions == 1
    first_validator = [s for s in case.trace.steps if s.agent == "deterministic_validator"][0]
    assert any("not supported" in i for i in first_validator.output["issues"])
    assert case.insight.status == "verified"
    analyst_msgs = [m for r, m in zip(client.calls, client.seen_messages, strict=True) if r == "ANALYST"]
    assert "revision" in analyst_msgs[1].lower() and "revision" not in analyst_msgs[0].lower()


async def test_two_rejections_end_without_verified_insight(golden, case_inputs) -> None:  # type: ignore[no-untyped-def]
    """AI-03 / AI-07: unsupported positional claim twice -> no verified insight, factual fallback only."""
    cand, state = case_inputs
    ids = list(cand.evidence_event_ids)
    bad = good_claim(cand) + " Riverton's left-back is being dragged out of position."
    client = ScriptedChatClient({
        "INVESTIGATOR": [dossier(ids)],
        "ANALYST": [draft(ids, bad), draft(ids, bad)],
        "VERIFIER": [{"verdict": "needs_revision", "checks": [], "issues": ["positional claim"],
                      "revision_instructions": "remove it"},
                     {"verdict": "rejected", "checks": [], "issues": ["still positional"],
                      "revision_instructions": None}],
    })
    case, _ = await run_case(golden, cand, state, client)
    ins = case.insight
    assert ins.status == "tentative" and ins.verification.verdict == "rejected"
    assert "not reviewed by AI" in ins.audience_variants.studio.subtitle
    assert "dragged" not in ins.canonical_claim


async def test_invalid_json_retried_once(golden, case_inputs) -> None:  # type: ignore[no-untyped-def]
    """AI-06."""
    cand, state = case_inputs
    ids = list(cand.evidence_event_ids)
    client = ScriptedChatClient({
        "INVESTIGATOR": ["this is not json", dossier(ids)],
        "ANALYST": [draft(ids, good_claim(cand))],
        "VERIFIER": [approve(ids)],
    })
    case, _ = await run_case(golden, cand, state, client)
    assert case.insight.status == "verified"
    assert client.calls[:2] == ["INVESTIGATOR", "INVESTIGATOR"]


async def test_unknown_event_id_rejected(golden, case_inputs) -> None:  # type: ignore[no-untyped-def]
    """AI-01."""
    cand, state = case_inputs
    ids = list(cand.evidence_event_ids)
    client = ScriptedChatClient({
        "INVESTIGATOR": [dossier(ids)],
        "ANALYST": [draft([*ids, "E9999"], good_claim(cand)), draft([*ids, "E9999"], good_claim(cand))],
        "VERIFIER": [approve(ids), approve(ids)],
    })
    case, _ = await run_case(golden, cand, state, client)
    assert case.insight.status != "verified"
    assert any("E9999" in i for i in case.insight.verification.issues)


async def test_budget_cap_degrades_to_factual_summary(golden, case_inputs) -> None:  # type: ignore[no-untyped-def]
    """T008: attempts over the cap are blocked; match continues with a labelled factual summary."""
    cand, state = case_inputs
    ids = list(cand.evidence_event_ids)
    client = ScriptedChatClient({"INVESTIGATOR": [dossier(ids)], "ANALYST": [], "VERIFIER": []})
    b = budget(max_calls_per_session=1)
    case, _ = await run_case(golden, cand, state, client, b)
    assert case.error is not None and "session_cap" in case.error
    assert case.insight.status == "tentative"
    assert "not reviewed by AI" in case.insight.audience_variants.studio.subtitle
    assert client.calls == ["INVESTIGATOR"]


async def test_model_failure_opens_breaker(golden, case_inputs) -> None:  # type: ignore[no-untyped-def]
    """AI-04: provider errors degrade gracefully and trip the circuit breaker."""
    cand, state = case_inputs

    class Exploding(ScriptedChatClient):
        async def _inner_get_response(self, **kwargs: Any) -> Any:
            raise TimeoutError("simulated Foundry timeout")

    b = budget(breaker_threshold=1)
    case, _ = await run_case(golden, cand, state, Exploding({}), b)
    assert case.insight.status == "tentative"
    assert b.breaker_open
    assert b.can_start("s2")[0] is False


def test_validator_flags_names_not_in_evidence(golden, case_inputs) -> None:  # type: ignore[no-untyped-def]
    cand, state = case_inputs
    ids = list(cand.evidence_event_ids)
    known = {e.event_id: e for e in golden.events if e.seq <= cand.detected_at_seq}
    d = DraftInsight.model_validate(draft(ids, good_claim(cand) + " Moberg-Kale is overworked."))
    issues = validate_draft(d, cand, known, set(ids), state, golden.world)
    assert any("Moberg-Kale" in i for i in issues)
    clean = DraftInsight.model_validate(draft(ids, good_claim(cand)))
    assert validate_draft(clean, cand, known, set(ids), state, golden.world) == []


def test_validator_blocks_betting_and_predictions(golden, case_inputs) -> None:  # type: ignore[no-untyped-def]
    cand, state = case_inputs
    ids = list(cand.evidence_event_ids)
    known = {e.event_id: e for e in golden.events if e.seq <= cand.detected_at_seq}
    d = DraftInsight.model_validate(draft(ids, good_claim(cand), fan_discover="Odds shorten: they will score soon."))
    issues = validate_draft(d, cand, known, set(ids), state, golden.world)
    assert any("betting" in i for i in issues) and any("predicts" in i for i in issues)


def test_persistent_ledger_hard_cap(tmp_path) -> None:  # type: ignore[no-untyped-def]
    """Owner rule: hard cap on real calls survives restarts and new processes."""
    from byline.agents.ledger import CallLedger

    path = tmp_path / "ledger.json"
    a = CallLedger(cap=3, path=path)
    assert [a.reserve("agent") for _ in range(4)] == [True, True, True, False]
    b = CallLedger(cap=3, path=path)  # "restarted" process sees the same count
    assert b.used() == 3 and b.remaining() == 0 and b.reserve("probe") is False
    g = budget(ledger=b)
    assert g.can_start("s9") == (False, "ledger_cap")


async def test_ledger_blocks_mid_case(golden, case_inputs, tmp_path) -> None:  # type: ignore[no-untyped-def]
    from byline.agents.ledger import CallLedger

    cand, state = case_inputs
    ids = list(cand.evidence_event_ids)
    client = ScriptedChatClient({"INVESTIGATOR": [dossier(ids)], "ANALYST": [draft(ids, good_claim(cand))],
                                 "VERIFIER": [approve(ids)]})
    case, _ = await run_case(golden, cand, state, client, budget(ledger=CallLedger(cap=2, path=tmp_path / "l.json")))
    assert "ledger_cap" in (case.error or "")
    assert client.calls == ["INVESTIGATOR", "ANALYST"]
    assert case.insight.status == "tentative"
