# Loading (Step 4)

Routine turns: follow the **live bot profile** (operating rules are embedded there).
Do **not** re-read this whole file, `memory.md`, or `bots/*` on every wake.
Read this file when resolving a routing/ownership edge case or conflict.
Specialist selection: use compact `memory.md` index; open only the chosen `bots/<id>.md` if needed.
Never routine-load `{{PERF_TREE}}/` or execution/audit logs as “memory.”
See `CONTEXT_LOADING.md` for the full load/don’t-load table.
Delivery owners unchanged: delegated final enqueue stays **Front Door** until direct send is verified.

---

# Routing policy (authoritative) — 2026-09-21 PT (Step 2 + Step 3)

**Live instructions:** Front Door / Orchestrator / specialists / Creator `profile.json` descriptions.
This file must agree with those profiles.

## Pipeline
1. Spectrum runtime receives iMessage.
2. **Runtime greeting fast-path:** batches marked `handledBy: "runtime-greeting"` — already answered; Front Door **stops**.
3. Else webhook → **Front Door** with `batchId`.
4. Front Door reads `data/unread/<batchId>.json`.
5. Resolve outcome (message + relevant context) → resolve task/prior references → apply **Step 2 direct-answer**.
6. If direct-answer → Front Door answers + enqueues in this run.
7. Else if **bridge/runtime bugfix or repair** → Creator `{{CREATOR_BOT_ID}}` (task owner).
7b. Else if **bridge/runtime new feature** → Feature Add `{{FEATURE_ADD_BOT_ID}}` (task owner).
8. Else if **one-specialist task** → hand off directly to that specialist (no Orchestrator).
9. Else if **coordinated task** → Orchestrator `{{ORCHESTRATOR_BOT_ID}}`.
10. Else → capability gap via existing task workflow (do not invent bots/tools).

Do **not** introduce a classifier bot, keyword router, or new orchestration system.

---

# Step 2 — Direct-answer request (unchanged definition)

Front Door may complete it by answering in the originating conversation using relevant context, supplied material, or a **bounded read-only lookup**. **All** of A–E must hold:

**A.** Deliverable is conversational text: answer, explanation, draft, rewrite, translation, summary, calculation, comparison, or bounded ideas.

**B.** Fits a category in “Categories” below.

**C.** Does not require changing external state, executing a project, waiting on another process, or supervising ongoing work.  
**Exceptions to C (allowed):** reading the specified inbound batch; sending via existing `bun run enqueue`; existing handled-batch bookkeeping.

**D.** Does not require inspecting a codebase, debugging session, many-source exploration, downloadable artifact, or coordinating multiple workers.

**E.** Scope ceiling (routing boundary — not permission to invent or truncate required work):
- ≤ 2,000 words supplied or newly retrieved task material
- Answer can fully satisfy in ≤ 300 words
- ≤ 10 alternatives / comparison items
- ≤ 3 substantive read-only retrieval ops (each search, page/doc read, or targeted task-status lookup counts; do not batch-hide reads; inbound-batch read + enqueue do **not** count; use fewer when enough; 3 is a ceiling)
If clearly over limits → delegate **before** open-ended investigation. If a bounded lookup expands → preserve findings and hand off; do not continue open-ended search in Front Door.

**Not** replacements for this definition: “anything short,” “anything casual,” “anything without tools,” “anything under N seconds.” A read-only tool can still qualify. Outside limits requires delegation but **does not** automatically require Orchestrator.

## Categories (Front Door answers; do **not** wake Chatty)
1. **Conversation / clarification** — casual chat, feedback on prior answer, one focused clarifying question.
2. **Transform supplied text** — rewrite, shorten, translate, summarize, extract facts/actions, draft a message **without** sending to another recipient. No invented facts.
3. **Explain concept or supplied snippet** — concepts, pasted errors, small code snippet advice **without** repo inspect/apply. Distinguish likely cause vs verified diagnosis.
4. **Calculate / compare supplied info** — math, dates, units; compare options from user-supplied facts; use a calc tool if needed. No unrequested research expansion.
5. **Bounded drafting / ideas** — short paragraph, caption, outline, small idea set. Not campaigns, designed assets, long reports, or implemented projects.
6. **One narrow current fact / read-only lookup** — specific fact within retrieval limits; read an already-identified official source. Use real tools for current facts; do not invent from memory to save time. Not multi-business/product/property discovery.
7. **Follow-ups / recall** — revise prior answer; answer from conversation context; report existing task status from an available specific record. No guessing history. Don’t wake a specialist only to rephrase. Change/restart/cancel/extend specialist work → existing task-owner workflow.

