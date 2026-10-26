"""Operator tool: one REAL agent investigation of a tactical moment, recorded for cache-only serving.

    python tools/run_tactical_case.py --match BYLINE-01 --moment T-option-NBA-0180 [--max-calls 8] [--spanish]
                                      [--confirm]

Without --confirm (the default) it only prints the plan: agents, prompt sizes, estimated tokens and maximum
cost, the ledger position and the cap the run needs. It constructs no model client, reserves no ledger slot
and writes nothing.

With --confirm it runs once against the configured provider (BYLINE_AI_PROVIDER=foundry), hard-stopped at
--max-calls (at most 8, translation and revision included) by the BudgetGuard session cap and the persistent
ledger, logs every call through log_call (BYLINE_CALL_LOG, required), records the finished run in
recorded/tactics/ and prints a measured summary.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import math
import os
import sys
from typing import Any

from byline.agents.budget import BudgetGuard
from byline.agents.ledger import DEFAULT_PATH, CallLedger
from byline.agents.orchestrator import (
    USD_PER_M_INPUT,
    USD_PER_M_OUTPUT,
    analyst_message,
    investigator_message,
    open_case,
    verifier_message,
)
from byline.agents.prompts import TACTICAL_PROMPT_VERSION
from byline.agents.schemas import DraftInsight, EvidenceDossier, ObservedFact, VerifierDecision
from byline.agents.tactical import (
    TacticalInputs,
    find_recording,
    investigate_moment,
    moment_inputs,
    recording_record,
    save_recording,
    translate_run,
)
from byline.agents.translate import PROMPT as TRANSLATOR_PROMPT
from byline.agents.translate import SpanishVariant
from byline.config import Settings
from byline.storage.fixtures import package_for_match

HARD_MAX_CALLS = 8
DEFAULT_MAX_TOKENS = 24_000
CHARS_PER_TOKEN = 4  # planning heuristic for English/JSON text; the real counts come from the provider
EST_OUTPUT_TOKENS = {"investigator": 700, "analyst": 800, "verifier": 700, "translator": 600}
TOOL_ROUND_TRIP_CHARS = 700  # a get_player / get_recent_events call and its result appended to the context
SESSION = "tactical-operator"


def _tok(chars: int) -> int:
    return math.ceil(chars / CHARS_PER_TOKEN)


def _schema_chars(model: Any) -> int:
    return len(json.dumps(model.model_json_schema()))


def _stand_in_dossier(inputs: TacticalInputs) -> EvidenceDossier:
    """SIZING ONLY: a deterministic placeholder of realistic length. Never stored, never shown, not agent output."""
    s = inputs.subject
    ids = list(s.evidence_event_ids)
    return EvidenceDossier(
        candidate_finding=s.factual_summary, key_event_ids=ids,
        observed_facts=[ObservedFact(statement=f"{o['label']}: {o['value']} {o['unit']}".strip(), event_ids=ids)
                        for o in s.facts.get("observed", [])],
        match_context=[f"Minute {s.display_clock}"], alternative_explanations=list(s.unsupported_claims[:2]),
        cannot_establish=list(s.unsupported_claims))


def _stand_in_draft(inputs: TacticalInputs) -> DraftInsight:
    """SIZING ONLY (see _stand_in_dossier)."""
    s, m = inputs.subject, inputs.moment
    plain = str(m.extra.get("plain", m.summary))
    return DraftInsight(title=s.title[:70], canonical_claim=s.factual_summary, why_it_matters=m.interpretation,
                        uncertainty="; ".join(m.unknowns), certainty="supported",
                        evidence_event_ids=list(s.evidence_event_ids), commentator=plain, fan_discover=plain,
                        fan_analyst=s.factual_summary, studio_headline=s.title[:55], studio_subtitle=plain[:100])


def plan(inputs: TacticalInputs, *, max_calls: int, max_tokens: int, spanish: bool, settings: Settings,
         ledger: CallLedger) -> tuple[list[str], dict[str, Any]]:
    """Prompt sizes of the real messages (built by the same functions the workflow uses), estimates, ledger."""
    s, pkg = inputs.subject, inputs.pkg
    case = open_case(s, session_id=SESSION, world=pkg.world, events=pkg.events, state=inputs.state,
                     provider="off", deployment=settings.foundry_deployment, prior_titles=[], tracking=pkg.tracking)
    p = case.profile
    bundle = case.tools.prefetch(list(s.evidence_event_ids), context=True)  # deterministic, no model
    tools_chars = sum(len(json.dumps(t.to_json_schema_spec())) for t in case.tools.investigator_extra_tools())
    rows: list[dict[str, Any]] = []

    def row(step: str, role: str, calls: str, system: str, message: str, schema: Any, extra: int = 0,
            optional: bool = False) -> None:
        sc = _schema_chars(schema)
        tin = _tok(len(system) + len(message) + sc + extra)
        rows.append({"step": step, "role": role, "calls": calls, "system": len(system), "message": len(message),
                     "schema_tools": sc + extra, "in": tin, "out": EST_OUTPUT_TOKENS[role], "optional": optional})

    inv_msg = investigator_message(case, bundle)
    row("investigator", "investigator", "1", p.investigator, inv_msg, EvidenceDossier, tools_chars)
    case.dossier = _stand_in_dossier(inputs)
    row("analyst", "analyst", "1", p.analyst, analyst_message(case), DraftInsight)
    case.draft = _stand_in_draft(inputs)
    ver_bundle = case.tools.prefetch(list(case.draft.evidence_event_ids), context=True)
    row("verifier", "verifier", "1", p.verifier, verifier_message(case, ver_bundle), VerifierDecision)
    row("investigator tool round-trip", "investigator", "0-2", p.investigator, inv_msg, EvidenceDossier,
        tools_chars + TOOL_ROUND_TRIP_CHARS, optional=True)
    case.revisions = 1
    case.decision = VerifierDecision(verdict="needs_revision", checks=[], issues=["(revision issues)"] * 2,
                                     revision_instructions="(verifier instructions)")
    row("revision: analyst", "analyst", "0-1", p.analyst, analyst_message(case), DraftInsight, optional=True)
    row("revision: verifier", "verifier", "0-1", p.verifier, verifier_message(case, ver_bundle), VerifierDecision,
        optional=True)
    en = _stand_in_draft(inputs)
    texts = {"title": en.title, "canonical_claim": en.canonical_claim, "commentator": en.commentator,
             "fan_discover": en.fan_discover, "fan_analyst": en.fan_analyst, "studio_headline": en.studio_headline,
             "studio_subtitle": en.studio_subtitle}
    row("translator (es)", "translator", "1" if spanish else "0", TRANSLATOR_PROMPT,
        "Texts:\n" + json.dumps(texts, indent=1, ensure_ascii=False), SpanishVariant, optional=not spanish)

    base = [r for r in rows if not r["optional"] or (r["role"] == "translator" and spanish)]
    exp_in, exp_out = sum(r["in"] for r in base), sum(r["out"] for r in base)
    biggest_in = max(r["in"] for r in rows)
    biggest_out = max(r["out"] for r in rows)

    def usd(tin: int, tout: int) -> float:
        return tin / 1e6 * USD_PER_M_INPUT + tout / 1e6 * USD_PER_M_OUTPUT

    used = ledger.peek()
    numbers = {"expected_calls": len(base), "expected_in": exp_in, "expected_out": exp_out,
               "expected_usd": usd(exp_in, exp_out), "max_calls": max_calls,
               "max_usd": max_calls * usd(biggest_in, biggest_out), "ledger_used": used, "ledger_cap": ledger.cap,
               "cap_needed": used + max_calls}
    d = settings.foundry_deployment or "(not configured)"
    rec = find_recording(inputs)
    out = [
        "BYLINE tactical case plan - DRY RUN: no model call, no provider client constructed, nothing written",
        f"  match        {pkg.match_id} ({pkg.scenario_id})",
        f"  moment       {s.moment_id} at {s.display_clock} - {s.title}",
        f"  evidence     {', '.join(s.evidence_event_ids)}; players in moment: "
        + ", ".join(str(x) for x in s.facts.get("players_in_moment", [])),
        f"  measured     intended lane {s.calculated_metrics.get('actual_lane_clearance_m')} m "
        f"({s.calculated_metrics.get('actual_opponents_in_lane')} opponents in it); "
        + "; ".join(f"{a['receiver']}: lane {a['lane_nearest_opponent_m']} m, space {a['space_around_receiver_m']} m, "
                    f"+{a['ground_gained_m']} m, {a['opponents_bypassed']} bypassed"
                    for a in s.facts.get("alternatives_on_the_same_frame", [])),
        f"  prompt       {TACTICAL_PROMPT_VERSION}",
        f"  input hash   {inputs.input_hash[:16]}...  recording key {inputs.key}"
        + (f"  (ALREADY RECORDED: state {rec['state']}; --confirm would not call)" if rec else "  (not recorded)"),
        f"  provider     BYLINE_AI_PROVIDER={settings.byline_ai_provider}  deployment={d}",
        "",
        "Agents (Microsoft Agent Framework workflow: investigator -> analyst -> verifier -> deterministic validator)",
        f"  {'step':<30}{'calls':>6}{'system':>9}{'message':>9}{'schema+tools':>14}{'est in tok':>12}{'est out tok':>13}",
    ]
    for r in rows:
        out.append(f"  {r['step']:<30}{r['calls']:>6}{r['system']:>9}{r['message']:>9}{r['schema_tools']:>14}"
                   f"{r['in']:>12,}{r['out']:>13,}")
    out += [
        f"  {'deterministic validator':<30}{'0':>6}   (code: numbers, names, ids, outcome/intent/hypothetical rules)",
        "  sizes are characters; tokens estimated at 4 characters per token. A JSON-repair retry (at most one per",
        "  role) would repeat that role's call.",
        "",
        f"Calls     expected {numbers['expected_calls']} ({'with' if spanish else 'without'} Spanish); "
        f"hard stop at --max-calls {max_calls} (BudgetGuard session cap + persistent ledger)",
        f"Tokens    expected ~{exp_in:,} in / ~{exp_out:,} out; case stops before any call once it has used "
        f"{max_tokens:,} tokens",
        f"Cost      gpt-4.1-mini list price USD {USD_PER_M_INPUT:.2f} / {USD_PER_M_OUTPUT:.2f} per M input / output "
        "tokens",
        f"          expected  ~USD {numbers['expected_usd']:.4f}",
        f"          maximum    USD {numbers['max_usd']:.4f}  ({max_calls} calls x the largest call: "
        f"{biggest_in:,} in + {biggest_out:,} out tokens)",
        f"Ledger    {ledger.path}: {used} used of cap {ledger.cap} "
        f"(remaining {max(0, ledger.cap - used)})",
    ]
    if ledger.cap - used >= max_calls:
        out.append(f"          the cap already allows {max_calls} more calls; no change needed")
    else:
        out.append(f"          this run reserves up to {max_calls} slots: raise BYLINE_MODEL_CALL_CAP to at least "
                   f"{numbers['cap_needed']} (currently {ledger.cap})")
    log = os.environ.get("BYLINE_CALL_LOG")
    out.append(f"Call log  BYLINE_CALL_LOG={log or '(unset: required for --confirm)'}")
    out.append("To run for real, add --confirm (one run, then recorded to apps/api/recorded/tactics/).")
    return out, numbers


async def run_confirmed(inputs: TacticalInputs, *, max_calls: int, max_tokens: int, spanish: bool,
                        settings: Settings) -> int:
    from byline.agents import provider

    if settings.byline_ai_provider != "foundry" or not settings.foundry_configured:
        print("REFUSED: --confirm needs BYLINE_AI_PROVIDER=foundry and a configured Foundry endpoint/deployment.")
        return 2
    if not os.environ.get("BYLINE_CALL_LOG"):
        print("REFUSED: set BYLINE_CALL_LOG to a .jsonl path so every real call is logged.")
        return 2
    if find_recording(inputs) is not None:
        print(f"Already recorded under key {inputs.key}; no call made.")
        return 0
    ledger = CallLedger(settings.byline_model_call_cap)
    if ledger.remaining() < max_calls:
        print(f"STOP: the ledger has {ledger.remaining()} calls left under cap {ledger.cap}; this run may need "
              f"{max_calls}. Raise BYLINE_MODEL_CALL_CAP to at least {ledger.used() + max_calls}.")
        return 3
    budget = BudgetGuard(max_calls_per_session=max_calls, max_calls_per_day=max_calls,
                         max_tokens_per_case=max_tokens, concurrency=1, ledger=ledger)
    client = provider.chat_client(settings)
    run = await investigate_moment(inputs, client=client, budget=budget, provider="foundry",
                                   deployment=settings.foundry_deployment, session_id=SESSION)
    if spanish and run.insight is not None:
        await translate_run(run, client=client, budget=budget, session_id=SESSION)
    p = run.provenance
    print(f"{inputs.subject.moment_id}: state={run.status} calls={p['model_calls']} tokens in/out="
          f"{p['input_tokens']}/{p['output_tokens']} est_cost=USD {p['est_cost_usd']:.4f} "
          f"latency_ms={p['total_latency_ms']} ledger={ledger.used()}/{ledger.cap}")
    for c in p["calls"]:
        print(f"   {c['role']:<12} ok={c['ok']} latency_ms={c['latency_ms']} in={c.get('input_tokens')} "
              f"out={c.get('output_tokens')} slot={c.get('ledger_slot')} id={c.get('response_id')}")
    if run.insight is not None:
        a = run.insight.audience
        print("   title:      ", run.insight.title)
        print("   commentator:", a.commentator)
        print("   studio:     ", a.studio_title, "|", a.studio_subtitle)
        print("   fan:        ", a.fan_plain)
    issues = (run.case.decision.issues if run.case.decision else []) + run.case.validator_issues
    if issues:
        print("   issues:", issues)
    if run.status == "failed":
        print(f"   not recorded: {p.get('error')}")
        return 1
    path = save_recording(recording_record(run))
    print(f"   recorded: {path}")
    return 0


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--match", required=True)
    ap.add_argument("--moment", required=True)
    ap.add_argument("--max-calls", type=int, default=HARD_MAX_CALLS)
    ap.add_argument("--max-tokens", type=int, default=DEFAULT_MAX_TOKENS)
    ap.add_argument("--spanish", action="store_true")
    ap.add_argument("--confirm", action="store_true", help="make the real model calls (default: plan only)")
    a = ap.parse_args(argv)
    if not 3 <= a.max_calls <= HARD_MAX_CALLS:
        print(f"--max-calls must be between 3 and {HARD_MAX_CALLS} (translation and revision included)")
        return 2
    try:
        pkg = package_for_match(a.match)
        inputs = moment_inputs(pkg, a.moment)
    except KeyError as exc:
        print(f"unknown match or moment: {exc}")
        return 2
    settings = Settings()
    if not a.confirm:
        lines, _ = plan(inputs, max_calls=a.max_calls, max_tokens=a.max_tokens, spanish=a.spanish,
                        settings=settings, ledger=CallLedger(settings.byline_model_call_cap, DEFAULT_PATH))
        print("\n".join(lines))
        return 0
    return asyncio.run(run_confirmed(inputs, max_calls=a.max_calls, max_tokens=a.max_tokens, spanish=a.spanish,
                                     settings=settings))


if __name__ == "__main__":
    sys.exit(main())
