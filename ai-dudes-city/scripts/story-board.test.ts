// The Board's data (FK-011): with Story on, `town.board` carries the head's Folly in gold (this age's
// word, its timer's %), Wren's ask in red (the caravan's ask under way: "BRIDGE · soon" until the opening
// has played, then "BRIDGE have/need", one shift per chatter; later asks switch the word), the tally
// of awake chatters on each side, and the ticker (the premise, what to type, the newest joiners and the
// latest turncoat; the page adds the !play line while the doors are open). Story OFF sends no board.
// Nothing here is saved.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { harness } from './harness';
import { ageOf, cityOf } from '../src/worlds/ai-dudes/city';
import { skipVisit } from '../src/worlds/ai-dudes/caravan';
import { AWAKE_MS } from '../src/worlds/ai-dudes/sim';
import { BOARD, boardTicker, PICK_A_SIDE, sideLines } from '../src/worlds/ai-dudes/story/board';
import { boardFor, demoBoard } from '../client/dudes/board';
import { FOLLY, raiseFolly } from '../src/worlds/ai-dudes/story/folly';
import { stateSchema, type SideLogEntry } from '../src/worlds/ai-dudes/state';
import { SCENES } from '../src/shared/scenes';
import type { DudesScene } from '../src/shared/dudesTypes';

const EIGHT = ['test-kev', 'test-dana', 'test-bo', 'test-nia', 'test-ash', 'test-lee', 'test-max', 'test-sol'];

/** A town with the caravan in (Stone's band stuck across the river), `names` said hello, Story on or off. */
async function town(names = EIGHT, story = true) {
  const hs = harness({ town: true });
  hs.h.state.ai.story = story;
  for (const n of names) await hs.say(n, 'hello');
  await hs.tick(2000);
  const view = () => (hs.world.buildScene(hs.h.state, { now: hs.h.now } as never) as unknown as DudesScene).town!;
  const board = () => view().board!;
  const run = (id: string, value?: string) => hs.world.adminActions!.find((a) => a.id === id)!.run({ state: hs.h.state, now: hs.h.now, log: () => {} } as never, value as never);
  const dude = (name: string) => hs.h.state.dudes.find((d) => d.name === name)!;
  return { ...hs, view, board, run, dude };
}

test('Story OFF: no board in the view; Story ON brings it, OFF takes it away again', async () => {
  const { h, view } = await town(['test-kev'], false);
  assert.equal(view().board, undefined, "today's page");
  assert.equal(view().story, undefined);
  h.state.ai.story = true;
  assert.ok(view().board, 'the Board with Story on');
  h.state.ai.story = false;
  assert.equal(view().board, undefined, 'and gone with it off');
});

test('before the opening: BRIDGE · soon, BIG HUT 0%, nobody on a side, the premise on the ticker', async () => {
  const { h, board } = await town();
  assert.ok(cityOf(h.state).caravan?.stranded, 'the band is stuck across the river');
  const b = board();
  assert.deepEqual(b.red, { word: 'BRIDGE' }, 'no count yet: the page reads "BRIDGE · soon"');
  assert.deepEqual(b.gold, { word: 'BIG HUT', pct: 0 }, 'no cordon yet');
  assert.deepEqual(b.tally, { red: 0, gold: 0 });
  assert.equal(b.ticker[0], "The Chief took Wren's home", 'the premise first');
  assert.equal(b.ticker[1], 'Type red or gold to pick a side', "what to type, as ?demo=board says it");
  assert.equal(b.now, undefined);
  assert.ok(stateSchema.safeParse(JSON.parse(JSON.stringify(h.state))).success, 'nothing new in the save');
});

