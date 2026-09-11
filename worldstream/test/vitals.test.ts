import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import type { IncomingChat } from '../src/server/ingest.js';
import { runCommand, type InterpreterContext } from '../src/server/interpreter.js';
import { Policy } from '../src/server/policy.js';
import { Store } from '../src/server/store.js';
import { resetVitalsMemory, stepVitals, type VitalsDeps } from '../src/server/vitals.js';
import type { Catalogue } from '../src/shared/catalogue.js';
import { ConfigSchema } from '../src/shared/config.js';
import { apply, initialState } from '../src/shared/state.js';

const root = new URL('..', import.meta.url);
const catalogue = JSON.parse(readFileSync(new URL('assets/worlds/cyberpunk/catalogue.json', root), 'utf8')) as Catalogue;
const baseCfg = JSON.parse(readFileSync(new URL('config/world.config.json', root), 'utf8'));

function setup() {
  const cfg = ConfigSchema.parse({ ...baseCfg, survival: { ...baseCfg.survival, collapseWindowMs: 30_000, blackoutMs: 5_000, sleepMs: 10_000, decayScale: 1 } });
  const store = new Store(mkdtempSync(join(tmpdir(), 'ws-')), 'cyberpunk');
  const ctx: InterpreterContext = { store, policy: new Policy(cfg), catalogue, cfg };
  const said: string[] = [];
  const saves: string[] = [];
  const deaths: number[] = [];
  const deps: VitalsDeps = { store, cfg, catalogue: () => catalogue, say: (t) => said.push(t), onSave: (_id, name) => saves.push(name), onDeath: (n) => deaths.push(n), onNewDay: () => {}, rnd: () => 0.99 };
  const mod: IncomingChat = { id: 'm', user: { id: 'u:mod', name: 'mod', badges: ['moderator'] }, content: '', at: 0, source: 'mock' };
  const kai: IncomingChat = { id: 'k', user: { id: 'u:kai', name: 'kai', badges: ['moderator'] }, content: '', at: 0, source: 'mock' };
  return { cfg, store, ctx, deps, said, saves, deaths, mod, kai };
}

beforeEach(() => resetVitalsMemory());

describe('vitals reducer', () => {
  it('collapses, revives to a floor, and dies with a blackout and a reset streak', () => {
    let s = initialState('cyberpunk');
    s = apply(s, { type: 'set_vitals', patch: { food: 0, days: 3 } });
    s = apply(s, { type: 'collapse', need: 'food', at: 1000, windowMs: 90_000 });
    expect(s.character.vitals.collapsed).toEqual({ need: 'food', since: 1000, until: 91_000 });
    const revived = apply(s, { type: 'revive', at: 2000, by: 'kai' });
    expect(revived.character.vitals.collapsed).toBeUndefined();
    expect(revived.character.vitals.food).toBe(40);
    expect(revived.character.vitals.lastSavedBy).toBe('kai');
    const dead = apply(s, { type: 'death', at: 91_000, blackoutMs: 25_000, respawnX: 16 });
    expect(dead.character.vitals.deaths).toBe(1);
    expect(dead.character.vitals.days).toBe(0);
    expect(dead.character.vitals.blackout).toEqual({ since: 91_000, until: 116_000 });
    expect(dead.character.x).toBe(16);
    expect(apply(s, { type: 'set_vitals', patch: { spirit: 500 } }).character.vitals.spirit).toBe(100);
  });
});

