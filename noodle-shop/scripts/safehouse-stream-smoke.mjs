// Fixture-only: the OBS view (`/?stream=1`) at a 1080p canvas — HUD scaled up, click-only
// controls gone, camera tighter — with no page errors. Screenshot for a human look.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('../.claude/preview-tools/node_modules/playwright');
const base = process.env.SMOKE_URL ?? 'http://127.0.0.1:4410';
const shots = '.claude/preview-tools/safehouse-smoke';
let browser;
try {
  browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const errors = [];
  const measure = async (url) => {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(base + url);
    await page.waitForFunction(() => document.querySelectorAll('#creations optgroup').length >= 1);
    await page.waitForTimeout(1500);
    const m = await page.evaluate(() => {
      // Fixed-position elements have no offsetParent, so check the computed display instead.
      const shown = (sel) => getComputedStyle(document.querySelector(sel)).display !== 'none';
      return {
        work: document.querySelector('#work').getBoundingClientRect().height,
        toolsVisible: shown('#tools'),
        linkVisible: shown('#status a'),
        wave: document.querySelector('#wave').getBoundingClientRect().height,
      };
    });
    return { page, m };
  };
  const plain = await measure('/');
  await plain.page.screenshot({ path: `${shots}/stream-plain.png` });
  const stream = await measure('/?stream=1');
  await stream.page.screenshot({ path: `${shots}/stream-mode.png` });
  assert.ok(stream.m.work > plain.m.work * 1.5, `HUD scaled up (${plain.m.work} → ${stream.m.work})`);
  assert.equal(stream.m.toolsVisible, false, 'click-only controls hidden');
  assert.equal(stream.m.linkVisible, false, 'operator link hidden');
  assert.equal(plain.m.toolsVisible, true, 'desktop view unchanged');
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ ok: true, plain: plain.m, stream: stream.m }));
} finally {
  await browser?.close();
}
