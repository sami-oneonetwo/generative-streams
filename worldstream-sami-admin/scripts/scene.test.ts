import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildScene, LAYOUT, slotPos, rackCenterX, powerServiceX, crateX, deskX } from '../src/worlds/server-room/scene';
import { createInitialState, type Server } from '../src/worlds/server-room/state';
import { tuning } from '../src/worlds/server-room/tuning';
import type { EngineView } from '../src/engine/world';
import { drawWhiteboardText, whiteboardArea, whiteboardPage } from '../client/renderer/whiteboard';
import { chatScreen, layoutChat } from '../client/renderer/chatMonitor';
import { Engine } from '../src/engine/engine';
import { ChatGlance } from '../client/renderer/chatGlance';
import { statusScreen } from '../src/worlds/server-room/screens';
import { openTickets, sweepTickets } from '../src/worlds/server-room/tickets';
import { fitScreenText, wrapScreenText, screenPageIndex, screenPhase } from '../client/renderer/infoMonitor';
import { buildScene as noodleScene, LAYOUT as NOODLE_LAYOUT } from '../src/worlds/noodle-shop/scene';
import { createInitialState as initialNoodles } from '../src/worlds/noodle-shop/state';

const now = 1_800_000_000_000;
const view: EngineView = { now, protagonist: { x: LAYOUT.homeX, state: 'idle' }, pendingTasks: [], logLines: [], recentChat: [], chatRevision: 0 };

function fullRoom() {
  const state = createInitialState(now);
  state.racks = Array.from({ length: tuning.maxRacks }, (_, i) => ({ id: `rack-${i}`, slots: tuning.slots }));
  for (let slot = 0; slot < tuning.maxRacks * tuning.slots; slot++) {
    const server: Server = {
      id: `server-${slot}`, slot, ownerUserId: `user-${slot}`, ownerName: `guest-${slot}`, name: `server-${slot}`,
      health: 95, level: 0, temperature: 22, powerDrawW: 150,
      uptimeDays: 1, delivered: 0, createdAt: now, darkStreams: 0,
    };
    state.servers[server.id] = server;
  }
  return state;
}

/** A room with enough wrong with it to fill the board. */
function boardRoom() {
  const state = fullRoom();
  state.cooling.working = false;
  state.door.open = true;
  state.incidents.rat = { serverId: 'server-0', startedAt: now };
  state.incidents.delivery = { arrivedAt: now };
  state.servers['server-2'].health = 10;
  state.servers['server-3'].health = 0;
  // The sweep is what puts things on the board, so run a tick's worth of it.
  sweepTickets(ticketCtx(state));
  return state;
}

/** Minimal ctx for driving the ticket sweep in scene fixtures. */
function ticketCtx(state: ReturnType<typeof createInitialState>) {
  const tasks: { kind: string; label: string; requestedBy?: string }[] = [];
  return {
    get state() { return state; },
    get now() { return now; },
    log: () => {}, say: () => {},
    enqueueTask: (spec: { kind: string; label: string; requestedBy?: string }) => {
      tasks.push(spec); return { id: `t${tasks.length}` };
    },
    get queue() { return tasks.map((t, i) => ({ id: `t${i}`, ...t })); },
    llm: { dialogue: async () => null, moderate: async (text: string) => ({ ok: true, cleaned: text }) },
    tuning, chatRatePerMin: 0, rng: () => 0.5,
  } as never;
}

test('chat TV sits on the back wall of a full-width room', () => {
  const scene = buildScene(fullRoom(), view);
  const monitor = scene.entities.find(e => e.id === 'chat-monitor')!;
  assert.equal(monitor.kind, 'chatMonitor');
  assert.equal(scene.worldWidth, scene.width);
  assert.notEqual(monitor.props?.layer, 'fore');
  assert.equal(monitor.props?.mount, 'wall');
  assert.ok(monitor.y + monitor.h < LAYOUT.rack.topY);
  assert.ok(monitor.x > LAYOUT.window.x + LAYOUT.window.w);
  assert.ok(monitor.x + monitor.w < scene.width);
  for (const n of [monitor.x, monitor.y, monitor.w, monitor.h]) assert.equal(n % 4, 0);
  const screen = chatScreen(monitor);
  assert.ok(screen.x > monitor.x && screen.y > monitor.y);
  assert.ok(screen.x + screen.w < monitor.x + monitor.w);
  assert.ok(screen.y + screen.h < monitor.y + monitor.h);
  assert.deepEqual(monitor.props?.messages, []);
});

