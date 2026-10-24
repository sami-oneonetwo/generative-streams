// Layout A+: the River Bank (FK-078). The river moved east from x = 86.5 to 116, so a 36 m bank of
// walkable ground lies between the ring road and the water; the far bank has a landing strip at the
// bridge's far end; the river is walked over only on the bridge's deck, and only while the bridge
// stands; and a band saved waiting where the river used to run boots on the new far bank.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { harness } from './harness';
import { loadState, statePath } from '../src/engine/persistence';
import { cityOf } from '../src/worlds/ai-dudes/city';
import { BRIDGE_ROAD, bridgeSpot } from '../src/worlds/ai-dudes/caravan';
import { GROUND, bridgeStands, clampToGround, onGround, route, walkableSegment } from '../src/worlds/ai-dudes/placement';
import { sendDude } from '../src/worlds/ai-dudes/sim';
import { stateSchema, type Dude } from '../src/worlds/ai-dudes/state';
import { CITY_BOUNDS, LANDING, RIVER, TOWN_GROUND, allPlots } from '../src/shared/city';
import { contains } from '../src/shared/layout';
import { BRIDGE, FACING_TOWN, SCENES, STEP_FORWARD, STRANDED } from '../src/shared/scenes';
import type { GroundPoint } from '../src/shared/objectTypes';

const LIVE = path.join(import.meta.dirname, 'fixtures', 'world-ai-dudes.live-2026-10-24-stranded.json');
/** Where the far bank was before the move: today's live band stands on these marks. */
const OLD_FAR = 86.5 + RIVER.width / 2;
const inWater = (p: GroundPoint) => GROUND.water.some((r) => contains(r, p));
/** Every 0.2 m along a path: [x, z] samples. */
function samples(p: GroundPoint[]): GroundPoint[] {
  const out: GroundPoint[] = [];
  for (let i = 1; i < p.length; i++) {
    const n = Math.max(1, Math.ceil(Math.hypot(p[i].x - p[i - 1].x, p[i].z - p[i - 1].z) / 0.2));
    for (let k = 0; k <= n; k++) out.push({ x: p[i - 1].x + ((p[i].x - p[i - 1].x) * k) / n, z: p[i - 1].z + ((p[i].z - p[i - 1].z) * k) / n });
  }
  return out;
}

test('the river runs at x = 116; the town walks from the ring road down to the water, the far bank only on its landing', () => {
  assert.equal(RIVER.x, 116);
  assert.deepEqual([BRIDGE.near, BRIDGE.far], [109, 123], 'the water from 109 to 123');
  assert.equal(Math.round(BRIDGE.near - 2.4 - CITY_BOUNDS.maxX), 36, 'a 36 m River Bank from the ring road to the top of the bank');
  assert.equal(TOWN_GROUND.maxX, BRIDGE.near, "the town's ground runs to the water's edge");
  assert.deepEqual(GROUND.bounds, TOWN_GROUND);
  for (const l of allPlots()) assert.ok(contains(TOWN_GROUND, { x: l.rect.minX, z: l.rect.minZ }) && contains(TOWN_GROUND, { x: l.rect.maxX, z: l.rect.maxZ }), `${l.id} on the ground`);
  // The band's marks (and the leader's step forward to speak) are on the landing, across the water.
  for (const p of [...STRANDED, { x: STRANDED[0].x - STEP_FORWARD, z: STRANDED[0].z }]) assert.ok(contains(LANDING, p) && onGround(p, 1) && p.x > BRIDGE.far, JSON.stringify(p));
  for (const p of [{ x: 90, z: 60 }, { x: 100, z: -65 }, { x: 108.5, z: 0 }, { x: 128, z: 10 }]) assert.ok(onGround(p), `${JSON.stringify(p)} is ground`);
  for (const p of [{ x: 116, z: 30 }, { x: 130, z: 40 }, { x: 140, z: 0 }, { x: 110, z: -70 }]) assert.ok(!onGround(p), `${JSON.stringify(p)} is not (the river past the crossing, the far bank past the landing)`);
  // Out of the square and down to the water, round nothing at all.
  const way = route({ x: 0, z: 10 }, { x: 104, z: 40 }, []);
  assert.ok(way && samples(way).every((p) => onGround(p) && !inWater(p)), 'the square to the bank');
});

