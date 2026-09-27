import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { renderCard, dots, segments } from '../public/card-template.mjs';
import { payload } from './helpers.mjs';
import { demoView } from '../src/demo.mjs';

test('27 of 50 is exactly 27 filled dots and 23 pending dots', () => {
  const html = dots({ completed: 27, total: 50, unit: 'profiles verified' });
  assert.equal((html.match(/data-fill="full"/g) || []).length, 27);
  assert.equal((html.match(/data-fill="empty"/g) || []).length, 23);
});
test('large batch uses bounded proportional dot display', () => {
  const html = dots({ completed: 275, total: 1000, unit: 'files processed' });
  assert.equal((html.match(/class="dot"/g) || []).length, 50);
  assert.match(html, /275 of 1000 files processed/);
  assert.equal((html.match(/data-fill="partial"/g) || []).length, 1);
});
test('74 percent is seven full segments, one 40 percent segment, two empty', () => {
  const html = segments({ completed: 37, total: 50, unit: 'checks complete' });
  assert.equal((html.match(/class="segment"/g) || []).length, 10);
  assert.equal((html.match(/scaleX\(1\)/g) || []).length, 7);
  assert.equal((html.match(/scaleX\(0\)/g) || []).length, 2);
  assert.match(html, /scaleX\(0\.4[0-9]*\)/);
});
test('stage tracker does not show an invented percent', async () => {
  const html = renderCard(await demoView('stages'));
  assert.match(html, /Step 3 \/ 4/); assert.match(html, /2 of 4 stages completed/);
  assert.doesNotMatch(html, /75%|class="percent"/);
});
test('unknown progress falls back to stages instead of 0 or fake 60 percent', async () => {
  const html = renderCard(await demoView('unknown'));
  assert.doesNotMatch(html, /class="percent"|role="progressbar"/);
});
test('completed and waiting states have no working activity ring', async () => {
  for (const name of ['complete', 'waiting']) assert.doesNotMatch(renderCard(await demoView(name)), /class="activity-ring"/);
});
test('layout contains no controls or external assets', async () => {
  for (const name of ['research', 'checks', 'stages']) {
    const html = renderCard(await demoView(name));
    assert.doesNotMatch(html, /<button|<form|https?:\/\/|Apple Pay|ORCHID/);
  }
});
test('code palette contains only approved flat navy, white and gray tokens', async () => {
  const css = await readFile(new URL('../public/card.css', import.meta.url), 'utf8');
  const hex = new Set(css.match(/#[0-9a-f]{6}/gi));
  assert.deepEqual(hex, new Set(['#07152a', '#ffffff', '#bac1cb', '#657084', '#465266']));
  assert.doesNotMatch(css, /(?:linear|radial|conic)-gradient\(|box-shadow\s*:/);
  assert.match(css, /prefers-reduced-motion/);
});
test('header disabled produces no blank image strip', async () => {
  const view = await demoView('stages');
  assert.match(renderCard(view), /no-header/); assert.doesNotMatch(renderCard(view), /<figure/);
});
test('text stays text, not script or HTML', async () => {
  const view = await demoView('research'); view.content.detail.subtitle = '<b>not markup</b>';
  assert.match(renderCard(view), /&lt;b&gt;not markup&lt;\/b&gt;/);
});
