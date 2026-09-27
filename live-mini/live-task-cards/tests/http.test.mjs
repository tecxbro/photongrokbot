import test from 'node:test';
import assert from 'node:assert/strict';
import { httpFixture, payload } from './helpers.mjs';

test('HTTP create, read page and update round trip uses actual file store', async t => {
  const { client } = await httpFixture(t), b = await payload(), r = await client.create(b);
  const page = await fetch(r.viewUrl); assert.equal(page.status, 200);
  const html = await page.text(); assert.match(html, /Research market/); assert.match(html, /27 \/ 50/);
  b.content.progress.completed = 28;
  const next = await client.update(r.id, { requestId: 'update', expectedRevision: 1, content: b.content });
  const reopened = await (await fetch(r.viewUrl)).text();
  assert.match(reopened, /28 \/ 50/); assert.equal(next.id, r.id);
  assert.equal(next.viewUrl, r.viewUrl);
  assert.equal(new URL(r.viewUrl).searchParams.has('r'), false);
  const oldUrl = new URL(r.viewUrl); oldUrl.searchParams.set('r', '1');
  assert.match(await (await fetch(oldUrl)).text(), /28 \/ 50/);
});
test('matrix page serves live component assets and saved activity, not demo fixture', async t => {
  const { client } = await httpFixture(t), r = await client.create(await payload('matrix'));
  const html = await (await fetch(r.viewUrl)).text();
  assert.match(html, /\/matrix\/mini-card.js/);
  assert.match(html, /Verify company profiles/);
  assert.doesNotMatch(html, /mini-demo.js/);
  for (const path of ['/workflow-progress.mjs', '/matrix-presentation.mjs', '/matrix-live.mjs', '/matrix/mini-card.css', '/matrix/square-animation.js', '/matrix/dot-matrix.js', '/matrix/mini-core.js', '/matrix/mini-card.js']) {
    assert.equal((await fetch(new URL(path, r.viewUrl))).status, 200, path);
  }
});
test('public health does not imply iMessage verification', async t => {
  const f = await httpFixture(t);
  assert.equal((await fetch(`${f.config.baseUrl}/health`)).status, 200);
  const doctor = await f.client.doctor(); assert.equal(doctor.liveDeviceVerified, false);
});
test('publisher API rejects absent or view-only credentials', async t => {
  const f = await httpFixture(t), r = await f.client.create(await payload());
  for (const token of ['', new URL(r.viewUrl).searchParams.get('k')]) {
    const res = await fetch(`${f.config.baseUrl}/api/slots`, { headers: { Authorization: `Bearer ${token}` } });
    assert.equal(res.status, 401);
  }
});
test('no button action or callback endpoint exists', async t => {
  const f = await httpFixture(t), r = await f.client.create(await payload());
  const html = await (await fetch(r.viewUrl)).text();
  assert.doesNotMatch(html, /<button|<form|onclick=|ApplePaySession/);
  const res = await fetch(`${f.config.baseUrl}/api/actions`, { method: 'POST', headers: {
    Authorization: `Bearer ${f.config.publisherToken}`, 'Content-Type': 'application/json',
  }, body: '{}' });
  assert.equal(res.status, 404);
});
test('private pages have no-store, no-referrer and restricted CSP', async t => {
  const f = await httpFixture(t), r = await f.client.create(await payload()), res = await fetch(r.viewUrl);
  assert.match(res.headers.get('cache-control'), /no-store/);
  assert.equal(res.headers.get('referrer-policy'), 'no-referrer');
  assert.match(res.headers.get('content-security-policy'), /form-action 'none'/);
  assert.equal(res.headers.get('access-control-allow-origin'), null);
});
test('bad view token and wrong slot cannot read another card', async t => {
  const f = await httpFixture(t), r = await f.client.create(await payload()), u = new URL(r.viewUrl);
  u.searchParams.set('k', 'bad'); assert.equal((await fetch(u)).status, 404);
  const wrongSlot = new URL(r.viewUrl); wrongSlot.pathname = wrongSlot.pathname.replace('live-1', 'live-2');
  assert.equal((await fetch(wrongSlot)).status, 404);
});
test('private JSON view omits task/conversation and publisher credentials', async t => {
  const f = await httpFixture(t), b = await payload(), r = await f.client.create(b);
  const res = await fetch(`${f.config.baseUrl}/api/view/${r.slot}/${r.id}`, {
    headers: { Authorization: `Bearer ${new URL(r.viewUrl).searchParams.get('k')}` },
  });
  const body = await res.text();
  assert.doesNotMatch(body, /conversationRef|taskId|initialHash|activeAttempt/);
  assert.equal(body.includes(f.config.publisherToken), false);
});
test('text injection is escaped in both HTML and JSON bootstrap', async t => {
  const f = await httpFixture(t), b = await payload(); b.content.title = '</script><img src=x>';
  const r = await f.client.create(b), html = await (await fetch(r.viewUrl)).text();
  assert.match(html, /&lt;\/script&gt;&lt;img src=x&gt;/);
  assert.match(html, /\\u003c\/script\\u003e/);
  assert.equal((html.match(/<\/script>/g) || []).length, 2);
});
test('reading a card cannot change revision or slot state', async t => {
  const f = await httpFixture(t), r = await f.client.create(await payload());
  const before = await f.store.read();
  await fetch(r.viewUrl); await fetch(r.viewUrl, { method: 'HEAD' });
  const after = await f.store.read(); assert.deepEqual(after, before);
});
test('malformed JSON and oversized requests rejected', async t => {
  const f = await httpFixture(t), headers = { Authorization: `Bearer ${f.config.publisherToken}`, 'Content-Type': 'application/json' };
  const bad = await fetch(`${f.config.baseUrl}/api/cards`, { method: 'POST', headers, body: '{broken' });
  assert.equal(bad.status, 400);
  const large = await fetch(`${f.config.baseUrl}/api/cards`, { method: 'POST', headers, body: 'x'.repeat(20_000) });
  assert.equal(large.status, 413);
});
test('Build Output API rewritten path is dispatched to the same router', async t => {
  const f = await httpFixture(t);
  const res = await fetch(`${f.config.baseUrl}/index?__path=/api/slots`, { headers: { Authorization: `Bearer ${f.config.publisherToken}` } });
  assert.equal(res.status, 200); assert.equal((await res.json()).length, 10);
});
test('examples are optional and have no task side effects', async t => {
  const f = await httpFixture(t);
  for (const name of ['research', 'checks', 'stages', 'waiting', 'complete', 'unknown']) {
    assert.equal((await fetch(`${f.config.baseUrl}/demo/${name}`)).status, 200);
  }
  assert.equal((await f.service.slots()).filter(x => x.occupied).length, 0);
});

test('requested theme changes saved content at the exact same URL', async t => {
  const { client } = await httpFixture(t), b = await payload(), r = await client.create(b);
  assert.match(await (await fetch(r.viewUrl)).text(), /data-card-theme="dark"/);
  const light = await client.update(r.id, { requestId: 'theme-light', expectedRevision: r.revision, content: { ...r.content, theme: 'light' } });
  assert.equal(light.viewUrl, r.viewUrl);
  assert.match(await (await fetch(r.viewUrl)).text(), /data-card-theme="light"/);
  const dark = await client.update(r.id, { requestId: 'theme-dark', expectedRevision: light.revision, content: { ...light.content, theme: 'dark' } });
  assert.equal(dark.viewUrl, r.viewUrl);
  assert.match(await (await fetch(r.viewUrl)).text(), /data-card-theme="dark"/);
});
