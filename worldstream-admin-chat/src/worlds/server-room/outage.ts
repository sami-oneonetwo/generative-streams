// When nothing is getting through (brief §5.7). With no capacity at all the
// room isn't carrying anything, and that includes the chat Admin is reading:
// the monitor goes to static, he keeps talking to a dead screen, and everything
// chat types is held by the engine until the room comes back — then it all
// lands at once.
//
// Nothing here is persisted. The outage start is already on the record as
// uptime.lastOutageAt (see tripBreaker in tick.ts), and the held messages
// themselves are transient engine state, so a restart mid-outage loses them.

import type { ChatFlood, WorldCtx } from '../../engine/world';
import { roomCapacityPerMin, type ServerRoomState } from './state';

type Ctx = WorldCtx<ServerRoomState>;

/** Whether the room can take chat in at all. False means he's cut off. */
export function audible(state: ServerRoomState): boolean {
  return roomCapacityPerMin(state) > 0;
}

/**
 * When the current blackout began, or undefined if the room can hear. The
 * breaker trip that killed the last of the capacity is what stamped it, so this
 * only speaks for an outage that is still going.
 */
export function deafSince(state: ServerRoomState): number | undefined {
  if (audible(state)) return undefined;
  return state.emergency?.startedAt ?? (state.power.breakerTripped ? state.uptime.lastOutageAt : undefined);
}

/** How long the room has been cut off, in ms; 0 when it can hear or can't tell. */
export function deafForMs(state: ServerRoomState, now: number): number {
  const since = deafSince(state);
  return since === undefined ? 0 : Math.max(0, now - since);
}

function pick(lines: string[]): string {
  return lines[Math.floor(Math.random() * lines.length)];
}

/**
 * The flood landing. He has been talking to nobody, so the first thing he knows
 * is how much of it piled up while he couldn't see — and it arrives at once.
 */
export function onAudible(ctx: Ctx, flood: ChatFlood): void {
  const seconds = Math.round(flood.deafMs / 1000);
  const forText = seconds >= 90 ? `${Math.round(seconds / 60)} minutes` : `${seconds} seconds`;
  const people = `${flood.people} of you`;

  if (flood.held === 0) return;
  if (flood.overflowed > 0) {
    ctx.log(`${flood.overflowed} waiting messages were lost before the room came back`, 'alert');
  }
  ctx.say(
    pick([
      `…there you are. ${flood.held} messages from ${people}, all at once. ${forText} of nothing.`,
      `we're back. ${flood.held} of them waiting, ${people}. i was talking to a dead screen for ${forText}.`,
      `oh, now you all show up. ${flood.held} messages in one go. give me a second.`,
    ]) + (flood.overflowed > 0 ? ` and ${flood.overflowed} never made it. sorry.` : ''),
  );
}
