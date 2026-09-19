import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSafehouseWorld } from '../src/worlds/safehouse';
import type { WorldCtx } from '../src/engine/world';
import type { SafehouseState } from '../src/worlds/safehouse/state';

test('bounded multi-job soak keeps saved state valid and completes failures', async () => {
  const world = createSafehouseWorld({ seedScenery: false,
    fixture: true,
    generator: async () => ({ action: 'reply', reply: 'Ready for your next idea.' }),
  });
  const state = world.createInitialState(0);
  let now = 10000;
  const ctx: WorldCtx<SafehouseState> = {
    state,
    get now() {
      return now;
    },
    checkpoint() {
      world.stateSchema.parse(state);
    },
    log() {},
    say() {},
    enqueueTask: () => ({ id: 'unused' }),
    queue: [],
    llm: { dialogue: async () => null, moderate: async () => ({ ok: false }) },
    tuning: {},
    chatRatePerMin: 0,
    rng: () => 0.5,
  };
  const stop = world.start?.(ctx);
  for (let i = 0; i < 1050; i++) {
    now += 4000;
    await world.intents[0].handle(
      ctx,
      { id: `m${i}`, userId: `u${i}`, username: 'visitor', text: 'Hello', source: 'dev', ts: now },
      undefined,
    );
    world.tick(ctx, 2000);
    await new Promise((resolve) => setImmediate(resolve));
    world.tick(ctx, 2000);
  }
  assert.ok(state.jobs.length <= 25);
  assert.equal(state.seen.length, 1000);
  assert.equal(state.objects.length, 0);
  assert.ok(JSON.stringify(state).length < 60000);
  world.stateSchema.parse(state);
  if (stop) stop();
});
