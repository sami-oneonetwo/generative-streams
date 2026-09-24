// Small life: behaviour as data (rules.ts), part animations, what pieces are for (uses), and the
// block's own animals (wildlife.ts). Zero AI calls anywhere here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  clampRules,
  clampAnimations,
  stepRules,
  perchHeight,
  RULE_LIMITS,
  ANIMATION_LIMITS,
} from '../src/worlds/safehouse/rules';
import { tickCreatures, freshCreature, FLIGHT } from '../src/worlds/safehouse/creatures';
import {
  WILDLIFE,
  tickWildlife,
  ensureWildlife,
  adoptLife,
  resetWildlifeMemory,
  RESPAWN_MS,
} from '../src/worlds/safehouse/wildlife';
import { sceneryObjects } from '../src/worlds/safehouse/scenery';
import {
  fenceObjects,
  freshCombat,
  spawnZombie,
  initializeObject,
  damageObject,
  intact,
  MAX_CREATURES,
} from '../src/worlds/safehouse/combat';
import { objectSchema, createInitialState, active, type SafehouseState } from '../src/worlds/safehouse/state';
import { measureBlueprint, SCENERY_LIMITS, MAX_RULES, MAX_ANIMATIONS, blueprintBounds } from '../src/worlds/safehouse/blueprint';
import { pickRepairTarget } from '../src/worlds/safehouse/repair';
import { census } from '../src/worlds/safehouse/neighbours';
import { createSafehouseWorld } from '../src/worlds/safehouse';
import { SURVIVOR_START } from '../src/shared/safehouseLayout';
import type { Rule, SafehouseObject, Use } from '../src/shared/safehouseTypes';
import type { WorldCtx } from '../src/engine/world';

const lcg = (seed = 11) => () => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
};
/** A plain piece: a box of the given height, optionally tagged and optionally alive. */
const piece = (
  id: string,
  position: { x: number; z: number },
  extra: Partial<SafehouseObject> & { height?: number; uses?: Use[]; rules?: Rule[] } = {},
): SafehouseObject => {
  const { height = 1, uses, rules, ...rest } = extra;
  return initializeObject({
    id,
    revision: 1,
    createdAt: 0,
    createdBy: 'viewer',
    editedBy: 'viewer',
    position,
    footprint: { width: 1, depth: 1 },
    blueprint: {
      name: id,
      description: '',
      parts: [{ shape: 'box', position: [0, height / 2, 0], size: [1, height, 1], rotation: [0, 0, 0], color: '#888888' }],
    },
    ...(uses ? { uses } : {}),
    ...(rules ? { rules: clampRules(rules) } : {}),
    ...rest,
  });
};
const bird = (id: string, position: { x: number; z: number }, rules: Rule[], altitude = FLIGHT.cruise) => {
  const creature = freshCreature('roam', true);
  creature.altitude = altitude;
  return piece(id, position, { creature, rules, wild: true, fixed: true });
};
const yard = (objects: SafehouseObject[], extra: Record<string, unknown> = {}) => ({
  objects,
  combat: freshCombat(true),
  survivor: { position: { ...SURVIVOR_START } },
  ...extra,
});
function run(w: ReturnType<typeof yard>, ticks: number, rng = lcg(), each?: (i: number) => void) {
  for (let i = 0; i < ticks; i++) {
    tickCreatures(w, 500, rng);
    each?.(i);
  }
}
const byId = (w: { objects: SafehouseObject[] }, id: string) => w.objects.find((o) => o.id === id)!;

const PERCH_RULE: Rule = { when: 'tick', target: { tag: 'perch', pick: 'nearest', within: 30 }, do: 'perch', dwell: [1, 1] };

