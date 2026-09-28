---
name: getting-started
description: >-
  First-run auto-setup for Photon Spectrum ↔ Grok iMessage (grokbot). The imported
  bot runs this on the agent VM — do not hand engineer steps to the human.
---
# Getting started — bot auto-setup playbook

**Audience:** you (the imported Front Door / primary bot), not the human adopter.

**Goal:** Use the Spectrum **free plan** to stand up the hosted iMessage line, bridge + STT + **all** sibling agents on the **agent VM**, have **Front Door** finish phone authorization + wake webhook + `.env` write + runtime restart, then prove live with one exact flow: the bot gives the adopter the bot’s hosted line number; the adopter texts **anything** to that number from their authorized phone (suggest `hi` if they ask what to send); the bot replies once with a greeting like “it’s grokbot here” **plus a confetti message effect**.

**Do not** ask the adopter to run `bun install`, fill `.env`, paste webhook URL/key/headers, or download models. You run those steps. The adopter’s only live action is texting the hosted number **after** the ready checklist passes. Only pause when a human action is required (browser login approval, or the adopter’s phone number for authorization — phone ask happens **after** core bots exist, owned by Front Door).

---

## Hard rules (read first — never violate)

1. **NEVER ask for first iMessage / “hi”** until **all** of these are true:
   - All core bots exist (Front Door + Master Orchestrator + Creator + Feature Add + Image Cards + App Sheet).
   - Wake routine exists on Front Door (Photon iMessage wake).
   - Webhook URL + bearer are written into bridge `.env` **by the bot** (not the human).
   - Runtime has been restarted with those env vars.
   - `AUTHORIZED_SENDER_ID` is set.
2. **NEVER instruct the human** to paste webhook URL, bearer, `Authorization` header, or POST body. The bot creates the routine and writes `.env`.
3. **Phone-number ask** happens **AFTER** bots exist, owned by Front Door (or handed to Front Door via SendToAgent if a bootstrap bot created Front Door).
4. **Step 0 orientation** must **NOT** ask them to text now. Say setup finishes first, then they text the bot number once.

---

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

## Step 0 — Orient the adopter (short — no texting yet)

Tell them, in plain language:

1. You will install Photon CLI on the VM, create a Spectrum **free-plan** project **`grokbot`** (or `grokbot-A`…`Z`), provision the bot’s hosted iMessage line, wire the bridge, download voice STT, and create **all** sibling bots first.
2. **After** those bots exist, Front Door will finish the last wiring: authorize their phone if needed, create the wake webhook, write secrets into `.env` itself, and restart the runtime. They may need to approve a browser login; they will **not** paste any webhook URL, key, or header.
3. **Only when setup is fully ready**, you will give them the hosted iMessage line number — the bot’s number, not their own — and invite them to text that number from their authorized phone (**any first message works**; suggest `hi` if they want a prompt). Reply once with a grokbot greeting (“it’s grokbot here” / similar) **plus confetti**. That is the live proof.
4. **Do not text yet.** Setup finishes first; then they text the bot number once.

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

## Step 3 — Spectrum free-plan project + hosted bot line (capture number; do not invite texting yet)

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

Set `HOSTED_IMESSAGE_NUMBER` to the line’s E.164 number. This is the bot’s destination number for the proof.

**Do not give this number to the adopter yet and do not invite them to text.** Capture it only. Invite texting only in Step 9 after the ready checklist passes. Never tell them to text their own authorized number.

---

## Step 4 — Install bridge on the VM + fill SPECTRUM_* only

```bash
# Example install path — choose a stable {{BRIDGE_ROOT}} on the VM
export BRIDGE_ROOT="${BRIDGE_ROOT:-/workspace/grokbot-bridge}"
mkdir -p "$BRIDGE_ROOT"
cp -a "{{PACK_ROOT}}/bridge/." "$BRIDGE_ROOT/"
cd "$BRIDGE_ROOT"
cp .env.example .env
chmod 0600 .env
```

