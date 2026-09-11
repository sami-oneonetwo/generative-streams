import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Host } from '../src/server/host/engine.js';
import { PERKS, pickErrand } from '../src/server/host/errands.js';
import { buildHooks } from '../src/server/host/hooks.js';
import { Profiles } from '../src/server/host/profiles.js';
import type { IncomingChat } from '../src/server/ingest.js';
import { runCommand, type InterpreterContext } from '../src/server/interpreter.js';
import { Policy } from '../src/server/policy.js';
import { Store } from '../src/server/store.js';
import { resetVitalsMemory, stepVitals } from '../src/server/vitals.js';
import type { Catalogue } from '../src/shared/catalogue.js';
import { parseCommand } from '../src/shared/commands.js';
import { ConfigSchema } from '../src/shared/config.js';
import { WORLDS, type World } from '../src/shared/state.js';

const root = new URL('..', import.meta.url);
const worlds = new Map<World, Catalogue>(WORLDS.map((w) => [w, JSON.parse(readFileSync(new URL(`assets/worlds/${w}/catalogue.json`, root), 'utf8')) as Catalogue]));
const baseCfg = JSON.parse(readFileSync(new URL('config/world.config.json', root), 'utf8'));

function setup() {
  const cfg = ConfigSchema.parse({ ...baseCfg, host: { ...baseCfg.host, mode: 'full' } });
  const dir = mkdtempSync(join(tmpdir(), 'ws-'));
  const store = new Store(dir, 'cyberpunk');
  const ctx: InterpreterContext = { store, policy: new Policy(cfg), cfg, get catalogue() { return worlds.get(store.state.world)!; } };
  let now = 1_000_000_000_000;
  const said: string[] = [];
  const hooks = buildHooks().filter((h) => h.id === 'errand_start' || h.id === 'errand_find');
  const host = new Host({ ctx, cfg, profiles: new Profiles(join(dir, 'viewers.json')), brain: null, say: (t) => said.push(t), hooks, arcs: [], worlds: [...worlds.keys()], catalogueOf: (w) => worlds.get(w), now: () => now, rnd: () => 0.01 });
  const advance = (ms: number) => { now += ms; };
  const chat = (name: string, content: string, badges: string[] = []): IncomingChat => ({ id: `${name}-${now}`, user: { id: `u:${name}`, name, badges }, content, at: now, source: 'mock' });
  const send = (msg: IncomingChat) => { const cmd = parseCommand(msg.content); const outcome = cmd ? runCommand(cmd, msg, ctx) : { applied: false }; return host.observe(msg, cmd, outcome); };
  return { cfg, store, ctx, host, said, advance, chat, send, now: () => now };
}

describe('errands', () => {
  it('only offers errands whose item exists in a world that exists', () => {
    const def = pickErrand('cyberpunk', ['cyberpunk', 'desert'], (w) => worlds.get(w), [], () => 0);
    expect(def?.world).toBe('desert');
    expect(pickErrand('cyberpunk', ['cyberpunk'], (w) => worlds.get(w), [], () => 0)).toBeNull();
    expect(pickErrand('cyberpunk', ['cyberpunk', 'desert'], (w) => worlds.get(w), ['lantern'], () => 0)?.item).not.toBe('lantern');
  });

  it('announces, leaves unless chat says stay, searches with help, collects, and comes home with a bag', async () => {
    const t = setup();
    t.advance(11 * 60_000); // he has been in the city a while
    await t.host.forceAsk();
    const askText = t.said.at(-1)!;
    expect(askText).toContain('say stay');
    const status = t.host.status() as { ask: { hook: string } };
    expect(status.ask.hook).toBe('errand_start');
    t.send(t.chat('a', 'go go go'));
    t.advance(30_000);
    await t.host.tick(); // resolve the collected vote
    const e = t.store.state.character.errand!;
    expect(e.stage).toBe('travelling');
    expect(e.home).toBe('cyberpunk');
    expect(t.store.state.transition?.to).toBe(e.target);

    // arrive
    t.store.switchWorld(e.target);
    await t.host.tick();
    expect(t.store.state.character.errand?.stage).toBe('searching');
    // chat finds it
    t.advance(60_000);
    await t.host.forceAsk();
    expect((t.host.status() as { ask: { hook: string } }).ask.hook).toBe('errand_find');
    t.send(t.chat('kai', `!add ${e.item.replace(/_/g, ' ')}`, ['moderator']));
    const item = t.store.state.entities.find((x) => x.sprite === e.item)!;
    expect(item).toBeDefined();
    t.store.dispatch({ type: 'set_character', patch: { x: item.x + 4, targetX: undefined } });
    await t.host.tick();
    expect(t.store.state.character.errand?.stage).toBe('found');
    expect(t.store.state.character.inventory).toEqual([e.item]);
    expect(t.store.state.entities.some((x) => x.sprite === e.item)).toBe(false);

    // and home
    t.advance(100_000);
    await t.host.tick();
    expect(t.store.state.character.errand?.stage).toBe('returning');
    expect(t.store.state.transition?.to).toBe('cyberpunk');
    t.store.switchWorld('cyberpunk');
    await t.host.tick();
    expect(t.store.state.character.errand).toBeUndefined();
    expect(t.store.state.character.inventory).toEqual([e.item]);
    expect(t.said.at(-1)).toMatch(/back|home|brought/);
  });

  it('turns the item up itself when chat does not, and chat can keep him home', async () => {
    const t = setup();
    t.advance(11 * 60_000);
    await t.host.forceAsk();
    t.send(t.chat('a', 'stay'));
    t.send(t.chat('b', 'stay please'));
    t.send(t.chat('c', 'go'));
    t.advance(30_000);
    await t.host.tick();
    expect(t.store.state.character.errand).toBeUndefined();
    expect(t.said.at(-1)).toMatch(/stay/);
    // force one directly
    t.store.dispatch({ type: 'set_character', patch: { errand: { item: 'lantern', target: 'desert', home: 'cyberpunk', stage: 'travelling', since: t.now() } } });
    t.store.switchWorld('desert');
    await t.host.tick();
    t.advance(5 * 60_000);
    await t.host.tick();
    expect(t.store.state.entities.some((x) => x.sprite === 'lantern' && x.addedBy === 'world')).toBe(true);
    expect(t.store.state.character.errand?.spawned).toBe(true);
  });

  it('what is in the bag slows the drains', () => {
    resetVitalsMemory();
    const cfg = ConfigSchema.parse(baseCfg);
    const mk = (bag: string[]) => {
      const store = new Store(mkdtempSync(join(tmpdir(), 'ws-')), 'cyberpunk');
      store.dispatch({ type: 'set_time', time: 23 });
      store.dispatch({ type: 'set_character', patch: { inventory: bag } });
      stepVitals({ store, cfg, catalogue: () => worlds.get('cyberpunk')!, say: () => {}, onSave: () => {}, onDeath: () => {}, onNewDay: () => {}, rnd: () => 0.99 }, 5_000, 60_000);
      return store.state.character.vitals;
    };
    expect(PERKS.lantern.comfort).toBeLessThan(1);
    expect(mk(['lantern']).comfort).toBeGreaterThan(mk([]).comfort);
    expect(mk(['bread']).food).toBeGreaterThan(mk([]).food);
  });
});
