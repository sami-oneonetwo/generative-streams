// Ages (docs/ages.md, slice 1): the town lives in an age; everything is designed, named, dressed and
// drawn that age's way; a build from another age gets a deterministic colour swap; an old save keeps
// the Modern look it had; the operator can set the age.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AGES, MODERN, ageStyle, dressFor, parseAge, restyleColour } from '../src/shared/ages';
import { VENUE_KINDS } from '../src/shared/city';
import { ageOf, cityOf, headName, setAge } from '../src/worlds/ai-dudes/city';
import { mayorInput } from '../src/worlds/ai-dudes/mayor';
import { fixtureDesign } from '../src/worlds/ai-dudes/fixtures';
import { stateSchema } from '../src/worlds/ai-dudes/state';
import type { AgentReply } from '../src/worlds/ai-dudes/agent';
import type { DesignFn, DesignInput } from '../src/worlds/ai-dudes/design';
import type { DudeLook } from '../src/shared/dudesTypes';
import { harness } from './harness';

const hsl = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255,
    g = ((n >> 8) & 255) / 255,
    b = (n & 255) / 255;
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b),
    l = (max + min) / 2;
  return { s: max === min ? 0 : l > 0.5 ? (max - min) / (2 - max - min) : (max - min) / (max + min), l };
};

test('six ages in order, each with a name for every kind of place, a title for the head and a design direction', () => {
  assert.deepEqual(
    AGES.map((a) => a.id),
    ['stone', 'bronze', 'medieval', 'industrial', 'modern', 'future'],
  );
  for (const a of AGES) {
    for (const k of VENUE_KINDS) assert.ok(a.venues[k], `${a.id} names ${k}`);
    assert.ok(a.head.title && a.design.length > 40 && a.living, a.id);
  }
  assert.equal(ageStyle(0).venues.cafe, 'fire pit');
  assert.equal(ageStyle(MODERN).head.title, 'Mayor');
  assert.equal(parseAge('Bronze'), 1);
  assert.equal(parseAge('the middle ages'), 2);
  assert.equal(parseAge('5'), 5);
  assert.equal(parseAge('the wasteland'), 5);
  assert.equal(parseAge('jurassic'), undefined);
});

test('the colour swap: the Modern age leaves colours alone, other ages pull them their way, the same every time', () => {
  assert.deepEqual(restyleColour('#e0523f', MODERN), { color: '#e0523f', glow: false });
  const stone = restyleColour('#2f7fff', 0);
  assert.equal(stone.color, restyleColour('#2f7fff', 0).color, 'deterministic');
  assert.ok(hsl(stone.color).s <= 0.43, `the Stone Age is earthy (${stone.color})`);
  const waste = restyleColour('#ff2040', 5);
  assert.ok(hsl(waste.color).s <= 0.39, `the Wasteland is dusty and faded (${waste.color})`);
  assert.equal(waste.glow, false, 'and nothing glows');
  assert.equal(restyleColour('not a colour', 0).color, 'not a colour', 'nonsense passes through');
});

test('what people wear: colours swapped like a build, a hat from the period, skin and hair their own', () => {
  const look: DudeLook = { skin: '#c68642', shirt: '#2f7fff', pants: '#222222', hair: '#111111', hat: 'propeller', hatColor: '#ff0000', accessory: 'glasses', accessoryColor: '#00ff00', height: 1, build: 1 };
  const stone = dressFor(look, 0);
  assert.equal(stone.skin, look.skin);
  assert.equal(stone.hair, look.hair);
  assert.equal(stone.hat, 'headband', 'no propeller hats in the Stone Age');
  assert.notEqual(stone.shirt, look.shirt);
  assert.deepEqual(dressFor(look, MODERN), look, 'today they wear what they chose');
  assert.equal(dressFor({ ...look, hat: 'crown' }, 2).hat, 'crown', 'a crown is fine in the Middle Ages');
});

