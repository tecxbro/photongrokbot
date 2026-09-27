# What is not in this share (and why one bot share is not enough)

## Why sharing a single bot is not enough

The system is a **graph**:

1. **Bun Spectrum bridge** (auth, batching, webhook, outbound drain) — code + `.env`
2. **Front Door** webhook routine + skills (`getting-started`, wake) + profile
3. **Orchestrator / Creator / Feature Add / Image Cards / App Sheet** — separate agents + skills
4. **orchestrator-memory** contracts (`CHAT_VS_TASK`, `REPLY_MODALITY`, `REACTIONS_EFFECTS`, …)
5. **Moonshine STT** venv + weights (downloaded on the VM; not in the tarball)

Exporting one Grok bot profile without the bridge, webhook, memory contracts, sibling agents, and STT leaves adopters unable to receive or send full iMessage traffic.

## What the **imported bot** creates (not a human engineer checklist)

| Item | Bot action (`skills/getting-started`) |
|---|---|
| Photon CLI on agent VM | Install via npm or binary; point adopter at https://photon.codes/docs/cli/installation |
| Auth | `photon login` (adopter approves browser / `--no-browser` URL) |
| Spectrum project | Create `grokbot` or `grokbot-A`…`Z` with `--spectrum` |
| Hosted bot line + authorized sender | Provision the Spectrum free-plan hosted line and give its number to the adopter; use the adopter’s already-known phone, or ask once in E.164 like `+19876543210`, for `AUTHORIZED_SENDER_ID` / `photon spectrum users add` |
| Bridge install | Copy `bridge/`, fill `.env` from CLI, `bun install`, start runtime |
| Moonshine STT | **Required** — run `stt/INSTALL.md` (download weights) |
| Six Grok agents | CreateAgent from `agents/*/PROFILE_TEMPLATE.md` |
| Skills | Attach workflows under `skills/` including **`getting-started`** on Front Door |
| Webhook routine | Front Door **Photon iMessage wake**; wire URL + bearer into `.env` |
| Bot cards + `memory.md` | Fill real serverIds after creation |
| First live proof | Bot gives its hosted line number; adopter texts **anything** to that number (not their own; suggest `hi`) → “it’s grokbot here” + **confetti** once |
| Domain specialists | Optional — create your own later. **Not** shipped. |
| Live Mini host | Optional — deploy `live-mini/live-task-cards/` only if wanted |

## Explicitly excluded from this pack

- Live `.env` / `.env.bak*` with values
- `node_modules/`, `.venv-moonshine/`
- `data/unread`, `data/outbound-*`, `data/inbound-*`, runtime logs, pids, live queues
- Personal attachments and conversation threads
- Personal specialist bots (housing, hotels, Italy, party-sim, CMOS tutor, logo, Chatty, …)
- Live Mini **production** secrets, Blob tokens, personal spaceIds, and bulky migration/deploy JSON dumps (teaching docs + source **are** under `live-mini/`)
- Real bot serverIds, agent UUIDs, webhook routine UUIDs, spaceIds, phone numbers, Apple IDs
- Webhook bearers, Spectrum project secrets, API keys (`sk-…`)
- STT binary weights (bot downloads; see `stt/INSTALL.md`)

## Decisions recorded

- **Bot does setup** — adopter-facing docs keep the proof to one action: text the bot’s hosted line (any first message; suggest `hi`).
- **STT mandatory** — Moonshine download is part of getting-started; weights stay out of the tarball.
- **Live Mini optional** — pack ships scrubbed `live-mini/` source + `agents/live-mini/` templates. Static App Sheet remains the default shipped specialist for `--app-url`.
- **Personal specialists omitted** — adopters/bots create their own; `_TEMPLATE.md` + generic `memory.md` remain.
- **SoT for memory** — `bridge/orchestrator-memory/` (top-level folder is a pointer).
- **Placeholders** — `{{FRONT_DOOR_BOT_ID}}`, `{{BRIDGE_ROOT}}`, `{{PHOTON_WAKE_ROUTINE_ID}}`, etc., used everywhere instead of the original deployment’s ids.
