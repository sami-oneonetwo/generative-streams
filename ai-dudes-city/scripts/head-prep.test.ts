// The head at a Call (FK-020): the server puts Sami's character where the scene needs him, so he never
// has to find a mark. Shown whatever H says, off what he was riding, the weapon away, snapped onto the
// mark facing the tarp, the operator page told to jump there; then pinned there (no walking, riding,
// playing or firing; still talking and posing) until the release, after which he walks again and H's
// own say holds. The Intro's flashback hides him whatever the page asks. None of it with Story off.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { STORY_SITES } from '../src/shared/storyMap';
import { MAYOR, forceHeadHidden, headHidden, mayorDudeView, mayorInput, mayorView, prepareHead, releaseHead, tickMayor } from '../src/worlds/ai-dudes/mayor';
import { mayorSpot } from '../src/worlds/ai-dudes/bits';
import { stateSchema } from '../src/worlds/ai-dudes/state';
import { releaseShow } from '../src/worlds/ai-dudes/story/show';
import { harness } from './harness';

const MARK = STORY_SITES.headMark;
const FAR = { x: -30, z: -30 };
const near = (a: { x: number; z: number }, b: { x: number; z: number }, m = 0.01) => Math.hypot(a.x - b.x, a.z - b.z) < m;

/** /mayor open, the Mayor far from the mark aboard a donkey, a blaster in hand, hidden with H. */
async function outRiding() {
  const hs = harness({ reply: () => ({ actions: [] }) });
  const { h, tick } = hs;
  mayorInput(h.state, { t: 'move', x: FAR.x, z: FAR.z, facing: 0, moving: false }, h.now);
  mayorInput(h.state, { t: 'build', what: 'a donkey that roams the streets', at: { x: FAR.x + 2, z: FAR.z } }, h.now);
  await tick(20_000);
  const donkey = h.state.objects.find((o) => /donkey/i.test(o.blueprint.name))!;
  assert.ok(donkey, 'the donkey went up');
  mayorInput(h.state, { t: 'move', x: donkey.position.x + 1, z: donkey.position.z, facing: 0, moving: false }, h.now);
  assert.equal(mayorInput(h.state, { t: 'ride' }, h.now)?.view.riding?.id, donkey.id, 'aboard');
  mayorInput(h.state, { t: 'move', x: FAR.x, z: FAR.z, facing: 1, moving: true, cx: FAR.x + 15, cz: FAR.z }, h.now);
  mayorInput(h.state, { t: 'arm', weapon: 'blaster' }, h.now);
  mayorInput(h.state, { t: 'visible', on: false }, h.now);
  const m = h.state.mayor!;
  assert.ok(m.riding && m.armed === 'blaster' && m.hidden, 'riding, armed and hidden');
  return { ...hs, donkey, m };
}

test('Story OFF: prepareHead touches nothing', async () => {
  const { h, m } = await outRiding();
  const before = structuredClone(m);
  assert.equal(prepareHead(h.state, MARK.at, MARK.facing, h.now), false);
  assert.deepEqual(h.state.mayor, before, 'today’s game: he is where he was, riding, armed and hidden');
  assert.equal(mayorView(h.state, h.now).lock, undefined);
});

test('the Call puts him on his mark: off the donkey, weapon away, shown whatever H says, facing the tarp', async () => {
  const { h, m, donkey, world } = await outRiding();
  h.state.ai.story = true;
  const moved = m.moved ?? 0;
  m.emote = { pose: 'dance', until: h.now + 10_000 };
  assert.equal(prepareHead(h.state, MARK.at, MARK.facing, h.now), true);
  const view = mayorView(h.state, h.now);
  assert.ok(near(view.position, MARK.at), 'on the mark');
  assert.equal(view.facing, MARK.facing, 'facing the tarp');
  assert.equal(view.moving, false);
  assert.equal(view.riding, undefined, 'off the donkey');
  assert.ok(near(donkey.driven?.at ?? donkey.position, FAR, 3), 'which stays where he left it');
  assert.equal(view.armed, undefined, 'the weapon put away');
  assert.equal(view.emote, undefined, 'out of the dance');
  assert.equal(view.moved, moved + 1, 'the operator page jumps there too');
  assert.ok(near({ x: view.cam.x!, z: view.cam.z! }, MARK.at), 'the camera on him, not off over the square');
  assert.deepEqual(view.lock, { at: MARK.at, facing: MARK.facing }, '/mayor hears of the lock');
  assert.equal(view.hidden, undefined, 'shown, though H hid him');
  assert.equal(m.hidden, true, 'H’s own say is kept');
  assert.equal(view.ownHidden, true, 'and /mayor hears it apart, for its status row and the release');
  const figure = world.buildScene(h.state, { now: h.now } as never).dudes.find((d) => d.mayor);
  assert.ok(figure && near(figure.position, MARK.at), 'the stream draws him on the mark');
});

