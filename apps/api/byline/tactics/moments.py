"""Tactical moments: deterministic detectors over the event log + 2 Hz tracking.

Each moment separates three layers and never mixes them:
  observed       measured numbers from events and tracking (with the frame time they were read at)
  interpretation a constrained sentence that only restates what the measurements show
  unknowns       what the data cannot establish (intent, facing, what would have happened next)
Thresholds are module constants so they can be audited. No model calls.
"""

from __future__ import annotations

from collections.abc import Callable, Sequence
from dataclasses import dataclass, field
from typing import Any

from byline.events.models import MatchEvent
from byline.events.phase import OPEN_PLAY, STOPPAGES, play_phases
from byline.tactics.frame import Frame, Pitch
from byline.tactics.options import option_value, options_for
from byline.world.models import World

# ---- published thresholds
LINE_BREAK_MIN_BYPASSED = 5
LINE_BREAK_MIN_PROGRESS_M = 15.0
OVERLOAD_RADIUS_M = 12.0
OVERLOAD_MIN_DIFF = 2
MISSED_OPTION_MIN_VALUE = 18.0
FOUL_MIN_PROGRESS_M = 10.0
BEATEN_MIN = 2
HIGH_TURNOVER_AX = 65.0
HIGH_TURNOVER_SHOT_S = 12.0
BETWEEN_LINES_MIN_GAP_M = 15.0
RUN_MIN_M = 9.0
RUN_WINDOW_MS = 2000
SHAPE_WINDOW_MS = 8 * 60_000
SHAPE_MIN_DELTA_M = 3.0
FRAME_TOLERANCE_MS = 500  # 2 Hz tracking: the frame read must be the one at or just before the event
COOLDOWN_MS = {"line_break": 8 * 60_000, "high_turnover": 4 * 60_000, "overload": 5 * 60_000, "option": 8 * 60_000, "between_lines": 6 * 60_000,
               "run": 6 * 60_000, "beaten": 5 * 60_000}

KIND_LABEL = {
    "line_break": "Line-breaking pass",
    "overload": "Numerical overload",
    "option": "Better option on",
    "foul_stops_attack": "Foul stops an attack",
    "beaten": "Defenders beaten",
    "high_turnover": "High turnover",
    "between_lines": "Between the lines",
    "run": "Run creates the option",
    "shape_change": "Shape after substitution",
    "press": "Pressing intensity",
    "stretched": "Lines stretched",
    "response": "Defensive response",
}

# ---- window detectors (10-minute windows inside each half; released when the window closes)
WINDOW_MS = 10 * 60_000
PRESS_ZONE_AX = 60.0  # defensive actions at or beyond this attacking-x count as pressing high
PRESS_MIN_ACTIONS = 5
PRESS_RATIO = 0.6  # PPDA at or below 60% of the team's earlier windows
STRETCH_MIN_GAP_M = 15.0
STRETCH_RATIO = 1.25
RESPONSE_MIN_SHARE = 0.6
RESPONSE_MIN_SHIFT_M = 3.0


@dataclass
class TacticalMoment:
    moment_id: str
    kind: str
    team_id: str
    at_ms: int
    seq: int
    display_clock: str
    title: str
    observed: list[dict[str, Any]]
    summary: str
    interpretation: str
    unknowns: list[str]
    evidence_event_ids: list[str]
    focus_player_ids: list[str]
    frame_ms: int
    significance: float
    whatif: bool = False
    extra: dict[str, Any] = field(default_factory=dict)
    # the latest data this moment uses: it is only released once the replay reaches it (no look-ahead)
    available_ms: int = 0
    available_seq: int = 0

    def to_json(self) -> dict[str, Any]:
        return {
            "moment_id": self.moment_id, "kind": self.kind, "label": KIND_LABEL.get(self.kind, self.kind),
            "team_id": self.team_id, "at_ms": self.at_ms, "seq": self.seq, "display_clock": self.display_clock,
            "title": self.title, "observed": self.observed, "summary": self.summary,
            "interpretation": self.interpretation, "unknowns": self.unknowns,
            "evidence_event_ids": self.evidence_event_ids, "focus_player_ids": self.focus_player_ids,
            "frame_ms": self.frame_ms, "significance": round(self.significance, 1), "whatif": self.whatif,
            "available_ms": self.available_ms, "available_seq": self.available_seq,
            "plain": self.extra.get("plain", self.summary),
            "provenance": "deterministic: synthetic event log + 2 Hz player-centre tracking",
        }


