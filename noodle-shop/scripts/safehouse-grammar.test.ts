// The grammar opened to the design call (slice 2): what a piece is for (`uses`), behaviour as data
// (`rules`) and part motion (`animations`) as the model phrases them, normalised into the closed
// vocabulary and clamped; the fixtures that carry them; the request grammar reading "a bird that
// sits on the fence" as a build; Rook sitting down when nothing is on. Zero AI calls.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeUses,
  normalizeRules,
  normalizeAnimations,
  normalizeResponse,
  validateResponse,
  MAX_USES,
  MAX_RULES,
  MAX_ANIMATIONS,
} from '../src/worlds/safehouse/blueprint';
import { RULE_LIMITS, ANIMATION_LIMITS } from '../src/worlds/safehouse/rules';
import { SYSTEM_PROMPT, fixtureGenerator } from '../src/llm/blueprint';
import { parseRequest, rotateBlueprint } from '../src/worlds/safehouse/edits';
import { sceneryObjects } from '../src/worlds/safehouse/scenery';
import { fenceObjects } from '../src/worlds/safehouse/combat';
import { createSafehouseWorld, type SafehouseOptions } from '../src/worlds/safehouse';
import { active, type SafehouseState } from '../src/worlds/safehouse/state';
import { shortRef, type Blueprint, type SafehouseObject } from '../src/shared/safehouseTypes';
import { SURVIVOR_START } from '../src/shared/safehouseLayout';
import type { WorldCtx } from '../src/engine/world';

const lcg = (seed = 11) => () => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
};
const box = (y = 0.5, h = 1) => ({ shape: 'box' as const, position: [0, y, 0] as [number, number, number], size: [1, h, 1] as [number, number, number], rotation: [0, 0, 0] as [number, number, number], color: '#888888' });
const design = (extra: Record<string, unknown> = {}, parts = 3): Record<string, unknown> => ({
  action: 'build',
  reply: 'ok',
  blueprint: { name: 'Thing', description: '', parts: Array.from({ length: parts }, (_, i) => box(0.5 + i)) },
  ...extra,
});

test('uses: every spelling the model might use lands in the closed vocabulary, junk is dropped, the list is capped', () => {
  assert.deepEqual(normalizeUses(['seat']), ['seat']);
  assert.deepEqual(normalizeUses('perch, seat'), ['perch', 'seat']);
  assert.deepEqual(normalizeUses(['Bench', 'chair', 'stool', 'hammock', 'swing']), ['seat'], 'deduped');
  assert.deepEqual(normalizeUses(['roost', 'perching', 'landing spot']), ['perch']);
  assert.deepEqual(normalizeUses(['Scarecrow', 'deterrent']), ['scare']);
  assert.deepEqual(normalizeUses(['trees']), ['tree']);
  assert.deepEqual(normalizeUses(['truck', 'go-kart', 'drivable']), ['vehicle']);
  assert.deepEqual(normalizeUses(['basketball hoop', 'net']), ['hoop']);
  assert.deepEqual(normalizeUses(['fountain', 'spaceship', 42, null]), undefined, 'nothing known → no field');
  assert.deepEqual(normalizeUses('bench / perch / tree'), ['seat', 'perch', 'tree']);
  const many = normalizeUses(['perch', 'seat', 'scare', 'tree', 'vehicle', 'hoop', 'bench']);
  assert.ok(many && many.length <= MAX_USES);
});

