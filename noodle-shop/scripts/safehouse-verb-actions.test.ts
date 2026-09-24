// Drive, ride, fight: three words in the verb dictionary that do more than hold a pose. `!drive` (or
// `!ride` on something that cannot move by itself) takes the piece up the street and back with the
// figure aboard — the piece's true position never changes, the page draws it at `driven.at`. `!ride`
// on a living build sits the figure on its back while it goes about its business. `!fight` on a living
// build is a scrap the app decides: the creature stands its ground, then bolts or the figure lies flat.
// Zero AI calls; every number here is the app's.
import crypto from 'node:crypto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSafehouseWorld, type SafehouseOptions } from '../src/worlds/safehouse';
import { WORD_COOLDOWN_MS, GENERIC_COOLDOWN_MS, verbViews, describeVerbs, standingVerbs } from '../src/worlds/safehouse/verbs';
import { RUN, CHASE, MOUNT, SCRAP, PAVEMENT_Z, slotPosition, crowdViews, planRun, turnFor, seatHeight, mountHeight, verbKind, doersFor } from '../src/worlds/safehouse/crowd';
import { normalizeVerb, normalizeVerbWord, DEFAULT_SECONDS, responseSchema } from '../src/worlds/safehouse/blueprint';
import { SYSTEM_PROMPT, fixtureGenerator } from '../src/llm/blueprint';
import { spawnGroup, initializeObject } from '../src/worlds/safehouse/combat';
import { freshCreature } from '../src/worlds/safehouse/creatures';
import { renderedPool, speakName } from '../src/worlds/safehouse/voice';
import { active, type SafehouseState } from '../src/worlds/safehouse/state';
import { LANDMARKS, footprint } from '../src/shared/safehouseLayout';
import { VERB_WORDS, CREATURE_VERB_WORDS, isCreatureVerb, isRunVerb, type SafehouseObject, type PieceVerb } from '../src/shared/safehouseTypes';
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
  const until = (fn: () => boolean, max = 200) => {
    let n = 0;
    while (!fn() && n < max) {
      tick();
      n++;
    }
    return n;
  };
  return { world, state, ctx, said, speak, tick, ticks, until, request, member, view, advance: (ms: number) => (now += ms), time: () => now };
}
const onPavement = (m: { position: { x: number; z: number } } | undefined) => !!m && Math.abs(m.position.z - PAVEMENT_Z) < 0.01;
const dist = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z);
const insideOf = (o: SafehouseObject, p: { x: number; z: number }) => {
  const r = footprint(o.position, o.footprint.width, o.footprint.depth);
  return p.x >= r.minX && p.x <= r.maxX && p.z >= r.minZ && p.z <= r.maxZ;
};
/** A hand-made piece; a living one when `creature` is given. */
const piece = (id: string, position: { x: number; z: number }, extra: Partial<SafehouseObject> & { name?: string; size?: [number, number, number] } = {}): SafehouseObject => {
  const { name, size, ...rest } = extra;
  const [w, h, d] = size ?? [1, 2, 1];
  return initializeObject({
    id,
    revision: 1,
    createdAt: 0,
    createdBy: 'ivy',
    editedBy: 'ivy',
    position,
    footprint: { width: w, depth: d },
    blueprint: { name: name ?? id, description: '', parts: [{ shape: 'box', position: [0, h / 2, 0], size: [w, h, d], rotation: [0, 0, 0], color: '#888888' }] },
    ...rest,
  });
};
const FIGHT: PieceVerb = { word: 'fight', pose: 'punch', spot: 'beside', seconds: 5, pop: 'CLANG' };
const RIDE: PieceVerb = { word: 'ride', pose: 'sit', spot: 'on', seconds: 12, pop: 'GIDDYUP' };
const robot = (position = { x: 12, z: 10 }) => piece('robot', position, { creature: freshCreature('roam'), verb: FIGHT, name: 'Yard robot', size: [0.8, 2, 0.6] });

