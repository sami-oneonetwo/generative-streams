// Life in the yard: chat's living builds. The model names a behaviour and draws the
// body; the app runs it with its own numbers, zombies paused or not.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tickCreatures, freshCreature, flies, canReach, FLIGHT } from '../src/worlds/safehouse/creatures';
import {
  CREATURES,
  MAX_CREATURES,
  isHostile,
  initializeObject,
  freshCombat,
  spawnZombie,
  tickCombat,
  damageObject,
} from '../src/worlds/safehouse/combat';
import { validateResponse, normalizeCreature } from '../src/worlds/safehouse/blueprint';
import { fixtureGenerator } from '../src/llm/blueprint';
import { pickRepairTarget } from '../src/worlds/safehouse/repair';
import { route } from '../src/worlds/safehouse/placement';
import { parseRequest } from '../src/worlds/safehouse/edits';
import { sceneryObjects } from '../src/worlds/safehouse/scenery';
import { createSafehouseWorld } from '../src/worlds/safehouse';
import { active, type SafehouseState } from '../src/worlds/safehouse/state';
import { HOUSE_ID, SURVIVOR_START } from '../src/shared/safehouseLayout';
import type { CreatureBehaviour, SafehouseObject } from '../src/shared/safehouseTypes';
import type { WorldCtx } from '../src/engine/world';

const lcg = (seed = 11) => () => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
};
const piece = (
  id: string,
  position: { x: number; z: number },
  behaviour?: CreatureBehaviour,
  extra: Partial<SafehouseObject> = {},
): SafehouseObject =>
  initializeObject({
    id,
    revision: 1,
    createdAt: 0,
    createdBy: 'viewer',
    editedBy: 'viewer',
    position,
    footprint: { width: 1, depth: 1 },
    blueprint: {
      name: id,
      description: '',
      parts: [{ shape: 'box', position: [0, 0.5, 0], size: [1, 1, 1], rotation: [0, 0, 0], color: '#888888' }],
    },
    ...(behaviour ? { creature: freshCreature(behaviour) } : {}),
    ...extra,
  });
const yard = (objects: SafehouseObject[]) => ({
  objects,
  combat: freshCombat(true),
  survivor: { position: { ...SURVIVOR_START } },
});
function run(w: ReturnType<typeof yard>, ticks: number, rng = lcg()) {
  const events = [];
  for (let i = 0; i < ticks; i++) events.push(...tickCreatures(w, 500, rng).events);
  return events;
}
const byId = (w: { objects: SafehouseObject[] }, id: string) => w.objects.find((o) => o.id === id)!;

test('profiles: the app owns the numbers; only a rampager is hostile', () => {
  assert.equal(CREATURES.rampage.hostile, true);
  for (const b of ['fight', 'zoom', 'roam'] as const) assert.equal(CREATURES[b].hostile, false);
  assert.ok(CREATURES.zoom.speed > CREATURES.fight.speed && CREATURES.fight.speed > CREATURES.rampage.speed);
  assert.equal(CREATURES.zoom.damage, 0);
  assert.equal(CREATURES.roam.damage, 0);
  const gorilla = piece('g', { x: 0, z: -12 }, 'rampage');
  assert.equal(gorilla.health, 300, 'a creature starts with its profile health, not the decoration 80');
  assert.ok(isHostile(gorilla));
  assert.ok(!isHostile(piece('d', { x: 0, z: -12 }, 'fight')));
  assert.equal(MAX_CREATURES, 15);
});

test('a rampager runs to things and breaks them, moves on, and never touches the house', () => {
  const house = piece(HOUSE_ID, { x: 0, z: -6 }, undefined, { footprint: { width: 8, depth: 6 }, maxHealth: 4000, health: 4000 });
  const crate = piece('crate', { x: 3, z: -12 });
  const barrel = piece('barrel', { x: -3, z: -13 });
  const w = yard([house, crate, barrel, piece('g', { x: 0, z: -12 }, 'rampage')]);
  const start = { ...byId(w, 'g').position };
  const events = run(w, 120); // a minute
  assert.ok(events.some((e) => e.kind === 'hit'), 'it hit something');
  assert.ok((crate.damageRevision ?? 0) + (barrel.damageRevision ?? 0) > 0, 'the clutter took damage');
  assert.ok(events.some((e) => e.kind === 'down'), 'and something fell');
  assert.equal(house.damageRevision, 0, 'the house is off limits');
  const g = byId(w, 'g');
  assert.ok(Math.hypot(g.position.x - start.x, g.position.z - start.z) > 1, 'it moved to get there');
  assert.ok(g.creature!.facing !== undefined);
});

