// The opening: the Stone Age band waits across the river with the bridge down; the streamer plays the
// scene, the board asks for hands, a share of the chatters mend the bridge, and the band crosses.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { harness } from './harness';
import { cityOf } from '../src/worlds/ai-dudes/city';
import { onGround } from '../src/worlds/ai-dudes/placement';
import { stateSchema } from '../src/worlds/ai-dudes/state';
import { BRIDGE, SCENES } from '../src/shared/scenes';
import type { AgentReply } from '../src/worlds/ai-dudes/agent';

test('the opening: stuck at the river, the scene, the bridge mended by a share of the chatters, the crossing', async () => {
  let script: AgentReply['actions'] = [];
  const { h, say, tick, world } = harness({ town: true, reply: (turn) => ({ actions: turn.messages.length ? script : [] }) });
  for (const n of ['kim', 'ash', 'lee', 'max', 'sol']) await say(n, 'hi');
  await tick(2000);
  const view = () => world.buildScene(h.state, { now: h.now } as never).town!;
  const cv = cityOf(h.state).caravan!;
  assert.ok(cv.stranded, 'the band is stuck across the river');
  const band = cityOf(h.state).townies.filter((t) => t.traveller);
  assert.equal(band.length, 5, 'a father, his daughter, and three more');
  assert.ok(band.every((t) => t.position.x > BRIDGE.far), 'all on the far bank');
  assert.ok(band.find((t) => t.daughter)!.scale! < 0.7, 'the daughter is small');
  assert.equal(view().caravan, undefined, 'nothing on the board before the opening');
  assert.equal(view().bridge, 0, 'the bridge is down');

  const run = (id: string, value?: string) => world.adminActions!.find((a) => a.id === id)!.run({ state: h.state, now: h.now, log: () => {} } as never, value as never);
  run('scene-opening');
  assert.equal(view().scene?.id, 'opening');
  assert.equal(view().scene?.leader, 'Toma');
  const leader = band.find((t) => t.leader)!;
  const startX = leader.position.x;
  await tick(13_000);
  assert.ok(leader.position.x < startX - 0.5, 'the leader stepped forward to speak');
  await tick(SCENES.opening.ms - 12_000);
  assert.equal(view().scene, undefined, 'the scene is over');
  const ask = view().caravan!.asks[0];
  assert.equal(ask.need, 2, 'two of the five chatters (40%) are needed');
  assert.ok(h.announced.some((l) => /bridge/i.test(l)), 'chat told about the bridge');

  // An agent that tries to build a bridge of its own goes to mend the river one instead.
  script = [{ do: 'build', what: 'a wooden log bridge with rope rails', kind: 'decor' }];
  await say('lee', 'do something useful');
  await tick(1000);
  const lee = h.state.dudes.find((d) => d.name === 'lee')!;
  assert.equal(lee.labour?.site, 'bridge', 'lee went to the river bridge');
  assert.ok(!h.state.jobs.some((j) => j.dudeId === lee.id && /bridge/i.test(j.request ?? '') && j.status !== 'failed'), 'and no bridge on the lot');
  lee.labour = undefined; // (lee steps aside, so kim and ash do it)
  lee.path = [];
  cityOf(h.state).caravan!.volunteers = [];
  // Saying so is enough: no agent turn needed, and it beats a build in progress.
  script = [{ do: 'build', what: 'a little hut', kind: 'home' }];
  await say('kim', 'build a hut');
  // The agent's own take (acting it out, walking somewhere) doesn't cancel the shift.
  script = [{ do: 'bit', caption: 'is mending the bridge', steps: [{ pose: 'hammer', seconds: 2 }] } as never, { do: 'move', to: 'square' } as never];
  await say('kim', 'build the bridge');
  await tick(1000);
  assert.equal(h.state.dudes.find((d) => d.name === 'kim')!.labour?.site, 'bridge', 'kim set off for the bridge straight away');
  // Nor does "help" again or "stop" from the agent on later turns: the shift carries on to the end.
  script = [{ do: 'help' }, { do: 'stop' } as never];
  await tick(4000);
  await say('kim', 'go go go');
  await tick(1000);
  assert.equal(h.state.dudes.find((d) => d.name === 'kim')!.labour?.site, 'bridge', 'still on the bridge');
  // Whatever knocks a volunteer off it, they go back.
  h.state.dudes.find((d) => d.name === 'kim')!.labour = undefined;
  await tick(1000);
  assert.equal(h.state.dudes.find((d) => d.name === 'kim')!.labour?.site, 'bridge', 'back on the bridge');
  await say('ash', 'I will help with the bridge');
  // Ticks that don't land on the end of a shift (the live server's) still finish it.
  for (let i = 0; i < 40 && cv.stranded; i++) await tick(5000, 730);
  assert.ok(!cv.stranded, 'mended');
  assert.deepEqual(new Set(cv.helpers), new Set(h.state.dudes.filter((d) => d.name === 'kim' || d.name === 'ash').map((d) => d.id)), 'by kim and ash');
  assert.equal(view().bridge, undefined, 'the bridge stands whole');
  assert.equal(view().scene?.id, 'crossing', 'the crossing plays');
  await tick(SCENES.crossing.ms + 6000);
  assert.ok(view().caravan?.asks.length, 'the first visit opened');
  assert.ok(band.every((t) => t.position.x < BRIDGE.near), 'everyone has crossed');
  // The River Bank is the town's ground now (FK-078): the helpers are on it, on the town side of the water.
  assert.ok(h.state.dudes.every((d) => onGround(d.position) && d.position.x < BRIDGE.near), 'the helpers are back on the town bank');

  run('name-daughter', 'Nell');
  assert.ok(cityOf(h.state).townies.some((t) => t.daughter && t.name === 'Nell'), 'the daughter renamed');
  assert.ok(stateSchema.safeParse(JSON.parse(JSON.stringify(h.state))).success, 'the save keeps it all');
});
