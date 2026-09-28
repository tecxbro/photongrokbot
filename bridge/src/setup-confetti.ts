/** Read-only compatibility view. Onboarding ownership is transactional store.accept. */
import type { BridgeStore } from './contracts.ts';
import { getStore } from './storage.ts';
import { readOnboarding } from './onboarding.ts';

export async function hasSetupConfettiBeenSent(store: Pick<BridgeStore, 'getMetadata' | 'outboundStatus'> = getStore()): Promise<boolean> {
  const status = readOnboarding(store);
  // Legacy provenance prevents a replay without asserting device observation.
  return status.state === 'accepted' || (status.state === 'legacy-recorded' && status.provenance === 'legacy-marker-not-device-observation');
}
/** Deliberately fails instead of reviving the independent file-marker writer. */
export async function markSetupConfettiSent(_sentAt?: string): Promise<never> {
  throw new Error('ONBOARDING_REQUIRES_DURABLE_PROVIDER_SETTLEMENT');
}
