import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ConfigSchema } from '../src/shared/config.js';
import { Policy } from '../src/server/policy.js';
import { apply, initialState, VIEW, type Entity } from '../src/shared/state.js';

const cfg = ConfigSchema.parse({
  ...JSON.parse(readFileSync(new URL('../config/world.config.json', import.meta.url), 'utf8')),
  limits: { maxEntities: 3, maxPerLayer: { near: 1 }, addCooldownMs: 30_000, entityTtlMs: 60_000, signMaxChars: 8 },
  denylist: ['badword'],
});

const user = { id: 'u1', name: 'alice', badges: [] as string[] };
const mod = { id: 'm1', name: 'mod', badges: ['moderator'] };
const ent = (id: string, layer: Entity['layer'] = 'stage', addedBy = 'u1'): Entity => ({
  id, sprite: 'cat', layer, x: 10, y: VIEW.groundY - 6, addedBy, addedByName: addedBy, addedAt: 0, touchedAt: 0, expiresAt: 9e12,
});

describe('policy', () => {
  it('enforces the total cap and the per-layer cap', () => {
    const p = new Policy(cfg);
    let s = initialState('cyberpunk');
    expect(p.canAdd(s, user, 'stage', 0).ok).toBe(true);
    s = apply(s, { type: 'add_entity', entity: ent('a', 'near') });
    expect(p.canAdd(s, user, 'near', 0).ok).toBe(false);
    s = apply(s, { type: 'add_entity', entity: ent('b') });
    s = apply(s, { type: 'add_entity', entity: ent('c') });
    expect(p.canAdd(s, user, 'stage', 0).ok).toBe(false);
  });

  it('applies the per-user cooldown, which moderators skip', () => {
    const p = new Policy(cfg);
    const s = initialState('cyberpunk');
    p.noteAdd(user, 1000);
    expect(p.canAdd(s, user, 'stage', 5000).ok).toBe(false);
    expect(p.canAdd(s, user, 'stage', 31_001).ok).toBe(true);
    p.noteAdd(mod, 1000);
    expect(p.canAdd(s, mod, 'stage', 1001).ok).toBe(true);
  });

  it('lets people remove only their own things, moderators anything', () => {
    const p = new Policy(cfg);
    expect(p.canRemove(user, ent('a', 'stage', 'u1')).ok).toBe(true);
    expect(p.canRemove(user, ent('a', 'stage', 'u2')).ok).toBe(false);
    expect(p.canRemove(mod, ent('a', 'stage', 'u2')).ok).toBe(true);
  });

  it('filters sign text by length and denylist', () => {
    const p = new Policy(cfg);
    expect(p.filterText('  go   west ')).toEqual({ ok: true, text: 'go west' });
    expect(p.filterText('far too long for a sign').ok).toBe(false);
    expect(p.filterText('b a d w o r d').ok).toBe(false);
    expect(p.filterText('').ok).toBe(false);
  });
});
