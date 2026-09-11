// A burned-out room is a physical job, not a restart request. The small saved
// cursor is authoritative; transient walk/work callbacks can always be rebuilt.
import type { WorldCtx } from '../../engine/world';
import { computeDrawW, roomCapacityPerMin, totalDrawW, type ServerRoomState } from './state';
import { tuning } from './tuning';
import { LAYOUT, deskX, powerServiceX, rackCenterX } from './scene';

type Ctx = WorldCtx<ServerRoomState>;
type Stage = NonNullable<ServerRoomState['emergency']>['stage'];
const jobs: Record<Stage, { label: string; workMs: number }> = {
  pull: { label: 'pull the smoking server out', workMs: tuning.emergencyPullMs },
  exchange: { label: 'collect a replacement server', workMs: tuning.emergencyExchangeMs },
  install: { label: 'fit the replacement server', workMs: tuning.emergencyInstallMs },
  reset: { label: 'restore the power', workMs: tuning.emergencyResetMs },
  boot: { label: 'start everything back up', workMs: tuning.emergencyBootMs },
};

export function updateEmergency(ctx: Ctx, dtMs: number): void {
  const s = ctx.state;
  if (s.emergency) { ensureEmergencyTask(ctx); return; }
  const traffic = s.traffic;
  if (traffic.recoveryForMs !== undefined) {
    traffic.recoveryForMs += dtMs;
    if (traffic.recoveryForMs < tuning.emergencyGraceMs) return;
    traffic.recoveryForMs = undefined;
    return;
  }
  const capacity = roomCapacityPerMin(s);
  const overCapacity = capacity > 0 && traffic.demandPerMin > capacity;
  if (!overCapacity) { traffic.overloadForMs = undefined; return; }
  if (!traffic.overloadForMs) {
    ctx.log('sustained chat overload: the room is about to shut down', 'alert');
    ctx.say("that's too much chat. i need more servers now, before this whole room goes dark.");
  }
  traffic.overloadForMs = (traffic.overloadForMs ?? 0) + dtMs;
  if (traffic.overloadForMs >= tuning.emergencyAfterMs) startEmergency(ctx, traffic.demandPerMin / capacity);
}

export function startEmergency(ctx: Ctx, ratio = 2): void {
  const s = ctx.state;
  if (s.emergency || s.power.breakerTripped) return;
  const victims = Object.values(s.servers).filter(server => server.health > 0)
    .sort((a, b) => a.health - b.health || a.slot - b.slot)
    .slice(0, Math.max(1, Math.min(3, Math.floor(ratio) - 1)));
  s.emergency = { startedAt: ctx.now, serverIds: victims.map(server => server.id), index: 0, stage: 'pull' };
  for (const server of victims) { server.health = 0; server.darkSince = ctx.now; }
  s.uptime.lastOutageAt = ctx.now;
  s.season.outages++;
  s.traffic.overloadForMs = undefined;
  s.traffic.capacityPerMin = 0;
  ctx.log('CHAT OVERLOAD: emergency power; damaged hardware must be replaced', 'alert');
  ctx.say("chat's gone. smoke in the rack. dropping everything — i have to pull these out.");
  ensureEmergencyTask(ctx);
}

/** Fit the installed hardware under the budget before reconnecting mains. */
export function shedPowerLoad(state: ServerRoomState): string[] {
  const wound: string[] = [];
  for (;;) {
    for (const server of Object.values(state.servers)) server.powerDrawW = computeDrawW(server);
    if (totalDrawW(state) <= state.power.budgetW) break;
    const victim = Object.values(state.servers).filter(server => server.level > 0)
      .sort((a, b) => b.level - a.level || a.slot - b.slot)[0];
    if (!victim) break;
    victim.level--;
    wound.push(`${victim.ownerName}'s`);
  }
  return wound;
}

export function ensureEmergencyTask(ctx: Ctx): void {
  const e = ctx.state.emergency;
  if (!e) return;
  const kind = `emergency-${e.stage}`;
  if (ctx.queue.some(task => task.kind === kind)) return;
  const { startedAt, index, stage } = e;
  const target = ctx.state.servers[e.serverIds[index]];
  const targetX = stage === 'exchange' ? LAYOUT.crate.x + LAYOUT.crate.w / 2
    : stage === 'reset' ? powerServiceX() : stage === 'boot' ? deskX()
    : target ? rackCenterX(target.slot) : LAYOUT.station.x + 660;
  ctx.enqueueTask({
    kind, ...jobs[stage], targetX, emergency: true, priority: 20,
    onComplete(next) {
      const s = next.state;
      const current = s.emergency;
      if (!current || current.startedAt !== startedAt || current.index !== index || current.stage !== stage) return;
      if (stage === 'pull') {
        current.stage = 'exchange';
        next.say("that's the dead one out. getting a fresh server.");
      } else if (stage === 'exchange') {
        current.stage = 'install';
      } else if (stage === 'install') {
        const server = s.servers[current.serverIds[index]];
        if (server) { server.health = 100; server.darkSince = undefined; server.darkStreams = 0; }
        current.index++;
        current.stage = current.index < current.serverIds.length ? 'pull' : 'reset';
        next.say(current.stage === 'pull' ? 'one back in. next one.' : 'new hardware is in. bringing the power back carefully.');
      } else if (stage === 'reset') {
        const wound = shedPowerLoad(s);
        if (totalDrawW(s) > s.power.budgetW) {
          next.log('power stays off: even the smallest servers exceed the budget', 'alert');
          return; // Retry later; never claim that an unsafe room has recovered.
        }
        if (wound.length) next.log(`wound down ${wound.join(', ')} server to fit the power budget`);
        current.stage = 'boot';
      } else {
        shedPowerLoad(s);
        if (totalDrawW(s) > s.power.budgetW) { current.stage = 'reset'; return; }
        s.power.breakerTripped = false;
        s.emergency = undefined;
        s.traffic.recoveryForMs = 0;
        s.traffic.capacityPerMin = roomCapacityPerMin(s);
        next.log('replacement complete; power and chat restored');
        next.say("lights are back. fresh servers are running. now let's see what i missed.");
      }
      ensureEmergencyTask(next);
    },
  });
}
