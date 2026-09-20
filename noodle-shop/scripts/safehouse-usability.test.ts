import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSafehouseWorld } from '../src/worlds/safehouse';
import { createInitialState, migrateState, STATE_VERSION, type SafehouseState } from '../src/worlds/safehouse/state';
import { resolveRequest, applyQuickEdit } from '../src/worlds/safehouse/edits';
import { fixtureGenerator, type DesignGenerator } from '../src/llm/blueprint';
import type { WorldCtx } from '../src/engine/world';
import { SURVIVOR_START } from '../src/shared/safehouseLayout';
function setup(generator?: DesignGenerator, fixture = true) {
  let now = 10000,
    calls = 0,
    failSave = false;
  const world = createSafehouseWorld({ seedScenery: false,
    fixture,
    workMs: 500,
    generator: async (i, s) => {
      calls++;
      return (generator ?? fixtureGenerator)(i, s);
    },
  });
  const state = world.createInitialState(now);
  const ctx: WorldCtx<SafehouseState> = {
    state,
    get now() {
      return now;
    },
    checkpoint() {
      if (failSave) throw new Error('disk full');
      world.stateSchema.parse(state);
    },
    say() {},
    log() {},
    enqueueTask: () => ({ id: '' }),
    queue: [],
    llm: { dialogue: async () => null, moderate: async () => ({ ok: false }) },
    tuning: {},
    chatRatePerMin: 0,
    rng: () => 0.5,
  };
  const stop = world.start?.(ctx);
  const step = async () => {
    now += 500;
    world.tick(ctx, 500);
    await new Promise((r) => setImmediate(r));
  };
  const finish = async () => {
    for (let i = 0; i < 200; i++) {
      await step();
      if (!state.jobs.some((j) => !['complete', 'failed'].includes(j.status))) return;
    }
    throw new Error('unfinished');
  };
  const send = async (text: string, user = 'a') => {
    now += 3500;
    await world.intents[0].handle(
      ctx,
      { id: crypto.randomUUID(), username: user, userId: user, text, ts: now, source: 'dev' },
      undefined,
    );
  };
  const action = (id: string) => world.adminActions!.find((a) => a.id === `safehouse-${id}`)!.run(ctx);
  return {
    world,
    state,
    ctx,
    step,
    finish,
    send,
    action,
    get calls() {
      return calls;
    },
    set failSave(v: boolean) {
      failSave = v;
    },
    stop: () => {
      if (stop) stop();
    },
  };
}
test('quick edits and per-user followups use zero new model calls', async () => {
  const h = setup();
  await h.send('Build tower');
  await h.finish();
  const object = h.state.objects[0];
  assert.equal(h.calls, 1);
  await h.send('Paint it red');
  await h.finish();
  assert.equal(h.calls, 1);
  assert.equal(h.state.objects[0].blueprint.parts[0].color, '#b65b50');
  await h.send('Paint it blue', 'b');
  assert.equal(h.state.jobs.length, 2);
  assert.match(h.state.notice, /Which one/);
  await h.send(`Make #${object.id.slice(0, 8)} 20% taller`, 'b');
  await h.finish();
  assert.equal(h.calls, 1);
  assert.equal(h.state.targets.find((t) => t.userId === 'b')?.objectId, object.id);
  h.stop();
});
test('ambiguous names and qualified edits never trigger incorrect recolor', async () => {
  const result = await fixtureGenerator(
    { text: 'Build tower', username: 'a', objects: [] },
    new AbortController().signal,
  );
  assert.ok('blueprint' in result);
  if (!('blueprint' in result)) return;
  const o = {
    id: 'abcdefgh-123',
    revision: 1,
    blueprint: result.blueprint,
    position: { x: 0, z: -12 },
    footprint: { width: 2.5, depth: 1.9 },
    createdBy: 'a',
    editedBy: 'a',
    createdAt: 0,
  };
  assert.ok(resolveRequest('Paint Duck-shaped watchtower red', [o, { ...o, id: 'other' }]).clarification);
  assert.equal(resolveRequest('Paint only the roof of Duck-shaped watchtower red', [o]).quick, undefined);
  assert.equal(resolveRequest('Add a ladder to it', [o], o.id).targetId, o.id);
  // Quick edits are free, so they still fail loudly instead of auto-fitting.
  assert.throws(() => applyQuickEdit(o.blueprint, { kind: 'scale', factor: 2, axis: 'all' }), /within 8m × 8m × 8m/);
});
test('pause blocks new paid requests but permits quick edits and preserves allowance', async () => {
  const h = setup(undefined, false);
  h.state.callsRemaining = 1;
  await h.send('Build tower');
  await h.finish();
  assert.equal(h.state.callsRemaining, 0);
  await h.send('Build another', 'b');
  assert.equal(h.calls, 1);
  h.action('pause');
  await h.send('Paint it blue');
  await h.finish();
  assert.equal(h.calls, 1);
  assert.equal(h.state.generationPaused, true);
  h.action('allowance');
  assert.ok(h.state.callsRemaining > 0);
  h.action('resume');
  assert.equal(h.state.generationPaused, false);
  h.stop();
});
test('v1 migration preserves objects/jobs and adds bounded defaults without resetting data', async () => {
  const h = setup();
  await h.send('Build tower');
  await h.finish();
  const old: any = structuredClone(h.state);
  old.version = 1;
  delete old.targets;
  delete old.idlePath;
  delete old.generationPaused;
  delete old.callsRemaining;
  const migrated = migrateState(old, 1);
  assert.deepEqual(migrated.objects.filter(o=>!o.fixed), h.state.objects);
  assert.deepEqual(migrated.jobs, h.state.jobs);
  assert.equal(migrated.version, STATE_VERSION);
  assert.deepEqual(migrated.targets, []);
  h.stop();
});
test('idle return reaches home and a new request interrupts from actual position', async () => {
  const h = setup();
  await h.send('Build tower');
  await h.finish();
  for (let i = 0; i < 160; i++) await h.step();
  assert.ok(
    Math.hypot(
      h.state.survivor.position.x - SURVIVOR_START.x,
      h.state.survivor.position.z - SURVIVOR_START.z,
    ) < 0.2,
  );
  assert.equal(h.state.survivor.activity, 'idle');
  await h.send('Paint it blue');
  await h.finish();
  assert.equal(h.calls, 1);
  h.stop();
});
test('prepared-design checkpoint failure recovers through current job, not detached state', async () => {
  const h = setup();
  await h.send('Build tower');
  await h.step();
  h.failSave = true;
  await assert.rejects(h.step());
  assert.equal(h.state.jobs[0].status, 'designing');
  h.failSave = false;
  await h.finish();
  assert.equal(h.state.objects.length, 1);
  assert.equal(h.calls, 1);
  h.stop();
});
test('retry creates a new bounded request and pause survives schema round-trip', async () => {
  let n = 0;
  const h = setup(async (i, s) => {
    if (++n === 1) throw new Error('down');
    return fixtureGenerator(i, s);
  });
  await h.send('Build tower');
  await h.finish();
  const id = h.state.jobs[0].id;
  for (let i = 0; i < 7; i++) await h.step();
  h.action('retry');
  await h.finish();
  assert.notEqual(h.state.jobs.at(-1)?.id, id);
  assert.equal(h.state.objects.length, 1);
  h.action('pause');
  assert.equal(h.world.stateSchema.parse(JSON.parse(JSON.stringify(h.state))).generationPaused, true);
  h.stop();
});
