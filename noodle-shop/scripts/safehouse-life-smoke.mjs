// Fixture-only: living builds in the real app. A gorilla starts wrecking the yard as soon as
// Rook finishes it, a dog goes for the gorilla, an RC car tears around, and the page follows
// all of it without errors. Screenshots land in .claude/preview-tools/safehouse-smoke/life-*.png.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import WebSocket from 'ws';
const require = createRequire(import.meta.url);
const { chromium } = require('../.claude/preview-tools/node_modules/playwright');
const base = process.env.SMOKE_URL ?? 'http://127.0.0.1:4410';
const shots = '.claude/preview-tools/safehouse-smoke';
let state;
const said = [];
let lastSpeech;
const ws = new WebSocket(base.replace('http:', 'ws:') + '/ws');
ws.on('message', (d) => {
  const m = JSON.parse(String(d));
  if (m.t !== 'state') return;
  state = m.scene.safehouse;
  const s = m.scene.speech;
  if (s && (s.text !== lastSpeech?.text || s.until !== lastSpeech?.until)) said.push(s.text);
  lastSpeech = s;
});
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
async function wait(fn, label, timeout = 120000) {
  const end = Date.now() + timeout;
  while (!fn()) {
    if (Date.now() > end) throw new Error(`Timeout ${label}; said so far: ${JSON.stringify(said.slice(-10))}`);
    await delay(50);
  }
}
async function post(path, body) {
  const r = await fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  assert.ok(r.ok, `${path}: ${await r.text()}`);
}
const creatures = () => (state?.objects ?? []).filter((o) => o.creature && o.destroyedAt === undefined);
const byBehaviour = (b) => creatures().find((o) => o.creature.behaviour === b);
const damage = () => state.objects.reduce((n, o) => n + (o.damageRevision ?? 0), 0);
const idle = () => !state.current && !state.pending.length;
async function track(getter, ms) {
  const trail = [];
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const o = getter();
    if (o) trail.push({ x: o.position.x, z: o.position.z });
    await delay(250);
  }
  return trail.reduce((n, p, i) => (i ? n + Math.hypot(p.x - trail[i - 1].x, p.z - trail[i - 1].z) : 0), 0);
}
let browser;
try {
  await wait(() => state, 'connect');
  assert.equal(state.fixture, true);
  await post('/admin/api/action', { id: 'safehouse-combat-pause' }); // zombies paused: creatures must still live
  browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(base);
  await page.waitForFunction(() => document.querySelectorAll('#creations optgroup').length >= 1);

  // 1. A gorilla: alive on completion, moving, breaking things while zombies are paused.
  await post('/admin/api/chat', { username: 'dave', text: 'Build a gorilla that runs around and breaks things' });
  await wait(() => byBehaviour('rampage') && idle(), 'gorilla built');
  const gorilla = byBehaviour('rampage');
  assert.equal(gorilla.createdBy, 'dave');
  const damageBefore = damage();
  const gorillaTravel = await track(() => byBehaviour('rampage'), 12000);
  await wait(() => damage() > damageBefore, 'the gorilla broke something', 60000);
  await delay(300);
  await page.screenshot({ path: `${shots}/life-gorilla.png` });
  // Built next to something breakable it may stand and smash for the whole window; either is life.
  assert.ok(gorillaTravel > 1 || damage() > damageBefore, `the gorilla moved or broke something (${gorillaTravel.toFixed(1)} m in 12 s)`);
  const inspect = await page.evaluate((id) => {
    const select = document.getElementById('creations');
    select.value = id;
    select.dispatchEvent(new Event('change'));
    return document.getElementById('inspect-detail').textContent;
  }, gorilla.id);
  assert.match(inspect, /living · rampage/);

  // 2. A dog: goes for the gorilla; the gorilla's health drops.
  await post('/admin/api/chat', { username: 'erin', text: 'Build a dog that fights the gorilla' });
  await wait(() => byBehaviour('fight') && idle(), 'dog built');
  await wait(() => (byBehaviour('rampage')?.health ?? 0) < 300 || !byBehaviour('rampage'), 'the dog bit the gorilla', 90000);
  await delay(300);
  await page.screenshot({ path: `${shots}/life-fight.png` });

  // 3. An RC car: fast and harmless.
  await post('/admin/api/chat', { username: 'fay', text: 'Build a little remote control car that just zooms around' });
  await wait(() => byBehaviour('zoom') && idle(), 'car built');
  const carTravel = await track(() => byBehaviour('zoom'), 8000);
  assert.ok(carTravel > 15, `the car covered ground (${carTravel.toFixed(1)} m in 8 s)`);
  await page.screenshot({ path: `${shots}/life-car.png` });

  // 4. A crow: airborne, climbing to cruise height, over everything.
  await post('/admin/api/chat', { username: 'gus', text: 'Build a crow' });
  await wait(() => creatures().some((o) => o.creature.flying) && idle(), 'crow built');
  await wait(() => (creatures().find((o) => o.creature.flying)?.creature.altitude ?? 0) > 4, 'the crow climbed', 30000);
  await delay(600);
  const lifted = await page.evaluate(() => {
    // The crow's group should be up in the air on the page too.
    const three = window.__safehouseScene;
    let highest = 0;
    three?.traverse((o) => {
      if (o.isGroup && o.children.some((c) => c.userData?.objectId) && o.position.y > highest) highest = o.position.y;
    });
    return highest;
  });
  assert.ok(lifted > 3, `the page lifted the flyer (${lifted.toFixed(1)} m)`);
  await page.screenshot({ path: `${shots}/life-crow.png` });
  // His voiced follow-up waits its turn behind the plain completion line.
  await wait(() => said.some((l) => /it flies|airborne|look up|goes up|'s up/.test(l)), "Rook's line about the flyer", 30000);

  assert.deepEqual(errors, []);
  assert.ok(said.some((l) => /is loose|it moves|and it's off|there it goes|alive\. cool cool/.test(l)), `Rook noticed: ${JSON.stringify(said)}`);
  console.log(
    JSON.stringify({
      ok: true,
      creatures: creatures().map((o) => `${o.blueprint.name}: ${o.creature.behaviour} ${Math.round(o.health)}/${o.maxHealth}`),
      gorillaTravel: Number(gorillaTravel.toFixed(1)),
      carTravel: Number(carTravel.toFixed(1)),
      damageDealt: damage() - damageBefore,
      said,
      errors,
    }),
  );
} finally {
  ws.close();
  await browser?.close();
}
