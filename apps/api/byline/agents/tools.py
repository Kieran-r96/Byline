"""Bounded, read-only agent tools over one investigation case.

Every tool sees only events up to the case snapshot (no future knowledge), validates ids and
ranges, returns compact JSON, and records each invocation for the trace.
"""

from __future__ import annotations

import json
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Annotated, Any

from agent_framework import FunctionTool, tool
from pydantic import Field

from byline.agents.subject import TacticalSubject
from byline.events.models import MatchEvent
from byline.football.detectors.base import PatternCandidate
from byline.football.rules_reference import law_reference
from byline.stories.models import ToolCallRecord
from byline.world.models import World

MAX_EVENTS_PER_CALL = 25


def _compact(ev: MatchEvent, world: World) -> dict[str, Any]:
    out: dict[str, Any] = {"id": ev.event_id, "clock": ev.display_clock, "type": ev.type}
    if ev.team_id:
        out["team"] = world.team(ev.team_id).short_name
    if ev.player_id:
        actor = world.player(ev.player_id)
        out["player"] = f"#{actor.shirt_number} {actor.display_name}"
    p = ev.payload
    for key in ("start", "end", "location"):
        if key in p:
            out[key] = [p[key]["x_m"], p[key]["y_m"]]
    for key in ("outcome", "pass_kind", "height", "restart_type", "severity", "foul_type", "reason"):
        if key in p:
            out[key] = p[key]
    for key in ("receiver_player_id", "victim_player_id"):
        if key in p:
            r = world.player(p[key])
            out[key.removesuffix("_player_id")] = f"#{r.shirt_number} {r.display_name}"
    return out