test('rules: triggers, actions and targets in the model’s words, dwell in three shapes, the bogus dropped alone', () => {
  const rules = normalizeRules([
    { when: 'when near', target: 'zombie', do: 'run from' },
    { when: 'always', target: { tag: 'seat', pick: 'closest', within: '30' }, do: 'sit on', dwell: 12 },
    { trigger: 'at night', target: { kind: 'neighbour', pick: 'random' }, action: 'follow', dwell: { min: 5, max: 10 } },
    { when: 'each tick', target: { use: 'perch', radius: 500 }, do: 'land on', dwell: [200, -1] },
    { when: 'sometimes', target: 'the moon', do: 'teleport' },
    { when: 'day', target: { tag: 'tree' }, do: 'visit' },
  ])!;
  assert.equal(rules.length, MAX_RULES, 'the bogus one is gone and the list is capped');
  assert.deepEqual(rules[0], { when: 'near', do: 'flee', target: { kind: 'zombie', pick: 'nearest', within: RULE_LIMITS.within.default }, dwell: RULE_LIMITS.dwell.default });
  assert.equal(rules[1].when, 'tick');
  assert.equal(rules[1].do, 'visit');
  assert.deepEqual(rules[1].target, { tag: 'seat', pick: 'nearest', within: 30 });
  assert.deepEqual(rules[1].dwell, [12, 12], 'a single number is a fixed dwell');
  assert.equal(rules[2].when, 'night');
  assert.equal(rules[2].do, 'visit');
  assert.deepEqual(rules[2].target, { kind: 'neighbour', pick: 'random', within: RULE_LIMITS.within.default });
  assert.deepEqual(rules[2].dwell, [5, 10]);
  assert.equal(rules[3].do, 'perch');
  assert.equal(rules[3].target!.within, RULE_LIMITS.within.max, 'clamped');
  assert.deepEqual(rules[3].dwell, [0, RULE_LIMITS.dwell.max]);
  assert.equal(normalizeRules('sit on the fence'), undefined);
  assert.equal(normalizeRules([{ when: 'tick', do: 'visit' }]), undefined, 'a rule needs a target');
  // A single rule object, and rules tucked inside the creature, both reach the top level.
  const r = normalizeResponse(design({ creature: { behaviour: 'roam', rules: { when: 'near', target: 'rook', do: 'flee', within: 4 } } })) as { rules?: unknown[]; creature?: unknown };
  assert.equal(r.rules?.length, 1);
  assert.deepEqual(r.creature, { behaviour: 'roam' });
});

test('animations: partIndex and synonyms, uppercase axes, numeric strings, bad parts dropped, capped', () => {
  const list = normalizeAnimations(
    [
      { partIndex: 1, kind: 'rotate', axis: 'Z', speed: '0.5' },
      { index: 0, type: 'flap', amplitude: 9, phase: '1' },
      { part: 2, kind: 'float' },
      { part: 7, kind: 'sway' },
      { part: 1, kind: 'wobble', axis: 'diagonal' },
      { part: 'two', kind: 'spin' },
      ...Array.from({ length: 20 }, () => ({ part: 0, kind: 'drift' })),
    ],
    3,
  )!;
  assert.equal(list.length, MAX_ANIMATIONS);
  assert.deepEqual(list[0], { part: 1, kind: 'spin', axis: 'z', speed: 0.5, phase: 0 });
  assert.equal(list[1].kind, 'sway');
  assert.equal(list[1].amplitude, ANIMATION_LIMITS.amplitude.sway, 'clamped');
  assert.equal(list[1].phase, 1);
  assert.equal(list[2].kind, 'bob');
  assert.equal(list[2].axis, 'y');
  assert.equal(list[3].kind, 'sway');
  assert.equal(list[3].axis, 'z', 'an unknown axis falls back to the kind’s default');
  assert.ok(list.every((a) => a.part < 3), 'part 7 and "two" are gone');
  assert.equal(normalizeAnimations([{ part: 0, kind: 'explode' }], 3), undefined);
});

test('a response carrying uses, rules and animations validates whole; on a plain response none of them appear', () => {
  const result = validateResponse(
    design(
      {
        creature: 'flying bird',
        uses: 'perch',
        rules: [{ when: 'tick', target: { tag: 'perch', pick: 'random', within: 30 }, do: 'perch', dwell: [8, 20] }],
        blueprint: {
          name: 'Bird',
          description: '',
          parts: [box(0.3, 0.3), box(0.5, 0.2), box(0.4, 0.05)],
          animations: [{ part: 2, kind: 'flap', axis: 'z', speed: 1.4, amplitude: 0.3 }],
        },
      },
      3,
    ),
  );
  assert.equal(result.action, 'build');
  if (result.action !== 'build') return;
  assert.deepEqual(result.creature, { behaviour: 'roam', flying: true });
  assert.deepEqual(result.uses, ['perch']);
  assert.equal(result.rules?.length, 1);
  assert.equal(result.rules?.[0].do, 'perch');
  assert.equal(result.blueprint.animations?.length, 1);
  assert.equal(result.blueprint.animations?.[0].kind, 'sway');
  const plain = validateResponse(design());
  assert.ok(!('uses' in plain) || plain.uses === undefined);
  assert.ok(!('rules' in plain) || plain.rules === undefined);
  assert.equal(('blueprint' in plain && plain.blueprint.animations) || undefined, undefined);
});