test('clamps: rule numbers are bounded, malformed rules dropped, the list capped', () => {
  const rules = clampRules([
    { when: 'tick', target: { tag: 'perch', within: 900 }, do: 'perch', dwell: [500, -3] },
    { when: 'near', target: { kind: 'zombie', within: 0.001 }, do: 'flee' },
    { when: 'tick', do: 'visit' },
    { when: 'tick', target: { tag: 'seat' }, do: 'visit', dwell: [30, 10] },
    { when: 'night', target: { tag: 'seat' }, do: 'visit' },
    { when: 'day', target: { tag: 'seat' }, do: 'visit' },
  ]);
  assert.equal(rules.length, MAX_RULES, 'capped');
  assert.equal(rules[0].target!.within, RULE_LIMITS.within.max);
  assert.deepEqual(rules[0].dwell, [0, RULE_LIMITS.dwell.max], 'dwell clamped and ordered');
  assert.equal(rules[1].target!.within, RULE_LIMITS.within.min);
  assert.equal(rules[2].target, undefined);
  assert.deepEqual(rules[3].dwell, [10, 30], 'a backwards dwell is put the right way round');
  assert.equal(rules[3].target!.pick, 'nearest', 'pick defaults');
  assert.deepEqual(clampRules(undefined), []);
});

test('clamps: animations default their axis and speed, lose bad part indices, spin has no amplitude', () => {
  const list = clampAnimations(
    [
      { part: 0, kind: 'sway', amplitude: 5, speed: 99 },
      { part: 7, kind: 'bob' },
      { part: 1, kind: 'spin', amplitude: 0.3 },
      { part: 2, kind: 'drift' },
      { part: -1, kind: 'bob' },
      ...Array.from({ length: 20 }, (_, i) => ({ part: 2, kind: 'bob' as const, phase: i })),
    ],
    3,
  );
  assert.equal(list.length, MAX_ANIMATIONS);
  assert.equal(list[0].amplitude, ANIMATION_LIMITS.amplitude.sway);
  assert.equal(list[0].speed, ANIMATION_LIMITS.speed.max);
  assert.equal(list[0].axis, 'z');
  assert.equal(list[1].kind, 'spin');
  assert.equal(list[1].amplitude, undefined);
  assert.equal(list[1].axis, 'y');
  assert.equal(list[2].kind, 'drift');
  assert.equal(list[2].axis, 'x');
  assert.equal(list[2].speed, ANIMATION_LIMITS.speed.default);
  assert.equal(list[2].amplitude, ANIMATION_LIMITS.amplitude.default);
  assert.ok(list.every((a) => a.part >= 0 && a.part < 3), 'out-of-range parts dropped');
});

test('the neighborhood: every animation points at a real part, every piece still validates, uses are on', () => {
  const all = [...sceneryObjects(), ...fenceObjects()];
  const animated = all.filter((o) => o.blueprint.animations?.length);
  assert.ok(animated.length >= 15, `trees and swings move (${animated.length})`);
  for (const o of all) {
    objectSchema.parse(o);
    measureBlueprint(o.blueprint, SCENERY_LIMITS);
    for (const a of o.blueprint.animations ?? []) assert.ok(a.part >= 0 && a.part < o.blueprint.parts.length, `${o.id} part ${a.part}`);
    if (o.blueprint.animations) assert.deepEqual(clampAnimations(o.blueprint.animations, o.blueprint.parts.length), o.blueprint.animations, `${o.id} within limits`);
  }
  const trees = all.filter((o) => /^scenery-tree-/.test(o.id));
  assert.equal(trees.length, 14);
  for (const t of trees) {
    assert.ok(t.uses?.includes('tree') && t.uses.includes('perch'), t.id);
    assert.equal(t.blueprint.animations?.length, 3, 'three canopy balls drift');
    assert.ok(t.blueprint.animations!.every((a) => a.kind === 'drift' && a.part >= 1));
  }
  const swings = all.find((o) => o.id === 'scenery-swings')!;
  assert.deepEqual(swings.uses, ['seat', 'perch']);
  assert.equal(swings.blueprint.animations?.length, 6);
  // The swings' seats are the wide flat boards and the chains the thin cylinders; the animated indices must be those.
  for (const a of swings.blueprint.animations!) {
    const p = swings.blueprint.parts[a.part];
    assert.ok((p.shape === 'box' && p.size[0] === 0.5) || (p.shape === 'cylinder' && p.size[0] < 0.05), `swing part ${a.part} is a seat or a chain`);
  }
  assert.ok(fenceObjects().every((f) => f.uses?.includes('perch')), 'birds sit on the fence');
  for (const id of ['scenery-car', 'scenery-car-west', 'scenery-car-far-east', 'scenery-car-far-west-2'])
    assert.deepEqual(all.find((o) => o.id === id)!.uses, ['vehicle', 'perch'], id);
  for (const id of ['scenery-bench-west', 'scenery-bench-east', 'scenery-picnic']) assert.deepEqual(all.find((o) => o.id === id)!.uses, ['seat'], id);
  assert.ok(all.find((o) => o.id === 'scenery-house')!.uses?.includes('perch'), 'birds on the roof');
});

