// Today's caravan scenes through the show runtime (FK-127): with Story on, the opening, the Crossing and
// the age turn tick from tickShow, not tickCaravan, so they play with nobody awake and the caravan off,
// and their beats find the cast by role, not by place in the caravan. Story (dev) plays all three: the
// Crossing crosses for real while the band waits across the river, the age turn is a look. A caravan
// scene that comes up under a story scene waits for it; one that breaks ends with an alert. Story OFF
// is today's game (scripts/opening.test.ts, caravan.test.ts).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { harness } from './harness';
import { ageOf, cityOf } from '../src/worlds/ai-dudes/city';
import { skipVisit } from '../src/worlds/ai-dudes/caravan';
import { AWAKE_MS, awake } from '../src/worlds/ai-dudes/sim';
import { castTownie } from '../src/worlds/ai-dudes/story/cast';
import { playShow } from '../src/worlds/ai-dudes/story/show';
import { SCENES, STEP_FORWARD, STRANDED, type SceneId } from '../src/shared/scenes';
import { STORY_SCENES } from '../src/shared/storyScenes';
import type { DudesScene } from '../src/shared/dudesTypes';

/** Two chatters have come, so the Stone caravan waits across the river; Story on, the cast are the band. */
async function storyTown() {
  const hs = harness({ town: true });
  for (const n of ['kim', 'lee']) await hs.say(n, 'hi');
  await hs.tick(2000);
  hs.h.state.ai.story = true;
  await hs.tick(1000);
  const alerts: string[] = [];
  const log = hs.ctx.log;
  hs.ctx.log = (line, level) => {
    if (level === 'alert') alerts.push(line);
    log(line, level);
  };
  const action = (id: string) => hs.world.adminActions!.find((a) => a.id === id)!;
  return {
    ...hs,
    alerts,
    s: hs.h.state,
    run: (id: string, value?: string) => action(id).run(hs.ctx, value) || undefined,
    view: () => hs.world.buildScene(hs.h.state, { now: hs.h.now } as never) as unknown as DudesScene,
  };
}

test('story-play crossing plays with nobody awake and the caravan off: the band crosses, the beat finds Wren by role', async () => {
  const t = await storyTown();
  const cv = cityOf(t.s).caravan!;
  assert.ok(cv.stranded, 'the band waits across the river');
  for (const d of t.s.dudes) d.lastHeardAt = t.h.now - AWAKE_MS - 1;
  t.s.ai.caravan = false;
  assert.ok(!t.s.dudes.some((d) => awake(d, t.h.now)), 'nobody awake');
  // The band out of order: the Crossing's cheer (who 1, the daughter) still goes to Wren, not to whoever stands second.
  cv.travellers.reverse();
  assert.equal(t.run('story-play', 'crossing'), undefined);
  assert.equal(cv.stranded, undefined, 'the bridge is mended: the crossing for real');
  assert.equal(t.view().town?.scene?.id, 'crossing');
  assert.equal(t.view().town?.scene?.leader, 'Ash', "the cast's leader speaks");
  await t.tick(1000);
  assert.equal(castTownie(t.s, 'wren')?.emote?.pose, 'cheer', 'Wren cheers');
  assert.notEqual(castTownie(t.s, 'oak')?.emote?.pose, 'cheer', 'not Oak, second in the shuffled band');
  await t.tick(SCENES.crossing.ms);
  assert.equal(t.view().town?.scene, undefined, 'and it ends on its own, the caravan off');
  assert.deepEqual(t.alerts, []);
});

test('Story (dev) → Play: Opening through the runtime: Ash steps forward, and the bridge ask opens as it ends', async () => {
  const t = await storyTown();
  assert.equal(t.run('story-play', 'opening'), undefined);
  assert.equal(t.view().town?.scene?.id, 'opening');
  const ash = castTownie(t.s, 'ash')!;
  const from = { ...ash.position };
  await t.tick(11_000);
  const to = ash.path.at(-1) ?? ash.position;
  assert.ok(Math.abs(to.x - (from.x - STEP_FORWARD)) < 0.05, `Ash steps forward to speak: ${JSON.stringify(to)}`);
  assert.equal(t.view().town?.caravan, undefined, 'nothing on the board yet');
  await t.tick(SCENES.opening.ms);
  assert.equal(t.view().town?.scene, undefined);
  assert.equal(cityOf(t.s).caravan?.asks[0]?.kind, 'bridge', 'the bridge ask opened');
  // The opening opens an ask, so it still needs the caravan on.
  t.s.ai.caravan = false;
  assert.match(t.run('story-play', 'opening') ?? 'ran', /^The caravan is off/);
});

