"""Replay a scenario through the full deterministic pipeline and print its story timeline.

    python -m byline.tools.replay golden_story
"""

from __future__ import annotations

import sys

from byline.football.intelligence import run_detectors
from byline.storage.fixtures import available_scenarios, load_package

KEY = {"goal.confirmed", "goal.disallowed", "card.yellow", "card.second_yellow", "card.red", "var.review_started",
       "penalty.outcome", "substitution", "period.started", "period.ended", "match.finished"}


def main(argv: list[str]) -> int:
    sid = argv[0] if argv else "golden_story"
    if sid not in available_scenarios():
        print(f"unknown scenario {sid}; available: {available_scenarios()}")
        return 2
    pkg = load_package(sid)
    mi = run_detectors(pkg.world, pkg.events, tracking=pkg.tracking)
    rows: list[tuple[int, str]] = []
    for e in pkg.events:
        if e.type in KEY:
            who = pkg.world.player(e.player_id).display_name if e.player_id else ""
            rows.append((e.seq, f"{e.display_clock:>6}  {e.event_id}  {e.type:<20} {who}"))
    for c in mi.candidates:
        mark = " [RETRACTED]" if c.candidate_id in mi.retractions else ""
        rows.append((c.detected_at_seq, f"{c.display_clock:>6}  STORY  {c.pattern_type:<20} {c.candidate_id}{mark}"))
    for d in mi.explainer.cards:
        if d.importance == "major":
            rows.append((int(d.source_event_ids[-1][1:]), f"{d.clock:>6}  RULE   {d.kind:<20} {d.decision}"))
    for _, line in sorted(rows):
        print(line)
    st = mi.state.snapshot()
    print(f"\n{sid}: {len(pkg.events)} events | final {st['score']} | {len(mi.candidates)} stories | "
          f"{len(mi.explainer.cards)} decision cards | sha256 {pkg.events_sha256[:16]}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
