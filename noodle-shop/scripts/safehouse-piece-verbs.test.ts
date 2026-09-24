// Verbs as data: a piece may carry the one thing a viewer can do at it (`verb`, a PieceVerb), so a
// swimming pool unlocks `!swim`, a trampoline `!bounce`, a bell `!ring`. The word and the pose come
// from closed lists the model only picks from; the app decides where the figure stands, how high,
// for how long, and clamps the rest. The park's own pond, benches, swings, slide and picnic table
// carry verbs from the seed. Zero AI calls; nothing here touches the model.
import crypto from 'node:crypto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSafehouseWorld, type SafehouseOptions } from '../src/worlds/safehouse';
import { GENERIC_COOLDOWN_MS, parseVerb, verbViews, describeVerbs, standingVerbs, isGenericWord } from '../src/worlds/safehouse/verbs';
import { VERB_ERRAND, PAVEMENT_Z, slotPosition, crowdViews, verbHeight } from '../src/worlds/safehouse/crowd';
import { normalizeVerb, normalizeVerbWord, normalizePose, normalizeResponse, responseSchema, DEFAULT_POSE } from '../src/worlds/safehouse/blueprint';
import { SYSTEM_PROMPT, fixtureGenerator } from '../src/llm/blueprint';
import { sceneryObjects } from '../src/worlds/safehouse/scenery';
import { adoptLife } from '../src/worlds/safehouse/wildlife';
import { spawnGroup, damageObject } from '../src/worlds/safehouse/combat';
import { footprint } from '../src/shared/safehouseLayout';
import { renderedPool } from '../src/worlds/safehouse/voice';
import { active, type SafehouseState } from '../src/worlds/safehouse/state';
import { VERB_WORDS, VERB_POSES, type SafehouseObject } from '../src/shared/safehouseTypes';
import type { WorldCtx, ChatMessage } from '../src/engine/world';

const lcg = (seed = 11) => () => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
};

function harness(options: Partial<SafehouseOptions> = {}, rng: () => number = lcg(7)) {
  let now = 10_000;
  const said: string[] = [];
  const world = createSafehouseWorld({ fixture: true, workMs: 500, seedScenery: false, neighbours: false, wildlife: false, ...options });
  const state = world.createInitialState(now);
  const ctx: WorldCtx<SafehouseState> = {
    state,
    get now() {
      return now;
    },
    checkpoint() {
      world.stateSchema.parse(state);
    },
    say(text) {
      said.push(text);
    },
    log() {},
    enqueueTask: () => ({ id: '' }),
    queue: [],
    llm: { dialogue: async () => null, moderate: async () => ({ ok: false }) },
    tuning: {},
    chatRatePerMin: 0,
    rng,
  };
  world.start?.(ctx);
  let seq = 0;
  const message = (username: string, text: string, userId = `dev:${username}`): ChatMessage => ({
    id: `m${++seq}`,
    userId,
    username,
    text,
    ts: now,
    source: 'dev',
  });
  /** What the engine does on arrival: the world's first look at the message, then admission. */
  async function speak(username: string, text: string) {
    const msg = message(username, text);
    world.receiveMessage!(ctx, msg);
    await world.intents[0].handle(ctx, msg, undefined);
    return msg;
  }
  function tick(ms = 500) {
    now += ms;
    world.tick(ctx, ms);
  }
  const ticks = (n: number) => {
    for (let i = 0; i < n; i++) tick();
  };
  /** A build request run to completion through the fixture designer (no pavement figure for the requester). */
  async function request(text: string, user = 'a') {
    now += 4000;
    await world.intents[0].handle(ctx, { id: crypto.randomUUID(), userId: user, username: user, text, ts: now, source: 'dev' }, undefined);
    for (let i = 0; i < 400; i++) {
      tick();
      await new Promise((r) => setImmediate(r));
      if (!state.jobs.some(active)) break;
    }
    return state.jobs.at(-1)!;
  }
  const member = (username: string) => state.crowd?.find((m) => m.id === `dev:${username}`);
  const view = (username: string) => crowdViews(state, now).find((v) => v.id === `dev:${username}`);
  return { world, state, ctx, said, speak, tick, ticks, request, member, view, advance: (ms: number) => (now += ms), time: () => now };
}
const onPavement = (m: { position: { x: number; z: number } } | undefined) => !!m && Math.abs(m.position.z - PAVEMENT_Z) < 0.01;
const inside = (o: SafehouseObject, p: { x: number; z: number }) => {
  const r = footprint(o.position, o.footprint.width, o.footprint.depth);
  return p.x >= r.minX && p.x <= r.maxX && p.z >= r.minZ && p.z <= r.maxZ;
};
/** Distance from a point to the edge of a footprint (0 inside). */
const offEdge = (o: SafehouseObject, p: { x: number; z: number }) => {
  const r = footprint(o.position, o.footprint.width, o.footprint.depth);
  const dx = Math.max(r.minX - p.x, 0, p.x - r.maxX),
    dz = Math.max(r.minZ - p.z, 0, p.z - r.maxZ);
  return Math.hypot(dx, dz);
};