test('the three words: in the dictionary, their kinds, their defaults, their synonyms, and the prompt knows them', () => {
  assert.equal(VERB_WORDS.length, 43);
  assert.deepEqual([...CREATURE_VERB_WORDS], ['ride', 'fight']);
  assert.ok(isCreatureVerb('fight') && isCreatureVerb('ride') && !isCreatureVerb('drive') && !isCreatureVerb('swim'));
  assert.ok(isRunVerb('drive') && isRunVerb('ride') && !isRunVerb('fight'));
  assert.deepEqual(normalizeVerb({ word: 'drive' }, 1.8), { word: 'drive', pose: 'sit', spot: 'on', seconds: 12 }, 'a car is got into however tall it is');
  assert.deepEqual(normalizeVerb('ride', 1.6), { word: 'ride', pose: 'sit', spot: 'on', seconds: 12 });
  assert.deepEqual(normalizeVerb({ word: 'fight', pop: 'pow!' }, 0.5), { word: 'fight', pose: 'punch', spot: 'beside', seconds: 5, pop: 'POW!' }, 'a fight is squared up to, never stood on');
  assert.equal(DEFAULT_SECONDS.fight, 5);
  assert.equal(normalizeVerbWord('joyride'), 'drive');
  assert.equal(normalizeVerbWord('Driving'), 'drive');
  assert.equal(normalizeVerbWord('gallop'), 'ride');
  assert.equal(normalizeVerbWord('brawl'), 'fight');
  assert.equal(normalizeVerbWord('wrestle'), 'fight');
  for (const w of ['drive', 'ride', 'fight']) assert.ok(new RegExp(`\\b${w}\\b`).test(SYSTEM_PROMPT), `prompt names ${w}`);
  assert.match(SYSTEM_PROMPT, /may carry only ride or fight/);
  // Kinds: a static car runs, a living build is mounted or scrapped with, everything else holds; one at a time for the moving ones.
  const car = piece('car', { x: 0, z: 10 }, { verb: { word: 'drive', pose: 'sit', spot: 'on', seconds: 12 }, size: [1.8, 1.8, 3.9] });
  assert.equal(verbKind(car, 'drive'), 'run');
  assert.equal(verbKind(car, 'ride'), 'run');
  assert.equal(verbKind(robot(), 'fight'), 'scrap');
  assert.equal(verbKind(robot(), 'ride'), 'mount');
  assert.equal(verbKind(robot(), 'swim'), 'hold');
  assert.equal(verbKind(car, 'sit'), 'hold');
  assert.equal(doersFor(car, 'drive'), 1);
  assert.equal(doersFor(car, 'sit'), 3);
  assert.equal(seatHeight(car), 1, 'capped at a metre');
  assert.ok(Math.abs(mountHeight(robot()) - Math.min(MOUNT.maxY, 2 * MOUNT.factor)) < 1e-9);
  // Turning: the long axis goes along the way, never more than a quarter turn.
  assert.equal(turnFor(car, 0), 0, 'a car designed nose along z drives forward down z');
  assert.ok(Math.abs(turnFor(car, Math.PI / 2) - Math.PI / 2) < 1e-9, 'and turns a quarter to go along x');
  assert.ok(Math.abs(turnFor(car, -Math.PI / 2) - Math.PI / 2) < 1e-9, 'the other way along x it reverses rather than swinging round');
  const sideways = piece('van', { x: 0, z: 10 }, { size: [3.9, 1.8, 1.8] });
  assert.equal(turnFor(sideways, Math.PI / 2), 0, 'a car parked along the street drives off as it stands');
});

test('fixtures: a car carries drive, a horse ride, a robot and a gorilla fight, the RC car ride; all valid against the schema', async () => {
  const signal = new AbortController().signal;
  const design = async (text: string) => {
    const r = await fixtureGenerator({ text, username: 'dave', objects: [] }, signal);
    assert.equal(r.action, 'build', text);
    responseSchema.parse(r);
    return r as Extract<typeof r, { action: 'build' }>;
  };
  const car = await design('Build a car at -7,10');
  assert.equal(car.creature, undefined, 'a plain car stands still');
  assert.deepEqual(car.uses, ['vehicle']);
  assert.deepEqual(car.verb, { word: 'drive', pose: 'sit', spot: 'on', seconds: 12, pop: 'VROOM' });
  const horse = await design('Build a horse');
  assert.equal(horse.creature?.behaviour, 'roam');
  assert.equal(horse.verb?.word, 'ride');
  const bot = await design('Build a robot at 20,10');
  assert.equal(bot.creature?.behaviour, 'roam');
  assert.equal(bot.verb?.word, 'fight');
  assert.equal(bot.verb?.spot, 'beside');
  const ape = await design('Build a gorilla');
  assert.equal(ape.creature?.behaviour, 'rampage');
  assert.equal(ape.verb?.word, 'fight');
  const rc = await design('Build an RC car');
  assert.equal(rc.creature?.behaviour, 'zoom');
  assert.equal(rc.verb?.word, 'ride');
});

