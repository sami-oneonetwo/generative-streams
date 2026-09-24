// The neighbours: Marge to the west, Jake to the east. They keep their own places up, answer
// chat's creatures with barricades, hunters and turrets, and never cost a model call. Jake is
// stoked about everything; Marge answers each thing he builds with a bigger one of the same.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  NEIGHBOURS,
  CATALOGUE,
  catalogueBlueprints,
  tickNeighbours,
  freshNeighbours,
  ownedByNeighbours,
  describeNeighbours,
  vegPatch,
  carProject,
  OWNED_SLOTS,
  NEIGHBOUR_CREATURE_BUDGET,
  HUNTER_HEALTH,
  WHIMS,
  oddity,
  takeWish,
  wishPrompt,
  takeSurvey,
  adoptTheme,
  census,
  signatureOf,
  surveyPrompt,
  yardPiece,
  oneUp,
  adoptNames,
  neighbourViews,
} from '../src/worlds/safehouse/neighbours';
import { renderedPool } from '../src/worlds/safehouse/voice';
import { adoptLife } from '../src/worlds/safehouse/wildlife';
import { fixtureSurveyor, parseSurveyJson, validateSurvey, type Surveyor } from '../src/worlds/safehouse/survey';
import { createSafehouseWorld } from '../src/worlds/safehouse';
import type { DesignGenerator } from '../src/llm/blueprint';
import type { DesignResponse } from '../src/worlds/safehouse/blueprint';
import { createInitialState, migrateState, STATE_VERSION, stateSchema, type SafehouseState } from '../src/worlds/safehouse/state';
import { sceneryObjects } from '../src/worlds/safehouse/scenery';
import { fenceObjects, freshCombat, initializeObject, intact, damageObject, spawnZombie, tickCombat } from '../src/worlds/safehouse/combat';
import { freshCreature, tickCreatures } from '../src/worlds/safehouse/creatures';
import { measureBlueprint, SCENERY_LIMITS } from '../src/worlds/safehouse/blueprint';
import { route } from '../src/worlds/safehouse/placement';
import { pickRepairTarget } from '../src/worlds/safehouse/repair';
import { parseRequest } from '../src/worlds/safehouse/edits';
import { YARD_BOUNDS, SURVIVOR_START, HOUSE_ID, contains, footprint, overlaps } from '../src/shared/safehouseLayout';
import type { CreatureBehaviour, SafehouseObject } from '../src/shared/safehouseTypes';
import type { WorldCtx } from '../src/engine/world';

const lcg = (seed = 7) => () => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
};
const inside = (r: { minX: number; maxX: number; minZ: number; maxZ: number }, within = YARD_BOUNDS) =>
  r.minX >= within.minX && r.maxX <= within.maxX && r.minZ >= within.minZ && r.maxZ <= within.maxZ;
const rectOf = (o: SafehouseObject) => footprint(o.position, o.footprint.width, o.footprint.depth);
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

test('the roster: two neighbours with houses in the scenery, lots inside the block, homes they can walk from', () => {
  assert.equal(NEIGHBOURS.length, 2);
  const scenery = [...sceneryObjects(), ...fenceObjects()];
  for (const spec of NEIGHBOURS) {
    const home = scenery.find((o) => o.id === spec.houseId)!;
    assert.ok(home, `${spec.name}'s house is seeded`);
    assert.ok(inside(spec.lot), `${spec.name}'s lot is inside the block`);
    assert.ok(inside(spec.front, spec.lot) && inside(spec.back, spec.lot), 'front and back yards are on the lot');
    assert.ok(!overlaps(spec.front, rectOf(home)) && !overlaps(spec.back, rectOf(home)), 'the yards are beside the house, not under it');
    assert.ok(contains(spec.lot, spec.home) && !contains(rectOf(home), spec.home), 'home is on the lot and outside the walls');
    assert.ok(route(spec.home, SURVIVOR_START, scenery), `${spec.name} can walk to Rook's porch`);
    assert.ok(route(spec.home, { x: (spec.back.minX + spec.back.maxX) / 2, z: (spec.back.minZ + spec.back.maxZ) / 2 }, scenery), 'and round the back');
    assert.ok(spec.projects.every((key) => CATALOGUE[key]), 'every project on the list is in the catalogue');
    for (const beat of Object.values(spec.lines)) assert.ok(beat.length >= 2, 'every beat has a couple of lines');
  }
  const [west, east] = NEIGHBOURS;
  assert.ok(west.lot.maxX < east.lot.minX, 'the lots do not overlap');
  assert.ok(west.lot.maxX <= -11 && east.lot.minX >= 13, "neither lot reaches into Rook's fenced yard");
});

test('the catalogue: every blueprint fits the neighborhood limits; the vegetables and the car grow by stages', () => {
  const all = catalogueBlueprints();
  assert.ok(all.length >= 18, `${all.length} designs`);
  for (const b of all) {
    assert.ok(b.parts.length >= 1 && b.parts.length <= 60, `${b.name} has a sensible part count (${b.parts.length})`);
    const size = measureBlueprint(b, SCENERY_LIMITS);
    assert.ok(size.width <= 8 && size.depth <= 8, `${b.name} is no bigger than a chat build (${size.width}×${size.depth})`);
  }
  const veg = [0, 1, 2, 3].map((s) => vegPatch(s).length);
  assert.ok(veg[0] < veg[1] && veg[1] < veg[2] && veg[2] < veg[3], `the patch fills in: ${veg.join(' < ')}`);
  const car = [0, 1, 2, 3].map((s) => carProject(s).length);
  assert.ok(car[0] < car[1] && car[1] < car[3], `the car comes together: ${car.join(' → ')}`);
  assert.ok(!carProject(3).some((p) => p.color === '#6d6a60'), 'the finished car is off its blocks');
  assert.ok(Object.keys(WHIMS).length >= 15, 'a decent pile of whims');
  for (const spec of NEIGHBOURS) for (const key of spec.whims) assert.ok(WHIMS[key], `${spec.name}'s whim ${key} exists`);
  // Oddities: never the same twice, always small, always above ground.
  const rng = lcg(21);
  const names = new Set<string>();
  for (let i = 0; i < 40; i++) {
    const odd = oddity(rng, 0xc4402f);
    names.add(odd.name);
    const size = measureBlueprint({ name: odd.name, description: '', parts: odd.parts }, SCENERY_LIMITS);
    assert.ok(size.width <= 2.2 && size.depth <= 2.2, `an oddity stays small (${size.width}×${size.depth})`);
    assert.ok(odd.parts.length >= 4 && odd.parts.length <= 8);
  }
  assert.ok(names.size >= 4, 'they get different names');
});

