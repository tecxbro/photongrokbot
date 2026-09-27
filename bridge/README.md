# {{DEPLOY_ID_PREFIX}} — Grok x Photon Spectrum proof runtime

Small detached Spectrum runtime using the **official published** `spectrum-ts` package and Photon’s **hosted** iMessage provider (`spectrum-ts/providers/imessage`). It does **not** use `@spectrum-ts/imessage-local`, does **not** clone Spectrum source, and does **not** use the Photon CLI token as the app credential.

Prefix for generated ids: `{{DEPLOY_ID_PREFIX}}`.

> **Adopter setup:** the imported Front Door bot runs `skills/getting-started` on the Spectrum **free plan** and handles the agent-VM setup (Photon CLI, project `grokbot`, hosted bot line, env fill, mandatory Moonshine STT, webhook). Humans are not expected to perform setup from this runtime README.


## Start

```bash
cd {{BRIDGE_ROOT}}
cp .env.example .env
chmod 0600 .env
# fill SPECTRUM_PROJECT_ID, SPECTRUM_PROJECT_SECRET, AUTHORIZED_SENDER_ID,
# GROK_ORCHESTRATOR_WEBHOOK_URL, GROK_ORCHESTRATOR_WEBHOOK_KEY
bun install
bun run start
```

Do not put secrets in source files. The Photon CLI device token (`PHOTON_TOKEN` / `photon login`) is for dashboard/CLI only. This process authenticates with **project id + project secret** only.

## Env

| Name | Purpose |
|---|---|
| `SPECTRUM_PROJECT_ID` | Spectrum Cloud project id |
| `SPECTRUM_PROJECT_SECRET` | Spectrum Cloud project secret (Basic auth for the SDK/API) |
| `AUTHORIZED_SENDER_ID` | Exact `message.sender.id` allowed through (E.164 or Apple ID email) |
| `GROK_ORCHESTRATOR_WEBHOOK_URL` | Orchestrator POST target |
| `GROK_ORCHESTRATOR_WEBHOOK_KEY` | Bearer token for that POST |

On the Spectrum **free plan**, also register that sender as a Spectrum **user** on the project (`photon spectrum users add` or Dashboard → Users). Discover the exact Apple handle via https://debug.photon.codes if needed.

## What it does

1. `Spectrum({ projectId, projectSecret, providers: [imessage.config()] })` receives hosted iMessages over gRPC.
2. Drops outbound echoes, non-iMessage, and any sender whose id is not `AUTHORIZED_SENDER_ID`.
3. Deduplicates on Photon `message.id` (`data/handled-ids.json`). Composite reaction ids (`…:reaction:…`) are unique and go through the same path.
4. Collects authorized **text, reactions, poll votes, and attachments** into a pending batch; after **2 seconds of quiet**, flushes. Reactions are stored with `kind: "reaction"`, `emoji`, optional `targetMessageId`, and display `text` like `reacted ❤️`. Authorized inbound text/reactions are marked read immediately via `message.read()` (chat-level read receipt on hosted iMessage). Inbound `content.type === "read"` (recipient read our outbound) is ignored — marked handled, never queued, never wakes Grok.
5. Flush writes `data/unread/<batchId>.json` (full records) then POSTs **only** `{"batchId":"..."}` to the orchestrator webhook (`Authorization: Bearer …`). Message text is never placed in the webhook body. Best-effort `space.startTyping()` runs on involved spaces until the first outbound send or ~30s.
6. A cards-ready watchdog (~3s) final-enqueues image stacks when `data/cards-ready/<batchId>.json` appears or pending Image Cards assets under `data/outbound-assets/` are complete (see `orchestrator-memory/ATTACHMENTS.md`). Idempotent vs Front Door enqueue.
7. A watcher loop drains `data/outbound-queue.json` and sends each item: plain `space.send`, Spectrum `group(attachment…)` for `attachment_group` (iMessage `sendMultipart`), threaded `message.reply`, `message.react`, `poll(...)`, `app(...)` / `edit(app(...))`, or typing start/stop. Spaces are cached from inbound, else `imessage(app).space.get(spaceId)`.
8. Text items are marked `sent` only when `send()` resolves to a Message. Replies try `message.reply()` first, then fall back once to `space.send(text)` when the target is missing/unreplyable or reply returns `undefined`; if the fallback also fails, the item is terminally `failed`. React treats platform skip (`undefined`) as done. `undefined`/throw on text leaves the item queued with backoff.

