import { describe, expect, it } from 'vitest';
import { apply, initialState, VIEW, type Entity } from '../src/shared/state.js';

const ent = (id: string, x = 100, extra: Partial<Entity> = {}): Entity => ({
  id, sprite: 'cat', layer: 'stage', x, y: VIEW.groundY - 6,
  addedBy: 'u1', addedByName: 'u1', addedAt: 0, touchedAt: 0, expiresAt: 1000, ...extra,
});

describe('reducer', () => {
  it('adds an entity and bumps the version', () => {
    const s0 = initialState('cyberpunk');
    const s1 = apply(s0, { type: 'add_entity', entity: ent('a') });
    expect(s1.version).toBe(1);
    expect(s1.entities.map((e) => e.id)).toEqual(['a']);
    expect(s0.entities).toHaveLength(0);
  });

  it('ignores a duplicate id without bumping', () => {
    const s1 = apply(initialState('cyberpunk'), { type: 'add_entity', entity: ent('a') });
    const s2 = apply(s1, { type: 'add_entity', entity: ent('a', 300) });
    expect(s2).toBe(s1);
  });

  it('clamps positions into the world', () => {
    const s = apply(initialState('cyberpunk'), { type: 'add_entity', entity: ent('a', 5000, { y: -20 }) });
    expect(s.entities[0].x).toBe(VIEW.worldW - 1);
    expect(s.entities[0].y).toBe(0);
  });

  it('removing an unknown id is a no-op', () => {
    const s = initialState('cyberpunk');
    expect(apply(s, { type: 'remove_entity', id: 'nope' })).toBe(s);
  });

  it('expires only what has passed', () => {
    let s = initialState('cyberpunk');
    s = apply(s, { type: 'add_entity', entity: ent('old', 10, { expiresAt: 100 }) });
    s = apply(s, { type: 'add_entity', entity: ent('new', 20, { expiresAt: 900 }) });
    const after = apply(s, { type: 'expire', now: 500 });
    expect(after.entities.map((e) => e.id)).toEqual(['new']);
    expect(apply(after, { type: 'expire', now: 500 })).toBe(after);
  });

  it('touch extends the lifetime', () => {
    let s = apply(initialState('cyberpunk'), { type: 'add_entity', entity: ent('a', 10, { expiresAt: 100 }) });
    s = apply(s, { type: 'touch_entity', id: 'a', at: 90, ttlMs: 1000 });
    expect(s.entities[0].expiresAt).toBe(1090);
    expect(s.entities[0].touchedAt).toBe(90);
  });

  it('wraps the hour and treats same values as no-ops', () => {
    const s = initialState('cyberpunk');
    expect(apply(s, { type: 'set_time', time: 25 }).time).toBe(1);
    expect(apply(s, { type: 'set_time', time: -1 }).time).toBe(23);
    expect(apply(s, { type: 'set_time', time: s.time })).toBe(s);
    expect(apply(s, { type: 'set_weather', weather: s.weather })).toBe(s);
  });

  it('camera stays within the scrollable range', () => {
    const s = apply(initialState('cyberpunk'), { type: 'set_camera', x: 99999 });
    expect(s.camera.x).toBe(VIEW.worldW - VIEW.w);
  });
});

describe('operator voice hold', () => {
  it('keeps other sources from putting words in his mouth, except critical ones', async () => {
    const { Store } = await import('../src/server/store.js');
    const { mkdtempSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const store = new Store(mkdtempSync(join(tmpdir(), 'ws-')), 'cyberpunk');
    store.holdVoice(60_000);
    expect(store.voiceHeld).toBe(true);
    expect(store.dispatch({ type: 'set_character', patch: { bubble: { text: 'ambient', until: 9e12 } } }, 'character')).toBe(false);
    expect(store.state.character.bubble).toBeUndefined();
    expect(store.dispatch({ type: 'set_character', patch: { bubble: { text: 'walking', until: 9e12 }, mode: 'walk' } }, 'host')).toBe(true);
    expect(store.state.character.bubble).toBeUndefined(); // bubble stripped, mode kept
    expect(store.state.character.mode).toBe('walk');
    expect(store.dispatch({ type: 'set_character', patch: { bubble: { text: 'I am down', until: 9e12 } } }, 'critical')).toBe(true);
    expect(store.state.character.bubble?.text).toBe('I am down');
    expect(store.dispatch({ type: 'set_character', patch: { bubble: { text: 'hello chat', until: 9e12 } } }, 'operator')).toBe(true);
    expect(store.state.character.bubble?.text).toBe('hello chat');
    store.releaseVoice();
    expect(store.dispatch({ type: 'set_character', patch: { bubble: { text: 'free again', until: 9e12 } } }, 'character')).toBe(true);
    expect(store.state.character.bubble?.text).toBe('free again');
  });
});
