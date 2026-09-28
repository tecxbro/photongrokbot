# Front Door native wake routine

The [redacted descriptor](photon-imessage-wake.REDACTED.json) describes desired behavior; it is not an executable native create-tool schema. Explicit bootstrap inspects the actual authorized routine tool, records intent before creation and actual receipt afterward. A normal message wake cannot recreate the routine.

POST body is only `{ "batchId": "..." }`, with the host-issued bearer privately configured in the instance. The bot writes configuration; never ask the user to paste URL, bearer, Authorization header or message body. The [official routines documentation](https://cursor.com/help/grok-bot/routines) specifies exactly HTTP 200 as a started run, distinct from completion.

The [Front Door wake skill](../skills/imessage-front-door-wake/SKILL.md) validates the reference, acquires a current claim, then reads the bound batch and resolves context before reaction/handoff. Unknown native acceptance retains its original durable intent. Follow the [operating contract](../docs/product-repair/OPERATING_CONTRACT.md).
