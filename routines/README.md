# Routines

`photon-imessage-wake.REDACTED.json` describes the Front Door webhook wake:

- **Trigger:** webhook
- **Body:** `{"batchId":"..."}` only (never message text)
- **Auth:** `Authorization: Bearer <key>`
- **Procedure skill:** `imessage-front-door-wake`

**Who creates it:** the imported Front Door bot (getting-started Step 8), not the human adopter. Create the routine on Front Door, copy the host-issued URL + bearer into bridge `.env` as `GROK_ORCHESTRATOR_WEBHOOK_URL` / `GROK_ORCHESTRATOR_WEBHOOK_KEY`, restart the runtime if needed, then enable it.
