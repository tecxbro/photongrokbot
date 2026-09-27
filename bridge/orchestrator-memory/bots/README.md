# Bot cards

After you create Grok bots, add one markdown card per `serverId` using `_TEMPLATE.md`.

Suggested starter cards (fill real serverIds into filenames + bodies):

- `{{FRONT_DOOR_BOT_ID}}.md` — iMessage Front Door
- `{{ORCHESTRATOR_BOT_ID}}.md` — Master Orchestrator
- `{{CREATOR_BOT_ID}}.md` — Creator (bugfixes)
- `{{FEATURE_ADD_BOT_ID}}.md` — Feature Add
- `{{IMAGE_CARDS_BOT_ID}}.md` — Photon Image Cards
- `{{APP_SHEET_BOT_ID}}.md` — App Sheet
- `{{LIVE_MINI_BOT_ID}}.md` — Live Mini *(optional; only after deploying `live-mini/`)*

Do **not** import personal specialist bots from another deployment (housing, hotels, party sims, etc.). Create your own when needed.

**Live Mini** is optional — see pack `live-mini/` + `agents/live-mini/` and `03-WHAT-NOT-IN-SHARE.md`.
