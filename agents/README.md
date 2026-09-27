# Agents (core graph + optional Live Mini)

Create these **six** core roles. **Live Mini** is optional (retired upstream; rebuild via `../live-mini/` + this folder’s templates):

| Folder | Role | Skills |
|---|---|---|
| `front-door/` | iMessage Front Door | **`getting-started`**, `imessage-front-door-wake`, `spectrum-imessage-apps-nudge` |
| `master-orchestrator/` | Master Orchestrator | `imessage-master-orchestrator` |
| `creator/` | Creator (bugfixes) | `imessage-creator` |
| `feature-add/` | Feature Add | `imessage-feature-add` |
| `image-cards/` | Photon Image Cards | `photon-demo-image-overlay`, `photon-image-card-delivery` |
| `app-sheet/` | App Sheet | `spectrum-imessage-apps-nudge` |
| `live-mini/` *(optional)* | Live Mini | `../live-mini/live-task-cards/SKILL.md` (+ optional dot-matrix loader skill) |

Each folder has `PROFILE_TEMPLATE.md` + `README.md`. After CreateAgent, substitute placeholders (`{{FRONT_DOOR_BOT_ID}}`, `{{LIVE_MINI_BOT_ID}}`, …) across the pack.

Front Door skill already mentions Live Mini — point it at your `{{LIVE_MINI_BOT_ID}}` only after the host under `live-mini/` is deployed.

See top-level `00-README.md` and `01-ARCHITECTURE.md` for the message flow.


**First run:** Front Door executes `skills/getting-started` on Spectrum’s **free plan** (bot does Photon CLI / device login / project / hosted bot line / bridge / mandatory STT / siblings / webhook). The bot gives the hosted line number; the adopter texts **anything** to that number (not their own; suggest `hi`) → grokbot greeting + confetti once. Their phone is used only for `AUTHORIZED_SENDER_ID` / Spectrum user registration.
