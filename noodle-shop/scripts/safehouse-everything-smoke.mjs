// Fixture-only: drives "everything is an object" through the real app in Chrome.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import WebSocket from 'ws';
const require = createRequire(import.meta.url);
const { chromium } = require('../.claude/preview-tools/node_modules/playwright');
const base = process.env.SMOKE_URL ?? 'http://127.0.0.1:4410';
const shots = '.claude/preview-tools/safehouse-smoke';
let state;
const ws = new WebSocket(base.replace('http:', 'ws:') + '/ws');
ws.on('message', (d) => { const m = JSON.parse(String(d)); if (m.t === 'state') state = m.scene.safehouse; });
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
async function wait(fn, label, timeout = 120000) { const end = Date.now() + timeout; while (!fn()) { if (Date.now() > end) throw new Error('Timeout ' + label); await delay(100); } }
async function chat(username, text) {
  const r = await fetch(base + '/admin/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, text }) });
  assert.ok(r.ok, await r.text());
  await wait(() => state.current, 'admitted ' + text, 10000).catch(() => {});
  await wait(() => !state.current, 'finished ' + text);
  return state.recent.at(-1);
}
const byName = (name) => state.objects.find((o) => o.blueprint.name === name);
let browser;
try {
  await wait(() => state, 'connect');
  assert.equal(state.fixture, true);
  assert.ok(byName('Barricade') && byName('Garage') && byName("Rook's house"), 'neighborhood is seeded as objects');
  browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(base);
  await page.waitForFunction(() => document.querySelectorAll('#creations optgroup').length >= 1);
  await page.screenshot({ path: `${shots}/everything-before.png` });

  const barricadeBefore = { ...byName('Barricade').position };
  const moved = await chat('mover', 'Move the barricade to -6,-13');
  assert.equal(moved.status, 'complete', moved.error);
  assert.deepEqual(byName('Barricade').position, { x: -6, z: -13 });
  const turned = await chat('driver', "Turn Rook's car around");
  assert.equal(turned.status, 'complete', turned.error);
  const painted = await chat('painter', 'Paint the house red');
  assert.equal(painted.status, 'complete', painted.error);
  // Snapshots carry no geometry; the parts endpoint does.
  const house = byName("Rook's house");
  assert.equal(house.blueprint.color, '#b65b50');
  const geometry = await (await fetch(base + '/api/objects/parts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ keys: [`${house.id}:${house.revision}`] }) })).json();
  const parts = geometry.parts[`${house.id}:${house.revision}`];
  assert.ok(Array.isArray(parts) && parts.length === house.blueprint.partCount, 'parts served by id+revision');
  assert.ok(parts.every((p) => p.color === '#b65b50'));
  const bench = await chat('builder', 'Build a barricade in front of the house');
  assert.equal(bench.status, 'complete', bench.error);
  const jobsBefore = state.recent.length;
  const r = await fetch(base + '/admin/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'dreamer', text: 'Build a turret on the roof' }) });
  assert.ok(r.ok);
  await delay(1500);
  assert.equal(state.recent.length, jobsBefore, 'roof requests are explained, not queued');
  assert.match(state.notice, /Ground-level/);
  await wait(() => state.worldRevision >= 4, 'renderer catch-up');
  await delay(1200);
  await page.screenshot({ path: `${shots}/everything-after.png` });

  await page.selectOption('#creations', byName("Rook's house").id);
  await page.locator('#inspect').waitFor({ state: 'visible' });
  assert.match(await page.locator('#inspect-detail').innerText(), /#scenery-house · barrier · 4000\/4000 health · Part of the neighborhood/);
  await page.screenshot({ path: `${shots}/everything-inspect.png` });

  const mobile = await browser.newPage({ viewport: { width: 400, height: 800 } });
  await mobile.goto(base);
  await mobile.waitForFunction(() => document.querySelectorAll('#creations optgroup').length >= 1);
  await mobile.screenshot({ path: `${shots}/everything-mobile.png` });
  assert.equal(await mobile.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ ok: true, barricadeBefore, barricadeAfter: byName('Barricade').position, pieces: state.objects.filter((o) => o.fixed).length, creations: state.objects.filter((o) => !o.fixed).length, errors }));
} finally { ws.close(); await browser?.close(); }
