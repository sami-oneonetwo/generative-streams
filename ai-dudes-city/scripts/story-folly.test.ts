// The Folly site (FK-023): with Story on, raising the cordon stands the age's Folly under wraps on its
// plot in the SE corner park; the bar fills on its own (100% in 40 min) and Story (dev) can set it;
// gold's names go on its plaque, first joiners first, up to the cap; no build lands on the plot or the
// crowd's ring; it takes no damage under wraps or unveiled, and no age turn restyles it; Story OFF
// takes it off the map and its lines off the feed, and Story ON puts it back as it was, even after a
// restart, so Story OFF is today's town.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { harness } from './harness';
import { cityOf, setAge } from '../src/worlds/ai-dudes/city';
import { damageBuild } from '../src/worlds/ai-dudes/damage';
import { mayorInput } from '../src/worlds/ai-dudes/mayor';
import { placeJob, reserved } from '../src/worlds/ai-dudes/sim';
import { FOLLY, FOLLY_DEV, follyOf, raiseFolly, tickFolly, unveilFolly } from '../src/worlds/ai-dudes/story/folly';
import { storyDevActions, storyDevButtons } from '../src/worlds/ai-dudes/story/dev';
import { LIMITS, STORY_CAPS, pushFeed, stateSchema, trimStory, type Job } from '../src/worlds/ai-dudes/state';
import { STORY_RECTS, STORY_SITES } from '../src/shared/storyMap';
import { BLOCK_HALF, CITY, PITCH } from '../src/shared/city';
import { footprint, overlaps } from '../src/shared/layout';
import type { DudesScene } from '../src/shared/dudesTypes';
import type { AgentReply } from '../src/worlds/ai-dudes/agent';
import type { SafehouseObject } from '../src/shared/objectTypes';

/** A town with a chatter about and Story on (or off). */
async function storyTown(story = true, reply?: (turn: { messages: unknown[] }) => AgentReply) {
  const hs = harness(reply ? { reply } : {});
  hs.h.state.ai.story = story;
  await hs.say('kim', 'hi');
  await hs.tick(1000);
  const view = () => (hs.world.buildScene(hs.h.state, { now: hs.h.now } as never) as unknown as DudesScene).town!;
  const ctx = () => ({ state: hs.h.state, now: hs.h.now, log: (l: string) => void hs.h.logs.push(l) }) as never;
  const dev = (id: keyof typeof FOLLY_DEV, value?: number | string) => FOLLY_DEV[id](ctx(), value);
  const folly = () => cityOf(hs.h.state).story?.folly;
  return { ...hs, view, dev, folly };
}
const rectOf = (o: SafehouseObject) => footprint(o.driven?.at ?? o.position, o.footprint.width, o.footprint.depth);
const onStoryGround = (o: SafehouseObject) => STORY_RECTS.some((r) => overlaps(rectOf(o), r));
const loads = (state: unknown) => stateSchema.safeParse(JSON.parse(JSON.stringify(state))).success;

