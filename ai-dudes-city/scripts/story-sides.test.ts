// Red and gold (FK-012): with Story on, `red`, `gold` and `help` as the whole message set a chatter's
// side for the age, put it on the ticker and send their dude to the side's job, with no agent call;
// one pick per age (the other word is refused through the crier); a neutral's `help` goes to red; sides
// survive a save; and lines that only contain the words ("make my house gold", "help me build a hut")
// reach the agent as today, from a newcomer and from someone already in town. Story OFF is today's game.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { harness } from './harness';
import { loadState, saveState } from '../src/engine/persistence';
import { ageOf, cityOf } from '../src/worlds/ai-dudes/city';
import { CRIER } from '../src/worlds/ai-dudes/crier';
import { STORY_SITES } from '../src/shared/storyMap';
import { SCENES } from '../src/shared/scenes';
import type { DudesScene } from '../src/shared/dudesTypes';
import { STORY_CAPS, stateSchema } from '../src/worlds/ai-dudes/state';
import { raiseFolly } from '../src/worlds/ai-dudes/story/folly';
import { SIDES, sideNow, sideWord, takeSide } from '../src/worlds/ai-dudes/story/sides';
import { gatherTally, gathering } from '../src/worlds/ai-dudes/story/gather';

/** A town with the caravan in (Stone's band stuck across the river), Story on or off; `names` said hello first. */
async function town(opts: { story?: boolean; names?: string[] } = {}) {
  const hs = harness({ town: true });
  hs.h.state.ai.story = opts.story ?? true;
  for (const n of opts.names ?? []) await hs.say(n, 'hello');
  await hs.tick(2000);
  const view = () => hs.world.buildScene(hs.h.state, { now: hs.h.now } as never) as unknown as DudesScene;
  const run = (id: string, value?: string) => hs.world.adminActions!.find((a) => a.id === id)!.run({ state: hs.h.state, now: hs.h.now, log: () => {} } as never, value as never);
  const dude = (name: string) => hs.h.state.dudes.find((d) => d.name === name)!;
  const sideLog = () => cityOf(hs.h.state).story?.sideLog ?? [];
  /** Agent turns taken for `name` (all of them with no name). */
  const turns = (name?: string) => hs.h.turns.filter((t) => !name || t.name === name).length;
  const asked = (text: string) => hs.h.turns.some((t) => t.messages.some((m) => m.includes(text)));
  return { ...hs, view, run, dude, sideLog, turns, asked };
}
const near = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z);

test("side words are the whole message only, by gather mode's rule: trimmed, any case, a trailing ! or ., Kick emotes aside", () => {
  for (const [line, word] of [['red', 'red'], ['RED', 'red'], [' Gold ', 'gold'], ['gold!', 'gold'], ['help!!', 'help'], ['Help', 'help'], ['red.', 'red'], ['gold [emote:123:KEKW]', 'gold']] as const)
    assert.equal(sideWord(line), word, line);
  for (const line of ['make my house gold', 'help me build a hut', 'red gold', '!red', '!help', 'redd', 'golden', 'red?', 'go red', 'gold KEKW', ''])
    assert.equal(sideWord(line), undefined, line);
});

test('Story OFF: "red" is an agent line as today, and nobody takes a side', async () => {
  const { h, tick, say, dude, sideLog, view, turns, asked } = await town({ story: false });
  await say('test-kev', 'red');
  await tick(2000);
  assert.equal(dude('test-kev').side, undefined);
  assert.deepEqual(sideLog(), []);
  assert.equal(turns('test-kev'), 1, 'the agent heard it');
  assert.ok(asked('red'));
  assert.equal(view().town?.board, undefined, "today's page");
  assert.equal(h.announced.length, 0);
});

