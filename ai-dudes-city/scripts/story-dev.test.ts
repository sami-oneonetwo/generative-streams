// Story (dev) on /admin (FK-002): every Finders Keepers scene and piece on a button, for a look
// off-air. Every button but Story ON refuses "Story is off" while Story is off; a piece that hasn't
// landed names its card; neither changes the world. Play: Crossing plays today's Crossing, Stop cuts
// it, Story OFF mid-scene lets everyone go, as every boot does, and Reset the cast puts FK-014's band
// back on its marks as new.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cityOf } from '../src/worlds/ai-dudes/city';
import { mayorOf } from '../src/worlds/ai-dudes/mayor';
import { CAST_ROLES, castId, castTownie } from '../src/worlds/ai-dudes/story/cast';
import { STORY_PLAYS, storyDevButtons } from '../src/worlds/ai-dudes/story/dev';
import { storyOn } from '../src/worlds/ai-dudes/state';
import type { DudesAdminStatus, DudesScene, StoryDevButton } from '../src/shared/dudesTypes';
import { PITCH } from '../src/shared/city';
import { FACING_TOWN, SCENES, STRANDED } from '../src/shared/scenes';
import { STORY_SITES } from '../src/shared/storyMap';
import { harness } from './harness';

const STORY_KEYS = ['story', 'board', 'show', 'spotlight', 'cast', 'folly'] as const;
/** What the argument box holds when a button takes it. */
const ARG = 'kim red';

/** A town with two chatters and the caravan stranded across the river (the opening not played yet). */
async function town() {
  const hs = harness({ town: true });
  for (const n of ['kim', 'lee']) await hs.say(n, 'hi');
  await hs.tick(2000);
  const action = (id: string) => {
    const a = hs.world.adminActions!.find((x) => x.id === id);
    assert.ok(a, `no admin action ${id}`);
    return a;
  };
  return {
    ...hs,
    action,
    /** Press an admin action: undefined when it ran, else why it didn't. */
    run: (id: string, value?: string | number) => action(id).run(hs.ctx, value) || undefined,
    press: (b: StoryDevButton) => action(b.action).run(hs.ctx, b.arg ? ARG : b.value) || undefined,
    view: () => hs.world.buildScene(hs.h.state, { now: hs.h.now } as never) as unknown as DudesScene,
    status: () => hs.world.adminStatus!(hs.h.state, hs.h.now) as DudesAdminStatus,
  };
}

/** The world as the save sees it. */
const snapshot = (t: { h: { state: unknown } }) => JSON.stringify(t.h.state);

test('Story OFF: every Story (dev) button but Story ON refuses "Story is off" and changes nothing', async () => {
  const t = await town();
  assert.equal(storyOn(t.h.state), false, 'Story starts off');
  const before = snapshot(t);
  const buttons = t.status().storyDev!;
  for (const b of buttons) assert.match(t.press(b) ?? 'ran', /^Story is off/, `${b.label} with Story OFF`);
  assert.match(t.run('story-off') ?? 'ran', /^Story is off/, 'Story OFF too');
  assert.equal(snapshot(t), before, 'nothing in the world changed');
  assert.ok(t.h.logs.some((l) => /^story-play crossing: Story is off/.test(l)), 'each refusal is in the log');
});

test('Story ON flips town.story; Story OFF puts it back', async () => {
  const t = await town();
  assert.equal(t.view().town?.story, undefined);
  assert.equal(t.run('story-on'), undefined);
  assert.equal(t.view().town?.story, true, 'town.story is on');
  assert.equal(t.status().town?.story, true, '/admin sees it too (the switch reads it)');
  assert.match(t.run('story-on') ?? 'ran', /already on/);
  assert.equal(t.run('story-off'), undefined);
  assert.equal(t.view().town?.story, undefined, 'and off again');
  assert.equal(t.h.state.ai.story, false);
});

