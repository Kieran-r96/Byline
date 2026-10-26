"""T014: discipline & VAR showcase replays legally and every refereeing case is explained."""

from __future__ import annotations

from byline.football.intelligence import run_detectors
from byline.match_state.reducer import replay
from byline.storage.fixtures import load_package


def test_discipline_var_full_replay_and_decisions() -> None:
    pkg = load_package("discipline_var")
    st = replay(pkg.world, list(pkg.events)).snapshot()
    assert st["finished"] and st["score"] == {"NBA": 2, "RVC": 1}
    assert st["teams"]["RVC"]["sent_off"] == ["RVC-04"] and st["teams"]["NBA"]["sent_off"] == ["NBA-05"]
    cards = run_detectors(pkg.world, pkg.events, tracking=pkg.tracking).explainer.cards
    kinds = [c.kind for c in cards]
    for k in ("OFFSIDE POSITION · NO OFFENCE", "RED CARD", "PENALTY", "DROPPED BALL", "GOAL KICK", "VAR CHECK",
              "GOAL CONFIRMED", "PENALTY RETAKE"):
        assert k in kinds, k
    pen = [c for c in cards if c.kind == "PENALTY"]
    assert any("Red card" in c.decision for c in pen) and any("Yellow card" in c.decision for c in pen)
    throw = next(c for c in cards if c.kind == "OFFSIDE POSITION · NO OFFENCE")
    assert "throw-in" in throw.reason
    goals = [g for g in st["goals"] if g["status"] == "confirmed"]
    assert len(goals) == 3 and any(g["situation"] == "penalty" for g in goals)
