import { readFile } from 'node:fs/promises';
import { parseContent } from './model.mjs';
const files = { research: 'research', checks: 'checks', stages: 'stages', matrix: 'matrix', complete: 'research', waiting: 'stages', unknown: 'checks' };
export async function demoView(name) {
  if (!Object.hasOwn(files, name)) return null;
  const data = JSON.parse(await readFile(new URL(`../examples/${files[name]}.json`, import.meta.url), 'utf8'));
  const c = data.content;
  if (name === 'complete') {
    c.status = 'completed'; c.stages.forEach(s => s.state = 'done');
    c.progress.completed = c.progress.total;
    c.detail = { title: 'Complete', subtitle: 'Report delivered in chat' };
  }
  if (name === 'waiting') {
    c.status = 'waiting'; c.stages.find(s => s.state === 'active').state = 'blocked';
    c.detail = { title: 'Waiting for your reply', subtitle: 'Answer in the conversation' };
  }
  if (name === 'unknown') {
    c.progress = null; c.header = 'none'; c.title = 'Build product';
    c.detail = { title: 'Testing', subtitle: 'No completion estimate' };
  }
  return { id: 'demo', slot: 'live-1', revision: 1, updatedAt: '2026-09-23T23:00:00.000Z', archived: false, content: parseContent(c) };
}
export function galleryHTML() {
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Live task cards — local examples</title><link rel="stylesheet" href="/gallery.css"><body><header><p>LIVE TASK CARDS / V1</p><h1>Four reusable layouts.</h1><p>Illustrative data only. No messages, orders or background work are executed.</p></header><main>${Object.keys(files).map(name => `<section><h2>${name}</h2><iframe title="${name} at 300 × 300" width="300" height="300" src="/demo/${name}"></iframe><p>300 × 300</p><iframe title="${name} at 300 × 240" width="300" height="240" src="/demo/${name}"></iframe><p>300 × 240 compact</p></section>`).join('')}</main></body></html>`;
}
