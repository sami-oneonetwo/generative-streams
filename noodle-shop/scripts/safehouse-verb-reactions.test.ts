// The neighbours' side of the chat verbs (verbs.ts → noteVerb): Jake cheers a basket at his hoop and
// warms to the shooter, Marge minds ball games in her garden and horns by her house, `!dance` gets
// Jake up when a tune carries to his place; Rook's summary carries the scoreboard and the admin page
// gets it sorted. Zero AI calls; every odd is the app's, drawn with the world's rng.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  NEIGHBOURS,
  DEFAULT_PACE,
  freshNeighbours,
  tickNeighbours,
  resetNeighbourMemory,
  noteVerb,
  type NeighbourEvent,
} from '../src/worlds/safehouse/neighbours';
import { persona } from '../src/worlds/safehouse/persona';
import { describeHoops, scoreSummary } from '../src/worlds/safehouse/scores';
import { freshCombat, initializeObject } from '../src/worlds/safehouse/combat';
import { sceneryObjects } from '../src/worlds/safehouse/scenery';
import { createSafehouseWorld } from '../src/worlds/safehouse';
import { SURVIVOR_START } from '../src/shared/safehouseLayout';
import type { SafehouseObject } from '../src/shared/safehouseTypes';

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
const WEST = NEIGHBOURS[0],
  EAST = NEIGHBOURS[1];
/** Jake's hoop, on his lot (his home is at 23,−0.1). */
const jakesHoop = () => piece('neighbour-east-hoop', { x: 20.5, z: 1.8 }, { owner: 'east', fixed: true, createdBy: 'Jake', editedBy: 'Jake', uses: ['hoop'] });
/** A chat hoop on Marge's lot (x −30…−12.5, z −17.5…4.6). */
const margesLawnHoop = () => piece('lawn-hoop', { x: -18, z: 2 }, { createdBy: 'Erin', editedBy: 'Erin', uses: ['hoop'] });
const car = (id: string, position: { x: number; z: number }) => piece(id, position, { uses: ['vehicle'], fixed: true });
const speakers = (id: string, position: { x: number; z: number }) => piece(id, position, { createdBy: 'Dave', editedBy: 'Dave', uses: ['music'] });
const rendered = (lines: string[], user: string) => lines.map((l) => l.replace(/\{user\}/g, user));

/** A world for tickNeighbours: the neighborhood seeded, the neighbours at their porches, the afternoon's projects switched off. */
function world(objects: SafehouseObject[] = [], rng: () => number = () => 0.5) {
  resetNeighbourMemory();
  const w = {
    objects: [...sceneryObjects(), ...objects],
    combat: freshCombat(true),
    neighbours: freshNeighbours(),
    worldRevision: 0,
    survivor: { position: { ...SURVIVOR_START } },
    lighting: 'day' as const,
  };
  for (const n of w.neighbours) n.restMs = 1e9;
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
  const west = () => w.neighbours.find((n) => n.id === 'west')!;
  const east = () => w.neighbours.find((n) => n.id === 'east')!;
  const verb = (v: 'shoot' | 'honk' | 'dance', user: string, objectId: string | undefined, detail: { hit?: boolean } = {}) => noteVerb(w, v, user, objectId, detail, now);
  return { w, tick, advance, west, east, verb, events, now: () => now };
}