test('Raise the cordon: the Folly stands under wraps on its plot in the SE corner park, at 0%', async () => {
  const { h, view, dev, folly } = await storyTown();
  assert.equal(view().folly, undefined, 'no cordon yet, no Folly on the page');
  assert.equal(dev('folly-raise'), undefined);
  const o = follyOf(h.state)!;
  assert.ok(o, 'a Folly stands');
  assert.equal(o.folly, 'stone');
  assert.ok(o.silhouette && o.civic, 'under wraps, and the town’s');
  assert.equal(o.blueprint.name, 'The Big Hut');
  assert.deepEqual(o.position, STORY_SITES.folly.at, 'on its plot');
  assert.equal(h.state.objects.filter((x) => x.folly).length, 1, 'one of it');
  // The SE corner block is a park: green inside its pavement, no lots.
  const park = { x: PITCH, z: PITCH, half: BLOCK_HALF - CITY.sidewalk };
  const r = rectOf(o);
  assert.ok(r.minX > park.x - park.half && r.maxX < park.x + park.half && r.minZ > park.z - park.half && r.maxZ < park.z + park.half, `inside the SE park: ${JSON.stringify(r)}`);
  assert.ok(o.footprint.width <= FOLLY.box.width && o.footprint.depth <= FOLLY.box.depth, 'inside its box, with room for the cordon');
  assert.ok(Math.max(o.footprint.width, o.footprint.depth) > 12, `Folly-sized: ${JSON.stringify(o.footprint)}`);
  // FK-007's design once it lands; until then the age's catalogue hut stands in.
  const spec = path.join(import.meta.dirname, '..', 'design', 'spec');
  const file = existsSync(path.join(spec, 'folly', 'stone.json')) ? path.join(spec, 'folly', 'stone.json') : path.join(spec, 'stone', 'home.json');
  assert.equal(o.blueprint.parts.length, Math.min(160, JSON.parse(readFileSync(file, 'utf8')).parts.length), `the parts of ${path.basename(file)}`);
  assert.deepEqual(folly(), { age: 0, pct: 0, startedAt: h.now, plaque: [] });
  assert.deepEqual(view().folly, { pct: 0, plaque: [] }, 'the page has the gold bar at 0');
  assert.ok(h.state.feed.some((f) => /cordon goes up .*KEEP OUT\. SOMETHING AMAZING\./.test(f.text)));
  assert.match(String(dev('folly-raise')), /already up: The Big Hut is under wraps/, 'once is enough');
  assert.ok(loads(h.state), 'the save takes it');
});

test('Story (dev) on /admin: Raise the cordon, Folly → 100 and Re-tarp do it (none says "not built yet")', async () => {
  const { h, folly } = await storyTown();
  const press = (id: string, value?: number) => storyDevActions().find((a) => a.id === id)!.run({ state: h.state, now: h.now, log: (l: string) => void h.logs.push(l) } as never, value);
  assert.ok(storyDevButtons().filter((b) => b.group === 'folly').every((b) => !b.card), 'all wired');
  assert.equal(press('folly-raise'), undefined);
  assert.ok(follyOf(h.state)?.silhouette, 'up, under wraps');
  assert.equal(press('folly-progress', 100), undefined);
  assert.equal(folly()!.pct, 100);
  unveilFolly(h.state, h.now);
  assert.equal(press('folly-retarp'), undefined);
  assert.ok(follyOf(h.state)?.silhouette, 'under wraps again');
  assert.match(String(press('folly-raise')), /already up/);
});

test('Story OFF: nothing to raise, set or re-tarp; no Folly, no reserved ground', async () => {
  const { h, view, dev, folly } = await storyTown(false);
  for (const id of ['folly-raise', 'folly-progress', 'folly-retarp'] as const) assert.equal(dev(id, 50), 'Story is off');
  assert.equal(follyOf(h.state), undefined);
  assert.equal(folly(), undefined);
  assert.equal(view().folly, undefined);
  assert.deepEqual(reserved(h.state), [], "only builds in flight, as today");
});

test('the bar climbs on its own: 15% after 6 minutes, full at 40 and no further; folly-progress sets it and the timer carries on', async () => {
  const { h, tick, view, dev, folly } = await storyTown();
  assert.match(String(dev('folly-progress', 50)), /raise it first/);
  dev('folly-raise');
  await tick(6 * 60_000, 5000);
  assert.ok(Math.abs(folly()!.pct - 15) < 0.5, `6/40 of the way: ${folly()!.pct}`);
  assert.equal(view().folly!.pct, Math.floor(folly()!.pct), 'whole percent on the page');
  await tick(34 * 60_000, 5000);
  assert.equal(folly()!.pct, 100, 'full at 40 minutes');
  await tick(60_000, 5000);
  assert.equal(folly()!.pct, 100, 'and no further');
  assert.equal(dev('folly-progress', 50), undefined);
  assert.equal(view().folly!.pct, 50);
  await tick(4 * 60_000, 5000);
  assert.ok(Math.abs(folly()!.pct - 60) < 0.5, `on from 50: ${folly()!.pct}`);
  assert.equal(dev('folly-progress', 100), undefined);
  assert.equal(view().folly!.pct, 100, 'folly-progress 100 → 100%');
  assert.equal(dev('folly-progress', 140), undefined);
  assert.equal(folly()!.pct, 100, 'never past 100');
  assert.match(String(dev('folly-progress', 'lots')), /percentage/);
  assert.ok(h.logs.some((l) => /the Folly is at 100%/.test(l)), 'logged');
});

