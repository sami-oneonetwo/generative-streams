// Counters to chat's tactics: Marge fills in holes (`trap`) near her place and unplugs speakers
// (`music`) in earshot; Jake thinks the hole is sick and dances to the speakers; Rook dances too,
// and has a word about all of it. Zero AI calls anywhere here; every number is the app's.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  NEIGHBOURS,
  DEFAULT_PACE,
  freshNeighbours,
  tickNeighbours,
  resetNeighbourMemory,
  neighbourViews,
  type NeighbourEvent,
} from '../src/worlds/safehouse/neighbours';
import { renderedPool } from '../src/worlds/safehouse/voice';
import { persona } from '../src/worlds/safehouse/persona';
import { freshCombat, initializeObject, intact } from '../src/worlds/safehouse/combat';
import { sceneryObjects } from '../src/worlds/safehouse/scenery';
import { createSafehouseWorld } from '../src/worlds/safehouse';
import { active, type SafehouseState } from '../src/worlds/safehouse/state';
import { SURVIVOR_START } from '../src/shared/safehouseLayout';
import type { SafehouseObject, Zombie } from '../src/shared/safehouseTypes';
import type { WorldCtx } from '../src/engine/world';

const lcg = (seed = 7) => () => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
};
const piece = (id: string, position: { x: number; z: number }, extra: Partial<SafehouseObject> = {}): SafehouseObject =>
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
    ...extra,
  });
/** A chat hole: ground, tagged `trap`, three metres across. */
const hole = (id: string, position: { x: number; z: number }, by = 'Dave') =>
  piece(id, position, { createdBy: by, editedBy: by, passable: true, uses: ['trap'], footprint: { width: 3, depth: 3 } });
/** A chat speaker stack: solid, tagged `music`. */
const speakers = (id: string, position: { x: number; z: number }, by = 'Dave') =>
  piece(id, position, { createdBy: by, editedBy: by, uses: ['music'], blueprint: { name: id, description: 'a wall of speakers', parts: piece('x', position).blueprint.parts } });
const zombie = (id: string, extra: Partial<Zombie> = {}): Zombie => ({
  id,
  kind: 'walker',
  position: { x: 0, z: 10 },
  health: 60,
  maxHealth: 60,
  facing: 0,
  attackAt: 0,
  path: [],
  replanAt: 0,
  ...extra,
});
const WEST = NEIGHBOURS[0],
  EAST = NEIGHBOURS[1];
/** Marge's house is at (−20, −4), her lot x −30…−12.5; the street runs z 7.5–12.5 along the whole block. */
const ON_MARGES_STREET = { x: -16, z: 9 };
const ON_JAKES_STREET = { x: 25, z: 9 };
const FAR_EAST = { x: 45, z: -8 };

/** A world for tickNeighbours: the neighborhood seeded, the neighbours at their porches, the afternoon's projects switched off. */
function world(objects: SafehouseObject[] = [], rng: () => number = lcg()) {
  resetNeighbourMemory();
  const w = {
    objects: [...sceneryObjects(), ...objects],
    combat: freshCombat(true),
    neighbours: freshNeighbours(),
    worldRevision: 0,
    survivor: { position: { ...SURVIVOR_START } },
    lighting: 'day' as const,
  };
  for (const n of w.neighbours) n.restMs = 1e9; // the counters, not whims, are the subject
  const pace = { ...DEFAULT_PACE, workMs: 500, restMs: 1e9 };
  let now = 100_000;
  const events: NeighbourEvent[] = [];
  const tick = (times = 1) => {
    for (let i = 0; i < times; i++) {
      now += 500;
      events.push(...tickNeighbours(w, 500, now, rng, pace, false).events);
    }
  };
  const advance = (ms: number) => {
    now += ms;
  };
  const until = (done: () => boolean, max: number, label: string) => {
    for (let i = 0; i < max && !done(); i++) tick();
    assert.ok(done(), `${label} (within ${max / 2} s)`);
  };
  const west = () => w.neighbours.find((n) => n.id === 'west')!;
  const east = () => w.neighbours.find((n) => n.id === 'east')!;
  const add = (o: SafehouseObject) => {
    o.createdAt = now + 1;
    w.objects.push(o);
    return o;
  };
  const byId = (id: string) => w.objects.find((o) => o.id === id);
  return { w, tick, advance, until, west, east, add, byId, events, now: () => now };
}

