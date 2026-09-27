import test from 'node:test';
import assert from 'node:assert/strict';
import { RedisStore, CAS_SCRIPT } from '../src/store.mjs';
import { CardService } from '../src/service.mjs';
import { config, payload } from './helpers.mjs';

// A boundary double, NOT a running Redis/Lua service. Remote EVAL needs a deployment smoke test.
function restDouble() {
  const database = new Map(); const commands = [];
  return {
    database, commands,
    async fetch(url, options) {
      const args = JSON.parse(options.body); commands.push(args);
      assert.equal(options.redirect, 'error'); assert.match(options.headers.Authorization, /^Bearer /);
      let result;
      if (args[0] === 'GET') result = database.get(args[1]) ?? null;
      else {
        assert.equal(args[0], 'EVAL'); assert.equal(args[1], CAS_SCRIPT); assert.equal(args[2], '1');
        const [, , , key, old, next] = args;
        const current = database.get(key) ?? '';
        if (current === old) { database.set(key, next); result = 1; } else result = 0;
      }
      return new Response(JSON.stringify({ result }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    },
  };
}
test('Redis REST adapter uses one atomic EVAL rather than plain SET', async () => {
  const api = restDouble(), store = new RedisStore({ url: 'https://redis.example.test', token: 'secret', key: 'test', fetchImpl: api.fetch });
  await new CardService(store, config()).create(await payload());
  assert.deepEqual(api.commands.map(c => c[0]), ['GET', 'EVAL']);
});
test('CAS retry resolves concurrent updates without lost slots', async () => {
  const api = restDouble(), b = await payload();
  const all = await Promise.all(Array.from({ length: 6 }, (_, i) => {
    const store = new RedisStore({ url: 'https://redis.example.test', token: 'secret', key: 'test', fetchImpl: api.fetch });
    return new CardService(store, config()).create({ ...b, requestId: `r-${i}`, taskId: `t-${i}` });
  }));
  assert.equal(new Set(all.map(r => r.slot)).size, 6);
});
test('storage/network failure remains an error, not a fresh empty pool', async () => {
  const store = new RedisStore({ url: 'https://redis.example.test', token: 'secret', key: 'test', fetchImpl: async () => { throw new Error('offline'); } });
  await assert.rejects(store.read(), { code: 'STORE_UNAVAILABLE' });
});
test('upstream error body cannot be mistaken for success', async () => {
  const store = new RedisStore({ url: 'https://redis.example.test', token: 'secret', key: 'test', fetchImpl: async () => new Response('{"error":"failure"}') });
  await assert.rejects(store.read(), { code: 'STORE_UNAVAILABLE' });
});
test('conflicts exhaust a bounded retry budget', async () => {
  const store = new RedisStore({ url: 'https://redis.example.test', token: 'secret', key: 'test', maxRetries: 1,
    fetchImpl: async (url, options) => new Response(JSON.stringify({ result: JSON.parse(options.body)[0] === 'GET' ? null : 0 })) });
  await assert.rejects(store.transaction(() => null), { code: 'STORE_BUSY' });
});
