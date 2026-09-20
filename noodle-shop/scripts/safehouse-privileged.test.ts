// Trusted chatters: the operator names them in the admin dashboard ("Trust a chatter"). They may
// `!delete <name>`, which the operator's undo reverses, and their designs are never cut off by the
// 90 s call timeout or the 95 s world deadline.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSafehouseWorld, type SafehouseOptions } from '../src/worlds/safehouse';
import { fixtureGenerator, type DesignGenerator, type DesignInput } from '../src/llm/blueprint';
import { chatCompletion } from '../src/llm/openrouter';
import { active, stateSchema, type SafehouseState } from '../src/worlds/safehouse/state';
import { HOUSE_ID } from '../src/shared/safehouseLayout';
import { config } from '../src/config';
import type { WorldCtx } from '../src/engine/world';

function harness(options: SafehouseOptions = {}) {
  let now = 10_000;
  const spoken: string[] = [];
  const world = createSafehouseWorld({
    seedScenery: false,
    fixture: false,
    generator: fixtureGenerator,
    workMs: 500,
    converse: false,
    neighbours: false,
    ...options,
  });
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
      dialogue: async () => 'yeah all good',
      moderate: async () => ({ ok: false }),
    },
    tuning: {},
    chatRatePerMin: 0,
    rng: () => 0.5,
  };
  const stop = world.start?.(ctx);
  async function step(ms = 2000) {
    now += ms;
    world.tick(ctx, ms);
    await new Promise((r) => setImmediate(r));
  }
  async function finish() {
    for (let i = 0; i < 100 && state.jobs.some(active); i++) await step();
  }
  async function chat(text: string, user: string) {
    await world.intents[0].handle(
      ctx,
      { id: crypto.randomUUID(), userId: user.toLowerCase(), username: user, text, ts: now, source: 'dev' },
      undefined,
    );
  }
  const action = (id: string, value?: number | string) =>
    world.adminActions!.find((a) => a.id === id)!.run(ctx, value);
  return { world, state, ctx, spoken, step, finish, chat, action, stop: () => stop?.() };
}

test('the operator trusts a chatter by name; only they may !delete, and undo puts the piece back', async () => {
  const h = harness();
  try {
    await h.chat('Build a duck-shaped watchtower', 'dave');
    await h.finish();
    const tower = h.state.objects.find((o) => !o.fixed);
    assert.ok(tower, 'the tower stands');

    await h.chat('!delete the duck-shaped watchtower', 'Erin');
    assert.ok(h.state.objects.some((o) => o.id === tower.id), 'an ordinary chatter cannot delete');
    assert.match(h.spoken.at(-1)!, /trusted/);

    h.action('safehouse-trust', ' Erin ');
    assert.deepEqual(h.state.privileged, ['erin'], 'stored lowercased and trimmed');
    stateSchema.parse(h.state);
    h.action('safehouse-trust', 'erin');
    assert.deepEqual(h.state.privileged, ['erin'], 'no duplicates');

    await h.chat('!delete', 'erin');
    assert.match(h.spoken.at(-1)!, /!delete <name>/);

    await h.chat('!delete the duck-shaped watchtower', 'Erin');
    assert.ok(!h.state.objects.some((o) => o.id === tower.id), 'gone');
    assert.match(h.spoken.at(-1)!, /Removed Duck-shaped watchtower for Erin/);
    const record = h.state.edits.at(-1)!;
    assert.equal(record.removed, true);
    assert.equal(record.previous?.id, tower.id);
    assert.equal(h.state.targets.some((t) => t.objectId === tower.id), false, 'nobody still targets it');

    h.action('safehouse-undo');
    const back = h.state.objects.find((o) => o.id === tower.id);
    assert.ok(back, 'undo restores it');
    assert.equal(back.revision, tower.revision + 1);
    assert.deepEqual(back.blueprint, tower.blueprint);
    assert.equal(h.state.edits.some((e) => e.removed), false);
    assert.match(h.spoken.at(-1)!, /Put Duck-shaped watchtower back/);

    h.action('safehouse-untrust', 'ERIN');
    assert.deepEqual(h.state.privileged, []);
    await h.chat('!delete the duck-shaped watchtower', 'erin');
    assert.ok(h.state.objects.some((o) => o.id === tower.id), 'privilege revoked');

    // A reset keeps the operator's list, like the other operator settings.
    h.action('safehouse-trust', 'erin');
    const fresh = h.world.reset!(h.state, h.ctx.now);
    assert.deepEqual(fresh.privileged, ['erin']);
  } finally {
    h.stop();
  }
});

