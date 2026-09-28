import type { BridgeStore, DeliveryState } from './contracts.ts';
import type { InboundRecord } from './types.ts';
import { isGreetingOnlyBatch } from './greeting.ts';

export type OnboardingState = { reserved: boolean; state?: DeliveryState | 'legacy-recorded'; outboundIds: string[]; provenance?: string; deviceObserved: false };

/** The store reserves and enqueues this in the same transaction as acceptance. */
export function onboardingAcceptance(record: InboundRecord) {
  return { onboarding: true, greetingOnly: isGreetingOnlyBatch([record]) };
}
export function readOnboarding(store: Pick<BridgeStore, 'getMetadata' | 'outboundStatus'>): OnboardingState {
  const record = store.getMetadata<{ state?: DeliveryState | 'legacy-recorded'; outboundIds?: string[]; provenance?: string }>('onboarding', 'reservation');
  if (!record) return { reserved: false, outboundIds: [], deviceObserved: false };
  const ids = Array.isArray(record.outboundIds) ? record.outboundIds.filter(id => typeof id === 'string') : [];
  const actual = ids.length ? store.outboundStatus(ids[0]!) : undefined;
  return { reserved: true, state: actual?.state ?? record.state ?? 'unknown', outboundIds: ids, provenance: record.provenance, deviceObserved: false };
}
