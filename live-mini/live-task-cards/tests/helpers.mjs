import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { FileStore } from '../src/store.mjs';
import { CardService } from '../src/service.mjs';
import { createHandler } from '../src/http.mjs';
import { PublisherClient } from '../src/client.mjs';

export const config = () => ({ baseUrl: 'http://127.0.0.1:3000', viewSecret: 'v'.repeat(40), publisherToken: 'p'.repeat(40),
  archiveDays: 30, maxArchived: 100, demos: true, store: 'file' });
export async function payload(name = 'research') {
  return JSON.parse(await readFile(new URL(`../examples/${name}.json`, import.meta.url), 'utf8'));
}
export async function fixture(t, extra = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'ltc-'));
  const cfg = { ...config(), ...extra.config };
  const store = new FileStore(join(dir, 'cards.json'));
  const service = new CardService(store, cfg, extra.options);
  t.after(() => rm(dir, { recursive: true, force: true }));
  return { dir, config: cfg, store, service };
}
export async function httpFixture(t) {
  const f = await fixture(t);
  const server = createServer(createHandler(f.service, f.config));
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  f.config.baseUrl = `http://127.0.0.1:${server.address().port}`;
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  return { ...f, server, client: new PublisherClient({ baseUrl: f.config.baseUrl, token: f.config.publisherToken }) };
}
export function finished(content) {
  const c = structuredClone(content); c.status = 'completed';
  c.stages.forEach(s => s.state = 'done');
  if (c.progress) c.progress.completed = c.progress.total;
  c.detail = { title: 'Complete', subtitle: 'Result delivered in chat' };
  return c;
}
export async function accept(service, record) {
  const c = await service.beginPresentation(record.id, { revision: record.revision });
  return service.settlePresentation(record.id, { attemptId: c.attempt.id, outcome: 'accepted',
    messageRef: record.delivery.messageRef || `message-${record.id}` });
}
