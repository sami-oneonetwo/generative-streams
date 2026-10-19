// The journey: everyone walks together down an endless forest path. The camp moves on, every
// character keeps up, builds left standing are left behind, and chat is acted out by the body.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { harness } from './harness';
import { normalizeAgentReply, type AgentReply } from '../src/worlds/ai-dudes/agent';
import { journeyOf, sceneryNow } from '../src/worlds/ai-dudes/journey';
import { stateSchema } from '../src/worlds/ai-dudes/state';
import { route } from '../src/worlds/ai-dudes/placement';
import { inGlade, sceneryChunk, trailX, TRAIL } from '../src/shared/trail';

const dist = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z);

test('the group walks on down the trail and everyone keeps up', async () => {
  const { h, say, tick } = harness({ walking: true });
  for (const n of ['ann', 'bob', 'cat', 'dan']) await say(n, 'hi');
  await tick(2000);
  const startZ = journeyOf(h.state).campZ;
  await tick(60_000);
  const j = journeyOf(h.state);
  assert.ok(startZ - j.campZ > 70, `the camp moved on (${startZ - j.campZ} m)`);
  assert.ok(j.walked > 70);
  const camp = { x: trailX(j.seed, j.campZ), z: j.campZ };
  for (const d of h.state.dudes) assert.ok(dist(d.position, camp) < 22, `${d.name} kept up (${dist(d.position, camp).toFixed(1)} m from the camp)`);
  assert.ok(stateSchema.safeParse(JSON.parse(JSON.stringify(h.state))).success);
});

test('the camp stands still with nobody awake, and when the operator stops it', async () => {
  const { h, say, tick, world, ctx } = harness({ walking: true });
  await say('ann', 'hi');
  await tick(2000);
  world.adminActions!.find((a) => a.id === 'journey-pause')!.run(ctx, undefined);
  const z0 = journeyOf(h.state).campZ;
  await tick(20_000);
  assert.equal(journeyOf(h.state).campZ, z0, 'paused');
  world.adminActions!.find((a) => a.id === 'journey-resume')!.run(ctx, undefined);
  await tick(10_000);
  assert.ok(journeyOf(h.state).campZ < z0, 'walking again');
  h.state.dudes[0].lastHeardAt = h.now - 60 * 60_000; // everyone asleep
  const z1 = journeyOf(h.state).campZ;
  await tick(10_000);
  assert.equal(journeyOf(h.state).campZ, z1, 'nobody awake: nobody walks on');
});

test('a build left standing is left behind; one being driven comes along', async () => {
  const replies: Record<string, AgentReply['actions']> = {
    'build a car': [{ do: 'build', what: 'a red car' }],
    'build a shed': [{ do: 'build', what: 'a little shed' }],
    'drive my car': [{ do: 'use', target: 'car', how: 'drive' }],
  };
  const { h, say, tick } = harness({ walking: true, reply: (t) => ({ actions: replies[t.messages.join(' ')] ?? [] }) });
  await say('ann', 'build a car');
  await say('bob', 'build a shed');
  await tick(40_000);
  assert.equal(h.state.objects.length, 2, 'both went up');
  const car = h.state.objects.find((o) => o.owner === 'dev:ann')!;
  await say('ann', 'drive my car');
  await tick(150_000);
  assert.ok(h.state.objects.some((o) => o.id === car.id), 'the car came along');
  assert.ok(!h.state.objects.some((o) => o.owner === 'dev:bob'), 'the shed was left behind');
  const bob = h.state.dudes.find((d) => d.name === 'bob')!;
  assert.ok(bob.history.some((l) => /left your .* behind/.test(l.text)), 'and its builder was told');
  const ann = h.state.dudes.find((d) => d.name === 'ann')!;
  assert.equal(ann.riding, car.id, 'still driving');
  assert.ok(dist(ann.position, { x: trailX(journeyOf(h.state).seed, journeyOf(h.state).campZ), z: journeyOf(h.state).campZ }) < 50, 'alongside the group');
});

