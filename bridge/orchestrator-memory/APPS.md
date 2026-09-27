# Apps — Spectrum iMessage app cards

## Bridge contract (live)

Full-sheet (static) and Spectrum live app URLs share one enqueue shape. **Bridge flags are live** — enqueue with `--app-url` / `--live` / `--app-update` as below. Low-level enqueue is URL + live/update only.

**Note (2026-09-26 / pack update):** The in-bridge publisher (`src/live-task-cards.ts`, `LIVE_CARDS_*`) was **removed** from the Spectrum runtime. Do not call `getLiveCards()`. Optional rebuild sources ship in pack folder **`live-mini/`** (scrubbed live-task-cards + dot-matrix). Wire via `examples/existing-runtime.mjs` or `live-mini/runtime/`, and optionally CreateAgent from `agents/live-mini/` → `{{LIVE_MINI_BOT_ID}}`.

Photon refs: spectrum-ts content/app and providers/imessage/messaging-features/apps.

### Static full-sheet (App Sheet Bot `{{APP_SHEET_BOT_ID}}`)

```bash
bun run enqueue -- --space-id "<spaceId>" --app-url "https://example.com/deep-link"
```

Spectrum: `space.send(app(url))` — tappable full-sheet card. URL must be absolute `http://` or `https://`.

Or: `enqueueOutbound({ kind: "app", spaceId, url })`.

### Live app URL (optional Spectrum `{ live: true }`)

First send:

```bash
bun run enqueue -- --space-id "<spaceId>" --app-url "https://example.com/dashboard" --live
```

Spectrum: `space.send(app(url, { live: true }))`.

In-place update (same bubble; needs prior app message id from a successful send):

```bash
bun run enqueue -- --space-id "<spaceId>" --app-update "<messageId>" --app-url "https://example.com/dashboard" --live
```

Spectrum: `space.getMessage(id)` then `space.send(edit(app(newUrl, { live: true }), message))`.

Or: `enqueueOutbound({ kind: "app_update", spaceId, url, live: true, targetMessageId })`.

Rules:
- URL must be absolute `http://` or `https://` after trim.
- `--live` for Spectrum live app updates (omit for static full-sheet).
- `--app-update` requires a prior outbound app `messageId` from a successful send.
- Low-level path is URL + live/update only. Optional task-progress card host sources are under pack `live-mini/` (not auto-wired into the bridge).

### Session storage for updates

After a successful `app` send, the runtime persists iMessage `miniAppCardSession` (when present on the returned Message) to `data/app-card-sessions.json` keyed by message id. On `app_update`, if `getMessage` lacks the session, the runtime attaches the stored session onto the Message before `edit(...)`.

**Limitation:** if neither the in-memory Spectrum message cache nor `app-card-sessions.json` has a session (e.g. send happened before this feature, or the provider omitted session metadata), in-place edit will fail at send time. Re-send a live app card, then update using the new message id.

## When agents should use which

| Intent | Owner | Shape |
|---|---|---|
| Live URL / live-task-cards progress | Live Mini Bot `{{LIVE_MINI_BOT_ID}}` (optional; see `live-mini/`) | `--app-url` + `--live`; prefer same-URL JSON updates over `--app-update` for task cards |
| Tappable full-sheet card (no live updates) | App Sheet Bot `{{APP_SHEET_BOT_ID}}` | `--app-url` only |
| Visual option stacks | Photon Image Cards `{{IMAGE_CARDS_BOT_ID}}` | attachment groups |
| Bounded label picks | Front Door / poll path | `POLLS.md` |
| Plain link in chat | Front Door text | `--text` with URL |

Prefer an app card over a bare URL when the desired UX is the Spectrum iMessage App launcher sheet (static or live).

## Delivery

Final user-facing enqueue remains Front Door `{{FRONT_DOOR_BOT_ID}}` until specialist direct send is verified. Specialists return ready-to-send app payloads (spaceId + url + live/update fields) to Front Door — they do not self-enqueue.

## Stuck / blocked

If live send/update fails: fall back to static App Sheet (`{{APP_SHEET_BOT_ID}}`) or short text + URL via Front Door. Do not burn tokens retrying. Feature Add owns bridge capability; Creator owns repairs.

## Architecture note

Apps do **not** change Step 2/3 routing or delivery owners. Front Door still final-enqueues (until direct send is verified). Feature Add owns bridge capability; Creator owns repairs. Live Mini Bot and App Sheet Bot own specialist UX and this contract — not bridge code.
