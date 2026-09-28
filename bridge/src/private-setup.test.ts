import { afterEach, describe, expect, test } from 'bun:test';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, lstatSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { assertPrivateFile, atomicPrivateWrite, ensureInstancePaths, resolveInstancePaths } from '../../shared/instance-paths.mjs';
import { loadConfig, parseBridgeEnv } from './config.ts';
import { CORE_ROLES, acquireSetupLock, initializeSetup, preserveBridgeCredentials, readInstanceDocument, readSetupInput, recoverSetupLock, runAuthorizedSetupStep, withSetupSession } from './setup-state.ts';
import { inspectTrackedPrivateFiles, preflight, verifySqliteBuild } from './preflight.ts';
import { inspectPrivacy, privacyError, pruneInstance } from './privacy.ts';
import { parseLiveMiniEnv } from './setup-verification.ts';
import { exportInstance } from './export-instance.ts';

const roots: string[] = [];
const envText = '# synthetic only\nSPECTRUM_PROJECT_ID=synthetic-project\nSPECTRUM_PROJECT_SECRET="synthetic-secret"\nAUTHORIZED_SENDER_ID=+15555550199\nGROK_ORCHESTRATOR_WEBHOOK_URL=https://example.invalid/wake?k=synthetic-key\nGROK_ORCHESTRATOR_WEBHOOK_KEY=synthetic-bearer\n';
function fresh() {
  const parent = mkdtempSync(join(realpathSync(tmpdir()), 'photon private tests ')); roots.push(parent);
  const paths = resolveInstancePaths({ instanceDir: join(parent, 'instance with spaces'), env: { PHOTON_TEST_MODE: '1' }, testMode: true });
  ensureInstancePaths(paths); return paths;
}
function seeded() { const paths = fresh(); initializeSetup(paths, { authorized: true }); preserveBridgeCredentials(paths, envText); return paths; }
function fakeStore(paths: ReturnType<typeof fresh>) {
  return { installationId: readInstanceDocument(paths).installationId, acknowledgePrunedArtifacts: (_: string[]) => {}, privacySnapshot: () => ({ events: 3, outbound: 3, unresolved: 2, prunableEvents: 1, prunableOutbound: 1 }), pruneResolvedBefore: (_: any) => ({ events: 1, outbound: 1, artifactPaths: [] as string[] }), backupTo: (path: string) => atomicPrivateWrite(path, 'synthetic database snapshot') };
}
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe('P01-P05 canonical private boundaries', () => {
  test('P01/P02/P03 repository rules ignore private forms, keep examples, and identify separately tracked secrets', () => {
    const paths = fresh(), repo = join(paths.root, 'synthetic-repo'); mkdirSync(repo, { mode: 0o700 });
    execFileSync('git', ['init', '-q', repo]);
    const source = resolve(import.meta.dir, '../..');
    writeFileSync(join(repo, '.gitignore'), readFileSync(join(source, '.gitignore')));
    mkdirSync(join(repo, 'bridge')); writeFileSync(join(repo, 'bridge', '.gitignore'), readFileSync(join(source, 'bridge/.gitignore')));
    for (const name of ['prod.env', '.env', '.env.bak', 'bridge/.env', 'bridge/.env.bak', 'live-mini/secrets/prod.env', 'live-mini/runtime/state/task.json']) {
      const result = spawnSync('git', ['-C', repo, 'check-ignore', '--no-index', '-q', name]); expect(result.status).toBe(0);
    }
    for (const name of ['.env.example', 'bridge/.env.example', 'bridge/data/.gitkeep']) expect(spawnSync('git', ['-C', repo, 'check-ignore', '--no-index', '-q', name]).status).toBe(1);
    writeFileSync(join(repo, '.env'), 'DO_NOT_PRINT=seed-secret'); execFileSync('git', ['-C', repo, 'add', '-f', '.env']);
    expect(inspectTrackedPrivateFiles(repo)).toEqual({ trackedPrivateFiles: ['.env'], ignoredRulesDoNotUntrack: true });
    expect(execFileSync('git', ['-C', repo, 'ls-files', '.env'], { encoding: 'utf8' }).trim()).toBe('.env');
  });
  test('P04 private root and file modes; resolution is side-effect free; path spaces work', () => {
    const paths = fresh();
    expect(lstatSync(paths.root).mode & 0o777).toBe(0o700);
    atomicPrivateWrite(paths.bridgeEnv, envText); expect(lstatSync(paths.bridgeEnv).mode & 0o777).toBe(0o600);
    expect(assertPrivateFile(paths.bridgeEnv, paths.root)).toBe(paths.bridgeEnv);
    const next = resolveInstancePaths({ env: { PHOTON_TEST_MODE: '1' }, instanceDir: join(roots.at(-1)!, 'not-created') }); expect(existsSync(next.root)).toBe(false);
  });
  test('P05 rejects traversal, symlinks, checkout paths, conflicting instances, default/live test paths and missing guard', () => {
    const paths = fresh(), other = fresh();
    const options = { env: { PHOTON_TEST_MODE: '1' } };
    expect(() => resolveInstancePaths({ ...options, instanceDir: `${paths.root}/../escape` })).toThrow('INSTANCE_PATH_INVALID');
    const link = join(roots[0]!, 'linked'); symlinkSync(other.root, link); expect(() => resolveInstancePaths({ ...options, instanceDir: link })).toThrow('INSTANCE_SYMLINK_REJECTED');
    expect(() => resolveInstancePaths({ ...options, instanceDir: join(import.meta.dir, 'state') })).toThrow('INSTANCE_CHECKOUT_OVERLAP');
    expect(() => resolveInstancePaths({ env: { PHOTON_TEST_MODE: '1', PHOTON_INSTANCE_DIR: other.root }, instanceDir: paths.root })).toThrow('INSTANCE_ROOT_CONFLICT');
    expect(() => resolveInstancePaths(options)).toThrow('TEST_INSTANCE_REQUIRED');
    expect(() => resolveInstancePaths({ ...options, instanceDir: '/workspace/photongrokbot-state' })).toThrow('TEST_PRODUCTION_PATH_REJECTED');
    expect(() => resolveInstancePaths({ env: {}, testMode: true, instanceDir: paths.root })).toThrow('TEST_GUARD_REQUIRED');
    atomicPrivateWrite(other.bridgeEnv, envText); expect(() => assertPrivateFile(other.bridgeEnv, paths.root)).toThrow('PRIVATE_FILE_OUTSIDE_INSTANCE');
  });
});

