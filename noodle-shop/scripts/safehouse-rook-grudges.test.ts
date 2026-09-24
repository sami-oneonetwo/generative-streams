// Rook's own grudges (grudges.ts): whose creatures keep knocking his yard down, how long he holds
// it, and what the sulk looks like — a flat acknowledgement, a grumble on the walk, their things
// last in his repair rounds. Also the gift grammar ("build marge a bench") and the hooks that tell
// a neighbour a chatter touched their piece. The neighbours' own tables are neighbours.ts's.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSafehouseWorld, chatEditKindOf, type SafehouseOptions } from '../src/worlds/safehouse';
import { fixtureGenerator } from '../src/llm/blueprint';
import { GRUDGE, bump, chatterKey, decayTable, describeGrudges, grudgeSummary, rookPhrase, sulking } from '../src/worlds/safehouse/grudges';
import { pickRepairTarget } from '../src/worlds/safehouse/repair';
import { parseRequest, parseGift } from '../src/worlds/safehouse/edits';
import { fenceObjects, initializeObject, intact } from '../src/worlds/safehouse/combat';
import { freshCreature } from '../src/worlds/safehouse/creatures';
import { renderedPool } from '../src/worlds/safehouse/voice';
import { active, MAX_REGARD, type SafehouseState } from '../src/worlds/safehouse/state';
import { LANDMARKS, contains, SURVIVOR_START } from '../src/shared/safehouseLayout';
import type { Regard, SafehouseObject } from '../src/shared/safehouseTypes';
import type { WorldCtx } from '../src/engine/world';

const MIN = 60_000;
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