This process never reads Grok transcripts. Voice/SIP is out of scope (see `prompts/voice-policy.md` for composition voice only).

## Data layout (orchestrator contract)

All paths are under `{{BRIDGE_ROOT}}/data`. Writes are atomic (temp file + rename) except jsonl appends which are `O_APPEND` + fsync.

```
data/
  inbound.jsonl                 append-only inbound log
  inbound/<messageId>.json      one file per inbound record
  handled-ids.json              { "ids": ["..."] }
  pending-batch.json            in-flight debounce buffer (crash recovery)
  unread/<batchId>.json         flushed unread batch (orchestrator reads this)
  webhook-pending.json          batchIds whose webhook has not succeeded
  outbound-queue.json           { "items": [OutboundItem, ...] }
  outbound.jsonl                audit log of enqueue/update
```

Inbound record:

```json
{
  "id": "photon-message-id",
  "spaceId": "spectrum-space-id",
  "senderId": "sender-handle",
  "text": "message text",
  "timestamp": "2026-09-18T18:00:00.000Z",
  "receivedAt": "2026-09-18T18:00:00.000Z",
  "kind": "text"
}
```

Attachment inbound (same batch as text):

```json
{
  "id": "…",
  "spaceId": "spectrum-space-id",
  "senderId": "sender-handle",
  "text": "[attachment] shot.jpg (image/jpeg, 1234 bytes)",
  "kind": "attachment",
  "attachmentPath": "{{BRIDGE_ROOT}}/data/inbound-attachments/…/shot.jpg",
  "attachmentName": "shot.jpg",
  "attachmentMimeType": "image/jpeg",
  "attachmentBytes": 1234,
  "timestamp": "…",
  "receivedAt": "…"
}
```

Poll vote inbound (same batch as text):

```json
{
  "id": "…",
  "spaceId": "spectrum-space-id",
  "senderId": "sender-handle",
  "text": "voted Pizza on \"Lunch?\"",
  "kind": "poll_vote",
  "pollTitle": "Lunch?",
  "pollOption": "Pizza",
  "pollSelected": true,
  "timestamp": "…",
  "receivedAt": "…"
}
```

Reaction inbound (same batch as text):

```json
{
  "id": "…:reaction:…",
  "spaceId": "spectrum-space-id",
  "senderId": "sender-handle",
  "text": "reacted ❤️",
  "kind": "reaction",
  "emoji": "❤️",
  "targetMessageId": "original-message-id",
  "timestamp": "…",
  "receivedAt": "…"
}
```

Unread batch (`data/unread/<batchId>.json`):

```json
{
  "batchId": "{{DEPLOY_ID_PREFIX}}-b-...",
  "flushedAt": "2026-09-18T18:00:02.000Z",
  "messages": [ { "id": "...", "spaceId": "...", "senderId": "...", "text": "...", "timestamp": "...", "receivedAt": "..." } ]
}
```

Outbound items (discriminated by `kind`; missing `kind` = text for backward compat):

```json
{ "id": "{{DEPLOY_ID_PREFIX}}-o-...", "kind": "text", "spaceId": "...", "text": "hello", "status": "queued", "attempts": 0, "createdAt": "…" }
{ "id": "{{DEPLOY_ID_PREFIX}}-o-...", "kind": "reply", "spaceId": "...", "targetMessageId": "...", "text": "got it", "status": "queued", "attempts": 0, "createdAt": "…" }
{ "id": "{{DEPLOY_ID_PREFIX}}-o-...", "kind": "react", "spaceId": "...", "targetMessageId": "...", "emoji": "❤️", "status": "queued", "attempts": 0, "createdAt": "…" }
{ "id": "{{DEPLOY_ID_PREFIX}}-o-...", "kind": "typing", "spaceId": "...", "state": "start", "status": "queued", "attempts": 0, "createdAt": "…" }
```

