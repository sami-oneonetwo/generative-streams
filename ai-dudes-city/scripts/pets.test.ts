// Pets follow their owner (movers.ts PETS, FK-027): with the Story switch on, a chatter's first small
// roamer trails them along the way they went to a spot behind their left shoulder at 1.2× their pace,
// pops to them in a puff from over 30 m, sits when they stop, and sleeps on their lot while they are
// away or indoors. Story OFF it roams as it always has. Fixture pets make one on a demo server, and
// the page sits it down and curls it up (client/dudes/objects.ts).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { harness } from './harness';
import { fixtureAgent, fixtureDesign } from '../src/worlds/ai-dudes/fixtures';
import { PET_SIZE, blueprintBounds, measureBlueprint, petSized } from '../src/worlds/ai-dudes/blueprint';
import { PETS, bedOf, heelOf, startMoving } from '../src/worlds/ai-dudes/movers';
import { AWAKE_MS, WALK_SPEED, sendDude } from '../src/worlds/ai-dudes/sim';
import { nextId, stateSchema, type Dude, type DudesState } from '../src/worlds/ai-dudes/state';
import { lotsOf } from '../src/worlds/ai-dudes/city';
import { createObjectsLayer } from '../client/dudes/objects';
import type { AgentTurn } from '../src/worlds/ai-dudes/agent';
import type { DesignInput } from '../src/worlds/ai-dudes/design';
import { partsKey, viewOf, type Blueprint, type GroundPoint, type SafehouseObject } from '../src/shared/objectTypes';
import { roadLines } from '../src/shared/city';

const dist = (a: GroundPoint, b: GroundPoint) => Math.hypot(a.x - b.x, a.z - b.z);
const inside = (p: GroundPoint, r: { minX: number; maxX: number; minZ: number; maxZ: number }) => p.x >= r.minX && p.x <= r.maxX && p.z >= r.minZ && p.z <= r.maxZ;
const design = async (request: string): Promise<Blueprint> => {
  const r = await fixtureDesign({ dudeName: 'kev', persona: '', request } as DesignInput, new AbortController().signal);
  assert.ok(r.action === 'build', request);
  return r.blueprint;
};
/** Where a point is in the owner's own frame: how far ahead of them, and how far to their left. */
const local = (owner: Dude, p: GroundPoint) => {
  const dx = p.x - owner.position.x,
    dz = p.z - owner.position.z;
  return { ahead: dx * Math.sin(owner.facing) + dz * Math.cos(owner.facing), left: dx * Math.cos(owner.facing) - dz * Math.sin(owner.facing) };
};
/** How far a point is from a walked line (the owner's positions, tick by tick). */
const offTrail = (p: GroundPoint, line: GroundPoint[]) => {
  let best = Infinity;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1],
      b = line[i];
    const len2 = (b.x - a.x) ** 2 + (b.z - a.z) ** 2;
    const u = len2 ? Math.max(0, Math.min(1, ((p.x - a.x) * (b.x - a.x) + (p.z - a.z) * (b.z - a.z)) / len2)) : 0;
    best = Math.min(best, dist(p, { x: a.x + (b.x - a.x) * u, z: a.z + (b.z - a.z) * u }));
  }
  return best;
};

/** A town with kev in it, the Story switch as asked; the fixture agent answers him. He stays where he is put. */
async function town(story = true) {
  const t = harness({ agent: fixtureAgent });
  t.h.state.ai.story = story;
  await t.say('kev', 'hi');
  await t.tick(1000);
  const kev = t.h.state.dudes.find((d) => d.name === 'kev')!;
  kev.idleUntil = Number.MAX_SAFE_INTEGER;
  kev.path = [];
  kev.walkingFor = undefined;
  return { ...t, kev };
}
/** A build of `request` for `owner` at `at`, gone up just now (as sim.ts commit puts one up). */
async function built(state: DudesState, owner: Dude, at: GroundPoint, request: string, now: number): Promise<SafehouseObject> {
  const blueprint = await design(request);
  const o: SafehouseObject = { id: nextId(state, 'b'), revision: 1, blueprint, position: { ...at }, footprint: measureBlueprint(blueprint), createdBy: owner.name, editedBy: owner.name, createdAt: now, owner: owner.id };
  startMoving(o, request);
  state.objects.push(o);
  state.worldRevision++;
  return o;
}
/** On the street nearest kev, `metres` along from him. */
function along(kev: Dude, metres: number): GroundPoint {
  const lines = roadLines();
  const z = lines.reduce((best, k) => (Math.abs(k - kev.position.z) < Math.abs(best - kev.position.z) ? k : best), lines[0]);
  return { x: kev.position.x + metres, z: z + 1.5 };
}