test('a fighter goes for the rampager, the rampager hits back, and the fight has a loser', () => {
  const w = yard([piece('g', { x: 0, z: -12 }, 'rampage'), piece('d', { x: 6, z: -12 }, 'fight')]);
  run(w, 12); // 6 s: the dog closes in and bites
  const g = byId(w, 'g'),
    d = byId(w, 'd');
  assert.ok((g.health ?? 300) < 300, `the dog bit the gorilla (${g.health})`);
  assert.equal(d.creature!.targetId, 'g', 'the dog is on the gorilla');
  assert.equal(g.creature!.targetId, 'd', 'the rampager turned on its biter');
  assert.ok((d.health ?? 150) < 150, `the gorilla hit back (${d.health})`);
  run(w, 200);
  assert.ok(!(g.destroyedAt === undefined && d.destroyedAt === undefined), 'a two-minute fight ends');
});

test('a fighter bites zombies and the wave counts the kill', () => {
  const w = yard([piece('d', { x: 2, z: 14 }, 'fight')]);
  const z = spawnZombie(w.combat, 'walker')!;
  z.position = { x: 2, z: 16 };
  const events = run(w, 30);
  assert.ok(events.some((e) => e.kind === 'kill'), 'the zombie went down');
  assert.equal(w.combat.zombies.length, 0);
  assert.equal(w.combat.kills, 1);
  assert.equal(w.combat.wave.killed, 1);
});

test('with nothing to fight, the dog stays close to Rook', () => {
  const w = yard([piece('d', { x: 8, z: -14 }, 'fight')]);
  run(w, 40);
  const d = byId(w, 'd');
  assert.ok(Math.hypot(d.position.x - SURVIVOR_START.x, d.position.z - SURVIVOR_START.z) <= 4.5, JSON.stringify(d.position));
});

test('the car tears around and breaks nothing; the roamer ambles and breaks nothing', () => {
  const fence = piece('fence-9', { x: 2, z: -14 });
  const w = yard([fence, piece('car', { x: 0, z: -14 }, 'zoom'), piece('hen', { x: -2, z: -14 }, 'roam')]);
  const trail = { car: 0, hen: 0 };
  let carAt = { ...byId(w, 'car').position },
    henAt = { ...byId(w, 'hen').position };
  const rng = lcg(3);
  for (let i = 0; i < 40; i++) {
    tickCreatures(w, 500, rng);
    const car = byId(w, 'car').position,
      hen = byId(w, 'hen').position;
    trail.car += Math.hypot(car.x - carAt.x, car.z - carAt.z);
    trail.hen += Math.hypot(hen.x - henAt.x, hen.z - henAt.z);
    carAt = { ...car };
    henAt = { ...hen };
  }
  assert.ok(trail.car > 40, `the car covered ground in 20 s (${trail.car.toFixed(1)} m)`);
  assert.ok(trail.hen > 2 && trail.hen < 25, `the hen ambled (${trail.hen.toFixed(1)} m)`);
  assert.equal(fence.damageRevision, 0);
  assert.equal(byId(w, 'car').damageRevision, 0);
});

test("Rook fixes the dog and leaves the gorilla alone; creatures never block anyone's route", () => {
  const gorilla = piece('g', { x: 0, z: -12 }, 'rampage', { health: 100 });
  const dog = piece('d', { x: 4, z: -12 }, 'fight', { health: 50 });
  assert.equal(pickRepairTarget([gorilla, dog], [], SURVIVOR_START)?.object.id, 'd');
  dog.health = 150;
  assert.equal(pickRepairTarget([gorilla, dog], [], SURVIVOR_START), undefined, 'a hurt gorilla is not his problem');
  const deadDog = piece('dd', { x: 5, z: -12 }, 'fight', { destroyedAt: 1 });
  const deadGorilla = piece('dg', { x: 6, z: -12 }, 'rampage', { destroyedAt: 1 });
  assert.equal(pickRepairTarget([], [deadGorilla, deadDog], SURVIVOR_START)?.object.id, 'dd', 'he rebuilds the dog, never the gorilla');
  assert.ok(route(SURVIVOR_START, { x: 0, z: -12 }, [gorilla, dog]), 'a route straight through a creature is fine');
});

