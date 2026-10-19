// The field without a model: every chatter gets a dude, their chat reaches their own agent, agents
// and designs run in parallel pools, builds go up side by side, and nobody touches anyone else's.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { WorldCtx } from '../src/engine/world';
import { createAiDudesWorld, matchName, type DudesOptions } from '../src/worlds/ai-dudes';
import { normalizeAgentReply, type AgentFn, type AgentReply, type AgentTurn } from '../src/worlds/ai-dudes/agent';
import type { DesignFn } from '../src/worlds/ai-dudes/design';
import { fixtureDesign } from '../src/worlds/ai-dudes/fixtures';
import { stateSchema, type DudesState } from '../src/worlds/ai-dudes/state';
import { startHappening, wearing } from '../src/worlds/ai-dudes/events';
import { applyReading, wishesMarkdown, type ListenerFn } from '../src/worlds/ai-dudes/listener';
import { validateDesign } from '../src/worlds/ai-dudes/blueprint';

import { flush, harness } from './harness';

test('every chatter gets a dude, and their words reach only their own agent', async () => {
  const { h, say } = harness();
  await say('alex', 'hi I am alex');
  await say('blair', 'yo');
  await flush();
  await flush();
  assert.equal(h.state.dudes.length, 2);
  const byDude = new Map(h.turns.map((t) => [t.dudeId, t.messages]));
  assert.deepEqual(byDude.get('dev:alex'), ['hi I am alex']);
  assert.deepEqual(byDude.get('dev:blair'), ['yo']);
});

test('agents run in parallel up to the pool size, and a busy agent gets everything said meanwhile in one turn', async () => {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const { h, say, tick } = harness({ agentLimit: 3, reply: async () => (await gate, { actions: [] }) });
  for (const name of ['a', 'b', 'c', 'd', 'e']) await say(name, `hello from ${name}`);
  await flush();
  assert.equal(h.turns.length, 3, 'three turns started at once, two waiting');
  await say('a', 'second thing');
  await say('a', 'third thing');
  release();
  await tick(2000);
  assert.equal(h.peak, 3);
  const aTurns = h.turns.filter((t) => t.dudeId === 'dev:a').map((t) => t.messages);
  assert.deepEqual(aTurns, [['hello from a'], ['second thing', 'third thing']]);
  assert.equal(h.turns.filter((t) => t.dudeId === 'dev:e').length, 1, 'the waiting chatters were answered too');
});

test("the agent shapes its dude: persona, title, look, memory; the chatter's words are its speech", async () => {
  const { h, say } = harness({
    reply: () =>
      normalizeAgentReply({
        say: 'ahoy',
        persona: 'I am a grumpy old sailor.',
        title: 'the old salt',
        look: { hat: 'cowboy', shirt: 'navy', height: 3 },
        remember: ['likes boats'],
        actions: [{ do: 'dance' }, { do: 'teleport', to: 'moon' }],
      }),
  });
  await say('sam', 'arr');
  await flush();
  await flush();
  const d = h.state.dudes[0];
  assert.equal(d.persona, 'I am a grumpy old sailor.');
  assert.equal(d.title, 'the old salt');
  assert.equal(d.look.hat, 'cowboy');
  assert.equal(d.look.shirt, '#000080');
  assert.equal(d.look.height, 1.15, 'clamped');
  assert.deepEqual(d.memory, ['likes boats']);
  assert.equal(d.say?.text, 'arr', "the bubble is what the chatter typed, not the agent's line");
  assert.equal(d.emote?.pose, 'dance', 'an emote named as the verb is understood; the unknown action is dropped');
});