test('Story ON: a piece that has not landed names its card and changes nothing', async () => {
  const t = await town();
  t.run('story-on');
  const before = snapshot(t);
  const unbuilt = t.status().storyDev!.filter((b) => b.card);
  // The four plays and three pieces pinned below; each card that lands takes its own off both lists.
  assert.equal(unbuilt.length, 7, unbuilt.map((b) => b.label).join(', '));
  for (const b of unbuilt) {
    assert.match(b.card!, /^FK-\d{3}$/, b.label);
    assert.equal(t.press(b), `not built yet: ${b.card}`, `${b.label} says which card builds it`);
  }
  assert.equal(snapshot(t), before, 'nothing in the world changed');
  // Which card builds which piece (BOARD.md): each wires its own button in story/dev.ts.
  const cardOf = (action: string, value?: string | number) => unbuilt.find((b) => b.action === action && (value === undefined || b.value === value))?.card;
  assert.deepEqual(
    [cardOf('story-play', 'unveil'), cardOf('story-play', 'rally'), cardOf('story-play', 'intro'), cardOf('story-play', 'ageTurn')],
    ['FK-025', 'FK-026', 'FK-043', 'FK-127'],
  );
  assert.equal(cardOf('story-play', 'test'), undefined, 'Play: test runs (FK-017: scripts/story-show.test.ts)');
  assert.deepEqual(
    ['side-set', 'spotlight-test', 'stage-stream-1'].map((a) => cardOf(a)),
    ['FK-012', 'FK-049', 'FK-056'],
  );
  assert.match(t.run('story-play', 'fireworks') ?? 'ran', /^No scene called "fireworks": intro, crossing, rally, unveil, ageTurn, test$/);
  assert.equal(t.run('story-play', 'CROSSING'), undefined, 'a scene name in any case');
});

