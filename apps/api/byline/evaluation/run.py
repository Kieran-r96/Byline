"""BYLINE evaluation report (T022). Deterministic, offline, reproducible.

    python -m byline.evaluation.run            # writes docs/evaluation/report.{json,md}

Ground-truth labels come from the scenario authoring (separate files the detectors never read).
Agent metrics are computed ONLY from recorded real Foundry traces in docs/evidence; nothing is
estimated or invented. Counts that cannot be measured are reported as "not measured".
"""

from __future__ import annotations

import datetime as dt
import glob
import json
import subprocess
import sys
from collections import defaultdict
from pathlib import Path
from typing import Any

from byline.config import API_ROOT, REPO_ROOT
from byline.events.models import MatchEvent
from byline.football.intelligence import run_detectors
from byline.match_state.reducer import DomainError, replay
from byline.simulation.generate import generate
from byline.simulation.scenarios import SCENARIOS

GOLDEN_SEEDS = [None, 11, 12, 13, 14]
ORDINARY_SEEDS = [None, 21, 22, 23, 24]
PATTERNS = ("repeated_channel_attack", "counterattack", "overlap")


def matches(c: Any, lab: dict[str, Any]) -> bool:
    if c.pattern_type != lab["pattern_type"] or c.team_id != lab["team_id"]:
        return False
    slack = 60_000 if lab["pattern_type"] == "repeated_channel_attack" else 2_000
    return bool(c.window_start_ms <= lab["end_ms"] + slack and c.detected_at_ms >= lab["start_ms"] - slack)


def detector_eval() -> dict[str, Any]:
    per: dict[str, dict[str, int]] = {p: {"TP": 0, "FP": 0, "FN": 0} for p in PATTERNS}
    split: dict[str, dict[str, dict[str, int]]] = {
        s: {p: {"TP": 0, "FP": 0, "FN": 0} for p in PATTERNS} for s in ("dev", "held_out")}
    runs: list[dict[str, Any]] = []
    reducer_failures = 0
    events_total = 0
    for scen, seeds in (("golden_story", GOLDEN_SEEDS), ("ordinary_match", ORDINARY_SEEDS)):
        for seed in seeds:
            g = generate(SCENARIOS[scen], seed=seed)
            evs = [MatchEvent.model_validate(e) for e in g.events]
            events_total += len(evs)
            try:
                replay(g.world, evs)
            except DomainError:
                reducer_failures += 1
            mi = run_detectors(g.world, evs, tracking=g.tracking)
            labels = g.labels
            matched_labels: set[int] = set()
            fp_list = []
            part = split["dev" if seed is None else "held_out"]
            for c in mi.candidates:
                hit = [i for i, lab in enumerate(labels) if matches(c, lab)]
                if hit:
                    matched_labels.update(hit)  # TP counted per label below
                else:
                    per[c.pattern_type]["FP"] += 1
                    part[c.pattern_type]["FP"] += 1
                    fp_list.append(f"{c.pattern_type}@{c.display_clock}/{c.team_id}")
            for i, lab in enumerate(labels):
                key = "TP" if i in matched_labels else "FN"
                per[lab["pattern_type"]][key] += 1
                part[lab["pattern_type"]][key] += 1
            runs.append({"scenario": scen, "seed": seed if seed is not None else SCENARIOS[scen].seed,
                         "events": len(evs), "labels": len(labels), "candidates": len(mi.candidates),
                         "unlabelled_detections": fp_list,
                         "missed": [f"{lab['pattern_type']}/{lab['team_id']}" for i, lab in enumerate(labels)
                                    if i not in matched_labels]})
    summary = {}
    for p, m in per.items():
        tp, fp, fn = m["TP"], m["FP"], m["FN"]
        summary[p] = {**m, "precision": round(tp / (tp + fp), 3) if tp + fp else None,
                      "recall": round(tp / (tp + fn), 3) if tp + fn else None}
    return {"scenarios": len(runs), "events_total": events_total, "reducer_failures": reducer_failures,
            "detectors": summary, "split": split, "runs": runs,
            "methodology": "Thresholds were tuned only on the dev seeds (golden 2026, ordinary 7341). Seeds 11-14 "
                           "and 21-24 are held out and were not used for tuning.",
            "note": "Labels are authored motifs only. 'Unlabelled detections' meet the detector definition in "
                    "generic simulated play but were not authored, so they are counted as false positives."}


def tests_eval() -> dict[str, Any]:
    def run(target: str) -> dict[str, Any]:
        r = subprocess.run([sys.executable, "-m", "pytest", "-q", target, "-p", "no:cacheprovider"],
                           cwd=API_ROOT, capture_output=True, text=True)
        last = [ln for ln in r.stdout.splitlines() if " passed" in ln or " failed" in ln]
        return {"command": f"pytest -q {target}", "result": last[-1] if last else r.stdout[-300:],
                "exit_code": r.returncode}
    return {"law_matrix": run("tests/test_law_matrix.py"), "agents_mock": run("tests/test_agents.py"),
            "full_suite": run("tests")}


