// Fixture-only: a viewer build makes Rook mutter on the way and while hammering, the
// bubble follows him on screen, the completion stays a plain status line, and a quiet
// yard gets an idle nudge. Screenshots land in .claude/preview-tools/safehouse-smoke/voice-*.png.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import WebSocket from 'ws';
const require = createRequire(import.meta.url);
const { chromium } = require('../.claude/preview-tools/node_modules/playwright');
const base = process.env.SMOKE_URL ?? 'http://127.0.0.1:4410';
const shots = '.claude/preview-tools/safehouse-smoke';
let state, speech;
const said = [];
const ws = new WebSocket(base.replace('http:', 'ws:') + '/ws');
ws.on('message', (d) => {
  const m = JSON.parse(String(d));
  if (m.t !== 'state') return;
  state = m.scene.safehouse;
  const s = m.scene.speech;
  if (s && (s.text !== speech?.text || s.until !== speech?.until))
    said.push({ text: s.text, current: state.current?.status, activity: state.survivor.activity });
  speech = s;
});
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
async function wait(fn, label, timeout = 120000) {
  const end = Date.now() + timeout;
  while (!fn()) {
    if (Date.now() > end) throw new Error(`Timeout ${label}; said so far: ${JSON.stringify(said.map((s) => s.text))}`);
    await delay(50);
  }
}
async function post(path, body) {
  const r = await fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  assert.ok(r.ok, `${path}: ${await r.text()}`);
}
// Status lines open with a capital; his muttering never does.
const mutter = (t) => /^[a-z]/.test(t);
const bubble = (page) =>
  page.evaluate(() => {
    const b = document.getElementById('speech');
    const r = b.getBoundingClientRect();
    return { hidden: b.hidden, text: b.textContent, left: r.left, top: r.top, width: r.width, height: r.height, vw: innerWidth, vh: innerHeight };
  });
let browser;
try {
  await wait(() => state, 'connect');
  assert.equal(state.fixture, true);
  await post('/admin/api/action', { id: 'safehouse-combat-pause' }); // a quiet yard: no wave lines in this run
  browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(base);
  await page.waitForFunction(() => document.querySelectorAll('#creations optgroup').length >= 1);
  assert.equal(await page.evaluate(() => document.getElementById('wave').hidden), true, 'no wave badge while zombies are paused');

  await post('/admin/api/chat', { username: 'dave', text: 'Build a duck-shaped watchtower' });
  await wait(() => said.some((s) => s.text === "Got your idea, dave. It's in the queue."), 'plain acknowledgement', 15000);
  await wait(
    () => said.some((s) => mutter(s.text) && (s.current === 'walking' || s.current === 'building')),
    'a muttered line on the way or at work',
    60000,
  );
  await delay(400); // the page gets the same snapshot; give it a frame
  const work = await bubble(page);
  await page.screenshot({ path: `${shots}/voice-work.png` });
  await wait(() => said.some((s) => s.text === 'Finished Duck-shaped watchtower, suggested by dave.'), 'plain completion', 60000);
  // Nothing left to do: a nudge to chat within about twenty seconds of settling.
  await wait(() => said.some((s) => mutter(s.text) && s.current === undefined), 'idle nudge', 60000);
  await delay(400);
  const idle = await bubble(page);
  await page.screenshot({ path: `${shots}/voice-idle.png` });

  // A request he cannot start yet (AI paused right after admission) must not freeze him: he paces.
  await post('/admin/api/chat', { username: 'erin', text: 'Build a scrap turret' });
  await post('/admin/api/action', { id: 'safehouse-pause' });
  await wait(() => state.current?.status === 'queued', 'request waiting', 10000);
  const trail = [];
  const paceEnd = Date.now() + 14000;
  while (Date.now() < paceEnd) {
    trail.push({ ...state.survivor.position, activity: state.survivor.activity });
    await delay(250);
  }
  await page.screenshot({ path: `${shots}/voice-pace.png` });
  const origin = trail[0];
  const roamed = Math.max(...trail.map((p) => Math.hypot(p.x - origin.x, p.z - origin.z)));
  assert.ok(trail.some((p) => p.activity === 'walking'), 'he walks while the request waits');
  assert.ok(roamed > 2, `he actually goes somewhere while waiting (${roamed.toFixed(1)} m)`);
  assert.equal(state.current?.status, 'queued', 'the request is still waiting for the AI');
  await post('/admin/api/action', { id: 'safehouse-resume' });
  await wait(() => said.some((s) => s.text === 'Finished Scrap turret, suggested by erin.'), 'the waiting request completes once resumed', 90000);

  assert.deepEqual(errors, []);
  for (const b of [work, idle]) {
    assert.equal(b.hidden, false, 'bubble showing');
    assert.ok(mutter(b.text), `bubble carries the muttered line: ${b.text}`);
    assert.ok(b.left >= 0 && b.top >= 0 && b.left + b.width <= b.vw && b.top + b.height <= b.vh, `bubble on screen: ${JSON.stringify(b)}`);
  }
  const plain = said.filter((s) => !mutter(s.text)).map((s) => s.text);
  assert.ok(plain.includes('Finished Duck-shaped watchtower, suggested by dave.'), 'completion stayed plain');
  console.log(
    JSON.stringify({ ok: true, said: said.map((s) => `${s.current ?? 'idle'}: ${s.text}`), work: work.text, idle: idle.text, roamed: Number(roamed.toFixed(1)), errors }),
  );
} finally {
  ws.close();
  await browser?.close();
}