test("gold's names go on the plaque, first joiners first, up to its cap; red's never do", async () => {
  const { h, say, tick, view, dev, folly } = await storyTown();
  dev('folly-raise');
  for (const n of ['ann', 'bo', 'cy', 'di']) await say(n, 'hi');
  const dude = (n: string) => h.state.dudes.find((d) => d.name === n)!;
  const story = cityOf(h.state).story!;
  // Joined in this order: di, bo, then ann; cy is red.
  story.sideLog = [
    { at: h.now - 3000, id: dude('di').id, name: 'di', side: 'gold' },
    { at: h.now - 2000, id: dude('bo').id, name: 'bo', side: 'gold' },
    { at: h.now - 1500, id: dude('cy').id, name: 'cy', side: 'red' },
    { at: h.now - 1000, id: dude('ann').id, name: 'ann', side: 'gold' },
  ];
  for (const n of ['ann', 'bo', 'di']) Object.assign(dude(n), { side: 'gold', sideAge: 0 });
  Object.assign(dude('cy'), { side: 'red', sideAge: 0 });
  await tick(1000);
  assert.deepEqual(folly()!.plaque, ['di', 'bo', 'ann']);
  assert.deepEqual(view().folly!.plaque, ['di', 'bo', 'ann'], 'on the page');
  await tick(5000);
  assert.deepEqual(folly()!.plaque, ['di', 'bo', 'ann'], 'each name once');
  // A crowd joins gold: the plaque takes the first 40 and keeps them; long names are clipped.
  for (let i = 0; i < 45; i++) await say(`gold${String(i).padStart(2, '0')}${i === 0 ? 'x'.repeat(50) : ''}`, 'gold');
  for (const d of h.state.dudes) if (/^gold/.test(d.name)) Object.assign(d, { side: 'gold', sideAge: 0 });
  await tick(1000);
  assert.equal(folly()!.plaque.length, STORY_CAPS.plaque, 'capped');
  assert.deepEqual(folly()!.plaque.slice(0, 3), ['di', 'bo', 'ann'], 'the first carved stay');
  assert.ok(folly()!.plaque.every((n) => n.length <= 40), 'names fit the plaque');
  assert.deepEqual(trimStory(h.state), [], 'nothing for the save guard to drop');
  assert.ok(loads(h.state));
  assert.ok(!folly()!.plaque.includes('cy'), 'red is never on it');
});

test("no build lands on the Folly's plot or the crowd's ring while Story is on", async () => {
  const { h, tick } = await storyTown();
  const plot = STORY_SITES.folly.at;
  assert.deepEqual(reserved(h.state).slice(-2), STORY_RECTS, 'the story ground is reserved');
  // A build with no lot (an off-lot one, as older saves have) anchored on the plot goes up beside it.
  const job = { id: 'jx', dudeId: h.state.dudes[0].id, kind: 'build', request: 'a big tent', anchor: { ...plot }, status: 'ready', createdAt: h.now, blueprint: { name: 'Big tent', description: '', parts: [{ shape: 'box', position: [0, 1, 0], size: [6, 2, 6], rotation: [0, 0, 0], color: '#aa8866' }] } } as Job;
  placeJob(h.state, job);
  assert.ok(!STORY_RECTS.some((r) => overlaps(footprint(job.position!, job.footprint!.width, job.footprint!.depth), r)), `off the plot: ${JSON.stringify(job.position)}`);
  // The head clicks a build onto the plot, and onto the ring: both go up off them.
  mayorInput(h.state, { t: 'build', what: 'a garden fountain', at: plot }, h.now);
  mayorInput(h.state, { t: 'build', what: 'a little statue', at: STORY_SITES.crowd.at }, h.now);
  await tick(20_000);
  const built = h.state.objects.filter((o) => /fountain|statue/i.test(o.blueprint.name));
  assert.equal(built.length, 2, 'both went up');
  assert.ok(built.every((o) => !onStoryGround(o)), `none on the story ground: ${JSON.stringify(built.map((o) => o.position))}`);
  // The same click with Story off lands where it was clicked, as today.
  h.state.ai.story = false;
  mayorInput(h.state, { t: 'build', what: 'a garden fountain', at: plot }, h.now);
  await tick(20_000);
  const today = h.state.objects.filter((o) => /fountain/i.test(o.blueprint.name)).at(-1)!;
  assert.ok(onStoryGround(today), 'Story off: the plot is just a park');
});

