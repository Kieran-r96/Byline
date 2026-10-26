"""TEST-ONLY scripted chat client. Exercises the real Agent Framework tool loop and workflow;
only the model replies are scripted. Never used in the production path."""

from __future__ import annotations

import json
from typing import Any

from agent_framework import (
    BaseChatClient,
    ChatMiddlewareLayer,
    ChatResponse,
    Content,
    FunctionInvocationLayer,
    Message,
)

ROLES = ("INVESTIGATOR", "ANALYST", "VERIFIER")


class ScriptedChatClient(FunctionInvocationLayer, ChatMiddlewareLayer, BaseChatClient):  # type: ignore[misc]
    """Same layer stack as the production OpenAI chat client (function loop + chat middleware)."""

    OTEL_PROVIDER_NAME = "test-mock"

    def __init__(self, script: dict[str, list[Any]]) -> None:
        super().__init__()
        self.script = {k: list(v) for k, v in script.items()}
        self.calls: list[str] = []
        self.seen_messages: list[str] = []

    @staticmethod
    def _role(messages: list[Message], options: dict[str, Any]) -> str:
        blob = json.dumps(options.get("instructions", ""), default=str)
        blob += " ".join(m.text or "" for m in messages)
        for r in ROLES:
            if f"ROLE: {r}" in blob:
                return r
        raise AssertionError("could not identify role from prompt")

    async def _inner_get_response(self, *, messages: Any, stream: bool, options: Any, **kwargs: Any) -> ChatResponse:
        role = self._role(list(messages), dict(options or {}))
        self.calls.append(role)
        self.seen_messages.append(" ".join(m.text or "" for m in messages))
        step = self.script[role].pop(0)
        usage = {"input_token_count": 100, "output_token_count": 40, "total_token_count": 140}
        if isinstance(step, tuple) and step[0] == "call":
            return ChatResponse(messages=[Message(role="assistant", contents=[
                Content.from_function_call(call_id=f"c{len(self.calls)}", name=step[1], arguments=step[2])])],
                usage_details=usage, response_id=f"mock-{len(self.calls)}")
        text = step if isinstance(step, str) else json.dumps(step)
        return ChatResponse(messages=[Message(role="assistant", contents=[text])], usage_details=usage,
                            response_id=f"mock-{len(self.calls)}")


def dossier(ids: list[str]) -> dict[str, Any]:
    return {
        "candidate_finding": "Northbridge entered the final third mostly through the right channel.",
        "key_event_ids": ids,
        "observed_facts": [{"statement": "Right-channel final-third entries", "event_ids": ids[:3]}],
        "match_context": ["Score at detection taken from match context"],
        "alternative_explanations": ["Opponent shape may have left the right side open, but no tracking used."],
        "cannot_establish": ["Defender positioning", "Managerial intent"],
    }


def draft(ids: list[str], claim: str, **over: Any) -> dict[str, Any]:
    d = {
        "title": "Northbridge keep coming down the right",
        "canonical_claim": claim,
        "why_it_matters": "It is a repeatable route into dangerous areas in this spell.",
        "uncertainty": "Does not establish why the space is there or what defenders intended.",
        "certainty": "supported",
        "evidence_event_ids": ids,
        "commentator": claim,
        "fan_discover": "Northbridge keep attacking down their right side.",
        "fan_analyst": claim,
        "studio_headline": "RIGHT-SIDE PRESSURE",
        "studio_subtitle": "Northbridge final-third entries by channel",
    }
    d.update(over)
    return d


def approve(ids: list[str]) -> dict[str, Any]:
    return {"verdict": "approved", "checks": [{"claim": "channel share", "supported": True, "event_ids": ids[:2],
                                               "note": "matches metrics"}], "issues": [], "revision_instructions": None}
