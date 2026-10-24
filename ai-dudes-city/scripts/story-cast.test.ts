// The cast persists (FK-014): with Story on, the caravan's band is Ash, Wren, Old Moss, Oak and Kit,
// under fixed `cast-<role>` ids with their roles on their tags; the same five come through an age
// turn (an admin set-age or the caravan's own); every wipe (a new caravan, the caravan off, town life
// off) spares them; Ash is gone from Medieval on; and the band follows the switch, so Story OFF is
// today's band again.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { harness } from './harness';
import { ageOf, cityOf } from '../src/worlds/ai-dudes/city';
import { skipVisit } from '../src/worlds/ai-dudes/caravan';
import { CAST, CAST_ROLES, castId, castTownie } from '../src/worlds/ai-dudes/story/cast';
import { lookSchema, stateSchema } from '../src/worlds/ai-dudes/state';
import { BRIDGE } from '../src/shared/scenes';
import type { DudesScene } from '../src/shared/dudesTypes';

const FIVE = ['cast-ash', 'cast-wren', 'cast-moss', 'cast-oak', 'cast-kit'];
const TAGS = ['Ash the hunter', 'Wren', 'Old Moss', 'Oak the builder', 'Kit'];

/** A town with Story on, a chatter about and the caravan in (the Stone band, stuck across the river). */
async function storyTown(story = true) {
  const hs = harness({ town: true });
  hs.h.state.ai.story = story;
  await hs.say('kim', 'hi');
  await hs.tick(2000);
  const view = () => hs.world.buildScene(hs.h.state, { now: hs.h.now } as never) as unknown as DudesScene;
  const run = (id: string, value?: string) => hs.world.adminActions!.find((a) => a.id === id)!.run({ state: hs.h.state, now: hs.h.now, log: () => {} } as never, value as never);
  const band = () => cityOf(hs.h.state).caravan!.travellers;
  const cast = () => cityOf(hs.h.state).townies.filter((t) => t.role);
  return { ...hs, view, run, band, cast };
}

test('Story ON: the band is the five cast under their own ids, with their roles on their tags', async () => {
  const { h, view, band } = await storyTown();
  assert.deepEqual(band(), FIVE, 'Ash leads, Wren at his side, then Moss, Oak and Kit');
  const ash = castTownie(h.state, 'ash')!;
  assert.ok(ash.leader && !castTownie(h.state, 'wren')!.leader, 'Ash leads in Stone');
  assert.ok(castTownie(h.state, 'wren')!.daughter, 'Wren is the daughter');
  assert.ok(FIVE.every((id) => cityOf(h.state).townies.find((t) => t.id === id)!.position.x > BRIDGE.far), 'stuck across the river with the bridge down');
  assert.deepEqual(
    FIVE.map((id) => cityOf(h.state).townies.find((t) => t.id === id)!.scale ?? 1),
    [1.15, 0.82, 1, 1.25, 0.7],
    'Ash tall, Wren a teenager, Oak big, Kit small',
  );
  assert.ok(!cityOf(h.state).townies.some((t) => t.traveller && !t.role), "no Mammoth Herder walks with them");
  const scene = view();
  assert.deepEqual(scene.town?.cast, CAST_ROLES.map((role, i) => ({ id: castId(role), role, tag: TAGS[i] })), 'town.cast carries the ids and tags');
  assert.deepEqual(FIVE.map((id) => scene.dudes.find((d) => d.id === id)?.name), TAGS, 'each tag is the role');
  assert.ok(FIVE.every((id) => !scene.dudes.find((d) => d.id === id)!.title), 'no "leader of the travellers" under it');
  assert.ok(scene.dudes.find((d) => d.id === 'cast-ash')!.traveller, 'drawn as the band (their tags always show)');
  assert.ok(stateSchema.safeParse(JSON.parse(JSON.stringify(h.state))).success, 'the save takes them');
});

