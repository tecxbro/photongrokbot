import { assert } from './errors.mjs';

export const TEMPLATES = ['dots', 'segments', 'stages', 'matrix'];
export const ACTIVITY_ICONS = ['planning', 'verifying', 'researching', 'analyzing', 'report', 'working'];
export const STATUSES = ['queued', 'running', 'waiting', 'completed', 'failed', 'cancelled'];
export const STAGE_STATES = ['pending', 'active', 'done', 'blocked'];
export const HEADERS = ['none', 'study', 'hands'];
export const TERMINAL = new Set(['completed', 'failed', 'cancelled']);
export const SLOT_NAMES = Array.from({ length: 10 }, (_, i) => `live-${i + 1}`);
export const STATUS_LABEL = {
  queued: 'Queued', running: 'In progress', waiting: 'Waiting',
  completed: 'Complete', failed: 'Failed', cancelled: 'Cancelled',
};

export function object(value, name, keys) {
  assert(value !== null && typeof value === 'object' && !Array.isArray(value),
    'INVALID_INPUT', `${name} must be an object.`);
  assert(Object.keys(value).every(k => keys.includes(k)),
    'UNKNOWN_FIELD', `${name} contains an unsupported field.`);
  return value;
}
export function text(value, name, max, optional = false) {
  if (optional && value === undefined) return '';
  assert(typeof value === 'string', 'INVALID_INPUT', `${name} must be text.`);
  const result = value.trim();
  assert((optional || result.length > 0) && [...result].length <= max && !/[\x00-\x1f\x7f]/.test(result),
    'INVALID_INPUT', `${name} must be ${optional ? '0' : '1'}–${max} characters on one line.`);
  return result;
}
export function identifier(value, name = 'id', max = 128) {
  const result = text(value, name, max);
  assert(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(result), 'INVALID_INPUT', `${name} has invalid characters.`);
  return result;
}
export function integer(value, name, min, max) {
  assert(Number.isSafeInteger(value) && value >= min && value <= max,
    'INVALID_INPUT', `${name} must be an integer from ${min} to ${max}.`);
  return value;
}
function choice(value, name, choices) {
  assert(choices.includes(value), 'INVALID_INPUT', `${name} must be one of: ${choices.join(', ')}.`);
  return value;
}