test('chat snapshots contain only bounded recent display fields and do not mutate history', () => {
  const recentChat = Array.from({ length: 30 }, (_, i) => ({
    username: `user${i}`, text: 'x'.repeat(1000), userId: `private${i}`, source: 'kick',
  }));
  const state = fullRoom();
  const monitor = buildScene(state, { ...view, recentChat }).entities.find(e => e.id === 'chat-monitor')!;
  assert.deepEqual(monitor.props?.messages, recentChat.slice(-6).map(m => ({ username: m.username, text: m.text.slice(0, 500) })));
  assert.equal(recentChat[29].text.length, 1000);
  // A room with no capacity puts nothing on that screen at all (brief §5.7).
  state.power.breakerTripped = true;
  const deaf = buildScene(state, { ...view, recentChat }).entities.find(e => e.id === 'chat-monitor')!;
  assert.deepEqual(deaf.props?.messages, []);
  assert.equal(deaf.props?.deaf, true);
});

test('recording chat marks the scene dirty and bounds history without classification', () => {
  // No constructor: this exercises the in-memory chat path without disk or model calls.
  const engine = Object.create(Engine.prototype) as Engine<unknown>;
  engine.recentChat = [];
  engine.chatRevision = 0;
  engine.renderDirty = false;
  for (let i = 0; i < 40; i++) engine.recordChat({
    id: `${i}`, userId: 'kick:1', username: 'viewer', text: `${i}`, ts: now, source: 'kick',
  });
  assert.equal(engine.renderDirty, true);
  assert.equal(engine.recentChat.length, 30);
  assert.equal(engine.chatRevision, 40);
  assert.equal(engine.recentChat[0].text, '10');
  Object.assign(engine, {
    protagonist: { currentX: () => 0, state: 'idle' },
    tasks: { current: null, pendingView: () => [] },
    log: { tail: () => [] },
  });
  assert.deepEqual(engine.buildView(now).recentChat, engine.recentChat.map(({ username, text }) => ({ username, text })));
});

test('chat revision reaches the scene independently of text and history size', () => {
  const scene = buildScene(fullRoom(), { ...view, chatRevision: 42 });
  assert.equal(scene.chatRevision, 42);
});

test('chat glance ignores initial history, eases up and always returns to work', () => {
  const glance = new ChatGlance();
  glance.observe(30, true, 0);
  assert.equal(glance.amount(500), 0);
  glance.observe(31, true, 1000);
  assert.equal(glance.amount(1000), 0);
  assert.ok(glance.amount(1150) > 0 && glance.amount(1150) < 1);
  assert.equal(glance.amount(1400), 1);
  assert.ok(glance.amount(3000) > 0 && glance.amount(3000) < 1);
  assert.equal(glance.amount(3200), 0);
  glance.observe(31, true, 10_000);
  assert.equal(glance.amount(10_500), 0);
});

test('a chat burst cannot extend a glance and only retriggers after the cooldown', () => {
  const glance = new ChatGlance();
  glance.observe(0, true, 0);
  glance.observe(1, true, 1000);
  for (let i = 2; i <= 30; i++) glance.observe(i, true, 1000 + i * 200);
  assert.equal(glance.amount(7500), 0);
  glance.observe(31, true, 8999);
  assert.equal(glance.amount(8999), 0);
  glance.observe(32, true, 9000);
  assert.equal(glance.amount(9500), 1);
  assert.equal(glance.amount(11_200), 0);
});

test('walking and reconnects discard pending chat attention', () => {
  const glance = new ChatGlance();
  glance.observe(0, true, 0);
  glance.observe(1, true, 1000);
  glance.observe(2, false, 1500);
  assert.equal(glance.amount(1600), 0);
  glance.observe(2, true, 2000);
  assert.equal(glance.amount(2500), 0);
  glance.reset();
  glance.observe(40, true, 3000);
  assert.equal(glance.amount(3500), 0);
  glance.observe(41, true, 4000);
  assert.equal(glance.amount(4500), 1);
  glance.observe(undefined, true, 4600);
  assert.equal(glance.amount(4700), 0);
});

const measureChat = (text: string) => Array.from(text).length * 12;