def agent_eval() -> dict[str, Any]:
    files = sorted(glob.glob(str(REPO_ROOT / "docs" / "evidence" / "*.json")))
    runs = []
    for f in files:
        d = json.loads(Path(f).read_text(encoding="utf-8"))
        t = d.get("trace")
        if not t or t.get("provider") != "foundry":
            continue
        ins = d.get("insight") or {}
        validators = [s for s in t["steps"] if s["agent"] == "deterministic_validator"]
        runs.append({
            "file": Path(f).name, "candidate": t["candidate_id"], "outcome": t["outcome"],
            "status": ins.get("status"), "model_calls": t["total_model_calls"], "tokens": t["total_tokens"],
            "latency_ms": t["total_latency_ms"], "revisions": max(0, len(validators) - 1),
            "validator_issues": [i for s in validators for i in (s.get("output") or {}).get("issues", [])],
            "response_ids": sum(len(s["response_ids"]) for s in t["steps"]),
            "schema_failures": sum(1 for s in t["steps"] if s.get("error") and "Validation" in (s.get("error") or "")),
        })
    lat = sorted(r["latency_ms"] for r in runs)

    def pct(p: float) -> int | None:
        return lat[min(len(lat) - 1, int(p * len(lat)))] if lat else None

    return {
        "provider": "Microsoft Foundry (gpt-4.1-mini) via Microsoft Agent Framework",
        "runs": len(runs), "verified": sum(1 for r in runs if r["status"] == "verified"),
        "not_verified": sum(1 for r in runs if r["status"] != "verified"),
        "model_calls": sum(r["model_calls"] for r in runs), "tokens": sum(r["tokens"] for r in runs),
        "case_latency_p50_ms": pct(0.5), "case_latency_p95_ms": pct(0.95),
        "schema_failures": sum(r["schema_failures"] for r in runs),
        "unsupported_claims_caught_by_validator": sum(len(r["validator_issues"]) for r in runs),
        "details": runs,
        "note": "Only recorded real runs are counted. Mock-client tests prove orchestration, not model quality.",
    }


def git_sha() -> str:
    r = subprocess.run(["git", "rev-parse", "--short", "HEAD"], cwd=REPO_ROOT, capture_output=True, text=True)
    return r.stdout.strip() or "unknown"


def markdown(rep: dict[str, Any]) -> str:
    d, a, t = rep["offline"], rep["agents"], rep["tests"]
    lines = [
        f"# BYLINE evaluation report\n\n`{rep['timestamp']}` · commit `{rep['commit']}` · seeds golden "
        f"{rep['seeds']['golden']} / ordinary {rep['seeds']['ordinary']}\n",
        f"**OFFLINE RUN:** scenarios {d['scenarios']} | events total {d['events_total']} | event reducer failures "
        f"{d['reducer_failures']}\n",
        "| Detector | TP | FP | FN | Precision | Recall |", "|---|---|---|---|---|---|",
    ]
    for p, m in d["detectors"].items():
        lines.append(f"| {p} | {m['TP']} | {m['FP']} | {m['FN']} | {m['precision']} | {m['recall']} |")
    lines.append(f"\n_{d['methodology']}_\n")
    lines += ["| Split | Detector | TP | FP | FN |", "|---|---|---|---|---|"]
    for part, dets in d["split"].items():
        for p, m in dets.items():
            lines.append(f"| {part} | {p} | {m['TP']} | {m['FP']} | {m['FN']} |")
    lines += [f"\n_{d['note']}_\n", "**Unlabelled detections / misses per run**\n"]
    for r in d["runs"]:
        lines.append(f"- {r['scenario']} seed {r['seed']}: {r['candidates']} candidates, labels {r['labels']}, "
                     f"unlabelled {r['unlabelled_detections'] or 'none'}, missed {r['missed'] or 'none'}")
    lines += [
        f"\n**REFEREE MATRIX:** {t['law_matrix']['result']}",
        f"\n**AGENTS:** provider {a['provider']} | runs {a['runs']} | verified {a['verified']} | not verified "
        f"{a['not_verified']} | schema failures {a['schema_failures']} | validator issues caught "
        f"{a['unsupported_claims_caught_by_validator']} | case latency p50/p95 {a['case_latency_p50_ms']}/"
        f"{a['case_latency_p95_ms']} ms (measured)",
        f"\n**COST:** {a['model_calls']} real model calls, {a['tokens']} tokens across recorded runs "
        "(gpt-4.1-mini; token counts as reported by the service).",
        f"\n**TESTS:** full suite {t['full_suite']['result']}; agent orchestration (test mocks) "
        f"{t['agents_mock']['result']}",
        "\n**UI / DEPLOY:** not measured by this script (see PROGRESS.md for screenshot and deployment checks).",
        "\n**LIMITATIONS:** synthetic data only; labels are authored motifs; player-centre tracking cannot "
        "adjudicate marginal offside; agent quality measured on a small number of real runs.",
    ]
    return "\n".join(lines) + "\n"


def main() -> int:
    rep = {
        "timestamp": dt.datetime.now().isoformat(timespec="seconds"), "commit": git_sha(),
        "seeds": {"golden": [s or SCENARIOS["golden_story"].seed for s in GOLDEN_SEEDS],
                  "ordinary": [s or SCENARIOS["ordinary_match"].seed for s in ORDINARY_SEEDS]},
        "offline": detector_eval(), "agents": agent_eval(), "tests": tests_eval(),
    }
    out = REPO_ROOT / "docs" / "evaluation"
    out.mkdir(parents=True, exist_ok=True)
    (out / "report.json").write_text(json.dumps(rep, indent=1, default=str), encoding="utf-8")
    (out / "report.md").write_text(markdown(rep), encoding="utf-8")
    print(markdown(rep))
    _ = defaultdict
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
