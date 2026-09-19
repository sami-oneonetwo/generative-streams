import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSafehouseWorld } from '../src/worlds/safehouse';
import { type SafehouseState } from '../src/worlds/safehouse/state';
import { fixtureGenerator, type DesignGenerator } from '../src/llm/blueprint';
import {
  validateResponse,
  measureBlueprint,
  blueprintBounds,
  normalizeColor,
  FALLBACK_COLOR,
} from '../src/worlds/safehouse/blueprint';
import type { WorldCtx, ChatMessage } from '../src/engine/world';
import { choosePlacement, route, straighten } from '../src/worlds/safehouse/placement';
import { sceneryObjects } from '../src/worlds/safehouse/scenery';
function harness(generator: DesignGenerator = fixtureGenerator, loaded?: SafehouseState) {
  let now = 10000,
    saves = 0,
    saveFails = false;
  const world = createSafehouseWorld({ seedScenery: false, fixture: true, generator, workMs: 2000 });
  const state = loaded ?? world.createInitialState(now);
  const ctx: WorldCtx<SafehouseState> = {
    state,
    get now() {
      return now;
    },
    checkpoint() {
      if (saveFails) throw new Error('disk full');
      saves++;
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
  async function step() {
    now += 2000;
    world.tick(ctx, 2000);
    await new Promise((resolve) => setImmediate(resolve));
  }
  async function finish() {
    for (let i = 0; i < 100; i++) {
      await step();
      if (!state.jobs.some((j) => !['complete', 'failed'].includes(j.status))) return;
    }
    throw new Error('queue did not finish');
  }
  async function send(text: string, user = 'a', id: string = crypto.randomUUID()) {
    const msg: ChatMessage = { id, userId: user, username: user, text, source: 'dev', ts: now };
    await world.intents[0].handle(ctx, msg, undefined);
  }
  return {
    world,
    state,
    ctx,
    step,
    finish,
    send,
    stop: () => {
      if (stop) stop();
    },
    get saves() {
      return saves;
    },
    set saveFails(v: boolean) {
      saveFails = v;
    },
  };
}
test('novel primitive fixture builds, shared edit preserves authorship, undo restores', async () => {
  const h = harness();
  await h.send('Build a duck-shaped watchtower');
  await h.finish();
  assert.equal(h.state.objects.length, 1);
  const first = structuredClone(h.state.objects[0]);
  assert.equal(first.blueprint.parts.length, 10);
  await h.send(`Make ${first.blueprint.name} pink`, 'b');
  await h.finish();
  const edited = h.state.objects[0];
  assert.equal(edited.createdBy, 'a');
  assert.equal(edited.editedBy, 'b');
  assert.equal(edited.revision, 2);
  assert.equal(edited.blueprint.parts[0].color, '#cb8b91');
  h.world.adminActions!.find((a) => a.id === 'safehouse-undo')!.run(h.ctx);
  assert.deepEqual(h.state.objects[0].blueprint, first.blueprint);
  assert.equal(h.state.objects[0].revision, 3);
  assert.ok(h.saves > 5);
  h.stop();
});
test('admission checkpoint failure rolls back and cannot acknowledge a queued job', async () => {
  const h = harness();
  h.saveFails = true;
  await h.send('Build a tower');
  assert.equal(h.state.jobs.length, 0);
  assert.equal(h.state.seen.length, 0);
  h.stop();
});
test('duplicate input, public deletion and per-user outstanding limits', async () => {
  const h = harness();
  await h.send('Build a tower', 'a', 'same');
  await h.send('Build a tower', 'a', 'same');
  await h.send('Build another tower', 'a');
  assert.equal(h.state.jobs.length, 1);
  await h.send('Delete everything', 'b');
  assert.equal(h.state.jobs.length, 1);
  h.stop();
});
test('failed generator releases queue and never substitutes a fixture', async () => {
  let count = 0;
  const h = harness(async (i, s) => {
    if (++count === 1) throw new Error('provider unavailable');
    return fixtureGenerator(i, s);
  });
  await h.send('Build a tower', 'a');
  await h.send('Build a duck', 'b');
  await h.finish();
  assert.equal(h.state.jobs[0].status, 'failed');
  assert.equal(h.state.objects.length, 1);
  h.stop();
});
test('walking/building saves recover without a second generation call', async () => {
  let calls = 0;
  const g: DesignGenerator = async (i, s) => {
    calls++;
    return fixtureGenerator(i, s);
  };
  const h = harness(g);
  await h.send('Build a duck');
  await h.step();
  await h.step();
  assert.equal(h.state.jobs[0].status, 'walking');
  const saved = h.world.stateSchema.parse(JSON.parse(JSON.stringify(h.state)));
  h.stop();
  const restored = harness(g, saved);
  await restored.finish();
  assert.equal(calls, 1);
  assert.equal(restored.state.objects.length, 1);
  restored.stop();
});
test('schema rejects nonfinite geometry, excess parts, rotated underground and oversize', async () => {
  const result = await fixtureGenerator(
    { text: 'Build duck', username: 'a', objects: [] },
    new AbortController().signal,
  );
  assert.ok('blueprint' in result);
  if (!('blueprint' in result)) return;
  const invalid = structuredClone(result);
  invalid.blueprint.parts[0].size[0] = Infinity;
  assert.throws(() => validateResponse(invalid));
  const huge = structuredClone(result);
  huge.blueprint.parts = [
    { ...result.blueprint.parts[0], size: [12, 2, 12], position: [-12, 1, -12] },
    { ...result.blueprint.parts[0], size: [12, 2, 12], position: [12, 1, 12] },
  ];
  assert.throws(() => validateResponse(huge), /came out .*the limit is 8m × 8m × 8m/);
  const many = structuredClone(result);
  many.blueprint.parts = Array(101).fill(result.blueprint.parts[0]);
  assert.throws(() => validateResponse(many));
  const low = structuredClone(result);
  low.blueprint.parts[0].position[1] = -2;
  assert.throws(() => measureBlueprint(low.blueprint));
});
// A paid design that is merely too big, off-centre or drawn below ground is
// fitted rather than thrown away; chat used to see only a generic failure.
test('oversized, off-centre and sunken designs are fitted instead of rejected', () => {
  const part = (position: [number, number, number], size: [number, number, number]) => ({
    shape: 'box' as const,
    position,
    size,
    rotation: [0, 0, 0] as [number, number, number],
    color: '#8a5a3c',
  });
  // A truck: 11 m long, wheels half sunk, and everything drawn to one side of the origin.
  const truck = {
    action: 'build' as const,
    reply: 'A burning truck coming up.',
    blueprint: {
      name: 'Burning truck',
      description: 'Long truck on fire',
      parts: [part([5.5, 1.5, 0], [11, 3, 2.5]), part([1, 0, 0], [1, 1, 1]), part([10, 0, 0], [1, 1, 1])],
    },
  };
  const fitted = validateResponse(truck);
  assert.ok('blueprint' in fitted);
  if (!('blueprint' in fitted)) return;
  const size = measureBlueprint(fitted.blueprint);
  assert.ok(size.width <= 8 && size.depth <= 8, `fits after scaling: ${JSON.stringify(size)}`);
  assert.ok(size.width > 7.9, 'scaled to the limit, not further');
  const bounds = blueprintBounds(fitted.blueprint);
  assert.ok(Math.abs(bounds.minX + bounds.maxX) < 0.01, 'recentred over the origin');
  assert.ok(bounds.minY >= -0.001, 'lifted onto the ground');
  assert.match(fitted.reply, /lifted onto the ground, scaled to \d+% to fit/);
  // A role tucked inside the blueprint (the model's habit) is hoisted, not rejected.
  const nested = validateResponse({
    ...truck,
    blueprint: { ...truck.blueprint, parts: [part([0, 0.5, 0], [2, 1, 2])], role: 'turret' },
  });
  assert.ok('blueprint' in nested && nested.action === 'build' && nested.role === 'turret');
  assert.ok('blueprint' in nested && !('role' in nested.blueprint));
  const nestedEdit = validateResponse({
    action: 'edit',
    targetId: 'x',
    reply: 'ok',
    blueprint: { ...truck.blueprint, parts: [part([0, 0.5, 0], [2, 1, 2])], role: 'barrier' },
  });
  assert.ok('blueprint' in nestedEdit && !('role' in nestedEdit.blueprint));
  // Already within limits: untouched, no note.
  const small = { ...truck, blueprint: { ...truck.blueprint, parts: [part([0, 0.5, 0], [2, 1, 2])] } };
  const same = validateResponse(small);
  assert.ok('blueprint' in same && same.reply === truck.reply);
  assert.deepEqual('blueprint' in same && same.blueprint, small.blueprint);
  // Wildly oversized designs are refused with the numbers rather than shrunk to a toy.
  const stadium = { ...truck, blueprint: { ...truck.blueprint, parts: [part([0, 4, 0], [12, 8, 12]), part([12, 4, 12], [12, 8, 12])] } };
  assert.throws(() => validateResponse(stadium), /24\.0m × 24\.0m × 8\.0m; the limit is 8m × 8m × 8m/);
});
// Formatting slips in an otherwise good design must not cost the paid call:
// the fifth live request died on one part coloured `orange`.
test('model formatting slips are normalised: colours, shape synonyms, degrees, extras, casing', () => {
  const loose = {
    action: 'Build',
    reply: 'A burning truck.',
    placement: 'street',
    blueprint: {
      name: 'Burning truck',
      description: 'x'.repeat(300),
      role: 'Barrier',
      parts: [
        { shape: 'cube', position: [0, 1, 0], size: [4, 2, 2], rotation: [0, 0, 0], color: 'orange', material: 'steel' },
        { shape: 'Cylinder', position: { x: 1.5, y: 0.5, z: 1 }, size: { width: 1, height: 0.4, depth: 1 }, rotation: [90, 0, 0], color: '#333' },
        { type: 'cone', position: ['0', '2.5', '0'], size: 1, color: 'rgb(255, 90, 31)' },
        // z-extents balance the wheel/plate (+1.5) so the build is not recentred and positions compare exactly
        { shape: 'sphere', position: [0, 2, -1.1], size: [0.8, 0.8, 0.8], rotation: [0, 0, 0], color: '#ff6a13cc' },
        { shape: 'box', position: [0, 0.2, 1], size: [1, 0.2, 1], rotation: [0, 0, 0], color: 'not a colour' },
      ],
    },
  };
  const result = validateResponse(loose);
  assert.ok('blueprint' in result && result.action === 'build');
  if (!('blueprint' in result) || result.action !== 'build') return;
  assert.equal(result.role, 'barrier');
  assert.equal(result.blueprint.description.length, 240);
  assert.ok(!('placement' in result) && !('role' in result.blueprint) && !('material' in result.blueprint.parts[0]));
  const [truck, wheel, flame, ember, plate] = result.blueprint.parts;
  assert.equal(truck.color, '#ffa500');
  assert.equal(wheel.shape, 'cylinder');
  assert.deepEqual(wheel.position, [1.5, 0.5, 1]);
  assert.deepEqual(wheel.size, [1, 0.4, 1]);
  assert.ok(Math.abs(wheel.rotation[0] - Math.PI / 2) < 1e-9, 'degrees converted to radians');
  assert.equal(wheel.color, '#333333');
  assert.equal(flame.shape, 'cone');
  assert.deepEqual(flame.position, [0, 2.5, 0]);
  assert.deepEqual(flame.size, [1, 1, 1]);
  assert.deepEqual(flame.rotation, [0, 0, 0]);
  assert.equal(flame.color, '#ff5a1f');
  assert.equal(ember.color, '#ff6a13', 'alpha dropped');
  assert.equal(plate.color, FALLBACK_COLOR);
  assert.equal(normalizeColor('Dark Slate Gray'), '#2f4f4f');
  assert.equal(normalizeColor('0xFF0000'), '#ff0000');
  // Real problems still fail: a shape we cannot draw, a missing position.
  assert.throws(() => validateResponse({ ...loose, blueprint: { ...loose.blueprint, parts: [{ shape: 'torus', position: [0, 1, 0], size: [1, 1, 1], color: 'red' }] } }));
  assert.throws(() => validateResponse({ ...loose, blueprint: { ...loose.blueprint, parts: [{ shape: 'box', size: [1, 1, 1], color: 'red' }] } }));
});
test('placement respects structures, other creations and reserves a reachable approach', () => {
  const result = choosePlacement({ width: 3, depth: 3 }, [], { x: 1.55, z: 2.5 });
  assert.ok(result.position.z <= -11);
  assert.ok(result.path.length > 0);
  assert.ok(route({ x: 0, z: -0.5 }, { x: 0, z: -13 }, sceneryObjects()), 'the yard behind the house is reachable');
});
test('corrupt model edit never removes the original object', async () => {
  const h = harness(async (i, s) =>
    i.objects.length
      ? { action: 'edit', targetId: 'missing', reply: 'edit', blueprint: i.objects[0].blueprint }
      : fixtureGenerator(i, s),
  );
  await h.send('Build duck');
  await h.finish();
  const first = structuredClone(h.state.objects[0]);
  await h.send('Add a roof to the Duck-shaped watchtower', 'b');
  await h.finish();
  assert.deepEqual(h.state.objects[0], first);
  assert.equal(h.state.jobs.at(-1)?.status, 'failed');
  h.stop();
});
test('walker routes are straightened into runs: collinear grid steps merge, corners stay', () => {
  const staircase = [
    { x: 0, z: 0 },
    { x: 0.5, z: 0 },
    { x: 1, z: 0 },
    { x: 1, z: 0.5 },
    { x: 1, z: 1 },
    { x: 1.5, z: 1 },
  ];
  assert.deepEqual(straighten(staircase), [
    { x: 0, z: 0 },
    { x: 1, z: 0 },
    { x: 1, z: 1 },
    { x: 1.5, z: 1 },
  ]);
  assert.deepEqual(straighten([{ x: 0, z: 0 }]), [{ x: 0, z: 0 }]);
  const placed = choosePlacement({ width: 1, depth: 1 }, sceneryObjects(), { x: 0, z: -0.5 });
  assert.ok(placed.path.length > 0);
  for (let i = 1; i < placed.path.length - 1; i++) {
    const a = placed.path[i - 1],
      b = placed.path[i],
      c = placed.path[i + 1];
    assert.notEqual((b.x - a.x) * (c.z - b.z) - (b.z - a.z) * (c.x - b.x), 0, 'no collinear triple survives');
  }
});