test('parseVerb: any dictionary word is a verb (generic), the built-ins stay themselves, anything else is a request', () => {
  assert.deepEqual(parseVerb('!swim'), { verb: 'swim', rest: '', generic: true });
  assert.deepEqual(parseVerb('  !Bounce like mad'), { verb: 'bounce', rest: 'like mad', generic: true });
  assert.deepEqual(parseVerb('!RING!'), { verb: 'ring', rest: '!', generic: true });
  assert.deepEqual(parseVerb('!shoot'), { verb: 'shoot', rest: '' });
  assert.deepEqual(parseVerb('!help'), { verb: 'verbs', rest: '' });
  assert.equal(parseVerb('!swimming'), undefined, 'the exact word, not a stem: chat learns the word from !verbs');
  assert.equal(parseVerb('!delete the pool'), undefined);
  assert.equal(parseVerb('!fly'), undefined);
  assert.equal(parseVerb('swim'), undefined);
  assert.equal(VERB_WORDS.length, 43);
  assert.equal(VERB_POSES.length, 8);
  assert.ok(VERB_WORDS.every((w) => /^[a-z]+$/.test(w)), 'plain lowercase words, nothing to escape');
  assert.ok(!VERB_WORDS.some((w) => ['shoot', 'honk', 'dance', 'verbs', 'help', 'delete'].includes(w)), 'the built-ins are not in the dictionary');
  assert.ok(VERB_WORDS.every(isGenericWord));
  for (const w of VERB_WORDS) assert.ok(VERB_POSES.includes(DEFAULT_POSE[w]), `${w} has a default pose`);
});

test('normalizeVerb: words and poses land in the closed lists (stems, synonyms), the rest is defaulted and clamped, unknown words drop the verb', () => {
  assert.deepEqual(normalizeVerb('swim'), { word: 'swim', pose: 'swim', spot: 'on', seconds: 8 });
  assert.deepEqual(normalizeVerb({ word: '!Swimming', pose: 'floating', spot: 'in the water', seconds: 99, pop: 'splash!!' }), {
    word: 'swim',
    pose: 'swim',
    spot: 'on',
    seconds: 20,
    pop: 'SPLASH!!',
  });
  assert.deepEqual(normalizeVerb({ word: 'trampoline', seconds: 1 }, 0.9), { word: 'bounce', pose: 'jump', spot: 'on', seconds: 3 });
  assert.deepEqual(normalizeVerb({ verb: 'ring', pose: 'no such pose' }, 2.4), { word: 'ring', pose: 'wave', spot: 'beside', seconds: 8 });
  assert.deepEqual(normalizeVerb({ command: 'boxing', where: 'next to it', pop: 'a very long shout indeed' }, 0.5), {
    word: 'punch',
    pose: 'punch',
    spot: 'beside',
    seconds: 8,
    pop: 'AVERYLONGSHO',
  });
  // A tall thing with no spot is stood beside; a low one is stood on.
  assert.equal(normalizeVerb({ word: 'sit' }, 2)?.spot, 'beside');
  assert.equal(normalizeVerb({ word: 'sit' }, 0.6)?.spot, 'on');
  assert.equal(normalizeVerb({ word: 'fly' }), undefined);
  assert.equal(normalizeVerb({ pose: 'swim' }), undefined, 'no word, no verb');
  assert.equal(normalizeVerb(42), undefined);
  assert.equal(normalizeVerbWord('Napping'), 'nap');
  assert.equal(normalizeVerbWord('bounces'), 'bounce');
  assert.equal(normalizeVerbWord('worship'), 'pray');
  assert.equal(normalizeVerbWord('explode'), undefined);
  assert.equal(normalizePose('lying'), 'lie');
  assert.equal(normalizePose('applaud'), 'cheer');
  assert.equal(normalizePose('handstand'), undefined);
});

