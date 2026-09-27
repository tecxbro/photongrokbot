#!/usr/bin/env python3
"""Copy the self-contained dot-matrix card starter into a new directory."""
import argparse
from pathlib import Path
import shlex
import shutil


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('destination', type=Path, help='New output directory; existing paths are never overwritten')
    args = parser.parse_args()
    destination = args.destination.expanduser().resolve()
    source = Path(__file__).resolve().parents[1] / 'assets' / 'starter'
    if destination.exists():
        parser.error(f'Destination already exists: {destination}. Choose a new directory or adapt the existing app manually.')
    shutil.copytree(source, destination)
    print(f'Created {destination}')
    print(f'Open {destination / "index.html"} directly in a browser.')
    print(f'Optional local server: python3 -m http.server --bind 127.0.0.1 --directory {shlex.quote(str(destination))}')
    print('A is the default; compare.html includes A and B. Fixture data is in mini-demo.js.')


if __name__ == '__main__':
    main()
