import { existsSync, mkdtempSync, readFileSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import { Generator, validateRows } from '../src/server/generator.js';
import type { IncomingChat } from '../src/server/ingest.js';
import { runCommand, type InterpreterContext } from '../src/server/interpreter.js';
import { Policy } from '../src/server/policy.js';
import { Store } from '../src/server/store.js';
import type { Atlas } from '../src/shared/atlas.js';
import type { Catalogue } from '../src/shared/catalogue.js';
import { parseCommand } from '../src/shared/commands.js';
import { ConfigSchema } from '../src/shared/config.js';
import type { World } from '../src/shared/state.js';

const root = new URL('..', import.meta.url);
const baseCfg = JSON.parse(readFileSync(new URL('config/world.config.json', root), 'utf8'));
const atlasPath = new URL('dist/worlds/cyberpunk/atlas.json', root);

const keys = { '.': '', a: '#3d3d5c', k: '#ff8a3d', m: '#ffe066', '1': '#0b0a1e' };

describe('validateRows', () => {
  it('pads ragged rows, trims blank edges, and reports sizes', () => {
    const f = validateRows(['..kk', 'kkkkk', '.mm', '1111'], keys, 40, 32);
    expect(f.w).toBe(5);
    expect(f.h).toBe(4);
    expect(f.rows[0]).toBe('..kk.');
  });
  it('rejects off-palette keys, empty and oversized grids', () => {
    expect(() => validateRows(['kkkk', 'kkzk', 'kkkk', 'kkkk'], keys, 40, 32)).toThrow(/palette/);
    expect(() => validateRows(['....', '....', '....'], keys, 40, 32)).toThrow(/empty/);
    expect(() => validateRows(Array(40).fill('k'.repeat(50)), keys, 40, 32)).toThrow(/too big/);
    expect(() => validateRows('nope', keys, 40, 32)).toThrow();
  });
});

describe('Generator', () => {
  it('draws, validates, saves, registers, announces and places a new sprite for the viewer', async () => {
    if (!existsSync(atlasPath)) return; // needs a packed atlas
    const atlas = JSON.parse(readFileSync(atlasPath, 'utf8')) as Atlas;
    const cfg = ConfigSchema.parse(baseCfg);
    const dir = mkdtempSync(join(tmpdir(), 'ws-gen-'));
    // a scratch copy of the world so files land somewhere disposable
    cpSync(new URL('assets/worlds/cyberpunk/catalogue.json', root), join(dir, 'assets/worlds/cyberpunk/catalogue.json'), { recursive: true });
    const store = new Store(join(dir, 'state'), 'cyberpunk');
    const worlds = new Map<World, Catalogue>([['cyberpunk', atlas]]);
    const ctx: InterpreterContext = { store, policy: new Policy(cfg), cfg, get catalogue() { return worlds.get('cyberpunk')!; } };
    const said: string[] = [];
    const pushed: string[] = [];
    let now = 1_000_000_000_000;
    const gen = new Generator({
      cfg, ctx, worlds, root: dir,
      say: (t) => said.push(t),
      onSprite: (_w, s) => pushed.push(s.name),
      now: () => now,
      complete: async () => ({
        id: 'm', type: 'message', role: 'assistant', model: 'x', stop_reason: 'tool_use', stop_sequence: null,
        usage: { input_tokens: 10, output_tokens: 20 },
        content: [{ type: 'tool_use', id: 't', name: 'sprite', input: { name: 'hot_dog_cart', rows: ['..kkkkkk..', '.kmkmkmkk.', 'kkkkkkkkkk', '.1......1.'], layer: 'stage', tags: ['food', 'cart'], aliases: ['hotdog stand', 'sausage cart'] } }],
      }) as unknown as Anthropic.Beta.BetaMessage,
    });
    ctx.generator = gen;
    const msg: IncomingChat = { id: '1', user: { id: 'u:kai', name: 'kai', badges: [] }, content: '!add hot dog cart', at: now, source: 'mock' };
    const outcome = runCommand(parseCommand(msg.content)!, msg, ctx);
    expect(outcome.applied).toBe(true);
    expect(outcome.reply).toMatch(/draw/);
    await new Promise((r) => setTimeout(r, 20));
    expect(pushed).toEqual(['hot_dog_cart']);
    const def = atlas.sprites.find((s) => s.name === 'hot_dog_cart')!;
    expect(def.generated).toBe(true);
    expect(def.w).toBe(10);
    expect(def.aliases).toContain('hot dog cart');
    expect(def.tags).toContain('food');
    expect(store.state.entities.some((e) => e.sprite === 'hot_dog_cart' && e.addedBy === 'u:kai')).toBe(true);
    expect(said.at(-1)).toMatch(/hot dog cart/);
    expect(existsSync(join(dir, 'assets/worlds/cyberpunk/generated/hot_dog_cart.sprite'))).toBe(true);
    expect(JSON.parse(readFileSync(join(dir, 'assets/worlds/cyberpunk/generated.json'), 'utf8'))[0].name).toBe('hot_dog_cart');
    // the same viewer cannot flood it
    expect(gen.request({ query: 'jetpack', user: msg.user, world: 'cyberpunk', msg }).ok).toBe(false);
    // and it can be removed again
    expect(gen.remove('cyberpunk', 'hot_dog_cart')).toBe(true);
    expect(atlas.sprites.some((s) => s.name === 'hot_dog_cart')).toBe(false);
    expect(store.state.entities.some((e) => e.sprite === 'hot_dog_cart')).toBe(false);
  });
});
