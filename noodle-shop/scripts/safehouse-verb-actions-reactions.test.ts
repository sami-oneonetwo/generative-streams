// The neighbours' side of the verbs that move things and the scrap (`!drive`, `!ride`, `!fight` —
// verbs.ts → noteVerb; a fight arrives once and is decided once more with `detail.result`): Jake
// calls the fight one time in two, cheers a winner (and warms to them, once in ten minutes), has a
// word for wheels and for a rider; Marge minds a brawl or a drive outside her house, and anyone
// picking on a creature of her own. Zero AI calls; every odd and gate is the app's.
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
import { freshCreature } from '../src/worlds/safehouse/creatures';
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
const fight: PieceVerb = { word: 'fight', pose: 'punch', spot: 'beside', seconds: 5, pop: 'POW' };
const ride: PieceVerb = { word: 'ride', pose: 'sit', spot: 'on', seconds: 12, pop: 'GIDDYUP' };
const drive: PieceVerb = { word: 'drive', pose: 'sit', spot: 'on', seconds: 12, pop: 'VROOM' };
/** A chat gorilla five metres from Jake's porch (his home is at 23,−0.1). */
const jakesGorilla = () => piece('gorilla', { x: 26, z: 4 }, { createdBy: 'Erin', editedBy: 'Erin', creature: freshCreature('roam'), verb: fight });
/** A chat horse in the same spot. */
const jakesHorse = () => piece('horse', { x: 26, z: 4 }, { createdBy: 'Erin', editedBy: 'Erin', creature: freshCreature('roam'), verb: ride });
/** A chat gorilla on the street in front of Marge's, off her lot, ten and a half metres from her house (at −20,−4). */
const streetGorilla = () => piece('street-gorilla', { x: -20, z: 7 }, { createdBy: 'Erin', editedBy: 'Erin', creature: freshCreature('roam'), verb: fight });
/** A gorilla on the street in the middle of the block: twenty-seven metres from Marge's house, nineteen from Jake's home — nobody's business. */
const farGorilla = () => piece('far-gorilla', { x: 5, z: 7 }, { createdBy: 'Erin', editedBy: 'Erin', creature: freshCreature('roam'), verb: fight });
/** Marge's own hunter, on her lot, tagged `fight` by a design. */
const margesHunter = () => piece('neighbour-west-hunter', { x: -16, z: 2 }, { owner: 'west', fixed: true, createdBy: 'Marge', editedBy: 'Marge', creature: freshCreature('fight'), verb: fight });
/** A horse on Marge's lot. */
const lawnHorse = () => piece('lawn-horse', { x: -16, z: 2 }, { createdBy: 'Erin', editedBy: 'Erin', creature: freshCreature('roam'), verb: ride });
/** A car eleven metres from Marge's house, on the road. */
const streetCar = () => piece('street-car', { x: -20, z: 9 }, { createdBy: 'Erin', editedBy: 'Erin', footprint: { width: 2, depth: 4 }, verb: drive });
/** A car thirty metres from Marge's house, eight from Jake's home. */
const jakesCar = () => piece('jakes-car', { x: 24, z: 8 }, { createdBy: 'Erin', editedBy: 'Erin', footprint: { width: 2, depth: 4 }, verb: drive });
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
  const verb = (word: string, user: string, objectId: string | undefined, detail: { result?: 'won' | 'lost' } = {}) =>
    noteVerb(w, word, user, objectId, detail, now);
  /**
   * A little time on, one tick (the tick leaves its rng for noteVerb's odds), and whatever the tick
   * had them say about the creature standing there (a pet, a visit) is cleared: a standing word
   * blocks a new one, and it is the verb's word under test here.
   */
  const settle = (ms = 60_000) => {
    advance(ms);
    tick();
    for (const n of w.neighbours) n.say = undefined;
  };
  return { w, tick, advance, settle, west, east, verb, events, now: () => now };
}

