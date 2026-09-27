import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, mkdir } from 'node:fs/promises';
import { FileStore } from '../src/store.mjs';
import { CardService } from '../src/service.mjs';
import { fixture, payload, finished, accept } from './helpers.mjs';

test('concurrent creates claim at most ten distinct slots', async t => {
  const f = await fixture(t), b = await payload();
  const calls = Array.from({ length: 12 }, (_, i) => {
    const service = new CardService(new FileStore(f.store.path), f.config);
    return service.create({ ...b, requestId: `create-${i}`, taskId: `task-${i}` });
  });
  const results = await Promise.allSettled(calls);
  const passed = results.filter(r => r.status === 'fulfilled');
  assert.equal(passed.length, 10); assert.equal(new Set(passed.map(r => r.value.slot)).size, 10);
  assert.equal(results.filter(r => r.reason?.code === 'NO_SLOT_AVAILABLE').length, 2);
});
test('identical create retries return one identity', async t => {
  const { service } = await fixture(t), b = await payload();
  const results = await Promise.all([service.create(b), service.create(b), service.create(b)]);
  assert.equal(new Set(results.map(r => r.id)).size, 1);
  assert.equal((await service.slots()).filter(s => s.occupied).length, 1);
});
test('conflicting create idempotency key is rejected', async t => {
  const { service } = await fixture(t), b = await payload(); await service.create(b);
  b.content.title = 'Different'; await assert.rejects(service.create(b), { code: 'IDEMPOTENCY_CONFLICT' });
});
test('same task cannot get another retained card', async t => {
  const { service } = await fixture(t), b = await payload(); await service.create(b);
  b.requestId = 'another'; await assert.rejects(service.create(b), { code: 'TASK_ALREADY_HAS_CARD' });
});
test('update changes data and revision, not identity or slot', async t => {
  const { service } = await fixture(t), b = await payload(), r = await service.create(b);
  b.content.progress.completed = 28;
  const next = await service.update(r.id, { requestId: 'update-1', expectedRevision: 1, content: b.content });
  assert.equal(next.revision, 2); assert.equal(next.slot, r.slot); assert.equal(next.id, r.id);
  assert.equal(next.content.progress.completed, 28);
});
test('a complete record snapshot can be reused as the next update payload', async t => {
  const { service } = await fixture(t), r = await service.create(await payload());
  const content = structuredClone(r.content);
  content.progress.completed = 28;
  const next = await service.update(r.id, { requestId: 'snapshot-next', expectedRevision: r.revision, content });
  assert.equal(next.content.progress.completed, 28);
});
test('stale updates cannot overwrite new progress', async t => {
  const { service } = await fixture(t), b = await payload(), r = await service.create(b);
  await service.update(r.id, { requestId: 'newer', expectedRevision: 1, content: b.content });
  await assert.rejects(service.update(r.id, { requestId: 'older', expectedRevision: 1, content: b.content }), { code: 'REVISION_CONFLICT' });
});
test('updates keep the original template so mounted assets remain valid', async t => {
  const { service } = await fixture(t), b = await payload(), r = await service.create(b);
  b.content.template = 'matrix';
  b.content.activityHistory = [{ icon: 'working', label: 'Working' }];
  await assert.rejects(service.update(r.id, { requestId: 'switch', expectedRevision: 1, content: b.content }), { code: 'TEMPLATE_CONFLICT' });
});
test('retry after an update response is lost is idempotent', async t => {
  const { service } = await fixture(t), b = await payload(), r = await service.create(b);
  const update = { requestId: 'next', expectedRevision: 1, content: b.content };
  const one = await service.update(r.id, update), two = await service.update(r.id, update);
  assert.equal(one.revision, two.revision);
});
test('presentation claims serialize same-card provider operations', async t => {
  const { service } = await fixture(t), r = await service.create(await payload());
  const all = await Promise.allSettled([service.beginPresentation(r.id, { revision: 1 }), service.beginPresentation(r.id, { revision: 1 })]);
  assert.equal(all.filter(x => x.status === 'fulfilled').length, 1);
  assert.equal(all.find(x => x.status === 'rejected').reason.code, 'PRESENTATION_PENDING');
});
test('confirmed milestone can be saved during an unresolved initial send', async t => {
  const { service } = await fixture(t), b = await payload(), r = await service.create(b);
  await service.beginPresentation(r.id, { revision: 1 });
  const updated = await service.update(r.id, { requestId: 'next', expectedRevision: 1, content: b.content });
  assert.equal(updated.revision, 2);
  assert.equal(updated.activeAttempt.revision, 1);
});
test('unknown outcomes retain occupancy and cannot be resent', async t => {
  const { service } = await fixture(t), r = await service.create(await payload());
  const a = await service.beginPresentation(r.id, { revision: 1 });
  await service.settlePresentation(r.id, { attemptId: a.attempt.id, outcome: 'unknown' });
  await assert.rejects(service.beginPresentation(r.id, { revision: 1 }), { code: 'PRESENTATION_PENDING' });
  await assert.rejects(service.discard(r.id), { code: 'PRESENTATION_PENDING' });
  assert.equal((await service.slots())[0].occupied, true);
});
test('unknown can be explicitly reconciled with actual message reference', async t => {
  const { service } = await fixture(t), r = await service.create(await payload());
  const a = await service.beginPresentation(r.id, { revision: 1 });
  await service.settlePresentation(r.id, { attemptId: a.attempt.id, outcome: 'unknown' });
  const result = await service.settlePresentation(r.id, { attemptId: a.attempt.id, outcome: 'accepted', messageRef: 'actual-message' });
  assert.equal(result.activeAttempt, null); assert.equal(result.delivery.messageRef, 'actual-message');
});
test('accepted settlement retries do not create new references', async t => {
  const { service } = await fixture(t), r = await service.create(await payload());
  const a = await service.beginPresentation(r.id, { revision: 1 });
  const settlement = { attemptId: a.attempt.id, outcome: 'accepted', messageRef: 'actual-message' };
  await service.settlePresentation(r.id, settlement);
  assert.equal((await service.settlePresentation(r.id, settlement)).delivery.messageRef, 'actual-message');
});
test('wrong initial attempt is rejected and accepted send cannot be repeated', async t => {
  const { service } = await fixture(t), b = await payload(); let r = await service.create(b);
  const a = await service.beginPresentation(r.id, { revision: 1 });
  await assert.rejects(service.settlePresentation(r.id, { attemptId: 'wrong', outcome: 'accepted', messageRef: 'wrong' }), { code: 'ATTEMPT_CONFLICT' });
  r = await service.settlePresentation(r.id, { attemptId: a.attempt.id, outcome: 'accepted', messageRef: 'original' });
  r = await service.update(r.id, { requestId: 'next', expectedRevision: 1, content: b.content });
  assert.equal((await service.beginPresentation(r.id, { revision: 2 })).skipped, true);
});
test('pre-migration edit claim can be reconciled without replacing original message', async t => {
  const { service, store } = await fixture(t), b = await payload(); let r = await service.create(b);
  r = await accept(service, r);
  await store.transaction(state => {
    state.cards[r.id].activeAttempt = { id: 'legacy-edit', revision: 1, kind: 'update', state: 'unknown' };
  });
  await assert.rejects(service.settlePresentation(r.id, { attemptId: 'legacy-edit', outcome: 'accepted', messageRef: 'replacement' }), { code: 'MESSAGE_CONFLICT' });
  const reconciled = await service.settlePresentation(r.id, { attemptId: 'legacy-edit', outcome: 'accepted' });
  assert.equal(reconciled.delivery.messageRef, r.delivery.messageRef);
});
test('release requires terminal state and reconciled initial send', async t => {
  const { service } = await fixture(t), b = await payload(); let r = await service.create(b);
  await assert.rejects(service.release(r.id, 1), { code: 'TASK_NOT_FINISHED' });
  r = await service.update(r.id, { requestId: 'done', expectedRevision: 1, content: finished(b.content) });
  await assert.rejects(service.release(r.id, 2), { code: 'INITIAL_SEND_NOT_RECONCILED' });
  r = await accept(service, r); await service.release(r.id, 2);
  assert.equal((await service.slots())[0].occupied, false);
});
test('terminal milestone can precede reconciliation, then release without final edit', async t => {
  const { service } = await fixture(t), b = await payload(); let r = await service.create(b);
  const claim = await service.beginPresentation(r.id, { revision: 1 });
  r = await service.update(r.id, { requestId: 'done', expectedRevision: 1, content: finished(b.content) });
  await assert.rejects(service.release(r.id, 2), { code: 'PRESENTATION_PENDING' });
  r = await service.settlePresentation(r.id, { attemptId: claim.attempt.id, outcome: 'accepted', messageRef: 'original' });
  assert.equal(r.delivery.presentedRevision, 1);
  r = await service.release(r.id, 2);
  assert.ok(r.archivedAt);
});
test('old URL remains bound to old card after slot reuse', async t => {
  const { service } = await fixture(t), b = await payload(); let r = await service.create(b);
  r = await service.update(r.id, { requestId: 'done', expectedRevision: 1, content: finished(b.content) });
  r = await accept(service, r); await service.release(r.id, 2);
  const next = await service.create({ ...b, requestId: 'new', taskId: 'different-task' });
  assert.equal(next.slot, r.slot); assert.notEqual(next.id, r.id);
  const old = await service.view(r.slot, r.id, new URL(r.viewUrl).searchParams.get('k'));
  assert.equal(old.content.status, 'completed'); assert.notEqual(old.id, next.id);
});
test('archived and terminal cards reject late worker changes', async t => {
  const { service } = await fixture(t), b = await payload(); let r = await service.create(b);
  r = await service.update(r.id, { requestId: 'done', expectedRevision: 1, content: finished(b.content) });
  await assert.rejects(service.update(r.id, { requestId: 'late', expectedRevision: 2, content: b.content }), { code: 'TASK_TERMINAL' });
  r = await accept(service, r); await service.release(r.id, 2);
  await assert.rejects(service.update(r.id, { requestId: 'later', expectedRevision: 2, content: b.content }), { code: 'CARD_ARCHIVED' });
});
test('restart preserves slots, progress and unresolved claims', async t => {
  const f = await fixture(t), r = await f.service.create(await payload()); await f.service.beginPresentation(r.id, { revision: 1 });
  const service = new CardService(new FileStore(f.store.path), f.config);
  const recovered = await service.get(r.id);
  assert.ok(recovered.activeAttempt); assert.equal((await service.slots())[0].occupied, true);
});
test('only unsent, unambiguous draft can be discarded', async t => {
  const { service } = await fixture(t), r = await service.create(await payload());
  await service.discard(r.id); assert.equal((await service.slots())[0].occupied, false);
});
test('read token is scoped to exact card and slot', async t => {
  const { service } = await fixture(t), r = await service.create(await payload()), k = new URL(r.viewUrl).searchParams.get('k');
  await assert.rejects(service.view('live-2', r.id, k), { code: 'CARD_NOT_FOUND' });
  await assert.rejects(service.view(r.slot, r.id, 'fake'), { code: 'CARD_NOT_FOUND' });
});
test('public view omits internal identities and delivery/session state', async t => {
  const { service } = await fixture(t), r = await service.create(await payload());
  const v = await service.view(r.slot, r.id, new URL(r.viewUrl).searchParams.get('k'));
  for (const key of ['taskId', 'conversationRef', 'delivery', 'activeAttempt', 'viewUrl']) assert.equal(key in v, false);
});
test('archive read expiry does not release active tasks by elapsed time', async t => {
  let now = new Date('2026-01-01T00:00:00Z');
  const { service } = await fixture(t, { options: { clock: () => now } });
  const b = await payload(); let r = await service.create(b);
  r = await service.update(r.id, { requestId: 'done', expectedRevision: 1, content: finished(b.content) });
  r = await accept(service, r); await service.release(r.id, 2);
  const active = await service.create({ ...b, requestId: 'active', taskId: 'active' });
  now = new Date('2026-04-01T00:00:00Z');
  await assert.rejects(service.view(r.slot, r.id, new URL(r.viewUrl).searchParams.get('k')), { code: 'CARD_NOT_FOUND' });
  assert.equal((await service.get(active.id)).archivedAt, null);
});
test('corrupt file rejected without overwrite', async t => {
  const f = await fixture(t); await writeFile(f.store.path, '{broken');
  await assert.rejects(f.service.create(await payload()), { code: 'STORE_CORRUPT' });
});
test('stale local lock fails closed instead of stealing ownership', async t => {
  const f = await fixture(t); await mkdir(`${f.store.path}.lock`);
  const store = new FileStore(f.store.path, { lockTimeoutMs: 5 });
  await assert.rejects(store.transaction(() => null), { code: 'STORE_BUSY' });
});
