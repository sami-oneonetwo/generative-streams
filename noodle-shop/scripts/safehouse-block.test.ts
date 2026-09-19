// The block: three lots wide (state v7). The corner shop to the west, Rook's yard in the middle,
// the park to the east; the same rules everywhere, and older worlds grow the lots on load.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { YARD_BOUNDS, LANDMARKS, SURVIVOR_START, HOUSE_ID, contains, footprint, overlaps, areaCandidates } from '../src/shared/safehouseLayout';
import { sceneryObjects, BLOCK_SCENERY_IDS } from '../src/worlds/safehouse/scenery';
import { SPAWN_POINTS, MAX_CREATURES, freshCombat, spawnZombie, intact } from '../src/worlds/safehouse/combat';
import { route, choosePlacement } from '../src/worlds/safehouse/placement';
import { createInitialState, migrateState, STATE_VERSION, BUDGETS, type SafehouseState } from '../src/worlds/safehouse/state';
import { createSafehouseWorld } from '../src/worlds/safehouse';
import type { SafehouseObject } from '../src/shared/safehouseTypes';

const inside = (r: { minX: number; maxX: number; minZ: number; maxZ: number }) =>
  r.minX >= YARD_BOUNDS.minX && r.maxX <= YARD_BOUNDS.maxX && r.minZ >= YARD_BOUNDS.minZ && r.maxZ <= YARD_BOUNDS.maxZ;

test('the block is three lots wide; every named area and spawn point sits inside it', () => {
  assert.equal(YARD_BOUNDS.maxX - YARD_BOUNDS.minX, 108);
  assert.equal(YARD_BOUNDS.maxZ - YARD_BOUNDS.minZ, 37);
  for (const [name, rect] of Object.entries(LANDMARKS)) assert.ok(inside(rect), `${name} is inside the block`);
  for (const key of ['west lot', 'shop', 'bus stop', 'east lot', 'park', 'playground', 'pond']) assert.ok(LANDMARKS[key], key);
  assert.ok(LANDMARKS['west lot'].maxX < -25 && LANDMARKS['east lot'].minX > 25, 'the lots flank the yard');
  for (const p of SPAWN_POINTS) {
    assert.ok(contains(YARD_BOUNDS, p), `spawn ${p.x},${p.z} is playable ground`);
    assert.ok(Math.abs(p.x) > 14 || p.z > 5, `spawn ${p.x},${p.z} is outside the fenced yard`);
  }
  const combat = freshCombat(false);
  for (let i = 0; i < 12; i++) spawnZombie(combat, 'walker');
  assert.equal(new Set(combat.zombies.map((z) => `${z.position.x},${z.position.z}`)).size, 12, 'the twelve points are all used');
});

test('the lots are seeded, inside the block, not on top of each other, and reachable from the porch', () => {
  const scenery = sceneryObjects();
  const ids = scenery.map((o) => o.id);
  assert.equal(new Set(ids).size, ids.length, 'ids are unique');
  for (const id of BLOCK_SCENERY_IDS) assert.ok(ids.includes(id), `${id} is seeded`);
  const solid = scenery.filter((o) => !o.passable);
  for (const o of scenery) {
    const r = footprint(o.position, o.footprint.width, o.footprint.depth);
    assert.ok(inside(r), `${o.id} is inside the block: ${JSON.stringify(r)}`);
    assert.ok(o.fixed, `${o.id} is part of the neighborhood`);
  }
  for (let i = 0; i < solid.length; i++)
    for (let j = i + 1; j < solid.length; j++) {
      const a = solid[i],
        b = solid[j];
      assert.ok(
        !overlaps(footprint(a.position, a.footprint.width, a.footprint.depth), footprint(b.position, b.footprint.width, b.footprint.depth)),
        `${a.id} and ${b.id} overlap`,
      );
    }
  assert.ok(route(SURVIVOR_START, { x: -42, z: 1.5 }, scenery), 'Rook can walk to the shop front');
  assert.ok(route(SURVIVOR_START, { x: 41, z: 0 }, scenery), 'Rook can walk into the park');
  assert.ok(route(SURVIVOR_START, { x: -53, z: 12 }, scenery), 'and out to the far west spawn');
  assert.equal(route(SURVIVOR_START, { x: -42, z: -6 }, scenery), null, 'nobody walks through the shop');
});

test('"in the park" and "outside the shop" place there', () => {
  const scenery = sceneryObjects();
  const park = choosePlacement({ width: 1.5, depth: 1.5 }, scenery, SURVIVOR_START, undefined, areaCandidates(LANDMARKS.park));
  assert.ok(contains(LANDMARKS.park, park.position), JSON.stringify(park.position));
  const shop = choosePlacement({ width: 1, depth: 1 }, scenery, SURVIVOR_START, undefined, areaCandidates(LANDMARKS.shop));
  assert.ok(contains(LANDMARKS.shop, shop.position), JSON.stringify(shop.position));
  assert.ok(park.path.length > 0 && shop.path.length > 0);
});

test('budgets grew with the block', () => {
  assert.equal(BUDGETS.creations, 100);
  assert.equal(BUDGETS.parts, 4000);
  assert.equal(MAX_CREATURES, 12);
  assert.equal(STATE_VERSION, 7);
  assert.equal(createSafehouseWorld().meta.stateVersion, STATE_VERSION, 'the world and the schema agree on the version');
});

test('a v6 world grows the lots on load; nothing standing moves; taken or archived spots are left alone', () => {
  const fresh = createInitialState();
  fresh.objects = sceneryObjects();
  const block = new Set(BLOCK_SCENERY_IDS);
  const shop = fresh.objects.find((o) => o.id === 'scenery-shop')!;
  const slide = fresh.objects.find((o) => o.id === 'scenery-slide')!;
  const creation: SafehouseObject = {
    ...structuredClone(fresh.objects.find((o) => o.id === 'scenery-crate')!),
    id: 'c0ffee00-0000-4000-8000-000000000001',
    fixed: undefined,
    createdBy: 'dave',
    editedBy: 'dave',
    position: { ...slide.position }, // chat already built where the slide would go
  };
  const v6 = {
    ...structuredClone(fresh),
    version: 6,
    objects: [...fresh.objects.filter((o) => !block.has(o.id)), creation],
    combat: { ...structuredClone(fresh.combat), paused: false, archive: [{ ...structuredClone(shop), destroyedAt: 5 }] },
  } as unknown as Record<string, unknown>;
  const before = structuredClone(v6.objects) as SafehouseObject[];
  const migrated: SafehouseState = migrateState(v6, 6);
  assert.equal(migrated.version, 7);
  const ids = new Set(migrated.objects.map((o) => o.id));
  for (const id of BLOCK_SCENERY_IDS) {
    if (id === 'scenery-shop') assert.ok(!ids.has(id), 'an archived shop is not re-seeded standing');
    else if (id === 'scenery-slide') assert.ok(!ids.has(id), 'a taken spot is left alone');
    else assert.ok(ids.has(id), `${id} arrived`);
  }
  for (const o of before) {
    const now = migrated.objects.find((x) => x.id === o.id)!;
    assert.deepEqual(now.position, o.position, `${o.id} did not move`);
    assert.equal(now.revision, o.revision);
  }
  assert.equal(migrated.combat.paused, false, 'the wave clock is left running');
  assert.equal(migrated.combat.archive.length, 1);
  assert.ok(migrated.objects.find((o) => o.id === HOUSE_ID));
  assert.ok(migrated.objects.every((o) => intact(o) || o.destroyedAt !== undefined));
});