def plain_text(m: TacticalMoment, name: Callable[[str | None], str], team: Callable[[str], str]) -> str:
    """Everyday-language version for fans: same facts, no jargon, no judgement of the player."""
    x = m.extra
    t = team(m.team_id)
    if m.kind == "option":
        return (f"{name(x.get('best'))} was free with an open passing lane, but the ball went to "
                f"{name(x.get('intended'))} and was cut out.")
    if m.kind == "line_break":
        return f"One pass took {m.observed[0]['value']} opponents out of the game for {t}."
    if m.kind == "overload":
        return f"{t} had more players than the defence around the ball ({x.get('ratio')})."
    if m.kind == "foul_stops_attack":
        return f"A foul stopped {t} just as forward passes were opening up."
    if m.kind == "beaten":
        return f"{name(m.focus_player_ids[0])} ran past {m.observed[1]['value']} defenders with the ball."
    if m.kind == "high_turnover":
        return f"{t} won the ball near the opponent's goal and had a shot seconds later."
    if m.kind == "between_lines":
        return f"{name(m.focus_player_ids[0])} found a pocket of space between the defence and midfield."
    if m.kind == "run":
        return f"{name(m.focus_player_ids[0])}'s run created the space for the pass."
    if m.kind == "shape_change":
        return f"How {t} lined up after the substitution, measured from player positions."
    if m.kind == "press":
        return f"{t} are hunting the ball higher up the pitch than earlier."
    if m.kind == "stretched":
        return f"There is more space between {t}'s defence and midfield than earlier."
    if m.kind == "response":
        return f"{t}'s players have moved across towards the side being attacked."
    return m.summary


def _obs(label: str, value: Any, unit: str = "") -> dict[str, Any]:
    v = round(value, 1) if isinstance(value, float) else value
    return {"label": label, "value": v, "unit": unit}


