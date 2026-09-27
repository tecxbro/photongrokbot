import { workflowProgress } from './workflow-progress.mjs';
// Derive the visible queue from saved stage state. Never advance work here.
export function matrixPresentation(content, timing, now) {
  const progress = workflowProgress(content, timing, now);
  if (!content.activityPlan) return { progress, activityHistory: content.activityHistory };
  const terminal = ['completed', 'failed', 'cancelled'].includes(content.status);
  let rows;
  if (terminal) {
    rows = [{ id: 'outcome', icon: content.status === 'completed' ? 'report' : 'working',
      label: content.detail.title, cue: { completed: 'Done', failed: 'Failed', cancelled: 'Stopped' }[content.status] }];
  } else {
    rows = content.activityPlan.filter(item => content.stages.find(stage => stage.id === item.stageId)?.state !== 'done')
      .slice(0, 3).map((item, index) => ({ id: item.stageId, icon: item.icon,
        label: index === 0 && content.status === 'waiting' ? content.detail.title : item.label,
        cue: index === 0 ? { running: 'Now', waiting: 'Wait', queued: 'Next' }[content.status] : index === 1 ? (content.status === 'queued' ? 'Then' : 'Next') : 'Later' }));
  }
  return { progress, activityPlan: rows };
}
