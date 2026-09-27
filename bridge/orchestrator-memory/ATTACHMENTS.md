# Attachments — Photon Spectrum bridge

## Outbound (already supported)

**Format:** enqueue always sends **JPEG** for raster images. PNG/WebP/GIF/HEIC paths are converted under `data/outbound-jpeg/` at enqueue time (ffmpeg). Paths that are already `.jpg`/`.jpeg` pass through. Non-images (e.g. PDF) are unchanged. Prefer writing cards as JPEG when easy; PNG sources still work.

```bash
bun run enqueue -- --space-id "<spaceId>" --attachment /absolute/path/to/file.png
bun run enqueue -- --space-id "<spaceId>" --text "caption" --attachment /absolute/path/to/file.png
```

Or `enqueueOutbound({ kind: "text", spaceId, text, attachmentPath })`.
When both caption text and `attachmentPath` are set, the runtime enqueues a text bubble then the file.

Uses Spectrum `attachment(path)` → hosted iMessage upload/send.

## Grouped outbound images (card stacks)

Generate separate image files, then deliver them as **one** Spectrum `group()` after all files for that batch exist. Do **not** enqueue each image as it finishes.

```bash
# Four cards → one iMessage stack (preferred)
bun run enqueue -- --space-id "<spaceId>" \
  --attachment /absolute/path/card-1.png \
  --attachment /absolute/path/card-2.png \
  --attachment /absolute/path/card-3.png \
  --attachment /absolute/path/card-4.png
```

Or from code:

```ts
await enqueueOutbound({
  kind: "attachment_group",
  spaceId,
  attachmentPaths: [p1, p2, p3, p4],
});
```

Runtime sends:

```ts
await space.send(group(
  attachment(p1),
  attachment(p2),
  attachment(p3),
  attachment(p4),
));
```

That stays one `group` through Spectrum. The iMessage provider uploads each file, collects `attachment.guid`s, and calls **one** `messages.sendMultipart(chat.guid, parts)`.

**Do not:**
- four separate `bun run enqueue -- --attachment …` calls
- `Promise.all` of individual sends
- `space.send(attachment(a), attachment(b), …)` without `group()` (that is N sequential messages — see Spectrum composing-content docs)
- build a collage to fake a stack

**Count gate:** enqueue image stacks only for **≥4** cards; if ≤3, Front Door uses text/poll instead (see `REPLY_MODALITY.md`).

**Batching:** Put **all ≥4 cards in one** `attachment_group` (5, 6, 7, 8+ are fine). the owner's rule: 4 or more go together as one Photos-style stack — do **not** split as 4+1 or leave a lone leftover. Prefer one group. Only split if Spectrum rejects a large group — then chunks of **≥4** each (never a visual choice of 1–3). Keep files separate.

**Verification:** enqueue success ≠ stack observed on iPhone. Confirm the Photos-style stack in Messages after send.

Docs: https://photon.codes/docs/spectrum-ts/content/groups · https://photon.codes/docs/spectrum-ts/content/composing-content · https://photon.codes/docs/advanced-kits/imessage/messages (Send Multipart Messages)


## Inbound (Feature Add 2026-09-21)

Authorized inbound `attachment` and `voice` content is downloaded via `content.read()` (fallback: `imessage(app).getAttachment(id).read()`), written under:

`{{BRIDGE_ROOT}}/data/inbound-attachments/<messageId>/<filename>`

and included in unread batches as:

```json
{
  "kind": "attachment",
  "text": "[attachment] shot.jpg (image/jpeg, 1234 bytes)",
  "attachmentPath": "{{BRIDGE_ROOT}}/data/inbound-attachments/.../shot.jpg",
  "attachmentId": "p:0/GUID",
  "attachmentName": "shot.jpg",
  "attachmentMimeType": "image/jpeg",
  "attachmentBytes": 1234
}
```

Limits: max **100 MiB** per file (Photon default). If download fails, the batch still carries metadata with `[download failed: …]` in `text`.

