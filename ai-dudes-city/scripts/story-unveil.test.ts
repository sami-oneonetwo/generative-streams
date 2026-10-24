// The Unveiling v0 (FK-025): Story (dev) → Play: Unveiling gathers everyone at the Folly (the Bell), then
// the scene plays through the show runtime: the tarp drops, the title card, RATE IT from chat's 1–10s,
// Wren far off with her line, then the NOW card as the crowd is let go and the camera goes back to normal.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { harness } from './harness';
import { cityOf } from '../src/worlds/ai-dudes/city';
import { follyOf } from '../src/worlds/ai-dudes/story/folly';
import { castId } from '../src/worlds/ai-dudes/story/cast';
import { sceneTime } from '../src/worlds/ai-dudes/story/show';
import { STORY_SCENES } from '../src/shared/storyScenes';
import { STORY_SITES } from '../src/shared/storyMap';
import { SCENES, fillLine, sceneLine, scenePose } from '../src/shared/scenes';
import type { DudesScene } from '../src/shared/dudesTypes';

function unveilTown() {
  const hs = harness();
  const s = hs.h.state;
  s.ai.story = true;
  s.ai.caravan = false;
  const action = (id: string) => hs.world.adminActions!.find((a) => a.id === id)!;
  return {
    ...hs,
    s,
    run: (id: string, value?: string) => action(id).run(hs.ctx, value) || undefined,
    view: () => hs.world.buildScene(s, { now: hs.h.now } as never) as unknown as DudesScene,
    dude: (name: string) => s.dudes.find((d) => d.name === name)!,
  };
}