test('"kev: red": kev is red, the ticker says so, the tug line moves, he heads for Wren\'s sign, and no agent call', async () => {
  const { h, tick, say, dude, sideLog, view, turns } = await town();
  assert.deepEqual(view().town!.board!.tally, { red: 0, gold: 0 });
  await say('test-kev', 'red');
  const kev = dude('test-kev');
  assert.deepEqual([kev.side, kev.sideAge], ['red', 0]);
  assert.deepEqual(sideLog(), [{ at: h.now, id: kev.id, name: 'test-kev', side: 'red' }]);
  assert.equal(kev.say?.text, 'red', 'the bubble shows what he typed');
  // Before the opening there's no bridge ask: red's job is a walk to Wren's sign, ending facing it.
  assert.equal(kev.labour, undefined);
  const end = kev.path.at(-1)!;
  assert.ok(near(end, STORY_SITES.redSign.at) <= SIDES.signRing[1] + 0.1, `by the sign (${near(end, STORY_SITES.redSign.at).toFixed(1)} m)`);
  assert.equal(kev.history.at(-1)?.text, "you joined red, Wren's side, and went over to Wren's sign by the bridge");
  await tick(30_000);
  assert.ok(near(kev.position, STORY_SITES.redSign.at) <= SIDES.signRing[1] + 0.1, 'there');
  const look = Math.atan2(STORY_SITES.redSign.at.x - kev.position.x, STORY_SITES.redSign.at.z - kev.position.z);
  assert.ok(Math.abs(Math.atan2(Math.sin(kev.facing - look), Math.cos(kev.facing - look))) < 0.05, 'facing the sign');
  const b = view().town!.board!;
  assert.deepEqual(b.tally, { red: 1, gold: 0 }, 'the tug line moved');
  assert.ok(b.ticker.includes('Test-kev joined red'));
  assert.equal(view().dudes.find((d) => d.name === 'test-kev')?.side, 'red', 'the disc and the flag');
  assert.equal(turns(), 0, 'no agent call');
  assert.ok(stateSchema.safeParse(JSON.parse(JSON.stringify(h.state))).success, 'the save takes it');
});

test('"kev: gold" in the same age: the crier says "You\'re red this age", once a minute, and nothing changes', async () => {
  const { h, tick, say, dude, sideLog, view, turns } = await town();
  await say('test-kev', 'red');
  await tick(1000);
  const kev = dude('test-kev');
  const path = structuredClone(kev.path);
  await say('test-kev', 'gold');
  assert.deepEqual(kev.path, path, 'still on his way to the sign');
  await tick(1000);
  assert.deepEqual(h.announced, ["You're red this age, @test-kev."]);
  assert.equal(kev.side, 'red', 'side unchanged');
  assert.equal(sideLog().length, 1, 'nothing new on the ticker');
  await say('test-kev', 'GOLD!');
  await tick(CRIER.askMs - 5000);
  assert.equal(h.announced.length, 1, 'not again inside the minute');
  await tick(6000);
  await say('test-kev', 'gold');
  await tick(1000);
  assert.equal(h.announced.length, 2, 'and again after it');
  assert.deepEqual(view().town!.board!.tally, { red: 1, gold: 0 });
  assert.equal(turns(), 0, 'no agent call');
});

test("a crier reply waits out the commands' gap and goes out with the others", async () => {
  const { h, tick, say } = await town();
  for (const n of ['test-kev', 'test-dana', 'test-bo']) await say(n, 'red');
  for (const n of ['test-kev', 'test-dana', 'test-bo']) await say(n, 'gold');
  await tick(CRIER.answerMs * 2);
  assert.ok(h.announced.length <= 2, h.announced.join(' | '));
  const all = h.announced.join(' · ');
  for (const n of ['test-kev', 'test-dana', 'test-bo']) assert.ok(all.includes(`You're red this age, @${n}.`), n);
});

