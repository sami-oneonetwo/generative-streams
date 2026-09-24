// The crowd: whoever speaks in chat stands on the pavement across the street, waves when they
// speak, lines up with their own build while it goes up, runs for the ends when a wave lands,
// and wanders off after ten quiet minutes. Zero AI calls; nothing here touches the model.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSafehouseWorld } from '../src/worlds/safehouse';
import {
  PAVEMENT_Z,
  SLOT_SPACING,
  PAVEMENT_REACH,
  EXPIRE_MS,
  WATCH_MS,
  slotPosition,
  noteChatter,
  tickCrowd,
  crowdViews,
  describeCrowd,
} from '../src/worlds/safehouse/crowd';
import { spawnGroup } from '../src/worlds/safehouse/combat';
import { renderedPool } from '../src/worlds/safehouse/voice';
import { persona } from '../src/worlds/safehouse/persona';
import { active, MAX_CROWD, type SafehouseState } from '../src/worlds/safehouse/state';
import type { WorldCtx, ChatMessage } from '../src/engine/world';

function harness(options: Parameters<typeof createSafehouseWorld>[0] = {}) {
  let now = 10_000;
  const said: string[] = [];
  const world = createSafehouseWorld({ fixture: true, workMs: 20_000, seedScenery: false, neighbours: false, ...options });
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
    rng: () => 0.5,
  };
  world.start?.(ctx);
  let seq = 0;
  const message = (username: string, text = 'hello', userId = `dev:${username}`): ChatMessage => ({
    id: `m${++seq}`,
    userId,
    username,
    text,
    ts: now,
    source: 'dev',
  });
  /** What the engine does on arrival: the world's first look at the message, then admission. */
  async function speak(username: string, text = 'hello') {
    const msg = message(username, text);
    world.receiveMessage!(ctx, msg);
    await world.intents[0].handle(ctx, msg, undefined);
    return msg;
  }
  function tick(ms = 500) {
    now += ms;
    world.tick(ctx, ms);
  }
  return { world, state, ctx, said, message, speak, tick, advance: (ms: number) => (now += ms), time: () => now };
}
const member = (state: SafehouseState, id: string) => state.crowd?.find((m) => m.id === id);

test('slots grow outward from the middle along the far kerb', () => {
  assert.deepEqual(slotPosition(0), { x: 0, z: PAVEMENT_Z });
  assert.deepEqual(slotPosition(1), { x: -SLOT_SPACING, z: PAVEMENT_Z });
  assert.deepEqual(slotPosition(2), { x: SLOT_SPACING, z: PAVEMENT_Z });
  assert.deepEqual(slotPosition(3), { x: -2 * SLOT_SPACING, z: PAVEMENT_Z });
  const span = slotPosition(MAX_CROWD - 1).x;
  assert.ok(Math.abs(span) < PAVEMENT_REACH - 10, `forty slots stay well inside the block (${span})`);
  assert.ok(PAVEMENT_Z > 14 && PAVEMENT_Z < 15, 'the row stands on the far pavement, not in the road or the yard');
});

test('a message puts a figure on the pavement; the next chatter stands beside them; a regular is not doubled', () => {
  const h = harness();
  const first = noteChatter(h.state, { userId: 'dev:dave', username: 'dave' }, h.time());
  assert.deepEqual(first, { first: true, count: 1 });
  const dave = member(h.state, 'dev:dave')!;
  assert.equal(dave.slot, 0);
  assert.deepEqual(dave.position, { x: 0, z: PAVEMENT_Z });
  assert.equal(dave.facing, Math.PI, 'standing, they face the yard');
  h.advance(1000);
  const second = noteChatter(h.state, { userId: 'dev:erin', username: 'erin' }, h.time());
  assert.deepEqual(second, { first: false, count: 2 });
  assert.deepEqual(member(h.state, 'dev:erin')!.position, slotPosition(1));
  h.advance(1000);
  const again = noteChatter(h.state, { userId: 'dev:dave', username: 'Dave' }, h.time());
  assert.deepEqual(again, { first: false, count: 2 }, 'the same chatter again is the same figure');
  assert.equal(dave.lastAt, h.time(), 'their lastAt is refreshed');
  assert.equal(dave.name, 'Dave', 'and their name is as they type it now');
  assert.equal(dave.slot, 0);
});

