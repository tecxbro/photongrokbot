import { createHash } from 'node:crypto';
import { closeSync, constants, copyFileSync, existsSync, fsyncSync, mkdirSync, openSync, readSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { assertPrivateFile, atomicPrivateWrite, resolveInstancePaths } from '../../shared/instance-paths.mjs';
import { assertInstanceLock } from './instance-lock.ts';
import { assertInstanceBinding, listPrivateExportFiles, privacyError } from './privacy.ts';

type Paths = ReturnType<typeof resolveInstancePaths>;
type ExportStore = { installationId: string; backupTo(path: string): void };

function digestFile(path: string) {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  const hash = createHash('sha256'), chunk = Buffer.alloc(64 * 1024);
  try { let count: number; while ((count = readSync(fd, chunk, 0, chunk.length, null)) > 0) hash.update(chunk.subarray(0, count)); }
  finally { closeSync(fd); }
  return hash.digest('hex');
}

/** Export includes private content in a 0700 backup, never credentials or stdout bodies. */
export function exportInstance(paths: Paths, store: ExportStore, options: { apply?: boolean; planId?: string } = {}) {
  assertInstanceBinding(paths, store);
  const files = listPrivateExportFiles(paths);
  const planId = createHash('sha256').update(JSON.stringify({ installationId: store.installationId, files: files.map(file => ({ name: file.relative, digest: digestFile(file.path) })) })).digest('hex');
  const preview = { planId, applied: false, files: files.length + 1, containsPrivateData: true, includesCredentials: false, backupRetentionDays: 30 };
  if (!options.apply) return preview;
  if (options.planId !== planId) throw new Error('PRIVACY_PREVIEW_REQUIRED_OR_CHANGED');
  const id = crypto.randomUUID();
  const target = join(paths.backupsDir, `export-${id}`);
  if (existsSync(target)) throw new Error('EXPORT_TARGET_EXISTS');
  mkdirSync(target, { mode: 0o700 });
  try {
    for (const file of files) {
      const destination = join(target, file.relative);
      mkdirSync(dirname(destination), { recursive: true, mode: 0o700 });
      copyFileSync(assertPrivateFile(file.path, paths.root), destination, constants.COPYFILE_EXCL);
      assertPrivateFile(destination, paths.root);
      const copied = openSync(destination, constants.O_RDONLY); try { fsyncSync(copied); } finally { closeSync(copied); }
    }
    store.backupTo(join(target, 'bridge.sqlite'));
    assertPrivateFile(join(target, 'bridge.sqlite'), paths.root);
    atomicPrivateWrite(join(target, 'export.json'), JSON.stringify({ version: 1, createdAt: Date.now(), installationId: store.installationId, includesCredentials: false, planId }));
    return { ...preview, applied: true, exportId: id };
  } catch {
    // Only the newly-created exact export directory is rolled back.
    rmSync(target, { recursive: true, force: true }); throw new Error('EXPORT_FAILED');
  }
}
export async function exportMain(args = process.argv.slice(2)) {
  args = args[0] === '--' ? args.slice(1) : args;
  const options: { apply?: boolean; planId?: string } = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--apply') options.apply = true;
    else if (args[i] === '--plan-id' && /^[a-f0-9]{64}$/.test(args[i + 1] ?? '')) options.planId = args[++i];
    else throw new Error('EXPORT_ARGUMENT_INVALID');
  }
  const paths = resolveInstancePaths();
  if (options.apply) assertInstanceLock(paths);
  const { openStore } = await import('./storage.ts');
  const store = openStore({ paths, readOnly: !options.apply });
  try { return exportInstance(paths, store, options); } finally { store.close(); }
}
if (import.meta.main) {
  try { console.log(JSON.stringify(await exportMain())); } catch (error) { console.error(privacyError(error)); process.exitCode = 1; }
}
