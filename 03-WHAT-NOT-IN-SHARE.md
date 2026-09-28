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
| Hosted bot line | Provision the Spectrum free-plan hosted line; **capture** `HOSTED_IMESSAGE_NUMBER` — do **not** invite texting yet |
| Bridge install | Copy `bridge/`, fill `SPECTRUM_*` from CLI; leave webhook keys blank until Step 8; `bun install` |
| Moonshine STT | **Required** — run `stt/INSTALL.md` (download weights) |
| Six Grok agents **first** | CreateAgent from `agents/*/PROFILE_TEMPLATE.md` **before** phone / webhook / hi |
| Skills | Attach workflows under `skills/` including **`getting-started`** on Front Door |
| Front Door — phone | After bots exist: use already-known phone or ask once in E.164 like `+19876543210` for `AUTHORIZED_SENDER_ID` / `photon spectrum users add`; bot writes `.env` |
| Front Door — webhook | Create **Photon iMessage wake** on Front Door; **bot** writes URL + bearer into `.env`; restart runtime. **Never** ask the human to paste webhook URL / key / Authorization header / POST body |
| Bot cards + `memory.md` | Fill real serverIds after creation |
| First live proof (**last**) | Ready checklist passes → bot gives hosted line number → adopter texts **anything** (suggest `hi`) → “it’s grokbot here” + **confetti** once |
| Domain specialists | Optional — create your own later. **Not** shipped. |
| Live Mini host | Auto-deploy via `live-mini-enable` when Vercel connected; else offer on fit (Spectrum Apps pitch is human-facing only) |

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

- **Bots before phone / webhook / hi** — create all six core agents first; Front Door owns phone + wake finish; proof is last.
- **Bot writes `.env` webhook keys** — never instruct the human to paste webhook URL, bearer, Authorization header, or POST body.
- **Bot does setup** — adopter-facing docs keep the proof to one action: text the bot’s hosted line (any first message; suggest `hi`) **only after** the ready checklist.
- **STT mandatory** — Moonshine download is part of getting-started; weights stay out of the tarball.
- **Live Mini auto-deploy when Vercel ready** — pack ships scrubbed `live-mini/` source + `agents/live-mini/` + `skills/live-mini-enable` (deploy-all, no questionnaire; Spectrum Apps only in pitch text). Static App Sheet remains the default shipped specialist for static `--app-url`.
- **Personal specialists omitted** — adopters/bots create their own; `_TEMPLATE.md` + generic `memory.md` remain.
- **SoT for memory** — `bridge/orchestrator-memory/` (top-level folder is a pointer).
- **Placeholders** — `{{FRONT_DOOR_BOT_ID}}`, `{{BRIDGE_ROOT}}`, `{{PHOTON_WAKE_ROUTINE_ID}}`, etc., used everywhere instead of the original deployment’s ids.
