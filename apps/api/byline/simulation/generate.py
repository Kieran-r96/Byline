"""Generate a scenario: events JSONL, tracking frames and (separate) evaluation labels.

    python -m byline.simulation.generate            # all scenarios -> fixtures/
    python -m byline.simulation.generate golden_story --check
"""

from __future__ import annotations

import gzip
import hashlib
import json
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from byline.config import API_ROOT, FIXTURE_DIR
from byline.simulation.engine import Engine, tracking_header
from byline.simulation.realism import refine
from byline.simulation.scenarios import MIN, SCENARIOS, Label, Scenario, labels_to_json
from byline.world.models import ScenarioRef, World
from byline.world.seed_world import build_world

HALF_TIME_GAP_MS = 5_000


@dataclass
class Generated:
    world: World
    events: list[dict[str, Any]]
    tracking: dict[str, Any]
    labels: list[dict[str, Any]]


def scenario_ref(s: Scenario) -> ScenarioRef:
    return ScenarioRef(scenario_id=s.scenario_id, seed=s.seed, version=s.version, title=s.title,
                       description=s.description)


def generate(s: Scenario, seed: int | None = None) -> Generated:
    world = build_world(s.match_id, scenario_ref(s))
    e = Engine(world, s.seed if seed is None else seed)
    labels: list[Label] = []
    e.emit("fixture.created", None, None, {"scenario_id": s.scenario_id, "seed": s.seed,
                                           "synthetic": True}, official=True)
    e.lineups()
    for period, kickoff_team in (("H1", e.home), ("H2", e.away)):
        if period == "H2":
            e.t += HALF_TIME_GAP_MS
            e.next_frame_t = e.t
        e.start_period(period, kickoff_team, s.added[period])
        start = e.period_start
        end = start + (45 + s.added[period]) * MIN
        phases = [p for p in s.phases if p.period == period]
        beats = sorted((b for b in s.beats if b.period == period), key=lambda b: b.at_min)
        checkpoints = sorted({int(start + p.start_min * MIN) for p in phases}
                             | {int(start + p.end_min * MIN) for p in phases}
                             | {int(start + b.at_min * MIN) for b in beats})
        for cp in [*checkpoints, end]:
            e.play_until(cp)
            for p in phases:
                if int(start + p.start_min * MIN) == cp:
                    e.bias[p.team_id] = (p.target_ay, p.strength)
                if int(start + p.end_min * MIN) == cp:
                    e.bias.pop(p.team_id, None)
                    labels.append(Label("repeated_channel_attack", p.team_id, int(start + p.start_min * MIN), e.t,
                                        f"Authored channel bias toward attacking-frame y={p.target_ay}"))
            for b in beats:
                if int(start + b.at_min * MIN) == cp:
                    b.run(e, labels)
        e.end_period(s.added[period])
    e.period = "FT"
    e.emit("match.finished", None, None, {"final_score": dict(e.score)}, official=True)
    tracking = {**tracking_header(e), "frames": e.frames}
    # stage 2: off-ball realism; engaged (evidence) frames are preserved exactly
    from byline.events.models import MatchEvent

    tracking = refine(tracking, [MatchEvent.model_validate(ev) for ev in e.events], world)
    return Generated(world=world, events=e.events, tracking=tracking, labels=labels_to_json(labels))


def events_jsonl(events: list[dict[str, Any]]) -> str:
    return "".join(json.dumps(ev, separators=(",", ":"), sort_keys=True) + "\n" for ev in events)


def write(g: Generated, s: Scenario, out_dir: Path = FIXTURE_DIR) -> dict[str, str]:
    out_dir.mkdir(parents=True, exist_ok=True)
    body = events_jsonl(g.events)
    (out_dir / f"{s.scenario_id}.events.jsonl").write_text(body, encoding="utf-8", newline="\n")
    (out_dir / f"{s.scenario_id}.world.json").write_text(
        json.dumps(g.world.model_dump(mode="json"), indent=1, sort_keys=True) + "\n", encoding="utf-8", newline="\n")
    tracking_bytes = json.dumps(g.tracking, separators=(",", ":")).encode()
    with gzip.GzipFile(out_dir / f"{s.scenario_id}.tracking.json.gz", "wb", mtime=0) as fh:
        fh.write(tracking_bytes)
    # Evaluation-only ground truth: lives outside the runtime fixture directory.
    label_dir = API_ROOT / "eval" / "labels" if out_dir == FIXTURE_DIR else out_dir / "labels"
    label_dir.mkdir(parents=True, exist_ok=True)
    (label_dir / f"{s.scenario_id}.labels.json").write_text(json.dumps(g.labels, indent=1) + "\n",
                                                            encoding="utf-8", newline="\n")
    return {
        "events_sha256": hashlib.sha256(body.encode()).hexdigest(),
        "tracking_sha256": hashlib.sha256(tracking_bytes).hexdigest(),
    }


def main(argv: list[str]) -> int:
    names = [a for a in argv if not a.startswith("--")] or list(SCENARIOS)
    for name in names:
        s = SCENARIOS[name]
        g = generate(s)
        digests = write(g, s)
        score = g.events[-1]["payload"]["final_score"]
        print(f"{name}: {len(g.events)} events, {len(g.tracking['frames'])} frames, final {score}, "
              f"labels {len(g.labels)}, events sha256 {digests['events_sha256'][:16]}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
