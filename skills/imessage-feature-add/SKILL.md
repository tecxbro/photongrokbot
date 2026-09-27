---
name: iMessage feature add
description: >-
  Use when adding new Photon Spectrum iMessage bridge capabilities on the VM;
  Feature Add owns new features, Creator owns bugfixes, Front Door talks to the
  user.
---
# iMessage Feature Add

Use when this agent is Feature Add ({{FEATURE_ADD_BOT_ID}}) or when Front Door/Orchestrator assigns a **new feature** on the bridge.

1. Scope: `{{BRIDGE_ROOT}}` only.
2. Own **net-new capabilities**. Hand **bugfixes/regressions** to Creator `{{CREATOR_BOT_ID}}`.
3. Extend Bun + spectrum-ts; one feature at a time unless asked otherwise.
4. After code changes: run unit tests; restart Spectrum runtime when the new behavior must go live.
5. Never chat with the owner in the app — return ready-to-send results to Front Door `{{FRONT_DOOR_BOT_ID}}` (direct enqueue not verified).
6. Never put Spectrum secrets in chat; never require Supermemory until the owner enables it.
7. Update orchestrator-memory when a new integration contract lands.

## Polls
Bridge poll enqueue/inbound is live. Usage policy for all bots: `{{BRIDGE_ROOT}}/orchestrator-memory/POLLS.md` (bounded selection only). Do not change Step 2/3 owners when documenting or extending poll helpers.

## Reactions & effects
Outbound tapbacks (`--react`) and message effects (`--effect`) are live. Policy: `{{BRIDGE_ROOT}}/orchestrator-memory/REACTIONS_EFFECTS.md`. First-setup Confetti helper: `src/setup-confetti.ts`. Do not change Step 2/3 owners.

## Coding + computer access
Contract: `{{BRIDGE_ROOT}}/orchestrator-memory/CODING_AND_COMPUTER_ACCESS.md` (general — not incident-specific).
- **Coding-specific tasks** (repo/bridge implementation, PRs, non-trivial code edits): use **Cursor on the web** (cloud agent / Origin). Do **not** drive Cursor on the owner's computer.
- **Never access the owner's registered computers** (`machineId`, CopyFromBox/CopyToBox involving their disk, local tools on their machine) unless he **explicitly asks** in that turn.
- Shared agent box under `{{BRIDGE_ROOT}}` (runtime, markers, tests, restarts) is allowed for feature landings; that is not the owner's personal computer.

