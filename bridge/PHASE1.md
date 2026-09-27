# Phase 1 — landed (2026-09-18 PT)

Gaps closed in the existing `{{DEPLOY_ID_PREFIX}}` bridge (no new project).

## What landed

1. **Inbound reactions** — `runtime.ts` no longer drops non-text blindly. `content.type === "reaction"` is shaped via `inbound.ts` into `InboundRecord` with `kind: "reaction"`, `emoji`, optional `targetMessageId`, and display `text` like `reacted ❤️`. Same auth + `message.id` dedupe; reactions join pending batch / unread flush so Grok sees tapbacks.
2. **Outbound queue schema** — Discriminated `OutboundItem`: `text` (default if `kind` missing), `reply`, `react`, `typing`. `enqueueOutbound` takes `EnqueueOutboundInput`.
3. **sendOutbound** — Resolves space; reply/react use `space.getMessage(id)` then `message.reply` / `message.react`; typing uses `startTyping`/`stopTyping`. Text + attachment path unchanged.
4. **Typing on flush** — After unread flush, best-effort `startTyping` on involved spaces; stop on first text/reply/react send or ~30s (`TYPING_TIMEOUT_MS`).
5. **Enqueue CLI** — `--reply-to`, `--react` + `--target`, `--typing start|stop` in addition to `--space-id` / `--text` / `--attachment`.
6. **Tests** — `outbound-text.test.ts` unchanged contract; new `inbound.test.ts` for reaction shaping.
7. **README** — Documents new flags and reaction inbound shape.

## Deferred / untouched

- Spectrum HTTPS webhooks (`app.webhook`)
- Voice/SIP calls
- Voice policy (`prompts/voice-policy.md`) composition rules unchanged
- `.env` secrets untouched

## How to enqueue

```bash
bun run enqueue -- --space-id "<spaceId>" --text "hello"
bun run enqueue -- --space-id "<spaceId>" --reply-to "<messageId>" --text "got it"
bun run enqueue -- --space-id "<spaceId>" --react "❤️" --target "<messageId>"
bun run enqueue -- --space-id "<spaceId>" --typing start
bun run enqueue -- --space-id "<spaceId>" --poll-title "Lunch?" --option Pizza --option Sushi
```

## Spectrum API quirks noted

- `space.getMessage(id)` is required before react/reply when only an id is known. For replies, a missing target or failed/undefined `message.reply()` falls back once to `space.send(text)`; failed fallback is terminally dead-lettered.
- `message.react` / `space.send(reaction(...))` may resolve `undefined` when the platform skips reactions — we mark react items sent (avoid infinite retry).
- `startTyping`/`stopTyping` are fire-and-forget (`Promise<void>`); typing queue items always mark sent on resolve.
- iMessage tapbacks: prefer `Emoji.love` etc. or raw emoji strings; cloud iMessage required for reactions.

## Mark-as-read (follow-on)

- On accepted inbound text/reaction: best-effort `await message.read()` so the sender sees a read receipt without waiting for Grok.
- Inbound `content.type === "read"` is marked handled and ignored (no queue, no wake).

## Greeting fast-path
- `src/greeting.ts`: match casual hi/hello/acks; enqueue canned reply on flush; skip webhook (`handledBy: runtime-greeting`).
- Debounce 250ms for greeting-only pending batches.

## Outbound queue compact (2026-09-21T01:26:31.088188+00:00)
- Slimmed `data/outbound-queue.json` sent history (124 → 20); `outbound.jsonl` still full audit.

## Outbound polls (2026-09-21 PT)

- **Enqueue** `kind: "poll"` with `title` + `options` (≥2). CLI: `--poll-title` + repeated `--option`.
- **Send** via `space.send(poll(title, ...options))` from `spectrum-ts`.
- **Inbound votes** shaped as `kind: "poll_vote"` (`voted` / `unvoted`); poll create echoes ignored.
- Usage policy for agents: `orchestrator-memory/POLLS.md`.

## Poll reply repair (2026-09-21 PT)

- Poll follow-up acknowledgments use plain `--text`, not `--reply-to` a poll or composite poll-vote id.
- Reply delivery falls back once to `space.send(text)` for missing/unreplyable targets; failed fallback becomes terminal `failed` rather than retrying forever.

## Inbound attachments (2026-09-21 PT)

- Shape `attachment` / `voice` as `kind: "attachment"`.
- Download via `content.read()` with `im.getAttachment` fallback; save under `data/inbound-attachments/`.
- Unread records include `attachmentPath`, mime, bytes; max 100 MiB.
- Contract: `orchestrator-memory/ATTACHMENTS.md`.
- HEIC/HEIF → JPEG via `heif2jpeg`; original retained beside JPEG.

## Outbound voice (2026-09-21 PT)

- `kind: "voice"` + `audioPath` → Spectrum `voice(path)` / `isAudioMessage: true`.
- Inbound voice notes: `kind: "voice"` with saved path.
- Contract: `orchestrator-memory/AUDIO.md`.
