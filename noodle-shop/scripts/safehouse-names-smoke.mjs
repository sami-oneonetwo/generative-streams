// Fixture-only, no browser: chat names things the way people talk and the world does the
// right thing end to end. Two "Street barricade"s go up (fixture mode names every build
// that); "the street barricade" alone is a question that names both; "the street barricade
// in the back" moves the right one to the front yard; "my street barricade" paints the
// requester's own; "repair the fence" over an undamaged fence asks which of the sections.
import assert from 'node:assert/strict';
import WebSocket from 'ws';
const base = process.env.SMOKE_URL ?? 'http://127.0.0.1:4410';
const FRONT = { minX: -6, maxX: 6, minZ: -1.3, maxZ: 4.2 }; // LANDMARKS['front yard']
let state;
const ws = new WebSocket(base.replace('http:', 'ws:') + '/ws');
ws.on('message', (d) => {
  const m = JSON.parse(String(d));
  if (m.t === 'state') state = m.scene.safehouse;
});
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
async function wait(fn, label, timeout = 120000) {
  const end = Date.now() + timeout;
  while (!fn()) {
    if (Date.now() > end) throw new Error(`Timeout ${label} (notice: ${state?.notice})`);
    await delay(100);
  }
}
async function say(username, text) {
  const r = await fetch(base + '/admin/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, text }) });
  assert.ok(r.ok, `${text}: ${await r.text()}`);
}
/** A request that becomes a job: wait for it to be admitted and finished. */
async function job(username, text) {
  const before = state.recent.length + (state.current ? 1 : 0) + state.pending.length;
  await say(username, text);
  await wait(() => state.current || state.recent.length > before, `admitted “${text}”`, 10000);
  await wait(() => !state.current && !state.pending.length, `finished “${text}”`);
  const done = state.recent.at(-1);
  assert.equal(done.status, 'complete', `${text}: ${done.error ?? done.status}`);
  return done;
}
const inside = (r, p) => p.x >= r.minX && p.x <= r.maxX && p.z >= r.minZ && p.z <= r.maxZ;
const barricades = () => state.objects.filter((o) => !o.fixed && /street barricade/i.test(o.blueprint.name));
try {
  await wait(() => state, 'connect');
  assert.equal(state.fixture, true);
  await job('ana', 'Build a barricade'); // no spot: placement prefers the rear lot, the back yard
  await job('ben', 'Build a barricade in the front yard'); // the area picks a free spot
  assert.equal(barricades().length, 2, 'two street barricades standing');
  const rear = barricades().find((o) => o.position.z <= -11);
  assert.ok(rear, `one of them is out back (${barricades().map((o) => `${o.position.x},${o.position.z}`).join(' / ')})`);
  assert.ok(barricades().some((o) => o.id !== rear.id && inside(FRONT, o.position)), 'the other is in the front yard');

  await say('cat', 'Move the street barricade to the front');
  await wait(() => /^Which street barricade\?/.test(state.notice), 'asks which', 5000);
  assert.match(state.notice, /back yard, by ana/);
  assert.match(state.notice, /front yard, by ben/);
  assert.match(state.notice, /the street barricade in the/);
  await delay(3200); // per-user pacing

  await job('cat', 'Move the street barricade in the back to the front');
  const moved = state.objects.find((o) => o.id === rear.id);
  assert.ok(inside(FRONT, moved.position), `moved into the front yard (${moved.position.x},${moved.position.z})`);

  await job('ana', 'Paint my street barricade red');
  assert.equal(state.objects.find((o) => o.id === rear.id).blueprint.color, '#b65b50', "ana's own barricade is red");
  assert.notEqual(barricades().find((o) => o.id !== rear.id).blueprint.color, '#b65b50', "ben's is not");

  await say('dan', 'Repair the fence');
  await wait(() => /^Which of the \d+ fence sections\?/.test(state.notice), 'fence needs a place', 5000);
  await say('eve', 'Move the spaceship to the front');
  await wait(() => /can't find “the spaceship”/.test(state.notice), 'honest miss', 5000);
  console.log(JSON.stringify({ ok: true, moved: moved.position, notice: state.notice, recent: state.recent.map((j) => `${j.label}: ${j.status}`) }));
} finally {
  ws.close();
}