test('a bird picks a perch, settles onto its top, sits out the dwell, then moves to another', () => {
  const post = piece('post', { x: 5, z: -12 }, { height: 2, uses: ['perch'] });
  const pole = piece('pole', { x: -9, z: -12 }, { height: 6, uses: ['perch'] });
  const w = yard([post, pole, bird('b', { x: 0, z: -12 }, [PERCH_RULE])]);
  const b = byId(w, 'b'),
    st = b.creature!;
  run(w, 2);
  assert.equal(st.goal?.targetId, 'post', 'the nearest perch first');
  assert.equal(st.goal?.rule, 0);
  let landed = 0;
  run(w, 40, lcg(), () => {
    if (st.goal?.perched) landed++;
  });
  assert.ok(landed > 0, 'it landed');
  const top = perchHeight(post);
  assert.ok(Math.abs(top - (blueprintBounds(post.blueprint).maxY + RULE_LIMITS.perchLift)) < 1e-9);
  // A one-second dwell: over the next while it lets go and heads for the other perch, and its last spot is remembered.
  const seen = new Set<string>();
  run(w, 60, lcg(), () => {
    if (st.goal?.targetId) seen.add(st.goal.targetId);
  });
  assert.ok(seen.has('pole'), `it moved on to the pole (${[...seen]})`);
  // Sitting: the altitude eases to the perch top rather than the cruise height.
  const w2 = yard([post, bird('c', { x: 5, z: -12 }, [PERCH_RULE])]);
  const c = byId(w2, 'c');
  c.rules = clampRules([{ ...PERCH_RULE, dwell: [120, 120] }]);
  run(w2, 60);
  assert.ok(c.creature!.goal?.perched, 'perched for the long dwell');
  assert.ok(Math.abs((c.creature!.altitude ?? 0) - top) < 0.15, `altitude ${c.creature!.altitude} settles to ${top}`);
  assert.equal(c.creature!.moving, false);
});

test('a bird never perches within four metres of a scarecrow', () => {
  const near = piece('near', { x: 3, z: -12 }, { height: 2, uses: ['perch'] });
  const scare = piece('scarecrow', { x: 5.5, z: -12 }, { height: 2, uses: ['scare'] });
  const far = piece('far', { x: -12, z: -12 }, { height: 2, uses: ['perch'] });
  const w = yard([near, scare, far, bird('b', { x: 0, z: -12 }, [PERCH_RULE])]);
  const st = byId(w, 'b').creature!;
  const targets = new Set<string>();
  run(w, 240, lcg(3), () => {
    if (st.goal) targets.add(st.goal.targetId ?? '?');
  });
  assert.ok(targets.has('far'));
  assert.ok(!targets.has('near'), `kept off the perch by the scarecrow (${[...targets]})`);
});