test('chat layout keeps the newest messages in order and fits inside the screen', () => {
  const messages = Array.from({ length: 10 }, (_, i) => ({ username: 'guest', text: `message ${i}` }));
  const rows = layoutChat(messages, 368, 6, measureChat);
  assert.equal(rows.length, 6);
  assert.equal(rows[0].text, 'message 4');
  assert.equal(rows.at(-1)?.text, 'message 9');
  assert.deepEqual(layoutChat([], 368, 6, measureChat), []);
});

test('chat layout wraps long words, caps messages, and keeps Unicode characters intact', () => {
  const rows = layoutChat([{ username: 'longname'.repeat(8), text: '😀'.repeat(500) }], 368, 6, measureChat);
  assert.equal(rows.length, 3);
  assert.ok(rows[0].username.endsWith('…: '));
  assert.ok(rows.at(-1)?.text.endsWith('…'));
  for (const row of rows) {
    assert.ok(measureChat(row.username + row.text) <= 368);
    assert.doesNotThrow(() => encodeURIComponent(row.text));
  }
  const normalized = layoutChat([{ username: 'guest', text: 'hello\n   world' }], 368, 6, measureChat);
  assert.equal(normalized[0].text, 'hello world');
});

test('left wall whiteboard and aquarium cabinet replace the old monitors and panels', () => {
  const scene = buildScene(fullRoom(), view);
  const board = scene.entities.find(e => e.kind === 'whiteboard')!;
  const cabinet = scene.entities.find(e => e.kind === 'aquariumCabinet')!;
  const tank = scene.entities.find(e => e.kind === 'fishTank')!;
  assert.equal(scene.entities.filter(e => e.screen).length, 1);
  assert.ok(board.screen);
  assert.ok(board.y + board.h + 8 < tank.y);
  assert.equal(tank.y + tank.h, cabinet.y);
  assert.ok(tank.x > cabinet.x && tank.x + tank.w < cabinet.x + cabinet.w);
  assert.equal(cabinet.y + cabinet.h + 8, LAYOUT.floorY);
  for (const e of [board, cabinet, tank]) {
    assert.ok(e.x >= 40 && e.x + e.w + 28 < 456);
    for (const n of [e.x, e.y, e.w, e.h]) assert.equal(n % 4, 0);
    assert.notEqual(e.props?.layer, 'fore');
  }
  assert.ok(!scene.entities.some(e => ['infoMonitor', 'uplinkPanel', 'uplinkCable', 'powerPanel'].includes(e.kind)));
});

/**
 * The floor monitor used to cycle roughly twenty pages of telemetry, which is
 * unreadable in the four seconds a new viewer gives it. It is now exactly two:
 * the room's status, and what any of it is for.
 */
test('whiteboard writing fits its surface and never cycles away from status', () => {
  const state = fullRoom();
  const board = buildScene(state, view).entities.find(e => e.kind === 'whiteboard')!;
  const area = whiteboardArea(board);
  assert.equal(whiteboardPage(board)?.id, 'status');
  board.screen!.pages.reverse();
  assert.equal(whiteboardPage(board)?.id, 'status', 'page order does not turn this into a slideshow');
  board.screen!.alerts = ['very long alert '.repeat(60)];
  board.screen!.pages.find(p => p.id === 'status')!.footer = 'long footer '.repeat(60);
  const draws: { text: string; x: number; y: number }[] = [];
  const ctx = {
    save() {}, restore() {}, beginPath() {}, rect() {}, clip() {}, fillRect() {},
    measureText: (text: string) => ({ width: Array.from(text).length * 8 }),
    fillText: (text: string, x: number, y: number) => draws.push({ text, x, y }),
  } as unknown as CanvasRenderingContext2D;
  drawWhiteboardText(ctx, board);
  const writing = draws.filter(d => d.y >= board.y);
  assert.ok(writing.length > 7);
  for (const d of writing) {
    assert.ok(d.x >= area.x && d.x + Array.from(d.text).length * 8 <= area.x + area.w);
    assert.ok(d.y >= area.y && d.y + 16 <= area.y + area.h);
  }
  state.emergency = { startedAt: now, serverIds: [], index: 0, stage: 'reset' };
  const emergencyBoard = buildScene(state, view).entities.find(e => e.kind === 'whiteboard')!;
  assert.equal(whiteboardPage(emergencyBoard)?.id, 'emergency');
  assert.equal(emergencyBoard.props?.dark, true);
});

