---
name: iMessage front-door wake
description: >-
  Use when handling Photon iMessage wakes on the front-door bot: apply Step 2
  direct-answer or Step 3 delegation; do not execute as a dumb pipe only.
---
# iMessage front-door wake

Use on iMessage Front Door (`{{FRONT_DOOR_BOT_ID}}`) when a Photon webhook wake arrives
(live routine: Photon iMessage wake / UUID `{{PHOTON_WAKE_ROUTINE_ID}}`).

1. Parse `batchId` from webhook body (`{"batchId":"..."}`).
2. Load `{{BRIDGE_ROOT}}/data/unread/<batchId>.json`. If missing, stop quietly.
3. If `handledBy` / `handled_by` is `runtime-greeting`, stop (runtime already replied).
4. **Reactions/effects FIRST (Step 0):** pick exactly one — **`react`** | **`no-react`** | **`effect`** — before drafting a reply or picking modality. If not `no-react`, enqueue immediately (`--react` / `--effect`). Record `reactionGate` in the handled note. See `REACTIONS_EFFECTS.md`.
5. If inbound is `kind: "reaction"` on an option/card stack, apply **Inbound option reactions (§§8–9)** in `REACTIONS_EFFECTS.md` (shortlist / clarify / batch-close). Use enrichment fields below; never guess when `optionAmbiguous: true`. Image Cards does not own the chat.
6. Apply Step 2 direct-answer from the live Front Door profile. If it qualifies: answer + `bun run enqueue` yourself; write `data/orchestrator-handled/<batchId>.json` with `action: "direct-answer"`.
7. Else Step 3: one-specialist SendToAgent (incl. Image Cards `{{IMAGE_CARDS_BOT_ID}}` for new visual stacks; App Sheet `{{APP_SHEET_BOT_ID}}` for full-sheet app cards; Live Mini `{{LIVE_MINI_BOT_ID}}` for live mini apps), or Orchestrator `{{ORCHESTRATOR_BOT_ID}}` only when coordination is required. Final enqueue stays Front Door until others are verified. Write orchestrator-handled after durable handoff/result bookkeeping.
8. Stay quiet in app chat unless failure needs it.
9. Enqueue only from `{{BRIDGE_ROOT}}` with the verified CLI / `enqueueOutbound`. Queue accept ≠ delivery.

Do not CreateAgent specialists. Do not edit bridge code (hand to iMessage Creator `{{CREATOR_BOT_ID}}`). Do not echo Spectrum secrets. Do not wake Chatty for primary conversation.
Webhook HTTP 200 only means the wake was accepted — not that work is done.

## Reply modality (text / image stack / poll / apps)
Decide before answering. Detail: `{{BRIDGE_ROOT}}/orchestrator-memory/REPLY_MODALITY.md` + `APPS.md`.
- **Text** — chat, explanations, single answers, open-ended.
- **Image stack** — visual choice among **≥4** options → Photon Image Cards `{{IMAGE_CARDS_BOT_ID}}`; enqueue attachment group(s) (`ATTACHMENTS.md`). **≤3 → text** (or poll). **All ≥4 in one group** (no 4+1). New card gen is Step 3, not Step 2.
- **Poll** — bounded label choice when images are unnecessary (e.g. cities). See `POLLS.md`.
- **App full sheet** — static iMessage app card → **App Sheet Bot `{{APP_SHEET_BOT_ID}}`**; enqueue `--app-url`.
- **Live mini app** — live UI / in-place updates → **Live Mini Bot `{{LIVE_MINI_BOT_ID}}`**; enqueue `--app-url --live` (updates: `--app-update`). If the request **fits** live mini but `{{LIVE_MINI_BOT_ID}}` is missing or the host is not deployed: **do not silently fail** — offer once via `spectrum-imessage-apps-nudge` / `live-mini-enable` (human-facing: Spectrum Apps + Vercel; if yes, connect Vercel then deploy-all — never gate on detecting Spectrum install). If they decline, use App Sheet or text. If Live Mini is ready (bot + host), route as today.
Be fast; be most visual when the user is choosing.
- **Stuck / blocked:** if image gen or heavy VM/web work stalls, ship **links or short text** now — do not burn tokens retrying. See `REPLY_MODALITY.md`.

## iMessage apps (who to message)
- Full-sheet / static app card → `SendToAgent` **App Sheet Bot `{{APP_SHEET_BOT_ID}}`** (priority true).
- Live mini app or update existing app card → `SendToAgent` **Live Mini Bot `{{LIVE_MINI_BOT_ID}}`** (priority true) when Live Mini is ready. If not ready but the request fits: offer once (`live-mini-enable` / apps-nudge); on decline, App Sheet or text — never silent fail.
- Specialists return ready enqueue args; Front Door final-enqueues until direct send is verified.
- Design/layout TBD — URL (+ live/update) only. Contract: `orchestrator-memory/APPS.md`.