describe('S01-S05 resumable setup', () => {
  test('S02 private file wins stale exports; parsing never mutates env or chmods diagnostic reads', () => {
    const paths = seeded(), original = process.env.SPECTRUM_PROJECT_SECRET;
    process.env.SPECTRUM_PROJECT_SECRET = 'stale-shell-secret';
    try { expect(loadConfig({ paths }).projectSecret).toBe('synthetic-secret'); expect(process.env.SPECTRUM_PROJECT_SECRET).toBe('stale-shell-secret'); }
    finally { if (original === undefined) delete process.env.SPECTRUM_PROJECT_SECRET; else process.env.SPECTRUM_PROJECT_SECRET = original; }
    expect(preserveBridgeCredentials(paths, envText)).toBe('preserved'); expect(readFileSync(paths.bridgeEnv, 'utf8')).toBe(envText);
    expect(() => preserveBridgeCredentials(paths, envText.replace('synthetic-secret', 'different-secret'))).toThrow('SETUP_CREDENTIAL_CONFLICT');
    chmodSync(paths.bridgeEnv, 0o644); expect(() => loadConfig({ paths })).toThrow('CONFIG_PRIVATE_FILE_UNAVAILABLE'); expect(lstatSync(paths.bridgeEnv).mode & 0o777).toBe(0o644);
  });
  test('S02 missing/duplicate/arbitrary fields fail with redacted codes', () => {
    expect(() => parseBridgeEnv(envText + 'SPECTRUM_PROJECT_SECRET=second-secret\n')).toThrow('CONFIG_DUPLICATE_SPECTRUM_PROJECT_SECRET');
    expect(() => parseBridgeEnv(envText.replace('SPECTRUM_PROJECT_ID=synthetic-project\n', ''))).toThrow('CONFIG_MISSING_SPECTRUM_PROJECT_ID');
    expect(() => parseBridgeEnv(envText + 'PATH=malicious-value')).toThrow('CONFIG_UNKNOWN_OR_INVALID_FIELD');
    expect(() => parseBridgeEnv(envText.replace('https://', 'http://'))).toThrow('CONFIG_INVALID_GROK_ORCHESTRATOR_WEBHOOK_URL');
  });
  test('S01 interruption after every core creation reconciles original identity without duplicate creation or key rotation', async () => {
    const paths = seeded(); let creates = 0;
    for (const resource of ['spectrum-project', ...CORE_ROLES, 'owner-binding', 'wake-routine', 'bridge-config', 'moonshine'] as const) {
      let remote: { resourceId: string; verified: true } | undefined;
      await expect(withSetupSession(paths, session => runAuthorizedSetupStep(session, resource, { verify: async () => remote, create: async () => { creates++; remote = { resourceId: `existing-${resource}`, verified: true }; throw new Error('lost response'); } }))).rejects.toThrow('SETUP_RESOURCE_OUTCOME_UNKNOWN');
      await withSetupSession(paths, session => runAuthorizedSetupStep(session, resource, { verify: async () => remote, create: async () => { throw new Error('DUPLICATE_CREATION'); } }));
      await withSetupSession(paths, session => runAuthorizedSetupStep(session, resource, { verify: async () => remote, create: async () => { throw new Error('DUPLICATE_CREATION'); } }));
    }
    expect(creates).toBe(11); expect(readFileSync(paths.bridgeEnv, 'utf8')).toBe(envText);
    expect(await withSetupSession(paths, session => session.status().fullSetupComplete)).toBe(true);
  });
  test('S01 intent-only crash refuses blind recreation; setup lock excludes a separate process', async () => {
    const paths = seeded();
    await withSetupSession(paths, session => session.intent('spectrum-project'));
    await expect(withSetupSession(paths, session => runAuthorizedSetupStep(session, 'spectrum-project', { verify: async () => undefined, create: async () => { throw new Error('MUST_NOT_CREATE'); } }))).rejects.toThrow('SETUP_RESOURCE_RECONCILIATION_REQUIRED');
    const release = acquireSetupLock(paths);
    try {
      const script = `import {resolveInstancePaths} from ${JSON.stringify(resolve(import.meta.dir, '../../shared/instance-paths.mjs'))}; import {acquireSetupLock} from ${JSON.stringify(join(import.meta.dir, 'setup-state.ts'))}; try { acquireSetupLock(resolveInstancePaths()); process.exit(2); } catch(e) { console.log(e.message); }`;
      const result = spawnSync(process.execPath, ['--eval', script], { env: { ...process.env, PHOTON_TEST_MODE: '1', PHOTON_INSTANCE_DIR: paths.root }, encoding: 'utf8' });
      expect(result.status).toBe(0); expect(result.stdout.trim()).toBe('SETUP_LOCK_HELD_OR_UNAVAILABLE');
    } finally { release(); }
  });
  test('S04 Live Mini requires explicit enablement and deployment requires the recorded environment revision', async () => {
    const paths = seeded();
    await withSetupSession(paths, session => {
      expect(session.status().liveMiniEnabled).toBe(false); expect(() => session.intent('live-project')).toThrow('LIVE_MINI_AUTHORIZATION_REQUIRED');
      session.authorizeLiveMini(true);
      const project = session.intent('live-project'); session.receipt('live-project', project.operationId, { resourceId: 'project-one', verified: true });
      expect(() => session.intent('live-deployment', 'rev-one')).toThrow('LIVE_ENVIRONMENT_NOT_READY');
      const env = session.intent('live-env', 'rev-one'); session.receipt('live-env', env.operationId, { resourceId: 'project-one-env', verified: true, environmentRevision: 'rev-one' });
      const deploy = session.intent('live-deployment', 'rev-one'); session.receipt('live-deployment', deploy.operationId, { resourceId: 'deployment-one', verified: true });
      expect(() => session.intent('live-deployment', 'rev-two')).toThrow('LIVE_ENVIRONMENT_REVISION_REQUIRED');
      expect(session.intent('live-project').resourceId).toBe('project-one');
    });
  });
  test('S05 all six roles and mandatory Moonshine; later media failure preserves working text', async () => {
    const paths = seeded(); expect(CORE_ROLES).toHaveLength(6);
    await withSetupSession(paths, session => {
      for (const resource of ['spectrum-project', ...CORE_ROLES, 'owner-binding', 'wake-routine', 'bridge-config'] as const) { const record = session.intent(resource); session.receipt(resource, record.operationId, { resourceId: `id-${resource}`, verified: true }); }
      expect(session.status().textReady).toBe(true); expect(session.status().fullSetupComplete).toBe(false);
      const moonshine = session.intent('moonshine'); session.receipt('moonshine', moonshine.operationId, { resourceId: 'model-fingerprint', verified: true }); expect(session.status().fullSetupComplete).toBe(true);
      session.mediaFailed(); expect(session.status().textReady).toBe(true); expect(session.status().textEverReady).toBe(true); expect(session.status().fullSetupComplete).toBe(false);
    });
  });
});

