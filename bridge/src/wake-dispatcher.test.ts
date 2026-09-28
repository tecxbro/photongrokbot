import { afterEach, describe, expect, test } from 'bun:test';
import { fixture, record } from './tests/storage/fixture.ts';
import { createWakeDispatcher, type WakeDispatcherOptions } from './wake-dispatcher.ts';
const cleanup: (() => void)[] = [];
afterEach(() => { for (const fn of cleanup.splice(0)) fn(); });
function setup() { const f = fixture(); cleanup.push(f.cleanup); f.store.accept({ eventKey: 'wake-event', record: record('wake-event'), destination: { spaceId: 'space-1', lineId: 'line-1' } }); const batch = f.store.formBatches()[0]!; return { ...f, batch }; }
const url = 'https://example.invalid/native-wake?k=synthetic-capability', key = 'synthetic-private-bearer';
function fakeFetch(fn: (input: Parameters<typeof fetch>[0], init?: RequestInit) => Promise<Response>): typeof fetch { return fn as typeof fetch; }
function dispatcher(store: WakeDispatcherOptions['store'], fetcher: typeof fetch, extra: Partial<WakeDispatcherOptions> = {}) { return createWakeDispatcher({ store, url, key, fetch: fetcher, random: () => 0, ...extra }); }

describe('bounded durable native wake dispatch', () => {
  test('W01 body is batchId only; diagnostics exclude credentials, URL and remote body', async () => {
    const { store, batch } = setup(); const requests: RequestInit[] = [], logs: unknown[] = [];
    const wake = dispatcher(store, fakeFetch(async (_input, init) => { requests.push(init!); return new Response('synthetic private remote body', { status: 202 }); }), { onStatus: item => logs.push(item) });
    await wake.drain(); expect(requests).toHaveLength(1); expect(JSON.parse(requests[0]!.body as string)).toEqual({ batchId: batch.batchId }); expect(new Headers(requests[0]!.headers).get('authorization')).toBe(`Bearer ${key}`); expect(requests[0]!.redirect).toBe('error');
    const output = JSON.stringify(logs); for (const value of [key, url, 'synthetic-capability', 'synthetic private remote body']) expect(output).not.toContain(value); expect(output).toContain('WAKE_ACKNOWLEDGED');
  });
  test('W02 ack is distinct from claim/completion; unclaimed original batch is recoverable after grace', async () => {
    const { store, batch } = setup(); let calls = 0;
    const wake = dispatcher(store, fakeFetch(async () => { calls++; return new Response(null, { status: 204 }); }));
    await wake.drain(); expect(store.claimSnapshot(batch.batchId).state).toBe('pending'); expect(store.claimWake(Date.now())).toBeUndefined();
    const retry = store.claimWake(Date.now() + 60001)!; expect(retry.batchId).toBe(batch.batchId); expect(retry.attempts).toBe(2); expect(calls).toBe(1);
  });
  test('W02 active/delegated unknown handoffs are not re-notified', async () => {
    const { store, batch } = setup(); let calls = 0;
    const wake = dispatcher(store, fakeFetch(async () => { calls++; return new Response(null, { status: 200 }); })); await wake.drain();
    const claim = store.claimBatch(batch.batchId); if (claim.status !== 'acquired') throw new Error('fixture claim failed');
    expect(store.claimWake(Date.now() + 60001)).toBeUndefined();
    const task = { taskId: 'task-held', batchId: batch.batchId, destination: { spaceId: 'space-1', lineId: 'line-1' }, owner: 'worker', finalOwner: 'front-door', state: 'intent' as const };
    store.bindTask(claim.token, task); store.bindTask(claim.token, { ...task, state: 'unknown' });
    expect(store.claimWake(Date.now() + 99999999)).toBeUndefined(); expect(calls).toBe(1);
  });
  test('W03 overlapping ticks have one physical request behind deterministic response barrier', async () => {
    const { store } = setup(); let finish!: (response: Response) => void, observed!: () => void, calls = 0;
    const entered = new Promise<void>(resolve => { observed = resolve; });
    const wake = dispatcher(store, fakeFetch(async () => { calls++; observed(); return new Promise(resolve => { finish = resolve; }); }));
    const first = wake.drain(), second = wake.drain(); expect(first).toBe(second); wake.notify(); await entered; expect(calls).toBe(1);
    finish(new Response(null, { status: 202 })); await first; await wake.drain(); expect(calls).toBe(1);
  });
  test('W03 timeout after possible remote acceptance aborts and retains bounded same-batch recovery', async () => {
    const { store, batch } = setup(); let accepted = 0, aborted = 0;
    const wake = dispatcher(store, fakeFetch(async (_input, init) => { accepted++; return new Promise((_resolve, reject) => { init!.signal!.addEventListener('abort', () => { aborted++; reject(new Error('secret URL failure details')); }); }); }), { timeoutMs: 10 });
    await wake.drain(); expect(accepted).toBe(1); expect(aborted).toBe(1);
    const row = store.db.query('SELECT state,code,next_at FROM wakes WHERE batch_id=?').get(batch.batchId) as any; expect(row.state).toBe('retry_wait'); expect(row.code).toBe('WAKE_TIMEOUT'); expect(row.next_at).toBeGreaterThan(Date.now()); expect(store.claimSnapshot(batch.batchId).state).toBe('pending');
  });
  test('W03 permanent rejection never retries and transient attempts exhaust', async () => {
    const first = setup(); let permanentCalls = 0;
    const rejected = dispatcher(first.store, fakeFetch(async () => { permanentCalls++; return new Response('secret remote body', { status: 403 }); })); await rejected.drain(); await rejected.drain(); expect(permanentCalls).toBe(1); expect(first.store.claimWake(Date.now() + 9999999)).toBeUndefined();
    const second = setup(); let transientCalls = 0, clock = Date.now();
    const transient = dispatcher(second.store, fakeFetch(async () => { transientCalls++; return new Response(null, { status: 503 }); }), { maxAttempts: 2, clock: () => clock }); await transient.drain(); clock += 10000; await transient.drain();
    expect(transientCalls).toBe(2); expect(second.store.db.query('SELECT state,code FROM wakes WHERE batch_id=?').get(second.batch.batchId)).toEqual({ state: 'failed', code: 'WAKE_ATTEMPTS_EXHAUSTED' });
  });
  test('W04 stop aborts/joins active attempt and leaves durable retry without later requests', async () => {
    const { store, batch } = setup(); let entered!: () => void, calls = 0; const barrier = new Promise<void>(resolve => { entered = resolve; });
    const wake = dispatcher(store, fakeFetch(async (_input, init) => { calls++; entered(); return new Promise((_resolve, reject) => init!.signal!.addEventListener('abort', () => reject(new Error('aborted')))); }));
    const running = wake.drain(); await barrier; await wake.stop(); await running; wake.notify(); await wake.drain(); expect(calls).toBe(1);
    expect(store.db.query('SELECT state,code FROM wakes WHERE batch_id=?').get(batch.batchId)).toEqual({ state: 'retry_wait', code: 'WAKE_SHUTDOWN' });
  });
  test('W02 local settlement failure after HTTP response preserves sending until startup recovery', async () => {
    const { store, batch } = setup(); let requests = 0;
    const wake = dispatcher({ claimWake: store.claimWake.bind(store), settleWake: () => { throw new Error('SYNTHETIC_STORAGE_FAILURE'); } }, fakeFetch(async () => { requests++; return new Response(null, { status: 202 }); }));
    await expect(wake.drain()).rejects.toThrow('SYNTHETIC_STORAGE_FAILURE'); expect(requests).toBe(1); expect((store.db.query('SELECT state FROM wakes WHERE batch_id=?').get(batch.batchId) as any).state).toBe('sending');
    expect(store.recoverWork().wakes).toBe(1); expect(store.claimWake()?.batchId).toBe(batch.batchId);
  });
  test('W02 expired abandoned claim is fenced and original batch wakes without new inbox/task', () => {
    const { store, batch } = setup(), claim = store.claimBatch(batch.batchId, 1000); if (claim.status !== 'acquired') throw new Error('fixture claim failed');
    const job = store.claimWake(Date.now() + 1001)!; expect(job.batchId).toBe(batch.batchId); expect(store.readBatch(batch.batchId).messages).toHaveLength(1);
    expect(() => store.renewClaim(claim.token)).toThrow(); expect(() => store.completeClaim(claim.token)).toThrow();
  });
});