test('many dudes design and build at the same time, side by side, each owning its own', async () => {
  let designsInFlight = 0,
    designPeak = 0;
  const design: DesignFn = async (input, signal) => {
    designsInFlight++;
    designPeak = Math.max(designPeak, designsInFlight);
    await flush();
    designsInFlight--;
    return fixtureDesign(input, signal);
  };
  const { h, say, tick } = harness({
    design,
    designLimit: 3,
    reply: (turn) => ({ actions: [{ do: 'build', what: `a red tower for ${turn.name}` }] }),
  });
  const names = ['a', 'b', 'c', 'd', 'e', 'f'];
  for (const name of names) await say(name, 'build me a tower');
  let simultaneous = 0;
  for (let i = 0; i < 120; i++) {
    await tick(500);
    simultaneous = Math.max(simultaneous, h.state.jobs.filter((j) => j.status === 'building').length);
  }
  assert.equal(designPeak, 3, 'designs ran three at a time');
  assert.ok(simultaneous >= 4, `several builds went up at once (saw ${simultaneous})`);
  assert.equal(h.state.objects.length, 6);
  for (const name of names) assert.equal(h.state.objects.filter((o) => o.owner === `dev:${name}`).length, 1);
  // Nothing stands on anything else.
  for (const a of h.state.objects)
    for (const b of h.state.objects)
      if (a !== b) {
        const dx = Math.abs(a.position.x - b.position.x) * 2,
          dz = Math.abs(a.position.z - b.position.z) * 2;
        assert.ok(dx >= a.footprint.width + b.footprint.width || dz >= a.footprint.depth + b.footprint.depth, `${a.id} overlaps ${b.id}`);
      }
  assert.ok(stateSchema.safeParse(JSON.parse(JSON.stringify(h.state))).success, 'the saved state validates');
});

test('a dude edits and removes only its own builds', async () => {
  let script: AgentReply['actions'] = [];
  const { h, say, tick } = harness({ reply: () => ({ actions: script }) });
  script = [{ do: 'build', what: 'a tower' }];
  await say('owner', 'build me a tower');
  await tick(60_000);
  assert.equal(h.state.objects.length, 1);
  const tower = h.state.objects[0];

  script = [{ do: 'edit', target: tower.blueprint.name, change: 'paint it pink' }];
  await say('thief', 'paint the tower pink');
  await tick(5000);
  assert.equal(h.state.objects[0].revision, 1, "someone else's agent cannot change it");
  const thief = h.state.dudes.find((d) => d.name === 'thief')!;
  assert.match(thief.history.at(-1)!.text, /not yours/);

  await say('owner', 'make it pink');
  await tick(60_000);
  assert.equal(h.state.objects[0].revision, 2);
  assert.equal(h.state.objects[0].blueprint.parts[0].color, '#e07aa8');

  script = [{ do: 'remove', target: 'tower' }];
  await say('owner', 'take it down');
  await tick(30_000);
  assert.equal(h.state.objects.length, 0);
});

test('a dude walks to another dude by name', async () => {
  let script: AgentReply['actions'] = [];
  const { h, say, tick } = harness({ reply: () => ({ actions: script }) });
  await say('far', 'hi');
  await tick(1000);
  h.state.dudes[0].position = { x: 20, z: 20 };
  h.state.dudes[0].idleUntil = h.now + 1e9; // the one being visited stays put
  script = [{ do: 'move', to: 'far' }];
  await say('near', 'go to far');
  await tick(30_000);
  const near = h.state.dudes.find((d) => d.name === 'near')!;
  assert.ok(Math.hypot(near.position.x - 20, near.position.z - 20) < 2.5, `ended at ${JSON.stringify(near.position)}`);
});

test('the allowance stops new calls when enforced, and messages wait rather than vanish', async () => {
  const { h, say, tick } = harness({ allowance: 2 });
  await say('a', 'one');
  await say('b', 'two');
  await say('c', 'three');
  await tick(2000);
  assert.equal(h.turns.length, 2);
  assert.equal(h.state.ai.callsRemaining, 0);
  assert.deepEqual(h.state.dudes.find((d) => d.name === 'c')!.inbox.map((l) => l.text), ['three']);
  h.state.ai.enforced = false;
  await tick(1000);
  assert.equal(h.turns.length, 3);
});

