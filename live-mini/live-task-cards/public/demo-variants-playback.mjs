import { createCardMotion } from '/card-motion.mjs';

// Review-only playback. No task state is written and no work is performed.
const root = document.getElementById('card-root');
const view = JSON.parse(document.getElementById('card-data').textContent);
const content = view.content;
const motion = createCardMotion(root, view);
const checks = content.template === 'segments';
const sequence = checks
  ? [
      { count: 0, stage: 0, title: 'Reproducing', subtitle: 'Inspecting the issue' },
      { count: 12, stage: 1, title: 'Diagnosing', subtitle: 'Tracing the failing path' },
      { count: 29, stage: 2, title: 'Patching', subtitle: 'Applying a sample fix' },
      { count: 43, stage: 3, title: 'Running checks', subtitle: 'Integration test suite' },
      { count: 50, stage: 4, title: 'Demo complete', subtitle: 'Simulated checks finished' },
    ]
  : [
      { stage: 0, title: 'Finding', subtitle: 'Reviewing sample options' },
      { stage: 1, title: 'Preparing', subtitle: 'Checking sample details' },
      { stage: 2, title: 'Ordering', subtitle: 'Simulated order in progress' },
      { stage: 3, title: 'Receiving', subtitle: 'Simulated confirmation' },
      { stage: 4, title: 'Demo complete', subtitle: 'No order was placed' },
    ];

function show(step) {
  content.status = step.stage === content.stages.length ? 'completed' : 'running';
  content.detail = { title: step.title, subtitle: step.subtitle };
  content.stages.forEach((stage, index) => {
    stage.state = index < step.stage ? 'done' : index === step.stage ? 'active' : 'pending';
  });
  if (checks) content.progress.completed = step.count;
  motion.update(view);
}

let index = 0;
show(sequence[index]);
let timer;
let dueAt = 0;
let remaining = 3500;
function schedule() {
  if (document.hidden || index === sequence.length - 1) return;
  dueAt = performance.now() + remaining;
  timer = setTimeout(() => {
    show(sequence[++index]);
    remaining = 3500;
    schedule();
  }, remaining);
}
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    clearTimeout(timer);
    remaining = Math.max(0, dueAt - performance.now());
  } else schedule();
});
schedule();
