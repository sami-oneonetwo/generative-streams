import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { stepBehaviours } from '../src/server/behaviours.js';
import { detectAnswer } from '../src/server/host/detectors.js';
import { Host } from '../src/server/host/engine.js';
import { buildHooks, type Hook } from '../src/server/host/hooks.js';
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

function setup(hooks: Hook[], opts: { rnd?: () => number } = {}) {
  const cfg = ConfigSchema.parse({ ...baseCfg, host: { ...baseCfg.host, mode: 'full' } });
  const dir = mkdtempSync(join(tmpdir(), 'ws-'));
  const store = new Store(dir, 'cyberpunk');
  const ctx: InterpreterContext = { store, policy: new Policy(cfg), catalogue, cfg };
  const profiles = new Profiles(join(dir, 'viewers.json'));
  let now = 1_000_000_000_000;
  const said: string[] = [];
  const host = new Host({ ctx, cfg, profiles, brain: null, say: (t) => said.push(t), hooks, arcs: [], now: () => now, rnd: opts.rnd ?? (() => 0.5) });
  const advance = (ms: number) => { now += ms; };
  const chat = (name: string, content: string, badges: string[] = []): IncomingChat => ({ id: `${name}-${now}`, user: { id: `u:${name}`, name, badges }, content, at: now, source: 'mock' });
  const send = (msg: IncomingChat) => { const cmd = parseCommand(msg.content); const outcome = cmd ? runCommand(cmd, msg, ctx) : { applied: false }; return host.observe(msg, cmd, outcome); };
  return { cfg, store, ctx, profiles, host, said, advance, chat, send, now: () => now };
}

describe('answer detection', () => {
  const msg = (content: string): IncomingChat => ({ id: '1', user: { id: 'u:a', name: 'a', badges: [] }, content, at: 0, source: 'mock' });
  it('reads choices, yes/no and names from plain chat', () => {
    expect(detectAnswer({ type: 'choice', options: ['left', 'right'] }, msg('go LEFT!'), null, null, catalogue)).toEqual({ matched: true, value: 'left' });
    expect(detectAnswer({ type: 'choice', options: ['left', 'right'] }, msg('lefty loosey'), null, null, catalogue).matched).toBe(false);
    expect(detectAnswer({ type: 'yesno' }, msg('yeah go'), null, null, catalogue).value).toBe('yes');
    expect(detectAnswer({ type: 'yesno' }, msg('nah'), null, null, catalogue).value).toBe('no');
    expect(detectAnswer({ type: 'name' }, msg('Mochi'), null, null, catalogue)).toEqual({ matched: true, value: 'Mochi' });
    expect(detectAnswer({ type: 'name' }, msg('lol'), null, null, catalogue).matched).toBe(false);
    expect(detectAnswer({ type: 'name' }, msg('call her sir pounce a lot'), null, null, catalogue).matched).toBe(false);
  });
  it('recognises the right command with the right tags', () => {
    const cmd = parseCommand('!add street lamp')!;
    expect(detectAnswer({ type: 'command', kind: 'add', tags: ['light'] }, msg('!add street lamp'), cmd, { applied: true }, catalogue)).toEqual({ matched: true, value: 'street_lamp' });
    expect(detectAnswer({ type: 'command', kind: 'add', tags: ['light'] }, msg('!add cat'), parseCommand('!add cat')!, { applied: true }, catalogue).matched).toBe(false);
    expect(detectAnswer({ type: 'command', kind: 'add', tags: ['light'] }, msg('!add street lamp'), cmd, { applied: false }, catalogue).matched).toBe(false);
    expect(detectAnswer({ type: 'command', kind: 'sign' }, msg('!sign "HELLO"'), parseCommand('!sign "HELLO"')!, { applied: true }, catalogue)).toEqual({ matched: true, value: 'HELLO' });
  });
});

