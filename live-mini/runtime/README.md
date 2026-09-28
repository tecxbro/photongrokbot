# Canonical task-card helper

This Node 22 helper publishes host content and submits the initial card through the bridge's durable outbox. It owns no Spectrum connection. Read the [operating contract](../../docs/product-repair/OPERATING_CONTRACT.md) and [host integration](../live-task-cards/docs/INTEGRATION.md). Live Mini must already be enabled by the initial requested setup scope or a later request; normal task execution cannot deploy it.

The local taskId must first have a durable delegation intent and actual accepted receipt, with nativeRef attached when the native tool returns it. Obtain its original destination and a permitted current batch/work revision through bridge controls. An original or amended worker uses task-result to return the recorded task inputRevision, correlationId and receipt without a parent claim. The resulting wake or resume-task grants Front Door current processing authority. Use a stable explicit task key for every call. No caller-selected replacement destination is allowed.

```js
import { createLiveCardMilestones } from './live-card-milestones.mjs';
const cards = createLiveCardMilestones({
  taskContext: { taskId, batchId, inputRevision, taskInputRevision, claim: { batchId, runId, generation } },
});
const first = await cards.createCard(createPayload, stableTaskKey);
await cards.sendOnce(originalSpaceId, first.record.viewUrl, stableTaskKey);
// On a permitted task continuation, replace authority with the fresh bridge result.
cards.setTaskContext({ taskId, batchId: resumedBatchId,
  inputRevision: resumedWorkRevision, taskInputRevision: currentTaskInputRevision,
  claim: resumedClaim });
await cards.updateMilestone(first.record.id, {
  requestId: stableMilestoneId,
  expectedRevision: revisionUsedToComputeThisContent,
  content: authoredSnapshot,
}, stableTaskKey);
await cards.completeAndRelease(first.record.id, stableTaskKey);
```

`setTaskContext(nextContext)` updates current authority while retaining local taskId and task key. Alternatively, pass an async `getTaskContext()` callback, evaluated once per operation, to fetch the current permitted context. Copy work inputRevision and taskInputRevision from bridge results; never derive either from claim generation.

`createPayload.taskId` and `conversationRef` must match the stored task and original conversation. Its `requestId` is stable. `loadContext(taskKey)` is async. `completeAndRelease(cardId,taskKey,terminalUpdate?)` optionally takes a full `{requestId,expectedRevision,content}` body before release. `taskKey` is never inferred. The helper rejects legacy direct-runtime options such as liveCards, space, stateDir and secretsPath. Ordinary static apps remain a separate Front Door capability.

Private paths come from the shared resolver: publisher environment at `secrets/live-mini.env`, hashed contexts at `live-mini/context`. Each context hashes installation, task, originalBatchId, original destination and full task key. This preserves the existing hash format with originalBatchId in the identity.batchId slot, so follow-ups retain old private contexts, the exact signed URL, presentation and settlement; a kernel lock serializes writers. Never build filenames from provider IDs, read old checkout queues, or clear a context to retry. A legacy runtime/state directory requires migration review.

## Executable bridge controls

Run from bridge/ with pinned Bun. These internal wrappers are not new provider APIs. All take bounded JSON on stdin:

- `bun run src/presentation-control.ts task-context --json-stdin`: `{taskId,batchId,inputRevision?,taskInputRevision?,claim?}`. Returns originalBatchId, current batchId, inputRevision, taskInputRevision, original destination and configured origin. The batch/work must be a permitted input to this task. Supply current claim/revisions for new mutations; omit claim only for read-only recovery.
- `bun run src/presentation-control.ts register --json-stdin`: `{claim,inputRevision?,taskInputRevision?,context:{cardId,taskId,batchId,destination,viewUrl}}`, with context.batchId set to the originalBatchId. Immutable registered context requires the configured origin, exact route/card and complete private URL.
- `bun run src/presentation-control.ts operation-status --json-stdin`: `{taskId,batchId,inputRevision?,taskInputRevision?,cardId,actionKey}`. Uses the existing card identity to return the exact original presentation operation, including after claim expiry.

The helper invokes these without a shell and uses the canonical `bun run enqueue -- --json-stdin` envelope with purpose presentation. It journals the original create/update requests before HTTP and registers the full URL before enqueue. Do not raw-send or edit a task-card app URL. Ordinary progress changes hosted JSON at the exact same URL, including unchanged query token, without a new bubble or deployment.

## Recovery

Unknown create, host-claim, enqueue, provider-send or host-settlement outcomes retain their original identity. Retry only the same body, request ID, revision, full URL and task key. A pending unknown update rejects a different body. Definitive revision/idempotency conflicts remain visible; review current content before intentionally authoring a new request. The helper never automatically rebases.

Initial presentation with no definitive message ID keeps the host claim and slot occupied. Stop dispatch and reconcile the exact existing outbox attempt using private provider evidence, as described in [migration/recovery](../../docs/product-repair/MIGRATION.md). Then call the identical sendOnce: it reads status and settles the original claim, without creating another send. Release requires terminal content and reconciled agreement among host, outbox and local message references. Expired authority can read/settle an existing outcome but cannot write new content. Report an ordinary worker result with task-result and use resume-task/current wake authority for subsequent writes; the bridge remains running. recover-delegation is only genuine offline operator recovery. Replayed results and resumed work never create another initial send.

Bridge controls return bounded `{ok:false,error:{code,recovery:[...]}}` on nonzero exit. The helper preserves supported codes/actions for stale authority, identity conflicts, invalid inputs and uncertain outcomes; it does not expose arbitrary raw stderr or replace every error with BRIDGE_REJECTED.

Local helper tests use synthetic HTTP, actual SQLite and child processes. They do not prove hosted persistence, provider delivery, device rendering or target-VM Python/flock availability. The [lane evidence](../../docs/product-repair/lanes/07.md) lists exact executed checks.
