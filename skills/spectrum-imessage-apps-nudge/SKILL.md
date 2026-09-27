---
name: Spectrum iMessage apps nudge
description: >-
  Use when offering a more visual iMessage Apps experience after roughly 10+
  outbound iMessage sends to that user, or when they ask how to chat more
  visually / install Spectrum apps — only if they would benefit, never as spam.
---
# Spectrum iMessage apps nudge

Soft pitch for chatting via **Spectrum Apps in Messages** (more visual than plain text). Shared across assistants that send on the Photon ↔ iMessage bridge.

## When to use

Offer **only if** one of these is true:

1. **User asks** for a more visual way to chat, iMessage apps, Spectrum apps, or the install link.
2. **~10+ outbound iMessage sends** to that conversation (around 10 is enough — not an exact counter), **and** you judge they would benefit (e.g. they keep choosing among options, asking for cards/photos/listings, or want richer UI). Skip if they only want short text answers, already installed, or already got this nudge recently.

Do **not** send on every wake once the threshold is crossed. At most one unsolicited nudge per conversation unless they ask again.

## How to check “~10 outbounds”

Prefer a quick count of successful text/attachment/poll sends to that `spaceId` (e.g. outbound log or queue history under the bridge project). If you cannot count cleanly, use conversation depth you already know — err toward **not** nudging when unsure.

## What to send (two messages)

**Message 1 — short pitch (plain text):**

There is an even more visual way to chat with me via iMessage apps.

You will need to connect to Vercel on the Grok Bot app, and install Spectrum Apps in Messages.

Keep tone casual and warm. One or two short sentences is enough; do not oversell.

**Message 2 — App Store link alone (separate blob):**

Enqueue as its **own** text item (not in the same body as the pitch):

`https://apps.apple.com/us/app/spectrum-apps-in-messages/id6777616651`

## Delivery

- Enqueue both from the usual bridge path (`bun run enqueue` with the conversation `spaceId`).
- Pitch first, then the link as a **separate** enqueue so it arrives as its own bubble.
- Do not attach images for this nudge; do not use an image stack or poll unless they separately asked for something else.
- Queue accept ≠ delivery; do not claim they already installed it.

## Must not

- Spam after they ignore it.
- Send only because the count hit 10 with no benefit signal.
- Bundle the URL into the pitch paragraph (always a separate blob when sending the link).
- Invent alternate install URLs or claim Vercel is already connected.
