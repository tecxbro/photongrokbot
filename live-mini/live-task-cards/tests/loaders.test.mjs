import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { parseLoaderAsset } from '../src/loaders.mjs';
import { CardService } from '../src/service.mjs';
import { createTaskCardRuntime, createSpectrumPresenter } from '../src/spectrum-presenter.mjs';
import { fixture, httpFixture, payload, finished, accept } from './helpers.mjs';

const asset = (name = 'Test portrait') => ({ name, kind: 'static', columns: 16, rows: 20, cells: '01234'.repeat(64) });
const change = (ownerRef = 'owner-a', extra = {}) => ({ ownerRef, requestId: 'customize-1', expectedRevision: 0, action: 'replace', asset: asset(), ...extra });
async function create(service, ownerRef, taskId, content) {
  const b = await payload('matrix');
  return service.create({ ...b, ownerRef, requestId: taskId, taskId, ...(content ? { content } : {}) });
}
async function view(service, r) { return service.view(r.slot, r.id, service.key(r)); }

test('loader validation accepts separate still/loop formats and rejects scripts, dimensions and invalid loops', () => {
  assert.equal(parseLoaderAsset(asset()).kind, 'static');
  const animation = { name: 'Authored loop', kind: 'animation', columns: 8, rows: 8, duration: 2,
    frames: [[0, '0'.repeat(64)], [1, '4'.repeat(64)], [2, '0'.repeat(64)]] };
  assert.equal(parseLoaderAsset(animation).frames.length, 3);
  for (const mutate of [a => a.url = 'https://example.com/loader.js', a => a.cells = '5'.repeat(320), a => a.rows = 33,
    a => a.cells = '0', a => a.duration = 1]) {
    const a = asset(); mutate(a); assert.throws(() => parseLoaderAsset(a));
  }
  for (const mutate of [a => a.frames[2][1] = '4'.repeat(64), a => a.frames[1][0] = 2,
    a => a.frames[0][0] = .1, a => a.duration = Infinity]) {
    const a = structuredClone(animation); mutate(a); assert.throws(() => parseLoaderAsset(a));
  }
});

test('loader replacement is owner-scoped, keeps URLs/task clocks, persists and applies to future cards', async t => {
  const f = await fixture(t), a = await create(f.service, 'owner-a', 'a'), b = await create(f.service, 'owner-b', 'b');
  const p = await f.service.setLoader(change());
  const next = await f.service.get(a.id);
  assert.equal(next.viewUrl, a.viewUrl); assert.equal(next.revision, a.revision + 1);
  assert.deepEqual(next.workflowTiming, a.workflowTiming); assert.deepEqual(next.content, a.content);
  assert.equal((await view(f.service, a)).loader.id, p.loader.id);
  assert.equal((await view(f.service, b)).loader, null);
  const restarted = new CardService(f.store, f.config);
  const future = await create(restarted, 'owner-a', 'future');
  assert.equal((await view(restarted, future)).loader.id, p.loader.id);
  assert.equal((await restarted.getLoader('owner-a')).revision, 1);
  assert.equal((await restarted.get(b.id)).revision, 1);
});

test('reset restores Grokbot for active/future cards but preserves terminal and archived loader history', async t => {
  const { service, store } = await fixture(t);
  const p = await service.setLoader(change());
  const done = await create(service, 'owner-a', 'done');
  await accept(service, done);
  const terminal = await service.update(done.id, { requestId: 'finish', expectedRevision: 1, content: finished(done.content) });
  await service.release(done.id, terminal.revision);
  const active = await create(service, 'owner-a', 'active');
  const reset = await service.setLoader(change('owner-a', { requestId: 'reset', expectedRevision: 1, action: 'reset', asset: undefined }));
  assert.equal(reset.loader, null);
  assert.equal((await view(service, active)).loader, null);
  assert.equal((await view(service, done)).loader.id, p.loader.id);
  assert.equal((await store.read()).loaderAssets[p.loader.id].name, 'Test portrait');
  const next = await create(service, 'owner-a', 'new');
  assert.equal((await view(service, next)).loader, null);
});

test('loader writes are idempotent, reject stale revisions and cannot overwrite a newer milestone', async t => {
  const { service } = await fixture(t);
  const r = await create(service, 'owner-a', 'a');
  const p = await service.setLoader(change());
  assert.deepEqual(await service.setLoader(change()), p);
  assert.equal((await service.get(r.id)).revision, 2);
  await assert.rejects(service.setLoader(change('owner-a', { asset: asset('Different') })), { code: 'IDEMPOTENCY_CONFLICT' });
  await assert.rejects(service.setLoader(change('owner-a', { requestId: 'stale' })), { code: 'REVISION_CONFLICT' });
  await assert.rejects(service.update(r.id, { requestId: 'milestone', expectedRevision: 1, content: r.content }), { code: 'REVISION_CONFLICT' });
  await service.update(r.id, { requestId: 'milestone', expectedRevision: 2, content: r.content });
  assert.equal((await view(service, r)).loader.id, p.loader.id);
});

