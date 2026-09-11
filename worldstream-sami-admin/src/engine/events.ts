import type { WorldCtx, WorldModule } from './world';

export function scheduleNextRoll(tuning: Record<string, number>, rng: () => number): number {
  const min = tuning.eventRollMsMin ?? 180_000;
  const max = tuning.eventRollMsMax ?? 300_000;
  return Date.now() + min + rng() * Math.max(0, max - min);
}

/** Weighted roll over the world's event table. Returns the triggered event name, or null. */
export function rollEvent<S>(world: WorldModule<S>, ctx: WorldCtx<S>): string | null {
  const weighted = world.events
    .map((d) => ({ d, w: Math.max(0, d.weight(ctx.state)) }))
    .filter((x) => x.w > 0);
  if (!weighted.length) return null;

  const total = weighted.reduce((s, x) => s + x.w, 0);
  let r = ctx.rng() * total;
  for (const { d, w } of weighted) {
    r -= w;
    if (r <= 0) {
      try {
        d.trigger(ctx);
      } catch (e) {
        ctx.log(`event '${d.name}' failed: ${(e as Error).message}`, 'warn');
      }
      return d.name;
    }
  }
  return null;
}
