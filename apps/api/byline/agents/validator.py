"""Deterministic post-verifier validation (mandatory). Model self-confidence is never trusted."""

from __future__ import annotations

import re
from collections.abc import Iterable
from typing import Any

from byline.agents.schemas import DraftInsight
from byline.agents.subject import TacticalSubject
from byline.events.models import MatchEvent
from byline.football.detectors.base import PatternCandidate
from byline.world.models import World

CaseSubject = PatternCandidate | TacticalSubject

WORD_NUMBERS = {
    "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8, "nine": 9, "ten": 10,
    "eleven": 11, "twelve": 12, "fifteen": 15, "twenty": 20,
}

BANNED: list[tuple[str, str]] = [
    (r"out of position|dragg(ed|ing)|pulled (out|away|wide)|caught (out|upfield)", "positional claim without tracking"),
    (r"\b(manager|coach|boss|head coach)\b[^.]{0,40}\b(want|instruct|plan|decid|order|told|ask)",
     "claims managerial intent"),
    (r"\b(deliberate(ly)?|intentional(ly)?|on purpose|game ?plan|tactical plan|instructed)\b", "claims intent"),
    (r"\b(odds|bet|bets|betting|wager|bookmaker|accumulator)\b", "betting language"),
    (r"\b(will|going to|bound to|certain to) (score|win|concede|break through)\b", "predicts an outcome"),
    (r"\bguarantee", "overclaims certainty"),
    (r"\b(weak|weakness|exposed|vulnerable)\b", "asserts a defensive weakness the data cannot show"),
    (r"\b\d{2,3}\s?%\s+(chance|probability|likely)", "probability claim"),
    (r"\bpremier league\b|\bopta\b", "real-world league or data provider reference"),
]
SPATIAL_WITHOUT_TRACKING = r"\b(exploit\w*|overload\w*|space (behind|in behind)|isolat\w*)\b"

LIMITS = {"title": 80, "studio_headline": 55, "studio_subtitle": 100}
WORD_LIMITS = {"title": 12, "commentator": 35, "fan_discover": 30, "fan_analyst": 90}


def _numbers(text: str) -> list[tuple[float, bool]]:
    """(value, is_percentage) for every numeral or number word in text."""
    out: list[tuple[float, bool]] = []
    cleaned = re.sub(r"\bE\d{3,5}\b", " ", text)  # event ids are checked separately
    cleaned = re.sub(r"#\d{1,2}", " ", cleaned)  # shirt numbers checked via names
    for m in re.finditer(r"(?<![\w.])(\d+(?:\.\d+)?)\s*(%|per ?cent)?", cleaned):
        out.append((float(m.group(1)), bool(m.group(2))))
    for w, v in WORD_NUMBERS.items():
        if re.search(rf"\b{w}\b", cleaned, re.IGNORECASE):
            out.append((float(v), False))
    return out


def allowed_numbers(candidate: CaseSubject, events: dict[str, MatchEvent], state: dict[str, Any],
                    world: World) -> set[float]:
    allowed: set[float] = {1.0}
    for v in candidate.calculated_metrics.values():
        if isinstance(v, bool) or not isinstance(v, int | float):
            continue
        allowed.add(float(v))
        if 0 < v < 1:
            pct = v * 100
            allowed.update({float(round(pct)), float(int(pct)), round(pct, 1)})
    for eid in candidate.evidence_event_ids:
        ev = events.get(eid)
        if ev and ev.display_clock:
            for n in re.findall(r"\d+", ev.display_clock):
                allowed.add(float(n))
    allowed.update(float(v) for v in state.get("score", {}).values())
    for n in re.findall(r"\d+(?:\.\d+)?", candidate.factual_summary):
        allowed.add(float(n))
    minute = state.get("minute") or ""
    for n in re.findall(r"\d+", str(minute)):
        allowed.add(float(n))
    allowed.add(float(len(candidate.evidence_event_ids)))
    return allowed


def surname_index(world: World) -> dict[str, str]:
    return {p.family_name.lower(): p.player_id for t in world.teams for p in t.players}


def draft_fields(draft: DraftInsight) -> dict[str, str]:
    return {
        "title": draft.title, "canonical_claim": draft.canonical_claim, "why_it_matters": draft.why_it_matters,
        "commentator": draft.commentator, "fan_discover": draft.fan_discover, "fan_analyst": draft.fan_analyst,
        "studio_headline": draft.studio_headline, "studio_subtitle": draft.studio_subtitle,
    }