/** Validate and normalize public display data. No HTML, styles, actions or external URLs. */
export function parseContent(input) {
  const c = object(input, 'content', [
    'template', 'theme', 'eyebrow', 'title', 'subtitle', 'status', 'stages', 'detail', 'progress', 'header', 'activityHistory', 'activityPlan', 'workflow',
  ]);
  const stages = c.stages;
  assert(Array.isArray(stages) && stages.length >= 2 && stages.length <= (c.template === 'matrix' ? 10 : 4),
    'INVALID_INPUT', 'Use 2–10 stages for matrix cards, or 2–4 for other layouts.');
  const parsedStages = stages.map((s, i) => {
    object(s, `stages[${i}]`, ['id', 'label', 'state']);
    return { id: identifier(s.id, 'stage.id', 32), label: text(s.label, 'stage.label', 12),
      state: choice(s.state, 'stage.state', STAGE_STATES) };
  });
  assert(new Set(parsedStages.map(s => s.id)).size === parsedStages.length,
    'INVALID_INPUT', 'Stage IDs must be unique.');
  const active = parsedStages.filter(s => s.state === 'active').length;
  const blocked = parsedStages.filter(s => s.state === 'blocked').length;
  assert(active <= 1 && blocked <= 1, 'INVALID_INPUT', 'Show at most one current or blocked stage.');
  const status = choice(c.status, 'status', STATUSES);
  if (status === 'running') assert(active === 1 && blocked === 0, 'INVALID_INPUT', 'Running requires one active stage.');
  if (status !== 'running') assert(active === 0, 'INVALID_INPUT', 'Only running work can have an active stage.');
  if (status === 'queued') assert(parsedStages.every(s => s.state === 'pending'), 'INVALID_INPUT', 'Queued stages must be pending.');
  if (status === 'completed') assert(parsedStages.every(s => s.state === 'done'), 'INVALID_INPUT', 'Complete only after every displayed stage is done.');
  if (blocked) assert(['waiting', 'failed', 'cancelled'].includes(status), 'INVALID_INPUT', 'Blocked stage requires a non-running state.');
  object(c.detail, 'detail', ['title', 'subtitle']);
  let progress = null;
  if (c.progress !== null && c.progress !== undefined) {
    object(c.progress, 'progress', ['completed', 'total', 'unit']);
    const total = integer(c.progress.total, 'progress.total', 1, 1_000_000);
    progress = { completed: integer(c.progress.completed, 'progress.completed', 0, total), total,
      unit: text(c.progress.unit, 'progress.unit', 32) };
    if (status === 'completed') assert(progress.completed === total, 'INVALID_INPUT', 'Completed cards cannot have unfinished measured work.');
  }
  let activityHistory = null;
  if (c.activityHistory != null) {
    assert(Array.isArray(c.activityHistory) && c.activityHistory.length >= 1 && c.activityHistory.length <= 3,
      'INVALID_INPUT', 'Activity history must contain 1–3 confirmed actions.');
    activityHistory = c.activityHistory.map((item, index) => {
      object(item, `activityHistory[${index}]`, ['icon', 'label']);
      return { icon: choice(item.icon, 'activity.icon', ACTIVITY_ICONS), label: text(item.label, 'activity.label', 50) };
    });
  }
  let activityPlan = null;
  if (c.activityPlan != null) {
    assert(c.template === 'matrix' && Array.isArray(c.activityPlan) && c.activityPlan.length === parsedStages.length,
      'INVALID_INPUT', 'Matrix activity plan must describe every stage in order.');
    assert(!activityHistory, 'INVALID_INPUT', 'Use activityPlan or legacy activityHistory, never both.');
    activityPlan = c.activityPlan.map((item, index) => {
      object(item, `activityPlan[${index}]`, ['stageId', 'icon', 'label']);
      assert(item.stageId === parsedStages[index].id, 'INVALID_INPUT', 'Plan stage IDs must match stages in order.');
      return { stageId: item.stageId, icon: choice(item.icon, 'activity.icon', ACTIVITY_ICONS),
        label: text(item.label, 'activity.label', 50) };
    });
    assert(TERMINAL.has(status) || parsedStages.some(stage => stage.state !== 'done'),
      'INVALID_INPUT', 'An active plan needs an unfinished stage.');
    // A queue cannot skip unfinished work or display a future step as current.
    let unfinished = false;
    parsedStages.forEach(stage => {
      if (stage.state === 'done') assert(!unfinished, 'INVALID_INPUT', 'Completed plan stages must form a prefix.');
      else {
        if (stage.state === 'active' || stage.state === 'blocked') assert(!unfinished, 'INVALID_INPUT', 'Current plan stage must be first unfinished.');
        unfinished = true;
      }
    });
  }
  let workflow = null;
  if (c.workflow != null) {
    object(c.workflow, 'workflow', ['weights']);
    assert(c.template === 'matrix' && activityPlan && !progress,
      'INVALID_INPUT', 'Workflow estimates require a matrix plan and progress: null.');
    assert(Array.isArray(c.workflow.weights) && c.workflow.weights.length === parsedStages.length,
      'INVALID_INPUT', 'Supply a weight for each planned stage.');
    const weights = c.workflow.weights.map((item, index) => {
      object(item, 'workflow weight', ['stageId', 'weight', 'paceSeconds']);
      assert(item.stageId === parsedStages[index].id, 'INVALID_INPUT', 'Weights must match stage IDs in order.');
      return { stageId: item.stageId, weight: integer(item.weight, 'weight', 1, 100),
        paceSeconds: integer(item.paceSeconds ?? 60, 'paceSeconds', 1, 86400) };
    });
    assert(weights.reduce((sum, item) => sum + item.weight, 0) === 100,
      'INVALID_INPUT', 'Workflow weights must sum to 100.');
    workflow = { weights };
  }
  if (c.template === 'matrix') {
    assert((progress || workflow) && (activityPlan || activityHistory), 'INVALID_INPUT', 'Matrix cards require a workflow estimate or measured progress and a plan.');
  }
  return {
    template: choice(c.template, 'template', TEMPLATES),
    theme: choice(c.theme ?? 'dark', 'theme', ['dark', 'light']),
    eyebrow: text(c.eyebrow ?? 'TASK', 'eyebrow', 20),
    title: text(c.title, 'title', 40),
    subtitle: text(c.subtitle, 'subtitle', 65, true), status, stages: parsedStages,
    detail: { title: text(c.detail.title, 'detail.title', 24),
      subtitle: text(c.detail.subtitle, 'detail.subtitle', 50, true) },
    progress, header: choice(c.header ?? 'none', 'header', HEADERS), activityHistory, activityPlan, workflow,
  };
}
export function parseCreate(input) {
  const b = object(input, 'create', ['requestId', 'taskId', 'conversationRef', 'ownerRef', 'content']);
  return {
    requestId: identifier(b.requestId, 'requestId'), taskId: identifier(b.taskId, 'taskId'),
    // Conversation reference is opaque; semicolons and E.164-like IDs are allowed.
    conversationRef: text(b.conversationRef, 'conversationRef', 256),
    ...(b.ownerRef === undefined ? {} : { ownerRef: text(b.ownerRef, 'ownerRef', 256) }), content: parseContent(b.content),
  };
}
export function parseUpdate(input) {
  const b = object(input, 'update', ['requestId', 'expectedRevision', 'content']);
  return { requestId: identifier(b.requestId, 'requestId'),
    expectedRevision: integer(b.expectedRevision, 'expectedRevision', 1, Number.MAX_SAFE_INTEGER),
    content: parseContent(b.content) };
}
export function emptyState() {
  return { schema: 1, version: 0, slots: Object.fromEntries(SLOT_NAMES.map(s => [s, null])), cards: {} };
}
export function checkState(s) {
  assert(s && s.schema === 1 && Number.isSafeInteger(s.version) && s.slots && s.cards,
    'STORE_CORRUPT', 'Stored schema is invalid; do not reset it automatically.', 503);
  const occupied = Object.values(s.slots).filter(Boolean);
  assert(SLOT_NAMES.every(k => Object.hasOwn(s.slots, k)) && Object.keys(s.slots).length === 10 &&
    new Set(occupied).size === occupied.length, 'STORE_CORRUPT', 'Slot registry is invalid.', 503);
  for (const [slot, id] of Object.entries(s.slots)) {
    if (id) assert(s.cards[id]?.slot === slot && !s.cards[id].archivedAt,
      'STORE_CORRUPT', 'Slot refers to a missing or archived card.', 503);
  }
  for (const r of Object.values(s.cards)) {
    assert(r && s.cards[r.id] === r && SLOT_NAMES.includes(r.slot), 'STORE_CORRUPT', 'Invalid card record.', 503);
    if (!r.archivedAt) assert(s.slots[r.slot] === r.id, 'STORE_CORRUPT', 'Active card is missing its slot.', 503);
  }
  return s;
}