test('the forest never stands in the glade; edge trees block walking and can be chopped into a log', async () => {
  const seed = 4242;
  for (let i = -3; i < 60; i++)
    for (const s of sceneryChunk(seed, i)) {
      const lateral = Math.abs(s.x - trailX(seed, s.z));
      if (s.edge) assert.ok(lateral >= TRAIL.edgeMin && lateral <= TRAIL.edgeMax);
      else assert.ok(!inGlade(seed, s, -2), `forest tree ${s.id} in the glade`);
    }
  let script: AgentReply['actions'] = [];
  const { h, say, tick } = harness({ reply: (t) => ({ actions: t.messages.length ? script : [] }) });
  await say('woody', 'hi');
  await tick(1000);
  const tree = sceneryNow(h.state).find((s) => s.kind !== 'boulder')!;
  // Routing goes round it.
  const path = route({ x: tree.x - 3, z: tree.z }, { x: tree.x + 3, z: tree.z }, []);
  assert.ok(path && path.length > 2, 'round the trunk, not through it');
  const woody = h.state.dudes[0];
  woody.position = { x: tree.x + Math.sign(trailX(1234, tree.z) - tree.x) * 4, z: tree.z };
  script = [{ do: 'chop', target: 'nearest tree' }];
  await say('woody', 'chop that tree down');
  await tick(20_000);
  assert.ok(journeyOf(h.state).felled.includes(tree.id), 'felled');
  assert.ok(!sceneryNow(h.state).some((s) => s.id === tree.id), 'and gone from the glade');
  const log = h.state.objects.find((o) => o.owner === woody.id);
  assert.match(log?.blueprint.name ?? '', /log$/, 'a log, theirs');
});

test("chat is the character's speech, and it is acted out by the body", async () => {
  let script: AgentReply['actions'] = [];
  const { h, say, tick } = harness({ reply: (t) => ({ say: 'this should not show', actions: t.messages.length ? script : [] }) });
  await say('ann', 'hi');
  await say('bob', 'hi');
  await tick(3000);
  const [ann, bob] = h.state.dudes;
  ann.position = { x: 0, z: 0 };
  bob.position = { x: 4, z: 0 };
  bob.idleUntil = h.now + 1e9;
  script = [{ do: 'greet', target: 'bob', how: 'highfive' }];
  await say('ann', 'nice one bob');
  assert.equal(ann.say?.text, 'nice one bob', 'their words, at once');
  let both = false;
  for (let i = 0; i < 20 && !both; i++) {
    await tick(500);
    both = ann.emote?.pose === 'highfive' && bob.emote?.pose === 'highfive';
  }
  assert.ok(both, 'a high five, together');
  assert.equal(ann.say?.text, 'nice one bob', "the agent's own line never replaces it");
  assert.ok(bob.overheard.some((o) => o.text === 'nice one bob'), 'bob heard it');
  // "I want a fight": a shove, no knockout.
  await tick(3000);
  script = [{ do: 'attack', target: 'bob', with: 'shove' }];
  await say('ann', 'i want to see a fight');
  let staggered = false;
  for (let i = 0; i < 20 && !staggered; i++) {
    await tick(500);
    staggered = bob.emote?.pose === 'stagger';
  }
  assert.ok(staggered, 'bob stumbles');
  assert.equal(bob.ko, undefined, 'and stays up');
  // "what is this": a wander round, looking at things.
  script = [{ do: 'explore' }];
  await say('ann', 'what is this place');
  await tick(500);
  assert.ok(ann.explore, 'exploring');
  const from = { ...ann.position };
  let looked = false;
  for (let i = 0; i < 30; i++) {
    await tick(500);
    if (['think', 'point', 'shrug'].includes(ann.emote?.pose ?? '')) looked = true;
  }
  assert.ok(looked && dist(from, ann.position) > 1, 'walked over and looked');
  // follow, then stop
  script = [{ do: 'follow', target: 'bob' }];
  await say('ann', 'follow bob');
  bob.idleUntil = 0;
  bob.position = { x: 10, z: -10 };
  await tick(10_000);
  assert.ok(dist(ann.position, bob.position) < 3, 'stuck with bob');
  script = [{ do: 'stop' }];
  await say('ann', 'ok stop');
  await tick(1000);
  assert.equal(ann.follow, undefined);
});

test('the new verbs parse from the ways a model writes them', () => {
  const r = normalizeAgentReply({
    actions: [{ do: 'look around' }, { do: 'high five', target: 'bob' }, { do: 'push', target: 'cat' }],
  });
  assert.deepEqual(r.actions, [{ do: 'explore' }, { do: 'greet', target: 'bob', how: 'highfive' }, { do: 'attack', target: 'cat', with: 'shove' }]);
  const r2 = normalizeAgentReply({ actions: [{ do: 'follow', who: 'dan' }, { do: 'get off' }, { do: 'chop down', tree: 'the big oak' }] });
  assert.deepEqual(r2.actions, [{ do: 'follow', target: 'dan' }, { do: 'stop' }, { do: 'chop', target: 'the big oak' }]);
  const r3 = normalizeAgentReply({ actions: [{ do: 'show', what: 'badges' }, { do: 'emote', pose: 'lol' }, { do: 'hug' }] });
  assert.deepEqual(r3.actions, [{ do: 'show', what: 'badges' }, { do: 'emote', pose: 'laugh' }, { do: 'emote', pose: 'hug' }]);
});

