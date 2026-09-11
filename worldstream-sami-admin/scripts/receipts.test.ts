import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Engine } from '../src/engine/engine';
import { IntentPipeline } from '../src/engine/intents';
import { ChatRateMeter } from '../src/engine/chatRate';
import { createInitialState, type Server } from '../src/worlds/server-room/state';
import { displayReceipt, trafficReadout } from '../src/worlds/server-room/display';
import { tuning } from '../src/worlds/server-room/tuning';
import { buildScene, LAYOUT } from '../src/worlds/server-room/scene';
import { MessagePulses, pulseTarget, messageCableRoute, cablePointAt } from '../client/renderer/messagePulses';
import { layoutChat } from '../client/renderer/chatMonitor';
import type { EngineView } from '../src/engine/world';
import type { ChatReceipt } from '../src/shared/sceneTypes';

const now = 1_800_000_000_000;
const view: EngineView = { now, protagonist: { x: LAYOUT.homeX, state: 'idle' }, pendingTasks: [], logLines: [], recentChat: [], chatRevision: 0 };
/**
 * Three servers, one at half health. Every running server carries chat, so the
 * room carries 10 (Admin) + 20 + 10 + 20 = 60 a minute. Small numbers on
 * purpose: demand is real chat now, so these are the scale a live chat moves in.
 */
function room() {
  const s = createInitialState(now);
  for (let i = 0; i < 3; i++) {
    const server: Server = { id: `server-${i}`, slot: i, ownerUserId: `u${i}`, ownerName: `guest${i}`, name: `server${i}`,
      health: i === 1 ? 50 : 100, level: 0, temperature: 22, powerDrawW: 150,
      uptimeDays: 1, delivered: 10, createdAt: now, darkStreams: 0 };
    s.servers[server.id] = server;
  }
  return s;
}

test('display receipts deterministically follow capacity shares without touching the ledger', () => {
  const s = room(), before = JSON.stringify(s);
  const counts: Record<string, number> = {};
  for (let i = 1; i <= 6600; i++) {
    const r = displayReceipt(s, i, now);
    assert.deepEqual(r, displayReceipt(s, i, now));
    counts[r.label] = (counts[r.label] ?? 0) + 1;
  }
  // Shares of 60: 20 / 10 / 20 to the servers, 10 to Admin's own machine.
  assert.ok(Math.abs(counts['slot 1'] - 2200) < 10, `slot 1: ${counts['slot 1']}`);
  assert.ok(Math.abs(counts['slot 2'] - 1100) < 10, `slot 2: ${counts['slot 2']}`);
  assert.ok(Math.abs(counts['slot 3'] - 2200) < 10, `slot 3: ${counts['slot 3']}`);
  assert.ok(Math.abs(counts.admin - 1100) < 10, `admin: ${counts.admin}`);
  assert.equal(JSON.stringify(s), before);
});

test('fallback, a server that is off, a hot room and lost power are reflected immediately', () => {
  const s = createInitialState(now);
  assert.equal(displayReceipt(s, 1, now).targetId, 'station');
  s.traffic.capacityPerMin = 60;
  s.traffic.demandPerMin = 40;
  s.power.breakerTripped = true;
  assert.equal(displayReceipt(s, 2, now).targetId, undefined);
  assert.deepEqual(trafficReadout(s), { demand: 40, capacity: 0, backlog: 0, delivered: 0, dropped: 0, load: null, lagSeconds: null, status: 'NOTHING GETTING THROUGH' });
  // One server off and the room hot: everything left is carrying 30% less.
  const live = room(); live.servers['server-0'].health = 0; live.roomTempC = 32;
  assert.ok(Math.abs(trafficReadout(live).capacity - (10 + 10 + 20) * 0.7) < 1e-9);
  for (let i = 1; i < 30; i++) assert.notEqual(displayReceipt(live, i, now).targetId, 'server-0');
});