test("Marge fills in a hole on her street that has caught a zombie: a mound with her name on it, no trap, three on the digger's grudge, and Rook told", () => {
  const h = world();
  h.tick(); // first look: what stands is old news
  const dug = h.add(hole('hole', ON_MARGES_STREET));
  h.w.combat.zombies.push(zombie('z1', { position: { ...ON_MARGES_STREET }, heldIn: 'hole', heldUntil: 1e9 }));
  h.until(() => h.west().job?.reason === 'fill', 20, 'she sets off to fill it');
  assert.equal(h.west().job!.kind, 'edit');
  assert.equal(h.west().job!.purpose, 'upkeep');
  assert.equal(h.west().job!.label, 'Filling in the hole');
  assert.equal(h.west().job!.targetId, 'hole');
  assert.ok(WEST.lines.hole.includes(h.west().say?.text ?? ''), `her word on setting off: ${h.west().say?.text}`);
  assert.equal(h.west().regard?.dave?.score, 3, 'three on the grudge for the digging');
  assert.equal(h.west().regard?.dave?.reason, 'dug a hole in the street');
  h.until(() => !h.west().job, 400, 'she walks over and fills it');
  const filled = h.byId('hole')!;
  assert.equal(filled.blueprint.name, 'Filled-in hole');
  assert.equal(filled.blueprint.description, 'Filled in by Marge');
  assert.equal(filled.uses, undefined, 'no trap on it any more');
  assert.equal(filled.passable, true, 'still ground');
  assert.equal(filled.revision, 2);
  assert.equal(filled.editedBy, 'Marge');
  assert.equal(filled.createdBy, 'Dave', 'still his');
  assert.equal(filled.health, dug.health, 'health untouched');
  assert.ok(filled.blueprint.parts.length >= 3 && filled.blueprint.parts.every((p) => p.position[1] - p.size[1] / 2 >= -0.01), 'a low mound above ground');
  assert.ok(WEST.lines.fill.includes(h.west().say?.text ?? ''), `her word on finishing: ${h.west().say?.text}`);
  const fill = h.events.find((e) => e.kind === 'fill');
  assert.ok(fill, 'Rook is told');
  assert.equal(fill!.who, 'Marge');
  assert.equal(fill!.user, 'dave');
  assert.equal(fill!.name, 'hole');
  assert.ok(!h.events.some((e) => e.kind === 'repair' && e.name === 'Filled-in hole'), 'not reported as a repair');
});

