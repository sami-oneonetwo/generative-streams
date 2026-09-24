// Chat verbs: builds unlock bang commands, and the chatter's own figure on the pavement does the
// thing. `!shoot` while a hoop stands (a jog over, a throw, a jog back, a scoreboard), `!honk`
// while a car stands (a horn the birds hate), `!dance` while speakers play, `!verbs` to ask.
// Zero AI calls; nothing here touches the model.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSafehouseWorld } from '../src/worlds/safehouse';
import { VERBS, HONK_GAP_MS, DANCE_MS, BOARD_WINDOW_MS, parseVerb, verbViews, hoopsBoard, describeVerbs } from '../src/worlds/safehouse/verbs';
import { ERRAND, EFFECT_TTL_MS, PAVEMENT_Z, slotPosition, crowdViews, tickCrowd } from '../src/worlds/safehouse/crowd';
import { spawnGroup, initializeObject, damageObject } from '../src/worlds/safehouse/combat';
import { freshCreature } from '../src/worlds/safehouse/creatures';
import { renderedPool } from '../src/worlds/safehouse/voice';
import { active, type SafehouseState } from '../src/worlds/safehouse/state';
import type { SafehouseObject, Use } from '../src/shared/safehouseTypes';
import type { WorldCtx, ChatMessage } from '../src/engine/world';

const piece = (id: string, position: { x: number; z: number }, extra: Partial<SafehouseObject> & { uses?: Use[]; name?: string } = {}): SafehouseObject => {
  const { uses, name, ...rest } = extra;
  return initializeObject({
    id,
    revision: 1,
    createdAt: 0,
    createdBy: 'Jake',
    editedBy: 'Jake',
    position,
    footprint: { width: 1, depth: 1 },
    blueprint: {
      name: name ?? id,
      description: '',
      parts: [{ shape: 'box', position: [0, 1, 0], size: [1, 2, 1], rotation: [0, 0, 0], color: '#888888' }],
    },
    fixed: true,
    ...(uses ? { uses } : {}),
    ...rest,
  });
};
const HOOP = { x: 22, z: 3.5 };
const hoop = () => piece('neighbour-east-hoop', HOOP, { uses: ['hoop'], name: "Jake's basketball hoop", owner: 'east' });
const car = () => piece('scenery-car', { x: 9, z: 0.15 }, { uses: ['vehicle', 'perch'], name: "Rook's car", createdBy: 'Neighborhood', editedBy: 'Neighborhood' });
const speakers = () => piece('stack', { x: 0, z: 7 }, { uses: ['music'], name: 'Speaker stack', fixed: false, createdBy: 'ivy', editedBy: 'ivy' });
const bird = (id: string, position: { x: number; z: number }) => {
  const creature = freshCreature('roam', true);
  creature.altitude = 5;
  return piece(id, position, { creature, wild: true, name: 'Sparrow', createdBy: 'Neighborhood', editedBy: 'Neighborhood' });
};

function harness(rng: () => number = () => 0.5) {
  let now = 10_000;
  const said: string[] = [];
  const world = createSafehouseWorld({ fixture: true, workMs: 20_000, seedScenery: false, neighbours: false, wildlife: false });
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
  const member = (username: string) => state.crowd?.find((m) => m.id === `dev:${username}`);
  return { world, state, ctx, said, speak, tick, ticks, member, advance: (ms: number) => (now += ms), time: () => now };
}
const onPavement = (m: { position: { x: number; z: number } } | undefined) => !!m && Math.abs(m.position.z - PAVEMENT_Z) < 0.01;

test('parseVerb: the five words, with and without arguments, any case; anything else is not a verb', () => {
  assert.deepEqual(parseVerb('!shoot'), { verb: 'shoot', rest: '' });
  assert.deepEqual(parseVerb('!Shoot at the hoop'), { verb: 'shoot', rest: 'at the hoop' });
  assert.deepEqual(parseVerb('  !HONK'), { verb: 'honk', rest: '' });
  assert.deepEqual(parseVerb('!dance!'), { verb: 'dance', rest: '!' });
  assert.deepEqual(parseVerb('!verbs'), { verb: 'verbs', rest: '' });
  assert.deepEqual(parseVerb('!help me'), { verb: 'verbs', rest: 'me' });
  assert.equal(parseVerb('!weird'), undefined);
  assert.equal(parseVerb('!shooting'), undefined);
  assert.equal(parseVerb('shoot'), undefined);
  assert.equal(parseVerb('!delete the duck'), undefined);
  assert.equal(VERBS.length, 3);
});

