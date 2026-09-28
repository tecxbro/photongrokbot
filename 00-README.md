# Photon ↔ Grok iMessage — handoff pack (adopter)

You imported a **Grok bot** that can stand up a **Photon Spectrum hosted iMessage** line bridged to a Front Door + specialist graph. **You do not run engineer setup steps.** Tell the bot you want iMessage / Grokbot online; it follows `skills/getting-started/SKILL.md` and does the work on the **agent VM**.

Packed: **2026-09-27** (PT). Scrubbed — no live secrets, phones, personal specialists, or runtime queues.

**Memory source of truth:** `bridge/orchestrator-memory/` (top-level `orchestrator-memory/` is a pointer only).

---

## What the bot will do for you

1. Point you at Photon CLI docs and install the **Photon CLI on the agent VM** (npm or standalone binary).
2. Authenticate via the CLI with **device login**: on the VM the bot runs `photon login --no-browser`, then gives you the verification URL (typically `https://app.photon.codes/sign-in/device`) and the user code from the CLI; you approve in your browser.
3. Create a Spectrum **free-plan** project named **`grokbot`**. If that name is taken, try `grokbot-A` … `grokbot-Z`, then provision the bot’s hosted iMessage line (**capture the number; do not invite you to text yet**).
4. Install this pack’s **bridge** on the VM, fill `SPECTRUM_PROJECT_ID` / `SPECTRUM_PROJECT_SECRET` from CLI outputs. Leave webhook keys blank for now. Start work toward runtime after STT.
5. **Download the Moonshine STT model** (required — weights are not in the tarball; see `stt/INSTALL.md`).
6. **Create all sibling agents first** (Front Door + Master Orchestrator + Creator + Feature Add + Image Cards + App Sheet), attach skills, write bot cards.
7. **Front Door finishes phone:** use your already-known phone, or ask once in E.164 (e.g. **`+19876543210`**) for `AUTHORIZED_SENDER_ID` / `photon spectrum users add`, and write it into `.env`.
8. **Front Door finishes webhook:** create the **Photon iMessage wake** routine on Front Door, **write** `GROK_ORCHESTRATOR_WEBHOOK_URL` + `GROK_ORCHESTRATOR_WEBHOOK_KEY` into bridge `.env` itself, restart the runtime. **You are never asked to paste webhook URL, bearer, Authorization header, or POST body.**
9. **Ready checklist passes**, then the bot gives you its hosted iMessage number. **First live proof:** text **anything** to that bot number from your authorized phone (not to your own number; suggest `hi` if you want a prompt). The bot replies once with a greeting such as **“it’s grokbot here”** plus an iMessage **confetti** message effect (`--effect confetti` / `setup-confetti` marker).

**Order matters:** bots → phone + webhook finish (bot writes `.env`) → restart → checklist → then first text. Setup finishes before any invite to text.

---

## Photon CLI docs (for the bot)

Primary index + CLI pages (ground commands here; do not invent flags):

| Doc | URL |
|---|---|
| Docs index (includes CLI) | https://photon.codes/docs/llms.txt |
| Full docs dump (CLI section inside) | https://photon.codes/docs/llms-full.txt |
| CLI overview | https://photon.codes/docs/cli/overview |
| Installation | https://photon.codes/docs/cli/installation |
| Authentication | https://photon.codes/docs/cli/authentication |
| Projects | https://photon.codes/docs/cli/projects |
| Spectrum (users / lines) | https://photon.codes/docs/cli/spectrum |

Note: `https://photon.codes/docs/llms-cli.txt` is the named CLI llms feed; if it 404s / “Asset not found”, use **`llms.txt` + the `/docs/cli/*` pages** or the CLI section of **`llms-full.txt`**.

## Bundled Photon skills — install them on the VM

The pack vendors scrubbed copies of the Photon skills from **https://github.com/photon-hq/skills.git**, especially:

- `photon-skills/photon-cli/` — **https://github.com/photon-hq/skills/tree/main/skills/photon-cli**
- `photon-skills/spectrum/` — **https://github.com/photon-hq/skills/tree/main/skills/spectrum**
- `photon-skills/imessage/` — **https://github.com/photon-hq/skills/tree/main/skills/imessage**

The bot must install these on the **agent VM** before setup, not just read them from the tarball. Follow the upstream skill install guidance first:

```bash
npx skills add photon-hq/skills --skill photon-cli
npx skills add photon-hq/skills --skill spectrum
npx skills add photon-hq/skills --skill imessage
```

