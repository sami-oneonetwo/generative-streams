// The show runtime (FK-017): story scenes tick on their own, every world tick while Story is on, with
// nobody awake, the caravan off and town life off. A scene's beats come due once each, in order, on
// scene time (holds don't count, a hold freezes it); the scene ends at its length, and rides
// `town.scene` ahead of today's caravan scene while it plays. The watchdog: a beat that throws, a beat
// or scene this build doesn't know, a broken clock, or a scene held past its lock cap ends in the panic
// exit (the scene ends, everyone is let go, the head is free), with an alert in the log, and never takes
// the world's tick down with it.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { harness } from './harness';
import { cityOf } from '../src/worlds/ai-dudes/city';
import { playScene } from '../src/worlds/ai-dudes/caravan';
import { mayorOf } from '../src/worlds/ai-dudes/mayor';
import { castArrival, castIn, castTownie } from '../src/worlds/ai-dudes/story/cast';
import { SHOW_BEATS, lockCapOf, playShow, sceneTime, storyScene } from '../src/worlds/ai-dudes/story/show';
import { stateSchema, type StorySceneState } from '../src/worlds/ai-dudes/state';
import { LOCK_CAPS, LOCK_SLACK_MS, SCENES, type Scene } from '../src/shared/scenes';
import { STORY_SCENES } from '../src/shared/storyScenes';
import { STORY_SITES } from '../src/shared/storyMap';
import type { DudesScene } from '../src/shared/dudesTypes';

const TEST = STORY_SCENES.test;

/** A world with Story on and its tools: by default empty (nobody has chatted), the caravan and town life off. */
function showTown(opts: { town?: boolean } = {}) {
  const hs = harness({ town: opts.town ?? false });
  const s = hs.h.state;
  s.ai.story = true;
  if (!opts.town) s.ai.caravan = false;
  // The harness keeps lines, not levels: the alerts are kept apart here.
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
    /** Press an admin action: undefined when it ran, else why it didn't. */
    run: (id: string, value?: string) => action(id).run(hs.ctx, value) || undefined,
    view: () => hs.world.buildScene(hs.h.state, { now: hs.h.now } as never) as unknown as DudesScene,
    scene: () => cityOf(s).story?.scene,
    /** Stone's band in town, as FK-014 brings them (here without any caravan): Ash leads, Wren beside him. */
    bringCast: () => castIn(0).forEach((m, i) => cityOf(s).townies.push(castArrival(m, i, 0, { x: 40 + i * 2, z: 10 }, 0, hs.h.now))),
    pose: (role: 'ash' | 'wren') => castTownie(s, role)?.emote?.pose,
  };
}

/** A story scene of the test's own, registered for the length of `body` and taken out again after it. */
async function withScene(scene: Omit<Scene, 'beats'> & { beats: { at: number; do: string; who: number; pose?: string; ms?: number }[] }, body: () => Promise<void> | void) {
  STORY_SCENES[scene.id] = scene as Scene;
  try {
    await body();
  } finally {
    delete STORY_SCENES[scene.id];
  }
}

test('Play: test runs its beats with nobody awake, the caravan off and town life off; town.scene is test while it runs', async () => {
  const t = showTown();
  const s = t.h.state;
  t.bringCast();
  assert.equal(s.dudes.length, 0, 'nobody has ever chatted');
  assert.ok(s.ai.caravan === false && s.ai.townLife === false, 'the caravan and town life are off');
  const at = t.h.now;
  assert.equal(t.run('story-play', 'test'), undefined);
  assert.ok(t.h.logs.includes('story: the test scene is playing (admin, Story (dev))'));
  assert.deepEqual(t.view().town?.scene, { id: 'test', at, shift: 0 }, 'on the page: which, since when, no holds');

  await t.tick(1000);
  assert.equal(t.pose('ash'), 'wave', "1 s: the age's leader waves (beat 1)");
  assert.equal(t.pose('wren'), undefined);
  await t.tick(5000);
  assert.equal(t.pose('wren'), 'cheer', '6 s: the next of the cast cheers (beat 2)');
  assert.equal(t.scene()?.beat, 2, 'both beats run, once each');
  await t.tick(3500);
  assert.equal(t.view().town?.scene?.id, 'test', 'still playing at 9.5 s');

  await t.tick(500);
  assert.equal(t.scene(), undefined, 'over at 10 s, as written');
  assert.equal(t.view().town?.scene, undefined, 'and gone from the page: autoFrame has the camera back');
  assert.ok(t.h.logs.includes('story: the test scene ended'), t.h.logs.join('\n'));
  assert.deepEqual(t.alerts, [], 'no alerts');
});

