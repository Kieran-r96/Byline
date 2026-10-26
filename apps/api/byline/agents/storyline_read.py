"""Tier 1 inference: one cheap call that reads a storyline version in plain football language.

T0 (every storyline version) is the deterministic engine. T1 adds a single interpretation line for a
storyline that is DEVELOPING, STRONG or CONFIRMED, cached per (storyline, version). T2 is the full
investigator -> analyst -> verifier workflow for a published candidate.

The line is never trusted: a deterministic check requires every number to come from the storyline's own
measurements, forbids the same intent, positional, betting and prediction language as the T2 validator,
and forbids calling a storyline verified before a verified story exists. A failing line is not shipped.
"""

from __future__ import annotations

import json
import re
import time
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from byline.agents.validator import BANNED, SPATIAL_WITHOUT_TRACKING, _numbers

T1_VERSION = "2026-10-21.1"
T1_STATES = ("DEVELOPING", "STRONG", "CONFIRMED")
MAX_WORDS = 30

PROMPT = """You are BYLINE's storyline reader for a SYNTHETIC match between fictional clubs. You receive one \
deterministic storyline: its state and the detector's measured counts. Write ONE line (max 30 words) a \
commentator could say now, interpreting the measured trend in plain football language. Rules: use only numbers \
that appear in the metrics (a share may be written as a whole percentage); never claim intent, tactics, \
instructions, player positioning or space; no predictions or odds; if the state is DEVELOPING say it is building \
and not yet a story; never say verified or confirmed unless the state is CONFIRMED. Also give a caveat (max 15 \
words) naming what the counts cannot show. Return only the JSON. ROLE: STORYLINE READER"""


class StorylineRead(BaseModel):
    model_config = ConfigDict(extra="forbid")
    line: str = Field(description="One commentator-ready line, max 30 words")
    caveat: str = Field(description="What the counts cannot show, max 15 words")


def allowed_numbers(sl: dict[str, Any]) -> set[float]:
    allowed: set[float] = {1.0}
    for v in (sl.get("metrics") or {}).values():
        if isinstance(v, bool) or not isinstance(v, int | float):
            continue
        allowed.add(float(v))
        if 0 < v < 1:
            pct = v * 100
            allowed.update({float(round(pct)), float(int(pct)), round(pct, 1)})
    for n in re.findall(r"\d+", str(sl.get("display_clock", ""))):
        allowed.add(float(n))
    return allowed


def check_read(read: StorylineRead, sl: dict[str, Any], other_team_names: list[str]) -> list[str]:
    issues: list[str] = []
    text = f"{read.line} {read.caveat}"
    allowed = allowed_numbers(sl)
    for value, _pct in _numbers(text):
        if value not in allowed:
            issues.append(f"number {value:g} is not in the storyline metrics")
    for pattern, why in BANNED:
        if re.search(pattern, text, re.IGNORECASE):
            issues.append(why)
    if re.search(SPATIAL_WITHOUT_TRACKING, text, re.IGNORECASE):
        issues.append("spatial claim without tracking")
    if sl.get("state") != "CONFIRMED" and re.search(r"\b(verified|confirmed|proven)\b", text, re.IGNORECASE):
        issues.append("claims verification the storyline has not reached")
    if len(read.line.split()) > MAX_WORDS:
        issues.append(f"line longer than {MAX_WORDS} words")
    for name in other_team_names:
        if name and name.lower() in text.lower():
            issues.append(f"mentions the other team ({name}) without measurements for it")
    return issues


async def read_storyline(client: Any, sl: dict[str, Any], other_team_names: list[str],
                         charge: Any) -> tuple[StorylineRead | None, dict[str, Any]]:
    """One real call. Returns (read or None if it failed the check, trace)."""
    from agent_framework import Agent, ChatContext, chat_middleware

    trace: dict[str, Any] = {"agent": "storyline_reader", "tier": "T1", "model_calls": 0, "input_tokens": 0,
                             "output_tokens": 0, "started_at": time.time()}

    @chat_middleware
    async def meter(context: ChatContext, call_next: Any) -> None:
        charge()
        await call_next()
        usage = getattr(context.result, "usage_details", None) or {}
        trace["model_calls"] += 1
        trace["input_tokens"] += int(usage.get("input_token_count") or 0)
        trace["output_tokens"] += int(usage.get("output_token_count") or 0)
        rid = getattr(context.result, "response_id", None)
        if rid:
            trace["response_id"] = str(rid)

    brief = {k: sl.get(k) for k in ("headline", "state", "display_clock", "reason", "metrics")}
    brief["history"] = [{"state": h["state"], "clock": h["display_clock"]} for h in sl.get("history", [])]
    agent = Agent(client, PROMPT, name="storyline_reader", middleware=[meter])
    t0 = time.perf_counter()
    resp = await agent.run("Storyline:\n" + json.dumps(brief, indent=1),
                           options={"response_format": StorylineRead, "temperature": 0.2})
    trace["latency_ms"] = int((time.perf_counter() - t0) * 1000)
    value = resp.value
    if not isinstance(value, StorylineRead):
        trace["issues"] = ["no structured output"]
        return None, trace
    trace["issues"] = check_read(value, sl, other_team_names)
    trace["output"] = value.model_dump()
    return (None if trace["issues"] else value), trace