test('verbViews: a verb is unlocked while a standing piece with its use is about, and not otherwise', () => {
  const h = harness();
  assert.deepEqual(
    verbViews(h.state).map((v) => [v.verb, v.unlocked]),
    [
      ['!shoot', false],
      ['!honk', false],
      ['!dance', false],
    ],
  );
  h.state.objects.push(hoop(), car());
  const views = verbViews(h.state);
  assert.equal(views.find((v) => v.verb === '!shoot')!.unlocked, true);
  assert.equal(views.find((v) => v.verb === '!honk')!.unlocked, true);
  assert.equal(views.find((v) => v.verb === '!dance')!.unlocked, false);
  assert.equal(views.find((v) => v.verb === '!shoot')!.needs, 'a basketball hoop');
  // Knocked down, it no longer counts.
  damageObject(h.state.objects.find((o) => o.id === 'neighbour-east-hoop')!, 1000, 0);
  assert.equal(verbViews(h.state).find((v) => v.verb === '!shoot')!.unlocked, false);
});

test('!shoot with no hoop standing is refused with the plain line, and nothing is queued', async () => {
  const h = harness();
  await h.speak('dave', '!shoot');
  assert.ok(h.said.includes('!shoot needs a basketball hoop standing. Build one.'), JSON.stringify(h.said));
  assert.equal(h.state.jobs.length, 0, 'no job: a verb never spends Rook');
  assert.equal(h.member('dave')?.errand, undefined);
  assert.ok(onPavement(h.member('dave')), 'still on the kerb');
});

test('!shoot: the figure leaves the pavement, jogs to the hoop, throws, scores a row, and jogs back to its slot', async () => {
  const h = harness();
  h.state.objects.push(hoop());
  await h.speak('dave', '!shoot');
  assert.ok(h.said.includes("dave is off to Jake's basketball hoop."), JSON.stringify(h.said));
  const dave = h.member('dave')!;
  assert.equal(dave.errand?.phase, 'going');
  assert.equal(dave.errand?.targetId, 'neighbour-east-hoop');
  assert.equal(h.state.jobs.length, 0);
  // Off the kerb within a couple of ticks; at the stand spot within fifteen seconds (~25 m at a jog).
  h.ticks(2);
  assert.ok(!onPavement(dave), `off the pavement: ${JSON.stringify(dave.position)}`);
  let arrived = 0;
  for (let i = 0; i < 30 && dave.errand?.phase === 'going'; i++) {
    h.tick();
    arrived++;
  }
  assert.equal(dave.errand?.phase, 'doing', `arrived after ${arrived} ticks`);
  const off = Math.hypot(dave.position.x - HOOP.x, dave.position.z - HOOP.z);
  assert.ok(off > 2.5 && off < 4.2, `stands back from the hoop (${off.toFixed(2)} m)`);
  assert.ok(Math.abs(dave.facing - Math.atan2(HOOP.x - dave.position.x, HOOP.z - dave.position.z)) < 0.01, 'facing the hoop');
  const views = crowdViews(h.state, h.time());
  assert.deepEqual(views.find((v) => v.id === 'dev:dave')!.errand, { kind: 'shoot', phase: 'doing', targetId: 'neighbour-east-hoop' });
  // Four seconds of throw, then the shot lands (rng 0.5: a miss) and they head home.
  const at = { ...dave.position };
  h.ticks(7);
  assert.deepEqual(dave.position, at, 'held still through the throw');
  assert.equal(dave.errand?.phase, 'doing');
  h.ticks(2);
  assert.equal(dave.errand?.phase, 'returning');
  assert.deepEqual(h.state.scores?.dave && { shots: h.state.scores.dave.shots, hits: h.state.scores.dave.hits, streak: h.state.scores.dave.streak }, {
    shots: 1,
    hits: 0,
    streak: 0,
  });
  assert.deepEqual(dave.shot && { hit: dave.shot.hit }, { hit: false });
  assert.deepEqual(crowdViews(h.state, h.time()).find((v) => v.id === 'dev:dave')!.shot, dave.shot, 'the page gets the miss');
  h.ticks(30);
  assert.equal(dave.errand, undefined, 'errand over');
  assert.deepEqual(dave.position, slotPosition(dave.slot), 'back in their slot');
  assert.equal(crowdViews(h.state, h.time()).find((v) => v.id === 'dev:dave')!.shot, undefined, 'the pop is gone after a few seconds');
  assert.deepEqual(hoopsBoard(h.state, h.time()), [{ user: 'dave', hits: 0, shots: 1, streak: 0 }]);
  h.world.stateSchema.parse(JSON.parse(JSON.stringify(h.state)));
});

