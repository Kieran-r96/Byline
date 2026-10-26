"""Full-time recap: reconciled with the final authoritative state, citing event ids.

Deterministic recap always exists. An optional single Foundry call rewrites it as editorial
prose; that draft must pass a deterministic check (scores, minutes, names, ids) or the
deterministic recap is used. Retracted or rejected stories never appear.
"""

from __future__ import annotations

import json
import re
import time
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from byline.agents.validator import BANNED, WORD_NUMBERS
from byline.events.models import MatchEvent
from byline.match_state.reducer import MatchState
from byline.stories.models import Insight


class RecapPoint(BaseModel):
    model_config = ConfigDict(extra="forbid")
    minute: str
    text: str
    event_ids: list[str]


class RecapDraft(BaseModel):
    """Structured output requested from the recap writer."""

    model_config = ConfigDict(extra="forbid")
    headline: str = Field(description="Max 12 words, factual, no hype")
    summary: str = Field(description="Max 90 words narrative of the match using only the facts given")
    turning_points: list[RecapPoint] = Field(description="Exactly three key moments in time order")


class Recap(BaseModel):
    match_id: str
    final_score: dict[str, int]
    headline: str
    summary: str
    turning_points: list[RecapPoint]
    goals: list[dict[str, Any]]
    disallowed: list[dict[str, Any]]
    discipline: list[dict[str, Any]]
    stories: list[dict[str, Any]]
    stats: dict[str, Any]
    source_event_ids: list[str]
    generated_by: Literal["deterministic", "foundry_recap_writer"]
    validation_issues: list[str] = Field(default_factory=list)
    model_trace: dict[str, Any] | None = None
    synthetic_notice: str = "Synthetic match between fictional clubs."


class RecapNotReady(RuntimeError):
    pass


RECAP_STATS = ("passes", "passes_completed", "shots", "shots_on_target", "fouls", "corners", "offsides")


def recap_facts(state: MatchState, events: list[MatchEvent], insights: list[Insight]) -> dict[str, Any]:
    if not state.finished:
        raise RecapNotReady("A recap is only available after match.finished.")
    w = state.world

    def who(pid: str | None) -> str:
        if pid is None:
            return "unknown"
        p = w.player(pid)
        return f"{p.given_name} {p.family_name} (#{p.shirt_number}, {w.team(p.team_id).short_name})"

    seq = {e.event_id: e.seq for e in events}
    by_id = {e.event_id: e for e in events}
    goals = [{"minute": g.minute, "team": w.team(g.team_id).short_name, "scorer": who(g.scorer_id),
              "situation": g.situation, "event_id": g.goal_event_id, "decided_by": g.decided_by_event_id,
              "seq": seq.get(g.goal_event_id, 0)}
             for g in state.goals if g.status == "confirmed"]

    def why(decided_by: str | None) -> str:
        ev = by_id.get(decided_by or "")
        if ev is None:
            return "ruled out"
        if ev.payload.get("law_ref") == "Law 14":
            return "ruled out and the penalty retaken (accidental double touch)"
        if ev.payload.get("decision_route") == "after_var_check":
            return f"ruled out for {str(ev.payload.get('reason', '')).replace('_', ' ')} after a VAR check"
        return f"ruled out for {str(ev.payload.get('reason', '')).replace('_', ' ')} by the referee"

    disallowed = [{"minute": g.minute, "team": w.team(g.team_id).short_name, "scorer": who(g.scorer_id),
                   "event_id": g.goal_event_id, "decided_by": g.decided_by_event_id, "why": why(g.decided_by_event_id),
                   "seq": seq.get(g.goal_event_id, 0)}
                  for g in state.goals if g.status == "disallowed"]
    discipline = [{"minute": c.minute, "player": who(c.player_id), "card": c.colour, "event_id": c.card_event_id,
                   "seq": seq.get(c.card_event_id, 0)}
                  for c in state.cards if c.status == "active"]
    stories = [{"title": i.title, "claim": i.canonical_claim, "insight_id": i.insight_id,
                "evidence_event_ids": i.evidence_event_ids[:6]}
               for i in insights if i.status == "verified"]
    # the recap fact sheet keeps its original stat keys: every stat value becomes an allowed number for the
    # recap validator, and rekey_recordings compares this sheet (V4 stats live in the state snapshot only)
    st = {w.team(t).short_name: {k: getattr(s, k) for k in RECAP_STATS} for t, s in state.stats.items()}
    return {
        "home": w.home.name, "away": w.away.name, "home_short": w.home.short_name, "away_short": w.away.short_name,
        "final_score": {w.home.short_name: state.score[w.home.team_id], w.away.short_name: state.score[w.away.team_id]},
        "goals": goals, "disallowed_goals": disallowed, "discipline": discipline, "verified_stories": stories,
        "stats": st,
    }


