import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sceneryObjects, RETIRED_SCENERY_IDS, adoptTilts } from '../src/worlds/safehouse/scenery';
import { adoptNeighbourYards, neighbourFenceObjects, NEIGHBOURS } from '../src/worlds/safehouse/neighbours';
import { createSafehouseWorld } from '../src/worlds/safehouse';
import { createInitialState, migrateState, stateSchema, STATE_VERSION, type SafehouseState } from '../src/worlds/safehouse/state';
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
import { SURVIVOR_START, HOUSE_ID, footprint, overlaps, contains } from '../src/shared/safehouseLayout';
import type { WorldCtx } from '../src/engine/world';
import type { Primitive, SafehouseObject } from '../src/shared/safehouseTypes';

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

// ---- Tilts (2026-10-08): three.js's +X tips a part's +Z end down, +Z lifts its +X end. -----------

/** The two ends of an X-tilted part, in its design's frame. */
function ends(p: Primitive) {
  const h = p.size[2] / 2,
    s = Math.sin(p.rotation[0]),
    c = Math.cos(p.rotation[0]);
  return { back: { y: p.position[1] + h * s, z: p.position[2] - h * c }, front: { y: p.position[1] - h * s, z: p.position[2] + h * c } };
}
const sized = (o: SafehouseObject, size: number[]) => o.blueprint.parts.filter((p) => p.size.every((v, k) => v === size[k]));

test('roofs rise to a ridge, porch roofs shed off the wall, the slide runs down from its platform, picnic legs splay', () => {
  const objects = sceneryObjects();
  for (const id of [HOUSE_ID, 'scenery-house-west', 'scenery-house-east']) {
    const house = objects.find((o) => o.id === id)!;
    const [rear, front] = sized(house, [9.6, 0.26, 4]).sort((a, b) => a.position[2] - b.position[2]);
    assert.ok(ends(rear).front.y > ends(rear).back.y + 1, `${id}: the rear slab climbs to the ridge`);
    assert.ok(ends(front).back.y > ends(front).front.y + 1, `${id}: the front slab climbs to the ridge`);
    const [porch] = sized(house, [3.9, 0.14, 1.9]);
    assert.ok(ends(porch).back.y > ends(porch).front.y, `${id}: the porch roof falls away from the wall`);
  }
  const slide = objects.find((o) => o.id === 'scenery-slide')!;
  const [chute] = sized(slide, [0.9, 0.08, 3.4]);
  const [platform] = sized(slide, [1.1, 0.1, 1.1]);
  assert.ok(Math.abs(ends(chute).back.y - platform.position[1]) < 0.1, 'the chute starts at the platform');
  assert.ok(ends(chute).back.z < ends(chute).front.z && ends(chute).front.y < 0.5, 'and runs down to the ground away from the ladder');
  const [left, right] = sized(objects.find((o) => o.id === 'scenery-picnic')!, [0.1, 0.7, 1.7]).sort((a, b) => a.position[0] - b.position[0]);
  // Rz(θ) takes a leg's foot (0, −h) to x + h·sinθ.
  const foot = (p: Primitive) => p.position[0] + (p.size[1] / 2) * Math.sin(p.rotation[2]);
  const top = (p: Primitive) => p.position[0] - (p.size[1] / 2) * Math.sin(p.rotation[2]);
  assert.ok(foot(right) - foot(left) > top(right) - top(left), 'the legs are wider apart at the foot');
});

/** The houses next door before 2026-10-08: one box under two roof slabs (tilted into a V). */
const oldHouse = (wall: string): Primitive[] => [
  { shape: 'box', position: [0, 1.8, 0], size: [9, 3.6, 7], rotation: [0, 0, 0], color: wall },
  { shape: 'box', position: [0, 4.05, -1.75], size: [10, 0.28, 4.8], rotation: [0.4, 0, 0], color: '#656d63' },
  { shape: 'box', position: [0, 4.05, 1.75], size: [10, 0.28, 4.8], rotation: [-0.4, 0, 0], color: '#656d63' },
  { shape: 'box', position: [-2.8, 1.9, 3.53], size: [1.4, 1.35, 0.04], rotation: [0, 0, 0], color: '#47554e' },
  { shape: 'box', position: [2.8, 1.9, 3.53], size: [1.4, 1.35, 0.04], rotation: [0, 0, 0], color: '#47554e' },
  { shape: 'box', position: [0, 1.05, 3.54], size: [1.15, 2.1, 0.04], rotation: [0, 0, 0], color: '#655f4c' },
];