test('beats come due on scene time: a hold freezes the beats and the end, and the scene goes on where it froze', async () => {
  const t = showTown();
  t.bringCast();
  playShow(t.h.state, 'test', t.h.now);
  const sc = t.scene()!;
  await t.tick(500);
  // A hold (FK-035 sets these): scene time stops at 0.5 s.
  sc.heldAt = sceneTime(sc, t.h.now);
  assert.equal(sc.heldAt, 500);
  await t.tick(8000);
  assert.equal(t.pose('ash'), undefined, 'held: the 1 s beat waits');
  assert.equal(sc.beat, 0);
  assert.deepEqual(t.view().town?.scene, { id: 'test', at: sc.at, shift: 0, heldAt: 500 }, 'the page sees the hold');
  // Let go: the 8 s held go into `shift`, `at` never moves (the page keys shots by id:at).
  sc.shift = t.h.now - sc.at - sc.heldAt;
  sc.heldAt = undefined;
  assert.equal(sc.shift, 8000);
  await t.tick(500);
  assert.equal(t.pose('ash'), 'wave', 'on again: scene time 1 s, the wave');
  await t.tick(8500);
  assert.equal(t.view().town?.scene?.shift, 8000, 'still playing at 9.5 s of scene time, 17.5 s after it began');
  await t.tick(500);
  assert.equal(t.scene(), undefined, 'over at 10 s of scene time');
  assert.deepEqual(t.alerts, []);
});

test('sceneTime: wall time less the holds, frozen at heldAt while a hold is on', () => {
  const sc: StorySceneState = { id: 'test', at: 1000, shift: 0, beat: 0, vars: {} };
  assert.equal(sceneTime(sc, 4000), 3000);
  assert.equal(sceneTime({ ...sc, shift: 2500 }, 4000), 500, 'holds so far are taken off');
  assert.equal(sceneTime({ ...sc, heldAt: 1200 }, 4000), 1200, 'a hold freezes it');
  assert.equal(sceneTime({ ...sc, heldAt: 1200 }, 1500), 500, 'never ahead of the clock');
  assert.equal(lockCapOf(TEST), TEST.ms + LOCK_SLACK_MS, 'no cap named: its length and a little');
  assert.equal(lockCapOf({ ...TEST, lockMs: LOCK_CAPS.unveiling }), 120_000);
  assert.deepEqual(LOCK_CAPS, { walk: 25_000, rally: 60_000, unveiling: 120_000, lastLight: 150_000, rising: 240_000 }, 'bible §5');
});

test('a scene held past its lock cap is cut: the panic exit, everyone let go, an alert', async () => {
  const t = showTown();
  const s = t.h.state;
  await t.say('kim', 'hi');
  playShow(s, 'test', t.h.now);
  const sc = t.scene()!;
  // The crowd gathered and the head on his mark (FK-019 and FK-020 set these).
  s.dudes[0].gather = { slot: { ...STORY_SITES.crowd.at }, face: 0, until: t.h.now + 600_000 };
  Object.assign(mayorOf(s, t.h.now), { lock: { at: { ...STORY_SITES.headMark.at }, facing: STORY_SITES.headMark.facing, since: t.h.now }, forcedHidden: true });
  await t.tick(500);
  sc.heldAt = sceneTime(sc, t.h.now);
  await t.tick(TEST.ms + LOCK_SLACK_MS - 1000);
  assert.ok(t.scene(), 'held, still within the cap (25 s)');
  await t.tick(1000);
  assert.equal(t.scene(), undefined, 'cut at the cap');
  assert.equal(s.dudes[0].gather, undefined, 'the crowd let go');
  assert.ok(!s.mayor!.lock && !s.mayor!.forcedHidden, 'the head free and shown');
  assert.equal(t.view().town?.scene, undefined);
  assert.equal(t.alerts.length, 1);
  assert.match(t.alerts[0], /^story: PANIC EXIT from the test scene: held past its 25 s lock cap \(0\.5 s into 10 s\); let go of 4 held things$/);
});

