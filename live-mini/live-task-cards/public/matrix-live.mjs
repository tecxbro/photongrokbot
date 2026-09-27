import { loaderAnimation } from '/loader-animation.mjs';
import { matrixPresentation } from '/matrix-presentation.mjs';
import { matrixPalette } from '/task-matrix.mjs';
let card, frame, preference, cleanup, estimateTimer, currentContent, currentTiming, fallbackTiming, previousStatus;
function schedule() { if(card && !document.hidden && !frame)frame=requestAnimationFrame(tick); }
function tick() {
  frame=null;if(!card||document.hidden)return;
  card.tick();
  if(card.motion || (card.targetView==='grokbot'&&!card.reducedMotion))schedule();
}
window.addEventListener('cardthemechange',()=>{if(card){Object.assign(card.renderer,matrixPalette);card.render();}});
function data(content, timing) {
  if (content.workflow && !timing) {
    const now = Date.now();
    const stageId = content.stages.find(stage => stage.state !== 'done')?.id ?? null;
    if (!fallbackTiming || fallbackTiming.stageId !== stageId) {
      fallbackTiming = { stageId, elapsedMs: 0, resumedAt: content.status === 'running' ? new Date(now).toISOString() : null };
    } else if (previousStatus !== content.status) {
      fallbackTiming.elapsedMs += fallbackTiming.resumedAt ? Math.max(0, now - Date.parse(fallbackTiming.resumedAt)) : 0;
      fallbackTiming.resumedAt = content.status === 'running' ? new Date(now).toISOString() : null;
    }
    timing = fallbackTiming;
  }
  previousStatus = content.status;
  return matrixPresentation(content, timing);
}
function estimate() {
  clearTimeout(estimateTimer);
  if (!card || !currentContent?.workflow || document.hidden) return;
  const next = data(currentContent, currentTiming);
  card.setState(next); schedule();
  if (!next.progress.holding) estimateTimer = setTimeout(estimate, preference.matches ? 1000 : 100);
}
export function mountMatrix(root,content,timing,loader) {
  if(card)return card;
  const element=root.querySelector('.mini-card');
  if(!element||!window.MatrixCardCore||!window.GrokbotMatrixCard||!window.GROKBOT_SQUARE)return null;
  currentContent=content;currentTiming=timing;
  preference=matchMedia('(prefers-reduced-motion: reduce)');
  card=new GrokbotMatrixCard(element,loaderAnimation(loader),{initial:data(content,timing),reducedMotion:preference.matches});
  element.dataset.status=content.status;
  element.classList.toggle('motion-paused',document.hidden);
  Object.assign(card.renderer,matrixPalette);card.render();
  const motion=()=>{card.lastTime=card.clock();card.setReducedMotion(preference.matches);schedule();};
  const visibility=()=>{element.classList.toggle('motion-paused',document.hidden);clearTimeout(estimateTimer);cancelAnimationFrame(frame);frame=null;if(!document.hidden){card.lastTime=card.clock();estimate();schedule();}};
  preference.addEventListener('change',motion);document.addEventListener('visibilitychange',visibility);
  element.addEventListener('click',schedule);element.addEventListener('keydown',schedule);
  cleanup=()=>{preference.removeEventListener('change',motion);document.removeEventListener('visibilitychange',visibility);element.removeEventListener('click',schedule);element.removeEventListener('keydown',schedule);};
  estimate();schedule();
  window.GrokbotMini={setState:next=>{card.setState(next);schedule();},toggleView:()=>{card.toggleView();schedule();},get state(){return card.state;}};
  return card;
}
export function updateMatrix(content,timing,loader) {
  if(!card)return;
  if ((loader?.id ?? 'grokbot') !== card.animation.id) card.setAnimation(loaderAnimation(loader));
  currentContent=content;currentTiming=timing;
  const old=card.counter.textContent;
  card.root.dataset.status=content.status;
  card.setState(data(content,timing));
  if(old!==card.counter.textContent && !preference.matches && !document.hidden) {
    card.counter.getAnimations().forEach(a=>a.cancel());
    card.counter.animate([{opacity:.45},{opacity:1}],{duration:180,easing:'ease-out'});
  }
  estimate();schedule();
}
export function stopMatrix(){clearTimeout(estimateTimer);fallbackTiming=null;currentContent=null;currentTiming=null;previousStatus=null;cancelAnimationFrame(frame);frame=null;cleanup?.();cleanup=null;card=null;}
