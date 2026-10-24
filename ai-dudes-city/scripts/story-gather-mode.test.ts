// Gather mode (FK-018): while a story scene or a gathering runs, a chat line is a bubble and maybe a
// vote, never an agent turn: nothing reaches an inbox, overhear or spokeTo, nobody is called out of a
// party, and the turns characters take on their own wait for the release. Keywords count only as the
// whole message, once per chatter. A move or build waits on its chatter (their latest one) and goes to
// their agent after the release, one chatter at a time, at least 2 s apart. Story OFF: today's game.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { harness } from './harness';
import { cityOf } from '../src/worlds/ai-dudes/city';
import { ARRIVED_LINE, REPLAY_GAP_MS, gatherTally, gathering, keywordOf, movesOrBuilds } from '../src/worlds/ai-dudes/story/gather';
import { pilots } from '../src/worlds/ai-dudes/players';
import { stateSchema } from '../src/worlds/ai-dudes/state';
import { STORY_SCENES } from '../src/shared/storyScenes';
import type { AgentReply, AgentTurn } from '../src/worlds/ai-dudes/agent';
import type { DudesScene } from '../src/shared/dudesTypes';

/** A town with Story on and the caravan off; every agent turn noted with when it started and what it read. */
function gatherTown(opts: { reply?: (turn: AgentTurn) => AgentReply; idleLife?: boolean } = {}) {
  const started: { name: string; at: number; said: string[]; content: string }[] = [];
  const hs = harness({
    idleLife: opts.idleLife ?? false,
    reply: (turn) => opts.reply?.(turn) ?? { actions: [] },
  });
  const s = hs.h.state;
  s.ai.story = true;
  s.ai.caravan = false;
  // The harness's agent is called the moment a turn starts: note the time there.
  const agent = hs.h.turns;
  const push = agent.push.bind(agent);
  agent.push = (...turns: AgentTurn[]) => {
    for (const t of turns) started.push({ name: t.name, at: hs.h.now, said: t.messages, content: t.content });
    return push(...turns);
  };
  const action = (id: string) => hs.world.adminActions!.find((a) => a.id === id)!;
  return {
    ...hs,
    started,
    run: (id: string, value?: string) => action(id).run(hs.ctx, value) || undefined,
    view: () => hs.world.buildScene(s, { now: hs.h.now } as never) as unknown as DudesScene,
    dude: (name: string) => s.dudes.find((d) => d.name === name)!,
    /** Everyone says hello and their agent answers once, so nobody is new when the scene starts. */
    async met(...names: string[]) {
      for (const n of names) await hs.say(n, `hello from ${n}`);
      await hs.tick(1000);
      assert.equal(started.length, names.length, 'one hello turn each');
      started.length = 0;
      // What they overheard of each other's hellos is old news.
      for (const d of s.dudes) Object.assign(d, { overheard: [], nudges: undefined });
    },
  };
}

test('keywords count only as the whole message: a number 1–10, us, coming, warn, red, gold, help', () => {
  const words: [string, ReturnType<typeof keywordOf>][] = [
    ['us', { word: 'us' }],
    ['US!', { word: 'us' }],
    ['  Coming ', { word: 'coming' }],
    ['warn.', { word: 'warn' }],
    ['red', { word: 'red' }],
    ['GOLD!!', { word: 'gold' }],
    ['help', { word: 'help' }],
    ['7', { word: 'rate', n: 7 }],
    ['10/10', { word: 'rate', n: 10 }],
    ['8.5', { word: 'rate', n: 8.5 }],
    ['1!', { word: 'rate', n: 1 }],
    ['us [emote:37226:KEKW]', { word: 'us' }],
  ];
  for (const [line, k] of words) assert.deepEqual(keywordOf(line), k, line);
  for (const line of ['0', '11', '7/11', '10.5', 'us lot should build a wall', 'make my house gold', 'help me build a hut', 'red house please', 'coming soon?', 'is it a 7', 'gold?', '']) assert.equal(keywordOf(line), undefined, line);
  // What waits for the release: asks for the world, not reactions.
  for (const line of ['build me a hut', 'make my house gold', 'help me build a hut', 'go to the café', 'paint my tower pink', 'follow dana']) assert.ok(movesOrBuilds(line), line);
  for (const line of ['lol', 'omg it is huge', 'what is under the tarp', 'boooo', 'nice one chief']) assert.ok(!movesOrBuilds(line), line);
});