def validate_draft(draft: DraftInsight, candidate: CaseSubject, known_events: dict[str, MatchEvent],
                   fetched_ids: Iterable[str], state: dict[str, Any], world: World,
                   tracking_used: bool = False, allowed: set[float] | None = None,
                   involved_players: set[str] | None = None) -> list[str]:
    """`allowed` / `involved_players` let a case type supply its own authoritative numbers and named players
    (tactical moments); by default both come from the detector candidate and the cited events."""
    issues: list[str] = []
    ids = list(draft.evidence_event_ids)
    if not ids:
        issues.append("no evidence ids cited")
    for eid in ids:
        if eid not in known_events:
            issues.append(f"cites unknown or future event id {eid}")
    citable = set(candidate.evidence_event_ids) | set(fetched_ids)
    stray = [e for e in ids if e in known_events and e not in citable]
    if stray:
        issues.append(f"cites ids that were never retrieved as evidence: {', '.join(stray[:5])}")
    if ids and not set(ids) & set(candidate.evidence_event_ids):
        issues.append("does not cite any detector evidence")
    if draft.certainty == "insufficient":
        issues.append("analyst marked evidence insufficient")

    fields = draft_fields(draft)
    if allowed is None:
        allowed = allowed_numbers(candidate, known_events, state, world)
    for name, text in fields.items():
        for n, is_pct in _numbers(text):
            tolerance = 1.0 if is_pct else 0.0  # rounding of shares only; counts must be exact
            if not any(abs(n - a) <= tolerance for a in allowed):
                issues.append(f"{name}: number {n:g}{'%' if is_pct else ''} is not supported by the metrics or events")
        low = text.lower()
        for pattern, why in BANNED:
            if re.search(pattern, low):
                issues.append(f"{name}: {why}")
        if not tracking_used and re.search(SPATIAL_WITHOUT_TRACKING, low):
            issues.append(f"{name}: spatial claim needs tracking evidence")
    for name, limit in LIMITS.items():
        if len(fields[name]) > limit:
            issues.append(f"{name} has {len(fields[name])} characters; maximum {limit} - shorten it")
    for name, limit in WORD_LIMITS.items():
        if len(fields[name].split()) > limit:
            issues.append(f"{name} has {len(fields[name].split())} words; maximum {limit} - shorten it")

    if involved_players is not None:
        involved = set(involved_players)
        not_involved = "who is not a player in this moment"
    else:
        involved = {e.player_id for i in citable if (e := known_events.get(i)) and e.player_id}
        for i in citable:
            e = known_events.get(i)
            if e is not None:
                for key in ("receiver_player_id", "victim_player_id"):
                    if key in e.payload:
                        involved.add(e.payload[key])
        not_involved = "who is not in the cited evidence"
    names = surname_index(world)
    blob = " ".join(fields.values()).lower()
    for surname, pid in names.items():
        if re.search(rf"\b{re.escape(surname)}\b", blob) and pid not in involved:
            issues.append(f"names {surname.title()} {not_involved}")
    # de-duplicate, keep order
    return list(dict.fromkeys(issues))


# ---------------------------------------------------------------- tactical moments (added rules; nothing relaxed)

TACTICAL_BANNED: list[tuple[str, str]] = [
    (r"\bwould(n't| not)? have\b|\bwould've\b|\bwould (score|win|lead|result|create|produce|go|be a goal)\b",
     "counterfactual outcome claim"),
    (r"\b(certain|sure|guaranteed|nailed[- ]on|definite) (goal|chance|assist|to)\b", "outcome claim"),
    (r"\bchances? (of|to|that)\b|\bodds of\b", "probability claim"),
    (r"%|\bper ?cent\b|\bpercentage\b", "probability or share claim (no percentages in tactical text)"),
    (r"\bx ?g\b|\bexpected goals?\b|\bexpected assists?\b", "expected-goals claim"),
    (r"\bprobab(le|ly|ility|ilities)\b|\blikel(y|ihood)\b|\bunlikely\b", "probability claim"),
    (r"\bshould(n't| not)?\b|\bshould've\b|\bought to\b|\bmust have\b", "normative claim (what a player should do)"),
    (r"\b(wanted|tried|trying|decided|chose|opted|meant|aimed|intended|attempted|sought|looked|looking|hoped|"
     r"planned|planning) to\b", "claims intent"),
    (r"\binstruct\w*|\b(was|were|been) told\b|\bon (the )?(coach|manager)'?s? orders\b", "claims instructions"),
    (r"\b(poor|bad|wrong|careless|lazy|sloppy|terrible|awful|rash|reckless) (pass|choice|decision|ball|option)\b"
     r"|\bblunder\w*|\bhowler\b", "judges the player"),
]
HYPOTHETICAL = r"\b(if|could|might|would|instead|alternatively|what if|had he|had she|had they)\b"
OPTION_FRAMING = r"\b(options?|alternatives?|available)\b"
INITIAL_NAME = r"\b[A-Z]\.\s?([A-Z][\w'’-]+)"
TACTICAL_WORD_LIMITS = {"commentator": 25}


