// Fixture-only: do the moving things move smoothly? Rook is sent across the yard and a
// few zombies are let in, then every animation frame for a few seconds records where
// each person-sized group in the scene is. Anything that covered ground is scored:
// the share of frames it stood still while travelling (move-stop-move stepping shows
// up here as ~70 %), and how uneven its frame-to-frame speed was. Prints the scores;
// with EXPECT_SMOOTH=1 it fails when the walkers are still stepping.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import WebSocket from 'ws';
const require = createRequire(import.meta.url);
const { chromium } = require('../.claude/preview-tools/node_modules/playwright');
const base = process.env.SMOKE_URL ?? 'http://127.0.0.1:4410';
const seconds = Number(process.env.SECONDS ?? 6);
let state;
const ws = new WebSocket(base.replace('http:', 'ws:') + '/ws');
ws.on('message', (d) => {
  const m = JSON.parse(String(d));
  if (m.t === 'state') state = m.scene.safehouse;
});
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
async function wait(fn, label, timeout = 60000) {
  const end = Date.now() + timeout;
  while (!fn()) {
    if (Date.now() > end) throw new Error('Timeout ' + label);
    await delay(100);
  }
}
async function post(path, body) {
  const r = await fetch(base + '/admin/api' + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  assert.ok(r.ok, `${path}: ${await r.text()}`);
}
let browser;
try {
  await wait(() => state, 'connect');
  assert.equal(state.fixture, true);
  browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(base);
  await page.waitForFunction(() => document.querySelectorAll('#creations optgroup').length >= 1);
  // Zombies from the street, and a job (placed wherever is free, so a reused world still works) to get Rook walking.
  await post('/action', { id: 'safehouse-zombies' });
  await post('/action', { id: 'safehouse-zombies' });
  await post('/action', { id: 'safehouse-combat-start' });
  await post('/chat', { username: 'motion-test', text: 'Build a barricade' });
  await wait(() => state.current?.status === 'walking' || state.survivor.activity === 'walking', 'Rook sets off', 20000);
  // Zombies with somewhere to go; ones already chewing a fence stand still for good.
  await wait(() => state.combat?.zombies.filter((z) => z.path.length).length >= 2, 'zombies on the move', 20000);
  const frames = await page.evaluate(
    (seconds) =>
      new Promise((resolve) => {
        const scene = window.__safehouseScene;
        // People (Rook, zombies) and living builds are groups of meshes sitting directly in
        // the world group or the objects layer; static scenery groups score zero and drop out.
        const groups = [];
        scene.traverse((o) => {
          if (o.type === 'Group' && o.children.some((c) => c.isMesh) && o.parent && o.parent.type === 'Group') groups.push(o);
        });
        const log = [];
        const start = performance.now();
        function tick(now) {
          log.push({ t: now, p: groups.map((g) => [g.position.x, g.position.z]) });
          if (now - start < seconds * 1000) requestAnimationFrame(tick);
          else resolve(log);
        }
        requestAnimationFrame(tick);
      }),
    seconds,
  );
  await page.screenshot({ path: '.claude/preview-tools/safehouse-smoke/motion.png' });
  const movers = [];
  const count = frames[0].p.length;
  for (let i = 0; i < count; i++) {
    // Per-frame distances; speeds over three frames so the page's and the probe's frame
    // callbacks falling in a different order once does not read as a jolt.
    const d = [],
      dt = [];
    for (let f = 1; f < frames.length; f++) {
      const [ax, az] = frames[f - 1].p[i],
        [bx, bz] = frames[f].p[i];
      d.push(Math.hypot(bx - ax, bz - az));
      dt.push((frames[f].t - frames[f - 1].t) / 1000);
    }
    const path = d.reduce((a, b) => a + b, 0);
    if (path < 0.8) continue;
    // Stepping is a stop of well under a snapshot (500 ms) between moving frames. A zombie
    // chewing the fence (1.2 s between bites) or Rook at a build stands for longer than that:
    // a pause, not stepping. Still runs of half a second or more are left out of the travel.
    const moved = (x) => x >= 0.002;
    const PAUSE = 30; // frames, ~0.5 s at 60 fps
    let still = 0,
      travel = 0;
    const speeds = [];
    for (let f = 0; f < d.length; ) {
      if (moved(d[f])) {
        travel++;
        if (f + 2 < d.length && moved(d[f + 1]) && moved(d[f + 2])) speeds.push((d[f] + d[f + 1] + d[f + 2]) / (dt[f] + dt[f + 1] + dt[f + 2]));
        f++;
        continue;
      }
      let run = 0;
      while (f + run < d.length && !moved(d[f + run])) run++;
      const interior = f > 0 && f + run < d.length;
      if (interior && run < PAUSE) {
        still += run;
        travel += run;
      }
      f += run;
    }
    const mean = speeds.reduce((a, b) => a + b, 0) / Math.max(1, speeds.length);
    const sd = Math.sqrt(speeds.reduce((a, s) => a + (s - mean) ** 2, 0) / Math.max(1, speeds.length));
    movers.push({
      path: +path.toFixed(2),
      travelFrames: travel,
      stillShare: +(still / Math.max(1, travel)).toFixed(2),
      meanSpeed: +mean.toFixed(2),
      speedCv: +(sd / mean).toFixed(2),
      fastest: +Math.max(...speeds).toFixed(1),
    });
  }
  const report = { ok: true, frames: frames.length, fps: +(frames.length / seconds).toFixed(0), movers, errors };
  console.log(JSON.stringify(report));
  assert.deepEqual(errors, []);
  assert.ok(movers.length >= 2, 'something moved');
  if (process.env.EXPECT_SMOOTH) {
    for (const m of movers) {
      assert.ok(m.stillShare < 0.15, `travels without stopping (still ${m.stillShare})`);
      assert.ok(m.speedCv < 0.6, `steady speed (cv ${m.speedCv})`);
    }
  }
} finally {
  ws.close();
  await browser?.close();
}
