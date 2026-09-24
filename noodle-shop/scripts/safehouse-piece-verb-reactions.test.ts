// The neighbours' side of a piece's own verb (`!swim` in a pool, `!bounce` on a trampoline, `!sit`
// on a bench — verbs.ts → noteVerb with any word from VERB_WORDS): Marge minds her things being used
// and the splashing within earshot of her house; Jake enjoys it near his place, has a word one time
// in three, and warms to a chatter for it at most once in ten minutes. The three built-in verbs are
// untouched (scripts/safehouse-verb-reactions.test.ts). Zero AI calls; every odd is the app's.
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
import { freshCombat, initializeObject } from '../src/worlds/safehouse/combat';
import { sceneryObjects } from '../src/worlds/safehouse/scenery';
import { SURVIVOR_START } from '../src/shared/safehouseLayout';
import type { PieceVerb, SafehouseObject } from '../src/shared/safehouseTypes';

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
const swim: PieceVerb = { word: 'swim', pose: 'swim', spot: 'on', seconds: 8, pop: 'SPLASH' };
const bounce: PieceVerb = { word: 'bounce', pose: 'jump', spot: 'on', seconds: 8, pop: 'BOING' };
const sit: PieceVerb = { word: 'sit', pose: 'sit', spot: 'on', seconds: 8 };
/** A chat trampoline five metres from Jake's porch (his home is at 23,−0.1). */
const trampoline = () => piece('trampoline', { x: 26, z: 4 }, { createdBy: 'Erin', editedBy: 'Erin', verb: bounce });
/** A bench of Jake's, further than fifteen metres from his home: his by ownership, not by distance. */
const jakesBench = () => piece('neighbour-east-bench', { x: 30, z: -16 }, { owner: 'east', fixed: true, createdBy: 'Jake', editedBy: 'Jake', verb: sit });
/** A chat pool on Marge's lot (x −30…−12.5, z −17.5…4.6). */
const lawnPool = () => piece('lawn-pool', { x: -16, z: 2 }, { createdBy: 'Erin', editedBy: 'Erin', passable: true, verb: swim });
/** A pool on the street in front of Marge's: off her lot, ten metres from her house (at −20,−4). */
const streetPool = () => piece('street-pool', { x: -20, z: 7 }, { createdBy: 'Erin', editedBy: 'Erin', passable: true, verb: swim });
/** A pool thirty metres from Marge's house and eighteen from Jake's home: nobody's business. */
const farPool = () => piece('far-pool', { x: 5, z: 16 }, { createdBy: 'Erin', editedBy: 'Erin', passable: true, verb: swim });
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
  const verb = (word: string, user: string, objectId: string | undefined) => noteVerb(w, word, user, objectId, {}, now);
  return { w, tick, advance, west, east, verb, events, now: () => now };
}

test('a bounce near Jake: a cheer one time in three, warmer by one, and not warmer again inside ten minutes', () => {
  const h = world([trampoline()], () => 0.1); // every odd comes up
  h.tick(); // the tick leaves its rng for noteVerb's odds
  h.verb('bounce', 'Dave', 'trampoline');
  const jake = h.east();
  assert.equal(jake.regard?.dave?.score, -1, 'warmer by one');
  assert.equal(jake.regard?.dave?.reason, 'having fun');
  assert.ok(rendered(EAST.lines.fun, 'dave').includes(jake.say?.text ?? ''), `his word: ${jake.say?.text}`);
  const toward = Math.atan2(26 - jake.position.x, 4 - jake.position.z);
  assert.ok(Math.abs(jake.facing - toward) < 1e-9, 'he turns to look');
  assert.equal(h.west().regard, undefined, 'nothing for Marge: not her lot, not her piece');
  // Two minutes on: the same chatter bounces again. Still a word, no further warmth.
  h.advance(2 * 60_000);
  h.tick();
  assert.equal(h.east().say, undefined, 'the earlier word has cleared');
  h.verb('bounce', 'Dave', 'trampoline');
  assert.equal(h.east().regard?.dave?.score, -1, 'a bounce spam does not make a favourite');
  assert.ok(rendered(EAST.lines.fun, 'dave').includes(h.east().say?.text ?? ''), 'but he still enjoys it');
  // Ten minutes on: warmer again.
  h.advance(10 * 60_000);
  h.tick();
  h.verb('bounce', 'Dave', 'trampoline');
  assert.equal(h.east().regard?.dave?.score, -2);
  // Somebody else in the meantime is their own ten-minute clock.
  h.verb('bounce', 'Erin', 'trampoline');
  assert.equal(h.east().regard?.erin?.score, -1);
  // The odds not coming up: warmer all the same, no word.
  const quiet = world([trampoline()], () => 0.9);
  quiet.tick();
  quiet.verb('bounce', 'Dave', 'trampoline');
  assert.equal(quiet.east().regard?.dave?.score, -1);
  assert.equal(quiet.east().say, undefined);
});

