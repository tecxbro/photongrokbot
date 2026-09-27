# Reply modality — text vs image stack vs poll vs iMessage apps

Goal: answers stay **fast**, and this agent stays the **most visual** iMessage experience when a choice benefits from seeing options.

Front Door picks the delivery shape **before** answering or handing off. Prefer visual when the user must **choose among concrete options**; do not default everything to plain text.

## 1) Plain text (direct message)
Use when:
- Conversation, clarification, explanation, status, open-ended help
- A single recommendation / answer with no menu of alternatives to pick from
- Follow-ups that only need words (including after a prior image stack or poll)

Enqueue text/reply as usual. Keep it short.

## 2) Image stack (visual choice)
Use when the user needs to **consider / pick among options that are better shown than listed** — listings, products, looks, places with vibe/photos, side-by-side cards, “which of these.”

### Hard count rule
- Send images **only if there are 4 or more** options/cards.
- If there are **3 or fewer**, use **plain text** (or a poll if labels alone fit) — never a 1–3 image send.
- **4+** go as **one** Spectrum `attachment_group` with **all** cards (5–7 included). Do not split as 4+1. Prefer one stack; only split into ≥4 chunks if Spectrum rejects a large group. See `ATTACHMENTS.md`.

- New cards → Photon Image Cards `{{IMAGE_CARDS_BOT_ID}}` (Step 3); Front Door enqueues the attachment group(s) (`ATTACHMENTS.md`). After cards land, FD (or runtime cards-ready watchdog) **must** final-enqueue — no silent drop after typing stops. Marker: `data/cards-ready/<batchId>.json`.
- Do **not** substitute a long text list when an image stack (≥4) is the right choice experience.
- Resend of an existing stack (≥4 already on disk) can be Step 2 follow-up.

## 3) Poll (text-only bounded choice)
Use when the user must pick among a **small fixed set of labels** and **does not need images** to evaluate them.

Examples: city names to visit, Friday/Saturday/Sunday, dinner vs movie vs stay in.

- Enqueue a native poll (`POLLS.md`).
- Do **not** use a poll when visuals would change the decision (use image stack instead).
- Do **not** turn open-ended questions into polls.


## 4) App full sheet (iMessage app card)
Use when the right experience is a **tappable full-sheet app card** that opens a URL inside the Spectrum iMessage App (static preview / sheet — not live UI).

- Hand off **App Sheet Bot `{{APP_SHEET_BOT_ID}}`**.
- Enqueue: `bun run enqueue -- --space-id <spaceId> --app-url 'https://...'`
- Prefer this over a bare text URL when you want an **app card**, not a link preview.
- Detail: `APPS.md`.

## 5) Live mini app
Use when the right experience is the **live mini app UI** (and/or **updating that card in place**).

- Hand off **Live Mini Bot `{{LIVE_MINI_BOT_ID}}`**.
- First send: `bun run enqueue -- --space-id <spaceId> --app-url 'https://...' --live`
- Update: `bun run enqueue -- --space-id <spaceId> --app-update '<messageId>' --app-url 'https://...' --live`
- Detail: `APPS.md`.

## Decision cheat-sheet
| Situation | Modality |
|---|---|
| “hey” / explain / one clear answer | Text |
| “which apartment / look / product — show me options” (**≥4**) | Image stack |
| Same but only 1–3 options | Text (or poll if labels) |
| “which city: Austin, Chicago, Miami?” | Poll |
| Open-ended “what should I do with my life?” | Text (maybe one clarifying Q) |
| “open this as an iMessage app / full sheet” | App full sheet → `{{APP_SHEET_BOT_ID}}` |
| “live dashboard / mini app / update the card” | Live mini → `{{LIVE_MINI_BOT_ID}}` |

Shopping/buy advice with no option set to pick from → text (or clarify use-case). If they ask to **see options** to choose from → image stack (or poll if labels alone suffice).

Architecture: modality choice does **not** change Step 2/3 ownership or final-enqueue (Front Door fallback).


## Stuck / blocked fallback (token-efficient)
If the preferred path is **blocked or dragging** — image generation stuck, VM compute thrashing, web pulls hanging, long tool loops, approval/wait walls — **do not keep burning tokens** retrying the heavy path.

**Degrade gracefully and ship something useful now:**
1. Prefer **links + short plain text** (listing URLs, product links, prior-known results) over waiting on cards/images.
2. If a poll still fits a label-only choice, use a poll; otherwise text.
3. One brief note that visuals/deeper work can follow later is fine — no essay, no tool-spiral narration.
4. Front Door may direct-answer with that fallback when a specialist/Orch path is stuck; specialists should return a ready text/link payload to Front Door instead of looping.

Stay fast. Token-efficient. Visual when it works; text/links when blocked.