test('the design prompt teaches the three fields and the three actions', () => {
  for (const word of ['"uses"', '"rules"', '"animations"', 'visit', 'perch', 'flee', '"seat"', '"hoop"', '"scare"', 'sway', 'drift', 'spin', 'bob'])
    assert.ok(SYSTEM_PROMPT.includes(word), word);
  assert.ok(!/walking creatures, roof access/.test(SYSTEM_PROMPT), 'the stale "not supported" line is gone');
});

const ask = (text: string, objects: SafehouseObject[] = []) => fixtureGenerator({ text, username: 'dave', objects }, new AbortController().signal);

test('fixtures: the bench, scarecrow, hoop and windmill carry their use or motion; the perching crow and the lap cat carry rules', async () => {
  const bench = await ask('Build a bench');
  assert.equal(bench.action, 'build');
  if (bench.action === 'build') {
    assert.deepEqual(bench.uses, ['seat']);
    validateResponse(bench);
  }
  const scarecrow = await ask('Build a scarecrow');
  if (scarecrow.action === 'build') assert.deepEqual(scarecrow.uses, ['scare']);
  const hoop = await ask('Build a basketball hoop');
  if (hoop.action === 'build') assert.deepEqual(hoop.uses, ['hoop']);
  const windmill = await ask('Build a windmill');
  if (windmill.action === 'build') {
    assert.deepEqual(windmill.uses, ['perch']);
    assert.ok(windmill.blueprint.animations?.every((a) => a.kind === 'spin' && a.axis === 'z'));
    validateResponse(windmill);
  }
  const crow = await ask('Build a bird that sits on the fence');
  assert.equal(crow.action, 'build');
  if (crow.action === 'build') {
    assert.deepEqual(crow.creature, { behaviour: 'roam', flying: true });
    assert.equal(crow.rules?.[0].do, 'perch');
    assert.equal(crow.rules?.[0].target?.tag, 'perch');
    assert.equal(crow.rules?.[1].do, 'flee');
    assert.ok(crow.blueprint.animations?.length, 'its wings flap');
    validateResponse(crow);
  }
  const plainCrow = await ask('Build a crow');
  if (plainCrow.action === 'build') assert.equal(plainCrow.rules, undefined, 'a plain crow just roams');
  const cat = await ask('Build a cat that sleeps on the bench');
  assert.equal(cat.action, 'build');
  if (cat.action === 'build') {
    assert.equal(cat.blueprint.name, 'Yard cat', 'the animal wins over the bench word');
    assert.deepEqual(cat.creature, { behaviour: 'roam' });
    assert.equal(cat.rules?.[0].do, 'visit');
    assert.equal(cat.rules?.[0].target?.tag, 'seat');
    validateResponse(cat);
  }
  const chicken = await ask('Build a chicken');
  if (chicken.action === 'build') assert.equal(chicken.rules, undefined);
});

test('the request grammar: "a bird that sits on the fence" builds a bird; "add a chimney on the garage" still edits the garage', () => {
  const catalog = [...sceneryObjects(), ...fenceObjects()];
  for (const text of ['Build a bird that sits on the fence', 'Build a crow that lives on the fence', 'Build a cat that sleeps on the bench']) {
    const r = parseRequest(text, catalog, undefined, 'dave');
    assert.equal(r.clarification, undefined, text);
    assert.equal(r.targetId, undefined, text);
  }
  assert.equal(parseRequest('Add a chimney on the garage', catalog, undefined, 'dave').targetId, 'scenery-garage');
  assert.equal(parseRequest('Put a flag on the house', catalog, undefined, 'dave').targetId, 'scenery-house');
});