test('planRun: out to the lane, as far as the road is clear each way, back home; boxed in is nothing', () => {
  const h = harness();
  const car = piece('car', { x: -7, z: 10 }, { verb: { word: 'drive', pose: 'sit', spot: 'on', seconds: 12 }, size: [1.8, 1.8, 3.9] });
  h.state.objects.push(car);
  const open = planRun(h.state, car, 12)!;
  assert.ok(open, 'a clear road');
  // 12 s at 5 m/s is 60 m: 15 m each way, the lane point between, ending back at the car's spot.
  assert.deepEqual(open, [
    { x: 8, z: 10 },
    { x: -7, z: 10 },
    { x: -22, z: 10 },
    { x: -7, z: 10 },
  ]);
  assert.ok(open.every((p) => p.z >= LANDMARKS.road.minZ && p.z <= LANDMARKS.road.maxZ), 'stays on the road');
  // Parked off the road: pull out to the lane first, park back after.
  const drive = piece('drive', { x: 20, z: 2 }, { verb: { word: 'drive', pose: 'sit', spot: 'on', seconds: 12 }, size: [1.8, 1.8, 3.9] });
  h.state.objects.push(drive);
  const out = planRun(h.state, drive, 12)!;
  assert.deepEqual(out[0], { x: 20, z: 10 });
  assert.deepEqual(out.at(-1), { x: 20, z: 2 });
  // Legs are clipped by whatever stands on the road: a wall 6 m east leaves only the west leg.
  h.state.objects.push(piece('wall', { x: -1, z: 10 }, { size: [1, 2, 6] }));
  const clipped = planRun(h.state, car, 12)!;
  assert.ok(clipped, 'still a run west');
  assert.ok(clipped.every((p) => p.x <= -7 + RUN.legMin), `no east leg past the wall: ${JSON.stringify(clipped)}`);
  assert.ok(clipped.some((p) => p.x <= -20), 'the west leg is the long one');
  // Walls both sides: boxed in.
  h.state.objects.push(piece('wall2', { x: -13, z: 10 }, { size: [1, 2, 6] }));
  assert.equal(planRun(h.state, car, 12), undefined);
  // Something in the way of pulling out: nothing either.
  h.state.objects.push(piece('bollard', { x: 20, z: 6 }, { size: [1, 1, 1] }));
  assert.equal(planRun(h.state, drive, 12), undefined);
});

