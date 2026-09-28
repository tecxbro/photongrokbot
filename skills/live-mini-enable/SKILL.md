---
name: live-mini-enable
description: >-
  Use when enabling Live Mini / deploying live-task-cards, or when a live-mini-fit
  request needs Vercel setup. Prefer deploy-all when Vercel is already connected —
  do not quiz the adopter. Never gate on detecting Spectrum Apps install.
---
# Live Mini enable — deploy-all (or offer once)

**Audience:** Front Door / primary bot enabling the optional Live Mini specialist + Vercel host.

**Goal:** When the **Vercel connector is already connected** for this user/agent, **deploy all** without a questionnaire — create Live Mini Bot if missing, deploy `live-task-cards`, wire publisher, smoke health/doctor, brief them. When a request fits live mini but Vercel is not connected (or Live Mini host/bot missing because of that), offer once in human-facing copy (Spectrum Apps in Messages + Vercel); if they say yes, guide Vercel connect then deploy-all; if no / ignore, fall back to text or App Sheet and do not nag.

**You can never know** whether Spectrum Apps in Messages is installed. Do **not** detect it, invent a machine check, or gate deploy-all on it. Spectrum Apps belongs **only** in human-facing pitch/guide text.

Never paste Blob / publisher / view secrets into chat. Never ask the human to paste Vercel env vars when you can set them via the Vercel connector.

Pack root: `{{PACK_ROOT}}`. Host source: `{{PACK_ROOT}}/live-mini/live-task-cards/`. Defaults: `{{PACK_ROOT}}/live-mini/migration/DEPLOY-NOTES.md` (prefer **blob**, not Redis quiz).

---

## Hard rule — deploy all, don't quiz

When **Vercel is already connected** for this user/agent (Grok Bot Vercel connector / authorized Vercel — e.g. list projects works):

**Do not** quiz them with a pile of deploy questions (which env keys, Redis vs blob, project name confirmation widgets, “paste this token”, Spectrum Apps install checks, etc.).

**Just deploy all** using sensible defaults:

- `STORE=blob` (not Redis)
- Generate distinct `PUBLISHER_TOKEN` + `VIEW_SIGNING_SECRET` (≥32 chars) yourself; set via the Vercel connector — **never** paste into chat
- Create or reuse one Vercel project (e.g. `live-task-cards` or `grokbot-live-cards`)
- Create / attach a private Blob store; set `BLOB_READ_WRITE_TOKEN` + `BLOB_PATHNAME` per DEPLOY-NOTES
- After deploy, set `PUBLIC_BASE_URL` to the production host
- Create Live Mini Bot if missing; wire publisher into the bridge path; smoke `/health` + doctor
- Tell them briefly what you deployed (and, in that brief, that live cards show best with Spectrum Apps in Messages — without claiming you verified install)

Prefer defaults from `live-mini/migration/DEPLOY-NOTES.md`.

Do **not** ask about Spectrum Apps before deploying. Do **not** wait for a Spectrum Apps “ready” signal — there is none you can reliably detect.

---

## Detect readiness (Vercel only)

### Vercel connector — ready when

- Grok Bot Vercel connector / MCP plugin is connected for this setup, **and**
- Listing projects (or equivalent authorized Vercel access) works without asking the human to paste tokens

Treat as **not ready** if the connector is missing, unauthorized, or project list fails. Do not invent that Vercel is connected.

### Spectrum Apps — never a machine gate

You **cannot** know whether Spectrum Apps in Messages exists or is installed. There is no “Spectrum Apps available/installed” check. Do not invent one from conversation context, app-card history, or user silence. Mention Spectrum Apps **only** in pitch/guide copy to the human.

### Live Mini host/bot ready when

- `{{LIVE_MINI_BOT_ID}}` exists (CreateAgent done), **and**
- Host is deployed with `STORE=blob` + secrets in Vercel env (not chat), **and**
- `/health` (and doctor when authenticated) looks healthy, **and**
- Publisher / `PUBLIC_BASE_URL` is wired into bridge-accessible VM env

---

## Deploy-all checklist (bot does these — numbered)

Run end-to-end when **Vercel is connected**. No human questionnaire. No Spectrum Apps pretest.

