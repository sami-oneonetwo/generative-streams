// A livelier town (review 2026-10-23, section 3): characters answer each other (and stop after a few
// lines), idle turns get something concrete, who has been to whose place is remembered, a walker
// says where they're off to, and an empty lot comes back from someone long gone.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AgentReply } from '../src/worlds/ai-dudes/agent';
import { homePlots } from '../src/shared/city';
import { cityOf, headingOf, noteTie, tiesForAgent } from '../src/worlds/ai-dudes/city';
import { idleHook, resetTalk } from '../src/worlds/ai-dudes/talk';
import { harness } from './harness';

test('a line said to someone nearby gets an answer, and the back-and-forth stops after a few lines', async () => {
  resetTalk();
  const lines: Record<string, string> = { alex: 'Morning blair, how is the new place?', blair: 'Coming along nicely, thanks.' };
  const { h, say, tick } = harness({ idleLife: true, reply: (turn) => ({ actions: [], ...(turn.messages.length ? {} : { say: lines[turn.name] }) }) });
  await say('alex', 'hi');
  await say('blair', 'hello');
  await tick(20_000);
  const [alex, blair] = h.state.dudes;
  for (const d of [alex, blair]) Object.assign(d, { path: [], idleUntil: h.now + 600_000 });
  blair.position = { x: alex.position.x + 1.5, z: alex.position.z };
  const before = h.turns.length;
  alex.nudges = ['test: say hello to blair'];
  await tick(60_000, 250);
  const own = h.turns.slice(before);
  const answered = own.filter((t) => /said to you/.test(t.content));
  assert.equal(answered.length, 2, `blair answers alex, alex answers back, and that's it (${own.map((t) => t.name).join(', ')})`);
  assert.equal(answered[0].name, 'blair');
  assert.match(answered[0].content, /alex \(\d+ m away\) said to you: \\"Morning blair/);
  assert.equal(answered[1].name, 'alex');
  assert.equal(own.length, 3, 'no fourth line');
});

test('an idle turn gets something concrete to react to', async () => {
  let script: AgentReply['actions'] = [];
  const { h, say, tick } = harness({ reply: (turn) => ({ actions: turn.messages.length ? script : [] }) });
  script = [{ do: 'build', what: 'a little bakery', kind: 'bakery' }];
  await say('baker', 'build a bakery');
  await tick(80_000);
  script = [];
  await say('nosy', 'hi');
  const nosy = h.state.dudes.find((d) => d.name === 'nosy')!;
  nosy.position = { ...h.state.objects[0].position, x: h.state.objects[0].position.x + 8 };
  const seen = new Set<string>();
  for (let i = 0; i < 40; i++) seen.add(idleHook(h.state, nosy, h.now, Math.random).split(' ')[0]);
  assert.ok(!seen.has('It'), `never just "quiet for a bit" when there is something to say (${[...seen].join(', ')})`);
  assert.ok([...seen].some((w) => w === 'baker'), 'the new bakery next door comes up');
});

test('who comes to whose place is remembered, and a walker says why and where', async () => {
  let script: AgentReply['actions'] = [];
  const { h, say, tick } = harness({ town: true, reply: (turn) => ({ actions: turn.messages.length ? script : [] }) });
  h.state.city!.townies = [];
  script = [{ do: 'build', what: 'a noodle restaurant', kind: 'restaurant' }];
  await say('chef', 'build a noodle bar');
  await tick(80_000);
  script = [];
  await say('eater', 'hi');
  const chef = h.state.dudes.find((d) => d.name === 'chef')!;
  const eater = h.state.dudes.find((d) => d.name === 'eater')!;
  Object.assign(eater.needs!, { hunger: 10, energy: 90, fun: 90, social: 90 });
  let heading: string | undefined;
  for (let i = 0; i < 160 && !heading; i++) {
    await tick(500);
    heading = headingOf(h.state, eater);
  }
  assert.equal(heading, `hungry → ${h.state.objects[0].blueprint.name}`.slice(0, 48));
  await tick(60_000);
  assert.equal(chef.ties?.[eater.id]?.came, 1, 'the chef has a visit from the eater on the ledger');
  assert.equal(eater.ties?.[chef.id]?.went, 1);
  noteTie(h.state, eater.id, chef.id, 'visit', h.now);
  noteTie(h.state, eater.id, chef.id, 'gift', h.now, 20);
  assert.deepEqual(tiesForAgent(h.state, chef).yourRegulars, ['eater (2 visits, gave you §20)']);
});

test('when every lot is taken, an empty one comes back from someone gone for weeks', async () => {
  const { h, say } = harness();
  await say('gone', 'hi');
  const gone = h.state.dudes[0];
  const lot = gone.plot!;
  gone.turns = 1;
  gone.lastHeardAt = h.now - 20 * 24 * 60 * 60_000;
  const plots = cityOf(h.state).plots;
  for (const p of homePlots()) if (!plots[p.id]) plots[p.id] = { owner: `dev:ghost-${p.id}`, coOwners: [], claimedAt: h.now };
  await say('newbie', 'hi');
  const newbie = h.state.dudes.find((d) => d.name === 'newbie')!;
  assert.equal(newbie.plot, lot, 'the newcomer gets the long-empty lot');
  assert.equal(gone.plot, undefined);
  assert.ok(gone.ledger?.notes.some((n) => /went to a newcomer/.test(n)), 'and its old owner hears about it when back');
  // Nothing else is free: the next newcomer is told the truth.
  await say('late', 'hi');
  const late = h.state.dudes.find((d) => d.name === 'late')!;
  assert.equal(late.plot, undefined);
  assert.ok(late.history.some((l) => /build on any lot with room/.test(l.text)));
});