test('a scrap near Jake: he calls it one time in two, a win gets a word and warms him once in ten minutes, a loss gets a word', () => {
  const h = world([jakesGorilla()], () => 0.1); // every odd comes up
  h.tick();
  h.verb('fight', 'Dave', 'gorilla');
  const jake = h.east();
  assert.ok(rendered(EAST.lines.scrap, 'dave').includes(jake.say?.text ?? ''), `his call: ${jake.say?.text}`);
  assert.equal(jake.regard, undefined, 'squaring up warms nobody yet');
  const toward = Math.atan2(26 - jake.position.x, 4 - jake.position.z);
  assert.ok(Math.abs(jake.facing - toward) < 1e-9, 'he turns to watch');
  assert.equal(h.west().regard, undefined, 'forty metres from Marge: nothing from her');
  assert.equal(h.west().say, undefined);
  // The bout is decided: a win.
  h.settle();
  h.verb('fight', 'Dave', 'gorilla', { result: 'won' });
  assert.equal(h.east().regard?.dave?.score, -1, 'warmer by one');
  assert.equal(h.east().regard?.dave?.reason, 'winning a scrap');
  assert.ok(rendered(EAST.lines.scrapWon, 'dave').includes(h.east().say?.text ?? ''), `his cheer: ${h.east().say?.text}`);
  // Two minutes on, another win: a word, no more warmth.
  h.settle(2 * 60_000);
  h.verb('fight', 'Dave', 'gorilla', { result: 'won' });
  assert.equal(h.east().regard?.dave?.score, -1, 'a scrap spam does not make a favourite');
  assert.ok(rendered(EAST.lines.scrapWon, 'dave').includes(h.east().say?.text ?? ''));
  // Ten minutes on: warmer again. Somebody else has their own clock.
  h.settle(10 * 60_000);
  h.verb('fight', 'Dave', 'gorilla', { result: 'won' });
  assert.equal(h.east().regard?.dave?.score, -2);
  h.settle();
  h.verb('fight', 'Erin', 'gorilla', { result: 'won' });
  assert.equal(h.east().regard?.erin?.score, -1);
  // A loss: a word, nothing on the score.
  h.settle();
  h.verb('fight', 'Fay', 'gorilla', { result: 'lost' });
  assert.equal(h.east().regard?.fay, undefined);
  assert.ok(rendered(EAST.lines.scrapLost, 'fay').includes(h.east().say?.text ?? ''), `his commiseration: ${h.east().say?.text}`);
  // The odds not coming up: no call at the start.
  const quiet = world([jakesGorilla()], () => 0.9);
  quiet.tick();
  quiet.verb('fight', 'Dave', 'gorilla');
  assert.equal(quiet.east().say, undefined);
  assert.equal(quiet.east().regard, undefined);
});

test("a brawl on the street outside Marge's: two points against the fighter and a word every three minutes at most; thirty metres off, nothing", () => {
  const h = world([streetGorilla()], () => 0.1);
  h.tick();
  h.verb('fight', 'Dave', 'street-gorilla');
  assert.equal(h.west().regard?.dave?.score, 2);
  assert.equal(h.west().regard?.dave?.reason, 'brawling outside her house');
  assert.ok(rendered(WEST.lines.brawl, 'dave').includes(h.west().say?.text ?? ''), `her word: ${h.west().say?.text}`);
  assert.equal(h.east().regard, undefined, 'too far for Jake');
  assert.equal(h.east().say, undefined);
  h.settle();
  h.verb('fight', 'Erin', 'street-gorilla');
  assert.equal(h.west().regard?.erin?.score, 2, 'every brawl counts');
  assert.equal(h.west().say, undefined, 'the word is gated three minutes');
  h.settle(3 * 60_000);
  h.verb('fight', 'Erin', 'street-gorilla');
  assert.equal(h.west().regard?.erin?.score, 4);
  assert.ok(rendered(WEST.lines.brawl, 'erin').includes(h.west().say?.text ?? ''), 'and comes back after the gate');
  const far = world([farGorilla()], () => 0.1);
  far.tick();
  far.verb('fight', 'Dave', 'far-gorilla');
  assert.equal(far.west().regard, undefined);
  assert.equal(far.west().say, undefined);
  assert.equal(far.east().regard, undefined);
  assert.equal(far.east().say, undefined);
});

test("picking on Marge's own hunter: three points, her own word, and not the brawl's two on top", () => {
  const h = world([margesHunter()], () => 0.1);
  h.tick();
  h.verb('fight', 'Dave', 'neighbour-west-hunter');
  assert.equal(h.west().regard?.dave?.score, 3, 'three, not five');
  assert.equal(h.west().regard?.dave?.reason, 'picking on her hunter');
  assert.ok(rendered(WEST.lines.myDog, 'dave').includes(h.west().say?.text ?? ''), `her word: ${h.west().say?.text}`);
  h.settle();
  h.verb('fight', 'Dave', 'neighbour-west-hunter');
  assert.equal(h.west().regard?.dave?.score, 6);
  assert.equal(h.west().say, undefined, 'gated three minutes');
});

