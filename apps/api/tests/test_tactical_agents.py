"""Tactical moment -> agent case, with TEST MOCKS ONLY (scripted replies through the real Agent Framework workflow).

These prove the adapter, the tactical validator, the recording/serving path and that the operator CLI's dry run
never reaches a model. They are not evidence of model quality. Nothing here writes to apps/api/recorded/.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

import byline.agents.tactical as tactical
from byline.agents.budget import BudgetGuard
from byline.agents.orchestrator import TACTICAL_PROFILE, _brief, open_case
from byline.agents.schemas import DraftInsight
from byline.agents.tactical import (
    TacticalInputs,
    investigate_moment,
    moment_inputs,
    recording_record,
    save_recording,
    translate_run,
)
from byline.agents.validator import tactical_allowed_numbers, validate_tactical_draft
from byline.storage.fixtures import MatchPackage, package_for_match
from tests import agent_mocks
from tests.agent_mocks import ScriptedChatClient, approve

MOMENT = "T-option-NBA-0180"
IDS = ["E0180", "E0181"]


@pytest.fixture(scope="module")
def inputs() -> TacticalInputs:
    return moment_inputs(package_for_match("BYLINE-01"), MOMENT)


def tactical_dossier() -> dict[str, Any]:
    return {
        "candidate_finding": "Lindqvist's pass towards Vantreight was intercepted; Haddad-Rhys was an open option.",
        "key_event_ids": IDS,
        "observed_facts": [{"statement": "Pass intercepted by Ndiaye-Shaw", "event_ids": IDS}],
        "match_context": ["7th minute"],
        "alternative_explanations": ["The passer may not have seen the open player (no facing data)."],
        "cannot_establish": ["The passer's view or intent", "Whether another pass would have been completed"],
    }


def good_draft(**over: Any) -> dict[str, Any]:
    d = {
        "title": "Haddad-Rhys open as Lindqvist's pass is cut out",
        "canonical_claim": ("At 7', Lindqvist's pass towards Vantreight ran through a lane with 2 opponents within "
                            "1.5 m (closest 0.3 m) and was intercepted by Ndiaye-Shaw."),
        "why_it_matters": ("On the same frame Haddad-Rhys was an open option: nearest opponent 3.3 m from the lane, "
                           "9.3 m of space and 13 m further forward."),
        "uncertainty": ("Positions only: the data cannot show what Lindqvist saw or intended, or whether another "
                        "pass would have been completed."),
        "certainty": "supported",
        "evidence_event_ids": IDS,
        "commentator": "Lindqvist's pass is cut out, but Haddad-Rhys was an open option with 9.3 m of space.",
        "fan_discover": "Haddad-Rhys was free with a clear passing lane, but the ball went to Vantreight and was cut out.",
        "fan_analyst": ("Intended lane: nearest opponent 0.3 m, 2 opponents in it. On the same frame Haddad-Rhys was "
                        "an alternative: lane 3.3 m clear, 9.3 m of space, 13 m further forward, 3 opponents "
                        "bypassed. Rennard was another option: lane 6.5 m, 13.8 m of space."),
        "studio_headline": "HADDAD-RHYS WAS THE OPEN OPTION",
        "studio_subtitle": "7' - lane 3.3 m clear, 9.3 m of space; the pass to Vantreight was cut out",
    }
    d.update(over)
    return d


def budget(**over: Any) -> BudgetGuard:
    kw: dict[str, Any] = {"max_calls_per_session": 8, "max_calls_per_day": 8, "max_tokens_per_case": 24_000}
    kw.update(over)
    return BudgetGuard(**kw)


async def run_fake(inputs: TacticalInputs, script: dict[str, list[Any]]) -> tuple[tactical.TacticalRun,
                                                                                  ScriptedChatClient]:
    client = ScriptedChatClient(script)
    run = await investigate_moment(inputs, client=client, budget=budget(), provider="mock_for_tests",
                                   deployment=None, session_id="test")
    return run, client


def check(inputs: TacticalInputs, **over: Any) -> list[str]:
    known = {e.event_id: e for e in inputs.pkg.events if e.seq <= inputs.subject.detected_at_seq}
    return validate_tactical_draft(DraftInsight.model_validate(good_draft(**over)), inputs.subject, known, set(IDS),
                                   inputs.state, inputs.pkg.world)


# ---------------------------------------------------------------- adapter


def test_adapter_builds_brief_metrics_and_allowed_numbers(inputs: TacticalInputs) -> None:
    s = inputs.subject
    assert s.candidate_id == MOMENT and s.pattern_type == "tactical_option" and s.team_id == "NBA"
    assert list(s.evidence_event_ids) == IDS and s.display_clock == "7'"
    assert s.detected_at_seq == 181  # the interception is the latest event the moment uses (no look-ahead)
    m = s.calculated_metrics
    assert (m["actual_lane_clearance_m"], m["actual_opponents_in_lane"]) == (0.3, 2)
    assert (m["alternative_1_lane_clearance_m"], m["alternative_1_receiver_space_m"],
            m["alternative_1_progression_m"], m["alternative_1_opponents_bypassed"]) == (3.3, 9.3, 13.0, 3)
    assert (m["alternative_2_lane_clearance_m"], m["alternative_2_receiver_space_m"]) == (6.5, 13.8)
    assert m["minute"] == 7 and "midfield_to_back_line_gap_m" in m
    f = s.facts
    assert "Ndiaye-Shaw" in f["what_happened"]["intercepted_by"] and "Vantreight" in f["what_happened"]["towards"]
    assert [a["receiver"] for a in f["alternatives_on_the_same_frame"]] == ["#11 S. Haddad-Rhys", "#7 K. Rennard"]
    assert {"NBA-04", "NBA-09", "NBA-11", "NBA-07", "RVC-06"} <= set(s.player_ids)
    assert "unknowns" in f and "labels" in f and f["labels"]["hypothetical"].startswith("What if")

    allowed = tactical_allowed_numbers(s, {e.event_id: e for e in inputs.pkg.events}, inputs.state)
    assert {0.3, 3.3, 9.3, 13.0, 3.0, 2.0, 6.5, 13.8, 7.0, 9.0, 14.0, 1.5} <= allowed
    assert 30.0 not in allowed and 11.2 not in allowed  # no share-to-percent conversion; no invented values

    pkg = inputs.pkg
    case = open_case(s, session_id="t", world=pkg.world, events=pkg.events, state=inputs.state, provider="off",
                     deployment=None, prior_titles=[], tracking=pkg.tracking)
    brief = _brief(case)
    assert MOMENT in brief and "players_in_moment" in brief and "E0180" in brief
    bundle = case.tools.prefetch(IDS, context=True)
    assert '"moment_facts"' in bundle and '"E0181"' in bundle and "match_context" in bundle
    assert [c.name for c in case.tools.calls] == ["get_moment_facts", "get_events", "get_match_context"]


def test_input_hash_and_key_are_stable_and_versioned(inputs: TacticalInputs) -> None:
    again = tactical.compute_input_hash(inputs.subject, inputs.pkg, inputs.state)
    assert again == inputs.input_hash
    assert inputs.key == tactical.recording_key(MOMENT, inputs.input_hash)
    assert tactical.recording_key(MOMENT, inputs.input_hash, "other-version") != inputs.key


# ---------------------------------------------------------------- validator


def test_tactical_validator_accepts_a_clean_draft(inputs: TacticalInputs) -> None:
    assert check(inputs) == []


@pytest.mark.parametrize(("over", "expect"), [
    ({"commentator": "Haddad-Rhys was open and would have scored from there."}, "counterfactual outcome"),
    ({"fan_discover": "A pass to Haddad-Rhys was a certain goal."}, "outcome claim"),
    ({"why_it_matters": "Haddad-Rhys was an open option with a big chance of a shot."}, "probability claim"),
    ({"fan_analyst": "Haddad-Rhys was an open option: 9.3 m of space, 0.4 xG."}, "expected-goals"),
    ({"studio_subtitle": "Open option: 9.3 m of space, 80% completion"}, "percentages"),
    ({"commentator": "Lindqvist decided to force it through the middle."}, "claims intent"),
    ({"commentator": "Lindqvist tried to find Vantreight; Haddad-Rhys was the option."}, "claims intent"),
    ({"fan_discover": "The Northbridge midfield were instructed to play through the middle."}, "instructions"),
    ({"why_it_matters": "Lindqvist should have picked out Haddad-Rhys, the open option."}, "normative"),
    ({"commentator": "Poor pass from Lindqvist; Haddad-Rhys was the open option."}, "judges the player"),
    ({"fan_discover": "If Lindqvist had gone wide, Haddad-Rhys could have run at the defence."}, "hypothetical"),
])
def test_tactical_validator_rejects_outcome_intent_and_unframed_hypotheticals(
        inputs: TacticalInputs, over: dict[str, str], expect: str) -> None:
    issues = check(inputs, **over)
    assert any(expect in i for i in issues), issues


def test_tactical_validator_rejects_unknown_numbers_and_names(inputs: TacticalInputs) -> None:
    issues = check(inputs, why_it_matters="Haddad-Rhys was an open option with 11.2 m of space.")
    assert any("11.2 is not supported" in i for i in issues), issues
    # a real player who is not part of this moment
    issues = check(inputs, fan_discover="Achterberg was also an open option.")
    assert any("Achterberg" in i and "not a player in this moment" in i for i in issues), issues
    # an invented player
    issues = check(inputs, commentator="J. Smith was an open option too.")
    assert any("J. Smith" in i for i in issues), issues
    # an invented event id is still caught by the shared rules
    issues = check(inputs, evidence_event_ids=[*IDS, "E9999"])
    assert any("E9999" in i for i in issues), issues


def test_possessive_of_a_player_in_the_moment_is_not_a_new_name(inputs: TacticalInputs) -> None:
    # regression: the real 22 Oct run lost a revision because "M. Lindqvist's" did not match "Lindqvist"
    claim = ("At 7', M. Lindqvist's pass towards Vantreight ran through a lane with 2 opponents within 1.5 m "
             "(closest 0.3 m) and was intercepted by Ndiaye-Shaw.")
    assert not [i for i in check(inputs, canonical_claim=claim) if "not a player in this moment" in i]
    issues = check(inputs, commentator="J. Smith's run was an open option too.")
    assert any("J. Smith" in i for i in issues), issues


def test_framed_hypothetical_is_allowed(inputs: TacticalInputs) -> None:
    assert check(inputs, fan_discover="Instead of Vantreight, Haddad-Rhys was an available option with 9.3 m "
                                      "of space.") == []


# ---------------------------------------------------------------- pipeline (fake provider)


async def test_full_pipeline_with_fake_provider_yields_verified_insight(inputs: TacticalInputs) -> None:
    run, client = await run_fake(inputs, {"INVESTIGATOR": [tactical_dossier()], "ANALYST": [good_draft()],
                                          "VERIFIER": [approve(IDS)]})
    assert run.status == "verified" and run.case.error is None
    assert client.calls == ["INVESTIGATOR", "ANALYST", "VERIFIER"]
    # the tactical role instructions (detector prompts + tactical rules) were used for every role
    assert run.case.profile is TACTICAL_PROFILE and "Investigate this tactical moment" in client.seen_messages[0]
    assert all("CASE TYPE: TACTICAL MOMENT" in p for p in (TACTICAL_PROFILE.investigator, TACTICAL_PROFILE.analyst,
                                                           TACTICAL_PROFILE.verifier))
    ins = run.insight
    assert ins is not None and ins.moment_id == MOMENT and ins.status == "verified"
    assert ins.audience.commentator.startswith("Lindqvist") and ins.audience.studio_title
    assert ins.audience.fan_plain.startswith("Haddad-Rhys") and ins.evidence_event_ids == IDS
    assert ins.verifier["verdict"] == "approved" and ins.validator["passed"] is True
    assert ins.hypothetical_label.startswith("What if")
    inv = run.case.trace.steps[0]
    assert [(t.name, t.prefetched) for t in inv.tool_calls] == [
        ("get_moment_facts", True), ("get_events", True), ("get_match_context", True)]
    p = run.provenance
    assert p["provider"] == "mock_for_tests" and p["prompt_version"] == tactical.TACTICAL_PROMPT_VERSION
    assert p["input_hash"] == inputs.input_hash and p["recording_key"] == inputs.key
    assert p["model_calls"] == 3 and (p["input_tokens"], p["output_tokens"]) == (300, 120)
    assert [c["role"] for c in p["calls"]] == ["investigator", "analyst", "verifier"]
    assert all(c["latency_ms"] is not None and c["response_id"] and c["started_at"] for c in p["calls"])
    assert p["started_at"] <= p["finished_at"] and p["est_cost_usd"] > 0


async def test_outcome_claim_is_caught_then_revised(inputs: TacticalInputs) -> None:
    bad = good_draft(commentator="Haddad-Rhys was open and would have scored.")
    run, client = await run_fake(inputs, {"INVESTIGATOR": [tactical_dossier()], "ANALYST": [bad, good_draft()],
                                          "VERIFIER": [approve(IDS), approve(IDS)]})
    assert run.case.revisions == 1 and run.status == "verified"
    first = [s for s in run.case.trace.steps if s.agent == "deterministic_validator"][0]
    assert any("counterfactual" in i for i in (first.output or {})["issues"])
    assert run.provenance["model_calls"] == 5
    assert run.insight is not None and run.insight.validator["attempts"][1] == []


async def test_two_failed_drafts_are_rejected_and_ship_no_text(inputs: TacticalInputs) -> None:
    bad = good_draft(fan_discover="Lindqvist wanted to play it through the middle.")
    run, _ = await run_fake(inputs, {"INVESTIGATOR": [tactical_dossier()], "ANALYST": [bad, bad],
                                     "VERIFIER": [approve(IDS), approve(IDS)]})
    assert run.status == "rejected" and run.insight is None
    rec = recording_record(run)
    assert rec["state"] == "rejected" and rec["insight"] is None and rec["validator"]["passed"] is False


async def test_max_calls_hard_stop_fails_closed(inputs: TacticalInputs) -> None:
    client = ScriptedChatClient({"INVESTIGATOR": [tactical_dossier()], "ANALYST": [good_draft()], "VERIFIER": []})
    run = await investigate_moment(inputs, client=client, budget=budget(max_calls_per_session=2),
                                   provider="mock_for_tests", deployment=None, session_id="cap")
    assert run.status == "failed" and "session_cap" in (run.case.error or "")
    assert client.calls == ["INVESTIGATOR", "ANALYST"]
    with pytest.raises(ValueError):
        save_recording(recording_record(run), folder=Path("unused"))


async def test_spanish_variant_through_the_same_budget(inputs: TacticalInputs,
                                                       monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(agent_mocks, "ROLES", (*agent_mocks.ROLES, "TRANSLATOR"))
    d = good_draft()
    es = {"title": "ES " + d["title"], "canonical_claim": "ES " + d["canonical_claim"],
          "commentator": "ES " + d["commentator"], "fan_discover": "ES " + d["fan_discover"],
          "fan_analyst": "ES " + d["fan_analyst"], "studio_headline": "ES " + d["studio_headline"],
          "studio_subtitle": "ES " + d["studio_subtitle"]}
    client = ScriptedChatClient({"INVESTIGATOR": [tactical_dossier()], "ANALYST": [d], "VERIFIER": [approve(IDS)],
                                 "TRANSLATOR": [es]})
    b = budget()
    run = await investigate_moment(inputs, client=client, budget=b, provider="mock_for_tests", deployment=None,
                                   session_id="es")
    tr = await translate_run(run, client=client, budget=b, session_id="es")
    assert tr["model_calls"] == 1 and not tr["issues"]
    assert run.insight is not None and run.insight.audience.translations["es.fan_plain"].startswith("ES ")
    assert run.provenance["model_calls"] == 4 and run.provenance["calls"][-1]["role"] == "translator"
    assert b.session_calls["es"] == 4  # the translation counts against the same hard cap


# ---------------------------------------------------------------- recordings and endpoint


def test_endpoint_not_run_then_served_from_recording(inputs: TacticalInputs, tmp_path: Path,
                                                     monkeypatch: pytest.MonkeyPatch) -> None:
    import asyncio

    from byline.api.app import app

    monkeypatch.setattr(tactical, "RECORDED_TACTICS", tmp_path)
    real_before = sorted(tactical._REAL_RECORDED_TACTICS.glob("*.json"))
    url = f"/api/matches/BYLINE-01/tactics/{MOMENT}"
    with TestClient(app) as c:
        r = c.get(url + "/insight").json()
        assert r["state"] == "not_run" and r["insight"] is None and r["provenance"] is None and r["notice"]
        assert c.get(url + "/view").json()["ai_state"] == "not_run"
        assert c.get(url + "/insight", params={"upto_seq": 150}).status_code == 404  # not released yet

        run, _ = asyncio.run(run_fake(inputs, {"INVESTIGATOR": [tactical_dossier()], "ANALYST": [good_draft()],
                                               "VERIFIER": [approve(IDS)]}))
        record = recording_record(run)
        with pytest.raises(ValueError, match="non-Foundry"):  # a mock run can never enter the committed store
            save_recording(record, folder=tactical._REAL_RECORDED_TACTICS)
        path = save_recording(record)  # -> the temp dir
        assert path.parent == tmp_path and path.stem == inputs.key

        r = c.get(url + "/insight").json()
        assert r["state"] == "verified" and r["insight"]["title"] == good_draft()["title"]
        assert r["insight"]["audience"]["commentator"] and r["insight"]["verifier"]["verdict"] == "approved"
        p = r["provenance"]
        assert p["cache_hit"] is True and p["served_from"] == "recording" and p["provider"] == "mock_for_tests"
        assert p["model_calls"] == 3 and p["input_hash"] == inputs.input_hash
        assert "Test mock" in r["notice"]
        assert c.get(url + "/view").json()["ai_state"] == "verified"
        # other moments are unaffected
        other = next(m for m in c.get("/api/matches/BYLINE-01/tactics").json() if m["moment_id"] != MOMENT)
        assert c.get(f"/api/matches/BYLINE-01/tactics/{other['moment_id']}/insight").json()["state"] == "not_run"
    assert sorted(tactical._REAL_RECORDED_TACTICS.glob("*.json")) == real_before


def test_recording_for_different_inputs_is_not_served(inputs: TacticalInputs, tmp_path: Path) -> None:
    import json

    stale = {"moment_id": MOMENT, "input_hash": "0" * 64, "state": "verified", "provider": "foundry"}
    (tmp_path / f"{inputs.key}.json").write_text(json.dumps(stale), encoding="utf-8")
    assert tactical.find_recording(inputs, folder=tmp_path) is None


# ---------------------------------------------------------------- operator CLI


@pytest.fixture()
def no_provider(monkeypatch: pytest.MonkeyPatch) -> list[str]:
    """Any attempt to construct a model client or reserve a ledger slot is recorded and fails the test."""
    from byline.agents import provider
    from byline.agents.ledger import CallLedger

    touched: list[str] = []

    def boom(name: str) -> Any:
        def f(*a: Any, **k: Any) -> Any:
            touched.append(name)
            raise AssertionError(f"{name} must not be called")
        return f

    monkeypatch.setattr(provider, "chat_client", boom("chat_client"))
    monkeypatch.setattr(provider, "openai_client", boom("openai_client"))
    monkeypatch.setattr(CallLedger, "reserve", boom("ledger.reserve"))
    return touched


def test_cli_dry_run_makes_no_model_call_and_prints_the_plan(no_provider: list[str], monkeypatch: pytest.MonkeyPatch,
                                                             capsys: pytest.CaptureFixture[str]) -> None:
    from byline.agents.ledger import DEFAULT_PATH
    from byline.tools.tactical_case import main

    monkeypatch.setenv("BYLINE_MODEL_CALL_CAP", "5")
    existed = DEFAULT_PATH.exists()
    code = main(["--match", "BYLINE-01", "--moment", MOMENT, "--max-calls", "8", "--spanish"])
    out = capsys.readouterr().out
    assert code == 0 and no_provider == []
    assert DEFAULT_PATH.exists() == existed  # a dry run never creates the ledger
    assert "DRY RUN" in out and MOMENT in out and "S. Haddad-Rhys" in out
    for step in ("investigator", "analyst", "verifier", "translator (es)", "revision: analyst"):
        assert step in out
    assert "USD 0.40 / 1.60" in out and "maximum" in out and "hard stop at --max-calls 8" in out
    assert "raise BYLINE_MODEL_CALL_CAP to at least" in out
    assert tactical.TACTICAL_PROMPT_VERSION in out


def test_cli_confirm_refuses_without_foundry(no_provider: list[str], capsys: pytest.CaptureFixture[str]) -> None:
    from byline.tools.tactical_case import main

    assert main(["--match", "BYLINE-01", "--moment", MOMENT, "--confirm"]) == 2
    assert "REFUSED" in capsys.readouterr().out and no_provider == []
    assert main(["--match", "BYLINE-01", "--moment", MOMENT, "--max-calls", "9"]) == 2


def test_signature_numbers_match_the_moment(golden: MatchPackage) -> None:
    """The ids and numbers quoted in the docs are the engine's."""
    i = moment_inputs(golden, MOMENT)
    w = i.whatif
    assert w is not None and w["actual"]["interceptor_id"] == "RVC-06" and w["actual"]["receiver_id"] == "NBA-09"
    assert w["carrier_id"] == "NBA-04" and len(w["actual"]["option"]["lane_opponents"]) == 2
    a1, a2 = w["alternatives"]
    assert (a1["receiver_id"], a1["lane_clearance_m"], a1["receiver_space_m"], a1["progression_m"],
            a1["opponents_bypassed"]) == ("NBA-11", 3.3, 9.3, 13.0, 3)
    assert (a2["receiver_id"], a2["lane_clearance_m"], a2["receiver_space_m"]) == ("NBA-07", 6.5, 13.8)
