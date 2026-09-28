import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertPrivateFile, atomicPrivateWrite, resolveInstancePaths } from '../../shared/instance-paths.mjs';

type Paths = ReturnType<typeof resolveInstancePaths>;
function invariant(ok: unknown, code: string): asserts ok { if (!ok) throw new Error(code); }
export function parseLiveMiniEnv(text: string): { PUBLIC_BASE_URL: string; PUBLISHER_TOKEN: string } {
  invariant(Buffer.byteLength(text) <= 64 * 1024, 'LIVE_ENV_TOO_LARGE');
  const values: Record<string, string> = Object.create(null);
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim(); if (!line || line.startsWith('#')) continue;
    const match = /^(PUBLIC_BASE_URL|PUBLISHER_TOKEN)\s*=\s*(.*)$/.exec(line);
    invariant(match && !Object.hasOwn(values, match[1]!), 'LIVE_ENV_INVALID_FIELD');
    let value = match[2]!;
    if (/^["']/.test(value)) { invariant(value.length >= 2 && value.at(-1) === value[0], 'LIVE_ENV_INVALID_VALUE'); value = value.slice(1, -1); }
    invariant(value && !/[\x00-\x20\x7f]/.test(value), 'LIVE_ENV_INVALID_VALUE'); values[match[1]!] = value;
  }
  invariant(values.PUBLIC_BASE_URL && values.PUBLISHER_TOKEN, 'LIVE_ENV_MISSING_FIELD');
  let url: URL; try { url = new URL(values.PUBLIC_BASE_URL); } catch { throw new Error('LIVE_ENV_INVALID_URL'); }
  invariant(url.protocol === 'https:' && !url.username && !url.password && !url.hash && !url.search, 'LIVE_ENV_INVALID_URL');
  return values as { PUBLIC_BASE_URL: string; PUBLISHER_TOKEN: string };
}
export function liveEnvironmentRevision(paths: Paths): string {
  const values = parseLiveMiniEnv(readFileSync(assertPrivateFile(paths.liveMiniEnv, paths.root), 'utf8'));
  return createHash('sha256').update(JSON.stringify(values)).digest('hex');
}
export function preserveLiveMiniCredentials(paths: Paths, text: string) {
  const desired = parseLiveMiniEnv(text);
  if (existsSync(paths.liveMiniEnv)) {
    const existing = parseLiveMiniEnv(readFileSync(assertPrivateFile(paths.liveMiniEnv, paths.root), 'utf8'));
    invariant(existing.PUBLIC_BASE_URL === desired.PUBLIC_BASE_URL && existing.PUBLISHER_TOKEN === desired.PUBLISHER_TOKEN, 'LIVE_ENV_CONFLICT_REDEPLOY_REVIEW_REQUIRED');
  } else atomicPrivateWrite(paths.liveMiniEnv, text);
  return { environmentRevision: liveEnvironmentRevision(paths) };
}
export function verifyMoonshineInstallation(paths: Paths) {
  const python = join(paths.toolsDir, 'moonshine-venv', 'bin', 'python');
  const script = fileURLToPath(new URL('../tools/moonshine_stt.py', import.meta.url));
  const model = join(paths.modelsDir, 'moonshine', 'small-streaming-en', 'quantized_26_08_21');
  let result: any;
  try {
    const output = execFileSync(python, [script, '--verify-installation', '--model', model], { encoding: 'utf8', timeout: 60_000, maxBuffer: 128 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
    result = JSON.parse(output);
  } catch { throw new Error('MOONSHINE_VERIFICATION_FAILED'); }
  invariant(result.verified === true && /^[a-f0-9]{40}$/.test(result.modelRevision) && /^[a-f0-9]{64}$/.test(result.manifestSha256), 'MOONSHINE_VERIFICATION_INVALID');
  invariant(result.packages && Object.keys(result.packages).length <= 64 && Object.entries(result.packages).every(([name, version]) => /^[A-Za-z0-9_.-]+$/.test(name) && typeof version === 'string' && /^[A-Za-z0-9_.+-]+$/.test(version)), 'MOONSHINE_VERIFICATION_INVALID');
  return result as { verified: true; modelRevision: string; manifestSha256: string; packages: Record<string, string> };
}
