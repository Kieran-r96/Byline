"""V2 tier 1: storyline reads are rule-checked, cached per version, and never spend in cache-only mode."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from byline.agents.storyline_read import StorylineRead, check_read
from byline.api.sessions import ReplaySession
from byline.config import Settings
from byline.storage.fixtures import MatchPackage
from byline.stories import service as service_mod
from byline.stories.service import InsightService

SL = {"storyline_id": "SL-x", "team_id": "NBA", "state": "DEVELOPING", "display_clock": "25'",
      "metrics": {"window_minutes": 10, "channel_entries": 7, "total_entries": 8, "channel_share": 0.875,
                  "distinct_possessions": 5, "dangerous_entries": 0}}


def read(line: str, caveat: str = "Counts cannot show why.") -> StorylineRead:
    return StorylineRead(line=line, caveat=caveat)


def test_measured_line_passes() -> None:
    ok = read("Northbridge are building down the right: 7 of their last 8 final-third entries, 88% in 10 minutes.")
    assert check_read(ok, SL, ["Riverton Vale", "Riverton"]) == []


@pytest.mark.parametrize("line,why", [
    ("Northbridge have 9 entries down the right.", "number 9"),
    ("Northbridge are deliberately targeting the right.", "intent"),
    ("Northbridge keep exploiting space down the right, 7 of 8.", "spatial"),
    ("A verified pattern: 7 of 8 entries down the right.", "verification"),
    ("Northbridge will score from the right soon, 7 of 8.", "predicts"),
    ("Riverton cannot cope, 7 of 8 entries down their left.", "other team"),
])
def test_unsupported_lines_are_blocked(line: str, why: str) -> None:
    issues = check_read(read(line), SL, ["Riverton Vale", "Riverton"])
    assert any(why in i for i in issues), issues


def make(tmp_path: Path, golden: MatchPackage, cache_only: bool) -> tuple[InsightService, ReplaySession]:
    svc = InsightService(Settings(byline_ai_provider="foundry", byline_ai_cache_only=cache_only,
                                  foundry_deployment="gpt-4.1-mini"), lambda: [], lambda: None,
                         cache_dir=tmp_path / "insights")
    s = ReplaySession("t", golden, on_candidate=lambda *a, **k: None, storyline_view=svc.storyline_view)
    return svc, s


def test_recorded_read_is_served_for_its_exact_version_only(tmp_path: Path, golden: MatchPackage,
                                                            monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(service_mod, "RECORDED_READS", tmp_path / "recorded")
    svc, s = make(tmp_path, golden, cache_only=True)
    s.seek(26 * 60_000)
    sl = next(x for x in s.intelligence.storylines.storylines if x.state == "DEVELOPING")
    (tmp_path / "recorded").mkdir()
    (tmp_path / "recorded" / f"{svc.read_key(s, sl)}.json").write_text(json.dumps({
        "read": {"line": "Building down the right.", "caveat": "Counts only."}, "model_deployment": "gpt-4.1-mini",
        "trace": {"response_id": "chatcmpl-x", "latency_ms": 900}}), encoding="utf-8")
    view = svc.storyline_view(s, sl, live=True)
    assert view["ai_read"]["line"] == "Building down the right." and view["ai_read"]["from_cache"] is True
    s.seek(29 * 60_000)  # the storyline moved on to a new version: the old read is not reused
    sl2 = next(x for x in s.intelligence.storylines.storylines if x.storyline_id == sl.storyline_id)
    assert sl2.version > sl.version and "ai_read" not in svc.storyline_view(s, sl2, live=False)


def test_cache_only_never_starts_a_read(tmp_path: Path, golden: MatchPackage) -> None:
    svc, s = make(tmp_path, golden, cache_only=True)
    s.seek(26 * 60_000)
    for sl in s.intelligence.storylines.storylines:
        svc.storyline_view(s, sl, live=True)
    assert svc.read_tasks == {} and svc.read_counts == {}
