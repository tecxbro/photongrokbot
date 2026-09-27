import { setTaskLoader } from '/task-matrix.mjs';
import { renderCard } from '/card-template.mjs';
import { setCardTheme } from '/card-theme.mjs';
import { paintDots } from '/dot-progress.mjs';
import { mountMatrix, updateMatrix, stopMatrix } from '/matrix-live.mjs';

// One update path for real snapshots and illustrative playback. It never writes data.
export function createCardMotion(root, initial) {
  const preference = matchMedia('(prefers-reduced-motion: reduce)');
  let view = structuredClone(initial);
  const animations = new Set();
  const ghosts = new Set();
  function finish() {
    for (const animation of animations) animation.finish();
    for (const ghost of ghosts) ghost.remove();
    animations.clear(); ghosts.clear();
  }
  function animate(element, frames, duration) {
    if (preference.matches || document.hidden || !element?.animate) return;
    // Interrupt an incoming text transition from its current opacity/position.
    const prior = element.getAnimations().filter(a => animations.has(a));
    if (prior.length) {
      const current = getComputedStyle(element);
      frames[0] = { opacity: current.opacity, transform: current.transform };
      prior.forEach(a => { a.cancel(); animations.delete(a); });
    }
    const a = element.animate(frames, { duration, easing: 'cubic-bezier(.22,1,.36,1)' });
    animations.add(a); a.finished.then(() => animations.delete(a), () => animations.delete(a));
  }
  function ghost(element) {
    if (preference.matches || document.hidden || !element) return;
    const rect = element.getBoundingClientRect(), base = root.getBoundingClientRect();
    const copy = element.cloneNode(true);
    copy.querySelectorAll('[id]').forEach(n => n.removeAttribute('id')); copy.removeAttribute('id');
    copy.setAttribute('aria-hidden', 'true'); copy.inert = true;
    const wrapper = document.createElement('div'); wrapper.className = 'card-motion-ghost';
    wrapper.setAttribute('aria-hidden', 'true');
    Object.assign(wrapper.style, { left: `${rect.left-base.left}px`, top: `${rect.top-base.top}px`, width: `${rect.width}px`, height: `${rect.height}px` });
    wrapper.append(copy); root.append(wrapper); ghosts.add(wrapper);
    const a = wrapper.animate([{opacity:1,transform:'translateY(0)'},{opacity:0,transform:'translateY(-3px)'}], {duration:180,easing:'ease-out'});
    animations.add(a); a.finished.then(()=>{wrapper.remove();ghosts.delete(wrapper);animations.delete(a)},()=>{wrapper.remove();ghosts.delete(wrapper);animations.delete(a)});
  }
  function reconcile(current, next) {
    if (current.nodeType !== next.nodeType || current.nodeName !== next.nodeName) { current.replaceWith(next.cloneNode(true)); return; }
    if (current.nodeType === Node.TEXT_NODE) { if(current.textContent!==next.textContent)current.textContent=next.textContent; return; }
    if(current.nodeType!==Node.ELEMENT_NODE)return;
    // Keep meter nodes and CSS interpolation intact; paintDots sets their targets.
    if(current.classList.contains('dot-grid') && next.classList.contains('dot-grid') && current.children.length===next.children.length)return;
    for(const attr of [...current.attributes])if(!next.hasAttribute(attr.name))current.removeAttribute(attr.name);
    for(const attr of [...next.attributes])if(current.getAttribute(attr.name)!==attr.value)current.setAttribute(attr.name,attr.value);
    const old=[...current.childNodes], fresh=[...next.childNodes];
    for(let i=0;i<Math.max(old.length,fresh.length);i++) {
      if(!fresh[i])old[i].remove(); else if(!old[i])current.append(fresh[i].cloneNode(true)); else reconcile(old[i],fresh[i]);
    }
  }
  function refreshTime() {
    const time=root.querySelector('time'); if(!time)return;
    const date=new Date(view.updatedAt);
    time.dateTime=view.updatedAt; time.textContent=`Updated ${date.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}`;
    time.title=date.toLocaleString();
  }
  function update(next, { immediate=false }={}) {
    const prior=view; view=structuredClone(next);
    setCardTheme(view.content.theme);
    setTaskLoader(view.loader);
    const motion=!immediate && !preference.matches && !document.hidden;
    root.classList.toggle('motion-snap', !motion);
    // Only one outgoing layer per update. Rapid revisions never accumulate ghosts.
    for(const g of ghosts)g.remove(); ghosts.clear();
    if(view.content.template==='matrix') {
      if(prior.content.template!=='matrix') { stopMatrix();root.innerHTML=renderCard(view);mountMatrix(root,view.content,view.workflowTiming,view.loader); }
      else updateMatrix(view.content,view.workflowTiming,view.loader);
    } else {
      const template=document.createElement('template');template.innerHTML=renderCard(view);
      const article=root.querySelector('.task-card');
      if(!article) {stopMatrix();root.innerHTML=renderCard(view);}
      else {
        const nextArticle=template.content.firstElementChild;
        const summary=article.querySelector('.summary'), nextSummary=nextArticle.querySelector('.summary');
        const summaryChanged=summary?.className!==nextSummary?.className;
        const selectors=['h1','.subtitle','.status',...(summaryChanged?['.summary']:['.detail h2','.detail p','.count','.percent','.stage-count','.measure-label'])];
        const changed=selectors.filter(s=>article.querySelector(s)?.textContent!==nextArticle.querySelector(s)?.textContent || (s==='.summary'&&summaryChanged));
        if(motion)for(const s of changed)ghost(article.querySelector(s));
        reconcile(article,nextArticle);
        if(motion)for(const s of changed)animate(article.querySelector(s),[{opacity:0,transform:'translateY(3px)'},{opacity:1,transform:'translateY(0)'}],s==='.summary'?300:200);
      }
      paintDots(root,view.content,view.content.progress?.completed ?? 0,preference.matches || document.hidden);
    }
    refreshTime();
    if(!motion) { root.getBoundingClientRect(); root.classList.remove('motion-snap'); }
  }
  function visibility() {
    if(document.hidden){finish();root.classList.add('motion-snap');}
    else update(view,{immediate:true});
  }
  const reduced=()=>{finish();update(view,{immediate:true});};
  if(view.content.template==='matrix')mountMatrix(root,view.content,view.workflowTiming,view.loader);
  update(view,{immediate:true});
  document.addEventListener('visibilitychange',visibility);
  preference.addEventListener('change',reduced);
  return {update, get view(){return view;}, destroy(){finish();stopMatrix();document.removeEventListener('visibilitychange',visibility);preference.removeEventListener('change',reduced);}};
}
