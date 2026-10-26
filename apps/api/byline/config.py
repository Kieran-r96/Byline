"""Runtime configuration. Secrets come from environment / .env only and are never echoed."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict

REPO_ROOT = Path(__file__).resolve().parents[3]
API_ROOT = Path(__file__).resolve().parents[1]
FIXTURE_DIR = API_ROOT / "byline" / "simulation" / "fixtures"

AIProvider = Literal["foundry", "mock_for_tests", "off"]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(REPO_ROOT / ".env",), env_file_encoding="utf-8", extra="ignore"
    )

    byline_ai_provider: AIProvider = "off"
    foundry_auth: Literal["entra", "api_key"] = "entra"
    foundry_openai_base_url: str | None = None
    foundry_deployment: str | None = None
    foundry_token_scope: str = "https://ai.azure.com/.default"
    foundry_tenant_id: str | None = None
    foundry_api_key: SecretStr | None = None

    # True = serve only recorded/cached real Foundry results; never start new model calls (safe public demo)
    byline_ai_cache_only: bool = False
    byline_model_call_cap: int = 20  # hard, persistent across restarts (agents/ledger.py)
    byline_max_model_calls_per_session: int = 30
    byline_max_model_calls_global_per_day: int = 400
    byline_max_tokens_per_case: int = 14000
    byline_model_concurrency: int = 2
    byline_model_timeout_s: float = 45.0

    byline_static_dir: str | None = None

    # HTTP hardening (docs/security-audit.md)
    # Interactive API docs (/docs, /redoc load Swagger/ReDoc from a CDN). The public image turns them off;
    # /openapi.json stays available either way (it holds no secrets).
    byline_api_docs: bool = True
    # Strict-Transport-Security. Only enable behind an HTTPS-only ingress (e.g. Azure Container Apps).
    byline_hsts: bool = False
    # How many X-Forwarded-For entries (from the right) were appended by proxies we operate. 0 = ignore the
    # header (it is client-controlled) and key rate limits and session quotas on the socket peer.
    byline_trusted_proxy_hops: int = Field(0, ge=0, le=5)
    # Largest request body accepted (the API's JSON bodies are a few dozen bytes)
    byline_max_body_bytes: int = Field(16_384, ge=1024, le=1_048_576)

    @property
    def foundry_configured(self) -> bool:
        if not (self.foundry_openai_base_url and self.foundry_deployment):
            return False
        return self.foundry_auth == "entra" or self.foundry_api_key is not None


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