test('the river is walked over only on the deck, and only while the bridge stands', () => {
  try {
    bridgeStands(false);
    assert.equal(GROUND.water.length, 1, 'the whole crossing is water');
    // Someone on the deck as it goes can still wade ashore, round whatever stands in the way.
    GROUND.blocks.push({ minX: 78, maxX: 82, minZ: -5, maxZ: 5 });
    const ashore = route({ x: 116, z: 0 }, { x: 60, z: 0 }, []);
    GROUND.blocks.pop();
    assert.ok(ashore && ashore.length > 2 && ashore.at(-1)!.x === 60, 'wades out of the river');
    assert.equal(route({ x: 105, z: 0 }, { x: 128, z: 0 }, []), null, 'no way over to the landing');
    assert.equal(route({ x: 128, z: 0 }, { x: 40, z: 30 }, []), null, 'nor back');
    assert.ok(!walkableSegment({ x: 105, z: 0 }, { x: 128, z: 0 }, []), 'not even in a straight line');
    assert.ok(route({ x: 30, z: 20 }, { ...bridgeSpot(3) }, []), "the helpers' spot on the bank is reached");
    assert.deepEqual(clampToGround({ x: 116, z: 0 }, 1), { x: 108, z: 0 }, 'a point in the river comes ashore on the town side');
    assert.deepEqual(clampToGround({ x: 128, z: 3 }, 1), { x: 128, z: 3 }, 'the landing stays the landing');

    bridgeStands(true);
    assert.equal(GROUND.water.length, 2, 'the deck is open');
    const over = route({ x: 104, z: 8 }, { x: 129, z: 8 }, []);
    assert.ok(over, 'over the bridge');
    const wet = samples(over).filter((p) => p.x > BRIDGE.near && p.x < BRIDGE.far);
    assert.ok(wet.length && wet.every((p) => Math.abs(p.z) < 1.7 && !inWater(p)), 'on the deck all the way across');
    assert.ok(!walkableSegment({ x: 105, z: 8 }, { x: 128, z: 8 }, []), 'never through the water beside it');
    assert.deepEqual(clampToGround({ x: 116, z: 0.5 }, 1), { x: 116, z: 0.5 }, 'on the deck');
    assert.deepEqual(clampToGround({ x: 116, z: 5 }, 1), { x: 108, z: 5 }, 'beside it, in the water: ashore');
    assert.deepEqual(clampToGround({ x: 130, z: 40 }, 2), { x: 107, z: 40 }, 'the far bank past the landing: back on the town side');
    assert.deepEqual(clampToGround({ x: 200, z: -200 }, 1), { x: 108, z: CITY_BOUNDS.minZ + 1 });
  } finally {
    bridgeStands(true);
  }
});

test('dudes walk the new bank; the helpers mend the bridge from the water’s edge, and the band crosses into town', async () => {
  const { h, say, tick, world } = harness({ town: true });
  for (const n of ['kim', 'ash', 'lee']) await say(n, 'hi');
  await tick(2000);
  const cv = cityOf(h.state).caravan!;
  assert.ok(cv.stranded && GROUND.water.length === 1, 'the bridge is down: the crossing is water');
  const kim = h.state.dudes.find((d) => d.name === 'kim')!;
  assert.ok(sendDude(h.state, kim, { x: 100, z: 40 }), 'kim heads for the bank');
  for (let i = 0; i < 60 && kim.path.length; i++) await tick(1000); // 100 m at a walk
  assert.ok(kim.position.x > 99 && onGround(kim.position), `kim walked out on the River Bank: ${JSON.stringify(kim.position)}`);

  const run = (id: string) => world.adminActions!.find((a) => a.id === id)!.run({ state: h.state, now: h.now, log: () => {} } as never, undefined as never);
  run('scene-opening');
  await tick(SCENES.opening.ms + 1000);
  const helpers = h.state.dudes.filter((d) => d.name === 'ash' || d.name === 'lee');
  for (const d of helpers) {
    await say(d.name, 'I will help with the bridge');
    assert.equal(d.labour?.site, 'bridge', `${d.name} set off for the bridge`);
    assert.equal(d.labour!.at.x, BRIDGE.near - 1.4, 'to a spot at the water’s edge');
    assert.ok(samples([d.position, ...d.path]).every((p) => onGround(p) && !inWater(p)), 'all the way on the ground: no path laid by hand off it');
  }
  for (let i = 0; i < 40 && cv.stranded; i++) await tick(5000, 730);
  assert.ok(!cv.stranded, 'mended');
  await tick(4000);
  assert.equal(GROUND.water.length, 2, 'the deck is walkable now');
  for (const d of helpers) assert.ok(!d.labour && Math.abs(d.position.x - BRIDGE_ROAD.x) < 0.6, `${d.name} stepped back up the bank, clear of the deck: ${JSON.stringify(d.position)}`);
  const band = cityOf(h.state).townies.filter((t) => t.traveller);
  await tick(SCENES.crossing.ms + 6000);
  assert.ok(band.every((t) => t.position.x < BRIDGE.near), 'the band crossed into town');
  assert.ok(h.state.dudes.every((d) => onGround(d.position) && !inWater(d.position)), 'everyone on the ground');
});