test('on his mark WASD waits: steps sent from far away keep him there; no riding, playing or firing; he still talks', async () => {
  const { h, m } = await outRiding();
  h.state.ai.story = true;
  prepareHead(h.state, MARK.at, MARK.facing, h.now);
  // A step the page sent before it heard of the lock, then more WASD: he stays put; the camera still turns and zooms.
  const view = mayorInput(h.state, { t: 'move', x: FAR.x, z: FAR.z, facing: 1, moving: true, running: true, yaw: 2, half: 20, cx: 0, cz: 0 }, h.now)!.view;
  assert.ok(near(view.position, MARK.at) && view.facing === MARK.facing, 'still on the mark, facing the tarp');
  assert.equal(view.moving, false);
  assert.equal(view.running, undefined);
  assert.equal(view.cam.yaw, 2, 'the camera turns');
  assert.equal(view.cam.half, 20, 'and zooms');
  assert.ok(near({ x: view.cam.x!, z: view.cam.z! }, MARK.at), 'on him, never free');
  assert.equal(mayorInput(h.state, { t: 'ride' }, h.now), undefined, 'nothing to get on');
  assert.equal(mayorInput(h.state, { t: 'play' }, h.now), undefined, 'no game of hoops');
  assert.equal(mayorInput(h.state, { t: 'arm', weapon: 'rocket' }, h.now), undefined, 'the weapon stays away');
  assert.equal(m.armed, undefined);
  assert.equal(mayorInput(h.state, { t: 'fire' }, h.now), undefined, 'nothing fired');
  assert.ok(mayorInput(h.state, { t: 'say', text: 'Behold. Mine.' }, h.now), 'he speaks');
  assert.equal(m.say?.text, 'Behold. Mine.');
  assert.ok(mayorInput(h.state, { t: 'emote', pose: 'point' }, h.now), 'and points');
  // H while on the mark: kept as his wish; the stream still sees him.
  mayorInput(h.state, { t: 'visible', on: true }, h.now);
  mayorInput(h.state, { t: 'visible', on: false }, h.now);
  assert.equal(mayorView(h.state, h.now).hidden, undefined, 'still shown');
  assert.ok(m.say, 'and his line stays up');
});

test('the release: he walks again from the mark, and H’s say holds again', async () => {
  const { h, m } = await outRiding();
  h.state.ai.story = true;
  prepareHead(h.state, MARK.at, MARK.facing, h.now);
  assert.equal(releaseHead(h.state), true);
  assert.equal(releaseHead(h.state), false, 'once');
  const view = mayorInput(h.state, { t: 'move', x: MARK.at.x - 1, z: MARK.at.z, facing: 0, moving: true }, h.now)!.view;
  assert.equal(view.lock, undefined, 'WASD is his');
  assert.ok(near(view.position, { x: MARK.at.x - 1, z: MARK.at.z }), 'he walks');
  assert.equal(view.hidden, true, 'hidden again, as H said');
  assert.equal(view.ownHidden, undefined, 'H decides again');
  assert.ok(mayorInput(h.state, { t: 'arm', weapon: 'blaster' }, h.now) && m.armed === 'blaster', 'G works again');
  // FK-001's release (boot, Story OFF, Stop) lets him go the same way.
  prepareHead(h.state, MARK.at, MARK.facing, h.now);
  assert.ok(releaseShow(h.state) >= 1);
  assert.equal(mayorView(h.state, h.now).lock, undefined);
});

test('forcedHidden (the Intro’s flashback): out of sight whatever the page asks; the Call shows him again', async () => {
  const { h, m } = await outRiding();
  h.state.ai.story = true;
  mayorInput(h.state, { t: 'visible', on: true }, h.now);
  mayorInput(h.state, { t: 'say', text: 'hello' }, h.now);
  forceHeadHidden(h.state, true, h.now);
  assert.equal(m.say, undefined, 'his line goes with him');
  mayorInput(h.state, { t: 'visible', on: true }, h.now);
  assert.equal(headHidden(h.state, m), true);
  assert.equal(mayorView(h.state, h.now).hidden, true, 'the page sees him hidden');
  assert.equal(mayorView(h.state, h.now).ownHidden, false, 'though H shows him (a page opened now knows, and so does the next H)');
  assert.deepEqual(mayorDudeView(h.state, h.now), [], 'the stream doesn’t draw him');
  assert.equal(mayorInput(h.state, { t: 'say', text: 'psst' }, h.now), undefined, 'nor hears him');
  forceHeadHidden(h.state, false, h.now);
  assert.equal(mayorView(h.state, h.now).hidden, undefined, 'back as H says');
  assert.equal(mayorView(h.state, h.now).ownHidden, undefined);
  forceHeadHidden(h.state, true, h.now);
  prepareHead(h.state, MARK.at, MARK.facing, h.now);
  assert.equal(m.forcedHidden, undefined, 'the Call shows him');
  assert.equal(mayorDudeView(h.state, h.now).length, 1);
});

