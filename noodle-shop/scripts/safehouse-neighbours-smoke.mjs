// Fixture-only: the neighbours in the real app. Marge and Jake show up on the page with name tags,
// start building on their own lots (a ghost first, then the piece), say a line, and when chat's
// gorilla turns up next door one of them puts up a barricade and builds a hunter. Then chat fills
// the street with animals and one of them reads the block, adopts the look and redoes a piece of
// their own yard in it. Screenshots land in .claude/preview-tools/safehouse-smoke/neighbours-*.png.
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
    if (Date.now() > end) throw new Error(`Timeout ${label}; neighbours: ${JSON.stringify(state?.neighbours?.map((n) => [n.name, n.activity, n.job?.label]))}; said: ${JSON.stringify(said.slice(-6))}`);
    await delay(100);
  }
}
async function post(path, body) {
  const r = await fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  assert.ok(r.ok, `${path}: ${await r.text()}`);
}
const owned = (id) => (state?.objects ?? []).filter((o) => o.owner === id && o.destroyedAt === undefined);
const neighbour = (id) => state?.neighbours?.find((n) => n.id === id);
let browser;
try {
  await wait(() => state, 'connect');
  assert.equal(state.fixture, true);
  await post('/admin/api/action', { id: 'safehouse-combat-pause' });
  assert.equal(state.neighbours?.length, 2, 'two neighbours in the snapshot');
  browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(base);
  await page.waitForFunction(() => document.querySelectorAll('#creations optgroup').length >= 1);

  // 1. Both are on the page with their names over their heads.
  await page.waitForFunction(() => document.querySelectorAll('#people .tag').length === 2);
  const tags = await page.evaluate(() => [...document.querySelectorAll('#people .tag')].map((t) => t.textContent));
  assert.ok(tags.some((t) => /Marge/.test(t)) && tags.some((t) => /Jake/.test(t)), JSON.stringify(tags));

  // 2. A project starts: a ghost of the build shows while they walk, they say something, then the piece lands.
  await wait(() => state.neighbours.some((n) => n.job?.preview), 'a neighbour sets off to build something', 90000);
  const busy = state.neighbours.find((n) => n.job?.preview);
  const previewAt = { ...busy.job.preview.position };
  // The page draws a snapshot and a half behind the server (more after a hiccup): poll, don't sleep.
  await page.waitForFunction(
    ({ x, z }) => {
      const three = window.__safehouseScene;
      let found = false;
      three?.traverse((o) => {
        if (o.isMesh && o.material?.transparent && Math.abs(o.parent.position.x - x) < 0.01 && Math.abs(o.parent.position.z - z) < 0.01) found = true;
      });
      return found;
    },
    previewAt,
    { timeout: 8000 },
  );
  await page.screenshot({ path: `${shots}/neighbours-ghost.png` });
  await wait(() => state.neighbours.some((n) => n.say), 'a neighbour says something', 60000);
  await page.waitForFunction(() => [...document.querySelectorAll('#people .say')].some((s) => !s.hidden), null, { timeout: 8000 });
  const bubbles = await page.evaluate(() => [...document.querySelectorAll('#people .say')].filter((s) => !s.hidden).map((s) => s.textContent));
  await page.screenshot({ path: `${shots}/neighbours-bubble.png` });
  await wait(() => owned('west').length + owned('east').length >= 1, 'the first piece lands', 90000);
  const first = [...owned('west'), ...owned('east')][0];
  assert.ok(first.fixed && first.owner, 'owned pieces are part of the neighborhood');
  // The Inspect list is rebuilt when the page reaches that snapshot, a moment after the socket saw it.
  await page.waitForFunction((id) => [...document.querySelectorAll('#creations option')].some((o) => o.value === id), first.id, { timeout: 8000 });
  const inspect = await page.evaluate((id) => {
    const select = document.getElementById('creations');
    select.value = id;
    select.dispatchEvent(new Event('change'));
    return document.getElementById('inspect-detail').textContent;
  }, first.id);
  assert.match(inspect, /Built by (Marge|Jake) next door/);
  const groups = await page.evaluate(() => [...document.querySelectorAll('#creations optgroup')].map((g) => g.label));
  assert.ok(groups.includes('Built next door'), JSON.stringify(groups));
  await delay(600);
  await page.screenshot({ path: `${shots}/neighbours-first-build.png` });

  // 3. Chat's gorilla next door: an alarm, a barricade, then a hunter with the gorilla as its nemesis.
  await post('/admin/api/chat', { username: 'dave', text: 'Build a gorilla that runs around and breaks things at -27,-3' });
  await wait(() => state.objects.some((o) => o.creature?.behaviour === 'rampage' && o.destroyedAt === undefined), 'gorilla built', 120000);
  const gorilla = state.objects.find((o) => o.creature?.behaviour === 'rampage');
  await wait(() => neighbour('west')?.alert || neighbour('east')?.alert, 'somebody notices', 60000);
  await page.waitForFunction(() => document.querySelectorAll('#people .tag.alert').length >= 1, null, { timeout: 8000 });
  const alertTags = await page.evaluate(() => [...document.querySelectorAll('#people .tag.alert')].map((t) => t.textContent));
  await wait(() => [...owned('west'), ...owned('east')].some((o) => o.role === 'barrier' && /barricade/i.test(o.blueprint.name)), 'a barricade goes up', 120000);
  await delay(800);
  await page.screenshot({ path: `${shots}/neighbours-barricade.png` });
  await wait(() => [...owned('west'), ...owned('east')].some((o) => o.creature?.nemesis === gorilla.id), 'a hunter is built', 150000);
  const hunter = [...owned('west'), ...owned('east')].find((o) => o.creature?.nemesis === gorilla.id);
  assert.match(hunter.blueprint.name, /hunter$/);
  await wait(() => (state.objects.find((o) => o.id === gorilla.id)?.health ?? 0) < 300 || !state.objects.some((o) => o.id === gorilla.id && o.destroyedAt === undefined), 'the hunter gets at the gorilla', 120000);
  await delay(800);
  await page.screenshot({ path: `${shots}/neighbours-hunter.png` });
  assert.ok(said.some((l) => /marge|dev|neighbours/.test(l)), `Rook remarked on them: ${JSON.stringify(said.slice(-10))}`);

  // 4. Chat fills the street with animals: somebody reads the block, adopts a look, and redoes a
  //    piece of their own yard in it — same id, new geometry, and the theme on their name tag.
  //    One live job per chatter and a three-second gap between theirs, so these go out spaced and
  //    under different names or the later ones are simply refused.
  const zoo = [
    ['ana', 'Build a dog that fights at 4,6'],
    ['ben', 'Build a chicken at 7,6'],
    ['cara', 'Build a duck at -4,6'],
  ];
  for (const [username, text] of zoo) {
    await post('/admin/api/chat', { username, text });
    await delay(4000);
  }
  await wait(() => state.objects.filter((o) => !o.fixed && o.destroyedAt === undefined).length >= 2, 'the street fills up with chat builds', 180000);
  await wait(() => state.neighbours.some((n) => n.theme && n.theme !== 'much as it was'), 'somebody reads the block and picks a look', 150000);
  const themed = state.neighbours.find((n) => n.theme && n.theme !== 'much as it was');
  assert.equal(themed.theme, 'all creatures', `the fixture surveyor reads a menagerie: ${themed.theme}`);
  // The theme reaches the page on their tag once they are not mid-job.
  await page.waitForFunction((t) => [...document.querySelectorAll('#people .tag')].some((el) => el.textContent.includes(t)), themed.theme, { timeout: 30000 });
  const themeTags = await page.evaluate(() => [...document.querySelectorAll('#people .tag')].map((t) => t.textContent));
  // A retheme replaces a piece in place: its id stays, its revision climbs.
  const before = new Map([...owned('west'), ...owned('east')].map((o) => [o.id, o.revision]));
  await wait(
    () => [...owned('west'), ...owned('east')].some((o) => before.has(o.id) && o.revision > before.get(o.id)),
    'a yard piece is redone in place',
    180000,
  );
  const redone = [...owned('west'), ...owned('east')].find((o) => before.has(o.id) && o.revision > before.get(o.id));
  await delay(800);
  await page.screenshot({ path: `${shots}/neighbours-theme.png` });
  // The cap holds: five yard pieces each, defenses and creatures aside.
  for (const id of ['west', 'east']) {
    const yard = owned(id).filter((o) => !o.creature && (o.role ?? 'decoration') === 'decoration' && !/-(light|kennel|care)$/.test(o.id));
    assert.ok(yard.length <= 5, `${id} keeps at most five yard pieces, saw ${yard.length}: ${yard.map((o) => o.id).join(', ')}`);
  }

  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      ok: true,
      theme: `${themed.name}: ${themed.theme}`,
      themeTags,
      redone: `${redone.blueprint.name} #${redone.id} rev ${redone.revision}`,
      neighbours: state.neighbours.map((n) => `${n.name}: ${n.activity}${n.job ? ` (${n.job.label})` : ''}`),
      owned: [...owned('west'), ...owned('east')].map((o) => o.blueprint.name),
      hunter: `${hunter.blueprint.name} ${Math.round(hunter.health)}/${hunter.maxHealth}`,
      gorilla: state.objects.find((o) => o.id === gorilla.id)?.health,
      bubbles,
      alertTags,
      said,
      errors,
    }),
  );
} finally {
  ws.close();
  await browser?.close();
}