test('a band saved waiting where the river used to run boots across the new river; a helper bound for the old bridge goes to the new one', async () => {
  const a = harness({ town: true });
  for (const n of ['kim', 'ash']) await a.say(n, 'hi');
  await a.tick(2000);
  const run = (id: string) => a.world.adminActions!.find((x) => x.id === id)!.run({ state: a.h.state, now: a.h.now, log: () => {} } as never, undefined as never);
  run('scene-opening');
  await a.tick(SCENES.opening.ms + 1000);
  await a.say('kim', 'help at the bridge');
  // Before the move: the band on the old far bank, kim on her way to the old bridge's spot.
  const c = cityOf(a.h.state);
  c.caravan!.travellers.forEach((id, i) => {
    const t = c.townies.find((x) => x.id === id)!;
    t.position = { x: OLD_FAR + (STRANDED[i].x - BRIDGE.far), z: STRANDED[i].z };
  });
  const kim = a.h.state.dudes.find((d) => d.name === 'kim')!;
  kim.labour = { ...kim.labour!, at: { x: 86.5 - 7 - 1.4, z: -0.9 } };
  kim.path = [{ x: 60, z: -0.9 }, { ...kim.labour.at }];
  const b = harness({ town: true });
  b.h.now = a.h.now;
  b.h.state = stateSchema.parse(JSON.parse(JSON.stringify(a.h.state)));
  b.world.start!(b.ctx);
  const band = cityOf(b.h.state).caravan!.travellers.map((id) => cityOf(b.h.state).townies.find((t) => t.id === id)!);
  band.forEach((t, i) => {
    assert.deepEqual(t.position, STRANDED[i], `${t.name} on their mark across the new river`);
    assert.ok(t.facing === FACING_TOWN && !t.path.length, 'facing the town, standing');
  });
  assert.ok(b.h.logs.some((l) => /river bank: 5 of the band back on their marks across the river/.test(l)), b.h.logs.join('\n'));
  const kim2 = b.h.state.dudes.find((d) => d.name === 'kim')!;
  assert.ok(!kim2.labour && !kim2.path.length, 'let go of the old bridge');
  await b.tick(1000);
  const sent = kim2.labour as Dude['labour'];
  assert.ok(sent?.site === 'bridge' && sent.at.x === BRIDGE.near - 1.4, `and sent to the new one: ${JSON.stringify(sent)}`);
  // A second start changes nothing.
  b.world.start!(b.ctx);
  assert.equal(b.h.logs.filter((l) => /river bank:/.test(l)).length, 1, 'once');
  // A band in town is left where it is.
  const s = harness({ town: true });
  await s.say('kim', 'hi');
  await s.tick(2000);
  cityOf(s.h.state).caravan!.stranded = undefined;
  const t0 = cityOf(s.h.state).townies.find((t) => t.traveller)!;
  t0.position = { x: 95, z: 1 };
  s.world.start!(s.ctx);
  assert.deepEqual(t0.position, { x: 95, z: 1 }, 'not stranded: nobody moved');
});

test("the live save (Story on, the cast stuck at the old river) boots with the band on the new far bank", async () => {
  const hs = harness();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dudes-river-'));
  fs.copyFileSync(LIVE, statePath(dir, hs.world.meta.id));
  hs.h.state = loadState(hs.world, dir, () => {});
  const before = cityOf(hs.h.state).townies.filter((t) => t.role).map((t) => t.position.x);
  assert.ok(hs.h.state.ai.story && cityOf(hs.h.state).caravan!.stranded && before.every((x) => x > OLD_FAR && x < BRIDGE.near), 'saved on what is now the town bank');
  hs.world.start!(hs.ctx);
  hs.h.state.ai.townLife = true;
  await hs.tick(3000);
  const cv = cityOf(hs.h.state).caravan!;
  assert.deepEqual(cv.travellers, ['cast-ash', 'cast-wren', 'cast-moss', 'cast-oak', 'cast-kit']);
  cv.travellers.forEach((id, i) => {
    const t = cityOf(hs.h.state).townies.find((x) => x.id === id)!;
    assert.deepEqual(t.position, STRANDED[i], `${id} across the new river`);
    assert.ok(contains(LANDING, t.position) && t.position.x > BRIDGE.far);
  });
  assert.equal(GROUND.water.length, 1, 'the bridge is down: nobody walks over to them');
  assert.ok(hs.h.state.dudes.every((d) => onGround(d.position) && d.position.x < BRIDGE.near), 'the chatters stay on the town side');
  assert.ok(stateSchema.safeParse(JSON.parse(JSON.stringify(hs.h.state))).success, 'the save still loads');
  bridgeStands(true);
});