test('the houses cannot be deleted, even by a trusted chatter', async () => {
  const h = harness({ seedScenery: true });
  try {
    h.action('safehouse-trust', 'erin');
    await h.chat('!delete the house', 'erin');
    assert.ok(h.state.objects.some((o) => o.id === HOUSE_ID), 'the house stands');
    assert.match(h.spoken.at(-1)!, /stays/);
  } finally {
    h.stop();
  }
});

test("a trusted chatter's design has no deadline; everyone else's is cut off at 95 s", async () => {
  const seen: DesignInput[] = [];
  const signals: AbortSignal[] = [];
  const generator: DesignGenerator = (input, signal) => {
    seen.push(input);
    signals.push(signal);
    return new Promise(() => {}); // the model never answers
  };
  const h = harness({ generator });
  try {
    await h.chat('Build a tower', 'dave');
    await h.step();
    assert.equal(h.state.jobs.at(-1)!.status, 'designing');
    assert.equal(seen[0].noTimeout, undefined);
    for (let i = 0; i < 50; i++) await h.step(); // 100 s
    assert.equal(h.state.jobs.at(-1)!.status, 'failed');
    assert.match(h.state.jobs.at(-1)!.error!, /timed out/);
    assert.equal(signals[0].aborted, true);

    h.action('safehouse-trust', 'erin');
    await h.chat('Build a tower', 'erin');
    await h.step();
    assert.equal(h.state.jobs.at(-1)!.status, 'designing');
    assert.equal(seen[1].noTimeout, true);
    assert.match(h.state.notice, /no time limit/);
    for (let i = 0; i < 300; i++) await h.step(); // ten minutes
    assert.equal(h.state.jobs.at(-1)!.status, 'designing', 'still waiting on the model');
    assert.equal(signals[1].aborted, false);
  } finally {
    h.stop();
  }
});

test('chatCompletion sets no abort timer for a non-finite timeout, and still does for a finite one', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const originalFetch = globalThis.fetch;
  const originalKey = config.OPENROUTER_API_KEY;
  config.OPENROUTER_API_KEY = 'fixture-not-a-real-key';
  let signal: AbortSignal | undefined;
  let answer: ((r: Response) => void) | undefined;
  try {
    globalThis.fetch = (_url, init) =>
      new Promise<Response>((resolve, reject) => {
        signal = init?.signal ?? undefined;
        answer = resolve;
        init?.signal?.addEventListener('abort', () => reject(new DOMException('This operation was aborted', 'AbortError')));
      });
    const open = chatCompletion({ model: 'fixture', messages: [], attempts: 1, timeoutMs: Infinity });
    await new Promise((r) => setImmediate(r));
    t.mock.timers.tick(60 * 60 * 1000);
    assert.equal(signal?.aborted, false, 'an hour on, the request is still open');
    answer!(new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), { status: 200 }));
    assert.equal(await open, 'ok');

    const bounded = chatCompletion({ model: 'fixture', messages: [], attempts: 1, timeoutMs: 1000 });
    await new Promise((r) => setImmediate(r));
    t.mock.timers.tick(1500);
    assert.equal(signal?.aborted, true, 'the finite timeout still aborts');
    await assert.rejects(bounded, /abort/i);
  } finally {
    globalThis.fetch = originalFetch;
    config.OPENROUTER_API_KEY = originalKey;
  }
});