test('Stone to Bronze (an off-air set-age) keeps the same five ids', async () => {
  const { h, tick, run, band, view } = await storyTown();
  const before = FIVE.map((id) => cityOf(h.state).townies.find((t) => t.id === id)!);
  const stranded = before.map((t) => ({ ...t.position }));
  run('set-age', 'bronze');
  await tick(2000);
  assert.equal(ageOf(h.state), 1);
  assert.equal(cityOf(h.state).caravan!.age, 1, "Bronze's caravan arrived");
  assert.deepEqual(band(), FIVE, 'the same five ids');
  assert.ok(before.every((t, i) => cityOf(h.state).townies.find((x) => x.id === FIVE[i]) === t), 'the same five townies: no wipe and respawn');
  assert.equal(cityOf(h.state).townies.filter((t) => t.role).length, 5, 'and nobody twice');
  assert.ok(!cityOf(h.state).townies.some((t) => t.traveller && !t.role), "no River Trader walks with them");
  assert.equal(castTownie(h.state, 'wren')!.scale, 0.9, 'Wren grew up a little');
  assert.equal(castTownie(h.state, 'ash')!.scale, 1.2);
  assert.ok(stranded.every((p) => p.x > BRIDGE.far) && before.every((t) => t.position.x < BRIDGE.near), 'a new caravan: from across the river into town, on their marks');
  assert.deepEqual(view().town?.cast?.map((c) => c.id), FIVE);
  // On the square, each waits on a spot of their own (the caravan's three would stack two pairs, tags and all).
  await tick(40_000);
  const at = before.map((t) => t.position);
  assert.ok(at.every((p, i) => at.every((q, j) => i === j || Math.hypot(p.x - q.x, p.z - q.z) > 2)), `five spots apart: ${JSON.stringify(at)}`);
  assert.ok(stateSchema.safeParse(JSON.parse(JSON.stringify(h.state))).success);
});

test("the caravan's own age turn keeps the cast: the goodbye, the walk back to camp and in again", async () => {
  const { h, tick, band } = await storyTown();
  const five = () => FIVE.map((id) => cityOf(h.state).townies.find((t) => t.id === id));
  const before = five();
  skipVisit(h.state, h.now); // the bridge
  await tick(21_000);
  for (let i = 0; i < 6 && ageOf(h.state) === 0; i++) {
    skipVisit(h.state, h.now);
    await tick(40_000);
  }
  assert.equal(ageOf(h.state), 1, 'the Wonder moved the town into Bronze');
  assert.ok(cityOf(h.state).caravan!.turn, 'the age is turning');
  assert.deepEqual(band(), FIVE, 'the cast say goodbye');
  for (let i = 0; i < 20 && cityOf(h.state).caravan!.age === 0; i++) await tick(10_000);
  assert.equal(cityOf(h.state).caravan!.age, 1, 'and walk back in with Bronze');
  assert.deepEqual(band(), FIVE, 'the same five ids');
  assert.deepEqual(five(), before, 'the same five townies, never wiped');
  assert.ok(five().every((t, i) => t === before[i]));
  assert.equal(cityOf(h.state).townies.filter((t) => t.role).length, 5);
  assert.ok(stateSchema.safeParse(JSON.parse(JSON.stringify(h.state))).success);
});

test('every wipe skips the cast: a new caravan, the caravan off, town life off', async () => {
  const { h, tick, run, band, cast } = await storyTown();
  await tick(60_000); // residents move in
  assert.ok(cityOf(h.state).townies.some((t) => !t.traveller), 'the town has residents');

  // A new caravan (startCaravan): the last band goes home, the cast stay, back on their marks.
  const ash = castTownie(h.state, 'ash')!;
  const same = () => assert.ok(castTownie(h.state, 'ash') === ash, 'the same Ash');
  ash.position = { x: BRIDGE.far + 12, z: 4 };
  run('caravan-restart');
  assert.deepEqual(band(), FIVE);
  assert.equal(cast().length, 5);
  same();
  assert.deepEqual(castTownie(h.state, 'ash')!.position, { x: BRIDGE.far + 3.2, z: 0.55 }, 'Ash back at the front of the band');

  // The caravan off (sandbox): travellers go home, the cast stay; back on, the same five.
  run('caravan-off');
  await tick(2000);
  assert.deepEqual(cast().map((t) => t.id), FIVE, 'the caravan off spares them');
  same();
  run('caravan-on');
  await tick(2000);
  assert.deepEqual(band(), FIVE);
  assert.equal(cast().length, 5);

  // Town life off: the residents go, the cast stay; on again, the same five.
  run('town-off');
  await tick(2000);
  assert.deepEqual(cityOf(h.state).townies.map((t) => t.id), FIVE, 'only the cast are left');
  same();
  run('town-on');
  await tick(2000);
  assert.deepEqual(band(), FIVE);
  assert.equal(cast().length, 5);
  assert.ok(stateSchema.safeParse(JSON.parse(JSON.stringify(h.state))).success);
});

