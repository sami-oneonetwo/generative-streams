import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sceneryObjects, RETIRED_SCENERY_IDS } from '../src/worlds/safehouse/scenery';
import { createSafehouseWorld } from '../src/worlds/safehouse';
import { migrateState, stateSchema, STATE_VERSION, type SafehouseState } from '../src/worlds/safehouse/state';
import { parseRequest, rotateBlueprint } from '../src/worlds/safehouse/edits';
import { measureBlueprint } from '../src/worlds/safehouse/blueprint';
import { route } from '../src/worlds/safehouse/placement';
import {
  freshCombat,
  spawnGroup,
  tickCombat,
  initializeObject,
  lineOfSight,
  fenceObjects,
} from '../src/worlds/safehouse/combat';
import { SURVIVOR_START, HOUSE_ID } from '../src/shared/safehouseLayout';
import type { WorldCtx } from '../src/engine/world';
import type { SafehouseObject } from '../src/shared/safehouseTypes';

const byName = (objects: SafehouseObject[], name: string) => objects.find((o) => o.blueprint.name === name)!;

function harness() {
  let now = 10000;
  const world = createSafehouseWorld({ fixture: true, workMs: 500 });
  const state = world.createInitialState(now);
  const ctx: WorldCtx<SafehouseState> = {
    state,
    get now() {
      return now;
    },
    checkpoint() {
      world.stateSchema.parse(state);
    },
    say() {},
    log() {},
    enqueueTask: () => ({ id: '' }),
    queue: [],
    llm: { dialogue: async () => null, moderate: async () => ({ ok: false }) },
    tuning: {},
    chatRatePerMin: 0,
    rng: () => 0.5,
  };
  world.start?.(ctx);
  async function request(text: string, user = 'a') {
    now += 4000;
    await world.intents[0].handle(
      ctx,
      { id: crypto.randomUUID(), userId: user, username: user, text, ts: now, source: 'dev' },
      undefined,
    );
    for (let i = 0; i < 400; i++) {
      now += 500;
      world.tick(ctx, 500);
      await new Promise((r) => setImmediate(r));
      if (!state.jobs.some((j) => !['complete', 'failed'].includes(j.status))) break;
    }
    return state.jobs.at(-1)!;
  }
  return { world, state, ctx, request };
}

test('the whole neighborhood is valid, uniquely named world objects', () => {
  const world = createSafehouseWorld({ fixture: true });
  const state = world.createInitialState(0);
  stateSchema.parse(state);
  const names = state.objects.map((o) => o.blueprint.name),
    ids = state.objects.map((o) => o.id);
  assert.equal(new Set(names).size, names.length);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(state.objects.filter((o) => o.fixed).length > 55);
  const house = byName(state.objects, "Rook's house");
  assert.equal(house.id, HOUSE_ID);
  assert.equal(house.role, 'barrier');
  assert.equal(house.health, 4000);
  assert.ok(house.footprint.width < 10 && house.footprint.depth < 10, 'one closed piece within scenery limits');
  assert.equal(byName(state.objects, 'Barricade').role, 'barrier');
  assert.ok(!state.objects.some((o) => RETIRED_SCENERY_IDS.includes(o.id)), 'no cutaway pieces left');
  assert.equal(state.combat.paused, true);
});

test('the yard around the house is reachable from the porch; the house itself is solid', () => {
  const scenery = sceneryObjects();
  const house = byName(scenery, "Rook's house");
  for (const spot of [
    { x: 0, z: -13 }, // behind
    { x: 5.5, z: -6 }, // between house and garage
    { x: -6, z: -6 }, // garden side
    { x: 7, z: 6 }, // out the gate
  ])
    assert.ok(route(SURVIVOR_START, spot, scenery), `reach ${spot.x},${spot.z}`);
  assert.equal(route(SURVIVOR_START, house.position, scenery), null, 'nobody walks through the house');
  assert.equal(lineOfSight({ x: 0, z: 2 }, { x: 0, z: -14 }, scenery), false, 'the house blocks shots');
  assert.equal(lineOfSight({ x: -6, z: -13 }, { x: 6, z: -13 }, scenery), true, 'open yard does not');
  assert.equal(Math.hypot(house.position.x - 1, house.position.z + 6.7) < 2.5, true, 'centred in the fenced yard');
});

