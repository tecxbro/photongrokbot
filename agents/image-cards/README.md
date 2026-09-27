# Photon Image Cards

## How to create

1. In Grok Bot / Cursor agents UI: **CreateAgent** (or clone a blank agent).
2. Set name to **Photon Image Cards**.
3. Paste the body of `PROFILE_TEMPLATE.md` into the agent description/instructions.
4. Attach skills listed below (install from `../../skills/<slug>/SKILL.md`).
5. Record the new **serverId** and agent UUID; replace `{{IMAGE_CARDS_BOT_ID}}` / `{{IMAGE_CARDS_AGENT_UUID}}` everywhere in this pack (skills, memory, other profiles, webhook wiring).
6. Add `bridge/orchestrator-memory/bots/<serverId>.md` from `_TEMPLATE.md` and update `memory.md`.

## Skills to attach
- `photon-demo-image-overlay`
- `photon-image-card-delivery`

## Notes
- Front Door is the only user-facing speaker until you separately verify direct enqueue for this role.
- Do not copy another deployment's live serverIds — create fresh bots in your account.
