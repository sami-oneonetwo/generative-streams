// Fixture-only: zombies damage the neighborhood, Rook walks over and fixes it
// on his own. Drives the real app in Chrome; no AI calls, no Kick.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import WebSocket from 'ws';
const require = createRequire(import.meta.url);
const { chromium } = require('../.claude/preview-tools/node_modules/playwright');
const base = process.env.SMOKE_URL ?? 'http://127.0.0.1:4410';
const shots = '.claude/preview-tools/safehouse-smoke';
let state;
const seen = { activities: new Set(), rookJobs: new Map() };
const ws = new WebSocket(base.replace('http:', 'ws:') + '/ws');
ws.on('message', (d) => {
  const m = JSON.parse(String(d));
  if (m.t !== 'state') return;
  state = m.scene.safehouse;
  seen.activities.add(state.survivor.activity);
  for (const j of [state.current, ...state.pending, ...state.recent].filter(Boolean))
    if (j.requestedBy === 'Rook') seen.rookJobs.set(j.id, j);
});
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
async function wait(fn, label, timeout = 180000) {
  const end = Date.now() + timeout;
  while (!fn()) {
    if (Date.now() > end) throw new Error('Timeout ' + label);
    await delay(100);
  }
}
async function action(id) {
  const r = await fetch(base + '/admin/api/action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) });
  assert.ok(r.ok, `${id}: ${await r.text()}`);
}
const hurt = (o) => o.destroyedAt !== undefined || (o.health ?? 80) < (o.maxHealth ?? 80) * 0.7;
let browser;
try {
  await wait(() => state, 'connect');
  assert.equal(state.fixture, true);
  assert.equal(state.repairsPaused, false);
  browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(base);
  await page.waitForFunction(() => document.querySelectorAll('#creations optgroup').length >= 1);
  await page.screenshot({ path: `${shots}/repair-house.png` });

  await action('safehouse-zombies');
  await action('safehouse-combat-start');
  await wait(() => state.objects.some(hurt), 'zombies do damage');
  const damaged = state.objects.filter(hurt).map((o) => o.blueprint.name);
  await action('safehouse-combat-pause');
  await wait(() => state.current?.requestedBy === 'Rook', 'Rook picks up the hammer', 60000);
  const target = state.current.label;
  await wait(() => state.survivor.activity === 'repairing', 'hammering pose');
  await delay(700);
  await page.screenshot({ path: `${shots}/repair-hammer.png` });
  await wait(() => !state.objects.some(hurt), 'everything patched up');
  await delay(1200);
  await page.screenshot({ path: `${shots}/repair-done.png` });
  const jobs = [...seen.rookJobs.values()];
  assert.ok(jobs.some((j) => j.status === 'complete'), 'at least one repair completed');
  assert.ok(seen.activities.has('repairing'));
  assert.equal(state.callsRemaining, 20, 'no model calls spent');
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ ok: true, damaged, firstTarget: target, rookJobs: jobs.map((j) => `${j.status}:${j.label}`), kills: state.combat.kills, errors }));
} finally {
  ws.close();
  await browser?.close();
}