test('15 lines during a scene: no agent call, votes counted once per chatter, every line a bubble, nobody overhears or leaves a party', async () => {
  const t = gatherTown();
  const s = t.h.state;
  const names = ['kev', 'dana', 'bo', 'nia', 'cy', 'eve'];
  await t.met(...names);
  // Dana right beside Kev (she'd overhear him and he names her); Bo at a party.
  t.dude('dana').position = { ...t.dude('kev').position };
  t.dude('bo').visit = { placeId: 'town:square', phase: 'in', why: 'party', until: t.h.now + 120_000 };
  const callsBefore = s.ai.callsUsed;

  assert.equal(t.run('story-play', 'test'), undefined);
  assert.ok(gathering(s), 'a story scene puts chat in gather mode');
  const lines: [string, string][] = [
    ['kev', '7'],
    ['dana', '3'],
    ['kev', 'dana come and look at this'],
    ['bo', 'us'],
    ['bo', 'us'],
    ['nia', 'US!'],
    ['cy', 'coming'],
    ['eve', 'warn'],
    ['nia', 'omg it is huge'],
    ['kev', 'red'],
    ['dana', 'gold'],
    ['cy', 'help'],
    ['eve', 'what is under the tarp'],
    ['bo', 'nice one chief'],
    ['dana', '3'],
  ];
  for (const [who, line] of lines) {
    await t.say(who, line);
    assert.equal(t.dude(who).say?.text, line, `${who}'s "${line}" is in their bubble at once`);
  }
  // (Checked before the clock moves: the square has no party place in this test town, so a tick ends it.)
  assert.equal(t.dude('bo').visit?.why, 'party', 'Bo talking keeps him at the party');
  await t.tick(5000);

  assert.equal(t.started.length, 0, 'no agent turn for any of the 15 lines');
  assert.equal(s.ai.callsUsed, callsBefore, 'and no call booked');
  assert.ok(s.dudes.every((d) => !d.inbox.length), 'nothing reached an inbox');
  assert.ok(s.dudes.every((d) => !d.overheard.length && !d.nudges?.length), 'nobody overheard anything or was nudged to answer');
  assert.ok(t.view().dudes.every((d) => !d.queued && !d.thinking), 'nobody shows as waiting on their agent');

  const tally = gatherTally(s);
  assert.equal(tally.lines, 15);
  assert.deepEqual(tally.rate, { avg: 5, n: 2 }, 'RATE IT: Kev 7, Dana 3 (her second 3 replaces her first)');
  const ids = (...n: string[]) => n.map((x) => t.dude(x).id);
  assert.deepEqual(tally.words, { us: ids('bo', 'nia'), coming: ids('cy'), warn: ids('eve'), red: ids('kev'), gold: ids('dana'), help: ids('cy') }, 'each word once per chatter, first first');
  assert.ok(s.dudes.every((d) => !d.queuedLine), 'no move or build among them: nothing waits for the release');

  // The end of the scene: chat is chat again, the tally goes into the log.
  await t.tick(6000);
  assert.equal(cityOf(s).story?.scene, undefined, 'the scene is over');
  assert.equal(gathering(s), false);
  assert.ok(t.h.logs.includes('story: gather mode over (the test scene): 15 lines, none to an agent; RATE IT 5.0 from 2, us 2, coming 1, warn 1, red 1, gold 1, help 1'), t.h.logs.join('\n'));
  assert.equal(gatherTally(s).lines, 0, 'the next gathering starts from nothing');
  await t.say('kev', 'what did I miss');
  await t.tick(500);
  assert.deepEqual(t.started.map((x) => x.said), [['what did I miss']], 'after the release a line goes to its agent as today');
});

test('a build typed in a scene is built after the release; three lines make one queued turn; queued turns start at least 2 s apart', async () => {
  const t = gatherTown({ reply: (turn) => ({ actions: /build/.test(turn.messages.join(' ')) ? [{ do: 'build', what: 'a little hut' }] : [] }) });
  const s = t.h.state;
  await t.met('kev', 'dana', 'bo');
  const end = t.h.now + STORY_SCENES.test.ms;
  t.run('story-play', 'test');
  await t.say('kev', 'build me a hut');
  await t.say('kev', 'lol');
  await t.say('kev', '7');
  await t.say('dana', 'build a tower');
  await t.say('dana', 'go to the café');
  await t.say('bo', 'paint my house pink');
  assert.deepEqual(t.dude('kev').queuedLine?.text, 'build me a hut', "Kev's build waits; his lol and his 7 don't replace it");
  assert.deepEqual(t.dude('dana').queuedLine?.text, 'go to the café', "Dana's latest move or build wins");
  await t.tick(5000);
  assert.equal(t.started.length, 0, 'nothing goes to an agent during the scene');

  await t.tick(20_000);
  assert.deepEqual(
    t.started.map((x) => [x.name, x.said]),
    [
      ['kev', ['build me a hut']],
      ['dana', ['go to the café']],
      ['bo', ['paint my house pink']],
    ],
    'one turn each, oldest first, with the line that waited',
  );
  assert.ok(t.started[0].at >= end, 'none before the release');
  for (let i = 1; i < t.started.length; i++) assert.ok(t.started[i].at - t.started[i - 1].at >= REPLAY_GAP_MS, `turn ${i + 1} starts ${t.started[i].at - t.started[i - 1].at} ms after the one before`);
  assert.ok(s.dudes.every((d) => !d.queuedLine), 'nothing left waiting');
  assert.ok(t.h.logs.includes('story: kev\'s line from the gathering goes on, after the release: "build me a hut"'), t.h.logs.join('\n'));

  // Kev's hut goes up, as it would have without the scene.
  await t.tick(60_000);
  assert.equal(s.objects.filter((o) => o.owner === t.dude('kev').id).length, 1, "Kev's hut stands");
});

