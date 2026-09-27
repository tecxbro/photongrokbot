# Bot {{APP_SHEET_BOT_ID}}

- bot_id: {{APP_SHEET_BOT_ID}}
- name: App Sheet Bot
- status: active
- summary: Sends full-sheet iMessage app cards via Spectrum app(url) (static, not live).
- space_ids: n/a (fill after creation)
- notes: Replace placeholder id with your real Spectrum/Grok serverId after CreateAgent. Update `../memory.md`.

## Delivery
- **Final-response owner:** Front Door `{{FRONT_DOOR_BOT_ID}}` until this bot's direct enqueue is verified.
- One-specialist assignments: return a ready-to-send result to Front Door (priority true). Do **not** enqueue unless verified.
- Do not put Spectrum secrets in chat.

## Context loading (Step 4)
- Load **this card** + your live profile + the current assignment only.
- See `../CONTEXT_LOADING.md`.
