/** Invocation ownership is the unguessable run ID plus monotonically increasing fence. */
import { getStore } from "./storage.ts";
import type { BridgeStore, ClaimToken } from "./contracts.ts";
export const DEFAULT_CLAIM_LEASE_MS = 15 * 60 * 1000;
export function tryClaimBatch(
  batchId: string,
  _botIdentity?: string,
  leaseMs = DEFAULT_CLAIM_LEASE_MS,
  store: BridgeStore = getStore(),
) {
  return store.claimBatch(batchId, leaseMs);
}
export function markBatchClaimCompleted(
  token: ClaimToken,
  store: BridgeStore = getStore(),
) {
  store.completeClaim(token);
}
export function renewBatchClaim(
  token: ClaimToken,
  leaseMs = DEFAULT_CLAIM_LEASE_MS,
  store: BridgeStore = getStore(),
) {
  store.renewClaim(token, leaseMs);
}
export function readBatchClaim(batchId: string) {
  return getStore().claimSnapshot(batchId);
}