test('Play: Unveiling: the Call, the tarp drops, RATE IT averages chat, Wren says her line, the NOW card, everyone let go', async () => {
  const t = unveilTown();
  const s = t.s;
  for (const n of ['kev', 'dana', 'bo']) await t.say(n, `hello from ${n}`);
  await t.tick(1000);
  // Wren in town somewhere (the caravan is off here): the scene puts her on her vantage.
  const wren = { id: castId('wren'), name: 'Wren', look: s.dudes[0].look, position: { x: 0, z: 0 }, facing: 0, path: [], doing: 'stroll' as const, until: 0, role: 'wren' };
  cityOf(s).townies.push(wren);

  assert.equal(t.run('story-play', 'unveil'), undefined, 'Play: Unveiling runs');
  const folly = follyOf(s)!;
  assert.ok(folly?.silhouette, 'the cordon went up: the Folly is under wraps');
  assert.equal(t.view().town?.show?.banner?.title, 'GATHER: THE UNVEILING');
  assert.ok(s.dudes.every((d) => d.gather), 'everyone called to the ring');
  assert.ok(s.mayor?.lock, 'the head is on his mark');
  assert.match(t.run('story-play', 'unveil') ?? '', /gathered already/, 'not twice');

  // The gathering starts (≥ 8 s, ≤ 25 s): the scene has the page.
  for (let i = 0; i < 60 && !cityOf(s).story?.scene; i++) await t.tick(500);
  const sc = cityOf(s).story!.scene!;
  assert.equal(sc.id, 'unveil-near', 'bridge whole (no caravan): Wren on the ring road');
  const scene = STORY_SCENES[sc.id];
  assert.equal(t.view().town?.scene?.id, 'unveil-near');
  assert.equal(t.view().town?.show?.banner, undefined, 'the banner goes as the scene starts');
  const at = (ms: number) => t.tick(Math.max(0, ms - sceneTime(sc, t.h.now)));

  // ~5 s: the head's line, still under wraps.
  await at(5000);
  assert.ok(follyOf(s)!.silhouette);
  assert.equal(fillLine(sceneLine(scene, 5000, sc.vars)?.who, sc.vars ?? {}), s.mayor?.title ?? fillLine('{head}', sc.vars ?? {}));
  // The page's camera is on the Folly.
  const pose = scenePose(scene, 5000, { focus: [0, 0, 0], yaw: 0, pitch: 0.6, half: 50 });
  assert.ok(Math.hypot(pose.focus[0] - STORY_SITES.folly.at.x, pose.focus[2] - STORY_SITES.folly.at.z) < 8, 'camera on the Folly');

  // ~10 s: the tarp is off, the title card, RATE IT up and counting.
  await at(10_000);
  assert.equal(follyOf(s)!.silhouette, undefined, 'unveiled');
  assert.ok(cityOf(s).story?.folly?.unveiled);
  assert.equal(sceneLine(scene, 10_000, sc.vars)?.title, true);
  assert.equal(fillLine(sceneLine(scene, 10_000, sc.vars)?.text, sc.vars ?? {}).toUpperCase(), "THE CHIEF'S BIG HUT");
  assert.deepEqual(t.view().town?.show?.prompt, { kind: 'rate', label: 'RATE IT', count: 0 });
  await t.say('kev', '7');
  await t.say('dana', '10');
  await t.say('bo', '8');
  await t.say('kev', '9'); // kev's latest counts once
  assert.deepEqual(t.view().town?.show?.prompt, { kind: 'rate', label: 'RATE IT', value: 9, count: 3 });
  assert.equal(s.dudes.filter((d) => d.queuedLine && /^\d+$/.test(d.queuedLine.text)).length, 0, 'a vote never goes to an agent');

  // ~25 s: Wren far off at her vantage, her line, the camera on her; RATE IT gone.
  await at(25_000);
  const w = cityOf(s).townies.find((x) => x.id === castId('wren'))!;
  assert.deepEqual(w.position, STORY_SITES.wrenVantage.near);
  const line = sceneLine(scene, 25_000, sc.vars)!;
  assert.deepEqual([line.who, line.text], ['Wren', 'That was our fire.']);
  const onWren = scenePose(scene, 25_000, pose);
  assert.ok(Math.hypot(onWren.focus[0] - w.position.x, onWren.focus[2] - w.position.z) < 0.5, 'the shot is on Wren');
  assert.equal(t.view().town?.show?.prompt, undefined);
  assert.ok(Math.hypot(w.position.x - STORY_SITES.folly.at.x, w.position.z - STORY_SITES.folly.at.z) > 15, 'at a distance');

  // The end: the NOW card, the crowd let go, the head free, the scene gone (the page's camera goes back to autoFrame).
  await at(scene.ms);
  await t.tick(500);
  assert.equal(cityOf(s).story?.scene, undefined);
  assert.equal(t.view().town?.scene, undefined);
  assert.deepEqual(t.view().town?.show?.now && { ...t.view().town!.show!.now!, until: 0 }, { word: 'BRIDGE', chip: 'type red', side: 'red', until: 0 });
  assert.equal(s.mayor?.lock, undefined);
  await t.tick(9000);
  assert.ok(s.dudes.every((d) => !d.gather), 'everyone let go');
  assert.equal(t.view().town?.show?.now, undefined, 'the NOW card is down after 6 s');
  assert.equal(follyOf(s)!.silhouette, undefined, 'the Folly stands unveiled');

  // It replays: back under wraps, and the Call again.
  assert.equal(t.run('story-play', 'unveil'), undefined);
  assert.ok(follyOf(s)!.silhouette);
  assert.equal(t.run('story-stop'), undefined);
});

test('the Unveiling while the bridge is down films Wren on the far bank; Story OFF refuses it and sends no story', async () => {
  assert.deepEqual(STORY_SCENES.unveil.shots.find((x) => x.at === 22_000)?.pose.focus, [STORY_SITES.wrenVantage.far.x, 1, STORY_SITES.wrenVantage.far.z]);
  assert.ok(!('unveil' in SCENES), "never one of today's saved scene ids");
  const t = unveilTown();
  t.s.ai.story = false;
  assert.match(t.run('story-play', 'unveil') ?? '', /Story is off/);
  assert.equal(follyOf(t.s), undefined);
  assert.equal(t.view().town?.show, undefined);
});
