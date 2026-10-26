"""Append-only ordered event journal with exactly-once ingest and out-of-order buffering."""

from __future__ import annotations

import bisect
from dataclasses import dataclass, field
from typing import Literal

from byline.events.models import MatchEvent

IngestResult = Literal["appended", "duplicate", "buffered"]


class JournalConflict(ValueError):
    pass


@dataclass
class EventJournal:
    match_id: str
    events: list[MatchEvent] = field(default_factory=list)
    _ids: dict[str, int] = field(default_factory=dict)
    _pending: dict[int, MatchEvent] = field(default_factory=dict)

    @property
    def next_seq(self) -> int:
        return len(self.events)

    def ingest(self, ev: MatchEvent) -> tuple[IngestResult, list[MatchEvent]]:
        """Returns the result and the events that became contiguous (to be applied in order)."""
        if ev.match_id != self.match_id:
            raise JournalConflict(f"{ev.event_id} belongs to {ev.match_id}")
        if ev.event_id in self._ids:
            if self._ids[ev.event_id] != ev.seq or self.events[ev.seq] != ev:
                raise JournalConflict(f"{ev.event_id} replayed with different content")
            return "duplicate", []
        if ev.seq < self.next_seq:
            raise JournalConflict(f"seq {ev.seq} already holds {self.events[ev.seq].event_id}")
        if ev.seq > self.next_seq:
            existing = self._pending.get(ev.seq)
            if existing is not None and existing != ev:
                raise JournalConflict(f"seq {ev.seq} buffered twice with different events")
            self._pending[ev.seq] = ev
            return "buffered", []
        released = [ev]
        self._append(ev)
        while self.next_seq in self._pending:
            nxt = self._pending.pop(self.next_seq)
            self._append(nxt)
            released.append(nxt)
        return "appended", released

    def _append(self, ev: MatchEvent) -> None:
        self._ids[ev.event_id] = ev.seq
        self.events.append(ev)

    @property
    def missing_seqs(self) -> list[int]:
        if not self._pending:
            return []
        return [s for s in range(self.next_seq, max(self._pending)) if s not in self._pending]

    def get(self, event_id: str) -> MatchEvent | None:
        i = self._ids.get(event_id)
        return self.events[i] if i is not None else None

    def after(self, after_seq: int, limit: int = 500) -> list[MatchEvent]:
        start = max(after_seq + 1, 0)
        return self.events[start:start + limit]

    def index_at_elapsed(self, elapsed_ms: int) -> int:
        """Number of events with elapsed_ms <= elapsed_ms."""
        keys = [e.elapsed_ms for e in self.events]
        return bisect.bisect_right(keys, elapsed_ms)