## Outbound polls
When a **bounded selection** is the right experience (day / plan / preference / next step among known options), enqueue a poll instead of a text question:
`bun run enqueue -- --space-id <spaceId> --poll-title '<question>' --option '<a>' --option '<b>' [...]`
Use ordinary text for open-ended questions. Do not invent options. Full rules: `{{BRIDGE_ROOT}}/orchestrator-memory/POLLS.md`. Does not change Step 2/3 architecture.

## Attachments
Inbound batches may include `kind: "attachment"` with `attachmentPath` under `{{BRIDGE_ROOT}}/data/inbound-attachments/`. Read that file for the bytes. Outbound: `bun run enqueue -- --space-id <id> --attachment <abs-path>` (optional `--text` caption). See `orchestrator-memory/ATTACHMENTS.md`.

## Voice notes
Outbound Apple audio-message bubble: `bun run enqueue -- --space-id <id> --voice <abs.m4a>` (not `--attachment`). Inbound `kind: "voice"` includes `attachmentPath`. See `orchestrator-memory/AUDIO.md`.

## Reactions & message effects
**Order:** Step 0 fork first — `react` | `no-react` | `effect` — then reply drafting. Record `reactionGate` in handled notes.
Tapbacks: `bun run enqueue -- --space-id <id> --react '<emoji>' --target <messageId>`.
Bubble/screen effects: `bun run enqueue -- --space-id <id> --text '...' --effect confetti` (also slam, loud, gentle, invisible, fireworks, balloons, …).
Policy + when-to-use: `{{BRIDGE_ROOT}}/orchestrator-memory/REACTIONS_EFFECTS.md` (plain text default; at most one effect per turn; first-setup Confetti once). v1: `--effect` with `--text` only, not `--reply-to`. Does not change Step 2/3.

### Inbound option reactions (§§8–9) — Front Door owns chat
When the user tapbacks a card/option in an image stack (or related option message):
- ❤️ / 👍 → interest → add to **task shortlist**; continue; **not** book/buy permission.
- 👎 → negative on that option.
- ❓ → clarify that option.
- **Any other emoji** → still that option; go ahead — think about the vibe in context and continue the thread (soft shortlist if positive). Never ignore as “not a selection”; still **not** book/buy.
- Multi-heart keeps both; reaction removal clears **that sender’s** interest only; scope by `senderId` + `spaceId` + option.
- Batch-close reactions; **one** reply, not a storm.
- If `optionAmbiguous: true` (or map missing) → ask **one** short clarification with `optionNames`; **never guess**.
- Route resolved reaction to the **task owner**; Image Cards `{{IMAGE_CARDS_BOT_ID}}` does **not** own the chat just because it made the PNG.
- Do **not** write reaction history into long-term personal memory.

**Wire fields (live):** resolved → `reactedPartIndex`, `reactedParentMessageId`, `reactedChildId`, `optionId`, `optionTitle`, `optionUrl`, `optionCaption`, `optionBatchId`, `optionAmbiguous: false` (e.g. reacted ❤️ on "Avalon"). Ambiguous → `optionAmbiguous: true`, `optionNames[]`. Full tables in `REACTIONS_EFFECTS.md`.

## Image-stack handoff + cards-ready final-enqueue (mandatory)

**Handoff (every new visual stack ≥4):**
1. `SendToAgent` Photon Image Cards **`{{IMAGE_CARDS_BOT_ID}}`** (agent UUID `{{IMAGE_CARDS_AGENT_UUID}}`) with **priority true**.
2. If this wake is an automation subagent **without** `SendToAgent`, **WakeParent must** perform that same `SendToAgent` before the turn is considered handed off. Writing `orchestrator-handled` with `pending-parent-SendToAgent` alone is **not** delivery.
3. Handled file MUST include: `action: "forward-to-specialist"`, `routedTo`/`specialistId: "{{IMAGE_CARDS_BOT_ID}}"`, `modality: "image-stack"`, `spaceId`, `expectedCardCount` (exact N), `deliveryStatus: "pending-cards"`.

**Final-enqueue when cards are ready (no silent drop):**
- Image Cards writes PNGs under `data/outbound-assets/<batchId>-NN-*.png` and a marker `data/cards-ready/<batchId>.json` (include `cards[]` parallel to paths).
- **You** (Front Door) final-enqueue **one** `attachment_group` with **all** ≥4 paths (never 4+1) and pass **`batchId` + `cards[]`** from the marker via `enqueueOutbound` so part maps build on send (bare CLI multi-`--attachment` omits the map). Runtime cards-ready watchdog already does this — do not dual-send: if `deliveryStatus` starts with `enqueued` or outbound already references `batchId`, stop.
- On **any** wake for a batch whose handled row is pending image-stack: if cards are already on disk (≥ `expectedCardCount`, or marker present), enqueue immediately — do not wait for another user ping.
- After enqueue: set `deliveryStatus: "enqueued-by-front-door"` on the handled file (or leave runtime’s `enqueued-by-runtime-watchdog` if it won the race).
- Pre-ship stacks without a map stay `optionAmbiguous` until resent with metadata.

Do **not** enable Image Cards direct-enqueue. Do **not** release the parent turn until either real `SendToAgent` ran or WakeParent is explicitly tasked to run it.
