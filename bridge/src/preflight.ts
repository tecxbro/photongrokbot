import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync } from 'node:fs';
import { resolveInstancePaths } from '../../shared/instance-paths.mjs';
import { loadConfig } from './config.ts';
import { readInstanceDocument } from './setup-state.ts';
import { privacyError } from './privacy.ts';
import { assertPatchedSQLite, inspectDatabase } from './db.ts';

type Paths = ReturnType<typeof resolveInstancePaths>;
export function inspectTrackedPrivateFiles(checkoutRoot: string): { trackedPrivateFiles: string[]; ignoredRulesDoNotUntrack: true } {
  let output: string;
  try { output = execFileSync('git', ['-C', checkoutRoot, 'ls-files', '-z'], { encoding: 'utf8', timeout: 5000, maxBuffer: 2 * 1024 * 1024 }); }
  catch { throw new Error('GIT_TRACKING_INSPECTION_FAILED'); }
  const files = output.split('\0').filter(Boolean).filter(path => {
    if (/(^|\/)\.env\.example$|\.env\.example$/.test(path)) return false;
    return /(^|\/)(?:\.env(?:\..*)?|prod\.env|[^/]+\.env(?:\.bak.*)?)$/.test(path) || /^live-mini\/(secrets|runtime\/state)\//.test(path) || (/^bridge\/data\//.test(path) && !path.endsWith('/.gitkeep'));
  });
  return { trackedPrivateFiles: files, ignoredRulesDoNotUntrack: true };
}
export function verifySqliteBuild(facts: { version: string; sourceId: string; journalMode: string; filesystemVerified: boolean }) {
  assertPatchedSQLite(facts.version, facts.sourceId);
  if (facts.journalMode.toLowerCase() === 'wal' && !facts.filesystemVerified) throw new Error('SQLITE_FILESYSTEM_VERIFICATION_REQUIRED');
}
export function preflight(options: { paths?: Paths; storage?: { installationId: string }; sqlite?: Parameters<typeof verifySqliteBuild>[0]; checkoutRoot?: string } = {}) {
  const checks: { name: string; status: 'ok' | 'error' | 'unverified'; code?: string }[] = [];
  let paths: Paths | undefined;
  const check = (name: string, fn: () => void) => { try { fn(); checks.push({ name, status: 'ok' }); } catch (error) { checks.push({ name, status: 'error', code: privacyError(error) }); } };
  check('private-path', () => { paths = options.paths ?? resolveInstancePaths(); if (!existsSync(paths.root)) throw new Error('PERSISTENT_INSTANCE_MISSING'); if ((lstatSync(paths.root).mode & 0o077) !== 0) throw new Error('PRIVATE_DIRECTORY_PERMISSIONS'); });
  if (paths) {
    check('configuration', () => { loadConfig({ paths }); });
    check('identity', () => { const document = readInstanceDocument(paths!); if (!existsSync(paths!.databasePath)) throw new Error('INSTANCE_DATABASE_MISSING'); if (options.storage && document.installationId !== options.storage.installationId) throw new Error('INSTANCE_IDENTITY_CONFLICT'); });
  }
  if (options.sqlite) check('sqlite', () => verifySqliteBuild(options.sqlite!));
  else checks.push({ name: 'sqlite', status: 'unverified', code: 'OPEN_STORE_VERIFICATION_REQUIRED' });
  if (options.checkoutRoot) check('tracked-private-files', () => { if (inspectTrackedPrivateFiles(options.checkoutRoot!).trackedPrivateFiles.length) throw new Error('TRACKED_PRIVATE_FILES_REQUIRE_RESPONSE'); });
  return { ok: checks.every(item => item.status === 'ok'), checks };
}

export async function preflightMain(args = process.argv.slice(2)) {
  args = args[0] === '--' ? args.slice(1) : args;
  if (args.length) throw new Error('PREFLIGHT_ARGUMENT_INVALID');
  const paths = resolveInstancePaths();
  // Explicit read-only inspection never opens a write store or repairs modes.
  try {
    const facts = inspectDatabase(paths);
    return preflight({ paths, storage: { installationId: facts.installationId }, sqlite: facts });
  } catch (error) { return { ok: false, checks: [{ name: 'storage', status: 'error', code: privacyError(error) }] }; }
}
if (import.meta.main) {
  try { const result = await preflightMain(); console.log(JSON.stringify(result)); if (!result.ok) process.exitCode = 1; }
  catch (error) { console.error(privacyError(error)); process.exitCode = 1; }
}