test('a server that stalls past the cap without a hold ends the scene as written, not in a panic', async () => {
  const t = showTown();
  t.bringCast();
  playShow(t.h.state, 'test', t.h.now);
  await t.tick(60_000, 60_000);
  assert.equal(t.scene(), undefined);
  assert.deepEqual([t.pose('ash'), t.pose('wren')], ['wave', 'cheer'], 'its beats ran on the way out');
  assert.ok(t.h.logs.includes('story: the test scene ended'));
  assert.deepEqual(t.alerts, []);
});

test('a beat that throws ends the scene cleanly and logs an alert; the beats after it never run and the tick goes on', async () => {
  SHOW_BEATS.boom = () => {
    throw new Error('the tarp is stuck');
  };
  try {
    await withScene(
      {
        id: 'boom-test',
        ms: 8000,
        shots: [],
        lines: [],
        beats: [
          { at: 500, do: 'emote', who: 0, pose: 'wave' },
          { at: 1000, do: 'boom', who: 0 },
          { at: 2000, do: 'emote', who: 1, pose: 'cheer' },
        ],
      },
      async () => {
        const t = showTown();
        const s = t.h.state;
        t.bringCast();
        await t.say('kim', 'hi');
        s.dudes[0].gather = { slot: { ...STORY_SITES.crowd.at }, face: 0, until: t.h.now + 600_000 };
        Object.assign(mayorOf(s, t.h.now), { lock: { at: { ...STORY_SITES.headMark.at }, facing: STORY_SITES.headMark.facing, since: t.h.now } });
        assert.equal(playShow(s, 'boom-test', t.h.now), undefined);
        await t.tick(1000); // the harness has no try/catch round world.tick: a throw out of the show would fail here
        assert.equal(t.scene(), undefined, 'the scene is over');
        assert.equal(t.view().town?.scene, undefined, 'off the page');
        assert.equal(s.dudes[0].gather, undefined, 'the crowd let go');
        assert.equal(s.mayor!.lock, undefined, 'WASD is the head’s again');
        assert.deepEqual(t.alerts, ['story: PANIC EXIT from the boom-test scene: beat 2 (boom at 1 s) threw: the tarp is stuck; let go of 3 held things']);
        assert.equal(t.pose('ash'), 'wave', 'the beat before it ran');
        await t.tick(3000);
        assert.equal(t.pose('wren'), undefined, 'the one after it never does');
        assert.equal(t.alerts.length, 1, 'one alert, once');
        assert.equal(t.h.state.ai.story, true, 'Story stays on');
        assert.equal(t.run('story-play', 'test'), undefined, 'and the next scene plays');
      },
    );
  } finally {
    delete SHOW_BEATS.boom;
  }
});

test('a beat or a scene this build does not know, a broken clock or broken scene data: the panic exit too', async () => {
  // A beat of a kind the runtime doesn't play.
  await withScene({ id: 'fly-test', ms: 5000, shots: [], lines: [], beats: [{ at: 500, do: 'fly', who: 0 }] }, async () => {
    const t = showTown();
    playShow(t.h.state, 'fly-test', t.h.now);
    await t.tick(500);
    assert.equal(t.scene(), undefined);
    assert.deepEqual(t.alerts, ['story: PANIC EXIT from the fly-test scene: beat 1 (fly at 0.5 s) threw: no beat called "fly" in the show runtime; let go of 1 held thing']);
  });
  // A scene saved by another build (one with the Bronze Unveiling): not on the page, and gone at the next tick.
  {
    const t = showTown();
    cityOf(t.h.state).story = { scene: { id: 'unveil-bronze', at: t.h.now, shift: 0, beat: 0, vars: {} } };
    assert.equal(t.view().town?.scene, undefined, 'the page never sees a scene it can’t play');
    await t.tick(500);
    assert.equal(t.scene(), undefined);
    assert.match(t.alerts[0], /PANIC EXIT from the unveil-bronze scene: this build has no story scene called "unveil-bronze"/);
  }
  // A clock that isn't a number.
  {
    const t = showTown();
    cityOf(t.h.state).story = { scene: { id: 'test', at: Number.NaN, shift: 0, beat: 0, vars: {} } };
    await t.tick(500);
    assert.equal(t.scene(), undefined);
    assert.match(t.alerts[0], /PANIC EXIT from the test scene: its clock is broken/);
  }
  // Scene data that throws outside any beat (no beats list): the round's own try/catch.
  await withScene({ id: 'bad-test', ms: 5000, shots: [], lines: [], beats: undefined as never }, async () => {
    const t = showTown();
    playShow(t.h.state, 'bad-test', t.h.now);
    await t.tick(500);
    assert.equal(t.scene(), undefined);
    assert.match(t.alerts[0], /PANIC EXIT from the bad-test scene: the show runtime threw: /);
  });
});