test('after the opening with 8 awake: BRIDGE 0/4; three different names take a shift each: 3/4; a second shift by one of them is turned away', async () => {
  const { h, tick, say, board, run, dude } = await town();
  run('scene-opening');
  assert.deepEqual(board().red, { word: 'BRIDGE' }, 'still soon while the opening plays');
  await tick(SCENES.opening.ms + 1000);
  assert.equal(cityOf(h.state).scene, undefined, 'the opening is over');
  assert.deepEqual(board().red, { word: 'BRIDGE', have: 0, need: 4 }, '⌈0.4 × 8⌉ = 4');
  for (const n of ['test-kev', 'test-dana', 'test-bo']) await say(n, 'fix the bridge');
  const helpers = () => cityOf(h.state).caravan?.helpers ?? [];
  for (let i = 0; i < 40 && helpers().length < 3; i++) await tick(2000);
  assert.deepEqual(new Set(helpers()), new Set(['test-kev', 'test-dana', 'test-bo'].map((n) => dude(n).id)), 'one shift each');
  assert.deepEqual(board().red, { word: 'BRIDGE', have: 3, need: 4 });
  await say('test-kev', 'fix the bridge again');
  await tick(20_000);
  assert.notEqual(dude('test-kev').labour?.site, 'bridge', 'kev has done his shift');
  assert.deepEqual(board().red, { word: 'BRIDGE', have: 3, need: 4 }, 'still 3/4: one shift per chatter');
  assert.deepEqual(board().gold, { word: 'BIG HUT', pct: 0 });
  assert.deepEqual(board().tally, { red: 0, gold: 0 });
});

test('after the crossing the red bar reads the ask under way, and NEXT JOB · soon between asks', async () => {
  const { h, tick, board } = await town(['test-kev', 'test-dana']);
  skipVisit(h.state, h.now); // the bridge: mended, the crossing plays
  assert.ok(!cityOf(h.state).caravan!.stranded);
  assert.deepEqual(board().red, { word: 'NEXT JOB' }, 'nothing asked while they cross');
  await tick(SCENES.crossing.ms + 6000);
  const asks = cityOf(h.state).caravan!.asks;
  assert.deepEqual(asks.map((a) => a.id), ['food', 'fed'], "today's first visit (FK-129 swaps in the story's)");
  assert.deepEqual(board().red, { word: 'FOOD', have: 0, need: asks[0].need });
  asks[0].have = asks[0].need;
  assert.deepEqual(board().red, { word: 'FEED THEM', have: 0, need: asks[1].need }, 'met: on to the next ask');
  for (let i = 0; i < 4; i++) skipVisit(h.state, h.now); // visit 1 met, visit 2 open, met, the Wonder visit open
  assert.equal(cityOf(h.state).caravan!.asks[0]?.kind, 'project');
  assert.deepEqual(board().red, { word: 'FURNACE', have: 0, need: 1 }, 'the Wonder by name (FK-130 merges the bars)');
});

test("the gold bar is this age's Folly: its word and its timer's whole percent", async () => {
  const { h, board, run, tick } = await town(['test-kev']);
  const city = cityOf(h.state);
  city.story = { folly: { age: 0, pct: 37.8, startedAt: h.now, plaque: [] } };
  assert.deepEqual(board().gold, { word: 'BIG HUT', pct: 37 }, '100 only when it is done');
  city.story.folly!.pct = 99.9;
  assert.equal(board().gold.pct, 99);
  city.story.folly!.pct = 100;
  assert.equal(board().gold.pct, 100);
  run('set-age', 'bronze');
  await tick(2000);
  assert.equal(ageOf(h.state), 1);
  assert.deepEqual(board().gold, { word: 'GOLDEN ME', pct: 0 }, "Stone's Folly doesn't fill Bronze's");
  assert.equal(board().ticker[0], "The High Priest took Wren's home", 'the head by his title in the age');
  assert.notEqual(board().red.word, 'BRIDGE', 'no bridge in Bronze: the band walks in and asks');
});

test("the gold bar follows the Folly's own timer once the cordon is up, as town.folly does", async () => {
  const { h, board, view, tick } = await town(['test-kev']);
  assert.equal(raiseFolly(h.state, h.now), undefined, 'the cordon goes up');
  assert.deepEqual(board().gold, { word: 'BIG HUT', pct: 0 });
  await tick(FOLLY.fillMs / 4 + 6000); // 25.25%
  assert.equal(board().gold.pct, 25, 'a quarter of the way after a quarter of its time');
  assert.equal(board().gold.pct, view().folly?.pct, 'the bar and the Folly agree');
});

