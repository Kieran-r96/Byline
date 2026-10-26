"""T020 / AI-09: Spanish variant preserves numbers and names; failing fields are not shipped."""

from __future__ import annotations

import json

from byline.agents.translate import FIELDS, check_translation
from byline.storage.fixtures import load_package
from byline.stories.models import Insight
from byline.stories.service import RECORDED_DIR


def test_number_and_name_preservation_check() -> None:
    world = load_package("golden_story").world
    en = dict.fromkeys(FIELDS, "Mensah-Lowe ran 36.5 m in 5.5 s (91%).")
    es_ok = dict.fromkeys(FIELDS, "Mensah-Lowe corrió 36.5 m en 5.5 s (91%).")
    assert all(v == [] for v in check_translation(en, es_ok, world).values())
    es_bad = dict(es_ok, canonical_claim="Mensah-Lowe corrió 37 m en 5.5 s (91%).",
                  commentator="El lateral corrió 36.5 m en 5.5 s (91%).")
    res = check_translation(en, es_bad, world)
    assert any("numbers changed" in i for i in res["canonical_claim"])
    assert any("Mensah-Lowe" in i for i in res["commentator"])


def test_recorded_spanish_variants_are_valid() -> None:
    world = load_package("golden_story").world
    found = 0
    for path in RECORDED_DIR.glob("*.json"):
        data = json.loads(path.read_text(encoding="utf-8"))
        ins = Insight.model_validate(data["insight"])
        tr = ins.audience_variants.translations
        if not tr:
            continue
        found += 1
        assert "es._note" in tr and "English is authoritative" in tr["es._note"]
        en = {"title": ins.title, "canonical_claim": ins.canonical_claim,
              "commentator": ins.audience_variants.commentator, "fan_discover": ins.audience_variants.fan_discover,
              "fan_analyst": ins.audience_variants.fan_analyst, "studio_headline": ins.audience_variants.studio.headline,
              "studio_subtitle": ins.audience_variants.studio.subtitle}
        es = {f: tr.get(f"es.{f}", "") for f in FIELDS}
        issues = check_translation(en, es, world)
        for f in FIELDS:
            if f"es.{f}" in tr:
                assert issues[f] == [], (path.name, f, issues[f])
    assert found >= 3


def test_recorded_translations_win_over_stale_runtime_cache(tmp_path) -> None:  # type: ignore[no-untyped-def]
    """Regression: an older runtime-cache copy must not shadow the curated recording."""
    import shutil

    from byline.api.sessions import ReplaySession
    from byline.config import Settings
    from byline.stories.service import InsightService

    stale = json.loads(next(RECORDED_DIR.glob("*.json")).read_text(encoding="utf-8"))
    for path in RECORDED_DIR.glob("*.json"):
        data = json.loads(path.read_text(encoding="utf-8"))
        data["insight"]["audience_variants"]["translations"] = {}
        (tmp_path / path.name).write_text(json.dumps(data), encoding="utf-8")
    _ = stale, shutil
    svc = InsightService(Settings(byline_ai_provider="foundry", byline_ai_cache_only=True,
                                  foundry_deployment="gpt-4.1-mini"), lambda: [], lambda: None, cache_dir=tmp_path)
    pkg = load_package("golden_story")
    s = ReplaySession("t", pkg, on_candidate=svc.submit)
    s.seek(pkg.events[-1].elapsed_ms)
    tr = svc.records["P-D1-NBA-0760"].insight.audience_variants.translations  # type: ignore[union-attr]
    assert "es.canonical_claim" in tr