Fill `.env` yourself for Spectrum credentials only (see `02-SECRETS.md` for key names). Leave webhook keys blank until Front Door finishes Step 8. Defer `AUTHORIZED_SENDER_ID` if the adopter’s phone is not yet known (Front Door owns that in Step 7).

| Key | When / how |
|---|---|
| `SPECTRUM_PROJECT_ID` | Now — from `photon projects show` / create |
| `SPECTRUM_PROJECT_SECRET` | Now — same / regenerate-secret |
| `AUTHORIZED_SENDER_ID` | **Later (Step 7)** — Front Door; leave blank if unknown |
| `GROK_ORCHESTRATOR_WEBHOOK_URL` | **Later (Step 8)** — bot writes after wake routine |
| `GROK_ORCHESTRATOR_WEBHOOK_KEY` | **Later (Step 8)** — same routine bearer |

```bash
# Bun required for this bridge
command -v bun >/dev/null || curl -fsSL https://bun.sh/install | bash
bun install
# STT first (Step 5) before calling ready — voice is mandatory
# You may start runtime after STT for health checks, but you MUST restart
# again after Step 8 writes webhook env. Do not invite texting yet.
```

Do not paste secrets into chat. Do not ask the human to fill webhook URL/key/headers.

---

## Step 5 — Moonshine STT (mandatory)

Weights are **not** in the tarball (~214 MB). Follow **`{{PACK_ROOT}}/stt/INSTALL.md`** end-to-end on `{{BRIDGE_ROOT}}`:

1. `python3 -m venv .venv-moonshine` + `pip install -U moonshine-voice`
2. Ensure `ffmpeg` on PATH
3. Download `small-streaming-en` / `quantized_26_08_21` (HF preferred or Moonshine CDN/SDK)
4. Place under `data/models/moonshine/small-streaming-en/quantized_26_08_21/`
5. Spot-check with `tools/moonshine_stt.py` if a sample wav is available

Do not mark setup complete without STT installed.

---

## Step 6 — Create ALL sibling agents first (before phone / webhook / hi)

Drive CreateAgent / equivalent tooling yourself. Do not ask the adopter to paste profiles. **Do not ask for phone, create the wake webhook, or invite “hi” until this step finishes.**

For each row, create the agent, paste `PROFILE_TEMPLATE.md` as the profile body (after placeholder substitution), and attach the listed skills from `{{PACK_ROOT}}/skills/`:

| Folder | Skills to attach |
|---|---|
| `agents/front-door/` | `imessage-front-door-wake`, `spectrum-imessage-apps-nudge`, **`getting-started`** (this skill) |
| `agents/master-orchestrator/` | `imessage-master-orchestrator` |
| `agents/creator/` | `imessage-creator` |
| `agents/feature-add/` | `imessage-feature-add` |
| `agents/image-cards/` | `photon-demo-image-overlay`, `photon-image-card-delivery` |
| `agents/app-sheet/` | `spectrum-imessage-apps-nudge` |
| `agents/live-mini/` (optional 7th — **only** when Step 6b auto-enable runs) | `live-mini-enable` + `live-mini/live-task-cards/SKILL.md` |


**Which bots to create depends on who you are:**

- **If this bot is already Front Door:** create the other five (Master Orchestrator, Creator, Feature Add, Image Cards, App Sheet). Then continue to Steps 7–9 yourself.
- **If this bot is a bootstrap / importer and is NOT Front Door:** create Front Door first (with this skill attached), then create the other five. Substitute placeholders, write bot cards, update `memory.md`. Then **hand off Phase B to Front Door** via SendToAgent (see **Handoff** below). Bootstrap must **not** ask for phone, create the wake, write webhook `.env`, restart for webhook, invite hi, or run the live proof itself.

**After each create, record and substitute:**

