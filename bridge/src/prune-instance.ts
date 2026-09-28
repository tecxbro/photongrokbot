import { resolveInstancePaths } from '../../shared/instance-paths.mjs';
import { assertInstanceLock } from './instance-lock.ts';
import { inspectPrivacy, privacyError, pruneInstance } from './privacy.ts';

export async function pruneMain(args = process.argv.slice(2)) {
  args = args[0] === '--' ? args.slice(1) : args;
  const options: { now?: number; apply?: boolean; planId?: string; includeBackups?: boolean; deleteResolved?: boolean } = {};
  let inspect = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--apply') options.apply = true;
    else if (arg === '--delete-resolved') options.deleteResolved = true;
    else if (arg === '--inspect') inspect = true;
    else if (arg === '--include-backups') options.includeBackups = true;
    else if (arg === '--now' && /^\d+$/.test(args[i + 1] ?? '')) options.now = Number(args[++i]);
    else if (arg === '--plan-id' && /^[a-f0-9]{64}$/.test(args[i + 1] ?? '')) options.planId = args[++i];
    else throw new Error('PRIVACY_ARGUMENT_INVALID');
  }
  if (inspect && (options.apply || options.planId || options.includeBackups || options.deleteResolved)) throw new Error('PRIVACY_ARGUMENT_CONFLICT');
  const paths = resolveInstancePaths();
  if (options.apply) assertInstanceLock(paths);
  const { openStore } = await import('./storage.ts');
  const store = openStore({ paths, readOnly: !options.apply });
  try { return inspect ? inspectPrivacy(paths, store, options.now) : pruneInstance(paths, store, options); } finally { store.close(); }
}
if (import.meta.main) {
  try { console.log(JSON.stringify(await pruneMain())); } catch (error) { console.error(privacyError(error)); process.exitCode = 1; }
}
