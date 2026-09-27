// Optional real-browser check. No messaging, external services or user photos.
// PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node tests/custom-loader-browser.mjs
import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { httpFixture, payload, finished } from './helpers.mjs';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const cleanup = [], f = await httpFixture({ after: fn => cleanup.push(fn) });
const animation = JSON.parse(await readFile(new URL('../examples/loader-animation.json', import.meta.url)));
const still = JSON.parse(await readFile(new URL('../examples/loader-static.json', import.meta.url)));
const output = process.env.LOADER_CAPTURE_DIR;
const until = async check => {
  for (let i = 0; i < 100; i++) { if (await check()) return; await new Promise(r => setTimeout(r, 100)); }
  throw Error('Browser condition timed out');
};
let browser;
try {
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
  const errors = [];
  if (output) await mkdir(output, { recursive: true });
  for (const template of (process.env.LOADER_TEST_TEMPLATE ? [process.env.LOADER_TEST_TEMPLATE] : ['matrix', 'research', 'checks', 'stages'])) {
    const ownerRef = `browser-${template}`;
    const input = await payload(template);
    let record = await f.client.create({ ...input, ownerRef });
    const page = await browser.newPage({ viewport: { width: 300, height: 240 } });
    page.on('pageerror', e => errors.push(`${template}: ${e.message}`));
    await page.goto(record.viewUrl);
    const matrix = template === 'matrix';
    const state = () => page.evaluate(isMatrix => isMatrix ? window.GrokbotMini?.state : window.TaskMatrix?.state, matrix);
    await until(async () => (await state())?.loaderId === 'grokbot');
    const control = page.locator(matrix ? '.mini-card' : '.task-matrix-toggle');
    await control.click();
    await until(async () => (await state())?.mode === 'grokbot');
    const choice = await f.client.setLoader({ ownerRef, requestId: 'replace', expectedRevision: 0, action: 'replace', asset: animation });
    await page.evaluate(() => dispatchEvent(new Event('pageshow')));
    await until(async () => (await state())?.loaderId === choice.loader.id);
    assert.equal((await state()).mode, 'grokbot');
    assert.equal((await state()).columns, 16); assert.equal((await state()).rows, 20);
    assert.equal(page.url(), record.viewUrl);
    // Confirmed task/theme updates preserve the chosen character and current view.
    const before = await state();
    record = await f.client.get(record.id);
    record.content.theme = 'light'; record.content.detail.title = 'Fresh milestone';
    record = await f.client.update(record.id, { requestId: 'milestone', expectedRevision: record.revision, content: record.content });
    await page.evaluate(() => dispatchEvent(new Event('pageshow')));
    await until(async () => await page.locator('html').getAttribute('data-card-theme') === 'light');
    const after = await state();
    assert.equal(after.mode, 'grokbot'); assert.equal(after.loaderId, choice.loader.id);
    assert.ok((matrix ? after.characterTime : after.phase) >= (matrix ? before.characterTime : before.phase));
    // Keyboard and repeated reversals must still settle to the selected view.
    await control.focus(); await page.keyboard.press('Enter');
    await page.keyboard.press('Space'); await control.click(); await control.click();
    await until(async () => (await state())?.mode === 'grokbot');
    if (matrix) {
      // Observe four full authored test cycles, taking clean frames around every wrap.
      for (let cycle = 1; cycle <= 4; cycle++) {
        await until(async () => (await state()).characterTime >= cycle * animation.duration - .05);
        if (output) await page.screenshot({ path: join(output, `loop-${cycle}-before.png`) });
        await until(async () => (await state()).characterTime >= cycle * animation.duration + .05);
        if (output) await page.screenshot({ path: join(output, `loop-${cycle}-after.png`) });
      }
    }
    if (output) await page.screenshot({ path: join(output, `${template}-character.png`) });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await until(() => page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches));
    await new Promise(r => setTimeout(r, 100)); // Let the media-change event and its final animation frame settle.
    const reduced = await state(); await new Promise(r => setTimeout(r, 150));
    const reducedAfter = await state();
    assert.equal(matrix ? reduced.characterTime : reduced.phase, matrix ? reducedAfter.characterTime : reducedAfter.phase);
    await control.click(); await control.click();
    await until(async () => (await state())?.mode === 'grokbot');
    await page.setViewportSize({ width: 300, height: 300 });
    if (output) await page.screenshot({ path: join(output, `${template}-300.png`) });
    // Reset while open keeps the selected view and the URL, including a lattice change.
    await f.client.setLoader({ ownerRef, requestId: 'reset', expectedRevision: 1, action: 'reset' });
    await page.evaluate(() => dispatchEvent(new Event('pageshow')));
    await until(async () => (await state())?.loaderId === 'grokbot');
    assert.equal((await state()).mode, 'grokbot'); assert.equal((await state()).columns, 14);
    const staticChoice = await f.client.setLoader({ ownerRef, requestId: 'still', expectedRevision: 2, action: 'replace', asset: still });
    await page.reload();
    await until(async () => (await state())?.loaderId === staticChoice.loader.id);
    await control.click(); await until(async () => (await state())?.mode === 'grokbot');
    record = await f.client.get(record.id);
    record = await f.client.update(record.id, { requestId: 'final', expectedRevision: record.revision, content: finished(record.content) });
    await page.evaluate(() => dispatchEvent(new Event('pageshow')));
    await until(async () => (matrix ? (await page.locator('.count').textContent()) === '100 / 100' : (await page.locator('.status').textContent()).includes('Complete')));
    await f.client.setLoader({ ownerRef, requestId: 'reset-after-final', expectedRevision: 3, action: 'reset' });
    await page.reload();
    await until(async () => (await state())?.loaderId === staticChoice.loader.id);
    assert.equal(page.url(), record.viewUrl);
    await page.close();
    console.log(`PASS ${template}: custom loop, latest task/theme, taps/keyboard, reduced motion, reset, still, reopen, terminal snapshot, stable URL.`);
  }
  assert.deepEqual(errors, []);
  console.log('PASS: zero page JavaScript errors; temporary browser and host cleaned up.');
} finally {
  if (browser) await browser.close();
  for (const fn of cleanup.reverse()) await fn();
}
