// Rook talks while he works: hand-written lines in Sami's voice for the beats
// he hits all day, plain status where viewers need to parse it, and one
// dialogue call when someone speaks to him by name.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSafehouseWorld } from '../src/worlds/safehouse';
import { fixtureGenerator, type DesignGenerator } from '../src/llm/blueprint';
import type { DesignResponse } from '../src/worlds/safehouse/blueprint';
import {
  LINES,
  pickLine,
  render,
  renderedPool,
  speakName,
  addressesRook,
  looksLikeRequest,
  idleMoment,
  ttlFor,
  type Moment,
} from '../src/worlds/safehouse/voice';
import { persona, replyInstruction } from '../src/worlds/safehouse/persona';
import { active, type SafehouseState } from '../src/worlds/safehouse/state';
import { HOUSE_ID, WANDER_AREA, SURVIVOR_START, contains, inflate } from '../src/shared/safehouseLayout';
import type { WorldCtx, DialogueRequest } from '../src/engine/world';

const inPool = (spoken: string[], moment: Moment, vars = {}) => {
  const pool = renderedPool(moment, vars);
  return spoken.filter((l) => pool.includes(l));
};

test('lines: variables fill in, recent lines are skipped, and pieces are named the way he says them', () => {
  assert.equal(speakName({ id: HOUSE_ID, blueprint: { name: "Rook's house" } }), 'the house');
  assert.equal(speakName({ id: 'fence-3', blueprint: { name: 'Fence section 3' } }), 'the fence');
  assert.equal(speakName({ id: 'abc', blueprint: { name: 'Scrap turret' } }), 'the scrap turret');
  assert.equal(speakName({ id: 'scenery-car', blueprint: { name: "Rook's car" } }), "Rook's car");
  assert.equal(speakName({ id: 'x', blueprint: { name: 'The 55-of-Everything Order Table' } }), 'the 55-of-Everything Order Table');
  assert.equal(speakName({ id: 'x', blueprint: { name: 'A Very Long Bench' } }), 'a Very Long Bench');
  assert.equal(speakName({ id: 'x', blueprint: { name: 'RC car' } }), 'the RC car');
  assert.equal(speakName(undefined), 'that');
  assert.equal(render('who keeps eating {name} man', { name: 'the fence' }), 'who keeps eating the fence man');

  const first = pickLine('work:build', {}, () => 0, []);
  const second = pickLine('work:build', {}, () => 0, [first]);
  assert.notEqual(first, second, 'a line he just said is not drawn again');
  // A template that needs {user} is skipped when nobody asked.
  for (let i = 0; i < 20; i++) {
    const l = pickLine('walk:preempt', {}, () => i / 20, []);
    assert.ok(!/\{|undefined/.test(l), l);
  }
  const vars = { name: 'the fence', user: 'dave', wave: 3, down: 7 };
  for (const moment of Object.keys(LINES) as Moment[]) {
    assert.ok(LINES[moment].length >= 2, `${moment} has a pool`);
    for (const line of renderedPool(moment, vars)) {
      assert.ok(!/[{}]/.test(line), `${moment}: ${line}`);
      assert.ok(!/^[A-Z][a-z]/.test(line) || /^Rook/.test(line), `${moment} is muttering, not a status line: ${line}`);
    }
  }
  assert.equal(ttlFor('hold still'), 4000);
  assert.equal(ttlFor('x'.repeat(200)), 12000);
});

test('who counts as talking to him, and what is quiet-moment material', () => {
  assert.ok(addressesRook('Rook you good?'));
  assert.ok(addressesRook('@rook how many left'));
  assert.ok(!addressesRook('rookie mistake'));
  assert.ok(!looksLikeRequest('rook you alright mate'));
  assert.ok(looksLikeRequest('rook build a turret'));
  assert.ok(looksLikeRequest('Rook can you move the barricade'));
  assert.ok(looksLikeRequest('paint #abc12345 red rook'));
  const base = { canDesign: true, creations: 3, combatPaused: true, phase: 'prep' as const, prepLeftMs: 170000, zombies: 0, hour: 14, rng: () => 0.5 };
  assert.equal(idleMoment(base), 'idle');
  assert.equal(idleMoment({ ...base, creations: 0 }), 'idle:empty');
  assert.equal(idleMoment({ ...base, canDesign: false }), 'idle:paused');
  assert.equal(idleMoment({ ...base, combatPaused: false, prepLeftMs: 30000 }), 'idle:prep');
  assert.equal(idleMoment({ ...base, combatPaused: false, phase: 'wave', zombies: 4 }), 'idle:wave');
  assert.equal(idleMoment({ ...base, hour: 23, rng: () => 0.1 }), 'idle:late');
  assert.equal(idleMoment({ ...base, hour: 23, rng: () => 0.9 }), 'idle');
});

function harness(
  opts: { seedScenery?: boolean; workMs?: number; fixture?: boolean; converse?: boolean; generator?: DesignGenerator } = {},
) {
  let now = 10_000;
  const spoken: string[] = [];
  const dialogue: DialogueRequest[] = [];
  let answer: () => Promise<string | null> = async () => null;
  // Deterministic but varied: line draws, cadence jitter and wander targets all need spread.
  let seed = 7;
  const rng = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  const world = createSafehouseWorld({
    seedScenery: opts.seedScenery ?? false,
    fixture: opts.fixture ?? true,
    generator: opts.generator ?? fixtureGenerator,
    workMs: opts.workMs ?? 2000,
    converse: opts.converse,
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
      dialogue: async (req) => {
        dialogue.push(req);
        return answer();
      },
      moderate: async () => ({ ok: false }),
    },
    tuning: {},
    chatRatePerMin: 0,
    rng,
  };
  const stop = world.start?.(ctx);
  async function step(ms = 2000) {
    now += ms;
    world.tick(ctx, ms);
    await new Promise((r) => setImmediate(r));
  }
  async function until(done: () => boolean, steps = 400) {
    for (let i = 0; i < steps && !done(); i++) await step();
    assert.ok(done(), 'condition reached in time');
  }
  async function chat(text: string, user = 'dave') {
    await world.intents[0].handle(ctx, { id: crypto.randomUUID(), userId: user, username: user, text, ts: now, source: 'dev' }, undefined);
  }
  return {
    world,
    state,
    ctx,
    spoken,
    dialogue,
    step,
    until,
    chat,
    setAnswer(fn: () => Promise<string | null>) {
      answer = fn;
    },
    stop: () => {
      if (stop) stop();
    },
  };
}

test('his own repair round is muttered in his voice; the finish line stays plain', async () => {
  const h = harness({ seedScenery: true, workMs: 500 });
  const fence = h.state.objects.find((o) => o.id === 'fence-3')!;
  fence.health = 100;
  await h.until(() => h.state.objects.find((o) => o.id === 'fence-3')!.health === 240);
  assert.ok(inPool(h.spoken, 'walk:repair', { name: 'the fence' }).length >= 1, JSON.stringify(h.spoken));
  assert.ok(!h.spoken.some((l) => /^Heading over/.test(l)), 'the old narrator line is gone');
  assert.match(h.spoken.at(-1)!, /^Patched up /, 'the completion is a plain status line');
  h.stop();
});

test('on a long viewer build he mutters while hammering; the completion still names who and what', async () => {
  const h = harness({ workMs: 30_000 });
  await h.chat('Build a duck-shaped watchtower');
  assert.equal(h.spoken.at(-1), "Got your idea, dave. It's in the queue.");
  await h.until(() => !h.state.jobs.some(active), 100);
  assert.ok(inPool(h.spoken, 'work:build', { name: 'the duck-shaped watchtower', user: 'dave' }).length >= 1, JSON.stringify(h.spoken));
  assert.equal(h.spoken.at(-1), 'Finished Duck-shaped watchtower, suggested by dave.');
  h.stop();
});

test('idle: he nudges chat for ideas; with the AI paused he offers paints and moves instead', async () => {
  const h = harness();
  for (let i = 0; i < 40; i++) await h.step();
  assert.ok(inPool(h.spoken, 'idle:empty').length >= 1, JSON.stringify(h.spoken));
  assert.equal(inPool(h.spoken, 'idle:paused').length, 0);
  h.spoken.length = 0;
  h.state.generationPaused = true;
  for (let i = 0; i < 60; i++) await h.step();
  assert.ok(inPool(h.spoken, 'idle:paused').length >= 1, JSON.stringify(h.spoken));
  assert.equal(inPool(h.spoken, 'idle').length + inPool(h.spoken, 'idle:empty').length, 0, 'no build nudges while the AI is off');
  // Cadence: a quiet minute is not a monologue.
  assert.ok(h.spoken.length <= 4, `${h.spoken.length} lines in two minutes`);
  h.stop();
});

test('wave warnings are voiced while the panel keeps the plain call; the incoming roster stays plain', async () => {
  const h = harness();
  h.state.combat.paused = false;
  await h.until(() => h.spoken.some((l) => renderedPool('wave:minute', { wave: 1 }).includes(l)), 120);
  assert.equal(h.state.notice, 'One minute until wave 1. Get your defenses up.');
  await h.until(() => h.spoken.some((l) => renderedPool('wave:ten', { wave: 1 }).includes(l)), 60);
  assert.equal(h.state.notice, 'Wave 1 in ten seconds. Brace.');
  await h.until(() => h.spoken.some((l) => /^Wave 1 incoming — 4 walkers\.$/.test(l)), 20);
  assert.ok(!h.spoken.some((l) => /^Wave 1 in ten seconds/.test(l)), 'the plain warning is on the panel, not in his mouth');
  h.stop();
});

test('talking to him by name costs one dialogue call and never queues a job; requests still do', async () => {
  const h = harness({ fixture: false, converse: true });
  h.setAnswer(async () => 'yeah all good mate. fence is holding');
  await h.chat('rook you alright?');
  assert.equal(h.dialogue.length, 1);
  assert.equal(h.dialogue[0].username, 'dave');
  assert.match(h.dialogue[0].instruction, /dave just spoke to you by name/);
  assert.equal(h.spoken.at(-1), 'yeah all good mate. fence is holding');
  assert.equal(h.state.jobs.length, 0);
  assert.equal(h.state.callsRemaining, 19, 'a reply comes out of the allowance');

  await h.chat('rook build a turret at 3,13', 'erin');
  assert.equal(h.dialogue.length, 1, 'a request with his name in it is still a request');
  assert.equal(h.state.jobs.length, 1);

  h.state.generationPaused = true;
  await h.chat('rook you there?', 'fay');
  assert.equal(h.dialogue.length, 1);
  assert.ok(renderedPool('offline', { user: 'fay' }).includes(h.spoken.at(-1)!), h.spoken.at(-1));
  assert.equal(h.state.callsRemaining, 19);
  h.state.generationPaused = false;

  h.setAnswer(async () => null);
  await h.chat('rook?', 'gus');
  assert.ok(renderedPool('missed', { user: 'gus' }).includes(h.spoken.at(-1)!), 'nothing from the model still gets an answer');

  // Two people at once: the second is told to hang on rather than stacking calls.
  let release!: () => void;
  h.setAnswer(() => new Promise((r) => (release = () => r('one at a time please'))));
  const first = h.chat('rook whats the plan', 'hal');
  await new Promise((r) => setImmediate(r));
  await h.chat('rook hello', 'ivy');
  assert.ok(renderedPool('busy', { user: 'ivy' }).includes(h.spoken.at(-1)!), h.spoken.at(-1));
  release();
  await first;
  assert.equal(h.spoken.at(-1), 'one at a time please');
  h.stop();
});

test('waiting on a design he paces the yard instead of freezing, then walks to work from wherever he is', async () => {
  let release!: (r: DesignResponse) => void;
  const design = new Promise<DesignResponse>((r) => (release = r));
  const h = harness({ seedScenery: true, fixture: false, generator: () => design });
  await h.chat('Build a duck-shaped watchtower');
  await h.step();
  assert.equal(h.state.jobs[0].status, 'designing');
  const start = { ...SURVIVOR_START };
  let walking = 0,
    furthest = 0;
  for (let i = 0; i < 40; i++) {
    await h.step();
    const p = h.state.survivor.position;
    if (h.state.survivor.activity === 'walking') walking++;
    furthest = Math.max(furthest, Math.hypot(p.x - start.x, p.z - start.z));
    assert.ok(contains(inflate(WANDER_AREA, 0.6), p), `stays inside the fence: ${JSON.stringify(p)}`);
  }
  assert.ok(walking >= 8, `walks while the design is drawn up (${walking} of 40 ticks)`);
  assert.ok(furthest > 2.5, `actually goes somewhere (${furthest.toFixed(1)} m)`);
  assert.equal(h.state.jobs[0].status, 'designing', 'still waiting');
  assert.ok(inPool(h.spoken, 'wait', { user: 'dave' }).length >= 1, JSON.stringify(h.spoken));
  release(
    await fixtureGenerator(
      { text: 'Build a duck-shaped watchtower', username: 'dave', objects: [] },
      new AbortController().signal,
    ),
  );
  // A short work route can finish inside one 2 s test tick, so watch for leaving 'designing', not for 'walking'.
  await h.until(() => h.state.jobs[0].status !== 'designing', 10);
  assert.ok(['walking', 'building', 'complete'].includes(h.state.jobs[0].status), h.state.jobs[0].status);
  assert.deepEqual(h.state.idlePath, [], 'pacing ends when the work route starts');
  await h.until(() => !h.state.jobs.some(active), 200);
  assert.equal(h.state.objects.filter((o) => !o.fixed).length, 1);
  h.stop();
});

test('a request stuck behind a paused AI does not freeze him either', async () => {
  const h = harness({ seedScenery: true, fixture: false });
  await h.chat('Build a duck-shaped watchtower');
  h.state.generationPaused = true; // paused after admission: the job waits, queued
  let walking = 0;
  for (let i = 0; i < 40; i++) {
    await h.step();
    if (h.state.survivor.activity === 'walking') walking++;
  }
  assert.equal(h.state.jobs[0].status, 'queued');
  assert.ok(walking >= 8, `paces while queued (${walking} of 40 ticks)`);
  h.stop();
});

test('he walks briskly: a straight run in one go, a corner costs a snapshot', async () => {
  const h = harness({ seedScenery: true, workMs: 500 });
  await h.chat('Build a duck-shaped watchtower');
  await h.until(() => !['queued', 'designing'].includes(h.state.jobs[0].status), 10);
  const job = h.state.jobs[0]; // walking, or already building if the whole route fitted in one tick
  const points = [{ ...h.state.survivor.position }, ...job.path.map((p) => ({ ...p }))];
  const runs = points.slice(1).map((p, i) => Math.hypot(p.x - points[i].x, p.z - points[i].z));
  // Each 2 s step covers 6.4 m of a run at 3.2 m/s; reaching a corner ends the step early.
  const budget = runs.reduce((n, r) => n + Math.ceil(r / 6.4), 0);
  let steps = 0;
  while (h.state.jobs[0].status === 'walking' && steps < 100) {
    await h.step();
    steps++;
  }
  assert.equal(h.state.jobs[0].status, 'building');
  assert.ok(steps <= budget, `${steps} steps for ${runs.length} runs of ${runs.map((r) => r.toFixed(1)).join('+')} m (budget ${budget})`);
  h.stop();
});

test('fixture mode never spends a dialogue call on conversation', async () => {
  const h = harness({ fixture: true });
  await h.chat('rook you alright?');
  assert.equal(h.dialogue.length, 0);
  assert.equal(h.state.callsRemaining, 20);
  h.stop();
});

test('persona: the card pins the promises and the state summary carries what he can talk about', () => {
  assert.equal(persona.name, 'Rook');
  assert.equal(persona.idleMutterMs, 0);
  assert.match(persona.systemPrompt, /Never claim a build is finished/);
  assert.match(persona.systemPrompt, /lowercase/);
  assert.match(persona.systemPrompt, /No emoji/);
  assert.match(persona.systemPrompt, /never say or hint that you are an AI/);
  const world = createSafehouseWorld({ seedScenery: true, fixture: true });
  const state = world.createInitialState(0);
  const summary = persona.summarizeState(state);
  assert.match(summary, /standing at the porch/);
  assert.match(summary, /zombies: paused\. wave 1 is next/);
  assert.match(summary, /your house: 100%/);
  assert.match(summary, /community builds: none yet/);
  assert.match(replyInstruction(state, 'dave'), /^dave just spoke to you by name/);
});
