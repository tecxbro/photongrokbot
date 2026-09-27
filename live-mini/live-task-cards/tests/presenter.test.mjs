import test from 'node:test';
import assert from 'node:assert/strict';
import { createSpectrumPresenter, createTaskCardRuntime, MemoryTargets } from '../src/spectrum-presenter.mjs';
import { httpFixture, payload, finished } from './helpers.mjs';

function sdkDouble({ fail = false } = {}) {
  const calls = []; const original = { id: 'provider-message-1' };
  const space = { id: 'replace-with-authorized-space-id', async send(op) {
    calls.push(op); if (fail) throw new Error('network failed after request might have been sent');
    return op.kind === 'edit' ? undefined : original;
  } };
  return { calls, original, space, app: (url, options) => ({ kind: 'app', url, options }), edit: (content, target) => ({ kind: 'edit', content, target }) };
}
test('start sends once; milestone writes never edit or resend', async t => {
  const f = await httpFixture(t), sdk = sdkDouble(), targets = new MemoryTargets();
  const runtime = createTaskCardRuntime({ client: f.client, presenter: createSpectrumPresenter({ ...sdk, targets }) });
  const b = await payload(); b.content.progress.total = 100; b.content.progress.completed = 41;
  const start = await runtime.start(b, sdk.space);
  assert.equal(start.presentation, 'provider_accepted');
  let revision = 1;
  for (const completed of [42, 45, 50, 55]) {
    b.content.progress.completed = completed;
    const result = await runtime.update(start.record.id, { requestId: `milestone-${completed}`, expectedRevision: revision++, content: b.content }, sdk.space);
    assert.equal(result.record.revision, revision);
    assert.equal(result.record.viewUrl, start.record.viewUrl);
  }
  assert.equal(sdk.calls.length, 1); assert.equal(sdk.calls[0].kind, 'app');
  assert.equal(sdk.calls[0].options.live, true);
  assert.equal((await f.store.read()).version, 7); // create, send claim, settlement, four milestone writes
});
test('update does not require a provider edit return', async t => {
  const f = await httpFixture(t), sdk = sdkDouble(), runtime = createTaskCardRuntime({ client: f.client, presenter: createSpectrumPresenter({ ...sdk, targets: new MemoryTargets() }) });
  const b = await payload(), start = await runtime.start(b, sdk.space);
  const updated = await runtime.update(start.record.id, { requestId: 'next', expectedRevision: 1, content: b.content }, sdk.space);
  assert.equal(updated.presentation, 'already_sent'); assert.equal(updated.record.delivery.messageRef, sdk.original.id);
  assert.equal(sdk.calls.length, 1);
});
test('repeat sync does not resend already presented revision', async t => {
  const f = await httpFixture(t), sdk = sdkDouble(), runtime = createTaskCardRuntime({ client: f.client, presenter: createSpectrumPresenter({ ...sdk, targets: new MemoryTargets() }) });
  const start = await runtime.start(await payload(), sdk.space);
  await runtime.sync(start.record.id, sdk.space); assert.equal(sdk.calls.length, 1);
});
test('confirmed terminal update releases slot and leaves original final page', async t => {
  const f = await httpFixture(t), sdk = sdkDouble(), runtime = createTaskCardRuntime({ client: f.client, presenter: createSpectrumPresenter({ ...sdk, targets: new MemoryTargets() }) });
  const b = await payload(), start = await runtime.start(b, sdk.space);
  const end = await runtime.update(start.record.id, { requestId: 'done', expectedRevision: 1, content: finished(b.content) }, sdk.space);
  assert.ok(end.record.archivedAt); assert.equal((await f.client.slots())[0].occupied, false);
  assert.match(await (await fetch(start.record.viewUrl)).text(), /Report delivered|Result delivered/);
});
test('missing original session after restart still permits saved updates without replacement send', async t => {
  const f = await httpFixture(t), sdk = sdkDouble(), b = await payload();
  let runtime = createTaskCardRuntime({ client: f.client, presenter: createSpectrumPresenter({ ...sdk, targets: new MemoryTargets() }) });
  const start = await runtime.start(b, sdk.space);
  runtime = createTaskCardRuntime({ client: f.client, presenter: createSpectrumPresenter({ ...sdk, targets: new MemoryTargets() }) });
  const updated = await runtime.update(start.record.id, { requestId: 'next', expectedRevision: 1, content: b.content }, sdk.space);
  assert.equal(updated.record.revision, 2);
  assert.equal(sdk.calls.length, 1); assert.equal((await f.client.get(start.record.id)).revision, 2);
});
test('wrong conversation rejects before a provider send or record creation', async t => {
  const f = await httpFixture(t), sdk = sdkDouble(), runtime = createTaskCardRuntime({ client: f.client, presenter: createSpectrumPresenter({ ...sdk, targets: new MemoryTargets() }) });
  const b = await payload(); b.conversationRef = 'wrong';
  await assert.rejects(runtime.start(b, sdk.space), { code: 'SPACE_MISMATCH' }); assert.equal(sdk.calls.length, 0);
});
test('provider failure becomes unknown and is not auto retried', async t => {
  const f = await httpFixture(t), sdk = sdkDouble({ fail: true }), runtime = createTaskCardRuntime({ client: f.client, presenter: createSpectrumPresenter({ ...sdk, targets: new MemoryTargets() }) });
  await assert.rejects(runtime.start(await payload(), sdk.space), { code: 'PRESENTATION_UNKNOWN' });
  const record = await f.client.get((await f.client.slots())[0].cardId);
  assert.equal(record.activeAttempt.state, 'unknown');
  await assert.rejects(runtime.sync(record.id, sdk.space), { code: 'PRESENTATION_PENDING' }); assert.equal(sdk.calls.length, 1);
});
test('lost acknowledgment returns reconciliation data, not another SDK send', async t => {
  const f = await httpFixture(t), sdk = sdkDouble();
  const normalSettle = f.client.settlePresentation.bind(f.client);
  f.client.settlePresentation = async () => { throw new Error('lost ack'); };
  const runtime = createTaskCardRuntime({ client: f.client, presenter: createSpectrumPresenter({ ...sdk, targets: new MemoryTargets() }) });
  const start = await runtime.start(await payload(), sdk.space);
  assert.equal(start.presentation, 'provider_accepted_ack_pending'); assert.ok(start.reconciliation.attemptId);
  await normalSettle(start.record.id, start.reconciliation);
  assert.equal(sdk.calls.length, 1);
});
test('terminal release clears optional uptime-only target mapping', async t => {
  const f = await httpFixture(t), sdk = sdkDouble(), targets = new MemoryTargets();
  const runtime = createTaskCardRuntime({ client: f.client, presenter: createSpectrumPresenter({ ...sdk, targets }) });
  const b = await payload(), start = await runtime.start(b, sdk.space);
  assert.ok(await targets.get(start.record.id));
  await runtime.update(start.record.id, { requestId: 'done', expectedRevision: 1, content: finished(b.content) }, sdk.space);
  assert.equal(await targets.get(start.record.id), null);
});

test('requested light palette updates the same card without a Spectrum operation', async t => {
  const f = await httpFixture(t), sdk = sdkDouble();
  const runtime = createTaskCardRuntime({client:f.client, presenter:createSpectrumPresenter(sdk)});
  const started = await runtime.start(await payload(), sdk.space);
  const changed = await runtime.update(started.record.id, {requestId:'request-light', expectedRevision:started.record.revision,
    content:{...started.record.content, theme:'light'}}, sdk.space);
  assert.equal(changed.record.content.theme, 'light');
  assert.equal(changed.record.viewUrl, started.record.viewUrl);
  assert.equal(sdk.calls.length, 1);
});