test('a new town starts in the Stone Age; a save from before ages keeps its Modern look', async () => {
  const { h, say, tick } = harness();
  assert.equal(ageOf(h.state), 0);
  // A save from before ages: a city with no age and builds standing.
  await say('kim', 'hi');
  await tick(5000);
  const old = JSON.parse(JSON.stringify(h.state));
  delete old.city.age;
  old.objects.push({ ...structuredClone(old.objects[0] ?? {}), id: 'b-old', revision: 1, blueprint: { name: 'Old cafe', description: 'from before', parts: [{ shape: 'box', position: [0, 0.5, 0], size: [1, 1, 1], rotation: [0, 0, 0], color: '#ff0000' }] }, position: { x: 10, z: 10 }, footprint: { width: 1, depth: 1 }, createdBy: 'kim', editedBy: 'kim', createdAt: 1 });
  const parsed = stateSchema.parse(old);
  assert.equal(ageOf(parsed), MODERN);
});

test('the age reaches the design call, the agent, the build, the Mayor and the save', async () => {
  const designs: DesignInput[] = [];
  const design: DesignFn = (input, signal) => (designs.push(input), fixtureDesign(input, signal));
  let script: AgentReply['actions'] = [];
  const { h, say, tick, world } = harness({ design, reply: (turn) => ({ actions: turn.messages.length ? script : [] }) });
  script = [{ do: 'build', what: 'a skyscraper café', kind: 'cafe' }];
  await say('kim', 'build me a skyscraper cafe');
  await tick(80_000);
  // The designer is told how the Stone Age makes things, and what a café is then.
  assert.ok(designs[0]?.age?.startsWith('The Stone Age'), `age in the design call (${designs[0]?.age?.slice(0, 30)})`);
  assert.equal(designs[0]?.kind, 'fire pit (a café)');
  // The agent lives in it, and knows what the Mayor is called now.
  const town = JSON.parse(h.turns.at(-1)!.content).town;
  assert.match(town.age, /^The Stone Age\..*Chief/);
  // What went up was made in the Stone Age, and the save keeps that.
  const cafe = h.state.objects.find((o) => o.venue === 'cafe');
  assert.equal(cafe?.age, 0);
  const saved = stateSchema.parse(JSON.parse(JSON.stringify(h.state)));
  assert.equal(saved.objects.find((o) => o.id === cafe!.id)?.age, 0);
  assert.equal(cityOf(saved).age, 0);
  // The Mayor is the Chief, dressed for it; in the Middle Ages the King.
  mayorInput(h.state, { t: 'move', x: 5, z: 5, facing: 0, moving: false }, h.now);
  const scene = () => world.buildScene(h.state, { now: h.now } as never);
  let mayor = scene().dudes.find((d) => d.mayor)!;
  assert.equal(mayor.name, 'The Chief');
  assert.equal(mayor.look?.hat, 'headband');
  assert.equal(scene().town?.head, 'The Chief');
  setAge(h.state, 2, h.now);
  mayor = scene().dudes.find((d) => d.mayor)!;
  assert.equal(mayor.name, 'The King');
  assert.equal(mayor.look?.hat, 'crown');
  assert.equal(headName(h.state), 'The King');
  assert.equal(scene().town?.age, 2);
  assert.ok(h.state.feed.some((f) => /in the Middle Ages now/.test(f.text)), 'the feed says so');
  // A bit aimed at "the King" finds the Mayor.
  script = [{ do: 'bit', caption: 'bows to the King', to: 'the King', steps: [{ pose: 'bow', seconds: 2 }] }];
  await say('kim', 'bow to the king');
  await tick(1000);
  assert.ok(!h.state.dudes[0].lastError?.includes('not out and about'), h.state.dudes[0].lastError);
});

test('the operator sets the age by name; nonsense is refused', () => {
  const { h, world, ctx } = harness();
  const action = world.adminActions!.find((a) => a.id === 'set-age')!;
  action.run(ctx, 'future');
  assert.equal(ageOf(h.state), 5);
  assert.equal(action.run(ctx, 'future'), undefined, 'a switch that happens reports no refusal');
  const refused = action.run(ctx, 'jurassic');
  assert.equal(ageOf(h.state), 5);
  assert.match(String(refused), /no age called/i, 'the refusal goes back to the dashboard');
  assert.ok(h.logs.some((l) => /no age called/i.test(l)));
});

