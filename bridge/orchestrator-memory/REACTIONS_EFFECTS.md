# Reactions & message effects — when and how

Policy for iMessage tapbacks and Spectrum bubble/screen effects on the Photon bridge. Prefer **plain text** by default; use reactions and effects **naturally and with purpose**. User preferences always win.

## Bridge contract

### Outbound reactions (tapbacks)

```bash
bun run enqueue -- --space-id "<spaceId>" --react "❤️" --target "<messageId>"
```

Or `enqueueOutbound({ kind: "react", spaceId, targetMessageId, emoji })`.
Runtime calls `target.react(emoji)`. Inbound reactions arrive as `kind: "reaction"` with `emoji` + `targetMessageId`.

### Outbound message effects (bubble + screen)

```bash
bun run enqueue -- --space-id "<spaceId>" --text "Happy birthday!" --effect confetti
bun run enqueue -- --space-id "<spaceId>" --text "Heads up" --effect slam
```

Or `enqueueOutbound({ kind: "text", spaceId, text, effect: "confetti" })`.

Runtime wraps with Spectrum:

```ts
import { effect, imessage } from "spectrum-ts/providers/imessage";
await space.send(effect(content, imessage.effect.message.confetti));
```

**v1 scope:** `--effect` applies to `--text` and single `--attachment` only — **not** `--reply-to`, `--react`, polls, voice, apps, or multi-attachment groups. At most one effect is attached (first bubble / caption when multi-part).

**Allowlist** (reject unknown names):

| Kind | Names |
|------|--------|
| Bubble | `slam`, `loud`, `gentle`, `invisible` |
| Screen | `confetti`, `fireworks`, `balloons`, `heart`, `lasers`, `celebration`, `sparkles`, `spotlight`, `echo` |

## Front Door order of operations (mandatory)

On every inbound wake, Front Door’s **absolute first** decision — before modality, drafting, or Step 3 — is a single fork:

### Step 0 — pick exactly one
| Choice | When | Action |
|--------|------|--------|
| **`react`** | Tapback fits (thanks, agree, funny, watching, light celebrate, ack) | Enqueue `--react` **immediately** on the inbound message id, then continue. |
| **`no-react`** | No tapback fits (neutral ask, task request, already reacted, reaction-only inbound that needs silence) | Explicitly choose this and move on — do not “forget” reactions by skipping the fork. |
| **`effect`** | This turn’s outbound should carry a bubble/screen effect (celebration, slam, first-setup Confetti, etc.) | Plan that effected send next; enqueue it as soon as the short text/attachment is ready (still before a long draft). |

Record the choice in the handled note: `reactionGate: react|no-react|effect` (plus emoji/effect name when not `no-react`).

Then:

1. Read the batch; note inbound message id(s).
2. Execute the Step 0 choice (enqueue react / skip / prepare effect).
3. **Only after that:** choose reply modality / Step 2 answer / Step 3 handoff and enqueue any text reply / image stack.

Do not wait for a finished essay before sending the reaction. Reaction-only is enough when nothing else is owed. Do not stack `react` + `effect` on the same ordinary turn unless the user clearly wants both; prefer one.

## Reactions — when to use

| Intent | Emoji |
|--------|--------|
| Thanks / appreciation | ❤️ |
| Agree / yes | 👍 |
| Funny | 😂 |
| Interest / watching | 👀 |
| Win / celebrate lightly | 🎉 |
| Done / acknowledged | ✅ |

- **Reaction-only** when a tapback is enough (ack, thanks, agree) — no need to spam a text bubble.
- **Reaction + reply** when you still owe substance (answer a question, report status) — tapback does not replace the reply.
- **One reaction per target** message (do not stack many tapbacks on the same id).
- **Never replace real work** with a reaction. A 👍 is not a completed task.

## Bubble effects — when to use

| Effect | Use when |
|--------|----------|
| `gentle` | Soft emphasis, calm good news, careful tone |
| `loud` | Excited shout-out that still stays in-bubble |
| `slam` | Strong emphasis / “pay attention” (sparingly) |
| `invisible` | Playful reveal / surprise ink (when the joke fits) |

Bubble effects animate the **message bubble** itself. Prefer them over screen effects for light emphasis.

## Screen effects — when to use

| Effect | Typical trigger |
|--------|-----------------|
| `confetti` | Wins, ship moments, first-setup celebration |
| `balloons` | Birthday / party vibes |
| `fireworks` | Bigger milestones than confetti |
| `celebration` | Happy birthday / formal party effect |
| `heart` | Warm appreciation / love notes |
| `sparkles` | Delightful polish / magic reveal |
| `spotlight` | Highlight something important |
| `lasers` | High-energy hype (rare) |
| `echo` | Echo / ripple emphasis (rare) |

## First successful iMessage setup → mandatory Confetti

On the **first successful** iMessage setup for this bridge, send **one** Confetti message (e.g. a short “you’re live” line with `--effect confetti`). Persist a marker so we never re-celebrate:

- Marker file: `data/onboarding-celebrated.json`
- Helpers: `hasSetupConfettiBeenSent()` / `markSetupConfettiSent()` in `src/setup-confetti.ts`

Call `markSetupConfettiSent()` only after the celebratory send is accepted/queued successfully.

