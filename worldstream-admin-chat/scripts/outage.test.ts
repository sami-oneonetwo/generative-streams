// Being cut off by an outage (brief §5.7). With nothing being carried the room
// carries no chat either, including the chat Admin reads: the screen goes to
// static, arriving
// messages are held rather than processed, and they land together when the room
// comes back. These pin the gate, the buffer, the release and what the screens
// and the persona are allowed to claim while it lasts.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Engine } from '../src/engine/engine';
import { IntentPipeline } from '../src/engine/intents';
import { ChatRateMeter } from '../src/engine/chatRate';
import type { ChatFlood, ChatMessage, EngineView, IntentDef, QueueEntryView, TaskSpec, WorldCtx } from '../src/engine/world';
import { createInitialState, type Server, type ServerRoomState } from '../src/worlds/server-room/state';
import { audible, deafForMs, deafSince, onAudible } from '../src/worlds/server-room/outage';
import { intents as serverRoomIntents } from '../src/worlds/server-room/intents';
import { displayReceipt } from '../src/worlds/server-room/display';
import { tripBreaker } from '../src/worlds/server-room/tick';
import { buildScene, LAYOUT } from '../src/worlds/server-room/scene';
import { persona } from '../src/worlds/server-room/persona';
import { tuning } from '../src/worlds/server-room/tuning';
import { deafPanel } from '../client/renderer/chatMonitor';

const now = 1_800_000_000_000;

function server(state: ServerRoomState, slot: number, health = 100): Server {
  const s: Server = {
    id: `server-${slot}`, slot, ownerUserId: `user-${slot}`, ownerName: `guest${slot}`, name: `server-${slot}`,
    health, level: 0, temperature: 22, powerDrawW: tuning.baseDrawW,
    uptimeDays: 1, delivered: 0, createdAt: now, darkStreams: 0,
  };
  state.servers[s.id] = s;
  return s;
}

