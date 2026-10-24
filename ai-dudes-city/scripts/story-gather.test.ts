// The Bell (FK-019): the Call walks everyone awake into a tiered ring round a STORY_SITES anchor, gold in
// front, neither side in the middle, red at the back, all facing the anchor, at 1.8× walking pace; away
// dudes pad a thin crowd. The gathering starts once 70% are there (never before RING.minMs) or when the
// 25 s walk is up: stragglers appear at their slots in a puff and the Call's scene plays. Latecomers go
// to the back. The release lets them go a few at a time, players first, and gather mode ends as it
// begins; a build they were called away from picks up where it left off. A /play player is walked like
// everyone else and can't walk, ride, fire or ram until their release. Never a party. Story OFF: nothing.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { harness } from './harness';
import { TOWN, cityOf } from '../src/worlds/ai-dudes/city';
import { pilots } from '../src/worlds/ai-dudes/players';
import { skipVisit } from '../src/worlds/ai-dudes/caravan';
import { hashOf } from '../src/worlds/ai-dudes/agent';
import { RING, callRing, gathering, ringRows, releaseRing } from '../src/worlds/ai-dudes/story/gather';
import { WALK_SPEED, awake } from '../src/worlds/ai-dudes/sim';
import { stateSchema, type Dude } from '../src/worlds/ai-dudes/state';
import { STORY_SITES } from '../src/shared/storyMap';
import { STORY_SCENES } from '../src/shared/storyScenes';
import { LOCK_CAPS } from '../src/shared/scenes';
import { contains } from '../src/shared/layout';
import type { DudesScene } from '../src/shared/dudesTypes';
import type { SafehouseObject } from '../src/shared/objectTypes';

const CROWD = STORY_SITES.crowd;
const dist = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z);
/** How far a point is from the ring's centre. */
const radius = (p: { x: number; z: number }) => dist(p, CROWD.at);
/** The way someone at `p` faces to look at the ring's centre. */
const toCentre = (p: { x: number; z: number }) => Math.atan2(CROWD.at.x - p.x, CROWD.at.z - p.z);
const sameAngle = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b))) < 1e-6;
/** Spots all over town, on the streets and in the parks, for the crowd to come from (none inside the ring). */
const SPOTS = [
  { x: 0, z: 0 },
  { x: -40, z: 5 },
  { x: 5, z: -45 },
  { x: 30, z: 22 },
  { x: -22, z: 45 },
  { x: 45, z: -20 },
  { x: -60, z: -60 },
  { x: 60, z: -62 },
  { x: -62, z: 62 },
  { x: 22, z: 66 },
  { x: -5, z: 30 },
  { x: 66, z: 20 },
];

/** A world with Story on, the caravan off, and its tools. */
function ringTown(opts: { town?: boolean } = {}) {
  pilots.clear(); // players are the module's, not the world's: none left over from another test
  const hs = harness({ town: opts.town ?? false });
  const s = hs.h.state;
  s.ai.story = true;
  if (!opts.town) s.ai.caravan = false;
  const action = (id: string) => hs.world.adminActions!.find((a) => a.id === id)!;
  return {
    ...hs,
    s,
    run: (id: string, value?: string) => action(id).run(hs.ctx, value) || undefined,
    view: () => hs.world.buildScene(s, { now: hs.h.now } as never) as unknown as DudesScene,
    dude: (name: string) => s.dudes.find((d) => d.name === name)!,
    /** Chatters who said hello, each put somewhere in town (SPOTS), with a side for some. */
    async crowd(people: [name: string, side?: 'red' | 'gold'][]) {
      for (const [name] of people) await hs.say(name, `hello from ${name}`);
      await hs.tick(1000);
      people.forEach(([name, side], i) => {
        const d = s.dudes.find((x) => x.name === name)!;
        Object.assign(d, { position: { ...SPOTS[i % SPOTS.length] }, path: [], walkingFor: undefined, ...(side ? { side, sideAge: cityOf(s).age ?? 0 } : {}) });
      });
      return people.map(([name]) => s.dudes.find((x) => x.name === name)!);
    },
  };
}
const there = (d: Dude) => !!d.gather && dist(d.position, d.gather.slot) <= RING.thereM;

