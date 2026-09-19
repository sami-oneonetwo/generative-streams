import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('./node_modules/playwright');
const base = process.env.SMOKE_URL ?? 'http://127.0.0.1:4410';
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
try {
  for (const [name, query] of [['block-wide', '/?zoom=0.7'], ['block-stream', '/?stream=1']]) {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    const errors = []; page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(base + query);
    await page.waitForFunction(() => document.querySelectorAll('#creations optgroup').length >= 1);
    await page.waitForTimeout(2500);
    await page.screenshot({ path: `.claude/preview-tools/safehouse-smoke/${name}.png` });
    console.log(JSON.stringify({ name, errors }));
    await page.close();
  }
} finally { await browser.close(); }
