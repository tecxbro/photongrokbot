#!/usr/bin/env node
import { readFile, writeFile, stat } from 'node:fs/promises';
import { parseLoaderAsset, LOADER_BODY_LIMIT } from '../src/loaders.mjs';
const [source, destination] = process.argv.slice(2);
if (!source || !destination) throw Error('Usage: node scripts/prepare-loader.mjs <draft.json> <new-validated.json>');
if ((await stat(source)).size > LOADER_BODY_LIMIT) throw Error('Draft exceeds the loader upload limit.');
const asset = parseLoaderAsset(JSON.parse(await readFile(source, 'utf8')));
await writeFile(destination, JSON.stringify(asset) + '\n', { flag: 'wx', mode: 0o600 });
console.log(`Validated ${asset.kind} loader: ${asset.columns} × ${asset.rows}. This does not publish or select it.`);
