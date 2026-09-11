import { describe, expect, it } from 'vitest';
import type { AmbientDef } from '../src/shared/catalogue.js';
import { advanceTime, fill, makeAmbientEntity, pick, pickWeighted } from '../src/server/drift.js';

describe('drift helpers', () => {
  it('advances in-world time at the configured rate and wraps at 24', () => {
    expect(advanceTime(10, 5 * 60_000, 5)).toBeCloseTo(11, 3);
    expect(advanceTime(23.5, 5 * 60_000, 5)).toBeCloseTo(0.5, 3);
    expect(advanceTime(22, 1000, 5)).toBeCloseTo(22.003, 3);
  });

  it('picks by weight and can exclude the current value', () => {
    const w = { rain: 0.5, clear: 0.25, fog: 0.25 } as const;
    expect(pickWeighted(w, 0.1)).toBe('rain');
    expect(pickWeighted(w, 0.6)).toBe('clear');
    expect(pickWeighted(w, 0.99)).toBe('fog');
    expect(pickWeighted(w, 0.1, 'rain')).toBe('clear');
    expect(pickWeighted({ rain: 1 }, 0.5, 'rain')).toBeUndefined();
    expect(pickWeighted({}, 0.5)).toBeUndefined();
  });

  it('builds ambient entities with scripted motion', () => {
    const def: AmbientDef = { name: 'train', sprite: 'train', layer: 'near', y: [100, 120], from: -100, to: 1060, durationMs: 9000, everyMs: [1, 2] };
    const e = makeAmbientEntity(def, 5000, () => 0.5);
    expect(e.id.startsWith('amb-train-')).toBe(true);
    expect(e.y).toBe(110);
    expect(e.motion).toEqual({ fromX: -100, toX: 1060, startAt: 5000, endAt: 14000 });
    expect(e.expiresAt).toBe(14000);
    expect(e.addedBy).toBe('world');
  });

  it('fills templates and leaves unknown keys visible', () => {
    expect(fill('{user} brought a {thing}', { user: 'kai', thing: 'cat' })).toBe('kai brought a cat');
    expect(fill('{nope}', {})).toBe('{nope}');
    expect(pick([], () => 0)).toBeUndefined();
    expect(pick(['a', 'b'], () => 0.99)).toBe('b');
  });
});