test('with the bridge ask open red takes a shift on it, one per chatter; after that red goes to the sign', async () => {
  const names = ['test-kev', 'test-dana', 'test-bo', 'test-nia', 'test-ash', 'test-lee'];
  const { h, tick, say, dude, run, turns } = await town({ names });
  run('scene-opening');
  await tick(SCENES.opening.ms + 1000);
  const cv = () => cityOf(h.state).caravan!;
  assert.ok(cv().asks.some((a) => a.kind === 'bridge' && a.need >= 2), 'the bridge asks for hands');
  const before = turns('test-kev');
  await say('test-kev', 'red');
  assert.equal(dude('test-kev').labour?.site, 'bridge', 'off to the bridge at once');
  assert.equal(dude('test-kev').history.at(-1)?.text, "you joined red, Wren's side, and set off to help mend the bridge for the travellers");
  for (let i = 0; i < 40 && !cv().helpers?.includes(dude('test-kev').id); i++) await tick(2000);
  assert.ok(cv().helpers?.includes(dude('test-kev').id), 'his shift counted');
  assert.ok(cv().stranded, 'one shift is not the whole bridge');
  await say('test-kev', 'help');
  assert.notEqual(dude('test-kev').labour?.site, 'bridge', 'one shift per chatter');
  assert.ok(near(dude('test-kev').path.at(-1)!, STORY_SITES.redSign.at) <= SIDES.signRing[1] + 0.1, "so Wren's sign");
  assert.equal(dude('test-kev').history.at(-1)?.text, "you went over to Wren's sign by the bridge");
  assert.equal(turns('test-kev'), before, 'no agent call for either word');
});

test("a neutral's help goes to red and joins it; gold's help walks to the cordon, and gold's names go on the plaque", async () => {
  const { h, tick, say, dude, sideLog, turns } = await town();
  await say('test-nia', 'help');
  assert.equal(dude('test-nia').side, 'red', 'help from nobody: Wren');
  assert.deepEqual(sideLog().map((e) => [e.name, e.side]), [['test-nia', 'red']]);
  assert.equal(raiseFolly(h.state, h.now), undefined, 'the cordon goes up');
  await say('test-dana', 'gold');
  const dana = dude('test-dana');
  assert.equal(dana.side, 'gold');
  const s = STORY_SITES.folly;
  const end = dana.path.at(-1)!;
  // (Paths snap to a half-metre grid.)
  assert.ok(Math.abs(end.z - (s.rect.maxZ + SIDES.cordonOut)) <= 0.5 && end.x >= s.rect.minX && end.x <= s.rect.maxX, `along the cordon's front (${end.x.toFixed(1)}, ${end.z.toFixed(1)})`);
  assert.equal(dana.history.at(-1)?.text, "you joined gold, the Chief's side, and went over to the cordon round The Big Hut (your name goes on its plaque)");
  await tick(1000);
  assert.deepEqual(cityOf(h.state).story!.folly!.plaque, ['test-dana'], 'her name on the plaque');
  dana.path = [];
  await say('test-dana', 'help!');
  assert.equal(dana.side, 'gold');
  assert.ok(dana.path.length, 'back to the cordon');
  assert.equal(sideLog().length, 2, 'help on your own side logs nothing');
  assert.equal(turns(), 0);
});

test('a new age: last age\'s red can cross to gold (on the ticker), then is held to it; help picks last age\'s side up again', async () => {
  const { h, tick, say, dude, sideLog, run, view } = await town();
  await say('test-kev', 'red');
  await say('test-bo', 'gold');
  run('set-age', 'bronze');
  await tick(2000);
  assert.equal(ageOf(h.state), 1);
  assert.equal(sideNow(h.state, dude('test-kev')), undefined, "Stone's side doesn't count in Bronze");
  await say('test-kev', 'gold');
  assert.deepEqual([dude('test-kev').side, dude('test-kev').sideAge], ['gold', 1]);
  assert.deepEqual(sideLog().at(-1), { at: h.now, id: dude('test-kev').id, name: 'test-kev', side: 'gold', from: 'red' });
  assert.ok(view().town!.board!.ticker.includes('Test-kev crossed to gold'));
  await say('test-kev', 'red');
  await tick(1000);
  assert.equal(dude('test-kev').side, 'gold', 'one pick per age');
  assert.ok(h.announced.includes("You're gold this age, @test-kev."));
  await say('test-bo', 'help');
  assert.deepEqual([dude('test-bo').side, dude('test-bo').sideAge], ['gold', 1], 'back on gold for Bronze');
  assert.deepEqual(sideLog().at(-1), { at: h.now, id: dude('test-bo').id, name: 'test-bo', side: 'gold' }, 'joined, not crossed');
});

