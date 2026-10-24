// Wren's Rally v0 (FK-026): Story (dev) → Play: Rally, with chat injected. The Call's banner and whistle,
// "coming" walks a chatter to Wren's fire (at most six), the cast fill the arc, the scene on the page from
// the Call's end with two lines from the bank, "us" joins red and lights a pip, the NOW card, the release.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { harness } from './harness';
import { cityOf } from '../src/worlds/ai-dudes/city';
import { castTownie } from '../src/worlds/ai-dudes/story/cast';
import { rallyCount } from '../src/worlds/ai-dudes/story/rally';
import { sideNow } from '../src/worlds/ai-dudes/story/sides';
import { SCENES } from '../src/shared/scenes';
import { STORY_SITES } from '../src/shared/storyMap';
import { RALLY, RALLY_LINES } from '../src/shared/storyScenes';
import type { DudesScene } from '../src/shared/dudesTypes';

const fire = STORY_SITES.wrenFire.at;
const far = (p: { x: number; z: number }) => Math.hypot(p.x - fire.x, p.z - fire.z);

/** A Story town whose band has crossed: the rally needs Wren in town. */
async function rallyTown() {
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
  const run = (id: string, value?: string) => action(id).run(hs.ctx, value) || undefined;
  return { ...hs, alerts, s: hs.h.state, run, view: () => hs.world.buildScene(hs.h.state, { now: hs.h.now } as never) as unknown as DudesScene };
}

test('Play: Rally refuses while the band is across the river, then plays end to end: coming, the arc, us, pips, NOW, release', async () => {
  const t = await rallyTown();
  assert.match(t.run('story-play', 'rally') ?? 'ran', /across the river/);
  assert.equal(t.run('story-play', 'crossing'), undefined);
  await t.tick(SCENES.crossing.ms + 1000);
  assert.equal(cityOf(t.s).story?.scene, undefined);
  // A crowd in town: kim and lee, and seven more.
  const more = ['ann', 'bo', 'cy', 'di', 'ed', 'fi', 'gus'];
  for (const n of more) await t.say(n, 'hello');
  await t.tick(1000);

  assert.equal(t.run('story-play', 'rally'), undefined);
  const id = (n: string) => t.s.dudes.find((d) => d.name === n)!.id;
  // The Call: the banner and its whistle, no scene on the page yet (the strip keeps it).
  let v = t.view().town!;
  assert.equal(v.scene, undefined);
  assert.equal(v.show?.banner?.title, "WREN'S FIRE · type coming");
  assert.equal(v.show?.banner?.sound, 'whistle');
  // The cast head for the fire: Wren to her mark, Oak, Moss and Kit to the arc.
  for (const r of ['wren', 'oak', 'moss', 'kit'] as const) {
    const c = castTownie(t.s, r)!;
    assert.ok(far(c.path.at(-1) ?? c.position) < 6, `${r} goes to the fire`);
  }

  // Eight say "coming": six come, first first; "coming soon" is a line, not a keyword.
  const comers = ['kim', 'lee', 'ann', 'bo', 'cy', 'di', 'ed', 'fi'];
  for (const n of comers) await t.say(n, 'coming!');
  await t.say('gus', 'coming soon');
  await t.tick(1000);
  assert.deepEqual(rallyCount(t.s).comers, comers.slice(0, 6).map(id));
  for (const n of comers.slice(0, 6)) {
    const d = t.s.dudes.find((x) => x.name === n)!;
    assert.ok(d.gather && far(d.gather.slot) < 6, `${n} has a slot by the fire`);
  }
  for (const n of ['ed', 'fi', 'gus']) assert.equal(t.s.dudes.find((x) => x.name === n)!.gather, undefined, `${n} doesn't come`);
  assert.match(t.view().town!.show?.banner?.premise ?? '', /6 coming/);

  // The talk: the scene on the page from the Call's end, everyone at the fire, two different lines from the bank.
  await t.tick(RALLY.callMs - 1000);
  v = t.view().town!;
  assert.equal(v.scene?.id, 'rally');
  assert.equal(v.show?.banner, undefined);
  const { w1, w2 } = v.scene!.vars!;
  assert.ok(RALLY_LINES.includes(w1 as never) && RALLY_LINES.includes(w2 as never) && w1 !== w2, `${w1} / ${w2}`);
  for (const n of comers.slice(0, 6)) assert.ok(far(t.s.dudes.find((x) => x.name === n)!.position) < 6, `${n} is at the fire`);
  for (const r of ['wren', 'oak', 'moss', 'kit'] as const) assert.ok(far(castTownie(t.s, r)!.position) < 6, `${r} is at the fire`);

  // "Him or us?": each "us" joins red and lights a pip; a gold chatter is refused and lights none.
  await t.tick(RALLY.askAt - RALLY.callMs + 500);
  assert.deepEqual(t.view().town!.show?.prompt, { kind: 'pips', label: 'Him or us? · type us', count: 0 });
  t.run('side-set', 'gus gold');
  for (const n of ['kim', 'ann', 'gus']) await t.say(n, 'us');
  await t.say('lee', 'us lot are great');
  await t.tick(1000);
  assert.equal(t.view().town!.show?.prompt?.count, 2);
  assert.equal(sideNow(t.s, t.s.dudes.find((x) => x.name === 'kim')!), 'red');
  assert.equal(sideNow(t.s, t.s.dudes.find((x) => x.name === 'ann')!), 'red');
  assert.equal(sideNow(t.s, t.s.dudes.find((x) => x.name === 'gus')!), 'gold', 'one pick per age');
  assert.equal(sideNow(t.s, t.s.dudes.find((x) => x.name === 'lee')!), undefined, 'a line is not a vote');
  assert.ok(cityOf(t.s).story?.sideLog?.some((e) => e.name === 'kim' && e.side === 'red'), 'on the ticker');

  // The NOW card, then the release: the scene goes and the comers are let go.
  await t.tick(RALLY.nowAt - RALLY.askAt);
  assert.deepEqual(t.view().town!.show?.now, { word: 'STAND WITH WREN', chip: 'type red', side: 'red', until: cityOf(t.s).story!.scene!.at + RALLY.ms });
  await t.tick(RALLY.ms - RALLY.nowAt + 1000);
  assert.equal(cityOf(t.s).story?.scene, undefined);
  await t.tick(10_000);
  assert.ok(!t.s.dudes.some((d) => d.gather), 'everyone let go');
  assert.deepEqual(t.alerts, []);
});

test('Play: Rally needs Story on, and Story OFF mid-rally lets everyone go', async () => {
  const t = await rallyTown();
  await t.run('story-play', 'crossing');
  await t.tick(SCENES.crossing.ms + 1000);
  assert.equal(t.run('story-play', 'rally'), undefined);
  await t.say('kim', 'coming');
  await t.tick(500);
  assert.ok(t.s.dudes.find((d) => d.name === 'kim')!.gather);
  t.run('story-off');
  assert.equal(cityOf(t.s).story?.scene, undefined);
  assert.ok(!t.s.dudes.some((d) => d.gather));
  assert.equal(t.view().town?.show, undefined);
  assert.match(t.run('story-play', 'rally') ?? 'ran', /Story is off/);
});