test('Story OFF ignores a lock and a hiding left in the save: he walks, rides and shows as H says', async () => {
  const { h, m } = await outRiding();
  m.lock = { at: { ...MARK.at }, facing: MARK.facing, since: h.now };
  m.forcedHidden = true;
  mayorInput(h.state, { t: 'visible', on: true }, h.now);
  const view = mayorInput(h.state, { t: 'move', x: FAR.x + 3, z: FAR.z, facing: 0, moving: true }, h.now)!.view;
  assert.ok(near(view.position, { x: FAR.x + 3, z: FAR.z }), 'he walks');
  assert.equal(view.hidden, undefined, 'and shows');
  assert.equal(view.lock, undefined);
  assert.equal(view.ownHidden, undefined, 'H decides, as today');
  assert.ok(mayorInput(h.state, { t: 'ride' }, h.now), 'and gets off the donkey');
});

test('a lock the show never lets go of times out, and his WASD comes back', async () => {
  const { h, m } = await outRiding();
  h.state.ai.story = true;
  prepareHead(h.state, MARK.at, MARK.facing, h.now);
  tickMayor(h.state, h.now + MAYOR.lockMs - 1000);
  assert.ok(m.lock, 'held through the longest scene');
  tickMayor(h.state, h.now + MAYOR.lockMs + 1000);
  assert.equal(m.lock, undefined, 'then let go');
});

test('a face that isn’t a number keeps the way he faces, so the save still loads; a mark that isn’t a place is refused', async () => {
  const { h, m } = await outRiding();
  h.state.ai.story = true;
  const facing = m.facing;
  assert.equal(prepareHead(h.state, MARK.at, Number.NaN, h.now), true);
  assert.equal(m.facing, facing);
  assert.equal(m.lock?.facing, facing);
  assert.ok(stateSchema.safeParse(JSON.parse(JSON.stringify(h.state))).success, 'the save loads');
  releaseHead(h.state);
  const before = structuredClone(m);
  assert.equal(prepareHead(h.state, { x: Number.NaN, z: 0 }, MARK.facing, h.now), false);
  assert.deepEqual(h.state.mayor, before, 'nothing touched');
});

test('chatters’ bits see him as the stream does: on his mark though H hid him, not during the flashback; Story OFF as today', async () => {
  const { h, m } = await outRiding();
  assert.equal(mayorSpot(h.state, h.now), undefined, 'Story OFF: hidden with H is out of sight');
  h.state.ai.story = true;
  prepareHead(h.state, MARK.at, MARK.facing, h.now);
  assert.ok(m.hidden, 'H still says hidden');
  assert.ok(near(mayorSpot(h.state, h.now)!, MARK.at), 'but the stream shows him on his mark: "go to the Mayor" goes there');
  releaseHead(h.state);
  mayorInput(h.state, { t: 'visible', on: true }, h.now);
  assert.ok(mayorSpot(h.state, h.now), 'out and about');
  forceHeadHidden(h.state, true, h.now);
  assert.equal(mayorSpot(h.state, h.now), undefined, 'the flashback hides him from bits too');
});

test('Story (dev) → Gather puts him on his mark, off the donkey, the weapon away; Stop lets him go', async () => {
  const { h, m, world, ctx } = await outRiding();
  const press = (id: string) => world.adminActions!.find((a) => a.id === id)!.run(ctx) || undefined;
  assert.match(press('story-gather') ?? 'ran', /^Story is off/, 'Story OFF: today’s game');
  assert.equal(m.lock, undefined);
  press('story-on');
  assert.equal(press('story-gather'), undefined);
  const view = mayorView(h.state, h.now);
  assert.ok(near(view.position, MARK.at) && view.facing === MARK.facing && view.lock, 'on his mark, facing the tarp');
  assert.ok(!view.riding && !view.armed && !view.hidden, 'off the donkey, the weapon away, shown');
  assert.equal(press('story-stop'), undefined);
  assert.equal(m.lock, undefined, 'Stop gives him his WASD back');
});