test('"make my house gold" and "help me build a hut" reach the agent as today, from a newcomer and from a chatter in town', async () => {
  const { tick, say, dude, sideLog, asked } = await town({ names: ['test-kev'] });
  // Newcomers: their first line comes through the newcomer branch.
  await say('test-new1', 'make my house gold');
  await say('test-new2', 'help me build a hut');
  // Known chatters.
  await say('test-kev', 'make my house gold');
  await tick(4000);
  await say('test-kev', 'help me build a hut');
  await tick(4000);
  for (const n of ['test-new1', 'test-new2', 'test-kev']) assert.equal(dude(n).side, undefined, n);
  assert.deepEqual(sideLog(), []);
  assert.ok(asked('make my house gold') && asked('help me build a hut'));
  for (const [n, line] of [['test-new1', 'make my house gold'], ['test-new2', 'help me build a hut']] as const)
    assert.ok(dude(n).history.some((l) => l.from === 'chatter' && l.text === line), `${n}'s agent read it`);
  assert.equal(dude('test-kev').history.filter((l) => l.from === 'chatter' && /gold|hut/.test(l.text)).length, 2);
});

test("a newcomer's first line can be a side word: they move in and take the side, no agent call", async () => {
  const { h, say, dude, turns } = await town();
  await say('test-bo', 'GOLD');
  const bo = dude('test-bo');
  assert.ok(bo, 'moved in');
  assert.equal(bo.side, 'gold');
  assert.ok(bo.history.some((l) => /got a lot of your own|flat|arrived/.test(l.text)), 'arrived as anyone does');
  assert.equal(turns(), 0);
  assert.ok(h.state.dudes.length === 1);
});

test("a body someone else has keeps still: a player walking it, a gathering holding it (gather mode: a vote, and the side); the side still counts", async () => {
  const { h, world, ctx, say, dude } = await town({ names: ['test-kev', 'test-dana'] });
  const kev = dude('test-kev');
  assert.ok(typeof world.players!.join(ctx, kev.id, 'test-kev') === 'object', 'kev walks himself (/play)');
  await say('test-kev', 'red');
  assert.equal(kev.side, 'red');
  assert.deepEqual(kev.path, []);
  world.players!.leave(ctx, kev.id);
  const dana = dude('test-dana');
  dana.gather = { slot: { x: 54, z: 58 }, face: Math.PI, until: h.now + 30_000 };
  dana.path = [];
  await say('test-dana', 'gold');
  assert.equal(dana.side, 'gold');
  assert.deepEqual(dana.path, [], 'stays in the ring');
  assert.equal(dana.history.at(-1)?.text, "you joined gold, the Chief's side");
});

test("during a scene the word is gather mode's vote and still takes the side, never its job; after the release help works it", async () => {
  const { h, tick, say, dude, sideLog, run, turns } = await town({ names: ['test-kev', 'test-dana'] });
  const before = turns();
  dude('test-kev').path = [];
  assert.equal(run('story-play', 'test'), undefined);
  assert.ok(gathering(h.state));
  await say('test-kev', 'red!');
  await say('test-dana', 'gold');
  await say('test-new', 'help');
  assert.deepEqual(['test-kev', 'test-dana', 'test-new'].map((n) => dude(n).side), ['red', 'gold', 'red'], "a newcomer's help: red");
  assert.deepEqual(dude('test-kev').path, [], 'held: no walk to the sign mid-scene');
  assert.equal(dude('test-kev').say?.text, 'red!', 'the bubble, as for every line in a scene');
  assert.deepEqual(gatherTally(h.state).words.red, [dude('test-kev').id], 'the vote counts');
  assert.deepEqual(sideLog().map((e) => e.name), ['test-kev', 'test-dana', 'test-new']);
  await say('test-kev', 'gold');
  await tick(1000);
  assert.equal(dude('test-kev').side, 'red');
  assert.ok(h.announced.includes("You're red this age, @test-kev."));
  await tick(12_000);
  assert.equal(gathering(h.state), false, 'released');
  await say('test-kev', 'help');
  assert.ok(near(dude('test-kev').path.at(-1)!, STORY_SITES.redSign.at) <= SIDES.signRing[1] + 0.1, "now he goes to Wren's sign");
  assert.equal(turns('test-kev') + turns('test-dana'), before, 'no agent call for any of it');
});