test('every story scene is one the runtime can play: known beats, in order, inside its length, a cap within the bible’s', () => {
  for (const [id, sc] of Object.entries(STORY_SCENES)) {
    assert.equal(sc.id, id);
    sc.beats.forEach((b, i) => {
      assert.ok(Object.hasOwn(SHOW_BEATS, b.do), `${id} beat ${i + 1}: the runtime plays "${b.do}"`);
      assert.ok(b.at >= 0 && b.at < sc.ms, `${id} beat ${i + 1} inside the scene`);
      assert.ok(i === 0 || sc.beats[i - 1].at <= b.at, `${id} beats in order`);
      assert.ok(Number.isInteger(b.who) && b.who >= 0 && b.who < 5, `${id} beat ${i + 1}: one of the band`);
    });
    assert.ok(lockCapOf(sc) >= sc.ms && lockCapOf(sc) <= LOCK_CAPS.rising, `${id}'s cap`);
  }
  assert.ok(TEST.beats.length >= 1, 'the test scene has beats to run');
});

test('town.scene: a story scene plays ahead of today’s; with Story OFF the show neither ticks nor shows', async () => {
  const t = showTown({ town: true });
  const s = t.h.state;
  for (const n of ['kim', 'lee']) await t.say(n, 'hi');
  await t.tick(2000);
  playScene(s, 'crossing', t.h.now);
  assert.equal(t.view().town?.scene?.id, 'crossing');
  playShow(s, 'test', t.h.now);
  assert.equal(t.view().town?.scene?.id, 'test', 'the story scene has the page');
  await t.tick(TEST.ms);
  assert.equal(t.scene(), undefined);
  assert.equal(t.view().town?.scene?.id, 'crossing', 'today’s scene plays on underneath, and shows again');
  await t.tick(SCENES.crossing.ms);

  // Story OFF is today's game: no story scene ticks or shows (Story (dev) → Story OFF also ends it).
  s.ai.story = false;
  cityOf(s).story = { scene: { id: 'test', at: t.h.now, shift: 0, beat: 0, vars: {} } };
  await t.tick(TEST.ms + 2000);
  assert.equal(t.scene()?.beat, 0, 'not ticked');
  assert.equal(t.view().town?.scene, undefined);
  assert.deepEqual(t.alerts, []);
});

test('Play: test refuses over today’s scene and over a story scene; Stop cuts it; playShow takes only story scenes', async () => {
  const t = showTown({ town: true });
  const s = t.h.state;
  for (const n of ['kim', 'lee']) await t.say(n, 'hi');
  await t.tick(2000);
  t.run('scene-opening');
  assert.match(t.run('story-play', 'test') ?? 'ran', /^Today's opening scene is playing: let it finish first$/);
  assert.equal(t.scene(), undefined);
  await t.tick(SCENES.opening.ms + 1000);
  assert.equal(t.run('story-play', 'test'), undefined);
  assert.match(t.run('story-play', 'test') ?? 'ran', /^The test scene is playing: Stop it first$/);
  assert.match(t.run('story-play', 'crossing') ?? 'ran', /^The test scene is playing: Stop it first$/);
  await t.tick(3000);
  assert.equal(t.run('story-stop'), undefined);
  assert.equal(t.scene(), undefined);
  assert.equal(t.view().town?.scene, undefined);
  assert.ok(t.alerts.includes('story: stopped the test scene (admin, panic exit): let go of 1 held thing'), t.alerts.join('\n'));

  for (const id of ['opening', 'constructor', 'toString', ''])
    assert.match(playShow(s, id, t.h.now) ?? 'ran', /^No story scene called/, `"${id}" is not a story scene`);
  assert.equal(storyScene('test'), TEST);
  // Vars go in within the save's limits, so a playing scene always saves.
  playShow(s, 'test', t.h.now, { ['k'.repeat(60)]: 'v'.repeat(400), head: 'The Chief' });
  const vars = t.scene()!.vars;
  assert.deepEqual(Object.keys(vars).map((k) => k.length), [40, 4]);
  assert.equal(vars['k'.repeat(40)].length, 160);
  assert.ok(stateSchema.safeParse(JSON.parse(JSON.stringify(s))).success, 'the save takes it');
  assert.deepEqual(t.view().town?.scene?.vars, vars, 'the page gets the vars for its lines');
});