test("a basket at Jake's hoop warms him to the shooter, turns him to look, and gets a cheer one time in three", () => {
  const cheering = world([jakesHoop()], () => 0.1); // every odd comes up
  cheering.tick(); // the tick leaves its rng for noteVerb's odds
  cheering.verb('shoot', 'Dave', 'neighbour-east-hoop', { hit: true });
  const jake = cheering.east();
  assert.equal(jake.regard?.dave?.score, -1, 'warmer by one');
  assert.equal(jake.regard?.dave?.reason, 'buckets');
  assert.ok(rendered(EAST.lines.cheer, 'dave').includes(jake.say?.text ?? ''), `his cheer: ${jake.say?.text}`);
  const toward = Math.atan2(20.5 - jake.position.x, 1.8 - jake.position.z);
  assert.ok(Math.abs(jake.facing - toward) < 1e-9, 'he turns to the hoop');
  assert.equal(cheering.west().regard, undefined, 'nothing for Marge: not her hoop, not her lot');
  const quiet = world([jakesHoop()], () => 0.9); // the odds do not come up
  quiet.tick();
  quiet.verb('shoot', 'Dave', 'neighbour-east-hoop', { hit: true });
  assert.equal(quiet.east().regard?.dave?.score, -1, 'still warmer');
  assert.equal(quiet.east().say, undefined, 'but no word this time');
});

test('a miss gets a word one time in four and moves nothing', () => {
  const h = world([jakesHoop()], () => 0.1);
  h.tick();
  h.verb('shoot', 'Dave', 'neighbour-east-hoop', { hit: false });
  assert.equal(h.east().regard, undefined, 'a miss earns nothing');
  assert.ok(rendered(EAST.lines.miss, 'dave').includes(h.east().say?.text ?? ''), `his word: ${h.east().say?.text}`);
  const q = world([jakesHoop()], () => 0.5);
  q.tick();
  q.verb('shoot', 'Dave', 'neighbour-east-hoop', { hit: false });
  assert.equal(q.east().say, undefined);
});

test('three baskets make the shooter one of his favourites, said on the next tick', () => {
  const h = world([jakesHoop()], () => 0.9);
  h.tick();
  for (let i = 0; i < 3; i++) h.verb('shoot', 'Dave', 'neighbour-east-hoop', { hit: true });
  assert.equal(h.east().regard?.dave?.score, -3);
  h.tick();
  assert.ok(h.events.some((e) => e.kind === 'favourite' && e.user === 'dave' && e.id === 'east'), 'Rook is told');
  assert.ok(rendered(EAST.lines.favourite, 'dave').includes(h.east().say?.text ?? ''), `his line: ${h.east().say?.text}`);
});

test("a ball game on Marge's lot: a point per basket and a word every three minutes at most", () => {
  const h = world([margesLawnHoop()], () => 0.1);
  h.tick();
  h.verb('shoot', 'Dave', 'lawn-hoop', { hit: true });
  assert.equal(h.west().regard?.dave?.score, 1);
  assert.equal(h.west().regard?.dave?.reason, 'playing ball in my garden');
  assert.ok(rendered(WEST.lines.lawn, 'dave').includes(h.west().say?.text ?? ''), `her word: ${h.west().say?.text}`);
  assert.equal(h.east().regard, undefined, 'forty metres from Jake: nothing from him');
  h.verb('shoot', 'Dave', 'lawn-hoop', { hit: false });
  assert.equal(h.west().regard?.dave?.score, 1, 'a miss costs nothing');
  h.advance(60_000);
  h.tick(); // her earlier word has cleared
  assert.equal(h.west().say, undefined);
  h.verb('shoot', 'Dave', 'lawn-hoop', { hit: true });
  assert.equal(h.west().regard?.dave?.score, 2, 'the second basket counts');
  assert.equal(h.west().say, undefined, 'but the word is gated for three minutes');
  h.advance(3 * 60_000);
  h.tick();
  h.verb('shoot', 'Dave', 'lawn-hoop', { hit: true });
  assert.ok(rendered(WEST.lines.lawn, 'dave').includes(h.west().say?.text ?? ''), 'and comes back after the gate');
});

