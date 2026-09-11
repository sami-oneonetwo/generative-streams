import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Builder } from '../src/server/builder.js';
import { Host } from '../src/server/host/engine.js';
import { buildHooks } from '../src/server/host/hooks.js';
import { Profiles } from '../src/server/host/profiles.js';
import type { IncomingChat } from '../src/server/ingest.js';
import { runCommand, type InterpreterContext } from '../src/server/interpreter.js';
import { Policy } from '../src/server/policy.js';
import { Store } from '../src/server/store.js';
import type { Catalogue } from '../src/shared/catalogue.js';
import { parseCommand } from '../src/shared/commands.js';
import { ConfigSchema } from '../src/shared/config.js';

const root = new URL('..', import.meta.url);
const catalogue = JSON.parse(readFileSync(new URL('assets/worlds/cyberpunk/catalogue.json', root), 'utf8')) as Catalogue;
const baseCfg = JSON.parse(readFileSync(new URL('config/world.config.json', root), 'utf8'));

function setup(mode: 'streamer' | 'full' = 'streamer') {
  const cfg = ConfigSchema.parse({ ...baseCfg, host: { ...baseCfg.host, mode } });
  const dir = mkdtempSync(join(tmpdir(), 'ws-'));
  const store = new Store(dir, 'cyberpunk');
  const ctx: InterpreterContext = { store, policy: new Policy(cfg), catalogue, cfg };
  let now = 1_000_000_000_000;
  const said: string[] = [];
  const builder = new Builder(ctx, (t) => said.push(t), () => now);
  ctx.builder = builder;
  const host = new Host({ ctx, cfg, profiles: new Profiles(join(dir, 'viewers.json')), brain: null, say: (t) => said.push(t), hooks: buildHooks(), arcs: [], worlds: ['cyberpunk', 'desert'], catalogueOf: () => catalogue, builder, now: () => now, rnd: () => 0.01 });
  const advance = (ms: number) => { now += ms; };
  const chat = (name: string, content: string, badges: string[] = []): IncomingChat => ({ id: `${name}-${now}`, user: { id: `u:${name}`, name, badges }, content, at: now, source: 'mock' });
  const run = (ms: number) => { for (let t = 0; t < ms; t += 400) { advance(400); builder.step(now); } };
  return { cfg, store, ctx, builder, host, said, advance, chat, run, now: () => now };
}

describe('builder', () => {
  it('parses !build and its aliases', () => {
    expect(parseCommand('!build noodle corner')).toEqual({ kind: 'build', name: 'noodle corner' });
    expect(parseCommand('!build me a farm')).toEqual({ kind: 'build', name: 'farm' });
    expect(parseCommand('!make the party')).toEqual({ kind: 'build', name: 'party' });
  });

  it('places the pieces one at a time near him, with the viewer as owner, then announces', () => {
    const t = setup();
    const msg = t.chat('kai', '!build party');
    const outcome = runCommand(parseCommand(msg.content)!, msg, t.ctx);
    expect(outcome.applied).toBe(true);
    expect(t.builder.busy).toBe(true);
    t.run(3600);
    expect(t.store.state.entities.length).toBe(1);
    t.run(6000);
    const mine = t.store.state.entities.filter((e) => e.addedBy === 'u:kai');
    expect(mine.length).toBe(5);
    expect(mine.map((e) => e.sprite)).toContain('graffiti');
    expect(mine.find((e) => e.sprite === 'graffiti')?.text).toBe('PARTY');
    expect(t.builder.busy).toBe(false);
    expect(t.said.at(-1)).toContain('kai');
    // one commission at a time per viewer
    expect(runCommand(parseCommand('!build farm')!, t.chat('kai', '!build farm'), t.ctx).applied).toBe(false);
    expect(runCommand(parseCommand('!build spaceport')!, t.chat('bob', '!build spaceport'), t.ctx).reply).toContain('I can do');
  });

  it('showcases a build, waits for it to finish, then asks chat what they think', async () => {
    const t = setup();
    const hooks = buildHooks().filter((h) => h.id === 'build_showcase');
    const host = new Host({ ctx: t.ctx, cfg: t.cfg, profiles: new Profiles(join(mkdtempSync(join(tmpdir(), 'ws-')), 'v.json')), brain: null, say: (s) => t.said.push(s), hooks, arcs: [], worlds: ['cyberpunk'], catalogueOf: () => catalogue, builder: t.builder, now: t.now, rnd: () => 0.01 });
    t.advance(120_000);
    await host.tick();
    expect(t.builder.busy).toBe(true);
    expect(host.hasOpenAsk).toBe(false); // the question waits for the build
    t.run(9000);
    expect(t.builder.busy).toBe(false);
    await new Promise((r) => setTimeout(r, 0));
  });

  it('welcomes a first-time chatter with a spot carrying their name', () => {
    const t = setup();
    t.host.observe(t.chat('newbie', 'hi everyone'), null, { applied: false });
    expect(t.said.at(-1)).toMatch(/newbie/i);
    t.run(8000);
    const sign = t.store.state.entities.find((e) => e.sprite === 'neon_sign');
    expect(sign?.text).toBe('NEWBIE');
    expect(sign?.addedBy).toBe('u:newbie');
    expect(t.said.at(-1)).toMatch(/newbie/i);
  });

  it('streamer mode leaves the bets and votes out', async () => {
    const t = setup('streamer');
    const ids = new Set<string>();
    for (let i = 0; i < 40; i++) {
      t.advance(400_000);
      await t.host.forceAsk();
      const s = t.host.status() as { ask: { hook: string } | null };
      if (s.ask) ids.add(s.ask.hook);
      t.host.skip();
    }
    for (const banned of ['bet_train', 'weather_vote', 'garden_dare', 'story_prompt', 'lull_event', 'pick_direction', 'travel_tease', 'blank_sign']) expect(ids.has(banned)).toBe(false);
  });
});
