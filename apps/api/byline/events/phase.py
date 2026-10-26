"""Play phase of every event: open play, a restart's delivery, or dead ball.

The event log records a restart in two steps (`restart.taken`, then the taker's first ball action), and that
first action is stamped with a generic `pass_kind` ("open_play" or "cross") in the synthetic feed. Read alone it
looks like open play, so a corner kick, throw-in, goal kick, free kick or kick-off could be measured as a
"line-breaking pass" or a "run". This module classifies the delivery by its place in the sequence instead:

  open_play       the ball is in play and this is not a restart's first action
  <restart type>  the first ball action of the team that took the restart (corner, throw_in, goal_kick,
                  direct_free_kick, indirect_free_kick, penalty, kickoff, dropped_ball)
  dead_ball       between a stoppage and the restart that ends it

Deterministic, no look-ahead: an event's phase depends only on the events before it.
"""

from __future__ import annotations

from collections.abc import Sequence

from byline.events.models import MatchEvent

OPEN_PLAY = "open_play"
DEAD_BALL = "dead_ball"
BALL_ACTIONS = frozenset({"pass.completed", "pass.failed", "carry", "shot"})
# events that put the ball back in play; the next ball action by that team is the restart's delivery
RESTARTS = frozenset({"restart.taken", "kickoff", "penalty.taken"})
# events after which the ball is out of play until a restart
STOPPAGES = frozenset({"restart.awarded", "goal.provisional", "period.ended", "match.finished"})
OPEN_PASS_KINDS = frozenset({"open_play", "cross"})


def play_phases(events: Sequence[MatchEvent]) -> dict[str, str]:
    """event_id -> phase for every event in the log (see module docstring)."""
    out: dict[str, str] = {}
    dead = True  # before the first kick-off
    pending: tuple[str, str | None] | None = None  # (restart type, team) awaiting its first ball action
    for ev in events:
        if ev.type in STOPPAGES:
            dead, pending = True, None
            out[ev.event_id] = DEAD_BALL
            continue
        if ev.type in RESTARTS:
            dead = False
            kind = "penalty" if ev.type == "penalty.taken" else str(ev.payload.get("restart_type", "kickoff"))
            pending = (kind, ev.team_id)
            out[ev.event_id] = kind
            continue
        if ev.type not in BALL_ACTIONS:
            out[ev.event_id] = DEAD_BALL if dead else OPEN_PLAY
            continue
        stamped = ev.payload.get("pass_kind")
        if pending is not None and pending[1] == ev.team_id:
            phase = pending[0]
        elif isinstance(stamped, str) and stamped not in OPEN_PASS_KINDS:
            phase = stamped  # the feed already says which restart it was
        else:
            phase = DEAD_BALL if dead else OPEN_PLAY
        pending = None
        out[ev.event_id] = phase
    return out
