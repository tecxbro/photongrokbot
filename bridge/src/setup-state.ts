import { existsSync, lstatSync, mkdirSync, readFileSync, rmdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { hostname } from 'node:os';
import { assertPrivateFile, atomicPrivateWrite, ensureInstancePaths, resolveInstancePaths } from '../../shared/instance-paths.mjs';
import { BRIDGE_FIELDS, parseBridgeEnv } from './config.ts';
import { liveEnvironmentRevision, preserveLiveMiniCredentials, verifyMoonshineInstallation } from './setup-verification.ts';

type Paths = ReturnType<typeof resolveInstancePaths>;
export const CORE_ROLES = ['front-door', 'orchestrator', 'creator', 'feature-add', 'image-cards', 'app-sheet'] as const;
export const SETUP_RESOURCES = ['spectrum-project', ...CORE_ROLES, 'owner-binding', 'wake-routine', 'bridge-config', 'moonshine', 'live-project', 'live-env', 'live-deployment'] as const;
export type SetupResource = typeof SETUP_RESOURCES[number];
export type SetupRecord = { operationId: string; status: 'intent' | 'unknown' | 'verified' | 'failed'; resourceId?: string; verifiedAt?: number; code?: string; environmentRevision?: string; evidence?: { modelRevision: string; manifestSha256: string; packages: Record<string, string> } };
export type SetupState = { version: 1; authorizedAt?: number; liveMiniAuthorizedAt?: number; textEverReady?: boolean; fullEverReady?: boolean; resources: Partial<Record<SetupResource, SetupRecord>> };
export type InstanceDocument = { version: 1; installationId: string; setup: SetupState; [key: string]: unknown };
type SetupStore = { installationId: string; getMetadata<T>(kind: string, key: string): T | undefined; setMetadata(kind: string, key: string, value: unknown): void };
const idPattern = /^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,191}$/;
function invariant(ok: unknown, code: string): asserts ok { if (!ok) throw new Error(code); }
function resourceKey(key: string): asserts key is SetupResource { invariant(SETUP_RESOURCES.includes(key as SetupResource), 'SETUP_RESOURCE_INVALID'); }

export function readInstanceDocument(paths: Paths): InstanceDocument {
  let document: InstanceDocument;
  try {
    const file = assertPrivateFile(paths.configPath, paths.root);
    invariant(lstatSync(file).size <= 256 * 1024, 'INSTANCE_CONFIG_TOO_LARGE');
    document = JSON.parse(readFileSync(file, 'utf8'));
  } catch { throw new Error('INSTANCE_CONFIG_MISSING_OR_INVALID'); }
  invariant(document.version === 1 && /^[A-Za-z0-9_-]{8,128}$/.test(document.installationId), 'INSTANCE_IDENTITY_INVALID');
  invariant(document.setup?.version === 1 && document.setup.resources && typeof document.setup.resources === 'object', 'SETUP_STATE_INVALID');
  for (const [key, value] of Object.entries(document.setup.resources)) {
    resourceKey(key);
    invariant(value && idPattern.test(value.operationId) && ['intent', 'unknown', 'verified', 'failed'].includes(value.status), 'SETUP_STATE_INVALID');
    invariant(!value.resourceId || idPattern.test(value.resourceId), 'SETUP_STATE_INVALID');
    invariant(value.status !== 'verified' || value.resourceId, 'SETUP_STATE_INVALID');
  }
  return document;
}

/** No timer-based stealing. An abandoned lock requires explicit offline recovery. */
export function acquireSetupLock(paths: Paths): () => void {
  ensureInstancePaths(paths);
  const directory = join(paths.root, '.setup-lock');
  try { mkdirSync(directory, { mode: 0o700 }); } catch { throw new Error('SETUP_LOCK_HELD_OR_UNAVAILABLE'); }
  const ownerPath = join(directory, 'owner.json');
  const nonce = crypto.randomUUID();
  atomicPrivateWrite(ownerPath, JSON.stringify({ pid: process.pid, host: hostname(), nonce }));
  return () => {
    let owner;
    try { owner = JSON.parse(readFileSync(assertPrivateFile(ownerPath, directory), 'utf8')); } catch { throw new Error('SETUP_LOCK_OWNER_INVALID'); }
    invariant(owner.nonce === nonce, 'SETUP_LOCK_OWNER_CHANGED');
    unlinkSync(ownerPath); rmdirSync(directory);
  };
}

