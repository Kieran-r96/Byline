"""Model provider wiring. Server-side only; no key or token ever leaves this module.

Production path: Microsoft Foundry deployment through its OpenAI-compatible v1 endpoint,
authenticated with Microsoft Entra ID (DefaultAzureCredential + bearer token provider), as in
Foundry's generated Python sample. The Agent Framework chat client wraps the official OpenAI
SDK client, so every agent call is real inference against the configured deployment.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Any, Literal

from byline.config import Settings, get_settings

ProviderState = Literal["configured", "ready", "degraded", "disabled", "recorded"]


@dataclass
class ProviderStatus:
    provider: str
    state: ProviderState
    deployment: str | None
    detail: str
    checked_at: float = field(default_factory=time.time)
    last_latency_ms: int | None = None


def credential(settings: Settings) -> Any:
    from azure.identity import DefaultAzureCredential

    kwargs: dict[str, Any] = {"exclude_interactive_browser_credential": True}
    if settings.foundry_tenant_id:
        # Pin the tenant that owns the Foundry resource so a different signed-in Windows/work
        # account (another tenant) is not picked up first.
        kwargs["shared_cache_tenant_id"] = settings.foundry_tenant_id
        kwargs["visual_studio_code_tenant_id"] = settings.foundry_tenant_id
        kwargs["exclude_broker_credential"] = True
        kwargs["additionally_allowed_tenants"] = [settings.foundry_tenant_id]
    return DefaultAzureCredential(**kwargs)


def openai_client(settings: Settings | None = None) -> Any:
    """Official OpenAI SDK async client pointed at the Foundry v1 endpoint with Entra auth."""
    from azure.identity import get_bearer_token_provider
    from openai import AsyncOpenAI

    s = settings or get_settings()
    if not s.foundry_openai_base_url:
        raise RuntimeError("FOUNDRY_OPENAI_BASE_URL is not configured")
    if s.foundry_auth == "api_key":
        if s.foundry_api_key is None:
            raise RuntimeError("FOUNDRY_API_KEY missing for api_key auth")
        return AsyncOpenAI(base_url=s.foundry_openai_base_url, api_key=s.foundry_api_key.get_secret_value(),
                           timeout=s.byline_model_timeout_s, max_retries=1)
    sync_provider = get_bearer_token_provider(credential(s), s.foundry_token_scope)

    async def token() -> str:
        import asyncio

        return await asyncio.to_thread(sync_provider)

    return AsyncOpenAI(base_url=s.foundry_openai_base_url, api_key=token, timeout=s.byline_model_timeout_s,
                       max_retries=1)


def chat_client(settings: Settings | None = None) -> Any:
    """Agent Framework chat client (Chat Completions) backed by the Foundry deployment."""
    from agent_framework.openai import OpenAIChatCompletionClient

    s = settings or get_settings()
    return OpenAIChatCompletionClient(model=s.foundry_deployment, async_client=openai_client(s))


async def probe(settings: Settings | None = None) -> ProviderStatus:
    """One tiny real request, charged to the persistent ledger. Operator use only (tools), never per page view."""
    s = settings or get_settings()
    if s.byline_ai_provider == "off":
        return ProviderStatus("off", "disabled", None, "AI disabled by configuration")
    if s.byline_ai_provider == "mock_for_tests":
        return ProviderStatus("mock_for_tests", "degraded", None, "Test mock: not real model output")
    if not s.foundry_configured:
        return ProviderStatus("foundry", "configured", s.foundry_deployment, "Foundry settings incomplete")
    from byline.agents.ledger import CallLedger

    if not CallLedger(s.byline_model_call_cap).reserve("probe"):
        return ProviderStatus("foundry", "configured", s.foundry_deployment, "Model call cap reached; probe skipped")
    t0 = time.perf_counter()
    try:
        client = openai_client(s)
        r = await client.chat.completions.create(
            model=s.foundry_deployment, max_tokens=5, temperature=0,
            messages=[{"role": "user", "content": "Reply with the single word: ready"}],
        )
        ms = int((time.perf_counter() - t0) * 1000)
        ok = bool(r.choices and r.choices[0].message.content)
        return ProviderStatus("foundry", "ready" if ok else "degraded", s.foundry_deployment,
                              "Live Foundry deployment responded" if ok else "Empty response", last_latency_ms=ms)
    except Exception as exc:  # noqa: BLE001 - reported as a redacted status, never raised to clients
        return ProviderStatus("foundry", "degraded", s.foundry_deployment, redact(exc))


def redact(exc: BaseException) -> str:
    name = type(exc).__name__
    text = str(exc)
    if "tenant" in text.lower():
        return f"{name}: signed-in identity is in a different Entra tenant from the Foundry resource"
    if "401" in text or "403" in text or "PermissionDenied" in text:
        return f"{name}: identity lacks access to the Foundry deployment"
    if "credential" in text.lower() or "ClientAuthenticationError" in name:
        return f"{name}: no Entra credential available (sign in required)"
    return f"{name}: model request failed"