test('Raising the cordon makes room: a build already on the plot moves off it, and nobody stands inside', async () => {
  const { h, dev } = await storyTown();
  const kim = h.state.dudes[0];
  kim.position = { ...STORY_SITES.folly.at };
  const shed: SafehouseObject = {
    id: 'bshed',
    revision: 1,
    blueprint: { name: 'Shed', description: '', parts: [{ shape: 'box', position: [0, 1, 0], size: [3, 2, 3], rotation: [0, 0, 0], color: '#886644' }] },
    position: { x: STORY_SITES.folly.at.x + 4, z: STORY_SITES.folly.at.z },
    footprint: { width: 3, depth: 3 },
    createdBy: 'kim',
    editedBy: 'kim',
    createdAt: h.now,
    owner: kim.id,
  };
  h.state.objects.push(shed);
  dev('folly-raise');
  assert.ok(h.state.objects.includes(shed), 'still there');
  assert.ok(!onStoryGround(shed), `moved off the story ground: ${JSON.stringify(shed.position)}`);
  const o = follyOf(h.state)!;
  const r = rectOf(o);
  assert.ok(!(kim.position.x > r.minX && kim.position.x < r.maxX && kim.position.z > r.minZ && kim.position.z < r.maxZ), 'kim stepped out');
});

test("under wraps or unveiled, a chatter's weapon does no damage to the Folly", async () => {
  let script: AgentReply['actions'] = [];
  const { h, say, tick, dev, folly } = await storyTown(true, (turn) => ({ actions: turn.messages.length ? script : [] }));
  dev('folly-raise');
  const o = follyOf(h.state)!;
  const parts = JSON.stringify(o.blueprint.parts);
  assert.equal(damageBuild(h.state, o, 5000, { name: 'kim' }, h.now), undefined, 'under wraps: nothing');
  assert.equal(unveilFolly(h.state, h.now), undefined, 'the unveil beat');
  assert.equal(o.silhouette, undefined, 'the tarp is off');
  assert.equal(folly()!.pct, 100, 'and it is done');
  assert.match(String(unveilFolly(h.state, h.now)), /already unveiled/);
  assert.equal(damageBuild(h.state, o, 5000, { name: 'kim' }, h.now), undefined, 'unveiled: still nothing');
  // kim kicks it, then bombs it: a chatter can find it now, and it shrugs both off.
  for (const how of ['kick', 'bomb'] as const) {
    script = [{ do: 'attack', target: 'The Big Hut', with: how }];
    await say('kim', `${how} the big hut`);
    await tick(500);
    assert.equal(h.state.dudes[0].attack?.targetId, o.id, `kim goes for it (${how})`);
    await tick(30_000);
  }
  // And the head's rocket.
  mayorInput(h.state, { t: 'move', x: o.position.x, z: o.position.z + 14, facing: Math.PI, moving: false }, h.now);
  mayorInput(h.state, { t: 'arm', weapon: 'rocket' }, h.now);
  mayorInput(h.state, { t: 'fire', aim: o.position }, h.now);
  await tick(2000);
  assert.equal(o.health, undefined, 'not a scratch');
  assert.equal(o.destroyedAt, undefined);
  assert.equal(JSON.stringify(o.blueprint.parts), parts, 'not a piece off');
  assert.ok(!h.state.effects?.some((e) => e.kind === 'hit' && e.objectId === o.id), 'no hit drawn');
  // Re-tarp for another Unveiling.
  assert.equal(dev('folly-retarp'), undefined);
  assert.ok(o.silhouette, 'under wraps again');
  assert.match(String(dev('folly-retarp')), /already under wraps/);
});

