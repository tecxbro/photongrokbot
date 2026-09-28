import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readdirSync, rmdirSync, unlinkSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { assertPrivateFile, resolveInstancePaths } from '../../shared/instance-paths.mjs';
import { readInstanceDocument } from './setup-state.ts';

type Paths = ReturnType<typeof resolveInstancePaths>;
export interface PrivacyStore {
  installationId: string;
  acknowledgePrunedArtifacts(paths: string[]): void;
  privacySnapshot(nowMs?: number): { events: number; outbound: number; unresolved: number; prunableEvents: number; prunableOutbound: number };
  pruneResolvedBefore(options: { resolvedBefore: number; intermediateBefore: number; apply?: boolean; intermediatePaths?: { path: string; createdAt: number }[] }): { events: number; outbound: number; artifactPaths: string[] };
}
export const RETENTION_POLICY = Object.freeze({ resolvedDays: 30, intermediateDays: 7, logDays: 30, logBytes: 10 * 1024 * 1024, backupDays: 30, minimumBackups: 3 });
const DAY = 24 * 60 * 60 * 1000;
function invariant(ok: unknown, code: string): asserts ok { if (!ok) throw new Error(code); }

const SAFE_ERROR_CODES = new Set(['SETUP_CORE_AND_MOONSHINE_REQUIRED', 'CONFIG_DUPLICATE_AUTHORIZED_SENDER_ID', 'CONFIG_DUPLICATE_GROK_ORCHESTRATOR_WEBHOOK_KEY', 'CONFIG_DUPLICATE_GROK_ORCHESTRATOR_WEBHOOK_URL', 'CONFIG_DUPLICATE_SPECTRUM_PROJECT_ID', 'CONFIG_DUPLICATE_SPECTRUM_PROJECT_SECRET', 'CONFIG_INVALID_AUTHORIZED_SENDER_ID', 'CONFIG_INVALID_GROK_ORCHESTRATOR_WEBHOOK_KEY', 'CONFIG_INVALID_GROK_ORCHESTRATOR_WEBHOOK_URL', 'CONFIG_INVALID_SPECTRUM_PROJECT_ID', 'CONFIG_INVALID_SPECTRUM_PROJECT_SECRET', 'CONFIG_MISSING_AUTHORIZED_SENDER_ID', 'CONFIG_MISSING_GROK_ORCHESTRATOR_WEBHOOK_KEY', 'CONFIG_MISSING_GROK_ORCHESTRATOR_WEBHOOK_URL', 'CONFIG_MISSING_SPECTRUM_PROJECT_ID', 'CONFIG_MISSING_SPECTRUM_PROJECT_SECRET', 'CONFIG_PRIVATE_FILE_UNAVAILABLE', 'CONFIG_TOO_LARGE', 'CONFIG_UNKNOWN_OR_INVALID_FIELD', 'EXPORT_ARGUMENT_INVALID', 'EXPORT_FAILED', 'EXPORT_TARGET_EXISTS', 'GIT_TRACKING_INSPECTION_FAILED', 'INSTANCE_CHECKOUT_OVERLAP', 'INSTANCE_CONFIG_MISSING_OR_INVALID', 'INSTANCE_CONFIG_TOO_LARGE', 'INSTANCE_DATABASE_MISSING', 'INSTANCE_DATABASE_RECOVERY_REQUIRED', 'INSTANCE_IDENTITY_CONFLICT', 'INSTANCE_IDENTITY_INVALID', 'INSTANCE_IDENTITY_RECOVERY_REQUIRED', 'INSTANCE_ID_MISMATCH', 'INSTANCE_PATH_INVALID', 'INSTANCE_ROOT_CONFLICT', 'INSTANCE_SYMLINK_REJECTED', 'LIVE_ENVIRONMENT_NOT_READY', 'LIVE_ENVIRONMENT_REVISION_REQUIRED', 'LIVE_ENV_CONFLICT_REDEPLOY_REVIEW_REQUIRED', 'LIVE_ENV_INVALID_FIELD', 'LIVE_ENV_INVALID_URL', 'LIVE_ENV_INVALID_VALUE', 'LIVE_ENV_MISSING_FIELD', 'LIVE_ENV_TOO_LARGE', 'LIVE_MINI_AUTHORIZATION_REQUIRED', 'MOONSHINE_INTENT_REQUIRED', 'MOONSHINE_VERIFICATION_FAILED', 'MOONSHINE_VERIFICATION_INVALID', 'OPEN_STORE_VERIFICATION_REQUIRED', 'PERSISTENT_INSTANCE_MISSING', 'PERSISTENT_WORKSPACE_REQUIRED', 'PREFLIGHT_ARGUMENT_INVALID', 'PRIVACY_ARGUMENT_CONFLICT', 'PRIVACY_ARGUMENT_INVALID', 'PRIVACY_ARTIFACT_OUTSIDE_SCOPE', 'PRIVACY_ASSET_DELETE_FAILED', 'PRIVACY_FILE_CHANGED', 'PRIVACY_FILE_LIMIT', 'PRIVACY_INSTANCE_CONFLICT', 'PRIVACY_PREVIEW_REQUIRED_OR_CHANGED', 'PRIVACY_SYMLINK_REJECTED', 'PRIVACY_TIME_INVALID', 'PRIVATE_DIRECTORY_PERMISSIONS', 'PRIVATE_FILE_OUTSIDE_INSTANCE', 'PRIVATE_FILE_PERMISSIONS', 'PRIVATE_FILE_REQUIRED', 'PRIVATE_OPERATION_FAILED', 'SETUP_ARGUMENT_INVALID', 'SETUP_AUTHORIZATION_REQUIRED', 'SETUP_CREDENTIAL_CONFLICT', 'SETUP_ENVIRONMENT_CHANGED_REDEPLOY_REQUIRED', 'SETUP_FAILED', 'SETUP_INPUT_INVALID', 'SETUP_INPUT_TOO_LARGE', 'SETUP_JSON_STDIN_REQUIRED', 'SETUP_LOCK_HELD_OR_UNAVAILABLE', 'SETUP_LOCK_OWNER_ALIVE', 'SETUP_LOCK_OWNER_CHANGED', 'SETUP_LOCK_OWNER_INVALID', 'SETUP_LOCK_OWNER_UNVERIFIED', 'SETUP_LOCK_RECOVERY_PREVIEW_REQUIRED', 'SETUP_OPERATION_CONFLICT', 'SETUP_RESOURCE_ID_CONFLICT', 'SETUP_RESOURCE_INVALID', 'SETUP_RESOURCE_OUTCOME_UNKNOWN', 'SETUP_RESOURCE_RECONCILIATION_REQUIRED', 'SETUP_STATE_INVALID', 'SETUP_STORE_REQUIRED', 'SETUP_VERIFIED_EVIDENCE_REQUIRED', 'SQLITE_BUILD_UNVERIFIED', 'SQLITE_FILESYSTEM_VERIFICATION_REQUIRED', 'SQLITE_FIXED_BUILD_REQUIRED', 'SQLITE_LOCAL_FILESYSTEM_UNVERIFIED', 'SQLITE_SOURCE_ID_REQUIRED', 'STORE_INTEGRITY_FAILED', 'STORE_NOT_INITIALIZED', 'STORE_SCHEMA_UNSUPPORTED', 'TEST_GUARD_REQUIRED', 'TEST_INSTANCE_REQUIRED', 'TEST_PRODUCTION_PATH_REJECTED', 'TRACKED_PRIVATE_FILES_REQUIRE_RESPONSE', 'UNVALIDATED_INSTANCE_PATHS', 'USE_VERIFY_MOONSHINE']);

