#!/usr/bin/env python3
"""Thin CLI → tools/moonshine_stt.py using the repo venv when available."""
from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
VENV_PY = ROOT / ".venv-moonshine" / "bin" / "python"
STT = ROOT / "tools" / "moonshine_stt.py"

def main() -> int:
    py = str(VENV_PY) if VENV_PY.is_file() else sys.executable
    cmd = [py, str(STT), *sys.argv[1:]]
    return subprocess.call(cmd)

if __name__ == "__main__":
    raise SystemExit(main())
