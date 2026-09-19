// Isolated art preview: real renderer + real buildScene, no engine or model calls.
// Run: npx tsx scripts/preview-scene.ts, then http://localhost:4401/?case=full
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { WebSocketServer } from 'ws';
import { buildScene, LAYOUT, rackCenterX, powerServiceX } from '../src/worlds/server-room/scene';
import { createInitialState, roomCapacityPerMin, type Server } from '../src/worlds/server-room/state';
import { displayReceipt } from '../src/worlds/server-room/display';
import { tuning } from '../src/worlds/server-room/tuning';
import { buildScene as noodleScene, LAYOUT as NOODLE_LAYOUT } from '../src/worlds/noodle-shop/scene';
import { createInitialState as initialNoodles } from '../src/worlds/noodle-shop/state';
import type { EngineView } from '../src/engine/world';

export function fixture(name: string, now = Date.now()) {
  const view: EngineView = {
    now, protagonist: { x: LAYOUT.homeX, state: 'idle' },
    pendingTasks: [], logLines: ['Local art preview · simulation is not running.'], recentChat: [], chatRevision: 0,
  };
  if (name.startsWith('chat') || name === 'screens' || name === 'screens-long') {
    view.recentChat = [
      { username: 'preview_alex', text: 'The rain sounds so good tonight.' },
      { username: 'preview_sam', text: 'how are the servers doing?' },
      { username: 'preview_lee', text: 'Hello from the chat TV!' },
    ];
    if (name === 'chat-overflow') view.recentChat.push(
      { username: 'preview_' + 'long_name_'.repeat(8), text: 'W'.repeat(500) },
      { username: 'preview_unicode', text: 'Hello 👋 こんにちは — this is a synthetic chat preview.' },
    );
  }
  if (name === 'noodles') {
    view.protagonist.x = NOODLE_LAYOUT.kenjiHomeX;
    return noodleScene(initialNoodles(now), view);
  }
  const state = createInitialState(now);
  const count = name === 'full' ? 24 : name === 'empty' ? 0 : 4;
  if (name === 'full') state.racks = [0, 1, 2].map(i => ({ id: `rack-${i}`, slots: 8 }));
  for (let i = 0; i < count; i++) {
    const server: Server = {
      id: `preview-${i}`, slot: i, ownerUserId: `preview:${i}`, ownerName: `guest${i + 1}`,
      name: `server-${i + 1}`, health: i === 2 ? 50 : 94, level: 0,
      temperature: 24, powerDrawW: 150,
      uptimeDays: 12, delivered: 412_000 + i * 9_000, createdAt: now, darkStreams: 0,
    };
    state.servers[server.id] = server;
  }
  // Two fixtures for the two things a viewer can actually ask for.
  if (name === 'upgraded') {
    state.servers['preview-0'].level = 3;
    state.servers['preview-1'].level = 1;
  }
  if (name === 'dead-server') {
    state.servers['preview-1'].health = 0;
    state.servers['preview-1'].darkSince = now - 120_000;
  }
  state.traffic.capacityPerMin = roomCapacityPerMin(state);
  state.traffic.demandPerMin = 28;
  state.traffic.delivered = 254_213;
  state.traffic.dropped = 2250;
  if (name.startsWith('load-') || name === 'board' || name.startsWith('receipts')) {
    state.traffic.capacityPerMin = roomCapacityPerMin(state);
    state.traffic.demandPerMin = state.traffic.capacityPerMin * (name === 'load-busy' ? 0.85 : name === 'load-drops' ? 1.4 : 0.5);
    state.traffic.backlog = name === 'load-drops' ? tuning.backlogDropAt : name === 'load-backlog' ? 20 : 0;
    if (name === 'board') {
      state.incidents.junkTraffic = { startedAt: now, endsAt: now + 300_000 };
      state.tickets = [{ id: 'job-13', kind: 'junk-traffic', title: 'junk traffic is hammering the room', severity: 2,
        source: 'sensor', raisedBy: 'SENSOR', claimedBy: ['guest1'], openedAt: now - 240_000, state: 'active' }];
      view.currentTask = { kind: 'block-traffic', label: 'shut out the junk traffic', progress: 0.68 };
    }
    view.recentChat = [
      { username: 'guest1', text: 'my server carries this chat?' },
      { username: 'guest2', text: 'we need more servers surely' },
      { username: 'guest3', text: 'upgrade mine please' },
    ].map((m, i) => ({ ...m, receipt: displayReceipt(state, i + 1, now - (3 - i) * 2000) }));
    view.chatRevision = 3;
  }
  // Same healthy room throughout; upgrading changes only the capacity denominator.
  if (name.startsWith('chaos-')) {
    for (const server of Object.values(state.servers)) server.health = 100;
    const baseCapacity = roomCapacityPerMin(state);
    const load = name === 'chaos-quiet' ? 0.15 : name === 'chaos-busy' ? 0.7 : name === 'chaos-strained' ? 0.92 : 1.05;
    state.traffic.demandPerMin = baseCapacity * load;
    if (name === 'chaos-upgraded') for (const server of Object.values(state.servers)) server.level = 3;
    state.traffic.capacityPerMin = roomCapacityPerMin(state);
    view.recentChat = [{ username: 'preview_chat', text: 'More chat, more coffee. Can the room keep up?' }];
    if (name === 'chaos-walking') view.protagonist = {
      x: LAYOUT.homeX, state: 'walking',
      walk: { fromX: LAYOUT.homeX, toX: rackCenterX(0), startedAt: now, durationMs: 10_000 },
    };
  }
  if (name === 'screens-long') {
    state.servers['preview-0'].name = 'long-server-name-'.repeat(6);
    state.servers['preview-0'].ownerName = 'long-viewer-name-'.repeat(6);
    view.currentTask = { kind: 'unknown-kind', label: 'A long synthetic job that must not overflow the status page', progress: 0.6 };
    view.pendingTasks = [{ label: 'A long synthetic queued job for the monitor preview', requestedBy: 'preview_guest' }];
    view.logLines = ['Long synthetic event: '.repeat(12)];
  }
  // Deaf room: static chat screen, and displayed rows must not survive it.
  if (name === 'outage') {
    state.power.breakerTripped = true;
    state.uptime.lastOutageAt = now - 42_000;
    state.traffic.backlog = tuning.backlogDropAt;
    view.recentChat = [
      { username: 'guest1', text: 'are you seeing this?' },
      { username: 'guest2', text: 'my screen went blank' },
    ];
    view.chatRevision = 2;
  }
  if (name === 'failure') {
    state.power.breakerTripped = true; state.roomTempC = 42;
    state.incidents.rat = { serverId: 'preview-0', startedAt: now };
    state.incidents.delivery = { arrivedAt: now };
    state.memorial = [{ name: 'old friend', ownerName: 'guest', at: now, delivered: 1_204_882 }];
  }
  if (name.startsWith('overload-')) {
    const phase = name.slice('overload-'.length);
    const stage = phase === 'carry' || phase === 'exchange' ? 'exchange'
      : phase === 'install' ? 'install' : phase === 'reset' ? 'reset' : phase === 'boot' ? 'boot' : 'pull';
    state.emergency = { startedAt: now - 54_000, serverIds: ['preview-0', 'preview-2'], index: stage === 'reset' || stage === 'boot' ? 2 : 0, stage };
    state.uptime.lastOutageAt = state.emergency.startedAt;
    state.traffic.capacityPerMin = 0;
    state.traffic.demandPerMin = 280;
    state.traffic.backlog = tuning.backlogDropAt;
    for (const id of state.emergency.serverIds) state.servers[id].health = stage === 'reset' || stage === 'boot' ? 100 : 0;
    view.currentTask = { kind: `emergency-${stage}`, label: 'replace damaged hardware', progress: 0.5 };
    view.protagonist = {
      x: stage === 'exchange' ? 430 : stage === 'reset' ? powerServiceX() : stage === 'boot' ? LAYOUT.homeX : rackCenterX(0),
      state: 'working',
    };
    if (phase === 'carry') view.protagonist = {
      x: rackCenterX(0), state: 'walking',
      walk: { fromX: rackCenterX(0), toX: 510, startedAt: now, durationMs: 6000 },
    };
    view.recentChat = [{ username: 'must_not_show', text: 'This real chat must never leak through the broken monitor.' }];
    view.chatRevision = 4;
  }
  if (name === 'working') {
    view.protagonist.state = 'working';
    view.currentTask = { kind: 'investigate', label: 'checking something', progress: 0.4 };
  }
  if (name === 'speech') view.speech = { text: 'Rain on the window. Tea on the desk. Everything is where it should be.', until: now + 60_000 };
  if (name === 'walk') {
    view.protagonist = { x: LAYOUT.homeX, state: 'walking', walk: { fromX: LAYOUT.homeX, toX: 200, startedAt: now, durationMs: 10_000 } };
  }
  if (name.startsWith('target-')) view.protagonist = { x: Number(name.slice(7)), state: 'working' };
  return buildScene(state, view);
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (url.pathname === '/fonts/JetBrainsMono-Regular.woff2' || url.pathname === '/fonts/JetBrainsMono-Bold.woff2') {
    res.setHeader('content-type', 'font/woff2'); res.end(readFileSync(`public${url.pathname}`)); return;
  }
  if (url.pathname === '/renderer.js') {
    res.setHeader('content-type', 'text/javascript'); res.end(readFileSync('public/renderer.js')); return;
  }
  if (url.pathname === '/scene') {
    res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(fixture(url.searchParams.get('case') ?? 'normal'))); return;
  }
  if (url.pathname !== '/') { res.writeHead(404); res.end(); return; }
  // Keep fixture selection out of production renderer code.
  const html = readFileSync('public/index.html', 'utf8').replace('<script src=', `<script>
    const Socket = window.WebSocket;
    window.WebSocket = class extends Socket { constructor(url) { super(url + location.search); } };
  </script><script src=`);
  res.setHeader('content-type', 'text/html'); res.end(html);
});
const wss = new WebSocketServer({ server, path: '/ws' });
wss.on('connection', (ws, req) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const name = url.searchParams.get('case') ?? 'normal';
  const now = Date.now();
  ws.send(JSON.stringify({ t: 'state', rev: 1, serverTime: now, scene: fixture(name, now) }));
  if (name === 'receipts-live' || name === 'receipts-burst') {
    let sequence = 3;
    const scene = fixture('receipts', now);
    const monitor = scene.entities.find(e => e.id === 'chat-monitor')!;
    const messages = monitor.props!.messages as import('../src/shared/sceneTypes').SceneChatMessage[];
    const timer = setInterval(() => {
      const at = Date.now();
      sequence++;
      const label = sequence % 2 ? 's1' : 's4';
      const receipt = { sequence, at, label, targetId: sequence % 2 ? 'preview-0' : 'preview-3' };
      messages.push({ username: 'preview_live', text: `Receipt ${sequence} via ${label}`, receipt });
      if (messages.length > 6) messages.shift();
      monitor.props!.receipts = messages.flatMap(m => m.receipt ? [m.receipt] : []);
      scene.chatRevision = sequence;
      ws.send(JSON.stringify({ t: 'state', rev: sequence, serverTime: at, scene }));
    }, name === 'receipts-burst' ? 100 : 2200);
    ws.on('close', () => clearInterval(timer));
  }
  if (name === 'chat-live' || name === 'chat-burst') {
    let rev = 1;
    const timer = setInterval(() => {
      const at = Date.now();
      const scene = fixture('chat', at);
      const monitor = scene.entities.find(e => e.id === 'chat-monitor')!;
      (monitor.props!.messages as { username: string; text: string }[]).push({
        username: 'preview_live', text: `Synthetic incoming message ${++rev}`,
      });
      scene.chatRevision = rev;
      ws.send(JSON.stringify({ t: 'state', rev, serverTime: at, scene }));
    }, name === 'chat-burst' ? 250 : 2000);
    ws.on('close', () => clearInterval(timer));
  }
  if (name === 'disconnect') setTimeout(() => ws.close(), 1800);
});
server.listen(4401, '127.0.0.1', () => console.log('Art preview: http://localhost:4401 (no live simulation)'));
