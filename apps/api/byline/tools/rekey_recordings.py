"""Verified re-key of recorded real Foundry runs after a source-data correction.

    python -m byline.tools.rekey_recordings <git-ref-of-old-fixtures> [--write]

Recorded runs are cached under a key that includes the checksum of the WHOLE event log, so any data fix
invalidates them (deliberately strict). This tool moves a recording to the new key ONLY when everything
the agents could have received is provably identical between the old and new logs:

  * the candidate the case was opened for (full model dump)
  * the match-state snapshot at detection (what get_match_context and the verifier saw)
  * every tool call in the recorded trace, replayed in full against both logs
  * the deterministic validator's verdict on the recorded draft

The recap is migrated only if its full-time fact sheet is identical. Anything that differs is reported and
left alone: it falls back to deterministic output and would need a fresh real run. Nothing is regenerated.
"""

from __future__ import annotations

import json
import subprocess
import sys
import time
from dataclasses import replace
from pathlib import Path
from typing import Any

from byline.agents.prompts import COMPATIBLE_PROMPT_VERSIONS, PROMPT_VERSION
from byline.agents.schemas import DraftInsight
from byline.agents.tools import CaseTools
from byline.agents.validator import validate_draft
from byline.config import FIXTURE_DIR, REPO_ROOT, Settings
from byline.events.models import MatchEvent
from byline.football.intelligence import MatchIntelligence
from byline.storage.fixtures import MatchPackage, available_scenarios, load_package
from byline.stories.models import Insight
from byline.stories.recap import recap_facts
from byline.stories.service import RECORDED_DIR, InsightService

RECAP_DIR = RECORDED_DIR.parent / "recaps"


def old_package(pkg: MatchPackage, ref: str) -> MatchPackage:
    rel = (FIXTURE_DIR / f"{pkg.scenario_id}.events.jsonl").relative_to(REPO_ROOT).as_posix()
    raw = subprocess.run(["git", "show", f"{ref}:{rel}"], cwd=REPO_ROOT, capture_output=True, check=True).stdout
    import hashlib

    events = tuple(MatchEvent.model_validate_json(line) for line in raw.splitlines() if line.strip())
    return replace(pkg, events=events, events_sha256=hashlib.sha256(raw).hexdigest())


def at_detection(pkg: MatchPackage, cid: str) -> tuple[Any, dict[str, Any]]:
    mi = MatchIntelligence(pkg.world, tracking=pkg.tracking)
    for ev in pkg.events:
        mi.ingest(ev)
        hit = next((c for c in mi.candidates if c.candidate_id == cid), None)
        if hit is not None:
            return hit, mi.state.snapshot()
    raise KeyError(cid)


def replay_tools(pkg: MatchPackage, cand: Any, state: dict[str, Any], calls: list[dict[str, Any]]) -> tuple[list[str], set[str]]:
    tools = CaseTools(world=pkg.world, events=pkg.events, snapshot_seq=cand.detected_at_seq, candidate=cand,
                      state_snapshot=state, tracking=pkg.tracking if cand.pattern_type == "overlap" else None)
    outs = []
    for call in calls:
        fn = getattr(tools, call["name"])
        outs.append(fn(**call.get("arguments", {})))
    return outs, tools.fetched_ids


class Key:
    """Stand-in for a session: InsightService.cache_key only reads session.package.events_sha256."""

    def __init__(self, pkg: MatchPackage) -> None:
        self.package = pkg


def check_insight(path: Path, pkgs: dict[str, tuple[MatchPackage, MatchPackage]], svc: InsightService) -> dict[str, Any]:
    d = json.loads(path.read_text(encoding="utf-8"))
    cid, match_id = d["insight"]["candidate_id"], d["insight"]["match_id"]
    old, new = pkgs[match_id]
    c_old, s_old = at_detection(old, cid)
    c_new, s_new = at_detection(new, cid)
    out: dict[str, Any] = {"file": path.name, "candidate_id": cid, "checks": {}}
    out["checks"]["candidate identical"] = c_old.model_dump() == c_new.model_dump()
    out["checks"]["state at detection identical"] = s_old == s_new
    calls = [tc for st in d["trace"]["steps"] for tc in st.get("tool_calls", [])]
    r_old, f_old = replay_tools(old, c_old, s_old, calls)
    r_new, f_new = replay_tools(new, c_new, s_new, calls)
    out["checks"][f"{len(calls)} tool calls identical"] = r_old == r_new and f_old == f_new
    out["checks"]["recorded previews match replay"] = all(
        out_new.startswith(tc["result_preview"]) for out_new, tc in zip(r_new, calls, strict=True))
    drafts = [st["output"] for st in d["trace"]["steps"] if st["agent"] == "analyst" and st.get("output")]
    draft = DraftInsight.model_validate(drafts[-1])
    v = [validate_draft(draft, c, {e.event_id: e for e in p.events if e.seq <= c.detected_at_seq}, f, s, p.world,
                        tracking_used=c.pattern_type == "overlap")
         for p, c, s, f in ((old, c_old, s_old, f_old), (new, c_new, s_new, f_new))]
    out["checks"]["validator verdict identical"] = v[0] == v[1]
    stem = path.stem
    version = next((ver for ver in (PROMPT_VERSION, *COMPATIBLE_PROMPT_VERSIONS)
                    if svc.cache_key(Key(old), c_old, ver) == stem), None)  # type: ignore[arg-type]
    out["checks"]["old key reproduced"] = version is not None
    out["new_key"] = svc.cache_key(Key(new), c_new, version or PROMPT_VERSION)  # type: ignore[arg-type]
    out["ok"] = all(out["checks"].values())
    return out