test('!drive: the figure boards, the car goes up the street and back under them (drawn at driven.at, never moved), then they walk home', async () => {
  const h = harness();
  const job = await h.request('Build a car at -7,10', 'ana');
  assert.equal(job.status, 'complete', job.error);
  const car = h.state.objects.find((o) => o.verb?.word === 'drive')!;
  assert.equal(car.blueprint.name, 'Old car');
  const parked = { ...car.position };
  assert.deepEqual(verbViews(h.state).find((v) => v.verb === '!drive'), { verb: '!drive', needs: 'Old car', unlocked: true });
  await h.speak('dave', '!drive');
  assert.ok(h.said.includes('dave is taking the old car for a spin.'), JSON.stringify(h.said.slice(-2)));
  const dave = h.member('dave')!;
  assert.equal(dave.errand?.word, 'drive');
  assert.equal(dave.errand?.pose, 'sit');
  assert.equal(dave.errand?.run?.length, 4, 'the run is planned up front');
  assert.equal(dave.errand?.y, seatHeight(car));
  const went = h.until(() => dave.errand?.phase === 'doing', 60);
  assert.equal(dave.errand?.phase, 'doing', `boarded after ${went} ticks`);
  assert.deepEqual(car.driven && { at: car.driven.at, by: car.driven.by }, { at: parked, by: 'dave' });
  assert.deepEqual(dave.position, parked, 'in the driving seat');
  assert.deepEqual(dave.pop, { text: 'VROOM', at: h.time() });
  // Off it goes: the drawn position leaves the parking spot at driving pace; the true one never moves.
  let farthest = 0;
  const turns: number[] = [];
  for (let i = 0; i < 6; i++) {
    h.tick();
    farthest = Math.max(farthest, dist(car.driven!.at, parked));
    turns.push(car.driven!.turn);
    assert.deepEqual(car.position, parked, 'the piece itself stays parked');
    assert.deepEqual(dave.position, car.driven!.at, 'the driver rides along');
    assert.ok(car.driven!.at.z >= LANDMARKS.road.minZ && car.driven!.at.z <= LANDMARKS.road.maxZ, 'on the road');
  }
  assert.ok(farthest > 6 && farthest <= RUN.speed * 3 + 0.01, `3 s of driving: ${farthest.toFixed(1)} m`);
  assert.ok(turns.every((t) => Math.abs(t - Math.PI / 2) < 1e-9), `turned a quarter to run along the street: ${JSON.stringify(turns)}`);
  const v = h.view('dave')!;
  assert.equal(v.errand?.pose, 'sit');
  assert.equal(v.errand?.y, seatHeight(car));
  h.world.stateSchema.parse(JSON.parse(JSON.stringify(h.state)));
  // The whole trip is about twelve seconds; then it is parked back where it was and dave walks home.
  const drove = h.until(() => !car.driven, 60);
  assert.ok(drove >= 12 && drove <= 30, `parked after ${drove} more ticks`);
  assert.equal(car.driven, undefined);
  assert.deepEqual(car.position, parked);
  assert.equal(dave.errand?.phase, 'returning');
  assert.ok(!insideOf(car, dave.position), 'stepped out beside it');
  h.until(() => !dave.errand, 60);
  assert.deepEqual(dave.position, slotPosition(dave.slot));
  // One driver at a time, and a minute between a chatter's drives.
  assert.equal(WORD_COOLDOWN_MS.drive, 60_000);
  await h.speak('dave', '!drive');
  assert.ok(h.said.includes('Give it a moment, dave.'), JSON.stringify(h.said.slice(-2)));
  await h.speak('erin', '!drive');
  await h.speak('fay', '!drive');
  assert.ok(h.said.includes('fay is next for the old car.'), JSON.stringify(h.said.slice(-2)));
});

test('a seeded street: !drive takes the abandoned car (west) along the road without crossing anything solid; a wave parks it where it is', async () => {
  const h = harness({ seedScenery: true });
  assert.ok(standingVerbs(h.state).some((v) => v.word === 'drive'), 'the street’s cars carry drive');
  assert.match(describeVerbs(h.state, { x: 0, z: PAVEMENT_Z }), /!drive \(Abandoned car \(west\)\)/);
  await h.speak('dave', '!drive');
  assert.ok(h.said.includes('dave is taking the abandoned car (west) for a spin.'), JSON.stringify(h.said.slice(-2)));
  const car = h.state.objects.find((o) => o.id === 'scenery-car-west')!;
  const dave = h.member('dave')!;
  h.until(() => dave.errand?.phase === 'doing', 60);
  assert.equal(dave.errand?.phase, 'doing');
  const solids = h.state.objects.filter((o) => o.id !== car.id && !o.passable && !o.creature && o.destroyedAt === undefined);
  const parked = { ...car.position };
  let farthest = 0;
  for (let i = 0; i < 10; i++) {
    h.tick();
    const at = car.driven!.at;
    farthest = Math.max(farthest, dist(at, parked));
    assert.ok(!solids.some((o) => insideOf(o, at)), `never through another piece at ${JSON.stringify(at)}`);
    assert.ok(at.z >= LANDMARKS.road.minZ && at.z <= LANDMARKS.road.maxZ, 'on the road');
  }
  assert.ok(farthest > 6, `well up the street: ${farthest.toFixed(1)} m`);
  // The horde lands mid-trip: the car is parked where it stands (drawn home again) and dave jogs back from the road.
  const where = { ...dave.position };
  spawnGroup(h.state.combat, 3);
  h.state.combat.paused = false;
  h.state.combat.wave.phase = 'wave';
  h.tick();
  assert.equal(car.driven, undefined, 'no longer driven');
  assert.deepEqual(car.position, parked);
  assert.equal(dave.errand?.phase, 'returning');
  assert.ok(dist(dave.position, where) < 3, `heads home from where the car was: ${JSON.stringify(dave.position)}`);
  await h.speak('erin', '!drive');
  assert.ok(h.said.includes("!drive can wait till the wave's done."), JSON.stringify(h.said.slice(-2)));
  h.state.combat.paused = true;
  h.state.combat.zombies = [];
  h.until(() => !dave.errand, 120);
  assert.ok(onPavement(dave));
});