describe('host loop', () => {
  it('asks, hears the answer, acts, thanks by name, then follows up sooner', async () => {
    const hooks = buildHooks().filter((h) => h.id === 'pick_direction');
    const t = setup(hooks);
    t.advance(25_000);
    await t.host.tick();
    expect(t.said).toHaveLength(1);
    expect(t.store.state.host?.ask?.text).toContain('left or right');
    expect(t.send(t.chat('kai', 'hmm'))).toBe(false);
    expect(t.send(t.chat('kai', 'RIGHT'))).toBe(true);
    await new Promise((r) => setTimeout(r, 0));
    expect(t.said[1]).toContain('kai');
    expect(t.store.state.host?.ask).toBeUndefined();
    expect(t.store.state.character.targetX).toBeGreaterThan(300);
    const status = t.host.status() as { nextOutreachInS: number };
    expect(status.nextOutreachInS).toBeLessThanOrEqual(t.cfg.host.followUpCadenceMs / 1000 * 1.2);
  });

  it('closes an unanswered ask with a line and greets a newcomer', async () => {
    const hooks = buildHooks().filter((h) => h.id === 'pick_direction');
    const t = setup(hooks);
    t.send(t.chat('newbie', 'hello?'));
    expect(t.said[0]).toContain('newbie');
    t.advance(30_000);
    await t.host.tick();
    expect(t.store.state.host?.ask).toBeDefined();
    t.advance(60_000);
    await t.host.tick();
    expect(t.store.state.host?.ask).toBeUndefined();
    expect(t.said.at(-1)).toMatch(/takers|decide/);
  });

  it('collects votes and applies the majority', async () => {
    const hooks = buildHooks().filter((h) => h.id === 'weather_vote');
    const t = setup(hooks);
    t.advance(25_000);
    await t.host.tick();
    t.send(t.chat('a', 'fog please'));
    t.send(t.chat('b', 'FOG'));
    t.send(t.chat('c', 'storm'));
    t.send(t.chat('a', 'storm')); // second answer from the same person is ignored
    t.advance(61_000);
    await t.host.tick();
    expect(t.store.state.weather).toBe('fog');
    expect(t.said.at(-1)).toContain('fog');
  });

  it('a command answer both runs and satisfies the ask; a name labels the thing', async () => {
    const hooks = buildHooks().filter((h) => h.id === 'need_light' || h.id === 'name_this');
    const t = setup(hooks, { rnd: () => 0.01 }); // low roll picks the first candidate hook
    t.store.dispatch({ type: 'set_time', time: 23 });
    t.advance(25_000);
    await t.host.tick();
    expect(t.store.state.host?.ask?.hint).toMatch(/SAY/);
    expect(t.send(t.chat('kai', '!add street lamp'))).toBe(false); // commands are never swallowed
    await new Promise((r) => setTimeout(r, 0));
    expect(t.store.state.entities.some((e) => e.sprite === 'street_lamp')).toBe(true);
    expect(t.said.at(-1)).toContain('kai');
    // now something to name
    t.send(t.chat('mod', '!add cat', ['moderator']));
    t.advance(60_000);
    await t.host.tick();
    expect(t.store.state.host?.ask?.text).toMatch(/name/);
    t.send(t.chat('kai', 'Mochi'));
    await new Promise((r) => setTimeout(r, 0));
    expect(t.store.state.entities.find((e) => e.sprite === 'cat')?.label).toBe('Mochi');
    expect(t.profiles.get('u:kai')?.named).toContain('Mochi');
    // and the label works as a target for commands
    expect(runCommand(parseCommand('!remove mochi')!, t.chat('mod', '!remove mochi', ['moderator']), t.ctx).applied).toBe(true);
  });
});

describe('host with the model in the loop', () => {
  it('counts an add the model made for a viewer as the answer and hands the line to the host', () => {
    const hooks = buildHooks().filter((h) => h.id === 'need_light');
    const t = setup(hooks);
    t.store.dispatch({ type: 'set_time', time: 23 });
    t.advance(25_000);
    return t.host.tick().then(() => {
      expect(t.host.hasOpenAsk).toBe(true);
      expect(t.host.context()).toContain('add it for them');
      const msg = t.chat('kai', 'here, have a lamp');
      expect(t.send(msg)).toBe(false); // plain text is not a direct answer to a command ask
      const cmd = parseCommand('!add street lamp')!;
      const outcome = runCommand(cmd, msg, { ...t.ctx, silent: true });
      expect(t.host.noteCommand(msg, cmd, outcome)).toBe(true);
      expect(t.host.hasOpenAsk).toBe(false);
      expect(t.profiles.get('u:kai')?.adds).toBe(1);
    });
  });
});

describe('behaviours', () => {
  it('rats flee the character, wanderers move, motion settles', () => {
    const cfg = ConfigSchema.parse(baseCfg);
    const store = new Store(mkdtempSync(join(tmpdir(), 'ws-')), 'cyberpunk');
    const ctx: InterpreterContext = { store, policy: new Policy(cfg), catalogue, cfg };
    const mod: IncomingChat = { id: 'm', user: { id: 'u:m', name: 'mod', badges: ['moderator'] }, content: '', at: 1000, source: 'mock' };
    runCommand({ kind: 'add', sprite: 'rat', position: 'centre' }, mod, ctx);
    const rat = store.state.entities.find((e) => e.sprite === 'rat')!;
    store.dispatch({ type: 'set_character', patch: { x: rat.x + 4 } });
    stepBehaviours(store, catalogue, 2000, () => 0.9);
    const moving = store.state.entities.find((e) => e.sprite === 'rat')!;
    expect(moving.motion).toBeDefined();
    expect(Math.abs(moving.motion!.toX - store.state.character.x)).toBeGreaterThan(30);
    stepBehaviours(store, catalogue, moving.motion!.endAt + 1, () => 0.9);
    const settled = store.state.entities.find((e) => e.sprite === 'rat')!;
    expect(settled.motion).toBeUndefined();
    expect(settled.x).toBe(moving.motion!.toX);
  });

  it('followers close the gap and talkers speak when the character is near', () => {
    const cfg = ConfigSchema.parse(baseCfg);
    const store = new Store(mkdtempSync(join(tmpdir(), 'ws-')), 'cyberpunk');
    const ctx: InterpreterContext = { store, policy: new Policy(cfg), catalogue, cfg };
    const mod: IncomingChat = { id: 'm', user: { id: 'u:m', name: 'mod', badges: ['moderator'] }, content: '', at: 1000, source: 'mock' };
    runCommand({ kind: 'add', sprite: 'cat', position: 'left' }, mod, ctx);
    runCommand({ kind: 'add', sprite: 'robot', position: 'right' }, mod, ctx);
    const cat = store.state.entities.find((e) => e.sprite === 'cat')!;
    const robot = store.state.entities.find((e) => e.sprite === 'robot')!;
    store.dispatch({ type: 'set_follow', id: cat.id, follow: true });
    store.dispatch({ type: 'set_character', patch: { x: robot.x + 6, bubble: undefined } });
    stepBehaviours(store, catalogue, 5000, () => 0.01);
    const s = store.state;
    expect(s.entities.find((e) => e.sprite === 'cat')!.motion).toBeDefined();
    expect(s.entities.find((e) => e.sprite === 'robot')!.say?.text).toBeDefined();
  });
});
