// Renders the design board from design/spec into design/out/r<round>/ (sheets, street corners, cells, boards).
//   node design/render.mjs <round> [ages=stone,bronze,…]
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const require = createRequire(path.resolve('scripts/x.mjs'));
const { chromium } = require('../../noodle-shop/.claude/preview-tools/node_modules/playwright');
const round = process.argv[2] ?? '0';
const AGE_IDS = ['stone', 'bronze', 'medieval', 'industrial', 'modern', 'future'];
const only = (process.argv[3] ?? '').split(',').filter(Boolean);
const out = path.resolve(`design/out/r${round}`);
mkdirSync(path.join(out, 'cells'), { recursive: true });

if (!process.env.NOBUILD) execFileSync('node', ['design/build.mjs'], { stdio: 'inherit' });
// The catalogue is TypeScript: read it through tsx.
const elements = JSON.parse(execFileSync('npx', ['tsx', '-e', "import {ELEMENTS} from './design/catalogue'; console.log(JSON.stringify(ELEMENTS.map(({id,label,board,tile,half})=>({id,label,board,tile,half}))))"], { encoding: 'utf8' }));
const read = (f) => (existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : undefined);
const ages = AGE_IDS.filter((a) => !only.length || only.includes(a)).map((id) => {
  const dir = path.resolve('design/spec', id);
  const bible = read(path.join(dir, 'bible.json'));
  if (!bible) throw new Error(`no bible for ${id}`);
  const specs = {};
  for (const e of elements) specs[e.id] = read(path.join(dir, `${e.id}.json`));
  return { id, name: bible.name ?? id, bible, elements: specs };
});

const browser = await chromium.launch({ headless: true, channel: 'chrome', args: ['--use-angle=metal', '--enable-gpu'] });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto('file://' + path.resolve('design/board/index.html'));
await page.waitForFunction(() => typeof window.renderBoard === 'function');
const images = await page.evaluate((data) => window.renderBoard(data), { title: 'AI DUDES', ages, elements });
for (const [name, url] of Object.entries(images)) writeFileSync(path.join(out, name), Buffer.from(url.split(',')[1], 'base64'));
await browser.close();
const missing = ages.flatMap((a) => elements.filter((e) => !a.elements[e.id]).map((e) => `${a.id}/${e.id}`));
console.log(`round ${round}: ${Object.keys(images).length} images in ${out}${missing.length ? `; missing specs: ${missing.join(', ')}` : ''}${errors.length ? `; page errors: ${errors.join(' | ')}` : ''}`);
