import { createCardMotion } from '/card-motion.mjs';
const root=document.getElementById('card-root'), button=document.getElementById('play-from-start'), note=document.getElementById('playback-note');
const initial=JSON.parse(document.getElementById('card-data').textContent);
const motion=createCardMotion(root,initial);
const stageOrder=['source','verify','analyze','report'];
// Illustrative milestones use the same renderer as confirmed runtime updates.
const updates = [
  { count: 0, waitMs: 600, stage: 'source', title: 'Sourcing', subtitle: 'Collecting company leads' },
  { count: 3, waitMs: 600, stage: 'verify', title: 'Verifying', subtitle: 'First company profiles' },
  { count: 5, waitMs: 600, stage: 'verify', title: 'Verifying', subtitle: 'Company profiles' },
  { count: 19, waitMs: 3_000, stage: 'verify', title: 'Verifying', subtitle: 'Company profiles' },
  { count: 20, waitMs: 600, stage: 'verify', title: 'Verifying', subtitle: 'Company profiles' },
  { count: 37, waitMs: 600, stage: 'verify', title: 'Verifying', subtitle: 'Final company profiles' },
  { count: 50, waitMs: 1_200, stage: 'verify', title: 'Verifying', subtitle: 'Final company profiles' },
  { count: 50, waitMs: 1_500, stage: 'analyze', title: 'Analyzing', subtitle: 'Patterns across 50 profiles' },
  { count: 50, waitMs: 1_500, stage: 'report', title: 'Preparing report', subtitle: 'Summarizing findings' },
  { count: 50, waitMs: 0, stage: 'complete', title: 'Demo complete', subtitle: 'Simulated research finished' },
];

let view=structuredClone(initial), index=0, timer, due=0, remaining=1400, playing=false;
function show(immediate=false) {
  const step=updates[index], content=view.content, active=stageOrder.indexOf(step.stage);
  content.progress.completed=step.count;content.status=step.stage==='complete'?'completed':'running';
  content.detail={title:step.title,subtitle:step.subtitle};
  content.stages.forEach((s,i)=>s.state=step.stage==='complete'||i<active?'done':i===active?'active':'pending');
  motion.update(view,{immediate});
  note.textContent=index===updates.length-1?'Simulated research complete':`${step.count} profiles confirmed · illustrative data`;
}
function schedule() {
  clearTimeout(timer);if(!playing||document.hidden)return;
  due=performance.now()+remaining;
  timer=setTimeout(()=>{
    index++;show();remaining=Math.max(1400,updates[index].waitMs);
    if(index===updates.length-1){playing=false;button.textContent='Replay from dot 1';document.body.classList.remove('is-playing');}
    else schedule();
  },remaining);
}
button.addEventListener('click',()=>{
  if(playing){remaining=Math.max(0,due-performance.now());playing=false;clearTimeout(timer);button.textContent='Resume';}
  else{if(index===updates.length-1){index=0;view=structuredClone(initial);show(true);remaining=1400;}playing=true;button.textContent='Pause';schedule();}
  document.body.classList.toggle('is-playing',playing);
});
document.addEventListener('visibilitychange',()=>{
  if(document.hidden){if(playing)remaining=Math.max(0,due-performance.now());clearTimeout(timer);}
  else schedule();
});
show(true);
if(new URLSearchParams(location.search).get('auto')==='1')button.click();
