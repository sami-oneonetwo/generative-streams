// Destruction: builds take damage and crumble, come down at nothing, and come back (fix, or on their
// own after a while); the Mayor's blaster and rockets, a tank's cannon, and a T-rex that goes after
// other people's builds by itself.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { harness } from './harness';
import { mayorInput } from '../src/worlds/ai-dudes/mayor';
import { DAMAGE, damageBuild, hpOf, maxHpOf } from '../src/worlds/ai-dudes/damage';
import { restore } from '../src/worlds/ai-dudes/damage';
import { stateSchema } from '../src/worlds/ai-dudes/state';
import type { AgentReply } from '../src/worlds/ai-dudes/agent';

test('a build crumbles step by step, falls at nothing, and goes back up (fix, or by itself)', async () => {
  let script: AgentReply['actions'] = [];
  const { h, say, tick } = harness({ reply: (turn) => ({ actions: turn.messages.length ? script : [] }) });
  script = [{ do: 'build', what: 'a stone house', kind: 'home' }];
  await say('kim', 'build me a house');
  await tick(80_000);
  const house = h.state.objects[0];
  const parts = JSON.stringify(house.blueprint.parts);
  const max = maxHpOf(house);
  damageBuild(h.state, house, max * 0.4, { name: 'Sam' }, h.now);
  assert.ok(hpOf(house) < max, 'took damage');
  assert.ok(house.damageRevision! >= 2, 'crumbled a couple of steps');
  assert.notEqual(JSON.stringify(house.blueprint.parts), parts, 'pieces came off');
  assert.equal(house.destroyedAt, undefined, 'still standing');
  assert.equal(damageBuild(h.state, house, max, { name: 'Sam' }, h.now), 'fell');
  assert.ok(house.destroyedAt, 'a heap of rubble');
  assert.ok(h.state.feed.some((f) => /Sam brought down/.test(f.text)));
  assert.ok(stateSchema.safeParse(JSON.parse(JSON.stringify(h.state))).success, 'the save keeps it');
  assert.ok(restore(h.state, house), 'fix puts it back');
  assert.equal(house.destroyedAt, undefined);
  assert.equal(JSON.stringify(house.blueprint.parts), parts, 'as it was');
  damageBuild(h.state, house, max * 2, { name: 'Sam' }, h.now);
  await tick(DAMAGE.rebuildMs + 5000);
  assert.equal(house.destroyedAt, undefined, 'and rebuilds itself when left alone');
  assert.equal(JSON.stringify(house.blueprint.parts), parts);
});

test("the Mayor's blaster chips at a build and a rocket takes a chunk out of it", async () => {
  let script: AgentReply['actions'] = [];
  const { h, say, tick } = harness({ reply: (turn) => ({ actions: turn.messages.length ? script : [] }) });
  script = [{ do: 'build', what: 'a wooden shed', kind: 'decor' }];
  await say('kim', 'build a shed');
  await tick(80_000);
  const shed = h.state.objects[0];
  const at = shed.position;
  const from = { x: at.x, z: at.z + shed.footprint.depth / 2 + 6 };
  mayorInput(h.state, { t: 'move', x: from.x, z: from.z, facing: Math.PI, moving: false }, h.now);
  mayorInput(h.state, { t: 'arm', weapon: 'blaster' }, h.now);
  mayorInput(h.state, { t: 'fire', aim: at }, h.now);
  const afterBlaster = hpOf(shed);
  assert.ok(afterBlaster < maxHpOf(shed), 'the blaster hit it');
  mayorInput(h.state, { t: 'arm', weapon: 'rocket' }, h.now + 1000);
  mayorInput(h.state, { t: 'fire', aim: at }, h.now + 1000);
  assert.ok(afterBlaster - hpOf(shed) > 10, 'the rocket took a chunk');
  assert.ok(h.state.effects?.some((e) => e.kind === 'shell'), 'a shell flew');
});

test('a T-rex goes after somebody else’s build and knocks it down', async () => {
  let script: AgentReply['actions'] = [];
  const { h, say, tick } = harness({ reply: (turn) => ({ actions: turn.messages.length ? script : [] }) });
  script = [{ do: 'build', what: 'a little shed', kind: 'decor' }];
  await say('kim', 'build a shed');
  await tick(80_000);
  const shed = h.state.objects[0];
  script = [{ do: 'build', what: 'a T-rex', kind: 'decor' }];
  await say('rex', 'build a t-rex');
  await tick(80_000);
  const rex = h.state.objects.find((o) => o !== shed)!;
  assert.ok(rex.creature, 'the T-rex goes about on its own');
  // Put it near the shed and let it at it.
  rex.position = { x: shed.position.x + 12, z: shed.position.z };
  for (let i = 0; i < 240 && !shed.destroyedAt; i++) await tick(500);
  assert.ok(shed.destroyedAt, 'it knocked the shed down');
  assert.ok(h.state.feed.some((f) => /T-rex brought down/i.test(f.text)), 'and the feed says so');
});