def tactical_allowed_numbers(subject: TacticalSubject, events: dict[str, MatchEvent], state: dict[str, Any]
                             ) -> set[float]:
    """The moment's measured numbers plus trivial derivations: rounding to whole or one-decimal values, the
    minute, the score, the counts the moment states. No share-to-percentage conversion (percentages are banned)."""
    allowed: set[float] = {1.0, float(len(subject.evidence_event_ids))}
    values = [float(v) for v in subject.calculated_metrics.values()
              if isinstance(v, int | float) and not isinstance(v, bool)]
    values += [float(n) for n in re.findall(r"\d+(?:\.\d+)?", subject.factual_summary)]
    for ob in subject.facts.get("observed", []):
        if isinstance(ob.get("value"), int | float) and not isinstance(ob.get("value"), bool):
            values.append(float(ob["value"]))
    for v in values:
        allowed.update({v, float(round(v)), float(int(v + 0.5)) if v >= 0 else v, round(v, 1)})
    for eid in subject.evidence_event_ids:
        ev = events.get(eid)
        if ev and ev.display_clock:
            allowed.update(float(n) for n in re.findall(r"\d+", ev.display_clock))
    allowed.update(float(n) for n in re.findall(r"\d+", subject.display_clock))
    allowed.update(float(v) for v in state.get("score", {}).values())
    return allowed


def _sentences(text: str) -> list[str]:
    return [s for s in re.split(r"(?<=[.!?;])\s+", text) if s.strip()]


def validate_tactical_draft(draft: DraftInsight, subject: TacticalSubject, known_events: dict[str, MatchEvent],
                            fetched_ids: Iterable[str], state: dict[str, Any], world: World) -> list[str]:
    """Every detector-draft rule (evidence ids, numbers, banned language, limits, names), with the moment's
    measurements as the only numbers and the moment's players as the only names, plus tactical safety rules:
    no outcome/probability claims, no intent or instructions, no judgement of the player, and every
    hypothetical sentence framed as an option or alternative."""
    issues = validate_draft(draft, subject, known_events, fetched_ids, state, world, tracking_used=False,
                            allowed=tactical_allowed_numbers(subject, known_events, state),
                            involved_players=set(subject.player_ids))
    fields = draft_fields(draft)
    moment_surnames = {world.player(p).family_name.lower() for p in subject.player_ids}
    for name, text in fields.items():
        low = text.lower()
        for pattern, why in TACTICAL_BANNED:
            if re.search(pattern, low):
                issues.append(f"{name}: {why}")
        for sentence in _sentences(text):
            s = sentence.lower()
            if re.search(HYPOTHETICAL, s) and not re.search(OPTION_FRAMING, s):
                issues.append(f"{name}: hypothetical not framed as an option or alternative: \"{sentence[:80]}\"")
        for m in re.finditer(INITIAL_NAME, text):
            # "M. Lindqvist's pass" names Lindqvist: strip only a trailing possessive before the comparison
            if re.sub(r"['’]s$", "", m.group(1)).lower() not in moment_surnames:
                issues.append(f"{name}: names {m.group(0)} who is not a player in this moment")
    for name, limit in TACTICAL_WORD_LIMITS.items():
        if len(fields[name].split()) > limit:
            issues.append(f"{name} has {len(fields[name].split())} words; a one-liner is at most {limit}")
    return list(dict.fromkeys(issues))
