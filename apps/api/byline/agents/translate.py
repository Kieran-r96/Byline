"""Second-language variant (T020): translate VERIFIED canonical text; never re-source claims.

A translator agent rewrites the already-verified English fields in Spanish. A deterministic
check then requires every number and every player surname in each English field to appear in
its translation, and the length limits to hold. Failing fields are dropped (no mistranslation
is shipped); the English stays authoritative and translations are labelled as translations.
"""

from __future__ import annotations

import json
import re
import time
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from byline.stories.models import Insight
from byline.world.models import World

FIELDS = ("title", "canonical_claim", "commentator", "fan_discover", "fan_analyst", "studio_headline",
          "studio_subtitle")
LIMITS = {"studio_headline": 60, "studio_subtitle": 110, "title": 90}

PROMPT = """You are BYLINE's translator. Translate the given VERIFIED English football texts into natural, \
broadcast-quality European Spanish. Rules: keep every number, percentage, minute and player name exactly as \
written (do not convert or round numbers); keep team names unchanged; do not add, remove or soften any fact; \
keep the same level of certainty; no new claims, odds or predictions. Return only the JSON. ROLE: TRANSLATOR"""


class SpanishVariant(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: str = Field(description="Spanish translation")
    canonical_claim: str
    commentator: str
    fan_discover: str
    fan_analyst: str
    studio_headline: str
    studio_subtitle: str


def english_fields(ins: Insight) -> dict[str, str]:
    v = ins.audience_variants
    return {"title": ins.title, "canonical_claim": ins.canonical_claim, "commentator": v.commentator,
            "fan_discover": v.fan_discover, "fan_analyst": v.fan_analyst, "studio_headline": v.studio.headline,
            "studio_subtitle": v.studio.subtitle}


def _nums(text: str) -> list[str]:
    return sorted(n.replace(",", ".") for n in re.findall(r"\d+(?:[.,]\d+)?", text))


def check_translation(en: dict[str, str], es: dict[str, str], world: World) -> dict[str, list[str]]:
    """Per-field issues; an empty list means the field is safe to ship."""
    surnames = [p.family_name for t in world.teams for p in t.players]
    out: dict[str, list[str]] = {}
    for f in FIELDS:
        issues = []
        if _nums(en[f]) != _nums(es[f]):
            issues.append(f"numbers changed: {_nums(en[f])} -> {_nums(es[f])}")
        for name in surnames:
            if name in en[f] and name not in es[f]:
                issues.append(f"name {name} missing")
        if f in LIMITS and len(es[f]) > LIMITS[f]:
            issues.append(f"too long ({len(es[f])} > {LIMITS[f]})")
        if not es[f].strip():
            issues.append("empty")
        out[f] = issues
    return out


async def translate_es(client: Any, ins: Insight, world: World, charge: Any) -> tuple[dict[str, str], dict[str, Any]]:
    """Returns (flattened translations for audience_variants.translations, trace)."""
    return await translate_texts_es(client, english_fields(ins), world, charge, case_id=ins.insight_id)


async def translate_texts_es(client: Any, en: dict[str, str], world: World, charge: Any,
                             case_id: str = "") -> tuple[dict[str, str], dict[str, Any]]:
    """Translate the seven verified English fields (keys = FIELDS). Each real request is charged first, logged
    through log_call (BYLINE_CALL_LOG) and kept in trace["calls"] with latency and tokens."""
    import time as _time

    from agent_framework import Agent, ChatContext, chat_middleware

    from byline.agents.orchestrator import log_call

    trace: dict[str, Any] = {"agent": "translator", "language": "es", "model_calls": 0, "tokens": 0,
                             "input_tokens": 0, "output_tokens": 0, "calls": []}

    @chat_middleware
    async def meter(context: ChatContext, call_next: Any) -> None:
        charge()
        started, t0 = _time.time(), _time.perf_counter()
        try:
            await call_next()
        except Exception as exc:
            rec = {"t": _time.time(), "case_id": case_id, "role": "translator", "ok": False,
                   "latency_ms": int((_time.perf_counter() - t0) * 1000), "error": type(exc).__name__}
            trace["calls"].append({**rec, "started_at": started})
            log_call(rec)
            raise
        usage = getattr(context.result, "usage_details", None) or {}
        tin, tout = int(usage.get("input_token_count") or 0), int(usage.get("output_token_count") or 0)
        trace["model_calls"] += 1
        trace["tokens"] += int(usage.get("total_token_count") or 0) or tin + tout
        trace["input_tokens"] += tin
        trace["output_tokens"] += tout
        rid = getattr(context.result, "response_id", None)
        if rid:
            trace["response_id"] = str(rid)
        rec = {"t": _time.time(), "case_id": case_id, "role": "translator", "ok": True,
               "latency_ms": int((_time.perf_counter() - t0) * 1000), "input_tokens": tin, "output_tokens": tout,
               "response_id": str(rid) if rid else None}
        trace["calls"].append({**rec, "started_at": started})
        log_call(rec)

    agent = Agent(client, PROMPT, name="translator", middleware=[meter])
    t0 = time.perf_counter()
    resp = await agent.run("Texts:\n" + json.dumps(en, indent=1, ensure_ascii=False),
                           options={"response_format": SpanishVariant, "temperature": 0.1})
    trace["latency_ms"] = int((time.perf_counter() - t0) * 1000)
    value = resp.value
    if not isinstance(value, SpanishVariant):
        trace["issues"] = {"all": ["no structured output"]}
        return {}, trace
    es = value.model_dump()
    issues = check_translation(en, es, world)
    trace["issues"] = {k: v for k, v in issues.items() if v}
    shipped = {f"es.{k}": es[k] for k in FIELDS if not issues[k]}
    if shipped:
        shipped["es._note"] = "Machine translation of verified English text (Foundry); English is authoritative."
    return shipped, trace
