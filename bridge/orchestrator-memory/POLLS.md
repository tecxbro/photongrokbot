# Polls — when and how

## Bridge contract

Enqueue a native iMessage poll:

```bash
bun run enqueue -- --space-id "<spaceId>" --poll-title "<question>" --option "<a>" --option "<b>" [--option "<c>" ...]
```

Or call `enqueueOutbound({ kind: "poll", spaceId, title, options })` from code.

Rules enforced by the bridge:
- Title must be non-empty after trim.
- At least two non-empty options after trim.
- Options are exactly what the caller provided (empty strings dropped only).

Inbound votes arrive in unread batches as `kind: "poll_vote"` with display `text` like `voted Pizza on "Lunch?"` or `unvoted Sushi on "Lunch?"`, plus `pollTitle`, `pollOption`, `pollSelected`.

Poll follow-up acknowledgments must be ordinary space sends: use `--text`, **not** `--reply-to <pollMessageId>` (and never reply to the composite poll-vote event id). The bridge falls back to `space.send(text)` if a queued reply target is missing or unreplyable, but callers should use the correct form up front.

## When agents should use a poll

See also `REPLY_MODALITY.md` (text vs **image stack** vs poll).

Use a poll when a **bounded selection** is the requested experience **and images are not needed** to evaluate the options (labels alone are enough).

Examples:
- Choosing a day: “Friday, Saturday, or Sunday?”
- Choosing among proposed plans: “Dinner, a movie, or staying in?”
- Collecting group preferences: “Which restaurant should we book?”
- Choosing the next part of an existing task: “Review the design, fix the bug, or write the announcement?”

Use **ordinary text** for open-ended questions, explanations, free-form feedback, or choices that cannot be represented faithfully by the available options. Use an **image stack** (Photon Image Cards `{{IMAGE_CARDS_BOT_ID}}`) when the choice is visual. Do **not** turn every question into a poll.

Write **one clear question** with **short, distinguishable** labels. Do not invent alternatives the user did not authorize or silently remove important choices.

## Delivery

Final user-facing enqueue remains Front Door until Feature Add / specialist direct send is verified. Specialists return ready-to-send poll payloads to Front Door.

## Architecture note

Polls do **not** change Step 2/3 routing or delivery owners. Front Door still final-enqueues (until specialist direct send is verified). Feature Add owns bridge capability; Creator owns repairs. Specialists propose poll payloads; they do not self-enqueue.
