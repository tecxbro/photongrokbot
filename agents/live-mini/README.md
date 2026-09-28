# Live Mini Bot (optional specialist)

**Status:** retired upstream as an active bot; included here as a **reusable template** so adopters can recreate the role when rebuilding the live-task-cards host.


## Deploy-all when Vercel is connected

If the Grok Bot **Vercel connector** is already authorized for this setup, the bot runs **deploy-all** via `skills/live-mini-enable` — create this agent if missing, deploy `live-mini/live-task-cards` with `STORE=blob` + Blob + generated secrets, wire publisher, smoke `/health` + doctor — **without** a human questionnaire (no Redis-vs-blob quiz, no paste-env asks). Do **not** gate on detecting Spectrum Apps install (you cannot know); mention Spectrum Apps only in brief human-facing copy.

If Vercel is not connected and a request fits live mini: offer once (Spectrum Apps + Vercel pitch); on yes, guide Vercel connect then deploy-all; on no, App Sheet or text.

## How to create

1. Deploy / preview the host under `../../live-mini/live-task-cards/` first (or you will have nothing to point `--app-url` at).
2. **CreateAgent** → name **Live Mini Bot**.
3. Paste `PROFILE_TEMPLATE.md` into the agent description/instructions.
4. Attach operating guidance from `../../live-mini/live-task-cards/SKILL.md` (and optionally `skills/dot-matrix-mini-app` for personal loaders).
5. Record the new **serverId** / agent UUID; replace `{{LIVE_MINI_BOT_ID}}` / `{{LIVE_MINI_AGENT_UUID}}` across the pack (Front Door skill already references the placeholder).
6. Add `bridge/orchestrator-memory/bots/<serverId>.md` from `_TEMPLATE.md` and update `memory.md`.

## Skills / docs to attach or keep in context

- `../../live-mini/live-task-cards/SKILL.md` — when to open a card, matrix preference, same-URL updates
- `../../live-mini/live-task-cards/HANDOFF.md` — install + Spectrum send-once rules
- `../../bridge/orchestrator-memory/APPS.md` — enqueue `--live` / `--app-update`
- Optional: `../../live-mini/live-task-cards/skills/dot-matrix-mini-app/` — personal loaders (explicit request only)

## Notes

- Front Door remains the only user-facing speaker until you verify direct enqueue for this role.
- Do **not** confuse with App Sheet (static `--app-url` only).
- Do **not** put Blob / publisher tokens or Spectrum secrets in chat.
