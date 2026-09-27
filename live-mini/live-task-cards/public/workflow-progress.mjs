// Local estimate only. This module never marks stages done or writes task state.
export function workflowProgress(content, timing, now = Date.now()) {
  if (!content.workflow) return content.progress;
  if (content.status === 'completed') return { completed: 100, total: 100, estimated: false, holding: true };
  const index = content.stages.findIndex(stage => stage.state !== 'done');
  const weights = content.workflow.weights;
  const start = weights.slice(0, index < 0 ? weights.length : index).reduce((sum, item) => sum + item.weight, 0);
  const budget = weights[index];
  if (!budget) return { completed: Math.min(99, start), total: 100, estimated: true, holding: true };
  const cap = Math.min(99, start + budget.weight - Math.max(1, Math.ceil(budget.weight * .1)));
  const sameStage = timing?.stageId === budget.stageId;
  const elapsed = sameStage ? timing.elapsedMs + (content.status === 'running' && timing.resumedAt
    ? Math.max(0, now - Date.parse(timing.resumedAt)) : 0) : 0;
  const fraction = Math.min(1, Math.max(0, elapsed / (budget.paceSeconds * 1000)));
  const completed = Math.min(cap, start + (cap - start) * (1 - (1 - fraction) ** 3));
  return { completed, total: 100, estimated: true,
    holding: content.status !== 'running' || fraction === 1 || cap === start };
}
