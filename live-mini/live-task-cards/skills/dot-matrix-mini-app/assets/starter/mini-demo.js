/* Preview wiring only: no automatic progress, view switches, or stage changes. */
'use strict';
(() => {
  const params = new URLSearchParams(location.search);
  const preference = matchMedia('(prefers-reduced-motion: reduce)');
  const animation = new MatrixCardCore.Animation(GROKBOT_SQUARE);
  const origin = performance.now() / 1000;
  let suspendedAt = null, suspendedDuration = 0, manualTime = params.has('capture') ? 0 : null;
  const clock = () => manualTime ?? ((suspendedAt ?? performance.now() / 1000) - origin - suspendedDuration);
  const initial = { progress: { completed: 41, total: 100 }, activityHistory: [
    { icon: 'working', label: 'Prepared workspace' },
    { icon: 'researching', label: 'Collected company sources' },
    { icon: 'verifying', label: 'Verifying company profiles' },
  ] };
  const cards = [...document.querySelectorAll('.mini-card')].map(root => new GrokbotMatrixCard(root, animation, {
    initial, clock, reducedMotion: preference.matches,
    transitionStyle: root.dataset.transitionStyle ?? (params.get('transition') === 'dissolve' ? 'dissolve' : 'morph'),
  }));
  const first = cards[0];
  function render() { const now = clock(); cards.forEach(card => card.tick(now)); }
  function toggleBoth() { const now = clock(); cards.forEach(card => card.toggleView(now)); }
  function update(next) { const now = clock(); cards.forEach(card => card.setState(next, now)); }
  function showDebug(show) {
    const bench = document.getElementById('workbench');
    if (bench) { bench.hidden = !show; document.body.classList.toggle('debug', show); }
  }
  function resetViews() { const now = clock(); cards.forEach(card => card.setView('progress', now)); }
  let activityIndex = 0;
  const activitySequence = ['analyzing', 'report', 'researching', 'verifying'];
  document.querySelectorAll('[data-action]').forEach(button => button.addEventListener('click', () => {
    if (button.dataset.action === 'toggle') toggleBoth();
    if (button.dataset.action === 'reset') resetViews();
    if (button.dataset.action === 'advance') update({ progress: { completed: Math.min(first.task.total, first.task.completed + 1), total: first.task.total } });
    if (button.dataset.action === 'activity') update({ activity: activitySequence[activityIndex++ % activitySequence.length] });
    syncControls();
  }));
  const style = document.getElementById('transition-style');
  if (style) { style.value = first.style; style.onchange = () => first.setTransitionStyle(style.value); }
  const confirmed = document.getElementById('confirmed');
  if (confirmed) confirmed.oninput = () => { update({ progress: { completed: Number(confirmed.value), total: first.task.total } }); syncControls(); };
  const activity = document.getElementById('activity-select');
  if (activity) activity.onchange = () => update({ activity: activity.value });
  function syncControls() {
    const output = document.getElementById('confirmed-value');
    if (output) output.textContent = `${first.task.completed} / ${first.task.total}`;
    if (confirmed) confirmed.value = first.task.completed;
  }
  document.addEventListener('keydown', event => {
    if (['INPUT', 'SELECT', 'BUTTON'].includes(event.target.tagName)) return;
    if (event.key.toLowerCase() === 'd') showDebug(document.getElementById('workbench')?.hidden ?? false);
    if (event.key === 'Escape') showDebug(false);
  });
  document.addEventListener('visibilitychange', () => {
    const now = performance.now() / 1000;
    if (document.hidden) suspendedAt = now;
    else if (suspendedAt !== null) { suspendedDuration += now - suspendedAt; suspendedAt = null; }
  });
  preference.addEventListener('change', () => cards.forEach(card => card.setReducedMotion(preference.matches)));
  window.addEventListener('resize', render);
  function tick() { if (manualTime === null && !document.hidden) render(); requestAnimationFrame(tick); }
  window.GrokbotMini = {
    setState: next => { first.setState(next); syncControls(); }, toggleView: () => first.toggleView(),
    setTransitionStyle: value => { first.setTransitionStyle(value); if (style) style.value = value; },
    showDebug, get state() { return first.state; },
  };
  window.MatrixPreview = {
    cards, toggleBoth, setState: update, resetViews,
    // Explicit opt-in deterministic clock for browser recordings and regression checks.
    setTime(time) {
      if (manualTime === null) throw new Error('Load with ?capture to use the deterministic clock.');
      if (!Number.isFinite(time) || time < manualTime) throw new RangeError('Capture time must be monotonic.');
      manualTime = time; render();
    },
    get time() { return clock(); },
  };
  if (params.has('debug')) showDebug(true);
  syncControls(); render(); requestAnimationFrame(tick);
})();