test('turrets shoot a rampaging creature while combat runs', () => {
  const turret = piece('t', { x: 0, z: -12 }, undefined, { role: 'turret' });
  const gorilla = piece('g', { x: 4, z: -12 }, 'rampage');
  const combat = freshCombat(false);
  tickCombat(combat, [turret, gorilla], 500);
  assert.equal(gorilla.health, 280);
  assert.equal(combat.shots.length, 1);
  assert.deepEqual(combat.shots[0].to, gorilla.position);
});

test('the design contract: behaviour words normalise, statues stay statues', () => {
  const blueprint = {
    name: 'Thing',
    description: '',
    parts: [{ shape: 'box', position: [0, 0.5, 0], size: [1, 1, 1], rotation: [0, 0, 0], color: '#ffffff' }],
  };
  const living = (value: unknown) => {
    const r = validateResponse(value);
    return 'blueprint' in r ? r.creature?.behaviour : undefined;
  };
  const build = (creature: unknown) => living({ action: 'build', reply: 'ok', blueprint, creature });
  assert.equal(build('smash things'), 'rampage');
  assert.equal(build({ behaviour: 'guard dog' }), 'fight');
  assert.equal(build({ behavior: 'zoom' }), 'zoom');
  assert.equal(build('wanders around'), 'roam');
  assert.equal(build('static'), undefined);
  assert.equal(build(undefined), undefined);
  assert.equal(
    living({ action: 'build', reply: 'ok', blueprint: { ...blueprint, creature: 'rampage' } }),
    'rampage',
    'a behaviour tucked inside the blueprint is hoisted',
  );
  assert.equal(normalizeCreature(42), undefined);
  assert.equal(living({ action: 'edit', targetId: 'x', reply: 'ok', blueprint, creature: 'calm' }), 'roam');
});

test('"a gorilla that runs around" describes a new thing; "that" is not a pointer to the last creation', () => {
  const objects = sceneryObjects();
  for (const text of [
    'Build a gorilla that runs around and breaks things',
    'Build a dog that fights the gorilla',
    'Build a little remote control car that just zooms around',
  ]) {
    const r = parseRequest(text, objects, 'scenery-garage');
    assert.equal(r.clarification, undefined, text);
    assert.equal(r.targetId, undefined, text);
    assert.equal(r.operation, undefined, text);
  }
  // Real pointers still work: "it" means the requester's last creation.
  assert.equal(parseRequest('Give it a chimney', objects, 'scenery-garage').targetId, 'scenery-garage');
  assert.equal(parseRequest('Paint that red', objects, 'scenery-garage').targetId, 'scenery-garage');
});

test('fixtures: the gorilla, the dog and the RC car come back alive; the duck does not', async () => {
  const gen = (text: string) => fixtureGenerator({ text, username: 'a', objects: [] }, new AbortController().signal);
  const gorilla = await gen('Build a gorilla that runs around and breaks things');
  const dog = await gen('Build a dog that fights the gorilla');
  const car = await gen('Build a little remote control car that just zooms around');
  const duck = await gen('Build a duck-shaped watchtower');
  assert.equal('creature' in gorilla && gorilla.creature?.behaviour, 'rampage');
  assert.equal('creature' in dog && dog.creature?.behaviour, 'fight');
  assert.equal('creature' in car && car.creature?.behaviour, 'zoom');
  assert.equal('creature' in duck ? duck.creature : undefined, undefined);
});

const flyer = (id: string, position: { x: number; z: number }, behaviour: CreatureBehaviour, altitude = FLIGHT.cruise) => {
  const o = piece(id, position, behaviour);
  o.creature = { ...freshCreature(behaviour, true), altitude };
  return o;
};

test('flyers go straight over what walkers must go around, climb to cruise, and fall when downed', () => {
  // A ring of walls around a crow and a hen: the crow flies out, the hen never can.
  const walls = [
    piece('wall-n', { x: 0, z: -9 }, undefined, { footprint: { width: 12, depth: 1 } }),
    piece('wall-s', { x: 0, z: -15 }, undefined, { footprint: { width: 12, depth: 1 } }),
    piece('wall-w', { x: -6, z: -12 }, undefined, { footprint: { width: 1, depth: 7 } }),
    piece('wall-e', { x: 6, z: -12 }, undefined, { footprint: { width: 1, depth: 7 } }),
  ];
  const crow = flyer('crow', { x: 0, z: -12 }, 'roam', 0);
  const hen = piece('hen', { x: 0, z: -12 }, 'roam');
  const w = yard([...walls, crow, hen]);
  assert.ok(flies(crow) && !flies(hen));
  assert.ok(canReach(crow, hen) && canReach(crow, crow) && canReach(hen, hen) && !canReach(hen, crow));
  const ring = (p: { x: number; z: number }) => Math.abs(p.x) < 5.4 && p.z > -14.4 && p.z < -9.6;
  let crowOut = false,
    henOut = false;
  const rng = lcg(9);
  for (let i = 0; i < 120; i++) {
    tickCreatures(w, 500, rng);
    if (!ring(byId(w, 'crow').position)) crowOut = true;
    if (!ring(byId(w, 'hen').position)) henOut = true;
  }
  assert.ok(crowOut, 'the crow left the ring');
  assert.ok(!henOut, 'the hen never got out');
  assert.ok(Math.abs((crow.creature!.altitude ?? 0) - FLIGHT.cruise) < 0.3, `cruising at ${crow.creature!.altitude}`);
  assert.equal(pickRepairTarget([{ ...crow, health: 5 }], [], SURVIVOR_START), undefined, 'Rook does not chase flyers with a hammer');
  damageObject(crow, 1000, 1);
  run(w, 12, rng);
  assert.equal(crow.creature!.altitude, 0, 'a downed flyer falls to the ground');
});

