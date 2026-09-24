// The wave loop's tactics: a hole (`trap`) the horde walks into and is held by, speakers (`music`)
// it comes for and dances at before it chews. Every number is the app's (TACTICS in combat.ts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TACTICS,
  freshCombat,
  initializeObject,
  spawnZombie,
  tickCombat,
  isHeld,
  isDancing,
  isMusic,
  damageObject,
  intact,
} from '../src/worlds/safehouse/combat';
import { choosePlacement, isTrap, route } from '../src/worlds/safehouse/placement';
import { tickCreatures, freshCreature } from '../src/worlds/safehouse/creatures';
import { normalizeUses } from '../src/worlds/safehouse/blueprint';
import { SYSTEM_PROMPT, fixtureGenerator } from '../src/llm/blueprint';
import { createSafehouseWorld, type SafehouseOptions } from '../src/worlds/safehouse';
import { active, type SafehouseState } from '../src/worlds/safehouse/state';
import { SURVIVOR_START } from '../src/shared/safehouseLayout';
import type { SafehouseObject, GroundPoint, ZombieKind, Use } from '../src/shared/safehouseTypes';
import type { WorldCtx } from '../src/engine/world';

const lcg = (seed = 11) => () => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
};
const piece = (
  id: string,
  position: GroundPoint,
  extra: Partial<SafehouseObject> & { width?: number; depth?: number; uses?: Use[] } = {},
): SafehouseObject => {
  const { width = 2, depth = 1, uses, ...rest } = extra;
  return initializeObject({
    id,
    revision: 1,
    createdAt: 0,
    createdBy: 'dave',
    editedBy: 'dave',
    position,
    footprint: { width, depth },
    blueprint: {
      name: id,
      description: 'test',
      parts: [{ shape: 'box', position: [0, 0.5, 0], size: [width, 1, depth], rotation: [0, 0, 0], color: '#888888' }],
    },
    ...(uses ? { uses } : {}),
    ...rest,
  });
};
/** A hole: passable ground with the trap use. */
const hole = (id: string, position: GroundPoint, across = 3) =>
  piece(id, position, { width: across, depth: across, passable: true, uses: ['trap'], role: 'decoration' });
const speakers = (id: string, position: GroundPoint) => piece(id, position, { width: 1, depth: 1, uses: ['music'], role: 'decoration' });
const inside = (p: GroundPoint, o: SafehouseObject) =>
  Math.abs(p.x - o.position.x) <= o.footprint.width / 2 && Math.abs(p.z - o.position.z) <= o.footprint.depth / 2;
/** A wall to the south, a hole in the way, a zombie of the kind to the north; run the horde `ms` of combat time. */
function dig(kind: ZombieKind, extra: SafehouseObject[] = []) {
  const wall = piece('wall', { x: 3, z: 10 }, { role: 'barrier', width: 2, depth: 1 });
  const pit = hole('pit', { x: 3, z: 14 });
  const objects = [wall, pit, ...extra];
  const c = freshCombat(false);
  const z = spawnZombie(c, kind)!;
  z.position = { x: 3, z: 18 };
  z.attackAt = 0;
  const run = (ms: number) => {
    for (let t = 0; t < ms; t += 250) tickCombat(c, objects, 250);
  };
  return { c, z, wall, pit, objects, run };
}

test('TACTICS: the numbers are the app\'s', () => {
  assert.equal(TACTICS.trap.holdMs, 20_000);
  assert.equal(TACTICS.trap.bruteHoldMs, 8_000);
  assert.equal(TACTICS.trap.creatureHoldMs, 12_000);
  assert.equal(TACTICS.trap.capacity, 6);
  assert.equal(TACTICS.trap.max, 3);
  assert.equal(TACTICS.music.earshot, 18);
  assert.equal(TACTICS.music.danceMs, 4_000);
  assert.equal(TACTICS.music.max, 3);
});