test('load status, lag and scene values are finite even with stale tick capacity', () => {
  const s = room();
  s.traffic.demandPerMin = 51; // 85% of 60
  assert.equal(trafficReadout(s).status, 'GETTING BUSY');
  s.traffic.demandPerMin = 65; s.traffic.backlog = 30;
  assert.equal(trafficReadout(s).status, 'AT THE LIMIT');
  assert.equal(trafficReadout(s).lagSeconds, 30);
  s.traffic.backlog = tuning.backlogDropAt;
  assert.equal(trafficReadout(s).status, 'LOSING MESSAGES');
  for (const tripped of [false, true]) {
    s.power.breakerTripped = tripped;
    const scene = buildScene(s, view);
    JSON.stringify(scene, (_k, value) => {
      if (typeof value === 'number') assert.ok(Number.isFinite(value)); return value;
    });
    assert.equal(scene.entities.find(e => e.kind === 'rackPowerSwitch')?.props?.tripped, tripped);
    assert.ok(scene.entities.some(e => e.kind === 'trafficReadout'));
    assert.equal(scene.worldWidth, scene.width);
    assert.ok(scene.hud.counters.some(c => c.id === 'delivered'));
  }
});

test('engine freezes receipts at display time and bounds history without exposing private ingest fields', () => {
  const engine = Object.create(Engine.prototype) as Engine<ReturnType<typeof room>>;
  Object.assign(engine, { state: room(), world: { displayReceipt }, recentChat: [], chatRevision: 0,
    protagonist: { currentX: () => 0, state: 'idle' }, tasks: { current: null, pendingView: () => [] }, log: { tail: () => [] } });
  const before = Date.now();
  for (let i = 0; i < 40; i++) engine.recordChat({ id: `${i}`, username: 'guest', text: 'hello', userId: 'secret', source: 'dev', ts: now });
  assert.equal(engine.recentChat.length, 30);
  const receipt = engine.recentChat[0].receipt!;
  assert.ok(receipt.at >= before && receipt.at <= Date.now());
  const frozen = { ...receipt };
  engine.state.power.breakerTripped = true;
  assert.deepEqual(engine.buildView(now).recentChat[0].receipt, frozen);
  assert.deepEqual(Object.keys(engine.recentChat[0]).sort(), ['receipt', 'text', 'username']);
  // While the room is deaf the screen carries nothing; the frozen history above
  // is what survives, and it reappears once there is capacity again.
  assert.deepEqual(buildScene(engine.state, engine.buildView(now)).entities.find(e => e.kind === 'chatMonitor')!.props!.receipts, []);
  engine.state.power.breakerTripped = false;
  const scene = buildScene(engine.state, engine.buildView(now));
  const receipts = scene.entities.find(e => e.kind === 'chatMonitor')!.props!.receipts as ChatReceipt[];
  assert.equal(receipts.length, 30);
  assert.deepEqual(receipts[0], frozen);
});

test('a route is captured from the hardware standing there at display time', async () => {
  const engine = Object.create(Engine.prototype) as Engine<ReturnType<typeof room>>;
  Object.assign(engine, { state: room(), world: {
    displayReceipt,
    fallbackIntent: 'noop', quickClassify: () => ({ intent: 'noop' }),
    intents: [{ name: 'noop', handle() {} }],
  }, recentChat: [], chatRevision: 0, chatRate: new ChatRateMeter(), classifications: [],
  log: { push() {} } });
  // The power goes before the message is ever recorded, so there is nothing
  // running to carry it and the receipt has no destination to name.
  engine.state.power.breakerTripped = true;
  await new IntentPipeline(engine).handle({ id: 'held', userId: 'newcomer', username: 'newcomer', text: 'hello', ts: now, source: 'dev' });
  assert.equal(engine.recentChat.length, 1);
  assert.equal(engine.recentChat[0].receipt?.label, 'held');
  assert.equal(engine.recentChat[0].receipt?.targetId, undefined);
});

