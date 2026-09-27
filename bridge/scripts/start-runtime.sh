#!/usr/bin/env bash
set -euo pipefail
cd "$(cd "$(dirname "$0")/.." && pwd)"
unset SPECTRUM_PROJECT_ID SPECTRUM_PROJECT_SECRET
while IFS= read -r line || [ -n "$line" ]; do
  case "$line" in
    ''|\#*) continue ;;
    SPECTRUM_PROJECT_ID=*|SPECTRUM_PROJECT_SECRET=*|AUTHORIZED_SENDER_ID=*|GROK_ORCHESTRATOR_WEBHOOK_URL=*|GROK_ORCHESTRATOR_WEBHOOK_KEY=*)
      export "$line"
      ;;
  esac
done < .env
echo "[start] SPECTRUM_PROJECT_ID=$SPECTRUM_PROJECT_ID"
exec bun run src/index.ts
