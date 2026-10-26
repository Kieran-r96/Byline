"""Pitch geometry normalised to a team's attacking direction.

Attacking frame: ax 0 = own goal line, 105 = opponent goal line; ay 0 = the team's LEFT
touchline as they attack, 68 = their RIGHT touchline. World y runs top->bottom of the
canonical pitch, so a team attacking +x has its right flank at high world y.
"""

from __future__ import annotations

import math
from typing import Literal

L, W = 105.0, 68.0
FINAL_THIRD_AX = 70.0
Channel = Literal["left", "centre", "right"]


def to_attacking(direction: str, x: float, y: float) -> tuple[float, float]:
    return (x, y) if direction == "+x" else (L - x, W - y)


def channel_of(ay: float) -> Channel:
    if ay < W / 3:
        return "left"
    if ay > 2 * W / 3:
        return "right"
    return "centre"


def in_penalty_area(ax: float, ay: float) -> bool:
    return ax >= L - 16.5 and 13.84 <= ay <= W - 13.84


def distance(x1: float, y1: float, x2: float, y2: float) -> float:
    return math.hypot(x2 - x1, y2 - y1)
