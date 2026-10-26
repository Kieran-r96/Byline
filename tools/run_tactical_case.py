"""Operator tool: plan (default) or run (--confirm) one agent investigation of a tactical moment.

    apps/api/.venv/Scripts/python tools/run_tactical_case.py --match BYLINE-01 --moment T-option-NBA-0180
    apps/api/.venv/Scripts/python tools/run_tactical_case.py --match BYLINE-01 --moment T-option-NBA-0180 \
        --max-calls 8 --spanish --confirm

Without --confirm nothing is called, constructed or written. See byline/tools/tactical_case.py.
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "apps" / "api"))

from byline.tools.tactical_case import main  # noqa: E402

if __name__ == "__main__":
    raise SystemExit(main())