test('the shared status model preserves status and help content', () => {
  const model = statusScreen(boardRoom(), view);
  assert.deepEqual(model.pages.map((p) => p.id), ['status', 'goal']);
  assert.equal(model.interlude, undefined, 'no telemetry interlude to sit through');

  // They alternate on the dwell, and there is never a flash to sit through.
  assert.equal(screenPhase(model, 0).page.id, 'status');
  assert.equal(screenPhase(model, 8_999).page.id, 'status');
  assert.equal(screenPhase(model, 9_001).page.id, 'goal');
  assert.equal(screenPhase(model, 18_001).page.id, 'status');
  for (const t of [0, 9_001, 18_001, 999_999]) assert.equal(screenPhase(model, t).flash, 0);
  assert.equal(screenPageIndex({ ...model, pages: [] }, 99999), 0);
});

/**
 * The goal is the status page's TITLE, not a footnote: a viewer who reads one
 * line of this screen should learn what the room is for.
 */
test('the status page leads with the goal and answers the room in five rows', () => {
  const state = fullRoom();
  const before = structuredClone(state);
  const page = statusScreen(state, view).pages[0];

  assert.equal(page.title, 'GOAL: KEEP CHAT ALIVE');
  assert.equal(page.lines.length, 5, 'five rows is what the compact monitor fits');
  const labels = page.lines.map((l) => l.split(/\s{2,}/)[0]);
  assert.deepEqual(labels, ['CHAT', 'SERVERS', 'POWER', 'ROOM', 'ADMIN']);

  const text = page.lines.join(' | ');
  // The chat row is live numbers, because that is the row a viewer can move.
  assert.match(text, /CHAT\s+\d+ of \d+ a min/);
  assert.match(text, /SERVERS\s+24 running/);
  assert.match(text, /POWER\s+3800 of 2000W/);
  assert.match(text, /ROOM\s+22°C/);
  assert.match(text, /ADMIN\s+watching the room/);

  // Every row fits the monitor, and no owner id leaks onto the screen.
  for (const line of page.lines) assert.ok(Array.from(line).length <= 29, line);
  assert.ok(!JSON.stringify(page).includes('user-0'));
  assert.deepEqual(state, before, 'building a screen must not touch world state');
});

/**
 * The one thing on this screen aimed squarely at somebody who just arrived and
 * has no idea why a man is watching servers.
 */
test('the second page says, in plain words, that chat is the load and servers are the fix', () => {
  const page = statusScreen(fullRoom(), view).pages[1];
  const text = page.lines.join(' ');
  assert.match(text, /help admin keep the chat alive/i, text);
  assert.match(text, /building servers/i, text);
  assert.match(text, /the more you type/i, text);
  assert.match(text, /more servers we need/i, text);
  assert.match(page.footer!, /give me a server/);
  // Same width ceiling as every other page, and five rows at most.
  assert.ok(page.lines.length <= 5, `${page.lines.length} rows`);
  for (const line of page.lines) assert.ok(Array.from(line).length <= 29, line);

  // An empty room asks harder, because nobody is helping yet.
  assert.match(statusScreen(createInitialState(now), view).pages[1].footer!, /be the first/);
});

test('the status page says nothing technical: no health, patch, disk or job words', () => {
  const state = boardRoom();
  state.power.breakerTripped = true;
  state.roomTempC = 42;
  const model = statusScreen(state, { ...view, currentTask: { kind: 'breaker-repair', label: 'get the power back on', progress: 0.5 } });
  const all = [model.label, model.pages[0].title, model.pages[0].footer ?? '', ...model.pages[0].lines, ...(model.alerts ?? [])].join(' | ');
  // 'DELIVERY' is excluded on purpose: a crate beside the desk is a delivery in
  // plain English. It is the job label that had to go.
  for (const jargon of ['patch', 'disk', 'AUTH', 'MOD QUEUE', 'health', 'breaker', 'SEV', 'msg/min', 'utilisation', 'capacity']) {
    assert.ok(!all.includes(jargon), `${jargon} should not appear: ${all}`);
  }
  assert.match(all, /ADMIN\s+getting power back/);
});