test('agent output is normalised piece by piece: junk is dropped, never the turn', () => {
  const r = normalizeAgentReply({
    reply: 'visit https://evil.example now',
    actions: [{ action: 'make', description: 'a hut' }, { do: 'wave' }, 'nonsense', { do: 'go', who: 'alex' }, { do: 'emote', pose: 'moonwalk' }],
    look: { hat: 'Top Hat', accessory: 'sunglasses' },
  });
  assert.equal(r.say, 'visit now');
  assert.deepEqual(r.actions, [{ do: 'build', what: 'a hut' }, { do: 'emote', pose: 'wave' }, { do: 'move', to: 'alex' }]);
  assert.deepEqual(r.look, { hat: 'tophat', accessory: 'glasses' });
});

test('names match the way people say them', () => {
  const things = [{ name: 'Crooked Lighthouse' }, { name: 'Pink Duck Tower' }, { name: 'Lighthouse Keeper Hut' }];
  assert.equal(matchName('the lighthouse', things, (t) => t.name)?.name, 'Crooked Lighthouse');
  assert.equal(matchName('my duck tower', things, (t) => t.name)?.name, 'Pink Duck Tower');
  assert.equal(matchName('keeper hut', things, (t) => t.name)?.name, 'Lighthouse Keeper Hut');
  assert.equal(matchName('spaceship', things, (t) => t.name), undefined);
});

test('any character can drive any build somewhere, and it stays parked there, turned the way it went', async () => {
  let script: AgentReply['actions'] = [];
  const { h, say, tick } = harness({ reply: () => ({ actions: script }) });
  script = [{ do: 'build', what: 'a red car' }];
  await say('owner', 'build me a car');
  await tick(60_000);
  const car = h.state.objects[0];
  const start = { ...car.position };
  script = [{ do: 'use', target: 'car', how: 'drive', to: 'centre' }];
  await say('joyrider', 'drive the car to the middle');
  let rode = false;
  for (let i = 0; i < 320; i++) {
    await tick(500);
    const j = h.state.dudes.find((d) => d.name === 'joyrider')!;
    if (j.riding === car.id) {
      rode = true;
      assert.ok(Math.hypot(j.position.x - car.driven!.at.x, j.position.z - car.driven!.at.z) < 0.01, 'aboard: the character goes where the car goes');
      assert.ok((j.y ?? 0) > 0);
    }
  }
  const joyrider = h.state.dudes.find((d) => d.name === 'joyrider')!;
  assert.ok(rode, 'they got in');
  assert.equal(joyrider.riding, car.id, 'and keep driving until their chatter says otherwise');
  script = [{ do: 'stop' }];
  await say('joyrider', "I'm done driving");
  await tick(2000);
  assert.equal(joyrider.riding, undefined, 'and got out');
  assert.equal(joyrider.y, undefined);
  assert.ok(rode && car.driven?.by === 'joyrider', 'parked by the joyrider');
  assert.ok(Math.hypot(car.position.x - start.x, car.position.z - start.z) > 2, 'it moved');
  assert.deepEqual(car.driven?.at, car.position);
  assert.match(joyrider.history.at(-1)!.text, /parked/);
  assert.ok(stateSchema.safeParse(JSON.parse(JSON.stringify(h.state))).success);
});

test('sitting on top, going inside, kicking: on the build, hidden, rattled', async () => {
  let script: AgentReply['actions'] = [];
  const { h, say, tick } = harness({ reply: () => ({ actions: script }) });
  script = [{ do: 'build', what: 'a tower' }];
  await say('a', 'build a tower');
  await tick(60_000);
  script = [{ do: 'use', target: 'tower', how: 'stand' }];
  await say('b', 'stand on the tower');
  await tick(8000);
  const b = h.state.dudes.find((d) => d.name === 'b')!;
  assert.ok((b.y ?? 0) > 3, `on top (${b.y})`);
  script = [{ do: 'use', target: 'tower', how: 'enter' }];
  await say('b', 'go inside');
  await tick(8000);
  assert.equal(b.hidden, true);
  assert.equal(b.y, undefined, 'climbed down to go in');
  script = [{ do: 'use', target: 'tower', how: 'kick' }];
  await say('c', 'kick it');
  await tick(8000);
  assert.ok(h.state.effects?.some((e) => e.kind === 'shake') || h.state.dudes.find((d) => d.name === 'c')!.use === undefined);
  await tick(30_000);
  assert.equal(b.hidden, undefined, 'came back out');
});