test('pet-sized: a small roamer only; no vehicle, no monster, nothing over 0.9 m tall or 1.4 m long', async () => {
  assert.ok(petSized(await design('pet dog')));
  const box = (w: number, h: number, l: number, extra: Partial<Blueprint> = {}): Blueprint => ({
    name: 'Critter',
    description: '',
    parts: [{ shape: 'box', position: [0, h / 2, 0], size: [w, h, l], rotation: [0, 0, 0], color: '#888888' }],
    moves: 'roam',
    ...extra,
  });
  assert.ok(petSized(box(0.5, PET_SIZE.tall, PET_SIZE.long)), 'right at the limits');
  assert.ok(!petSized(box(0.5, 0.95, 1)), 'too tall');
  assert.ok(!petSized(box(0.5, 0.6, 1.5)), 'too long');
  assert.ok(!petSized(box(1.5, 0.6, 0.5)), 'too long sideways too');
  assert.ok(!petSized(box(0.5, 0.6, 1, { moves: undefined })), 'stays put');
  assert.ok(!petSized(box(0.5, 0.6, 1, { moves: 'drive' })), 'drives');
  assert.ok(!petSized(box(0.5, 0.6, 1, { name: 'Toy go-kart' })), 'a vehicle');
  assert.ok(!petSized(box(0.5, 0.6, 1, { name: 'Baby T-rex' })), 'a monster');
});

test('fixture pets: "get me a pet dog" builds a 0.6 m dog that roams; a cat and a goat too; a dog house stays a house', async () => {
  const turn = async (text: string) => (await fixtureAgent({ name: 'kev', persona: 'x', messages: [text] } as AgentTurn, new AbortController().signal)).actions;
  assert.deepEqual(await turn('get me a pet dog'), [{ do: 'build', what: 'pet dog' }]);
  assert.deepEqual(await turn('I want a goat'), [{ do: 'build', what: 'pet goat' }]);
  assert.deepEqual(await turn('make me a pet cat'), [{ do: 'build', what: 'a pet cat' }], 'build words keep their wording');
  assert.deepEqual(await turn('paint my dog red'), [{ do: 'edit', target: 'dog', change: 'paint it red' }], 'an edit is still an edit');
  assert.deepEqual(await turn('hello there'), [], 'no pet words, no pet');
  for (const ask of ['pet dog', 'a pet cat', 'pet goat', 'a red pet']) {
    const b = await design(ask);
    const bounds = blueprintBounds(b);
    assert.equal(b.moves, 'roam', ask);
    assert.ok(bounds.maxY >= 0.55 && bounds.maxY <= PET_SIZE.tall, `${ask}: ${bounds.maxY.toFixed(2)} m tall`);
    assert.ok(Math.max(bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ) <= 1.2, `${ask} is at most 1.2 m long (design-system §7)`);
    assert.ok(b.parts.length >= 10 && b.parts.length <= 24, `${ask}: ${b.parts.length} parts`);
    assert.ok(b.animations?.some((a) => a.kind === 'sway'), `${ask} wags its tail`);
    assert.ok(petSized(b), ask);
  }
  assert.ok((await design('a red pet')).parts.some((p) => p.color === '#c4402f'), 'the asked-for colour');
  assert.equal((await design('a dog house')).moves, undefined, 'a dog house stays put');
});