test('rotateBlueprint turns sway and drift axes with a quarter turn, leaves them at a half turn and y alone', () => {
  const source: Blueprint = {
    name: 'Swing',
    description: '',
    parts: [box(0.5), box(1.5), box(2.5)],
    animations: [
      { part: 0, kind: 'sway', axis: 'x', speed: 0.4, amplitude: 0.1 },
      { part: 1, kind: 'drift', axis: 'z', speed: 0.2, amplitude: 0.05 },
      { part: 2, kind: 'spin', axis: 'y', speed: 0.5 },
    ],
  };
  const quarter = rotateBlueprint(source, Math.PI / 2);
  assert.deepEqual(quarter.animations!.map((a) => a.axis), ['z', 'x', 'y']);
  const backwards = rotateBlueprint(source, -Math.PI / 2);
  assert.deepEqual(backwards.animations!.map((a) => a.axis), ['z', 'x', 'y']);
  const half = rotateBlueprint(source, Math.PI);
  assert.deepEqual(half.animations!.map((a) => a.axis), ['x', 'z', 'y']);
  const slight = rotateBlueprint(source, 0.3);
  assert.deepEqual(slight.animations!.map((a) => a.axis), ['x', 'z', 'y']);
  assert.equal(rotateBlueprint({ ...source, animations: undefined }, Math.PI / 2).animations, undefined);
});

function harness(options: Partial<SafehouseOptions> = {}) {
  let now = 10000;
  const world = createSafehouseWorld({ fixture: true, workMs: 500, wildlife: false, neighbours: false, ...options });
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
    rng: lcg(7),
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
  return { world, state, ctx, tick, request };
}
const chatBuilds = (state: SafehouseState) => state.objects.filter((o) => !o.fixed);

test('end to end: a bird that sits on the fence is a ruled creature and ends up perched on the fence', async () => {
  const h = harness();
  const job = await h.request('Build a bird that sits on the fence', 'dave');
  assert.equal(job.status, 'complete', job.error);
  const bird = chatBuilds(h.state).find((o) => o.creature);
  assert.ok(bird && !bird.wild, 'a chat creature, not wildlife');
  assert.equal(bird!.rules?.length, 2);
  assert.equal(bird!.rules?.[0].do, 'perch');
  assert.ok(bird!.blueprint.animations?.length, 'its wings carry their animation');
  const perches = new Set<string>();
  for (let i = 0; i < 480; i++) {
    h.tick();
    const g = bird!.creature!.goal;
    if (g?.perched && g.targetId) perches.add(g.targetId);
  }
  assert.ok(perches.size >= 2, `it perched on more than one thing (${[...perches]})`);
  assert.ok([...perches].some((id) => /^fence-/.test(id)), `one of them a fence section (${[...perches]})`);
  for (const id of perches) {
    const piece = h.state.objects.find((o) => o.id === id);
    assert.ok(piece?.uses?.includes('perch'), `${id} is tagged perch`);
  }
});

test('end to end: a bench carries seat; a repaint keeps it; a repaint of the bird keeps its rules', async () => {
  const h = harness();
  const built = await h.request('Build a bench', 'erin');
  assert.equal(built.status, 'complete', built.error);
  const bench = chatBuilds(h.state).find((o) => o.blueprint.name === 'Park bench')!;
  assert.deepEqual(bench.uses, ['seat']);
  assert.equal(bench.rules, undefined, 'no creature, no rules');
  const painted = await h.request(`Paint #${shortRef(bench.id)} red`, 'erin');
  assert.equal(painted.status, 'complete', painted.error);
  const after = h.state.objects.find((o) => o.id === bench.id)!;
  assert.equal(after.revision, bench.revision + 1);
  assert.deepEqual(after.uses, ['seat'], 'a quick edit keeps what the piece is for');
  const flew = await h.request('Build a crow that lives on the fence', 'fay');
  assert.equal(flew.status, 'complete', flew.error);
  const crow = chatBuilds(h.state).find((o) => o.creature)!;
  const rules = structuredClone(crow.rules);
  // Let it settle on something first: a repaint must meet it where it sits, not fail over the fence under it.
  for (let i = 0; i < 400 && !crow.creature!.goal?.perched; i++) h.tick();
  assert.ok(crow.creature!.goal?.perched, 'perched before the repaint');
  const perchedOn = crow.creature!.goal!.targetId;
  const recolour = await h.request(`Paint #${shortRef(crow.id)} pink`, 'fay');
  assert.equal(recolour.status, 'complete', recolour.error);
  const crowAfter = h.state.objects.find((o) => o.id === crow.id)!;
  assert.deepEqual(crowAfter.rules, rules, 'an edit that says nothing about rules keeps them');
  assert.ok(crowAfter.blueprint.animations?.length, 'and the wings still flap');
  assert.ok(crowAfter.creature!.goal?.perched, 'still sitting where it was');
  assert.equal(crowAfter.creature!.goal?.targetId, perchedOn);
  assert.ok(crowAfter.blueprint.parts.every((p) => p.color === '#cb8b91'), 'in its new coat');
});