test("the ring's slots: rows 1.5 m apart from 8 m out, each row from the middle out and half a place over from the last, all facing the centre, none on a build", () => {
  const t = ringTown();
  const rows = ringRows(t.s, CROWD);
  const radii = rows.map((r) => radius(r[0].at));
  assert.deepEqual(
    radii.map((r) => Math.round(r * 10) / 10),
    [8, 9.5, 11, 12.5, 14, 15.5, 17, 18.5],
    'five rows from inner to outer, three spare behind',
  );
  for (const [i, row] of rows.entries()) {
    // The middle slot first: on the ring's bearing (even rows), or either side of it by half a place (odd rows).
    const off = row.map((s) => s.off);
    assert.ok(i % 2 ? Math.abs(Math.abs(off[0]) - RING.slotGap / radii[i] / 2) < 1e-9 : off[0] === 0, `row ${i} starts in the middle`);
    for (let k = 1; k < off.length; k++) assert.ok(Math.abs(off[k]) >= Math.abs(off[k - 1]) - 1e-9, `row ${i} fills from the middle out`);
    for (const s of row) {
      assert.ok(Math.abs(s.off) <= RING.arc + 1e-9, 'within the arc');
      assert.ok(sameAngle(s.face, toCentre(s.at)), 'facing the centre');
      if (i < 5) assert.ok(contains(CROWD.rect, s.at), "inside the crowd's reserved ground");
    }
    const byOff = [...row].sort((a, b) => a.off - b.off);
    for (let k = 1; k < byOff.length; k++) assert.ok(dist(byOff[k].at, byOff[k - 1].at) > 1.3, 'elbow room');
  }
  assert.ok(rows.slice(0, 5).flat().length >= 80, 'room for 80 in the ring itself');
  // A build that went up in the park before Story was on: nobody's slot is on it.
  const shed = { id: 'b-shed', position: { x: 54, z: 59 }, footprint: { width: 4, depth: 3 }, blueprint: { name: 'a shed', parts: [] } } as unknown as SafehouseObject;
  t.s.objects.push(shed);
  const around = ringRows(t.s, CROWD).flat();
  assert.ok(around.length < rows.flat().length, 'the slots under it are left out');
  assert.ok(around.every((s) => Math.abs(s.at.x - 54) > 2 + 0.3 || Math.abs(s.at.z - 59) > 1.5 + 0.3), 'none on the shed');
});

test('the Call: 12 dudes run to their slots at 1.8× walking pace and are all in place within 25 s, facing the Folly, gold in front and red at the back', async () => {
  const t = ringTown();
  const people = await t.crowd([
    ['kev', 'gold'],
    ['dana', 'red'],
    ['bo'],
    ['nia', 'gold'],
    ['cy', 'red'],
    ['eve'],
    ['fox', 'gold'],
    ['gus', 'red'],
    ['hal'],
    ['ida', 'gold'],
    ['jo', 'red'],
    ['lu'],
  ]);
  const far = t.dude('fox'); // (-60, -60): the far corner of town
  assert.equal(t.run('story-gather'), undefined);
  assert.ok(t.h.logs.includes('story: gather (admin): 12 called into the ring at the Folly (4 gold in front, 4 red at the back); the head is on his mark'), t.h.logs.join('\n'));
  assert.ok(people.every((d) => d.gather), 'everyone awake is called');
  assert.ok(gathering(t.s), 'gather mode from the Call');
  // The slots: each side in rows of its own, gold nearest the Folly, red furthest.
  const r = (side: string | undefined) => people.filter((d) => d.side === side).map((d) => radius(d.gather!.slot));
  assert.ok(Math.max(...r('gold')) < Math.min(...r(undefined)) && Math.max(...r(undefined)) < Math.min(...r('red')), 'gold front, neither middle, red back');
  for (const d of people) assert.ok(sameAngle(d.gather!.face, toCentre(d.gather!.slot)), 'each slot faces the centre');
  // At a run: 1.8× walking pace, a few setting off each tick.
  await t.tick(1500);
  const from = { ...far.position };
  await t.tick(1000);
  assert.ok(Math.abs(dist(from, far.position) - WALK_SPEED * RING.pace) < 0.05, `fox ran ${dist(from, far.position).toFixed(2)} m in a second`);
  await t.tick(LOCK_CAPS.walk - 2500);
  for (const d of people) {
    assert.ok(there(d), `${d.name} is in place`);
    assert.ok(sameAngle(d.facing, toCentre(d.position)), `${d.name} faces the Folly`);
  }
  assert.ok(t.h.logs.some((l) => /^story: the gathering starts [\d.]+ s after the Call: \d+ of 12 walked in/.test(l)), t.h.logs.join('\n'));
  // They stay put, facing it, until let go.
  await t.tick(30_000);
  assert.ok(people.every((d) => there(d) && sameAngle(d.facing, toCentre(d.position))), 'still in the ring');
});

