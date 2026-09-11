// Fix jobs shared by chat reports and Admin's own self-preservation. Each
// checks the queue first so a report and an auto-fix never double-book him.

import type { WorldCtx } from '../../engine/world';
import type { ServerRoomState } from './state';
import { tuning } from './tuning';
import { slotPos, deskX } from './scene';

type Ctx = WorldCtx<ServerRoomState>;

function alreadyQueued(ctx: Ctx, kind: string): boolean {
  return ctx.queue.some((q) => q.kind === kind);
}

/** The junk-traffic flood: nothing to do with chat, it just hammers the room. */
export function enqueueTrafficBlock(ctx: Ctx, requestedBy?: string): boolean {
  if (alreadyQueued(ctx, 'block-traffic')) return false;
  ctx.enqueueTask({
    kind: 'block-traffic',
    label: 'shut out the junk traffic',
    requestedBy,
    targetX: deskX(),
    workMs: tuning.taskBlockMs,
    priority: 5,
    onComplete(ctx) {
      if (!ctx.state.incidents.junkTraffic) return;
      ctx.state.incidents.junkTraffic = undefined;
      ctx.log('junk traffic shut out');
      ctx.say('junk traffic is shut out. the fans can calm down now.');
    },
  });
  return true;
}

export function enqueueRecable(ctx: Ctx, requestedBy?: string): boolean {
  const rat = ctx.state.incidents.rat;
  if (!rat || alreadyQueued(ctx, 'recable')) return false;
  const server = ctx.state.servers[rat.serverId];
  const target = server ? slotPos(server.slot) : null;
  ctx.enqueueTask({
    kind: 'recable',
    label: server ? `re-run the cable at ${server.ownerName}'s server` : 're-run the cable',
    requestedBy,
    targetX: target ? target.x + target.w / 2 + 70 : deskX(),
    workMs: tuning.taskRecableMs,
    priority: 4,
    onComplete(ctx) {
      ctx.state.incidents.rat = undefined;
      ctx.log('cable re-run; the rat has relocated');
      ctx.say('new cable in. the rat and i have an understanding now. the understanding is hatred.');
    },
  });
  return true;
}