// ---- the river ------------------------------------------------------------------------------------
/** A walking world with these chatters, stopped at a river right now. */
async function atRiver(names: string[], replies: Record<string, AgentReply['actions']> = {}) {
  const hz = harness({ walking: true, reply: (t) => ({ actions: replies[`${t.name}: ${t.messages.join(' ')}`] ?? replies[t.messages.join(' ')] ?? [] }) });
  for (const n of names) await hz.say(n, 'hi');
  await hz.tick(3000);
  hz.world.adminActions!.find((a) => a.id === 'challenge-now')!.run(hz.ctx, 'river');
  await hz.tick(1000);
  const j = journeyOf(hz.h.state);
  const river = j.features!.find((f) => f.id === j.challenge!.featureId)!;
  // Everyone on the near bank to start with.
  for (const d of hz.h.state.dudes) {
    d.position = { x: trailX(j.seed, river.z + 9) + (Math.random() * 6 - 3), z: river.z + 9 };
    d.path = [];
  }
  return { ...hz, river };
}

test('the river stops the group, and nobody walks across it', async () => {
  const { h, river, say, tick } = await atRiver(['ann']);
  const j = journeyOf(h.state);
  assert.equal(j.phase, 'challenge');
  assert.ok(j.campZ > river.z, 'the camp waits on the near side');
  const ann = h.state.dudes[0];
  assert.equal(route(ann.position, { x: ann.position.x, z: river.z - 10 }, []), null, 'no path over the water');
  const z0 = j.campZ;
  await tick(10_000);
  assert.equal(journeyOf(h.state).campZ, z0, 'and the walk waits');
  void say;
});

test('something that floats crosses the river; a car does not', async () => {
  const { h, river, say, tick } = await atRiver(['ann', 'bob'], {
    'ann: build a raft': [{ do: 'build', what: 'a wooden raft' }],
    'bob: build a car': [{ do: 'build', what: 'a red car' }],
    'ann: ride the raft across': [{ do: 'use', target: 'raft', how: 'ride', to: 'across' }],
    'bob: drive the car across': [{ do: 'use', target: 'car', how: 'drive', to: 'across' }],
  });
  await say('ann', 'build a raft');
  await say('bob', 'build a car');
  await tick(40_000);
  await say('ann', 'ride the raft across');
  await say('bob', 'drive the car across');
  await tick(40_000);
  const [ann, bob] = h.state.dudes;
  const c = journeyOf(h.state).challenge!;
  assert.ok(c.crossed.includes(ann.id) || ann.badges?.some((b) => b.kind === 'river'), `ann got across on the raft (${JSON.stringify(ann.position)}, river at ${river.z})`);
  assert.ok(!c.crossed.includes(bob.id), 'bob did not: a car does not float');
  assert.ok(bob.history.some((l) => /does not float or fly/.test(l.text)));
});

test('a bridge takes three people; hindering slows it; then everyone walks over and earns the droplet', async () => {
  const names = ['ann', 'bob', 'cat', 'dan', 'eve'];
  const { h, river, say, tick } = await atRiver(names, {
    'help build the bridge': [{ do: 'help', project: 'bridge' }],
    'build a bridge': [{ do: 'build', what: 'a big bridge over the river' }],
    'mess up the bridge': [{ do: 'hinder', project: 'bridge' }],
  });
  const c = journeyOf(h.state).challenge!;
  const bridge = c.projects!.bridge!;
  await say('ann', 'help build the bridge');
  await tick(bridge.need * 1000 + 20_000);
  assert.ok(bridge.work < bridge.need, 'one person never finishes it');
  assert.ok(river.bridge < 1);
  await say('bob', 'build a bridge'); // a build request at the river joins the bridge
  await say('cat', 'help build the bridge');
  await say('dan', 'mess up the bridge');
  await tick(3000);
  assert.equal(h.state.dudes.find((d) => d.name === 'bob')!.project?.kind, 'bridge');
  const before = bridge.work;
  await tick(10_000);
  assert.ok(bridge.work - before < 3 * 10, 'the hinderer slows it');
  await tick(bridge.need * 1000);
  assert.equal(river.bridge, 1, 'built');
  // Everyone walks over; the challenge ends; badges for crossers and helpers.
  await tick(40_000);
  const j = journeyOf(h.state);
  assert.ok(j.phase === 'reward' || j.phase === 'travel', `over (${j.phase}, crossed ${j.challenge?.crossed.length})`);
  for (const d of h.state.dudes) assert.ok(d.badges?.some((b) => b.kind === 'river'), `${d.name} earned the droplet`);
  await tick(10_000);
  assert.equal(journeyOf(h.state).phase, 'travel', 'and the walk goes on');
  assert.ok(journeyOf(h.state).campZ < river.z - river.half, 'past the river');
  const scene = (await import('./harness')).flush;
  void scene;
});

