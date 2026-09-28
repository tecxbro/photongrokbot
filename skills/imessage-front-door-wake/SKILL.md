---
name: imessage-front-door-wake
description: Handle an existing authorized batch through a current claim and canonical final submission.
---

# Front Door wake

Follow the [operating contract](../../docs/product-repair/OPERATING_CONTRACT.md) exactly. Validate batch reference → acquire current processing claim → read bound batch → resolve task/context → choose reaction/effect/no reaction → answer or durable handoff → idempotent final enqueue/result bookkeeping. Busy/completed claim exits without side effects. No reaction, read-for-work or native handoff precedes the claim.

From bridge/, acquire with `bun run batch -- claim --batch-id "$BATCH_ID"`; after acquired, use `bun run read-batch -- "$BATCH_ID"`. Preserve actual token, consumed inputRevision, original source references, conversation/line and reply/poll targets. Read continuationReason and acknowledgedRevision before interpreting the input. Complete with `--input-revision` set to the work actually consumed; a later result remains actionable. Use structured stdin through `bun run enqueue -- --json-stdin`; never write queue/handled files. The operating contract gives the complete envelope and renewal/completion commands.

Front Door answers bounded conversation itself. Existing task owner takes follow-ups: `batch -- associate-task --json-stdin` records the current claimed batch/work as a permitted input to the existing local taskId. Preserve the original binding and use its returned task inputRevision/correlationId for the native amendment. Intervening unrelated conversation does not replace that task. A new single-worker task goes to one verified configured worker; Orchestrator is for coordination/dependencies. Creator repairs; Feature Add adds capabilities. Mixed work gets one primary owner and bounded children, not repeated refusals. Record delegation intent with a local taskId before the actual native tool, then receipt/optional nativeRef or unknown. The native tool may return its ID afterward; a pre-call native ID is not required. A parent message saying it will hand off is not evidence that a handoff occurred.

Media continuations resume the original request when media_ready, media_failed or media_unavailable becomes durable, even after the first run completes and after restart. Do not reinsert media as a new user message, repeat its greeting or require another text. Report a genuine failure accurately.

Workers report a native result using `batch -- task-result --json-stdin` and the recorded local taskId, task inputRevision, correlationId and receipt. They do not recover an expired parent token. A task_result wake or `batch -- resume-task --json-stdin` gives Front Door fresh processing authority; retain the same native task, do not delegate it again, and do not send twice for a replayed result. Only genuine offline uncertainty uses recover-delegation.

First-use greeting/confetti belongs to atomic acceptance. Later hi/okay/thanks and mixed reactions retain context. Any added emoji on an exactly known option returns that option's existing details, known price and direct URL, without sentiment routing or asking whether details are wanted. Ask once only if the target is ambiguous. No reaction authorizes a transaction.

Image Cards returns every N >= 4 asset and aligned metadata for one logical group. Front Door/card watchdog share the same option-set revision, source revision and destination scope. Ordinary answers may reuse `answer:1` across distinct stored requests; retries keep their original scope. Static App Sheet stays separate from canonical task-card initial presentation; ordinary Live Mini progress is same-URL JSON. See [card delivery](../photon-image-card-delivery/SKILL.md) and [apps](../../bridge/orchestrator-memory/APPS.md).

Front Door is the sole final-response owner. Do not create workers, deploy resources, open another connection or bypass unknown outcomes with a new key/sender. HTTP 200 acknowledges a routine start, not completion. Return meaningful results/blockers only; no status-polling model loops.