test('request grammar: move, turn, relative builds, areas, the house by name, no false targets', () => {
  const scenery = sceneryObjects();
  const move = parseRequest('Move the barricade next to the house', scenery);
  assert.equal(move.operation, 'move');
  assert.equal(move.targetId, byName(scenery, 'Barricade').id);
  assert.deepEqual(move.relativeTo, { objectId: HOUSE_ID, side: 'next to' });
  assert.equal(parseRequest("Turn Rook's car around", scenery).angle, Math.PI);
  assert.ok(Math.abs(parseRequest('Rotate the barricade 90 degrees', scenery).angle! - Math.PI / 2) < 1e-9);
  const build = parseRequest('Build a lamp next to the house', scenery);
  assert.equal(build.operation, undefined);
  assert.equal(build.targetId, undefined);
  assert.equal(build.relativeTo?.objectId, HOUSE_ID);
  assert.equal(parseRequest('Build a shed behind the house', scenery).relativeTo?.side, 'behind');
  assert.equal(parseRequest('Build a flower bed', scenery).targetId, undefined);
  assert.equal(parseRequest('Build a bench in the front yard', scenery).requestedArea, 'front yard');
  assert.match(parseRequest('Build a bench in the kitchen', scenery).rejection!, /boarded up/);
  assert.match(parseRequest('Build a bed inside the house', scenery).rejection!, /boarded up/);
  assert.ok(parseRequest('Move the barricade to the moon', scenery).clarification);
  assert.equal(parseRequest("Paint Rook's house green", scenery).quick?.kind, 'recolor');
  assert.equal(parseRequest('Paint the house green', scenery).targetId, HOUSE_ID);
  assert.equal(parseRequest('Repair the house', scenery).operation, 'repair');
  assert.equal(parseRequest('Repair the house', scenery).targetId, HOUSE_ID);
  assert.ok(parseRequest('Build a turret on the roof', scenery).rejection);
  assert.deepEqual(parseRequest('Move the barricade to 3,12', scenery).requestedPosition, { x: 3, z: 12 });
});

test('rotation is exact for tilted parts and swaps the footprint', () => {
  const plank = {
    name: 'p',
    description: '',
    parts: [
      {
        shape: 'box' as const,
        position: [0, 0.5, 0] as [number, number, number],
        size: [4, 1, 1] as [number, number, number],
        rotation: [0.3, 0, 0] as [number, number, number],
        color: '#888888',
      },
    ],
  };
  const before = measureBlueprint(plank),
    after = measureBlueprint(rotateBlueprint(plank, Math.PI / 2));
  assert.ok(Math.abs(before.width - after.depth) < 1e-6 && Math.abs(before.depth - after.width) < 1e-6);
  const twice = rotateBlueprint(rotateBlueprint(plank, Math.PI / 2), Math.PI / 2),
    once = rotateBlueprint(plank, Math.PI);
  for (let i = 0; i < 3; i++) {
    assert.ok(Math.abs(twice.parts[0].position[i] - once.parts[0].position[i]) < 1e-9);
    assert.ok(Math.abs(twice.parts[0].rotation[i] - once.parts[0].rotation[i]) < 1e-9);
  }
});

test('moving the barricade, turning the car and painting the house are zero-call jobs that keep damage', async () => {
  const h = harness();
  const barricade = byName(h.state.objects, 'Barricade');
  barricade.health = 110;
  const moved = await h.request('Move the barricade to -6,-13');
  assert.equal(moved.status, 'complete', moved.error);
  const after = h.state.objects.find((o) => o.id === barricade.id)!;
  assert.deepEqual(after.position, { x: -6, z: -13 });
  assert.equal(after.health, 110);
  assert.equal(after.maxHealth, 300);
  assert.equal(after.fixed, true);
  const car = byName(h.state.objects, "Rook's car");
  const bumper = car.blueprint.parts.find((p) => p.color === '#8a9086')!.position[2];
  const turned = await h.request("Turn Rook's car around", 'b');
  assert.equal(turned.status, 'complete', turned.error);
  const carAfter = h.state.objects.find((o) => o.id === car.id)!;
  assert.ok(
    Math.abs(carAfter.blueprint.parts.find((p) => p.color === '#8a9086')!.position[2] + bumper) < 1e-9,
  );
  assert.equal(carAfter.blueprint.parts.filter((p) => p.shape === 'cylinder').length, 4);
  const painted = await h.request('Paint the house red', 'c');
  assert.equal(painted.status, 'complete', painted.error);
  assert.ok(h.state.objects.find((o) => o.id === HOUSE_ID)!.blueprint.parts.every((p) => p.color === '#b65b50'));
  const anchored = await h.request('Move the house to 3,12', 'd');
  assert.equal(anchored.status, 'failed');
  assert.match(anchored.error!, /stays where it is/);
  const undoAction = h.world.adminActions!.find((a) => a.id === 'safehouse-undo')!;
  undoAction.run(h.ctx);
  assert.ok(h.state.objects.find((o) => o.id === HOUSE_ID)!.blueprint.parts.some((p) => p.color === '#9c9682'));
});

