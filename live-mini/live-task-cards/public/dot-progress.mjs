// A complete batch settles in <= 620 ms, regardless of the number of new dots.
export function dotDelay(index, changedCount) {
  return changedCount <= 1 ? 0 : Math.min(260, index * 260 / (changedCount - 1));
}
export function clearWaitingDot(root) {
  root.querySelector('.dot--waiting')?.classList.remove('dot--waiting');
}
export function paintDots(root, content, displayedCount, reducedMotion=false, confirmedCount=displayedCount) {
  const progress=content?.progress, grid=root.querySelector('.dot-grid');
  if(!progress || !grid)return;
  const dots=[...grid.querySelectorAll('.dot')];
  const position=confirmedCount*dots.length/progress.total;
  const changed=dots.filter((dot,index)=>Number(dot.querySelector('i').dataset.target)!==Math.max(0,Math.min(1,position-index))).length;
  let rank=0;
  clearWaitingDot(grid);
  dots.forEach((dot,index)=>{
    const fill=Math.max(0,Math.min(1,position-index)), ink=dot.querySelector('i');
    if(Number(ink.dataset.target)!==fill) {
      ink.style.transitionDelay=`${reducedMotion?0:dotDelay(rank++,changed)}ms`;
      ink.style.transform=`scaleX(${fill})`; ink.dataset.target=String(fill);
    }
    dot.dataset.fill=fill===1?'full':fill===0?'empty':'partial';
  });
  const counter=root.querySelector('.count'); if(counter)counter.textContent=`${confirmedCount} / ${progress.total}`;
  grid.setAttribute('aria-label',`${confirmedCount} of ${progress.total} ${progress.unit} confirmed`);
  if(content.status==='running' && confirmedCount<progress.total && !document.hidden && !reducedMotion)dots[Math.ceil(position)]?.classList.add('dot--waiting');
}
