import { chromium } from './node_modules/playwright/index.mjs';
import { mkdir } from 'node:fs/promises';
const root = process.cwd();
await mkdir(`${root}/.claude/preview-tools/profile`, { recursive: true });
const context = await chromium.launchPersistentContext(`${root}/.claude/preview-tools/profile`, {
  headless: true, viewport: { width: 1920, height: 1080 },
});
const page = context.pages()[0];
const errors = [];
page.on('pageerror', e => errors.push(e.message));
await page.goto('http://127.0.0.1:4401/?case=screens');
await page.waitForFunction(() => {
  const c = document.querySelector('canvas');
  return c.getContext('2d').getImageData(500, 500, 1, 1).data[0] > 20;
});
await page.screenshot({ path: `${root}/.claude/preview-tools/screens.png` });
console.log(JSON.stringify({ errors }));
await context.close();
