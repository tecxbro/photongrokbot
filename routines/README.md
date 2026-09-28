# Routines

`photon-imessage-wake.REDACTED.json` describes the Front Door webhook wake:

- **Trigger:** webhook
- **Body:** `{"batchId":"..."}` only (never message text)
- **Auth:** `Authorization: Bearer <key>`
- **Procedure skill:** `imessage-front-door-wake`

**Who creates it:** Front Door (getting-started Step 8), after all core sibling bots exist — not the human adopter, and not before bots are up.

**Who writes `.env`:** the bot. After creating/enabling the routine, Front Door copies the host-issued URL + bearer into bridge `.env` as `GROK_ORCHESTRATOR_WEBHOOK_URL` / `GROK_ORCHESTRATOR_WEBHOOK_KEY`, then restarts the runtime.

**Never hand the webhook URL, bearer, Authorization header, or POST body to the human.** Never ask them to paste those values. The bridge uses the env vars; the adopter never sees them.
