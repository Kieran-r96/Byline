"""Case subjects other than detector candidates: a measured tactical moment opened as an agent case.

`TacticalSubject` carries the same fields the investigation pipeline reads from a `PatternCandidate`
(id, team, snapshot, evidence ids, authoritative metrics, factual summary, claim lists), so the
investigator -> analyst -> verifier workflow, its bounded tools and the deterministic validator run
unchanged. Everything in it comes from the deterministic tactics engine: the moment's observed
measurements, its What If? payload (what happened, measured alternatives on the same frame, lines) and
its unknowns. Nothing is generated here and no model is called.
"""

from __future__ import annotations

import re
from typing import Any

from pydantic import BaseModel, ConfigDict

from byline.tactics.moments import KIND_LABEL, TacticalMoment
from byline.world.models import World

# option fields that are measurements (pitch coordinates and the internal ranking value are not)
OPTION_MEASURES = ("lane_clearance_m", "receiver_space_m", "progression_m", "distance_m", "opponents_bypassed")
MOMENT_UNSUPPORTED = (
    "what the passer saw or intended (no facing or intent data)",
    "whether any alternative pass would have been completed",
    "any outcome, chance or probability after this instant",
    "instructions from coaches or a planned pattern",
)


class TacticalSubject(BaseModel):
    """A tactical moment in the shape the agent pipeline expects (PatternCandidate-compatible fields)."""

    model_config = ConfigDict(frozen=True, extra="forbid")
    candidate_id: str  # = moment_id: names the case, the trace and the log lines
    match_id: str
    pattern_type: str  # "tactical_<kind>"
    team_id: str
    detected_at_seq: int  # the moment's available_seq: the latest event its measurements use
    detected_at_ms: int
    display_clock: str
    window_start_ms: int
    window_end_ms: int
    evidence_event_ids: tuple[str, ...]
    calculated_metrics: dict[str, float | int | str | bool]
    factual_summary: str
    allowed_claims: tuple[str, ...]
    unsupported_claims: tuple[str, ...]
    explanation_constraints: tuple[str, ...]
    # tactical extras
    moment_id: str
    kind: str
    title: str
    player_ids: tuple[str, ...]  # every player the moment's measurements name; the only names a draft may use
    facts: dict[str, Any]  # the moment fact sheet given to the agents (get_moment_facts)


def _label(world: World, pid: str | None) -> str | None:
    if not pid:
        return None
    p = world.player(pid)
    return f"#{p.shirt_number} {p.display_name}"


def _minute(clock: str) -> int | None:
    m = re.match(r"\s*(\d+)", clock)
    return int(m.group(1)) if m else None


def _option_facts(world: World, o: dict[str, Any]) -> dict[str, Any]:
    out: dict[str, Any] = {"receiver": _label(world, o["receiver_id"]), "rating": o["rating"]}
    out["lane_nearest_opponent_m"] = o["lane_clearance_m"]
    out["opponents_in_lane"] = [_label(world, p) for p in o.get("lane_opponents", [])]
    out["closest_to_lane"] = _label(world, o.get("lane_blocker_id"))
    out["space_around_receiver_m"] = o["receiver_space_m"]
    out["nearest_marker"] = _label(world, o.get("nearest_marker_id"))
    out["ground_gained_m"] = o["progression_m"]
    out["pass_length_m"] = o["distance_m"]
    out["opponents_bypassed"] = o["opponents_bypassed"]
    out["between_lines"] = o.get("between_lines")
    out["offside_position"] = o.get("offside_position")
    return out


