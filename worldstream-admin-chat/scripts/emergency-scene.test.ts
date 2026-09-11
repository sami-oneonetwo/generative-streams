import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildScene, LAYOUT, rackCenterX } from '../src/worlds/server-room/scene';
import { createInitialState, type Server } from '../src/worlds/server-room/state';
import type { EngineView } from '../src/engine/world';
import { scrambledFragment } from '../client/renderer/chatMonitor';
import { chatReceipts, pulseTarget } from '../client/renderer/messagePulses';

const now = 1_800_000_000_000;
const view: EngineView = {
  now, protagonist: { x: rackCenterX(0), state: 'working' },
  currentTask: { kind: 'emergency-pull', label: 'pull the dead server', progress: 0.5 },
  pendingTasks: [], logLines: [], chatRevision: 3,
  recentChat: [{ username: 'private_viewer', text: 'do not show this during the outage', receipt: { sequence: 3, at: now, label: 's1', targetId: 'server-0' } }],
};

function room() {
  const state = createInitialState(now);
  for (let i = 0; i < 3; i++) state.servers[`server-${i}`] = {
    id: `server-${i}`, slot: i, ownerUserId: `user-${i}`, ownerName: `guest${i}`,
    name: `server-${i}`, health: i < 2 ? 0 : 90, level: 1, temperature: 24,
    powerDrawW: 200, uptimeDays: 10, delivered: 9000, createdAt: now - 100_000, darkStreams: 0,
  } satisfies Server;
  state.emergency = { startedAt: now - 30_000, serverIds: ['server-0', 'server-1'], index: 0, stage: 'pull' };
  return state;
}

test('power reset targets the service switch in the rack, not a removed wall panel', () => {
  const state = room();
  state.emergency!.stage = 'reset';
  const scene = buildScene(state, view);
  const control = scene.entities.find(e => e.id === 'power-service')!;
  assert.equal(scene.protagonist.service?.targetX, control.x + control.w / 2);
  assert.equal(scene.protagonist.service?.targetY, control.y + control.h / 2);
  assert.ok(!scene.entities.some(e => e.kind === 'powerPanel'));
});

test('emergency scene blacks out the city and equipment, but keeps a readable recovery scene', () => {
  const state = room();
  const scene = buildScene(state, view);
  assert.equal(scene.power?.mode, 'backup');
  for (const id of ['city', 'room', 'furnishings', 'station', 'fish-tank']) {
    assert.equal(scene.entities.find(e => e.id === id)?.props?.dark, true, id);
  }
  assert.equal(scene.entities.find(e => e.id === 'power-service')?.props?.tripped, true);
  assert.ok(!scene.entities.some(e => e.kind === 'cooling' || e.kind === 'door'));
  assert.equal(scene.entities.filter(e => e.kind === 'emergencyLight').length, 2);
  assert.ok(scene.entities.some(e => e.kind === 'spareServers'));
  assert.equal(scene.entities.filter(e => e.kind === 'serverSmoke').length, 2);
  const monitor = scene.entities.find(e => e.id === 'chat-monitor')!;
  assert.equal(monitor.props?.deaf, true);
  assert.equal(monitor.props?.emergency, true);
  assert.deepEqual(monitor.props?.messages, []);
  assert.deepEqual(chatReceipts(scene), []);
  assert.equal(pulseTarget(scene, view.recentChat[0].receipt!), undefined);
  assert.equal(scene.protagonist.pose, 'stand');
  assert.equal(scene.protagonist.service?.action, 'pull');
  assert.equal(scene.protagonist.service?.progress, 0.5);
  assert.ok(!JSON.stringify(monitor).includes('private_viewer'));
  const screen = scene.entities.find(e => e.id === 'room-whiteboard')!.screen!;
  assert.equal(screen.pages.length, 1, 'emergency does not rotate to ordinary help');
});

test('removed hardware leaves an empty slot without deleting ownership, and smoke follows the carried unit', () => {
  const state = room();
  state.emergency!.stage = 'exchange';
  const scene = buildScene(state, view);
  assert.equal(scene.entities.find(e => e.id === 'server-0'), undefined);
  assert.equal(scene.entities.find(e => e.id === 'smoke-server-0'), undefined);
  assert.ok(scene.entities.find(e => e.id === 'smoke-server-1'));
  assert.equal(scene.protagonist.service?.carrying, 'damaged');
  assert.equal(state.servers['server-0'].ownerUserId, 'user-0');
  assert.equal(state.servers['server-0'].delivered, 9000);
  state.emergency!.stage = 'install';
  const inserting = buildScene(state, view);
  assert.equal(inserting.protagonist.service?.carrying, 'replacement');
  assert.equal(inserting.entities.find(e => e.id === 'server-0'), undefined);
});

test('boot stays deaf and dark until recovery clears, then healthy visuals return', () => {
  const state = room();
  state.emergency!.index = 2;
  state.emergency!.stage = 'boot';
  let scene = buildScene(state, view);
  assert.equal(scene.power?.mode, 'booting');
  assert.equal(scene.entities.filter(e => e.kind === 'serverSmoke').length, 0);
  assert.equal(scene.entities.find(e => e.id === 'chat-monitor')?.props?.deaf, true);
  state.emergency = undefined;
  scene = buildScene(state, { ...view, protagonist: { x: LAYOUT.homeX, state: 'idle' } });
  assert.equal(scene.power, undefined);
  assert.equal(scene.entities.find(e => e.id === 'city')?.props?.dark, false);
  assert.equal(scene.entities.find(e => e.id === 'chat-monitor')?.props?.emergency, false);
  assert.equal(scene.entities.filter(e => e.kind === 'emergencyLight').length, 0);
  assert.equal(scene.protagonist.service, undefined);
});

test('ordinary breaker outages get backup lighting without inventing damaged hardware', () => {
  const state = createInitialState(now);
  state.power.breakerTripped = true;
  const scene = buildScene(state, view);
  assert.equal(scene.power?.mode, 'backup');
  assert.equal(scene.entities.find(e => e.id === 'city')?.props?.dark, true);
  assert.equal(scene.entities.filter(e => e.kind === 'serverSmoke').length, 0);
  assert.equal(scene.protagonist.service, undefined);
});

test('scrambled fragments are rare, deterministic decoration rather than readable chat', () => {
  let visible = 0;
  for (let elapsed = 0; elapsed < 7000; elapsed += 100) {
    const text = scrambledFragment(now, now + elapsed);
    if (!text) continue;
    visible++;
    assert.match(text, /^[#/%_?+x=\- ]+$/);
    assert.equal(text.length, 23);
    assert.equal(text, scrambledFragment(now, now + elapsed));
  }
  assert.ok(visible > 0 && visible < 14, 'interference occupies under 20% of the cycle');
  assert.equal(scrambledFragment(now, now - 10), null);
  assert.notEqual(scrambledFragment(now, now + 5200), scrambledFragment(now, now + 12_200));
});
