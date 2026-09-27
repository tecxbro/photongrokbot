---
name: getting-started
description: >-
  First-run auto-setup for Photon Spectrum ↔ Grok iMessage (grokbot). The imported
  bot runs this on the agent VM — do not hand engineer steps to the human.
---
# Getting started — bot auto-setup playbook

**Audience:** you (the imported Front Door / primary bot), not the human adopter.

**Goal:** Use the Spectrum **free plan** to stand up the hosted iMessage line, bridge + STT + sibling agents on the **agent VM**, then prove live with one exact flow: the bot gives the adopter the bot’s hosted line number; the adopter texts **anything** to that number from their authorized phone (suggest `hi` if they ask what to send); the bot replies once with a greeting like “it’s grokbot here” **plus a confetti message effect**.

**Do not** ask the adopter to run `bun install`, fill `.env`, or download models. You run those steps. The adopter’s only live action is texting `hi` to the hosted number you give them. Only pause when a human action is required (browser login approval, or the adopter’s phone number for authorization).

Ground every Photon CLI flag in live docs — fetch before inventing:

- https://photon.codes/docs/llms.txt
- https://photon.codes/docs/cli/installation
- https://photon.codes/docs/cli/authentication
- https://photon.codes/docs/cli/projects
- https://photon.codes/docs/cli/spectrum
- Full dump if needed: https://photon.codes/docs/llms-full.txt (CLI section)
- Named feed `https://photon.codes/docs/llms-cli.txt` — if 404 / “Asset not found”, use the pages above

Photon skills source and docs:

- Repository: https://github.com/photon-hq/skills.git
- Photon CLI skill: https://github.com/photon-hq/skills/tree/main/skills/photon-cli
- Spectrum skill: https://github.com/photon-hq/skills/tree/main/skills/spectrum
- iMessage skill: https://github.com/photon-hq/skills/tree/main/skills/imessage

Pack root on disk: wherever this share was unpacked (call it `{{PACK_ROOT}}`). Bridge lives at `{{PACK_ROOT}}/bridge/` (or copy to `{{BRIDGE_ROOT}}`).

---

## Step 0 — Orient the adopter (short)

Tell them, in plain language:

1. You will install Photon CLI on the VM, create a Spectrum **free-plan** project **`grokbot`** (or `grokbot-A`…`Z`), provision the bot’s hosted iMessage line, wire the bridge, download voice STT, and create sibling bots.
2. You may already have their phone number; if not, ask once for the number to authorize as `AUTHORIZED_SENDER_ID` and register as a Spectrum user. They may also need to approve a browser login.
3. When ready, give them the hosted iMessage line number — the bot’s number, not their own — and tell them to text that number from their authorized phone (**any first message works**; suggest `hi` if they want a prompt). Reply once with a grokbot greeting (“it’s grokbot here” / similar) **plus confetti**. That is the live proof.

Point them at CLI docs only as reference: https://photon.codes/docs/cli/installation (and the llms index above). Then you do the work.

---

## Step 0.5 — Install Photon skills on the agent VM

Do this on the agent VM before running Photon setup. The pack includes a scrubbed copy under `{{PACK_ROOT}}/photon-skills/`, but the source of truth is the GitHub repository above. Install the skills into the VM's agent skills directory; do not merely mention them or leave them only in the unpacked pack.

Use the upstream installer guidance when available:

```bash
# Run on the agent VM; install the skills where the agent discovers them.
npx skills add photon-hq/skills --skill photon-cli
npx skills add photon-hq/skills --skill spectrum
npx skills add photon-hq/skills --skill imessage
```

If the skills installer is unavailable, copy the bundled scrubbed skills into the agent skills directory. If the pack copy is unavailable, sparse-checkout the same GitHub paths and copy them:

```bash
export AGENT_SKILLS_DIR="${AGENT_SKILLS_DIR:-$HOME/.agents/skills}"
mkdir -p "$AGENT_SKILLS_DIR"

# Prefer the verified copy shipped in this pack.
for skill in photon-cli spectrum imessage; do
  cp -a "{{PACK_ROOT}}/photon-skills/$skill" "$AGENT_SKILLS_DIR/"
done

# Fallback only when {{PACK_ROOT}}/photon-skills is not present:
# tmp_dir=$(mktemp -d)
# git clone --depth 1 --filter=blob:none --sparse \
#   https://github.com/photon-hq/skills.git "$tmp_dir"
# git -C "$tmp_dir" sparse-checkout set \
#   skills/photon-cli skills/spectrum skills/imessage
# for skill in photon-cli spectrum imessage; do
#   cp -a "$tmp_dir/skills/$skill" "$AGENT_SKILLS_DIR/"
# done
```