test('!ride: the figure catches up with a horse, sits on its back wherever it wanders, and gets off after the verb’s seconds', async () => {
  const h = harness();
  const job = await h.request('Build a horse at -17,10', 'ana');
  assert.equal(job.status, 'complete', job.error);
  const horse = h.state.objects.find((o) => o.verb?.word === 'ride')!;
  assert.ok(horse.creature, 'a living build');
  assert.deepEqual(verbViews(h.state).find((v) => v.verb === '!ride'), { verb: '!ride', needs: 'Yard horse', unlocked: true });
  await h.speak('dave', '!ride');
  assert.ok(h.said.includes('dave is off to the yard horse.'), JSON.stringify(h.said.slice(-2)));
  const dave = h.member('dave')!;
  assert.equal(dave.errand?.tries, 0);
  // The horse wanders off while dave is on his way: he re-plans (a few times at most) and still gets there.
  h.ticks(2);
  horse.position = { x: horse.position.x + 8, z: horse.position.z };
  horse.creature!.path = [];
  const went = h.until(() => dave.errand?.phase === 'doing', 120);
  assert.equal(dave.errand?.phase, 'doing', `mounted after ${went} ticks`);
  assert.ok((dave.errand?.tries ?? 0) >= 1, 'went after it');
  assert.deepEqual(dave.position, horse.position, 'on its back');
  assert.equal(dave.errand?.y, mountHeight(horse));
  assert.ok(dave.errand!.y! > 0.3);
  assert.deepEqual(dave.pop, { text: 'GIDDYUP', at: h.time() });
  // Wherever it goes, the rider goes: the creature ticks first, the rider copies it the same tick.
  let carried = 0;
  const from = { ...horse.position };
  for (let i = 0; i < 20 && dave.errand?.phase === 'doing'; i++) {
    h.tick();
    assert.deepEqual(dave.position, horse.position);
    carried = Math.max(carried, dist(horse.position, from));
  }
  assert.ok(carried > 0.5, `the horse went somewhere with dave aboard: ${carried.toFixed(2)} m`);
  assert.equal(h.view('dave')!.errand?.pose, 'sit');
  h.until(() => dave.errand?.phase !== 'doing', 40);
  assert.equal(dave.errand?.phase, 'returning');
  h.until(() => !dave.errand, 120);
  assert.ok(onPavement(dave));
  // A horse that will not be caught: after three goes dave gives up and walks back.
  h.advance(WORD_COOLDOWN_MS.ride! + 1000);
  await h.speak('dave', '!ride');
  for (let i = 0; i < 200 && dave.errand && dave.errand.phase === 'going'; i++) {
    if (!dave.errand.path.length || dist(dave.position, horse.position) < 4) {
      horse.position = { x: horse.position.x + (horse.position.x > 0 ? -12 : 12), z: 10 };
      horse.creature!.path = [];
    }
    h.tick();
  }
  assert.ok(!dave.errand || dave.errand.phase === 'returning', `gave up: ${JSON.stringify(dave.errand)}`);
  assert.equal(CHASE.tries, 3);
});