test("takeSide (the Rally's path) logs once per side, and refuses the other side this age", async () => {
  const { h, say, dude, sideLog } = await town();
  await say('test-kev', 'hi');
  const kev = dude('test-kev');
  assert.equal(takeSide(h.state, kev, 'red', h.now), undefined);
  assert.equal(takeSide(h.state, kev, 'red', h.now), undefined, 'again: nothing');
  assert.equal(sideLog().length, 1);
  assert.equal(takeSide(h.state, kev, 'gold', h.now), "You're red this age, @test-kev.");
  assert.equal(kev.side, 'red');
});

test('the ticker log stays under its cap', async () => {
  const { h, say, sideLog, run, tick } = await town();
  for (let i = 0; i < STORY_CAPS.sideLog + 10; i++) await say(`test-${i}`, i % 2 ? 'red' : 'gold');
  assert.equal(sideLog().length, STORY_CAPS.sideLog);
  assert.equal(sideLog().at(-1)!.name, `test-${STORY_CAPS.sideLog + 9}`, 'the newest kept');
  run('set-age', 'bronze');
  await tick(1000);
  assert.ok(stateSchema.safeParse(JSON.parse(JSON.stringify(h.state))).success);
});

test('sides survive a save and a load', async () => {
  const { h, world, say, dude, sideLog } = await town();
  await say('test-kev', 'red');
  await say('test-dana', 'gold');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dudes-sides-'));
  world.beforeSave!(h.state);
  saveState(world, dir, h.state);
  const back = loadState(world, dir, () => {});
  const sideOf = (name: string) => back.dudes.find((d) => d.name === name)!;
  assert.deepEqual([sideOf('test-kev').side, sideOf('test-kev').sideAge], ['red', 0]);
  assert.deepEqual([sideOf('test-dana').side, sideOf('test-dana').sideAge], ['gold', 0]);
  assert.deepEqual(back.city!.story!.sideLog, sideLog());
  assert.equal(sideNow(back, sideOf('test-kev')), dude('test-kev').side);
});

test('Story (dev) → Set side: sets it outright and puts it on the ticker; none clears it; a bad line says why', async () => {
  const { say, dude, sideLog, run } = await town();
  await say('test-kev', 'hi');
  assert.equal(run('side-set', 'test-kev gold'), undefined);
  assert.deepEqual([dude('test-kev').side, dude('test-kev').sideAge], ['gold', 0]);
  assert.equal(run('side-set', '@TEST-KEV red'), undefined, 'past the one-per-age limit, any case, with an @');
  assert.equal(dude('test-kev').side, 'red');
  assert.deepEqual(sideLog().map((e) => [e.side, e.from]), [['gold', undefined], ['red', 'gold']]);
  assert.equal(run('side-set', 'test-kev none'), undefined);
  assert.equal(dude('test-kev').side, undefined);
  assert.match(run('side-set', 'test-kev') ?? '', /red, gold or none/);
  assert.match(run('side-set', 'nobody red') ?? '', /no chatter called "nobody"/);
  run('story-off');
  assert.match(run('side-set', 'test-kev red') ?? '', /Story is off/);
});

test('Story OFF sends no side on the page, though the save keeps it', async () => {
  const { h, say, view, dude } = await town();
  await say('test-kev', 'red');
  assert.equal(view().dudes.find((d) => d.name === 'test-kev')?.side, 'red');
  h.state.ai.story = false;
  assert.equal(view().dudes.find((d) => d.name === 'test-kev')?.side, undefined, "today's page");
  assert.equal(dude('test-kev').side, 'red');
});
