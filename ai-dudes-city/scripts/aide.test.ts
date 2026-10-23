// The Mayor's aide: a wish typed on the operator page becomes changes from a closed set (his look,
// his title, a build reworked, a town control), and the answer goes back to the page.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { harness } from './harness';
import { mayorInput, mayorDudeView, mayorView } from '../src/worlds/ai-dudes/mayor';
import { cityOf, headName } from '../src/worlds/ai-dudes/city';
import { stateSchema } from '../src/worlds/ai-dudes/state';
import type { AgentReply } from '../src/worlds/ai-dudes/agent';

test('the aide changes the Mayor, reworks a build by name, runs a town control, and answers', async () => {
  let reply = '{}';
  const seen: string[] = [];
  let script: AgentReply['actions'] = [];
  const { h, say, tick } = harness({
    aide: async (input) => (seen.push(input.content), reply),
    reply: (turn) => ({ actions: turn.messages.length ? script : [] }),
  });
  script = [{ do: 'build', what: 'a crooked lighthouse', kind: 'decor' }];
  await say('kim', 'build a lighthouse');
  await tick(80_000);
  const built = h.state.objects.find((o) => o.owner)!;
  mayorInput(h.state, { t: 'move', x: 0, z: 9, facing: 0, moving: false }, h.now);

  reply = JSON.stringify({
    reply: 'Purple cape on, and the lighthouse gets a stripe.',
    actions: [
      { do: 'look', accessory: 'cape', accessoryColor: '#7a3fc4', shirt: '#ffffff', costume: false },
      { do: 'title', title: 'The Grand Duke' },
      { do: 'edit', target: built.blueprint.name, change: 'add a red stripe' },
      { do: 'admin', id: 'rename-town', value: 'Duketon' },
      { do: 'admin', id: 'remove-dude', value: 'kim' },
      { do: 'fly to the moon' },
    ],
  });
  mayorInput(h.state, { t: 'ask', text: 'put me in a purple cape and stripe the lighthouse' }, h.now);
  assert.equal(mayorView(h.state, h.now).aide?.thinking, true, 'the page shows it thinking');
  await tick(1000);
  assert.match(seen[0], /crooked lighthouse|lighthouse/i, 'the aide was shown the builds nearby');
  const me = mayorDudeView(h.state, h.now)[0];
  assert.equal(me.look.accessory, 'cape');
  assert.equal(me.look.accessoryColor, '#7a3fc4');
  assert.equal(me.look.outfit, undefined, 'the costume came off so the colours show');
  assert.equal(headName(h.state), 'The Grand Duke');
  assert.ok(h.state.jobs.some((j) => j.dudeId === 'mayor' && j.kind === 'edit' && j.targetId === built.id), 'the build is being reworked');
  assert.equal(cityOf(h.state).name, 'Duketon');
  assert.ok(h.state.dudes.some((d) => d.name === 'kim'), 'moderation is not something the aide can do');
  const aide = mayorView(h.state, h.now).aide!;
  assert.equal(aide.thinking, false);
  assert.equal(aide.ok, false, 'it says what it could not do');
  assert.match(aide.reply, /Purple cape on.*Couldn't: no town control "remove-dude"; 1 step/);

  reply = JSON.stringify({ reply: 'Back to normal.', actions: [{ do: 'look-reset' }, { do: 'title-reset' }] });
  mayorInput(h.state, { t: 'ask', text: 'undo all that' }, h.now);
  await tick(1000);
  assert.notEqual(headName(h.state), 'The Grand Duke');
  assert.equal(h.state.mayor?.look, undefined);
  assert.ok(stateSchema.safeParse(JSON.parse(JSON.stringify(h.state))).success, 'the save keeps it');
});

test('without a model the aide says so instead of hanging', async () => {
  const { h, tick } = harness();
  mayorInput(h.state, { t: 'ask', text: 'make it rain' }, h.now);
  await tick(1000);
  const aide = mayorView(h.state, h.now).aide!;
  assert.equal(aide.thinking, false);
  assert.equal(aide.ok, false);
  assert.match(aide.reply, /needs the real models|not set up/);
});