def deterministic_recap(state: MatchState, facts: dict[str, Any]) -> Recap:
    hs, as_ = facts["home_short"], facts["away_short"]
    fs = facts["final_score"]
    h, a = fs[hs], fs[as_]
    winner = hs if h > a else as_ if a > h else None
    headline = (f"{winner} win {max(h, a)}–{min(h, a)}" if winner else f"{hs} and {as_} draw {h}–{a}")
    keyed: list[tuple[int, RecapPoint]] = []
    for g in facts["goals"]:
        keyed.append((g["seq"], RecapPoint(minute=g["minute"], text=f"{g['scorer']} scores"
                                           + (" from the penalty spot" if g["situation"] == "penalty" else "") + ".",
                                           event_ids=[g["event_id"]])))
    for d in facts["disallowed_goals"]:
        keyed.append((d["seq"], RecapPoint(minute=d["minute"], text=f"{d['scorer']}'s goal is {d['why']}.",
                                           event_ids=[d["event_id"], d["decided_by"]])))
    for c in facts["discipline"]:
        if c["card"] in ("second_yellow", "red"):
            keyed.append((c["seq"], RecapPoint(minute=c["minute"], text=f"{c['player']} is sent off.",
                                               event_ids=[c["event_id"]])))
    points = [p for _, p in sorted(keyed, key=lambda kv: kv[0])]
    parts = [f"{facts['home']} {h}–{a} {facts['away']}."]
    if facts["goals"]:
        parts.append("Goals: " + "; ".join(f"{g['scorer']} {g['minute']}" for g in facts["goals"]) + ".")
    n_dis = len(facts["disallowed_goals"])
    if n_dis:
        parts.append(f"{n_dis} goal{'s' if n_dis > 1 else ''} ruled out.")
    reds = [c for c in facts["discipline"] if c["card"] in ("second_yellow", "red")]
    if reds:
        parts.append(f"{len(reds)} player{'s' if len(reds) > 1 else ''} sent off.")
    return Recap(match_id=state.match_id, final_score=fs, headline=headline, summary=" ".join(parts),
                 turning_points=points, goals=facts["goals"], disallowed=facts["disallowed_goals"],
                 discipline=facts["discipline"], stories=facts["verified_stories"], stats=facts["stats"],
                 source_event_ids=sorted({i for p in points for i in p.event_ids if i}),
                 generated_by="deterministic")


def _minute_key(minute: str) -> tuple[int, int]:
    nums = [int(n) for n in re.findall(r"\d+", minute)]
    return (nums[0], nums[1] if len(nums) > 1 else 0) if nums else (0, 0)


