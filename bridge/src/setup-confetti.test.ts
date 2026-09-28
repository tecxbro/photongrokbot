import { afterEach, expect, test } from 'bun:test';
import { fixture, record } from './tests/storage/fixture.ts';
import { hasSetupConfettiBeenSent, markSetupConfettiSent } from './setup-confetti.ts';
import { readOnboarding } from './onboarding.ts';
import { openStore } from './storage.ts';
const cleanups: (() => void)[] = [];
afterEach(() => { for (const clean of cleanups.splice(0)) clean(); });
function setup() { const f = fixture(); cleanups.push(f.cleanup); return f; }

test('U05 onboarding is the store operation; queued/unknown are not accepted and no marker writer exists', async () => {
  const { store } = setup();
  expect(await hasSetupConfettiBeenSent(store)).toBe(false);
  store.accept({ eventKey: 'hello', record: record('hello'), destination: { spaceId: 'space-1', lineId: 'line-1' }, onboarding: true, greetingOnly: true });
  expect(readOnboarding(store).reserved).toBe(true); expect(await hasSetupConfettiBeenSent(store)).toBe(false);
  await expect(markSetupConfettiSent()).rejects.toThrow('ONBOARDING_REQUIRES_DURABLE_PROVIDER_SETTLEMENT');
  const attempt = store.claimOutbound()!; store.settleOutbound(attempt.item.id, attempt.attemptId, { state: 'unknown', code: 'SYNTHETIC_TIMEOUT' });
  expect(readOnboarding(store).state).toBe('unknown'); expect(await hasSetupConfettiBeenSent(store)).toBe(false);
});
test('U05 compatibility read reports provider acceptance separately from physical device observation', async () => {
  const { store, paths } = setup();
  store.accept({ eventKey: 'hello', record: record('hello'), destination: { spaceId: 'space-1', lineId: 'line-1' }, onboarding: true });
  const attempt = store.claimOutbound()!; store.settleOutbound(attempt.item.id, attempt.attemptId, { state: 'accepted', evidence: 'synthetic test provider', reference: { messageId: 'provider-hello' } });
  const readonly = openStore({ paths, readOnly: true });
  try { expect(await hasSetupConfettiBeenSent(readonly)).toBe(true); expect(readOnboarding(readonly).deviceObserved).toBe(false); } finally { readonly.close(); }
});
test('U05 legacy marker preserves no-repeat behavior without a fabricated new provider/device receipt', async () => {
  const { store } = setup();
  store.setMetadata('onboarding', 'reservation', { state: 'legacy-recorded', provenance: 'legacy-marker-not-device-observation', outboundIds: [] });
  expect(await hasSetupConfettiBeenSent(store)).toBe(true); expect(readOnboarding(store).deviceObserved).toBe(false);
  const accepted = store.accept({ eventKey: 'new', record: record('new'), destination: { spaceId: 'space-1', lineId: 'line-1' }, onboarding: true, greetingOnly: true });
  expect(accepted.onboardingCreated).toBe(false); expect(store.listOutbound()).toHaveLength(0); expect(store.formBatches()).toHaveLength(1);
});
