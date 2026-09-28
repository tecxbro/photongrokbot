#!/usr/bin/env bash
set -euo pipefail
cd "$(cd "$(dirname "$0")/.." && pwd)"
# config.ts resolves the one authoritative private file. The runtime owns the
# lifetime singleton lock; exec preserves signal delivery and exit status.
exec bun run start
