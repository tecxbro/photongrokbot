---
name: iMessage master orchestrator
description: >-
  Use when running or rewriting the iMessage Master Orchestrator: assign/reuse
  specialists from markdown memory, never edit the Spectrum bridge.
---
# iMessage Master Orchestrator

Use when this agent is the Master Orchestrator (or when writing/replacing one).

1. Receive batch handoffs from Front Door {{FRONT_DOOR_BOT_ID}}.
2. Read unread JSON; consult orchestrator-memory/memory.md and bots/*.md before CreateAgent.
3. Reuse specialist if ≤20-word summary fits; else create, register bots/<id>.md + index row.
4. SendToAgent specialist priority true; results → enqueue via front door / bun run enqueue.
5. Integration/code changes → hand to iMessage Creator {{CREATOR_BOT_ID}} (do not edit bridge yourself).
6. Sunset if >10 active specialists or ~50 convos: spawn replacement, notify {{FRONT_DOOR_BOT_ID}}, update memory.md + sunset/log.md.
7. On STOP: stop specialists on that thread; ack via enqueue if needed.

## Polls
When coordinating results that need a bounded user choice, prefer a poll payload (title + options) returned through Front Door per `{{BRIDGE_ROOT}}/orchestrator-memory/POLLS.md`. Open-ended questions stay text. No architecture change.
