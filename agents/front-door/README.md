# iMessage Front Door

Primary imported bot. **First run = `skills/getting-started`** — the bot stands up Photon CLI, Spectrum project `grokbot` (or `grokbot-A`…`Z`), bridge, mandatory Moonshine STT, sibling agents, and wake webhook. Do not treat this README as a human engineer checklist.

## How to create (bot / import path)

1. **CreateAgent** (or import this pack onto an existing agent) named **iMessage Front Door**. The first-proof path uses the Spectrum **free plan**.
2. Paste `PROFILE_TEMPLATE.md` into the agent description/instructions.
3. Attach skills listed below (install from `../../skills/<slug>/SKILL.md`).
4. On first conversation about iMessage / setup, **run `getting-started`** end-to-end on the agent VM.
5. Record the new **serverId** and agent UUID; replace `{{FRONT_DOOR_BOT_ID}}` / `{{FRONT_DOOR_AGENT_UUID}}` / `{{BRIDGE_ROOT}}` everywhere after siblings exist.
6. Add `bridge/orchestrator-memory/bots/<serverId>.md` from `_TEMPLATE.md` and update `memory.md`.

## Skills to attach

- **`getting-started`** — first-run auto-setup (CLI → project → bridge → STT → siblings → hi+confetti)
- `imessage-front-door-wake` — ordinary Photon webhook wakes
- `spectrum-imessage-apps-nudge`

## First live proof

After getting-started provisions the bot’s hosted iMessage line and gives its number to the adopter, the adopter texts **anything** to that bot number from their authorized phone (not their own number; suggest `hi` if they ask). Front Door replies once with a greeting like **“it’s grokbot here”** plus `--effect confetti` (see `setup-confetti` / `REACTIONS_EFFECTS.md`).

## Notes

- Front Door is the only user-facing speaker until direct enqueue is separately verified for other roles.
- Do not copy another deployment's live serverIds — create fresh bots in the adopter's account.