If that installer is unavailable, copy the bundled skills into the VM's agent skills directory (replace `{{PACK_ROOT}}` with the unpacked path):

```bash
export AGENT_SKILLS_DIR="${AGENT_SKILLS_DIR:-$HOME/.agents/skills}"
mkdir -p "$AGENT_SKILLS_DIR"
for skill in photon-cli spectrum imessage; do
  cp -a "{{PACK_ROOT}}/photon-skills/$skill" "$AGENT_SKILLS_DIR/"
done
```

If the bundled copy is unavailable, clone/sparse-checkout the GitHub repository and copy `skills/photon-cli` (and the other two small skills) into `$AGENT_SKILLS_DIR`:

```bash
tmp_dir=$(mktemp -d)
git clone --depth 1 --filter=blob:none --sparse \
  https://github.com/photon-hq/skills.git "$tmp_dir"
git -C "$tmp_dir" sparse-checkout set \
  skills/photon-cli skills/spectrum skills/imessage
for skill in photon-cli spectrum imessage; do
  cp -a "$tmp_dir/skills/$skill" "$AGENT_SKILLS_DIR/"
done
```

Verify `$AGENT_SKILLS_DIR/photon-cli/SKILL.md`, read that installed skill, and then use **photon-cli** to drive Photon project creation, Spectrum setup, and iMessage line setup. Use the live docs above for flags; do not invent commands.

---

## Role map (placeholders → real ids after CreateAgent)

| Role | Bot id placeholder | Agent UUID placeholder | Folder |
|---|---|---|---|
| Front Door | `{{FRONT_DOOR_BOT_ID}}` | `{{FRONT_DOOR_AGENT_UUID}}` | `agents/front-door/` |
| Master Orchestrator | `{{ORCHESTRATOR_BOT_ID}}` | `{{ORCHESTRATOR_AGENT_UUID}}` | `agents/master-orchestrator/` |
| Creator | `{{CREATOR_BOT_ID}}` | `{{CREATOR_AGENT_UUID}}` | `agents/creator/` |
| Feature Add | `{{FEATURE_ADD_BOT_ID}}` | `{{FEATURE_ADD_AGENT_UUID}}` | `agents/feature-add/` |
| Image Cards | `{{IMAGE_CARDS_BOT_ID}}` | `{{IMAGE_CARDS_AGENT_UUID}}` | `agents/image-cards/` |
| App Sheet | `{{APP_SHEET_BOT_ID}}` | `{{APP_SHEET_AGENT_UUID}}` | `agents/app-sheet/` |
| Live Mini (optional) | `{{LIVE_MINI_BOT_ID}}` | `{{LIVE_MINI_AGENT_UUID}}` | `agents/live-mini/` + `live-mini/` |
| Wake routine | — | `{{PHOTON_WAKE_ROUTINE_ID}}` | `routines/` |

**Live Mini** auto-deploys when the **Vercel connector** is already ready (`skills/live-mini-enable` deploy-all, no questionnaire); otherwise it is offered on fitting live-mini requests (human-facing Spectrum Apps + Vercel pitch — never a Spectrum install machine check). Core path is six agents + bridge + mandatory STT; Live Mini is an optional seventh when auto-enable runs.

---

## Pack layout

```text
00-README.md                 ← you are here (adopter)
01-ARCHITECTURE.md
02-SECRETS.md                ← key NAMES; bot obtains values via CLI / ask
03-WHAT-NOT-IN-SHARE.md
MANIFEST.txt
bridge/                      ← Spectrum Bun runtime (decision + enqueue/runtime)
  src/                       ← inbound, enqueue, runtime, setup-confetti, voice-stt, …
  orchestrator-memory/       ← REPLY_MODALITY, REACTIONS_EFFECTS, CHAT_VS_TASK, …
skills/getting-started/      ← bot auto-setup playbook (run this first)
photon-skills/photon-cli/     ← vendored GitHub Photon CLI skill (install on VM)
photon-skills/spectrum/        ← vendored Photon Spectrum skill
photon-skills/imessage/        ← vendored Photon iMessage skill
skills/imessage-front-door-wake/  (+ other workflow skills)
agents/{front-door,…}/
routines/photon-imessage-wake.REDACTED.json
stt/INSTALL.md               ← mandatory Moonshine download (bot runs)
live-mini/                   ← live-task-cards host (auto-deploy when Vercel ready)
skills/live-mini-enable/     ← deploy-all / offer path for Live Mini
```

## Intentionally omitted

See **`03-WHAT-NOT-IN-SHARE.md`**. No live `.env`, phones, tokens, STT weights, or personal specialists.
