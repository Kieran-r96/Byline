"""P1 movement audit: measure how credible the synthetic tracking is (all players, ball, sync).

    python -m byline.tools.movement_audit [scenario]
"""

from __future__ import annotations

import math
import statistics as stats
import sys
from typing import Any

from byline.storage.fixtures import load_package

ON_BALL = {"pass.completed", "pass.failed", "carry", "shot", "interception", "tackle", "ball_recovery"}


def pct(xs: list[float], p: float) -> float:
    xs = sorted(xs)
    return xs[min(len(xs) - 1, int(p * len(xs)))] if xs else float("nan")


def audit(scenario: str) -> dict[str, Any]:
    pkg = load_package(scenario)
    tr = pkg.tracking
    ents: list[str] = tr["entities"]
    frames = tr["frames"]
    world = pkg.world
    col = {pid: 4 + 2 * i for i, pid in enumerate(ents)}
    gk_ids = {p.player_id for t in world.teams for p in t.players if p.position == "GK"}
    per: dict[str, dict[str, Any]] = {}
    for pid in ents:
        if pid == "REF":
            continue
        c = col[pid]
        speeds, dist_m, still, active = [], 0.0, 0, 0
        for a, b in zip(frames, frames[1:], strict=False):
            if a[c] is None or b[c] is None:
                continue
            dt = (b[0] - a[0]) / 1000
            if dt <= 0 or dt > 1.0:
                continue
            d = math.dist((a[c], a[c + 1]), (b[c], b[c + 1]))
            v = d / dt
            speeds.append(v)
            dist_m += d
            active += 1
            if v < 0.3:
                still += 1
        if active:
            per[pid] = {"median": stats.median(speeds), "p95": pct(speeds, 0.95), "max": max(speeds),
                        "km": dist_m / 1000, "still_share": still / active, "minutes": active * 0.5 / 60,
                        "gk": pid in gk_ids}
    # ball
    bspeeds, teleports = [], 0
    for a, b in zip(frames, frames[1:], strict=False):
        dt = (b[0] - a[0]) / 1000
        if dt <= 0 or dt > 1.0:
            continue
        v = math.dist((a[1], a[2]), (b[1], b[2])) / dt
        bspeeds.append(v)
        if v > 40:
            teleports += 1
    # event / tracking sync: acting player at the event location at event time
    times = [f[0] for f in frames]
    import bisect

    gaps = []
    for ev in pkg.events:
        if ev.type not in ON_BALL or not ev.player_id:
            continue
        loc = ev.payload.get("start") or ev.payload.get("location")
        if not loc:
            continue
        i = min(bisect.bisect_left(times, ev.elapsed_ms), len(frames) - 1)
        row = frames[i]
        c = col[ev.player_id]
        if row[c] is None:
            continue
        gaps.append(math.dist((row[c], row[c + 1]), (loc["x_m"], loc["y_m"])))
    # team shape (outfield, every 10th frame)
    shape: dict[str, dict[str, list[float]]] = {t.team_id: {"length": [], "width": []} for t in world.teams}
    overlaps = 0
    samples = 0
    for row in frames[::10]:
        for t in world.teams:
            xs = [row[col[p.player_id]] for p in t.players if p.player_id not in gk_ids
                  and row[col[p.player_id]] is not None]
            ys = [row[col[p.player_id] + 1] for p in t.players if p.player_id not in gk_ids
                  and row[col[p.player_id]] is not None]
            if len(xs) >= 8:
                shape[t.team_id]["length"].append(max(xs) - min(xs))
                shape[t.team_id]["width"].append(max(ys) - min(ys))
        pts = [(row[col[p]], row[col[p] + 1]) for p in ents if p != "REF" and row[col[p]] is not None]
        samples += 1
        for i in range(len(pts)):
            for j in range(i + 1, len(pts)):
                if math.dist(pts[i], pts[j]) < 0.8:
                    overlaps += 1
    outfield = [v for v in per.values() if not v["gk"] and v["minutes"] > 80]
    gks = [v for v in per.values() if v["gk"] and v["minutes"] > 80]
    return {
        "scenario": scenario,
        "outfield_full_match": len(outfield),
        "outfield_median_speed_ms": round(stats.median([v["median"] for v in outfield]), 2),
        "outfield_p95_speed_ms": round(stats.median([v["p95"] for v in outfield]), 2),
        "outfield_max_speed_ms": round(max(v["max"] for v in outfield), 2),
        "outfield_km_per_match_median": round(stats.median([v["km"] for v in outfield]), 2),
        "outfield_still_share_median": round(stats.median([v["still_share"] for v in outfield]), 3),
        "outfield_still_share_max": round(max(v["still_share"] for v in outfield), 3),
        "gk_km": [round(v["km"], 2) for v in gks], "gk_still_share": [round(v["still_share"], 3) for v in gks],
        "ball_median_speed_ms": round(stats.median(bspeeds), 2), "ball_p99_speed_ms": round(pct(bspeeds, 0.99), 2),
        "ball_teleports_gt40ms": teleports,
        "event_actor_gap_m_median": round(stats.median(gaps), 2), "event_actor_gap_m_p95": round(pct(gaps, 0.95), 2),
        "team_length_m_median": {t: round(stats.median(v["length"]), 1) for t, v in shape.items()},
        "team_width_m_median": {t: round(stats.median(v["width"]), 1) for t, v in shape.items()},
        "player_overlaps_per_sampled_frame": round(overlaps / max(samples, 1), 3),
        "worst_still": sorted(((round(v["still_share"], 2), pid) for pid, v in per.items() if v["minutes"] > 30),
                              reverse=True)[:5],
    }


if __name__ == "__main__":
    for s in sys.argv[1:] or ["golden_story"]:
        for k, v in audit(s).items():
            print(f"{k:38s} {v}")