test('Story ON: kev asks for a pet dog; it trails him across town along his way, at heel, and sits when he stops', async () => {
  const { h, say, tick, kev } = await town(true);
  await say('kev', 'get me a pet dog');
  await tick(80_000);
  const dog = h.state.objects.find((o) => /dog/i.test(o.blueprint.name))!;
  assert.ok(dog, 'built');
  assert.equal(dog.creature?.follows, kev.id, "kev's pet");
  assert.equal(dog.creature?.rest, 'sit', 'it came over to him and sat down');
  assert.ok(dist(dog.position, heelOf(h.state, kev)) < 0.3, 'at heel');

  // Across town: east along the street, then back the other way past where he started.
  const walked: GroundPoint[] = [{ ...kev.position }];
  let worst = 0,
    stray = 0,
    fastest = 0;
  for (const leg of [along(kev, 36), along(kev, -10)]) {
    assert.ok(sendDude(h.state, kev, leg), 'a way there');
    for (let i = 0; i < 80 && kev.path.length; i++) {
      const was = { ...dog.position };
      await tick(500);
      walked.push({ ...kev.position });
      worst = Math.max(worst, dist(dog.position, kev.position));
      stray = Math.max(stray, offTrail(dog.position, walked));
      fastest = Math.max(fastest, dist(was, dog.position));
      assert.equal(dog.creature?.rest, undefined, 'up and trotting while he walks');
    }
    assert.equal(kev.path.length, 0, 'he got there');
  }
  assert.ok(worst < PETS.gap + 0.4, `about 1.2 m from him all the way (${worst.toFixed(2)} m at most)`);
  assert.ok(stray < 0.9, `along the way he went, just off his left shoulder (${stray.toFixed(2)} m off it at most)`);
  assert.ok(fastest <= PETS.pace * WALK_SPEED * 0.5 + 1e-6, `no quicker than 1.2× his pace (${fastest.toFixed(2)} m a tick)`);
  // He stops: it comes to heel behind his left shoulder and sits.
  await tick(2000);
  assert.equal(dog.creature?.rest, 'sit');
  assert.equal(dog.creature?.moving, false);
  const at = local(kev, dog.position);
  assert.ok(at.ahead < -0.5 && at.left > 0.5, `behind-left (${at.ahead.toFixed(2)} ahead, ${at.left.toFixed(2)} left)`);
  assert.ok(Math.abs(dist(dog.position, kev.position) - PETS.gap) < 0.05, '1.2 m from him');
  assert.ok(Math.abs(dog.creature!.facing - kev.facing) < 1e-9, 'facing the way he faces');
});

test('a pet left behind catches up at 1.2× its owner\'s pace, and from over 30 m away it pops to them in a puff', async () => {
  const { h, tick, kev } = await town(true);
  const dog = await built(h.state, kev, { x: kev.position.x + 10, z: kev.position.z }, 'pet dog', h.now);
  const start = { ...dog.position };
  await tick(500);
  assert.equal(dog.creature?.follows, kev.id, 'his first small roamer is his pet');
  assert.ok(Math.abs(dist(start, dog.position) - PETS.pace * WALK_SPEED * 0.5) < 0.05, `a trot at 1.2× a walk (${dist(start, dog.position).toFixed(2)} m)`);
  await tick(6000);
  assert.ok(dist(dog.position, heelOf(h.state, kev)) < 0.3, 'at heel');
  // Whisked off (a teleport bit): the dog follows in a puff of smoke at both ends.
  const from = { ...dog.position };
  kev.position = { x: kev.position.x - 34, z: kev.position.z };
  kev.path = [];
  const before = h.state.effects?.length ?? 0;
  await tick(500);
  const puffs = (h.state.effects ?? []).slice(before).filter((e) => e.kind === 'burst' && e.label === 'smoke');
  assert.equal(puffs.length, 2, 'a puff where it was and where it lands');
  assert.ok(dist(puffs[0].to!, from) < 1e-9);
  assert.ok(dist(dog.position, heelOf(h.state, kev)) < 0.3, 'and it is at his heel');
});

test('it sleeps on its owner\'s lot while their chatter is away, and wakes to follow them when they are back', async () => {
  const { h, tick, kev } = await town(true);
  const dog = await built(h.state, kev, { x: kev.position.x + 2, z: kev.position.z }, 'pet dog', h.now);
  await tick(3000);
  const lot = lotsOf(h.state, kev)[0];
  assert.ok(lot, 'kev has a lot');
  kev.lastHeardAt = h.now - AWAKE_MS - 1000;
  await tick(30_000);
  assert.equal(dog.creature?.rest, 'sleep', 'asleep');
  assert.ok(inside(dog.position, lot.rect), 'on his lot');
  assert.ok(dist(dog.position, bedOf(h.state, kev, dog.position)) < 0.05, 'in its bed');
  const bed = { ...dog.position };
  await tick(10_000);
  assert.deepEqual(dog.position, bed, 'and stays put: no motion while he is away');
  // Back: kev speaks again (and he is somewhere else now); it gets up and goes to him.
  kev.lastHeardAt = h.now;
  kev.position = along(kev, 12);
  kev.path = [];
  await tick(500);
  assert.equal(dog.creature?.rest, undefined, 'up');
  await tick(15_000);
  assert.ok(dist(dog.position, heelOf(h.state, kev)) < 0.3, 'and back at heel');
  assert.equal(dog.creature?.rest, 'sit');
});