1. Real `serverId` / agent UUID for that bot.
2. Replace placeholders everywhere they appear: `{{FRONT_DOOR_BOT_ID}}`, `{{MASTER_ORCHESTRATOR_BOT_ID}}`, `{{CREATOR_BOT_ID}}`, `{{FEATURE_ADD_BOT_ID}}`, `{{IMAGE_CARDS_BOT_ID}}`, `{{APP_SHEET_BOT_ID}}` (and `{{LIVE_MINI_BOT_ID}}` when Step 6b runs), matching `{{*_AGENT_UUID}}`, and `{{BRIDGE_ROOT}}` / `{{PACK_ROOT}}`.
3. Write bot cards: `bridge/orchestrator-memory/bots/<serverId>.md` from `_TEMPLATE.md` + the matching `ROLE_*.md`; update `bridge/orchestrator-memory/memory.md` with the live roster.
4. Prefer creating **Front Door first** when you are bootstrap, then Master Orchestrator, then Creator / Feature Add / Image Cards / App Sheet.

### Step 6b — Live Mini auto-enable when Vercel is ready

After the core six bots exist: if the **Vercel connector is already available** for this setup (authorized / list projects works), run `skills/live-mini-enable` **deploy-all** (create Live Mini bot + deploy `live-mini/live-task-cards` host with `STORE=blob` + Blob + generated secrets) **without** a questionnaire. Do **not** gate on Spectrum Apps — you cannot detect whether it is installed; mention it only in brief human-facing copy after deploy if useful. Brief them on what you deployed.

If Vercel is **not** connected, **skip silently** during getting-started — do not block hi proof / first-text confetti. Live Mini is **not** required for first-text confetti.

When auto-enable runs, Live Mini is an optional **seventh** sibling (see table note below). Otherwise leave `{{LIVE_MINI_BOT_ID}}` unsubstituted until a live-mini-fit request later triggers the offer path in `live-mini-enable` / `spectrum-imessage-apps-nudge`.

### Handoff — when bootstrap created Front Door (SendToAgent)

If you (bootstrap) just created Front Door, send Front Door a clear Phase B task. Example SendToAgent text:

> Phase B — Front Door finish (phone → authorize → webhook → `.env` → restart → proof). Core bots are created; placeholders and bot cards are updated. `{{BRIDGE_ROOT}}` is set. `HOSTED_IMESSAGE_NUMBER` is captured but the adopter has **not** been invited to text yet. Complete getting-started Steps 7–9 in order: (7) obtain adopter phone / set `AUTHORIZED_SENDER_ID` + `photon spectrum users add` + write into `.env`; (8) create Photon iMessage wake on Front Door from `routines/photon-imessage-wake.REDACTED.json`, write `GROK_ORCHESTRATOR_WEBHOOK_URL` + `GROK_ORCHESTRATOR_WEBHOOK_KEY` into bridge `.env` yourself, restart runtime — **never** ask the human to paste URL/key/headers; (9) ready checklist, then give hosted bot number and invite first text (suggest hi) + greeting + confetti. Do not ask for hi until the checklist passes.

Bootstrap stops there. Front Door owns Steps 7–9.

---

## Step 7 — Front Door finish — phone (AUTHORIZED_SENDER_ID)

**Owner: Front Door only** (after all core bots exist). Prefer a number already available:

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

Write `AUTHORIZED_SENDER_ID` into bridge `.env` yourself. Optional availability check (docs): `photon projects check-phone +19876543210`.

---

## Step 8 — Front Door finish — webhook (bot writes `.env`; human never pastes)

**Owner: Front Door only.** Create routine **Photon iMessage wake** on Front Door from `routines/photon-imessage-wake.REDACTED.json`:

1. Trigger type: **webhook**.
2. Prompt / procedure: follow `skills/imessage-front-door-wake/SKILL.md` (parse `{"batchId"}`, load unread batch under `{{BRIDGE_ROOT}}`, Step 2/3, enqueue). Do not put message text in the webhook body.
3. Enable the routine. Capture the host-issued **webhook URL** and **bearer** yourself.
4. **Write into bridge `.env` yourself** (never paste into chat or iMessage, never ask the human to paste URL / bearer / Authorization header / POST body):
   - `GROK_ORCHESTRATOR_WEBHOOK_URL`
   - `GROK_ORCHESTRATOR_WEBHOOK_KEY`