test("turns of a character's own wait for the release: no nudge turns and no idle life while a gathering runs", async () => {
  const t = gatherTown({ idleLife: true });
  const s = t.h.state;
  await t.met('kev', 'dana');
  // A gathering long enough for idle life's next turn (every 30–50 s) to come due inside it.
  assert.equal(t.run('story-gather'), undefined);
  t.dude('dana').nudges = ['kev waved at you'];
  // Both quiet for long enough that idle life would pick one.
  for (const d of s.dudes) Object.assign(d, { lastHeardAt: t.h.now - 120_000, lastTurnAt: t.h.now - 600_000 });
  await t.tick(60_000);
  assert.equal(t.started.length, 0, 'no nudge turn and no idle turn while the gathering runs');
  assert.deepEqual(t.dude('dana').nudges, ['kev waved at you'], 'the nudge waits');
  assert.equal(t.dude('kev').nudges, undefined, 'idle life picks nobody');
  t.run('story-stop');
  await t.tick(1000);
  // Idle life picks Kev, the one quiet character with nothing to react to, as soon as it may.
  assert.deepEqual(t.started.map((x) => x.name).sort(), ['dana', 'kev'], "Dana's nudge and an idle turn, once it's over");
});

test('a newcomer in a scene: bubble at once, and their agent meets them after the release; a muted chatter is never replayed', async () => {
  const t = gatherTown();
  await t.met('kev');
  t.run('story-play', 'test');
  await t.say('zed', 'hi everyone');
  await t.say('zed', 'lol');
  await t.say('kev', 'wow');
  assert.equal(t.dude('zed').say?.text, 'lol');
  assert.equal(t.dude('zed').queuedLine?.text, 'hi everyone', 'a first line waits for its agent, even with no build in it');
  assert.equal(t.dude('kev').queuedLine, undefined, 'a reaction from someone their agent knows is a bubble only');
  await t.say('mo', 'build me a hut');
  t.run('mute', 'mo');
  assert.equal(t.dude('mo').queuedLine, undefined, 'muting drops what waited');
  await t.tick(20_000);
  assert.deepEqual(t.started.map((x) => [x.name, x.said]), [['zed', ['hi everyone']]]);
});

test("a newcomer whose only words in a scene are votes: counted, and their agent meets them after the release, without the vote", async () => {
  const t = gatherTown();
  await t.met('kev');
  t.run('story-play', 'test');
  await t.say('zed', 'us');
  await t.say('zed', 'red');
  await t.say('ivy', '7');
  await t.say('ivy', 'hiya');
  assert.deepEqual(t.dude('zed').queuedLine, { text: ARRIVED_LINE, at: t.h.now, world: true }, 'their arrival waits for their agent');
  assert.equal(t.dude('ivy').queuedLine?.text, 'hiya', 'words of their own after a vote go instead');
  assert.deepEqual(gatherTally(t.h.state).words.us, [t.dude('zed').id]);
  assert.equal(gatherTally(t.h.state).rate?.avg, 7);
  await t.tick(20_000);
  assert.deepEqual(t.started.map((x) => [x.name, x.said]), [['zed', []], ['ivy', ['hiya']]], 'one turn each; no vote reaches an agent');
  assert.ok(t.started[0].content.includes(ARRIVED_LINE), 'Zed\'s agent hears that he arrived');
  assert.ok(t.h.logs.includes('story: zed, new in the gathering, meets their agent after the release'), t.h.logs.join('\n'));
  await t.tick(1000);
  assert.ok(t.dude('zed').turns > 0 && t.dude('ivy').turns > 0, 'both met');
});