/** No raw values in diagnostics, including malformed provider error messages. */
export function privacyError(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  const code = message.split(':', 1)[0]!;
  return SAFE_ERROR_CODES.has(code) ? code : 'PRIVATE_OPERATION_FAILED';
}
export function assertInstanceBinding(paths: Paths, store: Pick<PrivacyStore, 'installationId'>) {
  invariant(readInstanceDocument(paths).installationId === store.installationId, 'PRIVACY_INSTANCE_CONFLICT');
}
function walkPrivate(directory: string, root: string): { path: string; mtime: number; bytes: number }[] {
  if (!existsSync(directory)) return [];
  invariant(!lstatSync(directory).isSymbolicLink(), 'PRIVACY_SYMLINK_REJECTED');
  const files: { path: string; mtime: number; bytes: number }[] = [];
  for (const name of readdirSync(directory).sort()) {
    const path = join(directory, name), stat = lstatSync(path);
    invariant(!stat.isSymbolicLink(), 'PRIVACY_SYMLINK_REJECTED');
    if (stat.isDirectory()) files.push(...walkPrivate(path, root));
    else { assertPrivateFile(path, root); files.push({ path, mtime: stat.mtimeMs, bytes: stat.size }); }
    invariant(files.length <= 20_000, 'PRIVACY_FILE_LIMIT');
  }
  return files;
}
function eligibleFiles(paths: Paths, now: number, includeBackups: boolean) {
  const logs = walkPrivate(paths.logsDir, paths.root).sort((a, b) => b.mtime - a.mtime);
  let retainedBytes = 0;
  const selected = logs.filter(file => { retainedBytes += file.bytes; return now - file.mtime > RETENTION_POLICY.logDays * DAY || retainedBytes > RETENTION_POLICY.logBytes; });
  if (includeBackups) {
    // A snapshot rotates as one unit; never keep three files from a broken backup.
    const groups = readdirSync(paths.backupsDir).map(name => {
      const path = join(paths.backupsDir, name), stat = lstatSync(path);
      invariant(!stat.isSymbolicLink(), 'PRIVACY_SYMLINK_REJECTED');
      const files = stat.isDirectory() ? walkPrivate(path, paths.root) : [{ path: assertPrivateFile(path, paths.root), mtime: stat.mtimeMs, bytes: stat.size }];
      return { files, newest: Math.max(stat.mtimeMs, ...files.map(file => file.mtime)) };
    }).sort((a, b) => b.newest - a.newest);
    selected.push(...groups.filter((group, index) => index >= RETENTION_POLICY.minimumBackups && now - group.newest > RETENTION_POLICY.backupDays * DAY).flatMap(group => group.files));
  }
  return selected;
}
function intermediateCandidates(paths: Paths) {
  const uuid = '[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}';
  const ownedJob = new RegExp(`^media-job-[a-f0-9]{24}-${uuid}/`);
  const ownedConversion = new RegExp(`^(?:\\.${uuid}\\.partial\\.jpg|[a-f0-9]{64}\\.jpg)$`);
  const inbound = walkPrivate(paths.inboundAttachmentsDir, paths.root).filter(file => ownedJob.test(relative(paths.inboundAttachmentsDir, file.path)));
  const converted = join(paths.outboundAssetsDir, 'converted');
  const outbound = walkPrivate(converted, paths.root).filter(file => ownedConversion.test(relative(converted, file.path)));
  return [...inbound, ...outbound].map(file => ({ path: file.path, createdAt: file.mtime }));
}
function validateArtifact(paths: Paths, path: string) {
  invariant([paths.inboundAttachmentsDir, paths.outboundAssetsDir, paths.viewsDir].some(root => path.startsWith(`${root}/`)), 'PRIVACY_ARTIFACT_OUTSIDE_SCOPE');
  if (existsSync(path)) assertPrivateFile(path, paths.dataDir);
  else {
    // A dangling symlink must not be treated as an ordinary already-deleted file.
    try { invariant(!lstatSync(path).isSymbolicLink(), 'PRIVACY_SYMLINK_REJECTED'); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    invariant(!path.split('/').includes('..'), 'PRIVACY_ARTIFACT_OUTSIDE_SCOPE');
  }
}

/** Preview is deterministic for an explicit cutoff. Apply rechecks it before mutation. */
export function pruneInstance(paths: Paths, store: PrivacyStore, options: { now?: number; apply?: boolean; planId?: string; includeBackups?: boolean; deleteResolved?: boolean } = {}) {
  assertInstanceBinding(paths, store);
  const now = options.now ?? Date.now();
  invariant(Number.isSafeInteger(now) && now > 0, 'PRIVACY_TIME_INVALID');
  const cutoff = { resolvedBefore: options.deleteResolved ? now : now - RETENTION_POLICY.resolvedDays * DAY, intermediateBefore: options.deleteResolved ? now : now - RETENTION_POLICY.intermediateDays * DAY };
  const intermediatePaths = intermediateCandidates(paths);
  const preview = store.pruneResolvedBefore({ ...cutoff, intermediatePaths, apply: false });
  const artifacts = [...new Set(preview.artifactPaths)].sort();
  for (const path of artifacts) validateArtifact(paths, path);
  const files = eligibleFiles(paths, now, options.includeBackups === true);
  const planId = createHash('sha256').update(JSON.stringify({ installationId: store.installationId, now, preview, files, includeBackups: options.includeBackups === true, deleteResolved: options.deleteResolved === true })).digest('hex');
  const report = { planId, now, applied: false, events: preview.events, outbound: preview.outbound, assets: artifacts.length, ancillaryFiles: files.length, backupsIncluded: options.includeBackups === true, mode: options.deleteResolved ? 'delete-resolved' : 'retention', policy: RETENTION_POLICY };
  if (!options.apply) return report;
  invariant(options.planId === planId, 'PRIVACY_PREVIEW_REQUIRED_OR_CHANGED');
  const actual = store.pruneResolvedBefore({ ...cutoff, intermediatePaths, apply: true });
  // The store performs the same retained-reference check inside its write transaction.
  for (const path of actual.artifactPaths) {
    validateArtifact(paths, path);
    try { unlinkSync(path); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('PRIVACY_ASSET_DELETE_FAILED'); }
    store.acknowledgePrunedArtifacts([path]);
  }
  for (const file of files) { assertPrivateFile(file.path, paths.root); const current = lstatSync(file.path); invariant(current.mtimeMs === file.mtime && current.size === file.bytes, 'PRIVACY_FILE_CHANGED'); unlinkSync(file.path);
    if (file.path.startsWith(`${paths.backupsDir}/`)) {
      for (let parent = dirname(file.path); parent !== paths.backupsDir; parent = dirname(parent)) {
        try { rmdirSync(parent); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOTEMPTY') break; throw error; }
      }
    }
  }
  return { ...report, applied: true, events: actual.events, outbound: actual.outbound, assets: actual.artifactPaths.length };
}

/** Inspection exposes counts/status/ages only. File names, bodies and tokens stay private. */
export function inspectPrivacy(paths: Paths, store: PrivacyStore, now = Date.now()) {
  assertInstanceBinding(paths, store);
  const backups = walkPrivate(paths.backupsDir, paths.root);
  return { ...store.privacySnapshot(now), backupFiles: backups.length, backupBytes: backups.reduce((sum, file) => sum + file.bytes, 0), oldestBackupAgeDays: backups.length ? Math.max(...backups.map(file => Math.max(0, Math.floor((now - file.mtime) / DAY)))) : 0, policy: RETENTION_POLICY };
}

export function listPrivateExportFiles(paths: Paths) {
  return [paths.configPath, ...walkPrivate(paths.inboundAttachmentsDir, paths.root).map(file => file.path), ...walkPrivate(paths.outboundAssetsDir, paths.root).map(file => file.path), ...walkPrivate(paths.liveMiniContextDir, paths.root).map(file => file.path)].map(path => ({ path: assertPrivateFile(path, paths.root), relative: relative(paths.root, path) }));
}
