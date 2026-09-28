# Skills (workflows)

Install each skill onto the matching Grok agent (CreateAgent / skill attach UI). Slugs:

| Slug | Primary agent |
|---|---|
| **`getting-started`** | **Front Door (first run / auto-setup)** |
| `imessage-front-door-wake` | Front Door |
| `imessage-master-orchestrator` | Master Orchestrator |
| `imessage-creator` | Creator |
| `imessage-feature-add` | Feature Add |
| `photon-demo-image-overlay` | Image Cards |
| `photon-image-card-delivery` | Image Cards (+ Front Door awareness) |
| `spectrum-imessage-apps-nudge` | Front Door / App Sheet |
| `live-mini-enable` | Front Door (Live Mini deploy-all / offer) |

**First-run:** Front Door runs `getting-started` on Spectrum’s **free plan** (Photon CLI on the agent VM, device login URL+code, project `grokbot` or `grokbot-A`…`Z`, bot-hosted iMessage line, bridge, mandatory Moonshine STT, siblings, webhook). The bot gives the line number; adopter texts **anything** to that number (not their own; suggest `hi`) → “it’s grokbot here” + confetti once. Their phone is used only for `AUTHORIZED_SENDER_ID` / Spectrum user registration.

All prose uses role placeholders (`{{FRONT_DOOR_BOT_ID}}`, `{{BRIDGE_ROOT}}`, …). Substitute real ids after CreateAgent.

Live Mini: **`live-mini-enable`** auto-deploys when Vercel is connected (no questionnaire); otherwise offers on fitting requests (Spectrum Apps + Vercel pitch — never detect Spectrum install). Operating docs also under `../live-mini/live-task-cards/SKILL.md`. Front Door references `{{LIVE_MINI_BOT_ID}}`.