test('Story OFF: the same three wipes clear the band as today, and no cast is ever made', async () => {
  const { h, tick, run } = await storyTown(false);
  const travellers = () => cityOf(h.state).townies.filter((t) => t.traveller);
  assert.equal(travellers().length, 5, "today's Stone band");
  assert.ok(!cityOf(h.state).townies.some((t) => t.role || t.id.startsWith('cast-')), 'no cast');
  assert.equal(travellers()[0].name, 'Toma');
  run('caravan-off');
  await tick(1000);
  assert.equal(travellers().length, 0, 'the caravan off sends them home');
  run('caravan-on');
  await tick(1000);
  run('town-off');
  await tick(1000);
  assert.equal(cityOf(h.state).townies.length, 0, 'town life off empties the town');
});

test('Ash leaves the cast from Medieval on, and Wren leads', async () => {
  const { h, tick, run, band, view } = await storyTown();
  run('set-age', 'medieval');
  await tick(2000);
  assert.deepEqual(band(), ['cast-wren', 'cast-moss', 'cast-oak', 'cast-kit']);
  assert.equal(castTownie(h.state, 'ash'), undefined, 'Ash is gone');
  const wren = castTownie(h.state, 'wren')!;
  assert.ok(wren.leader && wren.daughter, 'Wren leads now');
  assert.equal(wren.scale, undefined, 'a woman now (scale 1)');
  const scene = view();
  assert.deepEqual(scene.town?.cast?.map((c) => c.tag), ['Wren', 'Old Moss', 'Oak the builder', 'Kit']);
  assert.ok(!scene.dudes.find((d) => d.id === 'cast-wren')!.title, 'her tag is still just "Wren"');
  // And back to Bronze (admin): Ash is with them again, under the same id.
  run('set-age', 'bronze');
  await tick(2000);
  assert.deepEqual(band(), FIVE);
});

test("the band follows the switch: OFF brings today's band back where the cast stood, ON the same cast again", async () => {
  const { h, tick, band, view } = await storyTown();
  skipVisit(h.state, h.now); // the bridge: they cross and walk into town
  await tick(30_000);
  const at = { ...castTownie(h.state, 'ash')!.position };
  h.state.ai.story = false;
  await tick(500);
  assert.ok(!band().some((id) => id.startsWith('cast-')), "today's band again");
  assert.ok(!cityOf(h.state).townies.some((t) => t.role), 'no cast left in town');
  const leader = cityOf(h.state).townies.find((t) => t.id === band()[0])!;
  assert.equal(leader.name, 'Toma');
  assert.ok(Math.hypot(leader.position.x - at.x, leader.position.z - at.z) < 1, 'the leader took over where Ash stood');
  const scene = view();
  assert.equal(scene.town?.cast, undefined);
  assert.equal(scene.dudes.find((d) => d.id === leader.id)!.title, 'leader of the travellers', "today's tag");
  h.state.ai.story = true;
  await tick(500);
  assert.deepEqual(band(), FIVE, 'the same five ids again');
  assert.equal(cityOf(h.state).townies.filter((t) => t.traveller).length, 5, 'and only them');
  assert.ok(stateSchema.safeParse(JSON.parse(JSON.stringify(h.state))).success);
});

test('the cast table: five roles, a tag each, Ash only in Stone and Bronze', () => {
  assert.deepEqual(CAST_ROLES.map((r) => CAST[r].tag), TAGS);
  assert.ok(CAST_ROLES.every((r) => castId(r).length <= 20 && CAST[r].name.length <= 40), 'fits the saved townie');
  assert.deepEqual(CAST.ash.scale.length, 2);
  assert.ok(CAST_ROLES.every((r) => lookSchema.safeParse(CAST[r].look).success), 'every look would save');
});
