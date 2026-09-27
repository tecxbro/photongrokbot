import { loaderAnimation } from '/loader-animation.mjs';
// Presentation only: observes rendered task facts, never sends or changes task data.
import '/matrix/mini-core.js';
import '/matrix/square-animation.js';
import '/matrix/dot-matrix.js';

import { cardTheme, matrixPalette } from '/card-theme.mjs';
export { cardTheme, matrixPalette };

const root = document.getElementById('card-root');
const motion = matchMedia('(prefers-reduced-motion: reduce)');
const { Animation, DampedField } = window.MatrixCardCore;
let controller;
let currentLoader = JSON.parse(document.getElementById('card-data')?.textContent || 'null')?.loader ?? null;
export function setTaskLoader(loader) {
  if ((currentLoader?.id ?? 'grokbot') === (loader?.id ?? 'grokbot')) return;
  currentLoader = loader ?? null;
  controller?.replaceLoader();
}

class TaskMatrix {
  constructor() {
    this.time = 0; this.phase = 0; this.last = null; this.selected = false;
    this.animation = loaderAnimation(currentLoader);
    this.empty = new Float64Array(this.animation.columns * this.animation.rows);
    this.dots = new DampedField(this.empty);
    this.reveal = new DampedField([0]);
    this.shell = document.createElement('div');
    this.shell.className = 'task-matrix-shell';
    root.before(this.shell); this.shell.append(root);
    this.panel = document.createElement('div');
    this.panel.className = 'task-character'; this.panel.setAttribute('aria-hidden', 'true');
    this.panel.innerHTML = '<div class="task-character-inner"><canvas class="task-character-canvas"></canvas><div class="task-character-footer"><p class="task-character-title"></p><div class="task-character-line"><span class="task-character-activity"></span><span class="task-character-count"></span></div><p class="task-character-status"></p></div></div>';
    this.button = document.createElement('button');
    this.button.className = 'task-matrix-toggle'; this.button.type = 'button';
    this.button.setAttribute('aria-pressed', 'false');
    this.shell.append(this.panel, this.button);
    this.renderer = new window.DotMatrix(this.panel.querySelector('canvas'), { columns: this.animation.columns, rows: this.animation.rows, ...matrixPalette });
    this.button.addEventListener('click', () => this.toggle());
    // Ignore held keys; a single Enter/Space press remains a native button click.
    this.button.addEventListener('keydown', event => { if (event.repeat) event.preventDefault(); });
    this.sync(); this.paint(); this.schedule();
  }
  replaceLoader() {
    this.animation = loaderAnimation(currentLoader); this.phase = 0;
    this.empty = new Float64Array(this.animation.columns * this.animation.rows);
    this.dots = new DampedField(this.selected ? this.animation.sampleLoop(0) : this.empty, this.time);
    this.reveal.reset([this.selected ? 1 : 0], this.time);
    this.renderer.configure(this.animation.columns, this.animation.rows);
    this.label(); this.paint(); this.schedule();
  }
  sync() {
    const task = root.querySelector('.task-card');
    if (!task) return;
    const text = selector => task.querySelector(selector)?.textContent.trim() || '';
    this.title = text('h1'); this.activity = text('.detail h2');
    this.count = text('.summary .count') || text('.measure-label').match(/^\d+\s*\/\s*\d+/)?.[0] || text('.stage-count');
    this.status = text('.status');
    this.panel.querySelector('.task-character-title').textContent = this.title;
    this.panel.querySelector('.task-character-activity').textContent = this.activity;
    this.panel.querySelector('.task-character-count').textContent = this.count;
    this.panel.querySelector('.task-character-status').textContent = this.status;
    this.label();
  }
  label() {
    this.button.setAttribute('aria-label', `${this.selected ? 'Show task details' : `Show ${this.animation.name}`}. ${this.title}. ${this.status}. ${this.activity}. ${this.count}`);
    this.button.title = this.selected ? 'Show task details' : `Show ${this.animation.name}`;
  }
  toggle() {
    this.selected = !this.selected;
    this.button.setAttribute('aria-pressed', String(this.selected));
    root.setAttribute('aria-hidden', String(this.selected));
    this.label();
    const options = { immediate: motion.matches, omega: 20 };
    this.reveal.retarget([this.selected ? 1 : 0], this.time, options);
    this.dots.retarget(this.selected ? this.animation.sampleLoop(this.phase) : this.empty, this.time,
      { ...options, columns: this.animation.columns, rows: this.animation.rows, style: 'morph', reverse: !this.selected, omega: 18 });
    this.paint(); this.schedule();
  }
  paint() {
    this.shell.style.setProperty('--character-reveal', this.reveal.values[0]);
    this.shell.dataset.view = this.reveal.settled && this.dots.settled ? (this.selected ? 'grokbot' : 'task') : 'transition';
    this.renderer.render(this.dots.values);
  }
  tick(timestamp) {
    this.frame = null;
    const dt = this.last === null ? 0 : Math.max(0, (timestamp - this.last) / 1000);
    this.last = timestamp; this.time += dt;
    const settled = this.reveal.settled && this.dots.settled;
    if (settled && this.selected && !motion.matches) {
      this.phase += dt;
      this.dots.reset(this.animation.sampleLoop(this.phase), this.time);
    } else { this.reveal.advance(this.time); this.dots.advance(this.time); }
    this.paint(); this.schedule();
  }
  schedule() {
    if (this.frame || document.hidden) return;
    if (!this.reveal.settled || !this.dots.settled || (this.selected && !motion.matches)) {
      this.frame = requestAnimationFrame(timestamp => this.tick(timestamp));
    } else this.last = null;
  }
  suspend() { cancelAnimationFrame(this.frame); this.frame = null; this.last = null; }
  reduceMotion() {
    this.phase = 0;
    this.reveal.reset([this.selected ? 1 : 0], this.time);
    this.dots.reset(this.selected ? this.animation.sampleLoop(0) : this.empty, this.time);
    this.suspend(); this.paint(); this.schedule();
  }
  destroy() {
    this.suspend(); root.removeAttribute('aria-hidden');
    this.shell.before(root); this.shell.remove();
  }
  get state() { return { loaderId: this.animation.id, columns: this.animation.columns, rows: this.animation.rows, selected: this.selected, mode: this.shell.dataset.view, theme: cardTheme, phase: this.phase, title: this.title, activity: this.activity, count: this.count }; }
}
function synchronize() {
  if (root.querySelector('.task-card')) {
    if (!controller) controller = new TaskMatrix();
    else controller.sync();
  } else if (controller) { controller.destroy(); controller = null; }
}
if (root) {
  synchronize();
  new MutationObserver(synchronize).observe(root, { subtree: true, childList: true, characterData: true });
  document.addEventListener('visibilitychange', () => {
    if (!controller) return;
    controller.suspend(); if (!document.hidden) controller.schedule();
  });
  motion.addEventListener('change', () => controller?.reduceMotion());
  window.addEventListener('resize', () => controller?.paint());
  window.addEventListener('cardthemechange', () => {
    if (controller) { Object.assign(controller.renderer, matrixPalette); controller.paint(); }
  });
  window.TaskMatrix = { get state() { return controller?.state ?? null; } };
}