test('a walker walks into the hole and is held twenty seconds, still and harmless, then climbs out and carries on', () => {
  const { c, z, wall, pit, run } = dig('walker');
  let fellAt: number | undefined;
  for (let t = 0; t < 8000 && fellAt === undefined; t += 250) {
    run(250); // 2.5 m at 0.7 m/s: in by the fourth second
    if (isHeld(z, c.time)) fellAt = c.time;
  }
  assert.ok(fellAt !== undefined, 'in the hole');
  assert.equal(z.heldIn, 'pit');
  assert.ok(inside(z.position, pit), `stopped inside the hole at ${JSON.stringify(z.position)}`);
  const at = { ...z.position };
  const releaseAt = z.heldUntil!;
  assert.ok(releaseAt - fellAt! > 19_500 && releaseAt - fellAt! <= 20_000, 'twenty seconds from falling in');
  run(19_000);
  assert.deepEqual(z.position, at, 'held still');
  assert.equal(wall.health, 240, 'nothing bitten from a hole');
  assert.ok(isHeld(z, c.time));
  run(2000);
  assert.ok(!isHeld(z, c.time), 'out');
  assert.equal(z.heldIn, 'pit', 'remembers which hole it is climbing out of');
  assert.ok((z.freeUntil ?? 0) > c.time, 'with a grace so the same hole does not take it back');
  run(6000);
  assert.ok(!inside(z.position, pit), `walked out of the hole (${JSON.stringify(z.position)})`);
  assert.ok(!isHeld(z, c.time), 'and not held again on the way out');
  run(12_000);
  assert.ok(wall.health! < 240, 'reached the wall in the end');
});

test('a brute climbs out in eight seconds; a runner jumps the hole altogether', () => {
  const brute = dig('brute');
  brute.run(12_000); // 0.45 m/s
  assert.ok(isHeld(brute.z, brute.c.time), 'the brute fell in');
  assert.ok(brute.z.heldUntil! - brute.c.time <= 8_000);
  brute.run(8_500);
  assert.ok(!isHeld(brute.z, brute.c.time), 'out after eight seconds');
  brute.run(8_000); // slower than the grace is long: the hole it is climbing out of still leaves it alone
  assert.ok(!isHeld(brute.z, brute.c.time), 'not taken straight back');
  assert.ok(!inside(brute.z.position, brute.pit), 'and clear of it');
  const runner = dig('runner');
  let everHeld = false;
  for (let t = 0; t < 12_000; t += 250) {
    tickCombat(runner.c, runner.objects, 250);
    if (isHeld(runner.z, runner.c.time)) everHeld = true;
  }
  assert.equal(everHeld, false, 'never held');
  assert.ok(runner.wall.health! < 240, 'and already at the wall');
});

test('six is the limit: the seventh walker walks straight over a full hole', () => {
  const wall = piece('wall', { x: 3, z: 10 }, { role: 'barrier' });
  const pit = hole('pit', { x: 3, z: 14 });
  const objects = [wall, pit];
  const c = freshCombat(false);
  const zombies = Array.from({ length: 7 }, (_, i) => {
    const z = spawnZombie(c, 'walker')!;
    z.position = { x: 2.2 + i * 0.25, z: 18 };
    z.attackAt = 0;
    return z;
  });
  for (let t = 0; t < 8000; t += 250) tickCombat(c, objects, 250);
  const held = zombies.filter((z) => isHeld(z, c.time));
  assert.equal(held.length, TACTICS.trap.capacity, `six held, saw ${held.length}`);
  const free = zombies.find((z) => !isHeld(z, c.time))!;
  for (let t = 0; t < 10_000; t += 250) tickCombat(c, objects, 250);
  assert.ok(!inside(free.position, pit) && !isHeld(free, c.time), 'the seventh walked on');
  assert.ok(wall.health! < 240, 'and bit the wall');
});

