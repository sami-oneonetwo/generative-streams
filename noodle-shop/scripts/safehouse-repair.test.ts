import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSafehouseWorld } from '../src/worlds/safehouse';
import { fixtureGenerator } from '../src/llm/blueprint';
import { pickRepairTarget, repairMs, needsRepair, MAX_REBUILD_OBJECTS } from '../src/worlds/safehouse/repair';
import { damageObject, initializeObject } from '../src/worlds/safehouse/combat';
import { sceneryObjects } from '../src/worlds/safehouse/scenery';
import { active, type SafehouseState } from '../src/worlds/safehouse/state';
import { SURVIVOR_START, HOUSE_ID } from '../src/shared/safehouseLayout';
import type { WorldCtx } from '../src/engine/world';
import type { SafehouseObject } from '../src/shared/safehouseTypes';

const byId = (objects: SafehouseObject[], id: string) => objects.find((o) => o.id === id)!;
const creation = (id: string, role: SafehouseObject['role'], position: { x: number; z: number }) =>
  initializeObject({
    id,
    role,
    position,
    revision: 1,
    createdAt: 0,
    createdBy: 'viewer',
    editedBy: 'viewer',
    footprint: { width: 1, depth: 1 },
    blueprint: {
      name: id,
      description: '',
      parts: [{ shape: 'box', position: [0, 0.5, 0], size: [1, 1, 1], rotation: [0, 0, 0], color: '#888888' }],
    },
  });

test('repair picking: his house first, then defenses, fence, creations, scenery; scratches ignored', () => {
  const objects = sceneryObjects();
  const house = byId(objects, HOUSE_ID),
    fence = creation('fence-3', 'barrier', { x: -11, z: -9 }),
    turret = creation('turret', 'turret', { x: 2, z: -13 }),
    duck = creation('duck', 'decoration', { x: -2, z: -13 });
  objects.push(fence, turret, duck);
  assert.equal(pickRepairTarget(objects, [], SURVIVOR_START), undefined, 'nothing to do on a fresh world');
  house.health = 3700; // 92%: a scratch on the house
  assert.equal(needsRepair(house), false);
  house.health = 3500; // 87%: below the house's 90% line
  fence.health = 100;
  turret.health = 50;
  duck.health = 40;
  byId(objects, 'scenery-garage').health = 200;
  const order: string[] = [];
  const archive: SafehouseObject[] = [];
  for (let i = 0; i < 6; i++) {
    const pick = pickRepairTarget(objects, archive, SURVIVOR_START);
    if (!pick) break;
    order.push(pick.object.id);
    pick.object.health = pick.object.maxHealth;
  }
  assert.deepEqual(order, [HOUSE_ID, 'turret', 'fence-3', 'duck', 'scenery-garage']);
  // Rubble and archived designs are rebuilds; a rebuild from the archive respects the object cap.
  damageObject(duck, 1000, 5);
  assert.equal(pickRepairTarget(objects, [], SURVIVOR_START)?.operation, 'rebuild');
  const archived = creation('gone', 'barrier', { x: 4, z: -13 });
  archived.destroyedAt = 1;
  duck.health = duck.maxHealth;
  duck.destroyedAt = undefined;
  assert.equal(pickRepairTarget(objects, [archived], SURVIVOR_START)?.object.id, 'gone');
  const crowded = [...objects, ...Array.from({ length: MAX_REBUILD_OBJECTS }, (_, i) => creation(`c${i}`, 'decoration', { x: 20, z: 15 }))];
  assert.equal(pickRepairTarget(crowded, [archived], SURVIVOR_START), undefined, 'no rebuilds at the cap');
  assert.equal(repairMs(100), 4000);
  assert.equal(repairMs(600), 24000);
  assert.equal(repairMs(4000), 90000);
});

function harness() {
  let now = 10000,
    calls = 0;
  const world = createSafehouseWorld({
    generator: async (input, signal) => {
      calls++;
      return fixtureGenerator(input, signal);
    },
    workMs: 500,
  });
  const state = world.createInitialState(now);
  const ctx: WorldCtx<SafehouseState> = {
    state,
    get now() {
      return now;
    },
    checkpoint() {
      world.stateSchema.parse(state);
    },
    log() {},
    say() {},
    enqueueTask: () => ({ id: 'unused' }),
    queue: [],
    llm: { dialogue: async () => null, moderate: async () => ({ ok: false }) },
    tuning: {},
    chatRatePerMin: 0,
    rng: () => 0.5,
  };
  world.start?.(ctx);
  const activities = new Set<string>();
  async function step(ms = 500) {
    now += ms;
    world.tick(ctx, ms);
    activities.add(state.survivor.activity);
    await new Promise((r) => setImmediate(r));
  }
  async function until(done: () => boolean, steps = 400) {
    for (let i = 0; i < steps && !done(); i++) await step();
    assert.ok(done(), 'condition reached in time');
  }
  async function chat(text: string, userId = 'viewer') {
    await world.intents[0].handle(ctx, { id: crypto.randomUUID(), userId, username: userId, text, ts: now, source: 'dev' }, undefined);
  }
  return {
    world,
    state,
    ctx,
    step,
    until,
    chat,
    activities,
    calls: () => calls,
    rookJobs: () => state.jobs.filter((j) => j.userId === 'rook'),
  };
}