test('a gathering with no scene (Story (dev) → Gather) is gather mode too, until Stop', async () => {
  const t = gatherTown();
  await t.met('kev');
  assert.equal(t.run('story-gather'), undefined);
  assert.ok(t.h.state.mayor?.lock && gathering(t.h.state), "the head's mark is a gathering");
  await t.say('kev', '9');
  await t.say('kev', 'build a well');
  await t.tick(30_000);
  assert.equal(t.started.length, 0);
  assert.equal(gatherTally(t.h.state).rate?.avg, 9);
  assert.equal(t.run('story-stop'), undefined);
  await t.tick(1000);
  assert.ok(t.h.logs.includes('story: gather mode over (the gathering): 2 lines, none to an agent; RATE IT 9.0 from 1; 1 queued for its agent after the release'), t.h.logs.join('\n'));
  assert.deepEqual(t.started.map((x) => x.said), [['build a well']]);
});

test('a scene begun inside a gathering: the gathering before it still gets its log line', async () => {
  const t = gatherTown();
  await t.met('kev');
  t.run('story-gather');
  await t.say('kev', '9');
  // No tick between: the scene starts with the head still on his mark, and Kev votes again at once.
  t.run('story-play', 'test');
  await t.say('kev', '3');
  assert.equal(gatherTally(t.h.state).rate?.avg, 3, "the scene's own tally");
  await t.tick(500);
  assert.ok(t.h.logs.includes('story: gather mode over (the gathering): 1 line, none to an agent; RATE IT 9.0 from 1'), t.h.logs.join('\n'));
  t.run('story-stop');
  await t.tick(500);
  assert.ok(t.h.logs.includes('story: gather mode over (the test scene): 1 line, none to an agent; RATE IT 3.0 from 1'), t.h.logs.join('\n'));
});

test("a /play player's line in gather mode: a bubble and a vote; nobody overhears it, nobody named is nudged, the feed stays quiet", async () => {
  const t = gatherTown();
  const { world, ctx } = t;
  await t.met('kim', 'sam');
  const kim = t.dude('kim');
  t.dude('sam').position = { ...kim.position };
  assert.equal(typeof world.players!.join(ctx, kim.id, 'kim'), 'object');
  t.run('story-play', 'test');
  world.players!.input(ctx, kim.id, { t: 'say', text: '8' });
  t.h.now += 5000;
  world.players!.input(ctx, kim.id, { t: 'say', text: 'sam build a tower' });
  assert.equal(kim.say?.text, 'sam build a tower');
  assert.equal(gatherTally(t.h.state).rate?.avg, 8);
  assert.ok(!t.dude('sam').overheard.length && !t.dude('sam').nudges?.length, 'Sam neither overhears nor is told');
  assert.ok(!t.h.state.feed.some((f) => /sam build a tower/.test(f.text)), 'not on the feed');
  assert.equal(kim.queuedLine, undefined, 'a player builds with the build button: nothing queued');
  await t.tick(12_000);
  assert.equal(t.started.length, 0);
  world.players!.leave(ctx, kim.id);
  pilots.clear();
});

test('Story OFF: no gather mode, even with a story scene left in the state; lines go to the agent as today', async () => {
  const t = gatherTown();
  const s = t.h.state;
  await t.met('kev');
  t.run('story-play', 'test');
  s.ai.story = false;
  assert.equal(gathering(s), false);
  await t.say('kev', '7');
  await t.tick(500);
  assert.deepEqual(t.started.map((x) => x.said), [['7']], 'a 7 is a line for the agent');
  assert.equal(gatherTally(s).lines, 0);
});

test('a queued line is saved with its chatter, and a save cut off mid-scene replays it after the boot', async () => {
  const t = gatherTown();
  await t.met('kev');
  t.run('story-play', 'test');
  await t.say('kev', 'build me a hut');
  const saved = JSON.parse(JSON.stringify(t.h.state));
  const parsed = stateSchema.safeParse(saved);
  assert.ok(parsed.success, 'the schema takes it');
  assert.deepEqual(parsed.data.dudes[0].queuedLine, { text: 'build me a hut', at: t.h.now });
  assert.ok(!stateSchema.safeParse({ ...saved, dudes: [{ ...saved.dudes[0], queuedLine: { text: 'x'.repeat(301), at: 0 } }] }).success, 'never longer than a chat line');
  assert.ok(stateSchema.safeParse({ ...saved, dudes: [{ ...saved.dudes[0], queuedLine: { text: ARRIVED_LINE, at: 0, world: true } }] }).success, "a newcomer's arrival saves too");

  // A restart: the boot lets everyone go (FK-017), so the line goes on at once.
  const b = gatherTown();
  b.h.state = parsed.data;
  b.world.start!(b.ctx);
  assert.equal(cityOf(b.h.state).story?.scene, undefined, 'the scene ended at the boot');
  await b.tick(1000);
  assert.deepEqual(b.started.map((x) => x.said), [['build me a hut']]);
});
