"""Tactical moment -> agent case -> verified interpretation, recorded once and served from the recording.

The case is opened from a deterministic TacticalMoment and its What If? payload (agents/subject.py) and runs
through the same Investigator -> Analyst -> Verifier -> deterministic validator workflow as detector stories,
with the tactical validator (validator.validate_tactical_draft) as the publication gate.

Recordings (recorded/tactics/<key>.json) are keyed by moment id + input hash + tactical prompt version. The
input hash covers everything the agents could receive: the case subject (moment facts and metrics), every
event up to the case snapshot, the match state at the snapshot and the tracking frames up to it. A data fix
that leaves those inputs byte-identical keeps the key (no re-key needed); any change to them means the
recording is no longer served and the moment shows `not_run` until a fresh real run. Nothing is regenerated.

HTTP never starts a model call: the endpoint only reads recordings. Real runs happen only through the
operator CLI (tools/run_tactical_case.py --confirm).
"""

from __future__ import annotations

import contextlib
import datetime as dt
import hashlib
import json
import os
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from byline.agents.budget import BudgetGuard
from byline.agents.orchestrator import (
    USD_PER_M_INPUT,
    USD_PER_M_OUTPUT,
    InvestigationCase,
    StageCallback,
    close_trace,
    open_case,
    run_workflow,
)
from byline.agents.prompts import TACTICAL_COMPATIBLE_PROMPT_VERSIONS, TACTICAL_PROMPT_VERSION
from byline.agents.subject import TacticalSubject, subject_from_moment
from byline.config import API_ROOT
from byline.football.intelligence import moments_for
from byline.match_state.reducer import replay
from byline.storage.fixtures import MatchPackage
from byline.tactics.frame import Pitch
from byline.tactics.moments import TacticalMoment
from byline.tactics.whatif import build_whatif

# Committed recordings of REAL Foundry tactical runs. Tests point RECORDED_TACTICS at a temp dir; the guard in
# save_recording always compares against the real location, so a mock run can never be written there.
_REAL_RECORDED_TACTICS = API_ROOT / "recorded" / "tactics"
RECORDED_TACTICS = _REAL_RECORDED_TACTICS
HYPOTHETICAL_LABEL = "What if: other options on the same frame. Not what happened; no outcome is implied."

AIState = Literal["verified", "tentative", "rejected", "not_run"]


class TacticalAudience(BaseModel):
    model_config = ConfigDict(extra="forbid")
    commentator: str = Field(description="One-liner a commentator can say live")
    studio_title: str = Field(max_length=80)
    studio_subtitle: str = Field(max_length=140)
    fan_plain: str = Field(description="Plain-language explanation for a casual fan")
    fan_analyst: str
    translations: dict[str, str] = Field(default_factory=dict)


class TacticalInsight(BaseModel):
    """Insight-like verified interpretation of one tactical moment (measurements stay authoritative)."""

    model_config = ConfigDict(extra="forbid")
    insight_id: str
    match_id: str
    moment_id: str
    kind: str
    team_id: str
    display_clock: str
    status: Literal["verified", "tentative"]
    title: str
    canonical_claim: str
    why_it_matters: str
    uncertainty: str
    certainty: Literal["supported", "tentative"]
    evidence_event_ids: list[str]
    metric_provenance: dict[str, float | int | str | bool]
    audience: TacticalAudience
    hypothetical_label: str = HYPOTHETICAL_LABEL
    verifier: dict[str, Any]
    validator: dict[str, Any]


# ---------------------------------------------------------------- inputs, hash and key


@dataclass
class TacticalInputs:
    pkg: MatchPackage
    moment: TacticalMoment
    whatif: dict[str, Any] | None
    subject: TacticalSubject
    state: dict[str, Any]
    input_hash: str
    key: str


