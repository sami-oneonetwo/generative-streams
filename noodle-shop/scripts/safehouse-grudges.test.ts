// Grudges and favourites: Marge keeps score against whoever's creatures come for her place and
// whoever meddles with her things, and acts on it in tiers — a cold word, the kerb or a coat of
// beige, then her hunter with their name on it. Jake only ever warms. Gifts are the way back.
// Zero AI calls anywhere here; every number is the app's.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  NEIGHBOURS,
  DEFAULT_PACE,
  freshNeighbours,
  tickNeighbours,
  noteChatEdit,
  forgive,
  regardSummary,
  regardPhrase,
  grudgeTier,
  neighbourViews,
  describeNeighbours,
  resetNeighbourMemory,
  chatter,
  GRUDGE_TIERS,
  GRUDGE_ACT_GAP_MS,
  REGARD_DECAY_MS,
  REGARD_FORGET_MS,
  BEIGE,
  type NeighbourEvent,
  type NeighbourState,
} from '../src/worlds/safehouse/neighbours';
import { freshCombat, initializeObject, intact, damageObject } from '../src/worlds/safehouse/combat';
import { freshCreature, tickCreatures } from '../src/worlds/safehouse/creatures';
import { sceneryObjects } from '../src/worlds/safehouse/scenery';
import { createInitialState, stateSchema, MAX_REGARD } from '../src/worlds/safehouse/state';
import { LANDMARKS, SURVIVOR_START, contains } from '../src/shared/safehouseLayout';
import type { CreatureBehaviour, SafehouseObject } from '../src/shared/safehouseTypes';

