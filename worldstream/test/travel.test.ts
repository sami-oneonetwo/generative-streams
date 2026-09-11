import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { IncomingChat } from '../src/server/ingest.js';
import { runCommand, type InterpreterContext } from '../src/server/interpreter.js';
import { Policy } from '../src/server/policy.js';
import { Store } from '../src/server/store.js';
import type { Catalogue } from '../src/shared/catalogue.js';
import { parseCommand } from '../src/shared/commands.js';
import { ConfigSchema } from '../src/shared/config.js';
import { apply, initialState, TRANSITION_MS } from '../src/shared/state.js';

const root = new URL('..', import.meta.url);
const cyber = JSON.parse(readFileSync(new URL('assets/worlds/cyberpunk/catalogue.json', root), 'utf8')) as Catalogue;
const desert = JSON.parse(readFileSync(new URL('assets/worlds/desert/catalogue.json', root), 'utf8')) as Catalogue;
const baseCfg = JSON.parse(readFileSync(new URL('config/world.config.json', root), 'utf8'));

function makeCtx(needed = 2): { ctx: InterpreterContext; store: Store } {
  const cfg = ConfigSchema.parse({ ...baseCfg, votes: { worldChangeVoters: needed, windowMs: 60_000 } });
  const store = new Store(mkdtempSync(join(tmpdir(), 'ws-')), 'cyberpunk');
  const worlds: Record<string, Catalogue> = { cyberpunk: cyber, desert };
  const ctx: InterpreterContext = {
    store,
    policy: new Policy(cfg),
    cfg,
    get catalogue() {
      return worlds[store.state.world];
    },
  };
  return { ctx, store };
}

const chat = (name: string, content: string, badges: string[] = []): IncomingChat => ({
  id: name + content, user: { id: `u:${name}`, name, badges }, content, at: Date.now(), source: 'mock',
});
const run = (ctx: InterpreterContext, msg: IncomingChat) => runCommand(parseCommand(msg.content)!, msg, ctx);

describe('reducer: votes and transitions', () => {
  it('opens and closes votes, and a departure clears the vote', () => {
    let s = initialState('cyberpunk');
    s = apply(s, { type: 'set_vote', vote: { to: 'desert', count: 1, needed: 3, until: 5 } });
    expect(s.vote?.count).toBe(1);
    const same = apply(s, { type: 'set_vote', vote: undefined });
    expect(same.vote).toBeUndefined();
    s = apply(s, { type: 'begin_transition', to: 'desert', at: 10, durationMs: 500 });
    expect(s.transition).toEqual({ to: 'desert', startedAt: 10, durationMs: 500 });
    expect(s.vote).toBeUndefined();
    expect(apply(s, { type: 'begin_transition', to: 'castle', at: 11, durationMs: 1 })).toBe(s);
    expect(apply(s, { type: 'end_transition' }).transition).toBeUndefined();
    expect(apply(initialState('desert'), { type: 'begin_transition', to: 'desert', at: 1, durationMs: 1 }).transition).toBeUndefined();
  });
});

describe('travel commands', () => {
  it('a viewer opens a vote, another viewer completes it, and the departure ride appears', () => {
    const { ctx, store } = makeCtx(2);
    const r1 = run(ctx, chat('alice', '!world desert'));
    expect(r1.applied).toBe(true);
    expect(store.state.vote).toMatchObject({ to: 'desert', count: 1, needed: 2 });
    expect(run(ctx, chat('alice', '!vote')).applied).toBe(false); // already counted
    expect(run(ctx, chat('bob', '!world castle')).applied).toBe(false); // a different vote is open
    const r2 = run(ctx, chat('bob', '!vote'));
    expect(r2.applied).toBe(true);
    expect(store.state.transition).toMatchObject({ to: 'desert', durationMs: TRANSITION_MS });
    expect(store.state.vote).toBeUndefined();
    expect(store.state.entities.some((e) => e.sprite === 'train' && e.motion)).toBe(true);
    expect(store.state.character.mode).toBe('travel');
    expect(store.state.character.targetX).toBeGreaterThan(store.state.camera.x + 480);
    expect(run(ctx, chat('carol', '!world castle')).reply).toContain('already on the move');
  });

  it('moderators travel immediately, and you cannot travel to where you are', () => {
    const { ctx, store } = makeCtx(5);
    expect(run(ctx, chat('mod', '!world cyberpunk', ['moderator'])).applied).toBe(false);
    expect(run(ctx, chat('mod', '!world desert', ['moderator'])).applied).toBe(true);
    expect(store.state.transition?.to).toBe('desert');
  });

  it('arriving swaps the world state and keeps the character', () => {
    const { ctx, store } = makeCtx(1);
    run(ctx, chat('mod', '!add cat', ['moderator']));
    const v = store.state.version;
    run(ctx, chat('mod', '!world desert', ['moderator']));
    store.switchWorld('desert');
    expect(store.state.world).toBe('desert');
    expect(store.state.entities).toHaveLength(0);
    expect(store.state.transition).toBeUndefined();
    expect(store.state.version).toBeGreaterThan(v);
    expect(store.state.character.mode).toBe('walk');
    expect(store.state.weather).toBe('clear');
    // and the city is still there when we come back
    store.switchWorld('cyberpunk');
    expect(store.state.entities.map((e) => e.sprite)).toContain('cat');
    // desert catalogue now drives commands
    expect(ctx.catalogue.world).toBe('cyberpunk');
    store.switchWorld('desert');
    expect(run(ctx, chat('kai', '!add cactus')).applied).toBe(true);
    expect(run(ctx, chat('kai', '!add neon sign', ['moderator'])).applied).toBe(true); // alias lands on the wood sign
    expect(store.state.entities.map((e) => e.sprite)).toContain('wood_sign');
  });
});