class TacticsEngine:
    """Runs every detector over the released events; deterministic and rebuild-safe."""

    def __init__(self, world: World, events: Sequence[MatchEvent], tracking: dict[str, Any] | None) -> None:
        self.world = world
        self.events = list(events)
        self.pitch = Pitch(world, self.events, tracking) if tracking else None
        self.phase = play_phases(self.events)

    def name(self, pid: str | None) -> str:
        if not pid:
            return "a player"
        try:
            p = self.world.player(pid)
        except KeyError:
            return pid
        return p.display_name

    def team_name(self, team_id: str) -> str:
        return self.world.team(team_id).short_name

    def run(self) -> list[TacticalMoment]:
        out = self._run()
        for m in out:
            m.extra["plain"] = plain_text(m, self.name, self.team_name)
        return out

    def _run(self) -> list[TacticalMoment]:
        if self.pitch is None:
            return []  # no tracking: tactical geometry abstains
        out: list[TacticalMoment] = []
        last: dict[tuple[str, str], int] = {}

        def cooled(kind: str, team: str, at: int) -> bool:
            prev = last.get((kind, team))
            if prev is not None and at - prev < COOLDOWN_MS.get(kind, 0):
                return False
            last[(kind, team)] = at
            return True

        detectors: list[Callable[[MatchEvent, Frame], TacticalMoment | None]] = [
            self._line_break, self._overload, self._missed_option, self._foul_stops_attack, self._beaten,
            self._between_lines, self._run_opens,
        ]
        for i, ev in enumerate(self.events):
            if ev.type in ("interception", "tackle", "ball_recovery"):
                m = self._high_turnover(i, ev)
                if m:
                    out.append(m)
                continue
            if ev.type == "substitution":
                m = self._shape_change(ev)
                if m:
                    out.append(m)
                continue
            if ev.type not in ("pass.completed", "pass.failed", "carry", "foul.committed"):
                continue
            if self.phase.get(ev.event_id) != OPEN_PLAY:
                continue  # a corner, throw-in, goal kick, free kick or kick-off delivery is a set piece, not open play
            frame = self.pitch.at(ev.elapsed_ms)
            if frame is None or not frame.directions or ev.elapsed_ms - frame.t_ms > FRAME_TOLERANCE_MS:
                continue
            for det in detectors:
                m = det(ev, frame)
                if m is not None and cooled(m.kind, m.team_id, m.at_ms):
                    out.append(m)
        out.extend(self._windows())
        times = [e.elapsed_ms for e in self.events]
        import bisect

        for m in out:
            # data used: the frame at the moment (+ any later frame or event the detector read)
            used = max(m.at_ms, int(m.extra.pop("_used_ms", m.at_ms)))
            k = bisect.bisect_left(times, used)
            if k >= len(self.events):
                m.available_ms, m.available_seq = 10**12, 10**9  # needs data beyond the log: never released
            else:
                m.available_ms, m.available_seq = self.events[k].elapsed_ms, self.events[k].seq
        return sorted(out, key=lambda m: (m.available_seq, m.at_ms))

    # -------------------------------------------------------------- helpers
    def _start(self, ev: MatchEvent) -> tuple[float, float] | None:
        loc = ev.payload.get("start") or ev.payload.get("location")
        return (float(loc["x_m"]), float(loc["y_m"])) if isinstance(loc, dict) else None

    def _base(self, ev: MatchEvent, kind: str, team: str, title: str, **kw: Any) -> TacticalMoment:
        return TacticalMoment(moment_id=f"T-{kind}-{team}-{ev.seq:04d}", kind=kind, team_id=team, at_ms=ev.elapsed_ms,
                              seq=ev.seq, display_clock=ev.display_clock or "", title=title, frame_ms=ev.elapsed_ms,
                              **kw)

    # -------------------------------------------------------------- detectors
    def _line_break(self, ev: MatchEvent, f: Frame) -> TacticalMoment | None:
        if ev.type != "pass.completed" or not ev.team_id or ev.team_id not in f.directions:
            return None
        passer = f.get(ev.player_id or "")
        if ev.payload.get("pass_kind") != "open_play" or passer is None or passer.gk:
            return None  # goal kicks and keeper long balls 'bypass' everyone trivially
        s, e = ev.payload["start"], ev.payload["end"]
        team = ev.team_id
        s_ax, _ = f.att(team, s["x_m"], s["y_m"])
        e_ax, _ = f.att(team, e["x_m"], e["y_m"])
        prog = e_ax - s_ax
        if prog < LINE_BREAK_MIN_PROGRESS_M or e_ax < 52.5:
            return None
        bypassed = [o for o in f.opponents(team, outfield=True) if s_ax < f.att(team, o.x, o.y)[0] < e_ax]
        if len(bypassed) < LINE_BREAK_MIN_BYPASSED:
            return None
        rec = ev.payload.get("receiver_player_id")
        defending = bypassed[0].team_id
        lines = f.lines(defending, team)
        crossed = sum(1 for x in (lines.mid_ax, lines.back_ax) if s_ax < x < e_ax)
        if crossed == 0:
            return None
        return self._base(
            ev, "line_break", team, f"{self.name(ev.player_id)} breaks the lines to {self.name(rec)}",
            observed=[_obs("Opponents bypassed", len(bypassed)), _obs("Ground gained", prog, "m"),
                      _obs("Lines crossed", crossed)],
            summary=(f"{self.name(ev.player_id)}'s pass to {self.name(rec)} gained {prog:.0f} m and bypassed "
                     f"{len(bypassed)} {self.team_name(defending)} outfield players"
                     f"{f', crossing {crossed} of their lines' if crossed else ''}."),
            interpretation=(f"{self.team_name(team)} moved the ball past {len(bypassed)} opponents in one action, "
                            "which removes them from the immediate defence of that attack."),
            unknowns=["Whether it was a planned pattern", "The receiver's body shape (player-centre tracking only)"],
            evidence_event_ids=[ev.event_id], focus_player_ids=[p for p in (ev.player_id, rec) if p],
            significance=len(bypassed) * 4 + prog, extra={"bypassed_ids": [o.pid for o in bypassed]})

    def _overload(self, ev: MatchEvent, f: Frame) -> TacticalMoment | None:
        if ev.type not in ("pass.completed", "carry") or not ev.team_id or ev.team_id not in f.directions:
            return None
        team = ev.team_id
        end = ev.payload.get("end")
        if not isinstance(end, dict):
            return None
        bx, by = float(end["x_m"]), float(end["y_m"])
        if f.att(team, bx, by)[0] < 70:
            return None
        att = [b for b in f.team(team, outfield=True) if ((b.x - bx) ** 2 + (b.y - by) ** 2) ** 0.5 <= OVERLOAD_RADIUS_M]
        dfn = [b for b in f.opponents(team) if ((b.x - bx) ** 2 + (b.y - by) ** 2) ** 0.5 <= OVERLOAD_RADIUS_M]
        if len(att) < 3 or len(att) - len(dfn) < OVERLOAD_MIN_DIFF:
            return None
        ratio = f"{len(att)}v{len(dfn)}"
        return self._base(
            ev, "overload", team, f"{self.team_name(team)} create a {ratio} near the ball",
            observed=[_obs("Attackers within 12 m", len(att)), _obs("Defenders within 12 m", len(dfn)),
                      _obs("Zone", "final third")],
            summary=(f"When the ball reached the final third, {len(att)} {self.team_name(team)} players and "
                     f"{len(dfn)} opponent{'' if len(dfn) == 1 else 's'} were within 12 m of it ({ratio})."),
            interpretation="More attackers than defenders around the ball at that instant: a local numerical advantage.",
            unknowns=["Whether the advantage was used: see the next actions", "Defenders arriving after this frame"],
            evidence_event_ids=[ev.event_id], focus_player_ids=[b.pid for b in att],
            significance=10 + 6 * (len(att) - len(dfn)), extra={"ratio": ratio, "defender_ids": [b.pid for b in dfn]})

    def _missed_option(self, ev: MatchEvent, f: Frame) -> TacticalMoment | None:
        if ev.type != "pass.failed" or ev.payload.get("outcome") != "intercepted" or not ev.player_id:
            return None
        carrier = f.get(ev.player_id)
        origin = self._start(ev)
        if carrier is None or origin is None or carrier.team_id not in f.directions:
            return None
        team = carrier.team_id
        if f.att(team, *origin)[0] < 55:
            return None
        opts = options_for(f, ev.player_id, origin)
        intended = ev.payload.get("intended_receiver_player_id")
        actual = next((o for o in opts if o.receiver_id == intended), None)
        best = max(opts, key=option_value, default=None)
        if (best is None or actual is None or best.receiver_id == intended or actual.rating != "blocked"
                or option_value(best) < MISSED_OPTION_MIN_VALUE or best.rating != "open"):
            return None
        interceptor = next((x for x in self.events if x.type == "interception" and x.seq > ev.seq), None)
        # name the real reason the intended pass was rated blocked: the lane, or the receiver's marker
        n_lane = len(actual.lane_opponents)
        why = (f"ran through a lane with {n_lane} opponent{'s' if n_lane != 1 else ''} within 1.5 m of it "
               f"(closest {actual.lane_clearance_m:.1f} m)"
               if actual.lane_clearance_m < 1.5 else
               f"went to a team-mate with an opponent {actual.receiver_space_m:.1f} m away")
        return self._base(
            ev, "option", team, f"{self.name(best.receiver_id)} was open as {self.name(ev.player_id)}'s pass was cut out",
            observed=[_obs("Intended lane: nearest opponent", actual.lane_clearance_m, "m"),
                      _obs("Open lane: nearest opponent", best.lane_clearance_m, "m"),
                      _obs("Space around the open player", best.receiver_space_m, "m"),
                      _obs("Ground the open option gained", best.progression_m, "m"),
                      _obs("Opponents goal-side of the ball, bypassed", best.opponents_bypassed)],
            summary=(f"{self.name(ev.player_id)}'s pass towards {self.name(intended)} {why} "
                     f"and was intercepted. At that instant "
                     f"{self.name(best.receiver_id)} had an open lane (nearest opponent {best.lane_clearance_m:.1f} m), "
                     f"{best.receiver_space_m:.1f} m of space and was {best.progression_m:.0f} m further forward."),
            interpretation=("The tracking shows a safer and more progressive passing lane than the one chosen. "
                            "This describes the geometry at one instant, not a mistake: the passer's view and "
                            "intent are unknown."),
            unknowns=["Whether the passer could see the open player (no facing data)",
                      "Whether that pass would have been completed",
                      "What would have happened next: nothing after this instant is shown as fact"],
            evidence_event_ids=[ev.event_id] + ([interceptor.event_id] if interceptor else []),
            focus_player_ids=[ev.player_id, best.receiver_id] + ([intended] if intended else []),
            significance=option_value(best) + 10, whatif=True,
            extra={"intended": intended, "best": best.receiver_id,
                   "_used_ms": interceptor.elapsed_ms if interceptor else ev.elapsed_ms})

    def _foul_stops_attack(self, ev: MatchEvent, f: Frame) -> TacticalMoment | None:
        if ev.type != "foul.committed":
            return None
        victim = ev.payload.get("victim_player_id")
        body = f.get(str(victim)) if victim else None
        loc = self._start(ev)
        if body is None or loc is None or body.team_id not in f.directions:
            return None
        team = body.team_id
        if f.att(team, *loc)[0] < 52.5:
            return None
        opts = [o for o in options_for(f, body.pid, loc) if o.rating == "open" and o.progression_m >= FOUL_MIN_PROGRESS_M]
        flagged = bool(ev.payload.get("stopped_promising_attack"))
        if not opts and not flagged:
            return None
        best = max(opts, key=option_value) if opts else None
        txt = (f"{len(opts)} open forward option{'s' if len(opts) != 1 else ''} at that instant, the best "
               f"{self.name(best.receiver_id)} {best.progression_m:.0f} m further forward" if best else
               "the referee recorded it as stopping a promising attack")
        return self._base(
            ev, "foul_stops_attack", team, f"Foul on {self.name(body.pid)} ends a promising position",
            observed=[_obs("Open forward options", len(opts)), _obs("Foul", str(ev.payload.get("foul_type", "foul"))),
                      _obs("Official: stopped a promising attack", "yes" if flagged else "not recorded")],
            summary=f"{self.name(body.pid)} was fouled in the opponent half with {txt}.",
            interpretation="The foul ended a moment where the tracking shows forward passing options were available.",
            unknowns=["Whether the foul was deliberate (the official record does not say)",
                      "Whether any option would have been taken or completed"],
            evidence_event_ids=[ev.event_id], focus_player_ids=[body.pid] + ([best.receiver_id] if best else []),
            significance=12 + 3 * len(opts) + (8 if flagged else 0), whatif=bool(best),
            extra={"best": best.receiver_id if best else None})

    def _beaten(self, ev: MatchEvent, f: Frame) -> TacticalMoment | None:
        if ev.type != "carry" or not ev.team_id or not ev.player_id or ev.team_id not in f.directions:
            return None
        assert self.pitch is not None
        s, e = ev.payload["start"], ev.payload["end"]
        team = ev.team_id
        s_ax, s_ay = f.att(team, s["x_m"], s["y_m"])
        e_ax, _ = f.att(team, e["x_m"], e["y_m"])
        if e_ax - s_ax < 8:
            return None
        dur = int(max(1.0, (e_ax - s_ax) / 6.0) * 1000)
        after = self.pitch.at(ev.elapsed_ms + dur)
        if after is None:
            return None
        ahead = [o for o in f.opponents(team, outfield=True)
                 if s_ax < f.att(team, o.x, o.y)[0] < s_ax + 14 and abs(f.att(team, o.x, o.y)[1] - s_ay) < 10]
        beaten = []
        for o in ahead:
            later = after.get(o.pid)
            if later is not None and after.att(team, later.x, later.y)[0] < e_ax - 1:
                beaten.append(o.pid)
        if len(beaten) < BEATEN_MIN:
            return None
        return self._base(
            ev, "beaten", team, f"{self.name(ev.player_id)} carries past {len(beaten)} defenders",
            observed=[_obs("Opponents goal-side at the start", len(ahead)), _obs("Behind the ball at the end", len(beaten)),
                      _obs("Carry", e_ax - s_ax, "m")],
            summary=(f"{self.name(ev.player_id)} carried the ball {e_ax - s_ax:.0f} m; {len(beaten)} opponents who were "
                     "goal-side of him at the start were behind the ball at the end."),
            interpretation="The carry took defenders out of the play without a pass.",
            unknowns=["Whether defenders were dribbled past or chose not to engage"],
            evidence_event_ids=[ev.event_id], focus_player_ids=[ev.player_id, *beaten],
            significance=8 + 5 * len(beaten), extra={"beaten_ids": beaten, "_used_ms": ev.elapsed_ms + dur})

    def _between_lines(self, ev: MatchEvent, f: Frame) -> TacticalMoment | None:
        if ev.type != "pass.completed" or not ev.team_id or ev.team_id not in f.directions:
            return None
        rec = ev.payload.get("receiver_player_id")
        body = f.get(str(rec)) if rec else None
        if body is None:
            return None
        team = ev.team_id
        defending = next((o.team_id for o in f.opponents(team)), None)
        if defending is None:
            return None
        lines = f.lines(defending, team)
        r_ax, r_ay = f.att(team, body.x, body.y)
        if not (lines.mid_ax + 2 < r_ax < lines.back_ax - 2) or lines.gap_m < BETWEEN_LINES_MIN_GAP_M or not 18 < r_ay < 50:
            return None
        space = min((((o.x - body.x) ** 2 + (o.y - body.y) ** 2) ** 0.5 for o in f.opponents(team)), default=99.0)
        if space < 5:
            return None
        return self._base(
            ev, "between_lines", team, f"{self.name(rec)} receives between the lines",
            observed=[_obs("Gap between their midfield and back line", lines.gap_m, "m"),
                      _obs("Space when receiving", space, "m")],
            summary=(f"{self.name(rec)} received centrally in a {lines.gap_m:.0f} m gap between "
                     f"{self.team_name(defending)}'s midfield and back line, with {space:.1f} m to the nearest opponent."),
            interpretation=f"{self.team_name(defending)}'s lines were stretched apart at that instant.",
            unknowns=["Why the gap opened (pressing, tiredness or instruction cannot be read from positions)"],
            evidence_event_ids=[ev.event_id], focus_player_ids=[str(rec)],
            significance=10 + lines.gap_m / 2, extra={"gap_m": round(lines.gap_m, 1)})

    def _run_opens(self, ev: MatchEvent, f: Frame) -> TacticalMoment | None:
        if ev.type != "pass.completed" or not ev.team_id or ev.team_id not in f.directions:
            return None
        assert self.pitch is not None
        rec = ev.payload.get("receiver_player_id")
        now = f.get(str(rec)) if rec else None
        before = self.pitch.at(ev.elapsed_ms - RUN_WINDOW_MS)
        then = before.get(str(rec)) if before and rec else None
        if now is None or then is None:
            return None
        team = ev.team_id
        moved = ((now.x - then.x) ** 2 + (now.y - then.y) ** 2) ** 0.5
        fwd = f.att(team, now.x, now.y)[0] - f.att(team, then.x, then.y)[0]
        if moved < RUN_MIN_M or fwd < 5 or f.att(team, now.x, now.y)[0] < 60:
            return None
        opts = {o.receiver_id: o for o in options_for(f, ev.player_id or "", self._start(ev))}
        o = opts.get(str(rec))
        if o is None or o.rating != "open":
            return None
        return self._base(
            ev, "run", team, f"{self.name(rec)}'s run opens the passing lane",
            observed=[_obs("Run in the 2 s before the pass", moved, "m"), _obs("Forward", fwd, "m"),
                      _obs("Space on receiving", o.receiver_space_m, "m")],
            summary=(f"{self.name(rec)} covered {moved:.0f} m ({fwd:.0f} m forward) in the 2 seconds before "
                     f"{self.name(ev.player_id)}'s pass and received with {o.receiver_space_m:.1f} m of space."),
            interpretation="The movement before the pass is what made this lane open.",
            unknowns=["Whether the run was called for or improvised"],
            evidence_event_ids=[ev.event_id], focus_player_ids=[str(rec)],
            significance=8 + moved / 2, extra={"from": [round(then.x, 1), round(then.y, 1)]})

    def _high_turnover(self, i: int, ev: MatchEvent) -> TacticalMoment | None:
        assert self.pitch is not None
        team = ev.team_id
        loc = self._start(ev)
        dirs = self.pitch.directions(ev.elapsed_ms)
        if not team or loc is None or team not in dirs:
            return None
        from byline.football.geometry import to_attacking

        ax = to_attacking(dirs[team], *loc)[0]
        if ax < HIGH_TURNOVER_AX:
            return None
        shot = None
        for nxt in self.events[i + 1:]:
            if nxt.elapsed_ms - ev.elapsed_ms > HIGH_TURNOVER_SHOT_S * 1000 or nxt.type in STOPPAGES:
                break  # the shot must come from the same passage of open play, not after a restart
            if nxt.type == "shot" and nxt.team_id == team:
                shot = nxt
                break
            if nxt.team_id and nxt.team_id != team and nxt.type in ("pass.completed", "carry"):
                break
        if shot is None:
            return None
        secs = (shot.elapsed_ms - ev.elapsed_ms) / 1000
        return self._base(
            ev, "high_turnover", team, f"{self.team_name(team)} win it high and shoot within {secs:.0f} s",
            observed=[_obs("Regain", ev.type.replace("_", " ")), _obs("Distance from goal", 105 - ax, "m"),
                      _obs("Seconds to the shot", secs, "s"),
                      _obs("Shot", str(shot.payload.get("outcome", "")).replace("_", " "))],
            summary=(f"{self.name(ev.player_id)} won the ball {105 - ax:.0f} m from goal and "
                     f"{self.team_name(team)} shot {secs:.1f} s later."),
            interpretation="Winning the ball high up the pitch led directly to a shot.",
            unknowns=["Whether the regain came from a planned press"],
            evidence_event_ids=[ev.event_id, shot.event_id], focus_player_ids=[p for p in (ev.player_id, shot.player_id) if p],
            significance=18 + max(0.0, 15 - secs),
            extra={"_used_ms": shot.elapsed_ms, "shot_outcome": str(shot.payload.get("outcome", ""))})

    def _windows(self) -> list[TacticalMoment]:
        return _windows_impl(self)

    def _shape_change(self, ev: MatchEvent) -> TacticalMoment | None:
        assert self.pitch is not None
        team = ev.team_id
        if not team:
            return None

        def shape(start: int, end: int) -> tuple[float, float, float] | None:
            frames = self.pitch.window(start, end, 5000) if self.pitch else []
            vals = []
            for fr in frames:
                if team not in fr.directions:
                    continue
                pts = [fr.att(team, b.x, b.y) for b in fr.team(team, outfield=True)]
                if len(pts) < 8:
                    continue
                xs = sorted(p[0] for p in pts)
                ys = sorted(p[1] for p in pts)
                vals.append((sum(xs[:4]) / 4, xs[-1] - xs[0], ys[-1] - ys[0]))
            if not vals:
                return None
            return tuple(sum(v[k] for v in vals) / len(vals) for k in range(3))  # type: ignore[return-value]

        pre = shape(ev.elapsed_ms - SHAPE_WINDOW_MS, ev.elapsed_ms - 60_000)
        post = shape(ev.elapsed_ms + 60_000, ev.elapsed_ms + SHAPE_WINDOW_MS)
        if pre is None or post is None:
            return None
        names = ("Back-line height", "Team length", "Team width")
        deltas = [post[k] - pre[k] for k in range(3)]
        changed = [(names[k], deltas[k]) for k in range(3) if abs(deltas[k]) >= SHAPE_MIN_DELTA_M]
        off, on = ev.payload.get("player_off_id"), ev.payload.get("player_on_id")
        verdict = ("; ".join(f"{n.lower()} {'+' if d > 0 else ''}{d:.1f} m" for n, d in changed)
                   if changed else "no change of 3 m or more in line height, length or width")
        return self._base(
            ev, "shape_change", team, f"{self.team_name(team)} after {self.name(on)} replaces {self.name(off)}",
            observed=[_obs(f"{n} change", d, "m") for n, d in zip(names, deltas, strict=True)],
            summary=f"Average shape 8 minutes either side of the substitution: {verdict}.",
            interpretation=("The measured shape changed after the substitution." if changed else
                            "The substitution did not measurably change the team's shape."),
            unknowns=["Whether the change was instructed, or a response to the score and the opponent"],
            evidence_event_ids=[ev.event_id], focus_player_ids=[p for p in (on, off) if p],
            significance=6 + 3 * len(changed),
            extra={"pre": [round(v, 1) for v in pre], "post": [round(v, 1) for v in post],
                   "_used_ms": ev.elapsed_ms + SHAPE_WINDOW_MS})