describe('P06-P08 privacy and R01-R02 recovery', () => {
  test('P06 diagnostics and inspections omit seeded secret, bodies and capability URL', () => {
    const paths = seeded(), store = fakeStore(paths);
    const output = JSON.stringify({ inspection: inspectPrivacy(paths, store), doctor: preflight({ paths }), error: privacyError(new Error('body secret https://example.invalid/?k=secret')) });
    for (const secret of ['synthetic-secret', 'synthetic-bearer', 'synthetic-key', 'body secret', '?k=secret']) expect(output).not.toContain(secret);
    expect(output).toContain('PRIVATE_OPERATION_FAILED');
  });
  test('P07/P08 retention previews first, keeps backups by default, uses store eligibility, and applies only matching plan', () => {
    const paths = seeded(), store = fakeStore(paths), now = Date.now(), asset = join(paths.inboundAttachmentsDir, 'resolved-asset');
    atomicPrivateWrite(asset, 'synthetic old body'); atomicPrivateWrite(join(paths.backupsDir, 'retained-backup'), 'synthetic private backup');
    const calls: any[] = [];
    store.pruneResolvedBefore = options => { calls.push(options); return { events: 1, outbound: 0, artifactPaths: [asset] }; };
    const plan = pruneInstance(paths, store, { now }); expect(existsSync(asset)).toBe(true); expect(plan.applied).toBe(false);
    expect(() => pruneInstance(paths, store, { now, apply: true })).toThrow('PRIVACY_PREVIEW_REQUIRED_OR_CHANGED');
    expect(pruneInstance(paths, store, { now, apply: true, planId: plan.planId }).applied).toBe(true);
    expect(existsSync(asset)).toBe(false); expect(existsSync(join(paths.backupsDir, 'retained-backup'))).toBe(true);
    expect(calls.at(-1)).toEqual({ resolvedBefore: now - 30 * 86400000, intermediateBefore: now - 7 * 86400000, intermediatePaths: [], apply: true });
  });
  test('P08 scope mismatch and symlinks reject before any data mutation', () => {
    const paths = seeded(), other = seeded(), store = fakeStore(paths);
    expect(() => pruneInstance(other, store)).toThrow('PRIVACY_INSTANCE_CONFLICT');
    const link = join(paths.inboundAttachmentsDir, 'escape'); symlinkSync(other.bridgeEnv, link);
    store.pruneResolvedBefore = () => ({ events: 1, outbound: 0, artifactPaths: [link] });
    expect(() => pruneInstance(paths, store)).toThrow('SYMLINK_REJECTED');
    expect(() => exportInstance(paths, store)).toThrow('PRIVACY_SYMLINK_REJECTED'); expect(existsSync(other.bridgeEnv)).toBe(true);
  });
  test('P08 export is explicit, private, excludes credentials, and reports no raw private content', () => {
    const paths = seeded(), store = fakeStore(paths); atomicPrivateWrite(join(paths.inboundAttachmentsDir, 'body.bin'), 'seeded-message-body');
    const plan = exportInstance(paths, store); expect(plan.applied).toBe(false);
    expect(() => exportInstance(paths, store, { apply: true })).toThrow('PRIVACY_PREVIEW_REQUIRED_OR_CHANGED');
    const result = exportInstance(paths, store, { apply: true, planId: plan.planId }); expect(result.applied).toBe(true);
    expect(JSON.stringify(result)).not.toContain('seeded-message-body'); expect(JSON.stringify(result)).not.toContain('synthetic-secret');
    const destination = join(paths.backupsDir, `export-${(result as any).exportId}`); expect(lstatSync(destination).mode & 0o777).toBe(0o700); expect(existsSync(join(destination, 'secrets'))).toBe(false);
    expect(readFileSync(join(destination, 'data/inbound-attachments/body.bin'), 'utf8')).toBe('seeded-message-body');
  });
  test('R01 identity survives restart and missing established identity fails closed', async () => {
    const paths = seeded(), first = readInstanceDocument(paths).installationId;
    expect(initializeSetup(paths, { authorized: true }).installationId).toBe(first);
    atomicPrivateWrite(paths.databasePath, 'synthetic existing database'); rmSync(paths.configPath);
    expect(() => initializeSetup(paths, { authorized: true })).toThrow('INSTANCE_IDENTITY_RECOVERY_REQUIRED');
    expect(preflight({ paths }).ok).toBe(false);
  });
  test('R02 missing persistent instance and unsupported SQLite fail closed', () => {
    const paths = fresh(); rmSync(paths.root, { recursive: true }); expect(preflight({ paths }).checks[0]?.code).toBe('PERSISTENT_INSTANCE_MISSING');
    const facts = { version: '3.51.2', sourceId: `2026-03-01 00:00:00 ${'a'.repeat(64)}`, journalMode: 'wal', filesystemVerified: true };
    expect(() => verifySqliteBuild(facts)).toThrow('SQLITE_BUILD_UNVERIFIED');
    expect(() => verifySqliteBuild({ ...facts, version: '3.51.3', filesystemVerified: false })).toThrow('SQLITE_FILESYSTEM_VERIFICATION_REQUIRED');
    expect(() => verifySqliteBuild({ ...facts, version: '3.51.3' })).not.toThrow();
  });
});