test('cooldown and the queue: dave cannot shoot twice in 45 s; erin waits behind him and goes when he is back', async () => {
  const h = harness();
  h.state.objects.push(hoop());
  await h.speak('dave', '!shoot');
  h.ticks(2);
  await h.speak('dave', '!shoot');
  assert.ok(h.said.includes('Give it a moment, dave.'), JSON.stringify(h.said.slice(-3)));
  await h.speak('erin', '!shoot');
  assert.ok(h.said.includes('erin is next at the hoop.'), JSON.stringify(h.said.slice(-3)));
  // (strict assert.equal narrows the property; read the member fresh each time.)
  assert.equal(h.member('erin')!.errand, undefined, 'waiting on the kerb');
  assert.ok(onPavement(h.member('erin')));
  // Dave finishes; erin sets off on the same tick he lands.
  for (let i = 0; i < 80 && h.member('dave')!.errand; i++) h.tick();
  assert.equal(h.member('dave')!.errand, undefined);
  assert.equal(h.member('erin')!.errand?.phase, 'going', 'erin is on her way');
  for (let i = 0; i < 80 && h.member('erin')!.errand; i++) h.tick();
  assert.equal(h.state.scores?.erin?.shots, 1);
  // Forty-five seconds on, dave may shoot again.
  h.advance(46_000);
  await h.speak('dave', '!shoot');
  assert.equal(h.member('dave')!.errand?.phase, 'going');
});

test('a wave refuses the verb, turns a shooter mid-errand back to the kerb, and a fallen hoop does too', async () => {
  const h = harness();
  h.state.objects.push(hoop());
  await h.speak('dave', '!shoot');
  h.ticks(3);
  assert.equal(h.member('dave')!.errand?.phase, 'going');
  spawnGroup(h.state.combat, 3);
  h.state.combat.paused = false;
  h.state.combat.wave.phase = 'wave';
  h.tick();
  assert.equal(h.member('dave')!.errand?.phase, 'returning', 'turned back');
  assert.equal(crowdViews(h.state, h.time()).find((v) => v.id === 'dev:dave')!.running, true, 'running in the view');
  await h.speak('erin', '!shoot');
  assert.ok(h.said.includes("!shoot can wait till the wave's done."), JSON.stringify(h.said.slice(-2)));
  h.state.combat.paused = true;
  h.state.combat.zombies = [];
  for (let i = 0; i < 60 && h.member('dave')!.errand; i++) h.tick();
  assert.equal(h.member('dave')!.errand, undefined);
  // The hoop goes while sam is on his way: back he comes, no shot recorded.
  h.advance(50_000);
  await h.speak('sam', '!shoot');
  h.ticks(3);
  assert.equal(h.member('sam')!.errand?.phase, 'going');
  damageObject(h.state.objects.find((o) => o.id === 'neighbour-east-hoop')!, 1000, h.state.combat.time);
  h.tick();
  assert.equal(h.member('sam')!.errand?.phase, 'returning');
  for (let i = 0; i < 60 && h.member('sam')!.errand; i++) h.tick();
  assert.equal(h.state.scores?.sam, undefined, 'no shot without a hoop');
  assert.ok(onPavement(h.member('sam')));
});

test('hoopsBoard: hits first, then fewer shots, top five, only chatters who shot in the last half hour', () => {
  const now = 1_000_000;
  const scores = {
    ana: { shots: 4, hits: 2, streak: 1, best: 2, lastAt: now - 60_000 },
    ben: { shots: 2, hits: 2, streak: 2, best: 2, lastAt: now - 120_000 },
    cara: { shots: 9, hits: 1, streak: 0, best: 1, lastAt: now - 10_000 },
    dan: { shots: 1, hits: 1, streak: 1, best: 1, lastAt: now - BOARD_WINDOW_MS - 1 },
    eve: { shots: 1, hits: 0, streak: 0, best: 0, lastAt: now },
    fay: { shots: 3, hits: 0, streak: 0, best: 0, lastAt: now },
    gus: { shots: 5, hits: 0, streak: 0, best: 0, lastAt: now },
  };
  const board = hoopsBoard({ scores }, now);
  assert.deepEqual(
    board.map((r) => r.user),
    ['ben', 'ana', 'cara', 'eve', 'fay'],
  );
  assert.equal(board.length, 5);
  assert.deepEqual(hoopsBoard({ scores: {} }, now), []);
  assert.deepEqual(hoopsBoard({}, now), []);
});