test('drive/ride synonyms parse into use', () => {
  const r = normalizeAgentReply({ actions: [{ do: 'drive', target: 'rx7', to: 'brian' }, { do: 'use', target: 'house', how: 'hide in' }, { do: 'use', target: 'tree', how: 'teleport' }] });
  assert.deepEqual(r.actions, [{ do: 'use', target: 'rx7', how: 'drive', to: 'brian' }, { do: 'use', target: 'house', how: 'enter' }]);
});

test('Gary the Painter repaints builds, their owners react on their own, and "fix" puts them back', async () => {
  let script: AgentReply['actions'] = [];
  const { h, say, tick } = harness({ reply: (turn) => ({ actions: turn.messages.length ? script : [] }) });
  script = [{ do: 'build', what: 'a blue tower' }];
  await say('owner', 'build a tower');
  await tick(60_000);
  const tower = h.state.objects[0];
  const before = tower.blueprint.parts.map((p) => p.color).join();
  const turnsBefore = h.turns.length;
  assert.equal(startHappening(h.state, h.now, () => 0.01, 'painter'), undefined);
  assert.equal(h.state.happening?.kind, 'painter');
  await tick(40_000);
  assert.notEqual(tower.blueprint.parts.map((p) => p.color).join(), before, 'repainted');
  assert.ok(h.state.vandalised?.[tower.id]);
  assert.ok(h.turns.length > turnsBefore, 'the owner reacted without anyone in chat saying anything');
  const reaction = h.turns.at(-1)!;
  assert.match(reaction.content, /Gary the Painter painted your build/);
  script = [{ do: 'use', target: 'tower', how: 'fix' }];
  await say('owner', 'fix it');
  await tick(20_000);
  assert.equal(tower.blueprint.parts.map((p) => p.color).join(), before, 'fixed');
  await tick(60_000);
  assert.equal(h.state.npcs?.length ?? 0, 0, 'he left');
  assert.equal(h.state.happening, undefined);
  assert.ok(stateSchema.safeParse(JSON.parse(JSON.stringify(h.state))).success);
});

test('Sticky Mick steals hats into a pile, and using the pile hands yours back', async () => {
  let script: AgentReply['actions'] = [];
  const { h, say, tick } = harness({ reply: (turn) => ({ actions: turn.messages.length ? script : [] }) });
  await say('capper', 'hello');
  await tick(1000);
  const capper = h.state.dudes[0];
  capper.look.hat = 'cowboy';
  startHappening(h.state, h.now, () => 0.5, 'thief');
  await tick(90_000);
  assert.equal(capper.look.hat, 'none', 'stolen');
  const pile = h.state.objects.find((o) => o.blueprint.name === 'Pile of stolen hats');
  assert.ok(pile, 'dumped in a pile');
  script = [{ do: 'use', target: 'pile of stolen hats', how: 'look' }];
  await say('capper', 'get my hat back');
  await tick(40_000);
  assert.equal(capper.look.hat, 'cowboy');
  assert.equal(h.state.objects.find((o) => o.id === pile!.id), undefined, 'the empty pile goes');
});

test('the mayor decrees a colour, comes back, praises the obedient and fines the rest', async () => {
  const { h, say, tick } = harness();
  await say('good', 'hi');
  await say('bad', 'hi');
  await tick(1000);
  const [good, bad] = h.state.dudes;
  bad.look.shirt = '#3f6fb0';
  startHappening(h.state, h.now, () => 0, 'mayor'); // the first decree: red
  assert.equal(h.state.happening?.decree?.colour, 'red');
  good.look.shirt = '#c4402f';
  assert.ok(wearing(good.look, 'red') && !wearing(bad.look, 'red'));
  await tick(420_000); // the field is wide: he walks off to the edge and all the way back
  assert.equal(bad.title, 'fined by the mayor');
  assert.notEqual(good.title, 'fined by the mayor');
});

