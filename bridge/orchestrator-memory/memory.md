# Active registry (adopter template)

## Context loading (Step 4)
- This file is a **compact index**, not a dump of contracts, transcripts, or audit logs.
- Front Door: read this **only when selecting/confirming a specialist** (or checking delivery mode). Skip on ordinary direct-answer wakes.
- Do **not** paste full `bots/*.md` bodies here. Details stay in `bots/<id>.md` and are loaded only for the selected bot.
- Task ownership/checkpoints: use existing task/delegation records under `{{BRIDGE_ROOT}}/data/`.
- Loading discipline: `CONTEXT_LOADING.md`.

## Runtime / Photon project
- Fill after you create your Spectrum project: label, `SPECTRUM_PROJECT_ID`, hosted iMessage number.
- After any project/secret/number change: read `SPECTRUM_PROJECT_SWITCH.md`, start with `./scripts/start-runtime.sh`, verify the running process sees the expected project id.
- Greeting-only inbound may skip Front Door (runtime fast-path); real tasks webhook Front Door.

## Front door
- agent_id: `{{FRONT_DOOR_BOT_ID}}`
- name: iMessage Front Door
- role: Step 2 direct-answer + enqueue; else one-specialist handoff or Orchestrator; bridge **fixes** → Creator `{{CREATOR_BOT_ID}}`, bridge **new features** → Feature Add `{{FEATURE_ADD_BOT_ID}}`; skips runtime-greeting
- final-response: owns enqueue for direct-answer; owns **fallback** final enqueue for all delegated routes until specialist/Orch/Creator direct enqueue is verified
- file: `bots/{{FRONT_DOOR_BOT_ID}}.md` (create from `_TEMPLATE.md` after you know your serverId)

## Active orchestrator
- agent_id: `{{ORCHESTRATOR_BOT_ID}}`
- name: iMessage Master Orchestrator
- status: active
- role: **coordinated** tasks only (multi-owner, dependencies, cross-task coordination, bounded specialist escalations). Does not edit bridge code. Direct enqueue **disabled** (FRONT_DOOR fallback).

## Integration — fixes
- agent_id: `{{CREATOR_BOT_ID}}`
- name: iMessage Creator
- status: active
- role: bugfixes, regressions, runtime repair on Photon Spectrum bridge (not net-new features)
- delivery: user-facing final enqueue via Front Door until Creator direct send verified

## Integration — new features
- agent_id: `{{FEATURE_ADD_BOT_ID}}`
- name: Feature Add
- status: active
- role: add new Photon Spectrum bridge capabilities (not bugfixes)
- delivery: user-facing final enqueue via Front Door until Feature Add direct send verified

## Core specialists (create your own; do not reuse personal bots from another deployment)
| role | placeholder bot_id | summary | delivery |
|---|---|---|---|
| Photon Image Cards | `{{IMAGE_CARDS_BOT_ID}}` | Editorial image option stacks for iMessage | FRONT_DOOR fallback |
| App Sheet | `{{APP_SHEET_BOT_ID}}` | Full-sheet iMessage app cards via Spectrum `app(url)` | FRONT_DOOR fallback |

## Optional / retired
- **Live Mini** (`{{LIVE_MINI_BOT_ID}}`): optional. Upstream specialist retired; scrubbed rebuild pack is `live-mini/` + `agents/live-mini/`. Low-level `--live` / `--app-update` in `APPS.md`.
- Domain specialists (housing, hotels, tutors, party sims, logo, chatty, …): **create your own** after setup. Do not copy another owner's personal bots. Use `bots/_TEMPLATE.md`.

## Routing notes
- Reply modality: `REPLY_MODALITY.md` (text vs image stack vs poll vs app sheet; image stacks **≥4 only**).
- iMessage apps: full-sheet → App Sheet; live/update → optional Live Mini rebuild (`APPS.md`).
- Poll when-to-use: `POLLS.md`.
- Reactions/effects: `REACTIONS_EFFECTS.md` — Front Door **Step 0** fork `react`|`no-react`|`effect`.
- Preserve Step 2 direct-answer first.
