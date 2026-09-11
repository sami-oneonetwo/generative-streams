// What a viewer can actually do (brief §5.4, simplified). A viewer owns one
// server, and there are exactly two things they can ask for: make it bigger so
// the room carries more chat, or turn it back on when it dies. These pin both
// verbs, the power cost that makes upgrading a real decision, and the random
// death that gives an owner a reason to be watching.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ChatMessage, QueueEntryView, TaskSpec, WorldCtx } from '../src/engine/world';
import {
  computeDrawW,
  createInitialState,
  deadServers,
  liveServers,
  roomCapacityPerMin,
  totalDrawW,
  type Server,
  type ServerRoomState,
} from '../src/worlds/server-room/state';
import { intents, quickClassify } from '../src/worlds/server-room/intents';
import { events } from '../src/worlds/server-room/events';
import { DOING, VALUE_COLS } from '../src/worlds/server-room/screens';
import { applyOfflineTime } from '../src/worlds/server-room/offline';
import { tuning } from '../src/worlds/server-room/tuning';

const now = 1_800_000_000_000;

function server(state: ServerRoomState, slot: number, over: Partial<Server> = {}): Server {
  const s: Server = {
    id: `server-${slot}`, slot, ownerUserId: `u:guest${slot}`, ownerName: `guest${slot}`, name: `server-${slot}`,
    health: 100, level: 0, temperature: 22, powerDrawW: tuning.baseDrawW,
    uptimeDays: 0, delivered: 0, createdAt: now, darkStreams: 0, ...over,
  };
  state.servers[s.id] = s;
  return s;
}

function harness(state = createInitialState(now)) {
  let clock = now;
  const said: string[] = [];
  const logged: string[] = [];
  let tasks: TaskSpec<ServerRoomState>[] = [];
  const ctx: WorldCtx<ServerRoomState> = {
    get state() { return state; },
    get now() { return clock; },
    log: (line) => { logged.push(line); },
    say: (text) => { said.push(text); },
    enqueueTask: (spec) => { tasks.push(spec); return { id: `task-${tasks.length}` }; },
    get queue(): ReadonlyArray<QueueEntryView> {
      return tasks.map((t, i) => ({ id: `task-${i}`, kind: t.kind, label: t.label, requestedBy: t.requestedBy }));
    },
    llm: { dialogue: async () => null, moderate: async (text: string) => ({ ok: true, cleaned: text }) },
    tuning,
    get chatRatePerMin() { return 0; },
    rng: () => 0.5,
  };
  return {
    ctx, state, said, logged,
    get tasks() { return tasks; },
    finishTasks() {
      const pending = tasks;
      tasks = [];
      for (const task of pending) task.onComplete(ctx);
    },
    setNow: (at: number) => { clock = at; },
  };
}

const message = (user: string, text: string): ChatMessage => ({
  id: `${user}-${Math.random()}`, userId: `u:${user}`, username: user, text, ts: now, source: 'kick',
});

const say = (intent: string, h: ReturnType<typeof harness>, user: string, text: string, params?: unknown) =>
  intents.find((i) => i.name === intent)!.handle(h.ctx, message(user, text), params);

// ------------------------------------------------------------------- upgrade

test('an upgrade makes the room carry more chat, and costs power to do it', async () => {
  const h = harness();
  const s = server(h.state, 0);
  const carriedBefore = roomCapacityPerMin(h.state);
  const drawBefore = totalDrawW(h.state);

  await say('upgrade', h, 'guest0', 'upgrade mine');
  assert.equal(h.tasks[0].kind, 'upgrade', 'it is work Admin has to walk over and do');
  h.finishTasks();

  assert.equal(s.level, 1);
  assert.equal(roomCapacityPerMin(h.state), carriedBefore + tuning.upgradeCapacityPerMin);
  assert.equal(totalDrawW(h.state), drawBefore + tuning.upgradeDrawW);
  assert.equal(s.powerDrawW, computeDrawW(s));
  // Chat is told what they bought, in plain words.
  assert.ok(h.said.some((l) => /carry a lot more|a size bigger/i.test(l)), h.said.join(' | '));
});