test('the sandbox world: age themes off makes builds in no age, as asked, with everyday names; on again remakes them for the age', async () => {
  const inputs: DesignInput[] = [];
  const design: DesignFn = async (input, signal) => (inputs.push(input), fixtureDesign(input, signal));
  let script: AgentReply['actions'] = [];
  const { h, world, ctx, say, tick } = harness({ design, reply: (turn) => ({ actions: turn.messages.length ? script : [] }) });
  setAge(h.state, 0, h.now);
  const run = (id: string) => world.adminActions!.find((a) => a.id === id)!.run(ctx, '');
  run('themes-off');
  assert.equal(h.state.ai.themes, false);
  assert.equal(h.state.ai.caravan, false, 'the caravan stops too');
  script = [{ do: 'build', what: 'a neon pink spaceship café', kind: 'cafe' }];
  await say('kim', 'build a neon pink spaceship cafe');
  await tick(80_000);
  const cafe = h.state.objects.find((o) => o.venue === 'cafe')!;
  assert.ok(cafe.free && cafe.age === undefined, 'made in no age');
  assert.match(inputs.at(-1)!.age ?? '', /^Sandbox: no age and no theme/);
  assert.match(inputs.at(-1)!.kind ?? '', /café/, 'everyday names, not "fire pit"');
  const scene = () => world.buildScene(h.state, { now: h.now } as never);
  assert.equal(scene().town?.sandbox, true);
  assert.equal(scene().town?.head, 'The Mayor');
  assert.equal(run('caravan-on') !== undefined, true, 'no caravan while the themes are off');
  run('themes-on');
  assert.equal(scene().town?.sandbox, undefined);
  await tick(5_000);
  assert.ok(h.state.jobs.some((j) => j.restyle === 0 && j.targetId === cafe.id) || cafe.age === 0, 'the café is remade for the Stone Age');
});

test('restyles: the prompt keeps "same layout" inside the 300-character cut, and the town’s own landmarks keep their age', async () => {
  const inputs: DesignInput[] = [];
  const design: DesignFn = async (input, signal) => (inputs.push(input), fixtureDesign(input, signal));
  let script: AgentReply['actions'] = [];
  const { h, say, tick } = harness({ design, reply: (turn) => ({ actions: turn.messages.length ? script : [] }) });
  setAge(h.state, 0, h.now);
  script = [{ do: 'build', what: `a cosy hut ${'with a very long and winding description of every beam and stone '.repeat(6)}`, kind: 'home' }];
  await say('kim', 'build me a hut');
  await tick(80_000);
  const hut = h.state.objects.find((o) => o.venue === 'home')!;
  hut.blueprint.description = 'x'.repeat(400);
  h.state.objects.push({ ...hut, id: 'civic1', civic: true, plot: undefined, owner: undefined, position: { x: 9, z: 9 } });
  h.state.objects.push({ ...hut, id: 'wonder1', civic: true, wonder: 0, plot: 'wonder', owner: undefined, position: { x: 0, z: 0 } });
  setAge(h.state, 1, h.now);
  assert.deepEqual(cityOf(h.state).restyle?.ids, [hut.id], 'only the chatter’s hut is queued');
  await tick(30_000);
  const req = inputs.find((i) => /^Remake/.test(i.request))?.request ?? '';
  assert.ok(req.length <= 300 && /same thing, purpose, size and layout/.test(req), req);
  assert.equal(h.state.objects.find((o) => o.id === 'wonder1')!.age, 0, 'the Wonder keeps its own age');
});

test('scene lines fill in their words, and a line with nothing to say is skipped', async () => {
  const { SCENES, fillLine, sceneLine } = await import('../src/shared/scenes');
  const vars = { head: 'The Chief', wonder: 'the Furnace', age: 'the Bronze Age', heroes: '' };
  assert.equal(fillLine(SCENES.ageTurn.lines[0].text, vars), 'I declare the Furnace open!');
  const heroes = SCENES.ageTurn.lines.find((l) => l.text === '{heroes}')!;
  assert.equal(sceneLine(SCENES.ageTurn, heroes.at + 10, vars), undefined, 'no heroes, no line');
  assert.ok(SCENES.ageTurn.lines.some((l) => l.title), 'a title card');
});
