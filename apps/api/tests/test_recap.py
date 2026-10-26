"""T019: full-time recap reconciled with final state; never before FT; validated model draft."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from byline.api.app import app
from byline.match_state.reducer import replay
from byline.storage.fixtures import MatchPackage
from byline.stories.recap import (
    RecapDraft,
    RecapNotReady,
    RecapPoint,
    deterministic_recap,
    recap_facts,
    validate_recap,
)


def test_no_recap_before_full_time(golden: MatchPackage) -> None:
    st = replay(golden.world, list(golden.events), upto_seq=2000)
    with pytest.raises(RecapNotReady):
        recap_facts(st, list(golden.events[:2001]), [])


def test_deterministic_recap_reconciles_with_final_state(golden: MatchPackage) -> None:
    st = replay(golden.world, list(golden.events))
    facts = recap_facts(st, list(golden.events), [])
    r = deterministic_recap(st, facts)
    assert r.final_score == {"Northbridge": 2, "Riverton": 1}
    assert r.headline == "Northbridge win 2–1"
    assert len(r.goals) == 3 and len(r.disallowed) == 1
    assert any(g["situation"] == "penalty" for g in r.goals)
    assert any(c["card"] == "second_yellow" for c in r.discipline)
    ids = {e.event_id for e in golden.events}
    assert set(r.source_event_ids) <= ids and r.source_event_ids
    assert "ruled out" in " ".join(p.text for p in r.turning_points)


def test_recap_validator_rejects_wrong_score_and_invented_names(golden: MatchPackage) -> None:
    st = replay(golden.world, list(golden.events))
    facts = recap_facts(st, list(golden.events), [])
    ids = {e.event_id for e in golden.events}
    g = facts["goals"]
    good = RecapDraft(headline="Northbridge edge Riverton 2–1", summary="Northbridge beat Riverton 2–1.",
                      turning_points=[RecapPoint(minute=x["minute"], text="Goal.", event_ids=[x["event_id"]]) for x in g])
    assert validate_recap(good, facts, ids, golden.world) == []
    bad = good.model_copy(update={"summary": "Northbridge beat Riverton 5–1 as Moberg-Kale was exposed.",
                                  "headline": "Northbridge cruise"})
    issues = validate_recap(bad, facts, ids, golden.world)
    assert any("unsupported number 5" in i for i in issues)
    assert any("final score" in i for i in issues)
    assert any("Moberg-Kale" in i for i in issues)


def test_session_recap_endpoint_409_then_ok() -> None:
    with TestClient(app) as c:
        sid = c.post("/api/matches/BYLINE-01/sessions", json={"speed": 30}).json()["session_id"]
        c.post(f"/api/sessions/{sid}/control", json={"action": "seek", "elapsed_ms": 3_000_000})
        assert c.get(f"/api/sessions/{sid}/recap").status_code == 409
        sess = app.state.rt.sessions.get(sid)
        c.post(f"/api/sessions/{sid}/control", json={"action": "seek", "elapsed_ms": sess.duration_ms})
        r = c.get(f"/api/sessions/{sid}/recap").json()
        assert r["generated_by"] == "deterministic" and r["final_score"] == {"Northbridge": 2, "Riverton": 1}
