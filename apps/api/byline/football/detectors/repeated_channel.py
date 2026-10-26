"""D1: repeated attacks through the same channel.

Works only from pass/carry events: an *entry* is a completed pass or carry that starts
outside and ends inside the attacking final third (normalised to the team's attacking
direction for the current period). Passes later ruled offside are not entries.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

from byline.events.models import MatchEvent
from byline.football.detectors.base import PatternCandidate
from byline.football.geometry import FINAL_THIRD_AX, Channel, channel_of, in_penalty_area, to_attacking
from byline.match_state.reducer import MatchState


@dataclass(frozen=True)
class D1Config:
    window_ms: int = 10 * 60_000
    min_entries: int = 5
    min_possessions: int = 3
    min_share: float = 0.6
    min_dangerous: int = 1
    baseline_min_entries: int = 6
    baseline_margin: float = 0.2
    require_baseline: bool = True
    max_tail_probability: float = 0.005
    cooldown_ms: int = 15 * 60_000


@dataclass
class Entry:
    event_id: str
    seq: int
    elapsed_ms: int
    team_id: str
    possession_id: int
    channel: Channel
    end_ax: float
    end_ay: float
    into_box: bool
    shot_event_ids: list[str] = field(default_factory=list)

    @property
    def dangerous(self) -> bool:
        return self.into_box or bool(self.shot_event_ids)


CHANNEL_WORD = {"left": "left", "centre": "central", "right": "right"}


@dataclass(frozen=True)
class ChannelMeasure:
    team_id: str
    channel: str
    at_ms: int
    window: list[Entry]
    ch: list[Entry]
    possessions: set[int]
    dangerous: list[Entry]
    share: float
    base_share: float | None
    tail: float
    gates: dict[str, bool]

    @property
    def passes(self) -> bool:
        return all(self.gates.values())

    @property
    def passes_except_danger(self) -> bool:
        return all(ok for gate, ok in self.gates.items() if gate != "danger")


def binomial_tail(k: int, n: int, p: float) -> float:
    """P(X >= k) for X ~ Binomial(n, p)."""
    return sum(math.comb(n, i) * p**i * (1 - p) ** (n - i) for i in range(k, n + 1))


class RepeatedChannelDetector:
    pattern_type = "repeated_channel_attack"

    def __init__(self, config: D1Config | None = None) -> None:
        self.cfg = config or D1Config()
        self.entries: list[Entry] = []
        self.last_fired: dict[tuple[str, str], int] = {}

    def observe(self, ev: MatchEvent, state: MatchState) -> list[PatternCandidate]:
        if ev.type == "offside.offence_confirmed":
            ruled = ev.payload["decision_event_id"]
            self.entries = [e for e in self.entries if e.event_id != ruled]
            return []
        if ev.type == "shot" and ev.team_id:
            for e in self.entries:
                if e.team_id == ev.team_id and e.possession_id == state.possession_id:
                    e.shot_event_ids.append(ev.event_id)
            return self._evaluate(ev, state, ev.team_id)
        if ev.type not in ("pass.completed", "carry") or not ev.team_id:
            return []
        direction = state.attacking_direction.get(ev.team_id)
        if direction is None:
            return []
        s, e = ev.payload["start"], ev.payload["end"]
        sax, _ = to_attacking(direction, s["x_m"], s["y_m"])
        eax, eay = to_attacking(direction, e["x_m"], e["y_m"])
        if not (sax < FINAL_THIRD_AX <= eax):
            return []
        self.entries.append(Entry(ev.event_id, ev.seq, ev.elapsed_ms, ev.team_id, state.possession_id,
                                  channel_of(eay), round(eax, 1), round(eay, 1), in_penalty_area(eax, eay)))
        return self._evaluate(ev, state, ev.team_id)

    def measure(self, team: str, channel: str, now: int) -> ChannelMeasure:
        """The same measurements and gates the detector publishes on, for any (team, channel) at any time."""
        cfg = self.cfg
        lo = now - cfg.window_ms
        window = [e for e in self.entries if e.team_id == team and lo <= e.elapsed_ms <= now]
        baseline = [e for e in self.entries if e.team_id == team and e.elapsed_ms < lo]
        ch = [e for e in window if e.channel == channel]
        possessions = {e.possession_id for e in ch}
        share = len(ch) / len(window) if window else 0.0
        dangerous = [e for e in ch if e.dangerous]
        base_share: float | None = None
        baseline_ok = not (cfg.require_baseline and len(baseline) < cfg.baseline_min_entries)
        if len(baseline) >= cfg.baseline_min_entries:
            base_share = sum(1 for e in baseline if e.channel == channel) / len(baseline)
            baseline_ok = baseline_ok and share >= base_share + cfg.baseline_margin
        # How unusual is this concentration against the team's own earlier spread? (editorial gate)
        k_base = sum(1 for e in baseline if e.channel == channel)
        p0 = max(1.0 / 3.0, (k_base + 1) / (len(baseline) + 3))
        tail = binomial_tail(len(ch), len(window), p0) if window else 1.0
        gates = {
            "volume": len(ch) >= cfg.min_entries,
            "possessions": len(possessions) >= cfg.min_possessions,
            "share": share >= cfg.min_share,
            "danger": len(dangerous) >= cfg.min_dangerous,
            "baseline": baseline_ok,
            "unusual": tail <= cfg.max_tail_probability,
        }
        return ChannelMeasure(team, channel, now, window, ch, possessions, dangerous, share, base_share, tail, gates)

    def _evaluate(self, ev: MatchEvent, state: MatchState, team: str) -> list[PatternCandidate]:
        cfg = self.cfg
        now = ev.elapsed_ms
        out: list[PatternCandidate] = []
        for channel in ("left", "centre", "right"):
            m = self.measure(team, channel, now)
            if not m.passes:
                continue
            key = (team, channel)
            last = self.last_fired.get(key)
            if last is not None and now - last < cfg.cooldown_ms:
                continue
            self.last_fired[key] = now
            out.append(self._candidate(ev, state, team, channel, m.window, m.ch, m.possessions, m.dangerous,
                                       m.share, m.base_share, m.tail))
        return out

    def _candidate(self, ev: MatchEvent, state: MatchState, team: str, channel: str, window: list[Entry],
                   ch: list[Entry], possessions: set[int], dangerous: list[Entry], share: float,
                   base_share: float | None, tail: float) -> PatternCandidate:
        team_name = state.world.team(team).name
        minutes = self.cfg.window_ms // 60_000
        word = CHANNEL_WORD[channel]
        shots = sorted({sid for e in ch for sid in e.shot_event_ids})
        evidence = [e.event_id for e in ch] + shots
        metrics: dict[str, float | int | str | bool] = {
            "window_minutes": minutes,
            "channel": channel,
            "channel_entries": len(ch),
            "total_entries": len(window),
            "channel_share": round(share, 3),
            "distinct_possessions": len(possessions),
            "dangerous_entries": len(dangerous),
            "shots_following": len(shots),
            "baseline_channel_share": round(base_share, 3) if base_share is not None else "n/a",
            "attacking_direction": state.attacking_direction[team],
            "concentration_tail_vs_baseline": round(tail, 5),
        }
        components = {
            "volume": min(1.0, len(ch) / 8.0),
            "concentration": round(share, 3),
            "danger": min(1.0, len(dangerous) / 3.0),
            "novelty_vs_baseline": round(share - base_share, 3) if base_share is not None else 0.5,
        }
        score = round(0.3 * components["volume"] + 0.3 * components["concentration"] + 0.25 * components["danger"]
                      + 0.15 * max(0.0, components["novelty_vs_baseline"]), 3)
        summary = (f"{team_name}: {len(ch)} of their last {len(window)} final-third entries came through the "
                   f"{word} channel ({share:.0%}) in the last {minutes} minutes, across {len(possessions)} separate "
                   f"possessions; {len(dangerous)} reached the box or produced a shot.")
        return PatternCandidate(
            candidate_id=f"P-D1-{team}-{ev.seq:04d}",
            match_id=state.match_id,
            pattern_type="repeated_channel_attack",
            team_id=team,
            detected_at_seq=ev.seq,
            detected_at_ms=ev.elapsed_ms,
            display_clock=ev.display_clock or state.minute(),
            window_start_ms=min(e.elapsed_ms for e in window),
            window_end_ms=ev.elapsed_ms,
            evidence_event_ids=tuple(evidence),
            calculated_metrics=metrics,
            score_components=components,
            score=score,
            confidence_band="supported" if len(dangerous) >= 2 and len(possessions) >= 3 else "tentative",
            novelty_key=f"repeated_channel_attack:{team}:{channel}",
            factual_summary=summary,
            allowed_claims=(
                f"{team_name} are repeatedly progressing through the {word} channel.",
                "Counts of final-third entries, possessions and resulting shots in the window.",
            ),
            unsupported_claims=(
                "Any statement about defenders being dragged, pulled or caught out of position (no tracking used).",
                "Any statement about the manager's instructions or tactical intent.",
                "Any prediction that a goal will follow.",
            ),
            explanation_constraints=(
                "Channel is relative to the team's attacking direction this half.",
                f"Thresholds: >= {self.cfg.min_entries} entries, >= {self.cfg.min_possessions} possessions, "
                f"share >= {self.cfg.min_share:.0%}, >= {self.cfg.min_dangerous} dangerous entry, and the "
                f"concentration must be unusual against the team's own earlier spread "
                f"(binomial tail <= {self.cfg.max_tail_probability}).",
                "Score is an editorial priority, not a probability.",
            ),
        )