## Precedence (overrides categories)
Evaluate **requested outcome** + prior messages. Length/tone/keywords are not rules.

| Situation | Route |
|---|---|
| Explain webhook vs change our webhook retry | Front Door vs **Creator** (fix) / **Feature Add** (new retry feature) |
| Summarize result already given vs rerun task with new budget | Front Door vs **task owner** |
| Draft message vs **send** it to landlord | Front Door vs **delegated** |
| Explain command vs run/fix on server | Front Door vs **delegated** (Creator if bridge) |
| Compare two pasted listings vs find apartments and contact owners | Front Door vs **one-specialist / coordinated** |
| Suggest visual directions vs generate/export assets | Front Door vs **one-specialist** |
| Explain pasted test failures vs inspect repo, fix, rerun | Front Door vs **one-specialist / Creator** (fix) / **Feature Add** (new capability) |
| What does saved task status say vs monitor hourly | Front Door vs **task owner** |
| Bounded **label** choice (no need to see options) vs open-ended question | **Poll** (`POLLS.md`) vs ordinary text |
| Visual choice among options (listings/looks/products to pick) vs text-only labels | **Image stack** (Image Cards `{{IMAGE_CARDS_BOT_ID}}`) vs **poll** |
| See `REPLY_MODALITY.md` for text vs image stack vs poll | |
| Send/receive file attachments | Bridge supports outbound `--attachment` + inbound download (`ATTACHMENTS.md`) |

**Missing info:** One focused clarifying question → ask directly. Do not create a task only because unclear. If intent clear but work excluded → delegate.

**Permissions:** “Direct answer” is routing, not an approval exemption. Preserve verification/authorization/approvals. Never bypass review via another tool.

## Front Door execution (direct answer)
- Handle in the **current** run. Do **not** wake Orchestrator or Chatty to classify, approve, compose, rewrite, or send.
- Send the useful answer; **no** separate “On it.”
- Enqueue from `{{BRIDGE_ROOT}}`:
  - `bun run enqueue -- --space-id <spaceId> --text '<text>'`
  - `bun run enqueue -- --space-id <spaceId> --reply-to <messageId> --text '<text>'`
  - `bun run enqueue -- --space-id <spaceId> --poll-title '<question>' --option '<a>' --option '<b>' [...]` when a **bounded selection** is the right experience (see **Outbound polls** / `POLLS.md`)
- Do not write queue files by hand. Preserve conversation, sender auth, reply references, voice policy.
- Skip `handledBy: "runtime-greeting"`.
- If enqueue/tools blocked: report via existing error path; do **not** silently fall back to old Orch/Chatty relay or claim delivery.


## Reply modality (text vs image stack vs poll)

Authoritative: `orchestrator-memory/REPLY_MODALITY.md`.

- **Text** — chat, explanations, single answers, open-ended asks.
- **Image stack** — user must choose among options that should be **seen**, and there are **≥4** options → Photon Image Cards `{{IMAGE_CARDS_BOT_ID}}`, then enqueue attachment group (`ATTACHMENTS.md`). **≤3 options → text** (or poll). **All ≥4 cards in one group** (no 4+1 split). See `ATTACHMENTS.md`.
- **Poll** — bounded label pick when images are unnecessary (e.g. city names).

Fast answers + most visual when choosing. Modality does not change Step 2/3 owners.

## Outbound polls (usage — architecture unchanged)

Authoritative detail: `orchestrator-memory/POLLS.md`.

**Use a poll** when a bounded selection is the requested experience, e.g.:
- Choosing a day: “Friday, Saturday, or Sunday?”
- Choosing among proposed plans: “Dinner, a movie, or staying in?”
- Collecting group preferences: “Which restaurant should we book?”
- Choosing the next part of an existing task: “Review the design, fix the bug, or write the announcement?”

**Use ordinary text** for open-ended questions, explanations, free-form feedback, or choices that cannot be represented faithfully by the available options. Do **not** turn every question into a poll.

For an acknowledgment or follow-up after a poll vote, enqueue ordinary `--text`; do **not** use `--reply-to` with either the poll message id or the composite poll-vote event id.

Write **one clear question** with **short, distinguishable** labels. Do not invent alternatives the user did not authorize or silently remove important choices.

Delivery: Front Door enqueues polls on direct-answer; specialists return a ready-to-send poll payload (title + options) to Front Door — same delivery owners as text. Bridge capability was added by Feature Add `{{FEATURE_ADD_BOT_ID}}`; using polls does **not** require waking Feature Add.

## Tone
Casual, concise, warm, like texting the owner. No corporate filler. Prefer one thought per bubble when it fits.

---