test('a zombie underneath sends a perched bird off, and it stays skittish for a while', () => {
  const post = piece('post', { x: 5, z: -12 }, { height: 2, uses: ['perch'] });
  const rules: Rule[] = [{ when: 'near', target: { kind: 'zombie', within: 3 }, do: 'flee' }, { ...PERCH_RULE, dwell: [60, 60] }];
  const w = yard([post, bird('b', { x: 5, z: -12 }, rules, 2)]);
  const b = byId(w, 'b'),
    st = b.creature!;
  run(w, 20);
  assert.ok(st.goal?.perched, 'perched to begin with');
  const z = spawnZombie(w.combat, 'walker')!;
  z.position = { x: 5.5, z: -11.5 };
  run(w, 1);
  assert.equal(st.goal?.perched, undefined, 'off the perch');
  assert.equal(st.goal?.rule, 0, 'the flee rule has it');
  assert.ok((st.scaredMs ?? 0) > 0);
  const before = { ...b.position };
  let perchedWhileScared = 0;
  run(w, 12, lcg(), () => {
    if ((st.scaredMs ?? 0) > 0 && st.goal?.perched) perchedWhileScared++;
  });
  assert.ok(Math.hypot(b.position.x - before.x, b.position.z - before.z) > 3, 'it got well away');
  assert.equal(perchedWhileScared, 0, 'no landing while skittish');
  assert.ok((st.altitude ?? 0) > 3, `climbed back toward cruise (${st.altitude})`);
});

test('the cat walks over to a seat and sits by it', () => {
  const bench = piece('bench', { x: 6, z: -12 }, { height: 0.9, uses: ['seat'] });
  const catRules: Rule[] = [{ when: 'tick', target: { tag: 'seat', pick: 'nearest', within: 25 }, do: 'visit', dwell: [30, 30] }];
  const w = yard([bench, piece('cat', { x: 0, z: -12 }, { creature: freshCreature('roam'), rules: catRules, wild: true, fixed: true })]);
  const cat = byId(w, 'cat'),
    st = cat.creature!;
  run(w, 40);
  assert.equal(st.goal?.targetId, 'bench');
  assert.ok(st.goal?.arrived, 'it got there');
  assert.equal(st.moving, false);
  const r = { minX: 5.5, maxX: 6.5, minZ: -12.5, maxZ: -11.5 };
  const gap = Math.hypot(Math.max(r.minX - cat.position.x, 0, cat.position.x - r.maxX), Math.max(r.minZ - cat.position.z, 0, cat.position.z - r.maxZ));
  assert.ok(gap < 1.2, `sitting beside the bench (${gap.toFixed(2)} m)`);
  assert.ok((st.altitude ?? 0) === 0, 'cats do not fly');
});

test('a ruled creature with nothing in range falls back to its preset behaviour', () => {
  const w = yard([bird('b', { x: 0, z: -12 }, [PERCH_RULE])]);
  const b = byId(w, 'b');
  const start = { ...b.position };
  run(w, 60);
  assert.ok(Math.hypot(b.position.x - start.x, b.position.z - start.z) > 1, 'it roamed');
  assert.equal(b.creature!.goal, undefined);
});

function harness() {
  let now = 10000;
  const world = createSafehouseWorld({ fixture: true, workMs: 500, neighbours: false });
  const state = world.createInitialState(now);
  const ctx: WorldCtx<SafehouseState> = {
    state,
    get now() {
      return now;
    },
    checkpoint() {
      world.stateSchema.parse(state);
    },
    say() {},
    log() {},
    enqueueTask: () => ({ id: '' }),
    queue: [],
    llm: { dialogue: async () => null, moderate: async () => ({ ok: false }) },
    tuning: {},
    chatRatePerMin: 0,
    rng: lcg(5),
  };
  world.start?.(ctx);
  const tick = (n = 1) => {
    for (let i = 0; i < n; i++) {
      now += 500;
      world.tick(ctx, 500);
    }
  };
  async function request(text: string, user = 'a') {
    now += 4000;
    await world.intents[0].handle(ctx, { id: crypto.randomUUID(), userId: user, username: user, text, ts: now, source: 'dev' }, undefined);
    for (let i = 0; i < 400; i++) {
      tick();
      await new Promise((r) => setImmediate(r));
      if (!state.jobs.some(active)) break;
    }
    return state.jobs.at(-1)!;
  }
  const advance = (ms: number) => {
    now += ms;
  };
  return { world, state, ctx, tick, request, advance };
}
const wild = (state: SafehouseState) => state.objects.filter((o) => o.wild);

