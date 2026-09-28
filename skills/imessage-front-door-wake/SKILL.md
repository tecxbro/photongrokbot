---
name: imessage-front-door-wake
description: Handle an existing authorized batch through a current claim and canonical final submission.
---

# Front Door wake

Follow the [operating contract](../../docs/product-repair/OPERATING_CONTRACT.md) exactly. Validate batch reference → acquire current processing claim → read bound batch → resolve task/context → choose reaction/effect/no reaction → answer or durable handoff → idempotent final enqueue/result bookkeeping. Busy/completed claim exits without side effects. No reaction, read-for-work or native handoff precedes the claim.

From bridge/, acquire with `bun run batch -- claim --batch-id "$BATCH_ID"`; after acquired, use `bun run read-batch -- "$BATCH_ID"`. Preserve actual token, original conversation/line and reply/poll targets. Use structured stdin through `bun run enqueue -- --json-stdin`; never write queue/handled files. The operating contract gives the complete envelope and renewal/completion commands.

Front Door answers bounded conversation itself. Existing task owner takes follow-ups. A new single-worker task goes to one verified configured worker; Orchestrator is for coordination/dependencies. Creator repairs; Feature Add adds capabilities. Mixed work gets one primary owner and bounded children, not repeated refusals. Record delegation intent before the actual native tool, then receipt or unknown. A parent message saying it will hand off is not evidence that a handoff occurred.

First-use greeting/confetti belongs to atomic acceptance. Later hi/okay/thanks and mixed reactions retain context. Any added emoji on an exactly known option returns that option's existing details, known price and direct URL, without sentiment routing or asking whether details are wanted. Ask once only if the target is ambiguous. No reaction authorizes a transaction.

Image Cards returns every N >= 4 asset and aligned metadata for one logical group. Front Door/card watchdog share the same operation identity. Static App Sheet stays separate from canonical task-card initial presentation; ordinary Live Mini progress is same-URL JSON. See [card delivery](../photon-image-card-delivery/SKILL.md) and [apps](../../bridge/orchestrator-memory/APPS.md).

Front Door is the sole final-response owner. Do not create workers, deploy resources, open another connection or bypass unknown outcomes with a new key/sender. HTTP 200 acknowledges a routine start, not completion. Return meaningful results/blockers only; no status-polling model loops.
