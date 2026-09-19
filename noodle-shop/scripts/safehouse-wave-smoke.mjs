// Fixture-only: the wave clock runs in the real app. Two turrets go up, wave 1 is
// called in early, its walkers die, "Wave 1 cleared" starts the prep for wave 2.
// With EXPECT_KINDS=runner,brute (against a world pre-set to a later wave) it
// waits for those kinds to spawn and screenshots them instead.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import WebSocket from 'ws';
const require = createRequire(import.meta.url);
const { chromium } = require('../.claude/preview-tools/node_modules/playwright');
const base = process.env.SMOKE_URL ?? 'http://127.0.0.1:4410';
const shots = '.claude/preview-tools/safehouse-smoke';
const expectKinds = (process.env.EXPECT_KINDS ?? '').split(',').filter(Boolean);
let state;
const seenKinds = new Set();
const ws = new WebSocket(base.replace('http:', 'ws:') + '/ws');
ws.on('message', (d) => {
  const m = JSON.parse(String(d));
  if (m.t !== 'state') return;
  state = m.scene.safehouse;
  for (const z of state.combat?.zombies ?? []) seenKinds.add(z.kind ?? 'walker');
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
async function chat(username, text) {
  const r = await fetch(base + '/admin/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, text }) });
  assert.ok(r.ok, await r.text());
  await wait(() => state.current, 'admitted ' + text, 10000).catch(() => {});
  await wait(() => !state.current, 'finished ' + text);
  return state.recent.at(-1);
}
let browser;
try {
  await wait(() => state, 'connect');
  assert.equal(state.fixture, true);
  const startWave = state.combat.wave.number;
  assert.equal(state.combat.wave.phase, 'prep');
  browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(base);
  await page.waitForFunction(() => document.querySelectorAll('#creations optgroup').length >= 1);
  await page.waitForFunction((n) => document.querySelector('#wave-title')?.textContent === `WAVE ${n}`, startWave);
  const prepDetail = await page.locator('#wave-detail').innerText();
  assert.match(prepDetail, /paused|incoming in \d+:\d\d/);
  await page.screenshot({ path: `${shots}/wave-prep.png` });

  if (!expectKinds.length) {
    for (const [who, text] of [['gunner', 'Build a turret at 3,13'], ['gunner2', 'Build a turret at -2,13']]) {
      const job = await chat(who, text);
      assert.equal(job.status, 'complete', job.error);
    }
  }
  await action('safehouse-combat-start');
  await action('safehouse-wave-next');
  await wait(() => state.combat.wave.phase === 'wave', 'wave starts', 15000);
  await wait(() => state.combat.zombies.length >= 2, 'first batch spawns', 15000);
  await page.waitForFunction(() => document.querySelector('#wave')?.classList.contains('live'));
  await delay(6000);
  await page.screenshot({ path: `${shots}/wave-live.png` });
  const liveDetail = await page.locator('#wave-detail').innerText();
  assert.match(liveDetail, /\d+ here/);

  if (expectKinds.length) {
    await wait(() => expectKinds.every((k) => seenKinds.has(k)), `kinds ${expectKinds.join(',')} spawn`, 90000);
    await delay(4000);
    await page.screenshot({ path: `${shots}/wave-kinds.png` });
  } else {
    // Cleared outright, or the last straggler (side spawns chew the far fence, out of turret range) timed out.
    await wait(() => state.combat.wave.number === startWave + 1 && state.combat.wave.phase === 'prep', 'wave over', 300000);
    assert.equal(state.combat.wave.best, startWave);
    assert.ok(state.combat.kills >= 2, `turrets got most of the roster (${state.combat.kills})`);
    assert.match(state.notice, /cleared|shambled off/);
    await delay(1200);
    await page.screenshot({ path: `${shots}/wave-cleared.png` });
  }
  await action('safehouse-combat-pause');
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ ok: true, startWave, wave: state.combat.wave, kinds: [...seenKinds], kills: state.combat.kills, prepDetail, liveDetail, errors }));
} finally {
  ws.close();
  await browser?.close();
}