test("the tally counts awake chatters on each side this age; neutrals, sleepers and last age's sides count for nobody", async () => {
  const { h, board, dude, run, tick } = await town(['test-kev', 'test-dana', 'test-bo', 'test-nia', 'test-sol', 'test-lee']);
  dude('test-kev').side = 'red';
  dude('test-dana').side = 'red';
  dude('test-bo').side = 'gold';
  dude('test-nia').side = 'gold';
  dude('test-nia').lastHeardAt = h.now - AWAKE_MS - 1; // asleep
  assert.deepEqual(board().tally, { red: 2, gold: 1 }, 'test-sol and test-lee are on no side');
  for (const n of ['test-kev', 'test-dana', 'test-bo']) dude(n).sideAge = 0;
  run('set-age', 'bronze');
  await tick(2000);
  for (const n of ['test-kev', 'test-dana', 'test-bo', 'test-sol', 'test-lee']) dude(n).lastHeardAt = h.now;
  dude('test-dana').sideAge = 1; // dana picked red again in Bronze
  dude('test-lee').side = 'gold';
  dude('test-lee').sideAge = 1;
  assert.deepEqual(board().tally, { red: 1, gold: 1 }, "Stone's sides don't count in Bronze (as on the plaque)");
});

test('the ticker: newest joiners first, the latest turncoat kept, a person once, old lines gone, names as chat reads them', () => {
  const now = 10_000_000;
  const e = (ago: number, id: string, side: 'red' | 'gold', from?: 'red' | 'gold', name = id): SideLogEntry => ({ at: now - ago, id, name, side, ...(from ? { from } : {}) });
  assert.deepEqual(sideLines([], now), []);
  assert.deepEqual(sideLines([e(9000, 'kev', 'red'), e(5000, 'nia', 'gold')], now), ['Nia joined gold', 'Kev joined red'], 'newest first');
  // Kev crossed, then three more joined: the turncoat still makes it, in the last slot.
  const log = [e(60_000, 'kev', 'red'), e(50_000, 'kev', 'gold', 'red'), e(40_000, 'dana', 'red'), e(30_000, 'bo', 'gold'), e(20_000, 'sol', 'red')];
  assert.deepEqual(sideLines(log, now), ['Sol joined red', 'Bo joined gold', 'Kev crossed to gold'], "Kev's crossing, not his join");
  assert.equal(sideLines(log, now).length, BOARD.sideLines);
  assert.deepEqual(sideLines([e(BOARD.sideMs + 1, 'kev', 'red'), e(1000, 'nia', 'gold')], now), ['Nia joined gold'], 'a join from long ago has had its turns');
  assert.deepEqual(sideLines([e(1000, 'a', 'red', undefined, '@TheRealKev'), e(500, 'b', 'gold', undefined, 'a_name_far_too_long_for_it')], now), ['A_name_far_too_long… joined gold', 'TheRealKev joined red']);
});

test("the !play line is the page's, only while the /play doors are open; the ticker keeps its words steady", async () => {
  const { h, board, view } = await town(['test-kev']);
  assert.ok(!board().ticker.some((l) => l.startsWith('Walk your character')), 'the server never sends it, open or closed');
  assert.equal(PICK_A_SIDE, demoBoard([]).ticker[1], 'one wording on the demo board and the real one');
  // The page: the snapshot's `play` comes only while the doors are open (src/index.ts playInfo).
  const open = boardFor(view(), [], '?stream=1', { url: 'https://play.example.com/' })!;
  assert.deepEqual(open.ticker, [...board().ticker, 'Walk your character: play.example.com'], 'doors open: the line last, without its scheme');
  assert.equal(open.gold.word, board().gold.word);
  assert.deepEqual(boardFor(view(), [], '?stream=1')!.ticker, board().ticker, 'doors closed: no line');
  assert.equal(boardTicker(h.state, h.now).length, board().ticker.length);
  const first = board().ticker;
  h.now += 30_000;
  assert.deepEqual(board().ticker, first, 'the same lines a moment later: the page decides what is new');
  cityOf(h.state).story = { sideLog: [{ at: h.now, id: 'test-kev', name: 'test-kev', side: 'red' }] };
  assert.deepEqual(board().ticker, ["The Chief took Wren's home", 'Type red or gold to pick a side', 'Test-kev joined red']);
});