### HEIC / HEIF
Inbound HEIC/HEIF is converted with Photon’s `heif2jpeg` (quality 85). `attachmentPath` points at the JPEG. The original is kept as `attachmentOriginalPath` / `attachmentOriginalMimeType`. If conversion fails, the HEIC path is delivered as-is.

## Agent usage

- Front Door / specialists: read `attachmentPath` from the unread record to open the file; do not invent paths.
- Sending: prefer absolute paths under `{{BRIDGE_ROOT}}/data/` (e.g. `outbound-assets/`).
- Architecture unchanged: same webhook → Front Door → enqueue path.

## Voice notes
See `AUDIO.md` — use `--voice` for Apple audio-message UI; inbound voice is `kind: "voice"` with Moonshine STT (`transcript` field).

## Cards-ready → Front Door final-enqueue

Image-stack routes hand off to Photon Image Cards `{{IMAGE_CARDS_BOT_ID}}`, then **Front Door** final-enqueues. FD releases the turn after handoff (no shell wait). To prevent silent drops after typing stops:

1. **Image Cards** writes `data/outbound-assets/<batchId>-NN-slug.png` and marker `data/cards-ready/<batchId>.json` (`batchId`, `spaceId`, `attachmentPaths`, `expectedCount`, `readyAt`, `source`).
2. **Image Cards** WakeParent / SendToAgent Front Door `{{FRONT_DOOR_BOT_ID}}` with RESULT paths (does **not** self-enqueue).
3. **Front Door** enqueues one `attachment_group` with **all** ≥4 paths (no 4+1).
4. **Runtime watchdog** (`src/cards-ready.ts`, polled ~3s): if a pending image-stack handled row (or unconsumed marker) has stable complete assets and outbound does not yet reference `batchId`, runtime final-enqueues and sets `deliveryStatus: "enqueued-by-runtime-watchdog"`. Idempotent vs FD enqueue.

Handled handoff fields: `modality: "image-stack"`, `routedTo`/`specialistId: "{{IMAGE_CARDS_BOT_ID}}"`, `expectedCardCount`, `deliveryStatus: "pending-cards"` → later `enqueued-by-front-door` or `enqueued-by-runtime-watchdog`.

Marker must be **valid JSON only** (atomic write; no shell heredoc/`$` expansion leaking into the file). If the marker is corrupt, the watchdog cannot drain it — disk-scan only helps when handled already looks like an image-stack pending row. See incidents `2026-09-23-image-stack-cards-ready-silent-drop.md` and `2026-09-24-cards-ready-corrupt-marker.md`.


## §8–9 Card stack presentations & Tapback → option resolve

When Image Cards / Front Door enqueue an `attachment_group` for a visual choice stack:

1. **Marker** `data/cards-ready/<batchId>.json` should include `cards[]` parallel to `attachmentPaths` (`optionId?`, `title?`, `url?`, `caption?`). Formalized on `CardsReadyMarker`.
2. **Enqueue MUST pass `batchId` + `cards`** on `attachment_group` when FD final-enqueues (runtime cards-ready watchdog already does). Use `enqueueOutbound({ kind:"attachment_group", spaceId, attachmentPaths, batchId, cards })` from the marker — bare CLI multi-`--attachment` omits the map and leaves future tapbacks `optionAmbiguous` until resent.
3. **On successful send** the runtime persists:
   - `messageId` = parent Spectrum message id on the outbound queue item
   - `parts[]` with `partIndex`, `path`, `childId` (`p:{partIndex}/{parentGuid}`), and option fields from `cards[]`
   - `data/presentations/{batchId}.json` + index by parent messageId in `data/presentation-index.json`
4. **Inbound reactions** targeting `p:N/<parentGuid>` are enriched for Front Door (`optionTitle` / `optionUrl` / …, or `optionAmbiguous` + `optionNames`). See `REACTIONS_EFFECTS.md` §§8–9.
5. Policy reminder: **one group of all N cards (≥4)** — not 4+1. Any emoji resolves to that card; ❤️/👍 = shortlist, 👎 negative, ❓ clarify, other = go ahead / think in context (soft interest if positive, not book). Never guess when ambiguous. No long-term memory writes for reactions.

