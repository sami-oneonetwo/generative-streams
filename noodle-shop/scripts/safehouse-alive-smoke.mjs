// Fixture-only: small life and the crowd in the real app. Rook sits down on the porch when nothing
// is on and the page lowers his figure; the block's wild birds are in the snapshot and one of them
// settles on a perch; the trees carry part motion and the page drifts their canopies; three chatters
// speak and appear as figures on the pavement across the street with a name tag each; a chat bird
// with a perch rule lands on a perch; a chat bench is a seat the stray cat walks over to; and if
// Jake gets to his hoop in time, the ball is in the air. Verbs as data: the pond is seeded with
// `swim`, so `!swim` stands unlocked on a fresh world — dave's figure jogs to the pond, lies flat in
// the water with SPLASH over its head and walks back; a chat trampoline carries `bounce`, and erin
// hops on it with BOING. Chat verbs: kim builds a hoop, `!verbs`
// lists what stands unlocked, `!shoot` sends her figure off the pavement to take the shot (the ball
// flies, SWISH!/MISS pops, the board shows her record), `!honk` sounds a car, `!dance` is refused
// until speakers stand. Then tactics: a hole dug in the front holds a walker (the page sinks it), a
// speaker stack pulls the horde and it dances (the page bounces it; ivy's `!dance` works now), and —
// if they get to it in time — somebody dances along and Marge fills the hole in. Screenshots land in
// .claude/preview-tools/safehouse-smoke/alive-*.png.
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
async function wait(fn, label, timeout = 60000) {
  const end = Date.now() + timeout;
  while (!fn()) {
    if (Date.now() > end)
      throw new Error(
        `Timeout ${typeof label === 'function' ? label() : label}; wild: ${JSON.stringify((state?.objects ?? []).filter((o) => o.wild).map((o) => [o.blueprint.name, o.creature?.goal]))}; crowd: ${JSON.stringify(state?.crowd)}`,
      );
    await delay(100);
  }
}
async function post(path, body) {
  const r = await fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  assert.ok(r.ok, `${path}: ${await r.text()}`);
}
const wild = () => (state?.objects ?? []).filter((o) => o.wild && o.destroyedAt === undefined);
let browser;
try {
  await wait(() => state, 'connect');
  assert.equal(state.fixture, true);
  await post('/admin/api/action', { id: 'safehouse-combat-pause' });
  browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(base);
  await page.waitForFunction(() => document.querySelectorAll('#creations optgroup').length >= 1);

  // 0. Nothing on: Rook sits down on the porch steps after a while, and the page draws him seated.
  await wait(() => state.survivor.activity === 'sitting', 'Rook sits down with nothing on', 60000);
  await page.waitForFunction(() => (window.__safehouseRook?.position.y ?? 1) < -0.1, null, { timeout: 10000 });
  const rookY = await page.evaluate(() => window.__safehouseRook.position.y);
  await page.screenshot({ path: `${shots}/alive-sitting.png` });

  // 1. Part motion as data: the trees carry animations in the view and the page moves their canopies.
  const trees = state.objects.filter((o) => /^scenery-tree-/.test(o.id));
  assert.ok(trees.length >= 7, 'trees are in the snapshot');
  const animated = trees.filter((o) => o.blueprint.animations?.length);
  assert.ok(animated.length >= 1, `trees carry animations in the view (${animated.length} of ${trees.length})`);
  const treeId = animated[0].id;
  // Sample a canopy part's position twice a moment apart: it should have drifted.
  await page.waitForFunction(
    (id) => {
      let found = false;
      window.__safehouseScene?.traverse((o) => {
        if (o.isMesh && o.userData.objectId === id && o.userData.base) found = true;
      });
      return found;
    },
    treeId,
    { timeout: 15000 },
  );
  const canopy = async () =>
    page.evaluate((id) => {
      const out = [];
      window.__safehouseScene?.traverse((o) => {
        if (o.isMesh && o.userData.objectId === id && o.userData.base) out.push([o.position.x, o.position.y, o.position.z, o.rotation.z]);
      });
      return out;
    }, treeId);
  const a = await canopy();
  await delay(700);
  const b = await canopy();
  const moved = a.some((p, i) => b[i] && p.some((v, k) => Math.abs(v - b[i][k]) > 1e-4));
  assert.ok(moved, `an animated tree part moved between frames: ${JSON.stringify(a)} → ${JSON.stringify(b)}`);

  // 2. The block's own small life: birds in the snapshot, marked wild, and one settles on a perch.
  await wait(() => wild().length >= 1, 'wildlife is out', 30000);
  assert.ok(wild().every((o) => o.wild && o.fixed && o.creature), 'wild pieces are fixed creatures');
  const wildGroup = await page.evaluate(() => [...document.querySelectorAll('#creations optgroup')].map((g) => g.label));
  assert.ok(wildGroup.includes('Wildlife'), `Inspect lists Wildlife: ${JSON.stringify(wildGroup)}`);
  await wait(() => wild().some((o) => o.creature?.goal?.perched), 'a bird reaches a perch', 90000);
  const perched = wild().find((o) => o.creature?.goal?.perched);
  await delay(1200);
  await page.screenshot({ path: `${shots}/alive-perch.png` });

  // 3. The crowd: three chatters speak, three figures stand on the pavement, tags show while they are recent.
  for (const [username, text] of [
    ['dave', 'hello'],
    ['erin', 'hi everyone'],
    ['sam', 'what are we building'],
  ]) {
    await post('/admin/api/chat', { username, text });
    await delay(300);
  }
  await wait(() => (state.crowd?.length ?? 0) >= 3, 'three viewers on the pavement', 20000);
  assert.ok(state.crowd.every((c) => Math.abs(c.position.z - 14.6) < 2), `they stand on the far pavement: ${JSON.stringify(state.crowd.map((c) => c.position))}`);
  await page.waitForFunction(() => document.querySelectorAll('#people .tag.viewer:not([hidden])').length >= 1, null, { timeout: 8000 });
  const tags = await page.evaluate(() => [...document.querySelectorAll('#people .tag.viewer')].filter((t) => !t.hidden).map((t) => t.textContent));
  // The crowd is four InstancedMeshes (legs, torso, head, arm); legs and torso are the 0.55 m boxes.
  await page.waitForFunction(
    (n) => {
      const counts = [];
      window.__safehouseScene?.traverse((o) => {
        if (o.isInstancedMesh && o.geometry?.parameters?.height === 0.55) counts.push(o.count);
      });
      return counts.length && counts.every((c) => c === n);
    },
    state.crowd.length,
    { timeout: 8000 },
  );
  const instanced = await page.evaluate(() => {
    const counts = [];
    window.__safehouseScene?.traverse((o) => {
      if (o.isInstancedMesh && o.geometry?.parameters?.height === 0.55) counts.push(o.count);
    });
    return counts;
  });
  assert.ok(instanced.some((n) => n === state.crowd.length), `the instanced figures match the crowd (${JSON.stringify(instanced)} vs ${state.crowd.length})`);
  const footer = await page.evaluate(() => document.getElementById('connection').textContent);
  assert.match(footer, /\d+ watching/);
  await delay(600);
  await page.screenshot({ path: `${shots}/alive-crowd.png` });

  // 3b. Verbs as data (verbs.ts): a piece may carry its own verb, and `!word` exists while it stands.
  //     The pond is seeded with `swim`, so on a fresh world `!verbs` already names `!swim (Pond)`.
  //     dave's figure jogs off the pavement to the pond, lies flat in the water (the page lays the
  //     instance horizontal: its torso's up axis is flat), SPLASH pops over the head, and after the
  //     verb's seconds dave walks back to the pavement. A trampoline chat builds carries `bounce`:
  //     erin steps up onto the mat and hops with BOING.
  const busy = () => (state.current && state.current.status !== 'complete' && state.current.status !== 'failed') || state.pending.length;
  const noticeBeforeSwim = state.notice;
  await post('/admin/api/chat', { username: 'dave', text: '!verbs' });
  await wait(() => state.notice !== noticeBeforeSwim && /!swim/.test(state.notice), () => `!verbs names !swim on a fresh world; notice: ${state.notice}`, 15000);
  const swimNotice = state.notice;
  assert.ok(
    state.verbs?.some((v) => v.verb === '!swim' && v.unlocked && /pond/i.test(v.needs)),
    `the scene lists !swim unlocked by the pond: ${JSON.stringify(state.verbs)}`,
  );
  const dave = () => state.crowd?.find((c) => c.name === 'dave');
  await post('/admin/api/chat', { username: 'dave', text: '!swim' });
  await wait(
    () => dave()?.errand?.kind === 'verb' && dave().errand.word === 'swim',
    () => `dave sets off to swim; dave: ${JSON.stringify(dave())}; notice: ${state.notice}`,
    15000,
  );
  await wait(() => dave()?.errand?.phase === 'doing', () => `dave reaches the pond; dave: ${JSON.stringify(dave())}`, 120000);
  const swimming = JSON.parse(JSON.stringify(dave()));
  assert.equal(swimming.errand.pose, 'swim', `the pose is swim: ${JSON.stringify(swimming.errand)}`);
  assert.ok(swimming.errand.y >= 0 && swimming.errand.y <= 0.6, `at water level: y ${swimming.errand.y}`);
  assert.ok(
    Math.hypot(swimming.position.x - 40, swimming.position.z + 14.5) < 3.2,
    `in the pond, not beside it: ${JSON.stringify(swimming.position)}`,
  );
  // SPLASH pops over the head on arrival. The pond sits at the very right edge of the frame (x 40),
  // so the tag may be hidden as off-screen at this viewport; the page having made it with the word
  // is the check here, and the trampoline below (well inside the frame) checks it is shown.
  await page.waitForFunction(
    () => [...document.querySelectorAll('#people .tag.pop.verb')].some((t) => /SPLASH/.test(t.textContent)),
    null,
    { timeout: 8000 },
  );
  // The page lays the figure flat: the torso instance's up axis (matrix element 5) is near zero.
  await page.waitForFunction(
    (name) => {
      const p = window.__safehouseCrowd?.probe(name);
      return !!p && Math.abs(p.torso[5]) < 0.35;
    },
    'dave',
    { timeout: 12000 },
  );
  const torsoUp = await page.evaluate((name) => window.__safehouseCrowd.probe(name).torso[5], 'dave');
  await page.screenshot({ path: `${shots}/alive-swim.png` });
  await wait(() => !dave()?.errand, () => `dave is back on the pavement; dave: ${JSON.stringify(dave())}`, 120000);
  assert.ok(Math.abs(dave().position.z - 14.6) < 2, `back on the pavement: ${JSON.stringify(dave().position)}`);
  // A trampoline: the fixture carries the verb bounce / pose jump / spot on / BOING.
  await wait(() => !busy(), 'Rook is free before the trampoline', 120000);
  await post('/admin/api/chat', { username: 'erin', text: 'Build a trampoline at -17,10' });
  const trampoline = () => state.objects.find((o) => !o.fixed && o.verb?.word === 'bounce' && o.destroyedAt === undefined);
  await wait(() => trampoline(), () => `a trampoline with the bounce verb is built; last job: ${JSON.stringify(state?.recent?.at(-1))}`, 120000);
  const mat = trampoline();
  await wait(() => !busy(), 'Rook is free after the trampoline', 60000);
  const erin = () => state.crowd?.find((c) => c.name === 'erin');
  await post('/admin/api/chat', { username: 'erin', text: '!bounce' });
  await wait(() => erin()?.errand?.phase === 'doing', () => `erin gets onto the trampoline; erin: ${JSON.stringify(erin())}; notice: ${state.notice}`, 90000);
  const hopping = JSON.parse(JSON.stringify(erin()));
  assert.equal(hopping.errand.pose, 'jump', `the pose is jump: ${JSON.stringify(hopping.errand)}`);
  assert.ok(hopping.errand.y > 0.5, `up on the mat: y ${hopping.errand.y}`);
  await page.waitForFunction(
    () => [...document.querySelectorAll('#people .tag.pop.verb')].some((t) => !t.hidden && /BOING/.test(t.textContent)),
    null,
    { timeout: 8000 },
  );
  await page.screenshot({ path: `${shots}/alive-bounce.png` });
  await wait(() => !erin()?.errand, () => `erin is back on the pavement; erin: ${JSON.stringify(erin())}`, 120000);

  // 3c. Drive: the seeded Abandoned car (west) on the road carries the verb `drive`. dave gets in and
  //     the car pulls out and trundles up the street with him aboard — the piece's true position never
  //     changes, so the page draws it at `driven.at`; when the run ends the car is back where it parked.
  await wait(() => !busy(), 'Rook is free before the drive', 60000);
  const car = () => state.objects.find((o) => o.id === 'scenery-car-west');
  assert.ok(car()?.verb?.word === 'drive', `the abandoned car carries !drive: ${JSON.stringify(car()?.verb)}`);
  assert.ok(
    state.verbs?.some((v) => v.verb === '!drive' && v.unlocked && /car/i.test(v.needs)),
    `the scene lists !drive unlocked by the car: ${JSON.stringify(state.verbs)}`,
  );
  const carHome = { ...car().position };
  await post('/admin/api/chat', { username: 'dave', text: '!drive' });
  await wait(() => dave()?.errand?.kind === 'verb' && dave().errand.word === 'drive', () => `dave gets in; dave: ${JSON.stringify(dave())}; notice: ${state.notice}`, 15000);
  await wait(() => dave()?.errand?.phase === 'doing', () => `dave is driving; dave: ${JSON.stringify(dave())}`, 90000);
  // On the road: the car has a `driven` pose, moved well off its parked spot, dave sits in it.
  await wait(
    () => {
      const c = car(),
        d = dave();
      return c?.driven && Math.hypot(c.driven.at.x - carHome.x, c.driven.at.z - carHome.z) > 6 && d?.errand?.phase === 'doing';
    },
    () => `the car is out on the road; car: ${JSON.stringify(car()?.driven)} parked ${JSON.stringify(carHome)}`,
    90000,
  );
  const driving = JSON.parse(JSON.stringify(car()));
  const driver = JSON.parse(JSON.stringify(dave()));
  assert.equal(driver.errand.pose, 'sit', `dave sits to drive: ${JSON.stringify(driver.errand)}`);
  assert.ok(driver.errand.y > 0, `up in the seat: y ${driver.errand.y}`);
  assert.ok(
    Math.hypot(driver.position.x - driving.driven.at.x, driver.position.z - driving.driven.at.z) < 0.3,
    `dave rides where the car is drawn: dave ${JSON.stringify(driver.position)} car ${JSON.stringify(driving.driven.at)}`,
  );
  assert.ok(Math.abs(car().position.x - carHome.x) < 0.001 && Math.abs(car().position.z - carHome.z) < 0.001, 'the car\'s true position never moved');
  // The page draws the car near where the server says it is (a little behind, snapshot interpolation).
  await page.waitForFunction(
    (home) => {
      const p = window.__safehouseObjects?.positionOf('scenery-car-west');
      return !!p && Math.hypot(p.x - home.x, p.z - home.z) > 4;
    },
    carHome,
    { timeout: 8000 },
  );
  // The page draws about a snapshot and a half behind the server (3–4 m at driving pace), so the check
  // is against dave's drawn figure — both ride the same clock — not against the server's driven.at.
  const drawn = await page.evaluate(() => {
    const car = window.__safehouseObjects.positionOf('scenery-car-west');
    const torso = window.__safehouseCrowd?.probe('dave')?.torso;
    return { car, dave: torso ? { x: torso[12], y: torso[13], z: torso[14] } : undefined };
  });
  assert.ok(drawn.dave, 'dave is drawn');
  assert.ok(
    Math.hypot(drawn.car.x - drawn.dave.x, drawn.car.z - drawn.dave.z) < 1.5,
    `the car group is drawn under the driver: car ${JSON.stringify(drawn.car)} dave ${JSON.stringify(drawn.dave)} (server at ${JSON.stringify(driving.driven.at)})`,
  );
  assert.ok(drawn.dave.y > 0.5, `the driver sits up in the car: y ${drawn.dave.y}`);
  await page.screenshot({ path: `${shots}/alive-drive.png` });
  await wait(() => !car()?.driven && !dave()?.errand, () => `the run ends and dave is back; car.driven ${JSON.stringify(car()?.driven)}; dave ${JSON.stringify(dave())}`, 120000);
  assert.ok(Math.abs(car().position.x - carHome.x) < 0.001 && Math.abs(car().position.z - carHome.z) < 0.001, 'the car is parked back where it was');
  const carDrawnAfter = await page.evaluate(() => window.__safehouseObjects.positionOf('scenery-car-west'));
  assert.ok(Math.hypot(carDrawnAfter.x - carHome.x, carDrawnAfter.z - carHome.z) < 1.5, `the car is drawn back at its spot: ${JSON.stringify(carDrawnAfter)}`);

  // 3d. Ride: a horse chat builds carries `ride`. erin climbs on and sits on its back as it ambles.
  await wait(() => !busy(), 'Rook is free before the horse', 60000);
  await post('/admin/api/chat', { username: 'erin', text: 'Build a horse at -26,10' }); // the trampoline has -17,10; tree 7 ends at x -21
  const horse = () => state.objects.find((o) => !o.fixed && o.creature && o.verb?.word === 'ride' && o.destroyedAt === undefined);
  await wait(() => horse(), () => `a horse with the ride verb is built; last job: ${JSON.stringify(state?.recent?.at(-1))}`, 120000);
  await wait(() => !busy(), 'Rook is free after the horse', 60000);
  await post('/admin/api/chat', { username: 'erin', text: '!ride' });
  await wait(() => erin()?.errand?.kind === 'verb' && erin().errand.word === 'ride', () => `erin sets off to ride; erin: ${JSON.stringify(erin())}; notice: ${state.notice}`, 15000);
  await wait(() => erin()?.errand?.phase === 'doing', () => `erin gets on the horse; erin: ${JSON.stringify(erin())}`, 120000);
  // Seated on its back, riding along: over three snapshots erin stays on top of the horse.
  let ridden = 0;
  for (let i = 0; i < 40 && ridden < 3; i++) {
    const h = horse(),
      e = erin();
    if (h && e?.errand?.phase === 'doing' && Math.hypot(e.position.x - h.position.x, e.position.z - h.position.z) < 0.6 && e.errand.pose === 'sit' && e.errand.y > 0.3) ridden++;
    else if (e?.errand?.phase !== 'doing') break;
    await delay(400);
  }
  const riding = JSON.parse(JSON.stringify(erin()));
  assert.ok(ridden >= 3, `erin rode on the horse's back for three snapshots (pose ${riding.errand?.pose}, y ${riding.errand?.y}, ${ridden} seen)`);
  await page.screenshot({ path: `${shots}/alive-ride.png` });
  await wait(() => !erin()?.errand, () => `erin gets down; erin: ${JSON.stringify(erin())}`, 120000);

  // 3e. Fight: a robot chat builds carries `fight`. finn squares up; the bout is decided; he wins or loses.
  const finn = () => state.crowd?.find((c) => c.name === 'finn');
  await wait(() => !busy(), 'Rook is free before the robot', 60000);
  await post('/admin/api/chat', { username: 'finn', text: 'Build a robot at 20,10' });
  const robot = () => state.objects.find((o) => !o.fixed && o.creature && o.verb?.word === 'fight' && o.destroyedAt === undefined);
  await wait(() => robot(), () => `a robot with the fight verb is built; last job: ${JSON.stringify(state?.recent?.at(-1))}`, 120000);
  await wait(() => !busy(), 'Rook is free after the robot', 60000);
  await post('/admin/api/chat', { username: 'finn', text: '!fight' });
  await wait(() => finn()?.errand?.kind === 'verb' && finn().errand.word === 'fight', () => `finn sets off to fight; finn: ${JSON.stringify(finn())}; notice: ${state.notice}`, 15000);
  await wait(
    () => finn()?.errand?.phase === 'doing' && finn().errand.pose === 'punch' && (robot()?.creature?.busyMs ?? 0) > 0,
    () => `finn squares up and the robot stands its ground; finn: ${JSON.stringify(finn())}; robot busyMs ${robot()?.creature?.busyMs}`,
    120000,
  );
  await wait(() => finn()?.errand?.result === 'won' || finn()?.errand?.result === 'lost', () => `the bout is decided; finn: ${JSON.stringify(finn())}`, 60000);
  const bout = JSON.parse(JSON.stringify(finn()));
  const wonPose = bout.errand.result === 'won' ? 'cheer' : 'lie';
  assert.equal(bout.errand.pose, wonPose, `${bout.errand.result} → pose ${wonPose}: ${JSON.stringify(bout.errand)}`);
  const koWord = bout.errand.result === 'won' ? 'KO' : 'OOF';
  await page.waitForFunction(
    (word) => [...document.querySelectorAll('#people .tag.pop.verb')].some((t) => !t.hidden && t.textContent.includes(word)),
    koWord,
    { timeout: 8000 },
  );
  await page.screenshot({ path: `${shots}/alive-fight.png` });
  const fightResult = `${bout.errand.result} (pose ${bout.errand.pose}, pop ${koWord})`;
  await wait(() => !finn()?.errand, () => `finn leaves the ring; finn: ${JSON.stringify(finn())}`, 120000);

  // 4. The grammar is open to chat: a bird described as perching on fences comes with a perch rule
  //    and lands on a perch (the interpreter picks which; fences are seeded, so it may well be one).
  //    Plural and no article on purpose: "on the fence" is read by the request grammar as a mention of
  //    an existing fence section and answered with "Which of the 31 fence sections?".
  // By now the neighbours are redoing their yards and Rook may be mid-repair, so wait for him first.
  await wait(() => !busy(), 'Rook is free before the bird', 120000);
  await post('/admin/api/chat', { username: 'finn', text: 'Build a bird that perches on fences' });
  const chatBird = () => state.objects.find((o) => !o.wild && !o.fixed && o.creature && o.rules?.length && o.destroyedAt === undefined);
  await wait(() => chatBird(), 'a chat bird with rules is built', 180000);
  const byId = (id) => state.objects.find((o) => o.id === id);
  await wait(() => {
    const b = chatBird();
    return b?.creature?.goal?.perched && byId(b.creature.goal.targetId)?.uses?.includes('perch');
  }, 'the chat bird perches on something tagged perch', 120000);
  const bird = chatBird();
  const perchId = bird.creature.goal.targetId;
  await wait(() => !busy(), 'Rook is free again', 60000);

  // 5. A chat bench is a seat: the stray cat walks over to it (built by the skip, where the cat lives).
  await post('/admin/api/chat', { username: 'gail', text: 'Build a bench at -45,-14' });
  const chatBench = () => state.objects.find((o) => !o.fixed && /bench/i.test(o.blueprint.name) && o.destroyedAt === undefined);
  await wait(() => chatBench()?.uses?.includes('seat'), 'a chat bench with the seat use is built', 120000);
  const bench = chatBench();
  await wait(() => byId('wild-cat')?.creature?.goal?.targetId === bench.id, 'the stray cat heads for the new bench', 120000);

  // 6. Jake and his hoop: his fifth project in fixture pace, so it may not come round in time. If it
  //    does, the ball is in the air on the page.
  let hoops = 'not reached';
  try {
    await wait(() => state.neighbours?.some((n) => n.activity === 'playing' || n.job?.label?.match(/hoop/i)), 'Jake plays', 240000);
    await wait(() => state.neighbours?.some((n) => n.activity === 'playing' && n.job?.at), 'Jake is shooting', 90000);
    await page.waitForFunction(
      () => {
        let found = false;
        window.__safehouseScene?.traverse((o) => {
          if (o.userData?.ball && o.visible) found = true;
        });
        return found;
      },
      null,
      { timeout: 12000 },
    );
    await page.screenshot({ path: `${shots}/alive-hoops.png` });
    const jake = state.neighbours.find((n) => n.activity === 'playing');
    hoops = `${jake.name} shooting at ${JSON.stringify(jake.job.at)}; ball in the air`;
  } catch (error) {
    hoops = `not reached (${String(error.message).split(';')[0]})`;
  }

  // 6b. Chat verbs (verbs.ts): a piece that stands unlocks a command. Jake's hoop may not be up yet in
  //     fixture pace, so kim builds one. `!verbs` lists what is unlocked; `!shoot` sends kim's own figure
  //     off the pavement to the hoop for a shot — the ball flies, SWISH! or MISS pops over her head and
  //     the board shows her record; `!honk` sounds a horn on a car; `!dance` needs speakers and is
  //     refused until the tactics section puts some up.
  await wait(() => !busy(), 'Rook is free before the verbs', 120000);
  await post('/admin/api/chat', { username: 'kim', text: 'Build a basketball hoop at -4,6' });
  const chatHoop = () => state.objects.find((o) => !o.fixed && o.uses?.includes('hoop') && o.destroyedAt === undefined);
  await wait(() => chatHoop(), () => `a chat hoop is built; last job: ${JSON.stringify(state?.recent?.at(-1))}`, 120000);
  const hoopPiece = chatHoop();
  await wait(() => !busy(), 'Rook is free after the hoop', 60000);
  const noticeBeforeVerbs = state.notice;
  await post('/admin/api/chat', { username: 'kim', text: '!verbs' });
  await wait(() => state.notice !== noticeBeforeVerbs && /!shoot/.test(state.notice), () => `!verbs names !shoot; notice: ${state.notice}`, 15000);
  const verbsNotice = state.notice;
  assert.match(verbsNotice, /!honk/, "and !honk, since Rook's car stands");
  assert.ok(state.verbs?.some((v) => v.verb === '!shoot' && v.unlocked), `the scene carries the verbs: ${JSON.stringify(state.verbs)}`);
  const kim = () => state.crowd?.find((c) => c.name === 'kim');
  await post('/admin/api/chat', { username: 'kim', text: '!shoot' });
  await wait(() => kim()?.errand?.phase === 'going', () => `kim sets off for the hoop; kim: ${JSON.stringify(kim())}; notice: ${state.notice}`, 15000);
  await wait(() => kim()?.errand?.phase === 'doing', () => `kim reaches the hoop; kim: ${JSON.stringify(kim())}`, 90000);
  const shootingFrom = { ...kim().position };
  assert.ok(shootingFrom.z < 12, `kim left the pavement: ${JSON.stringify(shootingFrom)}`);
  await wait(() => kim()?.shot, () => `the server calls kim's shot; kim: ${JSON.stringify(kim())}`, 30000);
  const shot = { ...kim().shot };
  assert.equal(typeof shot.hit, 'boolean');
  // The page draws a snapshot and a half behind: the ball leaves the hand when the drawn clock reaches
  // the shot, is in the air for a second, then SWISH! or MISS pops over her head.
  await page.waitForFunction(
    () => {
      let found = false;
      window.__safehouseScene?.traverse((o) => {
        if (o.userData?.crowdBall && o.visible) found = true;
      });
      return found;
    },
    null,
    { timeout: 8000 },
  );
  await page.waitForFunction(
    () => [...document.querySelectorAll('#people .tag.pop')].some((t) => !t.hidden && /SWISH|MISS/.test(t.textContent)),
    null,
    { timeout: 8000 },
  );
  const popText = await page.evaluate(() => [...document.querySelectorAll('#people .tag.pop')].filter((t) => !t.hidden).map((t) => t.textContent));
  await page.screenshot({ path: `${shots}/alive-shoot.png` });
  assert.equal(popText.some((t) => t === (shot.hit ? 'SWISH!' : 'MISS')), true, `the pop matches the call: ${JSON.stringify(popText)} for ${JSON.stringify(shot)}`);
  await wait(() => state.hoops?.some((r) => r.user === 'kim' && r.shots === 1), () => `the board lists kim: ${JSON.stringify(state.hoops)}`, 10000);
  await page.waitForFunction(
    () => !document.getElementById('hoops').hidden && /kim [01]\/1/.test(document.getElementById('hoops-rows').textContent),
    null,
    { timeout: 8000 },
  );
  const board = await page.evaluate(() => document.getElementById('hoops-rows').textContent);
  await wait(() => !kim()?.errand, () => `kim is back on the pavement; kim: ${JSON.stringify(kim())}`, 90000);
  // A horn: a brief effect in the snapshot, a HONK pop over the car on the page.
  await post('/admin/api/chat', { username: 'kim', text: '!honk' });
  await wait(() => state.effects?.some((e) => e.kind === 'honk'), () => `a horn sounds; effects: ${JSON.stringify(state.effects)}; notice: ${state.notice}`, 15000);
  const honked = { ...state.effects.find((e) => e.kind === 'honk') };
  await page.waitForFunction(() => [...document.querySelectorAll('#people .tag.pop.honk')].some((t) => !t.hidden), null, { timeout: 8000 });
  // No speakers yet: `!dance` is refused, and the refusal says what it needs.
  const noticeBeforeDance = state.notice;
  await post('/admin/api/chat', { username: 'kim', text: '!dance' });
  await wait(() => state.notice !== noticeBeforeDance && /speaker|music/i.test(state.notice), () => `!dance is refused without speakers; notice: ${state.notice}`, 15000);
  const danceRefusal = state.notice;

  // 7. Tactics. A hole (`trap`) in front of the house, on the horde's way in. The first walkers sent
  //    spawn at (1,18) and (7,18) and go for the nearest front fence section — the one from (7,18)
  //    for the section just east of the gate at x 11.3, whose approach snaps to the x = 11.5 grid
  //    column; routes run east-first, then straight down that column. The fixture hole is 3.4 m
  //    across, so it sits on that column just north of the fence line, clear of the gate post and
  //    the pole: the walker walks in and is held, and the page draws it sunk with its arms up.
  await wait(() => !busy(), 'Rook is free before the tactics', 120000);
  await post('/admin/api/chat', { username: 'hal', text: 'Dig a hole at 11.5,7' });
  const hole = () => state.objects.find((o) => !o.fixed && o.uses?.includes('trap') && o.destroyedAt === undefined);
  await wait(() => hole(), () => `a hole with the trap use is dug; last job: ${JSON.stringify(state?.recent?.at(-1))}`, 120000);
  const dug = hole();
  assert.equal(dug.passable, true, 'a hole is ground: it never blocks and is never a target');
  assert.ok(Math.hypot(dug.position.x - 11.5, dug.position.z - 7) < 1.5, `dug where asked: ${JSON.stringify(dug.position)}`);
  await wait(() => !busy(), 'Rook is free after the hole', 60000);
  await post('/admin/api/action', { id: 'safehouse-zombies' });
  await post('/admin/api/action', { id: 'safehouse-combat-start' });
  const combatTime = () => state.combat?.time ?? 0;
  const heldZombie = () => state.combat?.zombies.find((z) => (z.heldUntil ?? 0) > combatTime() && z.heldIn === dug.id);
  await wait(
    () => heldZombie(),
    () => `a walker walks into the hole and is held; zombies: ${JSON.stringify((state?.combat?.zombies ?? []).map((z) => [z.id, z.position, z.targetId, z.heldIn]))}`,
    150000,
  );
  const held = heldZombie();
  // The actor standing where the held zombie is (it is not moving) has been sunk below the ground.
  const lowestGroupAt = ({ x, z }) => {
    let y;
    window.__safehouseScene?.traverse((o) => {
      if (o.isGroup && o.children.length >= 6 && Math.hypot(o.position.x - x, o.position.z - z) < 0.6 && (y === undefined || o.position.y < y)) y = o.position.y;
    });
    return y;
  };
  await page.waitForFunction((at) => {
    let y;
    window.__safehouseScene?.traverse((o) => {
      if (o.isGroup && o.children.length >= 6 && Math.hypot(o.position.x - at.x, o.position.z - at.z) < 0.6 && (y === undefined || o.position.y < y)) y = o.position.y;
    });
    return y !== undefined && y < -0.3;
  }, held.position, { timeout: 15000 });
  const sunkY = await page.evaluate(lowestGroupAt, held.position);
  await page.screenshot({ path: `${shots}/alive-hole.png` });

  // A speaker stack (`music`): the horde within earshot comes for the sound and dances before it
  // chews; the page bounces a dancing zombie.
  await post('/admin/api/chat', { username: 'ivy', text: 'Build a speaker stack at 0,7' });
  const speakers = () => state.objects.find((o) => !o.fixed && o.uses?.includes('music') && o.destroyedAt === undefined);
  await wait(() => speakers(), 'a speaker stack with the music use is built', 120000);
  const stack = speakers();
  assert.ok(stack.blueprint.animations?.length, 'the speakers move (animations in the view)');
  // With speakers standing, `!dance` is unlocked: ivy's figure bounces on the pavement.
  await post('/admin/api/chat', { username: 'ivy', text: '!dance' });
  const ivy = () => state.crowd?.find((c) => c.name === 'ivy');
  await wait(() => (ivy()?.dancingUntil ?? 0) > Date.now() - 5000, () => `ivy dances to the speakers; ivy: ${JSON.stringify(ivy())}; notice: ${state.notice}`, 15000);
  const ivyDance = ivy().dancingUntil;
  const dancingZombie = () => state.combat?.zombies.find((z) => (z.dancingUntil ?? 0) > combatTime());
  await wait(
    () => dancingZombie(),
    () => `a zombie dances at the speakers; zombies: ${JSON.stringify((state?.combat?.zombies ?? []).map((z) => [z.id, z.position, z.targetId, z.dancingUntil]))}`,
    150000,
  );
  // A dance lasts four seconds and the page draws about a snapshot and a half behind the server,
  // so poll: sample the height of the actor standing where each dancing zombie is (re-read from the
  // snapshot every time) until one of them has bounced — a dancing actor's height changes frame to frame.
  const heights = new Map();
  let dancer, samples = [], bouncing = false;
  const deadline = Date.now() + 90000;
  while (!bouncing && Date.now() < deadline) {
    for (const z of (state.combat?.zombies ?? []).filter((z) => (z.dancingUntil ?? 0) > combatTime())) {
      const y = await page.evaluate(lowestGroupAt, z.position);
      if (y === undefined) continue;
      const list = heights.get(z.id) ?? [];
      list.push(Math.round(y * 1000) / 1000);
      heights.set(z.id, list.slice(-6));
      if (list.length >= 2 && Math.max(...list) - Math.min(...list) > 0.005) {
        dancer = z;
        samples = heights.get(z.id);
        bouncing = true;
        break;
      }
    }
    if (!bouncing) await delay(120);
  }
  assert.ok(bouncing, `a dancing zombie bounces on the page: ${JSON.stringify([...heights])}`);
  await page.screenshot({ path: `${shots}/alive-dance.png` });

  // Soft: somebody on the block dances along, and Marge fills the hole in (her counter). Neither
  // is guaranteed inside the window; log what was reached.
  let dancingWho = 'not reached';
  try {
    await wait(() => state.survivor.activity === 'dancing' || state.neighbours?.some((n) => n.activity === 'dancing'), 'somebody dances', 120000);
    dancingWho = state.survivor.activity === 'dancing' ? 'Rook' : state.neighbours.find((n) => n.activity === 'dancing').name;
  } catch (error) {
    dancingWho = `not reached (${String(error.message).split(';')[0]})`;
  }
  let fill = 'not reached';
  try {
    await wait(() => {
      const h = byId(dug.id);
      return h && /filled/i.test(h.blueprint.name) && !h.uses?.includes('trap');
    }, 'Marge fills the hole in', 240000);
    const filled = byId(dug.id);
    fill = `${filled.blueprint.name} by ${filled.editedBy} (rev ${filled.revision}, uses ${JSON.stringify(filled.uses ?? [])})`;
  } catch (error) {
    fill = `not reached (${String(error.message).split(';')[0]})`;
  }
  await post('/admin/api/action', { id: 'safehouse-combat-pause' });

  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      ok: true,
      rookSeatedY: rookY,
      animatedTrees: animated.length,
      wild: wild().map((o) => `${o.blueprint.name}${o.creature?.goal?.perched ? ' (perched)' : ''}`),
      perched: perched && `${perched.blueprint.name} on ${perched.creature.goal.targetId} at ${perched.creature.goal.altitude}`,
      crowd: state.crowd.map((c) => `${c.name} @ ${c.position.x.toFixed(1)},${c.position.z.toFixed(1)}`),
      tags,
      instanced,
      footer,
      chatBird: `${bird.blueprint.name} rules=${JSON.stringify(bird.rules)} perched on ${perchId}${/^fence-/.test(perchId) ? ' (a fence section)' : ''}`,
      chatBench: `${bench.blueprint.name} uses=${JSON.stringify(bench.uses)} → cat goal ${byId('wild-cat')?.creature?.goal?.targetId}`,
      hoops,
      swim: `${swimNotice} → dave swam at ${swimming.position.x.toFixed(1)},${swimming.position.z.toFixed(1)} (pose ${swimming.errand.pose}, y ${swimming.errand.y}); torso up ${torsoUp.toFixed(2)}`,
      bounce: `${mat.blueprint.name} verb=${JSON.stringify(mat.verb)}; erin bounced at y ${hopping.errand.y}`,
      drive: `dave drove ${driving.blueprint.name} to ${driving.driven.at.x.toFixed(1)},${driving.driven.at.z.toFixed(1)} (parked ${carHome.x},${carHome.z}); drawn at ${drawn.car.x.toFixed(1)},${drawn.car.z.toFixed(1)} under dave at ${drawn.dave.x.toFixed(1)},${drawn.dave.z.toFixed(1)}; seat y ${driver.errand.y}`,
      ride: `erin rode the horse on its back (pose ${riding.errand?.pose}, y ${riding.errand?.y}, ${ridden} snapshots)`,
      fight: `finn fought the robot: ${fightResult}`,
      verbs: verbsNotice,
      shoot: `${hoopPiece.blueprint.name} at ${hoopPiece.position.x},${hoopPiece.position.z}; kim shot from ${shootingFrom.x.toFixed(1)},${shootingFrom.z.toFixed(1)}: ${shot.hit ? 'hit' : 'miss'}; pop ${JSON.stringify(popText)}; board "${board}"`,
      honk: `${honked.objectId} by ${honked.user}`,
      danceRefusal,
      ivyDance: `dancingUntil ${ivyDance}`,
      hole: `${dug.blueprint.name} uses=${JSON.stringify(dug.uses)} passable=${dug.passable} at ${dug.position.x},${dug.position.z}; ${held.id} held until ${held.heldUntil} (combat time ${combatTime()}), drawn at y ${sunkY}`,
      speakers: `${stack.blueprint.name} uses=${JSON.stringify(stack.uses)} animations=${stack.blueprint.animations?.length}; ${dancer.id} dancing, heights ${JSON.stringify(samples)}`,
      dancing: dancingWho,
      fill,
      errors,
    }),
  );
} finally {
  ws.close();
  await browser?.close();
}