Verify that `$AGENT_SKILLS_DIR/photon-cli/SKILL.md` exists, then read that installed skill (especially `SKILL.md`, `getting-started.md`, and `spectrum.md`) and use it to drive Photon project, Spectrum, and iMessage line setup. Follow its current command guidance and the live Photon docs above; do not invent CLI flags. The bundled `spectrum` and `imessage` skills are useful references for the bridge and handler behavior.

---

## Step 1 — Install Photon CLI on the agent VM

After the Photon skills are installed, use the installed `photon-cli` skill to drive this CLI installation and all later project/line commands.

Verified from https://photon.codes/docs/cli/installation (Node ≥ 18):

**Preferred (global npm):**

```bash
npm install -g @photon-ai/cli
photon --version
photon ping
```

**Alternatives (same docs):**

```bash
# one-off
npx @photon-ai/cli ping
# or Bun
bun add -g @photon-ai/cli
# or standalone binary (linux x64 example)
curl -L -o /usr/local/bin/photon \
  https://github.com/photon-hq/cli/releases/latest/download/photon-linux-x64
chmod +x /usr/local/bin/photon
photon --version
photon ping
```

Use `linux-arm64` / `darwin-arm64` / `darwin-x64` as appropriate. Do not invent other download URLs.

---

## Step 2 — Authenticate (device login — human approves)

From https://photon.codes/docs/cli/authentication and the installed `photon-cli` skill:

On the **agent VM**, prefer headless so the CLI does not try to open a browser on the machine:

```bash
photon whoami --json || photon login --no-browser
```

`photon login --no-browser` uses OAuth **device authorization**. It prints a **verification URL** and a **user code**, then polls until approved.

**Hand both to the adopter in chat** (do not ask them to run CLI):

1. **URL** — use the exact URL the CLI prints. Typical production shape: `https://app.photon.codes/sign-in/device` (prefer the printed URL if it differs).
2. **Code** — the short user code from the same CLI output.

Tell them: open that link on their phone or laptop, enter the code, approve the login. Keep the CLI process running until it reports success, then continue.

```bash
photon whoami
photon auth status --json   # optional
```

CLI login token ≠ Spectrum **project secret**. Bridge auth uses project id + project secret only.

---

## Step 3 — Use the photon-cli skill to create a Spectrum free-plan project and provision the bot line `grokbot` (fallback `grokbot-A`…`Z`)

First consult the installed `photon-cli` skill and the live docs, then run the documented commands below. From https://photon.codes/docs/cli/projects:

```bash
photon projects ls --json
```

Use the Spectrum **free plan** for this first-proof flow; do not upgrade the project. If a project named exactly `grokbot` already exists and is yours to reuse on the free plan, set it active. Otherwise create:

```bash
photon projects create --name "grokbot" --spectrum
# if name conflict / create fails because name taken, try:
#   grokbot-A, grokbot-B, … grokbot-Z
```

Location flag `--location us-east` is documented; include it when the CLI requires a region.

Capture **project id**. Export for the shell session:

```bash
export PHOTON_PROJECT_ID='<project-id>'
```

Obtain **project secret** (Spectrum Basic auth for `spectrum-ts` — **not** `PHOTON_TOKEN`):

```bash
photon projects show --json
# or, if create output showed the secret once, save it immediately
# rotate only if needed: photon projects regenerate-secret -y
```

Write values into bridge `.env` later as `SPECTRUM_PROJECT_ID` / `SPECTRUM_PROJECT_SECRET`.

Provision the hosted iMessage line for the bot and capture its number:

```bash
photon spectrum platforms ls
photon spectrum lines ls --json
# add the hosted bot line if none (interactive): photon spectrum lines add
photon spectrum lines ls --json
```

Set `HOSTED_IMESSAGE_NUMBER` to the line’s E.164 number. This is the bot’s destination number for the proof. Give this number to the adopter after setup; never tell them to text their own authorized number.

