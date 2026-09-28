import { cp, mkdir, rm, writeFile, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = resolve(root, '.vercel/output');
const animation = await readFile(resolve(root, 'grokbot-matrix/square-animation.js'));
if(createHash('sha256').update(animation).digest('hex')!=='1a84ddb9935ef3375e7d743208537fb3845c404dea61d2f984f81247c4f38cac')throw new Error('Committed animation asset failed integrity check.');
await rm(output, { recursive: true, force: true });
const fn = resolve(output, 'functions/index.func');
await mkdir(fn, { recursive: true });
for (const name of ['index.mjs', 'src', 'public']) await cp(resolve(root, name), resolve(fn, name), { recursive: true });
const matrix = resolve(fn, 'grokbot-matrix');
await mkdir(matrix, { recursive: true });
for (const name of ['mini-card.css', 'square-animation.js', 'dot-matrix.js', 'mini-core.js', 'mini-card.js']) await cp(resolve(root, 'grokbot-matrix', name), resolve(matrix, name));
// Only bundle the dependency adapter. Keeping host source layout preserves all
// new URL('../public/...', import.meta.url) asset resolution in the function.
await build({entryPoints:[resolve(root,'src/blob-sdk.mjs')],outfile:resolve(fn,'src/blob-sdk.mjs'),bundle:true,platform:'node',target:'node22',format:'esm',banner:{js:'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);'},logLevel:'silent'});
await writeFile(resolve(fn, '.vc-config.json'), JSON.stringify({ runtime: 'nodejs22.x', handler: 'index.mjs', launcherType: 'Nodejs', shouldAddHelpers: false, maxDuration: 30 }, null, 2));
await writeFile(resolve(output, 'config.json'), JSON.stringify({ version: 3, routes: [{ src: '/(.*)', dest: '/index?__path=/$1' }] }, null, 2));
console.log('Built .vercel/output with bundled official Blob SDK and verified committed assets.');
