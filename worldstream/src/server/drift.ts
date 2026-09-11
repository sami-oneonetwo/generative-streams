// Pure helpers behind the tick loop, kept free of timers so they can be tested.
import type { AmbientDef } from '../shared/catalogue.js';
import type { Entity } from '../shared/state.js';

export function advanceTime(time: number, elapsedMs: number, minutesPerWorldHour: number): number {
  const t = (time + elapsedMs / (minutesPerWorldHour * 60_000)) % 24;
  return Math.round(t * 1000) / 1000;
}

/** Weighted pick; `exclude` drops one key (e.g. the current weather). */
export function pickWeighted<T extends string>(weights: Partial<Record<T, number>>, rnd: number, exclude?: T): T | undefined {
  const entries = (Object.entries(weights) as [T, number][]).filter(([k, w]) => w > 0 && k !== exclude);
  const total = entries.reduce((a, [, w]) => a + w, 0);
  if (total <= 0) return undefined;
  let r = rnd * total;
  for (const [k, w] of entries) {
    r -= w;
    if (r <= 0) return k;
  }
  return entries[entries.length - 1][0];
}

export function randomBetween(a: number, b: number, rnd: () => number = Math.random): number {
  return a + rnd() * (b - a);
}

export function pick<T>(arr: readonly T[] | undefined, rnd: () => number = Math.random): T | undefined {
  return arr && arr.length ? arr[Math.floor(rnd() * arr.length)] : undefined;
}

export function fill(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_m, k: string) => vars[k] ?? `{${k}}`);
}

export const ambientPrefix = (name: string) => `amb-${name}-`;

export function makeAmbientEntity(def: AmbientDef, now: number, rnd: () => number = Math.random): Entity {
  const y = Array.isArray(def.y) ? Math.round(def.y[0] + rnd() * (def.y[1] - def.y[0])) : def.y;
  return {
    id: `${ambientPrefix(def.name)}${now.toString(36)}`,
    sprite: def.sprite,
    layer: def.layer,
    x: def.from,
    y,
    addedBy: 'world',
    addedByName: 'the city',
    addedAt: now,
    touchedAt: now,
    expiresAt: now + def.durationMs,
    motion: { fromX: def.from, toX: def.to, startAt: now, endAt: now + def.durationMs },
  };
}