test('rules on a non-living build are dropped; a design that names rules for a living build replaces the old ones', async () => {
  let turn = 0;
  const h = harness({
    generator: async () => {
      turn++;
      return turn === 1
        ? {
            action: 'build',
            reply: 'a statue',
            uses: ['seat'],
            rules: [{ when: 'tick', target: { tag: 'perch', pick: 'nearest', within: 20 }, do: 'perch', dwell: [5, 5] }],
            blueprint: { name: 'Statue', description: '', parts: [box(0.5), box(1.5)] },
          }
        : {
            action: 'build',
            reply: 'a cat',
            creature: { behaviour: 'roam' },
            rules: [{ when: 'near', target: { kind: 'rook', within: 5 }, do: 'flee' }],
            blueprint: { name: 'Nervous cat', description: '', parts: [box(0.3, 0.6)] },
          };
    },
  });
  const statue = await h.request('Build a statue', 'gus');
  assert.equal(statue.status, 'complete', statue.error);
  const s = chatBuilds(h.state).find((o) => o.blueprint.name === 'Statue')!;
  assert.deepEqual(s.uses, ['seat']);
  assert.equal(s.rules, undefined, 'a statue does not act');
  const cat = await h.request('Build a nervous cat', 'hal');
  assert.equal(cat.status, 'complete', cat.error);
  const c = chatBuilds(h.state).find((o) => o.blueprint.name === 'Nervous cat')!;
  assert.equal(c.rules?.length, 1);
  assert.equal(c.rules?.[0].do, 'flee');
  assert.equal(c.rules?.[0].target?.kind, 'rook');
});

test('Rook sits on the steps after a while with nothing on, stands up for a request, and sits on a seat chat builds nearby', async () => {
  const h = harness();
  h.tick(10); // five seconds: home, standing
  assert.equal(h.state.survivor.activity, 'idle');
  h.tick(34); // past twenty seconds idle
  assert.equal(h.state.survivor.activity, 'sitting');
  assert.ok(Math.hypot(h.state.survivor.position.x - SURVIVOR_START.x, h.state.survivor.position.z - SURVIVOR_START.z) <= 0.2, 'on the steps');
  assert.equal(h.state.survivor.facing, 0, 'facing the street');
  // A request stands him up at once.
  h.ctx.state.jobs.length = 0;
  const seen: string[] = [];
  const now = h.ctx.now;
  await h.world.intents[0].handle(h.ctx, { id: crypto.randomUUID(), userId: 'ivy', username: 'ivy', text: 'Build a bench at -1,2.5', ts: now, source: 'dev' }, undefined);
  for (let i = 0; i < 400; i++) {
    h.tick();
    await new Promise((r) => setImmediate(r));
    seen.push(h.state.survivor.activity);
    if (!h.state.jobs.some(active)) break;
  }
  assert.ok(!seen.includes('sitting'), 'never sat during the job');
  assert.ok(seen.includes('walking') || seen.includes('building'), `he worked (${[...new Set(seen)]})`);
  const bench = chatBuilds(h.state).find((o) => o.blueprint.name === 'Park bench')!;
  assert.deepEqual(bench.uses, ['seat']);
  // Nothing on again: he walks over to the new bench and sits by it rather than on the steps.
  h.tick(80);
  assert.equal(h.state.survivor.activity, 'sitting');
  const p = h.state.survivor.position;
  const gap = Math.hypot(p.x - bench.position.x, p.z - bench.position.z);
  assert.ok(gap <= 1.6, `beside the bench (${gap.toFixed(2)} m)`);
  assert.ok(Math.hypot(p.x - SURVIVOR_START.x, p.z - SURVIVOR_START.z) > 1, 'not on the steps');
  // The saved state still validates with him sitting, and a restart stands him up.
  h.world.stateSchema.parse(h.state);
  h.world.start?.(h.ctx);
  assert.equal(h.state.survivor.activity, 'idle');
});