test('swimming: across, or dragged back by the current', async () => {
  const { h, river, say, tick } = await atRiver(['ann', 'bob', 'cat', 'dan'], { 'swim for it': [{ do: 'move', to: 'across' }] });
  for (const n of ['ann', 'bob', 'cat', 'dan']) await say(n, 'swim for it');
  await tick(1500);
  assert.ok(h.state.dudes.every((d) => d.swim), 'everyone is going in');
  // The odds were rolled when they set off; fix them here so both endings are seen.
  h.state.dudes.forEach((d, i) => (d.swim!.ok = i < 2));
  let wet = false;
  for (let i = 0; i < 80; i++) {
    await tick(500);
    const scene = (h.state.dudes.some((d) => d.swim?.phase === 'swimming'));
    wet ||= scene;
  }
  assert.ok(wet, 'they were in the water');
  const [ann, bob, cat, dan] = h.state.dudes;
  for (const d of [ann, bob]) assert.ok(isAcrossZ(d.position.z, river), `${d.name} swam across`);
  for (const d of [cat, dan]) {
    assert.ok(!isAcrossZ(d.position.z, river), `${d.name} did not`);
    assert.ok(d.history.some((l) => /dragged you back/.test(l.text)), 'and was told why');
  }
});
const isAcrossZ = (z: number, f: { z: number; half: number }) => z < f.z - f.half;

test('time runs out: stragglers are ferried over with nothing, crossers keep their droplet', async () => {
  const { h, river, world, ctx, tick } = await atRiver(['ann', 'bob']);
  const [ann, bob] = h.state.dudes;
  ann.position = { x: trailX(journeyOf(h.state).seed, river.z - 10), z: river.z - 10 }; // already over
  await tick(1000);
  world.adminActions!.find((a) => a.id === 'challenge-finish')!.run(ctx, undefined);
  await tick(12_000);
  assert.equal(journeyOf(h.state).phase, 'travel');
  assert.ok(ann.badges?.some((b) => b.kind === 'river'));
  assert.ok(!bob.badges?.length, 'bob was ferried: no droplet');
  assert.ok(bob.position.z < river.z - river.half, 'but he is over');
});

test('badges show on the tag grouped by kind, and the chatter can ask to see them all', async () => {
  const { h, say, tick, world } = harness({ reply: (t) => ({ actions: /badges/.test(t.messages.join(' ')) ? [{ do: 'show', what: 'badges' }] : [] }) });
  await say('ann', 'hi');
  await tick(1000);
  const ann = h.state.dudes[0];
  ann.badges = [
    { kind: 'river', at: 1 },
    { kind: 'river', at: 2 },
    { kind: 'boss:moss-troll', at: 3 },
  ];
  let view = world.buildScene(h.state, { now: h.now } as never).dudes.find((d) => d.id === ann.id)!;
  assert.deepEqual(view.badges, [
    ['river', 2],
    ['boss:moss-troll', 1],
  ]);
  assert.ok(!view.badgesOpen);
  await say('ann', 'show me my badges');
  await tick(1000);
  view = world.buildScene(h.state, { now: h.now } as never).dudes.find((d) => d.id === ann.id)!;
  assert.ok(view.badgesOpen);
  await tick(20_000);
  view = world.buildScene(h.state, { now: h.now } as never).dudes.find((d) => d.id === ann.id)!;
  assert.ok(!view.badgesOpen, 'for a while');
});

