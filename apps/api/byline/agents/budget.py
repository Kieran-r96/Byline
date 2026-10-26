"""Spend protection: per-session and daily model-call caps, concurrency, circuit breaker."""

from __future__ import annotations

import asyncio
import datetime as dt
import time
from dataclasses import dataclass, field

from byline.agents.ledger import CallLedger


class BudgetExceeded(RuntimeError):
    pass


@dataclass
class BudgetGuard:
    max_calls_per_session: int
    max_calls_per_day: int
    max_tokens_per_case: int
    concurrency: int = 2
    breaker_threshold: int = 3
    breaker_cooldown_s: float = 120.0
    session_calls: dict[str, int] = field(default_factory=dict)
    day: str = field(default_factory=lambda: dt.date.today().isoformat())
    day_calls: int = 0
    total_calls: int = 0
    total_tokens: int = 0
    consecutive_failures: int = 0
    open_until: float = 0.0
    latencies_ms: list[int] = field(default_factory=list)
    ledger: CallLedger | None = None

    def __post_init__(self) -> None:
        self.semaphore = asyncio.Semaphore(self.concurrency)

    def _roll_day(self) -> None:
        today = dt.date.today().isoformat()
        if today != self.day:
            self.day, self.day_calls = today, 0

    @property
    def breaker_open(self) -> bool:
        return time.monotonic() < self.open_until

    def can_start(self, session_id: str, expected_calls: int = 6) -> tuple[bool, str]:
        self._roll_day()
        if self.breaker_open:
            return False, "circuit_open"
        if self.session_calls.get(session_id, 0) + expected_calls > self.max_calls_per_session:
            return False, "session_cap"
        if self.day_calls + expected_calls > self.max_calls_per_day:
            return False, "daily_cap"
        if self.ledger is not None and self.ledger.remaining() < 3:
            return False, "ledger_cap"
        return True, "ok"

    def charge(self, session_id: str, case_tokens: int) -> None:
        """Called before every real model call. Raises when a cap would be exceeded."""
        self._roll_day()
        if self.breaker_open:
            raise BudgetExceeded("circuit_open")
        if self.session_calls.get(session_id, 0) >= self.max_calls_per_session:
            raise BudgetExceeded("session_cap")
        if self.day_calls >= self.max_calls_per_day:
            raise BudgetExceeded("daily_cap")
        if case_tokens >= self.max_tokens_per_case:
            raise BudgetExceeded("case_token_cap")
        if self.ledger is not None and not self.ledger.reserve("agent"):
            raise BudgetExceeded("ledger_cap")
        self.session_calls[session_id] = self.session_calls.get(session_id, 0) + 1
        self.day_calls += 1
        self.total_calls += 1

    def record(self, ok: bool, latency_ms: int | None = None, tokens: int = 0) -> None:
        self.total_tokens += tokens
        if latency_ms is not None:
            self.latencies_ms.append(latency_ms)
            self.latencies_ms = self.latencies_ms[-500:]
        if ok:
            self.consecutive_failures = 0
        else:
            self.consecutive_failures += 1
            if self.consecutive_failures >= self.breaker_threshold:
                self.open_until = time.monotonic() + self.breaker_cooldown_s

    def snapshot(self) -> dict[str, object]:
        lat = sorted(self.latencies_ms)

        def pct(p: float) -> int | None:
            return lat[min(len(lat) - 1, int(p * len(lat)))] if lat else None

        return {
            "calls_today": self.day_calls, "daily_cap": self.max_calls_per_day,
            "session_cap": self.max_calls_per_session, "total_calls": self.total_calls,
            "total_tokens": self.total_tokens, "breaker_open": self.breaker_open,
            "latency_p50_ms": pct(0.5), "latency_p95_ms": pct(0.95), "measured_calls": len(lat),
            "hard_cap": self.ledger.cap if self.ledger else None,
            "hard_cap_used": self.ledger.used() if self.ledger else None,
        }