test('!honk: the nearest car sounds off, the birds take off, the horn has a gate and the chatter a cooldown, effects fade', async () => {
  const h = harness();
  h.state.objects.push(car(), bird('wild-bird-1', { x: 14, z: 4 }), bird('wild-bird-2', { x: 40, z: 4 }));
  const near = h.state.objects.find((o) => o.id === 'wild-bird-1')!;
  near.creature!.goal = { rule: 0, targetId: 'x', dwellMs: 5000, arrived: true, perched: true, altitude: 2 };
  await h.speak('dave', '!honk');
  assert.equal(h.state.effects?.length, 1);
  assert.equal(h.state.effects![0].kind, 'honk');
  assert.equal(h.state.effects![0].objectId, 'scenery-car');
  assert.equal(h.state.effects![0].user, 'dave');
  assert.equal(near.creature!.scaredMs, 8000, 'the bird eight metres off takes fright');
  assert.equal(near.creature!.goal, undefined, 'and leaves its perch');
  assert.equal(h.state.objects.find((o) => o.id === 'wild-bird-2')!.creature!.scaredMs, undefined, 'the far bird did not hear it');
  assert.ok(!h.said.some((l) => /needs|moment/.test(l)), JSON.stringify(h.said));
  // Another chatter straight after: the horn is still ringing.
  h.tick();
  await h.speak('erin', '!honk');
  assert.ok(h.said.some((l) => /still ringing/.test(l)), JSON.stringify(h.said.slice(-2)));
  assert.equal(h.state.effects?.length, 1);
  // Nine seconds on erin may honk; dave is on his own cooldown.
  h.advance(HONK_GAP_MS + 1000);
  await h.speak('erin', '!honk');
  assert.equal(h.state.effects?.length, 2, 'a second horn');
  await h.speak('dave', '!honk');
  assert.ok(h.said.includes('Give it a moment, dave.'), JSON.stringify(h.said.slice(-2)));
  // The snapshot carries them, and they fade after ten seconds.
  const scene = h.world.buildScene(h.state, { protagonist: { x: 0, state: 'idle' }, pendingTasks: [], logLines: [], recentChat: [], chatRevision: 0, now: h.time() }).safehouse!;
  assert.equal(scene.effects?.length, 2);
  h.advance(EFFECT_TTL_MS + 1000);
  h.tick();
  assert.equal(h.state.effects?.length ?? 0, 0, 'faded');
  const later = h.world.buildScene(h.state, { protagonist: { x: 0, state: 'idle' }, pendingTasks: [], logLines: [], recentChat: [], chatRevision: 0, now: h.time() }).safehouse!;
  assert.equal(later.effects, undefined);
  // No car at all: refused.
  h.state.objects = h.state.objects.filter((o) => o.id !== 'scenery-car');
  h.advance(60_000);
  await h.speak('dave', '!honk');
  assert.ok(h.said.includes('!honk needs a car or a van standing. Build one.'), JSON.stringify(h.said.slice(-2)));
});

test('!dance needs speakers; with them the figure dances on the kerb for a while and the view says so', async () => {
  const h = harness();
  await h.speak('dave', '!dance');
  assert.ok(h.said.includes('!dance needs speakers standing. Build one.'), JSON.stringify(h.said));
  h.state.objects.push(speakers());
  await h.speak('dave', '!dance');
  const dave = h.member('dave')!;
  assert.equal(dave.dancingUntil, h.time() + DANCE_MS);
  assert.ok(onPavement(dave), 'dancing where they stand');
  assert.equal(crowdViews(h.state, h.time()).find((v) => v.id === 'dev:dave')!.dancingUntil, dave.dancingUntil);
  h.advance(DANCE_MS + 500);
  h.tick();
  assert.equal(dave.dancingUntil, undefined, 'and stops');
  assert.equal(crowdViews(h.state, h.time()).find((v) => v.id === 'dev:dave')!.dancingUntil, undefined);
});

test('!verbs and !help say what is unlocked (with the piece) and what would unlock the rest', async () => {
  const h = harness();
  await h.speak('dave', '!verbs');
  assert.ok(h.said.includes('Nothing unlocked yet. Build a basketball hoop for !shoot, a car for !honk, speakers for !dance.'), JSON.stringify(h.said));
  h.state.objects.push(hoop(), car());
  await h.speak('dave', '!help');
  assert.ok(h.said.includes("Unlocked: !shoot (Jake's basketball hoop), !honk (Rook's car). Build speakers for !dance."), JSON.stringify(h.said.slice(-1)));
  h.state.objects.push(speakers());
  assert.equal(describeVerbs(h.state), "Unlocked: !shoot (Jake's basketball hoop), !honk (Rook's car), !dance (Speaker stack).");
  const scene = h.world.buildScene(h.state, { protagonist: { x: 0, state: 'idle' }, pendingTasks: [], logLines: [], recentChat: [], chatRevision: 0, now: h.time() }).safehouse!;
  assert.deepEqual(scene.verbs?.map((v) => v.unlocked), [true, true, true]);
  assert.deepEqual(scene.hoops, []);
});