test("Play: Crossing plays today's Crossing; Stop and Story OFF cut it; the opening is never cut short", async () => {
  const t = await town();
  t.run('story-on');
  assert.ok(cityOf(t.h.state).caravan?.stranded, 'the band waits across the river');
  assert.equal(t.run('story-play', 'crossing'), undefined);
  assert.equal(t.view().town?.scene?.id, 'crossing', 'the Crossing is on the page');
  assert.ok(t.h.logs.some((l) => /today's crossing is playing \(admin, Story \(dev\)\)/.test(l)));
  await t.tick(SCENES.crossing.ms + 1000);
  assert.equal(t.view().town?.scene, undefined, 'and ends on its own');
  assert.ok(cityOf(t.h.state).caravan?.stranded, 'a look only: the band is still waiting, the bridge ask untouched');

  // Stop (the panic exit) cuts it: nothing follows the Crossing's end.
  t.run('story-play', 'crossing');
  await t.tick(3000);
  assert.equal(t.run('story-stop'), undefined);
  assert.equal(t.view().town?.scene, undefined, 'cut');
  assert.match(t.run('story-stop') ?? 'ran', /^Nothing to stop/, 'a second press has nothing to do');
  // Story OFF lets go of the same: today's game, with no Crossing left playing from here.
  t.run('story-play', 'crossing');
  assert.equal(t.run('story-off'), undefined);
  assert.equal(t.view().town?.scene, undefined, 'Story OFF cut it too');
  t.run('story-on');

  // The opening (today's /admin scene-opening, linked from the card) opens the bridge ask as it ends,
  // so neither Play: Crossing nor Stop cuts it short.
  t.run('scene-opening');
  assert.match(t.run('story-play', 'crossing') ?? 'ran', /^The opening scene is playing/);
  assert.match(t.run('story-stop') ?? 'ran', /^Nothing to stop: today's opening scene plays on to its end/, 'Stop names what it leaves playing');
  assert.equal(t.view().town?.scene?.id, 'opening');
  await t.tick(SCENES.opening.ms + 1000);
  assert.ok(t.view().town?.caravan?.asks.length, 'the bridge ask opened as usual');

  // A story scene playing (FK-017's runtime) has the stage: Stop it before a Crossing goes on top.
  cityOf(t.h.state).story = { scene: { id: 'test', at: t.h.now, shift: 0, beat: 0, vars: {} } };
  assert.match(t.run('story-play', 'crossing') ?? 'ran', /^The test scene is playing: Stop it first/);
  assert.equal(t.view().town?.scene?.id, 'test', 'no Crossing on top: the test scene has the page');
  t.run('story-stop');

  // What today's Crossing needs, it still needs.
  t.h.state.ai.caravan = false;
  assert.match(t.run('story-play', 'crossing') ?? 'ran', /^The caravan is off/);
  t.h.state.ai.caravan = true;
  t.h.state.ai.townLife = false;
  assert.match(t.run('story-play', 'crossing') ?? 'ran', /^Town life is off/);
});

test('Play: Crossing before any caravan refuses (nothing would end the scene)', () => {
  const { world, ctx, h } = harness({ town: true });
  h.state.ai.story = true;
  assert.equal(cityOf(h.state).caravan, undefined, 'nobody has chatted: no caravan yet');
  const why = world.adminActions!.find((a) => a.id === 'story-play')!.run(ctx, 'crossing');
  assert.match(why ?? 'ran', /^No caravan in this age yet/);
  assert.equal(cityOf(h.state).scene, undefined);
});

test('Story OFF mid-scene lets everyone go: the scene ends, nobody gathered, the head free and shown, today’s view', async () => {
  const t = await town();
  t.run('story-on');
  const s = t.h.state;
  // A story scene with the crowd gathered and the head on his mark (FK-017, FK-019 and FK-020 set these).
  cityOf(s).story = { scene: { id: 'test', at: t.h.now, shift: 0, beat: 0, vars: {} }, folly: { age: 0, pct: 40, startedAt: t.h.now, plaque: ['kim'] } };
  for (const d of s.dudes) d.gather = { slot: { ...STORY_SITES.crowd.at }, face: 0, until: t.h.now + 60_000 };
  Object.assign(mayorOf(s, t.h.now), { lock: { at: { ...STORY_SITES.headMark.at }, facing: STORY_SITES.headMark.facing, since: t.h.now }, forcedHidden: true });
  s.dudes[0].side = 'gold';
  assert.ok(t.view().mayor?.lock, 'the head is held');

  assert.equal(t.run('story-off'), undefined);
  assert.equal(storyOn(s), false);
  assert.equal(cityOf(s).story!.scene, undefined, 'the scene is over');
  assert.ok(s.dudes.every((d) => !d.gather), 'everyone let go');
  assert.equal(s.mayor!.lock, undefined, 'WASD is his again');
  assert.equal(s.mayor!.forcedHidden, undefined, 'and he shows');
  assert.ok(cityOf(s).story!.folly && s.dudes[0].side === 'gold', 'what the story keeps stays, for next time');
  const v = t.view();
  for (const k of STORY_KEYS) assert.equal(v.town?.[k], undefined, `no town.${k}: the old band's panels come back`);
  assert.equal(v.mayor?.lock, undefined);
  assert.ok(v.dudes.every((d) => d.side === undefined), 'no sides drawn');
  // Five: the scene, kim's and lee's gatherings, the lock, the hiding.
  assert.ok(t.h.logs.some((l) => /Story OFF \(admin\): today's game; let go of 5 held things \(scene, gatherings, the head's lock\)/.test(l)), t.h.logs.join('\n'));
});

test('Reset the cast: the band as new, back on its marks (Kit too, if gone); not mid-scene or mid age turn', async () => {
  const t = await town();
  t.run('story-on');
  await t.tick(1000);
  const s = t.h.state;
  const city = cityOf(s);
  const five = CAST_ROLES.map(castId);
  assert.deepEqual(city.caravan!.travellers, five, 'Story ON: the band is the cast (FK-014)');
  // Knocked about: Wren off chatting in town, Oak indoors, Kit gone.
  Object.assign(castTownie(s, 'wren')!, { position: { x: 0, z: 0 }, path: [{ x: 1, z: 1 }], doing: 'chat', say: { text: 'hi', until: t.h.now + 9000 }, emote: { pose: 'cheer', until: t.h.now + 9000 } });
  Object.assign(castTownie(s, 'oak')!, { hidden: true, placeId: 'b1', doing: 'in' });
  city.townies = city.townies.filter((x) => x.id !== castId('kit'));

  assert.equal(t.run('cast-reset'), undefined);
  assert.deepEqual(city.caravan!.travellers, five, 'the five, Kit back');
  assert.equal(city.townies.filter((x) => x.role).length, 5, 'one of each');
  five.forEach((id, i) => {
    const x = city.townies.find((y) => y.id === id)!;
    assert.deepEqual(x.position, STRANDED[i], `${id} on their mark across the river (the bridge is down)`);
    assert.equal(x.facing, FACING_TOWN);
    assert.ok(!x.path.length && x.doing === 'stroll' && !x.say && !x.emote && !x.hidden && !x.placeId, `${id} as new`);
  });
  assert.ok(t.h.logs.some((l) => /story: the cast reset, on their marks across the river/.test(l)));

  // Mid-scene the scene has the band: wait for it (or Stop the Crossing).
  t.run('story-play', 'crossing');
  const before = snapshot(t);
  assert.match(t.run('cast-reset') ?? 'ran', /^The crossing scene is playing: let it finish first/);
  assert.equal(snapshot(t), before, 'nothing moved');
  t.run('story-stop');
  // The age turning: they are walking home.
  city.caravan!.turn = { at: t.h.now };
  assert.match(t.run('cast-reset') ?? 'ran', /^The age is turning/);
  // After the last age's finale nobody comes: say so, not "once the next caravan is here".
  city.caravan!.turn = { at: t.h.now, final: true };
  assert.match(t.run('cast-reset') ?? 'ran', /^The journey is over/);
  city.caravan!.turn = undefined;
  // Once they've crossed, their marks are at the town gate, as a caravan arriving by road stands.
  city.caravan!.stranded = undefined;
  assert.equal(t.run('cast-reset'), undefined);
  five.forEach((id, i) => assert.deepEqual(city.townies.find((y) => y.id === id)!.position, { x: PITCH / 2, z: (i - 1) * 1.2 }, `${id} at the gate`));
});

test('the /admin card: every button runs a real action that takes what the button sends', async () => {
  const t = await town();
  const buttons = t.status().storyDev!;
  assert.deepEqual(buttons, storyDevButtons(), 'the status carries the card');
  // The scenes in show order, each a Play button; the switch's actions are not buttons.
  assert.deepEqual(
    buttons.filter((b) => b.action === 'story-play').map((b) => b.value),
    STORY_PLAYS.map((p) => p.id),
  );
  assert.ok(!buttons.some((b) => b.action === 'story-on' || b.action === 'story-off'));
  for (const b of buttons) {
    const input = t.action(b.action).input;
    if (b.arg) assert.equal(input?.kind, 'text', `${b.label} sends the argument box as text`);
    else if (typeof b.value === 'string') assert.ok(input?.kind === 'text' && b.value.length <= (input.maxLength ?? 200), b.label);
    else if (typeof b.value === 'number') assert.ok(input && input.kind !== 'text' && b.value >= (input.min ?? -Infinity) && b.value <= (input.max ?? Infinity), b.label);
    else assert.equal(input, undefined, `${b.label} takes nothing`);
  }
  for (const id of ['story-on', 'story-off', 'story-play', 'story-stop', 'story-gather', 'folly-raise', 'folly-progress', 'folly-retarp', 'side-set', 'cast-reset', 'spotlight-test', 'stage-stream-1'])
    assert.ok(t.action(id).label.startsWith('Story (dev): '), id);
  assert.equal(t.action('scene-opening').label, 'Story: play the opening (travellers stuck across the river, the broken bridge)', 'scene-opening stays as it is');
  assert.deepEqual(
    buttons.filter((b) => b.action === 'folly-progress').map((b) => b.value),
    [0, 50, 100],
  );
});
