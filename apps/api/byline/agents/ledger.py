"""Persistent, cross-process hard cap on real model calls.

Every real Foundry request (agent step or probe) must reserve a slot here first. The ledger
lives on disk so restarts, extra server processes or reloads cannot reset the count. Raising
the cap is an owner decision (BYLINE_MODEL_CALL_CAP in .env, or `tools/ledger.py reset`).
"""

from __future__ import annotations

import contextlib
import json
import os
import time
from collections.abc import Iterator
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from byline.config import API_ROOT

DEFAULT_PATH = API_ROOT / ".cache" / "model_call_ledger.json"


@dataclass
class CallLedger:
    cap: int
    path: Path = DEFAULT_PATH
    # the ledger position of this process's most recent successful reservation (1-based), for provenance
    last_slot: int | None = field(default=None, init=False)

    @contextlib.contextmanager
    def _locked(self) -> Iterator[None]:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        lock = self.path.with_suffix(".lock")
        deadline = time.monotonic() + 5.0
        while True:
            try:
                fd = os.open(lock, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
                break
            except FileExistsError:
                try:
                    age = time.time() - lock.stat().st_mtime
                except FileNotFoundError:
                    continue
                if age > 30:
                    # only a lock far older than any real hold is treated as left by a crashed process
                    with contextlib.suppress(FileNotFoundError):
                        os.unlink(lock)
                    continue
                if time.monotonic() > deadline:
                    raise TimeoutError("model-call ledger is busy") from None
                time.sleep(0.01)
        try:
            yield
        finally:
            os.close(fd)
            with contextlib.suppress(FileNotFoundError):
                os.unlink(lock)

    def _read(self) -> dict[str, Any]:
        if not self.path.exists():
            return {"calls": 0, "started_at": time.time(), "entries": []}
        data: dict[str, Any] = json.loads(self.path.read_text(encoding="utf-8"))
        return data

    def _write(self, data: dict[str, Any]) -> None:
        tmp = self.path.with_suffix(".tmp")
        tmp.write_text(json.dumps(data, indent=1), encoding="utf-8")
        os.replace(tmp, self.path)

    def reserve(self, kind: str) -> bool:
        """False when the cap is reached or the ledger cannot be locked (fail closed: no call)."""
        try:
            return self._reserve(kind)
        except TimeoutError:
            return False

    def _reserve(self, kind: str) -> bool:
        with self._locked():
            data = self._read()
            if data["calls"] >= self.cap:
                return False
            data["calls"] += 1
            data["entries"] = [*data["entries"][-199:], {"t": time.time(), "kind": kind}]
            self._write(data)
            self.last_slot = int(data["calls"])
            return True

    def used(self) -> int:
        with self._locked():
            return int(self._read()["calls"])

    def peek(self) -> int:
        """Read-only count for plans and dry runs: takes no lock and creates no file or directory."""
        try:
            return int(json.loads(self.path.read_text(encoding="utf-8"))["calls"])
        except FileNotFoundError:
            return 0

    def remaining(self) -> int:
        return max(0, self.cap - self.used())

    def reset(self) -> None:
        with self._locked():
            self._write({"calls": 0, "started_at": time.time(), "entries": []})