test('relative placement lands beside the anchor and refuses impossible spots', async () => {
  const h = harness();
  const crate = byName(h.state.objects, 'Supply crate');
  const job = await h.request('Move the barricade next to the supply crate');
  assert.equal(job.status, 'complete', job.error);
  const barricade = byName(h.state.objects, 'Barricade');
  assert.ok(Math.hypot(barricade.position.x - crate.position.x, barricade.position.z - crate.position.z) < 5);
  const blocked = await h.request('Move the garage to -9,-8.7', 'b');
  assert.equal(blocked.status, 'failed');
  const beside = await h.request('Build a lamp next to the house', 'c');
  assert.equal(beside.status, 'complete', beside.error);
  const lamp = h.state.objects.find((o) => !o.fixed)!;
  const house = byName(h.state.objects, "Rook's house");
  assert.ok(
    Math.abs(lamp.position.x - house.position.x) < 8 && Math.abs(lamp.position.z - house.position.z) < 8,
    `lamp at ${lamp.position.x},${lamp.position.z} hugs the house`,
  );
});

test('Rook steps off a spot he is standing on instead of blocking the next build', async () => {
  const h = harness();
  const house = byName(h.state.objects, "Rook's house");
  // Painting the house leaves him at its front work spot, exactly where "in front of the house" lands.
  const painted = await h.request('Paint the house red', 'd');
  assert.equal(painted.status, 'complete', painted.error);
  assert.ok(Math.abs(h.state.survivor.position.x) < 0.6 && h.state.survivor.position.z > house.position.z);
  const inFront = await h.request('Build a barricade in front of the house', 'e');
  assert.equal(inFront.status, 'complete', inFront.error);
  const street = byName(h.state.objects, 'Street barricade');
  assert.ok(street.position.z > house.position.z + house.footprint.depth / 2, 'in front means street side');
  assert.ok(Math.abs(street.position.x - house.position.x) <= 1.5);
});

test('a v1 world gains fences and the neighborhood without touching creations, combat paused', () => {
  const world = createSafehouseWorld({ fixture: true, seedScenery: false });
  const fresh = world.createInitialState(0);
  const creation: SafehouseObject = {
    id: 'mine',
    revision: 2,
    blueprint: {
      name: 'Duck tower',
      description: '',
      parts: [{ shape: 'box', position: [0, 1, 0], size: [1, 2, 1], rotation: [0, 0, 0], color: '#cb8b91' }],
    },
    position: { x: 0, z: -13 },
    footprint: { width: 1, depth: 1 },
    createdBy: 'a',
    editedBy: 'b',
    createdAt: 5,
  };
  const v1 = {
    version: 1,
    objects: [creation],
    jobs: [],
    survivor: fresh.survivor,
    lighting: 'day',
    worldRevision: 3,
    notice: 'hi',
    seen: ['m1'],
    edits: [],
  };
  const migrated = migrateState(v1, 1);
  assert.equal(migrated.version, STATE_VERSION);
  const mine = migrated.objects.find((o) => o.id === 'mine')!;
  assert.deepEqual(mine.blueprint, creation.blueprint);
  assert.equal(mine.editedBy, 'b');
  assert.equal(mine.role, 'decoration');
  assert.equal(migrated.objects.filter((o) => o.id.startsWith('fence-')).length, 31);
  assert.ok(migrated.objects.some((o) => o.id === HOUSE_ID));
  assert.ok(!migrated.objects.some((o) => o.blueprint.name === 'Couch'));
  assert.equal(migrated.combat.paused, true);
  assert.deepEqual(migrated.seen, ['m1']);
});