describe('the body over time', () => {
  it('drains, then eats from a stand nearby and a cup once', () => {
    const t = setup();
    runCommand({ kind: 'add', sprite: 'ramen stand', position: 'centre' }, t.mod, t.ctx);
    const stand = t.store.state.entities[0];
    t.store.dispatch({ type: 'set_character', patch: { x: stand.x + 20 } });
    t.store.dispatch({ type: 'set_vitals', patch: { food: 50 } });
    stepVitals(t.deps, 10_000, 1000);
    expect(t.store.state.character.vitals.food).toBeGreaterThan(70); // ate
    expect(t.said.length).toBe(1);
    stepVitals(t.deps, 11_000, 1000);
    expect(t.store.state.character.vitals.food).toBeLessThan(75.1); // no second meal within a minute, just drain
    runCommand({ kind: 'add', sprite: 'noodle cup', position: 'centre' }, t.kai, t.ctx);
    const cup = t.store.state.entities.find((e) => e.sprite === 'noodle_cup')!;
    t.store.dispatch({ type: 'set_character', patch: { x: cup.x + 3 } });
    t.store.dispatch({ type: 'set_vitals', patch: { food: 30 } });
    stepVitals(t.deps, 12_000, 1000);
    expect(t.store.state.entities.some((e) => e.sprite === 'noodle_cup')).toBe(false);
    expect(t.store.state.character.vitals.food).toBeGreaterThan(60);
  });

  it('gets warm by a fire, cold in a storm at night', () => {
    const t = setup();
    t.store.dispatch({ type: 'set_time', time: 23 });
    t.store.dispatch({ type: 'set_weather', weather: 'storm' });
    t.store.dispatch({ type: 'set_vitals', patch: { comfort: 50 } });
    stepVitals(t.deps, 10_000, 10_000);
    const cold = t.store.state.character.vitals.comfort;
    expect(cold).toBeLessThan(49);
    runCommand({ kind: 'add', sprite: 'barrel fire', position: 'centre' }, t.kai, t.ctx);
    const fire = t.store.state.entities.find((e) => e.sprite === 'barrel_fire')!;
    t.store.dispatch({ type: 'set_character', patch: { x: fire.x + 5 } });
    stepVitals(t.deps, 20_000, 10_000);
    expect(t.store.state.character.vitals.comfort).toBeGreaterThan(cold);
  });

  it('collapses at zero, is saved by whoever put food next to him, and credits them', () => {
    const t = setup();
    t.store.dispatch({ type: 'set_vitals', patch: { food: 0.01 } });
    stepVitals(t.deps, 10_000, 1000);
    expect(t.store.state.character.vitals.collapsed?.need).toBe('food');
    expect(t.said.at(-1)).toMatch(/down|hungry|legs/);
    stepVitals(t.deps, 15_000, 5000); // frozen while collapsed
    expect(t.store.state.character.vitals.collapsed).toBeDefined();
    runCommand({ kind: 'add', sprite: 'noodle cup', position: 'centre' }, t.kai, t.ctx);
    const cup = t.store.state.entities.find((e) => e.sprite === 'noodle_cup')!;
    t.store.dispatch({ type: 'move_entity', id: cup.id, x: t.store.state.character.x - 4 });
    stepVitals(t.deps, 16_000, 1000);
    expect(t.store.state.character.vitals.collapsed).toBeUndefined();
    expect(t.store.state.character.vitals.food).toBeGreaterThanOrEqual(40);
    expect(t.saves).toEqual(['kai']);
    expect(t.said.at(-1)).toContain('kai');
  });

  it('dies when nobody helps, blacks out, resets the streak and frees companions, then comes back', () => {
    const t = setup();
    runCommand({ kind: 'add', sprite: 'cat', position: 'left' }, t.kai, t.ctx);
    const cat = t.store.state.entities[0];
    t.store.dispatch({ type: 'set_follow', id: cat.id, follow: true });
    t.store.dispatch({ type: 'set_vitals', patch: { comfort: 0.01, days: 2 } });
    stepVitals(t.deps, 10_000, 1000);
    expect(t.store.state.character.vitals.collapsed?.need).toBe('comfort');
    stepVitals(t.deps, 41_000, 1000); // past the 30s window
    const v = t.store.state.character.vitals;
    expect(v.deaths).toBe(1);
    expect(v.days).toBe(0);
    expect(v.blackout).toBeDefined();
    expect(t.deaths).toEqual([1]);
    expect(t.store.state.entities[0].follow).toBe(false);
    stepVitals(t.deps, 47_000, 1000); // blackout over
    expect(t.store.state.character.vitals.blackout).toBeUndefined();
    expect(t.said.at(-1)).toMatch(/remember|back|1 now/);
  });

  it('lies down on a bench when tired, recovers, and wakes', () => {
    const t = setup();
    runCommand({ kind: 'add', sprite: 'bench', position: 'centre' }, t.kai, t.ctx);
    const bench = t.store.state.entities[0];
    t.store.dispatch({ type: 'set_character', patch: { x: bench.x + 12, targetX: undefined } });
    t.store.dispatch({ type: 'set_vitals', patch: { rest: 20 } });
    const deps = { ...t.deps, rnd: () => 0.1 }; // low roll so he decides to look after himself
    stepVitals(deps, 10_000, 1000);
    expect(t.store.state.character.sleeping).toBeDefined();
    stepVitals(deps, 15_000, 5000);
    expect(t.store.state.character.vitals.rest).toBeGreaterThan(24);
    stepVitals(deps, 21_000, 1000); // past sleepMs
    expect(t.store.state.character.sleeping).toBeUndefined();
    expect(t.said.at(-1)).toMatch(/hm\?|asleep|where were we/);
  });
});