// ---- the boss -------------------------------------------------------------------------------------
async function atBoss(names: string[], replies: Record<string, AgentReply['actions']> = {}) {
  const hz = harness({ walking: true, reply: (t) => ({ actions: replies[`${t.name}: ${t.messages.join(' ')}`] ?? replies[t.messages.join(' ')] ?? [] }) });
  for (const n of names) await hz.say(n, 'hi');
  await hz.tick(3000);
  const why = hz.world.adminActions!.find((a) => a.id === 'challenge-now')!.run(hz.ctx, 'boss');
  void why;
  await hz.tick(500);
  return hz;
}

test('the boss blocks the path with health for everyone, slams people flat for twenty seconds, and falls to the group', async () => {
  const names = ['ann', 'bob', 'cat', 'idle'];
  const { h, say, tick } = await atBoss(names, {
    'punch the troll': [{ do: 'attack', target: 'the troll', with: 'punch' }],
    'shoot it': [{ do: 'attack', target: 'it', with: 'shoot' }],
  });
  const j = journeyOf(h.state);
  assert.equal(j.phase, 'challenge');
  const boss = j.boss!;
  assert.ok(boss, 'it came');
  assert.equal(boss.maxHp, 30 + 25 * 4, 'health for four');
  const scene = (await import('../src/worlds/ai-dudes/index')).aiDudesWorld;
  void scene;
  // A slam: everyone close is out for twenty seconds and cannot act.
  const ann = h.state.dudes.find((d) => d.name === 'ann')!;
  ann.position = { x: boss.position.x + 1, z: boss.position.z };
  boss.nextSlamAt = h.now;
  boss.targetId = ann.id;
  boss.retargetAt = h.now + 1e9;
  await tick(500);
  assert.ok(ann.ko && ann.ko.until - h.now > 15_000, 'knocked out for a long while');
  await say('ann', 'punch the troll');
  await tick(500);
  assert.ok(ann.history.some((l) => /knocked out/.test(l.text)), 'and could not help');
  // Bob and cat wear it down from range; idle does nothing.
  const bob = h.state.dudes.find((d) => d.name === 'bob')!,
    cat = h.state.dudes.find((d) => d.name === 'cat')!;
  for (let round = 0; round < 80 && boss.hp > 0; round++) {
    boss.nextSlamAt = h.now + 1e9; // no more slams, so the test is about the damage
    await say('bob', 'shoot it');
    await say('cat', 'shoot it');
    await tick(3000);
  }
  assert.equal(boss.hp, 0, `it fell (${boss.hp} left)`);
  assert.ok(['reward', 'travel'].includes(journeyOf(h.state).phase));
  const kind = `boss:${boss.kindId}`;
  for (const d of [bob, cat]) assert.ok(d.badges?.some((b) => b.kind === kind), `${d.name} earned its face`);
  assert.ok(!h.state.dudes.find((d) => d.name === 'idle')!.badges?.length, 'not the one who did nothing');
  await tick(10_000);
  assert.equal(journeyOf(h.state).phase, 'travel');
  assert.equal(journeyOf(h.state).boss, undefined);
});

test('weapons people build and fire, traps it walks into, and ramming it all hurt the boss', async () => {
  const { h, say, tick } = await atBoss(['gunner', 'trapper', 'driver'], {
    'build a cannon': [{ do: 'build', what: 'a big iron cannon' }],
    'build a trap': [{ do: 'build', what: 'a spike pit trap' }],
    'build a car': [{ do: 'build', what: 'a red car' }],
    'fire the cannon': [{ do: 'use', target: 'cannon', how: 'fire' }],
    'ram it': [{ do: 'use', target: 'car', how: 'drive', to: 'the boss' }],
  });
  const boss = journeyOf(h.state).boss!;
  boss.nextSlamAt = h.now + 1e9;
  boss.stunUntil = h.now + 60_000; // stands still while things get built
  await say('gunner', 'build a cannon');
  await say('trapper', 'build a trap');
  await say('driver', 'build a car');
  await tick(45_000);
  assert.equal(h.state.objects.length, 3, 'all three went up');
  const hp0 = boss.hp;
  await say('gunner', 'fire the cannon');
  await tick(20_000);
  const gunner = h.state.dudes.find((d) => d.name === 'gunner')!;
  assert.ok((boss.damagers[gunner.id] ?? 0) >= 6, `the cannon hit it (${boss.damagers[gunner.id]})`);
  // The trap: put the boss on it.
  const trap = h.state.objects.find((o) => /trap|pit/i.test(o.blueprint.name))!;
  boss.stunUntil = undefined;
  boss.position = { ...trap.position };
  const before = boss.hp;
  await tick(500);
  assert.ok(before - boss.hp >= 15, 'the trap hurt it');
  assert.ok(boss.stunUntil && boss.stunUntil > h.now, 'and stunned it');
  assert.ok(h.state.vandalised?.[trap.id], 'and is wrecked');
  // Ramming.
  boss.stunUntil = h.now + 60_000;
  await say('driver', 'ram it');
  const driver = h.state.dudes.find((d) => d.name === 'driver')!;
  for (let i = 0; i < 60 && !boss.damagers[driver.id]; i++) await tick(500);
  assert.ok(boss.damagers[driver.id] >= 5, 'the car hurt it');
  assert.equal(driver.riding, undefined, 'and the driver was thrown off');
  assert.ok(boss.hp < hp0);
});

