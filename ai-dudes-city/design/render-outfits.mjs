// Renders the age's garment kits on real rigged figures into design/out/o<round>/ (outfits-<age>.png, outfits-board.png).
//   node design/render-outfits.mjs <round> [ages=stone,bronze,…]   (NOBUILD=1 to skip rebuilding the renderer)
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const require = createRequire(path.resolve('scripts/x.mjs'));
const { chromium } = require('../../noodle-shop/.claude/preview-tools/node_modules/playwright');
const round = process.argv[2] ?? '0';
const AGE_IDS = ['stone', 'bronze', 'medieval', 'industrial', 'modern', 'future'];
const only = (process.argv[3] ?? '').split(',').filter(Boolean);
const out = path.resolve(`design/out/o${round}`);
mkdirSync(out, { recursive: true });
if (!process.env.NOBUILD) execFileSync('node', ['design/build.mjs'], { stdio: 'inherit' });
const read = (f) => (existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : undefined);
const ages = AGE_IDS.map((id, index) => ({ id, index, bible: read(path.resolve('design/spec', id, 'bible.json')), outfits: read(path.resolve('design/spec', id, 'outfits.json')) }))
  .filter((a) => !only.length || only.includes(a.id))
  .map((a) => ({ ...a, name: a.bible?.name ?? a.id }));
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto('file://' + path.resolve('design/board/index.html'));
await page.waitForFunction(() => typeof window.renderOutfits === 'function');
const images = await page.evaluate((data) => window.renderOutfits(data), { ages });
for (const [name, url] of Object.entries(images)) writeFileSync(path.join(out, name), Buffer.from(url.split(',')[1], 'base64'));
await browser.close();
console.log(`outfits round ${round}: ${Object.keys(images).length} images in ${out}${errors.length ? `; page errors: ${errors.join(' | ')}` : ''}`);