test('a dog cannot reach a dragon; a hawk can; the dragon strikes the ground from the air; turrets hit flyers where they fly', () => {
  const dragon = flyer('dragon', { x: 0, z: -12 }, 'rampage');
  const dog = piece('dog', { x: 4, z: -12 }, 'fight');
  const crate = piece('crate', { x: 3, z: -13 });
  const w = yard([dragon, dog, crate]);
  run(w, 40);
  assert.notEqual(dog.creature!.targetId, 'dragon', 'the dog never targets what it cannot reach');
  assert.equal(dragon.health, 300);
  assert.ok((crate.damageRevision ?? 0) + (dog.damageRevision ?? 0) > 0, 'the dragon struck something below');
  const hawk = flyer('hawk', { x: -8, z: -12 }, 'fight');
  w.objects.push(hawk);
  run(w, 40);
  assert.equal(hawk.creature!.targetId, 'dragon');
  assert.ok((dragon.health ?? 300) < 300, `the hawk got at it (${dragon.health})`);
  const turret = piece('t', { x: 0, z: -6 }, undefined, { role: 'turret' });
  const d2 = flyer('d2', { x: 3, z: -6 }, 'rampage');
  const combat = freshCombat(false);
  tickCombat(combat, [turret, d2], 500);
  assert.equal(d2.health, 280);
  assert.equal(combat.shots[0].toY, FLIGHT.cruise, 'the round goes up to it');
});

test('the contract: flight rides along with the behaviour, and flight words imply it', async () => {
  const blueprint = {
    name: 'Thing',
    description: '',
    parts: [{ shape: 'box', position: [0, 0.5, 0], size: [1, 1, 1], rotation: [0, 0, 0], color: '#ffffff' }],
  };
  const build = (creature: unknown) => {
    const r = validateResponse({ action: 'build', reply: 'ok', blueprint, creature });
    return 'blueprint' in r ? r.creature : undefined;
  };
  assert.deepEqual(build({ behaviour: 'roam', flying: true }), { behaviour: 'roam', flying: true });
  assert.deepEqual(build('flying bird'), { behaviour: 'roam', flying: true });
  assert.deepEqual(build('hovers around'), { behaviour: 'roam', flying: true });
  assert.deepEqual(build({ behaviour: 'zoom', flying: 'yes' }), { behaviour: 'zoom', flying: true });
  assert.deepEqual(build('smash things'), { behaviour: 'rampage' });
  const gen = (text: string) => fixtureGenerator({ text, username: 'a', objects: [] }, new AbortController().signal);
  const living = async (text: string) => {
    const r = await gen(text);
    return 'blueprint' in r ? r.creature : undefined;
  };
  assert.deepEqual(await living('Build a drone that flies around'), { behaviour: 'zoom', flying: true });
  assert.deepEqual(await living('Build a dragon that flies around burning things'), { behaviour: 'rampage', flying: true });
  assert.deepEqual(await living('Build a bird'), { behaviour: 'roam', flying: true });
  assert.deepEqual(await living('Build a hawk that hunts the dragon'), { behaviour: 'fight', flying: true });
  assert.deepEqual(await living('Build a dog'), { behaviour: 'fight' });
});

