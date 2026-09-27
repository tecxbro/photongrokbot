import { cp, mkdir, rm, writeFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = resolve(root, '.vercel/output');
await rm(output, { recursive: true, force: true });
const fn = resolve(output, 'functions/index.func');
await mkdir(fn, { recursive: true });
for (const name of ['index.mjs', 'src', 'public']) await cp(resolve(root, name), resolve(fn, name), { recursive: true });
const matrix = resolve(fn, 'grokbot-matrix');
await mkdir(matrix, { recursive: true });
for (const name of ['mini-card.css', 'square-animation.js', 'dot-matrix.js', 'mini-core.js', 'mini-card.js']) {
  await cp(resolve(root, 'grokbot-matrix', name), resolve(matrix, name));
}

// Production ABS may only have the 304-byte stub. Pull the real Grokbot
// animation (~103KB, window.GROKBOT_SQUARE) from private Blob during build.
const squareDest = resolve(matrix, 'square-animation.js');
const squareSize = (await stat(squareDest)).size;
if (squareSize < 10_000) {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) throw new Error(`square-animation.js is stub-sized (${squareSize}b) and BLOB_READ_WRITE_TOKEN is missing`);
  const storeId = String(token).split('_')[3];
  if (!storeId) throw new Error('Invalid BLOB_READ_WRITE_TOKEN: cannot parse store id');
  const pathname = process.env.SQUARE_ANIMATION_BLOB_PATH || 'live-task-cards/grokbot-matrix/square-animation.js';
  const url = `https://${storeId}.private.blob.vercel-storage.com/${pathname}`;
  const res = await fetch(url, {
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`Failed to fetch full square-animation.js from Blob: ${res.status} ${res.statusText}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.byteLength < 10_000 || !buf.includes(Buffer.from('GROKBOT_SQUARE'))) {
    throw new Error(`Blob square-animation.js invalid (size=${buf.byteLength})`);
  }
  await writeFile(squareDest, buf);
  console.log(`Replaced stub square-animation.js (${squareSize}b) with Blob full (${buf.byteLength}b)`);
}

await writeFile(resolve(fn, '.vc-config.json'), JSON.stringify({ runtime: 'nodejs22.x', handler: 'index.mjs', launcherType: 'Nodejs', shouldAddHelpers: false, maxDuration: 30 }, null, 2));
await writeFile(resolve(output, 'config.json'), JSON.stringify({ version: 3, routes: [{ src: '/(.*)', dest: '/index?__path=/$1' }] }, null, 2));
console.log('Built .vercel/output (one Node function; Blob via src/vercel-blob-lite.mjs; no credentials).');
