// Fix tasks shared by chat reports, Kenji's own upkeep, and events. Each guards
// the queue so a report and an auto-fix never double-book him.

import type { WorldCtx } from '../../engine/world';
import type { NoodleShopState } from './state';
import { tuning } from './tuning';
import { plantX, potX, stoolX, vendingX } from './scene';

type Ctx = WorldCtx<NoodleShopState>;

function queued(ctx: Ctx, kind: string): boolean {
  return ctx.queue.some((q) => q.kind === kind);
}

export function enqueueTendBroth(ctx: Ctx, requestedBy?: string): boolean {
  if (queued(ctx, 'tend-broth')) return false;
  ctx.enqueueTask({
    kind: 'tend-broth',
    label: 'save the boiling pot',
    requestedBy,
    targetX: potX(),
    workMs: tuning.taskTendBrothMs,
    priority: 6,
    onComplete(ctx) {
      ctx.state.incidents.brothBoiling = undefined;
      ctx.log('caught the pot before it boiled over');
      ctx.say('caught it. a broth that boils hard goes cloudy and bitter. never let it roll like that.');
    },
  });
  return true;
}

export function enqueueCatchRat(ctx: Ctx, requestedBy?: string): boolean {
  if (!ctx.state.incidents.rat || queued(ctx, 'catch-rat')) return false;
  ctx.enqueueTask({
    kind: 'catch-rat',
    label: 'deal with the rat',
    requestedBy,
    targetX: potX() + 60,
    workMs: tuning.taskRatMs,
    priority: 7,
    onComplete(ctx) {
      ctx.state.incidents.rat = undefined;
      ctx.log('the rat has been dealt with');
      ctx.say('gone. i run a clean kitchen. one health strike and we are finished — remember that.');
    },
  });
  return true;
}

export function enqueueCleanMess(ctx: Ctx, requestedBy?: string): boolean {
  if (!ctx.state.incidents.mess || queued(ctx, 'clean')) return false;
  const stoolId = ctx.state.incidents.mess.stoolId;
  const stool = ctx.state.stools[stoolId];
  ctx.enqueueTask({
    kind: 'clean',
    label: stool ? `wipe down seat ${stool.index + 1}` : 'wipe the counter',
    requestedBy,
    targetX: stool ? stoolX(stool.index) : 700,
    workMs: tuning.taskCleanMs,
    priority: 4,
    onComplete(ctx) {
      ctx.state.incidents.mess = undefined;
      ctx.log('counter wiped down');
      ctx.say('spotless again. a counter tells a customer everything before the first bite.');
    },
  });
  return true;
}

export function enqueueFixVending(ctx: Ctx, requestedBy?: string): boolean {
  if (!ctx.state.incidents.vendingBroken || queued(ctx, 'fix-vending')) return false;
  ctx.enqueueTask({
    kind: 'fix-vending',
    label: 'fix the vending machine',
    requestedBy,
    targetX: vendingX(),
    workMs: tuning.taskVendingMs,
    priority: 2,
    onComplete(ctx) {
      ctx.state.incidents.vendingBroken = false;
      ctx.log('vending machine fixed');
      ctx.say('gave it a smack in the right spot. it dispenses cold tea again. you are welcome.');
    },
  });
  return true;
}

export function enqueueRelightBurner(ctx: Ctx, requestedBy?: string): boolean {
  if (!ctx.state.incidents.burnerOut || queued(ctx, 'relight')) return false;
  ctx.enqueueTask({
    kind: 'relight',
    label: 'relight the burner',
    requestedBy,
    targetX: potX(),
    workMs: tuning.taskBurnerMs,
    priority: 8,
    onComplete(ctx) {
      ctx.state.incidents.burnerOut = false;
      ctx.log('burner relit');
      ctx.say('lit. no flame, no ramen. we are back.');
    },
  });
  return true;
}

/** Kenji tends the plant himself. High priority — he will make chat wait. */
export function enqueueWaterPlant(ctx: Ctx): boolean {
  if (queued(ctx, 'water-plant')) return false;
  ctx.enqueueTask({
    kind: 'water-plant',
    label: 'tend the plant',
    targetX: plantX(),
    workMs: tuning.taskWaterMs,
    priority: 5,
    onComplete(ctx) {
      const s = ctx.state;
      s.plant.vitality = 100;
      s.plant.lastWateredAt = ctx.now;
      ctx.log('watered the plant');
      // Understated on purpose.
      ctx.say(pickWaterLine(ctx));
    },
  });
  return true;
}

function pickWaterLine(ctx: Ctx): string {
  const lines = [
    'there. a little water, turn it to the light. that\'s all it asks.',
    'orders can wait a minute. this doesn\'t.',
    'she kept it on the windowsill. i keep it here. same idea.',
    'good. still green. still ours.',
  ];
  return lines[Math.floor(ctx.rng() * lines.length)];
}