test('the pavement holds forty; the quietest makes room and the newcomer takes their spot', () => {
  const h = harness();
  for (let i = 0; i < MAX_CROWD; i++) {
    h.advance(1000);
    noteChatter(h.state, { userId: `dev:u${i}`, username: `u${i}` }, h.time());
  }
  assert.equal(h.state.crowd!.length, MAX_CROWD);
  const quietest = h.state.crowd!.reduce((a, b) => (b.lastAt < a.lastAt ? b : a));
  assert.equal(quietest.id, 'dev:u0');
  h.advance(1000);
  noteChatter(h.state, { userId: 'dev:late', username: 'late' }, h.time());
  assert.equal(h.state.crowd!.length, MAX_CROWD, 'still forty');
  assert.equal(member(h.state, 'dev:u0'), undefined, 'the quietest has gone');
  assert.equal(member(h.state, 'dev:late')!.slot, quietest.slot, 'the newcomer took their spot');
  const slots = new Set(h.state.crowd!.map((m) => m.slot));
  assert.equal(slots.size, MAX_CROWD, 'no two people share a spot');
  h.ctx.checkpoint!(); // the save schema takes a full pavement
});

test('ten quiet minutes and a viewer wanders off', () => {
  const h = harness();
  noteChatter(h.state, { userId: 'dev:dave', username: 'dave' }, h.time());
  h.advance(EXPIRE_MS - 5000);
  noteChatter(h.state, { userId: 'dev:erin', username: 'erin' }, h.time());
  tickCrowd(h.state, h.time(), 500);
  assert.ok(member(h.state, 'dev:dave'), 'not yet');
  h.advance(10_000);
  tickCrowd(h.state, h.time(), 500);
  assert.equal(member(h.state, 'dev:dave'), undefined, 'dave has wandered off');
  assert.ok(member(h.state, 'dev:erin'), 'erin, who spoke later, is still there');
});

test('a viewer drifts along the pavement to line up with their own build, then home a minute after it lands', async () => {
  const h = harness();
  await h.speak('dave', 'Build a barricade at -20,-14');
  const dave = member(h.state, 'dev:dave')!;
  assert.equal(dave.position.x, 0);
  // Rook designs (fixture, instant), walks, then hammers for workMs; dave lines up meanwhile.
  for (let i = 0; i < 40 && !h.state.jobs.some((j) => active(j) && j.status === 'building'); i++) {
    h.tick();
    await new Promise((r) => setImmediate(r));
  }
  assert.ok(h.state.jobs.some((j) => active(j) && j.status === 'building'), 'the build is under way');
  assert.equal(dave.watching, h.state.jobs.find(active)!.preview!.id, 'dave is watching his own build');
  assert.ok(dave.position.x < -3, `he has set off toward it along the kerb (${dave.position.x})`);
  assert.equal(dave.position.z, PAVEMENT_Z, 'and never leaves the pavement');
  assert.ok(dave.facing < 0, 'facing the way he walks (toward −x)');
  for (let i = 0; i < 20; i++) h.tick();
  assert.ok(Math.abs(dave.position.x - -20) < 0.05, `and stands level with it (${dave.position.x})`);
  assert.equal(dave.facing, Math.PI, 'facing the yard once there');
  for (let i = 0; i < 60 && h.state.jobs.some(active); i++) {
    h.tick();
    await new Promise((r) => setImmediate(r));
  }
  assert.ok(!h.state.jobs.some(active), 'the build has landed');
  h.tick();
  assert.ok(dave.watching && dave.watchingUntil, 'he stays a while once it has landed');
  const views = crowdViews(h.state);
  assert.equal(views[0].watching, dave.watching, 'the page is told what he is looking at');
  assert.equal(views[0].running, undefined, 'walking to a build is not running');
  h.advance(WATCH_MS + 1000);
  h.tick();
  assert.equal(dave.watching, undefined, 'a minute on, he loses interest');
  for (let i = 0; i < 40; i++) h.tick();
  assert.equal(dave.position.x, 0, 'and is back at his spot');
});

test('a wave sends everyone running for the ends of the block, and they come back after', () => {
  const h = harness();
  for (const name of ['a', 'b', 'c', 'd']) noteChatter(h.state, { userId: `dev:${name}`, username: name }, h.time());
  h.state.combat.paused = false;
  h.state.combat.wave.phase = 'wave';
  spawnGroup(h.state.combat, 2);
  tickCrowd(h.state, h.time(), 500);
  for (const v of crowdViews(h.state)) assert.equal(v.running, true, `${v.name} is running`);
  for (let i = 0; i < 60; i++) {
    h.advance(500);
    tickCrowd(h.state, h.time(), 500);
  }
  const xs = h.state.crowd!.map((m) => m.position.x);
  assert.ok(xs.every((x) => Math.abs(x) === PAVEMENT_REACH), `everyone reached an end (${xs})`);
  assert.ok(xs.some((x) => x < 0) && xs.some((x) => x > 0), 'each side ran for its own end');
  for (const m of h.state.crowd!) assert.equal(m.position.z, PAVEMENT_Z);
  // Ran there at running pace: four seconds at 1.6 m/s would not have got anyone 40 m.
  h.state.combat.zombies = [];
  h.state.combat.wave.phase = 'prep';
  tickCrowd(h.state, h.time(), 500);
  assert.ok(crowdViews(h.state).every((v) => v.running === true), 'still hurrying home from the ends');
  for (let i = 0; i < 120; i++) {
    h.advance(500);
    tickCrowd(h.state, h.time(), 500);
  }
  for (const m of h.state.crowd!) assert.deepEqual(m.position, slotPosition(m.slot), `${m.name} is back in place`);
  assert.ok(crowdViews(h.state).every((v) => !v.running), 'and standing');
});