test('a server can only get so big, and he says so instead of failing quietly', async () => {
  const h = harness();
  const s = server(h.state, 0, { level: tuning.upgradeMaxLevel });
  await say('upgrade', h, 'guest0', 'upgrade mine');
  assert.equal(h.tasks.length, 0);
  assert.equal(s.level, tuning.upgradeMaxLevel);
  assert.ok(h.said.some((l) => /as big as it gets/i.test(l)), h.said.join(' | '));
});

test('an upgrade that would cut the power off is refused, before and after the walk', async () => {
  const h = harness();
  server(h.state, 0);
  // Only enough headroom left for nothing at all.
  h.state.power.budgetW = totalDrawW(h.state);

  await say('upgrade', h, 'guest0', 'upgrade mine');
  assert.equal(h.tasks.length, 0);
  assert.ok(h.said.some((l) => /power would go off/i.test(l)), h.said.join(' | '));

  // And again for the race: budget is fine when asked, gone when he arrives.
  const race = harness();
  const s = server(race.state, 0);
  await say('upgrade', race, 'guest0', 'upgrade mine');
  assert.equal(race.tasks.length, 1);
  race.state.power.budgetW = totalDrawW(race.state);
  race.finishTasks();
  assert.equal(s.level, 0, 'he must re-check on arrival, not trust the old answer');
  assert.ok(race.said.some((l) => /ran out of power while i was walking over/i.test(l)));
});

// ------------------------------------------------------------------- restart

test('a restart brings a dead server back and it carries chat again', async () => {
  const h = harness();
  const s = server(h.state, 0, { health: 0, darkSince: now - 60_000 });
  assert.equal(liveServers(h.state).length, 0);
  const carriedDead = roomCapacityPerMin(h.state);

  await say('restart', h, 'guest0', 'restart mine');
  assert.equal(h.tasks[0].kind, 'restart');
  assert.equal(h.tasks[0].workMs, tuning.taskRestartMs);
  h.finishTasks();

  assert.equal(s.health, 100);
  assert.equal(s.darkSince, undefined);
  assert.equal(liveServers(h.state).length, 1);
  assert.ok(roomCapacityPerMin(h.state) > carriedDead, 'the room carries more with it back');
  assert.ok(h.said.some((l) => /it lives|back and carrying/i.test(l)), h.said.join(' | '));
});

test('a struggling server can be restarted; a healthy one is left alone', async () => {
  const struggling = harness();
  const weak = server(struggling.state, 0, { health: 30 });
  await say('restart', struggling, 'guest0', 'restart mine');
  struggling.finishTasks();
  assert.equal(weak.health, 100);

  const fine = harness();
  server(fine.state, 0, { health: 100 });
  await say('restart', fine, 'guest0', 'restart mine');
  assert.equal(fine.tasks.length, 0);
  assert.ok(fine.said.some((l) => /running fine/i.test(l)), fine.said.join(' | '));
});

