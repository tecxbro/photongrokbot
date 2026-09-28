import { constants, closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, realpathSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_ROOT = '/workspace/photongrokbot-state';
const CHECKOUT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const validated = new WeakSet();
const roots = new Set();
function fail(code) { throw new Error(code); }
function within(path, root) { const rel = relative(root, path); return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel)); }
function safeAbsolute(path) {
  if (typeof path !== 'string' || !isAbsolute(path) || path.includes('\0') || path.split(/[\\/]/).includes('..')) fail('INSTANCE_PATH_INVALID');
  const full = resolve(path);
  let current = sep;
  for (const part of full.split(sep).filter(Boolean)) {
    current = join(current, part);
    try { if (lstatSync(current).isSymbolicLink()) fail('INSTANCE_SYMLINK_REJECTED'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return full;
}

/** Resolves and validates only; never creates directories or opens instance state. */
export function resolveInstancePaths(options = {}) {
  const env = options.env ?? process.env;
  const isRunner = process.argv.includes('test') || env.NODE_ENV === 'test';
  const test = options.testMode === true || env.PHOTON_TEST_MODE === '1' || isRunner;
  if (test && env.PHOTON_TEST_MODE !== '1') fail('TEST_GUARD_REQUIRED');
  const override = options.instanceDir;
  const exported = env.PHOTON_INSTANCE_DIR;
  if (override && exported && resolve(override) !== resolve(exported)) fail('INSTANCE_ROOT_CONFLICT');
  if (test && (!override && !exported)) fail('TEST_INSTANCE_REQUIRED');
  const root = safeAbsolute(override ?? exported ?? DEFAULT_ROOT);
  const checkout = resolve(options.checkoutRoot ?? CHECKOUT);
  if (within(root, checkout) || within(checkout, root)) fail('INSTANCE_CHECKOUT_OVERLAP');
  if (test && (within(root, '/workspace') || root === sep)) fail('TEST_PRODUCTION_PATH_REJECTED');
  if (!test && (!within(root, '/workspace') || root === '/workspace')) fail('PERSISTENT_WORKSPACE_REQUIRED');
  const paths = Object.freeze({
    root, configPath: join(root, 'instance.json'), secretsDir: join(root, 'secrets'),
    bridgeEnv: join(root, 'secrets', 'bridge.env'), liveMiniEnv: join(root, 'secrets', 'live-mini.env'),
    dataDir: join(root, 'data'), databasePath: join(root, 'data', 'bridge.sqlite'),
    inboundAttachmentsDir: join(root, 'data', 'inbound-attachments'), outboundAssetsDir: join(root, 'data', 'outbound-assets'),
    viewsDir: join(root, 'data', 'views'), modelsDir: join(root, 'models'), toolsDir: join(root, 'tools'),
    liveMiniContextDir: join(root, 'live-mini', 'context'), backupsDir: join(root, 'backups'), logsDir: join(root, 'logs'),
  });
  validated.add(paths); roots.add(root); return paths;
}

export function ensureInstancePaths(paths) {
  if (!validated.has(paths)) fail('UNVALIDATED_INSTANCE_PATHS');
  for (const path of [paths.root, paths.secretsDir, paths.dataDir, paths.inboundAttachmentsDir, paths.outboundAssetsDir, paths.viewsDir, paths.modelsDir, paths.toolsDir, join(paths.root, 'live-mini'), paths.liveMiniContextDir, paths.backupsDir, paths.logsDir]) {
    safeAbsolute(path);
    mkdirSync(path, { recursive: true, mode: 0o700 });
    const stat = lstatSync(path);
    if (!stat.isDirectory() || (stat.mode & 0o077) !== 0) fail('PRIVATE_DIRECTORY_PERMISSIONS');
  }
}

export function assertPrivateFile(path, allowedRoot) {
  const root = safeAbsolute(allowedRoot), full = safeAbsolute(path);
  if (full === root || !within(full, root)) fail('PRIVATE_FILE_OUTSIDE_INSTANCE');
  const stat = lstatSync(full);
  if (!stat.isFile()) fail('PRIVATE_FILE_REQUIRED');
  if ((stat.mode & 0o077) !== 0) fail('PRIVATE_FILE_PERMISSIONS');
  return realpathSync(full);
}

/** Atomic same-directory replacement; caller holds the appropriate process/store lock. */
export function atomicPrivateWrite(path, content) {
  const full = safeAbsolute(path);
  if (![...roots].some(root => full !== root && within(full, root))) fail('UNVALIDATED_INSTANCE_PATHS');
  safeAbsolute(dirname(full));
  if (existsSync(full)) assertPrivateFile(full, dirname(full));
  const temporary = `${full}.tmp-${process.pid}-${crypto.randomUUID()}`;
  let fd;
  try {
    fd = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    writeFileSync(fd, content); fsyncSync(fd); closeSync(fd); fd = undefined;
    renameSync(temporary, full);
    const directory = openSync(dirname(full), constants.O_RDONLY); try { fsyncSync(directory); } finally { closeSync(directory); }
  } finally {
    if (fd !== undefined) closeSync(fd);
    try { unlinkSync(temporary); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}
