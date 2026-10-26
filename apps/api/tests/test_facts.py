"""T015: fictional research facts with provenance; live match facts from events."""

from __future__ import annotations

from fastapi.testclient import TestClient

from byline.api.app import app
from byline.storage.fixtures import MatchPackage
from byline.world.facts import match_facts, seeded_facts


def test_seeded_facts_are_fictional_stable_and_consistent(golden: MatchPackage) -> None:
    a, b = seeded_facts(golden.world), seeded_facts(golden.world)
    assert a == b and len(a) > 60
    assert len({f.fact_id for f in a}) == len(a)
    for f in a:
        assert f.provenance == "fictional_seeded" and "fictional" in f.source and f.as_of
    for f in a:
        if f.subject_kind == "player" and f.category == "career" and f.short_text[0].isdigit() and " in " in f.short_text:
            goals, apps = int(f.short_text.split()[0]), int(f.short_text.split(" in ")[1].split()[0])
            assert goals <= apps
        if "away from" in f.short_text:
            assert f.relevance_reason == "Milestone within reach today"


def test_match_facts_follow_the_event_log(golden: MatchPackage) -> None:
    evs = list(golden.events)
    six = match_facts(golden.world, "RVC-06", evs)
    texts = " ".join(f.short_text for f in six)
    assert "Booked at" in texts and "Sent off (second yellow)" in texts
    for f in six:
        assert f.provenance == "match_event_derived" and set(f.event_source_ids) <= {e.event_id for e in evs}
    sub = match_facts(golden.world, "NBA-19", evs)
    assert any("Came on at" in f.short_text and f.relevance_reason for f in sub)
    early = match_facts(golden.world, "RVC-06", evs[:400])
    assert not any("Sent off" in f.short_text for f in early)  # no future knowledge


def test_facts_endpoints() -> None:
    with TestClient(app) as c:
        t = c.get("/api/matches/BYLINE-01/teams/NBA/facts").json()
        assert t["facts"] and all(f["subject_id"] == "NBA" for f in t["facts"])
        p = c.get("/api/matches/BYLINE-01/players/NBA-09/facts", params={"upto_seq": 800}).json()
        assert p["player"]["display_name"] == "N. Vantreight"
        assert any(f["fact_type"] == "match" for f in p["facts"])
        rel = [f["relevance"] for f in p["facts"]]
        assert rel == sorted(rel, reverse=True)
        assert c.get("/api/matches/BYLINE-01/players/XXX-99/facts").status_code == 404
        assert c.get("/api/matches/BYLINE-01/teams/XXX/facts").status_code == 404