@dataclass
class CaseTools:
    world: World
    events: tuple[MatchEvent, ...]
    snapshot_seq: int
    candidate: PatternCandidate | TacticalSubject
    state_snapshot: dict[str, Any]
    prior_insight_titles: list[str] = field(default_factory=list)
    tracking: dict[str, Any] | None = None
    calls: list[ToolCallRecord] = field(default_factory=list)
    fetched_ids: set[str] = field(default_factory=set)
    prefetching: bool = False

    def __post_init__(self) -> None:
        self._by_id = {e.event_id: e for e in self.events if e.seq <= self.snapshot_seq}

    def _record(self, name: str, args: dict[str, Any], fn: Callable[[], Any]) -> str:
        t0 = time.perf_counter()
        try:
            result = fn()
        except (KeyError, ValueError) as exc:
            result = {"error": str(exc)}
        text = json.dumps(result, separators=(",", ":"))
        self.calls.append(ToolCallRecord(name=name, arguments=args, result_preview=text[:300],
                                         latency_ms=int((time.perf_counter() - t0) * 1000),
                                         prefetched=self.prefetching))
        return text

    # ---------------------------------------------------------------- tool bodies

    def get_events(self, event_ids: list[str]) -> str:
        def run() -> Any:
            ids = event_ids[:MAX_EVENTS_PER_CALL]
            found, missing = [], []
            for i in ids:
                ev = self._by_id.get(i)
                if ev is None:
                    missing.append(i)
                else:
                    self.fetched_ids.add(i)
                    found.append(_compact(ev, self.world))
            return {"events": found, "unknown_ids": missing}
        return self._record("get_events", {"event_ids": event_ids}, run)

    def get_recent_events(self, team_id: str, minutes: int, types: list[str] | None = None) -> str:
        def run() -> Any:
            if team_id not in (self.world.fixture.home_team_id, self.world.fixture.away_team_id):
                raise ValueError(f"unknown team {team_id}")
            mins = max(1, min(int(minutes), 15))
            end = self.candidate.detected_at_ms
            evs = [e for e in self._by_id.values()
                   if e.team_id == team_id and end - mins * 60_000 <= e.elapsed_ms <= end
                   and (not types or e.type in types)]
            evs = evs[-40:]
            self.fetched_ids.update(e.event_id for e in evs)
            return {"team": team_id, "minutes": mins, "count": len(evs), "events": [_compact(e, self.world) for e in evs]}
        return self._record("get_recent_events", {"team_id": team_id, "minutes": minutes, "types": types}, run)

    def get_player(self, player_id: str) -> str:
        def run() -> Any:
            p = self.world.player(player_id)
            involvement: dict[str, int] = {}
            for e in self._by_id.values():
                if e.player_id == player_id:
                    involvement[e.type] = involvement.get(e.type, 0) + 1
            return {"id": p.player_id, "name": f"{p.given_name} {p.family_name}", "shirt": p.shirt_number,
                    "position": p.position, "team": self.world.team(p.team_id).name,
                    "match_involvement_so_far": involvement, "fictional": True}
        return self._record("get_player", {"player_id": player_id}, run)

    def get_match_context(self) -> str:
        def run() -> Any:
            s = self.state_snapshot
            return {"minute": s["minute"], "score": s["score"], "provisional_score": s["provisional_score"],
                    "home": self.world.home.name, "away": self.world.away.name,
                    "players_on_pitch": {t: len(v["on_pitch"]) for t, v in s["teams"].items()},
                    "cards": [{"player": c["player_id"], "colour": c["colour"], "minute": c["minute"]}
                              for c in s["cards"]],
                    "attacking_direction_this_half": s["attacking_direction"]}
        return self._record("get_match_context", {}, run)

    def get_detector_metrics(self) -> str:
        def run() -> Any:
            c = self.candidate
            return {"pattern_type": c.pattern_type, "team": c.team_id, "metrics": c.calculated_metrics,
                    "evidence_event_ids": list(c.evidence_event_ids), "factual_summary": c.factual_summary,
                    "allowed_claims": list(c.allowed_claims), "unsupported_claims": list(c.unsupported_claims),
                    "constraints": list(c.explanation_constraints)}
        return self._record("get_detector_metrics", {}, run)

    def get_moment_facts(self) -> str:
        """Tactical cases: the moment's deterministic fact sheet (observed, what happened, measured alternatives,
        lines, unknowns, metrics). The tactical counterpart of get_detector_metrics."""
        def run() -> Any:
            c = self.candidate
            if not isinstance(c, TacticalSubject):
                raise ValueError("not a tactical moment case")
            return c.facts
        return self._record("get_moment_facts", {}, run)

    def get_rule(self, law_number: int) -> str:
        return self._record("get_rule", {"law_number": law_number}, lambda: law_reference(int(law_number)))

    def get_prior_insights(self) -> str:
        return self._record("get_prior_insights", {}, lambda: {"titles": self.prior_insight_titles[-5:]})

    def get_tracking_window(self, start_ms: int, end_ms: int, player_ids: list[str]) -> str:
        def run() -> Any:
            if self.tracking is None:
                return {"available": False, "note": "No positional tracking used for this case"}
            if end_ms - start_ms > 15_000 or end_ms < start_ms:
                raise ValueError("window must be 0-15 seconds")
            if end_ms > self.candidate.detected_at_ms:
                raise ValueError("window cannot extend beyond the case snapshot")
            ents = self.tracking["entities"]
            idx = {pid: 4 + 2 * i for i, pid in enumerate(ents)}
            rows = [r for r in self.tracking["frames"] if start_ms <= r[0] <= end_ms][::2]
            out = {pid: [[r[0], r[idx[pid]], r[idx[pid] + 1]] for r in rows]
                   for pid in player_ids[:4] if pid in idx}
            return {"available": True, "sample_ms": 1000, "positions": out,
                    "precision": "player-centre synthetic tracking"}
        return self._record("get_tracking_window", {"start_ms": start_ms, "end_ms": end_ms,
                                                    "player_ids": player_ids}, run)

    def prefetch(self, event_ids: list[str], context: bool) -> str:
        """The standard evidence bundle, fetched through the same bounded tools (recorded, marked prefetched)."""
        self.prefetching = True
        try:
            if isinstance(self.candidate, TacticalSubject):
                parts = {"moment_facts": json.loads(self.get_moment_facts())}
            else:
                parts = {"detector_metrics": json.loads(self.get_detector_metrics())}
            parts["events"] = json.loads(self.get_events(event_ids))
            if context:
                parts["match_context"] = json.loads(self.get_match_context())
        finally:
            self.prefetching = False
        return json.dumps(parts, indent=1)

    # ---------------------------------------------------------------- AF tool objects

    def investigator_tools(self) -> list[FunctionTool]:
        t = self

        @tool(name="get_detector_metrics", description="Deterministic detector output for this case: metrics, "
              "evidence ids, allowed and unsupported claims.")
        def get_detector_metrics() -> str:
            return t.get_detector_metrics()

        @tool(name="get_events", description="Fetch specific match events by id (max 25).")
        def get_events(event_ids: Annotated[list[str], Field(description="Event ids such as E0123")]) -> str:
            return t.get_events(event_ids)

        @tool(name="get_recent_events", description="Recent events for one team up to the case time.")
        def get_recent_events(team_id: Annotated[str, Field(description="NBA or RVC")],
                              minutes: Annotated[int, Field(description="1-15")],
                              types: Annotated[list[str] | None, Field(description="Optional event types")] = None,
                              ) -> str:
            return t.get_recent_events(team_id, minutes, types)

        @tool(name="get_match_context", description="Score, minute, cards and players on the pitch at case time.")
        def get_match_context() -> str:
            return t.get_match_context()

        @tool(name="get_player", description="Fictional player profile and involvement so far.")
        def get_player(player_id: Annotated[str, Field(description="Player id such as NBA-07")]) -> str:
            return t.get_player(player_id)

        @tool(name="get_prior_insights", description="Titles of insights already published this match.")
        def get_prior_insights() -> str:
            return t.get_prior_insights()

        @tool(name="get_tracking_window", description="Synthetic player-centre positions (1 Hz) for up to 4 "
              "players within a 15 s window. Returns available=false when tracking is not part of the case.")
        def get_tracking_window(start_ms: int, end_ms: int, player_ids: list[str]) -> str:
            return t.get_tracking_window(start_ms, end_ms, player_ids)

        return [get_detector_metrics, get_events, get_recent_events, get_match_context, get_player,
                get_prior_insights, get_tracking_window]

    def investigator_extra_tools(self) -> list[FunctionTool]:
        """V3: only tools that add context beyond the prefetched bundle (measured: offering the duplicates made
        gpt-4.1-mini re-fetch data it already had, costing a round trip and ~40% more tokens)."""
        keep = {"get_recent_events", "get_player", "get_prior_insights", "get_tracking_window"}
        return [f for f in self.investigator_tools() if f.name in keep]

    def verifier_tools(self) -> list[FunctionTool]:
        t = self

        @tool(name="get_events", description="Fetch specific match events by id to check a claim (max 25).")
        def get_events(event_ids: list[str]) -> str:
            return t.get_events(event_ids)

        @tool(name="get_detector_metrics", description="The authoritative computed metrics for this case.")
        def get_detector_metrics() -> str:
            return t.get_detector_metrics()

        @tool(name="get_match_context", description="Score, minute, cards and players on the pitch at case time.")
        def get_match_context() -> str:
            return t.get_match_context()

        return [get_events, get_detector_metrics, get_match_context]
