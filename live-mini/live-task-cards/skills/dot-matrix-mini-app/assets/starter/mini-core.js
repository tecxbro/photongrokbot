/* Pure intensity math. Both views use one stationary square lattice. */
'use strict';
(() => {
  const clamp = value => Math.max(0, Math.min(1, value));
  function progress(completed, total, size = 196) {
    if (!Number.isFinite(total) || total <= 0 || !Number.isFinite(completed)) {
      throw new RangeError('A measured count and positive total are required.');
    }
    const position = clamp(completed / total) * size;
    return Float64Array.from({ length: size }, (_, i) => clamp(position - i));
  }
  function blend(from, to, amount) {
    const a = clamp(amount);
    return Float64Array.from(from, (v, i) => v + (to[i] - v) * a);
  }
  class Animation {
    constructor(data) {
      this.columns = data.columns; this.rows = data.rows; this.duration = data.duration;
      this.loopStart = data.loop?.start ?? 0; this.loopEnd = data.loop?.end ?? this.duration;
      this.loopDuration = this.loopEnd - this.loopStart;
      this.frames = data.frames.map(([t, cells]) => ({ t, cells: Float64Array.from(cells, c => Number(c) / 4) }));
    }
    sampleLoop(time) {
      // Measured matching poses close the source's natural cycle. No extra
      // transition, hold, or resampling is inserted at the wrap.
      return this.sample(this.loopStart + Math.max(0, time) % this.loopDuration);
    }
    sample(time) {
      const t = Math.max(0, Math.min(this.duration, time));
      let low = 0, high = this.frames.length - 1;
      while (low < high) {
        const mid = Math.ceil((low + high) / 2);
        if (this.frames[mid].t <= t) low = mid; else high = mid - 1;
      }
      const a = this.frames[low], b = this.frames[Math.min(low + 1, this.frames.length - 1)];
      return blend(a.cells, b.cells, a === b ? 0 : (t - a.t) / (b.t - a.t));
    }
  }
  const radialDelay = (index, size = 14) => {
    const center = (size - 1) / 2;
    const distance = Math.hypot(index % size - center, Math.floor(index / size) - center);
    const nearest = Math.SQRT1_2, furthest = center * Math.SQRT2;
    return clamp((distance - nearest) / (furthest - nearest));
  };

  /* Analytic critically damped springs: no frame-rate-dependent Euler steps.
     Retargeting keeps position AND velocity; pending stagger targets are replaced. */
  class DampedField {
    constructor(values, now = 0) {
      this.values = Float64Array.from(values);
      this.velocity = new Float64Array(values.length);
      this.targets = Float64Array.from(values);
      this.pending = Float64Array.from(values);
      this.due = new Float64Array(values.length).fill(Infinity);
      this.time = now; this.omega = 16; this.settled = true;
    }
    reset(values, now) {
      this.values.set(values); this.targets.set(values); this.pending.set(values);
      this.velocity.fill(0); this.due.fill(Infinity); this.time = now; this.settled = true;
    }
    retarget(values, now, { style = 'dissolve', reverse = false, omega = 16, immediate = false } = {}) {
      this.advance(now);
      if (immediate) { this.reset(values, now); return; }
      this.omega = omega; this.settled = false;
      for (let i = 0; i < values.length; i++) {
        const fraction = radialDelay(i);
        const delay = style === 'morph' ? .12 * (reverse ? 1 - fraction : fraction) : 0;
        this.pending[i] = values[i];
        this.due[i] = now + delay;
        if (delay === 0) { this.targets[i] = values[i]; this.due[i] = Infinity; }
      }
    }
    integrate(i, dt) {
      if (dt <= 0) return;
      const x = this.values[i] - this.targets[i], v = this.velocity[i], w = this.omega;
      const c = v + w * x, decay = Math.exp(-w * dt);
      const value = this.targets[i] + (x + c * dt) * decay;
      this.values[i] = clamp(value);
      this.velocity[i] = value < 0 || value > 1 ? 0 : (v - w * c * dt) * decay;
    }
    advance(now) {
      if (now < this.time) throw new RangeError('Animation time must be monotonic.');
      let settled = true;
      for (let i = 0; i < this.values.length; i++) {
        let start = this.time;
        if (this.due[i] <= now) {
          this.integrate(i, Math.max(0, this.due[i] - start));
          start = Math.max(start, this.due[i]);
          this.targets[i] = this.pending[i]; this.due[i] = Infinity;
        }
        this.integrate(i, now - start);
        if (this.due[i] !== Infinity || Math.abs(this.values[i] - this.targets[i]) > 1 / 1024 || Math.abs(this.velocity[i]) > .003) settled = false;
      }
      this.time = now; this.settled = settled;
      if (settled) { this.values.set(this.targets); this.velocity.fill(0); }
      return this.values;
    }
  }
  globalThis.MatrixCardCore = { clamp, progress, blend, Animation, DampedField, radialDelay };
})();
