# Orchestrator memory (markdown v1)

Supermemory deferred. This folder is the durable registry.

## Roles
| Agent | id | Job |
|---|---|---|
| iMessage Front Door | {{FRONT_DOOR_BOT_ID}} | Talks to the owner; dumb-pipe wakes → Orchestrator; enqueues |
| iMessage Master Orchestrator | {{ORCHESTRATOR_BOT_ID}} | Decides chat vs task; assigns Chatty or specialists |
| iMessage Creator | {{CREATOR_BOT_ID}} | Updates Photon/Spectrum integration code |
| Chatty | {{SPECIALIST_CHATTY_BOT_ID}} | Casual chat / fast greetings (non-tasks) |

| Path | Purpose |
|---|---|
| `memory.md` | Active index |
| `bots/<bot_id>.md` | Per-bot ≤20-word summary |
| `threads/` | Optional per-space notes |
| `sunset/log.md` | Orchestrator handoffs |