1. **CreateAgent Live Mini** from `{{PACK_ROOT}}/agents/live-mini/` if missing. Attach operating skill from `{{PACK_ROOT}}/live-mini/live-task-cards/SKILL.md` (and optionally `skills/dot-matrix-mini-app` for personal loaders). Substitute `{{LIVE_MINI_BOT_ID}}` / `{{LIVE_MINI_AGENT_UUID}}` / `{{LIVE_TASK_CARDS_HOST}}` everywhere they appear. Write bot card under `bridge/orchestrator-memory/bots/` and update `memory.md`.

2. **Build from source** at `{{PACK_ROOT}}/live-mini/live-task-cards`: run `npm test` / `npm run check` / `npm run build` as feasible on the agent VM (Node 22+). Fix only if something obviously breaks; do not stop to quiz the adopter.

3. **Ensure Vercel project + Blob store; set env; deploy.** Via the authorized Vercel connector (not chat pastes):
   - Project: create or reuse `live-task-cards` or `grokbot-live-cards` (framework none / Other; Node 22; build `npm run build` per DEPLOY-NOTES)
   - Private Blob store; set `STORE=blob`, `BLOB_READ_WRITE_TOKEN`, `BLOB_PATHNAME=live-task-cards:v1:{{SETUP_NAME}}.json` (preview pathname separate)
   - Generate and set `PUBLISHER_TOKEN` + `VIEW_SIGNING_SECRET` (≥32 chars) via connector
   - Deploy the host; then set `PUBLIC_BASE_URL=https://<production-host>`

4. **Verify** `GET /health` and authenticated `GET /api/doctor` → `storage: "blob"` (per DEPLOY-NOTES). Fix env via connector if doctor fails; do not ask the human to paste vars.

5. **Wire runtime helper** — note `PUBLIC_BASE_URL` + publisher secrets into **bridge-accessible env on the VM** (e.g. helper under `live-mini/runtime/` or `examples/existing-runtime.mjs` pattern). **Not** into chat or iMessage.

6. **Brief the user:** Live Mini is live; the next fitting multi-step task can use a live progress card. Optionally remind (human-facing only) that live cards need Spectrum Apps in Messages — **never** claim you detected or verified install. One or two short sentences. Do not dump secrets, project ids, or env dumps.

---

## Offer path (Vercel not connected / Live Mini not ready)

When a user request is a **fit for live mini apps** (substantial multi-step task that benefits from a live progress card / matrix UI) **but** Live Mini is not ready (typically: Vercel not connected, so host/bot were never deployed):

1. **Brief pitch** (Front Door / iMessage — plain text): richer live mini-app experience needs **Spectrum Apps in Messages** + **Vercel connected in Grok Bot**. Keep it short; do not oversell. Do not claim you checked either.
2. **Separate bubble** with App Store URL only:
   `https://apps.apple.com/us/app/spectrum-apps-in-messages/id6777616651`
3. If they say **yes**: guide them to connect Vercel in the Grok Bot app (and mention installing Spectrum Apps in Messages in the same guide). Once Vercel is connected, run **deploy-all** above — do not wait for proof of Spectrum install.
4. If they say **no** / ignore: continue with text or App Sheet — **do not nag**. Cross-link with `skills/spectrum-imessage-apps-nudge` (same App Store URL; at most one unsolicited visual nudge per conversation unless they ask again).

Do not block first-text confetti / getting-started on Live Mini. Offer only on fit (or when they ask).

---

## What NOT to ask when deploy-all applies

- Redis vs blob (default **blob**)
- Which env key names / “paste this into Vercel”
- Publisher / view / Blob tokens into chat
- Ten confirmation widgets / project-name quizzes when a default name works
- Manual deploy steps the connector can do
- Whether Spectrum Apps is installed (you cannot know; do not ask as a gate)

Just deploy, smoke health/doctor, brief them.

---

## Must not

- Paste Blob, publisher, or view secrets into chat or iMessage
- Ask the human to paste Vercel env vars when the connector can set them
- Invent that Vercel is connected
- Invent, detect, or verify Spectrum Apps install — never gate deploy-all on it
- Nag after they decline or ignore the offer
- Block getting-started / hi proof on Live Mini
