import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  freshCombat,
  tickCombat,
  waveRoster,
  describeRoster,
  initializeObject,
  damageObject,
  spawnGroup,
  ZOMBIE_KINDS,
  MAX_ZOMBIES,
  PREP_MS,
  WAVE_CAP_MS,
  SPAWN_EVERY_MS,
} from '../src/worlds/safehouse/combat';
import { migrateState } from '../src/worlds/safehouse/state';
import { createSafehouseWorld } from '../src/worlds/safehouse';
import { HOUSE_ID } from '../src/shared/safehouseLayout';
import type { SafehouseObject } from '../src/shared/safehouseTypes';

const object = (id: string, role: SafehouseObject['role'], position: { x: number; z: number }, health?: number) =>
  initializeObject({
    id,
    role,
    position,
    revision: 1,
    createdAt: 0,
    createdBy: 'a',
    editedBy: 'a',
    footprint: { width: 2, depth: 1 },
    blueprint: {
      name: id,
      description: 'test',
      parts: [{ shape: 'box', position: [0, 0.5, 0], size: [2, 1, 1], rotation: [0, 0, 0], color: '#888888' }],
    },
    ...(health ? { health, maxHealth: health } : {}),
  });
/** Advance combat, collecting announcements; objects are far from spawn points so nothing gets hit. */
function run(c: ReturnType<typeof freshCombat>, objects: SafehouseObject[], ms: number) {
  const events: string[] = [];
  for (let t = 0; t < ms; t += 1000) {
    const r = tickCombat(c, objects, 1000);
    objects = r.objects;
    events.push(...r.events);
  }
  return { events, objects };
}

test('rosters grow by tier: walkers from 1, runners from 3, brutes from 5, capped at the zombie limit', () => {
  const count = (n: number) =>
    waveRoster(n).reduce((m, k) => ({ ...m, [k]: (m[k] ?? 0) + 1 }), {} as Record<string, number>);
  assert.deepEqual(count(1), { walker: 4 });
  assert.deepEqual(count(2), { walker: 5 });
  assert.deepEqual(count(3), { walker: 6, runner: 1 });
  assert.deepEqual(count(5), { walker: 8, runner: 2, brute: 1 });
  assert.deepEqual(count(10), { walker: 13, runner: 4, brute: 3 });
  assert.ok(waveRoster(40).length <= MAX_ZOMBIES, 'huge waves trim walkers, never exceed the cap');
  assert.equal(waveRoster(40).filter((k) => k === 'brute').length, 18);
  assert.equal(describeRoster(waveRoster(5)), '8 walkers, 2 runners, 1 brute');
  assert.equal(waveRoster(5).slice(0, 3).join(','), 'walker,runner,brute', 'the mix is interleaved');
  for (const kind of ['runner', 'brute'] as const)
    assert.ok(!waveRoster(ZOMBIE_KINDS[kind].from - 1).includes(kind) && waveRoster(ZOMBIE_KINDS[kind].from).includes(kind));
});

test('prep counts down with two warnings, then the wave spawns its roster in batches and clears', () => {
  const c = freshCombat(false);
  const wall = object('wall', 'barrier', { x: 0, z: -17 });
  let { events } = run(c, [wall], PREP_MS - 61000);
  assert.deepEqual(events, [], 'quiet until the last minute');
  ({ events } = run(c, [wall], 1000));
  assert.match(events.join('\n'), /One minute until wave 1/);
  ({ events } = run(c, [wall], 50000));
  assert.match(events.join('\n'), /ten seconds/);
  assert.equal(events.length, 1, 'each warning once');
  ({ events } = run(c, [wall], 10000));
  assert.match(events.at(-1)!, /Wave 1 incoming — 4 walkers/);
  assert.equal(c.wave.phase, 'wave');
  assert.equal(c.zombies.length, 2, 'first batch lands with the announcement');
  assert.ok(c.zombies.every((z) => z.kind === 'walker' && z.maxHealth === 60));
  run(c, [wall], SPAWN_EVERY_MS);
  assert.equal(c.zombies.length, 4);
  assert.deepEqual(c.wave.queue, []);
  // Kill everything: the wave clears, the record moves, the next prep starts.
  for (const z of c.zombies) z.health = 0;
  ({ events } = run(c, [wall], 1000));
  assert.match(events.at(-1)!, /Wave 1 cleared/);
  assert.equal(c.wave.number, 2);
  assert.equal(c.wave.best, 1);
  assert.equal(c.wave.phase, 'prep');
  assert.ok(c.wave.phaseEndsAt - c.time >= PREP_MS - 1000);
});