test('the start: once 70% are there (never before 8 s) the stragglers appear at their slots in a puff; if they never are, at 25 s', async () => {
  const t = ringTown();
  const people = await t.crowd([['a'], ['b'], ['c'], ['d'], ['e'], ['f'], ['g'], ['h'], ['i'], ['j']]);
  // Seven a stone's throw from the ring, three across town.
  people.slice(0, 7).forEach((d, i) => (d.position = { x: 44 + i * 3, z: 70 }));
  for (const [i, d] of people.slice(7).entries()) d.position = { ...SPOTS[6 + i] };
  callRing(t.s, t.h.now);
  await t.tick(RING.minMs - 500);
  assert.equal(people.filter(there).length, 7, 'the near seven are in; the far three still running');
  assert.ok(!t.h.logs.some((l) => /gathering starts/.test(l)), 'not before 8 s');
  const puffs = t.s.effects?.length ?? 0;
  await t.tick(500);
  assert.ok(t.h.logs.includes('story: the gathering starts 8 s after the Call: 7 of 10 walked in, 3 appeared in their places'), t.h.logs.join('\n'));
  assert.ok(people.every(there), 'the stragglers are in their places');
  assert.ok(people.slice(7).every((d) => !d.path.length && sameAngle(d.facing, toCentre(d.position))), 'standing, facing the Folly');
  assert.equal((t.s.effects?.length ?? 0) - puffs, 6, 'a puff where each vanished and where each appeared');
  assert.ok(t.view().town?.ring?.started, 'the page knows it has started');

  // Nobody near: it waits out the walk.
  const u = ringTown();
  const far = await u.crowd([['p'], ['q'], ['r']]);
  far.forEach((d, i) => (d.position = { ...SPOTS[6 + i] }));
  callRing(u.s, u.h.now);
  await u.tick(LOCK_CAPS.walk - 500);
  assert.ok(!u.h.logs.some((l) => /gathering starts/.test(l)));
  await u.tick(500);
  assert.ok(u.h.logs.includes('story: the gathering starts 25 s after the Call: 0 of 3 walked in, 3 appeared in their places'), u.h.logs.join('\n'));
});

test('latecomers go to the back: walking in during the walk, appearing at their place once it has started', async () => {
  const t = ringTown();
  const people = await t.crowd([['kev', 'gold'], ['dana'], ['bo', 'red']]);
  callRing(t.s, t.h.now);
  await t.tick(1000);
  const back = Math.max(...people.map((d) => radius(d.gather!.slot)));
  await t.say('zed', 'hi, what is going on');
  await t.tick(500);
  const zed = t.dude('zed');
  assert.ok(zed.gather, 'a new chatter is called too');
  assert.ok(radius(zed.gather.slot) >= back - 1e-9, 'at the back, whatever side');
  assert.ok(zed.path.length, 'and walks in');
  await t.tick(LOCK_CAPS.walk);
  assert.ok(t.view().town?.ring?.started);
  // After the start: straight to the back in a puff (a player who logs in, someone back from away …).
  const puffs = t.s.effects?.length ?? 0;
  await t.say('yan', 'hello!');
  await t.tick(500);
  const yan = t.dude('yan');
  assert.ok(yan.gather && there(yan) && !yan.path.length, 'yan appears in place');
  assert.ok(radius(yan.gather.slot) >= radius(zed.gather!.slot) - 1e-9, 'behind everyone');
  assert.ok((t.s.effects?.length ?? 0) > puffs, 'in a puff');
});

test("away dudes pad a thin crowd: the half of them a party would get, nearest first, never more than the crowd needs", async () => {
  const t = ringTown();
  const names = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm', 'n'];
  const people = await t.crowd(names.map((n) => [n] as [string]));
  // Only two still here; the rest went quiet an hour ago.
  for (const d of people.slice(2)) d.lastHeardAt = t.h.now - 60 * 60_000;
  const called = callRing(t.s, t.h.now);
  assert.ok(typeof called === 'object');
  const away = people.slice(2);
  const half = away.filter((d) => hashOf(`${d.id}:${t.h.now}`) % 2 === 0 && dist(d.position, CROWD.at) < TOWN.reach);
  assert.ok(half.length && half.length < away.length, 'the test has both halves');
  assert.ok(people.slice(0, 2).every((d) => d.gather), 'everyone here is called');
  assert.deepEqual(away.filter((d) => d.gather).map((d) => d.name).sort(), half.map((d) => d.name).sort(), "the party's half of the away within reach pad it");
  assert.equal(called.away, half.length);
  // The padding stands behind those who are here.
  assert.ok(Math.min(...half.map((d) => radius(d.gather!.slot))) >= Math.max(...people.slice(0, 2).map((d) => radius(d.gather!.slot))) - 1e-9);
  // A full crowd needs no padding.
  const u = ringTown();
  const many = await u.crowd(Array.from({ length: RING.padTo }, (_, i) => [`p${i}`] as [string]));
  await u.say('sleepy', 'hi');
  await u.tick(500);
  u.dude('sleepy').lastHeardAt = u.h.now - 60 * 60_000;
  const full = callRing(u.s, u.h.now);
  assert.ok(typeof full === 'object' && full.away === 0 && full.called === many.length);
});

