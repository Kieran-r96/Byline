"""Secret scan (CI + local). Exits 1 on a finding. Matched values are never printed, only where they are.

    python tools/secret_scan.py                    # git-tracked files in the working tree (CI)
    python tools/secret_scan.py --history          # every line ever added, in every commit reachable from any
                                                   # ref (all branches incl. agent worktrees, tags, stash)
    python tools/secret_scan.py --dir apps/web/dist  # any directory, e.g. the built frontend bundle

Two classes of pattern:
* credentials (keys, tokens, private keys, connection strings, signed URLs);
* identifiers that are not credentials but must not be published either: a real Azure AI resource
  hostname, or a tenant/subscription id assignment.
"""

from __future__ import annotations

import argparse
import re
import subprocess
import sys
from collections.abc import Iterator
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
GUID = r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"
PATTERNS = {
    "private key": re.compile(r"-----BEGIN (RSA |EC |OPENSSH |DSA |ENCRYPTED )?PRIVATE KEY-----"),
    "azure key assignment": re.compile(
        r"(?i)(api[_-]?key|account[_-]?key|client[_-]?secret|subscription[_-]?key)\s*[=:]\s*['\"]?[A-Za-z0-9+/]{32,}"),
    "bearer token": re.compile(r"(?i)bearer\s+eyJ[A-Za-z0-9_-]{20,}"),
    "jwt": re.compile(r"eyJ[A-Za-z0-9_-]{20,}\.eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}"),
    "connection string": re.compile(r"(?i)(AccountKey|SharedAccessKey)=[A-Za-z0-9+/=]{20,}"),
    "openai key": re.compile(r"\bsk-(proj-)?[A-Za-z0-9_-]{32,}"),
    "entra client secret": re.compile(r"(?<![A-Za-z0-9_~.-])[A-Za-z0-9_~.-]{3}[0-9]Q~[A-Za-z0-9_~.-]{30,}"),
    "azure sas signature": re.compile(r"[?&]sig=[A-Za-z0-9%/+=]{30,}"),
    "github token": re.compile(r"\b(gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{50,})"),
    "aws access key": re.compile(r"\bAKIA[0-9A-Z]{16}\b"),
    "google api key": re.compile(r"\bAIza[0-9A-Za-z_-]{35}\b"),
    "slack token": re.compile(r"\bxox[abprs]-[A-Za-z0-9-]{10,}"),
    # identifiers (not credentials, but never published)
    "azure ai resource hostname": re.compile(
        r"(?<![A-Za-z0-9<{-])[a-z0-9][a-z0-9-]{1,62}\.(services\.ai|openai|cognitiveservices)\.azure\.com"),
    "tenant or subscription id": re.compile(rf"(?i)(tenant|subscription)[_ -]?id['\"]?\s*[=:]\s*['\"]?{GUID}"),
}
FORBIDDEN_FILES = re.compile(r"(^|/)\.env$|(^|/)\.env\.(?!example$)[^/]+$|\.pem$|\.pfx$|\.p12$|(^|/)\.azure/"
                             r"|(^|/)model_call_ledger\.json$")
# binaries, lockfile hashes, and compiled bytecode (never committed or shipped; the compiler folds the test
# canaries' split string literals back together)
SKIP = re.compile(r"package-lock\.json$|\.(png|jpe?g|gif|webp|gz|woff2?|ttf|otf|ico|mp4|webm|pyc)$|(^|/)__pycache__/")


def scan_text(text: str) -> list[str]:
    return [name for name, pat in PATTERNS.items() if pat.search(text)]


def scan_tracked() -> tuple[int, list[str]]:
    files = subprocess.run(["git", "ls-files", "-z"], cwd=ROOT, capture_output=True, text=True,
                           check=True).stdout.split("\0")
    files = [f for f in files if f]
    problems: list[str] = []
    for f in files:
        if FORBIDDEN_FILES.search(f):
            problems.append(f"{f}: file type must never be committed")
            continue
        if SKIP.search(f):
            continue
        try:
            text = (ROOT / f).read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue
        problems += [f"{f}: possible {name}" for name in scan_text(text)]
    return len(files), problems


def scan_dir(folder: Path) -> tuple[int, list[str]]:
    problems: list[str] = []
    files = [p for p in folder.rglob("*") if p.is_file()]
    for p in files:
        rel = p.relative_to(folder).as_posix()
        if FORBIDDEN_FILES.search(rel):
            problems.append(f"{rel}: file type must never be shipped")
            continue
        if SKIP.search(rel):
            continue
        text = p.read_text(encoding="utf-8", errors="ignore")
        problems += [f"{rel}: possible {name}" for name in scan_text(text)]
    return len(files), problems


def _history_lines() -> Iterator[str]:
    proc = subprocess.Popen(["git", "log", "--all", "-p", "--no-color", "--no-ext-diff", "--format=@@COMMIT %h"],
                            cwd=ROOT, stdout=subprocess.PIPE, text=True, encoding="utf-8", errors="ignore")
    assert proc.stdout is not None
    yield from proc.stdout
    if proc.wait() != 0:
        raise RuntimeError("git log failed")


def scan_history() -> tuple[int, list[str]]:
    """Every added line of every commit reachable from any ref; plus any forbidden file ever added."""
    problems: set[str] = set()
    commits = 0
    commit, path = "?", "?"
    for line in _history_lines():
        if line.startswith("@@COMMIT "):
            commit, commits = line.split()[1], commits + 1
        elif line.startswith("+++ "):
            path = line[6:].rstrip("\n") if line.startswith("+++ b/") else line[4:].rstrip("\n")
        elif line.startswith("+") and not SKIP.search(path):
            for name in scan_text(line):
                problems.add(f"{commit} {path}: possible {name}")
    added = subprocess.run(["git", "log", "--all", "--diff-filter=A", "--name-only", "--format=@@COMMIT %h"],
                           cwd=ROOT, capture_output=True, text=True, check=True).stdout.splitlines()
    commit = "?"
    for line in added:
        if line.startswith("@@COMMIT "):
            commit = line.split()[1]
        elif line and FORBIDDEN_FILES.search(line):
            problems.add(f"{commit} {line}: file type must never be committed")
    return commits, sorted(problems)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    mode = ap.add_mutually_exclusive_group()
    mode.add_argument("--history", action="store_true", help="scan every commit reachable from any ref")
    mode.add_argument("--dir", type=Path, help="scan every file under this directory (e.g. a build output)")
    a = ap.parse_args(argv)
    if a.history:
        n, problems = scan_history()
        what = f"{n} commits (all refs)"
    elif a.dir is not None:
        if not a.dir.is_dir():
            print(f"secret scan: {a.dir} is not a directory")
            return 2
        n, problems = scan_dir(a.dir)
        what = f"{n} files under {a.dir.as_posix()}"
    else:
        n, problems = scan_tracked()
        what = f"{n} tracked files"
    for p in problems:
        print("SECRET-SCAN:", p)
    print(f"secret scan: {what}, {len(problems)} findings")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
