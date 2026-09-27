import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const scope = { Float64Array, Math, Number, RangeError }; vm.createContext(scope);
vm.runInContext(readFileSync(new URL('../mini-core.js', import.meta.url), 'utf8'), scope);
const { DampedField, progress } = scope.MatrixCardCore;
scope.window = scope;
vm.runInContext(readFileSync(new URL('../square-animation.js', import.meta.url), 'utf8'), scope);
const near = (a, b, tolerance = 1e-9) => assert.ok(Math.abs(a - b) <= tolerance, `${a} != ${b}`);

test('physical progress brightness matches the measured fraction', () => {
  for (const n of [0, 1, 41, 42, 99, 100]) near(progress(n, 100).reduce((a,b)=>a+b,0), n/100*196);
});
test('analytic springs agree across 30, 60 and 120fps', () => {
  const runs = [30,60,120].map(fps => {
    const field = new DampedField(new Float64Array(196));
    field.retarget(new Float64Array(196).fill(1), 0, { style: 'morph' });
    for (let i=1;i<=fps/2;i++) field.advance(i/fps);
    return field.values;
  });
  for(let i=0;i<196;i++) { near(runs[0][i],runs[1][i]); near(runs[1][i],runs[2][i]); }
});
test('A staggers center-out and reverses order; B starts simultaneously', () => {
  for(const [style,reverse] of [['morph',false],['morph',true],['dissolve',false]]) {
    const f=new DampedField(new Float64Array(196));f.retarget(new Float64Array(196).fill(1),0,{style,reverse});f.advance(.06);
    const center=6*14+6,corner=0;
    if(style==='dissolve') near(f.values[center],f.values[corner]);
    else if(reverse) assert.ok(f.values[corner]>f.values[center]);
    else assert.ok(f.values[center]>f.values[corner]);
  }
});
test('repeated retargeting preserves position and velocity and remains bounded', () => {
  const f=new DampedField(new Float64Array(196));
  for(let turn=0;turn<20;turn++) {
    const now=turn*.087;f.advance(now);
    const x=Array.from(f.values),v=Array.from(f.velocity);
    f.retarget(new Float64Array(196).fill(turn%2?0:1),now,{style:'morph',reverse:!!(turn%2)});
    x.forEach((x,i)=>near(f.values[i],x));v.forEach((v,i)=>near(f.velocity[i],v));
    assert.ok(f.values.every(x=>x>=0&&x<=1));
  }
  f.advance(3);assert.ok(f.settled);assert.ok(f.values.every(x=>x===0));
});
test('confirmed progress fills monotonically without the former three pulses', () => {
  const f=new DampedField(progress(41,100));f.retarget(progress(42,100),0,{omega:36});
  let last=Float64Array.from(f.values);
  for(let i=1;i<=30;i++) {
    f.advance(i/60);f.values.forEach((value,j)=>assert.ok(value>=last[j]-1e-12));last=Float64Array.from(f.values);
  }
  assert.ok(f.settled);near(f.values.reduce((a,b)=>a+b,0),42/100*196);
});
test('zero-motion updates settle immediately for reduced motion', () => {
  const f=new DampedField(progress(41,100));f.retarget(progress(63,100),0,{immediate:true});
  assert.ok(f.settled);near(f.values.reduce((a,b)=>a+b,0),63/100*196);assert.ok(f.velocity.every(v=>v===0));
});
test('loops the measured source cycle without an added fade or endpoint hold', () => {
  const animation = new scope.MatrixCardCore.Animation(scope.GROKBOT_SQUARE);
  const start = 2.358333, end = 10.325, period = end - start;
  near(animation.loopDuration, period);
  // Source-comparison sampling retains the entire original recording.
  near(animation.duration, 11.175);
  const sourceStart = animation.sample(start), sourceEnd = animation.sample(end);
  sourceStart.forEach((v, i) => near(v, sourceEnd[i]));
  for (const cycle of [0, 1, 2, 4, 100]) {
    for (const t of [0, .6, 4.7, period - .01]) {
      const expected = animation.sample(start + t), actual = animation.sampleLoop(cycle * period + t);
      actual.forEach((value, i) => near(value, expected[i], 1e-8));
    }
  }
  for (const fps of [30, 60, 120]) {
    const dt = 1 / fps;
    for (const cycle of [1, 2, 3, 4]) {
      const before = animation.sampleLoop(cycle * period - dt);
      const boundary = animation.sampleLoop(cycle * period);
      const after = animation.sampleLoop(cycle * period + dt);
      before.forEach((v, i) => near(v, animation.sample(end - dt)[i], 1e-8));
      after.forEach((v, i) => near(v, animation.sample(start + dt)[i], 1e-8));
      assert.ok(before.some((v, i) => Math.abs(v - boundary[i]) > .01), 'Moving into the boundary');
      assert.ok(after.some((v, i) => Math.abs(v - boundary[i]) > .01), 'Moving out of the boundary');
      assert.ok([...before, ...boundary, ...after].every(v => v >= 0 && v <= 1));
    }
  }
  const left = animation.sampleLoop(period - 1e-8), right = animation.sampleLoop(period + 1e-8);
  left.forEach((v, i) => near(v, right[i], 1e-6));
});
