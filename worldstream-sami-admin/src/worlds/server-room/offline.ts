// Between-streams simulation (brief §5.7, §5.9): gentle wear while nobody is
// watching, dead servers marching toward being taken out of the rack, the
// memorial history, and the quarterly review with its rewards. Called once at
// boot; returns facts the engine hands to Admin for the stream-start recap.

import type { WorldCtx } from '../../engine/world';
import { serverStatus, type ServerRoomState } from './state';
import { tuning } from './tuning';
import { ensureEmergencyTask } from './emergency';
import { retireMaintenanceTickets } from './tickets';

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

export function applyOfflineTime(ctx: WorldCtx<ServerRoomState>): string[] {
  const state = ctx.state;
  retireMaintenanceTickets(ctx);
  const gapMs = ctx.now - state.lastLiveAt;
  // Hardware replacement cannot happen off camera or be erased as an incident.
  if (state.emergency) {
    state.lastLiveAt = ctx.now;
    ensureEmergencyTask(ctx);
    return ['the room is still on backup power; finish replacing the damaged hardware'];
  }
  state.traffic.overloadForMs = undefined;
  if (gapMs < tuning.offlineGapMinMs) return []; // a restart, not a new stream

  const days = gapMs / 86_400_000;
  const facts: string[] = [];

  // Overnight the room settles: temperature falls back and trouble wanders off.
  state.roomTempC = tuning.ambientTempC;
  state.incidents = {};
  state.legacy.uptimeDays += days;
  // Anything still queued overnight is long gone; lifetime totals stay.
  state.traffic.backlog = 0;
  state.traffic.wave = undefined;
  state.traffic.droppingSince = undefined;
  state.traffic.lastDropNoticeAt = undefined;

  let wentStruggling = 0;
  let wentTrouble = 0;
  const removed: string[] = [];

  for (const server of Object.values(state.servers)) {
    const before = serverStatus(server, state);
    server.health = clamp(server.health - tuning.offlineHealthDecayPerDay * days, 0, 100);
    const after = serverStatus(server, state);
    if (after !== before) {
      if (after === 'amber') wentStruggling++;
      if (after === 'red') wentTrouble++;
    }

    if (server.health <= 0) {
      server.darkStreams++;
      if (!server.darkSince) server.darkSince = ctx.now;
      if (server.darkStreams >= tuning.darkStreamsToDecommission) {
        state.memorial.push({
          name: server.name,
          ownerName: server.ownerName,
          at: ctx.now,
          delivered: Math.round(server.delivered),
        });
        const chatter = state.chatters[server.ownerUserId];
        if (chatter) chatter.serverId = undefined;
        delete state.servers[server.id];
        removed.push(`${server.ownerName}'s "${server.name}"`);
      }
    } else {
      server.darkStreams = 0;
    }
  }

  if (days >= 0.5) facts.push(`${days.toFixed(1)} days since the last stream`);
  if (wentStruggling) {
    facts.push(`${wentStruggling} server${wentStruggling > 1 ? 's' : ''} started struggling overnight`);
  }
  if (wentTrouble) {
    facts.push(`${wentTrouble} server${wentTrouble > 1 ? 's are' : ' is'} in trouble`);
  }
  // Whoever's server is off as the stream opens needs telling, whether it died
  // overnight or was already off when the last one ended. It is the one thing
  // in this room only they can fix, and the room carries less until they do.
  const stillOff = Object.values(state.servers).filter((s) => s.health <= 0);
  if (stillOff.length) {
    facts.push(
      `${stillOff.map((s) => s.ownerName).join(', ')} went off overnight — they can say "restart mine" to bring it back`,
    );
  }
  for (const name of removed) {
    facts.push(
      `${name} came out of the rack after ${tuning.darkStreamsToDecommission} streams switched off — the name goes on the wall`,
    );
  }
  facts.push('LEGACY-01 is still up');

  // Quarterly review (brief §5.9): every N streams there's a review.
  state.season.streams++;
  if (state.season.streams >= tuning.streamsPerQuarter) {
    facts.push(...runQuarterlyReview(ctx));
  }

  state.lastLiveAt = ctx.now;
  return facts;
}

function runQuarterlyReview(ctx: WorldCtx<ServerRoomState>): string[] {
  const state = ctx.state;
  const facts: string[] = [];
  const clean = state.season.outages === 0;

  // The room's score, and the one number that only ever goes up (brief §5.11).
  facts.push(
    `this quarter the room moved ${Math.round(state.traffic.delivered).toLocaleString('en-GB')} chat messages` +
      (state.traffic.dropped >= 1
        ? ` and lost ${Math.round(state.traffic.dropped).toLocaleString('en-GB')}`
        : ' and lost none') +
      `, busiest moment ${state.traffic.peakDemandPerMin} a minute`,
  );

  if (clean) {
    if (state.racks.length < tuning.maxRacks) {
      const id = `rack-${state.racks.length}`;
      state.racks.push({ id, slots: tuning.slots });
      state.power.budgetW += tuning.rackRewardBudgetW;
      facts.push(
        `review: not a single outage — a new rack arrived (${tuning.slots} more spaces) and we're allowed ${state.power.budgetW}W now`,
      );
    } else {
      state.power.budgetW += tuning.cleanQuarterBudgetW;
      facts.push(`review: not a single outage — we're allowed ${state.power.budgetW}W now`);
    }
  } else {
    facts.push(
      `review: ${state.season.outages} outage${state.season.outages > 1 ? 's' : ''} on the record — no reward, and head office noticed`,
    );
  }

  state.season = { quarter: state.season.quarter + 1, streams: 0, outages: 0 };
  state.traffic.peakDemandPerMin = 0; // busiest moment is per quarter
  return facts;
}
