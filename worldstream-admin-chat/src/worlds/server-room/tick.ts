import type { WorldCtx } from '../../engine/world';
import {
  computeDrawW,
  isRoomThrottling,
  serverStatus,
  totalDrawW,
  type ServerStatus,
  type ServerRoomState,
} from './state';
import { tuning } from './tuning';
import { powerServiceX } from './scene';
import { updateTraffic } from './traffic';
import { sweepTickets, retireMaintenanceTickets } from './tickets';
import { updateEmergency, shedPowerLoad } from './emergency';

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

const BAND_MULT: Record<ServerStatus, number> = { green: 1, amber: 2, red: 4, dark: 0 };

export function tick(ctx: WorldCtx<ServerRoomState>, dtMs: number): void {
  const state = ctx.state;
  const hours = dtMs / 3_600_000;
  retireMaintenanceTickets(ctx);

  // Traffic first: it decides how hard the servers are being worked this tick,
  // which the temperature and the wear below both need.
  const load = updateTraffic(ctx, dtMs);
  updateEmergency(ctx, dtMs);
  updateTemperature(state, hours, load.overloadHeatW);
  if (state.emergency) { state.lastLiveAt = ctx.now; return; }
  processIncidents(ctx);

  if (!state.power.breakerTripped) {
    const overheatMult =
      state.roomTempC >= tuning.failTempC
        ? tuning.overheatSevereMultiplier
        : isRoomThrottling(state)
          ? tuning.overheatMultiplier
          : 1;

    for (const server of Object.values(state.servers)) {
      const before = serverStatus(server, state);

      server.temperature = state.roomTempC + server.level * 2;

      let wear = tuning.healthDecayPerHourGreen * hours * BAND_MULT[before];
      wear *= overheatMult;
      // Carrying more chat than it comfortably can wears a server out. Additive
      // like the rat: it's stress on top, not a multiplier on existing wear.
      if (load.overload > 0 && server.health > 0) {
        wear += tuning.overloadHealthDecayPerHour * load.overload * hours;
      }
      if (state.incidents.rat?.serverId === server.id) wear += tuning.ratHealthDrainPerHour * hours;
      server.health = clamp(server.health - wear, 0, 100);

      if (server.health > 0) {
        server.uptimeDays += dtMs / 86_400_000;
        server.darkSince = undefined;
      } else if (!server.darkSince) {
        server.darkSince = ctx.now;
      }

      const after = serverStatus(server, state);
      if (after !== before) {
        ctx.log(
          `${server.ownerName}'s server "${server.name}" is ${after === 'dark' ? 'off' : after === 'red' ? 'in trouble' : after === 'amber' ? 'struggling' : 'fine again'}`,
          after === 'red' || after === 'dark' ? 'alert' : 'warn',
        );
      }
    }
  }

  // Power draw is derived (base + upgrades) so it can never drift from reality.
  for (const server of Object.values(state.servers)) server.powerDrawW = computeDrawW(server);
  const draw = totalDrawW(state);
  if (!state.power.breakerTripped && draw > state.power.budgetW) {
    tripBreaker(ctx, `the room was pulling ${draw}W and only ${state.power.budgetW}W is allowed`);
  }

  // Last, so the board reflects the state this tick just produced.
  sweepTickets(ctx);

  state.lastLiveAt = ctx.now;
}

function updateTemperature(state: ServerRoomState, hours: number, overloadHeatW: number): void {
  if (state.emergency || state.power.breakerTripped) {
    state.roomTempC = Math.max(tuning.ambientTempC, state.roomTempC - hours * 3);
    return; // Mains-powered equipment neither heats nor actively cools the room.
  }
  const loadW =
    totalDrawW(state) + (state.incidents.junkTraffic ? tuning.junkTrafficHeatW : 0) + overloadHeatW;
  const heating = loadW * tuning.heatPerWattHourC * hours;
  const cooling = tuning.passiveCoolingWattEquiv * tuning.heatPerWattHourC * hours;
  state.roomTempC = clamp(state.roomTempC + heating - cooling, tuning.ambientTempC, tuning.maxTempC);
}

function processIncidents(ctx: WorldCtx<ServerRoomState>): void {
  const junk = ctx.state.incidents.junkTraffic;
  if (junk && ctx.now >= junk.endsAt) {
    ctx.state.incidents.junkTraffic = undefined;
    ctx.log('the junk traffic stopped on its own');
  }
}

export function tripBreaker(ctx: WorldCtx<ServerRoomState>, reason: string): void {
  const state = ctx.state;
  if (state.power.breakerTripped || state.emergency) return;
  state.power.breakerTripped = true;
  state.uptime.lastOutageAt = ctx.now;
  state.season.outages++;
  ctx.log(`POWER CUT: ${reason}`, 'alert');
  ctx.say("power just went. everything's dark. nobody touch anything.");

  if (!ctx.queue.some((q) => q.kind === 'breaker-repair')) {
    ctx.enqueueTask({
      kind: 'breaker-repair',
      label: 'get the power back on',
      targetX: powerServiceX(),
      workMs: tuning.taskRepairMs,
      priority: 10,
      onComplete(ctx) {
        const s = ctx.state;
        // Shed load until we're back under budget: wind the hungriest servers
        // down a level at a time.
        if (s.emergency) return;
        const wound = shedPowerLoad(s);
        if (totalDrawW(s) > s.power.budgetW) {
          ctx.log('power stays off: installed servers exceed the power budget', 'alert');
          return;
        }
        s.power.breakerTripped = false;
        ctx.log(`power back on${wound.length ? `; wound down ${wound.join(', ')}` : ''}`);
        ctx.say(
          wound.length
            ? `power's back. i had to wind ${wound.join(' and ')} server down a size to fit. we don't talk about it.`
            : "power's back. don't do that again.",
        );
      },
    });
  }
}
