"""Why That Decision? — law-grounded explanations of OFFICIAL synthetic decisions.

Deterministic. BYLINE explains what the (synthetic) officials decided, citing the pinned
IFAB 2026/27 references; it never decides offences itself and never adjudicates marginal
offside from player-centre tracking.
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict

from byline.events.models import MatchEvent
from byline.football.rules_reference import IFAB_BASE, LAWS, RULESET_VERSION, VAR_PROTOCOL
from byline.match_state.reducer import MatchState

DISCLAIMER = "BYLINE explains official decisions; it does not officiate matches."
CENTRE_CAVEAT = ("Positions are synthetic player-centre coordinates, which cannot show the body parts that decide "
                 "a marginal offside. The official decision in the data is authoritative.")

DecisionKind = Literal[
    "DIRECT FREE KICK", "INDIRECT FREE KICK", "PENALTY", "YELLOW CARD", "SECOND YELLOW", "RED CARD", "OFFSIDE",
    "OFFSIDE POSITION · NO OFFENCE", "VAR CHECK", "GOAL DISALLOWED", "GOAL CONFIRMED", "ADVANTAGE",
    "PENALTY RETAKE", "GOAL KICK", "DROPPED BALL",
]


class RuleCitation(BaseModel):
    model_config = ConfigDict(frozen=True)
    law: str
    title: str
    url: str
    point: str


class DecisionCard(BaseModel):
    model_config = ConfigDict(frozen=True)
    decision_id: str
    match_id: str
    kind: DecisionKind
    clock: str
    team_id: str | None
    player_id: str | None
    headline: str
    decision: str
    reason: str
    what_happened: str
    which_rule: list[RuleCitation]
    what_changes: str
    caveats: list[str]
    provisional: bool
    source_event_ids: list[str]
    ruleset_version: str = RULESET_VERSION
    disclaimer: str = DISCLAIMER
    explanation_kind: Literal["law_grounded"] = "law_grounded"
    importance: Literal["major", "minor"] = "major"


def cite(law: int, contains: str) -> RuleCitation:
    entry = LAWS[law]
    point = next(p for p in entry["points"] if contains.lower() in p.lower())
    return RuleCitation(law=f"Law {law}", title=entry["title"], url=entry["url"], point=point)


def cite_var(contains: str) -> RuleCitation:
    point = next(p for p in VAR_PROTOCOL["points"] if contains.lower() in p.lower())
    return RuleCitation(law="VAR protocol", title=VAR_PROTOCOL["title"], url=VAR_PROTOCOL["url"], point=point)


FOUL_WORDS = {
    "trip": "tripped", "kick": "kicked", "push": "pushed", "charge": "charged", "jump_at": "jumped at",
    "strike": "struck", "tackle": "tackled", "hold": "held", "handball": "handled the ball against",
    "impeding": "impeded", "dangerous_play": "played dangerously near", "goalkeeper_possession": "challenged",
}
CARD_REASON = {
    "reckless_foul": "a reckless challenge", "stopping_promising_attack": "stopping a promising attack",
    "dogso_attempt_to_play_ball": "denying an obvious goal-scoring opportunity while attempting to play the ball",
    "dogso": "denying an obvious goal-scoring opportunity", "serious_foul_play": "serious foul play (excessive force)",
    "violent_conduct": "violent conduct", "second_caution": "a second caution", "unsporting_behaviour":
    "unsporting behaviour", "dissent": "dissent", "delaying_restart": "delaying the restart",
}


class DecisionExplainer:
    """Observes the official event stream and emits decision cards at natural decision points."""

    def __init__(self) -> None:
        self.events: dict[str, MatchEvent] = {}
        self.cards: list[DecisionCard] = []
        self.explained_fouls: set[str] = set()

    def observe(self, ev: MatchEvent, state: MatchState) -> list[DecisionCard]:
        self.events[ev.event_id] = ev
        handler = getattr(self, "_on_" + ev.type.replace(".", "_"), None)
        out: list[DecisionCard] = handler(ev, state) if handler else []
        self.cards.extend(out)
        return out

    # ------------------------------------------------------------- helpers

    def _name(self, state: MatchState, pid: str | None) -> str:
        if pid is None:
            return "a player"
        p = state.world.player(pid)
        return f"#{p.shirt_number} {p.display_name} ({state.world.team(p.team_id).short_name})"

    def _team(self, state: MatchState, tid: str | None) -> str:
        return state.world.team(tid).short_name if tid else "the team"

    def _card_for(self, foul_id: str) -> MatchEvent | None:
        return next((e for e in self.events.values()
                     if e.type in ("card.yellow", "card.second_yellow", "card.red")
                     and e.payload.get("foul_event_id") == foul_id), None)

    def _card(self, kind: DecisionKind, ev: MatchEvent, state: MatchState, **kw: Any) -> DecisionCard:
        return DecisionCard(decision_id=f"D-{ev.event_id}", match_id=state.match_id, kind=kind,
                            clock=ev.display_clock or state.minute(), **kw)

    # ------------------------------------------------------------- fouls + restarts

    def _on_restart_awarded(self, ev: MatchEvent, state: MatchState) -> list[DecisionCard]:
        p = ev.payload
        reason = self.events.get(p.get("reason_event_id") or "")
        rt = p["restart_type"]
        if reason is not None and reason.type == "foul.committed" and reason.event_id not in self.explained_fouls:
            self.explained_fouls.add(reason.event_id)
            return [self._foul_card(reason, ev, state)]
        if reason is not None and reason.type == "offside.offence_confirmed":
            voided = next((e for e in self.events.values() if e.type == "goal.disallowed"
                           and e.payload["goal_event_id"] == reason.correlation_id), None)
            if voided is not None:
                return [self._disallowed_card(voided, state, offside=reason, award=ev)]
            return [self._offside_card(reason, ev, state)]
        if rt == "goal_kick" and reason is not None and reason.type == "shot" and \
                reason.payload.get("situation") == "free_kick" and reason.payload.get("outcome") == "entered_goal":
            return [self._card("GOAL KICK", ev, state, team_id=p["awarded_to_team_id"], player_id=None,
                               headline="No goal from an indirect free kick",
                               decision="Goal kick", reason="Indirect free kick entered the goal without another touch",
                               what_happened=f"The indirect free kick by {self._name(state, reason.player_id)} went "
                                             f"straight into the goal ({reason.event_id}).",
                               which_rule=[cite(13, "indirect free kick, a goal is only valid")],
                               what_changes=f"Goal kick to {self._team(state, p['awarded_to_team_id'])}; score unchanged.",
                               caveats=[], provisional=False, source_event_ids=[reason.event_id, ev.event_id])]
        if reason is not None and reason.type == "penalty.outcome" and                 reason.payload.get("touch") == "accidental_double_touch" and rt == "indirect_free_kick":
            return [self._card("INDIRECT FREE KICK", ev, state, team_id=p["awarded_to_team_id"], player_id=None,
                               headline="Penalty double touch: indirect free kick",
                               decision="Indirect free kick", reason="Kicker touched the ball twice and it did not go in",
                               what_happened=f"The penalty taker {self._name(state, reason.player_id)} accidentally "
                                             f"touched the ball twice and it did not enter the goal ({reason.event_id}).",
                               which_rule=[cite(14, "accidentally touches")],
                               what_changes=f"Indirect free kick to {self._team(state, p['awarded_to_team_id'])}.",
                               caveats=[], provisional=False, source_event_ids=[reason.event_id, ev.event_id])]
        if rt == "dropped_ball":
            return [self._card("DROPPED BALL", ev, state, team_id=p["awarded_to_team_id"], player_id=None,
                               headline="Play restarts with a dropped ball", decision="Dropped ball",
                               reason="Play was stopped for an injury with no offence",
                               what_happened="The referee stopped play for an injury; no offence had occurred.",
                               which_rule=[cite(8, "dropped ball")],
                               what_changes=f"Ball dropped for {self._team(state, p['awarded_to_team_id'])}.",
                               caveats=[], provisional=False, source_event_ids=[ev.event_id], importance="minor")]
        return []

    def _foul_card(self, foul: MatchEvent, award: MatchEvent | None, state: MatchState) -> DecisionCard:
        p = foul.payload
        card_ev = self._card_for(foul.event_id)
        restart = p["restart_type"]
        victim = self._name(state, p.get("victim_player_id"))
        offender = self._name(state, foul.player_id)
        verb = FOUL_WORDS.get(p["foul_type"], "fouled")
        severity = p.get("severity")
        rules = []
        kind: DecisionKind = {"direct_free_kick": "DIRECT FREE KICK", "indirect_free_kick": "INDIRECT FREE KICK",
                              "penalty": "PENALTY"}[restart]  # type: ignore[assignment]
        if restart == "penalty":
            rules.append(cite(14, "awarded when a player commits a direct-free-kick offence inside"))
        elif restart == "direct_free_kick":
            rules.append(cite(12, "direct free kick is awarded"))
        else:
            rules.append(cite(12, "indirect free kick is awarded"))
        sanction = "No card."
        if severity == "careless" and card_ev is None:
            rules.append(cite(12, "Careless:"))
        if card_ev is not None:
            colour = card_ev.type
            why = CARD_REASON.get(str(card_ev.payload.get("reason")), str(card_ev.payload.get("reason")))
            if colour == "card.yellow":
                sanction = f"Yellow card for {why}."
                kind = kind if restart == "penalty" else "YELLOW CARD"
            elif colour == "card.second_yellow":
                sanction = "Second yellow card: sent off."
                kind = "SECOND YELLOW"
                rules.append(cite(12, "second caution"))
            else:
                sanction = f"Red card for {why}."
                kind = "RED CARD" if restart != "penalty" else "PENALTY"
            if card_ev.payload.get("reason") == "reckless_foul":
                rules.append(cite(12, "Reckless:"))
            if card_ev.payload.get("reason") == "serious_foul_play":
                rules.append(cite(12, "far exceeds"))
            if p.get("denied_goal_scoring_opportunity"):
                rules.append(cite(12, "DOGSO"))
        where = "inside their own penalty area" if p["in_offender_penalty_area"] else "outside the penalty area"
        what_changes = {
            "penalty": f"Penalty kick to {self._team(state, award.payload['awarded_to_team_id'] if award else None)}.",
            "direct_free_kick": "Direct free kick: a goal can be scored directly from it.",
            "indirect_free_kick": "Indirect free kick: another player must touch the ball before a goal can count.",
        }[restart]
        if card_ev is not None and card_ev.type in ("card.second_yellow", "card.red") and card_ev.team_id:
            left = len(state.sheets[card_ev.team_id].on_pitch)
            what_changes += f" {self._team(state, card_ev.team_id)} continue with {left} players."
        caveats = []
        if p.get("denied_goal_scoring_opportunity") and restart == "penalty":
            caveats.append("In the penalty area a DOGSO offence that was an attempt to play the ball is a caution; "
                           "holding, pulling, pushing or no attempt to play the ball remains a sending-off.")
        noun = {"hold": "holding", "push": "push", "dangerous_play": "dangerous play", "handball": "handball"}.get(p['foul_type'], p['foul_type'].replace('_', ' '))
        reason_txt = (f"{severity.replace('_', ' ')} {noun}" if severity else noun).capitalize() + f" {where}"
        return self._card(kind, foul, state, team_id=foul.team_id, player_id=foul.player_id,
                          headline=f"{offender} {verb} {victim}",
                          decision={"direct_free_kick": "Direct free kick", "indirect_free_kick": "Indirect free kick",
                                    "penalty": "Penalty"}[restart] + f" · {sanction}",
                          reason=reason_txt,
                          what_happened=f"{offender} {verb} {victim} {where} ({foul.event_id}).",
                          which_rule=rules, what_changes=what_changes, caveats=caveats, provisional=False,
                          source_event_ids=[foul.event_id, *([card_ev.event_id] if card_ev else []),
                                            *([award.event_id] if award else [])],
                          importance="major" if card_ev or restart == "penalty" else "minor")

    def _on_card_yellow(self, ev: MatchEvent, state: MatchState) -> list[DecisionCard]:
        foul_id = ev.payload.get("foul_event_id")
        foul = self.events.get(foul_id or "")
        if foul is not None and foul.payload.get("advantage_played"):
            # caution issued at the next stoppage after advantage
            return [self._card("YELLOW CARD", ev, state, team_id=ev.team_id, player_id=ev.player_id,
                               headline=f"Delayed caution for {self._name(state, ev.player_id)}",
                               decision="Yellow card at the stoppage",
                               reason=f"{CARD_REASON.get(str(ev.payload['reason']), 'misconduct').capitalize()} "
                                      f"when advantage was played ({foul.display_clock})",
                               what_happened=f"The referee played advantage after the foul ({foul.event_id}) and "
                                             f"issued the caution when the ball next went dead ({ev.event_id}).",
                               which_rule=[cite(12, "advantage is played"), cite(12, "Reckless:")],
                               what_changes="No free kick for the original foul: play restarts for the reason it "
                                            "stopped.",
                               caveats=[], provisional=False, source_event_ids=[foul.event_id, ev.event_id])]
        return []

    def _on_advantage_applied(self, ev: MatchEvent, state: MatchState) -> list[DecisionCard]:
        foul = self.events.get(ev.payload["foul_event_id"])
        if foul is None:
            return []
        self.explained_fouls.add(foul.event_id)
        return [self._card("ADVANTAGE", ev, state, team_id=ev.team_id, player_id=None,
                           headline=f"Advantage to {self._team(state, ev.team_id)}",
                           decision="Play on (advantage)",
                           reason=f"{self._name(state, foul.player_id)} fouled "
                                  f"{self._name(state, foul.payload.get('victim_player_id'))}, but stopping play would "
                                  f"have helped the offending team",
                           what_happened=f"Foul {foul.event_id}; the referee signalled advantage ({ev.event_id}).",
                           which_rule=[cite(12, "advantage is played")],
                           what_changes="Play continues. A card can still be shown at the next stoppage.",
                           caveats=[], provisional=False, source_event_ids=[foul.event_id, ev.event_id],
                           importance="minor")]

    # ------------------------------------------------------------- offside

    def _offside_card(self, off: MatchEvent, award: MatchEvent | None, state: MatchState) -> DecisionCard:
        interference = str(off.payload["interference_type"]).replace("_", " ")
        caveats = [CENTRE_CAVEAT]
        return self._card("OFFSIDE", off, state, team_id=off.team_id, player_id=off.player_id,
                          headline=f"Offside: {self._name(state, off.player_id)}",
                          decision="Indirect free kick",
                          reason=f"Active involvement ({interference}) from an offside position",
                          what_happened=f"{self._name(state, off.player_id)} was in an offside position when the "
                                        f"ball was played ({off.payload['decision_event_id']}) and became involved "
                                        f"in active play.",
                          which_rule=[cite(11, "only penalised"), cite(11, "indirect free kick")],
                          what_changes=f"Indirect free kick to "
                                       f"{self._team(state, state.world.opponent_of(off.team_id or ''))} where the "
                                       f"offence occurred.",
                          caveats=caveats, provisional=False,
                          source_event_ids=[off.payload["decision_event_id"], off.event_id,
                                            *([award.event_id] if award else [])])

    def _on_offside_position_detected(self, ev: MatchEvent, state: MatchState) -> list[DecisionCard]:
        kind_of_pass = self.events.get(ev.payload["pass_event_id"])
        from_restart = kind_of_pass.payload.get("pass_kind") if kind_of_pass else None
        if ev.payload.get("involved") and from_restart not in ("throw_in", "goal_kick", "corner"):
            return []
        rules = [cite(11, "not an offence in itself")]
        reason = "Not involved in active play"
        if from_restart in ("throw_in", "goal_kick", "corner"):
            rules.append(cite(11, "directly from a goal kick, throw-in or corner"))
            reason = f"Received directly from a {from_restart.replace('_', '-')}"
        return [self._card("OFFSIDE POSITION · NO OFFENCE", ev, state, team_id=ev.team_id, player_id=ev.player_id,
                           headline=f"No offside: {self._name(state, ev.player_id)}",
                           decision="Play continues", reason=reason,
                           what_happened=f"{self._name(state, ev.player_id)} stood in an offside position when the "
                                         f"ball was played ({ev.payload['pass_event_id']}).",
                           which_rule=rules, what_changes="No restart: being in an offside position alone is not "
                                                          "an offence.",
                           caveats=[CENTRE_CAVEAT], provisional=False,
                           source_event_ids=[ev.payload["pass_event_id"], ev.event_id], importance="minor")]

    # ------------------------------------------------------------- VAR + goals

    def _on_var_review_started(self, ev: MatchEvent, state: MatchState) -> list[DecisionCard]:
        subject = self.events.get(ev.payload["subject_event_id"])
        return [self._card("VAR CHECK", ev, state, team_id=subject.team_id if subject else None,
                           player_id=subject.player_id if subject else None,
                           headline=f"VAR checking the {ev.payload['check_type'].replace('_', ' ')}",
                           decision="Decision pending", reason=str(ev.payload["reason"]),
                           what_happened=f"The VAR is reviewing {ev.payload['subject_event_id']}.",
                           which_rule=[cite_var("four situations"), cite_var("final decision")],
                           what_changes="Nothing is settled until the review ends. The goal is provisional.",
                           caveats=["A VAR check is not itself a ruling."], provisional=True,
                           source_event_ids=[ev.payload["subject_event_id"], ev.event_id])]

    def _on_goal_disallowed(self, ev: MatchEvent, state: MatchState) -> list[DecisionCard]:
        if ev.payload["reason"] == "offside":
            return []  # explained together with the offside offence when the restart is awarded
        return [self._disallowed_card(ev, state)]

    def _disallowed_card(self, ev: MatchEvent, state: MatchState, offside: MatchEvent | None = None,
                         award: MatchEvent | None = None) -> DecisionCard:
        reason = str(ev.payload["reason"])
        rules = [cite_var("Factual decisions")] if ev.payload.get("decision_route") == "after_var_check" else []
        caveats: list[str] = []
        kind: DecisionKind = "GOAL DISALLOWED"
        if reason == "offside":
            rules.insert(0, cite(11, "only penalised"))
            caveats.append(CENTRE_CAVEAT)
        if ev.payload["law_ref"] == "Law 14":
            kind = "PENALTY RETAKE"
            rules = [cite(14, "accidentally touches")]
        score = state.score
        happened = (f"The goal {ev.payload['goal_event_id']} was ruled out "
                    f"({ev.payload['decision_route'].replace('_', ' ')}).")
        if offside is not None:
            happened += (f" {self._name(state, offside.player_id)} was in an offside position when the ball was played "
                         f"({offside.payload['decision_event_id']}) and was involved in active play.")
        sources = [ev.payload["goal_event_id"], ev.event_id, *([offside.event_id] if offside else []),
                   *([award.event_id] if award else [])]
        changes = (f"Score stays {score[state.home]}–{score[state.away]}. "
                   + (f"Indirect free kick to {self._team(state, award.payload['awarded_to_team_id'])}. "
                      if award else "") + "Stories built on this attack are withdrawn.")
        return self._card(kind, ev, state, team_id=ev.team_id, player_id=ev.player_id,
                           headline="Penalty to be retaken" if kind == "PENALTY RETAKE" else
                           f"Goal disallowed: {reason.replace('_', ' ')}",
                           decision="Retake" if kind == "PENALTY RETAKE" else "No goal",
                           reason="Accidental double touch by the kicker; the ball went in" if kind == "PENALTY RETAKE" else reason.replace("_", " ").capitalize(),
                           what_happened=happened, which_rule=rules, what_changes=changes,
                           caveats=caveats, provisional=False, source_event_ids=sources)

    def _on_goal_confirmed(self, ev: MatchEvent, state: MatchState) -> list[DecisionCard]:
        if ev.payload.get("decision_route") != "after_var_check":
            return []
        return [self._card("GOAL CONFIRMED", ev, state, team_id=ev.team_id, player_id=ev.player_id,
                           headline="Goal stands after VAR check", decision="Goal", reason="No clear and obvious error",
                           what_happened=f"The VAR check on {ev.payload['goal_event_id']} found no clear error.",
                           which_rule=[cite_var("clear and obvious")], what_changes="The goal counts.",
                           caveats=[], provisional=False, source_event_ids=[ev.payload["goal_event_id"], ev.event_id])]

    def _on_penalty_outcome(self, ev: MatchEvent, state: MatchState) -> list[DecisionCard]:
        if ev.payload["outcome"] == "retake":
            return []  # explained by the goal.disallowed (Law 14) card
        return []


def law_index() -> dict[str, str]:
    return {f"Law {n}": entry["url"] for n, entry in LAWS.items()} | {"base": IFAB_BASE}
