# iMessage Front Door

Primary imported bot. **First run = `skills/getting-started`** — the bot stands up Photon CLI, Spectrum project `grokbot` (or `grokbot-A`…`Z`), bridge, mandatory Moonshine STT, **all sibling agents first**, then Front Door finishes phone + wake webhook + `.env` write + runtime restart. Only after the ready checklist does it invite the first text. Do not treat this README as a human engineer checklist.

## How to create (bot / import path)

1. **CreateAgent** (or import this pack onto an existing agent) named **iMessage Front Door**. The first-proof path uses the Spectrum **free plan**.
2. Paste `PROFILE_TEMPLATE.md` into the agent description/instructions.
3. Attach skills listed below (install from `../../skills/<slug>/SKILL.md`).
4. On first conversation about iMessage / setup, **run `getting-started`** end-to-end on the agent VM.
5. Record the new **serverId** and agent UUID; replace `{{FRONT_DOOR_BOT_ID}}` / `{{FRONT_DOOR_AGENT_UUID}}` / `{{BRIDGE_ROOT}}` everywhere after siblings exist.
6. Add `bridge/orchestrator-memory/bots/<serverId>.md` from `_TEMPLATE.md` and update `memory.md`.

## First-run order (Front Door owns finish)

1. Orient (no hi invite) → Photon skills → CLI → device login → project + hosted line (capture number only).
2. Bridge + `SPECTRUM_*` only; leave webhook keys blank; defer `AUTHORIZED_SENDER_ID` if unknown.
3. Moonshine STT (mandatory).
4. **Create all sibling agents** (Master Orchestrator, Creator, Feature Add, Image Cards, App Sheet) — or if a bootstrap bot created Front Door, accept Phase B handoff via SendToAgent.
5. **Front Door finish — phone:** prefer CLI/profile; ask E.164 once if needed; set `AUTHORIZED_SENDER_ID` + `photon spectrum users add`; write into `.env`.
6. **Front Door finish — webhook:** create Photon iMessage wake from `routines/photon-imessage-wake.REDACTED.json`; **write** URL+KEY into `.env` yourself; restart runtime. **Never** ask the human to paste URL/key/headers.
7. Ready checklist → give hosted bot number → invite first text (suggest hi) → greeting + confetti.

If bootstrap created Front Door, bootstrap must SendToAgent listing what Front Door finishes (phone → authorize → webhook → `.env` → restart → proof) and must **not** ask for hi itself.

## Skills to attach

- **`getting-started`** — first-run auto-setup (CLI → project → bridge → STT → **siblings first** → phone → webhook → ready → hi+confetti)
- `imessage-front-door-wake` — ordinary Photon webhook wakes
- `spectrum-imessage-apps-nudge`

## First live proof

Only after the ready checklist (bots + wake + `.env` webhook keys written by bot + runtime restarted + `AUTHORIZED_SENDER_ID`), Front Door gives the adopter the hosted iMessage number. The adopter texts **anything** to that bot number from their authorized phone (not their own number; suggest `hi` if they ask). Front Door replies once with a greeting like **“it’s grokbot here”** plus `--effect confetti` (see `setup-confetti` / `REACTIONS_EFFECTS.md`).

## Notes

- Front Door is the only user-facing speaker until direct enqueue is separately verified for other roles.
- Front Door owns phone authorization and wake webhook finish; the human never pastes webhook credentials.
- Do not copy another deployment's live serverIds — create fresh bots in the adopter's account.
