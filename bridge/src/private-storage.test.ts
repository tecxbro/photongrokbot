import { afterEach, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { atomicPrivateWrite, ensureInstancePaths, resolveInstancePaths } from '../../shared/instance-paths.mjs';
import { CORE_ROLES, assertRuntimeReady, initializeSetup, initializeStorage, readInstanceDocument, withSetupSession } from './setup-state.ts';
import { openStore } from './storage.ts';
import { pruneInstance } from './privacy.ts';

const cleanup: (() => void)[] = [];
afterEach(() => { for (const fn of cleanup.splice(0).reverse()) fn(); });
async function fixture() {
  const root = mkdtempSync(join(realpathSync(tmpdir()), 'photon privacy database '));
  const paths = resolveInstancePaths({ instanceDir: root, testMode: true, env: { PHOTON_TEST_MODE: '1' } });
  ensureInstancePaths(paths); initializeSetup(paths, { authorized: true }); await initializeStorage(paths);
  const store = openStore({ paths }); cleanup.push(() => { store.close(); rmSync(root, { recursive: true, force: true }); }); return { paths, store };
}
function completed(store: ReturnType<typeof openStore>, paths: ReturnType<typeof resolveInstancePaths>, name: string, unknown = false) {
  const destination = { spaceId: `space-${name}`, lineId: 'line-synthetic' }, id = `event-${name}`;
  const asset = join(paths.inboundAttachmentsDir, `${name}.bin`); atomicPrivateWrite(asset, 'synthetic private attachment');
  const record = { id, spaceId: destination.spaceId, senderId: 'synthetic-owner', text: 'synthetic private body', timestamp: new Date().toISOString(), receivedAt: new Date().toISOString(), attachmentPath: asset };
  store.accept({ eventKey: id, record, destination });
  const batch = store.formBatches().find(batch => batch.messages.some(message => message.id === id))!;
  const claim = store.claimBatch(batch.batchId); if (claim.status !== 'acquired') throw new Error('fixture failed');
  const out = store.enqueue({ kind: 'text', spaceId: destination.spaceId, text: 'synthetic private reply' }, { actionKey: `answer-${name}`, destination, purpose: 'final', claim: claim.token });
  const attempt = store.claimOutbound(); if (!attempt) throw new Error('fixture no outbound');
  store.settleOutbound(attempt.item.id, attempt.attemptId, unknown ? { state: 'unknown', code: 'SYNTHETIC_TIMEOUT' } : { state: 'accepted', evidence: 'synthetic mocked acceptance', reference: { messageId: `provider-${name}` } });
  store.completeClaim(claim.token);
  return { batch, out, record, destination, id, asset };
}

test('R01 setup initializes DB once, uses DB checkpoint after bootstrap, preserves identity across restart', async () => {
  const { paths, store } = await fixture(), identity = store.installationId;
  expect(readInstanceDocument(paths).database).toEqual({ status: 'ready' });
  await withSetupSession(paths, session => { const record = session.intent('spectrum-project'); session.receipt('spectrum-project', record.operationId, { resourceId: 'synthetic-project', verified: true }); }, store);
  expect(readInstanceDocument(paths).setup.resources['spectrum-project']).toBeUndefined();
  expect(await withSetupSession(paths, session => session.status().resources['spectrum-project'], store)).toBe('verified');
  await initializeStorage(paths); expect(readInstanceDocument(paths).installationId).toBe(identity);
});

test('R01 initialized DB loss refuses recreation even with explicit setup rerun', async () => {
  const { paths, store } = await fixture(); store.close(); rmSync(paths.databasePath);
  await expect(initializeStorage(paths)).rejects.toThrow('INSTANCE_DATABASE_RECOVERY_REQUIRED');
  expect(() => initializeSetup(paths, { authorized: true })).toThrow('INSTANCE_DATABASE_RECOVERY_REQUIRED'); expect(existsSync(paths.databasePath)).toBe(false);
});

test('P07 actual SQLite prunes resolved data, retains unknown bodies/assets and dedupe identities', async () => {
  const { paths, store } = await fixture(), done = completed(store, paths, 'done'), uncertain = completed(store, paths, 'unknown', true);
  const now = Date.now(), old = now - 40 * 86400000;
  store.db.query('UPDATE batches SET completed_at=?').run(old); store.db.query('UPDATE outbound SET settled_at=?').run(old);
  const plan = pruneInstance(paths, store, { now }); expect(plan.events).toBe(1); expect(plan.outbound).toBe(1); expect(existsSync(done.asset)).toBe(true);
  pruneInstance(paths, store, { now, apply: true, planId: plan.planId });
  expect(existsSync(done.asset)).toBe(false); expect(existsSync(uncertain.asset)).toBe(true);
  expect(store.readBatch(uncertain.batch.batchId).messages[0]?.text).toBe('synthetic private body');
  expect(store.readBatch(done.batch.batchId).messages[0]?.text).not.toBe('synthetic private body');
  expect(store.accept({ eventKey: done.id, record: done.record, destination: done.destination }).duplicate).toBe(true);
  expect(store.outboundStatus(uncertain.out[0]!.id)?.state).toBe('unknown');
});

test('P07 cleanup after DB commit interruption recovers same pending asset instead of orphaning it', async () => {
  const { paths, store } = await fixture(), done = completed(store, paths, 'crash');
  const now = Date.now(), old = now - 40 * 86400000;
  store.db.query('UPDATE batches SET completed_at=?').run(old); store.db.query('UPDATE outbound SET settled_at=?').run(old);
  const interrupted = store.pruneResolvedBefore({ resolvedBefore: now - 30 * 86400000, intermediateBefore: now - 7 * 86400000, apply: true });
  expect(interrupted.artifactPaths).toContain(done.asset); expect(existsSync(done.asset)).toBe(true);
  const plan = pruneInstance(paths, store, { now }); expect(plan.events).toBe(0); expect(plan.assets).toBe(1);
  pruneInstance(paths, store, { now, apply: true, planId: plan.planId }); expect(existsSync(done.asset)).toBe(false);
  expect(pruneInstance(paths, store, { now }).assets).toBe(0);
});

test('P07 expired owned crash intermediates use 7-day policy; arbitrary private assets remain', async () => {
  const { paths, store } = await fixture(), now = Date.now();
  const directory = join(paths.inboundAttachmentsDir, `media-job-${'a'.repeat(24)}-${crypto.randomUUID()}`); mkdirSync(directory, { mode: 0o700 });
  const temporary = join(directory, `.${crypto.randomUUID()}.partial.wav`), arbitrary = join(paths.inboundAttachmentsDir, 'do-not-guess.wav');
  for (const path of [temporary, arbitrary]) { atomicPrivateWrite(path, 'synthetic media'); const old = (now - 8 * 86400000) / 1000; utimesSync(path, old, old); }
  const plan = pruneInstance(paths, store, { now }); expect(plan.assets).toBe(1);
  pruneInstance(paths, store, { now, apply: true, planId: plan.planId }); expect(existsSync(temporary)).toBe(false); expect(readFileSync(arbitrary, 'utf8')).toBe('synthetic media');
});


test('S03 private setup, doctor, prune and export entrypoints share the explicit instance with leading separator', async () => {
  const { paths } = await fixture();
  atomicPrivateWrite(paths.bridgeEnv, 'SPECTRUM_PROJECT_ID=synthetic-project\nSPECTRUM_PROJECT_SECRET=synthetic-secret\nAUTHORIZED_SENDER_ID=+15555550199\nGROK_ORCHESTRATOR_WEBHOOK_URL=https://example.invalid/wake\nGROK_ORCHESTRATOR_WEBHOOK_KEY=synthetic-key\n');
  for (const [file, ...args] of [['setup-state.ts', 'status'], ['preflight.ts'], ['prune-instance.ts', '--inspect'], ['export-instance.ts']]) {
    const result = spawnSync(process.execPath, ['run', join(import.meta.dir, file!), '--', ...args], { env: { ...process.env, PHOTON_TEST_MODE: '1', PHOTON_INSTANCE_DIR: paths.root }, encoding: 'utf8', timeout: 10000 });
    expect(result.status).toBe(0); expect(result.stderr).toBe(''); expect(result.stdout).not.toContain('synthetic-secret'); expect(() => JSON.parse(result.stdout)).not.toThrow();
  }
});


test('S05 runtime gates first setup on six roles and Moonshine proof, later media failure leaves text ready', async () => {
  const { paths, store } = await fixture();
  expect(() => assertRuntimeReady(paths, store)).toThrow('SETUP_CORE_AND_MOONSHINE_REQUIRED');
  await withSetupSession(paths, session => {
    for (const resource of ['spectrum-project', ...CORE_ROLES, 'owner-binding', 'wake-routine', 'bridge-config'] as const) { const operation = session.intent(resource); session.receipt(resource, operation.operationId, { resourceId: `synthetic-${resource}`, verified: true }); }
  }, store);
  expect(() => assertRuntimeReady(paths, store)).toThrow('SETUP_CORE_AND_MOONSHINE_REQUIRED');
  await withSetupSession(paths, session => { const operation = session.intent('moonshine'); session.receipt('moonshine', operation.operationId, { resourceId: 'synthetic-model-manifest', verified: true }); }, store);
  expect(assertRuntimeReady(paths, store)).toEqual({ ready: true, mediaDegraded: false });
  await withSetupSession(paths, session => session.mediaFailed(), store);
  expect(assertRuntimeReady(paths, store)).toEqual({ ready: true, mediaDegraded: true });
});
