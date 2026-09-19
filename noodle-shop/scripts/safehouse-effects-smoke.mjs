// Fixture-only: zombies hit the fence; the page shows dust and a punch, with no errors.
// Screenshots land in .claude/preview-tools/safehouse-smoke/effects-*.png for a human look.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import WebSocket from 'ws';
const require = createRequire(import.meta.url);
const { chromium } = require('../.claude/preview-tools/node_modules/playwright');
const base = process.env.SMOKE_URL ?? 'http://127.0.0.1:4410';
const shots = '.claude/preview-tools/safehouse-smoke';
let state;
const ws = new WebSocket(base.replace('http:', 'ws:') + '/ws');
ws.on('message', (d) => {
  const m = JSON.parse(String(d));
  if (m.t === 'state') state = m.scene.safehouse;
});
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
async function wait(fn, label, timeout = 180000) {
  const end = Date.now() + timeout;
  while (!fn()) {
    if (Date.now() > end) throw new Error('Timeout ' + label);
    await delay(50);
  }
}
async function action(id) {
  const r = await fetch(base + '/admin/api/action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) });
  assert.ok(r.ok, `${id}: ${await r.text()}`);
}
const damageTotal = () => state.objects.reduce((n, o) => n + (o.damageRevision ?? 0), 0);
let browser;
try {
  await wait(() => state, 'connect');
  assert.equal(state.fixture, true);
  await action('safehouse-repairs-pause'); // keep Rook out of the frame so the hits are the subject
  browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(base);
  await page.waitForFunction(() => document.querySelectorAll('#creations optgroup').length >= 1);
  // The camera should drift on its own: the same world must not render to identical pixels 3 s apart.
  const shotA = await page.screenshot({ type: 'png' });
  await delay(3000);
  const shotB = await page.screenshot({ type: 'png' });
  assert.notEqual(Buffer.compare(shotA, shotB), 0, 'ambient camera pan moves the frame');

  await action('safehouse-zombies');
  await action('safehouse-combat-start');
  await wait(() => damageTotal() > 0, 'zombies start hitting');
  // Catch a few hits mid-puff: motes live ~0.75–1.2 s, hits land every 1.2 s per zombie, and the
  // page shows a hit about 0.75 s after the snapshot carrying it (it draws the world that far
  // behind the server so movers slide instead of stepping; see motion.ts).
  for (let i = 0; i < 3; i++) {
    const before = damageTotal();
    await wait(() => damageTotal() > before, 'next hit', 20000);
    await delay(950);
    await page.screenshot({ path: `${shots}/effects-hit-${i + 1}.png` });
  }
  const motes = await page.evaluate(() => {
    // Count small transparent cubes currently in the scene: those are the dust motes.
    const three = window.__safehouseScene;
    if (!three) return -1;
    let n = 0;
    three.traverse((o) => {
      if (o.isMesh && o.material?.transparent && o.material?.depthWrite === false && o.scale.x < 0.6) n++;
    });
    return n;
  });
  await action('safehouse-combat-pause');
  await action('safehouse-repairs-resume');
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ ok: true, hits: damageTotal(), motesAtLastShot: motes, zombies: state.combat.zombies.length, errors }));
} finally {
  ws.close();
  await browser?.close();
}