test('unreferenced assets are collected; preferences and retained final cards keep theirs', async t => {
  const { service, store } = await fixture(t);
  const first = await service.setLoader(change());
  const second = await service.setLoader(change('owner-a', { requestId: 'next', expectedRevision: 1, asset: asset('New') }));
  assert.equal((await store.read()).loaderAssets[first.loader.id], undefined);
  assert.ok((await store.read()).loaderAssets[second.loader.id]);
  await service.setLoader(change('owner-a', { requestId: 'reset', expectedRevision: 2, action: 'reset', asset: undefined }));
  assert.deepEqual((await store.read()).loaderAssets, {});
});

test('old registries and cards without owners retain Grokbot; owner identity is absent from public data', async t => {
  const { service } = await fixture(t);
  const r = await service.create(await payload('matrix'));
  await service.setLoader(change());
  const publicView = await view(service, r);
  assert.equal(publicView.loader, null);
  assert.equal(publicView.ownerRef, undefined);
  const owned = await create(service, 'owner-a', 'owned');
  assert.equal((await view(service, owned)).ownerRef, undefined);
  assert.equal((await view(service, owned)).loaderPreferences, undefined);
});

test('loader HTTP API rejects unauthenticated/view-only writes and exposes only the selected asset', async t => {
  const f = await httpFixture(t);
  const a = await create(f.service, 'owner-a', 'a'), b = await create(f.service, 'owner-b', 'b');
  for (const token of ['', f.service.key(a)]) {
    const response = await fetch(`${f.config.baseUrl}/api/loader-preference`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(change()),
    });
    assert.equal(response.status, 401);
  }
  const p = await f.client.setLoader(change());
  assert.equal((await f.client.getLoader('owner-a')).loader.id, p.loader.id);
  const html = await (await fetch(a.viewUrl)).text();
  assert.ok(html.includes(p.loader.id)); assert.ok(!html.includes('owner-a'));
  assert.ok(!(await (await fetch(b.viewUrl)).text()).includes(p.loader.id));
  const denied = await fetch(`${f.config.baseUrl}/api/loader-preference?ownerRef=owner-a`);
  assert.equal(denied.status, 401);
});

test('loader upload accepts bounded larger assets without increasing the ordinary card body limit', async t => {
  const f = await httpFixture(t);
  const large = { name: 'Longer loop', kind: 'animation', columns: 32, rows: 32, duration: 20,
    frames: Array.from({ length: 21 }, (_, i) => [i, String(i % 4).repeat(1024)]) };
  assert.ok(JSON.stringify(large).length > 16_384);
  await f.client.setLoader(change('owner-a', { asset: large }));
  const oversized = { ...large, frames: Array.from({ length: 201 }, (_, i) => [i / 10, '0'.repeat(1024)]) };
  await assert.rejects(f.client.setLoader(change('owner-b', { asset: oversized })), { code: 'BODY_TOO_LARGE' });
  await assert.rejects(f.client.create({ padding: 'a'.repeat(17000) }), { code: 'BODY_TOO_LARGE' });
});

function runtime(f, hooks = {}) {
  const calls = [];
  const space = { id: 'replace-with-authorized-space-id', send: async value => { calls.push(value); return { id: 'message-1' }; } };
  const presenter = createSpectrumPresenter({ app: url => ({ url }) });
  return { calls, space, live: createTaskCardRuntime({ client: f.client, presenter, ...hooks }) };
}
const resolveOwner = (_space, context) => context.owner;
const authorizeLoaderChange = (_space, context) => context.explicit;

test('runtime requires explicit replace/reset authorization; attachments and wrong actions cause no write', async t => {
  const f = await httpFixture(t);
  const { live, space, calls } = runtime(f, { resolveOwner, authorizeLoaderChange });
  const input = { expectedRevision: 0, asset: asset() };
  await assert.rejects(live.setLoader(input, space, { owner: 'a', photo: true }), { code: 'LOADER_REQUEST_REQUIRED' });
  await assert.rejects(live.setLoader(input, space, { owner: 'a', explicit: { action: 'reset', requestId: 'x' } }), { code: 'LOADER_REQUEST_REQUIRED' });
  assert.equal((await f.client.getLoader('a')).revision, 0);
  await live.setLoader(input, space, { owner: 'a', explicit: { action: 'replace', requestId: 'x' } });
  await live.resetLoader({ expectedRevision: 1 }, space, { owner: 'a', explicit: { action: 'reset', requestId: 'y' } });
  assert.equal((await f.client.getLoader('a')).loader, null); assert.equal(calls.length, 0);
});

