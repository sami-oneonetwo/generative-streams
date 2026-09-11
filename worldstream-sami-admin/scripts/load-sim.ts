// Headless tuning harness for the load model (brief §5.7). No renderer, no
// model calls — just the traffic curve, so the numbers in tuning.ts can be
// argued with before anything visual depends on them.
//
// There is no task queue here: tasks Admin enqueues are collected and never
// run, so damaged servers stay damaged for the whole run. That's deliberate —
// it's how you watch a spiral play out — but it means this harness always shows
// the no-intervention case, never the recovery.
//
//   npm run sim:load -- --servers 3 --chat 200 --hours 2
//   npm run sim:load -- --servers 6 --chat 300 --wave peak --at 20
//
//   --servers N  viewer servers in the rack (default 3)
//   --health N   starting health for every server (default 100)
//   --level N    upgrade level for every server (default 0)
//   --chat N     local chat, messages per minute (default 150)
//   --hours N    how long to simulate (default 2)
//   --wave K     ripple | peak — another room's chat pushed through (default none)
//   --at N       minute the wave lands (default 30)
//   --for N      wave duration in minutes (default from tuning)

import type { QueueEntryView, TaskSpec, WorldCtx } from '../src/engine/world';
import {
  chatLagSeconds,
  createInitialState,
  roomCapacityPerMin,
  trafficStatus,
  utilisation,
  type Server,
  type ServerRoomState,
} from '../src/worlds/server-room/state';
import { startWave } from '../src/worlds/server-room/traffic';
import { tick } from '../src/worlds/server-room/tick';
import { tuning } from '../src/worlds/server-room/tuning';

function arg(name: string, fallback: number): number {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return fallback;
  const v = Number(process.argv[i + 1]);
  return Number.isFinite(v) ? v : fallback;
}
function str(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i < 0 ? undefined : process.argv[i + 1];
}

const servers = arg('servers', arg('boxes', 3)); // --boxes still accepted
const health = arg('health', 100);
const level = Math.max(0, Math.min(tuning.upgradeMaxLevel, arg('level', 0)));
const chatPerMin = arg('chat', 150);
const hours = arg('hours', 2);
const waveKind = str('wave');
const waveAtMin = arg('at', 30);
const waveForMin = arg('for', tuning.waveDurationMs / 60_000);

const STEP_MS = 30_000;
const start = Date.now();
const state = createInitialState(start);
for (let slot = 0; slot < servers; slot++) {
  const server: Server = {
    id: `sim-${slot}`, slot, ownerUserId: `sim:${slot}`, ownerName: `guest${slot + 1}`, name: `server-${slot + 1}`,
    health, level, temperature: 22, powerDrawW: tuning.baseDrawW,
    uptimeDays: 0, delivered: 0, createdAt: start, darkStreams: 0,
  };
  state.servers[server.id] = server;
}

let clock = start;
const spoken: { atMin: number; line: string }[] = [];
const tasks: TaskSpec<ServerRoomState>[] = [];
const ctx: WorldCtx<ServerRoomState> = {
  get state() { return state; },
  get now() { return clock; },
  log: () => {},
  say: (line) => { spoken.push({ atMin: Math.round((clock - start) / 60_000), line }); },
  enqueueTask: (spec) => { tasks.push(spec); return { id: `task-${tasks.length}` }; },
  get queue(): ReadonlyArray<QueueEntryView> {
    return tasks.map((t, i) => ({ id: `task-${i}`, kind: t.kind, label: t.label, requestedBy: t.requestedBy }));
  },
  llm: { dialogue: async () => null, moderate: async (text: string) => ({ ok: true, cleaned: text }) },
  tuning,
  get chatRatePerMin() { return chatPerMin; },
  rng: Math.random,
};

const pad = (v: string | number, w: number) => String(v).padStart(w);
const rows: string[] = [];
const header = ['min', 'demand', 'cap', 'util', 'queue', 'lag', 'dropped', 'temp', 'minHP', 'status'];
rows.push(header.map((h, i) => pad(h, [5, 7, 6, 6, 7, 7, 9, 6, 6, 0][i])).join(' '));

const steps = Math.round((hours * 3_600_000) / STEP_MS);
const sampleEvery = Math.max(1, Math.round(steps / 40)); // ~40 rows whatever the span

for (let i = 0; i <= steps; i++) {
  const minute = (i * STEP_MS) / 60_000;
  clock = start + i * STEP_MS;
  if (waveKind && Math.abs(minute - waveAtMin) < 0.001) {
    const extra = waveKind === 'peak' ? tuning.wavePeakExtraPerMin : tuning.waveRippleExtraPerMin;
    startWave(ctx, 'NODE-3', extra, waveForMin * 60_000);
  }
  tick(ctx, STEP_MS);

  if (i % sampleEvery !== 0) continue;
  const t = state.traffic;
  const lag = chatLagSeconds(state);
  const live = Object.values(state.servers).filter((s) => s.health > 0);
  const minHp = live.length ? String(Math.round(Math.min(...live.map((s) => s.health)))) : '-';
  rows.push(
    [
      pad(Math.round(minute), 5),
      pad(t.demandPerMin, 7),
      pad(t.capacityPerMin, 6),
      pad(Number.isFinite(utilisation(state)) ? `${Math.round(utilisation(state) * 100)}%` : '--', 6),
      pad(Math.round(t.backlog), 7),
      pad(Number.isFinite(lag) ? `${Math.round(lag)}s` : 'deaf', 7),
      pad(Math.round(t.dropped), 9),
      pad(state.roomTempC.toFixed(1), 6),
      pad(minHp, 6),
      trafficStatus(state),
    ].join(' '),
  );
}

const t = state.traffic;
console.log(
  `\n${servers} server${servers === 1 ? '' : 's'} at ${health} health, upgrade level ${level} · local chat ${chatPerMin}/min · ` +
    `${hours}h${waveKind ? ` · ${waveKind} wave at +${waveAtMin}m for ${waveForMin}m` : ''}`,
);
console.log(`carried at full health: ${Math.round(roomCapacityPerMin(state))}/min ` +
  `(Admin ${tuning.adminFallbackPerMin} + ${servers}×${tuning.serverBasePerMin + level * tuning.upgradeCapacityPerMin})\n`);
console.log(rows.join('\n'));
console.log(
  `\ndelivered ${Math.round(t.delivered).toLocaleString('en-GB')} · ` +
    `dropped ${Math.round(t.dropped).toLocaleString('en-GB')} ` +
    `(${((t.dropped / Math.max(1, t.delivered + t.dropped)) * 100).toFixed(1)}% of arrivals) · ` +
    `peak demand ${t.peakDemandPerMin}/min`,
);
const byServer = Object.values(state.servers)
  .sort((a, b) => b.delivered - a.delivered)
  .map((s) => `${s.ownerName} ${Math.round(s.delivered).toLocaleString('en-GB')} (hp ${Math.round(s.health)})`);
if (byServer.length) console.log(`per server: ${byServer.join(' · ')}`);
if (spoken.length) {
  console.log('\nAdmin:');
  for (const { atMin, line } of spoken) console.log(`  ${pad(atMin, 4)}m  ${line}`);
}