def subject_from_moment(m: TacticalMoment, whatif: dict[str, Any] | None, world: World) -> TacticalSubject:
    """Adapter: TacticalMoment (+ its What If? payload) -> agent case subject. Deterministic."""
    metrics: dict[str, float | int | str | bool] = {}
    minute = _minute(m.display_clock)
    if minute is not None:
        metrics["minute"] = minute
    for i, ob in enumerate(m.observed, 1):
        if isinstance(ob["value"], int | float) and not isinstance(ob["value"], bool):
            metrics[f"observed_{i}_{re.sub(r'[^a-z]+', '_', ob['label'].lower()).strip('_')}"] = ob["value"]
    players: list[str] = list(m.focus_player_ids)
    facts: dict[str, Any] = {
        "moment_id": m.moment_id, "kind": m.kind, "label": KIND_LABEL.get(m.kind, m.kind),
        "team": world.team(m.team_id).short_name, "clock": m.display_clock, "title": m.title,
        "summary": m.summary, "deterministic_interpretation": m.interpretation,
        "observed": [{"label": o["label"], "value": o["value"], "unit": o["unit"]} for o in m.observed],
        "unknowns": list(m.unknowns), "evidence_event_ids": list(m.evidence_event_ids),
        "measured_from": "synthetic event log + 2 Hz player-centre tracking, frame at the decision instant",
    }
    if whatif is not None:
        actual = whatif["actual"]
        players += [p for p in (whatif.get("carrier_id"), actual.get("receiver_id"), actual.get("interceptor_id"),
                                actual.get("fouler_id")) if p]
        act: dict[str, Any] = {"kind": actual["kind"], "by": _label(world, whatif.get("carrier_id")),
                               "towards": _label(world, actual.get("receiver_id")), "outcome": actual.get("outcome"),
                               "intercepted_by": _label(world, actual.get("interceptor_id")),
                               "event_id": actual.get("event_id")}
        opt = actual.get("option")
        if opt:
            act["measured_lane"] = _option_facts(world, opt)
            players += [*opt.get("lane_opponents", []), opt.get("lane_blocker_id"), opt.get("nearest_marker_id")]
            for k in OPTION_MEASURES:
                metrics[f"actual_{k}"] = opt[k]
            metrics["actual_opponents_in_lane"] = len(opt.get("lane_opponents", []))
        alts = []
        for i, o in enumerate(whatif.get("alternatives", []), 1):
            alts.append(_option_facts(world, o))
            players += [o["receiver_id"], o.get("lane_blocker_id"), o.get("nearest_marker_id")]
            for k in OPTION_MEASURES:
                metrics[f"alternative_{i}_{k}"] = o[k]
        metrics["alternatives_measured"] = len(alts)
        facts["what_happened"] = act
        facts["alternatives_on_the_same_frame"] = alts
        lines = whatif.get("lines")
        if lines:
            facts["defending_lines_x_m"] = lines
            metrics["defending_back_line_x_m"] = lines["back_x"]
            metrics["defending_midfield_line_x_m"] = lines["mid_x"]
            metrics["offside_line_x_m"] = lines["offside_x"]
            metrics["midfield_to_back_line_gap_m"] = round(abs(lines["back_x"] - lines["mid_x"]), 1)
        facts["labels"] = whatif.get("labels", {})
        facts["option_rules"] = whatif.get("rules", {})
        for rating in ("open", "contested"):
            # e.g. "lane >= 3.0 m from every opponent and >= 4.0 m of space": the published thresholds
            nums = re.findall(r">= ([\d.]+) m", str(whatif.get("rules", {}).get(rating, "")))
            if len(nums) == 2:
                metrics[f"{rating}_lane_rule_m"] = float(nums[0])
                metrics[f"{rating}_space_rule_m"] = float(nums[1])
    player_ids = tuple(dict.fromkeys(p for p in players if p))
    facts["players_in_moment"] = [_label(world, p) for p in player_ids]
    facts["metrics"] = metrics
    rep = whatif.get("replay") if whatif else None
    return TacticalSubject(
        candidate_id=m.moment_id, match_id=world.fixture.match_id, pattern_type=f"tactical_{m.kind}",
        team_id=m.team_id, detected_at_seq=m.available_seq, detected_at_ms=m.available_ms,
        display_clock=m.display_clock,
        window_start_ms=int(rep["from_ms"]) if rep else max(0, m.at_ms - 6000), window_end_ms=m.available_ms,
        evidence_event_ids=tuple(m.evidence_event_ids), calculated_metrics=metrics, factual_summary=m.summary,
        allowed_claims=(
            "what happened at the instant, as recorded in the event log",
            "the measured lanes, space, ground gained and opponents bypassed for each option",
            "that other passing options existed on the same frame, framed as options or alternatives",
        ),
        unsupported_claims=tuple(dict.fromkeys([*m.unknowns, *MOMENT_UNSUPPORTED])),
        explanation_constraints=(
            "history first: what happened, with event ids",
            "alternatives are options on the same frame, never outcomes",
            "no intent, no instructions, no judgement of the player",
            "no outcome or probability claims",
        ),
        moment_id=m.moment_id, kind=m.kind, title=m.title, player_ids=player_ids, facts=facts,
    )