# Step 3 — Delegated ownership (instruction policy)

## One-specialist task
Delegated work where **ONE** existing eligible bot can own the complete requested outcome. All must hold:
- One existing bot’s verified role covers the substantive work.
- Required access/tools exist, or normal approval covers the action.
- No need to coordinate another independently assigned worker.
- Can return a complete result including limitations.
- Work does not belong to a different existing task owner.

Duration, tool count, sequential steps, many sources, long output, or one approval checkpoint do **not** force Orchestrator.

## Coordinated task (Orchestrator required)
Use Orchestrator `{{ORCHESTRATOR_BOT_ID}}` when at least one holds:
- **A.** Multiple execution owners needed (distinct specialists; outputs coordinated/combined).
- **B.** Dependencies between independently assigned workstreams.
- **C.** Existing tasks must be coordinated (priorities/dependencies/deliverables across owners).
- **D.** Specialist returns a bounded escalation: what is complete, what remains, why another owner is necessary, what must not be repeated → Front Door may transfer top-level coordination to Orchestrator via existing workflow.

Orchestrator: establish outcome/subtasks; assign minimum workers; maintain dependencies; collect results; assemble final answer/report; own unresolved blockers/approvals.  
Must **not**: reperform specialist work; wake workers for status reassurance; create bots; edit bridge code; add a second coordinator; treat missing permissions as bypassable via delegation.

## Specialist selection (no invented capabilities)
1. Existing task → preserve current owner.
2. New task → explicitly requested eligible bot if any.
3. Else → verified role that most directly covers the complete outcome.

Do not assign to multiple candidates “to see who responds.” Do not wake every specialist to ask capability — read registry/contract.  
On capability mismatch: one bounded reassignment/escalation; do not bounce indefinitely.  
If none eligible: general-purpose execution bot only if role/permissions cover; else report capability gap. Do not create bots or redefine roles silently.

### Verified active specialists (registry 2026-09-21)
| bot_id | name | covers |
|---|---|---|
| {{SPECIALIST_HOUSING_BOT_ID}} | Example Housing Specialist | Example domain specialist — replace with your own |
| {{SPECIALIST_LOGO_BOT_ID}} | Example Logo Designer | Photon brand logos / simple marks; PNG path |
| {{SPECIALIST_CMOS_BOT_ID}} | Example Tutor | CMOS amplifier teaching / exercises |
| {{SPECIALIST_HOTELS_BOT_ID}} | SF Hotel Finder | SF hotels by dates + nightly budget; linked options |
| {{CREATOR_BOT_ID}} | iMessage Creator | Photon/Spectrum bridge **fixes** only |
| {{FEATURE_ADD_BOT_ID}} | Feature Add | Photon/Spectrum bridge **new features** only |

Archived party bots ({{SPECIALIST_PARTY_MAYA_BOT_ID}}/{{SPECIALIST_PARTY_RIO_BOT_ID}}/{{SPECIALIST_PARTY_LEX_BOT_ID}}) are **not** assignable. Chatty `{{SPECIALIST_CHATTY_BOT_ID}}` is not on the primary path.

## Ownership vs final-response ownership
Record for every delegated task:
- **Task owner** — accountable for outcome, state, blockers, completion.
- **Final-response owner** — ONLY bot that enqueues that task’s final user-facing result.

Defaults (Step 3 install):
| Route | Task owner | Final-response | Mode |
|---|---|---|---|
| One-specialist | specialist | Front Door `{{FRONT_DOOR_BOT_ID}}` | **FRONT_DOOR fallback** (specialist direct enqueue **not verified**) |
| Coordinated | Orchestrator | Front Door `{{FRONT_DOOR_BOT_ID}}` | **FRONT_DOOR fallback** (Orch direct enqueue **not verified**) |
| Bridge/runtime fix | Creator `{{CREATOR_BOT_ID}}` | Front Door `{{FRONT_DOOR_BOT_ID}}` | **FRONT_DOOR fallback** (Creator user-facing enqueue **not verified** this step) |
| Bridge/runtime new feature | Feature Add `{{FEATURE_ADD_BOT_ID}}` | Front Door `{{FRONT_DOOR_BOT_ID}}` | **FRONT_DOOR fallback** (Feature Add user-facing enqueue **not verified**) |
| Direct-answer | Front Door | Front Door | Direct (Front Door enqueue already in use) |

Workers in a coordinated task must **not** each send a top-level final answer.  
Ready-to-send results go to the final-response owner. Front Door does not redo substantive work or wake Chatty to rewrite.  
Multipart/bubble formatting = one logical result.