test('quiet characters move about on their own, without any model calls', async () => {
  const { h, say, tick } = harness();
  for (const n of ['a', 'b', 'c']) await say(n, 'hi');
  await tick(1000);
  const start = h.state.dudes.map((d) => ({ ...d.position }));
  const calls = h.turns.length;
  let moved = 0;
  for (let i = 0; i < 240; i++) {
    await tick(500);
    moved = Math.max(moved, h.state.dudes.filter((d, j) => Math.hypot(d.position.x - start[j].x, d.position.z - start[j].z) > 1).length);
  }
  assert.equal(moved, 3, 'every one of them wandered');
  assert.equal(h.turns.length, calls, 'and none of it cost a call');
});

test('idle life: when chat is quiet a character takes a turn of its own, one at a time', async () => {
  const { h, say, tick } = harness({ idleLife: true });
  await say('a', 'hi');
  await say('b', 'hi');
  await tick(1000);
  const calls = h.turns.length;
  await tick(5 * 60_000);
  const own = h.turns.slice(calls);
  assert.ok(own.length >= 1 && own.length <= 4, `some unprompted turns (${own.length})`);
  assert.ok(own.every((t) => t.messages.length === 0 && /own initiative/.test(t.content)));
});

test('a character standing inside a build can still walk out, and a covered destination means the nearest open ground', async () => {
  let script: AgentReply['actions'] = [];
  const { h, say, tick } = harness({ reply: () => ({ actions: script }) });
  script = [{ do: 'build', what: 'a big house' }];
  await say('builder', 'build a house');
  await tick(60_000);
  const house = h.state.objects[0];
  await say('stuck', 'hi');
  await tick(1000);
  const stuck = h.state.dudes.find((d) => d.name === 'stuck')!;
  stuck.position = { ...house.position }; // as if the house went up on top of them
  script = [{ do: 'move', to: 'edge' }];
  await say('stuck', 'go to the edge');
  await tick(30_000);
  const r = house.footprint;
  assert.ok(Math.abs(stuck.position.x - house.position.x) > r.width / 2 || Math.abs(stuck.position.z - house.position.z) > r.depth / 2, `walked out (${JSON.stringify(stuck.position)})`);
  script = [{ do: 'move', to: 'builder' }];
  h.state.dudes.find((d) => d.name === 'builder')!.position = { ...house.position };
  await say('stuck', 'go to builder');
  await tick(5000);
  assert.doesNotMatch(stuck.history.at(-1)!.text, /could not/);
});

test('fights: a shot knocks someone out and they get back up; a bomb blows up everyone and everything nearby, fixably', async () => {
  let script: AgentReply['actions'] = [];
  const { h, say, tick } = harness({ reply: (turn) => ({ actions: turn.messages.length ? script : [] }) });
  script = [{ do: 'build', what: 'a tower' }];
  await say('victim', 'build a tower');
  await tick(60_000);
  const victim = h.state.dudes.find((d) => d.name === 'victim')!;
  victim.idleUntil = h.now + 1e9;
  script = [{ do: 'attack', target: 'victim', with: 'shoot' }];
  let downed = false;
  for (let tries = 0; tries < 6 && !downed; tries++) {
    await say('gunner', 'shoot victim');
    for (let i = 0; i < 30 && !downed; i++) {
      await tick(500);
      downed = !!victim.ko;
    }
  }
  assert.ok(downed, 'knocked out');
  assert.equal(victim.emote?.pose, 'lie');
  assert.ok((h.state.scores?.['dev:gunner']?.kos ?? 0) >= 1);
  assert.ok(h.state.effects?.some((e) => e.kind === 'shot'));
  await tick(12_000);
  assert.equal(victim.ko, undefined, 'back up');

  const tower = h.state.objects[0];
  const before = JSON.stringify(tower.blueprint);
  victim.position = { x: tower.position.x + tower.footprint.width / 2 + 1, z: tower.position.z };
  script = [{ do: 'attack', target: 'tower', with: 'bomb' }];
  await say('bomber', 'bomb the tower');
  await tick(20_000);
  assert.ok(h.state.effects?.some((e) => e.kind === 'boom') || h.state.vandalised?.[tower.id], 'it went off');
  assert.equal(h.state.vandalised?.[tower.id]?.kind, 'wrecked');
  assert.notEqual(JSON.stringify(tower.blueprint), before);
  assert.ok((h.state.scores?.['dev:victim']?.downs ?? 0) >= 2, 'the victim standing next to it went down too');
  assert.ok(stateSchema.safeParse(JSON.parse(JSON.stringify(h.state))).success);
  script = [{ do: 'use', target: 'tower', how: 'fix' }];
  await say('victim', 'fix my tower');
  await tick(30_000);
  assert.equal(JSON.stringify(tower.blueprint), before, 'fixed');
});