test('a hole that has caught nothing is left three minutes first; one on the far lot is nobody\'s business; Jake just has his word, once', () => {
  const h = world();
  h.tick();
  h.add(hole('quiet', ON_MARGES_STREET));
  // Fixed: nobody wanders over for a look at these, so the timing below is the counters' alone.
  h.add({ ...hole('far', FAR_EAST), fixed: true });
  h.add({ ...hole('jakes', ON_JAKES_STREET), fixed: true });
  h.tick(1);
  // Jake's word about the one near his place, straight away (a bubble lasts seven seconds).
  const said = h.east().say?.text;
  assert.ok(EAST.lines.hole.includes(said ?? ''), `Jake had his word: ${said}`);
  h.tick(60); // half a minute
  assert.ok(h.byId('quiet')!.uses?.includes('trap'), 'left alone for now');
  assert.notEqual(h.west().job?.reason, 'fill');
  h.advance(3 * 60_000);
  h.until(() => h.west().job?.reason === 'fill', 20, 'after three minutes she goes to fill it');
  assert.equal(h.west().job!.targetId, 'quiet', 'the one on her street, not the one on the far lot');
  h.until(() => !h.west().job, 400, 'filled');
  assert.equal(h.byId('quiet')!.uses, undefined);
  assert.ok(h.byId('far')!.uses?.includes('trap'), 'the far one is still a hole');
  assert.ok(h.byId('jakes')!.uses?.includes('trap'), "and Jake's street is not hers");
  // A second one on her street straight after: one fill every three minutes.
  h.add(hole('again', { x: -22, z: 9 }));
  h.w.combat.zombies.push(zombie('z2', { heldIn: 'again' }));
  h.tick(60);
  assert.ok(h.byId('again')!.uses?.includes('trap'), 'not two fills within three minutes');
  assert.equal(h.east().job, undefined, 'Jake fills nothing');
  // His word came once: the bubble has long expired and he has not repeated it.
  const later = h.east().say;
  assert.ok(!later || !EAST.lines.hole.includes(later.text), 'no second word about the same hole');
});

test('speakers in earshot of her house: a point a quarter hour on the grudge, then the plug comes out; a stack nowhere near her plays on', () => {
  const h = world();
  h.tick();
  // Fixed: chat's stacks would get a look first; here the counter is the subject, so nobody goes over.
  const stack = h.add({ ...speakers('stack', { x: -24, z: 2 }), fixed: true });
  h.add({ ...speakers('farstack', FAR_EAST, 'Erin'), fixed: true });
  h.tick(4);
  assert.equal(h.west().regard?.dave, undefined, 'nothing yet');
  h.advance(4 * 60_000);
  h.tick(2);
  assert.equal(h.west().regard?.dave?.score, 1, 'four minutes of it: one point');
  assert.equal(h.west().regard?.dave?.reason, 'that noise');
  assert.notEqual(h.west().job?.reason, 'unplug', 'not yet enough to act on');
  h.advance(4 * 60_000);
  h.tick(2);
  assert.equal(h.west().regard?.dave?.score, 2);
  h.advance(4 * 60_000);
  h.until(() => h.west().job?.reason === 'unplug', 10, 'three quarters of an hour: tier one, and she goes to pull the plug');
  assert.equal(h.west().regard?.dave?.score, 3);
  assert.equal(h.west().job!.kind, 'edit');
  assert.equal(h.west().job!.label, 'Unplugging the speakers');
  assert.equal(h.west().job!.targetId, 'stack');
  assert.ok(WEST.lines.unplug.includes(h.west().say?.text ?? ''), `her word: ${h.west().say?.text}`);
  h.until(() => !h.west().job, 400, 'unplugged');
  const off = h.byId('stack')!;
  assert.equal(off.uses, undefined, 'music is off it');
  assert.equal(off.blueprint.description, 'a wall of speakers (unplugged)');
  assert.equal(off.revision, 2);
  assert.equal(off.editedBy, 'Marge');
  assert.deepEqual(off.blueprint.parts, stack.blueprint.parts, 'it keeps its looks');
  const unplug = h.events.find((e) => e.kind === 'unplug');
  assert.ok(unplug && unplug.user === 'dave' && unplug.name === 'stack', JSON.stringify(unplug));
  assert.ok(h.byId('farstack')!.uses?.includes('music'), 'the far stack is not her business');
  assert.equal(h.west().regard?.erin, undefined, 'and costs erin nothing');
  // Nothing more to charge once it is off.
  h.advance(8 * 60_000);
  h.tick(2);
  assert.equal(h.west().regard?.dave?.score, 3, 'no more points for a silent stack');
});