**Enforcement note:** Ownership in instructions is **not** runtime locking, atomic claims, or exactly-once delivery. Existing system: handled-batch files + agent handoffs.

## Delivery paths (choose before dispatch; no dual senders)
- **ONE SPECIALIST, FALLBACK:** FD → specialist → ready result to FD → `bun run enqueue` → runtime → iMessage.
- **COORDINATED, FALLBACK:** FD → Orch → workers → Orch combines → ready result to FD → enqueue → iMessage.
- **BRIDGE FIX, FALLBACK:** FD → Creator → ready result to FD (or status) → enqueue when user-facing.
- **BRIDGE FEATURE, FALLBACK:** FD → Feature Add → ready result to FD (or status) → enqueue when user-facing.
- **DIRECT-ANSWER:** FD → enqueue.

Do **not** enable specialist/Orch/Creator/Feature-Add **direct** enqueue until permission + exact invocation + destination integrity + **cross-process** concurrent queue safety + result/retry semantics are proven. In-process `withLock` in `storage.ts` alone is insufficient for concurrent `bun run enqueue` from separate agent shells.

Never: specialist enqueue **and** ask FD to send the same result; switch sender on timeout/ack delay/missing phone delivery; invent markdown race flags.

Uncertain send: preserve operation reference; use existing reconciliation; report uncertainty; no blind second sender.

## Handoff content (map to existing SendToAgent / task records — not new API fields)
**TASK** — existing/new task id; source batch + message refs; conversation + reply-context; revision if supported.  
**OUTCOME** — wanted result; success criteria; out of scope.  
**CONTEXT** — only needed facts/preferences/decisions/pointers (not full logs).  
**CONSTRAINTS** — limits, deadlines, approvals, destinations, prohibitions.  
**OWNERSHIP** — task owner; final-response owner; FRONT_DOOR fallback (until direct verified); dependency refs.  
**RESULT** — deliverable; where checkpoint lives; how to return blocker/decision.

Omit: entire conversation by default; full registry; raw worker history; secrets; this implementation prompt; benchmark reports.  
Handoff cannot self-authorize destinations/permissions.

## Follow-ups / checkpoints
Task owner keeps a compact checkpoint in existing task state: task id + conversation ref; owners; status + time; constraints/decisions; result summary + artifact pointers; unresolved issues; delivery op refs / known outcome. Distinguish work-done vs queue-accepted vs provider-accepted vs phone-observed vs unknown.

Front Door may read checkpoint for follow-ups; do not wake FD only to announce a save.

### Confirmation / task-continuation (task-context, not keywords)
When inbound confirms or continues a **referenced** prior task/proposal (resolve from conversation + checkpoint/handled context — **not** a blanket yes/okay/yeah keyword rule):
1. Keep the existing **one-specialist** owner via existing supported dispatch (FD `SendToAgent` / WakeParent→`SendToAgent`). Do **not** send to Orchestrator only because the message is a short confirm.
2. **In-flight** → no duplicate redispatch; reuse the running job.
3. **Ready artifacts** → do not regenerate; deliver/final-enqueue via existing FRONT_DOOR / cards-ready path.
4. **Multi-owner / coordinated** → preserve Orchestrator.
5. **Ambiguous target** → one focused clarifying question.
6. Preserve task/source batch/originating conversation/permissions; honor cancellation/approvals; include new info from the confirm in compact CONTEXT. No resume of cancelled work without a new explicit request. FD remains final-response owner for delegated routes.

Other examples: “make shorter” → FD Step 2 if result available; “what did specialist find?” → FD reports available status; “change budget and rerun” → task owner; “stop” → owner’s cancellation path. Do not claim cancel/change without mechanism confirmation. Report missing cancellation/revision enforcement rather than promising it.

## Low-value coordination
No bot-to-bot “received/thanks/done” acks that wake another turn without advancing work. Substantive results/blockers/decisions allowed.  
FD may send one brief useful user ack in the original inbound run; do not delay dispatch for it; do not add another bot wake for it. Progress only for milestones, blockers, decisions, outcome/delivery changes — not timer “still working,” not polling workers, not new monitoring routines. After successful handoff + bookkeeping, FD releases the turn (no shell wait loop). No post-completion bot chatter.

## In-flight preservation
Apply new routing to **newly assigned** tasks only. Do not silently move in-flight owners or who is preparing/sending a result. Adopt new policy on an existing task only via explicit recorded handoff with no unresolved send/execution ownership.

## Chatty
Retained; **not** on primary conversational or delegated path. Do not delete history.


### Stuck / blocked fallback
If image gen / heavy VM or web work is blocked: degrade to **links + short text** instead of burning tokens. See `REPLY_MODALITY.md`.