test('an older save: the houses next door take Rook\'s design in their paint and move in line, the lots get fences, the tilts come right', () => {
  const state = createInitialState();
  state.objects = [...sceneryObjects(), ...fenceObjects()];
  const at = (id: string) => state.objects.findIndex((o) => o.id === id);
  const west = state.objects[at('scenery-house-west')];
  state.objects[at('scenery-house-west')] = { ...west, revision: 13, position: { x: -20, z: -4 }, footprint: { width: 10, depth: 8.9 }, blueprint: { ...west.blueprint, description: 'Marge lives here', parts: oldHouse('#d6d2c2') } };
  const east = state.objects[at('scenery-house-east')];
  state.objects[at('scenery-house-east')] = { ...east, revision: 12, position: { x: 23, z: -5 }, footprint: { width: 10, depth: 8.9 }, blueprint: { ...east.blueprint, parts: oldHouse('#8c8b78') } };
  // Rook's house as chat redesigned it from the old parts: a sandbag fewer, the roof still a V.
  const rook = state.objects[at(HOUSE_ID)];
  const flip = (p: Primitive): Primitive => (p.size.join() === '9.6,0.26,4' ? { ...p, rotation: [-p.rotation[0], 0, 0] } : p);
  state.objects[at(HOUSE_ID)] = { ...rook, revision: 2, blueprint: { ...rook.blueprint, parts: rook.blueprint.parts.slice(0, -1).map(flip) } };
  // The slide as it was seeded: the chute tilted up and away from the ladder.
  const slide = state.objects[at('scenery-slide')];
  state.objects[at('scenery-slide')] = { ...slide, blueprint: { ...slide.blueprint, parts: slide.blueprint.parts.map((p) => (p.size[2] === 3.4 ? { ...p, rotation: [-0.55, 0, 0] } : p)) } };
  // Jake's piece on what becomes his front fence line, and a chat build on Marge's back one.
  const jakes = initializeObject({ id: 'neighbour-east-slot-1', revision: 6, blueprint: { name: "Jake's conversation piece", description: '', parts: [{ shape: 'box', position: [0, 0.5, 0], size: [1.2, 1, 0.9], rotation: [0, 0, 0], color: '#888888' }] }, position: { x: 28.5, z: 4 }, footprint: { width: 1.2, depth: 0.9 }, createdBy: 'Jake', editedBy: 'Jake', createdAt: 1, fixed: true, owner: 'east' });
  const chats = initializeObject({ id: 'duck', revision: 1, blueprint: { name: 'Duck', description: '', parts: [{ shape: 'box', position: [0, 0.5, 0], size: [1, 1, 1], rotation: [0, 0, 0], color: '#888888' }] }, position: { x: -25, z: -17.4 }, footprint: { width: 1, depth: 1 }, createdBy: 'dave', editedBy: 'dave', createdAt: 1 });
  state.objects.push(jakes, chats);

  assert.equal(adoptNeighbourYards(state), true);
  assert.equal(adoptTilts(state), true);
  const byId = (id: string) => state.objects.find((o) => o.id === id)!;
  const marge = byId('scenery-house-west');
  assert.equal(marge.blueprint.parts.length, sceneryObjects().find((o) => o.id === HOUSE_ID)!.blueprint.parts.length, "Rook's design");
  assert.deepEqual(marge.position, { x: -20, z: -5.7 }, 'in line with his');
  assert.equal(marge.revision, 14, 'a new revision, so the page fetches the new shape');
  assert.equal(marge.blueprint.description, 'Marge lives here');
  assert.ok(marge.blueprint.parts.some((p) => p.color === '#d6d2c2' && p.size[1] === 3.4), 'the walls keep her paint');
  assert.deepEqual(byId('scenery-house-east').position, { x: 23, z: -5.7 });
  for (const id of [HOUSE_ID, 'scenery-house-west', 'scenery-house-east']) {
    const [rear, front] = sized(byId(id), [9.6, 0.26, 4]).sort((a, b) => a.position[2] - b.position[2]);
    assert.ok(ends(rear).front.y > ends(rear).back.y && ends(front).back.y > ends(front).front.y, `${id}: the roof rises to its ridge`);
  }
  assert.equal(byId(HOUSE_ID).revision, 3);
  assert.equal(byId(HOUSE_ID).blueprint.parts.length, rook.blueprint.parts.length - 1, "chat's redesign keeps its shape otherwise");
  assert.ok(sized(byId('scenery-slide'), [0.9, 0.08, 3.4])[0].rotation[0] > 0, 'the chute runs down');
  assert.equal(byId('scenery-slide').revision, 2);

  const fences = neighbourFenceObjects();
  const missing = fences.filter((f) => !state.objects.some((o) => o.id === f.id));
  assert.deepEqual(missing.map((f) => f.owner), ['west'], 'one section waits for the duck to move');
  assert.ok(overlaps(footprint(missing[0].position, missing[0].footprint.width, missing[0].footprint.depth), footprint(chats.position, 1, 1)));
  assert.deepEqual(byId('duck').position, { x: -25, z: -17.4 }, "chat's build stays where it is");
  const moved = byId('neighbour-east-slot-1');
  const line = fences.filter((f) => f.owner === 'east').map((f) => footprint(f.position, f.footprint.width, f.footprint.depth));
  assert.ok(!line.some((r) => overlaps(r, footprint(moved.position, 1.2, 0.9))), "Jake's piece is off his fence line");
  assert.ok(contains(NEIGHBOURS[1].lot, moved.position) && moved.revision === 7, 'onto his own lot');
  for (const spec of NEIGHBOURS) {
    assert.ok(route(spec.home, { x: spec.home.x, z: 9 }, state.objects), `${spec.name} walks out through the gate`);
    assert.ok(route(SURVIVOR_START, spec.home, state.objects), `Rook can walk round to ${spec.name}'s door`);
  }
  stateSchema.parse(JSON.parse(JSON.stringify(state)));
  assert.equal(adoptNeighbourYards(state), false, 'idempotent while the duck is there');
  assert.equal(adoptTilts(state), false);
  byId('duck').position = { x: -25, z: -12 };
  assert.equal(adoptNeighbourYards(state), true, 'and the section goes up once it has moved');
  assert.ok(state.objects.some((o) => o.id === missing[0].id));
});