test('indoors: at home it goes straight to bed; somewhere else it waits by the door, then goes home', async () => {
  const { h, tick, kev } = await town(true);
  const dog = await built(h.state, kev, { x: kev.position.x + 2, z: kev.position.z }, 'pet dog', h.now);
  await tick(3000);
  const lot = lotsOf(h.state, kev)[0];
  // In somewhere down the street (well away from home): it sits and waits.
  kev.position = along(kev, 24);
  kev.path = [];
  await tick(8000);
  assert.ok(dist(bedOf(h.state, kev, dog.position), kev.position) > PETS.homeNear, 'away from home');
  const door = { ...dog.position };
  kev.hidden = true;
  await tick(PETS.doorMs - 2000);
  assert.equal(dog.creature?.rest, 'sit', 'waiting by the door');
  assert.deepEqual(dog.position, door);
  await tick(15_000);
  assert.equal(dog.creature?.rest, 'sleep', 'gave up and went home to bed');
  assert.ok(inside(dog.position, lot.rect));
  // Out again: back to him.
  kev.hidden = undefined;
  await tick(20_000);
  assert.ok(dist(dog.position, heelOf(h.state, kev)) < 0.3, 'back with him');
  // In at home: straight to bed.
  kev.position = { x: lot.centre.x, z: lot.centre.z };
  await tick(5000);
  kev.hidden = true;
  await tick(10_000);
  assert.equal(dog.creature?.rest, 'sleep', 'straight to bed');
});

test('one pet each: the oldest small roamer; the rest, big roamers and other people\'s builds roam as before. Old ones are adopted when Story goes ON', async () => {
  const { h, tick, kev } = await town(false);
  const at = (dx: number) => ({ x: kev.position.x + dx, z: kev.position.z });
  const first = await built(h.state, kev, at(3), 'pet cat', h.now - 5000);
  const second = await built(h.state, kev, at(-3), 'pet goat', h.now);
  const donkey = await built(h.state, kev, at(6), 'a donkey that roams the streets', h.now - 9000);
  await tick(5000);
  assert.ok(h.state.objects.every((o) => !o.creature?.follows), 'Story OFF: nobody is anybody\'s pet');
  h.state.ai.story = true;
  await tick(500);
  assert.equal(first.creature?.follows, kev.id, 'the oldest small roamer');
  assert.equal(second.creature?.follows, undefined, 'one pet each');
  assert.equal(donkey.creature?.follows, undefined, 'a 2 m donkey is no pet');
  // A pet whose owner has left town wanders like anything else.
  h.state.dudes = h.state.dudes.filter((d) => d !== kev);
  const spot = { ...first.position };
  await tick(30_000);
  assert.ok(dist(spot, first.position) > 1, 'it wanders');
  assert.equal(first.creature?.rest, undefined);
});

test('Story OFF: a pet roams as it always has; it neither trails its owner nor sits', async () => {
  const { h, say, tick, kev } = await town(false);
  await say('kev', 'get me a pet dog');
  await tick(80_000);
  const dog = h.state.objects.find((o) => /dog/i.test(o.blueprint.name))!;
  assert.equal(dog.creature?.follows, undefined, 'nobody\'s pet');
  // Even marked as kev's pet (Story was ON once), with it OFF it goes its own way.
  dog.creature!.follows = kev.id;
  const spots: GroundPoint[] = [];
  assert.ok(sendDude(h.state, kev, along(kev, 40)));
  for (let i = 0; i < 80; i++) {
    await tick(500);
    spots.push({ ...dog.position });
    assert.equal(dog.creature?.rest, undefined);
  }
  assert.ok(dist(dog.position, kev.position) > 8, `not at his heels (${dist(dog.position, kev.position).toFixed(1)} m off)`);
  assert.ok(spots.some((p) => dist(p, spots[0]) > 1), 'wandering');
});

