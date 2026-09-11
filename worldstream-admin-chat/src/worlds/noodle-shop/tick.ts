import type { WorldCtx } from '../../engine/world';
import { canCook, type NoodleShopState } from './state';
import { tuning } from './tuning';
import { enqueueWaterPlant } from './fixes';
import { potX } from './scene';

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

export function tick(ctx: WorldCtx<NoodleShopState>, dtMs: number): void {
  const state = ctx.state;
  const hours = dtMs / 3_600_000;

  // Bowls: customers finish, then linger, then the bowl goes cold (waste).
  for (const stool of Object.values(state.stools)) {
    const bowl = stool.bowl;
    if (!bowl) continue;
    if (!bowl.eaten && ctx.now - bowl.servedAt >= tuning.bowlEatMs) {
      bowl.eaten = true;
      state.reputation = clamp(state.reputation + tuning.repPerHappyBowl, 0, 100);
    } else if (bowl.eaten && ctx.now - bowl.servedAt >= tuning.bowlEatMs + tuning.bowlColdMs) {
      stool.bowl = undefined; // cleared away, seat ready for the next order
    } else if (!bowl.eaten && ctx.now - bowl.servedAt >= tuning.bowlColdMs + tuning.bowlEatMs) {
      stool.bowl = undefined;
      state.reputation = clamp(state.reputation - tuning.repColdBowlPenalty, 0, 100);
      ctx.log(`${stool.ownerName}'s bowl went cold, untouched — waste`, 'warn');
    }
  }

  // Rush hour: nudges reputation for the crowd energy, ends on its own.
  if (state.incidents.rush && ctx.now >= state.incidents.rush.endsAt) {
    state.incidents.rush = undefined;
    ctx.log('the rush died down');
  }

  // Rat left loose too long is a health-code hit.
  const rat = state.incidents.rat;
  if (rat && ctx.now >= rat.deadlineAt) {
    state.incidents.rat = undefined;
    state.reputation = clamp(state.reputation - tuning.repRatPenalty, 0, 100);
    ctx.log('the rat got into the flour before it was caught — reputation took a hit', 'alert');
    ctx.say('it got into the flour. that batch is in the bin. that is money and face, both gone.');
  }

  // The plant slowly needs water; Kenji tends it himself when it dips.
  state.plant.vitality = clamp(state.plant.vitality - tuning.plantDecayPerHour * hours, 0, 100);
  if (state.plant.vitality < tuning.plantWaterBelow && !state.broth.simmering) {
    enqueueWaterPlant(ctx);
  }

  // A fresh pot finishes simmering (guarded task in the queue handles the fill;
  // here we just clear the flag if somehow left set with servings present).
  if (state.broth.servings <= 0 && !state.broth.simmering && ctx.queue.length === 0) {
    startSimmer(ctx);
  }

  state.lastLiveAt = ctx.now;
}

/** Begin a fresh pot; the pot is unusable until the simmer task completes. */
export function startSimmer(ctx: WorldCtx<NoodleShopState>): void {
  const state = ctx.state;
  if (state.broth.simmering) return;
  if (ctx.queue.some((q) => q.kind === 'simmer')) return;
  state.broth.simmering = true;
  ctx.log('starting a fresh pot of broth');
  ctx.say('pot\'s empty. new batch on. good broth takes time — you cannot rush it and you should not ask.');
  ctx.enqueueTask({
    kind: 'simmer',
    label: 'simmer a fresh pot',
    targetX: potX(),
    workMs: tuning.taskSimmerMs,
    priority: 3,
    onComplete(ctx) {
      const s = ctx.state;
      s.broth.servings = tuning.brothServings;
      s.broth.simmering = false;
      ctx.log(`fresh pot ready (${tuning.brothServings} servings)`);
      ctx.say('broth\'s ready. tonkotsu, rich and clean. who\'s first.');
    },
  });
}
