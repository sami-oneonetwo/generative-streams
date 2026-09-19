// The load model (brief §5.7). The room carries this chat and nothing else:
// demand is what viewers actually type, so every number on screen is one they
// can move. What the room can carry comes from the servers they own. The gap
// between the two is the whole game: room to spare, then a queue, then messages
// lost for good, then a room that can't see chat at all.
//
// Pure derivations (capacity, the regional floor, lag, status) live in state.ts.
// This module owns the per-tick mutation.

import type { WorldCtx } from '../../engine/world';
import {
  adminFallbackCapacityPerMin,
  demandPerMin,
  liveServers,
  roomCapacityPerMin,
  serverCapacityPerMin,
  someoneToAsk,
  trafficStatus,
  type ServerRoomState,
} from './state';
import { tuning } from './tuning';

type Ctx = WorldCtx<ServerRoomState>;

export interface LoadTick {
  /** How far past comfortable the servers are being worked, capped. 0 when fine. */
  overload: number;
  /** Extra heat the overworked servers are putting into the room. */
  overloadHeatW: number;
}

export function updateTraffic(ctx: Ctx, dtMs: number): LoadTick {
  const state = ctx.state;
  const traffic = state.traffic;
  const minutes = dtMs / 60_000;

  expireWave(ctx);

  const capacity = roomCapacityPerMin(state);
  const demand = demandPerMin(state, ctx.now, ctx.chatRatePerMin);
  traffic.capacityPerMin = Math.round(capacity);
  traffic.demandPerMin = Math.round(demand);
  traffic.peakDemandPerMin = Math.max(traffic.peakDemandPerMin, traffic.demandPerMin);

  // A queue with a service rate: everything arrives, the servers work it off,
  // and whatever won't fit in the queue is gone. Nobody gets that message back.
  traffic.backlog += demand * minutes;
  const served = Math.min(traffic.backlog, capacity * minutes);
  traffic.backlog -= served;
  traffic.delivered += served;
  creditDelivered(state, served);

  let losing = false;
  if (traffic.backlog > tuning.backlogDropAt) {
    const lost = traffic.backlog - tuning.backlogDropAt;
    traffic.backlog = tuning.backlogDropAt;
    traffic.dropped += lost;
    losing = true;
  }
  // Pressure first: it is the window where chat can still stop this, and it
  // goes quiet once messages are actually being lost, because then the line
  // below is the one worth saying.
  if (!state.emergency) {
    narratePressure(ctx, losing);
    narrateDropSpell(ctx, losing);
  }

  // No capacity means nothing is running, so nothing to overheat — a room that
  // can't see chat is punishment enough.
  const overload =
    capacity > 0
      ? Math.min(
          tuning.overloadCap,
          Math.max(0, demand / capacity - tuning.overloadFromUtilisation),
        )
      : 0;
  return { overload, overloadHeatW: overload * tuning.overloadHeatW };
}

/**
 * Every message that lands is credited to the server that carried it, in
 * proportion to what that server contributed. Admin's own share is counted in
 * the total and credited to nobody — his machine doesn't get a plaque.
 */
function creditDelivered(state: ServerRoomState, served: number): void {
  if (served <= 0) return;
  const servers = liveServers(state);
  const shares = servers.map((server) => serverCapacityPerMin(server, state));
  const total = shares.reduce((sum, v) => sum + v, 0) + adminFallbackCapacityPerMin(state);
  if (total <= 0) return;
  servers.forEach((server, i) => {
    server.delivered += served * (shares[i] / total);
  });
}

function pick(lines: string[]): string {
  return lines[Math.floor(Math.random() * lines.length)];
}

/** "1 minute", not "1 minutes" — he says these out loud on a live stream. */
function mins(n: number): string {
  return `${n} ${n === 1 ? 'minute' : 'minutes'}`;
}

/**
 * The room is filling up but nothing is lost yet. This is the only moment where
 * chat can actually prevent the bad outcome, so he stops being calm about it
 * and asks them for help — by name where he can, because shouting at a person
 * lands and announcing at a room does not.
 *
 * Silent while messages are genuinely being lost: the drop spell below owns
 * that, and two lines about the same thing is him talking over himself.
 */
