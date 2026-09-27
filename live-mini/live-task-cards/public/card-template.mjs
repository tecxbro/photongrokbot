import { workflowProgress } from './workflow-progress.mjs';
// Shared by Node SSR and the browser. All text is escaped; no task-supplied HTML/CSS.
export const HEADER_ASSETS = Object.freeze({
  none: null, study: '/assets/study.png', hands: '/assets/hands.png',
});
export const STATUS_LABELS = Object.freeze({
  queued: 'Queued', running: 'In progress', waiting: 'Waiting',
  completed: 'Complete', failed: 'Failed', cancelled: 'Cancelled',
});
export function escapeHTML(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}
const check = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4.5 4.5L19 7"/></svg>';
const pause = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6v12M15 6v12"/></svg>';
const cross = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 7 10 10M17 7 7 17"/></svg>';
function icon(state) { return state === 'done' ? check : state === 'blocked' ? pause : ''; }
const clamp = n => Math.max(0, Math.min(1, n));
function safeRatio(p) { return p && p.total > 0 ? clamp(p.completed / p.total) : null; }
function count(p) { return `${p.completed} / ${p.total}`; }
function progressLabel(p) { return `${p.completed} of ${p.total} ${p.unit}`; }

/** Exact one-item dots up to 50; proportional 50-dot meter for larger batches. */
export function dots(p) {
  const n = Math.min(p.total, 50), ratio = safeRatio(p);
  const columns = n >= 10 ? 10 : n;
  const cells = Array.from({ length: n }, (_, i) => {
    const fraction = p.total <= 50 ? (i < p.completed ? 1 : 0) : clamp(ratio * n - i);
    return `<span class="dot" data-fill="${fraction === 1 ? 'full' : fraction === 0 ? 'empty' : 'partial'}" aria-hidden="true"><i data-target="${fraction}" style="transform:scaleX(${fraction})"></i></span>`;
  }).join('');
  return `<div class="dot-grid" role="img" aria-label="${escapeHTML(progressLabel(p))}" style="--columns:${columns}">${cells}</div>`;
}
export function segments(p) {
  const ratio = safeRatio(p);
  return `<div class="segments" role="progressbar" aria-label="${escapeHTML(p.unit)}" aria-valuemin="0" aria-valuemax="${p.total}" aria-valuenow="${p.completed}">${Array.from({ length: 10 }, (_, i) => {
    const fill = clamp(ratio * 10 - i);
    return `<span class="segment" aria-hidden="true"><i style="transform:scaleX(${fill})"></i></span>`;
  }).join('')}</div>`;
}
function stepper(c) {
  return `<ol class="stepper" aria-label="Task stages" style="--stage-count:${c.stages.length}">${c.stages.map((s, i) => `
    <li class="step step--${s.state}" ${s.state === 'active' || s.state === 'blocked' ? 'aria-current="step"' : ''}>
      <span class="step-marker" aria-hidden="true">${icon(s.state)}</span>
      <span class="step-label" title="${escapeHTML(s.label)}">${escapeHTML(s.label)}</span>
      <span class="sr-only">: ${escapeHTML(s.state)}</span>
      ${i < c.stages.length - 1 ? '<span class="step-line" aria-hidden="true"></span>' : ''}
    </li>`).join('')}</ol>`;
}
function detail(c) {
  return `<div class="detail"><h2 title="${escapeHTML(c.detail.title)}">${escapeHTML(c.detail.title)}</h2><p title="${escapeHTML(c.detail.subtitle)}">${escapeHTML(c.detail.subtitle)}</p></div>`;
}
function bottom(c) {
  if (['completed', 'failed', 'cancelled', 'waiting', 'queued'].includes(c.status)) {
    const statusIcon = c.status === 'completed' ? check : c.status === 'failed' || c.status === 'cancelled' ? cross : pause;
    return `<section class="summary terminal-summary"><span class="terminal-icon" aria-hidden="true">${statusIcon}</span>${detail(c)}${c.progress ? `<span class="count">${escapeHTML(count(c.progress))}</span>` : ''}</section>`;
  }
  if (c.template === 'dots' && c.progress) {
    return `<section class="summary dot-summary">${dots(c.progress)}<div class="detail-stack">${detail(c)}<span class="count">${escapeHTML(count(c.progress))}</span><span class="sr-only">${escapeHTML(c.progress.unit)}</span></div></section>`;
  }
  if (c.template === 'segments' && c.progress) {
    // This percentage belongs to the named measurable unit, never to guessed total task effort.
    const percent = Math.floor(safeRatio(c.progress) * 100);
    return `<section class="summary segment-summary"><div class="summary-row">${detail(c)}<span class="percent" title="${escapeHTML(progressLabel(c.progress))}">${percent}%</span></div>${segments(c.progress)}<span class="measure-label">${escapeHTML(count(c.progress))} ${escapeHTML(c.progress.unit)}</span></section>`;
  }
  const done = c.stages.filter(s => s.state === 'done').length;
  const active = c.stages.findIndex(s => s.state === 'active');
  return `<section class="summary stage-summary"><div class="summary-row">${detail(c)}<span class="stage-count">${active >= 0 ? `Step ${active + 1} / ${c.stages.length}` : `${done} / ${c.stages.length}`}</span></div><div class="small-stages" role="img" aria-label="${done} of ${c.stages.length} stages completed">${c.stages.map(s => `<span class="small-stage small-stage--${s.state}"></span>`).join('')}</div></section>`;
}
export function renderCard(view) {
  const c = view.content;
  const workflow = c.workflow ? workflowProgress(c, view.workflowTiming) : null;
  if (c.template === 'matrix') return `<article class="mini-card" id="mini-card" role="button" tabindex="0" aria-pressed="false" aria-label="${escapeHTML(c.title)}">
    <canvas class="matrix-display" aria-hidden="true"></canvas>
    <footer class="activity-strip"><div class="activity-window" aria-hidden="true"></div><p class="count" aria-hidden="true">${workflow ? `${workflow.estimated ? "~" : ""}${Math.floor(workflow.completed)} / 100` : escapeHTML(count(c.progress))}</p></footer>
    <span class="task-status sr-only" role="status" aria-live="polite"></span>
    <span class="refresh-note sr-only" role="status"></span>
    <time class="sr-only" datetime="${escapeHTML(view.updatedAt)}"></time>
  </article>`;
  return `<article class="task-card no-header" data-template="${c.template}" data-status="${c.status}" aria-label="${escapeHTML(c.title)}">
    <div class="card-body">
      <header class="intro">
        <div class="meta"><span title="${escapeHTML(c.eyebrow)}">${escapeHTML(c.eyebrow)}</span><span class="status">${STATUS_LABELS[c.status]}</span></div>
        <div class="title-row"><h1 title="${escapeHTML(c.title)}">${escapeHTML(c.title)}</h1>${c.template === 'stages' && c.status === 'running' ? '<span class="activity-ring" role="img" aria-label="Working; no percentage estimate"></span>' : ''}</div>
        ${c.subtitle ? `<p class="subtitle" title="${escapeHTML(c.subtitle)}">${escapeHTML(c.subtitle)}</p>` : ''}
      </header>
      <div class="divider" aria-hidden="true"></div>
      ${stepper(c)}
      ${bottom(c)}
      <footer class="freshness"><time datetime="${escapeHTML(view.updatedAt)}">Updated ${escapeHTML(view.updatedAt.slice(11, 16))} UTC</time><span class="refresh-note" role="status"></span></footer>
    </div>
  </article>`;
}
