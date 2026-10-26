"""One-time Entra sign-in for local development, then one real Foundry request.

    apps/api/.venv/Scripts/python tools/foundry_login.py --tenant <TENANT_ID>

Opens a browser once. The token is cached in the shared MSAL cache that
DefaultAzureCredential (SharedTokenCacheCredential) reads silently afterwards.
Also writes FOUNDRY_TENANT_ID into .env. No secret is printed or written to the repo.
"""

from __future__ import annotations

import argparse
import asyncio
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "apps" / "api"))


def set_env_var(key: str, value: str) -> None:
    env = ROOT / ".env"
    lines = env.read_text(encoding="utf-8").splitlines() if env.exists() else []
    lines = [ln for ln in lines if not ln.startswith(f"{key}=")]
    lines.append(f"{key}={value}")
    env.write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--tenant", required=True, help="Directory (tenant) ID that owns the Foundry resource")
    args = ap.parse_args()
    from azure.identity import InteractiveBrowserCredential, TokenCachePersistenceOptions

    from byline.config import get_settings

    scope = get_settings().foundry_token_scope
    cred = InteractiveBrowserCredential(tenant_id=args.tenant,
                                        cache_persistence_options=TokenCachePersistenceOptions())
    cred.authenticate(scopes=[scope])
    print("Signed in; token cached for DefaultAzureCredential.")
    set_env_var("FOUNDRY_TENANT_ID", args.tenant)
    get_settings.cache_clear()

    from byline.agents.provider import openai_client

    async def call() -> None:
        s = get_settings()
        client = openai_client(s)
        t0 = time.perf_counter()
        r = await client.chat.completions.create(
            model=s.foundry_deployment, temperature=0, max_tokens=80,
            messages=[{"role": "user", "content": "In one sentence: is being in an offside position an offence?"}],
        )
        ms = int((time.perf_counter() - t0) * 1000)
        print(f"REAL FOUNDRY CALL OK | deployment={s.foundry_deployment} | {ms} ms | id={r.id}")
        if r.usage:
            print(f"tokens prompt={r.usage.prompt_tokens} completion={r.usage.completion_tokens}")
        print("output:", r.choices[0].message.content)

    asyncio.run(call())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