test('a drive: Marge minds a car within twelve metres of her house (a point, gated four minutes), not one thirty metres off; Jake likes the wheels one time in three', () => {
  const h = world([streetCar()], () => 0.1);
  h.tick();
  h.verb('drive', 'Dave', 'street-car');
  assert.equal(h.west().regard?.dave?.score, 1);
  assert.equal(h.west().regard?.dave?.reason, 'boy racers');
  assert.ok(rendered(WEST.lines.racers, 'dave').includes(h.west().say?.text ?? ''), `her word: ${h.west().say?.text}`);
  assert.equal(h.east().say, undefined, 'too far for Jake');
  h.settle(3 * 60_000);
  h.verb('drive', 'Dave', 'street-car');
  assert.equal(h.west().regard?.dave?.score, 2);
  assert.equal(h.west().say, undefined, 'gated four minutes');
  h.settle(60_000 + 1);
  h.verb('drive', 'Dave', 'street-car');
  assert.ok(rendered(WEST.lines.racers, 'dave').includes(h.west().say?.text ?? ''));
  // Jake's end of the street.
  const j = world([jakesCar()], () => 0.1);
  j.tick();
  j.verb('drive', 'Dave', 'jakes-car');
  assert.equal(j.west().regard, undefined, 'thirty metres from Marge: nothing');
  assert.equal(j.west().say, undefined);
  assert.ok(rendered(EAST.lines.wheels, 'dave').includes(j.east().say?.text ?? ''), `his word: ${j.east().say?.text}`);
  assert.equal(j.east().regard, undefined, 'a drive warms nobody');
  const quiet = world([jakesCar()], () => 0.9);
  quiet.tick();
  quiet.verb('drive', 'Dave', 'jakes-car');
  assert.equal(quiet.east().say, undefined);
});

test("a fight's result is not an arrival: no second helping of Marge's points, and a result on any other word moves nobody", () => {
  const h = world([streetGorilla()], () => 0.1);
  h.tick();
  h.verb('fight', 'Dave', 'street-gorilla');
  assert.equal(h.west().regard?.dave?.score, 2);
  h.settle();
  h.verb('fight', 'Dave', 'street-gorilla', { result: 'lost' });
  assert.equal(h.west().regard?.dave?.score, 2, 'the result adds nothing');
  assert.equal(h.west().say, undefined, 'and draws no brawl line');
  h.verb('fight', 'Dave', 'street-gorilla', { result: 'won' });
  assert.equal(h.west().regard?.dave?.score, 2);
  // A stray result on a swim in her pool: nothing at all.
  const pool = world([piece('lawn-pool', { x: -16, z: 2 }, { createdBy: 'Erin', editedBy: 'Erin', passable: true, verb: { word: 'swim', pose: 'swim', spot: 'on', seconds: 8 } })], () => 0.1);
  pool.tick();
  pool.verb('swim', 'Dave', 'lawn-pool', { result: 'won' });
  assert.equal(pool.west().regard, undefined);
  assert.equal(pool.west().say, undefined);
});

test('a ride near Jake: warmer by one and his cowboy word one time in three; a horse on her lot is none of Marge\'s business', () => {
  const h = world([jakesHorse()], () => 0.1);
  h.tick();
  h.verb('ride', 'Dave', 'horse');
  assert.equal(h.east().regard?.dave?.score, -1);
  assert.equal(h.east().regard?.dave?.reason, 'having fun');
  assert.ok(rendered(EAST.lines.yeehaw, 'dave').includes(h.east().say?.text ?? ''), `his word: ${h.east().say?.text}`);
  assert.ok(!rendered(EAST.lines.fun, 'dave').includes(h.east().say?.text ?? ''), 'the rider gets the cowboy line, not the plain one');
  const m = world([lawnHorse()], () => 0.1);
  m.tick();
  m.verb('ride', 'Dave', 'lawn-horse');
  assert.equal(m.west().regard, undefined, 'no point against a rider');
  assert.equal(m.west().say, undefined);
});