describe('setup and privacy recovery edges', () => {
  test('S01 setup JSON stdin is bounded while reading, cancels overflow and accepts split chunks', async () => {
    let cancelled = false;
    const tooLarge = new ReadableStream<Uint8Array>({ pull(controller) { controller.enqueue(new Uint8Array(33 * 1024)); }, cancel() { cancelled = true; } });
    await expect(readSetupInput(tooLarge)).rejects.toThrow('SETUP_INPUT_TOO_LARGE'); expect(cancelled).toBe(true);
    expect(await readSetupInput(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('{')); controller.enqueue(new TextEncoder().encode('}')); controller.close(); } }))).toBe('{}');
  });
  test('S01 SIGKILL leaves setup lock; explicit dead-owner preview recovers without touching checkpoint', async () => {
    const paths = seeded(), identity = readInstanceDocument(paths).installationId;
    const script = `import {resolveInstancePaths} from ${JSON.stringify(resolve(import.meta.dir, '../../shared/instance-paths.mjs'))}; import {acquireSetupLock} from ${JSON.stringify(join(import.meta.dir, 'setup-state.ts'))}; acquireSetupLock(resolveInstancePaths()); console.log('LOCKED'); setInterval(()=>{},1000);`;
    const child = spawn(process.execPath, ['--eval', script], { env: { ...process.env, PHOTON_TEST_MODE: '1', PHOTON_INSTANCE_DIR: paths.root }, stdio: ['ignore', 'pipe', 'pipe'] });
    await new Promise<void>((resolve, reject) => { const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('test lock startup timed out')); }, 5000); child.stdout.once('data', () => { clearTimeout(timer); resolve(); }); child.once('error', reject); });
    expect(() => recoverSetupLock(paths)).toThrow('SETUP_LOCK_OWNER_ALIVE');
    const exited = new Promise(resolve => child.once('exit', resolve)); child.kill('SIGKILL'); await exited;
    const preview = recoverSetupLock(paths); expect(preview.applied).toBe(false);
    expect(() => recoverSetupLock(paths, { apply: true })).toThrow('SETUP_LOCK_RECOVERY_PREVIEW_REQUIRED');
    expect(recoverSetupLock(paths, { apply: true, nonce: preview.nonce }).applied).toBe(true);
    expect(readInstanceDocument(paths).installationId).toBe(identity); acquireSetupLock(paths)();
  });
  test('S04 Live Mini env preserves keys and public URL, has no implicit enable, detects changed environment', async () => {
    const paths = seeded(), text = 'PUBLIC_BASE_URL=https://example.invalid\nPUBLISHER_TOKEN=synthetic-publisher\n';
    await withSetupSession(paths, session => {
      expect(() => session.writeLiveEnvironment(text)).toThrow('LIVE_MINI_AUTHORIZATION_REQUIRED');
      session.authorizeLiveMini(true); const first = session.writeLiveEnvironment(text); expect(first.environmentRevision).toHaveLength(64);
      expect(session.writeLiveEnvironment(text)).toEqual(first);
      expect(() => session.writeLiveEnvironment(text.replace('synthetic-publisher', 'new-key'))).toThrow('LIVE_ENV_CONFLICT_REDEPLOY_REVIEW_REQUIRED');
      expect(readFileSync(paths.liveMiniEnv, 'utf8')).toBe(text);
    });
    expect(() => parseLiveMiniEnv(text + 'UNKNOWN_FIELD=secret')).toThrow('LIVE_ENV_INVALID_FIELD');
  });
  test('P08 explicit delete-resolved keeps unresolved rows and backup policy is whole-snapshot rotation', () => {
    const paths = seeded(), store = fakeStore(paths), now = Date.now(), old = (now - 40 * 86400000) / 1000;
    for (let i = 0; i < 4; i++) {
      const folder = join(paths.backupsDir, `backup-${i}`); mkdirSync(folder, { mode: 0o700 });
      for (const name of ['database', 'manifest']) { const path = join(folder, name); atomicPrivateWrite(path, 'synthetic-backup-data'); utimesSync(path, old + i, old + i); }
      utimesSync(folder, old + i, old + i);
    }
    const calls: any[] = []; store.pruneResolvedBefore = options => { calls.push(options); return { events: 0, outbound: 0, artifactPaths: [] }; };
    const plan = pruneInstance(paths, store, { now, deleteResolved: true, includeBackups: true });
    expect(plan.ancillaryFiles).toBe(2); expect(plan.mode).toBe('delete-resolved');
    pruneInstance(paths, store, { now, deleteResolved: true, includeBackups: true, apply: true, planId: plan.planId });
    expect(existsSync(join(paths.backupsDir, 'backup-0'))).toBe(false); expect(existsSync(join(paths.backupsDir, 'backup-1/database'))).toBe(true);
    expect(calls.at(-1)).toEqual({ resolvedBefore: now, intermediateBefore: now, intermediatePaths: [], apply: true }); expect(inspectPrivacy(paths, store).unresolved).toBe(2);
  });
});


test('Live Mini setup rejects a path-bearing publisher origin', () => {
  expect(() => parseLiveMiniEnv('PUBLIC_BASE_URL=https://host.test/suffix\nPUBLISHER_TOKEN=synthetic-private-value\n')).toThrow('LIVE_ENV_INVALID_URL');
  expect(parseLiveMiniEnv('PUBLIC_BASE_URL=https://host.test\nPUBLISHER_TOKEN=synthetic-private-value\n').PUBLIC_BASE_URL).toBe('https://host.test');
});
