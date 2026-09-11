import assert from 'node:assert/strict';
import { chromium } from './node_modules/playwright/index.mjs';
const root = process.cwd();
const context = await chromium.launchPersistentContext(`${root}/.claude/preview-tools/profile`, {
  headless: true, viewport: { width: 1920, height: 1080 },
});
const page = context.pages()[0];
const errors = [];
page.on('pageerror', e => errors.push(e.message));
await page.addInitScript(() => {
  window.renderedText = [];
  const fill = CanvasRenderingContext2D.prototype.fillText;
  const clear = CanvasRenderingContext2D.prototype.clearRect;
  CanvasRenderingContext2D.prototype.clearRect = function(...args) {
    if (this.canvas.id === 'c') window.renderedText = [];
    return clear.apply(this, args);
  };
  CanvasRenderingContext2D.prototype.fillText = function(text, ...args) {
    if (this.canvas.id === 'c') window.renderedText.push(String(text));
    return fill.call(this, text, ...args);
  };
});
await page.clock.install();
await page.goto('http://127.0.0.1:4401/?case=screens');
await page.waitForFunction(() => window.renderedText.includes('BOX TELEMETRY'));
const title = () => page.evaluate(() => window.renderedText[window.renderedText.indexOf('BOX TELEMETRY') + 2]);
const before = await title();
await page.clock.fastForward(8100);
const after = await title();
assert.notEqual(after, before);
console.log(`PASS: box monitor cycles ${before} -> ${after} without another snapshot`);
for (const name of ['full', 'failure', 'empty', 'screens-long', 'noodles']) {
  await page.goto(`http://127.0.0.1:4401/?case=${name}`);
  await page.waitForFunction(() => !window.renderedText.includes('connecting…') && window.renderedText.length > 3);
  await page.screenshot({ path: `${root}/.claude/preview-tools/${name}.png` });
  const text = await page.evaluate(() => window.renderedText);
  if (name !== 'noodles') {
    assert.ok(text.includes('ROOM TELEMETRY'));
    assert.ok(text.includes('BOX TELEMETRY'));
    assert.ok(!text.includes('THE SERVER ROOM'));
    assert.ok(!text.includes('RAY'));
  } else assert.ok(!text.includes('BOX TELEMETRY'));
  console.log(`PASS: ${name} scene rendered`);
}
await page.goto('http://127.0.0.1:4401/?case=screens-long');
await page.waitForFunction(() => window.renderedText.includes('BOX TELEMETRY'));
for (let i = 0; i < 6; i++) {
  if (await page.evaluate(() => window.renderedText.some(t => t.includes('long-server-name')))) break;
  await page.clock.fastForward(8000);
}
assert.ok(await page.evaluate(() => window.renderedText.some(t => t.includes('long-server-name'))));
await page.screenshot({ path: `${root}/.claude/preview-tools/long-box.png` });
for (let i = 0; i < 7; i++) {
  if (await page.evaluate(() => window.renderedText.includes('RAY / WORK ORDERS'))) break;
  await page.clock.fastForward(7000);
}
assert.ok(await page.evaluate(() => window.renderedText.includes('RAY / WORK ORDERS')));
await page.screenshot({ path: `${root}/.claude/preview-tools/long-work.png` });
console.log('PASS: long box names and work orders render on their own pages');
await page.goto('http://127.0.0.1:4401/?case=chat-live');
await page.waitForFunction(() => window.renderedText.some(t => t.includes('Synthetic incoming')));
console.log('PASS: live WebSocket chat reaches the background TV text');
assert.deepEqual(errors, []);
console.log('PASS: no browser runtime errors');
await context.close();
