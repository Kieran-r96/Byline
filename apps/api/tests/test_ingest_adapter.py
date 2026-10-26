"""R5: the provider boundary is real — the pipeline runs end to end through the adapter interface."""

from __future__ import annotations

import pytest

from byline.football.intelligence import MatchIntelligence
from byline.ingest.adapter import IdRegistry, MatchDataAdapter, ProviderRef, SyntheticReplayAdapter


def test_pipeline_consumes_the_adapter_only() -> None:
    adapter: MatchDataAdapter = SyntheticReplayAdapter("golden_story")
    mi = MatchIntelligence(adapter.world(), tracking={"entities": adapter.pkg.tracking["entities"],  # type: ignore[attr-defined]
                                                      "frames": adapter.tracking(0, 10**9)})
    for ev in adapter.events():
        mi.ingest(ev)
    assert mi.state.finished and mi.state.score == {"NBA": 2, "RVC": 1}
    assert {c.pattern_type for c in mi.candidates} == {"repeated_channel_attack", "counterattack", "overlap"}


def test_id_registry_is_stable_and_rejects_conflicts() -> None:
    reg = IdRegistry()
    reg.register(ProviderRef("NBA-09", "vendorX", "p-19283"))
    reg.register(ProviderRef("NBA-09", "vendorX", "p-19283"))  # idempotent
    assert reg.internal("vendorX", "p-19283") == "NBA-09"
    with pytest.raises(ValueError):
        reg.register(ProviderRef("NBA-10", "vendorX", "p-19283"))