test("an age turn keeps the Folly as it was built; the next age's goes up in its place (one plot in M1)", async () => {
  const { h, view, dev } = await storyTown();
  dev('folly-raise');
  const stone = follyOf(h.state)!;
  const parts = JSON.stringify(stone.blueprint.parts);
  unveilFolly(h.state, h.now);
  setAge(h.state, 1, h.now);
  assert.ok(!cityOf(h.state).restyle!.ids.includes(stone.id), 'never restyled');
  assert.ok(h.state.objects.includes(stone) && JSON.stringify(stone.blueprint.parts) === parts, 'the evidence stands');
  assert.equal(view().folly, undefined, "Bronze's cordon isn't up yet");
  assert.equal(dev('folly-raise'), undefined);
  const bronze = follyOf(h.state)!;
  assert.equal(bronze.folly, 'bronze');
  assert.equal(bronze.blueprint.name, 'The Golden Me');
  assert.ok(!h.state.objects.includes(stone), 'Stone’s made way on the one M1 plot');
  assert.deepEqual(view().folly, { pct: 0, plaque: [] }, "Bronze's bar from 0");
});

test('Story OFF takes the Folly off the map, Story ON puts it back as it was; after a restart too, unveiled (its plaque closed) or under wraps', async () => {
  const { h, tick, view, dev, folly } = await storyTown();
  dev('folly-raise');
  dev('folly-progress', 30);
  folly()!.plaque.push('di');
  const o = follyOf(h.state)!;
  unveilFolly(h.state, h.now);
  dev('folly-progress', 30); // a Folly can be shown at any count from Story (dev)
  h.state.ai.story = false;
  await tick(1000);
  assert.ok(!h.state.objects.some((x) => x.folly), 'Story OFF: off the map');
  assert.equal(view().folly, undefined, 'and off the page');
  assert.deepEqual(reserved(h.state), [], 'its plot is just a park again');
  assert.equal(folly()!.pct, 30, 'its count waits');
  assert.ok(loads(h.state));
  await tick(60_000, 5000);
  assert.equal(folly()!.pct, 30, 'and does not climb with Story off');
  h.state.ai.story = true;
  await tick(1000);
  assert.equal(follyOf(h.state), o, 'Story ON: the same Folly back');
  assert.equal(o.silhouette, undefined, 'still unveiled');
  assert.deepEqual(view().folly, { pct: 30, plaque: ['di'] });
  // A restart while Story is off keeps the count, the plaque and the unveiling, not the build: Story ON stands it again as it was.
  const restart = async () => {
    h.state.ai.story = false;
    await tick(1000);
    h.state = stateSchema.parse(JSON.parse(JSON.stringify(h.state)));
    await tick(1000);
    h.state.ai.story = true;
    await tick(1000);
    return follyOf(h.state)!;
  };
  let again = await restart();
  assert.ok(again && !again.silhouette, 'back up, still unveiled');
  assert.deepEqual(again.position, STORY_SITES.folly.at);
  assert.equal(h.state.objects.filter((x) => x.folly).length, 1, 'one of it');
  assert.equal(folly()!.pct, 30);
  assert.deepEqual(folly()!.plaque, ['di']);
  // Unveiled, its plaque is closed and its bar stands still: a gold joiner now isn't carved.
  Object.assign(h.state.dudes[0], { side: 'gold', sideAge: 0 });
  await tick(60_000, 5000);
  assert.deepEqual(folly()!.plaque, ['di'], 'nothing carved after the Unveiling');
  assert.equal(folly()!.pct, 30, 'the bar stands still');
  // Re-tarped, it comes back under wraps after a restart, and the bar and the plaque carry on.
  assert.equal(dev('folly-retarp'), undefined);
  again = await restart();
  assert.ok(again && again.silhouette, 'back up, under wraps');
  assert.equal(Math.floor(folly()!.pct), 30);
  assert.deepEqual(folly()!.plaque, ['di', 'kim']);
});

