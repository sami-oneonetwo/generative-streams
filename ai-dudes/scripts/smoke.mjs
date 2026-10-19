// Browser smoke against a fixture instance: six chatters arrive at once, every one gets a dude on
// the page, their agents answer, and their builds go up side by side.
//   npm run demo            (fixture server on :4510, data/demo)
//   node scripts/smoke.mjs  (SHOTS=dir for screenshots; default the system temp dir)
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require('../../noodle-shop/.claude/preview-tools/node_modules/playwright');

const base = `http://localhost:${process.env.PORT ?? 4510}`;
const shots = process.env.SHOTS ?? os.tmpdir();
const names = ['alex', 'blair', 'casey', 'dana', 'eli', 'fran'];
const lines = {
  alex: 'yo! build me a red tower',
  blair: 'build me a green house',
  casey: 'hi everyone, dance',
  dana: 'build me a blue car',
  eli: 'build me a pink tree',
  fran: 'wave',
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const status = async () => (await fetch(`${base}/admin/api/status`)).json();

const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(base);
await page.waitForFunction(() => window.__dudes !== undefined, null, { timeout: 15_000 });

await Promise.all(
  names.map((username) =>
    fetch(`${base}/admin/api/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, text: lines[username] }) }),
  ),
);
await page.waitForFunction((n) => window.__dudes.count() >= n, names.length, { timeout: 15_000 });
await sleep(1500);
await page.screenshot({ path: path.join(shots, 'dudes-arrived.png') });

// Builds: designing, walking, putting up, all at once.
let sawParallel = 0;
for (let i = 0; i < 60; i++) {
  const s = await status();
  sawParallel = Math.max(sawParallel, s.dudes.jobs.filter((j) => j.status === 'building').length);
  if (sawParallel >= 2) await page.screenshot({ path: path.join(shots, 'dudes-building.png') });
  if (s.dudes.objects.length >= 4) break;
  await sleep(1000);
}
await sleep(2500);
await page.screenshot({ path: path.join(shots, 'dudes-built.png') });
const s = await status();
assert.ok(s.dudes.objects.length >= 4, `four builds stand (saw ${s.dudes.objects.length})`);
assert.ok(sawParallel >= 2, `builds went up in parallel (saw ${sawParallel})`);
for (const n of names) assert.ok(s.dudes.dudes.find((d) => d.name === n)?.turns >= 1, `${n}'s agent answered`);
const pose = await page.evaluate(() => window.__dudes.poseOf('dev:casey'));
// A troublemaker: the banner goes up, he is on the page, and builds get painted.
await fetch(`${base}/admin/api/action`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: 'event-now', value: 'painter' }) });
await page.waitForFunction(() => [...document.querySelectorAll('*')].some((e) => /GARY THE PAINTER/.test(e.textContent ?? '') && e.offsetParent !== null), null, { timeout: 15_000 });
await sleep(12_000);
await page.screenshot({ path: path.join(shots, 'dudes-troublemaker.png') });
let painted = 0;
for (let i = 0; i < 40 && !painted; i++) {
  painted = (await status()).dudes.objects.filter((o) => o.damage).length;
  await sleep(1000);
}
assert.ok(painted >= 1, 'the painter got to a build');
// A fight: one shoots another, then a bomb goes off by a build.
const send = (username, text) => fetch(`${base}/admin/api/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, text }) });
await sleep(4000);
await send('blair', 'bomb the red tower');
let boomed = false;
for (let i = 0; i < 40 && !boomed; i++) {
  boomed = (await status()).dudes.objects.some((o) => /blown up/.test(o.damage ?? ''));
  if (!boomed) await sleep(500);
}
await page.screenshot({ path: path.join(shots, 'dudes-boom.png') });
assert.ok(boomed, 'the bomb blew up the tower');
assert.deepEqual(errors, [], 'no page errors');
console.log(`ok: ${names.length} dudes, ${s.dudes.objects.length} builds, ${sawParallel} at once, casey pose ${pose}; screenshots in ${shots}`);
await browser.close();