## Selection order (ordinary turns)

1. **Step 0 fork first:** `react` | `no-react` | `effect` (Front Door: before drafting the reply). Enqueue immediately when not `no-react`.
2. Prefer a **reaction** when a tapback is enough (reaction-only OK).
3. Prefer **plain text** (or reply) with no effect for ordinary substance.
4. Prefer a **bubble** effect over a **screen** effect when mild emphasis is enough.
5. Use a **screen** effect only for clear celebratory / spotlight moments.
6. **At most one effect** per ordinary turn (do not stack effect + multiple flashy sends).

## CLI examples

```bash
# Tapback
bun run enqueue -- --space-id "<spaceId>" --react "👍" --target "<messageId>"

# Screen effect on text
bun run enqueue -- --space-id "<spaceId>" --text "effects are live 🎉" --effect confetti

# Bubble effect
bun run enqueue -- --space-id "<spaceId>" --text "important" --effect slam
```

## Inbound option reactions (§§8–9) — Front Door owns chat

**Status:** Bridge wire **live** (Feature Add). Runtime persists `messageId` + `parts[]` on successful `attachment_group` send, writes `data/presentations/{batchId}.json`, indexes by parent messageId, and enriches inbound `kind: "reaction"` batches with resolved option fields (or `optionAmbiguous` + `optionNames`). Front Door applies the mapping rules below on every reaction wake — **never invent** an option when `optionAmbiguous: true`.

### Meaning of tapbacks on listing / option cards
| Tapback | Meaning | Action |
|---------|---------|--------|
| ❤️ / 👍 | Interest | Add that option to the **task shortlist**; continue the thread. **Not** book/buy permission. |
| 👎 | Negative | Mark that option down / out for this sender. |
| ❓ / ? | Clarify | Explain or clarify **that** option. |
| **Any other emoji** (😂, 🔥, !!, custom, …) | Soft signal on **that** option | Still resolve the card. **Go ahead** — read the emoji in context, think briefly, and continue the thread about that option (answer, compare, ask one useful follow-up). Prefer soft shortlist interest when the vibe is positive; do **not** invent book/buy permission. Never ignore an other-emoji tapback as “not a selection.” |

### Scope & batching
- **Multi-heart** keeps every hearted option on the shortlist.
- **Removal** of a reaction clears **that sender’s** interest on that option only.
- Scope keys: `senderId` + `spaceId` + option id (from part map: `optionId` or title).
- **Batch-close** reaction wakes in one turn: one reply (or silence), not a storm of per-emoji bubbles.
- If the event is **batch-only** or the **part→option map is missing** (`optionAmbiguous: true`): ask **one** short clarification naming `optionNames`; **never guess** which card they meant.

### Ownership
- Route the resolved reaction to the **task owner** for that shortlist (Housing specialist, Orchestrator task, etc.).
- **Image Cards `{{IMAGE_CARDS_BOT_ID}}` does not own the chat** just because it made the PNG — Front Door owns conversation / Step 2; specialists own their task outcomes.
- Do **not** write reaction history into long-term personal / shared user memory.

### Wire fields (Feature Add live — fill applied 2026-09-26)

`fieldsStatus: live` · Runtime restarted with Tapback→option resolve.

**Resolved** (`optionAmbiguous: false`) — display e.g. `reacted ❤️ on "Avalon"`:
| Field | Meaning |
|-------|---------|
| `reactedPartIndex` | Part index in the group |
| `reactedParentMessageId` | Parent Spectrum message id |
| `reactedChildId` | `p:N/<parentGuid>` |
| `optionId` | Stable option id when known |
| `optionTitle` | Display name |
| `optionUrl` | Listing / deep link when known |
| `optionCaption` | Caption on the card |
| `optionBatchId` | Cards-ready / presentation batch id |
| `optionAmbiguous` | `false` |

**Ambiguous** — clarify with names; **never guess**:
| Field | Meaning |
|-------|---------|
| `optionAmbiguous` | `true` |
| `optionNames` | `string[]` of known titles (+ partial ids when known) |

Also present when Spectrum provides it: `targetMessageId`, `emoji`, `senderId`, `spaceId`.

**Outbound (so resolve works):** when Front Door (or runtime) final-enqueues an `attachment_group`, pass **`batchId` + `cards[]`** (parallel to paths: `optionId?`, `title?`, `url?`, `caption?`) so the part map can be built on successful send → `data/presentations/{batchId}.json` + `presentation-index.json`. Pre-ship stacks without a map stay `optionAmbiguous` until resent with metadata. Runtime cards-ready watchdog already passes marker `batchId`/`cards`. Prefer `enqueueOutbound({ kind:"attachment_group", spaceId, attachmentPaths, batchId, cards })` over bare CLI multi-`--attachment` (CLI does not yet accept batchId/cards).

Resolver: `src/reaction-option.ts` → `resolveReactionOption(targetMessageId)`. Detail: `ATTACHMENTS.md` §8–9.

## Architecture note

Reactions and effects do **not** change Step 2/3 routing or delivery owners. Front Door still final-enqueues user-facing messages until specialist direct send is verified. Feature Add owns bridge capability; Creator owns repairs.
