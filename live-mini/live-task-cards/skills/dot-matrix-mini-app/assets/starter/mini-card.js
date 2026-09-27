/* Task data, selected view, and character timing are deliberately independent. */
'use strict';
(() => {
  const C = MatrixCardCore;
  const icons = {
    planning: { label: 'Planning', paths: ['M5 4h11M5 9h14M5 14h9', 'M2 4h.01M2 9h.01M2 14h.01'] },
    verifying: { label: 'Verifying company profiles', paths: ['M10 2 17 5v5c0 4-7 8-7 8S3 14 3 10V5l7-3Z', 'm6.5 9.5 2.4 2.4 4.6-4.6'] },
    researching: { label: 'Collecting sources', paths: ['M13.5 13.5 18 18', 'M15 8.5a6.5 6.5 0 1 1-13 0 6.5 6.5 0 0 1 13 0'] },
    analyzing: { label: 'Analyzing findings', paths: ['M3 3v14h15', 'M6 13V9M11 13V5M16 13V7'] },
    report: { label: 'Preparing report', paths: ['M5 2h7l4 4v12H5Z', 'M12 2v5h4', 'M8 10h5M8 13h5'] },
    working: { label: 'Preparing workspace', paths: ['M2 3h16v14H2Z', 'm5 7 3 3-3 3', 'M10 13h4'] },
  };
  function entry(value) {
    if (typeof value === 'string') {
      const icon = icons[value] ? value : 'working';
      return { icon, label: icons[value]?.label ?? value };
    }
    if (!value || typeof value.label !== 'string' || !value.label.trim()) throw new TypeError('Activity needs a label.');
    return { icon: icons[value.icon] ? value.icon : 'working', label: value.label };
  }
  function iconElement(name) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 20 20'); svg.setAttribute('aria-hidden', 'true');
    for (const d of icons[name].paths) {
      const path = document.createElementNS(svg.namespaceURI, 'path'); path.setAttribute('d', d); svg.append(path);
    }
    return svg;
  }
  class GrokbotMatrixCard {
    constructor(root, animation, { reducedMotion = false, transitionStyle = 'morph', clock = () => performance.now() / 1000, initial } = {}) {
      this.root = root; this.animation = animation; this.clock = clock; this.reducedMotion = reducedMotion;
      this.style = transitionStyle; this.view = 'progress'; this.targetView = 'progress';
      this.transitioning = false; this.characterTime = 0; this.lastTime = clock(); this.motion = null;
      this.task = { completed: initial?.progress?.completed ?? 41, total: initial?.progress?.total ?? 100,
        history: (initial?.activityHistory ?? [{ icon: 'verifying', label: 'Verifying company profiles' }]).map(entry).slice(-3) };
      this.field = new C.DampedField(C.progress(this.task.completed, this.task.total), this.lastTime);
      this.details = new C.DampedField([1], this.lastTime);
      root.classList.toggle('reduce-motion', reducedMotion);
      this.renderer = new DotMatrix(root.querySelector('canvas'), { columns: 14, rows: 14 });
      this.historyWindow = root.querySelector('.activity-window'); this.counter = root.querySelector('.count');
      this.rows = new Map(); this.historySignature = ''; this.syncHistory();
      root.addEventListener('click', () => this.toggleView());
      root.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.code === 'Space') {
          event.preventDefault(); if (!event.repeat) this.toggleView();
        }
      });
      this.render();
    }
    syncHistory() {
      const signature = JSON.stringify(this.task.history);
      if (signature === this.historySignature) return;
      const hadRows = this.rows.size > 0; this.historySignature = signature;
      const next = new Map(), occurrences = new Map();
      this.task.history.forEach((item, index) => {
        const base = `${item.icon}\u0000${item.label}`, occurrence = occurrences.get(base) ?? 0;
        occurrences.set(base, occurrence + 1); const key = `${base}\u0000${occurrence}`;
        let row = this.rows.get(key);
        if (!row) {
          row = document.createElement('div'); row.className = 'activity-row';
          if (!hadRows) { row.style.transition = 'none'; requestAnimationFrame(() => row.style.removeProperty('transition')); }
          const label = document.createElement('span'); label.className = 'activity-label'; label.textContent = item.label; label.title = item.label;
          const content = document.createElement('span'); content.className = 'activity-content';
          content.append(iconElement(item.icon), label); row.append(content); this.historyWindow.append(row);
          row.style.setProperty('--y', hadRows && !this.reducedMotion ? '54px' : `${(3 - this.task.history.length + index) * 18}px`);
          row.style.setProperty('--alpha', '0');
        }
        next.set(key, row);
      });
      // Establish entry positions before applying destinations, including in file:// previews.
      this.historyWindow.getBoundingClientRect();
      let index = 0;
      for (const row of next.values()) {
        const depth = next.size - 1 - index++;
        row.dataset.depth = String(depth); row.style.setProperty('--y', `${36 - depth * 18}px`);
        row.style.setProperty('--alpha', String([1, .57, .3][depth]));
      }
      for (const [key, row] of this.rows) if (!next.has(key)) {
        row.classList.add('exiting'); row.style.setProperty('--y', '-18px'); row.style.setProperty('--alpha', '0');
        setTimeout(() => row.remove(), this.reducedMotion ? 0 : 340);
      }
      this.rows = next;
    }
    destination() {
      return this.targetView === 'grokbot' ? this.animation.sampleLoop(this.characterTime) : C.progress(this.task.completed, this.task.total);
    }
    beginViewTransition(now) {
      this.transitioning = true; this.motion = 'view'; this.viewTransitionEnd = now + .82;
      this.details.retarget([this.targetView === 'progress' ? 1 : 0], now, { omega: 22, immediate: this.reducedMotion });
      this.field.retarget(this.destination(), now, { style: this.style, reverse: this.targetView === 'progress', immediate: this.reducedMotion });
      if (this.reducedMotion) { this.view = this.targetView; this.transitioning = false; this.motion = null; }
      this.render();
    }
    setView(view, now = this.clock()) {
      if (!['progress', 'grokbot'].includes(view)) throw new RangeError('Mode must be progress or grokbot.');
      this.tick(now);
      if (view === this.targetView) return;
      this.targetView = view; this.beginViewTransition(now);
    }
    toggleView(now = this.clock()) { this.setView(this.targetView === 'progress' ? 'grokbot' : 'progress', now); }
    setTransitionStyle(style, now = this.clock()) {
      if (!['morph', 'dissolve'].includes(style)) throw new RangeError('Transition style must be morph or dissolve.');
      this.tick(now); this.style = style;
      if (this.transitioning) this.beginViewTransition(now);
    }
    setState(next, now = this.clock()) {
      // Validate first so a malformed update cannot partially replace task data.
      const completed = next.progress?.completed ?? this.task.completed, total = next.progress?.total ?? this.task.total;
      if (!Number.isFinite(completed) || !Number.isFinite(total) || total <= 0 || completed < 0 || completed > total) throw new RangeError('Progress must be between zero and its positive total.');
      if (next.mode !== undefined && !['progress', 'grokbot'].includes(next.mode)) throw new RangeError('Mode must be progress or grokbot.');
      let history = this.task.history;
      if (next.activityHistory !== undefined) {
        if (!Array.isArray(next.activityHistory) || next.activityHistory.length === 0) throw new TypeError('Activity history must contain at least the current action.');
        history = next.activityHistory.map(entry).slice(-3);
      } else if (next.activity !== undefined) {
        const current = entry(next.activity);
        if (JSON.stringify(current) !== JSON.stringify(history.at(-1))) history = [...history, current].slice(-3);
      }
      this.tick(now);
      const progressChanged = completed !== this.task.completed || total !== this.task.total;
      this.task = { completed, total, history }; this.syncHistory();
      if (next.mode !== undefined && next.mode !== this.targetView) { this.setView(next.mode, now); return; }
      if (progressChanged && this.targetView === 'progress') {
        if (this.transitioning) this.beginViewTransition(now);
        else {
          this.motion = 'progress';
          this.field.retarget(this.destination(), now, { omega: 36, immediate: this.reducedMotion });
          if (this.reducedMotion) this.motion = null;
        }
      }
      this.render();
    }
    setReducedMotion(value, now = this.clock()) {
      this.tick(now); this.reducedMotion = value; this.root.classList.toggle('reduce-motion', value);
      if (value) {
        this.field.reset(this.destination(), now); this.details.reset([this.targetView === 'progress' ? 1 : 0], now); this.view = this.targetView;
        this.transitioning = false; this.motion = null;
      }
      this.render();
    }
    tick(now = this.clock()) {
      const dt = Math.max(0, now - this.lastTime); this.lastTime = now;
      this.details.advance(now);
      if (this.motion) {
        this.field.advance(now);
        if (this.field.settled && (this.motion !== 'view' || now >= this.viewTransitionEnd)) {
          if (this.motion === 'view') { this.view = this.targetView; this.transitioning = false; }
          this.motion = null;
        }
      } else if (this.view === 'grokbot') {
        if (!this.reducedMotion) this.characterTime += dt;
        this.field.reset(this.animation.sampleLoop(this.characterTime), now);
      } else this.field.time = now;
      this.render();
    }
    render() {
      this.renderer.render(this.field.values);
      this.root.style.setProperty('--details', String(this.details.values[0]));
      this.root.dataset.view = this.transitioning ? 'transition' : this.view;
      this.root.dataset.targetView = this.targetView;
      this.root.setAttribute('aria-pressed', String(this.targetView === 'grokbot'));
      const current = this.task.history.at(-1)?.label ?? 'Working';
      const action = this.targetView === 'progress' ? 'Show Grokbot' : 'Show progress dots';
      this.root.setAttribute('aria-label', `${action}. ${current}. ${this.task.completed} of ${this.task.total} confirmed.`);
      const count = `${this.task.completed} / ${this.task.total}`;
      if (this.counter.textContent !== count) this.counter.textContent = count;
      const status = this.root.querySelector('.task-status');
      if (status.textContent !== current) status.textContent = current;
    }
    get state() {
      return { mode: this.transitioning ? 'transition' : this.view, targetView: this.targetView, transitionStyle: this.style,
        completed: this.task.completed, total: this.task.total, activity: this.task.history.at(-1)?.label,
        activityHistory: this.task.history.map(item => ({ ...item })), characterTime: this.characterTime,
        cells: Array.from(this.field.values), velocities: Array.from(this.field.velocity) };
    }
  }
  window.GrokbotMatrixCard = GrokbotMatrixCard;
})();