---

## Step 4 — Get the adopter’s authorized sender phone (not the bot line)

The bot already has the adopter’s phone when it is available after login. Prefer a number **already available**:

```bash
photon whoami
photon profile show
photon spectrum users ls --json
```

If the adopter’s personal iMessage handle is not clear, **ask once**:

> What’s the phone number I should authorize for this bot? Use E.164 like `+19876543210`.

Set `AUTHORIZED_SENDER_ID` to that exact string (E.164 or Apple ID email as Spectrum uses it). This is the adopter’s authorized sender identity; it is not the hosted bot line and is not the number they text.

Register them as a Spectrum user on the Spectrum **free-plan** project:

```bash
photon spectrum users add
# follow CLI prompts / flags from --help; do not invent undocumented flags
```

Optional availability check (docs): `photon projects check-phone +19876543210`

---

## Step 5 — Install bridge on the VM + fill env + start runtime

```bash
# Example install path — choose a stable {{BRIDGE_ROOT}} on the VM
export BRIDGE_ROOT="${BRIDGE_ROOT:-/workspace/grokbot-bridge}"
mkdir -p "$BRIDGE_ROOT"
cp -a "{{PACK_ROOT}}/bridge/." "$BRIDGE_ROOT/"
cd "$BRIDGE_ROOT"
cp .env.example .env
chmod 0600 .env
```

Fill `.env` yourself (see `02-SECRETS.md` for key names):

| Key | How you get it |
|---|---|
| `SPECTRUM_PROJECT_ID` | `photon projects show` / create |
| `SPECTRUM_PROJECT_SECRET` | same / regenerate-secret |
| `AUTHORIZED_SENDER_ID` | Step 4 |
| `GROK_ORCHESTRATOR_WEBHOOK_URL` | after wake routine (Step 8) |
| `GROK_ORCHESTRATOR_WEBHOOK_KEY` | same routine bearer |

```bash
# Bun required for this bridge
command -v bun >/dev/null || curl -fsSL https://bun.sh/install | bash
bun install
# STT first (Step 6) before calling ready — voice is mandatory
./scripts/start-runtime.sh   # or: bun run start
```

Confirm runtime is up (process listening / log healthy). Do not paste secrets into chat.

---

## Step 6 — Moonshine STT (mandatory)

Weights are **not** in the tarball (~214 MB). Follow **`{{PACK_ROOT}}/stt/INSTALL.md`** end-to-end on `{{BRIDGE_ROOT}}`:

1. `python3 -m venv .venv-moonshine` + `pip install -U moonshine-voice`
2. Ensure `ffmpeg` on PATH
3. Download `small-streaming-en` / `quantized_26_08_21` (HF preferred or Moonshine CDN/SDK)
4. Place under `data/models/moonshine/small-streaming-en/quantized_26_08_21/`
5. Spot-check with `tools/moonshine_stt.py` if a sample wav is available

Do not mark setup complete without STT installed.

---

## Step 7 — Sibling agents + skills (you create them; do not hand this to the human)

Drive CreateAgent / equivalent tooling yourself. Do not ask the adopter to paste profiles.

For each row, create the agent, paste `PROFILE_TEMPLATE.md` as the profile body (after placeholder substitution), and attach the listed skills from `{{PACK_ROOT}}/skills/`:

| Folder | Skills to attach |
|---|---|
| `agents/front-door/` | `imessage-front-door-wake`, `spectrum-imessage-apps-nudge`, **`getting-started`** (this skill) |
| `agents/master-orchestrator/` | `imessage-master-orchestrator` |
| `agents/creator/` | `imessage-creator` |
| `agents/feature-add/` | `imessage-feature-add` |
| `agents/image-cards/` | `photon-demo-image-overlay`, `photon-image-card-delivery` |
| `agents/app-sheet/` | `spectrum-imessage-apps-nudge` |

**After each create, record and substitute:**