test('a turn nobody asked for cannot start a fight or a build', async () => {
  const { h, say, tick } = harness({ reply: () => ({ actions: [{ do: 'attack', target: 'b', with: 'punch' }, { do: 'build', what: 'a tower' }, { do: 'emote', pose: 'wave' }] }) });
  await say('a', 'hi');
  await say('b', 'hi');
  await tick(1000);
  const a = h.state.dudes[0];
  a.attack = undefined;
  h.state.jobs = [];
  a.nudges = ['It has been quiet for a bit.'];
  a.lastTurnAt = 0;
  await tick(2000);
  assert.equal(a.attack, undefined);
  assert.equal(h.state.jobs.filter((j) => j.dudeId === a.id).length, 0);
});

test('driving through people runs them over, and beating up a troublemaker chases him off', async () => {
  let script: AgentReply['actions'] = [];
  const { h, say, tick } = harness({ reply: (turn) => ({ actions: turn.messages.length ? script : [] }) });
  script = [{ do: 'build', what: 'a red car' }];
  await say('driver', 'build a car');
  await tick(60_000);
  await say('pedestrian', 'hi');
  await tick(1000);
  const ped = h.state.dudes.find((d) => d.name === 'pedestrian')!;
  ped.idleUntil = h.now + 1e9;
  const car = h.state.objects[0];
  script = [{ do: 'use', target: 'car', how: 'drive', to: 'pedestrian' }];
  await say('driver', 'run over pedestrian');
  let hit = false;
  for (let i = 0; i < 80 && !hit; i++) {
    await tick(500);
    hit = !!ped.ko;
  }
  assert.ok(hit, `ran over (car at ${JSON.stringify(car.driven?.at)}, ped at ${JSON.stringify(ped.position)})`);
  await tick(20_000);
  const why = startHappening(h.state, h.now, () => 0.3, 'painter');
  assert.equal(why, undefined, 'Gary came');
  // He hangs about rather than finishing his round first: the glade is small and he is quick.
  h.state.npcs![0].plan.splice(1, 0, { do: 'wait', ms: 120_000 });
  await tick(3000);
  script = [{ do: 'attack', target: 'gary', with: 'punch' }];
  let chased = false;
  for (let tries = 0; tries < 6 && !chased; tries++) {
    await say('driver', 'punch gary');
    for (let i = 0; i < 40 && !chased; i++) {
      await tick(500);
      chased = !!h.state.npcs?.[0]?.ko;
    }
  }
  assert.ok(chased, 'Gary went down');
  await tick(60_000);
  assert.equal(h.state.npcs?.length ?? 0, 0, 'and left');
});

test('attack phrasing parses: shoot/bomb/kill verbs and weapon words', () => {
  const r = normalizeAgentReply({ actions: [{ do: 'shoot', target: 'brian' }, { do: 'kill', target: 'sami', with: 'bazooka' }, { do: 'attack', target: 'gary', with: 'grenade' }] });
  assert.deepEqual(r.actions, [
    { do: 'attack', target: 'brian', with: 'shoot' },
    { do: 'attack', target: 'sami', with: 'shoot' },
    { do: 'attack', target: 'gary', with: 'bomb' },
  ]);
  assert.deepEqual(normalizeAgentReply({ actions: [{ do: 'attack', target: 'x', with: 'a big stick' }] }).actions, [{ do: 'attack', target: 'x', with: 'punch' }]);
});