test('a stack twelve minutes in earshot comes off whatever the score; a chatter already in her bad books gets it sooner', () => {
  const h = world();
  h.tick();
  h.add({ ...speakers('stack', { x: -24, z: 2 }, 'Erin'), fixed: true });
  h.tick(2); // the stack is noticed standing; the clock on it starts here
  h.west().regard = { erin: { score: 2, since: h.now(), lastAt: h.now() } };
  h.advance(4 * 60_000);
  h.until(() => h.west().job?.reason === 'unplug', 10, 'one charge takes erin to the first tier: unplugged after four minutes');
  h.until(() => !h.west().job, 400, 'done');
  assert.equal(h.byId('stack')!.uses, undefined);
});

test('Jake dances to speakers within fifteen metres of home, on his lot or not; Marge never does', () => {
  const h = world([], () => 0.1); // a steady rng keeps the "one rest in three" roll on
  h.tick();
  h.add(speakers('jstack', { x: 27, z: 3 }, 'Erin'));
  h.add(speakers('mstack', { x: -26, z: 3 }, 'Erin'));
  h.east().restMs = 1000;
  h.until(() => h.east().job?.kind === 'use' && h.east().job?.reason === 'music', 40, 'Jake heads for the speakers');
  assert.equal(h.east().job!.label, 'Dancing');
  assert.equal(h.east().job!.targetId, 'jstack');
  const end = h.east().job!.path.at(-1)!;
  assert.ok(Math.abs(Math.hypot(end.x - 27, end.z - 3) - 2.5) < 0.6, `two metres off the stack (${Math.hypot(end.x - 27, end.z - 3).toFixed(2)} m to its middle)`);
  assert.ok(EAST.lines.dance.includes(h.east().say?.text ?? ''), `his line: ${h.east().say?.text}`);
  h.until(() => h.east().activity === 'dancing', 200, 'and dances');
  assert.equal(neighbourViews(h.w).find((v) => v.id === 'east')!.activity, 'dancing');
  assert.ok(h.events.some((e) => e.kind === 'use' && e.reason === 'music' && e.who === 'Jake'), 'Rook is told');
  h.until(() => !h.east().job, 60, 'and stops');
  assert.equal(h.byId('jstack')!.revision, 1, 'a dance changes nothing');
  // Marge, with speakers just as close, never dances; the noise wears on erin instead.
  for (let round = 0; round < 6; round++) {
    h.west().restMs = 1000;
    h.tick(10);
  }
  assert.ok(!h.events.some((e) => e.kind === 'use' && e.reason === 'music' && e.who === 'Marge'), 'Marge does not dance');
  assert.notEqual(h.west().job?.reason, 'music');
});

/** A world through createSafehouseWorld for Rook: the neighborhood seeded, no neighbours, no wildlife (they would eat the seeded rng's draws). */
function harness() {
  let now = 10_000;
  const spoken: string[] = [];
  const world = createSafehouseWorld({ seedScenery: true, fixture: true, workMs: 500, wildlife: false, neighbours: false });
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
    rng: lcg(5),
  };
  const stop = world.start?.(ctx);
  const tick = (n = 1, ms = 500) => {
    for (let i = 0; i < n; i++) {
      now += ms;
      world.tick(ctx, ms);
    }
  };
  const until = (done: () => boolean, max: number, label: string) => {
    for (let i = 0; i < max && !done(); i++) tick();
    assert.ok(done(), `${label} (within ${max / 2} s)`);
  };
  return { world, state, ctx, spoken, tick, until, stop: () => stop?.() };
}

