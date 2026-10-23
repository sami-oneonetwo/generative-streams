// The Town Crier: deeds for the caravan are tallied per chatter, the beats are posted to chat,
// !top / !town / !me answer, and the age's top name gets a laurel when it turns.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { harness } from './harness';
import { ageOf, cityOf } from '../src/worlds/ai-dudes/city';
import { skipVisit } from '../src/worlds/ai-dudes/caravan';
import { credit, crierOf } from '../src/worlds/ai-dudes/crier';
import { stateSchema } from '../src/worlds/ai-dudes/state';
import type { AgentReply } from '../src/worlds/ai-dudes/agent';

test('the crier announces the caravan, keeps the board, answers commands and crowns the age', async () => {
  const { h, say, tick } = harness({ town: true, reply: () => ({ actions: [] }) });
  await say('kim', 'hi');
  await say('ash', 'hello');
  await tick(2000);
  assert.ok(cityOf(h.state).caravan, 'the caravan made camp');
  // The Stone Age band starts stuck across the river: mend the bridge and let them cross first.
  skipVisit(h.state, h.now);
  await tick(21_000);

  assert.ok(h.announced.some((l) => /across the river|camped/.test(l)), `arrival posted: ${h.announced.join(' | ')}`);

  const kim = h.state.dudes.find((d) => d.name === 'kim')!;
  const ash = h.state.dudes.find((d) => d.name === 'ash')!;
  credit(h.state, kim.id, 'build', h.now);
  credit(h.state, kim.id, 'build', h.now);
  credit(h.state, ash.id, 'serve', h.now);
  await tick(1000);
  assert.ok(h.announced.some((l) => l.includes('@kim') && /10 deeds/.test(l)), 'a leader once someone has ten deeds');

  h.announced.length = 0;
  await say('ash', '!top');
  await tick(1000);
  assert.match(h.announced.join(' '), /1\. @kim 10, 2\. @ash 2/);
  assert.equal(ash.inbox.length, 0, "the command doesn't reach the character");
  h.now += 10_000;
  await say('ash', '!me');
  await tick(1000);
  assert.match(h.announced.at(-1)!, /@ash you're 2nd .* 2 deeds, 8 behind @kim/);
  h.now += 10_000;
  await say('kim', '!town');
  await tick(1000);
  assert.match(h.announced.at(-1)!, /wants: .*\(\d\/\d\)/);
  const before = h.announced.length;
  await say('kim', '!town');
  await tick(1000);
  assert.equal(h.announced.length, before, 'asking again straight away is ignored');

  h.announced.length = 0;
  skipVisit(h.state, h.now);
  await tick(1000);
  assert.ok(h.announced.some((l) => l.includes('@kim') && /fed/.test(l)), `the visit's helpers thanked: ${h.announced.join(' | ')}`);

  for (let i = 0; i < 6 && ageOf(h.state) === 0; i++) {
    skipVisit(h.state, h.now);
    await tick(25_000);
  }
  assert.equal(ageOf(h.state), 1);
  assert.ok(h.announced.some((l) => /Hero of the age: @kim|@kim carried it/.test(l)), 'the hero named');
  assert.ok(kim.badges?.some((b) => b.kind === 'hero:0'), 'with a laurel');
  assert.equal(crierOf(h.state).age, 1);
  assert.deepEqual(crierOf(h.state).tally, {}, 'a fresh board for the new age');
  assert.ok(stateSchema.safeParse(JSON.parse(JSON.stringify(h.state))).success, 'the save keeps it');
});

test('sandbox mode: the caravan goes home and nothing is asked, and it comes back with a fresh visit', async () => {
  const { h, say, tick, world } = harness({ town: true, reply: () => ({ actions: [] }) });
  await say('kim', 'hi');
  await tick(2000);
  // The Stone Age band starts stuck across the river: mend the bridge and let them cross first.
  skipVisit(h.state, h.now);
  await tick(21_000);
  const run = (id: string) => world.adminActions!.find((a) => a.id === id)!.run({ state: h.state, now: h.now, log: () => {} } as never);
  run('caravan-off');
  await tick(1000);
  assert.ok(!cityOf(h.state).townies.some((t) => t.traveller), 'the travellers went home');
  assert.equal(world.buildScene(h.state, { now: h.now } as never).town?.caravan, undefined, 'no asks on the board');
  assert.ok(h.announced.some((l) => /Free build/.test(l)), 'chat told');
  h.now += 70_000;
  await say('kim', '!town');
  await tick(1000);
  assert.match(h.announced.at(-1)!, /Free build/);
  assert.ok(!h.announced.some((l) => /caravan/i.test(l)), `no caravan talk in sandbox: ${h.announced.join(' | ')}`);
  run('caravan-on');
  await tick(1000);
  assert.ok(cityOf(h.state).townies.some((t) => t.traveller), 'the travellers are back');
  assert.ok(world.buildScene(h.state, { now: h.now } as never).town?.caravan?.asks.length, 'asking again');
  assert.ok(stateSchema.safeParse(JSON.parse(JSON.stringify(h.state))).success);
});

test('the crier now and then picks out a build a chatter made', async () => {
  let script: AgentReply['actions'] = [];
  const { h, say, tick } = harness({ reply: (turn) => ({ actions: turn.messages.length ? script : [] }) });
  script = [{ do: 'build', what: 'a crooked lighthouse', kind: 'decor' }];
  await say('kim', 'build a lighthouse');
  await tick(80_000);
  assert.ok(h.state.objects.some((o) => o.owner), 'kim built something');
  h.announced.length = 0;
  for (let i = 0; i < 25 && !h.announced.some((l) => l.includes('@kim')); i++) {
    await say('kim', 'still here');
    await tick(60_000);
  }
  const line = h.announced.find((l) => l.includes('@kim'));
  assert.ok(line, `a spotlight within ~25 minutes: ${h.announced.join(' | ')}`);
  assert.ok(line!.includes(h.state.objects.find((o) => o.owner)!.blueprint.name), 'naming the build');
});