test('!fight: the robot stands its ground, the rounds run, and the app decides — a win sends it bolting, a loss lays the figure flat; Rook and the neighbours hear the result', async () => {
  const won = harness({}, () => 0.1);
  won.state.objects.push(robot());
  const bot = won.state.objects.find((o) => o.id === 'robot')!;
  assert.deepEqual(verbViews(won.state).find((v) => v.verb === '!fight'), { verb: '!fight', needs: 'Yard robot', unlocked: true });
  await won.speak('dave', '!fight');
  assert.ok(won.said.includes('dave is squaring up to the yard robot.'), JSON.stringify(won.said.slice(-2)));
  const dave = won.member('dave')!;
  won.until(() => dave.errand?.phase === 'doing', 60);
  assert.equal(dave.errand?.phase, 'doing');
  assert.equal(dave.errand?.pose, 'punch');
  assert.ok(dist(dave.position, bot.position) <= CHASE.reach);
  assert.ok(bot.creature!.busyMs! > 0, 'the robot squares up');
  assert.ok(Math.abs(dave.facing - Math.atan2(bot.position.x - dave.position.x, bot.position.z - dave.position.z)) < 1e-9, 'facing it');
  assert.ok(Math.abs(bot.creature!.facing - Math.atan2(dave.position.x - bot.position.x, dave.position.z - bot.position.z)) < 1e-9, 'and it faces back');
  assert.deepEqual(dave.pop, { text: 'CLANG', at: won.time() });
  const stood = { ...bot.position };
  won.ticks(9);
  assert.deepEqual(bot.position, stood, 'it does not wander mid-bout');
  assert.equal(dave.errand?.result, undefined);
  won.tick();
  assert.equal(dave.errand?.result, 'won', 'five seconds of rounds, then decided');
  assert.equal(dave.errand?.pose, 'cheer');
  assert.deepEqual(dave.pop, { text: 'KO', at: won.time() });
  assert.equal(bot.creature!.busyMs, 0);
  assert.equal(bot.creature!.scaredMs, SCRAP.boltMs, 'the loser bolts');
  assert.equal(won.view('dave')!.errand?.result, 'won');
  won.world.stateSchema.parse(JSON.parse(JSON.stringify(won.state)));
  won.ticks(6);
  assert.equal(dave.errand?.phase, 'returning');
  won.ticks(30);
  const wonLine = renderedPool('fight:won', { user: 'dave', name: speakName(bot) });
  assert.ok(won.said.some((l) => wonLine.includes(l)), `Rook on the win: ${JSON.stringify(won.said.slice(-6))}`);
  // The other way round.
  const lost = harness({}, () => 0.9);
  lost.state.objects.push(robot());
  const bot2 = lost.state.objects.find((o) => o.id === 'robot')!;
  await lost.speak('erin', '!fight');
  const erin = lost.member('erin')!;
  lost.until(() => dave.errand?.phase === 'doing' || erin.errand?.phase === 'doing', 60);
  lost.until(() => !!erin.errand?.result, 20);
  assert.equal(erin.errand?.result, 'lost');
  assert.equal(erin.errand?.pose, 'lie');
  assert.deepEqual(erin.pop, { text: 'OOF', at: lost.time() });
  assert.equal(bot2.creature!.scaredMs, undefined, 'the winner stays put');
  lost.ticks(6);
  assert.equal(erin.errand?.phase, 'doing', 'flat out for a few seconds');
  lost.ticks(2);
  assert.equal(erin.errand?.phase, 'returning');
  lost.ticks(30);
  const lostLine = renderedPool('fight:lost', { user: 'erin', name: speakName(bot2) });
  assert.ok(lost.said.some((l) => lostLine.includes(l)), `Rook on the loss: ${JSON.stringify(lost.said.slice(-6))}`);
  assert.equal(WORD_COOLDOWN_MS.fight, 60_000);
  assert.equal(GENERIC_COOLDOWN_MS, 30_000);
});

test('a living build carries only ride or fight; a swim on a creature is neither listed nor answered; restart clears a run and a scrap', async () => {
  const h = harness();
  const odd = piece('odd', { x: 12, z: 10 }, { creature: freshCreature('roam'), verb: { word: 'swim', pose: 'swim', spot: 'on', seconds: 8 }, name: 'Odd fish' });
  h.state.objects.push(odd);
  assert.equal(verbViews(h.state).find((v) => v.verb === '!swim'), undefined);
  await h.speak('dave', '!swim');
  assert.ok(h.said.includes('!swim needs something to swim in standing. Build one.'), JSON.stringify(h.said.slice(-2)));
  // A design that puts a non-creature verb on a creature loses the verb; ride survives an edit.
  const job = await h.request('Build a horse at -17,10', 'ana');
  assert.equal(job.status, 'complete', job.error);
  const horse = h.state.objects.find((o) => o.verb?.word === 'ride')!;
  const painted = await h.request('Paint the yard horse white', 'ben');
  assert.equal(painted.status, 'complete', painted.error);
  assert.equal(h.state.objects.find((o) => o.id === horse.id)?.verb?.word, 'ride');
  // Restart: a piece left `driven` and a creature left `busyMs` are cleared.
  const car = piece('car', { x: -7, z: 10 }, { verb: { word: 'drive', pose: 'sit', spot: 'on', seconds: 12 }, size: [1.8, 1.8, 3.9] });
  car.driven = { at: { x: 3, z: 10 }, turn: 1, by: 'dave', until: h.time() + 5000 };
  odd.creature!.busyMs = 4000;
  h.state.objects.push(car);
  h.world.stateSchema.parse(JSON.parse(JSON.stringify(h.state)));
  h.world.start?.(h.ctx);
  assert.equal(car.driven, undefined);
  assert.equal(odd.creature!.busyMs, 0);
});