test("a sit on Jake's own bench counts for him wherever it stands; three warm-ups make a favourite", () => {
  const h = world([jakesBench()], () => 0.9);
  h.tick();
  for (let i = 0; i < 3; i++) {
    h.verb('sit', 'Dave', 'neighbour-east-bench');
    h.advance(10 * 60_000 + 1);
    h.tick();
  }
  assert.equal(h.east().regard?.dave?.score, -3);
  assert.ok(h.events.some((e) => e.kind === 'favourite' && e.user === 'dave' && e.id === 'east'), 'Rook is told');
});

test("a swim in a pool on Marge's lot: a point against the swimmer and a word every three minutes at most", () => {
  const h = world([lawnPool()], () => 0.1);
  h.tick();
  h.verb('swim', 'Dave', 'lawn-pool');
  assert.equal(h.west().regard?.dave?.score, 1);
  assert.equal(h.west().regard?.dave?.reason, 'using my things');
  assert.ok(rendered(WEST.lines.mine, 'dave').includes(h.west().say?.text ?? ''), `her word: ${h.west().say?.text}`);
  assert.equal(h.east().regard, undefined, 'forty metres from Jake: nothing from him');
  h.advance(60_000);
  h.tick();
  assert.equal(h.west().say, undefined, 'her word has cleared');
  h.verb('swim', 'Erin', 'lawn-pool');
  assert.equal(h.west().regard?.erin?.score, 1, 'every use counts');
  assert.equal(h.west().say, undefined, 'the word is gated three minutes');
  h.advance(3 * 60_000);
  h.tick();
  h.verb('swim', 'Erin', 'lawn-pool');
  assert.equal(h.west().regard?.erin?.score, 2);
  assert.ok(rendered(WEST.lines.mine, 'erin').includes(h.west().say?.text ?? ''), 'and comes back after the gate');
});

test('splashing ten metres from her house, off her lot: the splash line and nothing on the score; thirty metres away: nothing at all', () => {
  const near = world([streetPool()], () => 0.1);
  near.tick();
  near.verb('swim', 'Dave', 'street-pool');
  assert.equal(near.west().regard, undefined, 'not her pool, not her lot: no grudge');
  assert.ok(rendered(WEST.lines.splash, 'dave').includes(near.west().say?.text ?? ''), `her word: ${near.west().say?.text}`);
  assert.equal(near.east().say, undefined, 'too far for Jake');
  near.advance(60_000);
  near.tick();
  near.verb('swim', 'Dave', 'street-pool');
  assert.equal(near.west().say, undefined, 'gated three minutes');
  near.advance(3 * 60_000);
  near.tick();
  near.verb('swim', 'Dave', 'street-pool');
  assert.ok(rendered(WEST.lines.splash, 'dave').includes(near.west().say?.text ?? ''));
  // A bounce on the street in front of her, off her lot: not her thing, not a splash — nothing.
  const bouncer = world([piece('street-tramp', { x: -20, z: 7 }, { createdBy: 'Erin', editedBy: 'Erin', verb: bounce })], () => 0.1);
  bouncer.tick();
  bouncer.verb('bounce', 'Dave', 'street-tramp');
  assert.equal(bouncer.west().regard, undefined);
  assert.equal(bouncer.west().say, undefined);
  const far = world([farPool()], () => 0.1);
  far.tick();
  far.verb('swim', 'Dave', 'far-pool');
  assert.equal(far.west().regard, undefined);
  assert.equal(far.west().say, undefined);
  assert.equal(far.east().regard, undefined);
  assert.equal(far.east().say, undefined);
});

test('a word for a piece that is gone, or no piece at all, moves nobody', () => {
  const h = world([], () => 0.1);
  h.tick();
  h.verb('swim', 'Dave', 'nothing-here');
  h.verb('swim', 'Dave', undefined);
  assert.equal(h.west().regard, undefined);
  assert.equal(h.east().regard, undefined);
  assert.equal(h.west().say, undefined);
  assert.equal(h.east().say, undefined);
});