function harness(options: SafehouseOptions = {}) {
  let now = 10_000;
  const spoken: string[] = [];
  const world = createSafehouseWorld({
    seedScenery: false,
    fixture: false,
    generator: fixtureGenerator,
    workMs: 500,
    converse: false,
    neighbours: false,
    wildlife: false,
    ...options,
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
    log() {},
    say(text) {
      spoken.push(text);
    },
    enqueueTask: () => ({ id: 'unused' }),
    queue: [],
    llm: { dialogue: async () => null, moderate: async () => ({ ok: false }) },
    tuning: {},
    chatRatePerMin: 0,
    rng: () => 0.5,
  };
  const stop = world.start?.(ctx);
  async function step(ms = 2000) {
    now += ms;
    world.tick(ctx, ms);
    await new Promise((r) => setImmediate(r));
  }
  async function finish(ms = 2000) {
    for (let i = 0; i < 200 && state.jobs.some(active); i++) await step(ms);
  }
  async function chat(text: string, user: string) {
    await world.intents[0].handle(
      ctx,
      { id: crypto.randomUUID(), userId: `dev:${user.toLowerCase()}`, username: user, text, ts: now, source: 'dev' },
      undefined,
    );
  }
  const action = (id: string, value?: number | string) => world.adminActions!.find((a) => a.id === id)!.run(ctx, value);
  const advance = (ms: number) => {
    now += ms;
  };
  return { world, state, ctx, spoken, step, finish, chat, action, advance, stop: () => stop?.() };
}
const hold = (score: number, now = 0): Regard => ({ score, since: now, lastAt: now });

test('the arithmetic: a grudge starts on a slight only, stays within 0..20, fades a point a quarter hour and is forgotten', () => {
  const table: Record<string, Regard> = {};
  assert.equal(bump(table, 'Dave', -3, 1000), undefined, 'nothing to forgive yet');
  assert.deepEqual(Object.keys(table), []);
  const entry = bump(table, 'Dave', GRUDGE.knockedDown, 1000, 'the gorilla knocked the fence down')!;
  assert.equal(entry.score, 2);
  assert.equal(entry.reason, 'the gorilla knocked the fence down');
  assert.ok(table.dave === entry, 'keyed lowercased');
  bump(table, 'dave', 99, 2000);
  assert.equal(table.dave.score, GRUDGE.max, 'capped');
  bump(table, 'dave', -99, 3000);
  assert.equal(table.dave.score, 0, 'never below zero');
  table.dave.score = 5;
  table.dave.lastAt = 3000;
  assert.equal(decayTable(table, 3000 + GRUDGE.decayMs * 2 + 10), true);
  assert.equal(table.dave.score, 3, 'two quarter hours: two points off');
  assert.equal(decayTable(table, 3000 + GRUDGE.decayMs * 2 + 20), false, 'nothing more within the same quarter hour');
  decayTable(table, 3000 + GRUDGE.decayMs * 5);
  assert.equal(table.dave.score, 0);
  assert.ok(table.dave, 'a fresh zero is still remembered');
  decayTable(table, 3000 + GRUDGE.decayMs * 5 + GRUDGE.forgetMs);
  assert.equal(table.dave, undefined, 'an hour at zero and it is gone');
  // The table is bounded: the coldest chatters go past the cap.
  const many: Record<string, Regard> = {};
  for (let i = 0; i < MAX_REGARD + 5; i++) bump(many, `user${i}`, 1 + (i % 7), 1000 + i);
  assert.equal(Object.keys(many).length, GRUDGE.remembered);
  assert.equal(GRUDGE.remembered, MAX_REGARD);
  assert.equal(chatterKey('Rook', ['Rook', 'Marge']), undefined);
  assert.equal(chatterKey('marge', ['Rook', 'Marge']), undefined);
  assert.equal(chatterKey('Dave', ['Rook', 'Marge']), 'dave');
  assert.equal(sulking({ dave: hold(GRUDGE.sulkAt) }, 'DAVE'), true);
  assert.equal(sulking({ dave: hold(GRUDGE.sulkAt - 1) }, 'dave'), false);
  assert.equal(rookPhrase(4), 'a bit off with');
  assert.equal(rookPhrase(9), 'properly annoyed at');
  assert.equal(rookPhrase(15), 'done with');
  assert.match(describeGrudges({ grudges: { dave: { ...hold(7), reason: 'the gorilla knocked the fence down' } } })!, /a bit off with dave \(7\): the gorilla knocked the fence down/);
  assert.equal(describeGrudges({ grudges: { dave: hold(2) } }), undefined, 'a scratch is not a sulk');
  assert.deepEqual(grudgeSummary({ grudges: { a: hold(2), b: hold(9) } }).map((g) => g.user), ['b', 'a']);
});

test("dave's gorilla knocks the fence down: two points against dave, with the reason; a neighbour's hunter counts for nothing", async () => {
  const h = harness();
  const fence = fenceObjects()[0];
  fence.health = 10;
  const gorilla = piece('gorilla', { x: fence.position.x, z: fence.position.z + fence.footprint.depth / 2 + 0.9 }, {
    createdBy: 'Dave',
    editedBy: 'Dave',
    creature: freshCreature('rampage'),
  });
  gorilla.blueprint.name = 'Yard gorilla';
  h.state.objects.push(fence, gorilla);
  for (let i = 0; i < 10 && intact(h.state.objects.find((o) => o.id === fence.id)!); i++) await h.step(500);
  assert.ok(!intact(h.state.objects.find((o) => o.id === fence.id)!), 'the fence fell');
  assert.equal(h.state.grudges?.dave?.score, GRUDGE.knockedDown);
  assert.equal(h.state.grudges?.dave?.reason, 'the yard gorilla knocked the fence down');
  h.world.stateSchema.parse(JSON.parse(JSON.stringify(h.state)));
  // A hunter Marge built is nobody in chat: its damage lands on no table.
  const h2 = harness();
  const fence2 = fenceObjects()[1];
  fence2.health = 10;
  const hunter = piece('hunter', { x: fence2.position.x, z: fence2.position.z + fence2.footprint.depth / 2 + 0.9 }, {
    createdBy: 'Marge',
    editedBy: 'Marge',
    owner: 'west',
    creature: freshCreature('rampage'),
  });
  h2.state.objects.push(fence2, hunter);
  for (let i = 0; i < 10; i++) await h2.step(500);
  assert.ok(!intact(h2.state.objects.find((o) => o.id === fence2.id)!));
  assert.equal(h2.state.grudges, undefined);
  h.stop();
  h2.stop();
});

test('the sulk: a flat follow-up to the plain ack, a grudging walk line, and a repair round that gets to them last', async () => {
  const h = harness();
  h.state.grudges = { dave: { ...hold(5, h.ctx.now), reason: 'the gorilla knocked the fence down' } };
  await h.chat('Build a duck watchtower at 40,-5', 'Dave');
  assert.match(h.spoken.at(-1)!, /^Got your idea, Dave\. It's in the queue\.$/, 'the status line stays plain');
  const before = h.spoken.length;
  // The walk to the park is long enough for a line or two: half-second ticks so nothing is skipped.
  for (let i = 0; i < 80 && h.state.jobs.some(active); i++) await h.step(500);
  const said = h.spoken.slice(before);
  const ack = renderedPool('grudge:ack', { user: 'Dave' });
  assert.ok(said.some((l) => ack.includes(l)), `a grudge:ack line followed the ack: ${JSON.stringify(said)}`);
  const walk = renderedPool('walk:grudge', { name: 'the duck-shaped watchtower', user: 'Dave' });
  assert.ok(said.some((l) => walk.includes(l)), `the walk line came from walk:grudge: ${JSON.stringify(said)}`);
  const plainWalk = [...renderedPool('walk:build', { name: 'the duck-shaped watchtower', user: 'Dave' })];
  assert.ok(!said.some((l) => plainWalk.includes(l)), 'and not from walk:build');
  assert.equal(h.state.jobs.at(-1)!.status, 'complete', 'built all the same');
  // Someone he has nothing against gets the plain treatment.
  const quiet = h.spoken.length;
  await h.chat('Build a small greenhouse', 'Erin');
  await h.finish(500);
  assert.ok(!h.spoken.slice(quiet).some((l) => renderedPool('grudge:ack', { user: 'Erin' }).includes(l)));
  h.stop();
});

test("repair rounds: dave's damaged creation waits behind erin's, but still comes before the rest of the neighborhood", () => {
  const erins = piece('erin-statue', { x: 2, z: -12 }, { createdBy: 'erin', editedBy: 'erin', health: 20 });
  const daves = piece('dave-statue', { x: 1, z: -12 }, { createdBy: 'dave', editedBy: 'dave', health: 20 }); // nearer, equally hurt
  const clutter = piece('scenery-crate', { x: 0, z: -12 }, { fixed: true, health: 20 });
  const grudges = { dave: hold(6) };
  const later = (o: SafehouseObject) => !o.fixed && sulking(grudges, o.createdBy);
  const pick = pickRepairTarget([erins, daves, clutter], [], SURVIVOR_START, () => false, later);
  assert.equal(pick?.object.id, 'erin-statue');
  const next = pickRepairTarget([daves, clutter], [], SURVIVOR_START, () => false, later);
  assert.equal(next?.object.id, 'dave-statue', 'still before the neighborhood clutter');
  const noSulk = pickRepairTarget([erins, daves, clutter], [], SURVIVOR_START);
  assert.equal(noSulk?.object.id, 'dave-statue', 'without a grudge the nearer one goes first');
});

test('amends: a repair dave asks for takes three off, a defense two; his summary says where things stand', async () => {
  const h = harness();
  const fence = fenceObjects()[0];
  fence.health = 100;
  h.state.objects.push(fence);
  h.state.grudges = { dave: { ...hold(7, h.ctx.now), reason: 'the gorilla knocked the fence down' } };
  assert.match(h.world.persona.summarizeState(h.state), /a bit off with dave \(7\): the gorilla knocked the fence down/);
  await h.chat('Repair the fence', 'Dave');
  await h.finish();
  assert.equal(h.state.jobs.at(-1)!.status, 'complete');
  assert.equal(h.state.grudges.dave.score, 7 + GRUDGE.repaired);
  h.advance(4000);
  await h.chat('Build a turret at 3,12', 'Dave');
  await h.finish();
  assert.equal(h.state.jobs.at(-1)!.status, 'complete');
  assert.equal(h.state.objects.at(-1)!.role, 'turret');
  assert.equal(h.state.grudges.dave.score, 7 + GRUDGE.repaired + GRUDGE.defended);
  assert.equal(h.world.persona.summarizeState(h.state).includes('off with dave'), false, 'below the sulk line now');
  // Nothing against erin: her repair changes nothing and opens no entry.
  h.advance(4000);
  fence.health = 100;
  await h.chat('Repair the fence', 'Erin');
  await h.finish();
  assert.equal(h.state.grudges.erin, undefined);
  h.stop();
});

test('gifts: "build marge a bench" is a build for Marge on her lot; possessives and placement are not gifts', () => {
  const bench = piece('neighbour-west-bench', { x: -22, z: 1 }, { owner: 'west', fixed: true, createdBy: 'Marge', editedBy: 'Marge' });
  bench.blueprint.name = "Marge's bench";
  const house = piece('scenery-house', { x: 0, z: -5.7 }, { fixed: true, footprint: { width: 9, depth: 7 } });
  house.blueprint.name = "Rook's house";
  const objects = [bench, house];
  const a = parseRequest('build marge a bench', objects, undefined, 'dave');
  assert.equal(a.giftTo, 'west');
  assert.equal(a.requestedArea, 'west lot');
  assert.equal(a.targetId, undefined);
  assert.match(a.text, /^build a bench$/i);
  const b = parseRequest('Build a bench for Jake at 3,3', objects, undefined, 'dave');
  assert.equal(b.giftTo, 'east');
  assert.deepEqual(b.requestedPosition, { x: 3, z: 3 });
  assert.equal(b.requestedArea, undefined, 'a spot was given');
  assert.match(b.text, /^Build a bench$/);
  const c = parseRequest("paint marge's bench red", objects, undefined, 'dave');
  assert.equal(c.giftTo, undefined);
  assert.equal(c.targetId, bench.id);
  assert.equal(c.quick?.kind, 'recolor');
  const d = parseRequest('build a bench next to the house', objects, undefined, 'dave');
  assert.equal(d.giftTo, undefined);
  assert.equal(d.relativeTo?.objectId, house.id);
  const e = parseRequest('Make Jake a hoop in the park', objects, undefined, 'dave');
  assert.equal(e.giftTo, 'east');
  assert.equal(e.requestedArea, 'park', 'a named area wins over the default lot');
  assert.equal(parseGift('build a turret for the front yard'), undefined);
  assert.equal(parseGift("build a bench next to marge's house"), undefined);
  assert.deepEqual(parseGift('give jake a gnome'), { to: 'east', text: 'give a gnome' });
});

test('a finished gift carries giftTo, stands on their lot, and the plain line says who it is for', async () => {
  const h = harness();
  await h.chat('Build marge a bench', 'Dave');
  await h.finish();
  const job = h.state.jobs.at(-1)!;
  assert.equal(job.status, 'complete', job.error);
  assert.equal(job.giftTo, 'west');
  const gift = h.state.objects.find((o) => o.giftTo);
  assert.ok(gift, 'the piece carries the recipient');
  assert.equal(gift!.giftTo, 'west');
  assert.equal(gift!.createdBy, 'Dave', 'still the chatter’s creation');
  assert.ok(contains(LANDMARKS['west lot'], gift!.position), `on her lot: ${JSON.stringify(gift!.position)}`);
  assert.ok(h.spoken.some((l) => /^Finished .*, from Dave for Marge\.$/.test(l)), JSON.stringify(h.spoken.slice(-3)));
  // A repaint of it later is an edit and stays a gift; an edit never turns a piece into one.
  h.advance(4000);
  await h.chat('Paint the park bench red', 'Dave');
  await h.finish();
  const painted = h.state.objects.find((o) => o.id === gift!.id)!;
  assert.equal(painted.giftTo, 'west');
  h.world.stateSchema.parse(JSON.parse(JSON.stringify(h.state)));
  h.stop();
});

test('what a chat job did to a piece, for the neighbour whose piece it was', () => {
  assert.equal(chatEditKindOf({ quick: { kind: 'recolor', color: '#ff0000' } }), 'paint');
  assert.equal(chatEditKindOf({ quick: { kind: 'scale', factor: 1.2, axis: 'all' } }), 'resize');
  assert.equal(chatEditKindOf({ operation: 'move' }), 'move');
  assert.equal(chatEditKindOf({ operation: 'rotate' }), 'turn');
  assert.equal(chatEditKindOf({ operation: 'repair' }), 'repair');
  assert.equal(chatEditKindOf({ operation: 'rebuild' }), 'rebuild');
  assert.equal(chatEditKindOf({}), 'redesign');
  assert.equal(chatEditKindOf({ operation: 'turret' }), 'redesign');
});

test('the operator forgives one chatter, or everyone', async () => {
  const h = harness();
  h.state.grudges = { dave: hold(9, h.ctx.now), erin: hold(5, h.ctx.now) };
  h.action('safehouse-forgive', 'Dave ');
  assert.equal(h.state.grudges.dave, undefined);
  assert.equal(h.state.grudges.erin?.score, 5);
  assert.match(h.state.notice, /dave is forgiven, by everyone/);
  h.action('safehouse-forgive-all');
  assert.equal(h.state.grudges, undefined);
  assert.match(h.state.notice, /Clean slate/);
  // A reset starts clean too: grudges are the world's, not the operator's settings.
  h.state.grudges = { dave: hold(9, h.ctx.now) };
  const fresh = h.world.reset!(h.state, h.ctx.now);
  assert.equal(fresh.grudges, undefined);
  h.stop();
});