function harness(
  opts: {
    restMs?: number;
    neighbours?: boolean;
    rng?: () => number;
    ai?: boolean;
    generator?: DesignGenerator;
    aiGapMs?: number;
    surveyor?: Surveyor;
    survey?: boolean;
    surveyGapMs?: number;
  } = {},
) {
  let now = 10_000;
  const spoken: string[] = [];
  const logged: string[] = [];
  const rng = opts.rng ?? lcg();
  const world = createSafehouseWorld({
    seedScenery: true,
    fixture: true,
    workMs: 500,
    wildlife: false, // the neighbours are the subject; the birds would also eat the seeded rng's draws
    neighbours: opts.neighbours,
    neighbourAi: opts.ai,
    generator: opts.generator,
    surveyor: opts.surveyor,
    survey: opts.survey,
    neighbourPace: {
      restMs: opts.restMs ?? 2000,
      ...(opts.aiGapMs !== undefined ? { aiGapMs: opts.aiGapMs } : {}),
      ...(opts.surveyGapMs !== undefined ? { surveyGapMs: opts.surveyGapMs } : {}),
    },
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
    log(line) {
      logged.push(line);
    },
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
  async function until(done: () => boolean, steps: number, label: string) {
    for (let i = 0; i < steps && !done(); i++) await step();
    assert.ok(done(), `${label} (within ${steps / 2} s)`);
  }
  const owned = (id: string) => state.objects.filter((o) => o.owner === id && intact(o));
  const neighbour = (id: string) => state.neighbours.find((n) => n.id === id)!;
  return { world, state, ctx, spoken, logged, step, until, owned, neighbour, stop: () => stop?.() };
}

test('through the world: left alone, both neighbours build things on their own lots, spending nothing of chat\'s', async () => {
  const h = harness();
  await h.until(() => h.owned('west').length >= 3 && h.owned('east').length >= 3, 400, 'three pieces each');
  for (const spec of NEIGHBOURS) {
    for (const o of h.owned(spec.id)) {
      assert.ok(o.fixed, `${o.blueprint.name} is part of the neighborhood`);
      assert.equal(o.createdBy, spec.name);
      assert.ok(o.blueprint.name.startsWith(`${spec.name}'s`), o.blueprint.name);
      assert.ok(inside(rectOf(o), spec.lot), `${o.blueprint.name} stands on ${spec.name}'s lot: ${JSON.stringify(o.position)}`);
      assert.ok(!o.creature, 'peacetime builds do not move');
    }
  }
  assert.equal(h.state.objects.filter((o) => !o.fixed).length, 0, "nothing counts against chat's creation budget");
  assert.equal(h.state.callsRemaining, 20, 'no model calls');
  assert.ok(h.state.jobs.every((j) => j.userId !== 'rook'), 'Rook had nothing to fix');
  assert.match(describeNeighbours(h.state), /Marge \(next door west\) is .*Jake \(next door east\) is /);
  // The vegetables grow once the list is done; the car gets worked on; the house gets a coat.
  const veg = () => h.state.objects.find((o) => o.id === 'neighbour-west-veg')!;
  await h.until(() => veg().revision >= 2, 900, 'the vegetables sprout');
  assert.equal(veg().editedBy, 'Marge');
  assert.ok((h.neighbour('west').stages.veg ?? 0) >= 1);
  assert.ok(veg().blueprint.parts.length > vegPatch(0).length, 'there is something growing in it');
  const car = () => h.state.objects.find((o) => o.id === 'neighbour-east-car')!;
  await h.until(() => car().revision >= 2, 900, 'the car gets wheels');
  await h.until(() => !!h.neighbour('west').paint || !!h.neighbour('east').paint, 900, 'somebody paints their house');
  await h.until(() => NEIGHBOURS.some((s) => h.state.objects.find((o) => o.id === s.houseId)!.editedBy === s.name), 200, 'and the coat goes on');
  const painted = NEIGHBOURS.find((s) => h.neighbour(s.id).paint)!;
  const house = h.state.objects.find((o) => o.id === painted.houseId)!;
  assert.ok(house.blueprint.parts.some((p) => p.color === h.neighbour(painted.id).paint), 'the walls carry the new colour');
  assert.equal(house.editedBy, painted.name);
  for (const s of NEIGHBOURS)
    assert.ok(h.owned(s.id).filter(yardPiece).length <= OWNED_SLOTS, `${s.name} stays within the yard-slot cap`);
  h.world.stateSchema.parse(JSON.parse(JSON.stringify(h.state)));
  assert.ok(h.spoken.length > 0);
  h.stop();
});

test('a rampaging creature near the west house: Marge puts up a barricade, then builds a hunter with the creature as its nemesis', async () => {
  const h = harness({ restMs: 600_000 }); // no peacetime projects to muddy the picture
  const gorilla = piece('gorilla', { x: -27, z: -3 }, 'rampage', { blueprint: { name: 'Yard gorilla', description: '', parts: [{ shape: 'box', position: [0, 0.5, 0], size: [1, 1, 1], rotation: [0, 0, 0], color: '#333333' }] } });
  h.state.objects.push(gorilla);
  await h.until(() => h.neighbour('west').job?.purpose === 'defense', 40, 'Marge answers');
  assert.equal(h.neighbour('west').threat?.id, 'gorilla');
  const gorillaThen = { ...gorilla.position }; // it keeps moving; the barricade goes where it was when she decided
  await h.until(() => h.owned('west').some((o) => o.id.startsWith('neighbour-west-barricade')), 200, 'a barricade goes up');
  const barricade = h.owned('west').find((o) => o.id.startsWith('neighbour-west-barricade'))!;
  assert.equal(barricade.role, 'barrier');
  assert.ok(inside(rectOf(barricade), NEIGHBOURS[0].lot));
  const house = h.state.objects.find((o) => o.id === 'scenery-house-west')!;
  assert.ok(!overlaps(rectOf(barricade), rectOf(house)));
  const d = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z);
  assert.ok(d(barricade.position, gorillaThen) < d(house.position, gorillaThen), `between the house and where the gorilla was: barricade ${JSON.stringify(barricade.position)}, gorilla ${JSON.stringify(gorillaThen)}`);
  await h.until(() => h.owned('west').some((o) => o.id === 'neighbour-west-hunter'), 240, 'then a hunter');
  const hunter = h.owned('west').find((o) => o.id === 'neighbour-west-hunter')!;
  assert.equal(hunter.creature?.behaviour, 'fight');
  assert.equal(hunter.creature?.nemesis, 'gorilla');
  assert.equal(hunter.owner, 'west');
  assert.match(hunter.blueprint.name, /^Marge's gorilla hunter$/);
  await h.until(() => (h.state.objects.find((o) => o.id === 'gorilla')?.health ?? 300) < 300 || !h.state.objects.find((o) => o.id === 'gorilla' && intact(o)), 400, 'the hunter gets at the gorilla');
  assert.ok(h.spoken.some((l) => /marge/.test(l)), `Rook mentioned her: ${JSON.stringify(h.spoken.slice(-8))}`);
  // Down goes the gorilla: after half a minute of quiet she stands down.
  const g = h.state.objects.find((o) => o.id === 'gorilla');
  if (g) damageObject(g, 10_000, h.state.combat.time);
  await h.until(() => !h.neighbour('west').threat, 140, 'Marge stands down');
  h.world.stateSchema.parse(JSON.parse(JSON.stringify(h.state)));
  h.stop();
});

test('a flying menace near the east house: Jake skips the fence and goes straight to a turret', async () => {
  const h = harness({ restMs: 600_000 });
  const dragon = piece('dragon', { x: 30, z: -4 }, 'rampage', { blueprint: { name: 'Yard dragon', description: '', parts: [{ shape: 'box', position: [0, 0.5, 0], size: [1, 1, 1], rotation: [0, 0, 0], color: '#333333' }] } });
  dragon.creature = { ...freshCreature('rampage', true), altitude: 6.5 };
  h.state.objects.push(dragon);
  await h.until(() => h.owned('east').some((o) => o.id === 'neighbour-east-turret'), 200, 'a turret goes up');
  const turret = h.owned('east').find((o) => o.id === 'neighbour-east-turret')!;
  assert.equal(turret.role, 'turret');
  assert.ok(!h.owned('east').some((o) => o.id.startsWith('neighbour-east-barricade')), 'no fence against something that flies');
  assert.ok(!h.owned('east').some((o) => o.id === 'neighbour-east-hunter'), 'no hunter that cannot reach it');
  // The dragon never leaves and nothing of his can reach it: after a few minutes he stops hiding and gets on with it.
  dragon.position = { x: 28, z: 6 }; // hovering over the pavement, out of the turret's reach, still "about"
  h.state.neighbours.find((n) => n.id === 'east')!.restMs = 1000;
  const projectsBefore = h.owned('east').filter((o) => !/turret/.test(o.id)).length;
  for (let i = 0; i < 40; i++) await h.step(); // 20 s: still watching
  assert.equal(h.owned('east').filter((o) => !/turret/.test(o.id)).length, projectsBefore, 'nothing but defenses while it is fresh');
  await h.until(() => h.owned('east').filter((o) => !/turret/.test(o.id)).length > projectsBefore, 700, 'then life goes on under the dragon');
  assert.ok(h.state.objects.some((o) => o.id === 'dragon' && intact(o)), 'with the dragon still up there');
  h.stop();
});

test('their own damage is theirs: Marge repairs her house and rebuilds her things; Rook leaves them to her', async () => {
  const h = harness({ restMs: 600_000 });
  const house = h.state.objects.find((o) => o.id === 'scenery-house-west')!;
  house.health = 600;
  house.damageRevision = 3;
  await h.until(() => h.neighbour('west').job?.kind === 'repair', 40, 'she picks up the hammer');
  assert.equal(h.neighbour('west').activity === 'walking' || h.neighbour('west').activity === 'repairing', true);
  await h.until(() => (h.state.objects.find((o) => o.id === 'scenery-house-west')?.health ?? 0) === 1500, 200, 'the house is whole again');
  assert.ok(h.state.jobs.every((j) => j.userId !== 'rook' || j.resolvedTarget !== 'scenery-house-west'), 'Rook never took that job');
  // A piece of hers knocked flat comes back as a rebuild with the same identity.
  const bench = initializeObject({
    ...piece('neighbour-west-bench', { x: -21.5, z: 2.4 }),
    blueprint: { name: "Marge's bench", description: '', parts: [{ shape: 'box', position: [0, 0.3, 0], size: [1.8, 0.6, 0.5], rotation: [0, 0, 0], color: '#8d7856' }] },
    footprint: { width: 1.8, depth: 0.5 },
    createdBy: 'Marge',
    editedBy: 'Marge',
    fixed: true,
    owner: 'west',
  });
  damageObject(bench, 10_000, h.state.combat.time);
  h.state.objects.push(bench);
  await h.until(() => h.state.objects.some((o) => o.id === 'neighbour-west-bench' && intact(o)), 200, 'the bench is rebuilt');
  const back = h.state.objects.find((o) => o.id === 'neighbour-west-bench')!;
  assert.equal(back.lifecycle, 3);
  assert.equal(back.owner, 'west');
  assert.equal(back.health, back.maxHealth);
  // Rook's own picker skips what is theirs when asked to.
  const hurt = [...h.state.objects];
  hurt.find((o) => o.id === 'scenery-house-east')!.health = 100;
  assert.equal(pickRepairTarget(hurt, [], SURVIVOR_START, (id) => ownedByNeighbours(hurt.find((o) => o.id === id)!)), undefined);
  assert.equal(pickRepairTarget(hurt, [], SURVIVOR_START)?.object.id, 'scenery-house-east', 'without the skip he would');
  h.stop();
});

test('zombies walk past what the neighbours built; the operator can stand them down and let them out', async () => {
  const combat = freshCombat(false);
  const theirs = piece('neighbour-west-barricade-1', { x: -20, z: 8 }, undefined, { role: 'barrier', owner: 'west', fixed: true });
  const z = spawnZombie(combat, 'walker')!;
  z.position = { x: -20, z: 12 };
  for (let i = 0; i < 8; i++) tickCombat(combat, [theirs], 500);
  assert.equal(z.targetId, undefined, 'nothing there worth attacking');
  const ours = piece('barricade', { x: -20, z: 8 }, undefined, { role: 'barrier' });
  z.replanAt = 0;
  for (let i = 0; i < 8; i++) tickCombat(combat, [ours], 500);
  assert.equal(z.targetId, 'barricade', "a chat barricade on the same spot draws it");

  const h = harness();
  h.world.adminActions!.find((a) => a.id === 'safehouse-neighbours-pause')!.run(h.ctx);
  assert.equal(h.state.neighboursPaused, true);
  for (let i = 0; i < 120; i++) await h.step();
  assert.equal(h.owned('west').length + h.owned('east').length, 0, 'nobody builds while stood down');
  // Stood down, their houses are Rook's problem again.
  h.state.objects.find((o) => o.id === 'scenery-house-east')!.health = 200;
  await h.until(() => h.state.jobs.some((j) => j.userId === 'rook' && j.resolvedTarget === 'scenery-house-east'), 60, 'Rook covers for them');
  h.world.adminActions!.find((a) => a.id === 'safehouse-neighbours-resume')!.run(h.ctx);
  await h.until(() => h.owned('west').length + h.owned('east').length > 0, 300, 'back out and building');
  const fresh = h.world.reset!(h.state, 0);
  assert.equal(fresh.neighbours.length, 2);
  h.stop();
});

test('a hunter goes after its nemesis across the block, then stays by its owner rather than by Rook', () => {
  const hunter = piece('hunter', { x: -20, z: 2 }, 'fight', { owner: 'west' });
  hunter.creature!.nemesis = 'g';
  const gorilla = piece('g', { x: 6, z: 14 }, 'rampage');
  const w = { objects: [hunter, gorilla], combat: freshCombat(true), survivor: { position: { ...SURVIVOR_START } }, neighbours: [{ id: 'west', position: { x: -20, z: 0.9 } }] };
  hunter.health = hunter.maxHealth = HUNTER_HEALTH; // built heavy, as the neighbours build them
  const rng = lcg(3);
  for (let i = 0; i < 6; i++) tickCreatures(w, 500, rng);
  assert.equal(hunter.creature!.targetId, 'g', 'well beyond the usual 18 m, it still goes for the one it was built for');
  for (let i = 0; i < 300 && intact(gorilla); i++) tickCreatures(w, 500, rng);
  assert.ok(!intact(gorilla), `it got there and won (gorilla ${gorilla.health}, hunter ${hunter.health})`);
  assert.ok(intact(hunter) && (hunter.health ?? 0) < HUNTER_HEALTH, 'and came out of it hurt but standing');
  for (let i = 0; i < 80; i++) tickCreatures(w, 500, rng);
  assert.equal(hunter.creature!.nemesis, undefined, 'the grudge ends with the gorilla');
  const home = w.neighbours[0].position;
  assert.ok(Math.hypot(hunter.position.x - home.x, hunter.position.z - home.z) <= 4.5, `back by Marge: ${JSON.stringify(hunter.position)}`);
  assert.ok(Math.hypot(hunter.position.x - SURVIVOR_START.x, hunter.position.z - SURVIVOR_START.z) > 8, 'not by Rook');
});

test("chat can talk about their things: \"marge's vegetable patch\" resolves; a rebuild keeps the owner", () => {
  const objects = sceneryObjects();
  const veg = piece('neighbour-west-veg', { x: -20, z: -12 }, undefined, { owner: 'west', fixed: true, createdBy: 'Marge', editedBy: 'Marge' });
  veg.blueprint = { ...veg.blueprint, name: "Marge's vegetable patch" };
  objects.push(veg);
  assert.equal(parseRequest("Paint marge's vegetable patch red", objects).targetId, 'neighbour-west-veg');
  assert.equal(parseRequest('Move the vegetable patch to the park', objects).targetId, 'neighbour-west-veg');
  const which = parseRequest("Paint marge's house pink", objects);
  assert.ok(which.clarification, 'her house is the neighborhood\'s, not one of her builds');
});

test('they notice the block: a chat build gets a visit, night gets a light, a pet gets a kennel, a wave gets sandbags, a fallen house gets a crate', async () => {
  const h = harness({ restMs: 600_000 }); // no idle whims: only reactions
  for (let i = 0; i < 4; i++) await h.step(); // first look: what is already here is old news
  // 1. Chat builds a statue in the front yard: someone wanders over for a look.
  const statue = piece('statue-1', { x: 0, z: 2 }, undefined, { createdBy: 'dave', editedBy: 'dave', createdAt: h.ctx.now + 1 });
  statue.blueprint = { ...statue.blueprint, name: 'Stone duck', description: 'A duck, in stone' };
  h.state.objects.push(statue);
  h.state.worldRevision++;
  await h.until(() => h.state.neighbours.some((n) => n.job?.kind === 'look' && n.job.targetId === 'statue-1'), 40, 'someone heads over to look');
  const looker = h.state.neighbours.find((n) => n.job?.kind === 'look')!;
  assert.match(looker.job!.label, /Having a look at stone duck/);
  await h.until(() => looker.activity === 'looking', 200, 'and stands there looking');
  await h.until(() => !looker.job, 60, 'then wanders off');
  assert.ok(h.logged.some((l) => /neighbours: \w+ — visit \(visit\) — Stone duck/.test(l)), h.logged.filter((l) => /neighbours/.test(l)).join('\n'));
  // 2. Night falls: a light goes up at each house.
  h.state.lighting = 'night';
  await h.until(() => NEIGHBOURS.every((s) => h.owned(s.id).some((o) => o.id === `neighbour-${s.id}-light`)), 300, 'lights at both houses');
  assert.ok(h.owned('west').some((o) => /lantern/.test(o.blueprint.name)) && h.owned('east').some((o) => /fire barrel/.test(o.blueprint.name)));
  // 3. A hen wanders in: somewhere for it.
  const hen = piece('hen', { x: 5, z: 12 }, 'roam', { createdBy: 'erin', editedBy: 'erin' });
  h.state.objects.push(hen);
  await h.until(() => h.owned('west').some((o) => o.id === 'neighbour-west-kennel') || h.owned('east').some((o) => o.id === 'neighbour-east-kennel'), 300, 'a feeder or a kennel');
  // 4. A wave clears: something practical.
  h.state.combat.paused = false;
  h.state.combat.wave.number = 2;
  await h.until(() => h.logged.some((l) => /neighbours: \w+ — project \(fortify\)/.test(l)), 300, 'sandbags, a bell or a lookout');
  const fortified = h.state.objects.filter((o) => o.owner && /sandbags|warning bell|lookout/.test(o.blueprint.name));
  assert.ok(fortified.length >= 1, fortified.map((o) => o.blueprint.name).join(', '));
  assert.ok(fortified.every((o) => /^neighbour-(west|east)-slot-/.test(o.id)), `reactions take a yard slot: ${fortified.map((o) => o.id).join(', ')}`);
  // 5. Rook's house fell: a crate of supplies by his porch.
  h.state.combat.wave.fell = 2;
  await h.until(() => h.state.objects.some((o) => o.owner && o.id.endsWith('-care')), 300, 'a crate for Rook');
  const crate = h.state.objects.find((o) => o.owner && o.id.endsWith('-care'))!;
  assert.match(crate.blueprint.name, /crate of supplies/);
  assert.ok(Math.abs(crate.position.x) < 8 && crate.position.z > -1.5 && crate.position.z < 5, `in Rook's front yard: ${JSON.stringify(crate.position)}`);
  assert.ok(h.logged.some((l) => /neighbours: \w+ — care/.test(l)));
  assert.ok(h.spoken.some((l) => /crate|supplies|dropped something/.test(l)), `Rook noticed: ${JSON.stringify(h.spoken.slice(-6))}`);
  h.world.stateSchema.parse(JSON.parse(JSON.stringify(h.state)));
  h.stop();
});

test('the yard fills to its five and stops: the oldest piece is redone rather than a sixth added', async () => {
  const h = harness({ restMs: 1200 });
  const slots = (id: string) => h.state.objects.filter((o) => o.owner === id && intact(o) && yardPiece(o));
  await h.until(() => NEIGHBOURS.every((s) => slots(s.id).length >= OWNED_SLOTS), 3000, 'both yards fill to the cap');
  // Past the cap the only way to build is to replace: somebody's piece goes to revision 2+.
  await h.until(() => NEIGHBOURS.some((s) => slots(s.id).some((o) => o.revision >= 2)), 3000, 'the oldest gets redone');
  for (const s of NEIGHBOURS) {
    assert.equal(slots(s.id).length, OWNED_SLOTS, `${s.name} keeps exactly ${OWNED_SLOTS} yard pieces`);
    for (const o of slots(s.id)) assert.ok(o.blueprint.name.startsWith(`${s.name}'s`), o.blueprint.name);
  }
  assert.equal(h.state.callsRemaining, 20, 'all of it free');
  assert.equal(h.state.surveyCallsUsed ?? 0, 0, 'and no block readings without a surveyor');
  h.world.stateSchema.parse(JSON.parse(JSON.stringify(h.state)));
  h.stop();
});

test('the cap counts yard pieces only: a barricade and a turret never cost them a slot', async () => {
  const h = harness({ restMs: 1200 });
  const slots = (id: string) => h.state.objects.filter((o) => o.owner === id && intact(o) && yardPiece(o));
  await h.until(() => slots('west').length >= OWNED_SLOTS, 3000, 'Marge fills her yard');
  // A full yard must not stop her answering a rampager: the ladder sits outside the cap.
  const gorilla = piece('gorilla', { x: -27, z: -3 }, 'rampage', { blueprint: { name: 'Yard gorilla', description: '', parts: [{ shape: 'box', position: [0, 0.5, 0], size: [1, 1, 1], rotation: [0, 0, 0], color: '#333333' }] } });
  h.state.objects.push(gorilla);
  await h.until(() => h.state.objects.some((o) => o.owner === 'west' && o.role === 'barrier' && intact(o)), 400, 'a barricade still goes up');
  assert.equal(slots('west').length, OWNED_SLOTS, 'and her five yard pieces are all still there');
  h.world.stateSchema.parse(JSON.parse(JSON.stringify(h.state)));
  h.stop();
});

test('with the model on, an idea goes out as a brief and comes back as a build with their line; off or failing, the catalogue covers it', async () => {
  let calls = 0;
  const design: DesignResponse = {
    action: 'build',
    role: 'decoration',
    reply: 'A gnome. With attitude.',
    blueprint: {
      name: 'Wonky gnome',
      description: 'From the model',
      parts: [
        { shape: 'cylinder', position: [0, 0.3, 0], size: [0.4, 0.6, 0.4], rotation: [0, 0, 0], color: '#5b6b8a' },
        { shape: 'sphere', position: [0, 0.75, 0], size: [0.34, 0.34, 0.34], rotation: [0, 0, 0], color: '#e0c3a0' },
        { shape: 'cone', position: [0, 1.1, 0], size: [0.34, 0.5, 0.34], rotation: [0, 0, 0], color: '#c4402f' },
      ],
    },
  };
  let mode: 'ok' | 'fail' = 'ok';
  const generator: DesignGenerator = async (input) => {
    calls++;
    assert.match(input.text, /wants to build .* (in their own yard|— the same kind of thing|practical)/);
    assert.ok(/Marge|Jake/.test(input.username));
    if (mode === 'fail') throw new Error('model down');
    return design;
  };
  const h = harness({ restMs: 1200, ai: true, generator, aiGapMs: 0 });
  // Their project lists are longer than the yard now, so "the whole list" is unreachable by
  // design: the yards fill to OWNED_SLOTS and everything after that is a replacement.
  await h.until(
    () => NEIGHBOURS.every((s) => h.state.objects.filter((o) => o.owner === s.id && intact(o) && yardPiece(o)).length >= OWNED_SLOTS),
    3000,
    'both yards full',
  );
  await h.until(() => h.state.objects.some((o) => o.owner && /wonky gnome/.test(o.blueprint.name)), 1200, 'a model design goes up');
  assert.ok(calls >= 1);
  const gnome = h.state.objects.find((o) => o.owner && /wonky gnome/.test(o.blueprint.name))!;
  assert.ok(/^neighbour-(west|east)-slot-/.test(gnome.id), `model designs take yard slots too: ${gnome.id}`);
  assert.equal(gnome.blueprint.description, 'From the model');
  assert.ok(h.state.neighbours.some((n) => n.say?.text === 'A gnome. With attitude.') || h.logged.some((l) => /asks the model/.test(l)));
  assert.ok(h.logged.some((l) => /neighbours: (Marge|Jake) asks the model for/.test(l)));
  // The wish and its brief.
  const spec = NEIGHBOURS[0];
  const brief = wishPrompt(spec, { kind: 'whim', idea: 'a fat ceramic toad', at: 0 });
  assert.match(brief, /Marge \(the older gardener/);
  const rivalBrief = wishPrompt(spec, { kind: 'rival', idea: "a bigger and better version of Jake's bird bath", name: "Jake's bird bath", at: 0 });
  assert.match(rivalBrief, /bigger and better version of Jake's bird bath — the same kind of thing as "Jake's bird bath", plainly bigger and grander, to show them up/);
  assert.match(brief, /a fat ceramic toad/);
  assert.match(brief, /never a turret/);
  assert.equal(takeWish({ neighbours: [{ ...h.state.neighbours[0], wish: { kind: 'whim', idea: 'x', at: 0 } }] }, 10_000_000), undefined, 'a stale wish is not asked again');
  // Paused: no calls, but the yard keeps changing from the catalogue.
  h.state.generationPaused = true;
  const before = calls;
  const revisionBefore = h.state.worldRevision;
  for (let i = 0; i < 400; i++) await h.step();
  assert.equal(calls, before, 'no model calls while paused');
  assert.ok(h.state.worldRevision > revisionBefore, 'still building');
  h.state.generationPaused = false;
  // Failing: the idea falls back to the catalogue and nothing gets stuck.
  mode = 'fail';
  const failedBefore = calls;
  await h.until(() => calls > failedBefore, 600, 'another ask');
  await h.until(() => h.state.neighbours.every((n) => !n.wish) && h.logged.some((l) => /neighbour design failed/.test(l)), 200, 'the failure is logged and the wish cleared');
  const revisionAfterFail = h.state.worldRevision;
  await h.until(() => h.state.worldRevision > revisionAfterFail, 400, 'and something still goes up');
  h.world.stateSchema.parse(JSON.parse(JSON.stringify(h.state)));
  h.stop();
});

test('state v8: a v7 world gains the neighbours and nothing else moves; the world and the schema agree', () => {
  assert.equal(STATE_VERSION, 9);
  assert.equal(createSafehouseWorld().meta.stateVersion, STATE_VERSION);
  const fresh = createInitialState();
  fresh.objects = [...sceneryObjects(), ...fenceObjects()];
  const { neighbours: _gone, ...rest } = structuredClone(fresh);
  const v7 = { ...rest, version: 7 } as unknown as Record<string, unknown>;
  const migrated = migrateState(v7, 7);
  assert.equal(migrated.version, STATE_VERSION);
  assert.equal(migrated.neighbours.length, 2);
  assert.deepEqual(migrated.neighbours.map((n) => n.id), ['west', 'east']);
  assert.equal(migrated.objects.length, fresh.objects.length);
  for (const o of fresh.objects) {
    const now = migrated.objects.find((x) => x.id === o.id)!;
    assert.deepEqual(now.position, o.position);
    assert.equal(now.revision, o.revision);
  }
  assert.equal(migrated.objects.find((o) => o.id === 'scenery-house-west')!.blueprint.description, 'Marge lives here');
  assert.equal(migrated.objects.find((o) => o.id === HOUSE_ID)!.blueprint.description, fresh.objects.find((o) => o.id === HOUSE_ID)!.blueprint.description);
  assert.equal(migrated.combat.paused, true);
  stateSchema.parse(migrated);
  assert.deepEqual(freshNeighbours().map((n) => n.activity), ['idle', 'idle']);
});

test('state v9: the yards are capped to five, the surplus is dropped, and defenses are left alone', () => {
  const fresh = createInitialState();
  fresh.objects = [...sceneryObjects(), ...fenceObjects()];
  // A v8 world where Marge has hoarded: eighteen yard pieces, plus a barricade and a turret.
  const hoard = Array.from({ length: 18 }, (_, i) =>
    piece(`neighbour-west-whim-${i}`, { x: -20 + (i % 5) * 0.2, z: -10 + i * 0.2 }, undefined, {
      owner: 'west',
      fixed: true,
      createdBy: 'Marge',
      editedBy: 'Marge',
      createdAt: 1000 + i, // newest last
    }),
  );
  const turret = piece('neighbour-west-turret', { x: -18, z: 3 }, undefined, { owner: 'west', fixed: true, role: 'turret', createdAt: 5 });
  const barricade = piece('neighbour-west-barricade-1-aaaa', { x: -19, z: 3 }, undefined, { owner: 'west', fixed: true, role: 'barrier', createdAt: 5 });
  const pet = piece('neighbour-west-pet-thing', { x: -21, z: -4 }, 'roam', { owner: 'west', fixed: true, createdAt: 5 });
  fresh.objects.push(...hoard, turret, barricade, pet);
  fresh.edits = [{ objectId: 'neighbour-west-whim-0', revision: 1 }];
  fresh.targets = [{ userId: 'u1', objectId: 'neighbour-west-whim-0' }];
  fresh.neighbours[0].impulses = [{ kind: 'whim', idea: 'a gnome', at: 0 }];
  fresh.neighbours[0].whimSeq = 7;
  const v8 = { ...structuredClone(fresh), version: 8 } as unknown as Record<string, unknown>;
  const migrated = migrateState(v8, 8);
  assert.equal(migrated.version, STATE_VERSION);
  const kept = migrated.objects.filter((o) => o.owner === 'west' && yardPiece(o));
  assert.equal(kept.length, OWNED_SLOTS, `five yard pieces kept, not ${kept.length}`);
  // The newest survive; the oldest are gone from objects and from the archive alike.
  assert.deepEqual(
    kept.map((o) => o.id).sort(),
    ['neighbour-west-whim-13', 'neighbour-west-whim-14', 'neighbour-west-whim-15', 'neighbour-west-whim-16', 'neighbour-west-whim-17'],
  );
  assert.equal(migrated.combat.archive.filter((o) => o.owner === 'west').length, 0, 'the surplus is dropped, not archived');
  // Outside the cap and untouched: the ladder, the pet, both houses.
  for (const id of ['neighbour-west-turret', 'neighbour-west-barricade-1-aaaa', 'neighbour-west-pet-thing', 'scenery-house-west'])
    assert.ok(migrated.objects.some((o) => o.id === id), `${id} survives`);
  // References to dropped pieces go with them, and anything in flight is let go.
  assert.deepEqual(migrated.edits, []);
  assert.deepEqual(migrated.targets, []);
  assert.deepEqual(migrated.neighbours[0].impulses, []);
  assert.equal(migrated.neighbours[0].job, undefined);
  assert.equal(migrated.neighbours[0].activity, 'idle');
  // Scenery and the wave clock are not this migration's business.
  const sceneryBefore = [...sceneryObjects(), ...fenceObjects()];
  for (const o of sceneryBefore) {
    const now = migrated.objects.find((x) => x.id === o.id)!;
    assert.deepEqual(now.position, o.position, `${o.id} did not move`);
  }
  assert.equal(migrated.combat.wave.number, fresh.combat.wave.number, 'the wave clock is left running');
  stateSchema.parse(migrated);
});

test('reading the block: the survey is a census of names, and its signature only moves when the street does', async () => {
  const objects = [
    piece('scenery-tree', { x: 5, z: 5 }, undefined, { fixed: true }),
    piece('marges-gnome', { x: -20, z: 1 }, undefined, { owner: 'west', fixed: true }),
    piece('chat-trex', { x: 2, z: 2 }, undefined, { blueprint: { name: 'Angry T-rex', description: 'it stomps', parts: [{ shape: 'box', position: [0, 0.5, 0], size: [1, 1, 1], rotation: [0, 0, 0], color: '#556b2f' }] } }),
    piece('chat-raptor', { x: 4, z: 2 }, 'rampage', { blueprint: { name: 'Raptor', description: '', parts: [{ shape: 'box', position: [0, 0.5, 0], size: [1, 1, 1], rotation: [0, 0, 0], color: '#556b2f' }] } }),
  ];
  const w = { objects, combat: freshCombat(true), neighbours: [], worldRevision: 0, survivor: { position: SURVIVOR_START }, lighting: 'day' as const };
  const c = census(w);
  // Chat's builds only: the scenery and the neighbours' own things are not news about the street.
  assert.deepEqual(c.builds.map((b) => b.name), ['Angry T-rex']);
  assert.deepEqual(c.creatures, [{ name: 'Raptor', behaviour: 'rampage' }]);
  assert.equal(c.lighting, 'day');
  const sig = signatureOf(c);
  assert.equal(sig, signatureOf(census(w)), 'the same street reads the same');
  // Moving or repainting a piece is not news; a new piece is.
  objects[2].position = { x: 9, z: 9 };
  objects[2].revision = 4;
  assert.equal(signatureOf(census(w)), sig, 'a piece being moved does not trigger a reading');
  objects.push(piece('chat-stego', { x: 6, z: 2 }, undefined, { blueprint: { name: 'Stegosaurus', description: '', parts: [{ shape: 'box', position: [0, 0.5, 0], size: [1, 1, 1], rotation: [0, 0, 0], color: '#556b2f' }] } }));
  assert.notEqual(signatureOf(census(w)), sig, 'a new build does');
  // The brief, as a pure function.
  const prompt = surveyPrompt(NEIGHBOURS[0]);
  assert.match(prompt, /Marge is looking over the block/);
  assert.match(prompt, new RegExp(`give ${OWNED_SLOTS} ideas`));
  // The fixture surveyor reads dinosaurs as prehistoric, and an empty street as no change.
  const read = await fixtureSurveyor({ who: 'Marge', persona: 'x', census: c, prompt }, new AbortController().signal);
  assert.equal(read.theme, 'prehistoric');
  assert.equal(read.ideas.length, OWNED_SLOTS);
  // Fixture mode's own generator only builds from a fixed list of animals, so that vocabulary has
  // to read as a theme too or the demo world could never show one changing.
  const zoo = { builds: [{ name: 'Yard gorilla', description: '' }], creatures: [{ name: 'Yard dog', behaviour: 'fight' }], wave: 0, lighting: 'day' as const };
  const zooRead = await fixtureSurveyor({ who: 'Jake', persona: 'x', census: zoo, prompt }, new AbortController().signal);
  assert.equal(zooRead.theme, 'all creatures');
  // An empty street is not a theme: they are told to carry on as they were.
  const quiet = { builds: [], creatures: [], wave: 0, lighting: 'day' as const };
  assert.equal((await fixtureSurveyor({ who: 'Jake', persona: 'x', census: quiet, prompt }, new AbortController().signal)).theme, 'much as it was');
});

test('the survey response is read tolerantly: pieces/things become ideas, control characters go', () => {
  assert.deepEqual(validateSurvey({ theme: 'prehistoric', brief: 'ferns and bones', ideas: ['a fern', 'a bone'] }).ideas, ['a fern', 'a bone']);
  // The shapes the model reaches for instead of ours.
  assert.deepEqual(validateSurvey({ name: 'space age', summary: 'panels', pieces: [{ idea: 'a dish' }, { name: 'a mast' }] }).ideas, ['a dish', 'a mast']);
  assert.equal(validateSurvey({ theme: 'space age', brief: '', things: ['a dish'] }).theme, 'space age');
  assert.throws(() => validateSurvey({ theme: 'x', brief: '', ideas: [] }), 'no ideas is not a theme');
  assert.throws(() => validateSurvey({ brief: '', ideas: ['a dish'] }), 'no theme is not a theme');
  // The fast model answers in a markdown fence through OpenRouter whatever the system prompt and
  // response_format say. The first live readings all died on the backtick before this.
  const body = '{"theme":"prehistoric","brief":"ferns","ideas":["a fern"]}';
  assert.deepEqual(parseSurveyJson('```json\n' + body + '\n```'), JSON.parse(body));
  assert.deepEqual(parseSurveyJson('```\n' + body + '\n```'), JSON.parse(body));
  assert.deepEqual(parseSurveyJson(body), JSON.parse(body));
  assert.deepEqual(parseSurveyJson(`Here you go:\n${body}\nHope that helps.`), JSON.parse(body));
  assert.throws(() => parseSurveyJson('no json here at all'));
});

test('a street full of dinosaurs turns a yard prehistoric, one piece at a time, on its own budget', async () => {
  let surveys = 0;
  const surveyor: Surveyor = async (input) => {
    surveys++;
    // The census reaches the model as names, and the brief is in their own voice.
    assert.match(input.prompt, /looking over the block/);
    assert.ok(/Marge|Jake/.test(input.who));
    return { theme: 'prehistoric', brief: 'ferns, bones and volcanic rock', ideas: ['a fossil dig', 'a giant fern', 'a nest of stone eggs', 'a slab of basalt', 'a cycad in a pot'] };
  };
  const h = harness({ restMs: 1200, surveyor, surveyGapMs: 0 });
  const slots = (id: string) => h.state.objects.filter((o) => o.owner === id && intact(o) && yardPiece(o));
  // Chat fills the street with dinosaurs.
  for (const name of ['Angry T-rex', 'Raptor pack', 'Stegosaurus']) {
    h.state.objects.push(
      piece(`chat-${name.replace(/\W/g, '')}`, { x: 2 + h.state.objects.length * 0.1, z: 2 }, undefined, {
        blueprint: { name, description: '', parts: [{ shape: 'box', position: [0, 0.5, 0], size: [1, 1, 1], rotation: [0, 0, 0], color: '#556b2f' }] },
      }),
    );
  }
  await h.until(() => h.state.neighbours.some((n) => n.theme?.name === 'prehistoric'), 200, 'somebody reads the street');
  assert.ok(surveys >= 1);
  const west = () => h.neighbour('west');
  await h.until(() => !!west().theme, 300, 'Marge adopts it too');
  assert.equal(west().theme!.brief, 'ferns, bones and volcanic rock');
  // The yard converts a piece at a time: never two rethemes queued at once.
  let maxQueued = 0;
  for (let i = 0; i < 1600; i++) {
    await h.step();
    maxQueued = Math.max(maxQueued, (west().impulses ?? []).filter((x) => x.kind === 'retheme').length);
    if (Object.keys(west().themed ?? {}).length >= OWNED_SLOTS) break;
  }
  assert.ok(maxQueued <= 1, `one retheme at a time, saw ${maxQueued}`);
  assert.equal(Object.keys(west().themed ?? {}).length, OWNED_SLOTS, 'the whole yard comes round');
  assert.equal(slots('west').length, OWNED_SLOTS, 'and it is still five pieces');
  assert.ok(h.logged.some((l) => /is having a look at what the street has built/.test(l)));
  assert.ok(h.logged.some((l) => /is redoing the yard — prehistoric/.test(l)));
  // Its own budget: chat's allowance is untouched (and fixture mode books nothing at all).
  assert.equal(h.state.callsRemaining, 20, "chat's allowance is not spent on the neighbours");
  h.world.stateSchema.parse(JSON.parse(JSON.stringify(h.state)));
  h.stop();
});

test('a failing survey leaves the theme alone and the yard still changes from the catalogue', async () => {
  let calls = 0;
  const surveyor: Surveyor = async () => {
    calls++;
    throw new Error('survey down');
  };
  const h = harness({ restMs: 1200, surveyor, surveyGapMs: 0 });
  h.state.objects.push(
    piece('chat-trex', { x: 2, z: 2 }, undefined, {
      blueprint: { name: 'Angry T-rex', description: '', parts: [{ shape: 'box', position: [0, 0.5, 0], size: [1, 1, 1], rotation: [0, 0, 0], color: '#556b2f' }] },
    }),
  );
  await h.until(() => calls >= 1, 300, 'a reading is attempted');
  await h.until(() => h.logged.some((l) => /block reading failed/.test(l)), 100, 'and the failure is logged');
  assert.equal(h.state.neighbours.every((n) => !n.theme), true, 'no theme was adopted');
  // Nothing wedged: the yards still fill from the hand-written catalogue.
  await h.until(
    () => NEIGHBOURS.every((s) => h.state.objects.filter((o) => o.owner === s.id && intact(o) && yardPiece(o)).length >= OWNED_SLOTS),
    3000,
    'the catalogue still fills both yards',
  );
  h.world.stateSchema.parse(JSON.parse(JSON.stringify(h.state)));
  h.stop();
});

test('the operator can stop the readings, and a stale one is never asked twice', async () => {
  let calls = 0;
  const surveyor: Surveyor = async () => {
    calls++;
    return { theme: 'space age', brief: 'panels and antennae', ideas: ['a dish', 'a mast'] };
  };
  const h = harness({ restMs: 600_000, surveyor, surveyGapMs: 0 });
  h.state.surveyPaused = true;
  h.state.objects.push(
    piece('chat-rocket', { x: 2, z: 2 }, undefined, {
      blueprint: { name: 'Rocket', description: '', parts: [{ shape: 'box', position: [0, 0.5, 0], size: [1, 1, 1], rotation: [0, 0, 0], color: '#cccccc' }] },
    }),
  );
  for (let i = 0; i < 60; i++) await h.step();
  assert.equal(calls, 0, 'paused means no readings');
  h.state.surveyPaused = false;
  await h.until(() => calls >= 1, 200, 'and resuming asks');
  // A survey older than the timeout is dropped rather than asked.
  assert.equal(
    takeSurvey(
      { ...h.state, neighbours: [{ ...h.state.neighbours[0], survey: { sig: 'abc', at: 0 } }] },
      10_000_000,
    ),
    undefined,
    'a stale reading is not asked',
  );
  // A theme that comes back the same is not re-adopted, so the plan is not restarted.
  await h.until(() => h.state.neighbours.some((x) => !!x.theme), 100, 'a theme lands');
  const n = h.state.neighbours.find((x) => !!x.theme)!;
  const before = structuredClone(n.theme);
  n.survey = { sig: 'zzz', at: h.ctx.now };
  assert.equal(adoptTheme(h.state, n.id, { theme: n.theme!.name, brief: n.theme!.brief, ideas: ['a dish'] }, h.ctx.now), false);
  assert.deepEqual(n.theme, before, 'the same look is not a change');
  assert.equal(n.surveySig, 'zzz', 'but the reading is recorded so it is not asked again');
  h.stop();
});

test('the neighbours share a creature budget and leave the rest of the yard to chat', async () => {
  const h = harness({ restMs: 600_000 });
  // More creatures than they may own, all theirs.
  for (let i = 0; i < NEIGHBOUR_CREATURE_BUDGET; i++)
    h.state.objects.push(piece(`neighbour-west-beast-${i}`, { x: -22 + i * 0.4, z: -6 }, 'roam', { owner: 'west', fixed: true }));
  const gorilla = piece('gorilla', { x: -27, z: -3 }, 'rampage', { blueprint: { name: 'Yard gorilla', description: '', parts: [{ shape: 'box', position: [0, 0.5, 0], size: [1, 1, 1], rotation: [0, 0, 0], color: '#333333' }] } });
  h.state.objects.push(gorilla);
  // Their budget is full, so the ladder skips the hunter and goes to planks and a gun instead.
  await h.until(() => h.neighbour('west').job?.purpose === 'defense' || (h.neighbour('west').threat?.level ?? 0) > 0, 200, 'Marge still answers');
  for (let i = 0; i < 600; i++) await h.step();
  assert.equal(h.state.objects.some((o) => o.id === 'neighbour-west-hunter'), false, 'no hunter past the creature budget');
  const theirs = h.state.objects.filter((o) => o.owner && o.creature && intact(o)).length;
  assert.ok(theirs <= NEIGHBOUR_CREATURE_BUDGET, `they keep to ${NEIGHBOUR_CREATURE_BUDGET}, saw ${theirs}`);
  h.stop();
});

test('the dynamic: Marge answers a thing Jake built with a bigger one of the same; Jake goes over to admire hers and never competes', async () => {
  const h = harness({ restMs: 600_000, rng: () => 0.5 }); // no idle projects, no dice: only the reactions
  for (let i = 0; i < 4; i++) await h.step(); // first look: what is already here is old news
  const jake = NEIGHBOURS.find((s) => s.id === 'east')!;
  assert.equal(jake.name, 'Jake');
  assert.equal(jake.rival, false);
  assert.equal(NEIGHBOURS.find((s) => s.id === 'west')!.rival, true);
  // Jake's bird bath lands in one of his whim slots, the way his builds do.
  const bath = piece('neighbour-east-whim-1', { x: 23, z: 2.5 }, undefined, { owner: 'east', fixed: true, createdBy: jake.name, editedBy: jake.name, createdAt: h.ctx.now + 1 });
  bath.blueprint = {
    name: `${jake.name}'s bird bath`,
    description: `Built by ${jake.name} next door`,
    parts: [
      { shape: 'cylinder', position: [0, 0.35, 0], size: [0.3, 0.7, 0.3], rotation: [0, 0, 0], color: '#8b8f86' },
      { shape: 'cylinder', position: [0, 0.75, 0], size: [1, 0.1, 1], rotation: [0, 0, 0], color: '#9a9f96' },
    ],
  };
  bath.footprint = measureBlueprint(bath.blueprint, SCENERY_LIMITS);
  h.state.objects.push(bath);
  h.state.worldRevision++;
  await h.until(() => /Pfft|bigger|Cute|Anything he can do|thinks that is good/i.test(h.neighbour('west').say?.text ?? ''), 6, 'Marge sniffs');
  await h.until(() => h.neighbour('west').job?.reason === 'rival', 30, 'and sets out to one-up it');
  await h.until(() => h.owned('west').some((o) => /bird bath/.test(o.blueprint.name)), 200, 'hers goes up');
  const hers = h.owned('west').find((o) => /bird bath/.test(o.blueprint.name))!;
  assert.match(hers.blueprint.name, /^Marge's (bigger|better|deluxe|superior|proper|grander) bird bath$/);
  assert.ok(
    hers.footprint.width > bath.footprint.width * 1.1 && hers.footprint.depth > bath.footprint.depth * 1.1,
    `bigger: ${hers.footprint.width}×${hers.footprint.depth} vs ${bath.footprint.width}×${bath.footprint.depth}`,
  );
  assert.equal(hers.blueprint.parts.length, bath.blueprint.parts.length + 1, 'the same thing, on a plinth');
  assert.ok(hers.blueprint.parts.some((p) => p.color === '#d9b53a'), 'with a gold accent');
  assert.match(hers.blueprint.description, /Bigger than Jake's/);
  assert.ok(/^neighbour-west-slot-/.test(hers.id), `in one of her yard slots: ${hers.id}`);
  assert.ok((hers.maxHealth ?? 0) > (bath.maxHealth ?? 0), 'and tougher');
  assert.ok(h.logged.some((l) => /neighbours: Marge — project \(rival\) — Marge's \w+ bird bath/.test(l)), h.logged.filter((l) => /neighbours/.test(l)).join('\n'));
  // Jake notices hers: over for a look, stoked, and no answer of his own.
  await h.until(() => h.neighbour('east').job?.kind === 'look' && h.neighbour('east').job?.targetId === hers.id, 80, 'Jake wanders over');
  assert.equal(h.neighbour('east').job!.reason, 'admire');
  await h.until(() => !h.neighbour('east').job, 200, 'has his look');
  assert.match(h.neighbour('east').say?.text ?? '', /Marge|massive|bigger|Love|good/);
  for (let i = 0; i < 40; i++) await h.step();
  assert.ok(!(h.neighbour('east').impulses ?? []).some((i) => i.kind === 'rival'), 'Jake never competes');
  assert.ok(!h.logged.some((l) => /neighbours: Jake — project \(rival\)/.test(l)));
  assert.ok(h.logged.some((l) => /neighbours: Jake — visit \(admire\)/.test(l)) && !h.logged.some((l) => /neighbours: Jake — visit \(visit\)/.test(l)), 'a look at hers is not a visit Rook remarks on');
  // Nothing to outdo the shed with: it cannot come out bigger inside the limits, so it is let go.
  const shed = piece('neighbour-east-shed', { x: 25, z: -12 }, undefined, { owner: 'east', fixed: true, role: 'barrier' });
  shed.blueprint = { ...shed.blueprint, parts: [{ shape: 'box', position: [0, 2.5, 0], size: [5.4, 5, 5.4], rotation: [0, 0, 0], color: '#8d7856' }] };
  assert.equal(oneUp(NEIGHBOURS[0], shed, 0), undefined);
  h.world.stateSchema.parse(JSON.parse(JSON.stringify(h.state)));
  h.stop();
});

test('an older save built under the name Dev: at start-up the pieces, the house and the builder take the name Jake', () => {
  const state = createInitialState();
  state.objects = [...sceneryObjects(), ...fenceObjects()];
  const house = state.objects.find((o) => o.id === 'scenery-house-east')!;
  house.blueprint = { ...house.blueprint, description: 'Dev lives here' };
  house.editedBy = 'Dev';
  const car = piece('neighbour-east-car', { x: 23, z: 2 }, undefined, { owner: 'east', fixed: true, createdBy: 'Dev', editedBy: 'Dev' });
  car.blueprint = { ...car.blueprint, name: "Dev's project car", description: 'Built by Dev next door' };
  const ramp = piece('neighbour-east-whim-2', { x: 25, z: -12 }, undefined, { owner: 'east', fixed: true, createdBy: 'Dev', editedBy: 'dave' });
  ramp.blueprint = { ...ramp.blueprint, name: "Dev's skate ramp", description: 'A ramp, in wood' };
  const hers = piece('neighbour-west-bench', { x: -20, z: 2 }, undefined, { owner: 'west', fixed: true, createdBy: 'Marge', editedBy: 'Marge' });
  hers.blueprint = { ...hers.blueprint, name: "Marge's bench" };
  state.objects.push(car, hers);
  state.combat.archive.push(ramp);
  assert.equal(adoptNames(state), true);
  assert.equal(house.blueprint.description, 'Jake lives here');
  assert.equal(house.editedBy, 'Jake');
  assert.equal(car.blueprint.name, "Jake's project car");
  assert.equal(car.blueprint.description, 'Built by Jake next door');
  assert.equal(car.createdBy, 'Jake');
  assert.equal(car.editedBy, 'Jake');
  const archived = state.combat.archive.find((o) => o.id === 'neighbour-east-whim-2')!;
  assert.equal(archived.blueprint.name, "Jake's skate ramp");
  assert.equal(archived.blueprint.description, 'A ramp, in wood', "chat's own description stays");
  assert.equal(archived.editedBy, 'dave', "chat's edit stays");
  assert.equal(hers.blueprint.name, "Marge's bench", 'Marge is untouched');
  assert.equal(adoptNames(state), false, 'idempotent');
  stateSchema.parse(state);
  // Through the world: start() does it, and the ownership grammar follows the new name.
  const fresh = createInitialState();
  fresh.objects = [...sceneryObjects(), ...fenceObjects(), structuredClone({ ...car, blueprint: { ...car.blueprint, name: "Dev's project car" }, createdBy: 'Dev', editedBy: 'Dev' })];
  const world = createSafehouseWorld({ seedScenery: true, fixture: true });
  const ctx: WorldCtx<SafehouseState> = {
    state: fresh,
    now: 10_000,
    checkpoint() {
      world.stateSchema.parse(fresh);
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
  const before = fresh.worldRevision;
  const stop = world.start?.(ctx);
  assert.equal(fresh.objects.find((o) => o.id === 'neighbour-east-car')!.blueprint.name, "Jake's project car");
  assert.equal(fresh.worldRevision, before + 1, 'a snapshot goes out with the new names');
  assert.equal(parseRequest("paint jake's project car red", fresh.objects).targetId, 'neighbour-east-car');
  stop?.();
});

// ---- Slice 2: using what stands on the lot, and noticing the crowd ---------------------------

test('a quiet moment goes on what is already there: Jake shoots hoops, Marge sits on her bench, nothing in the world changes, Rook remarks', async () => {
  // A steady rng keeps the "one rest in three" roll on and the say() picks predictable; no peacetime
  // projects (restMs huge) so the only thing on their afternoon is the hoop and the bench.
  const h = harness({ restMs: 600_000, rng: () => 0.1 });
  assert.deepEqual(CATALOGUE.hoop.uses, ['hoop'], "Jake's catalogue hoop is a hoop to the interpreter");
  const hoop = piece('neighbour-east-hoop', { x: 20.5, z: 1.8 }, undefined, { owner: 'east', fixed: true, createdBy: 'Jake', editedBy: 'Jake', uses: ['hoop'] });
  hoop.blueprint = { ...hoop.blueprint, name: "Jake's basketball hoop" };
  const bench = piece('neighbour-west-bench', { x: -22, z: 2.2 }, undefined, { owner: 'west', fixed: true, createdBy: 'Marge', editedBy: 'Marge', uses: ['seat'] });
  bench.blueprint = { ...bench.blueprint, name: "Marge's bench" };
  h.state.objects.push(hoop, bench);
  for (let i = 0; i < 4; i++) await h.step();
  const jake = h.neighbour('east'),
    marge = h.neighbour('west');
  jake.restMs = 1000; // Marge waits her turn below: Rook remarks on one such moment every few minutes, and the test wants his line on the game
  const eastCount = () => h.state.objects.filter((o) => o.owner === 'east').length;
  const owned = eastCount();
  await h.until(() => jake.job?.kind === 'use' && jake.job.reason === 'hoop', 60, 'Jake heads for the hoop');
  assert.equal(jake.job!.label, 'Shooting hoops');
  assert.equal(jake.job!.targetId, 'neighbour-east-hoop');
  assert.equal(jake.job!.purpose, 'upkeep');
  assert.ok(Math.hypot(jake.job!.path.at(-1)!.x - hoop.position.x, jake.job!.path.at(-1)!.z - hoop.position.z) >= 2.5, 'he stands back from it to throw');
  await h.until(() => jake.activity === 'playing', 200, 'and plays');
  const view = neighbourViews(h.state).find((v) => v.id === 'east')!;
  assert.deepEqual(view.job?.at, hoop.position, 'the page is told where the hoop is');
  assert.equal(view.activity, 'playing');
  assert.ok(h.logged.some((l) => /neighbours: Jake — use \(hoop\) — Jake's basketball hoop/.test(l)), h.logged.filter((l) => /neighbours/.test(l)).join('\n'));
  await h.until(() => !jake.job, 60, 'then he stops');
  assert.equal(eastCount(), owned, 'a game leaves nothing behind');
  assert.equal(h.state.objects.find((o) => o.id === 'neighbour-east-hoop')!.revision, 1, 'and changes nothing');
  assert.ok(jake.restMs > 1000, 'a game counts as the rest');
  // Rook's remark: the reaction waits behind whatever is showing, so give it a few ticks.
  const pool = renderedPool('neighbour:play', { who: 'jake', name: 'basketball hoop' });
  await h.until(() => h.spoken.some((l) => pool.includes(l)), 60, `Rook remarked on the game: ${JSON.stringify(h.spoken.slice(-5))}`);
  // Marge sits down on her bench.
  marge.restMs = 1000;
  await h.until(() => marge.job?.kind === 'use' && marge.job.reason === 'seat', 60, 'Marge heads for the bench');
  assert.equal(marge.job!.label, 'Sitting down');
  await h.until(() => marge.activity === 'sitting', 200, 'and sits');
  assert.deepEqual(neighbourViews(h.state).find((v) => v.id === 'west')!.job?.at, bench.position);
  // A rampager turning up next door gets her off the bench at once.
  const gorilla = piece('gorilla', { x: -27, z: -3 }, 'rampage');
  h.state.objects.push(gorilla);
  await h.until(() => marge.job?.kind !== 'use', 10, 'the sit-down is dropped for the threat');
  assert.equal(marge.threat?.id, 'gorilla');
  h.world.stateSchema.parse(JSON.parse(JSON.stringify(h.state)));
  h.stop();
});

test('the pavement fills up: Jake goes to the front and waves, Marge has a word; once per fill-up, ten minutes apart, never for a crowd that just stays', async () => {
  const h = harness({ restMs: 600_000, rng: () => 0.1 });
  for (let i = 0; i < 4; i++) await h.step(); // first look: what is here is old news
  const member = (i: number) => ({ id: `kick:${i}`, name: `viewer${i}`, since: h.ctx.now, lastAt: h.ctx.now, slot: i, position: { x: i * 1.3, z: 14.6 }, facing: Math.PI });
  const crowdEvents = () => h.logged.filter((l) => /neighbours: Jake — crowd/.test(l)).length;
  h.state.crowd = [member(0), member(1)];
  for (let i = 0; i < 12; i++) await h.step();
  assert.equal(crowdEvents(), 0, 'two people is not a crowd');
  h.state.crowd = [member(0), member(1), member(2)];
  const jake = h.neighbour('east'),
    marge = h.neighbour('west');
  await h.until(() => jake.job?.kind === 'use' && jake.job.reason === 'crowd', 30, 'Jake heads to the front of the lot');
  assert.equal(jake.job!.label, 'Waving at the crowd');
  assert.ok(contains(NEIGHBOURS[1].lot, jake.job!.path.at(-1)!), 'he stays on his own lot');
  assert.ok(jake.job!.path.at(-1)!.z > 3, `at the street edge: ${JSON.stringify(jake.job!.path.at(-1))}`);
  assert.equal(crowdEvents(), 1);
  await h.until(() => jake.activity === 'waving', 200, 'and waves');
  assert.ok(Math.abs(jake.facing) < 0.6, `facing the pavement across the road (${jake.facing.toFixed(2)})`);
  assert.ok(NEIGHBOURS[0].lines.crowd.includes(marge.say?.text ?? ''), `Marge had a word: ${marge.say?.text}`);
  assert.equal(marge.job, undefined, 'and did not move');
  const pool = renderedPool('neighbour:crowd', { who: 'jake' });
  await h.until(() => h.spoken.some((l) => pool.includes(l)), 80, `Rook remarked: ${JSON.stringify(h.spoken.slice(-5))}`);
  // The same crowd stays for a quarter of an hour: nothing more.
  for (let i = 0; i < 15; i++) await h.step(60_000);
  assert.equal(crowdEvents(), 1, 'a steady crowd is old news');
  // It thins out and fills again: another wave.
  h.state.crowd = [member(0)];
  for (let i = 0; i < 4; i++) await h.step();
  h.state.crowd = [member(0), member(1), member(2), member(3)];
  await h.until(() => crowdEvents() === 2, 40, 'a second fill-up gets a second wave');
  // ...but a fill-up straight after that one does not: ten minutes between remarks.
  // He may be over at Marge's by now (the quarter of an hour above ran his rest timer down): the walk back can take a while.
  await h.until(() => !jake.job, 240, `he stops waving (job ${JSON.stringify(jake.job && { ...jake.job, path: jake.job.path.length })}, at ${JSON.stringify(jake.position)}, ${jake.activity})`);
  h.state.crowd = [member(0)];
  for (let i = 0; i < 4; i++) await h.step();
  h.state.crowd = [member(0), member(1), member(2)];
  for (let i = 0; i < 30; i++) await h.step();
  assert.equal(crowdEvents(), 2, 'not twice within ten minutes');
  h.world.stateSchema.parse(JSON.parse(JSON.stringify(h.state)));
  h.stop();
});

test('adoptLife tags an older save\'s hoop for the interpreter, and a hoop never leaves its owner\'s lot', () => {
  const state = createInitialState();
  const hoop = piece('neighbour-east-hoop', { x: 22, z: 2 }, undefined, { owner: 'east', fixed: true });
  hoop.blueprint.name = "Jake's basketball hoop"; // recognised by its catalogue name, not its id
  state.objects = [...sceneryObjects(), ...fenceObjects(), hoop];
  assert.equal(hoop.uses, undefined);
  assert.equal(adoptLife(state), true);
  assert.deepEqual(hoop.uses, ['hoop']);
  assert.equal(adoptLife(state), false, 'idempotent');
  for (const spec of NEIGHBOURS) assert.ok(spec.pastimes.length >= 1 && spec.lines.play.length >= 2 && spec.lines.sit.length >= 2 && spec.lines.crowd.length >= 2);
  assert.ok(NEIGHBOURS[1].pastimes.includes('hoop') && !NEIGHBOURS[0].pastimes.includes('hoop'), 'the hoop is Jake\'s thing');
  assert.ok(NEIGHBOURS[1].greetsCrowd && !NEIGHBOURS[0].greetsCrowd);
});
