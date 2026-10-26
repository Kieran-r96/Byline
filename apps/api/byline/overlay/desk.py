"""Studio graphics desk (demo sandbox only — never connected to a real broadcast).

Proposed packets come from verified insights, major official decisions and goals. Nothing goes
on air without explicit approval. Packets expire, can be rejected or hidden, and are retracted
when the official record changes (e.g. VAR disallows a goal that a proposed graphic celebrated).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict

from byline.events.models import MatchEvent
from byline.football.decisions import DecisionCard
from byline.stories.models import Insight
from byline.world.models import World

OverlayStatus = Literal["proposed", "approved", "on_screen", "expired", "rejected", "hidden", "retracted"]
Template = Literal["goal_story", "channel_pressure", "transition_breakdown", "player_milestone", "referee_decision",
                   "full_time_recap", "tactical_moment", "substitution", "player_record", "stat_comparison"]
Cue = Literal["now", "next_stoppage", "delay"]
# a scheduled graphic airs at the next stoppage: a restart, a goal, a card, a substitution or a whistle
STOPPAGE_TYPES = frozenset({"restart.awarded", "goal.confirmed", "card.yellow", "card.second_yellow", "card.red",
                            "substitution", "period.ended", "var.review_outcome"})
STAT_ROWS = (("shots", "Shots"), ("shots_on_target", "On target"), ("corners", "Corners"), ("fouls", "Fouls"),
             ("offsides", "Offsides"), ("passes_completed", "Passes completed"))
PROPOSAL_TTL_MS = 3 * 60_000
ON_AIR_MS = 60_000  # a timed graphic's default: one match minute (a persistent one stays until taken off)


class OverlayPacket(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str
    match_id: str
    source_kind: Literal["insight", "decision", "goal", "tactical", "substitution", "context", "stats"]
    source_id: str
    version: int = 1
    status: OverlayStatus = "proposed"
    template_id: Template
    match_elapsed_ms: int
    display_from_ms: int | None = None
    display_for_ms: int | None = None  # None = on air until the producer takes it off (or a correction withdraws it)
    expires_at_ms: int
    title: str
    subtitle: str
    team_id: str | None = None
    player_ids: list[str] = []
    source_event_ids: list[str]
    language: str = "en"
    priority: int = 2
    safe_area: Literal["lower_third"] = "lower_third"
    animation_style: Literal["slide_up", "fade"] = "slide_up"
    status_reason: str | None = None
    # a goal graphic is held while VAR checks the goal: it cannot be approved or go on air until confirmed
    on_hold: bool = False
    # when an approved graphic airs: straight away, at the next stoppage, or after a delay
    cue: Cue | None = None
    # who asked for it: the desk's automatic proposal, or a producer from the analysis desk
    origin: Literal["auto", "producer"] = "auto"
    # structured, deterministic content for the graphic's own format (sub board, record plate, stats panel)
    data: dict[str, Any] = {}
    requires_approval: Literal[True] = True
    demo_only: Literal[True] = True


@dataclass
class StudioDesk:
    world: World
    match_id: str
    packets: dict[str, OverlayPacket] = field(default_factory=dict)
    changed: list[OverlayPacket] = field(default_factory=list)

    def _put(self, p: OverlayPacket) -> None:
        self.packets[p.id] = p
        self.changed.append(p)

    def drain(self) -> list[OverlayPacket]:
        out, self.changed = self.changed, []
        return out

    # ---------------------------------------------------------------- proposals

    def offer_insight(self, ins: Insight, now_ms: int) -> None:
        """Proposals are anchored to the detection time; stale stories are not re-proposed after a seek."""
        pid = f"O-{ins.insight_id}"
        if pid in self.packets or ins.status != "verified":
            return
        base = ins.created_at_ms if ins.created_at_ms is not None else now_ms
        if now_ms > base + PROPOSAL_TTL_MS:
            return
        now_ms = base
        st = ins.audience_variants.studio
        template: Template = st.template_id if st.template_id in (  # type: ignore[assignment]
            "channel_pressure", "transition_breakdown") else "channel_pressure"
        self._put(OverlayPacket(
            id=pid, match_id=self.match_id, source_kind="insight", source_id=ins.insight_id, template_id=template,
            match_elapsed_ms=now_ms, expires_at_ms=now_ms + PROPOSAL_TTL_MS, title=st.headline[:55],
            subtitle=st.subtitle[:100], team_id=None, source_event_ids=ins.evidence_event_ids[:8], priority=2))

    def _reofferable(self, pid: str, origin: str) -> int | None:
        """Version for a new proposal, or None when one already stands. A producer may re-request a graphic
        that expired, was rejected or was taken off air; never one withdrawn for a correction."""
        old = self.packets.get(pid)
        if old is None:
            return 1
        if origin == "producer" and old.status in ("expired", "rejected", "hidden"):
            return old.version + 1
        return None

    def offer_tactical(self, moment_id: str, title: str, subtitle: str, team_id: str | None, event_ids: list[str],
                       player_ids: list[str], now_ms: int, origin: Literal["auto", "producer"] = "auto",
                       data: dict[str, Any] | None = None) -> OverlayPacket | None:
        """A measured tactical moment (deterministic geometry) as a proposal; approval is still human."""
        pid = f"O-{moment_id}"
        version = self._reofferable(pid, origin)
        if version is None:
            return None
        short = title if len(title) <= 55 else title[:54].rsplit(" ", 1)[0] + "…"
        p = OverlayPacket(
            id=pid, match_id=self.match_id, source_kind="tactical", source_id=moment_id, template_id="tactical_moment",
            match_elapsed_ms=now_ms, expires_at_ms=now_ms + PROPOSAL_TTL_MS, title=short, subtitle=subtitle[:100],
            team_id=team_id, player_ids=player_ids[:4], source_event_ids=event_ids, priority=2, version=version,
            origin=origin, data=data or {})
        self._put(p)
        return p

    def offer_substitution(self, ev: MatchEvent) -> None:
        """The fourth official's board: who comes on, who goes off (official event)."""
        on, off = str(ev.payload.get("player_on_id", "")), str(ev.payload.get("player_off_id", ""))
        if not (self.world.has_player(on) and self.world.has_player(off)) or f"O-{ev.event_id}" in self.packets:
            return
        pon, poff = self.world.player(on), self.world.player(off)
        team = self.world.home if ev.team_id == self.world.home.team_id else self.world.away
        sub_line = f"On {pon.given_name} {pon.family_name} · off {poff.given_name} {poff.family_name}"
        self._put(OverlayPacket(
            id=f"O-{ev.event_id}", match_id=self.match_id, source_kind="substitution", source_id=ev.event_id,
            template_id="substitution", match_elapsed_ms=ev.elapsed_ms, expires_at_ms=ev.elapsed_ms + PROPOSAL_TTL_MS,
            title=f"SUBSTITUTION · {team.short_name}", subtitle=sub_line[:100],
            team_id=ev.team_id, player_ids=[on, off], source_event_ids=[ev.event_id], priority=1,
            data={"on": {"id": on, "number": pon.shirt_number, "name": f"{pon.given_name} {pon.family_name}"},
                  "off": {"id": off, "number": poff.shirt_number, "name": f"{poff.given_name} {poff.family_name}"},
                  "clock": ev.display_clock}))

    def offer_record(self, signal_id: str, kind: str, headline: str, text: str, team_id: str | None,
                     player_id: str | None, event_ids: list[str], now_ms: int, rule: str | None,
                     origin: Literal["auto", "producer"] = "auto") -> OverlayPacket | None:
        """A record or milestone computed from the fictional history (deterministic, rule attached)."""
        pid = f"O-{signal_id}"
        version = self._reofferable(pid, origin)
        if version is None:
            return None
        # ticker headlines are often a bare category ("RECORD"): the plate's title is then the category in words
        title = headline.capitalize() if headline.isupper() and " " not in headline.strip() else headline
        p = OverlayPacket(
            id=pid, match_id=self.match_id, source_kind="context", source_id=signal_id, template_id="player_record",
            match_elapsed_ms=now_ms, expires_at_ms=now_ms + PROPOSAL_TTL_MS, title=title[:55], subtitle=text[:180],
            team_id=team_id, player_ids=[player_id] if player_id else [], source_event_ids=event_ids[:8], priority=2,
            version=version, origin=origin,
            data={"kind": kind, "text": text, "rule": rule or "", "source": "Fictional history (synthetic, seeded)"})
        self._put(p)
        return p

    def offer_stats(self, label: str, stats: dict[str, dict[str, int]], score: dict[str, int], now_ms: int,
                    origin: Literal["auto", "producer"] = "auto") -> OverlayPacket | None:
        """A stats comparison panel from the official counts at this moment (half-time, full-time, on request)."""
        key = label.lower().replace(" ", "-")
        pid = f"O-stats-{key}" if origin == "auto" else f"O-stats-{key}-{now_ms // 1000}"
        version = self._reofferable(pid, origin)
        if version is None:
            return None
        h, a = self.world.home, self.world.away
        rows = [{"key": k, "label": lab, "home": int(stats.get(h.team_id, {}).get(k, 0)),
                 "away": int(stats.get(a.team_id, {}).get(k, 0))} for k, lab in STAT_ROWS]
        line = f"{h.short_name} {score.get(h.team_id, 0)}–{score.get(a.team_id, 0)} {a.short_name}"
        p = OverlayPacket(
            id=pid, match_id=self.match_id, source_kind="stats", source_id=pid, template_id="stat_comparison",
            match_elapsed_ms=now_ms, expires_at_ms=now_ms + PROPOSAL_TTL_MS, title=f"{label.upper()} · {line}",
            subtitle="Counted from the official match events", team_id=None, source_event_ids=[], priority=1,
            version=version, origin=origin, data={"label": label, "rows": rows})
        self._put(p)
        return p

    def offer_decision(self, card: DecisionCard, now_ms: int) -> None:
        if card.importance != "major" or card.kind == "VAR CHECK":
            return
        pid = f"O-{card.decision_id}"
        if pid in self.packets:
            return
        self._put(OverlayPacket(
            id=pid, match_id=self.match_id, source_kind="decision", source_id=card.decision_id,
            template_id="referee_decision", match_elapsed_ms=now_ms, expires_at_ms=now_ms + PROPOSAL_TTL_MS,
            title=card.kind, subtitle=f"{card.decision} · {card.which_rule[0].law}"[:100], team_id=card.team_id,
            player_ids=[card.player_id] if card.player_id else [], source_event_ids=card.source_event_ids, priority=1))

    def on_event(self, ev: MatchEvent, score: dict[str, int], provisional: dict[str, int]) -> None:
        if ev.type in STOPPAGE_TYPES:
            for q in list(self.packets.values()):
                if q.status == "approved" and q.cue == "next_stoppage" and q.display_from_ms is None:
                    self._put(q.model_copy(update={"display_from_ms": ev.elapsed_ms, "version": q.version + 1,
                                                   "status_reason": f"Aired at the stoppage at {ev.display_clock}."}))
        if ev.type == "substitution":
            self.offer_substitution(ev)
        if ev.type == "goal.provisional" and ev.team_id and ev.player_id:
            p = self.world.player(ev.player_id)
            h, a = self.world.home.team_id, self.world.away.team_id
            line = f"{self.world.home.short_name} {provisional[h]}–{provisional[a]} {self.world.away.short_name}"
            self._put(OverlayPacket(
                id=f"O-{ev.event_id}", match_id=self.match_id, source_kind="goal", source_id=ev.event_id,
                template_id="goal_story", match_elapsed_ms=ev.elapsed_ms, expires_at_ms=ev.elapsed_ms + PROPOSAL_TTL_MS,
                title=f"GOAL · {line}", subtitle=f"{p.given_name} {p.family_name} {ev.display_clock}"[:100],
                team_id=ev.team_id, player_ids=[p.player_id], source_event_ids=[ev.event_id], priority=0))
        elif ev.type == "var.review_started" and ev.payload.get("check_type") == "goal":
            pk = self.packets.get(f"O-{ev.payload['subject_event_id']}")
            if pk is not None and pk.status in ("proposed", "approved", "on_screen"):
                held: dict[str, object] = {"on_hold": True, "version": pk.version + 1,
                        "status_reason": f"VAR check in progress ({ev.display_clock}): on hold until the decision."}
                if pk.status == "on_screen":  # never leave a scoreline on air while it is being checked
                    held.update(status="hidden", status_reason=f"Taken off air: VAR check started at {ev.display_clock}.")
                elif pk.status == "approved":
                    held.update(status="proposed")
                self._put(pk.model_copy(update=held))
        elif ev.type == "goal.confirmed":
            pk = self.packets.get(f"O-{ev.payload['goal_event_id']}")
            if pk is not None and pk.on_hold:
                self._put(pk.model_copy(update={"on_hold": False, "version": pk.version + 1,
                                               "status_reason": f"Goal confirmed at {ev.display_clock}."}))
        elif ev.type == "goal.disallowed":
            pid = f"O-{ev.payload['goal_event_id']}"
            if pid in self.packets:
                self.retract(pid, f"Goal disallowed ({str(ev.payload['reason']).replace('_', ' ')}, "
                                  f"{ev.payload['law_ref']}) at {ev.display_clock}; official event {ev.event_id}.")

    def retract_source(self, source_id: str, reason: str) -> None:
        for p in list(self.packets.values()):
            if p.source_id == source_id:
                self.retract(p.id, reason)

    def retract(self, pid: str, reason: str) -> None:
        p = self.packets[pid]
        if p.status in ("retracted", "rejected"):
            return
        self._put(p.model_copy(update={"status": "retracted", "version": p.version + 1, "status_reason": reason}))

    # ---------------------------------------------------------------- producer actions

    def act(self, pid: str, action: Literal["approve", "reject", "hide"], now_ms: int, cue: Cue = "now",
            delay_ms: int = 0, duration_ms: int | None = None) -> OverlayPacket:
        p = self.packets.get(pid)
        if p is None:
            raise KeyError(pid)
        if action == "approve":
            if p.status != "proposed":
                raise ValueError(f"cannot approve a {p.status} graphic")
            if p.on_hold:
                raise ValueError("on hold while VAR checks the goal")
            start: int | None = now_ms if cue == "now" else now_ms + max(0, delay_ms) if cue == "delay" else None
            note = None if cue == "now" else ("Scheduled for the next stoppage." if cue == "next_stoppage"
                                              else f"Scheduled to air in {max(0, delay_ms) // 1000} s.")
            new = p.model_copy(update={"status": "approved", "display_from_ms": start, "cue": cue,
                                       "expires_at_ms": max(p.expires_at_ms, now_ms + PROPOSAL_TTL_MS),
                                       "display_for_ms": duration_ms,
                                       "status_reason": note, "version": p.version + 1})
        elif action == "reject":
            if p.status not in ("proposed", "approved"):
                raise ValueError(f"cannot reject a {p.status} graphic")
            new = p.model_copy(update={"status": "rejected", "version": p.version + 1})
        else:
            new = p.model_copy(update={"status": "hidden", "version": p.version + 1})
        self._put(new)
        return new

    def advance(self, now_ms: int) -> None:
        for p in list(self.packets.values()):
            if p.status == "approved" and p.display_from_ms is None and now_ms > p.expires_at_ms:
                self._put(p.model_copy(update={"status": "expired", "version": p.version + 1,
                                               "status_reason": "No stoppage before the graphic went stale"}))
            elif p.status == "proposed" and now_ms > p.expires_at_ms:
                self._put(p.model_copy(update={"status": "expired", "version": p.version + 1,
                                               "status_reason": "Not approved in time"}))
            elif p.status == "approved" and p.display_from_ms is not None and now_ms >= p.display_from_ms:
                self._put(p.model_copy(update={"status": "on_screen", "version": p.version + 1}))
            elif p.status == "on_screen" and p.display_from_ms is not None and p.display_for_ms is not None \
                    and now_ms >= p.display_from_ms + p.display_for_ms:
                self._put(p.model_copy(update={"status": "expired", "version": p.version + 1,
                                               "status_reason": "Finished on-air display"}))

    def snapshot(self) -> list[dict[str, Any]]:
        order = {"on_screen": 0, "approved": 1, "proposed": 2, "retracted": 3, "expired": 4, "rejected": 5, "hidden": 6}
        return [p.model_dump(mode="json") for p in sorted(self.packets.values(),
                                                           key=lambda x: (order[x.status], -x.match_elapsed_ms))]
