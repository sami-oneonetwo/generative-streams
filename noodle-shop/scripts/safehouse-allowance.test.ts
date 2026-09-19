// The AI call allowance is the operator's: enforce it, ignore it, set it to any number.
// Calls are counted either way.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { createSafehouseWorld } from '../src/worlds/safehouse';
import { fixtureGenerator } from '../src/llm/blueprint';
import { active, type SafehouseState } from '../src/worlds/safehouse/state';
import { Engine } from '../src/engine/engine';
import { createHttpServer } from '../src/server/http';
import { WsHub } from '../src/server/ws';
import { KickAuth } from '../src/kick/oauth';
import { EchoGuard } from '../src/kick/echo';
import { config } from '../src/config';
import type { WorldCtx, EngineView } from '../src/engine/world';

function harness() {
  let now = 10_000;
  const spoken: string[] = [];
  let dialogueCalls = 0;
  const world = createSafehouseWorld({ seedScenery: false, fixture: false, generator: fixtureGenerator, workMs: 500, converse: true });
  const state = world.createInitialState(now);
  const ctx: WorldCtx<SafehouseState> = {
    state,
    get now() {
      return now;
    },
    checkpoint() {
      world.stateSchema.parse(state);
    },
    log() {},
    say(text) {
      spoken.push(text);
    },
    enqueueTask: () => ({ id: 'unused' }),
    queue: [],
    llm: {
      dialogue: async () => {
        dialogueCalls++;
        return 'yeah all good';
      },
      moderate: async () => ({ ok: false }),
    },
    tuning: {},
    chatRatePerMin: 0,
    rng: () => 0.5,
  };
  const stop = world.start?.(ctx);
  async function step() {
    now += 2000;
    world.tick(ctx, 2000);
    await new Promise((r) => setImmediate(r));
  }
  async function finish() {
    for (let i = 0; i < 100 && state.jobs.some(active); i++) await step();
  }
  async function chat(text: string, user: string) {
    await world.intents[0].handle(ctx, { id: crypto.randomUUID(), userId: user, username: user, text, ts: now, source: 'dev' }, undefined);
  }
  const action = (id: string, value?: number) => world.adminActions!.find((a) => a.id === id)!.run(ctx, value);
  return { world, state, ctx, spoken, step, finish, chat, action, dialogueCalls: () => dialogueCalls, stop: () => stop?.() };
}
const engineView: EngineView = { protagonist: { x: 0, state: 'idle' }, pendingTasks: [], logLines: [], recentChat: [], chatRevision: 0, now: 0 };

test('spent and enforced, the allowance refuses designs and chat; ignoring the limit opens both and still counts', async () => {
  const h = harness();
  h.state.callsRemaining = 0;
  await h.chat('Build a duck-shaped watchtower', 'dave');
  assert.equal(h.state.jobs.length, 0);
  assert.match(h.spoken.at(-1)!, /allowance is empty/);
  await h.chat('rook you there?', 'erin');
  assert.equal(h.dialogueCalls(), 0, 'no reply call either');

  h.action('safehouse-allowance-off');
  assert.equal(h.state.allowanceEnforced, false);
  await h.chat('Build a duck-shaped watchtower', 'dave');
  await h.finish();
  assert.equal(h.state.objects.length, 1, 'the design went ahead');
  assert.equal(h.state.callsRemaining, 0, 'the counter is not driven negative');
  assert.equal(h.state.callsUsed, 1, 'but the call is counted');
  await h.chat('rook you there?', 'erin');
  assert.equal(h.dialogueCalls(), 1);
  assert.equal(h.state.callsUsed, 2);
  const scene = h.world.buildScene(h.state, engineView).safehouse!;
  assert.equal(scene.allowanceEnforced, false);
  assert.equal(scene.callsUsed, 2);
  assert.match(h.world.persona.summarizeState(h.state), /no call limit right now \(2 calls made so far\)/);

  h.action('safehouse-allowance-on');
  await h.chat('Build a scrap turret', 'fay');
  assert.equal(h.state.jobs.filter(active).length, 0, 'enforced again with nothing left: refused');
  assert.match(h.spoken.at(-1)!, /allowance is empty/);
  h.stop();
});

test('the allowance can be set to any number; a world reset keeps the switch and the count', async () => {
  const h = harness();
  h.action('safehouse-allowance-set', 250);
  assert.equal(h.state.callsRemaining, 250);
  assert.match(h.state.notice, /set to 250 calls/);
  h.action('safehouse-allowance-off');
  h.action('safehouse-allowance-set', 3);
  assert.match(h.state.notice, /not enforced right now/);
  h.state.callsUsed = 17;
  const fresh = h.world.reset!(h.state, 0);
  assert.equal(fresh.callsRemaining, 3);
  assert.equal(fresh.allowanceEnforced, false);
  assert.equal(fresh.callsUsed, 17);
  // With the limit enforced and calls left, a design spends one.
  h.action('safehouse-allowance-on');
  h.action('safehouse-allowance-set', 2);
  await h.chat('Build a duck-shaped watchtower', 'dave');
  await h.finish();
  assert.equal(h.state.callsRemaining, 1);
  assert.equal(h.state.callsUsed, 18);
  h.stop();
});

test('over HTTP the operator sends a number with the action, and bad numbers are refused', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'world-allowance-'));
  const token = config.ADMIN_TOKEN;
  config.ADMIN_TOKEN = undefined;
  const world = createSafehouseWorld({ seedScenery: false, fixture: true });
  const engine = new Engine(world, { dataDir: dir, confidenceThreshold: 0.6, flags: { devTimeScale: 1, kickRepliesEnabled: false } });
  const auth = new KickAuth(dir, () => {});
  let hub: WsHub;
  const server = createHttpServer({ engine, auth, echo: new EchoGuard(), dataDir: dir, wsClientCount: () => hub.clientCount, kickSubscription: {} });
  hub = new WsHub(server, 'safehouse');
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  const post = (body: unknown) =>
    fetch(`http://127.0.0.1:${port}/admin/api/action`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  try {
    const status = (await (await fetch(`http://127.0.0.1:${port}/admin/api/status`)).json()) as {
      adminActions: { id: string; input?: { min?: number; max?: number } }[];
      safehouse: { allowanceEnforced: boolean; callsUsed: number; callsRemaining: number };
    };
    const setAction = status.adminActions.find((a) => a.id === 'safehouse-allowance-set')!;
    assert.deepEqual([setAction.input?.min, setAction.input?.max], [0, 1_000_000], "the field's bounds travel with the action");
    assert.equal(status.safehouse.allowanceEnforced, true);
    assert.equal(status.safehouse.callsUsed, 0);
    assert.equal((await post({ id: 'safehouse-allowance-set', value: 42 })).status, 200);
    assert.equal((engine.state as SafehouseState).callsRemaining, 42);
    assert.equal((await post({ id: 'safehouse-allowance-set', value: -3 })).status, 400);
    assert.equal((await post({ id: 'safehouse-allowance-set', value: 'lots' })).status, 400);
    assert.equal((await post({ id: 'safehouse-allowance-set' })).status, 400);
    assert.equal((engine.state as SafehouseState).callsRemaining, 42, 'refused values change nothing');
    assert.equal((await post({ id: 'safehouse-allowance-off' })).status, 200);
    const after = (await (await fetch(`http://127.0.0.1:${port}/admin/api/status`)).json()) as { safehouse: { allowanceEnforced: boolean } };
    assert.equal(after.safehouse.allowanceEnforced, false);
  } finally {
    engine.stop();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    config.ADMIN_TOKEN = token;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
