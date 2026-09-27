import { createCardMotion } from '/card-motion.mjs';

const initial = document.getElementById('card-data');
let view = initial ? JSON.parse(initial.textContent) : null;
let timer, inFlight = false, stopped = false, failures = 0;
const root = document.getElementById('card-root');
const key = new URLSearchParams(location.search).get('k');
const intervalMs = 10_000;
const terminal = new Set(['completed', 'failed', 'cancelled']);

const motion = view ? createCardMotion(root, view) : null;
function applyView(next) { view=next; motion?.update(next); }

function note(message) {
  const el = root.querySelector('.refresh-note');
  if (el) el.textContent = message;
}
function schedule(ms = intervalMs) {
  clearTimeout(timer);
  if (!stopped && key && !document.hidden && view && !terminal.has(view.content.status)) timer = setTimeout(refresh, ms);
}
async function refresh() {
  if (inFlight || stopped || document.hidden || !view || !key) return;
  inFlight = true;
  try {
    const response = await fetch(`/api/view/${encodeURIComponent(view.slot)}/${encodeURIComponent(view.id)}`, {
      headers: { Authorization: `Bearer ${key}` }, cache: 'no-store', credentials: 'omit',
      signal: AbortSignal.timeout(8000), redirect: 'error',
    });
    if (response.status === 404 || response.status === 410) {
      stopped = true; motion?.destroy();
      root.innerHTML = '<div class="unavailable">This card is no longer available.</div>';
      return;
    }
    if (!response.ok) throw new Error('refresh unavailable');
    const next = await response.json();
    if (next.id !== view.id || next.slot !== view.slot) throw new Error('identity mismatch');
    if (Number.isSafeInteger(next.revision) && next.revision > view.revision) applyView(next);
    failures = 0; note('');
  } catch { failures++; note('Updates delayed'); }
  finally { inFlight = false; schedule(Math.min(60_000, intervalMs * 2 ** Math.min(failures, 3))); }
}
schedule();
document.addEventListener('visibilitychange', () => {
  clearTimeout(timer);
  if (!document.hidden && !stopped) refresh();
});
window.addEventListener('pageshow', () => { if (!stopped) refresh(); });
// Polling reads saved task state only. It never wakes Grokbot or executes an action.
