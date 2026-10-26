"""Provider boundary: everything downstream consumes these internal contracts, never a vendor format.

Only `SyntheticReplayAdapter` is implemented. A commercial adapter would implement the same protocol
by translating a licensed feed into MatchEvent / tracking frames (see docs/data-contracts.md); no
commercial integration exists in this prototype.
"""

from __future__ import annotations

from collections.abc import Iterator
from dataclasses import dataclass, field
from typing import Any, Protocol

from byline.events.models import MatchEvent
from byline.storage.fixtures import MatchPackage, load_package
from byline.world.models import World


@dataclass(frozen=True)
class ProviderRef:
    """Mapping from an internal id to a provider's id (kept for audit, re-ingestion and corrections)."""

    internal_id: str
    provider: str
    provider_id: str


@dataclass
class IdRegistry:
    refs: dict[tuple[str, str], str] = field(default_factory=dict)  # (provider, provider_id) -> internal id

    def register(self, ref: ProviderRef) -> None:
        existing = self.refs.get((ref.provider, ref.provider_id))
        if existing is not None and existing != ref.internal_id:
            raise ValueError(f"{ref.provider}:{ref.provider_id} already mapped to {existing}")
        self.refs[(ref.provider, ref.provider_id)] = ref.internal_id

    def internal(self, provider: str, provider_id: str) -> str:
        return self.refs[(provider, provider_id)]


class MatchDataAdapter(Protocol):
    """What BYLINE needs from any source (synthetic now; licensed feeds later)."""

    provider: str

    def world(self) -> World: ...  # fixture, squads, officials, ruleset

    def events(self) -> Iterator[MatchEvent]: ...  # ordered, immutable; corrections are new events

    def tracking(self, from_ms: int, to_ms: int) -> list[list[Any]]: ...  # frames in the internal layout


class SyntheticReplayAdapter:
    """The only implemented adapter: BYLINE's seeded synthetic matches."""

    provider = "byline-synthetic"

    def __init__(self, scenario_id: str) -> None:
        self.pkg: MatchPackage = load_package(scenario_id)

    def world(self) -> World:
        return self.pkg.world

    def events(self) -> Iterator[MatchEvent]:
        yield from self.pkg.events

    def tracking(self, from_ms: int, to_ms: int) -> list[list[Any]]:
        return [f for f in self.pkg.tracking["frames"] if from_ms <= f[0] <= to_ms]