def _window_moment(engine: TacticsEngine, kind: str, team: str, start: int, end: int, clock: str, title: str,
                   **kw: Any) -> TacticalMoment:
    seq = next((e.seq for e in engine.events if e.elapsed_ms >= end), engine.events[-1].seq if engine.events else 0)
    m = TacticalMoment(moment_id=f"T-{kind}-{team}-{start // 60_000:03d}", kind=kind, team_id=team, at_ms=end,
                       seq=seq, display_clock=clock, title=title, frame_ms=end, **kw)
    m.extra["_used_ms"] = end
    return m


def _windows_impl(engine: TacticsEngine) -> list[TacticalMoment]:
    """Pressing, line spacing and defensive response, measured per 10-minute window of each half."""
    from byline.football.geometry import channel_of, to_attacking

    pitch = engine.pitch
    assert pitch is not None
    out: list[TacticalMoment] = []
    halves = [(e.elapsed_ms, e.period) for e in engine.events if e.type == "period.started"]
    ends = {e.period: e.elapsed_ms for e in engine.events if e.type == "period.ended"}
    teams = [t.team_id for t in engine.world.teams]
    history: dict[tuple[str, str], list[float]] = {}
    last_ms = engine.events[-1].elapsed_ms if engine.events else 0
    for h_start, period in halves:
        h_end = ends.get(period)  # None while the half is still being played
        dirs = pitch.directions(h_start + 1)
        w_start = h_start
        prev_entries: dict[str, list[str]] = {}
        prev_def_y: dict[str, float] = {}
        while True:
            # a window is only judged once it has closed: 10 full minutes, or the end of the half (no look-ahead)
            w_end = w_start + WINDOW_MS
            if h_end is not None:
                if h_end - w_start < 60_000:
                    break
                w_end = min(w_end, h_end)
            elif w_end > last_ms:
                break
            evs = [e for e in engine.events if w_start <= e.elapsed_ms < w_end]
            clock = next((e.display_clock for e in reversed(evs) if e.display_clock), "") or ""
            for team in teams:
                if team not in dirs:
                    continue
                opp = next(t for t in teams if t != team)

                def ax(ev: MatchEvent, side: str, dirs: dict[str, str] = dirs) -> float | None:
                    loc = ev.payload.get("location") or ev.payload.get("start")
                    if not isinstance(loc, dict) or side not in dirs:
                        return None
                    return to_attacking(dirs[side], float(loc["x_m"]), float(loc["y_m"]))[0]

                # pressing: opponent passes in their own 60% per defensive action of ours in that zone
                def_actions = [e for e in evs if e.team_id == team and e.type in ("pressure", "tackle", "interception")
                               and (ax(e, team) or 0) >= PRESS_ZONE_AX]
                opp_passes = [e for e in evs if e.team_id == opp and e.type in ("pass.completed", "pass.failed")
                              and (ax(e, opp) or 105) <= 105 - PRESS_ZONE_AX + 18]
                key = ("ppda", team)
                if len(def_actions) >= 1:
                    ppda = len(opp_passes) / max(1, len(def_actions))
                    earlier = history.get(key, [])
                    if (earlier and len(def_actions) >= PRESS_MIN_ACTIONS
                            and ppda <= PRESS_RATIO * (sum(earlier) / len(earlier))):
                        base = sum(earlier) / len(earlier)
                        regains = sum(1 for e in def_actions if e.type in ("tackle", "interception"))
                        out.append(_window_moment(
                            engine, "press", team, w_start, w_end, clock,
                            f"{engine.team_name(team)} press higher and harder",
                            observed=[_obs("Opponent passes per defensive action (this window)", ppda),
                                      _obs("Earlier windows", base), _obs("High defensive actions", len(def_actions)),
                                      _obs("Regains among them", regains)],
                            summary=(f"In the last 10 minutes {engine.team_name(opp)} managed {ppda:.1f} passes in "
                                     f"their own half per {engine.team_name(team)} defensive action, against "
                                      f"{base:.1f} earlier in the match; {len(def_actions)} of those actions came high "
                                     "up the pitch."),
                            interpretation=f"{engine.team_name(team)} are disrupting the build-up more often than before.",
                            unknowns=["Whether this is a planned press or a reaction to the score or fatigue"],
                            evidence_event_ids=[e.event_id for e in def_actions][:12],
                            focus_player_ids=sorted({e.player_id for e in def_actions if e.player_id})[:4],
                            significance=20 + (base - ppda) * 2))
                    history.setdefault(key, []).append(ppda)
                # lines stretched: our back-to-midfield gap while defending, from tracking
                gaps = []
                for f in pitch.window(w_start, w_end, 10_000):
                    if team not in f.directions or opp not in f.directions:
                        continue
                    gaps.append(f.lines(team, opp).gap_m)
                if gaps:
                    gap = sum(gaps) / len(gaps)
                    gkey = ("gap", team)
                    earlier_g = history.get(gkey, [])
                    if earlier_g and gap >= STRETCH_MIN_GAP_M and gap >= STRETCH_RATIO * (sum(earlier_g) / len(earlier_g)):
                        base_g = sum(earlier_g) / len(earlier_g)
                        out.append(_window_moment(
                            engine, "stretched", team, w_start, w_end, clock,
                            f"{engine.team_name(team)}'s lines are stretching",
                            observed=[_obs("Gap between back line and midfield", gap, "m"),
                                      _obs("Earlier windows", base_g, "m")],
                            summary=(f"Over the last 10 minutes the gap between {engine.team_name(team)}'s back line "
                                     f"and midfield averaged {gap:.0f} m, up from {base_g:.0f} m earlier in the match."),
                            interpretation="More space is opening between their defence and midfield.",
                            unknowns=["Whether tiredness, the score or an instruction caused it"],
                            evidence_event_ids=[evs[-1].event_id] if evs else [], focus_player_ids=[],
                            significance=14 + gap - base_g))
                    history.setdefault(gkey, []).append(gap)
                # defensive response: did the opponent's defence shift towards the channel we kept attacking?
                entries: list[str] = [channel_of(to_attacking(dirs[team], float(e.payload["end"]["x_m"]),
                                                   float(e.payload["end"]["y_m"]))[1])
                           for e in evs if e.team_id == team and e.type in ("pass.completed", "carry")
                           and isinstance(e.payload.get("end"), dict) and (ax(e, team) or 0) < 70
                           and to_attacking(dirs[team], float(e.payload["end"]["x_m"]), float(e.payload["end"]["y_m"]))[0] >= 70]
                ys = [sum(to_attacking(dirs[team], b.x, b.y)[1] for b in f.team(opp, outfield=True)) / 10
                      for f in pitch.window(w_start, w_end, 10_000) if len(f.team(opp, outfield=True)) >= 9]
                def_y = sum(ys) / len(ys) if ys else None
                prev = prev_entries.get(team, [])
                if prev and def_y is not None and team in prev_def_y:
                    side = max(("left", "right"), key=prev.count)
                    share = prev.count(side) / len(prev)
                    shift = (def_y - prev_def_y[team]) * (1 if side == "right" else -1)
                    if share >= RESPONSE_MIN_SHARE and len(prev) >= 5 and shift >= RESPONSE_MIN_SHIFT_M:
                        out.append(_window_moment(
                            engine, "response", opp, w_start, w_end, clock,
                            f"{engine.team_name(opp)}'s defence shifts towards the {side} channel",
                            observed=[_obs(f"{engine.team_name(team)} entries down the {side} (previous 10 min)",
                                           f"{prev.count(side)} of {len(prev)}"),
                                      _obs("Average lateral shift of their outfield players", shift, "m")],
                            summary=(f"After {engine.team_name(team)} sent {prev.count(side)} of {len(prev)} final-third "
                                     f"entries down the {side}, {engine.team_name(opp)}'s outfield players sat on "
                                     f"average {shift:.1f} m further towards that side over the next 10 minutes."),
                            interpretation=f"{engine.team_name(opp)}'s positions moved towards the channel being attacked.",
                            unknowns=["Whether the shift was instructed or the players reacting to where the ball went"],
                            evidence_event_ids=[evs[-1].event_id] if evs else [], focus_player_ids=[],
                            significance=16 + shift))
                prev_entries[team] = entries
                if def_y is not None:
                    prev_def_y[team] = def_y
            w_start += WINDOW_MS
    return out


def tactical_moments(world: World, events: Sequence[MatchEvent], tracking: dict[str, Any] | None) -> list[TacticalMoment]:
    return TacticsEngine(world, events, tracking).run()