const lcg = (seed = 7) => () => {
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
const WEST = NEIGHBOURS[0],
  EAST = NEIGHBOURS[1];
/** Marge's house is at (−20, −4); the street runs z 7.5–12.5 along the whole block. */
const NEAR_MARGE = { x: -24, z: -1 };
const ON_MARGES_STREET = { x: -16, z: 9 };
const ON_JAKES_STREET = { x: 25, z: 9 };

/** A world for tickNeighbours: the neighborhood seeded, the neighbours at their porches, the afternoon's projects switched off. */
function world(objects: SafehouseObject[] = []) {
  resetNeighbourMemory();
  const w = {
    objects: [...sceneryObjects(), ...objects],
    combat: freshCombat(true),
    neighbours: freshNeighbours(),
    worldRevision: 0,
    survivor: { position: { ...SURVIVOR_START } },
    lighting: 'day' as const,
  };
  for (const n of w.neighbours) n.restMs = 1e9; // grudges, not whims, are the subject
  const pace = { ...DEFAULT_PACE, workMs: 500, restMs: 1e9 };
  let now = 100_000;
  const rng = lcg();
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
  /** Tick until something is true; a bubble lasts seven seconds at most, so what they say is read the moment it is said. */
  const until = (done: () => boolean, max: number, label: string) => {
    for (let i = 0; i < max && !done(); i++) tick();
    assert.ok(done(), `${label} (within ${max / 2} s)`);
  };
  const west = () => w.neighbours.find((n) => n.id === 'west')!;
  const east = () => w.neighbours.find((n) => n.id === 'east')!;
  const add = (o: SafehouseObject) => {
    o.createdAt = now + 1; // news, not old news: notice() only sees creations newer than its first look
    w.objects.push(o);
    return o;
  };
  const byId = (id: string) => w.objects.find((o) => o.id === id);
  return { w, tick, advance, until, west, east, add, byId, events, now: () => now, rng };
}
const marges = (id: string, position: { x: number; z: number }, behaviour?: CreatureBehaviour) =>
  piece(id, position, behaviour, { owner: 'west', fixed: true, createdBy: 'Marge', editedBy: 'Marge' });
const chats = (id: string, position: { x: number; z: number }, by: string, behaviour?: CreatureBehaviour, extra: Partial<SafehouseObject> = {}) =>
  piece(id, position, behaviour, { createdBy: by, editedBy: by, ...extra });
const hold = (n: NeighbourState, user: string, score: number, now: number) => {
  n.regard = { ...(n.regard ?? {}), [user]: { score, since: now, lastAt: now } };
};

test('who counts: chatters do, the neighborhood, Rook and the neighbours themselves never', () => {
  assert.equal(chatter('Dave'), 'dave');
  assert.equal(chatter('  ERIN '), 'erin');
  for (const nobody of ['Neighborhood', 'Rook', 'Marge', 'jake', '', undefined]) assert.equal(chatter(nobody), undefined, String(nobody));
  assert.equal(grudgeTier(GRUDGE_TIERS[0]), 1);
  assert.equal(grudgeTier(GRUDGE_TIERS[1]), 2);
  assert.equal(grudgeTier(GRUDGE_TIERS[2]), 3);
  assert.equal(grudgeTier(2), 0);
  assert.equal(WEST.temper, 'grudges');
  assert.equal(EAST.temper, 'favourites');
});

test("a rampager built by dave near Marge's house: the alarm is three, a piece of hers going down three more, the house under 80 % two", () => {
  const h = world([marges('neighbour-west-bench', { x: -18, z: 2 })]);
  h.tick(); // first look
  h.add(chats('g', NEAR_MARGE, 'Dave', 'rampage'));
  h.tick();
  const dave = () => h.west().regard?.dave;
  assert.ok(h.events.some((e) => e.kind === 'alarm' && e.id === 'west'), 'Marge raised the alarm');
  assert.equal(dave()?.score, 3);
  assert.match(dave()!.reason!, /^the g came for the house$/);
  assert.equal(dave()!.since, dave()!.lastAt);
  // Her bench goes down while the thing is about.
  damageObject(h.byId('neighbour-west-bench')!, 1000, 0);
  h.tick();
  assert.equal(dave()?.score, 6, 'a piece of hers knocked down: three more');
  assert.match(dave()!.reason!, /knocked something of theirs down/);
  // The house takes a beating: under 80 % once per episode.
  damageObject(h.byId(WEST.houseId)!, 400, 0);
  h.tick();
  assert.equal(dave()?.score, 8);
  damageObject(h.byId(WEST.houseId)!, 100, 0);
  h.tick();
  assert.equal(dave()?.score, 8, 'once per episode');
  // Jake saw none of it as his business, and never accrues a grudge anyway.
  assert.equal(h.east().regard, undefined);
});

test("nothing accrues for a neighbour's own creature or a piece of the neighborhood; Jake never goes positive", () => {
  const h = world();
  h.tick();
  h.add(chats('rogue', NEAR_MARGE, 'Marge', 'rampage'));
  h.tick(3);
  assert.equal(h.west().regard, undefined, "Marge's own creature is nobody's fault");
  const h2 = world();
  h2.tick();
  h2.add(chats('feral', NEAR_MARGE, 'Neighborhood', 'rampage'));
  h2.tick(3);
  assert.equal(h2.west().regard, undefined);
  const h3 = world();
  h3.tick();
  h3.add(chats('g', { x: 27, z: -1 }, 'Dave', 'rampage')); // by Jake's house at (23, −5)
  h3.tick(3);
  assert.ok(h3.events.some((e) => e.kind === 'alarm' && e.id === 'east'));
  assert.equal(h3.east().regard, undefined, 'Jake holds nothing against anyone');
});

test('decay: a point toward zero every quarter hour since the last change, forgotten after an hour at zero', () => {
  const h = world();
  h.tick();
  hold(h.west(), 'dave', 2, h.now());
  hold(h.east(), 'erin', -2, h.now());
  h.advance(REGARD_DECAY_MS);
  h.tick();
  assert.equal(h.west().regard?.dave.score, 1);
  assert.equal(h.east().regard?.erin.score, -1);
  h.advance(REGARD_DECAY_MS);
  h.tick();
  assert.equal(h.west().regard?.dave.score, 0);
  assert.equal(h.east().regard?.erin.score, 0);
  // Two decay steps put `lastAt` exactly two quarter-hours after the hold; the ticks since add 1.5 s.
  h.advance(REGARD_FORGET_MS - 3000);
  h.tick();
  assert.ok(h.west().regard?.dave, 'still remembered, just');
  h.advance(5000);
  h.tick();
  assert.equal(h.west().regard, undefined, 'forgotten');
  assert.equal(h.east().regard, undefined);
});

test('meddling through chat: paint, move and delete cost; a repair is amends; Jake only notices the amends', () => {
  const h = world([marges('neighbour-west-bench', { x: -18, z: 2 }), piece('neighbour-east-shed', { x: 26, z: -12 }, undefined, { owner: 'east', fixed: true, createdBy: 'Jake' })]);
  h.tick();
  const house = h.byId(WEST.houseId)!;
  const bench = h.byId('neighbour-west-bench')!;
  noteChatEdit(h.w, house, 'Dave', 'paint', h.now());
  assert.equal(h.west().regard?.dave.score, 2);
  assert.equal(h.west().regard?.dave.reason, 'painted the house');
  noteChatEdit(h.w, bench, 'dave', 'move', h.now());
  assert.equal(h.west().regard?.dave.score, 5);
  assert.equal(h.west().regard?.dave.reason, 'moved something of theirs');
  noteChatEdit(h.w, bench, 'DAVE', 'delete', h.now());
  assert.equal(h.west().regard?.dave.score, 10, 'one key however they type it');
  noteChatEdit(h.w, bench, 'dave', 'repair', h.now());
  assert.equal(h.west().regard?.dave.score, 7, 'amends');
  noteChatEdit(h.w, house, 'erin', 'repair', h.now());
  assert.equal(h.west().regard?.erin, undefined, 'nothing to forgive: no entry below zero for Marge');
  const shed = h.byId('neighbour-east-shed')!;
  noteChatEdit(h.w, shed, 'erin', 'paint', h.now());
  assert.equal(h.east().regard, undefined, 'Jake does not mind a repaint');
  noteChatEdit(h.w, shed, 'erin', 'repair', h.now());
  assert.equal(h.east().regard?.erin.score, -1);
  noteChatEdit(h.w, shed, 'Rook', 'repair', h.now());
  assert.equal(Object.keys(h.east().regard!).length, 1, 'Rook is not a chatter');
  // Somebody else's piece is nobody's business.
  noteChatEdit(h.w, piece('stray', { x: 0, z: -14 }), 'dave', 'paint', h.now());
  assert.equal(h.west().regard?.dave.score, 7);
});

test("tier 1: dave's next build gets a cold look and a cold word, and no answering it with something bigger", () => {
  const h = world();
  h.tick();
  hold(h.west(), 'dave', 4, h.now());
  const statue = h.add(chats('statue', ON_MARGES_STREET, 'Dave'));
  h.tick(8);
  const job = h.west().job;
  assert.ok(job && job.kind === 'look' && job.reason === 'grudge' && job.targetId === statue.id, `a cold look: ${JSON.stringify(job)}`);
  assert.ok(h.events.some((e) => e.kind === 'grudge' && e.act === 'remark' && e.user === 'dave' && e.name === 'statue'));
  h.until(() => !h.west().job, 400, 'the look is over');
  const pool = WEST.lines.grudge.map((l) => l.replace(/\{user\}/g, 'dave'));
  assert.ok(h.west().say && pool.includes(h.west().say!.text), `her word: ${h.west().say?.text}`);
  assert.ok(!(h.west().impulses ?? []).some((i) => i.kind === 'rival'), 'no one-up for dave');
  assert.equal(h.west().regard?.dave.acts, undefined, 'a cold word is not an act');
});

test('tier 2: the kerb, then beige four minutes later; never both within the gap; nothing without a piece; nothing while a threat is on', () => {
  const h = world();
  h.tick();
  hold(h.west(), 'dave', 7, h.now());
  const statue = h.add(chats('statue', ON_MARGES_STREET, 'Dave'));
  h.tick(2);
  let job = h.west().job;
  assert.ok(job && job.kind === 'edit' && job.reason === 'grudge' && job.targetId === statue.id && /kerb/.test(job.label), `off to the kerb: ${JSON.stringify(job)}`);
  assert.ok(h.events.some((e) => e.kind === 'grudge' && e.act === 'kerb' && e.user === 'dave' && e.name === 'statue'));
  assert.ok(h.west().say && WEST.lines.kerb.map((l) => l.replace(/\{user\}/g, 'dave')).includes(h.west().say!.text), `said as she sets off: ${h.west().say?.text}`);
  h.until(() => !h.west().job, 400, 'the piece is moved');
  const moved = h.byId('statue')!;
  assert.ok(contains(LANDMARKS['across the street'], moved.position), `on the kerb: ${JSON.stringify(moved.position)}`);
  assert.equal(moved.revision, 2);
  assert.equal(moved.editedBy, 'Marge');
  assert.equal(moved.createdBy, 'Dave', 'still his');
  assert.ok(!h.events.some((e) => e.kind === 'project' && e.id === 'west'), 'Rook heard about the kerb once, not as a project');
  // A second piece within the gap: left alone.
  const duck = h.add(chats('duck', { x: -14, z: 9 }, 'Dave'));
  h.tick(120); // a minute
  assert.equal(duck.revision, 1);
  assert.ok(!h.events.some((e) => e.kind === 'grudge' && e.act === 'beige'));
  // The gap passes: beige.
  h.advance(GRUDGE_ACT_GAP_MS);
  h.tick(2);
  job = h.west().job;
  assert.ok(job && job.kind === 'edit' && job.reason === 'grudge' && job.targetId === duck.id && /Repainting/.test(job.label), `beige next: ${JSON.stringify(job)}`);
  assert.ok(h.west().say && WEST.lines.beige.includes(h.west().say!.text), `and says so: ${h.west().say?.text}`);
  h.until(() => !h.west().job, 400, 'the piece is repainted');
  const beige = h.byId('duck')!;
  assert.ok(beige.blueprint.parts.every((p) => p.color === BEIGE), 'every part beige');
  assert.equal(beige.revision, 2);
  assert.equal(beige.editedBy, 'Marge');
  assert.equal(h.west().regard?.dave.acts, 2);
  // Nothing of his standing: the grudge just sits.
  const h2 = world();
  h2.tick();
  hold(h2.west(), 'dave', 7, h2.now());
  h2.tick(40);
  assert.equal(h2.west().job, undefined);
  assert.ok(!h2.events.some((e) => e.kind === 'grudge'));
  // A creature about: defences first, scores later.
  const h3 = world();
  h3.tick();
  hold(h3.west(), 'dave', 7, h3.now());
  h3.add(chats('statue', ON_MARGES_STREET, 'Dave'));
  h3.add(chats('g', NEAR_MARGE, 'Erin', 'rampage'));
  h3.tick(60);
  assert.ok(!h3.events.some((e) => e.kind === 'grudge' && e.act !== 'remark'), 'no kerb, no beige while the thing is about');
  assert.equal(h3.byId('statue')!.revision, 1);
});

test('tier 3: her hunter gets their name, goes for their creatures first, and drops the name when the score falls', () => {
  const h = world([marges('neighbour-west-hunter', { x: -24, z: 2 }, 'fight')]);
  h.tick();
  hold(h.west(), 'dave', 10, h.now());
  h.tick(2);
  const hunter = h.byId('neighbour-west-hunter')!;
  assert.equal(hunter.creature?.nemesisOwner, 'dave');
  assert.ok(h.events.some((e) => e.kind === 'grudge' && e.act === 'vendetta' && e.user === 'dave'));
  assert.ok(h.west().say && WEST.lines.vendetta.map((l) => l.replace(/\{user\}/g, 'dave')).includes(h.west().say!.text));
  // The chase: dave's harmless chicken and somebody else's rampager, both a few metres off; the chicken first.
  const chicken = chats('chicken', { x: -24, z: 8 }, 'Dave', 'roam');
  const gorilla = chats('gorilla', { x: -30, z: 2 }, 'Erin', 'rampage');
  const arena = { objects: [...h.w.objects, chicken, gorilla], combat: freshCombat(true), survivor: { position: { ...SURVIVOR_START } }, neighbours: h.w.neighbours };
  for (let i = 0; i < 6; i++) tickCreatures(arena, 500, h.rng);
  assert.equal(hunter.creature?.targetId, 'chicken', `the vendetta comes first: ${hunter.creature?.targetId}`);
  for (let i = 0; i < 80; i++) tickCreatures(arena, 500, h.rng);
  assert.ok((chicken.health ?? 60) < 60 || !intact(chicken), 'and it bites');
  // The score slips under the top tier: the name comes off that tick.
  h.west().regard!.dave.score = 9;
  h.tick();
  assert.equal(hunter.creature?.nemesisOwner, undefined);
  // No hunter standing: she builds one for the purpose.
  const h2 = world();
  h2.tick();
  hold(h2.west(), 'dave', 10, h2.now());
  h2.tick(2);
  const job = h2.west().job;
  assert.ok(job && job.kind === 'build' && job.preview?.creature?.behaviour === 'fight', `a hunter goes up: ${JSON.stringify(job?.label)}`);
  assert.equal(job!.preview!.creature!.nemesisOwner, 'dave');
  assert.equal(job!.preview!.blueprint.name, "Marge's dave hunter");
  assert.ok(h2.events.some((e) => e.kind === 'grudge' && e.act === 'vendetta'));
  h2.tick(300);
  const built = h2.byId('neighbour-west-hunter');
  assert.ok(built && built.creature?.nemesisOwner === 'dave' && built.owner === 'west', 'standing, with his name on it');
});

test("a gift: six off with Marge, a look and a grudging thank-you, no one-up; straight into Jake's good books", () => {
  const h = world();
  h.tick();
  hold(h.west(), 'dave', 8, h.now());
  const present = h.add(chats('bench', ON_MARGES_STREET, 'Dave', undefined, { giftTo: 'west' }));
  h.tick(8);
  assert.equal(h.west().regard?.dave.score, 2);
  assert.equal(h.west().regard?.dave.reason, 'built them something');
  const job = h.west().job;
  assert.ok(job && job.kind === 'look' && job.reason === 'gift' && job.targetId === present.id, `over for a look: ${JSON.stringify(job)}`);
  assert.ok(h.events.some((e) => e.kind === 'gift' && e.id === 'west' && e.user === 'dave' && e.name === 'bench'));
  h.until(() => !h.west().job, 400, 'the look is over');
  assert.ok(h.west().say && WEST.lines.gift.map((l) => l.replace(/\{user\}/g, 'dave')).includes(h.west().say!.text), `her thanks: ${h.west().say?.text}`);
  assert.ok(!(h.west().impulses ?? []).some((i) => i.kind === 'rival'), 'a present is never outdone');
  assert.ok(!h.events.some((e) => e.kind === 'grudge'), 'and never a grudge act at two');
  // Jake: three, and a favourite on the spot.
  const h2 = world();
  h2.tick();
  h2.add(chats('hoop', ON_JAKES_STREET, 'Erin', undefined, { giftTo: 'east' }));
  h2.tick(8);
  assert.equal(h2.east().regard?.erin.score, -3);
  assert.equal(h2.events.filter((e) => e.kind === 'favourite' && e.user === 'erin').length, 1);
  assert.ok(h2.events.some((e) => e.kind === 'gift' && e.id === 'east'));
});

test("Jake's favourites: a point for every build he goes over to admire, the event once at three, then always over for theirs", () => {
  const h = world();
  h.tick();
  hold(h.east(), 'erin', -2, h.now());
  // A constant roll under 0.75 so his curiosity never fails the dice.
  const steady = () => 0.1;
  const tickSteady = (times: number) => {
    for (let i = 0; i < times; i++) {
      h.advance(500);
      h.events.push(...tickNeighbours(h.w, 500, h.now(), steady, { ...DEFAULT_PACE, workMs: 500, restMs: 1e9 }, false).events);
    }
  };
  h.add(chats('mural', ON_JAKES_STREET, 'Erin'));
  tickSteady(8);
  assert.ok(h.east().job?.kind === 'look' && h.east().job?.reason === 'visit', `over for a look: ${JSON.stringify(h.east().job)}`);
  for (let i = 0; i < 400 && h.east().job; i++) tickSteady(1);
  assert.equal(h.east().job, undefined, 'the look is over');
  assert.equal(h.east().regard?.erin.score, -3);
  tickSteady(1); // the favourite is said on the tick after the look
  assert.equal(h.events.filter((e) => e.kind === 'favourite' && e.user === 'erin').length, 1, 'once');
  assert.ok(h.east().say && EAST.lines.favourite.map((l) => l.replace(/\{user\}/g, 'erin')).includes(h.east().say!.text), h.east().say?.text);
  h.add(chats('mural-2', { x: 27, z: 9 }, 'Erin'));
  tickSteady(300);
  assert.equal(h.east().regard?.erin.score, -4);
  assert.equal(h.events.filter((e) => e.kind === 'favourite').length, 1, 'not twice');
  assert.equal(h.east().regard?.erin.reason, 'liked something they built');
});

test('views and summaries: the phrase for each tier on the tag, the strongest first for the admin page, and a line for Rook', () => {
  const h = world();
  h.tick();
  assert.equal(neighbourViews(h.w)[0].regard, undefined);
  hold(h.west(), 'dave', 2, h.now());
  assert.equal(neighbourViews(h.w)[0].regard, undefined, 'under the first tier nothing shows');
  hold(h.west(), 'dave', 3, h.now());
  assert.deepEqual(neighbourViews(h.w)[0].regard, { user: 'dave', score: 3, phrase: 'cross with dave' });
  hold(h.west(), 'dave', 6, h.now());
  assert.equal(neighbourViews(h.w)[0].regard?.phrase, 'not speaking to dave');
  hold(h.west(), 'dave', 10, h.now());
  assert.equal(neighbourViews(h.w)[0].regard?.phrase, 'at war with dave');
  hold(h.west(), 'erin', 4, h.now());
  assert.equal(neighbourViews(h.w)[0].regard?.user, 'dave', 'the strongest shows');
  hold(h.east(), 'sam', -3, h.now());
  assert.equal(neighbourViews(h.w)[1].regard?.phrase, 'big fan of sam');
  assert.equal(regardPhrase(WEST, 'x', 1), 'wary of x');
  assert.equal(regardPhrase(EAST, 'x', -1), 'warming to x');
  assert.deepEqual(
    regardSummary(h.w).map((r) => `${r.name}:${r.user}:${r.score}`),
    ['Marge:dave:10', 'Marge:erin:4', 'Jake:sam:-3'],
  );
  h.west().regard!.dave.reason = 'the gorilla came for the house';
  const line = describeNeighbours(h.w);
  assert.match(line, /Marge .*at war with dave \(10\): the gorilla came for the house; cross with erin \(4\)/);
  assert.match(line, /Jake .*big fan of sam \(3\)/);
});

test('forgiveness clears one chatter everywhere, or everyone, and takes the name off the hunter; the save carries it all', () => {
  const h = world([marges('neighbour-west-hunter', { x: -24, z: 2 }, 'fight')]);
  h.tick();
  hold(h.west(), 'dave', 10, h.now());
  hold(h.west(), 'erin', 4, h.now());
  hold(h.east(), 'dave', -3, h.now());
  h.tick(2);
  const hunter = h.byId('neighbour-west-hunter')!;
  assert.equal(hunter.creature?.nemesisOwner, 'dave');
  assert.equal(forgive(h.w, 'Dave'), true);
  assert.equal(h.west().regard?.dave, undefined);
  assert.equal(h.west().regard?.erin.score, 4, 'erin is still in the book');
  assert.equal(h.east().regard, undefined, "Jake's entry went too");
  assert.equal(hunter.creature?.nemesisOwner, undefined);
  assert.equal(forgive(h.w, 'nobody'), false);
  assert.equal(forgive(h.w), true);
  assert.equal(h.west().regard, undefined);
  // The table round-trips through the schema, and only so many are remembered.
  const state = createInitialState();
  state.neighbours[0].regard = { dave: { score: 7, since: 1, lastAt: 2, reason: 'painted the house', acts: 1, lastActAt: 3 } };
  const parsed = stateSchema.parse(state);
  assert.deepEqual(parsed.neighbours[0].regard, state.neighbours[0].regard);
  assert.equal(MAX_REGARD, 60);
  const h2 = world();
  h2.tick();
  for (let i = 0; i < 70; i++) noteChatEdit(h2.w, h2.byId(WEST.houseId)!, `user${i}`, 'paint', h2.now() + i);
  assert.ok(Object.keys(h2.west().regard!).length <= 60, 'the coldest are dropped past the limit');
});