test('filling the hole in (its use gone) or removing it lets everyone out at once', () => {
  const a = dig('walker');
  a.run(6000);
  assert.ok(isHeld(a.z, a.c.time));
  a.pit.uses = []; // Marge's shovel
  a.run(250);
  assert.ok(!isHeld(a.z, a.c.time), 'released when the hole was filled');
  assert.ok((a.z.freeUntil ?? 0) > a.c.time);
  const b = dig('walker');
  b.run(6000);
  assert.ok(isHeld(b.z, b.c.time));
  b.objects.splice(b.objects.indexOf(b.pit), 1); // dug up / deleted
  b.run(250);
  assert.ok(!isHeld(b.z, b.c.time), 'released when the hole was gone');
});

test('a turret shoots a zombie in a hole: an easy kill', () => {
  const gun = piece('gun', { x: 7, z: 14 }, { role: 'turret', width: 1, depth: 1 });
  const { c, z, run, objects } = dig('walker');
  run(6000);
  assert.ok(isHeld(z, c.time));
  objects.push(gun); // set up beside the hole once it is in: four rounds and it is done
  run(4000);
  assert.ok(z.health <= 0 || c.kills === 1, `shot where it stood (${z.health} hp, ${c.kills} kills)`);
});

test('routing: Rook walks round a hole, the horde walks through it, and nothing is built on one', () => {
  const pit = hole('pit', { x: 3, z: 14 });
  const walked = route({ x: 3, z: 18 }, { x: 3, z: 10 }, [pit]);
  assert.ok(walked, 'Rook finds a way');
  assert.ok(walked!.every((p) => !inside(p, pit)), 'and it is round the hole');
  const shambled = route({ x: 3, z: 18 }, { x: 3, z: 10 }, [pit], { ignoreTraps: true });
  assert.ok(shambled!.some((p) => inside(p, pit)), 'the horde goes straight through');
  assert.throws(() => choosePlacement({ width: 1, depth: 1 }, [pit], { x: 8, z: 14 }, undefined, { x: 3, z: 14 }), /blocked|unreachable/);
  assert.ok(isTrap(pit));
  damageObject(pit, 1000, 0);
  assert.ok(!isTrap(pit), 'a hole that is gone is no trap');
});

test('a rampager charging past falls in and is stuck twelve seconds; a flyer sails over', () => {
  const crate = piece('crate', { x: 6, z: -12 }, { width: 1, depth: 1 });
  const pit = hole('pit', { x: 3, z: -12 }, 2);
  const gorilla = piece('g', { x: 0, z: -12 }, { creature: freshCreature('rampage'), width: 1, depth: 1 });
  const w = { objects: [crate, pit, gorilla], combat: freshCombat(true), survivor: { position: { ...SURVIVOR_START } } };
  const rng = lcg();
  let fell = false;
  for (let i = 0; i < 10 && !fell; i++) {
    tickCreatures(w, 500, rng); // 2.2 m/s: at the lip inside a second
    fell = (gorilla.creature!.heldMs ?? 0) > 0;
  }
  assert.ok(fell, `held (${gorilla.creature!.heldMs})`);
  assert.equal(gorilla.creature!.heldMs, TACTICS.trap.creatureHoldMs);
  assert.ok(inside(gorilla.position, pit), `in the hole at ${JSON.stringify(gorilla.position)}`);
  const at = { ...gorilla.position };
  for (let i = 0; i < 20; i++) tickCreatures(w, 500, rng); // 10 s of the 12
  assert.deepEqual(gorilla.position, at, 'stuck');
  assert.ok((gorilla.creature!.heldMs ?? 0) > 0, 'still stuck');
  assert.equal(crate.health, 80, 'no biting from a hole');
  for (let i = 0; i < 6; i++) tickCreatures(w, 500, rng);
  assert.equal(gorilla.creature!.heldMs, undefined, 'out after twelve seconds');
  assert.ok((gorilla.creature!.freeMs ?? 0) > 0, 'with a grace');
  for (let i = 0; i < 40; i++) tickCreatures(w, 500, rng);
  assert.ok(crate.health! < 80, 'and it got to the crate');
  // Wings: the same run, over the top.
  const dragon = piece('d', { x: 0, z: -12 }, { creature: freshCreature('rampage', true), width: 1, depth: 1 });
  dragon.creature!.altitude = 6.5;
  const crate2 = piece('crate2', { x: 6, z: -12 }, { width: 1, depth: 1 });
  const w2 = { objects: [crate2, hole('pit2', { x: 3, z: -12 }, 2), dragon], combat: freshCombat(true), survivor: { position: { ...SURVIVOR_START } } };
  for (let i = 0; i < 30; i++) tickCreatures(w2, 500, lcg(3));
  assert.equal(dragon.creature!.heldMs, undefined, 'never held');
  assert.ok(crate2.health! < 80, 'struck from the air');
});