test('the pool seeds on a fresh world; a downed bird is gone, not rubble, and comes back later', () => {
  resetWildlifeMemory();
  const h = harness();
  h.tick();
  assert.deepEqual(wild(h.state).map((o) => o.id).sort(), WILDLIFE.map((s) => s.id).sort());
  for (const o of wild(h.state)) {
    assert.ok(o.fixed && o.creature && o.rules?.length, `${o.id} is a fixed ruled creature`);
    assert.equal(o.createdBy, 'Neighborhood');
    objectSchema.parse(o);
    measureBlueprint(o.blueprint, SCENERY_LIMITS);
    for (const a of o.blueprint.animations ?? []) assert.ok(a.part < o.blueprint.parts.length);
  }
  const birds = wild(h.state).filter((o) => o.creature!.flying);
  assert.equal(birds.length, 3);
  assert.ok(birds.every((b) => (b.creature!.altitude ?? 0) > 5), 'birds arrive on the wing');
  const sparrow = byId(h.state, 'wild-bird-1');
  damageObject(sparrow, 1000, h.state.combat.time);
  assert.ok(!intact(sparrow));
  h.tick();
  assert.ok(!h.state.objects.some((o) => o.id === 'wild-bird-1'), 'removed outright');
  assert.ok(!h.state.combat.archive.some((o) => o.id === 'wild-bird-1'), 'never archived');
  h.tick(20);
  assert.ok(!h.state.objects.some((o) => o.id === 'wild-bird-1'), 'not back within ten seconds');
  h.advance(RESPAWN_MS[1] + 1000);
  h.tick();
  assert.ok(h.state.objects.some((o) => o.id === 'wild-bird-1'), 'back after the delay');
});

test('wildlife counts against nobody: chat still has all its living things, Rook and the census ignore them', async () => {
  resetWildlifeMemory();
  const h = harness();
  h.tick();
  assert.equal(wild(h.state).length, WILDLIFE.length);
  for (let i = 0; i < MAX_CREATURES - 1; i++) h.state.objects.push(piece(`pet-${i}`, { x: -8 + i, z: -14 }, { creature: freshCreature('roam') }));
  h.tick();
  const chatCreatures = () => h.state.objects.filter((o) => o.creature && intact(o) && !o.wild).length;
  assert.equal(chatCreatures(), MAX_CREATURES - 1);
  assert.equal(wild(h.state).length, WILDLIFE.length, 'the birds are still about with the yard nearly full');
  const ok = await h.request('Build a chicken', 'ana');
  assert.equal(ok.status, 'complete', `the fifteenth living thing is fine: ${ok.error}`);
  assert.equal(chatCreatures(), MAX_CREATURES);
  const refused = await h.request('Build a chicken', 'ben');
  assert.equal(refused.status, 'failed');
  assert.match(refused.error ?? '', /living things already/);
  // Rook never picks up a hurt cat, and the survey never reads the birds as chat's menagerie.
  const cat = byId(h.state, 'wild-cat');
  cat.health = 5;
  assert.equal(pickRepairTarget([cat], [], SURVIVOR_START), undefined);
  assert.equal(pickRepairTarget([], [{ ...cat, destroyedAt: 1 }], SURVIVOR_START), undefined);
  const c = census({ objects: h.state.objects, combat: h.state.combat, lighting: 'day' } as never);
  assert.ok(c.creatures.every((x) => !/Sparrow|Magpie|Crow|cat|Rat/.test(x.name)), JSON.stringify(c.creatures));
});

