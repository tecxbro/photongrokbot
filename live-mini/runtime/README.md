# Canonical task-card helper

This Node 22 helper publishes host content and submits the initial card through the bridge's durable outbox. It owns no Spectrum connection. Read the [operating contract](../../docs/product-repair/OPERATING_CONTRACT.md) and [host integration](../live-task-cards/docs/INTEGRATION.md). Live Mini must already be explicitly enabled; normal task execution cannot deploy it.

The native task must first have a durable delegation intent and actual accepted receipt. Obtain its original batch, space, line and current claim through bridge controls. Use a stable explicit task key for every call. No caller-selected replacement destination is allowed.

```js
import { createLiveCardMilestones } from './live-card-milestones.mjs';
const cards = createLiveCardMilestones({
  taskContext: { taskId, batchId, claim: { batchId, runId, generation } },
});
const first = await cards.createCard(createPayload, stableTaskKey);
await cards.sendOnce(originalSpaceId, first.record.viewUrl, stableTaskKey);
await cards.updateMilestone(first.record.id, {
  requestId: stableMilestoneId,
  expectedRevision: revisionUsedToComputeThisContent,
  content: authoredSnapshot,
}, stableTaskKey);
await cards.completeAndRelease(first.record.id, stableTaskKey);
```

`createPayload.taskId` and `conversationRef` must match the stored task and original conversation. Its `requestId` is stable. `loadContext(taskKey)` is async. `completeAndRelease(cardId,taskKey,terminalUpdate?)` optionally takes a full `{requestId,expectedRevision,content}` body before release. `taskKey` is never inferred. The helper rejects legacy direct-runtime options such as liveCards, space, stateDir and secretsPath. Ordinary static apps remain a separate Front Door capability.

Private paths come from the shared resolver: publisher environment at `secrets/live-mini.env`, hashed contexts at `live-mini/context`. Each context hashes installation, task, batch, original destination and full task key; a kernel lock serializes writers. Never build filenames from provider IDs, read old checkout queues, or clear a context to retry. A legacy runtime/state directory requires migration review.

## Executable bridge controls

Run from bridge/ with pinned Bun. These internal wrappers are not new provider APIs. All take bounded JSON on stdin:

- `bun run src/presentation-control.ts task-context --json-stdin`: `{taskId,batchId,claim?}`. Returns the original destination and configured origin. Supply claim to validate current mutation authority; omit only for read-only recovery.
- `bun run src/presentation-control.ts register --json-stdin`: `{claim,context:{cardId,taskId,batchId,destination,viewUrl}}`. Immutable registered context requires the configured origin, exact route/card and complete private URL.
- `bun run src/presentation-control.ts operation-status --json-stdin`: `{taskId,batchId,actionKey}`. Returns the exact original presentation operation, including after claim expiry.

The helper invokes these without a shell and uses the canonical `bun run enqueue -- --json-stdin` envelope with purpose presentation. It journals the original create/update requests before HTTP and registers the full URL before enqueue. Do not raw-send or edit a task-card app URL. Ordinary progress changes hosted JSON at the exact same URL, including unchanged query token, without a new bubble or deployment.

## Recovery

Unknown create, host-claim, enqueue, provider-send or host-settlement outcomes retain their original identity. Retry only the same body, request ID, revision, full URL and task key. A pending unknown update rejects a different body. Definitive revision/idempotency conflicts remain visible; review current content before intentionally authoring a new request. The helper never automatically rebases.

Initial presentation with no definitive message ID keeps the host claim and slot occupied. Stop dispatch and reconcile the exact existing outbox attempt using private provider evidence, as described in [migration/recovery](../../docs/product-repair/MIGRATION.md). Then call the identical sendOnce: it reads status and settles the original claim, without creating another send. Release requires terminal content and reconciled agreement among host, outbox and local message references. Expired authority can read/settle an existing outcome but cannot write new content. Use locked recover-delegation for expired accepted native tasks; preserve their task and receipt.

Local helper tests use synthetic HTTP, actual SQLite and child processes. They do not prove hosted persistence, provider delivery, device rendering or target-VM Python/flock availability. The [lane evidence](../../docs/product-repair/lanes/07.md) lists exact executed checks.