test('a room in trouble rotates its problems along the bottom, worst first', () => {
  const state = boardRoom();
  state.power.breakerTripped = true;
  state.roomTempC = 42;
  const alerts = statusScreen(state, view).alerts ?? [];
  assert.ok(openTickets(state).length >= 3, 'the fixture should put several things on the board');

  assert.equal(alerts[0], 'NO CHAT IS REACHING THIS ROOM', alerts.join(' | '));
  assert.equal(alerts[1], 'THE POWER IS OFF');
  assert.ok(alerts.includes('THE ROOM IS DANGEROUSLY HOT'));
  assert.ok(alerts.includes('SOMETHING HAS CHEWED A CABLE'));
  assert.ok(alerts.includes('A DELIVERY IS WAITING'));
  assert.ok(!alerts.some(line => /AIR CON|DOOR/.test(line)));
  // Every alert is a sentence, not a code.
  for (const alert of alerts) assert.doesNotMatch(alert, /^!|SEV|WO-/, alert);
});

test('an empty room still tells a new viewer how to join', () => {
  const model = statusScreen(createInitialState(now), view);
  const page = model.pages[0];
  assert.ok(page.footer?.includes('give me a server'));
  assert.match(page.lines.join(' | '), /SERVERS\s+none yet, 8 spaces/);
  // Nothing typed and nothing running: no invented load either way.
  assert.match(page.lines.join(' | '), /CHAT\s+0 of 10 a min/);
  assert.deepEqual(model.alerts, ['ALL SYSTEMS ARE GREEN']);
});

test('a dead server puts its owner on the footer, because only they can restart it', () => {
  const state = fullRoom();
  state.servers['server-0'].health = 0;
  const page = statusScreen(state, view).pages[0];
  assert.match(page.footer!, /guest-0: say "restart mine"/);
  assert.match(page.lines.join(' | '), /SERVERS\s+23 running, 1 off/);
  assert.ok((statusScreen(state, view).alerts ?? []).includes('1 SERVER IS OFF'));
});

test('status text wraps or ellipsizes without overflowing the monitor', () => {
  const long = 'A'.repeat(300);
  assert.ok(measureChat(fitScreenText(long, 360, measureChat)) <= 360);
  const wrapped = wrapScreenText('hello '.repeat(100), 360, 5, measureChat);
  assert.equal(wrapped.length, 5);
  assert.ok(wrapped.at(-1)?.endsWith('…'));
  for (const line of wrapped) assert.ok(measureChat(line) <= 360);
});

test('noodle shop retains its sidebar and receives no server-room screens', () => {
  const scene = noodleScene(initialNoodles(now), { ...view, protagonist: { x: NOODLE_LAYOUT.kenjiHomeX, state: 'idle' } });
  assert.ok(scene.worldWidth < scene.width);
  assert.ok(!scene.entities.some(e => e.screen || e.kind === 'chatMonitor'));
});

test('all 24 slots are pixel-aligned, inside separate racks, and clear of the desk', () => {
  const scene = buildScene(fullRoom(), view);
  assert.equal(scene.worldWidth % 4, 0);
  assert.equal(scene.height % 4, 0);
  assert.equal(scene.entities.filter(e => e.kind === 'server').length, 24);
  for (let slot = 0; slot < 24; slot++) {
    const pos = slotPos(slot);
    const rack = scene.entities.find(e => e.id === `rack-${Math.floor(slot / 8)}`)!;
    assert.ok(pos.x >= rack.x && pos.x + pos.w <= rack.x + rack.w);
    assert.ok(pos.y >= rack.y && pos.y + pos.h <= rack.y + rack.h - LAYOUT.rack.legacyH);
    for (const n of Object.values(pos)) assert.equal(n % 4, 0);
    assert.ok(rack.x > LAYOUT.station.x + LAYOUT.station.w);
    assert.ok(rack.x >= LAYOUT.chatMonitor.x && rack.x + rack.w <= LAYOUT.chatMonitor.x + LAYOUT.chatMonitor.w);
    assert.ok(rack.y > LAYOUT.trafficReadout.y + LAYOUT.trafficReadout.h);
  }
  for (let i = 1; i < 3; i++) {
    const a = scene.entities.find(e => e.id === `rack-${i - 1}`)!;
    const b = scene.entities.find(e => e.id === `rack-${i}`)!;
    assert.ok(a.x + a.w < b.x);
  }
});

test('three visible cabinets preserve starter progression and activate without duplicates', () => {
  const state = createInitialState(now);
  const before = structuredClone(state);
  const starter = buildScene(state, view);
  const cabinets = starter.entities.filter(e => e.kind === 'rack');
  assert.equal(cabinets.length, 3);
  assert.equal(cabinets.filter(e => e.props?.inactive).length, 2);
  assert.equal(state.racks.length, 1);
  assert.ok(!starter.entities.some(e => e.kind === 'apartmentStorage'));
  assert.deepEqual(state, before);
  state.racks.push({ id: 'new-rack', slots: tuning.slots });
  const expanded = buildScene(state, view).entities.filter(e => e.kind === 'rack');
  assert.equal(expanded.length, 3);
  assert.equal(expanded[1].id, 'new-rack');
  assert.equal(expanded[1].props?.inactive, false);
  assert.equal(expanded[1].x, cabinets[1].x);
});

