#!/usr/bin/env python3
"""Thin CLI using the canonical private instance's installed Moonshine runtime."""
from __future__ import annotations
import json
import os
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
STT = ROOT / 'bridge' / 'tools' / 'moonshine_stt.py'

def main() -> int:
    # Node/Bun executes the same resolver used by the bridge and Live Mini helper.
    module_url = (ROOT / 'shared' / 'instance-paths.mjs').as_uri()
    script = 'import {resolveInstancePaths} from ' + json.dumps(module_url) + '; console.log(JSON.stringify(resolveInstancePaths()))'
    try:
        result = subprocess.run(['bun', '--eval', script], capture_output=True, text=True, timeout=10, check=True)
        paths = json.loads(result.stdout)
        python = Path(paths['toolsDir']) / 'moonshine-venv' / 'bin' / 'python'
        model = Path(paths['modelsDir']) / 'moonshine' / 'small-streaming-en' / 'quantized_26_08_21'
        if not python.is_file() or not model.is_dir():
            raise ValueError('mandatory runtime unavailable')
        args = sys.argv[1:]
        if '--model' not in args:
            args = ['--model', str(model), *args]
        os.execv(str(python), [str(python), str(STT), *args])
    except Exception:
        print(json.dumps({'error': 'MOONSHINE_PRIVATE_RUNTIME_UNAVAILABLE', 'text': ''}))
        return 1
    return 1

if __name__ == '__main__':
    raise SystemExit(main())