test("a horn by Marge's house costs a point and a word every two minutes; Jake beeps back near his; far away, nothing", () => {
  const h = world([car('car-near-marge', { x: -18, z: 5 }), car('car-near-jake', { x: 25, z: 5 }), car('car-far', { x: 50, z: 9 })], () => 0.1);
  h.tick();
  h.verb('honk', 'Dave', 'car-near-marge');
  assert.equal(h.west().regard?.dave?.score, 1);
  assert.equal(h.west().regard?.dave?.reason, 'that horn');
  assert.ok(rendered(WEST.lines.horn, 'dave').includes(h.west().say?.text ?? ''), `her word: ${h.west().say?.text}`);
  assert.equal(h.east().say, undefined, 'too far for Jake');
  h.advance(30_000);
  h.tick();
  h.verb('honk', 'Dave', 'car-near-marge');
  assert.equal(h.west().regard?.dave?.score, 2, 'every honk counts');
  assert.equal(h.west().say, undefined, 'the word is gated two minutes');
  h.advance(2 * 60_000);
  h.tick();
  h.verb('honk', 'Dave', 'car-near-marge');
  assert.ok(rendered(WEST.lines.horn, 'dave').includes(h.west().say?.text ?? ''), 'and back after the gate');
  h.advance(10_000);
  h.tick();
  h.verb('honk', 'Erin', 'car-near-jake');
  assert.equal(h.west().regard?.erin, undefined, 'a horn by Jake\'s is nothing to Marge');
  assert.ok(rendered(EAST.lines.horn, 'erin').includes(h.east().say?.text ?? ''), `Jake beeps back: ${h.east().say?.text}`);
  h.advance(10_000);
  h.tick();
  h.verb('honk', 'Fay', 'car-far');
  assert.equal(h.west().regard?.fay, undefined);
  assert.equal(h.east().say, undefined, 'a horn on the far east lot: nobody minds');
});

test('!dance: Jake joins in on the next tick when a tune carries to his place and he is free; not when busy; never Marge', () => {
  const h = world([speakers('stack', { x: 25, z: 4 })], () => 0.9);
  h.tick();
  h.verb('dance', 'Dave', undefined);
  h.tick();
  assert.equal(h.east().job?.reason, 'music', 'Jake gets up');
  assert.equal(h.east().job?.label, 'Dancing');
  assert.ok(h.events.some((e) => e.kind === 'use' && e.reason === 'music' && e.id === 'east'));
  assert.equal(h.west().job, undefined, 'Marge does not dance');
  const job = h.east().job;
  h.verb('dance', 'Erin', undefined);
  h.tick();
  assert.equal(h.east().job, job, 'already dancing: the same job carries on');
  // No tune anywhere: the request is dropped.
  const quiet = world([], () => 0.9);
  quiet.tick();
  quiet.verb('dance', 'Dave', undefined);
  quiet.tick(3);
  assert.equal(quiet.east().job, undefined);
});

test("Rook's summary carries the scoreboard for the last half hour, and the admin rows come sorted", () => {
  const now = 3_600_000;
  const world = createSafehouseWorld({ fixture: true, wildlife: false, neighbours: false });
  const state = world.createInitialState(now);
  state.scores = {
    erin: { shots: 2, hits: 1, streak: 1, best: 1, lastAt: now - 60_000 },
    dave: { shots: 5, hits: 3, streak: 0, best: 2, lastAt: now - 120_000 },
    old: { shots: 9, hits: 9, streak: 9, best: 9, lastAt: now - 31 * 60_000 },
    sam: { shots: 4, hits: 1, streak: 0, best: 1, lastAt: now - 30_000 },
  };
  assert.equal(describeHoops(state, now), 'dave 3/5 (best run 2), erin 1/2, sam 1/4');
  const summary = persona.summarizeState(state, now);
  assert.match(summary, /hoops \(.*!shoot.*\): dave 3\/5 \(best run 2\), erin 1\/2, sam 1\/4\./);
  assert.ok(!summary.includes('old 9/9'), 'half an hour ago is old news');
  assert.deepEqual(
    scoreSummary(state).map((r) => r.user),
    ['old', 'dave', 'erin', 'sam'],
    'baskets first, then fewer shots for the same baskets',
  );
  assert.equal(describeHoops({}, now), undefined);
  assert.deepEqual(scoreSummary({}), []);
});