test('moved fixtures and their dependent details stay in their side zones', () => {
  const state = fullRoom();
  state.power.breakerTripped = true;
  state.door.open = true;
  state.incidents.rat = { serverId: 'server-0', startedAt: now };
  const scene = buildScene(state, view);
  const byId = (id: string) => scene.entities.find(e => e.id === id)!;
  for (const kind of ['door', 'cooling', 'memorialWall', 'uptimeSign']) {
    assert.ok(!scene.entities.some(e => e.kind === kind), `${kind} is removed`);
  }
  assert.ok(crateX() > LAYOUT.crate.x + LAYOUT.crate.w);
  assert.equal(byId('legacy-01').x, LAYOUT.rack.firstX);
  assert.equal(byId('backup-rack').x, LAYOUT.rack.firstX);
  assert.ok(byId('rat').x > LAYOUT.rack.firstX);
  const service = byId('power-service');
  assert.ok(service.x > LAYOUT.rack.firstX && service.x + service.w < LAYOUT.rack.firstX + LAYOUT.rack.w);
  assert.ok(service.y + service.h <= byId('legacy-01').y);

});

test('all interaction targets remain inside the room', () => {
  const targets = [powerServiceX(), crateX(), deskX()];
  for (let slot = 0; slot < 24; slot++) targets.push(rackCenterX(slot), slotPos(slot).x + slotPos(slot).w / 2 + 70);
  for (const x of targets) assert.ok(x > 40 && x < LAYOUT.worldWidth - 40, `target outside room: ${x}`);
  assert.equal(deskX(), LAYOUT.homeX);
});

test('scene building does not mutate world state and preserves all HUD owners', () => {
  const state = fullRoom();
  const before = structuredClone(state);
  const scene = buildScene(state, view);
  assert.deepEqual(state, before);
  assert.equal(scene.hud.board.length, 25);
  assert.equal(scene.hud.counters.find(c => c.id === 'servers')?.value, '24 running, 0 off');
});

test('seated, walking and remote working poses use the new sprite without dropping motion', () => {
  const state = createInitialState(now);
  assert.equal(buildScene(state, view).protagonist.pose, 'console');
  const walk = { fromX: LAYOUT.homeX, toX: rackCenterX(), startedAt: now, durationMs: 3000 };
  const moving = buildScene(state, { ...view, protagonist: { x: LAYOUT.homeX, state: 'walking', walk } });
  assert.equal(moving.protagonist.pose, 'stand');
  assert.equal(moving.protagonist.art, 'server-room');
  assert.deepEqual(moving.protagonist.walk, walk);
  const working = buildScene(state, { ...view, protagonist: { x: rackCenterX(), state: 'working' } });
  assert.equal(working.protagonist.pose, 'stand');
});

test('failure and incident states reach their corresponding artwork layers', () => {
  const state = fullRoom();
  state.power.breakerTripped = true; state.cooling.working = false; state.roomTempC = 42; state.door.open = true;
  state.incidents.delivery = { arrivedAt: now };
  state.incidents.rat = { serverId: 'server-0', startedAt: now };
  state.servers['server-2'].level = 2;
  const scene = buildScene(state, view);
  const byId = (id: string) => scene.entities.find(e => e.id === id)!;
  assert.equal(byId('station').props?.dark, true);
  assert.equal(byId('power-service').props?.tripped, true);
  assert.equal(byId('crate').props?.layer, 'fore');
  assert.ok(byId('crate').x > LAYOUT.aquariumCabinet.x + LAYOUT.aquariumCabinet.w, 'deliveries do not cover the aquarium cabinet');
  assert.ok(byId('rat'));
  // Upgrade level reaches the artwork as the pips that replaced the job glyph.
  assert.equal(byId('server-2').props?.level, 2);
  const servers = scene.entities.filter(e => e.kind === 'server');
  assert.ok(servers.every(e => e.props?.status === 'dark'));
  // Nothing running, so no server shows a load strip.
  assert.ok(servers.every(e => e.props?.load === null));
});
