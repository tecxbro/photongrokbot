// VM-only integration: the existing bridge remains the only Spectrum connection.
// This adapter uses its bounded Bun control plane; never import it into the host.
import { createLiveCardMilestones } from "../../runtime/live-card-milestones.mjs";

export function attachLiveTaskCards(options) {
  return createLiveCardMilestones(options);
}

/*
const liveCards = attachLiveTaskCards({
  taskContext: { taskId: storedTaskId, batchId: originalBatchId, claim: currentClaim },
});
// Private instance configuration supplies the configured host and publisher token.
// Native task acceptance and original batch/line binding must already be recorded.
const started = await liveCards.createCard(createPayload, stableTaskKey);
await liveCards.sendOnce(originalSpaceId, started.record.viewUrl, stableTaskKey);
await liveCards.updateMilestone(started.record.id, {
  requestId: stableMilestoneId,
  expectedRevision: started.record.revision, // Revision used to compute this snapshot.
  content: nextContent,
}, stableTaskKey);
// A conflict requires reviewing newer content, not replaying stale content with a new ID.
// Unknown delivery retains the host claim; rerun sendOnce only to reconcile its same outbox action.
*/