test('the save: `follows` is kept, a rest is never written down (it is worked out again each tick)', async () => {
  const { h, tick, kev } = await town(true);
  const dog = await built(h.state, kev, { x: kev.position.x + 2, z: kev.position.z }, 'pet dog', h.now);
  await tick(5000);
  assert.equal(dog.creature?.rest, 'sit');
  const saved = stateSchema.safeParse(JSON.parse(JSON.stringify(h.state)));
  assert.ok(saved.success, 'save validates');
  const back = saved.data!.objects.find((o) => o.id === dog.id)!;
  assert.equal(back.creature?.follows, kev.id);
  assert.equal(back.creature?.rest, undefined);
});

test('the page: a sitting pet tips back on its front feet; a sleeping one curls up low and stops wagging; standing, it is as before', async () => {
  const blueprint = await design('pet dog');
  const o: SafehouseObject = { id: 'b7', revision: 1, blueprint, position: { x: 4, z: -3 }, footprint: measureBlueprint(blueprint), createdBy: 'kev', editedBy: 'kev', createdAt: 0, owner: 'dev:kev' };
  startMoving(o, 'pet dog');
  o.creature!.facing = 0.7;
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({ parts: { [partsKey(o.id, 1)]: blueprint.parts } }))) as typeof fetch;
  try {
    const layer = createObjectsLayer(new THREE.Group());
    const show = (rest: 'sit' | 'sleep' | undefined, now: number) => {
      o.creature!.rest = rest;
      const view = viewOf(o);
      layer.syncCommitted([view]);
      layer.sample([view], 1000);
      layer.update(now, false, 1000);
    };
    show(undefined, 0);
    await new Promise((r) => setTimeout(r, 20)); // the parts arrive
    show(undefined, 10);
    const g = layer.root.children[0] as THREE.Group;
    const front = Math.max(...blueprint.parts.map((p) => p.position[2] + p.size[2] / 2));
    const top = Math.max(...blueprint.parts.map((p) => p.position[1] + p.size[1] / 2));
    assert.equal(g.rotation.x, 0);
    assert.equal(g.position.y, 0, 'standing on the ground');
    const tail = blueprint.animations![0].part;
    const wag = () => g.children[tail].rotation.z;
    show(undefined, 300);
    const wagging = wag();
    // Sitting: eased in, then tipped back; the front feet stay where they stood, the back end goes down.
    show('sit', 1000);
    show('sit', 3000);
    assert.ok(g.rotation.x < -0.2, `tipped back (${g.rotation.x.toFixed(2)} rad)`);
    g.updateMatrixWorld(true);
    const feet = new THREE.Vector3(0, 0, front).applyMatrix4(g.matrixWorld);
    const stood = { x: o.position.x + Math.sin(0.7) * front, z: o.position.z + Math.cos(0.7) * front };
    assert.ok(Math.abs(feet.y) < 1e-6 && Math.abs(feet.x - stood.x) < 1e-6 && Math.abs(feet.z - stood.z) < 1e-6, 'front feet put');
    const rear = new THREE.Vector3(0, 0, -front).applyMatrix4(g.matrixWorld);
    assert.ok(rear.y < -0.3 * top && rear.y > -0.5 * top, `the back end down about 40% of its height (${(rear.y / top).toFixed(2)})`);
    // Asleep: low and still.
    show('sleep', 3100);
    show('sleep', 5000);
    assert.ok(Math.abs(g.rotation.x) < 1e-3);
    assert.ok(Math.abs(g.position.y + 0.32 * top) < 1e-3, 'curled up low');
    assert.ok(g.rotation.z > 0.1, 'leaning over');
    const still = wag();
    show('sleep', 5600);
    assert.equal(wag(), still, 'no wagging in its sleep');
    assert.notEqual(still, wagging);
    // Up again: back to standing, as any roamer stands.
    show(undefined, 5700);
    show(undefined, 8000);
    assert.equal(g.rotation.x, 0);
    assert.ok(Math.abs(g.position.y) < 1e-6 && Math.abs(g.rotation.z) < 1e-6);
  } finally {
    globalThis.fetch = realFetch;
  }
});
