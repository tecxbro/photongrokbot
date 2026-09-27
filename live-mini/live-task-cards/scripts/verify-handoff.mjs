import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
const root = fileURLToPath(new URL('../', import.meta.url));
const manifest = JSON.parse(await readFile(resolve(root, 'MANIFEST.sha256.json'), 'utf8'));
for (const [name, expected] of Object.entries(manifest)) {
  if (name.startsWith('/') || name.split('/').includes('..')) throw Error('Invalid manifest path');
  const actual = createHash('sha256').update(await readFile(resolve(root, name))).digest('hex');
  if (actual !== expected) throw Error(`Hash mismatch: ${name}`);
}
console.log(`Verified ${Object.keys(manifest).length} handoff source files.`);
