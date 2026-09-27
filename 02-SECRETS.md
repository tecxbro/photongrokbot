# Secrets — key names (bot obtains values)

**Do not** ask the adopter to hand-edit `.env` as the primary path. The imported bot fills these via Photon CLI outputs, CreateRoutine results, and one phone ask when needed. **Never** commit real values into a share pack or git repo.

## Bridge `.env` (from `bridge/.env.example`)

| Key | What it is | How the **bot** obtains it |
|---|---|---|
| `SPECTRUM_PROJECT_ID` | Spectrum Cloud project id | `photon projects create --name "grokbot" --spectrum` (or `grokbot-A`…`Z`) then `photon projects show --json` / `export PHOTON_PROJECT_ID=…` |
| `SPECTRUM_PROJECT_SECRET` | Project secret (Basic auth for `spectrum-ts`) | Shown on create / `photon projects show`; rotate with `photon projects regenerate-secret` if needed. **Not** the Photon CLI device token (`PHOTON_TOKEN` / `photon login`). |
| `AUTHORIZED_SENDER_ID` | Exact `message.sender.id` allowed through | Prefer number already visible after CLI login (`photon whoami`, `photon spectrum users ls`, `photon spectrum lines ls`). Else ask adopter once in E.164, e.g. `+19876543210`. Register as Spectrum **user** (`photon spectrum users add`). |
| `GROK_ORCHESTRATOR_WEBHOOK_URL` | Front Door wake webhook URL | Bot creates Front Door routine **Photon iMessage wake**; copies URL ending `/webhook/{{PHOTON_WAKE_ROUTINE_ID}}`. |
| `GROK_ORCHESTRATOR_WEBHOOK_KEY` | Bearer for that POST | Same routine’s webhook secret. Runtime sends `Authorization: Bearer <key>` with body `{"batchId":"..."}` only. |

```bash
cd "{{BRIDGE_ROOT}}"   # bot-chosen path after copying pack bridge/
cp .env.example .env
chmod 0600 .env
# bot writes values from CLI / routine — never paste secrets into adopter chat
```

`./scripts/start-runtime.sh` loads only the keys above from `.env` and **unsets** any shell-exported Spectrum vars that could override the file.

## Webhook routine secrets

In `routines/photon-imessage-wake.REDACTED.json`:

- `webhookUrl` → `REDACTED` until CreateRoutine
- `webhookBearer` → `REDACTED` (bot pastes into `GROK_ORCHESTRATOR_WEBHOOK_KEY`)

## Optional Live Mini host (only if deploying `live-mini/`)

Set on the **Vercel** project (and optionally a local chmod-600 env file) — never in chat or this pack:

| Key | Purpose |
|---|---|
| `PUBLIC_BASE_URL` | Stable production origin for card URLs |
| `STORE` | `blob` (recommended) or `redis` |
| `BLOB_READ_WRITE_TOKEN` | Private Vercel Blob read-write token |
| `BLOB_PATHNAME` | Registry key, e.g. `live-task-cards:v1:{{SETUP_NAME}}.json` |
| `PUBLISHER_TOKEN` | Writer secret (≥32 chars) |
| `VIEW_SIGNING_SECRET` | Per-card read capability signing (≥32 chars) |

Photon / Spectrum credentials stay in the bridge `.env` only — not on the card host.

## Intentionally not included anywhere in this pack

- Live `.env` values
- Bearer / project secret / webhook key material
- Runtime queues, inbound attachments, logs, pids
- STT `.ort` / `tokenizer.bin` (bot downloads per `stt/INSTALL.md`)
- `node_modules/`, `.venv-moonshine/`
- Personal phone numbers, Apple IDs, real spaceIds
- Live Mini Blob / publisher / view tokens and migration upload JSON

Placeholders like `{{WEBHOOK_BEARER}}` are intentional — substitute only in the private `.env` on the agent VM.
