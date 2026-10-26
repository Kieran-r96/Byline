"""Match clock: continuous elapsed_ms timeline vs broadcast display clock.

elapsed_ms is the monotonic replay timeline across the whole match. Each period has its
own start offset; the display clock counts from the period base (0' or 45') and shows
stoppage time as 45+2' / 90+5'.
"""

from __future__ import annotations

PERIOD_BASE_MIN = {"H1": 0, "H2": 45, "ET1": 90, "ET2": 105}
PERIOD_REGULATION_MIN = {"H1": 45, "H2": 45, "ET1": 15, "ET2": 15}


def minute_label(period: str, period_elapsed_ms: int) -> str:
    """Football minute convention: 0:00-0:59 is the 1st minute ("1'")."""
    if period not in PERIOD_BASE_MIN:
        return {"PRE": "PRE", "HT": "HT", "FT": "FT", "PEN": "PEN"}.get(period, period)
    base = PERIOD_BASE_MIN[period]
    regulation = PERIOD_REGULATION_MIN[period]
    minute_in_period = period_elapsed_ms // 60_000 + 1
    if minute_in_period > regulation:
        return f"{base + regulation}+{minute_in_period - regulation}'"
    return f"{base + minute_in_period}'"


def broadcast_clock(period: str, period_elapsed_ms: int) -> str:
    """mm:ss broadcast clock that keeps counting into stoppage (e.g. 47:12 in H1)."""
    if period not in PERIOD_BASE_MIN:
        return minute_label(period, period_elapsed_ms)
    total_s = PERIOD_BASE_MIN[period] * 60 + period_elapsed_ms // 1000
    return f"{total_s // 60:02d}:{total_s % 60:02d}"