def check_recap(path: Path, pkgs: dict[str, tuple[MatchPackage, MatchPackage]], svc: InsightService) -> dict[str, Any]:
    import hashlib

    d = json.loads(path.read_text(encoding="utf-8"))
    old, new = pkgs[d["match_id"]]
    insights = []
    for p in RECORDED_DIR.glob("*.json"):
        rec = json.loads(p.read_text(encoding="utf-8"))
        if rec["insight"]["match_id"] == d["match_id"]:
            insights.append(Insight.model_validate(rec["insight"]))

    def facts(pkg: MatchPackage) -> dict[str, Any]:
        mi = MatchIntelligence(pkg.world, tracking=pkg.tracking)
        for ev in pkg.events:
            mi.ingest(ev)
        by_cid = {i.candidate_id: i for i in insights}  # the server lists them in detection order
        live = [by_cid[c.candidate_id] for c in mi.candidates
                if c.candidate_id in by_cid and c.candidate_id not in mi.retractions]
        return recap_facts(mi.state, list(pkg.events), live)

    f_old, f_new = facts(old), facts(new)
    diff = sorted(k for k in set(f_old) | set(f_new) if f_old.get(k) != f_new.get(k))

    def key(pkg: MatchPackage, f: dict[str, Any]) -> str:
        return hashlib.sha256(json.dumps([pkg.events_sha256, PROMPT_VERSION, f["verified_stories"],
                                          svc.settings.foundry_deployment]).encode()).hexdigest()[:24]

    return {"file": path.name, "checks": {"old key reproduced": key(old, f_old) == path.stem,
                                          "full-time fact sheet identical": not diff},
            "differs": {k: (f_old.get(k), f_new.get(k)) for k in diff}, "new_key": key(new, f_new),
            "ok": key(old, f_old) == path.stem and not diff}


def main() -> int:
    if len(sys.argv) < 2:
        print(__doc__)
        return 2
    ref, write = sys.argv[1], "--write" in sys.argv
    pkgs = {}
    for sid in available_scenarios():
        new = load_package(sid)
        pkgs[new.match_id] = (old_package(new, ref), new)
    svc = InsightService(Settings(byline_ai_provider="foundry", byline_ai_cache_only=True,
                                  foundry_deployment="gpt-4.1-mini"), lambda: [], lambda: None, cache_dir=None)
    results = [check_insight(p, pkgs, svc) for p in sorted(RECORDED_DIR.glob("*.json"))]
    results += [check_recap(p, pkgs, svc) for p in sorted(RECAP_DIR.glob("*.json"))]
    for r in results:
        print(("OK   " if r["ok"] else "KEEP ") + r["file"], "->", r["new_key"])
        for name, ok in r["checks"].items():
            print(f"       {'pass' if ok else 'FAIL'}  {name}")
        for k, (a, b) in r.get("differs", {}).items():
            print(f"       differs: {k}: {str(a)[:120]} -> {str(b)[:120]}")
    if write:
        for r in results:
            if not r["ok"]:
                continue
            folder = RECAP_DIR if "differs" in r else RECORDED_DIR
            src = folder / r["file"]
            d = json.loads(src.read_text(encoding="utf-8"))
            d.setdefault("rekeyed", []).append({
                "from_key": src.stem, "to_key": r["new_key"], "at": time.strftime("%Y-%m-%d"),
                "reason": "event log corrected (period.ended clock); inputs verified identical, output unchanged",
                "verified": sorted(r["checks"]),
            })
            (folder / f"{r['new_key']}.json").write_text(json.dumps(d, indent=1, ensure_ascii=False), encoding="utf-8")
            src.unlink()
        print("written")
    return 0 if all(r["ok"] for r in results) else 1


if __name__ == "__main__":
    raise SystemExit(main())