test('v4 → v5 swaps the cutaway house for Rook\'s house and keeps every creation', () => {
  const world = createSafehouseWorld({ fixture: true, seedScenery: false });
  const fresh = world.createInitialState(0);
  const box = (id: string, name: string, position: { x: number; z: number }, extra: Partial<SafehouseObject> = {}) =>
    initializeObject({
      id,
      revision: 1,
      blueprint: {
        name,
        description: '',
        parts: [{ shape: 'box', position: [0, 0.5, 0], size: [1, 1, 1], rotation: [0, 0, 0], color: '#cb8b91' }],
      },
      position,
      footprint: { width: 1, depth: 1 },
      createdBy: 'a',
      editedBy: 'a',
      createdAt: 5,
      ...extra,
    });
  const couch = box('scenery-couch', 'Couch', { x: -4.55, z: -1.62 }, { fixed: true });
  const wall = box('scenery-back-2', 'Back wall (middle)', { x: -2, z: -7.15 }, { fixed: true, role: 'barrier' });
  const underHouse = box('under', 'Lamp', { x: 0, z: -6 });
  const clear = box('clear', 'Duck', { x: 0, z: -13 });
  const v4 = {
    ...fresh,
    version: 4,
    objects: [couch, underHouse, clear, ...fenceObjects()],
    combat: { ...freshCombat(false), archive: [wall], zombies: [] },
    jobs: [
      {
        id: 'j1',
        text: 'Paint the couch red',
        username: 'a',
        userId: 'a',
        status: 'walking',
        createdAt: 1,
        attempts: 0,
        label: 'Couch',
        path: [],
        workedMs: 0,
        workMs: 1000,
        resolvedTarget: 'scenery-couch',
      },
    ],
    edits: [{ objectId: 'scenery-couch', revision: 1 }],
    targets: [{ userId: 'a', objectId: 'scenery-couch' }],
  };
  const migrated = migrateState(v4, 4);
  assert.equal(migrated.version, STATE_VERSION);
  assert.ok(!migrated.objects.some((o) => o.id === 'scenery-couch'));
  assert.ok(!migrated.combat.archive.some((o) => o.id === 'scenery-back-2'), 'retired pieces leave the archive too');
  assert.ok(migrated.objects.some((o) => o.id === HOUSE_ID));
  const moved = migrated.objects.find((o) => o.id === 'under')!;
  assert.ok(moved && !(Math.abs(moved.position.x) < 4.8 && moved.position.z > -11 && moved.position.z < -1), 'creation under the house moved out');
  assert.deepEqual(migrated.objects.find((o) => o.id === 'clear')!.position, { x: 0, z: -13 });
  assert.equal(migrated.jobs[0].status, 'failed');
  assert.deepEqual(migrated.edits, []);
  assert.deepEqual(migrated.targets, []);
  assert.deepEqual(migrated.survivor.position, SURVIVOR_START);
  assert.equal(migrated.combat.paused, true);
});

test('zombies prefer defenses and creations over parked cars', () => {
  const car = initializeObject({ ...byName(sceneryObjects(), "Rook's car"), position: { x: 0, z: 3 } });
  const barrier = initializeObject({
    id: 'wall',
    revision: 1,
    blueprint: {
      name: 'wall',
      description: '',
      parts: [
        { shape: 'box', position: [0, 0.5, 0], size: [2, 1, 1], rotation: [0, 0, 0], color: '#888888' },
      ],
    },
    position: { x: 0, z: -6.5 },
    footprint: { width: 2, depth: 1 },
    createdBy: 'a',
    editedBy: 'a',
    createdAt: 0,
    role: 'barrier',
  });
  const combat = freshCombat(false);
  spawnGroup(combat, 1);
  combat.zombies[0].position = { x: 0, z: 0 };
  tickCombat(combat, [car, barrier], 250);
  assert.equal(combat.zombies[0].targetId, 'wall');
});