test('a fresh world seeds the neighbours\' fences round their lots, joined to Rook\'s, with a gate at each porch', () => {
  const h = harness();
  const fences = h.state.objects.filter((o) => /^neighbour-\w+-fence-/.test(o.id));
  assert.equal(fences.length, neighbourFenceObjects().length);
  for (const spec of NEIGHBOURS) {
    const mine = fences.filter((o) => o.owner === spec.id);
    assert.ok(mine.every((o) => o.role === 'barrier' && o.fixed && o.createdBy === spec.name), `${spec.name}'s fence is theirs to keep`);
    const front = mine.filter((o) => o.position.z === 4.6).map((o) => footprint(o.position, o.footprint.width, o.footprint.depth));
    const house = h.state.objects.find((o) => o.id === spec.houseId)!;
    assert.ok(!front.some((r) => r.minX < house.position.x + 1.5 && r.maxX > house.position.x - 1.5), 'a gate in front of the porch');
    const rookSide = spec.id === 'west' ? -11 : 13;
    assert.ok(front.some((r) => Math.abs((spec.id === 'west' ? r.maxX : r.minX) - rookSide) < 1e-6), "the front line runs on from Rook's");
  }
});

test("a house next door left on its old spot moves in line once it can: her own pieces step aside, chat's hold it there", () => {
  const state = createInitialState();
  state.objects = [...sceneryObjects(), ...fenceObjects(), ...neighbourFenceObjects()];
  const house = state.objects.find((o) => o.id === 'scenery-house-west')!;
  house.position = { x: -20, z: -4 }; // converted in place on an earlier start, something of hers in the way
  const piece = (id: string, x: number, z: number, owner?: string) =>
    initializeObject({ id, revision: 1, blueprint: { name: id, description: '', parts: [{ shape: 'box', position: [0, 0.5, 0], size: [1, 1, 1], rotation: [0, 0, 0], color: '#888888' }] }, position: { x, z }, footprint: { width: 1, depth: 1 }, createdBy: owner ? 'Marge' : 'dave', editedBy: 'x', createdAt: 1, ...(owner ? { fixed: true, owner } : {}) });
  const chats = piece('duck', -24.5, -11);
  state.objects.push(chats);
  assert.equal(adoptNeighbourYards(state), false, "chat's duck holds the spot");
  assert.deepEqual(house.position, { x: -20, z: -4 });
  state.objects = state.objects.filter((o) => o.id !== 'duck');
  const hers = piece('neighbour-west-slot-1', -24.5, -11, 'west');
  state.objects.push(hers);
  const marge = state.neighbours.find((n) => n.id === 'west')!;
  marge.job = { kind: 'edit', purpose: 'project', label: 'Painting the house', status: 'working', path: [], spot: house.position, workedMs: 0, workMs: 1000, targetId: house.id } as typeof marge.job;
  assert.equal(adoptNeighbourYards(state), true);
  const moved = state.objects.find((o) => o.id === 'scenery-house-west')!;
  assert.deepEqual(moved.position, { x: -20, z: -5.7 }, 'in line with Rook');
  assert.equal(moved.revision, house.revision + 1);
  assert.ok(!overlaps(footprint(hers.position, 1, 1), footprint(moved.position, moved.footprint.width, moved.footprint.depth)), 'her piece stepped aside');
  assert.ok(contains(NEIGHBOURS[0].lot, hers.position), 'onto her own lot');
  assert.equal(marge.job, undefined, 'the paint job on the old spot is dropped');
  assert.equal(adoptNeighbourYards(state), false, 'and it stays put after that');
});