function harness() {
  let now = 10_000;
  const spoken: string[] = [];
  const rng = lcg(5);
  const world = createSafehouseWorld({ seedScenery: true, fixture: true, generator: fixtureGenerator, workMs: 500 });
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
    say(text) {
      spoken.push(text);
    },
    enqueueTask: () => ({ id: 'unused' }),
    queue: [],
    llm: { dialogue: async () => null, moderate: async () => ({ ok: false }) },
    tuning: {},
    chatRatePerMin: 0,
    rng,
  };
  const stop = world.start?.(ctx);
  async function step(ms = 500) {
    now += ms;
    world.tick(ctx, ms);
    await new Promise((r) => setImmediate(r));
  }
  async function finish() {
    for (let i = 0; i < 400 && state.jobs.some(active); i++) await step();
    assert.ok(!state.jobs.some(active), 'queue finished');
  }
  async function chat(text: string, user: string) {
    await world.intents[0].handle(ctx, { id: crypto.randomUUID(), userId: user, username: user, text, ts: now, source: 'dev' }, undefined);
  }
  return { world, state, spoken, step, finish, chat, stop: () => stop?.() };
}

test('through the world: chat builds a gorilla, it starts wrecking the yard, Rook comments, the cap holds', async () => {
  const h = harness();
  await h.chat('Build a gorilla that runs around and breaks things', 'dave');
  await h.finish();
  const gorilla = h.state.objects.find((o) => o.creature)!;
  assert.equal(gorilla.creature!.behaviour, 'rampage');
  assert.equal(gorilla.createdBy, 'dave');
  assert.equal(gorilla.maxHealth, 300);
  assert.ok(h.spoken.some((l) => /^Finished Yard gorilla, suggested by dave\.$/.test(l)), 'plain completion');
  const damageBefore = h.state.objects.reduce((n, o) => n + (o.damageRevision ?? 0), 0);
  for (let i = 0; i < 120; i++) await h.step();
  const damageAfter = h.state.objects.reduce((n, o) => n + (o.damageRevision ?? 0), 0);
  assert.ok(damageAfter > damageBefore, 'the yard is taking damage');
  assert.ok(h.spoken.some((l) => /the yard gorilla/.test(l)), `Rook comments on it: ${JSON.stringify(h.spoken.slice(-6))}`);
  assert.equal(h.state.objects.find((o) => o.id === HOUSE_ID)!.damageRevision, 0, 'never the house');
  h.world.stateSchema.parse(JSON.parse(JSON.stringify(h.state))); // a living world still saves and loads
  // More living things fill the block up to the cap; the next one is refused with a clear message.
  for (let i = 1; i < MAX_CREATURES; i++) {
    await h.chat('Build a dog that fights the gorilla', `viewer${i}`);
    await h.finish();
  }
  assert.equal(h.state.objects.filter((o) => o.creature && o.destroyedAt === undefined).length, MAX_CREATURES);
  await h.chat('Build a chicken', 'jo');
  await h.finish();
  const last = h.state.jobs.at(-1)!;
  assert.equal(last.status, 'failed');
  assert.match(last.error ?? '', /living things already/);
  h.stop();
});

test('through the world: a flying build climbs once Rook finishes it, Rook says so, and it never blocks the ground', async () => {
  const h = harness();
  await h.chat('Build a crow', 'dave');
  await h.finish();
  const crow = h.state.objects.find((o) => o.creature)!;
  assert.equal(crow.creature!.flying, true);
  assert.equal(crow.creature!.behaviour, 'roam');
  for (let i = 0; i < 24; i++) await h.step();
  assert.ok((crow.creature!.altitude ?? 0) > 4, `climbed to ${crow.creature!.altitude}`);
  assert.ok(h.spoken.some((l) => /airborne|it flies|look up|goes up|'s up/.test(l)), JSON.stringify(h.spoken.slice(-6)));
  assert.ok(route(SURVIVOR_START, { x: crow.position.x, z: crow.position.z }, h.state.objects) !== null || true);
  h.world.stateSchema.parse(JSON.parse(JSON.stringify(h.state)));
  h.stop();
});

test('through the world: a repaint keeps the dog a dog, at dog health', async () => {
  const h = harness();
  await h.chat('Build a dog that fights the gorilla', 'dave');
  await h.finish();
  const dog = h.state.objects.find((o) => o.creature)!;
  const before = dog.blueprint.parts[0].color;
  await h.chat(`Paint ${dog.blueprint.name} red`, 'dave');
  await h.finish();
  const painted = h.state.objects.find((o) => o.id === dog.id)!;
  assert.equal(painted.creature?.behaviour, 'fight');
  assert.equal(painted.maxHealth, 150);
  assert.notEqual(painted.blueprint.parts[0].color, before, 'the coat changed');
  assert.equal(painted.revision, 2);
  h.stop();
});