5. **Restart the bridge runtime** so it picks up webhook env + `AUTHORIZED_SENDER_ID`.

Body contract is only `{"batchId":"..."}`. Auth is `Authorization: Bearer <GROK_ORCHESTRATOR_WEBHOOK_KEY>` — used by the bridge, not by the human.

If your host has no “create webhook routine” UI/API yet, use whatever routine-create tool exists for this agent (e.g. `update_state` target routine with trigger type webhook, or the product’s webhook routine creator). Do not invent a fake URL — wait until the platform returns a real URL + bearer. Do not hand those values to the human.

---

## Step 9 — Ready checklist, then first live proof

**Ready checklist — all must pass before inviting any text:**

- [ ] All six core bots exist (Front Door + Master Orchestrator + Creator + Feature Add + Image Cards + App Sheet)
- [ ] Wake routine exists on Front Door
- [ ] `GROK_ORCHESTRATOR_WEBHOOK_URL` + `GROK_ORCHESTRATOR_WEBHOOK_KEY` written into `.env` by the bot
- [ ] Runtime restarted with those env vars
- [ ] `AUTHORIZED_SENDER_ID` set
- [ ] Moonshine STT installed
- [ ] `HOSTED_IMESSAGE_NUMBER` captured

Only after every box is checked: give the adopter `HOSTED_IMESSAGE_NUMBER`, the E.164 number of the bot’s hosted Spectrum iMessage line. Tell them to text **that bot number** from their authorized phone. **Any first message counts** (hi, hey, a question, a sticker — does not matter). If they ask what to send, suggest `hi`. The destination is the bot’s number, never the adopter’s own number.

On that first inbound wake (or immediately after the first successful inbound space is known), regardless of the inbound text:

1. Check setup-confetti marker has not fired: bridge helper `hasSetupConfettiBeenSent()` / file `data/onboarding-celebrated.json` (see `orchestrator-memory/REACTIONS_EFFECTS.md` § “First successful iMessage setup”).
2. Enqueue from `{{BRIDGE_ROOT}}`:

```bash
bun run enqueue -- --space-id "<spaceId>" --text "it’s grokbot here" --effect confetti
```

(Slight wording variants OK: “it's grokbot here”, “hey — it's grokbot here”.)

3. After queue accept, mark celebrated (`markSetupConfettiSent()` or write the marker per REACTIONS_EFFECTS). Never re-send setup confetti.

If runtime `handledBy: runtime-greeting` already answered a bare hi, still ensure the reply is a greeting plus the **confetti** message effect once via enqueue with `--effect confetti` if the marker is unset.

The adopter-facing proof is exactly one action: send any first iMessage to the bot’s hosted number **after** setup is ready. The bot’s reply is the greeting (“it’s grokbot here” / similar) plus confetti.

---

## Operating rules after setup

- Follow `imessage-front-door-wake` for ordinary wakes (Step 0 react|no-react|effect → modality → Step 2/3).
- Decision contracts live under `bridge/orchestrator-memory/` (`REPLY_MODALITY`, `REACTIONS_EFFECTS`, `CHAT_VS_TASK`, …).
- Never echo Spectrum project secrets, webhook bearers, or `PHOTON_TOKEN` into iMessage or chat logs.
- Never ask the human to paste webhook URL, bearer, Authorization header, or POST body.
- Do not claim Moonshine weights shipped in the pack.

## Stop / escalate to human only for

- Browser approval of `photon login`
- Their E.164 (or Apple ID) when CLI does not already expose it — **after** core bots exist, Front Door asks
- Billing / Stripe if project upgrade is required for a line
- Explicit permission for irreversible deletes (`photon projects delete`, etc.)