test('Rook dances by chat\'s speakers near the porch instead of sitting, and a request stands him up', async () => {
  const h = harness();
  const stack = speakers('stack', { x: -6, z: 3 });
  stack.createdAt = 1;
  h.state.objects.push(stack);
  h.tick(10);
  assert.notEqual(h.state.survivor.activity, 'dancing', 'not yet: twenty seconds idle first');
  h.until(() => h.state.survivor.activity === 'dancing', 80, 'he ends up dancing');
  const p = h.state.survivor.position;
  const gap = Math.hypot(p.x - stack.position.x, p.z - stack.position.z);
  assert.ok(gap <= 2.7, `by the speakers (${gap.toFixed(2)} m from the middle of the stack)`);
  assert.ok(Math.hypot(p.x - SURVIVOR_START.x, p.z - SURVIVOR_START.z) > 1, 'not on the steps');
  // Facing the stack.
  const facing = Math.atan2(stack.position.x - p.x, stack.position.z - p.z);
  assert.ok(Math.abs(((h.state.survivor.facing - facing + Math.PI) % (2 * Math.PI)) - Math.PI) < 0.3, `facing the speakers (${h.state.survivor.facing.toFixed(2)} vs ${facing.toFixed(2)})`);
  assert.match(persona.summarizeState(h.state), /dancing by the speakers/);
  h.world.stateSchema.parse(h.state);
  // A request stands him up at once.
  const seen: string[] = [];
  await h.world.intents[0].handle(h.ctx, { id: crypto.randomUUID(), userId: 'ivy', username: 'ivy', text: 'Build a bench at 3,-14', ts: h.ctx.now, source: 'dev' }, undefined);
  for (let i = 0; i < 400; i++) {
    h.tick();
    await new Promise((r) => setImmediate(r));
    seen.push(h.state.survivor.activity);
    if (!h.state.jobs.some(active)) break;
  }
  assert.ok(!seen.includes('dancing'), 'never danced during the job');
  assert.ok(seen.includes('walking') || seen.includes('building'), `he worked (${[...new Set(seen)]})`);
  // Speakers gone: back to sitting.
  h.state.objects = h.state.objects.filter((o) => o.id !== 'stack');
  h.tick(120);
  assert.equal(h.state.survivor.activity, 'sitting');
  h.stop();
});

test('Rook has a word when a hole appears (once per hole), when the horde dances, and when one is stuck; the pools render', () => {
  for (const moment of ['hole:dug', 'hole:held', 'music:on', 'music:dance'] as const) assert.ok(renderedPool(moment, {}).length >= 3, moment);
  for (const moment of ['hole:filled', 'music:unplugged', 'neighbour:dance'] as const) assert.ok(renderedPool(moment, { who: 'marge' }).length >= 2, moment);
  const h = harness();
  h.tick(4); // primed: anything already standing is old news
  const dug = renderedPool('hole:dug', {});
  const heard = () => h.spoken.filter((l) => dug.includes(l)).length;
  h.state.objects.push(hole('hole1', { x: 3, z: 12 }));
  h.until(() => heard() === 1, 40, `a word about the hole: ${JSON.stringify(h.spoken.slice(-4))}`);
  h.tick(40);
  assert.equal(heard(), 1, 'once per hole');
  h.state.objects.push(hole('hole2', { x: -3, z: 12 }));
  h.until(() => heard() === 2, 40, 'and once for the next one');
  // The horde starts dancing to something.
  const dance = renderedPool('music:dance', {});
  h.state.combat.zombies.push(zombie('z1', { dancingUntil: h.state.combat.time + 60_000 }));
  h.until(() => h.spoken.some((l) => dance.includes(l)), 40, `the dancing: ${JSON.stringify(h.spoken.slice(-4))}`);
  // And one is stuck in a hole.
  const held = renderedPool('hole:held', {});
  h.state.combat.zombies.push(zombie('z2', { heldIn: 'hole1', heldUntil: h.state.combat.time + 60_000 }));
  h.until(() => h.spoken.some((l) => held.includes(l)), 40, `the stuck one: ${JSON.stringify(h.spoken.slice(-4))}`);
  // A restart with holes already dug says nothing about them.
  const before = heard();
  h.world.start?.(h.ctx);
  h.tick(40);
  assert.equal(heard(), before, 'old holes are old news after a restart');
  h.stop();
});