test('the stray cat sitting where a hole is dug is stuck in it too', () => {
  const cat = piece('cat', { x: 3, z: -12 }, { creature: freshCreature('roam'), wild: true, fixed: true, width: 1, depth: 1 });
  const w = { objects: [hole('pit', { x: 3, z: -12 }, 2), cat], combat: freshCombat(true), survivor: { position: { ...SURVIVOR_START } } };
  tickCreatures(w, 500, lcg());
  assert.equal(cat.creature!.heldMs, TACTICS.trap.creatureHoldMs);
  for (let i = 0; i < 24; i++) tickCreatures(w, 500, lcg());
  assert.equal(cat.creature!.heldMs, undefined, 'out again');
});

test('speakers within earshot pull a zombie off a nearer wall; it dances four seconds, then chews, then moves on when they fall', () => {
  const wall = piece('wall', { x: 3, z: 10 }, { role: 'barrier' });
  const stack = speakers('stack', { x: -3, z: 10 });
  assert.ok(isMusic(stack));
  const objects = [wall, stack];
  const c = freshCombat(false);
  const z = spawnZombie(c, 'walker')!;
  z.position = { x: 2, z: 16 };
  z.attackAt = 0;
  tickCombat(c, objects, 250);
  assert.equal(z.targetId, 'stack', 'the sound wins over the nearer wall');
  let firstBeside: number | undefined,
    firstBite: number | undefined;
  for (let t = 0; t < 30_000 && firstBite === undefined; t += 250) {
    tickCombat(c, objects, 250);
    if (firstBeside === undefined && isDancing(z, c.time)) firstBeside = c.time;
    if (stack.health! < 80) firstBite = c.time;
  }
  assert.ok(firstBeside !== undefined, 'it danced');
  assert.ok(firstBite !== undefined && firstBite - firstBeside! >= TACTICS.music.danceMs - 250, `four seconds of dancing before the first bite (${firstBite! - firstBeside!} ms)`);
  damageObject(stack, 1000, c.time);
  for (let t = 0; t < 5000; t += 250) tickCombat(c, objects, 250);
  assert.equal(z.targetId, 'wall', 'on to the wall once the music stopped');
  assert.equal(z.dancingUntil, undefined, 'a new target is a new dance');
});

test('far speakers do not carry: out of earshot the horde ignores them', () => {
  const wall = piece('wall', { x: 3, z: 10 }, { role: 'barrier' });
  const stack = speakers('stack', { x: -40, z: 10 });
  const c = freshCombat(false);
  const z = spawnZombie(c, 'walker')!;
  z.position = { x: 2, z: 16 };
  tickCombat(c, [wall, stack], 250);
  assert.equal(z.targetId, 'wall');
});

test('the words: the normaliser maps holes and speakers, the prompt names both, the fixtures carry them', async () => {
  assert.deepEqual(normalizeUses('hole'), ['trap']);
  assert.deepEqual(normalizeUses(['speakers', 'bench']), ['music', 'seat']);
  assert.deepEqual(normalizeUses('a pit trap'), ['trap']);
  assert.deepEqual(normalizeUses('jukebox, loudspeaker'), ['music']);
  assert.ok(/"trap"/.test(SYSTEM_PROMPT) && /"music"/.test(SYSTEM_PROMPT));
  assert.ok(!/Roof access, traps, lures/.test(SYSTEM_PROMPT), 'the old refusal is gone');
  const signal = new AbortController().signal;
  const dug = await fixtureGenerator({ text: 'Dig a hole at 6,8', username: 'dave', objects: [] }, signal);
  assert.ok('blueprint' in dug && dug.action === 'build');
  assert.deepEqual(dug.uses, ['trap']);
  const spk = await fixtureGenerator({ text: 'Build a speaker stack', username: 'dave', objects: [] }, signal);
  assert.ok('blueprint' in spk && spk.action === 'build');
  assert.deepEqual(spk.uses, ['music']);
  assert.equal(spk.blueprint.animations?.length, 2);
  assert.ok(spk.blueprint.animations!.every((a) => a.kind === 'drift'));
});