1. Real `serverId` / agent UUID for that bot.
2. Replace placeholders everywhere they appear: `{{FRONT_DOOR_BOT_ID}}`, `{{MASTER_ORCHESTRATOR_BOT_ID}}`, `{{CREATOR_BOT_ID}}`, `{{FEATURE_ADD_BOT_ID}}`, `{{IMAGE_CARDS_BOT_ID}}`, `{{APP_SHEET_BOT_ID}}`, matching `{{*_AGENT_UUID}}`, and `{{BRIDGE_ROOT}}` / `{{PACK_ROOT}}`.
3. Write bot cards: `bridge/orchestrator-memory/bots/<serverId>.md` from `_TEMPLATE.md` + the matching `ROLE_*.md`; update `bridge/orchestrator-memory/memory.md` with the live roster.
4. Prefer creating **Front Door first** (needs wake skill + this playbook), then Master Orchestrator, then Creator / Feature Add / Image Cards / App Sheet.

Live Mini (`agents/live-mini/` + `live-mini/`) is optional — skip unless the adopter asks for it.

---

## Step 8 — Webhook wake routine (bot wires this; human does not)

On the **Front Door** agent (not the adopter’s checklist), create routine **Photon iMessage wake** from `routines/photon-imessage-wake.REDACTED.json`:

1. Trigger type: **webhook**.
2. Prompt / procedure: follow `skills/imessage-front-door-wake/SKILL.md` (parse `{"batchId"}`, load unread batch under `{{BRIDGE_ROOT}}`, Step 2/3, enqueue). Do not put message text in the webhook body.
3. Enable the routine. Copy the host-issued **webhook URL** and **bearer**.
4. Write into bridge `.env` (never paste into chat or iMessage):
   - `GROK_ORCHESTRATOR_WEBHOOK_URL`
   - `GROK_ORCHESTRATOR_WEBHOOK_KEY`
5. Restart the bridge runtime if it was already running so it picks up webhook env.

Body contract is only `{"batchId":"..."}`. Auth is `Authorization: Bearer <GROK_ORCHESTRATOR_WEBHOOK_KEY>`.

If your host has no “create webhook routine” UI/API yet, use whatever routine-create tool exists for this agent (e.g. `update_state` target routine with trigger type webhook, or the product’s webhook routine creator). Do not invent a fake URL — wait until the platform returns a real URL + bearer.

---

## Step 9 — First live proof (bot line → any first text → greeting + confetti)

Give the adopter `HOSTED_IMESSAGE_NUMBER`, the E.164 number of the bot’s hosted Spectrum iMessage line. Tell them to text **that bot number** from their authorized phone. **Any first message counts** (hi, hey, a question, a sticker — does not matter). If they ask what to send, suggest `hi`. The destination is the bot’s number, never the adopter’s own number.

On that first inbound wake (or immediately after the first successful inbound space is known), regardless of the inbound text:

1. Check setup-confetti marker has not fired: bridge helper `hasSetupConfettiBeenSent()` / file `data/onboarding-celebrated.json` (see `orchestrator-memory/REACTIONS_EFFECTS.md` § “First successful iMessage setup”).
2. Enqueue from `{{BRIDGE_ROOT}}`:

```bash
bun run enqueue -- --space-id "<spaceId>" --text "it’s grokbot here" --effect confetti
```

(Slight wording variants OK: “it's grokbot here”, “hey — it's grokbot here”.)

3. After queue accept, mark celebrated (`markSetupConfettiSent()` or write the marker per REACTIONS_EFFECTS). Never re-send setup confetti.

If runtime `handledBy: runtime-greeting` already answered a bare hi, still ensure the reply is a greeting plus the **confetti** message effect once via enqueue with `--effect confetti` if the marker is unset.

The adopter-facing proof is exactly one action: send any first iMessage to the bot’s hosted number. The bot’s reply is the greeting (“it’s grokbot here” / similar) plus confetti.

---

## Operating rules after setup

- Follow `imessage-front-door-wake` for ordinary wakes (Step 0 react|no-react|effect → modality → Step 2/3).
- Decision contracts live under `bridge/orchestrator-memory/` (`REPLY_MODALITY`, `REACTIONS_EFFECTS`, `CHAT_VS_TASK`, …).
- Never echo Spectrum project secrets, webhook bearers, or `PHOTON_TOKEN` into iMessage or chat logs.
- Do not claim Moonshine weights shipped in the pack.

## Stop / escalate to human only for

- Browser approval of `photon login`
- Their E.164 (or Apple ID) when CLI does not already expose it
- Billing / Stripe if project upgrade is required for a line
- Explicit permission for irreversible deletes (`photon projects delete`, etc.)
