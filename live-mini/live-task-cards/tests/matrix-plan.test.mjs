import test from 'node:test';
import assert from 'node:assert/strict';
import { matrixPresentation } from '../public/matrix-presentation.mjs';
import { parseContent } from '../src/model.mjs';
import { payload } from './helpers.mjs';

test('queue promotes the same planned step only after saved stage advancement', async () => {
  const content = (await payload('matrix')).content;
  const first = matrixPresentation(parseContent(content));
  assert.deepEqual(first.activityPlan.map(r => [r.id, r.cue]), [['verify', 'Now'], ['analyze', 'Next'], ['report', 'Later']]);
  content.workflow.weights[1].paceSeconds = 1;
  assert.equal(matrixPresentation(parseContent(content)).activityPlan[0].id, 'verify', 'a full counter alone must not advance the plan');
  content.stages[1].state = 'done'; content.stages[2].state = 'active';
  const advanced = matrixPresentation(parseContent(content));
  assert.deepEqual(advanced.activityPlan.map(r => [r.id, r.cue]), [['analyze', 'Now'], ['report', 'Next'], ['deliver', 'Later']]);
  assert.equal(advanced.activityPlan[0].label, first.activityPlan[1].label);
});

test('waiting preserves the upcoming plan; terminal states remove it', async () => {
  const content = (await payload('matrix')).content;
  content.status = 'waiting'; content.stages[1].state = 'blocked'; content.detail.title = 'Awaiting source access';
  let rows = matrixPresentation(parseContent(content)).activityPlan;
  assert.equal(rows[0].cue, 'Wait'); assert.equal(rows[0].label, 'Awaiting source access');
  assert.equal(rows[1].id, 'analyze');
  for (const status of ['failed', 'cancelled', 'completed']) {
    const end = structuredClone(content); end.status = status; end.detail.title = 'Final outcome';
    if (status === 'completed') { end.stages.forEach(s => s.state = 'done');  }
    rows = matrixPresentation(parseContent(end)).activityPlan;
    assert.equal(rows.length, 1); assert.equal(rows[0].id, 'outcome'); assert.equal(rows[0].label, 'Final outcome');
  }
});

test('queued work labels future intent instead of claiming it has started', async () => {
  const content = (await payload('matrix')).content;
  content.status = 'queued'; content.stages.forEach(s => s.state = 'pending');
  assert.deepEqual(matrixPresentation(parseContent(content)).activityPlan.map(r => r.cue), ['Next', 'Then', 'Later']);
});