function harness(options: Partial<SafehouseOptions> = {}) {
  let now = 10000;
  const world = createSafehouseWorld({ fixture: true, workMs: 500, wildlife: false, neighbours: false, ...options });
  const state = world.createInitialState(now);
  const ctx: WorldCtx<SafehouseState> = {
    state,
    get now() {
      return now;
    },
    checkpoint() {
      world.stateSchema.parse(state);
    },
    say() {},
    log() {},
    enqueueTask: () => ({ id: '' }),
    queue: [],
    llm: { dialogue: async () => null, moderate: async () => ({ ok: false }) },
    tuning: {},
    chatRatePerMin: 0,
    rng: lcg(7),
  };
  world.start?.(ctx);
  const tick = (n = 1) => {
    for (let i = 0; i < n; i++) {
      now += 500;
      world.tick(ctx, 500);
    }
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
  return { world, state, ctx, tick, request };
}

test('"Dig a hole at 6,8" ends up as a passable hole on that spot, and chat may have three, not four', async () => {
  const h = harness();
  const first = await h.request('Dig a hole at 6,8', 'ana');
  assert.equal(first.status, 'complete', first.error);
  const dug = h.state.objects.find((o) => !o.fixed && o.uses?.includes('trap'))!;
  assert.ok(dug, 'a hole stands');
  assert.deepEqual(dug.position, { x: 6, z: 8 });
  assert.equal(dug.passable, true, 'ground, not a wall');
  assert.equal(dug.role, 'decoration');
  assert.ok(isTrap(dug));
  const second = await h.request('Dig a hole at -14,10', 'ben');
  assert.equal(second.status, 'complete', second.error);
  const third = await h.request('Dig a hole at -30,10', 'cara');
  assert.equal(third.status, 'complete', third.error);
  const fourth = await h.request('Dig a hole at 26,10', 'dan');
  assert.equal(fourth.status, 'failed');
  assert.equal(fourth.error, 'Three holes is plenty. Fill one in first.');
  assert.equal(h.state.objects.filter((o) => !o.fixed && isTrap(o)).length, 3);
  // Nothing gets built on a hole: Rook places the bench beside it instead of on it.
  const bench = await h.request('Build a bench at 6,8', 'erin');
  assert.equal(bench.status, 'failed', 'the exact spot is taken by the hole');
  assert.match(bench.error ?? '', /blocked|unreachable/);
});

test('three sets of speakers is plenty for one street', async () => {
  const h = harness();
  for (const [user, spot] of [
    ['ana', '20,10'],
    ['ben', '26,10'],
    ['cara', '32,10'],
  ]) {
    const job = await h.request(`Build a speaker stack at ${spot}`, user);
    assert.equal(job.status, 'complete', job.error);
  }
  const stacks = h.state.objects.filter((o) => !o.fixed && isMusic(o));
  assert.equal(stacks.length, 3);
  assert.ok(stacks.every((o) => o.blueprint.animations?.length === 2 && intact(o)));
  const fourth = await h.request('Build a boombox at 38,10', 'dan');
  assert.equal(fourth.status, 'failed');
  assert.equal(fourth.error, 'Three sets of speakers is plenty for one street.');
  // A repaint keeps the use and does not count as a fourth.
  const painted = await h.request("Paint ana's speaker stack red", 'ana');
  assert.equal(painted.status, 'complete', painted.error);
  assert.equal(h.state.objects.filter((o) => !o.fixed && isMusic(o)).length, 3);
});
