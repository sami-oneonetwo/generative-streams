import { readFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import { Brain, toolToCommand } from '../src/server/brain.js';
import type { IncomingChat } from '../src/server/ingest.js';
import type { InterpreterContext } from '../src/server/interpreter.js';
import { Policy } from '../src/server/policy.js';
import { Store } from '../src/server/store.js';
import type { Catalogue } from '../src/shared/catalogue.js';
import { ConfigSchema } from '../src/shared/config.js';

const root = new URL('..', import.meta.url);
const catalogue = JSON.parse(readFileSync(new URL('assets/worlds/cyberpunk/catalogue.json', root), 'utf8')) as Catalogue;
const baseCfg = JSON.parse(readFileSync(new URL('config/world.config.json', root), 'utf8'));

function makeCtx(mode: 'all' | 'mention' | 'off' = 'all'): InterpreterContext {
  const cfg = ConfigSchema.parse({ ...baseCfg, nl: { ...baseCfg.nl, mode } });
  const store = new Store(mkdtempSync(join(tmpdir(), 'ws-')), 'cyberpunk');
  return { store, policy: new Policy(cfg), catalogue, cfg };
}

const chat = (name: string, content: string, badges: string[] = []): IncomingChat => ({
  id: name + content, user: { id: `u:${name}`, name, badges }, content, at: Date.now(), source: 'mock',
});

const toolUse = (name: string, input: Record<string, unknown>): Anthropic.Beta.BetaToolUseBlock =>
  ({ type: 'tool_use', id: 'tu_' + name, name, input }) as Anthropic.Beta.BetaToolUseBlock;

function fakeMessage(blocks: Anthropic.Beta.BetaToolUseBlock[], stop: Anthropic.Beta.BetaStopReason = 'tool_use'): Anthropic.Beta.BetaMessage {
  return {
    id: 'msg', type: 'message', role: 'assistant', model: 'claude-opus-5', content: blocks, stop_reason: stop, stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 5 },
  } as unknown as Anthropic.Beta.BetaMessage;
}

describe('toolToCommand', () => {
  it('maps tool calls onto fast-path commands', () => {
    expect(toolToCommand('add_entity', { sprite: 'cat', position: 'left', text: '', for_user_id: 'x' })).toEqual({ kind: 'add', sprite: 'cat', position: 'left', text: undefined });
    expect(toolToCommand('remove_entity', { entity_id: 'abc', for_user_id: 'x' })).toEqual({ kind: 'remove', target: 'abc' });
    expect(toolToCommand('set_weather', { weather: 'fog', for_user_id: 'x' })).toEqual({ kind: 'weather', weather: 'fog' });
    expect(toolToCommand('set_weather', { weather: 'lava', for_user_id: 'x' })).toBeNull();
    expect(toolToCommand('set_time', { preset: 'dawn', for_user_id: 'x' })).toEqual({ kind: 'time', preset: 'dawn' });
    expect(toolToCommand('propose_world_change', { world: 'desert', for_user_id: 'x' })).toEqual({ kind: 'world', world: 'desert' });
    expect(toolToCommand('character_say', { text: 'hi' })).toBeNull();
  });
});

describe('Brain', () => {
  it('routes only mentions in mention mode', () => {
    const brain = new Brain(makeCtx('mention'), async () => fakeMessage([]));
    expect(brain.wants(chat('a', 'hello wanderer, nice rain'))).toBe(true);
    expect(brain.wants(chat('a', '@Wanderer add a cat'))).toBe(true);
    expect(brain.wants(chat('a', 'lol'))).toBe(false);
    expect(new Brain(makeCtx('off'), async () => fakeMessage([])).wants(chat('a', 'wanderer'))).toBe(false);
  });

  it('applies tool calls through the policy layer for the right viewer and speaks once', async () => {
    const ctx = makeCtx('all');
    let seen: Anthropic.Beta.MessageCreateParamsNonStreaming | null = null;
    const brain = new Brain(ctx, async (params) => {
      seen = params;
      return fakeMessage([
        toolUse('add_entity', { sprite: 'cat', position: 'left', text: '', for_user_id: 'u:alice' }),
        toolUse('add_entity', { sprite: 'neon_sign', position: 'right', text: 'HELLO', for_user_id: 'u:bob' }),
        toolUse('add_entity', { sprite: 'spaceship', position: 'anywhere', text: '', for_user_id: 'u:carol' }),
        toolUse('character_say', { text: 'a cat and a sign. busy night.' }),
      ]);
    });
    const result = await brain.think([chat('alice', 'can we get a cat'), chat('bob', 'put HELLO in neon'), chat('carol', 'spaceship pls')]);
    expect(result.calls).toHaveLength(4);
    expect(result.outcomes.map((o) => o.applied)).toEqual([true, true, false]);
    const sprites = ctx.store.state.entities.map((e) => [e.sprite, e.addedBy, e.text]);
    expect(sprites).toEqual([['cat', 'u:alice', undefined], ['neon_sign', 'u:bob', 'HELLO']]);
    expect(ctx.store.state.character.bubble?.text).toBe('a cat and a sign. busy night.');
    expect(seen!.model).toBe('claude-opus-5');
    expect(seen!.tools?.length).toBe(11);
    expect(String(seen!.messages[0].content)).toContain('[user_id=u:alice] alice: can we get a cat');
    expect(seen!.fallbacks).toBe('default');
  });

  it('honours cooldowns and ownership exactly like commands', async () => {
    const ctx = makeCtx('all');
    const brain = new Brain(ctx, async () =>
      fakeMessage([
        toolUse('add_entity', { sprite: 'cat', position: 'anywhere', text: '', for_user_id: 'u:alice' }),
        toolUse('add_entity', { sprite: 'plant', position: 'anywhere', text: '', for_user_id: 'u:alice' }),
      ]),
    );
    const r1 = await brain.think([chat('alice', 'cat and plant please')]);
    expect(r1.outcomes.map((o) => o.applied)).toEqual([true, false]);
    const catId = ctx.store.state.entities[0].id;
    const brain2 = new Brain(ctx, async () => fakeMessage([toolUse('remove_entity', { entity_id: catId, for_user_id: 'u:bob' })]));
    const r2 = await brain2.think([chat('bob', 'remove the cat')]);
    expect(r2.outcomes[0].applied).toBe(false);
    expect(ctx.store.state.entities).toHaveLength(1);
  });

  it('does nothing on a refusal', async () => {
    const ctx = makeCtx('all');
    const brain = new Brain(ctx, async () => fakeMessage([], 'refusal'));
    const r = await brain.think([chat('x', 'something')]);
    expect(r.calls).toEqual([]);
    expect(ctx.store.state.entities).toHaveLength(0);
  });
});
