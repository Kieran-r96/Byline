"""Pinned, paraphrased IFAB Laws of the Game references for 2026/27.

These are short BYLINE summaries written for explanation, not the official text. Each entry
links to the IFAB source. Agents and the decision explainer use only these entries.
"""

from __future__ import annotations

from typing import Any

RULESET_VERSION = "IFAB-2026/27"
IFAB_BASE = "https://theifab.com/laws/latest"

LAWS: dict[int, dict[str, Any]] = {
    8: {
        "title": "Law 8: The Start and Restart of Play",
        "url": f"{IFAB_BASE}/the-start-and-restart-of-play/",
        "points": [
            "A kick-off starts each half and restarts play after a goal; the team that conceded takes it.",
            "Teams change ends for the second half.",
            "A dropped ball restarts play after a stoppage with no offence (e.g. an injury); it is dropped for "
            "the defending goalkeeper inside their penalty area, otherwise for the team that last touched the ball.",
        ],
    },
    11: {
        "title": "Law 11: Offside",
        "url": f"{IFAB_BASE}/offside/",
        "points": [
            "Being in an offside position is not an offence in itself.",
            "A player is in an offside position if any part of the head, body or feet is in the opponents' half "
            "(excluding the halfway line) and nearer the goal line than both the ball and the second-last "
            "opponent. Hands and arms are not considered.",
            "A player level with the second-last opponent, or with the last two opponents, is not offside.",
            "An offside position is only penalised when, at the moment a team-mate plays or touches the ball, the "
            "player becomes involved in active play: interfering with play, interfering with an opponent, or "
            "gaining an advantage.",
            "There is no offside offence when receiving the ball directly from a goal kick, throw-in or corner kick.",
            "A deliberate play by an opponent (other than a deliberate save) generally resets offside; a deflection "
            "or rebound does not.",
            "The restart for an offside offence is an indirect free kick where the offence occurred.",
        ],
    },
    12: {
        "title": "Law 12: Fouls and Misconduct",
        "url": f"{IFAB_BASE}/fouls-and-misconduct/",
        "points": [
            "A direct free kick is awarded for offences such as tripping, kicking, pushing, charging, jumping at, "
            "striking or tackling an opponent carelessly, recklessly or with excessive force, holding, and "
            "deliberate handball.",
            "Careless: a lack of attention or consideration; no disciplinary sanction is needed.",
            "Reckless: disregard of the danger to an opponent; the player must be cautioned (yellow card).",
            "Using excessive force: far exceeds the necessary use of force; the player must be sent off.",
            "A second caution in the same match results in a sending-off.",
            "Denying an obvious goal-scoring opportunity (DOGSO) by an offence is normally a sending-off. When a "
            "penalty is awarded for DOGSO and the offence was an attempt to play the ball or a challenge for the "
            "ball, the sanction is reduced to a caution. Holding, pulling, pushing or no possibility to play the "
            "ball remain a sending-off.",
            "When advantage is played, a caution or sending-off can still be issued at the next stoppage.",
            "An indirect free kick is awarded for offences such as dangerous play without contact and impeding "
            "without contact.",
        ],
    },
    13: {
        "title": "Law 13: Free Kicks",
        "url": f"{IFAB_BASE}/free-kicks/",
        "points": [
            "A goal can be scored directly from a direct free kick against the opponents.",
            "From an indirect free kick, a goal is only valid if the ball touches another player before entering "
            "the goal. If it enters the opponents' goal directly, a goal kick is awarded.",
            "Opponents must be at least 9.15 m from the ball until it is in play.",
        ],
    },
    14: {
        "title": "Law 14: The Penalty Kick",
        "url": f"{IFAB_BASE}/the-penalty-kick/",
        "points": [
            "A penalty kick is awarded when a player commits a direct-free-kick offence inside their own penalty "
            "area while the ball is in play.",
            "The kicker must kick the ball forward and cannot play it again until it has touched another player.",
            "2026/27 clarification: if the kicker accidentally touches the ball twice (for example with the "
            "non-kicking foot) and the ball enters the goal, the kick is retaken; if it does not enter the goal, an "
            "indirect free kick is awarded.",
            "A deliberate second touch by the kicker is penalised with an indirect free kick (a direct free kick if "
            "it is a handball offence).",
        ],
    },
    15: {
        "title": "Law 15: The Throw-in",
        "url": f"{IFAB_BASE}/the-throw-in/",
        "points": [
            "Awarded to the opponents of the player who last touched the ball when it wholly crosses the touchline.",
            "A goal cannot be scored directly from a throw-in, and there is no offside offence directly from one.",
        ],
    },
    16: {
        "title": "Law 16: The Goal Kick",
        "url": f"{IFAB_BASE}/the-goal-kick/",
        "points": [
            "Awarded when the ball wholly crosses the goal line, without a goal being scored, having last touched "
            "an attacking player.",
            "There is no offside offence directly from a goal kick.",
        ],
    },
    17: {
        "title": "Law 17: The Corner Kick",
        "url": f"{IFAB_BASE}/the-corner-kick/",
        "points": [
            "Awarded when the ball wholly crosses the goal line, without a goal being scored, having last touched "
            "a defending player.",
            "There is no offside offence directly from a corner kick.",
        ],
    },
}

VAR_PROTOCOL = {
    "title": "VAR protocol (IFAB)",
    "url": "https://theifab.com/laws/latest/video-assistant-referee-var-protocol/",
    "points": [
        "VAR can only be used for clear and obvious errors or serious missed incidents in four situations: goals, "
        "penalty decisions, direct red cards and mistaken identity.",
        "The referee makes the final decision. Factual decisions such as offside position can be changed on the "
        "VAR's advice without an on-field review.",
        "A second yellow card is not a reviewable incident.",
    ],
}


def law_reference(law_number: int) -> dict[str, Any]:
    if law_number not in LAWS:
        raise KeyError(f"No pinned reference for Law {law_number}")
    return {"ruleset_version": RULESET_VERSION, "law": law_number, **LAWS[law_number],
            "note": "BYLINE paraphrase for explanation; the IFAB text is authoritative."}