function harness(state = createInitialState(now)) {
  const said: string[] = [];
  const logged: string[] = [];
  const tasks: TaskSpec<ServerRoomState>[] = [];
  const ctx: WorldCtx<ServerRoomState> = {
    get state() { return state; },
    get now() { return Date.now(); },
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
  return { ctx, state, said, logged, tasks };
}

/**
 * A real IntentPipeline over a real Engine.recordChat/recordClassification, with
 * the world reduced to the pieces the deaf path touches. quickClassify always
 * resolves, so no test can reach the network.
 */
function pipelineHarness(state: ServerRoomState) {
  const { ctx, said, logged } = harness(state);
  const handled: string[] = [];
  const floods: ChatFlood[] = [];
  const order: string[] = [];
  const displayedAtFlood: number[] = [];
  const intents: IntentDef<ServerRoomState>[] = [
    { name: 'ask', description: 'talk', examples: [], handle: (_c, msg) => { handled.push(msg.text); order.push('reply'); } },
  ];
  const engine = Object.create(Engine.prototype) as Engine<ServerRoomState>;
  Object.assign(engine, {
    state, ctx, recentChat: [], chatRevision: 0, classifications: [], renderDirty: false,
    chatRate: new ChatRateMeter(), confidenceThreshold: 0.6,
    log: { push: (line: string) => { logged.push(line); } },
    world: {
      intents, fallbackIntent: 'ask', quickClassify: () => ({ intent: 'ask' }),
      displayReceipt, audible,
      onAudible: (_c: unknown, flood: ChatFlood) => {
        floods.push(flood);
        order.push('flood');
        displayedAtFlood.push(engine.recentChat.length);
      },
    },
  });
  // The real engine exposes this through makeCtx(); the harness has to as well.
  Object.defineProperty(ctx, 'replay', { get: () => engine.replay, configurable: true });
  return { engine, pipeline: new IntentPipeline(engine), handled, floods, order, displayedAtFlood, said, logged };
}

let seq = 0;
/** A known chatter by default; `stranger` skips registering them. */
function message(state: ServerRoomState, userId: string, text = 'hello admin', stranger = false): ChatMessage {
  if (!stranger && !state.chatters[userId]) {
    state.chatters[userId] = { firstSeen: now, lastSeen: now, reports: 0 };
  }
  return { id: `m${++seq}`, userId, username: userId, text, ts: Date.now(), source: 'kick' };
}

// ------------------------------------------------------------------ the gate

test("Admin's own machine keeps the room hearing chat until the power goes", () => {
  const state = createInitialState(now);
  assert.equal(audible(state), true, 'an empty rack still has his own machine');
  server(state, 0, 0); // a dark box adds nothing, and takes nothing away
  assert.equal(audible(state), true);
  state.power.breakerTripped = true;
  assert.equal(audible(state), false);
});

test('deafness dates itself from the outage that caused it, and only while it lasts', () => {
  const { ctx, state } = harness();
  server(state, 0);
  assert.equal(deafSince(state), undefined);
  assert.equal(deafForMs(state, Date.now()), 0);

  tripBreaker(ctx, 'test');
  assert.equal(audible(state), false);
  assert.equal(deafSince(state), state.uptime.lastOutageAt);
  assert.ok(deafForMs(state, (state.uptime.lastOutageAt ?? 0) + 5000) === 5000);

  // A tripped breaker with nothing on the record can't invent a start time.
  const bare = createInitialState(now);
  bare.power.breakerTripped = true;
  assert.equal(deafSince(bare), undefined);
  assert.equal(deafForMs(bare, Date.now()), 0);
});

// --------------------------------------------------------------- the holding

test('a deaf room holds arrivals instead of hearing them, and still feels the load', async () => {
  const state = createInitialState(now);
  state.power.breakerTripped = true;
  const { engine, pipeline, handled } = pipelineHarness(state);

  for (let i = 0; i < 3; i++) await pipeline.handle(message(state, `u${i}`, `held ${i}`));

  assert.equal(pipeline.heldCount, 3);
  assert.deepEqual(engine.recentChat, [], 'nothing reaches the screen');
  assert.deepEqual(engine.classifications, [], 'nothing is classified');
  assert.deepEqual(handled, [], 'no intent runs');
  // Demand is measured on arrival: held messages are still traffic the room
  // failed to carry.
  assert.equal(engine.chatRate.ratePerMin(Date.now()), 3);
});

test('dedupe and per-user flood control still apply while the room is deaf', async () => {
  const state = createInitialState(now);
  state.power.breakerTripped = true;
  const { pipeline } = pipelineHarness(state);

  const msg = message(state, 'kaz', 'same message');
  await pipeline.handle(msg);
  await pipeline.handle(msg); // same id
  await pipeline.handle(message(state, 'kaz', 'again, immediately')); // inside the 3s window
  assert.equal(pipeline.heldCount, 1);
});

test('the buffer is bounded, keeps the newest and counts what it lost', async () => {
  const state = createInitialState(now);
  state.power.breakerTripped = true;
  const { pipeline, floods } = pipelineHarness(state);

  for (let i = 0; i < 205; i++) await pipeline.handle(message(state, `u${i}`, `held ${i}`));
  assert.equal(pipeline.heldCount, 200);

  state.power.breakerTripped = false;
  await pipeline.release();
  assert.equal(floods[0].held, 200);
  assert.equal(floods[0].overflowed, 5);
});

// --------------------------------------------------------------- the release

test('nothing is released while the room is still deaf', async () => {
  const state = createInitialState(now);
  state.power.breakerTripped = true;
  const { engine, pipeline, floods } = pipelineHarness(state);

  await pipeline.handle(message(state, 'kaz'));
  await pipeline.release();
  assert.equal(pipeline.heldCount, 1);
  assert.deepEqual(engine.recentChat, []);
  assert.deepEqual(floods, []);
});

test('the flood lands in order: everything displayed, only the newest few acted on', async () => {
  const state = createInitialState(now);
  state.power.breakerTripped = true;
  const { engine, pipeline, handled, floods, order, displayedAtFlood } = pipelineHarness(state);

  for (let i = 0; i < 12; i++) await pipeline.handle(message(state, `u${i}`, `held ${i}`));
  state.power.breakerTripped = false;
  await pipeline.release();

  assert.equal(pipeline.heldCount, 0);
  assert.deepEqual(
    engine.recentChat.map((m) => m.text),
    Array.from({ length: 12 }, (_v, i) => `held ${i}`),
    'the whole flood is displayed, in arrival order',
  );
  assert.deepEqual(handled, Array.from({ length: 8 }, (_v, i) => `held ${i + 4}`), 'the newest eight are acted on');
  assert.equal(engine.classifications.length, 8);

  assert.equal(floods.length, 1);
  const flood = floods[0];
  assert.equal(flood.held, 12);
  assert.equal(flood.displayed, 12);
  assert.equal(flood.acted, 8);
  assert.equal(flood.overflowed, 0);
  assert.equal(flood.people, 12);
  assert.ok(Number.isFinite(flood.deafMs) && flood.deafMs >= 0);

  // The whole flood is on screen before he reacts to it, and he reacts before
  // answering anyone: each reply can cost a model round trip, and a reaction
  // that arrives after eight of those is a reaction to nothing.
  assert.deepEqual(displayedAtFlood, [12]);
  assert.equal(order[0], 'flood');
  assert.deepEqual(order.slice(1), Array.from({ length: 8 }, () => 'reply'));

  // Draining once is enough; the next loop pass must not re-narrate.
  await pipeline.release();
  assert.equal(floods.length, 1);
});

test('a flood is answered once, at its newest message', async () => {
  const state = createInitialState(now);
  state.power.breakerTripped = true;
  const { engine, pipeline } = pipelineHarness(state);
  const seen: (number | undefined)[] = [];
  (engine.world as { intents: IntentDef<ServerRoomState>[] }).intents = [
    { name: 'ask', description: 'talk', examples: [], handle: (ctx) => { seen.push(ctx.replay?.remaining); } },
  ];

  for (let i = 0; i < 4; i++) await pipeline.handle(message(state, `u${i}`, `held ${i}`));
  state.power.breakerTripped = false;
  await pipeline.release();

  assert.deepEqual(seen, [3, 2, 1, 0], 'the world can tell how much of the flood is still behind each one');
  assert.equal(engine.replay, undefined, 'the flag is cleared afterwards');

  // And the world's own conversational intent takes that hint.
  const { ctx, state: room } = harness();
  const askIntent = serverRoomIntents.find((i) => i.name === 'ask')!;
  const said: string[] = [];
  const replayCtx = { ...ctx, replay: { remaining: 2 }, say: (t: string) => said.push(t), get state() { return room; } };
  await askIntent.handle(replayCtx as WorldCtx<ServerRoomState>, message(room, 'kaz', 'admin are you there'), undefined);
  assert.deepEqual(said, [], 'a message behind the newest is seen, not answered');
});

/**
 * There is no longer any per-message hold in this world (the door queue went
 * with the AUTH job), so a released flood should reach the screen immediately —
 * the outage itself was the wait.
 */
test('a released flood is displayed at once, with nothing held back a second time', async () => {
  const state = createInitialState(now);
  state.power.breakerTripped = true;
  const { engine, pipeline } = pipelineHarness(state);

  for (let i = 0; i < 3; i++) await pipeline.handle(message(state, `new${i}`, `stranger ${i}`, true));
  assert.equal(engine.recentChat.length, 0, 'nothing reaches the screen while the room is cut off');
  state.power.breakerTripped = false;

  const startedAt = Date.now();
  await pipeline.release();
  assert.ok(Date.now() - startedAt < 1_000, 'the outage was their wait; the release must not add one');
  assert.equal(engine.recentChat.length, 3);
});

test('Admin reacts to the flood with the size of it, and admits what was lost', () => {
  const { ctx, state, said, logged } = harness();
  state.power.breakerTripped = true;
  const flood: ChatFlood = { held: 12, displayed: 12, acted: 8, overflowed: 0, people: 3, deafMs: 42_000 };

  onAudible(ctx, flood);
  assert.equal(said.length, 1);
  assert.ok(said[0].includes('12'), said[0]);

  onAudible(ctx, { ...flood, overflowed: 4 });
  assert.ok(said[1].includes('4'), said[1]);
  assert.ok(logged.some((l) => l.includes('4 waiting messages were lost')), logged.join(' | '));

  // Nothing held, nothing to say.
  onAudible(ctx, { ...flood, held: 0 });
  assert.equal(said.length, 2);
});

// ---------------------------------------------------------- what is on screen

function view(recentChat: EngineView['recentChat'] = []): EngineView {
  return { now, protagonist: { x: LAYOUT.homeX, state: 'idle' }, pendingTasks: [], logLines: [], recentChat, chatRevision: 1 };
}

test('a deaf chat monitor carries no messages and says how long it has been dark', () => {
  const state = createInitialState(now);
  server(state, 0);
  const chat = [{ username: 'kaz', text: 'admin?' }];

  const heard = buildScene(state, view(chat)).entities.find((e) => e.id === 'chat-monitor')!;
  assert.equal(heard.props?.deaf, false);
  assert.equal((heard.props?.messages as unknown[]).length, 1);

  state.power.breakerTripped = true;
  state.uptime.lastOutageAt = now - 42_000;
  const scene = buildScene(state, view(chat));
  const monitor = scene.entities.find((e) => e.id === 'chat-monitor')!;
  assert.equal(monitor.props?.deaf, true);
  assert.deepEqual(monitor.props?.messages, [], 'no stale rows behind the static');
  assert.deepEqual(monitor.props?.receipts, []);
  assert.equal(monitor.props?.deafSince, now - 42_000);

  const telemetry = scene.entities.find((e) => e.id === 'room-whiteboard')!;
  assert.ok(telemetry.screen?.alerts?.includes('NO CHAT IS REACHING THIS ROOM'));
  // The status page has to say the room is carrying nothing, without reading
  // like a broken gauge ("N of 0 a min").
  assert.match(telemetry.screen!.pages[0].lines.join(' | '), /CHAT\s+\d+ in, 0 carried/);

  JSON.stringify(scene, (_k, value) => {
    if (typeof value === 'number') assert.ok(Number.isFinite(value));
    return value;
  });
});

test('the static panel tells the audience their messages are held, with or without a clock', () => {
  assert.deepEqual(deafPanel(now - 42_000, now), {
    title: 'NO SIGNAL',
    status: 'CHAT IS DOWN · 0:42',
    lines: ['nothing is reaching admin ·', 'your messages are waiting'],
  });
  assert.equal(deafPanel(now - 67_000, now).status, 'CHAT IS DOWN · 1:07');
  assert.equal(deafPanel(undefined, now).status, 'CHAT IS DOWN', 'no start time, no invented duration');
  assert.equal(deafPanel(now + 5000, now).status, 'CHAT IS DOWN · 0:00', 'never negative');
  assert.equal(deafPanel(0, now).status, 'CHAT IS DOWN · 99:59', 'clamped, not seven-digit');
});

// ------------------------------------------------------------- what Ray knows

test('the state summary refuses to pretend he can read chat while the room is deaf', () => {
  const state = createInitialState(now);
  server(state, 0);
  assert.ok(!persona.summarizeState(state, now).includes('YOU CANNOT SEE CHAT'));

  state.power.breakerTripped = true;
  state.uptime.lastOutageAt = now - 42_000;
  const summary = persona.summarizeState(state, now);
  assert.ok(summary.includes('YOU CANNOT SEE CHAT'), summary);
  assert.ok(summary.includes('42s'), summary);
  assert.ok(summary.includes('do not invent messages'), summary);
});

test('deafness gets its own idle focus: a dead screen, not a plea for boxes', () => {
  const state = createInitialState(now);
  server(state, 0);
  state.power.breakerTripped = true;
  const deaf = persona.idleFocus!(state)!;
  assert.ok(deaf.includes('dead screen'), deaf);
  assert.ok(!deaf.includes('more servers'), deaf);

  // Dropping is a different beat, and still asks for hardware.
  state.power.breakerTripped = false;
  state.traffic.capacityPerMin = 300;
  state.traffic.demandPerMin = 900;
  state.traffic.backlog = tuning.backlogDropAt;
  const dropping = persona.idleFocus!(state)!;
  assert.ok(dropping.includes('more servers'), dropping);
  assert.ok(!dropping.includes('dead screen'), dropping);
});
