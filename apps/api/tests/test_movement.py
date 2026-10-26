"""P1: movement realism invariants on the shipped tracking (what the UI renders = what detectors read)."""

from __future__ import annotations

import json
import math

import pytest

from byline.football.intelligence import run_detectors
from byline.simulation.realism import MatchContext, refine
from byline.storage.fixtures import MatchPackage, load_package
from byline.stories.service import RECORDED_DIR
from byline.tools.movement_audit import audit


@pytest.fixture(scope="module", params=["golden_story", "discipline_var", "ordinary_match"])
def audited(request):  # type: ignore[no-untyped-def]
    return audit(request.param)


def test_football_plausible_volumes(audited) -> None:  # type: ignore[no-untyped-def]
    assert 8.0 <= audited["outfield_km_per_match_median"] <= 13.0  # elite outfield players ~10-11 km
    assert 1.2 <= audited["outfield_median_speed_ms"] <= 2.5
    assert audited["outfield_max_speed_ms"] <= 10.5  # elite top speed; no teleporting players
    assert audited["outfield_still_share_max"] < 0.15  # nobody frozen for long spells
    assert audited["ball_teleports_gt40ms"] == 0
    assert all(2.0 <= km <= 6.0 for km in audited["gk_km"])


def test_events_and_tracking_stay_in_sync(audited) -> None:  # type: ignore[no-untyped-def]
    assert audited["event_actor_gap_m_median"] < 1.5
    assert audited["event_actor_gap_m_p95"] < 3.5


def test_positions_in_bounds_and_goalkeepers_stay_home(golden: MatchPackage) -> None:
    tr = golden.tracking
    ents = tr["entities"]
    gk_cols = {4 + 2 * ents.index(p.player_id): t.team_id for t in golden.world.teams for p in t.players
               if p.position == "GK"}
    ctx = MatchContext(golden.world, list(golden.events))
    home_third = 0
    total = 0
    for f in tr["frames"]:
        for k in range(4, len(f), 2):
            if f[k] is not None:
                assert 0.0 <= f[k] <= 105.0 and 0.0 <= f[k + 1] <= 68.0
        for c, team in gk_cols.items():
            if f[c] is None:
                continue
            total += 1
            d = ctx.direction(team, f[0])
            ax = f[c] if d == "+x" else 105.0 - f[c]
            home_third += ax <= 35.0
    assert home_third / total > 0.97


def test_defending_block_is_more_compact_than_attacking_shape(golden: MatchPackage) -> None:
    ctx = MatchContext(golden.world, list(golden.events))
    ents = golden.tracking["entities"]
    gk = {p.player_id for t in golden.world.teams for p in t.players if p.position == "GK"}
    width = {True: [], False: []}  # type: ignore[var-annotated]
    for f in golden.tracking["frames"][::10]:
        poss = ctx.possession(f[0])
        for t in golden.world.teams:
            ys = [f[4 + 2 * ents.index(p.player_id) + 1] for p in t.players
                  if p.player_id not in gk and f[4 + 2 * ents.index(p.player_id)] is not None]
            if len(ys) >= 8:
                width[poss == t.team_id].append(max(ys) - min(ys))
    med = {k: sorted(v)[len(v) // 2] for k, v in width.items()}
    assert med[False] < med[True] - 6.0  # compresses out of possession


def test_realism_never_changes_evidence(golden: MatchPackage) -> None:
    """Re-running the pass keeps detector outputs identical, and the recorded REAL overlap insight's
    numbers still match the tracking that is displayed."""
    again = refine(golden.tracking, list(golden.events), golden.world)
    a = [c.model_dump() for c in run_detectors(golden.world, golden.events, tracking=golden.tracking).candidates]
    b = [c.model_dump() for c in run_detectors(golden.world, golden.events, tracking=again).candidates]
    assert a == b
    d3 = next(c for c in run_detectors(golden.world, golden.events, tracking=golden.tracking).candidates
              if c.pattern_type == "overlap")
    rec = next(json.loads(p.read_text(encoding="utf-8")) for p in RECORDED_DIR.glob("*.json")
               if json.loads(p.read_text(encoding="utf-8"))["insight"]["candidate_id"] == d3.candidate_id)
    prov = rec["insight"]["metric_provenance"]
    for k in ("runner_distance_m", "run_seconds", "runner_start_behind_m", "runner_finish_ahead_m"):
        assert math.isclose(float(d3.calculated_metrics[k]), float(prov[k])), k
    assert str(d3.calculated_metrics["runner_distance_m"]) in rec["insight"]["canonical_claim"]


def test_events_unchanged_by_realism_pass() -> None:
    """Event logs are generated before the pass and must match the committed fixtures exactly."""
    for sid, sha in (("golden_story", "e533e299501c2fd0"), ("ordinary_match", "cd4f8caaabbf1818"),
                     ("discipline_var", "050c1c262c826b2e")):
        assert load_package(sid).events_sha256.startswith(sha)
