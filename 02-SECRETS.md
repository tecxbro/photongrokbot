# Secrets and private configuration

The bot obtains credentials from authorized CLI/native-tool outputs and writes them privately. Never ask the user to paste project secrets, webhook bearers, publisher tokens or authorization headers into chat. Device-login verification URL and short user code are the intended human approval surface, not bridge credentials.

The resolver selects a private `/workspace` instance outside code. `secrets/bridge.env` is authoritative and replaces stale shell values for its allowlisted configuration. Parsing accepts one literal key=value per line: no shell evaluation, duplicate keys, unknown keys or unresolved values. Do not source the file or print process environments.

| Key | Origin |
| --- | --- |
| SPECTRUM_PROJECT_ID / SPECTRUM_PROJECT_SECRET | Verified selected Photon project; the project secret is not the CLI login token. |
| AUTHORIZED_SENDER_ID | Exact authorized incoming sender identity; different from the hosted line users text. |
| GROK_ORCHESTRATOR_WEBHOOK_URL / GROK_ORCHESTRATOR_WEBHOOK_KEY | Actual Front Door routine-create/read result; URL and bearer remain private. |

Use `bun run setup-state -- write-bridge-env --json-stdin` from `bridge/`, with a bounded JSON object `{ "text": "the complete literal environment text" }` from the secure setup executor. Existing credentials are preserved; a normal rerun must not rotate or overwrite them. This placeholder describes a tool input, not a token to paste. Provider create intents/receipts are recorded before and after actual authorized operations; uncertain creation must be reconciled before another attempt.

Explicitly enabled Live Mini uses `secrets/live-mini.env` for `PUBLIC_BASE_URL` and `PUBLISHER_TOKEN`. The host's Blob token and distinct view-signing secret stay in its authorized deployment environment. Configure through `bun run setup-state -- write-live-env --json-stdin` with the same text envelope after `authorize-live-mini --authorized`. Environment revision precedes deployment. Preserve existing keys, project, storage namespace and historical URLs.

Private directories are 0700 and files 0600 (immutable migration evidence may be stricter). Symlinks, traversal, checkout state and conflicting path overrides are refused. Ignore rules prevent future accidental additions; they do not remove tracked files or invalidate already exposed credentials. If exposure is discovered, report it privately and follow an explicitly authorized incident response. Do not rotate credentials during an ordinary repair or setup retry.

See [privacy](docs/product-repair/PRIVACY.md), [setup](skills/getting-started/SKILL.md) and [configuration example](bridge/.env.example). No production credential or private environment was inspected in this repair.
