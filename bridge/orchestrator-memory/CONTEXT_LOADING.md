# Context loading rules (Step 4) — 2026-09-21 PT

Human-readable operating rules for **what to load when**.
Does **not** replace `CHAT_VS_TASK.md` (routing/ownership authority).
Does **not** change Step 2/3 delivery owners. Specialist/Orch/Creator direct enqueue remains **disabled**.

## Classification
| Class | Examples | Load habit |
|---|---|---|
| A. Operating instructions | Role bounds; Step 2/3 rules for this bot; auth; voice; verified enqueue for authorized sender; queue≠delivery | Keep in **live profile**. Re-read on-disk contract only on conflict/edge case. |
| B. Current request | Specified unread batch; relevant prior turns; user-supplied material; this task’s constraints/owner/status | Load for **this wake** as needed. |
| C. Retrievable reference | Other bots’ full contracts; old task evidence; bridge docs; perf/rollback reports; troubleshooting history | Keep on disk; load **only** with an identifiable reason. |
| D. Execution/audit records | inbound logs, unread batches, outbound queue/audit, handled ids, claims, retries | **Do not** delete/compact/relocate/schema-change in Step 4. Point to them; never replace them with summaries. |

## Front Door (`{{FRONT_DOOR_BOT_ID}}`) — each inbound wake
1. Read the **specified** unread batch via existing workflow. Preserve all messages in that batch, conversation, reply refs. Skip runtime-greeting batches per existing rules.
2. Use relevant conversation context already available. Do not ignore earlier turns to save cost; do not reread an entire transcript “just in case.”
3. **Direct-answer (most wakes):** rely on **this profile’s** embedded Step 2/3 rules + batch + needed conversation. Do **not** routinely Read `CHAT_VS_TASK.md`, `memory.md`, `bots/*`, `{{PERF_TREE}}/`, `inbound.jsonl`, `outbound.jsonl`, or whole `orchestrator-handled/`.
4. **Retrieve more only for a reason:** referenced missing prior answer; missing necessary constraint; specific task status/result; specialist capability check before handoff; current factual verification; messaging op needs its usage docs; targeted diagnostic for an observed error. “Be thorough” / “check everything” is **not** a reason to load the project.
5. **Match read to need:** rewrite → supplied text + style; follow-up → available answer (fetch only if missing); task status → that task’s checkpoint/status source (not all histories); delegation → compact `memory.md` index, then **only** selected `bots/<id>.md` if needed; bounded choice / poll → `POLLS.md` (or the poll rules in profile / `CHAT_VS_TASK.md`); bridge diagnosis routing → policy in profile (runtime investigation → Creator; new bridge feature → Feature Add).
6. Reuse already-read material in the same run when unchanged and sufficient. Recheck mutable auth/queue state when existing rules require it before consequential sends.
7. If investigation would exceed Step 2 bounds → installed delegation route. Do not skip essential evidence, guess, or mark incomplete answers complete to stay under a read budget.

## Orchestrator (`{{ORCHESTRATOR_BOT_ID}}`)
Load coordination policy (profile) + records for work **you are coordinating**. Do not load every account task, full specialist manuals, or perf/audit trees.

## Specialists
Load own role (profile) + current assignment + necessary evidence + delivery contract (**ready result → Front Door**; no self-enqueue). Do **not** load the full shared registry or other specialists’ contracts unless the assignment explicitly requires it.

## Creator (`{{CREATOR_BOT_ID}}`)
Load bridge details when doing bridge work. Do not push bridge implementation docs into other bots’ routine context.
Coding + computer access (general): `CODING_AND_COMPUTER_ACCESS.md` — Cursor on the web for coding; no user-computer access unless he specifically asks.

## Feature Add (`{{FEATURE_ADD_BOT_ID}}`)
Same as Creator — see `CODING_AND_COMPUTER_ACCESS.md`.

## Chatty (`{{SPECIALIST_CHATTY_BOT_ID}}`)
Off primary path. If woken in error: no enqueue; one note to sender; stop. Do not load registry/perf.

## Authoritative copies
- Routing/ownership meaning: live profiles + `CHAT_VS_TASK.md` (on conflict, align to profiles for Step 2/3 install; then fix the file).
- Compact specialist index: `memory.md` (pointers only).
- Perf/rollback/reports: `{{PERF_TREE}}/` — **never** routine-loaded.
- Poll when-to-use / enqueue shape: `POLLS.md` — load when composing a bounded choice or poll payload; do not load for every wake.
- Coding + computer access: `CODING_AND_COMPUTER_ACCESS.md`.
- This file: reference for loading discipline; bots should follow the copy embedded in their profiles.
