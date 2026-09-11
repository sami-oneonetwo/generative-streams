import { chromium } from './node_modules/playwright/index.mjs';
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  for (const fixture of ['outage', 'overload-pull', 'overload-boot']) {
    await page.goto(`http://127.0.0.1:4401/?case=${fixture}`);
    await page.waitForTimeout(400);
    await page.screenshot({ path: `.claude/preview-tools/check-${fixture}.png` });
  }
} finally { await browser.close(); }