test('runtime derives owner from trusted context, applies loader and blocks cross-owner task access', async t => {
  const f = await httpFixture(t);
  const { live, space, calls } = runtime(f, { resolveOwner, authorizeLoaderChange });
  const context = { owner: 'a', explicit: { action: 'replace', requestId: 'requested' } };
  await live.setLoader({ expectedRevision: 0, asset: asset() }, space, context);
  const b = await payload('matrix');
  await assert.rejects(live.start({ ...b, ownerRef: 'victim' }, space, context), { code: 'INVALID_INPUT' });
  const start = await live.start(b, space, context);
  assert.equal(start.record.ownerRef, 'a'); assert.ok(start.record.loaderAssetId);
  await assert.rejects(live.get(start.record.id, space, { owner: 'b' }), { code: 'OWNER_MISMATCH' });
  await live.update(start.record.id, { requestId: 'milestone', expectedRevision: 1, content: b.content }, space, context);
  assert.equal(calls.length, 1);
});

test('personalization stays disabled when runtime authorization hooks are absent', async t => {
  const f = await httpFixture(t), { live, space } = runtime(f);
  await assert.rejects(live.setLoader({ expectedRevision: 0, asset: asset() }, space), { code: 'LOADER_REQUEST_REQUIRED' });
  assert.equal((await f.client.getLoader('a')).revision, 0);
});

test('variable lattices preserve transition position/velocity and agree across 30/60/120fps', async () => {
  const scope = { Float64Array, Math, Number, RangeError }; vm.createContext(scope);
  vm.runInContext(await readFile(new URL('../grokbot-matrix/mini-core.js', import.meta.url), 'utf8'), scope);
  const { DampedField, progress } = scope.MatrixCardCore;
  for (const [columns, rows] of [[14,14], [16,20], [32,32]]) {
    const count = columns * rows;
    assert.ok(Math.abs(progress(41, 100, count).reduce((a,b)=>a+b,0) - count * .41) < 1e-8);
    const runs = [30,60,120].map(fps => {
      const f = new DampedField(new Float64Array(count));
      f.retarget(new Float64Array(count).fill(1), 0, { style: 'morph', columns, rows });
      for(let i=1;i<=fps/2;i++) f.advance(i/fps);
      const values = [...f.values], velocities = [...f.velocity];
      f.retarget(new Float64Array(count), .5, { style: 'morph', reverse: true, columns, rows });
      assert.deepEqual([...f.values], values); assert.deepEqual([...f.velocity], velocities);
      return values;
    });
    for(let i=0;i<count;i++) assert.ok(Math.abs(runs[0][i]-runs[2][i]) < 1e-9);
  }
});

test('concurrent personalization cannot silently overwrite another request for the same owner', async t => {
  const { service } = await fixture(t);
  const outcomes = await Promise.allSettled([
    service.setLoader(change('owner-a', { requestId: 'first', asset: asset('First') })),
    service.setLoader(change('owner-a', { requestId: 'second', asset: asset('Second') })),
  ]);
  assert.equal(outcomes.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(outcomes.find(r => r.status === 'rejected').reason.code, 'REVISION_CONFLICT');
  assert.equal((await service.getLoader('owner-a')).revision, 1);
});

test('custom static and authored loop samples remain bounded through four cycles at 30/60/120fps', async () => {
  const scope = { Float64Array, Math, Number, RangeError }; vm.createContext(scope);
  vm.runInContext(await readFile(new URL('../grokbot-matrix/mini-core.js', import.meta.url), 'utf8'), scope);
  const data = parseLoaderAsset(JSON.parse(await readFile(new URL('../examples/loader-animation.json', import.meta.url))));
  const animation = new scope.MatrixCardCore.Animation(data);
  for (const fps of [30, 60, 120]) {
    let previous = animation.sampleLoop(0);
    for (let frame = 1; frame <= fps * data.duration * 4; frame++) {
      const current = animation.sampleLoop(frame / fps);
      assert.ok(current.every((v, i) => v >= 0 && v <= 1 && Math.abs(v - previous[i]) <= 3.01 / fps));
      previous = current;
    }
  }
  const oldCore = globalThis.MatrixCardCore;
  try {
    globalThis.MatrixCardCore = scope.MatrixCardCore;
    const { loaderAnimation } = await import('../public/loader-animation.mjs');
    const still = loaderAnimation({ ...asset(), id: 'test-static' });
    assert.deepEqual(still.sampleLoop(0), still.sampleLoop(1000));
    assert.equal(still.sampleLoop(0).length, 320);
  } finally { globalThis.MatrixCardCore = oldCore; }
});