test('stragglers time out, pausing freezes the clock, and calling a wave early works', () => {
  const c = freshCombat(false);
  const wall = object('wall', 'barrier', { x: 0, z: -17 });
  c.wave.phaseEndsAt = c.time; // start the wave now
  run(c, [wall], 1000 + SPAWN_EVERY_MS * 2);
  assert.equal(c.wave.phase, 'wave');
  assert.equal(c.zombies.length, 4);
  const spawnTime = c.time;
  c.paused = true;
  run(c, [wall], 60000);
  assert.equal(c.time, spawnTime, 'paused combat does not age the wave');
  c.paused = false;
  const { events } = run(c, [wall], WAVE_CAP_MS + 2000);
  assert.match(events.join('\n'), /stragglers shambled off/);
  assert.equal(c.zombies.length, 0);
  assert.equal(c.wave.number, 2, 'a survived wave still counts');
});

test('kinds differ in speed and damage; the wave tally counts turret kills', () => {
  const c = freshCombat(false);
  c.wave.phase = 'wave';
  c.wave.queue = ['brute', 'runner'];
  c.wave.phaseEndsAt = c.time + WAVE_CAP_MS;
  const wall = object('wall', 'barrier', { x: 3, z: 16 }, 1000);
  tickCombat(c, [wall], 250);
  const brute = c.zombies.find((z) => z.kind === 'brute')!,
    runner = c.zombies.find((z) => z.kind === 'runner')!;
  brute.position = { x: 3, z: 16.9 };
  runner.position = { x: 3.4, z: 16.9 };
  brute.attackAt = runner.attackAt = c.time;
  tickCombat(c, [wall], 250);
  assert.equal(wall.health, 1000 - ZOMBIE_KINDS.brute.damage - ZOMBIE_KINDS.runner.damage);
  // Speed: a runner covers about twice the ground of a walker in the same time.
  const open = freshCombat(false);
  open.wave.phase = 'wave';
  open.wave.phaseEndsAt = open.time + WAVE_CAP_MS;
  open.wave.queue = ['runner', 'walker'];
  const far = object('far', 'barrier', { x: 4, z: -16 });
  tickCombat(open, [far], 250);
  const r = open.zombies.find((z) => z.kind === 'runner')!,
    w = open.zombies.find((z) => z.kind === 'walker')!;
  r.position = { x: 4, z: 12 };
  w.position = { x: 4.5, z: 12 };
  for (const z of [r, w]) {
    z.path = []; // forget the route planned from the spawn point
    z.replanAt = 0;
  }
  const start = { r: r.position.z, w: w.position.z };
  for (let i = 0; i < 8; i++) tickCombat(open, [far], 1000);
  assert.ok(start.r - r.position.z > (start.w - w.position.z) * 1.8, 'runner is faster');
  // Turret kills feed the per-wave tally.
  const gun = freshCombat(false);
  gun.wave.phase = 'wave';
  gun.wave.phaseEndsAt = gun.time + WAVE_CAP_MS;
  gun.wave.queue = ['runner'];
  const turret = object('gun', 'turret', { x: 3, z: 10 });
  tickCombat(gun, [turret], 250);
  gun.zombies[0].position = { x: 3, z: 13 };
  for (let i = 0; i < 12; i++) tickCombat(gun, [turret], 250);
  assert.equal(gun.kills, 1);
  assert.equal(gun.wave.killed, 1);
});