test('the operator can hide the crowd: the views empty, the pavement in the save does not', () => {
  const h = harness();
  noteChatter(h.state, { userId: 'dev:dave', username: 'dave' }, h.time());
  h.state.crowdHidden = true;
  assert.deepEqual(crowdViews(h.state), []);
  assert.equal(h.state.crowd!.length, 1);
  h.state.crowdHidden = false;
  assert.equal(crowdViews(h.state).length, 1);
  const hide = h.world.adminActions!.find((a) => a.id === 'safehouse-crowd-hide')!;
  const show = h.world.adminActions!.find((a) => a.id === 'safehouse-crowd-show')!;
  hide.run(h.ctx);
  assert.equal(h.state.crowdHidden, true);
  show.run(h.ctx);
  assert.equal(h.state.crowdHidden, false);
  // A reset keeps the switch like the other operator settings and clears the pavement itself.
  h.state.crowdHidden = true;
  const fresh = h.world.reset!(h.state, h.time());
  assert.equal(fresh.crowdHidden, true);
  assert.equal(fresh.crowd, undefined);
});

test('the snapshot carries the crowd with when each one last spoke, and Rook can list them', () => {
  const h = harness();
  noteChatter(h.state, { userId: 'dev:dave', username: 'dave' }, h.time());
  h.advance(2000);
  noteChatter(h.state, { userId: 'dev:erin', username: 'erin' }, h.time());
  const scene = h.world.buildScene(h.state, {
    protagonist: { x: 0, state: 'idle' },
    pendingTasks: [],
    logLines: [],
    recentChat: [],
    chatRevision: 0,
    now: h.time(),
  }).safehouse!;
  assert.equal(scene.crowd!.length, 2);
  const erin = scene.crowd!.find((v) => v.id === 'dev:erin')!;
  assert.equal(erin.wavedAt, h.time(), 'wavedAt is when they last spoke');
  assert.equal(erin.name, 'erin');
  assert.deepEqual(erin.position, slotPosition(1));
  assert.equal(scene.crowdHidden, false);
  assert.equal(describeCrowd(h.state, h.time()), 'watching from the pavement: 2 people (erin, dave)');
  for (let i = 0; i < 8; i++) noteChatter(h.state, { userId: `dev:x${i}`, username: `x${i}` }, h.time());
  assert.match(describeCrowd(h.state, h.time())!, /^watching from the pavement: 10 people \([^)]*, and 4 more\)$/);
  assert.match(persona.summarizeState(h.state, h.time()), /watching from the pavement: 10 people/);
  assert.equal(describeCrowd({ ...h.state, crowd: [] }, h.time()), undefined);
});

test('Rook says hello to the first person on the pavement, and notices a full one once', async () => {
  const h = harness();
  await h.speak('dave', 'rook you there');
  for (let i = 0; i < 40; i++) h.tick();
  const hello = h.said.filter((l) => renderedPool('crowd:first', { user: 'dave' }).includes(l));
  assert.equal(hello.length, 1, `one hello: ${JSON.stringify(h.said)}`);
  // A dozen more arrive (the hook alone: what they said is admission's business, and a burst of
  // status lines would rightly bury a remark). One remark on the crowd, not one per person.
  for (let i = 0; i < 12; i++) {
    h.advance(500);
    h.world.receiveMessage!(h.ctx, h.message(`v${i}`, 'hi'));
  }
  for (let i = 0; i < 40; i++) h.tick();
  const many = h.said.filter((l) => renderedPool('crowd:many', {}).includes(l));
  assert.equal(many.length, 1, `one remark on the crowd: ${JSON.stringify(h.said)}`);
  assert.equal(h.said.filter((l) => renderedPool('crowd:first', { user: 'dave' }).includes(l)).length, 1, 'no second hello');
  // Everyone leaves and one person comes back: he says hello again; the full-pavement line waits ten minutes.
  h.advance(EXPIRE_MS + 1000);
  h.tick();
  assert.equal(h.state.crowd!.length, 0);
  await h.speak('erin', 'rook hi');
  for (let i = 0; i < 40; i++) h.tick();
  assert.equal(h.said.filter((l) => renderedPool('crowd:first', { user: 'erin' }).includes(l)).length, 1, 'hello again');
});
