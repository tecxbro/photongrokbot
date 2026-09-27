---
name: Photon Image Card Delivery
description: >-
  Use when delivering Photon demo image cards over iMessage via the bridge
  enqueue/runtime path ({{BRIDGE_ROOT}}). Ensures separate PNGs are sent as Spectrum group() batches
  (iMessage sendMultipart), not as one-by-one attachment sends.
---

# Photon Image Card Delivery

## Rule

Generate separate card PNGs (overlay skill unchanged). **Wait until the batch is complete**, then enqueue **one** grouped send.

## Enqueue (preferred)

```bash
bun run enqueue -- --space-id "<spaceId>" \
  --attachment /abs/card-1.png \
  --attachment /abs/card-2.png \
  --attachment /abs/card-3.png \
  --attachment /abs/card-4.png
```

Or:

```ts
await enqueueOutbound({
  kind: "attachment_group",
  spaceId,
  attachmentPaths: [p1, p2, p3, p4],
});
```

## What the runtime does

```ts
await space.send(group(
  attachment(p1),
  attachment(p2),
  attachment(p3),
  attachment(p4),
));
```

Installed Spectrum iMessage provider maps `group` of attachments → upload each → one `messages.sendMultipart(chat.guid, parts)` with `attachmentGuid` parts (not local paths).

## Do not

- Enqueue/send each image as it finishes
- `Promise.all` of individual attachment sends
- `space.send(attachment, attachment, …)` without `group()` (N separate messages)
- Collage multiple cards into one PNG to fake a stack
- Open a second native iMessage SDK connection alongside Spectrum

## Batch sizes

| Cards | Sends |
|------:|-------|
| 4–N | **1 group of all N** (the owner: 4 or more together) |
| only if Spectrum rejects a large group | split into chunks of **≥4** each — never 4+1 / lone leftover |

Do **not** send 5 as “group of 4 + single.”

## Verify

Queue `kind: "attachment_group"` with **all** paths on one item. After send, confirm the Photos-style stack in iMessage — enqueue/API success alone is not enough.

## Cards-ready callback (mandatory — do not skip)

Front Door releases after handoff; **you must not leave PNGs on disk with no enqueue**.

When the full batch is complete (≥4, all options):

1. Write marker (atomic JSON). The `cards[]` array is mandatory and aligned 1:1 with `attachmentPaths`; each typed entry has `nn`, `slug`, `title`, exactly one `rent` or `price`, `url`, and `caption`:

```json
{
  "batchId": "<batchId>",
  "spaceId": "<spaceId>",
  "attachmentPaths": [
    "{{BRIDGE_ROOT}}/data/outbound-assets/<batchId>-01-<slug-1>.png",
    "{{BRIDGE_ROOT}}/data/outbound-assets/<batchId>-02-<slug-2>.png",
    "{{BRIDGE_ROOT}}/data/outbound-assets/<batchId>-03-<slug-3>.png",
    "{{BRIDGE_ROOT}}/data/outbound-assets/<batchId>-04-<slug-4>.png",
    "{{BRIDGE_ROOT}}/data/outbound-assets/<batchId>-05-<slug-5>.png"
  ],
  "cards": [
    {
      "nn": 1,
      "slug": "<slug-1>",
      "title": "<title-1>",
      "price": "<price-1>",
      "url": "<url-1>",
      "caption": "<caption-1>"
    },
    {
      "nn": 2,
      "slug": "<slug-2>",
      "title": "<title-2>",
      "price": "<price-2>",
      "url": "<url-2>",
      "caption": "<caption-2>"
    },
    {
      "nn": 3,
      "slug": "<slug-3>",
      "title": "<title-3>",
      "price": "<price-3>",
      "url": "<url-3>",
      "caption": "<caption-3>"
    },
    {
      "nn": 4,
      "slug": "<slug-4>",
      "title": "<title-4>",
      "price": "<price-4>",
      "url": "<url-4>",
      "caption": "<caption-4>"
    },
    {
      "nn": 5,
      "slug": "<slug-5>",
      "title": "<title-5>",
      "price": "<price-5>",
      "url": "<url-5>",
      "caption": "<caption-5>"
    }
  ],
  "expectedCount": 5,
  "readyAt": "<ISO-8601>",
  "source": "{{IMAGE_CARDS_BOT_ID}}",
  "enqueueOwner": "front-door"
}
```

Path: `{{BRIDGE_ROOT}}/data/cards-ready/<batchId>.json`

2. **WakeParent / `SendToAgent` Front Door `{{FRONT_DOOR_BOT_ID}}`** (priority true) with RESULT: batchId, spaceId, paths, expectedCount. Ask FD to final-enqueue one `attachment_group` of **all** paths.

3. **Do not** `bun run enqueue` yourself (specialist direct-enqueue not verified). Runtime watchdog will final-enqueue from the marker if FD wake is delayed — that is the durable backup, not a license to self-send.

4. Naming: `data/outbound-assets/<batchId>-NN-slug.png` with `NN` = `01`, `02`, … matching `expectedCount`. Image Cards must include `cards[]`, aligned to `attachmentPaths` order, so part order matches the attachment paths. The bridge attaches `partIndex` mapping after send for Tapback resolution.