test('idle Rook repairs the house before the fence, on his own, with no AI calls', async () => {
  const h = harness();
  const house = byId(h.state.objects, HOUSE_ID),
    fence = byId(h.state.objects, 'fence-3');
  fence.health = 100;
  house.health = 2000;
  await h.until(() => byId(h.state.objects, HOUSE_ID).health === 4000);
  const first = h.rookJobs()[0];
  assert.equal(first.username, 'Rook');
  assert.equal(first.operation, 'repair');
  assert.equal(first.resolvedTarget, HOUSE_ID, 'his house comes first');
  assert.ok(h.activities.has('repairing'), 'the client saw the hammer pose');
  await h.until(() => byId(h.state.objects, 'fence-3').health === 240);
  assert.equal(h.calls(), 0, 'repairs never cost a model call');
  assert.equal(h.state.callsRemaining, 20);
  // Nothing left to fix: he goes home and stays idle instead of fidgeting.
  await h.until(() => !h.state.jobs.some(active) && h.state.survivor.activity === 'idle', 200);
  const before = h.rookJobs().length;
  for (let i = 0; i < 30; i++) await h.step();
  assert.equal(h.rookJobs().length, before);
});

test('a viewer request pre-empts a repair; Rook comes back to it afterwards; the operator can pause him', async () => {
  const h = harness();
  const fence = byId(h.state.objects, 'fence-20');
  fence.health = 40;
  await h.until(() => h.state.jobs.some((j) => j.userId === 'rook' && j.status === 'walking'));
  await h.chat('Build a barricade at 3,13');
  await h.until(() => h.state.jobs.some((j) => j.userId !== 'rook' && j.status === 'complete'));
  const setAside = h.rookJobs()[0];
  assert.equal(setAside.status, 'failed');
  assert.match(setAside.error!, /viewer request/);
  assert.equal(byId(h.state.objects, 'fence-20').health, 40, 'the fence waited');
  await h.until(() => byId(h.state.objects, 'fence-20').health === 240);
  assert.ok(h.rookJobs().some((j) => j.status === 'complete'));
  // Pause switch.
  h.world.adminActions!.find((a) => a.id === 'safehouse-repairs-pause')!.run(h.ctx);
  byId(h.state.objects, 'fence-21').health = 10;
  const before = h.rookJobs().length;
  for (let i = 0; i < 40; i++) await h.step();
  assert.equal(h.rookJobs().length, before, 'no rounds while paused');
  assert.equal(h.state.repairsPaused, true);
  h.world.adminActions!.find((a) => a.id === 'safehouse-repairs-resume')!.run(h.ctx);
  await h.until(() => byId(h.state.objects, 'fence-21').health === 240);
});

test('destroyed and archived pieces are rebuilt; a restart mid-repair resumes hammering', async () => {
  const h = harness();
  const fence = byId(h.state.objects, 'fence-5');
  damageObject(fence, 1000, 0);
  const gone = byId(h.state.objects, 'fence-6');
  h.state.objects = h.state.objects.filter((o) => o.id !== gone.id);
  h.state.combat.archive.push({ ...gone, destroyedAt: 0, lifecycle: 2 });
  await h.until(() => byId(h.state.objects, 'fence-5').destroyedAt === undefined && !!h.state.objects.find((o) => o.id === 'fence-6'));
  assert.ok(h.rookJobs().every((j) => j.operation === 'rebuild'));
  assert.equal(h.state.combat.archive.length, 0);
  assert.equal(byId(h.state.objects, 'fence-6').health, 240);
  // Restart while a repair is in progress: the resumed job keeps the repairing pose.
  byId(h.state.objects, 'fence-7').health = 20;
  await h.until(() => h.state.jobs.some((j) => j.userId === 'rook' && j.status === 'building'));
  const again = createSafehouseWorld({ fixture: true, workMs: 500 });
  const stop = again.start?.(h.ctx);
  assert.equal(h.state.survivor.activity, 'repairing');
  stop?.();
});