test('a Call with a scene plays it at the start; at its end the crowd goes a few at a time over 8 s, players first, and gather mode ends as the release begins', async () => {
  const t = ringTown();
  const people = await t.crowd(['kev', 'dana', 'bo', 'nia', 'cy', 'eve', 'fox', 'gus', 'hal', 'ida', 'jo', 'lu'].map((n) => [n] as [string]));
  const kev = t.dude('kev');
  assert.equal(typeof t.world.players!.join(t.ctx, kev.id, 'kev'), 'object');
  assert.match(String(callRing(t.s, t.h.now, { scene: 'nope' })), /^No story scene called "nope"/);
  assert.ok(typeof callRing(t.s, t.h.now, { scene: 'test', banner: { title: 'GATHER: THE TEST', premise: 'A quick look' } }) === 'object');
  assert.equal(callRing(t.s, t.h.now), 'Everyone is gathered already: Stop it first');
  // The Call's banner, counting down the walk, and the ring for the walk shot.
  const call = t.view().town!;
  assert.deepEqual(call.show?.banner, { title: 'GATHER: THE TEST', premise: 'A quick look', until: t.h.now + LOCK_CAPS.walk });
  assert.deepEqual(call.ring, { at: CROWD.at });
  assert.deepEqual(t.view().dudes.find((d) => d.id === kev.id)?.gather, { slot: kev.gather!.slot, face: kev.gather!.face });
  await t.tick(LOCK_CAPS.walk);
  assert.equal(cityOf(t.s).story?.scene?.id, 'test', 'the scene plays at the start');
  assert.equal(t.view().town?.show?.banner, undefined, 'the banner goes as it starts');
  // The scene runs its 10 s, then ends: everyone still standing, but the release has begun.
  await t.tick(STORY_SCENES.test.ms - 500);
  assert.ok(people.every((d) => d.gather));
  const left: number[] = [];
  for (let i = 0; i < 20; i++) {
    const before = people.filter((d) => d.gather).length;
    await t.tick(500);
    left.push(before - people.filter((d) => d.gather).length);
    if (i === 0) {
      assert.equal(cityOf(t.s).story?.scene, undefined, 'the scene is over');
      assert.equal(gathering(t.s), false, 'gather mode ends as the release begins');
      assert.equal(kev.gather, undefined, 'the player first');
      assert.ok(people.filter((d) => d.gather).length >= 10, 'most still in place');
      assert.equal(t.view().town?.ring, undefined, 'off the page');
    }
  }
  assert.ok(people.every((d) => !d.gather), 'all let go within the release');
  assert.ok(Math.max(...left) <= 2, `a few at a time, never as one block (${left.join(' ')})`);
  assert.ok(left.filter((n) => n > 0).length >= 8, 'spread over the release');
  assert.ok(t.h.logs.includes('story: the test scene ended; let go of 12 held things'), t.h.logs.join('\n'));
});