export function recoverSetupLock(paths: Paths, options: { apply?: boolean; nonce?: string } = {}) {
  const directory = join(paths.root, '.setup-lock'), ownerPath = join(directory, 'owner.json');
  const owner = JSON.parse(readFileSync(assertPrivateFile(ownerPath, paths.root), 'utf8'));
  invariant(owner.host === hostname() && Number.isSafeInteger(owner.pid) && owner.pid > 0 && typeof owner.nonce === 'string', 'SETUP_LOCK_OWNER_INVALID');
  let alive = true;
  try { process.kill(owner.pid, 0); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ESRCH') alive = false; else throw new Error('SETUP_LOCK_OWNER_UNVERIFIED'); }
  invariant(!alive, 'SETUP_LOCK_OWNER_ALIVE');
  if (!options.apply) return { recoverable: true, nonce: owner.nonce, applied: false };
  invariant(options.nonce === owner.nonce, 'SETUP_LOCK_RECOVERY_PREVIEW_REQUIRED');
  const again = JSON.parse(readFileSync(assertPrivateFile(ownerPath, paths.root), 'utf8'));
  invariant(again.nonce === owner.nonce && again.pid === owner.pid, 'SETUP_LOCK_OWNER_CHANGED');
  unlinkSync(ownerPath); rmdirSync(directory); return { recoverable: true, applied: true };
}

export function initializeSetup(paths: Paths, options: { authorized: boolean }): InstanceDocument {
  invariant(options.authorized, 'SETUP_AUTHORIZATION_REQUIRED');
  const release = acquireSetupLock(paths);
  try {
    if (existsSync(paths.configPath)) {
      const existing = readInstanceDocument(paths);
      invariant(!existing.database || existsSync(paths.databasePath), 'INSTANCE_DATABASE_RECOVERY_REQUIRED');
      return existing;
    }
    invariant(![paths.databasePath, paths.bridgeEnv, paths.liveMiniEnv].some(path => existsSync(path)), 'INSTANCE_IDENTITY_RECOVERY_REQUIRED');
    const document: InstanceDocument = { version: 1, installationId: crypto.randomUUID(), setup: { version: 1, authorizedAt: Date.now(), resources: {} } };
    atomicPrivateWrite(paths.configPath, JSON.stringify(document, null, 2) + '\n');
    return document;
  } finally { release(); }
}

export class SetupSession {
  readonly document: InstanceDocument;
  constructor(readonly paths: Paths, private readonly store?: SetupStore) {
    this.document = readInstanceDocument(paths);
    if (store) {
      invariant(store.installationId === this.document.installationId, 'INSTANCE_IDENTITY_CONFLICT');
      this.document.setup = store.getMetadata<SetupState>('setup', 'checkpoint') ?? this.document.setup;
    } else invariant(!existsSync(paths.databasePath), 'SETUP_STORE_REQUIRED');
  }
  private save() {
    if (this.store) this.store.setMetadata('setup', 'checkpoint', this.document.setup);
    else atomicPrivateWrite(this.paths.configPath, JSON.stringify(this.document, null, 2) + '\n');
  }
  authorizeLiveMini(explicit: boolean) {
    invariant(explicit, 'LIVE_MINI_AUTHORIZATION_REQUIRED');
    this.document.setup.liveMiniAuthorizedAt ??= Date.now(); this.save();
  }
  intent(key: SetupResource, environmentRevision?: string): SetupRecord {
    resourceKey(key);
    invariant(this.document.setup.authorizedAt, 'SETUP_AUTHORIZATION_REQUIRED');
    if (key.startsWith('live-')) invariant(this.document.setup.liveMiniAuthorizedAt, 'LIVE_MINI_AUTHORIZATION_REQUIRED');
    if (key === 'live-deployment') {
      invariant(this.document.setup.resources['live-project']?.status === 'verified' && this.document.setup.resources['live-env']?.status === 'verified', 'LIVE_ENVIRONMENT_NOT_READY');
      invariant(environmentRevision && this.document.setup.resources['live-env']?.environmentRevision === environmentRevision, 'LIVE_ENVIRONMENT_REVISION_REQUIRED');
    }
    const previous = this.document.setup.resources[key];
    if (previous) {
      if (environmentRevision && previous.environmentRevision !== environmentRevision) throw new Error('SETUP_ENVIRONMENT_CHANGED_REDEPLOY_REQUIRED');
      return { ...previous };
    }
    const record: SetupRecord = { operationId: crypto.randomUUID(), status: 'intent', ...(environmentRevision ? { environmentRevision } : {}) };
    this.document.setup.resources[key] = record; this.save(); return { ...record };
  }
  receipt(key: SetupResource, operationId: string, evidence: { resourceId: string; verified: true; environmentRevision?: string }) {
    resourceKey(key);
    const record = this.document.setup.resources[key];
    invariant(record && record.operationId === operationId, 'SETUP_OPERATION_CONFLICT');
    invariant(evidence.verified === true && idPattern.test(evidence.resourceId), 'SETUP_VERIFIED_EVIDENCE_REQUIRED');
    invariant(!record.resourceId || record.resourceId === evidence.resourceId, 'SETUP_RESOURCE_ID_CONFLICT');
    if (key === 'live-env') {
      invariant(evidence.environmentRevision && idPattern.test(evidence.environmentRevision), 'LIVE_ENVIRONMENT_REVISION_REQUIRED');
      record.environmentRevision = evidence.environmentRevision;
    }
    record.status = 'verified'; record.resourceId = evidence.resourceId; record.verifiedAt = Date.now(); delete record.code;
    if (this.status().textReady) this.document.setup.textEverReady = true;
    if (this.status().fullSetupComplete) this.document.setup.fullEverReady = true;
    this.save();
  }
  uncertain(key: SetupResource, operationId: string) {
    resourceKey(key); const record = this.document.setup.resources[key];
    invariant(record?.operationId === operationId, 'SETUP_OPERATION_CONFLICT');
    record.status = 'unknown'; record.code = 'RECONCILE_EXACT_RESOURCE'; this.save();
  }
  verifyMoonshine() {
    const record = this.intent('moonshine');
    try {
      const evidence = verifyMoonshineInstallation(this.paths);
      this.document.setup.resources.moonshine!.evidence = evidence;
      this.receipt('moonshine', record.operationId, { resourceId: evidence.manifestSha256, verified: true });
      return { verified: true };
    } catch { this.mediaFailed(); throw new Error('MOONSHINE_VERIFICATION_FAILED'); }
  }
  writeLiveEnvironment(text: string) {
    invariant(this.document.setup.liveMiniAuthorizedAt, 'LIVE_MINI_AUTHORIZATION_REQUIRED');
    const result = preserveLiveMiniCredentials(this.paths, text);
    return result;
  }
  mediaFailed() {
    const record = this.document.setup.resources.moonshine;
    invariant(record, 'MOONSHINE_INTENT_REQUIRED'); record.status = 'failed'; record.code = 'MOONSHINE_VERIFICATION_FAILED'; this.save();
  }
  status() {
    const resources = this.document.setup.resources;
    const textReady = ['spectrum-project', ...CORE_ROLES, 'owner-binding', 'wake-routine', 'bridge-config'].every(key => resources[key as SetupResource]?.status === 'verified');
    return { fullEverReady: !!this.document.setup.fullEverReady, textReady, textEverReady: !!this.document.setup.textEverReady, fullSetupComplete: textReady && resources.moonshine?.status === 'verified', moonshineRequired: true, liveMiniEnabled: !!this.document.setup.liveMiniAuthorizedAt, resources: Object.fromEntries(Object.entries(resources).map(([key, value]) => [key, value!.status])) };
  }
}

/** Runtime reads durable setup evidence only; never provisions or downloads on boot. */
export function assertRuntimeReady(paths: Paths, store: SetupStore) {
  const session = new SetupSession(paths, store), status = session.status();
  invariant(status.textReady && (status.fullSetupComplete || status.fullEverReady), 'SETUP_CORE_AND_MOONSHINE_REQUIRED');
  return { ready: true, mediaDegraded: !status.fullSetupComplete };
}

export async function withSetupSession<T>(paths: Paths, callback: (session: SetupSession) => Promise<T> | T, store?: SetupStore): Promise<T> {
  const release = acquireSetupLock(paths);
  try { return await callback(new SetupSession(paths, store)); } finally { release(); }
}

/** Tool adapters must use locked CLI/native schemas. No invented remote API lives here. */
export async function runAuthorizedSetupStep(session: SetupSession, key: SetupResource, adapter: {
  verify: (record: SetupRecord) => Promise<{ resourceId: string; verified: true } | undefined>;
  create: (record: SetupRecord) => Promise<{ resourceId: string; verified: true }>;
}) {
  const existed = !!session.document.setup.resources[key];
  const record = session.intent(key);
  if (existed) {
    const result = await adapter.verify(record);
    invariant(result, 'SETUP_RESOURCE_RECONCILIATION_REQUIRED'); session.receipt(key, record.operationId, result); return;
  }
  try { const result = await adapter.create(record); session.receipt(key, record.operationId, result); }
  catch { session.uncertain(key, record.operationId); throw new Error('SETUP_RESOURCE_OUTCOME_UNKNOWN'); }
}

/** Existing credentials are preserved byte-for-byte; conflicts never echo values. */
export function preserveBridgeCredentials(paths: Paths, text: string): 'created' | 'preserved' {
  const desired = parseBridgeEnv(text);
  if (existsSync(paths.bridgeEnv)) {
    const existing = parseBridgeEnv(readFileSync(assertPrivateFile(paths.bridgeEnv, paths.root), 'utf8'));
    invariant(BRIDGE_FIELDS.every(key => existing[key] === desired[key]), 'SETUP_CREDENTIAL_CONFLICT'); return 'preserved';
  }
  atomicPrivateWrite(paths.bridgeEnv, text); return 'created';
}

export async function readSetupInput(input: ReadableStream<Uint8Array>, limit = 64 * 1024): Promise<string> {
  const reader = input.getReader(); const chunks: Uint8Array[] = []; let bytes = 0;
  try {
    while (true) {
      const part = await reader.read(); if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > limit) { await reader.cancel(); throw new Error('SETUP_INPUT_TOO_LARGE'); }
      chunks.push(part.value);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks).toString('utf8');
}

export async function initializeStorage(paths: Paths) {
  const release = acquireSetupLock(paths);
  try {
    const document = readInstanceDocument(paths);
    invariant(document.setup.authorizedAt, 'SETUP_AUTHORIZATION_REQUIRED');
    const existed = existsSync(paths.databasePath);
    invariant(existed || !document.database, 'INSTANCE_DATABASE_RECOVERY_REQUIRED');
    if (!existed) { document.database = { status: 'intent' }; atomicPrivateWrite(paths.configPath, JSON.stringify(document, null, 2) + '\n'); }
    const store = (await import('./storage.ts')).openStore({ paths, create: !existed });
    try {
      invariant(store.installationId === document.installationId, 'INSTANCE_IDENTITY_CONFLICT');
      if (!store.getMetadata('setup', 'checkpoint')) store.setMetadata('setup', 'checkpoint', document.setup);
      document.database = { status: 'ready' }; atomicPrivateWrite(paths.configPath, JSON.stringify(document, null, 2) + '\n');
      return { initialized: true };
    } finally { store.close(); }
  } finally { release(); }
}

export async function setupMain(args = process.argv.slice(2)) {
  args = args[0] === '--' ? args.slice(1) : args;
  const paths = resolveInstancePaths();
  const [command, ...rest] = args;
  if (command === 'init') {
    invariant(rest.length === 1 && rest[0] === '--authorized', 'SETUP_AUTHORIZATION_REQUIRED');
    initializeSetup(paths, { authorized: true }); return { initialized: true };
  }
  if (command === 'recover-lock') {
    if (rest.length === 0) return recoverSetupLock(paths);
    invariant(rest.length === 3 && rest[0] === '--apply' && rest[1] === '--nonce', 'SETUP_ARGUMENT_INVALID');
    return recoverSetupLock(paths, { apply: true, nonce: rest[2] });
  }
  if (command === 'initialize-storage') { invariant(rest.length === 0, 'SETUP_ARGUMENT_INVALID'); return initializeStorage(paths); }
  let payload: any;
  if (['intent', 'receipt', 'uncertain', 'write-bridge-env', 'write-live-env'].includes(command ?? '')) {
    invariant(rest.length === 1 && rest[0] === '--json-stdin', 'SETUP_JSON_STDIN_REQUIRED');
    const text = await readSetupInput(Bun.stdin.stream());
    try { payload = JSON.parse(text); } catch { throw new Error('SETUP_INPUT_INVALID'); }
    invariant(payload && !Array.isArray(payload) && typeof payload === 'object', 'SETUP_INPUT_INVALID');
  } else if (command === 'authorize-live-mini') invariant(rest.length === 1 && rest[0] === '--authorized', 'LIVE_MINI_AUTHORIZATION_REQUIRED');
  else invariant((command === 'status' || command === 'verify-moonshine') && rest.length === 0, 'SETUP_ARGUMENT_INVALID');
  const store = existsSync(paths.databasePath) ? (await import('./storage.ts')).openStore({ paths, readOnly: command === 'status' }) : undefined;
  try {
    return await withSetupSession(paths, session => {
      if (command === 'status') return session.status();
      if (command === 'verify-moonshine') return session.verifyMoonshine();
      if (command === 'write-live-env') {
        invariant(Object.keys(payload).length === 1 && typeof payload.text === 'string', 'SETUP_INPUT_INVALID');
        return session.writeLiveEnvironment(payload.text);
      }
      if (command === 'authorize-live-mini') { session.authorizeLiveMini(true); return { authorized: true }; }
      if (command === 'write-bridge-env') {
        invariant(Object.keys(payload).length === 1 && typeof payload.text === 'string', 'SETUP_INPUT_INVALID');
        return { credentials: preserveBridgeCredentials(paths, payload.text) };
      }
      const allowed = command === 'intent' ? ['resource', 'environmentRevision'] : command === 'receipt' ? ['resource', 'operationId', 'resourceId', 'verified', 'environmentRevision'] : ['resource', 'operationId'];
      invariant(Object.keys(payload).every(key => allowed.includes(key)), 'SETUP_INPUT_INVALID');
      resourceKey(payload.resource);
      if (command === 'intent') return session.intent(payload.resource, payload.environmentRevision);
      if (command === 'receipt') {
        if (payload.resource === 'moonshine') throw new Error('USE_VERIFY_MOONSHINE');
        if (payload.resource === 'live-env') invariant(payload.environmentRevision === liveEnvironmentRevision(paths), 'LIVE_ENVIRONMENT_REVISION_REQUIRED');
        session.receipt(payload.resource, payload.operationId, payload); return { recorded: true }; }
      session.uncertain(payload.resource, payload.operationId); return { recorded: true };
    }, store);
  } finally { store?.close(); }
}
if (import.meta.main) {
  try { console.log(JSON.stringify(await setupMain())); }
  catch (error) { const { privacyError } = await import('./privacy.ts'); console.error(privacyError(error)); process.exitCode = 1; }
}