test('chat wraps Unicode inside its available width, with no route tag in front of a name', () => {
  const measure = (s: string) => Array.from(s).length * 12;
  const rows = layoutChat([{ username: 'longname'.repeat(8), text: '😀'.repeat(200), receipt: { sequence: 1, at: now, label: 'slot 24' } }], 416, 7, measure);
  assert.ok(rows[0].username.startsWith('longname'), rows[0].username);
  assert.doesNotMatch(rows[0].username, /\[|slot/, 'the receipt label never reaches the screen as text');
  for (const row of rows) { assert.ok(measure(row.username + row.text) <= 416); assert.doesNotThrow(() => encodeURIComponent(row.text)); }
});

test('pulses ignore history/reconnects, dedupe snapshots, bound bursts and expire', () => {
  const p = new MessagePulses();
  const r = (sequence: number): ChatReceipt => ({ sequence, at: now, label: 'slot 1', targetId: 'server-0' });
  p.observe([r(1)], now); assert.equal(p.visible(now).length, 0);
  p.observe([r(1), r(2)], now); p.observe([r(1), r(2)], now);
  assert.equal(p.visible(now).length, 1);
  p.observe(Array.from({ length: 100 }, (_, i) => r(i + 3)), now);
  assert.equal(p.visible(now).length, 30);
  assert.equal(p.visible(now + 1500).length, 0);
  p.reset(); p.observe([r(200)], now); assert.equal(p.visible(now).length, 0);
});

test('cables run from the chat outlet around the readout to all three rack columns', () => {
  const s = room();
  s.racks = [0, 1, 2].map(i => ({ id: `rack-${i}`, slots: tuning.slots }));
  for (let i = 0; i < 3; i++) s.servers[`server-${i}`].slot = i * tuning.slots;
  const scene = buildScene(s, view);
  const monitor = scene.entities.find(e => e.kind === 'chatMonitor')!;
  const readout = scene.entities.find(e => e.kind === 'trafficReadout')!;
  const endpoints = new Set<number>();
  for (const target of scene.entities.filter(e => e.kind === 'server' || e.kind === 'rack' || e.kind === 'station')) {
    const route = messageCableRoute(scene, target);
    assert.deepEqual(route[0], [monitor.x + monitor.w - 24, monitor.y + monitor.h - 12]);
    assert.deepEqual(cablePointAt(route, 0), route[0]);
    assert.deepEqual(cablePointAt(route, 1), route.at(-1));
    assert.deepEqual(cablePointAt(route, 2), route.at(-1));
    for (let i = 0; i < route.length; i++) {
      const [x, y] = route[i];
      assert.ok(x > 0 && x < scene.width && y > 0 && y < scene.height);
      assert.equal(x % 4, 0); assert.equal(y % 4, 0);
      if (i === 0) continue;
      const [px, py] = route[i - 1];
      assert.ok(px === x || py === y, 'orthogonal pixel-art routing');
      const crossesReadout = px === x
        ? x > readout.x && x < readout.x + readout.w && Math.max(y, py) > readout.y && Math.min(y, py) < readout.y + readout.h
        : y > readout.y && y < readout.y + readout.h && Math.max(x, px) > readout.x && Math.min(x, px) < readout.x + readout.w;
      assert.equal(crossesReadout, false, 'cable never crosses readout text');
    }
    if (target.kind === 'server') {
      assert.deepEqual(route.at(-1), [target.x + target.w - 8, target.y + 8]);
      endpoints.add(route.at(-1)![0]);
    }
  }
  assert.equal(endpoints.size, 3);
  assert.equal(cablePointAt([], 0.5), undefined);
  assert.deepEqual(messageCableRoute({ ...scene, entities: [] }, scene.entities[0]), []);
});

test('old receipts never pulse to a server that is off, removed or reused', () => {
  const s = room();
  const receipt = { sequence: 1, at: now, label: 'slot 1', targetId: 'server-0' };
  assert.equal(pulseTarget(buildScene(s, view), receipt)?.id, 'server-0');

  // An upgrade changes what it carries but not that it carries: still a target.
  s.servers['server-0'].level = 2;
  assert.equal(pulseTarget(buildScene(s, view), receipt)?.id, 'server-0');

  s.servers['server-0'].health = 0;
  assert.equal(pulseTarget(buildScene(s, view), receipt), undefined);
  s.servers.replacement = { ...s.servers['server-0'], id: 'replacement', health: 100 }; delete s.servers['server-0'];
  assert.equal(pulseTarget(buildScene(s, view), receipt), undefined);
});