test('the operator can send the wildlife away and let it back; the switch survives a reset', () => {
  resetWildlifeMemory();
  const h = harness();
  h.tick();
  assert.equal(wild(h.state).length, WILDLIFE.length);
  h.world.adminActions!.find((a) => a.id === 'safehouse-wildlife-pause')!.run(h.ctx);
  h.tick();
  assert.equal(wild(h.state).length, 0);
  assert.equal(h.state.wildlifePaused, true);
  h.tick(10);
  assert.equal(wild(h.state).length, 0);
  const fresh = h.world.reset!(h.state, h.ctx.now);
  assert.equal(fresh.wildlifePaused, true, 'kept across a reset like the other switches');
  h.world.adminActions!.find((a) => a.id === 'safehouse-wildlife-resume')!.run(h.ctx);
  h.tick();
  assert.equal(wild(h.state).length, WILDLIFE.length, 'straight back, no respawn delay after a pause');
  assert.equal(h.world.buildScene(h.state, { protagonist: { x: 0, state: 'idle' }, pendingTasks: [], logLines: [], recentChat: [], chatRevision: 0, now: h.ctx.now }).safehouse!.wildlifePaused, false);
});

test('adoptLife: an older save gets uses and animations in place, no revision bump', () => {
  const state = createInitialState();
  state.objects = [...sceneryObjects(), ...fenceObjects()].map((o) => {
    const { uses: _u, ...rest } = o;
    const { animations: _a, ...blueprint } = o.blueprint;
    return { ...rest, blueprint };
  });
  // Owned pieces are recognised by their catalogue name, never by id: a themed yard redoes a
  // piece in place under the same id, so the `-hoop` id may hold something else entirely by now.
  const named = (o: SafehouseObject, name: string) => ({ ...o, blueprint: { ...o.blueprint, name } });
  state.objects.push(
    named(piece('neighbour-west-birdbath', { x: -22, z: 1 }, { owner: 'west', fixed: true }), "Marge's bird bath"),
    named(piece('neighbour-west-scarecrow', { x: -18, z: -9 }, { owner: 'west', fixed: true }), "Marge's scarecrow"),
    piece('neighbour-east-slot-ab12', { x: 26, z: 1 }, { owner: 'east', fixed: true }),
    named(piece('neighbour-east-hoop', { x: 22, z: 2 }, { owner: 'east', fixed: true, revision: 10 }), "Jake's pallet-mounted rusted V8"),
  );
  assert.ok(state.objects.every((o) => !o.uses && !o.blueprint.animations));
  assert.equal(adoptLife(state), true);
  const tree = byId(state, 'scenery-tree-1');
  assert.deepEqual(tree.uses, ['tree', 'perch']);
  assert.equal(tree.blueprint.animations?.length, 3);
  assert.equal(tree.revision, 1);
  assert.deepEqual(byId(state, 'fence-0').uses, ['perch']);
  assert.deepEqual(byId(state, 'neighbour-west-birdbath').uses, ['perch']);
  assert.deepEqual(byId(state, 'neighbour-west-scarecrow').uses, ['scare']);
  assert.equal(byId(state, 'neighbour-east-slot-ab12').uses, undefined, 'a whim slot means nothing to the animals');
  assert.equal(byId(state, 'neighbour-east-hoop').uses, undefined, 'a rethemed hoop is not a hoop any more');
  assert.equal(adoptLife(state), false, 'idempotent');
  // A tree chat has redesigned keeps its own shape unanimated: the indices would not line up.
  const redone = byId(state, 'scenery-tree-2');
  redone.revision = 2;
  redone.blueprint = { ...redone.blueprint, animations: undefined };
  delete redone.blueprint.animations;
  assert.equal(adoptLife(state), false);
  assert.equal(redone.blueprint.animations, undefined);
  ensureWildlife(state, 0);
  for (const o of state.objects) objectSchema.parse(o);
  assert.equal(tickWildlife(state, 0, lcg()), false, 'nothing to change once seeded');
});