test('zombies ignore backdrop scenery outside the fence and head for the yard', () => {
  const c = freshCombat(false);
  c.wave.phase = 'wave';
  c.wave.phaseEndsAt = c.time + WAVE_CAP_MS;
  spawnGroup(c, 1);
  c.zombies[0].position = { x: -24, z: 5 };
  const tree = initializeObject({ ...object('tree', 'decoration', { x: -23, z: 7 }), fixed: true });
  const fence = initializeObject({ ...object('fence-9', 'barrier', { x: -11, z: 3 }), fixed: true });
  const bed = initializeObject({ ...object('scenery-garden-1', 'decoration', { x: -8.8, z: -6.5 }), fixed: true });
  tickCombat(c, [tree, fence, bed], 250);
  assert.notEqual(c.zombies[0].targetId, 'tree', 'the street tree is backdrop');
  assert.equal(c.zombies[0].targetId, 'fence-9', 'the fence is the way in');
  c.zombies[0].position = { x: -9.5, z: -4 };
  c.zombies[0].replanAt = 0;
  tickCombat(c, [tree, bed], 250);
  assert.equal(c.zombies[0].targetId, 'scenery-garden-1', 'yard scenery is fair game');
});

test('losing the house ends the run: the wave counter goes back to 1 after that wave', () => {
  const c = freshCombat(false);
  c.wave.number = 4;
  c.wave.best = 3;
  c.wave.phase = 'wave';
  c.wave.queue = [];
  c.wave.phaseEndsAt = c.time + WAVE_CAP_MS;
  spawnGroup(c, 1);
  const house = object(HOUSE_ID, 'barrier', { x: 0, z: -5.7 }, 4000);
  damageObject(house, 5000, c.time);
  let { events } = run(c, [house], 1000);
  assert.match(events.join('\n'), /house fell on wave 4/);
  assert.equal(c.wave.fell, 4);
  c.zombies[0].health = 0;
  ({ events } = run(c, [house], 1000));
  assert.match(events.join('\n'), /Starting over from wave 1/);
  assert.equal(c.wave.number, 1);
  assert.equal(c.wave.best, 3, 'the record survives the loss');
  assert.equal(c.wave.phase, 'prep');
});

test('v5 saves gain the wave clock and their zombies become walkers; the world speaks wave events', async () => {
  const world = createSafehouseWorld({ fixture: true, seedScenery: false, workMs: 500 });
  const fresh = world.createInitialState(0);
  const { wave: _w, ...legacyCombat } = fresh.combat;
  const v5 = {
    ...fresh,
    version: 5,
    combat: {
      ...legacyCombat,
      nextSpawn: 45000,
      time: 9000,
      zombies: [{ id: 'z1', position: { x: 1, z: 18 }, health: 60, facing: 0, attackAt: 0, path: [], replanAt: 0 }],
    },
  };
  const migrated = migrateState(v5, 5);
  assert.equal(migrated.version, 7);
  assert.equal(migrated.combat.wave.number, 1);
  assert.equal(migrated.combat.wave.phase, 'prep');
  assert.equal(migrated.combat.wave.phaseEndsAt, 9000 + PREP_MS);
  assert.equal(migrated.combat.zombies[0].kind, 'walker');
  assert.equal(migrated.combat.zombies[0].maxHealth, 60);
  assert.ok(!('nextSpawn' in migrated.combat));
  // Announcements reach the notice/speech path through the world tick.
  const spoken: string[] = [];
  let now = 10000;
  const state = world.createInitialState(now);
  state.combat.paused = false;
  state.combat.wave.phaseEndsAt = state.combat.time + 500;
  const ctx = {
    state,
    get now() {
      return now;
    },
    checkpoint() {
      world.stateSchema.parse(state);
    },
    log() {},
    say(text: string) {
      spoken.push(text);
    },
    enqueueTask: () => ({ id: 'unused' }),
    queue: [],
    llm: { dialogue: async () => null, moderate: async () => ({ ok: false }) },
    tuning: {},
    chatRatePerMin: 0,
    rng: () => 0.5,
  };
  world.start?.(ctx as never);
  now += 1000;
  world.tick(ctx as never, 1000);
  assert.match(spoken.join('\n'), /Wave 1 incoming/);
  assert.match(state.notice, /Wave 1 incoming/);
  const early = world.adminActions!.find((a) => a.id === 'safehouse-wave-next')!;
  early.run(ctx as never);
  assert.match(state.notice, /already on/);
});