def validate_recap(draft: RecapDraft, facts: dict[str, Any], known_ids: set[str], world: Any) -> list[str]:
    issues: list[str] = []
    allowed: set[float] = {1.0}
    for v in facts["final_score"].values():
        allowed.add(float(v))
    for group in ("goals", "disallowed_goals", "discipline"):
        for item in facts[group]:
            allowed.update(float(n) for n in re.findall(r"\d+", item["minute"]))
            allowed.update(float(n) for n in re.findall(r"#(\d+)", item.get("scorer", item.get("player", ""))))
    for s in facts["stats"].values():
        allowed.update(float(v) for v in s.values())
    allowed.add(float(len(facts["goals"])))
    allowed.add(float(len(facts["disallowed_goals"])))
    allowed.add(10.0)  # "ten men" after a dismissal
    texts = [draft.headline, draft.summary, *[p.text for p in draft.turning_points]]
    for t in texts:
        cleaned = re.sub(r"\bE\d{3,5}\b", " ", t)
        for m in re.finditer(r"(?<![\w.])(\d+(?:\.\d+)?)", cleaned):
            if float(m.group(1)) not in allowed:
                issues.append(f"unsupported number {m.group(1)}")
        for wname, val in WORD_NUMBERS.items():
            if re.search(rf"\b{wname}\b", cleaned, re.I) and float(val) not in allowed:
                issues.append(f"unsupported number word '{wname}'")
        for pattern, why in BANNED:
            if re.search(pattern, t.lower()):
                issues.append(why)
    for p in draft.turning_points:
        for eid in p.event_ids:
            if eid not in known_ids:
                issues.append(f"unknown event id {eid}")
    named = {p.family_name.lower() for t in world.teams for p in t.players}
    allowed_names = {n.lower() for g in ("goals", "disallowed_goals", "discipline") for item in facts[g]
                     for n in re.findall(r"[A-Z][\w-]+", item.get("scorer", item.get("player", "")))}
    blob = " ".join(texts).lower()
    for name in named:
        if re.search(rf"\b{re.escape(name)}\b", blob) and name not in allowed_names:
            issues.append(f"names {name.title()} who is not in the recap facts")
    if len(draft.turning_points) != 3:
        issues.append("needs exactly three turning points")
    if len(draft.summary.split()) > 110:
        issues.append("summary too long")
    h, a = facts["final_score"][facts["home_short"]], facts["final_score"][facts["away_short"]]
    both = f"{draft.headline} {draft.summary}"
    if not re.search(rf"(?<!\d){h}\s*[–-]\s*{a}(?!\d)|(?<!\d){a}\s*[–-]\s*{h}(?!\d)", both):
        issues.append("final score missing or wrong")
    return list(dict.fromkeys(issues))


RECAP_PROMPT = """You are BYLINE's recap writer for a SYNTHETIC match between fictional clubs. Write a short, \
factual, editorial full-time recap using ONLY the JSON facts provided. Do not add players, numbers, minutes, \
quotes, history, tactics, intent, odds or predictions that are not in the facts. Use the final score exactly. \
Mention disallowed goals and dismissals if present. Turning points: exactly three, in time order, each citing the \
event ids given in the facts. ROLE: RECAP"""


async def model_recap(client: Any, facts: dict[str, Any], known_ids: set[str], world: Any,
                      charge: Any) -> tuple[RecapDraft | None, list[str], dict[str, Any]]:
    from agent_framework import Agent, ChatContext, chat_middleware

    trace: dict[str, Any] = {"agent": "recap_writer", "model_calls": 0, "tokens": 0, "latency_ms": 0}

    @chat_middleware
    async def meter(context: ChatContext, call_next: Any) -> None:
        charge()
        await call_next()
        usage = getattr(context.result, "usage_details", None) or {}
        trace["model_calls"] += 1
        trace["tokens"] += int(usage.get("total_token_count") or 0)
        rid = getattr(context.result, "response_id", None)
        if rid:
            trace["response_id"] = str(rid)

    agent = Agent(client, RECAP_PROMPT, name="recap_writer", middleware=[meter])
    t0 = time.perf_counter()
    resp = await agent.run("Facts:\n" + json.dumps(facts, indent=1),
                           options={"response_format": RecapDraft, "temperature": 0.2})
    trace["latency_ms"] = int((time.perf_counter() - t0) * 1000)
    draft = resp.value if isinstance(resp.value, RecapDraft) else None
    if draft is None:
        return None, ["no structured output"], trace
    return draft, validate_recap(draft, facts, known_ids, world), trace