test('only owners get to restart, and nothing restarts while the power is off', async () => {
  const h = harness();
  server(h.state, 0, { health: 0 });
  await say('restart', h, 'stranger', 'restart mine');
  assert.equal(h.tasks.length, 0);
  assert.ok(h.said.some((l) => /don't have a server|nothing in this rack is yours/i.test(l)), h.said.join(' | '));

  const dark = harness();
  server(dark.state, 0, { health: 0 });
  dark.state.power.breakerTripped = true;
  await say('restart', dark, 'guest0', 'restart mine');
  assert.equal(dark.tasks.length, 0);
  assert.ok(dark.said.some((l) => /power's off/i.test(l)), dark.said.join(' | '));
});

// --------------------------------------------------------------------- death

test('servers die, worst-first, and the owner is told the words to say', () => {
  const h = harness();
  server(h.state, 0, { health: 100 });
  const sick = server(h.state, 1, { health: 25 });
  const def = events.find((e) => e.name === 'server-died')!;

  // A room with something already struggling is likelier to lose one.
  assert.ok(def.weight(h.state) > 0);
  def.trigger(h.ctx);

  assert.equal(sick.health, 0, 'the one already struggling goes first');
  assert.equal(sick.darkSince, now);
  assert.deepEqual(deadServers(h.state).map((s) => s.id), [sick.id]);
  assert.ok(h.said.some((l) => /guest1.*restart mine/i.test(l)), h.said.join(' | '));
});

test('nothing can die in an empty room, or a room where everything is already off', () => {
  const empty = harness();
  const def = events.find((e) => e.name === 'server-died')!;
  assert.equal(def.weight(empty.state), 0);

  const allOff = harness();
  server(allOff.state, 0, { health: 0 });
  assert.equal(def.weight(allOff.state), 0);
});

// ---------------------------------------------------------------- the plaque

test('a server left off for too long comes out of the rack and onto the wall', () => {
  const h = harness();
  const s = server(h.state, 0, { health: 0, delivered: 61_935, darkStreams: tuning.darkStreamsToDecommission - 1 });
  h.state.chatters['u:guest0'] = { serverId: s.id, name: 'guest0', firstSeen: now, lastSeen: now, reports: 0 };
  h.state.lastLiveAt = now - 86_400_000;

  const facts = applyOfflineTime(h.ctx);
  assert.equal(Object.keys(h.state.servers).length, 0, 'it is out of the rack');
  assert.equal(h.state.memorial.at(-1)!.delivered, 61_935, 'the count it carried is kept');
  assert.equal(h.state.memorial.at(-1)!.ownerName, 'guest0');
  assert.equal(h.state.chatters['u:guest0'].serverId, undefined);
  assert.ok(facts.some((f) => /came out of the rack/.test(f)), facts.join(' | '));
});

test('a server that is merely off overnight is not lost, and its owner is told', () => {
  const h = harness();
  const s = server(h.state, 0, { health: 0 });
  h.state.lastLiveAt = now - 86_400_000;

  const facts = applyOfflineTime(h.ctx);
  assert.ok(h.state.servers[s.id], 'one stream off is not a decommission');
  assert.equal(s.darkStreams, 1);
  assert.ok(facts.some((f) => /guest0 went off overnight.*restart mine/.test(f)), facts.join(' | '));
});

// ------------------------------------------------------------- the fast path

test('the fast path reads the two verbs without spending a classifier call', () => {
  const cases: [string, string | null][] = [
    ['give me a server', 'provision'],
    ['give me a box', 'provision'], // the old wording still works
    ['I want one', 'provision'],
    ['can I get a server called doom-machine', 'provision'],
    ['restart mine', 'restart'],
    ['reboot my server', 'restart'],
    ['my server is dead', 'restart'],
    ['upgrade mine', 'upgrade'],
    ['upgrade my server', 'upgrade'],
    ['make my server bigger', 'upgrade'],
    ["something's beeping", 'report'],
    ['turn off the air con', null],
    // Conversation must fall through to the classifier, not be grabbed.
    ['what do you actually do all day', null],
    ['how big can a server get', null],
  ];
  for (const [text, expected] of cases) {
    assert.equal(quickClassify(text)?.intent ?? null, expected, text);
  }
});

test('every verb the character card teaches actually exists', () => {
  const names = intents.map((i) => i.name).sort();
  assert.deepEqual(names, ['ask', 'claim', 'hinder', 'provision', 'report', 'restart', 'upgrade']);
});

/**
 * The status page has one row for what Admin is doing, and it is the only place
 * a viewer learns why he has walked off. A phrase one character too long
 * truncates mid-word, which is how "getting the power back" first shipped.
 */
test('every phrase for what Admin is doing fits the status row', () => {
  for (const [kind, phrase] of Object.entries(DOING)) {
    assert.ok(Array.from(phrase).length <= VALUE_COLS, `${kind}: "${phrase}" is too long`);
  }
  // And every task kind the world actually enqueues has a phrase, so the row
  // never falls back to the vague default.
  const enqueued = [
    'provision', 'restart', 'upgrade', 'investigate', 'breaker-repair',
    'block-traffic', 'recable', 'unpack', 'hinder-heat',
  ];
  for (const kind of enqueued) assert.ok(DOING[kind], `no phrase for the "${kind}" task`);
});