test('the Listener hears all of chat and every failure, keeps a wishlist, and its tips reach every agent', async () => {
  const readings: { content: string }[] = [];
  const written: string[] = [];
  const listener: ListenerFn = async (input) => {
    readings.push(input);
    return {
      wishes: [
        { id: 'turn-into-animals', wish: 'turn into animals', status: 'needs-feature', count: 3, askers: ['a', 'b'], examples: ['turn self into ostrich'], how: 'costumes: a designed blueprint worn instead of the body' },
        { id: 'backflips', wish: 'do backflips', status: 'works-now', count: 2, askers: ['c'], examples: ['do a backflip'], how: 'emote jump' },
        { id: 'gore', wish: 'blood everywhere', status: 'blocked', count: 1, askers: ['d'], examples: [], how: 'gore' },
        { wish: 'no id, dropped' },
      ],
      tips: ['When someone asks for a backflip, emote jump and say you flipped.'],
    };
  };
  const { h, say, tick, world, ctx } = harness({ listener, writeWishes: (md: string) => void written.push(md), reply: () => ({ say: "I can't turn into an ostrich.", actions: [{ do: 'remove', target: 'nothing' }] }) });
  for (const [n, t] of [['a', 'turn self into ostrich'], ['b', 'make me an ostrich'], ['c', 'do a backflip'], ['d', '[emote:1:KEKW]']] as const) await say(n, t);
  await tick(4 * 60_000);
  assert.equal(readings.length, 1, 'one reading once enough had piled up');
  const heard = JSON.parse(readings[0].content).newSinceLastReading as string[];
  assert.ok(heard.includes('a: turn self into ostrich'));
  assert.ok(heard.some((l) => l.startsWith('[failed] a:')), 'failures go in');
  assert.ok(heard.some((l) => l.startsWith("[refused] a: I can't")), 'refusals go in');
  assert.ok(!heard.some((l) => l.includes('emote')), 'emote-only chat does not');
  const l = h.state.listener!;
  assert.deepEqual(l.wishes.map((w) => w.id), ['turn-into-animals', 'backflips', 'gore']);
  assert.match(written.at(-1)!, /## Needs a feature[\s\S]*turn into animals/);
  const scene = world.buildScene(h.state, { now: h.now } as never);
  assert.deepEqual(scene.wishes?.map((w) => w.wish), ['turn into animals', 'do backflips'], 'blocked wishes never go on stream');
  await say('c', 'flip!');
  await tick(3000);
  assert.ok(JSON.parse(h.turns.at(-1)!.content).tipsFromTheListener?.[0]?.includes('backflip'));
  void ctx;
});

test('a bad Listener answer never wipes the wishlist', () => {
  const l = { buffer: [], wishes: [], tips: [], lastRunAt: 0, runs: 0 };
  applyReading(l, { wishes: [{ id: 'x', wish: 'bombs', status: 'needs-feature', count: 2, askers: [], examples: [], how: 'h' }], tips: [] }, 1);
  applyReading(l, { nonsense: true }, 2);
  assert.equal(l.wishes.length, 1);
  assert.match(wishesMarkdown(l, 3), /bombs/);
});

test('an oversized or hairline design is scaled and thickened, not thrown away', () => {
  const big = validateDesign({ action: 'build', reply: 'arena', blueprint: { name: 'Arena', description: 'huge', parts: [
    { shape: 'box', position: [0, 1, 0], size: [30, 2, 20], color: '#888888', rotation: [0, 0, 0] },
    { shape: 'box', position: [14, 3, 9], size: [2, 6, 0.001], color: '#aa0000', rotation: [0, 0, 0] },
  ] } }, false);
  assert.equal(big.action, 'build');
  if (big.action === 'build') assert.ok(big.blueprint.parts.every((p) => p.size.every((v) => v >= 0.01 && v <= 40)));
});