function narratePressure(ctx: Ctx, losing: boolean): void {
  const traffic = ctx.state.traffic;
  const { demandPerMin: demand, capacityPerMin: capacity } = traffic;
  const status = trafficStatus(ctx.state);
  const underPressure = status === 'busy' || status === 'saturated' || status === 'dropping';

  if (underPressure) {
    if (traffic.busySince === undefined) {
      traffic.busySince = ctx.now;
      traffic.lastBusyNoticeAt = ctx.now;
      if (losing) return; // the drop line says it louder; don't say it twice
      ctx.log(`under pressure — ${demand} a minute against ${capacity}`, 'warn');
      const target = someoneToAsk(ctx.state, ctx.now);
      ctx.say(
        target
          ? pick([
              `right — chat's coming in at ${demand} a minute and we can only carry ${capacity}. yo ${target.name}, ${target.ask} and help me hold this.`,
              `we are running out of room, ${demand} a minute against ${capacity}. ${target.name} — ${target.ask}, i need it.`,
            ])
          : pick([
              `CHAT. help me keep this chat online — ${demand} a minute coming in, ${capacity} is all we can carry. i need more servers.`,
              `oh that's not good. ${demand} a minute and we can only carry ${capacity}. somebody say "give me a server", quickly.`,
            ]),
      );
      return;
    }
    if (losing) return;
    const last = traffic.lastBusyNoticeAt ?? traffic.busySince;
    if (ctx.now - last < tuning.busyReminderMs) return;
    traffic.lastBusyNoticeAt = ctx.now;
    const target = someoneToAsk(ctx.state, ctx.now);
    ctx.log(`still under pressure — ${demand} against ${capacity}`, 'warn');
    ctx.say(
      pick([
        `still riding the limit here — ${demand} in, ${capacity} out.${target ? ` ${target.name}, ${target.ask}?` : ' one more server and i can breathe.'}`,
        `i'm holding it, barely. ${demand} a minute.${target ? ` ${target.name}, you're my best shot — ${target.ask}.` : ' somebody get me another server.'}`,
        `every message you send is going through this room and there is not much left in it. more servers, please.`,
      ]),
    );
    return;
  }

  if (traffic.busySince !== undefined) {
    const forMin = Math.max(1, Math.round((ctx.now - traffic.busySince) / 60_000));
    traffic.busySince = undefined;
    traffic.lastBusyNoticeAt = undefined;
    // If messages were being lost, the drop spell's own recovery line is about
    // to land and it says this better. Don't stack two.
    if (traffic.droppingSince !== undefined) return;
    ctx.log(`back under, after ${forMin}m of pressure`);
    ctx.say(
      pick([
        `there. we're back under, and that's because you lot turned up. ${mins(forMin)} of me sweating for nothing.`,
        `room's got headroom again. that was you — thank you, genuinely.`,
        `we held it. plenty of room again. i'm going to sit down for a second.`,
      ]),
    );
  }
}

/**
 * Losing messages gets announced as a spell with a beginning and an end, not as
 * a line every tick. Chat needs to hear it start, needs the occasional reminder
 * while it lasts, and — the part that closes the loop — needs to hear that the
 * servers they asked for fixed it.
 */
function narrateDropSpell(ctx: Ctx, losing: boolean): void {
  const traffic = ctx.state.traffic;
  const { demandPerMin: demand, capacityPerMin: capacity } = traffic;

  if (losing && traffic.droppingSince === undefined) {
    traffic.droppingSince = ctx.now;
    traffic.lastDropNoticeAt = ctx.now;
    ctx.log(`losing messages — ${demand} a minute arriving, room carries ${capacity}`, 'alert');
    const target = someoneToAsk(ctx.state, ctx.now);
    ctx.say(
      pick([
        `oh shit — we are losing messages. ${demand} a minute coming in, ${capacity} is all we can carry. CHAT, i need servers, now.`,
        `right, that's it, we're losing them. somebody's post just went nowhere.${target ? ` ${target.name} — ${target.ask}, please.` : ' i need more servers in this rack.'}`,
        `we are dropping messages on the floor. ${demand} against ${capacity}. help me keep this chat online — more servers, whoever's got one in them.`,
      ]),
    );
    return;
  }

  if (losing) {
    const last = traffic.lastDropNoticeAt ?? traffic.droppingSince ?? ctx.now;
    const forMin = Math.round((ctx.now - (traffic.droppingSince ?? ctx.now)) / 60_000);
    // Back off as the spell drags on: a room that's been over its limit for an
    // hour shouldn't turn Admin into a metronome.
    const interval = tuning.dropReminderMs * (1 + Math.floor(forMin / 10));
    if (ctx.now - last < interval) return;
    traffic.lastDropNoticeAt = ctx.now;
    ctx.log(`still losing messages after ${forMin}m — ${demand} against ${capacity}`, 'alert');
    const stillTarget = someoneToAsk(ctx.state, ctx.now);
    ctx.say(
      pick([
        `${mins(forMin)} of losing messages now. i cannot fix this on my own — i need servers.`,
        `still going. ${demand} in, ${capacity} out.${stillTarget ? ` ${stillTarget.name}, ${stillTarget.ask} and you'd genuinely be saving this.` : ' more servers. please.'}`,
        `we are still dropping them. every one of those was somebody talking. help me out here.`,
      ]),
    );
    return;
  }

  if (traffic.droppingSince !== undefined) {
    const forMin = Math.round((ctx.now - traffic.droppingSince) / 60_000);
    traffic.droppingSince = undefined;
    traffic.lastDropNoticeAt = undefined;
    ctx.log(`caught up — nothing being lost, after ${forMin}m`);
    ctx.say(
      pick([
        `we're caught up — nothing's being lost. that was you lot. ${mins(forMin)} i'd like back, mind.`,
        `queue's clear, every message is landing again. good work, all of you. genuinely.`,
        `back under. ${capacity} we can carry, ${demand} coming in. right. breathing.`,
      ]),
    );
  }
}

function expireWave(ctx: Ctx): void {
  const wave = ctx.state.traffic.wave;
  if (!wave || ctx.now < wave.endsAt) return;
  ctx.state.traffic.wave = undefined;
  ctx.log(`the ${wave.origin} crowd stopped coming through us`);
  ctx.say(`${wave.origin}'s crowd went home. it's just us in here again.`);
}

/**
 * Chat pushed through this room because another room fell over. The in-world
 * reason for a wave: that chat has to go somewhere.
 */
export function startWave(
  ctx: Ctx,
  origin: string,
  extraPerMin: number,
  durationMs = tuning.waveDurationMs,
): void {
  ctx.state.traffic.wave = {
    origin,
    extraPerMin,
    startedAt: ctx.now,
    endsAt: ctx.now + durationMs,
  };
  ctx.log(`${origin}'s chat is being pushed through us: +${extraPerMin} a minute`, 'alert');
  ctx.say(
    `${origin} has fallen over and their chat is coming through us as well — ${extraPerMin} more a minute, landing now. i am going to need help with this one.`,
  );
}
