// Isolated demonstration: local estimates plus explicit simulated milestones.
import { createCardMotion } from '/card-motion.mjs';

const initial = JSON.parse(document.getElementById('card-data').textContent);
// Short pacing is only for the example. Real cards use Grokbot's saved pacing.
if (initial.content.workflow) initial.content.workflow.weights.forEach(item => item.paceSeconds = 6);
let view = structuredClone(initial);
function startClock() {
  view.workflowTiming = { stageId: view.content.stages.find(stage => stage.state === 'active')?.id ?? null,
    elapsedMs: 0, resumedAt: view.content.status === 'running' ? new Date().toISOString() : null };
}
startClock();
const motion = createCardMotion(document.getElementById('card-root'), view);
if (window.self === window.top) {
  document.body.classList.add('matrix-demo-page');
  const controls = document.createElement('div');
  controls.className = 'matrix-demo-controls';
  controls.innerHTML = '<button type="button" data-demo="advance"></button> <button type="button" data-demo="restart">Restart</button><p role="status">Simulated workflow · dots hold at each stage limit</p>';
  document.body.append(controls);
  const advance = controls.querySelector('[data-demo="advance"]');
  function label() {
    const i = view.content.stages.findIndex(stage => stage.state === 'active');
    advance.disabled = i < 0;
    advance.textContent = i < 0 ? 'Workflow complete' : view.content.stages[i + 1]
      ? `Confirm ${view.content.stages[i].label} → ${view.content.stages[i + 1].label}` : 'Confirm completion';
  }
  advance.addEventListener('click', () => {
    const i = view.content.stages.findIndex(stage => stage.state === 'active');
    if (i < 0) return;
    view.content.stages[i].state = 'done';
    const next = view.content.stages[i + 1];
    if (next) {
      next.state = 'active';
      view.content.detail = { title: next.label, subtitle: 'Simulated next stage' };
    } else {
      view.content.status = 'completed';
      view.content.detail = { title: 'Workflow complete', subtitle: 'Simulated result delivered' };
    }
    startClock(); motion.update(view); label();
  });
  controls.querySelector('[data-demo="restart"]').addEventListener('click', () => {
    view = structuredClone(initial); startClock(); motion.update(view, { immediate: true }); label();
  });
  label();
}