test("Rook's lines: hello to the first shot ever, once; a word at three in a row; a word after four bricks", async () => {
  // Every shot goes in.
  const h = harness(() => 0.1);
  h.state.objects.push(hoop());
  await h.speak('dave', '!shoot');
  h.ticks(20); // the acknowledgement clears, the follow-up is spoken
  const first = renderedPool('hoops:first', { user: 'dave' });
  assert.ok(h.said.some((l) => first.includes(l)), `his hello: ${JSON.stringify(h.said)}`);
  const hellos = () => h.said.filter((l) => first.includes(l)).length;
  for (let i = 0; i < 100 && h.member('dave')!.errand; i++) h.tick();
  assert.equal(h.state.scores?.dave?.hits, 1);
  // Two more, a minute apart: the third lands the streak line; the hello is not repeated.
  for (let n = 2; n <= 3; n++) {
    h.advance(46_000);
    await h.speak('dave', '!shoot');
    for (let i = 0; i < 100 && h.member('dave')!.errand; i++) h.tick();
    assert.equal(h.state.scores?.dave?.hits, n);
  }
  assert.equal(h.state.scores?.dave?.streak, 3);
  assert.equal(h.state.scores?.dave?.best, 3);
  h.ticks(30);
  const streak = renderedPool('hoops:streak', { user: 'dave' });
  assert.ok(h.said.some((l) => streak.includes(l)), `on fire: ${JSON.stringify(h.said.slice(-6))}`);
  assert.equal(hellos(), 1, 'the hello was said once');
  // Somebody who cannot hit: four straight misses draw a word, the fifth does not (gated).
  const cold = harness(() => 0.9);
  cold.state.objects.push(hoop());
  for (let n = 1; n <= 5; n++) {
    cold.advance(46_000);
    await cold.speak('erin', '!shoot');
    for (let i = 0; i < 100 && cold.member('erin')!.errand; i++) cold.tick();
    cold.ticks(20);
  }
  assert.equal(cold.state.scores?.erin?.shots, 5);
  assert.equal(cold.state.scores?.erin?.hits, 0);
  const brick = renderedPool('hoops:brick', { user: 'erin' });
  assert.equal(cold.said.filter((l) => brick.includes(l)).length, 1, `one word about the bricks: ${JSON.stringify(cold.said.slice(-8))}`);
});

test('a bang word that is not a verb still goes down the request path; the saved shape round-trips', async () => {
  const h = harness();
  h.state.objects.push(hoop(), car());
  await h.speak('dave', '!weird thing');
  assert.ok(h.state.jobs.some((j) => j.username === 'dave'), 'admitted as a request');
  assert.ok(!h.said.some((l) => /needs .* standing/.test(l)));
  await h.speak('erin', '!shoot');
  await h.speak('sam', '!honk');
  h.ticks(3);
  const clone = JSON.parse(JSON.stringify(h.state));
  const parsed = h.world.stateSchema.parse(clone);
  assert.equal(parsed.crowd?.find((m) => m.id === 'dev:erin')?.errand?.phase, 'going');
  assert.equal(parsed.effects?.length, 1);
  // A queue whose shooter has gone (expired) lets the next one go: erin leaves, sam waits on the hoop, then sam goes.
  await h.speak('sam', '!shoot');
  assert.ok(h.said.includes('sam is next at the hoop.'), JSON.stringify(h.said.slice(-2)));
  h.state.crowd = h.state.crowd!.filter((m) => m.id !== 'dev:erin');
  h.tick();
  assert.equal(h.member('sam')!.errand?.phase, 'going', 'sam sets off once the hoop is free');
  // ERRAND's numbers are the app's.
  assert.equal(ERRAND.shotMs, 4000);
  assert.equal(ERRAND.hitChance, 0.45);
  assert.equal(ERRAND.queue, 3);
  // Queue full: with sam shooting and three waiting, a fifth is turned away.
  for (const u of ['tia', 'ulf', 'vic']) await h.speak(u, '!shoot');
  await h.speak('wes', '!shoot');
  assert.ok(h.said.includes('The hoop has a queue. Give it a minute, wes.'), JSON.stringify(h.said.slice(-2)));
  // Members on an errand or in the queue never expire while quiet.
  h.advance(11 * 60_000);
  tickCrowd(h.state, h.time(), 500, () => 0.5);
  assert.ok(h.member('sam'), 'sam, mid-errand, is still about');
});
