# Architecture — Photon ↔ Grok iMessage bridge

## Components

| Piece | Location / tech | Role |
|---|---|---|
| iPhone | Owner's Messages | User surface |
| Photon hosted iMessage | Spectrum Cloud | Provider |
| Spectrum bridge | `bridge/` Bun + `spectrum-ts` | Inbound auth/dedupe/batch, webhook, outbound drain |
| Grok Front Door | `{{FRONT_DOOR_BOT_ID}}` | Webhook consumer; Step 2 answer or Step 3 route; final enqueue |
| Master Orchestrator | `{{ORCHESTRATOR_BOT_ID}}` | Multi-owner coordination only |
| Creator | `{{CREATOR_BOT_ID}}` | Bridge bugfixes |
| Feature Add | `{{FEATURE_ADD_BOT_ID}}` | Bridge new features |
| Image Cards | `{{IMAGE_CARDS_BOT_ID}}` | Editorial visual option stacks |
| App Sheet | `{{APP_SHEET_BOT_ID}}` | Static full-sheet `app(url)` cards |
| Live Mini (optional) | `{{LIVE_MINI_BOT_ID}}` + `live-mini/` | Live task cards / matrix; `--app-url --live` + hosted JSON |
| Moonshine STT (**required**) | `.venv-moonshine` + ORT weights (downloaded; not in tarball) | Inbound voice → `transcript` |

Id / batch prefix example: `{{DEPLOY_ID_PREFIX}}` (choose your own).

## Message flow

```
iPhone
  → Photon hosted iMessage
  → Spectrum bridge (bun run start / ./scripts/start-runtime.sh)
  → auth + dedupe + shape (text/reaction/poll_vote/attachment/voice+STT)
  → debounce quiet → data/unread/<batchId>.json
  → optional runtime-greeting fast-path
  → POST {"batchId"} + Bearer → Front Door "Photon iMessage wake" ({{PHOTON_WAKE_ROUTINE_ID}})
  → Front Door: Step 0 react|no-react|effect
       → Step 2 direct-answer
       OR one-specialist (Image Cards / App Sheet / optional Live Mini / Creator / Feature Add / your specialists)
       OR Master Orchestrator (coordinated only)
  → bun run enqueue → data/outbound-queue.json
  → runtime → Spectrum → iMessage
```

Webhook body is **only** `{"batchId":"..."}` — never message text or Spectrum secrets.

## Data layout (bridge `data/`)

```text
data/
  .gitkeep
  inbound.jsonl / inbound/<id>.json
  handled-ids.json
  unread/<batchId>.json
  webhook-pending.json
  outbound-queue.json / outbound.jsonl
  inbound-attachments/<messageId>/…
  cards-ready/
  models/moonshine/small-streaming-en/quantized_26_08_21/   # STT required — bot downloads (not in pack)
```

## Outbound kinds (`bun run enqueue`)

| kind | Flags |
|---|---|
| text (default) | `--space-id` `--text` |
| reply | `--reply-to` `--text` |
| react | `--react` `--target` |
| effect | `--text` `--effect <name>` |
| poll | `--poll-title` repeated `--option` |
| voice | `--voice` (audio-message bubble) |
| typing | `--typing start\|stop` |
| attachment | `--attachment` (+ optional `--text`) |
| attachment group | multiple attachments / cards-ready path (see `ATTACHMENTS.md`) |
| app sheet | `--app-url` |
| live app (optional; see `live-mini/`) | `--app-url … --live` / `--app-update` |

## Inbound kinds

`text`, `reaction`, `poll_vote`, `attachment`, `voice` (+ `transcript` from Moonshine when installed).

## Live Mini (optional)

Scrubbed sources live under `live-mini/` (live-task-cards host, grokbot-matrix / dot-matrix animation, install + Blob CAS notes, optional VM milestone helper). Front Door already routes live-mini intents to `{{LIVE_MINI_BOT_ID}}`. Preferred progress model: **one** Spectrum live send, then JSON updates at the **same URL** (not Spectrum `edit`). Details: `live-mini/README.md`, `bridge/orchestrator-memory/APPS.md`.

## Collaboration rules

- **Front Door** is the only user-facing speaker until other roles pass direct-enqueue verification.
- **Creator** = fixes; **Feature Add** = new features; never mix.
- **Orchestrator** only when multi-owner / dependencies / cross-task coordination is required.
- Never dual-send. Never put Spectrum secrets in chat.
- Domain specialists (housing, hotels, …) are **adopter-created** — not shipped.

## Diagram (prose)

```
[Owner iPhone]
      |
      v
[Photon / Spectrum Cloud] ---- secrets in bridge .env only
      |
      v
[Bun bridge runtime] --unread batch--> [Front Door webhook]
      ^                                      |
      | enqueue                              +--> Step 2 answer
      |                                      +--> Image Cards / App Sheet / …
      |                                      +--> Orchestrator --> specialists
      +--------------------------------------+
```