test('normalizeResponse carries a build\'s verb through to the schema, keyed by the design\'s height, and a bad verb never fails the design', () => {
  const raw = {
    action: 'build',
    reply: 'A pool.',
    blueprint: {
      name: 'Pool',
      description: 'a pool',
      parts: [{ shape: 'cylinder', position: [0, 0.1, 0], size: [3, 0.2, 3], color: 'blue' }],
    },
    verb: { word: 'swimming', pose: 'float', pop: 'splash' },
  };
  const ok = responseSchema.parse(normalizeResponse(raw));
  assert.equal(ok.action, 'build');
  assert.deepEqual(ok.action === 'build' && ok.verb, { word: 'swim', pose: 'swim', spot: 'on', seconds: 8, pop: 'SPLASH' });
  // A tall design with an unplaced verb is stood beside.
  const tall = normalizeResponse({
    ...raw,
    blueprint: { ...raw.blueprint, parts: [{ shape: 'box', position: [0, 1.2, 0], size: [0.5, 2.4, 0.5], color: 'brown' }] },
    verb: 'ring',
  }) as { verb?: unknown };
  assert.deepEqual(tall.verb, { word: 'ring', pose: 'wave', spot: 'beside', seconds: 8 });
  // A word off the list: the verb is dropped, the design is kept.
  const dropped = responseSchema.parse(normalizeResponse({ ...raw, verb: { word: 'teleport', pose: 'swim' } }));
  assert.equal(dropped.action === 'build' && dropped.verb, undefined);
  // An edit may carry one too.
  const edit = responseSchema.parse(normalizeResponse({ ...raw, action: 'edit', targetId: 'x', verb: { word: 'sleep' } }));
  assert.deepEqual(edit.action === 'edit' && edit.verb, { word: 'sleep', pose: 'lie', spot: 'on', seconds: 8 });
  // The prompt tells the model about the field and both lists, and when to leave it out.
  assert.match(SYSTEM_PROMPT, /"verb":\{"word"/);
  for (const w of VERB_WORDS) assert.ok(new RegExp(`\\b${w}\\b`).test(SYSTEM_PROMPT), `prompt names ${w}`);
  for (const p of VERB_POSES) assert.ok(new RegExp(`\\b${p}\\b`).test(SYSTEM_PROMPT), `prompt names pose ${p}`);
  assert.match(SYSTEM_PROMPT, /Omit for anything nobody would do one thing at/);
});

test('fixtures: a pool, a trampoline, a bell and a punchbag come with their verbs, valid against the schema', async () => {
  const signal = new AbortController().signal;
  const design = async (text: string) => {
    const r = await fixtureGenerator({ text, username: 'dave', objects: [] }, signal);
    assert.equal(r.action, 'build', text);
    responseSchema.parse(r);
    return r as Extract<typeof r, { action: 'build' }>;
  };
  const pool = await design('Build a swimming pool');
  assert.deepEqual(pool.verb, { word: 'swim', pose: 'swim', spot: 'on', seconds: 8, pop: 'SPLASH' });
  assert.equal(pool.blueprint.name, 'Swimming pool');
  const tramp = await design('Build a trampoline at -20,10');
  assert.deepEqual(tramp.verb, { word: 'bounce', pose: 'jump', spot: 'on', seconds: 8, pop: 'BOING' });
  const bell = await design('Build a bell');
  assert.deepEqual(bell.verb, { word: 'ring', pose: 'wave', spot: 'beside', seconds: 5, pop: 'DING' });
  const bag = await design('Build a punching bag');
  assert.deepEqual(bag.verb, { word: 'punch', pose: 'punch', spot: 'beside', seconds: 6, pop: 'WHACK' });
  // A plain bench fixture carries no verb of its own (seeded benches do; chat's are just seats).
  const bench = await design('Build a bench');
  assert.equal(bench.verb, undefined);
});

test('"Build a swimming pool at -20,10" stands a pool with !swim on it; !verbs names it; nobody swims until it is built', async () => {
  const h = harness();
  await h.speak('dave', '!swim');
  assert.ok(h.said.includes('!swim needs something to swim in standing. Build one.'), JSON.stringify(h.said));
  assert.equal(h.member('dave')?.errand, undefined);
  assert.deepEqual(verbViews(h.state).map((v) => v.verb), ['!shoot', '!honk', '!dance'], 'only the built-ins are listed with nothing standing');
  const job = await h.request('Build a swimming pool at -20,10', 'ana');
  assert.equal(job.status, 'complete', job.error);
  const pool = h.state.objects.find((o) => !o.fixed && o.verb)!;
  assert.ok(pool, 'the pool stands');
  assert.deepEqual(pool.position, { x: -20, z: 10 });
  assert.deepEqual(pool.verb, { word: 'swim', pose: 'swim', spot: 'on', seconds: 8, pop: 'SPLASH' });
  assert.equal(pool.creature, undefined);
  assert.deepEqual(standingVerbs(h.state).map((v) => [v.word, v.piece.id]), [['swim', pool.id]]);
  const row = verbViews(h.state).find((v) => v.verb === '!swim');
  assert.deepEqual(row, { verb: '!swim', needs: 'Swimming pool', unlocked: true });
  assert.match(describeVerbs(h.state), /Unlocked: !swim \(Swimming pool\)\./);
  await h.speak('dave', '!verbs');
  assert.ok(h.said.at(-1)!.includes('!swim (Swimming pool)'), h.said.at(-1));
  // Knocked down, the word goes with it.
  damageObject(pool, 10_000, h.state.combat.time);
  assert.equal(verbViews(h.state).find((v) => v.verb === '!swim'), undefined);
});

test('!swim: the figure jogs to the pool, steps in (a pose, a height, a SPLASH), holds for the verb\'s seconds, and jogs back to its slot', async () => {
  const h = harness();
  const job = await h.request('Build a swimming pool at -20,10', 'ana');
  assert.equal(job.status, 'complete', job.error);
  const pool = h.state.objects.find((o) => o.verb?.word === 'swim')!;
  await h.speak('dave', '!swim');
  assert.ok(h.said.includes('dave is off to the swimming pool.'), JSON.stringify(h.said));
  const dave = h.member('dave')!;
  assert.equal(dave.errand?.kind, 'verb');
  assert.equal(dave.errand?.phase, 'going');
  assert.equal(dave.errand?.word, 'swim');
  assert.equal(dave.errand?.targetId, pool.id);
  assert.equal(h.state.jobs.filter((j) => j.username === 'dave').length, 0, 'no job: a verb never spends Rook');
  h.ticks(2);
  assert.ok(!onPavement(dave), 'off the kerb');
  let arrived = 0;
  for (let i = 0; i < 40 && dave.errand?.phase === 'going'; i++) {
    h.tick();
    arrived++;
  }
  assert.equal(dave.errand?.phase, 'doing', `arrived after ${arrived} ticks`);
  assert.ok(inside(pool, dave.position), `stands in the pool: ${JSON.stringify(dave.position)} vs ${JSON.stringify(pool.position)}`);
  assert.equal(dave.facing, 0, 'faces the street from the water');
  assert.deepEqual(dave.pop, { text: 'SPLASH', at: h.time() });
  const y = verbHeight(pool, 'swim');
  assert.ok(y > 0 && y <= VERB_ERRAND.lowY.max, `waist-deep, not on top: ${y}`);
  const view = h.view('dave')!;
  assert.deepEqual(view.errand, { kind: 'verb', phase: 'doing', targetId: pool.id, word: 'swim', pose: 'swim', y });
  assert.deepEqual(view.pop, { text: 'SPLASH', at: h.time() });
  // Eight seconds in the water, then out and home.
  const at = { ...dave.position };
  h.ticks(15);
  assert.equal(dave.errand?.phase, 'doing');
  assert.deepEqual(dave.position, at, 'held still in the water');
  assert.equal(h.view('dave')!.pop, undefined, 'the SPLASH cleared after a couple of seconds');
  h.ticks(2);
  assert.equal(dave.errand?.phase, 'returning');
  h.ticks(40);
  assert.equal(dave.errand, undefined, 'errand over');
  assert.deepEqual(dave.position, slotPosition(dave.slot), 'back in their slot');
  assert.equal(h.view('dave')!.errand, undefined);
  h.world.stateSchema.parse(JSON.parse(JSON.stringify(h.state)));
});

test('three may swim at once, spread apart; the fourth is next in line and goes when one leaves; the cooldown and a wave refuse', async () => {
  const h = harness();
  const job = await h.request('Build a swimming pool at -20,10', 'ana');
  assert.equal(job.status, 'complete', job.error);
  const pool = h.state.objects.find((o) => o.verb?.word === 'swim')!;
  for (const u of ['dave', 'erin', 'fay']) await h.speak(u, '!swim');
  await h.speak('gus', '!swim');
  assert.ok(h.said.includes('gus is next at the swimming pool.'), JSON.stringify(h.said.slice(-3)));
  assert.equal(h.member('gus')!.errand, undefined, 'waiting on the kerb');
  assert.ok(onPavement(h.member('gus')));
  // Twice in a row: the cooldown.
  await h.speak('dave', '!swim');
  assert.ok(h.said.includes('Give it a moment, dave.'), JSON.stringify(h.said.slice(-2)));
  assert.equal(GENERIC_COOLDOWN_MS, 30_000);
  for (let i = 0; i < 40 && ['dave', 'erin', 'fay'].some((u) => h.member(u)!.errand?.phase === 'going'); i++) h.tick();
  const spots = ['dave', 'erin', 'fay'].map((u) => h.member(u)!.errand!.at!);
  assert.ok(spots.every((p) => inside(pool, p)), JSON.stringify(spots));
  for (let i = 0; i < 3; i++)
    for (let j = i + 1; j < 3; j++) assert.ok(Math.hypot(spots[i].x - spots[j].x, spots[i].z - spots[j].z) > 0.5, `spread apart: ${JSON.stringify(spots)}`);
  // The first out lets gus in.
  for (let i = 0; i < 60 && !h.member('gus')!.errand; i++) h.tick();
  assert.equal(h.member('gus')!.errand?.phase, 'going', 'gus sets off once a doer heads home');
  // A wave: everyone in the pool heads home, and nobody new is sent.
  spawnGroup(h.state.combat, 3);
  h.state.combat.paused = false;
  h.state.combat.wave.phase = 'wave';
  h.tick();
  assert.ok(['dave', 'erin', 'fay', 'gus'].every((u) => !h.member(u)!.errand || h.member(u)!.errand!.phase === 'returning'), 'all turned back');
  await h.speak('hal', '!swim');
  assert.ok(h.said.includes("!swim can wait till the wave's done."), JSON.stringify(h.said.slice(-2)));
  h.state.combat.paused = true;
  h.state.combat.zombies = [];
  for (let i = 0; i < 80 && ['dave', 'erin', 'fay', 'gus'].some((u) => h.member(u)!.errand); i++) h.tick();
  assert.ok(['dave', 'erin', 'fay', 'gus'].every((u) => onPavement(h.member(u))));
});

test('a beside verb: !ring stands the figure next to the bell, on the ground, facing it', async () => {
  const h = harness();
  const job = await h.request('Build a bell at 12,10', 'ana');
  assert.equal(job.status, 'complete', job.error);
  const bell = h.state.objects.find((o) => o.verb?.word === 'ring')!;
  assert.equal(bell.verb?.spot, 'beside');
  await h.speak('dave', '!ring');
  assert.ok(h.said.includes('dave is off to the bell.'), JSON.stringify(h.said.slice(-2)));
  const dave = h.member('dave')!;
  for (let i = 0; i < 40 && dave.errand?.phase === 'going'; i++) h.tick();
  assert.equal(dave.errand?.phase, 'doing');
  assert.equal(dave.errand?.at, undefined, 'no step onto it');
  assert.equal(dave.errand?.y, 0);
  // The route ends on the grid cell nearest the 0.75 m spot, so within half a cell of it.
  const off = offEdge(bell, dave.position);
  assert.ok(off > 0.4 && off < VERB_ERRAND.besideOff + 0.5, `about 0.75 m off the footprint: ${off.toFixed(2)}`);
  assert.ok(!inside(bell, dave.position));
  assert.ok(Math.abs(dave.facing - Math.atan2(bell.position.x - dave.position.x, bell.position.z - dave.position.z)) < 0.01, 'facing the bell');
  assert.deepEqual(h.view('dave')!.pop, { text: 'DING', at: h.time() });
  assert.equal(h.view('dave')!.errand?.pose, 'wave');
  // Five seconds, then home.
  h.ticks(11);
  assert.equal(dave.errand?.phase, 'returning');
});

test('the park comes with verbs: the pond to swim in, seats to sit on, the swings, the slide, the picnic table; old saves adopt them', () => {
  const seeds = sceneryObjects();
  const verbOf = (id: string) => seeds.find((o) => o.id === `scenery-${id}`)!.verb;
  assert.deepEqual(verbOf('pond'), { word: 'swim', pose: 'swim', spot: 'on', seconds: 8, pop: 'SPLASH' });
  assert.deepEqual(verbOf('bench-west'), { word: 'sit', pose: 'sit', spot: 'on', seconds: 10 });
  assert.deepEqual(verbOf('bench-east'), { word: 'sit', pose: 'sit', spot: 'on', seconds: 10 });
  assert.equal(verbOf('bus-shelter')?.word, 'sit');
  assert.equal(verbOf('swings')?.word, 'swing');
  assert.equal(verbOf('slide')?.word, 'slide');
  assert.equal(verbOf('slide')?.spot, 'beside');
  assert.equal(verbOf('picnic')?.word, 'eat');
  assert.equal(verbOf('house'), undefined);
  assert.equal(verbOf('sandpit'), undefined);
  // A fresh world lists them, one row per word (the first piece by name), and !verbs names the pond.
  const h = harness({ seedScenery: true });
  const rows = verbViews(h.state).filter((v) => !['!shoot', '!honk', '!dance'].includes(v.verb));
  assert.deepEqual(
    rows.map((v) => [v.verb, v.needs]),
    [
      ['!drive', 'Abandoned car (east)'],
      ['!sit', 'Bus shelter'],
      ['!eat', 'Picnic table'],
      ['!swim', 'Pond'],
      ['!slide', 'Slide'],
      ['!swing', 'Swings'],
    ],
  );
  assert.match(describeVerbs(h.state, { x: 40, z: 0 }), /!sit \(Park bench/);
  // A save from before verbs: the seed's verb is adopted onto an untouched piece, never onto a redesigned one.
  const old = harness({ seedScenery: true });
  const pond = old.state.objects.find((o) => o.id === 'scenery-pond')!;
  const bench = old.state.objects.find((o) => o.id === 'scenery-bench-west')!;
  delete pond.verb;
  delete bench.verb;
  bench.revision = 2;
  assert.equal(adoptLife(old.state), true);
  assert.equal(old.state.objects.find((o) => o.id === 'scenery-pond')!.verb?.word, 'swim');
  assert.equal(old.state.objects.find((o) => o.id === 'scenery-bench-west')!.verb, undefined, 'a redesigned bench keeps chat\'s shape and no seeded verb');
  assert.equal(adoptLife(old.state), false, 'idempotent');
});

test("Rook's lines: a word when a new !word comes on (not on a restart), a word the first time anyone does it, once each and gated", async () => {
  const h = harness();
  const job = await h.request('Build a swimming pool at -20,10', 'ana');
  assert.equal(job.status, 'complete', job.error);
  h.ticks(30);
  const fresh = renderedPool('verb:new', { word: 'swim' });
  assert.equal(h.said.filter((l) => fresh.includes(l)).length, 1, `one word on the new verb: ${JSON.stringify(h.said)}`);
  // Another pool: the word is already on, so nothing.
  const second = await h.request('Build a paddling pool at -30,10', 'ben');
  assert.equal(second.status, 'complete', second.error);
  h.ticks(30);
  assert.equal(h.said.filter((l) => fresh.includes(l)).length, 1);
  // The first swim ever draws a word; the second swimmer does not.
  await h.speak('dave', '!swim');
  for (let i = 0; i < 60 && h.member('dave')!.errand?.phase === 'going'; i++) h.tick();
  h.ticks(30);
  const first = renderedPool('verb:first', { user: 'dave', word: 'swim' });
  assert.equal(h.said.filter((l) => first.includes(l)).length, 1, `his hello to the first swim: ${JSON.stringify(h.said.slice(-8))}`);
  h.advance(GENERIC_COOLDOWN_MS + 60_000);
  await h.speak('erin', '!swim');
  for (let i = 0; i < 60 && h.member('erin')!.errand?.phase === 'going'; i++) h.tick();
  h.ticks(30);
  assert.equal(h.said.filter((l) => renderedPool('verb:first', { user: 'erin', word: 'swim' }).includes(l)).length, 0, 'said once per word');
  // A restart with the pool already standing says nothing new.
  const again = harness();
  again.state.objects.push(...h.state.objects.filter((o) => o.verb));
  again.ticks(30);
  assert.equal(again.said.filter((l) => fresh.includes(l)).length, 0, JSON.stringify(again.said));
  // A trampoline later is news: a different word.
  again.advance(120_000);
  const tramp = await again.request('Build a trampoline at 20,10', 'cara');
  assert.equal(tramp.status, 'complete', tramp.error);
  again.ticks(30);
  const boing = renderedPool('verb:new', { word: 'bounce' });
  assert.equal(again.said.filter((l) => boing.includes(l)).length, 1, JSON.stringify(again.said.slice(-6)));
});

test('an edit keeps a piece\'s verb unless the design replaces it; a creature never carries one; the saved shape round-trips', async () => {
  const h = harness();
  const job = await h.request('Build a swimming pool at -20,10', 'ana');
  assert.equal(job.status, 'complete', job.error);
  const pool = h.state.objects.find((o) => o.verb?.word === 'swim')!;
  const painted = await h.request('Paint the swimming pool red', 'ben');
  assert.equal(painted.status, 'complete', painted.error);
  const after = h.state.objects.find((o) => o.id === pool.id)!;
  assert.equal(after.verb?.word, 'swim', 'a paint job keeps the verb');
  assert.ok(after.revision > pool.revision);
  // Mid-errand state survives a save and load.
  await h.speak('dave', '!swim');
  h.ticks(3);
  const clone = JSON.parse(JSON.stringify(h.state));
  const parsed = h.world.stateSchema.parse(clone);
  const dave = parsed.crowd?.find((m) => m.id === 'dev:dave');
  assert.equal(dave?.errand?.kind, 'verb');
  assert.equal(dave?.errand?.word, 'swim');
  assert.equal(dave?.errand?.pose, 'swim');
  assert.equal(parsed.objects.find((o) => o.id === pool.id)?.verb?.word, 'swim');
  // A verb with a word off the list never makes it into a save.
  const bad = JSON.parse(JSON.stringify(h.state));
  bad.objects.find((o: SafehouseObject) => o.id === pool.id).verb = { word: 'teleport', pose: 'swim', spot: 'on', seconds: 8 };
  assert.throws(() => h.world.stateSchema.parse(bad));
});