def find_moment(pkg: MatchPackage, moment_id: str) -> TacticalMoment:
    m = next((x for x in moments_for(pkg.events_sha256, pkg.world, pkg.events, pkg.tracking)
              if x.moment_id == moment_id), None)
    if m is None:
        raise KeyError(moment_id)
    return m


def compute_input_hash(subject: TacticalSubject, pkg: MatchPackage, state: dict[str, Any]) -> str:
    tracking = {k: v for k, v in pkg.tracking.items() if k != "frames"}
    tracking["frames"] = [r for r in pkg.tracking.get("frames", []) if r[0] <= subject.detected_at_ms]
    blob = {
        "subject": subject.model_dump(mode="json"),
        "events": [e.to_json_dict() for e in pkg.events if e.seq <= subject.detected_at_seq],
        "state": state,
        "tracking": tracking,
    }
    raw = json.dumps(blob, sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(raw.encode()).hexdigest()


def recording_key(moment_id: str, input_hash: str, version: str = TACTICAL_PROMPT_VERSION) -> str:
    return hashlib.sha256(json.dumps([moment_id, input_hash, version]).encode()).hexdigest()[:24]


_INPUTS: dict[tuple[str, str], TacticalInputs] = {}


def moment_inputs(pkg: MatchPackage, moment_id: str) -> TacticalInputs:
    """Deterministic case inputs for one moment (memoised per immutable log). Raises KeyError if unknown."""
    k = (pkg.events_sha256, moment_id)
    if k not in _INPUTS:
        m = find_moment(pkg, moment_id)
        whatif = build_whatif(m, pkg.world, list(pkg.events), Pitch(pkg.world, pkg.events, pkg.tracking)) \
            if m.whatif else None
        subject = subject_from_moment(m, whatif, pkg.world)
        state = replay(pkg.world, list(pkg.events), upto_seq=subject.detected_at_seq).snapshot()
        h = compute_input_hash(subject, pkg, state)
        _INPUTS[k] = TacticalInputs(pkg, m, whatif, subject, state, h, recording_key(moment_id, h))
    return _INPUTS[k]


# ---------------------------------------------------------------- running a case


@dataclass
class TacticalRun:
    case: InvestigationCase
    inputs: TacticalInputs
    status: Literal["verified", "tentative", "rejected", "failed"]
    insight: TacticalInsight | None
    provenance: dict[str, Any]
    translation: dict[str, Any] | None = None


def _iso(t: float) -> str:
    return dt.datetime.fromtimestamp(t, tz=dt.UTC).isoformat(timespec="seconds")


def _validator_attempts(case: InvestigationCase) -> list[list[str]]:
    return [list((s.output or {}).get("issues", [])) for s in case.trace.steps if s.agent == "deterministic_validator"]


def build_result(case: InvestigationCase, inputs: TacticalInputs
                 ) -> tuple[Literal["verified", "tentative", "rejected", "failed"], TacticalInsight | None]:
    if case.error is not None or case.draft is None or case.decision is None:
        return "failed", None
    if case.decision.verdict != "approved" or case.validator_issues:
        return "rejected", None
    d, s = case.draft, inputs.subject
    status: Literal["verified", "tentative"] = "verified" if d.certainty == "supported" else "tentative"
    return status, TacticalInsight(
        insight_id=f"TI-{s.moment_id}", match_id=s.match_id, moment_id=s.moment_id, kind=s.kind,
        team_id=s.team_id, display_clock=s.display_clock, status=status, title=d.title,
        canonical_claim=d.canonical_claim, why_it_matters=d.why_it_matters, uncertainty=d.uncertainty,
        certainty="supported" if d.certainty == "supported" else "tentative",
        evidence_event_ids=list(dict.fromkeys(d.evidence_event_ids)), metric_provenance=dict(s.calculated_metrics),
        audience=TacticalAudience(commentator=d.commentator, studio_title=d.studio_headline[:80],
                                  studio_subtitle=d.studio_subtitle[:140], fan_plain=d.fan_discover,
                                  fan_analyst=d.fan_analyst),
        verifier=case.decision.model_dump(mode="json"),
        validator={"passed": True, "issues": [], "attempts": _validator_attempts(case),
                   "checker": "deterministic_validator (tactical rules)"},
    )


def _cost(tin: int, tout: int) -> float:
    return round(tin / 1e6 * USD_PER_M_INPUT + tout / 1e6 * USD_PER_M_OUTPUT, 6)


def build_provenance(case: InvestigationCase, inputs: TacticalInputs, *, provider: str, deployment: str | None,
                     started_at: float, finished_at: float, budget: BudgetGuard,
                     ledger_before: int | None) -> dict[str, Any]:
    calls = [{k: c.get(k) for k in ("role", "attempt", "ok", "started_at", "latency_ms", "input_tokens",
                                    "output_tokens", "response_id", "ledger_slot", "error")}
             for c in case.call_records]
    tin = sum(int(c.get("input_tokens") or 0) for c in calls)
    tout = sum(int(c.get("output_tokens") or 0) for c in calls)
    led = budget.ledger
    return {
        "provider": provider, "model_deployment": deployment, "prompt_version": TACTICAL_PROMPT_VERSION,
        "input_hash": inputs.input_hash, "recording_key": inputs.key, "case_id": case.case_id,
        "orchestration": case.trace.orchestration, "started_at": started_at, "started_at_iso": _iso(started_at),
        "finished_at": finished_at, "finished_at_iso": _iso(finished_at), "model_calls": len(calls),
        "input_tokens": tin, "output_tokens": tout, "total_latency_ms": case.trace.total_latency_ms,
        "est_cost_usd": _cost(tin, tout), "calls": calls,
        "ledger": None if led is None else {"cap": led.cap, "used_before": ledger_before, "used_after": led.peek(),
                                            "slots": [c["ledger_slot"] for c in calls if c.get("ledger_slot")]},
        "error": case.error,
    }


async def investigate_moment(inputs: TacticalInputs, *, client: Any, budget: BudgetGuard, provider: str,
                             deployment: str | None, session_id: str = "tactical-operator",
                             on_stage: StageCallback | None = None) -> TacticalRun:
    pkg = inputs.pkg
    ledger_before = budget.ledger.peek() if budget.ledger is not None else None
    started = time.time()
    case = open_case(inputs.subject, session_id=session_id, world=pkg.world, events=pkg.events, state=inputs.state,
                     provider=provider, deployment=deployment, prior_titles=[], tracking=pkg.tracking)
    case, t0 = await run_workflow(case, world=pkg.world, events=pkg.events, state=inputs.state, client=client,
                                  budget=budget, on_stage=on_stage)
    status, insight = build_result(case, inputs)
    close_trace(case, t0, status)
    prov = build_provenance(case, inputs, provider=provider, deployment=deployment, started_at=started,
                            finished_at=time.time(), budget=budget, ledger_before=ledger_before)
    return TacticalRun(case, inputs, status, insight, prov)


TRANSLATED = {"title": "title", "canonical_claim": "canonical_claim", "commentator": "commentator",
              "fan_discover": "fan_plain", "fan_analyst": "fan_analyst", "studio_headline": "studio_title",
              "studio_subtitle": "studio_subtitle"}


async def translate_run(run: TacticalRun, *, client: Any, budget: BudgetGuard, session_id: str) -> dict[str, Any]:
    """Optional Spanish variant of approved text (1 call, same session cap and ledger). Fields that fail the
    deterministic number/name check are dropped; English stays authoritative."""
    from byline.agents.budget import BudgetExceeded
    from byline.agents.translate import translate_texts_es

    ins = run.insight
    if ins is None:
        return {"skipped": "no approved text to translate"}
    a = ins.audience
    en = {"title": ins.title, "canonical_claim": ins.canonical_claim, "commentator": a.commentator,
          "fan_discover": a.fan_plain, "fan_analyst": a.fan_analyst, "studio_headline": a.studio_title,
          "studio_subtitle": a.studio_subtitle}
    slots: list[int | None] = []

    def charge() -> None:
        budget.charge(session_id, 0)
        slots.append(budget.ledger.last_slot if budget.ledger is not None else None)

    try:
        shipped, trace = await translate_texts_es(client, en, run.inputs.pkg.world, charge, case_id=run.case.case_id)
    except BudgetExceeded as exc:
        run.translation = {"skipped": f"budget: {exc}"}
        return run.translation
    except Exception as exc:  # noqa: BLE001 - the English insight stands; the failure is reported
        from byline.agents.provider import redact

        run.translation = {"skipped": redact(exc)}
        return run.translation
    for call, slot in zip(trace.get("calls", []), slots, strict=False):
        call["ledger_slot"] = slot
    for k, v in shipped.items():
        field = k.removeprefix("es.")
        a.translations[f"es.{TRANSLATED.get(field, field)}"] = v
    calls = [{k: c.get(k) for k in ("role", "ok", "started_at", "latency_ms", "input_tokens", "output_tokens",
                                    "response_id", "ledger_slot", "error")} for c in trace.get("calls", [])]
    p = run.provenance
    p["calls"] += calls
    p["model_calls"] = len(p["calls"])
    p["input_tokens"] += int(trace.get("input_tokens") or 0)
    p["output_tokens"] += int(trace.get("output_tokens") or 0)
    p["est_cost_usd"] = _cost(p["input_tokens"], p["output_tokens"])
    if p.get("ledger") is not None and budget.ledger is not None:
        p["ledger"]["used_after"] = budget.ledger.peek()
        p["ledger"]["slots"] += [c["ledger_slot"] for c in calls if c.get("ledger_slot")]
    run.translation = {k: trace.get(k) for k in ("model_calls", "input_tokens", "output_tokens", "latency_ms",
                                                 "issues", "response_id")}
    run.translation["fields_shipped"] = sorted(k for k in shipped if not k.endswith("_note"))
    return run.translation


# ---------------------------------------------------------------- recordings


def recording_record(run: TacticalRun) -> dict[str, Any]:
    s = run.inputs.subject
    review = {"verifier": run.case.decision.model_dump(mode="json") if run.case.decision else None,
              "validator": {"passed": not run.case.validator_issues, "issues": list(run.case.validator_issues),
                            "attempts": _validator_attempts(run.case)}}
    return {
        "kind": "tactical_insight", "match_id": s.match_id, "moment_id": s.moment_id, "state": run.status,
        "provider": run.provenance["provider"], "saved_at": time.time(), "prompt_version": TACTICAL_PROMPT_VERSION,
        "input_hash": run.inputs.input_hash,
        "insight": run.insight.model_dump(mode="json") if run.insight else None,
        **review, "provenance": run.provenance, "translation": run.translation,
        "trace": run.case.trace.model_dump(mode="json"),
        "inputs": {"subject": s.model_dump(mode="json")},
    }


def save_recording(record: dict[str, Any], folder: Path | None = None) -> Path:
    """Writes one finished run. Only real Foundry runs may ever be written to the committed store."""
    target = folder if folder is not None else RECORDED_TACTICS
    if record.get("provider") != "foundry" and target.resolve() == _REAL_RECORDED_TACTICS.resolve():
        raise ValueError("refusing to write a non-Foundry run into the committed recordings")
    if record.get("state") not in ("verified", "tentative", "rejected"):
        raise ValueError("only finished runs (verified, tentative or rejected) are recorded")
    key = record["provenance"]["recording_key"]
    target.mkdir(parents=True, exist_ok=True)
    path = target / f"{key}.json"
    tmp = path.with_suffix(f".{os.getpid()}.tmp")
    tmp.write_text(json.dumps(record, indent=1, ensure_ascii=False), encoding="utf-8")
    os.replace(tmp, path)
    return path


_INDEX: dict[str, tuple[tuple[Any, ...], dict[str, list[str]]]] = {}


def _index(folder: Path) -> dict[str, list[str]]:
    """moment_id -> recording file names; rebuilt only when the folder's files change."""
    files = sorted(folder.glob("*.json")) if folder.exists() else []
    sig = tuple((p.name, p.stat().st_mtime_ns, p.stat().st_size) for p in files)
    hit = _INDEX.get(str(folder))
    if hit is not None and hit[0] == sig:
        return hit[1]
    idx: dict[str, list[str]] = {}
    for p in files:
        with contextlib.suppress(OSError, ValueError, KeyError):
            idx.setdefault(json.loads(p.read_text(encoding="utf-8"))["moment_id"], []).append(p.name)
    _INDEX[str(folder)] = (sig, idx)
    return idx


def find_recording(inputs: TacticalInputs, folder: Path | None = None) -> dict[str, Any] | None:
    """The recording for exactly these inputs and a compatible prompt version, or None. Never calls a model."""
    target = folder if folder is not None else RECORDED_TACTICS
    if inputs.subject.moment_id not in _index(target):
        return None
    for version in (TACTICAL_PROMPT_VERSION, *TACTICAL_COMPATIBLE_PROMPT_VERSIONS):
        path = target / f"{recording_key(inputs.subject.moment_id, inputs.input_hash, version)}.json"
        if not path.exists():
            continue
        try:
            data: dict[str, Any] = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return None  # unreadable recording = not served, never a crash
        if data.get("moment_id") == inputs.subject.moment_id and data.get("input_hash") == inputs.input_hash:
            return data
    return None


def has_recording_for(moment_id: str, folder: Path | None = None) -> bool:
    return moment_id in _index(folder if folder is not None else RECORDED_TACTICS)


def insight_response(pkg: MatchPackage, moment_id: str, *, cache_only: bool) -> dict[str, Any]:
    """Payload of GET /api/matches/{match_id}/tactics/{moment_id}/insight. Reads recordings only."""
    base: dict[str, Any] = {"match_id": pkg.match_id, "moment_id": moment_id}
    rec = find_recording(moment_inputs(pkg, moment_id)) if has_recording_for(moment_id) else None
    if rec is None:
        notice = "No AI run is recorded for this moment. The measurements shown are deterministic."
        if cache_only:
            notice += " Cache-only mode: recorded runs only, no new model calls."
        return {**base, "state": "not_run", "insight": None, "provenance": None, "notice": notice}
    prov = {**rec.get("provenance", {}), "cache_hit": True, "served_from": "recording",
            "recorded_at": rec.get("saved_at"), "verifier_verdict": (rec.get("verifier") or {}).get("verdict"),
            "validator": rec.get("validator")}
    state: AIState = rec["state"]
    if rec.get("provider") != "foundry":
        who = "Test mock run: not real model output."
    else:
        when = _iso(float(rec["saved_at"]))[:16].replace("T", " ") if rec.get("saved_at") else "earlier"
        who = (f"Real Foundry run ({prov.get('model_deployment')}, {prov.get('model_calls')} model calls), recorded "
               f"{when} UTC; served from the recording, no new model call.")
    if state == "rejected":
        notice = f"{who} The AI draft did not pass verification, so only the deterministic measurements are shown."
        return {**base, "state": state, "insight": None, "provenance": prov, "notice": notice}
    if state == "tentative":
        who += " The agents rated the evidence tentative."
    return {**base, "state": state, "insight": rec.get("insight"), "provenance": prov, "notice": who}


def ai_state(pkg: MatchPackage, moment_id: str) -> AIState:
    """Cheap: only hashes inputs when a recording for this moment id exists at all."""
    if not has_recording_for(moment_id):
        return "not_run"
    rec = find_recording(moment_inputs(pkg, moment_id))
    if rec is None:
        return "not_run"
    state: AIState = rec["state"]
    return state