test('a /play player is walked to a slot and can’t walk, ride, fire or ram until their release; then their keys are back where they stand', async () => {
  const t = ringTown();
  const [kim] = await t.crowd([['kim'], ['sam']]);
  const { world, ctx } = t;
  assert.equal(typeof world.players!.join(ctx, kim.id, 'kim'), 'object');
  const input = (msg: Record<string, unknown>) => world.players!.input(ctx, kim.id, msg);
  input({ t: 'arm', weapon: 'blaster' });
  /** How many shots a fire at `aim` adds. */
  const fires = (aim: { x: number; z: number }) => {
    const n = (t.s.effects ?? []).length;
    input({ t: 'fire', aim });
    return (t.s.effects ?? []).length - n;
  };
  assert.ok(fires({ x: kim.position.x + 5, z: kim.position.z }) > 0, 'before the Call she fires');
  t.h.now += 2000;
  assert.equal(t.run('story-gather'), undefined);
  assert.ok(kim.gather, 'a slot like everyone else');
  // Her page tries to walk off: the server keeps her, and tells her why, once.
  const at = { ...kim.position };
  const first = input({ t: 'move', x: at.x - 1, z: at.z, facing: 0, moving: true, at: Date.now() });
  assert.deepEqual(kim.position, at, "her page's step doesn't move her");
  assert.match(String((first as { note?: string })?.note), /^Everyone's gathering: you're walked to your place in the crowd/);
  assert.equal(input({ t: 'move', x: at.x - 1, z: at.z, facing: 0, moving: true, at: Date.now() }), undefined, 'told once');
  assert.match(String((input({ t: 'ride' }) as { note?: string })?.note), /^Everyone's gathering/, 'no riding off');
  assert.equal(fires({ x: at.x + 5, z: at.z }), 0, 'no firing from the ring');
  assert.equal(input({ t: 'ram', target: 'anything', speed: 9 }), undefined, 'no ramming');
  // The server walks her in.
  await t.tick(LOCK_CAPS.walk);
  assert.ok(there(kim), 'walked to her slot');
  assert.ok(t.view().dudes.find((d) => d.id === kim.id)?.gather, 'her page is told she is gathered (it follows)');
  for (let i = 0; i < 3; i++) input({ t: 'move', x: kim.position.x + 3, z: kim.position.z, facing: 0, moving: true, at: Date.now() });
  assert.ok(there(kim), 'still there, whatever her page says');
  // Stop: everyone is let go, and her first step goes from where she stands.
  assert.equal(t.run('story-stop'), undefined);
  assert.equal(kim.gather, undefined);
  t.h.now += 100;
  const from = { ...kim.position };
  input({ t: 'move', x: from.x + 0.3, z: from.z, facing: Math.PI / 2, moving: true, at: Date.now() });
  assert.ok(dist(kim.position, { x: from.x + 0.3, z: from.z }) < 1e-6, 'she walks again, from her place in the ring');
  t.h.now += 1000;
  assert.ok(fires({ x: from.x + 5, z: from.z }) > 0, 'and fires again');
});

test('a build going up waits for the release, then its builder walks back and picks up where they left off', async () => {
  const t = ringTown();
  const [kev] = await t.crowd([['kev']]);
  kev.position = { x: -30, z: -30 };
  t.s.jobs.push({
    id: 'j-hut',
    dudeId: kev.id,
    kind: 'build',
    request: 'a hut',
    status: 'building',
    createdAt: t.h.now,
    anchor: { x: -30, z: -33 },
    position: { x: -30, z: -33 },
    footprint: { width: 3, depth: 3 },
    blueprint: { name: 'a hut', parts: [] },
    workMs: 20_000,
    workedMs: 6000,
  } as never);
  const job = t.s.jobs.find((j) => j.id === 'j-hut')!;
  callRing(t.s, t.h.now, { scene: 'test' });
  await t.tick(LOCK_CAPS.walk);
  assert.ok(there(kev), 'called away from it');
  assert.equal(job.workedMs, 6000, 'nothing done while gathered');
  await t.tick(STORY_SCENES.test.ms + RING.releaseMs + 500);
  assert.equal(kev.gather, undefined);
  assert.equal(job.status, 'walking', 'back to it');
  assert.equal(job.workedMs, 6000, 'its progress kept');
  await t.tick(70_000); // about 125 m back across town at a walk
  const now: string = job.status;
  assert.ok(job.workedMs! > 6000 || now === 'done', `building again from where it was (${now}, ${job.workedMs} ms in)`);
});

test('a ring with no scene (Story (dev) → Gather) holds until Stop, at most RING.holdMs, then lets go a few at a time', async () => {
  const t = ringTown();
  const people = await t.crowd([['kev'], ['dana'], ['bo']]);
  assert.equal(t.run('story-gather'), undefined);
  assert.match(t.run('story-gather') ?? '', /^Everyone is gathered already: Stop it first/, 'not twice');
  // The page: the banner through the walk, the ring, each dude's slot.
  const town = t.view().town!;
  assert.deepEqual(town.show?.banner, { title: 'GATHER: THE BIG HUT', premise: "The Chief's secret build", until: t.h.now + LOCK_CAPS.walk });
  await t.tick(RING.holdMs - 1000);
  assert.ok(people.every((d) => d.gather) && gathering(t.s), 'held');
  await t.tick(1000);
  assert.ok(t.h.logs.includes('story: the gathering held its longest (300 s): letting 3 go'), t.h.logs.join('\n'));
  await t.tick(500);
  assert.equal(gathering(t.s), false, "the head's lock lets go at the same cap (mayor.ts)");
  await t.tick(RING.releaseMs);
  assert.ok(people.every((d) => !d.gather));
  // Stop lets go at once, and nobody walks on into a ring that is gone.
  people.forEach((d, i) => Object.assign(d, { position: { ...SPOTS[i] }, path: [] }));
  t.run('story-gather');
  await t.tick(1500);
  assert.ok(people.some((d) => d.path.length), 'walking in');
  assert.equal(t.run('story-stop'), undefined);
  assert.ok(people.every((d) => !d.gather && !d.path.length), 'let go where they stand');
  assert.equal(t.view().town?.ring, undefined);
  // Story OFF lets go too, and the Call refuses with Story off.
  t.run('story-gather');
  t.run('story-off');
  assert.ok(people.every((d) => !d.gather));
  assert.equal(callRing(t.s, t.h.now), 'Story is off');
  assert.equal(t.run('story-on'), undefined);
  // Not over a story scene playing.
  t.run('story-play', 'test');
  assert.equal(t.run('story-gather'), 'The test scene is playing: Stop it first');
});

test('a ring saves and loads mid-walk (its slots are a dude’s saved `gather`), and every boot lets it go', async () => {
  const t = ringTown();
  await t.crowd([['kev', 'gold'], ['dana', 'red']]);
  t.run('story-gather');
  await t.tick(3000);
  const saved = JSON.parse(JSON.stringify(t.s));
  assert.ok(stateSchema.safeParse(saved).success, 'the save loads');
  assert.ok(saved.dudes.every((d: Dude) => d.gather && Number.isFinite(d.gather.slot.x) && Number.isFinite(d.gather.face)));
});

test('a gathering is never a party: no city.party, the caravan’s party ask never counts it, nothing in gather.ts throws one', async () => {
  const t = ringTown({ town: true });
  await t.say('kim', 'hi');
  await t.tick(2000);
  t.s.ai.story = false;
  skipVisit(t.s, t.h.now);
  await t.tick(21_000);
  skipVisit(t.s, t.h.now); // visit two wants a party
  await t.tick(25_000);
  const party = cityOf(t.s).caravan!.asks.find((a) => a.kind === 'party')!;
  assert.ok(party, 'the caravan wants a party');
  const had = party.have;
  t.s.ai.story = true;
  assert.ok(typeof callRing(t.s, t.h.now) === 'object');
  await t.tick(LOCK_CAPS.walk + 5000);
  assert.ok(t.s.dudes.every((d) => d.gather), 'gathered');
  assert.equal(cityOf(t.s).party, undefined, 'no party on');
  assert.ok(t.s.dudes.every((d) => d.visit?.why !== 'party'));
  assert.equal(party.have, had, 'the caravan did not count it');
  const src = readFileSync(new URL('../src/worlds/ai-dudes/story/gather.ts', import.meta.url), 'utf8').replace(/\/\/.*$/gm, '');
  assert.doesNotMatch(src, /caravanSaw|throwParty|\.party\s*=/, 'the ring never calls caravanSaw(party)');
});

test('the release lets anyone given something to do go at once; until then a walk elsewhere gives way to the ring', async () => {
  const t = ringTown();
  const [kev, dana] = await t.crowd([['kev'], ['dana']]);
  callRing(t.s, t.h.now);
  await t.tick(LOCK_CAPS.walk);
  // A turn from before the Call sends kev off: the ring wins while it holds.
  kev.path = [{ x: -40, z: -40 }];
  kev.walkingFor = 'move';
  await t.tick(1000);
  assert.ok(there(kev), 'back in his place');
  // The release has begun: a move now takes him straight off, without waiting for his turn to leave.
  releaseRing(t.s, t.h.now);
  kev.gather!.until = dana.gather!.until = t.h.now + 5000;
  kev.path = [{ x: -40, z: -40 }];
  kev.walkingFor = 'move';
  await t.tick(500);
  assert.equal(kev.gather, undefined, 'kev goes');
  assert.ok(kev.path.length, 'on his way');
  assert.ok(dana.gather, 'dana waits her turn');
  assert.ok(awake(dana, t.h.now));
});