### Read helper

```bash
bun run read-batch -- {{DEPLOY_ID_PREFIX}}-b-<id>
```

Prints the unread batch JSON on stdout. Same as reading `data/unread/<batchId>.json`.

### Enqueue helper (orchestrator → runtime)

```bash
# Plain text (bubble-split + proof-marker guard)
bun run enqueue -- --space-id "<spaceId>" --text "hello"

# Optional attachment
bun run enqueue -- --space-id "<spaceId>" --text "see tee" --attachment /tmp/tee.png

# Threaded reply (resolves target via space.getMessage then message.reply)
bun run enqueue -- --space-id "<spaceId>" --reply-to "<messageId>" --text "got it"
# Poll follow-up acknowledgments: use plain --text, never --reply-to the poll/poll-vote id
bun run enqueue -- --space-id "<spaceId>" --text "Got it — Pizza."

# Tapback / reaction
bun run enqueue -- --space-id "<spaceId>" --react "❤️" --target "<messageId>"

# Typing indicator
bun run enqueue -- --space-id "<spaceId>" --typing start
bun run enqueue -- --space-id "<spaceId>" --typing stop
bun run enqueue -- --space-id "<spaceId>" --poll-title "Lunch?" --option Pizza --option Sushi --option Tacos
bun run enqueue -- --space-id "<spaceId>" --voice /path/to/note.m4a

# Full-sheet iMessage app card (Spectrum app(url))
bun run enqueue -- --space-id "<spaceId>" --app-url "https://example.com/deep-link"

# Live mini app
bun run enqueue -- --space-id "<spaceId>" --app-url "https://example.com/dashboard" --live

# In-place update of a previously sent live app card
bun run enqueue -- --space-id "<spaceId>" --app-update "<messageId>" --app-url "https://example.com/dashboard" --live

**When to use polls:** bounded selections only — see `orchestrator-memory/POLLS.md`. Open-ended questions stay ordinary text.
**When to use apps:** full-sheet vs live — see `orchestrator-memory/APPS.md`.
```

Or append an `OutboundItem` with `"status": "queued"` onto `data/outbound-queue.json` (keep valid JSON; the runtime rewrites this file atomically).

Webhook the runtime sends:

```http
POST <GROK_ORCHESTRATOR_WEBHOOK_URL>
Authorization: Bearer <GROK_ORCHESTRATOR_WEBHOOK_KEY>
Content-Type: application/json

{"batchId":"{{DEPLOY_ID_PREFIX}}-b-..."}
```

## Hosted iMessage notes

- Package: `spectrum-ts` (batteries-included; includes `@spectrum-ts/imessage`).
- Import: `import { imessage } from "spectrum-ts/providers/imessage"` then `imessage.config()` with empty config so Spectrum Cloud discovers lines and renews tokens from project credentials.
- Do not pass explicit line tokens. Do not install or import `@spectrum-ts/imessage-local`.
- Runtime: Node.js or Bun (cloud iMessage uses Node-compatible gRPC).
- Reactions/replies need cloud iMessage; `space.getMessage(id)` is required to materialize a `Message` before `react`/`reply` when only an id is known.

## Scripts

| Script | Command |
|---|---|
| Start runtime | `bun run start` |
| Read unread batch | `bun run read-batch -- <batchId>` |
| Enqueue outbound | `bun run enqueue -- --space-id <id> --text <text>` |
| Enqueue reply | `bun run enqueue -- --space-id <id> --reply-to <msgId> --text <text>` |
| Enqueue react | `bun run enqueue -- --space-id <id> --react <emoji> --target <msgId>` |
| Enqueue typing | `bun run enqueue -- --space-id <id> --typing start\|stop` |
| Enqueue poll | `bun run enqueue -- --space-id <id> --poll-title <q> --option <a> --option <b>` |
| Enqueue voice | `bun run enqueue -- --space-id <id> --voice <audioPath>` |
| Enqueue app | `bun run enqueue -- --space-id <id> --app-url <url> [--live]` |
| Enqueue app update | `bun run enqueue -- --space-id <id> --app-update <msgId> --app-url <url> [--live]` |
