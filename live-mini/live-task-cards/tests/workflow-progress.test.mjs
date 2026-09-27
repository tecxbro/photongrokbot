import test from 'node:test';
import assert from 'node:assert/strict';
import { workflowProgress } from '../public/workflow-progress.mjs';
import { parseContent } from '../src/model.mjs';
import { fixture, payload } from './helpers.mjs';

test('whole-workflow estimates stay within weighted caps and never advance stages', async () => {
  const c = (await payload('matrix')).content;
  const time = { stageId: 'verify', elapsedMs: 0, resumedAt: '2026-09-26T00:00:00Z' };
  const start = Date.parse(time.resumedAt);
  assert.equal(workflowProgress(c, time, start).completed, 20);
  const middle = workflowProgress(c, time, start + 20_000).completed;
  assert.ok(middle > 20 && middle < 47);
  assert.equal(workflowProgress(c, time, start + 60_000).completed, 47);
  assert.equal(workflowProgress(c, time, start + 86400_000).completed, 47);
  assert.equal(c.stages[1].state, 'active');
  c.stages[1].state = 'done'; c.stages[2].state = 'active';
  assert.equal(workflowProgress(c, time, start + 86400_000).completed, 50, 'old phase clock cannot advance the new phase');
});

test('only confirmed completion reaches 100, including last-stage and failed cases', async () => {
  const c = (await payload('matrix')).content;
  c.stages.forEach((s, i) => s.state = i === 4 ? 'active' : 'done');
  const time = { stageId: 'deliver', elapsedMs: 86400_000, resumedAt: null };
  assert.equal(workflowProgress(c, time).completed, 99);
  for (const status of ['waiting', 'failed', 'cancelled']) {
    c.status = status; c.stages[4].state = 'blocked';
    assert.equal(workflowProgress(parseContent(c), time).completed, 99);
  }
  c.status = 'completed'; c.stages[4].state = 'done';
  const result = workflowProgress(parseContent(c), time);
  assert.equal(result.completed, 100); assert.equal(result.estimated, false);
});

test('workflow weights require a complete ordered positive 100-point budget', async () => {
  const c = (await payload('matrix')).content;
  for (const mutate of [
    c => c.workflow.weights[0].weight = 0,
    c => c.workflow.weights[0].weight = 21,
    c => c.workflow.weights[0].paceSeconds = -1,
    c => c.workflow.weights[0].stageId = 'wrong',
    c => c.workflow.weights.pop(),
    c => c.progress = { completed: 41, total: 100, unit: 'profiles' },
  ]) { const invalid = structuredClone(c); mutate(invalid); assert.throws(() => parseContent(invalid)); }
  assert.equal(parseContent(c).stages.length, 5);
});

test('saved clock survives theme updates, pauses and reopening; estimate causes no writes', async t => {
  let now = Date.parse('2026-09-26T00:00:00Z');
  const { service } = await fixture(t, { options: { clock: () => new Date(now) } });
  let r = await service.create(await payload('matrix'));
  now += 10_000;
  const c = structuredClone(r.content); c.theme = 'light';
  r = await service.update(r.id, { requestId: 'theme', expectedRevision: r.revision, content: c });
  assert.equal(r.workflowTiming.elapsedMs, 10_000);
  c.status = 'waiting'; c.stages[1].state = 'blocked';
  now += 5_000;
  r = await service.update(r.id, { requestId: 'pause', expectedRevision: r.revision, content: c });
  const frozen = workflowProgress(c, r.workflowTiming, now).completed;
  now += 600_000;
  assert.equal(workflowProgress(c, r.workflowTiming, now).completed, frozen);
  const reopened = await service.view(r.slot, r.id, service.key(r));
  assert.equal(workflowProgress(reopened.content, reopened.workflowTiming, now).completed, frozen);
  c.status = 'running'; c.stages[1].state = 'active';
  r = await service.update(r.id, { requestId: 'resume', expectedRevision: r.revision, content: c });
  assert.equal(r.workflowTiming.elapsedMs, 15_000);
  assert.equal(workflowProgress(c, r.workflowTiming, now).completed, frozen);
  for (let i = 0; i < 100; i++) workflowProgress(c, r.workflowTiming, now + i * 1000);
  assert.equal((await service.get(r.id)).revision, r.revision);
  c.stages[1].state = 'done'; c.stages[2].state = 'active';
  r = await service.update(r.id, { requestId: 'analyze', expectedRevision: r.revision, content: c });
  assert.equal(r.workflowTiming.stageId, 'analyze'); assert.equal(r.workflowTiming.elapsedMs, 0);
  assert.equal(workflowProgress(c, r.workflowTiming, now).completed, 50);
});

test('workflow budgets and confirmed stages cannot be rewritten backward', async t => {
  const { service } = await fixture(t);
  const r = await service.create(await payload('matrix'));
  const c = structuredClone(r.content);
  c.workflow.weights[0].weight--; c.workflow.weights[1].weight++;
  await assert.rejects(service.update(r.id, { requestId: 'reweight', expectedRevision: r.revision, content: c }), { code: 'WORKFLOW_CONFLICT' });
  const back = structuredClone(r.content); back.stages[0].state = 'active'; back.stages[1].state = 'pending';
  await assert.rejects(service.update(r.id, { requestId: 'backward', expectedRevision: r.revision, content: back }), { code: 'WORKFLOW_CONFLICT' });
});