test('Story (dev) → Play: Age turn is a look: its lines filled in, the age stays, nobody walks home', async () => {
  const t = await storyTown();
  t.run('story-play', 'crossing');
  await t.tick(SCENES.crossing.ms + 1000);
  assert.equal(t.run('story-play', 'ageTurn'), undefined);
  const sc = t.view().town?.scene;
  assert.equal(sc?.id, 'ageTurn');
  assert.equal(sc?.vars?.wonder, 'the Furnace');
  assert.equal(sc?.vars?.age, 'the Bronze Age');
  assert.ok(sc?.vars?.head, 'the head opens it');
  await t.tick(SCENES.ageTurn.ms + 1000);
  assert.equal(t.view().town?.scene, undefined, 'over');
  assert.equal(ageOf(t.s), 0, 'still the Stone Age');
  assert.equal(cityOf(t.s).caravan?.turn, undefined);
  for (const [i, id] of cityOf(t.s).caravan!.travellers.entries()) {
    const end = cityOf(t.s).townies.find((x) => x.id === id)?.path.at(-1);
    assert.ok(!end || end.x !== STRANDED[i % STRANDED.length].x, `${id} is not walking back to the camp`);
  }
});

test('a real age turn with Story on: the runtime turns the age at the wave, the band heads home, the breather follows', async () => {
  const t = await storyTown();
  const cv = cityOf(t.s).caravan!;
  Object.assign(cv, { stranded: undefined, visit: 2, asks: [{ id: 'wonder', kind: 'project', label: 'the Furnace', need: 1, have: 0 }] });
  skipVisit(t.s, t.h.now);
  assert.equal(cityOf(t.s).scene?.id, 'ageTurn');
  await t.tick(8000);
  assert.equal(ageOf(t.s), 1, 'the town turned at the wave');
  await t.tick(19_000);
  assert.ok(cv.turn?.left, 'the band heads back to camp');
  await t.tick(SCENES.ageTurn.ms - 27_000 + 1000);
  assert.equal(cityOf(t.s).scene, undefined);
  assert.ok(cv.turn?.arriveAt && cv.turn.arriveAt > t.h.now + 60_000, 'the breather counts from the end of the scene');
  assert.deepEqual(t.alerts, []);
});

test("a caravan scene that comes up under a story scene waits for it, then plays from the top", async () => {
  const t = await storyTown();
  assert.equal(playShow(t.s, 'test', t.h.now), undefined);
  skipVisit(t.s, t.h.now); // the bridge mended: the Crossing comes up
  await t.tick(4000);
  assert.equal(t.view().town?.scene?.id, 'test', 'the story scene has the page');
  assert.equal(cityOf(t.s).scene?.beat, 0, 'the Crossing waits, its beats not played');
  await t.tick(STORY_SCENES.test.ms - 4000 + 500);
  const sc = cityOf(t.s).scene!;
  assert.equal(t.view().town?.scene?.id, 'crossing', 'then the Crossing has it');
  assert.ok(t.h.now - sc.at < 2000, 'from the top');
  await t.tick(SCENES.crossing.ms);
  assert.equal(cityOf(t.s).scene, undefined);
});

test('a caravan scene that breaks ends with an alert, and never takes the tick down', async () => {
  const t = await storyTown();
  cityOf(t.s).scene = { id: 'nope' as SceneId, at: t.h.now, beat: 0 };
  await t.tick(500);
  assert.equal(cityOf(t.s).scene, undefined);
  assert.ok(t.alerts.some((a) => /^story: PANIC EXIT from today's nope scene: it threw/.test(a)), t.alerts.join('\n'));
});
