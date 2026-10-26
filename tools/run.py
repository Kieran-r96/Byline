"""Cross-platform task runner (Windows has no make). The Makefile delegates here.

    py tools/run.py setup        # create venv + install backend and frontend deps
    py tools/run.py api          # FastAPI on :8000
    py tools/run.py web          # Vite dev server on :5173 (proxies /api)
    py tools/run.py verify       # backend lint/types/tests + frontend typecheck/lint/tests/build
    py tools/run.py generate     # regenerate synthetic fixtures (changes golden checksums!)
    py tools/run.py replay-scenario [golden_story]
    py tools/run.py evaluation
"""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
API = ROOT / "apps" / "api"
WEB = ROOT / "apps" / "web"
PY = API / ".venv" / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
NPM = "npm.cmd" if os.name == "nt" else "npm"


def run(cmd: list[str], cwd: Path, check: bool = True) -> int:
    print(f"\n$ ({cwd.relative_to(ROOT)}) {' '.join(cmd)}", flush=True)
    rc = subprocess.call(cmd, cwd=cwd)
    if check and rc != 0:
        print(f"FAILED ({rc}): {' '.join(cmd)}")
        sys.exit(rc)
    return rc


def main(argv: list[str]) -> int:
    task = argv[0] if argv else "help"
    rest = argv[1:]
    if task == "setup":
        if not PY.exists():
            run([sys.executable, "-m", "venv", ".venv"], API)
        run([str(PY), "-m", "pip", "install", "-q", "-e", ".[dev]", "-r", "requirements-ai.txt"], API)
        run([NPM, "ci"], WEB)
    elif task == "api":
        run([str(PY), "-m", "uvicorn", "byline.api.app:app", "--port", "8000", "--reload", *rest], API)
    elif task == "web":
        run([NPM, "run", "dev"], WEB)
    elif task == "verify":
        run([str(PY), "-m", "ruff", "check", "byline", "tests"], API)
        run([str(PY), "-m", "mypy"], API)
        run([str(PY), "-m", "pytest", "-q"], API)
        run([NPM, "run", "typecheck"], WEB)
        run([NPM, "run", "lint"], WEB)
        run([NPM, "test"], WEB)
        run([NPM, "run", "build"], WEB)
        print("\nVERIFY: all steps passed")
    elif task == "generate":
        run([str(PY), "-m", "byline.simulation.generate", *rest], API)
    elif task == "replay-scenario":
        run([str(PY), "-m", "byline.tools.replay", *(rest or ["golden_story"])], API)
    elif task == "evaluation":
        run([str(PY), "-m", "byline.evaluation.run", *rest], API)
    else:
        print(__doc__)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
