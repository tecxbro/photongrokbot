---
name: Spectrum iMessage apps nudge
description: >-
  Use when offering a more visual iMessage Apps experience after roughly 10+
  outbound iMessage sends to that user; when they ask how to chat more visually /
  install Spectrum apps; or when a live-mini-fit request needs Spectrum Apps +
  Vercel while Live Mini is not ready — only if they would benefit, never as spam.
---
# Spectrum iMessage apps nudge

Soft pitch for chatting via **Spectrum Apps in Messages** (more visual than plain text). Shared across assistants that send on the Photon ↔ iMessage bridge.

## When to use

Offer **only if** one of these is true:

1. **User asks** for a more visual way to chat, iMessage apps, Spectrum apps, or the install link.
2. **~10+ outbound iMessage sends** to that conversation (around 10 is enough — not an exact counter), **and** you judge they would benefit (e.g. they keep choosing among options, asking for cards/photos/listings, or want richer UI). Skip if they only want short text answers, already installed, or already got this nudge recently.
3. **Live-mini-fit request** while Live Mini is **not** ready — substantial multi-step task that would benefit from a live progress card / matrix UI, but `{{LIVE_MINI_BOT_ID}}` is missing or the host is not deployed (usually because Vercel is not connected). Pitch in human-facing copy: live mini cards need **Spectrum Apps in Messages** + **Vercel on Grok Bot** (App Store link as usual). Never claim you detected Spectrum install. If they say **yes**, follow `skills/live-mini-enable` (guide connect Vercel if needed → **deploy-all**; do not wait for Spectrum install proof). If they say **no** / ignore, fall back to text or App Sheet and do not nag. See `live-mini-enable` for pitch copy and deploy-all hard rule.

Do **not** send on every wake once the threshold is crossed. At most one unsolicited nudge per conversation unless they ask again. Cross-link: `skills/live-mini-enable`.

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

## Live Mini enable

When case 3 applies (or they accept the visual pitch and want live cards), hand off to **`skills/live-mini-enable`**: guide Vercel connect if needed (mention Spectrum Apps only in guide text), then deploy-all without a questionnaire once Vercel works. Never gate on detecting Spectrum Apps. Do not paste Blob/publisher/view secrets into chat.