test('the boss gets bored when time runs out, and nobody earns anything', async () => {
  const { h, say, tick, world, ctx } = await atBoss(['ann'], { 'punch it': [{ do: 'attack', target: 'boss', with: 'punch' }] });
  const boss = journeyOf(h.state).boss!;
  boss.nextSlamAt = h.now + 1e9;
  await say('ann', 'punch it');
  await tick(8000);
  world.adminActions!.find((a) => a.id === 'challenge-finish')!.run(ctx, undefined);
  await tick(12_000);
  assert.equal(journeyOf(h.state).phase, 'travel');
  assert.ok(!h.state.dudes[0].badges?.length, 'no face for anyone');
});

// ---- the end of the path ----------------------------------------------------------------------------
test("the landmark: hidden in the mist on 'Getting close', revealed with a star each on 'You've made it', left behind on 'Set off again'", async () => {
  const replies: Record<string, AgentReply['actions']> = { 'sit on it': [{ do: 'use', target: 'tower', how: 'sit' }], 'drive it': [{ do: 'use', target: 'tower', how: 'drive' }] };
  const { h, say, tick, world, ctx } = harness({ walking: true, reply: (t) => ({ actions: replies[t.messages.join(' ')] ?? [] }) });
  for (const n of ['ann', 'bob']) await say(n, 'hi');
  await tick(2000);
  const run = (id: string, value?: string) => world.adminActions!.find((a) => a.id === id)!.run(ctx, value);
  run('landmark-close', 'a giant glowing tower');
  await tick(1000);
  const j = journeyOf(h.state);
  assert.equal(j.phase, 'approach');
  const mark = h.state.objects.find((o) => o.id === 'landmark')!;
  assert.ok(mark && mark.silhouette, 'a shape in the mist');
  assert.ok(mark.position.z < j.campZ - 50, 'far ahead');
  const scene = world.buildScene(h.state, { now: h.now } as never);
  assert.equal(scene.happening?.title, 'SOMETHING IS UP AHEAD');
  // The walk goes on, with no challenges in the way.
  const z0 = j.campZ;
  await tick(60_000);
  assert.ok(j.campZ < z0 - 50);
  assert.equal(j.challenge, undefined);
  assert.equal(j.next, undefined);
  await say('ann', 'sit on it');
  await tick(1000);
  assert.ok(h.state.dudes[0].history.some((l) => /no build called/.test(l.text)), 'nobody can use it yet');
  run('landmark-arrive');
  await tick(1000);
  assert.equal(j.phase, 'arrived');
  assert.ok(!h.state.objects.find((o) => o.id === 'landmark')!.silhouette, 'revealed');
  for (const d of h.state.dudes) assert.ok(d.badges?.some((b) => b.kind === 'arrived:1'), `${d.name} got a star`);
  await tick(60_000);
  const lm = h.state.objects.find((o) => o.id === 'landmark')!;
  assert.ok(j.campZ > lm.position.z, 'the group stands in front of it');
  const zStop = j.campZ;
  await tick(20_000);
  assert.equal(j.campZ, zStop, 'and stays');
  await say('bob', 'drive it');
  await tick(1000);
  assert.ok(h.state.dudes[1].history.some((l) => /does not move/.test(l.text)));
  run('journey-set-off');
  await tick(1000);
  assert.equal(j.phase, 'travel');
  assert.equal(j.leg, 2);
  await tick(150_000);
  assert.ok(!h.state.objects.some((o) => o.id.startsWith('landmark')), 'left behind');
  assert.ok(j.next || j.challenge, 'challenges are back');
  assert.ok(stateSchema.safeParse(JSON.parse(JSON.stringify(h.state))).success);
});