test("Story OFF takes the Folly's own lines off the feed, and leaves the rest", async () => {
  const { h, tick, dev } = await storyTown();
  dev('folly-raise');
  pushFeed(h.state, h.now, 'kim built The Big Hut');
  unveilFolly(h.state, h.now);
  setAge(h.state, 1, h.now);
  dev('folly-raise');
  const lines = () => h.state.feed.map((f) => f.text);
  assert.ok(lines().some((t) => /cordon goes up/.test(t)) && lines().some((t) => / unveils The Big Hut!$/.test(t)) && lines().some((t) => /^The Big Hut comes down to make way for The Golden Me$/.test(t)));
  const before = lines().length;
  h.state.ai.story = false;
  await tick(1000);
  assert.ok(!lines().some((t) => /cordon goes up| unveils The Big Hut!|make way for/.test(t)), `no story lines: ${JSON.stringify(lines())}`);
  assert.ok(lines().includes('kim built The Big Hut'), "a chatter's own build of that name stays");
  assert.equal(lines().length, before - 4, 'two cordons, one unveil, one making way');
});

test('a full town: no cordon goes up, and Story ON puts nothing back past the save’s limit', async () => {
  const { h, dev } = await storyTown();
  const filler = (i: number): SafehouseObject => ({
    id: `bfill${i}`,
    revision: 1,
    blueprint: { name: 'Post', description: '', parts: [{ shape: 'box', position: [0, 0.5, 0], size: [0.3, 1, 0.3], rotation: [0, 0, 0], color: '#886644' }] },
    position: { x: -40 + (i % 40) * 0.5, z: -40 + Math.floor(i / 40) * 0.5 },
    footprint: { width: 0.3, depth: 0.3 },
    createdBy: 'kim',
    editedBy: 'kim',
    createdAt: h.now,
  });
  const fill = () => {
    for (let i = 0; h.state.objects.length < LIMITS.objects; i++) h.state.objects.push(filler(i));
  };
  const switchTo = (on: boolean) => {
    h.state.ai.story = on;
    tickFolly(h.state, 100, h.now);
  };
  const full = h.state.objects.length;
  fill();
  assert.equal(dev('folly-raise'), 'The town is full: no room for the Folly');
  assert.equal(follyOf(h.state), undefined);
  h.state.objects = h.state.objects.slice(0, full);
  assert.equal(dev('folly-raise'), undefined);
  switchTo(false);
  fill();
  switchTo(true);
  assert.equal(h.state.objects.length, LIMITS.objects, 'not one past the limit');
  assert.equal(follyOf(h.state), undefined, 'no room for it');
  assert.ok(loads(h.state), 'the save takes it');
  h.state.objects = h.state.objects.slice(0, full);
  switchTo(false);
  switchTo(true);
  assert.ok(follyOf(h.state)?.silhouette, 'room again: back up under wraps');
});

test('raising the cordon moves a build on its way up on the plot (placed while Story was off), and its builder goes there', async () => {
  const { h, tick, dev } = await storyTown(false);
  const kim = h.state.dudes[0];
  const job = { id: 'jtent', dudeId: kim.id, kind: 'build', request: 'a big tent', anchor: { ...STORY_SITES.folly.at }, status: 'ready', createdAt: h.now, blueprint: { name: 'Big tent', description: '', parts: [{ shape: 'box', position: [0, 1, 0], size: [6, 2, 6], rotation: [0, 0, 0], color: '#aa8866' }] } } as Job;
  placeJob(h.state, job);
  const onPlot = () => overlaps(footprint(job.position!, job.footprint!.width, job.footprint!.depth), STORY_SITES.folly.rect);
  assert.ok(onPlot(), 'Story off: placed on the park, as today');
  h.state.jobs.push(job);
  await tick(500);
  assert.equal(job.status, 'walking', 'kim is on the way');
  h.state.ai.story = true;
  await tick(500);
  assert.equal(dev('folly-raise'), undefined);
  assert.ok(!onPlot(), `moved off the plot: ${JSON.stringify(job.position)}`);
  assert.equal(job.status, 'ready', 'kim starts over at the new spot');
  await tick(60_000);
  const tent = h.state.objects.find((o) => o.blueprint.name === 'Big tent');
  assert.ok(tent && !overlaps(rectOf(tent), rectOf(follyOf(h.state)!)), `the tent went up beside the Folly, not in it: ${JSON.stringify(tent?.position)}`);
});

test('raiseFolly refuses with Story off and changes nothing', () => {
  const { h } = harness();
  const before = JSON.stringify(h.state);
  assert.equal(raiseFolly(h.state, h.now), 'Story is off');
  assert.equal(JSON.stringify(h.state), before);
});
