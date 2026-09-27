#!/usr/bin/env node
import { readFile, stat } from 'node:fs/promises';
import { PublisherClient } from '../src/client.mjs';
import { assert } from '../src/errors.mjs';

async function input(path) {
  let raw = '';
  if (path === '-') {
    for await (const chunk of process.stdin) { raw += chunk; assert(Buffer.byteLength(raw) <= 16384, 'BODY_TOO_LARGE', 'Input exceeds 16 KiB.'); }
  } else {
    assert(path, 'USAGE', 'Provide a JSON filename or - for stdin.');
    assert((await stat(path)).size <= 16384, 'BODY_TOO_LARGE', 'Input exceeds 16 KiB.');
    raw = await readFile(path, 'utf8');
  }
  return JSON.parse(raw);
}
const [command, a, b] = process.argv.slice(2);
if (!command || command === 'help' || command === '--help') {
  console.log(`live-card — task-page publishing, not an independent iMessage sender

  create <json-file|->
  update <card-id> <json-file|->
  get <card-id>
  slots
  doctor
  release <card-id> <final-revision>
  discard <unsent-card-id>
  settle <card-id> <settlement-json-file|->  (reconciliation only)

Uses PUBLIC_BASE_URL and PUBLISHER_TOKEN. Keep command output private: viewUrl is a read capability.
Use the supplied existing-runtime adapter to send/update the actual iMessage bubble.`);
  process.exit(0);
}
try {
  const client = new PublisherClient({ baseUrl: process.env.PUBLIC_BASE_URL, token: process.env.PUBLISHER_TOKEN });
  let result;
  if (command === 'create') result = await client.create(await input(a));
  else if (command === 'update') result = await client.update(a, await input(b));
  else if (command === 'get') result = await client.get(a);
  else if (command === 'slots') result = await client.slots();
  else if (command === 'doctor') result = await client.doctor();
  else if (command === 'release') result = await client.release(a, Number(b));
  else if (command === 'discard') result = await client.discard(a);
  else if (command === 'settle') result = await client.settlePresentation(a, await input(b));
  else throw new Error('Unknown command. Run help.');
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(JSON.stringify({ error: { code: error.code || 'COMMAND_FAILED', message: error.message } }));
  process.exitCode = 1;
}
