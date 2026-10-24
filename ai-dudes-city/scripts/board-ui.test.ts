// The Board on the stream (client/dudes/board.ts, FK-010): what the two bars, the tug line and the
// ticker say; `?demo=board`'s fake board, whose tally matches the fake sides on the dudes; the ticker's
// 20 s rotation with fresh lines cutting in; autoFrame keeping everyone under the strip; the strip's
// sizes in the sheet; and Story OFF, where there is no #board and the caravan panel is back.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  DEMO_BOARD,
  KNOT_END,
  TICKER_FRESH_MS,
  TICKER_MS,
  TickerClock,
  boardFor,
  checkBoard,
  demoBoard,
  fitBar,
  fitUnder,
  goldCount,
  goldFill,
  goldText,
  knotAt,
  liftUnder,
  redCount,
  redFill,
  redText,
  reserved,
  shortUrl,
} from '../client/dudes/board';
import { sideOf } from '../client/dudes/sideMarks';
import type { BoardView, DudeView, TownView } from '../src/shared/dudesTypes';

const board = (extra: Partial<BoardView> = {}): BoardView => ({
  gold: { word: 'BIG HUT', pct: 35 },
  red: { word: 'BRIDGE', have: 3, need: 8 },
  tally: { red: 4, gold: 7 },
  ticker: ['The Chief took Wren’s home'],
  ...extra,
});
const dude = (id: string, extra: Partial<DudeView> = {}): DudeView =>
  ({ id, name: id, position: { x: 0, z: 0 }, facing: 0, activity: 'idle', look: {}, ...extra }) as DudeView;
const town = (extra: Partial<TownView> = {}): TownView =>
  ({ name: 'Town', age: 0, head: 'The Chief', lots: [], districts: [], wants: [], hot: [], ...extra }) as TownView;

test('the bars: "BIG HUT 35%" on gold, "BRIDGE 3/8" on red, "BRIDGE · soon" before the ask has a count', () => {
  const b = board();
  assert.equal(goldText(b), 'BIG HUT 35%');
  assert.equal(goldFill(b), 0.35);
  assert.equal(redText(b), 'BRIDGE 3/8');
  assert.equal(redFill(b), 3 / 8);
  // Before the opening the bridge ask doesn't exist yet (FK-011): no count, no fill.
  const soon = board({ red: { word: 'BRIDGE' } });
  assert.equal(redText(soon), 'BRIDGE · soon');
  assert.equal(redFill(soon), 0);
  assert.equal(redText(board({ red: { word: 'BRIDGE', have: 0, need: 0 } })), 'BRIDGE · soon', 'a need of 0 is no count');
  assert.equal(redText(board({ red: { word: 'BRIDGE', have: 0, need: 4 } })), 'BRIDGE 0/4');
  // Out of range: an over-full ask reads full, the Folly's % stays 0..100 and whole.
  assert.equal(redText(board({ red: { word: 'MAKE ROOM', have: 7, need: 5 } })), 'MAKE ROOM 5/5');
  assert.equal(redFill(board({ red: { word: 'MAKE ROOM', have: 7, need: 5 } })), 1);
  assert.equal(goldText(board({ gold: { word: 'BIG HUT', pct: 112 } })), 'BIG HUT 100%');
  assert.equal(goldText(board({ gold: { word: 'BIG HUT', pct: -3 } })), 'BIG HUT 0%');
  assert.equal(goldText(board({ gold: { word: 'BIG HUT', pct: 41.6 } })), 'BIG HUT 42%');
  assert.equal(goldText(board({ gold: { word: 'BIG HUT', pct: Number.NaN } })), 'BIG HUT 0%');
});

test('a long bar word is cut, never its number: "HEALER\'S… 2/4", not "HEALER\'S HUT…"', () => {
  // A stand-in for the bar's width test: so many characters fit.
  const room = (n: number) => (t: string) => [...t].length <= n;
  assert.equal(fitBar('BIG HUT', '35%', room(16)), 'BIG HUT 35%', 'fits: as it is');
  // The story bible's later jobs that measured too long at 54 px (Fredoka 700, 1920×1080).
  assert.equal(fitBar("HEALER'S HUT", '2/4', room(14)), "HEALER'S… 2/4");
  assert.equal(fitBar('ROYAL MOAT', '100%', room(14)), 'ROYAL… 100%');
  assert.equal(fitBar('GOLF COURSE', '100%', room(14)), 'GOLF… 100%');
  assert.equal(fitBar("ASH'S CAIRN", '12/20', room(14)), "ASH'S… 12/20");
  assert.equal(fitBar('SCRAP ROCKET', '3/8', room(14)), 'SCRAP… 3/8');
  assert.equal(fitBar('BIG OLD HUT', '35%', room(13)), 'BIG OLD… 35%', 'as many whole words as fit');
  assert.equal(fitBar('BRIDGE', '· soon', room(8)), 'BRIDGE · soon', 'one word too long stays whole (CSS clips it), never an empty bar');
  // The numbers are the bar texts' tails.
  const b = board();
  assert.equal(goldText(b), `${b.gold.word} ${goldCount(b)}`);
  assert.equal(redText(b), `${b.red.word} ${redCount(b)}`);
  assert.equal(redCount(board({ red: { word: 'BRIDGE' } })), '· soon');
});

test('a malformed board from the server blanks the strip at worst, never throws in apply()', () => {
  const b = board({ now: 'NOW: fix the bridge' });
  assert.deepEqual(checkBoard(b), b, 'a whole board as it is');
  assert.equal(checkBoard(undefined), undefined);
  // Missing parts: nobody on a side, no ticker line.
  const bare = checkBoard({ gold: { word: 'BIG HUT', pct: 35 }, red: { word: 'BRIDGE' } } as BoardView);
  assert.ok(bare);
  assert.deepEqual(bare.tally, { red: 0, gold: 0 });
  assert.deepEqual(bare.ticker, []);
  assert.equal(knotAt(bare.tally), 0.5);
  assert.equal(goldText(bare), 'BIG HUT 35%');
  assert.equal(redText(bare), 'BRIDGE · soon');
  assert.deepEqual(checkBoard({ ...b, tally: { gold: 3 } } as unknown as BoardView)?.tally, { red: 0, gold: 3 });
  // No bars: no board.
  assert.equal(checkBoard({ red: { word: 'BRIDGE' }, tally: { red: 1, gold: 1 }, ticker: [] } as unknown as BoardView), undefined);
  assert.equal(checkBoard({ gold: { word: 'BIG HUT', pct: 35 } } as unknown as BoardView), undefined);
  // Odd ticker entries and a non-string NOW are dropped; a missing word reads as none.
  const odd = checkBoard({ ...b, ticker: ['a', 7, '', null, 'b'], now: 3 } as unknown as BoardView);
  assert.deepEqual(odd?.ticker, ['a', 'b']);
  assert.equal(odd?.now, undefined);
  assert.equal(checkBoard({ ...b, gold: { pct: 10 } } as unknown as BoardView)?.gold.word, '');
  assert.equal(new TickerClock().pick(bare.ticker, 0, bare.now), undefined, 'no line, no throw');
});

test('the tug line: the rope is gold up to the knot, which sits at gold’s share of everyone on a side', () => {
  const at = (gold: number, red: number) => knotAt({ gold, red });
  assert.equal(at(0, 0), 0.5, 'nobody on a side: the middle');
  assert.equal(at(5, 5), 0.5);
  // 7 gold against 4 red: more gold rope (the bible's GOLD 7 ═════╪═══ RED 4).
  assert.ok(Math.abs(at(7, 4) - (KNOT_END + (7 / 11) * (1 - 2 * KNOT_END))) < 1e-12);
  assert.ok(at(7, 4) > 0.5 && at(4, 7) < 0.5);
  assert.ok(Math.abs(at(7, 4) - 0.5 - (0.5 - at(4, 7))) < 1e-12, 'mirror images');
  // All on one side: the knot stays on the rope, short of the end.
  assert.equal(at(9, 0), 1 - KNOT_END);
  assert.equal(at(0, 9), KNOT_END);
  assert.equal(at(-2, Number.NaN), 0.5, 'nonsense counts as nobody');
  // One more on a side moves it towards the other side's end (unless the other side has nobody: it is there already).
  for (let g = 0; g < 8; g++)
    for (let r = 0; r < 8; r++) {
      if (r) assert.ok(at(g + 1, r) > at(g, r), `${g + 1}–${r} past ${g}–${r}`);
      if (g) assert.ok(at(g, r + 1) < at(g, r), `${g}–${r + 1} short of ${g}–${r}`);
    }
});

test('?demo=board: BIG HUT 35% and BRIDGE 3/8, the tally from the same fake sides the dudes wear', () => {
  const dudes = Array.from({ length: 40 }, (_, i) => dude(`chatter-${i}`, { name: `test-${i}`, away: i % 7 === 3 }));
  dudes.push(
    dude('wren', { name: 'Wren', npc: true }),
    dude('tom', { name: 'Old Tom', resident: true }),
    dude('band', { name: 'Moss', traveller: true }),
    dude('head', { name: 'Sami', mayor: true }),
    dude('real', { name: 'kev', side: 'red' }),
  );
  const b = demoBoard(dudes, 'The Chief');
  assert.equal(goldText(b), 'BIG HUT 35%');
  assert.equal(redText(b), 'BRIDGE 3/8');
  // Exactly the awake chatters whose marks show a side (client/dudes/sideMarks.ts, FK-013): a real side counts as itself.
  const want = { red: 0, gold: 0 };
  for (const d of dudes) {
    if (d.away || d.npc || d.resident || d.traveller || d.mayor) continue;
    const s = sideOf(d, true);
    if (s) want[s]++;
  }
  assert.deepEqual(b.tally, want);
  assert.ok(want.red > 3 && want.gold > 3, `both sides have people (${JSON.stringify(want)})`);
  // The ticker: the premise, what to type, one joiner a side (capitalised), and no !play line without a URL.
  assert.equal(b.ticker[0], 'The Chief took Wren\'s home');
  assert.equal(b.ticker[1], 'Type red or gold to pick a side');
  const joins = b.ticker.slice(2);
  assert.equal(joins.length, 2);
  assert.match(joins[0], /^[A-Z][\w-]* joined red$/);
  assert.match(joins[1], /^Test-\d+ joined gold$/);
  assert.ok(!b.ticker.some((l) => /Walk your character/.test(l)));
  // The !play line moves from the retired invite panel to the ticker.
  const played = demoBoard(dudes, 'The King', { url: 'https://abc.example.com/play/' });
  assert.equal(played.ticker[0], "The King took Wren's home");
  assert.equal(played.ticker.at(-1), 'Walk your character: abc.example.com/play');
  assert.equal(shortUrl('http://localhost:4613/play'), 'localhost:4613/play');
  // Nobody about: still both jobs, an even tally, and the premise.
  const empty = demoBoard([]);
  assert.deepEqual(empty.tally, { red: 0, gold: 0 });
  assert.equal(empty.ticker[0], "The Chief took Wren's home");
  // The demo's data is a copy: drawing it can never change the next one.
  empty.gold.pct = 99;
  assert.equal(DEMO_BOARD.gold.pct, 35);
});

test('boardFor: the server’s board while Story is ON, the demo’s on ?demo=board, else none (Story OFF)', () => {
  const dudes = [dude('a', { side: 'gold' })];
  const real = board({ gold: { word: 'BIG HUT', pct: 80 } });
  assert.equal(boardFor(town({ story: true, board: real }), dudes, '?stream=1'), real);
  assert.equal(boardFor(town({ story: true, board: real }), dudes, '?stream=1&demo=board'), real, 'a real board always wins');
  assert.equal(boardFor(town(), dudes, '?stream=1'), undefined, 'Story OFF');
  assert.equal(boardFor(town({ story: true }), dudes, '?stream=1'), undefined, 'Story ON before the server sends one');
  assert.equal(boardFor(undefined, dudes, ''), undefined);
  assert.equal(boardFor(town(), dudes, '?stream=1&demo=show'), undefined, 'another demo');
  const demo = boardFor(town({ head: 'The Overseer' }), dudes, '?stream=1&demo=board', { url: 'http://x.test/play' });
  assert.ok(demo);
  assert.equal(redText(demo), 'BRIDGE 3/8');
  assert.deepEqual(demo.tally, { red: 0, gold: 1 });
  assert.equal(demo.ticker[0], "The Overseer took Wren's home");
  assert.equal(demo.ticker.at(-1), 'Walk your character: x.test/play');
});

test('the ticker: one line at a time, the next every 20 s, round and round', () => {
  const t = new TickerClock();
  const lines = ['premise', 'type red or gold', 'play'];
  assert.equal(t.pick(lines, 0), 'premise');
  assert.equal(t.pick(lines, TICKER_MS - 1), 'premise');
  assert.equal(t.pick(lines, TICKER_MS), 'type red or gold');
  assert.equal(t.pick(lines, 2 * TICKER_MS - 1), 'type red or gold');
  assert.equal(t.pick(lines, 2 * TICKER_MS), 'play');
  assert.equal(t.pick(lines, 3 * TICKER_MS), 'premise', 'round again');
  // A list of one just stays; an empty list shows nothing; a line that's gone hands over to the top.
  const one = new TickerClock();
  for (const at of [0, TICKER_MS, 5 * TICKER_MS]) assert.equal(one.pick(['only'], at), 'only');
  assert.equal(one.pick([], 6 * TICKER_MS), undefined);
  assert.equal(one.pick(['a', 'b'], 6 * TICKER_MS + 1), 'a');
  const gone = new TickerClock();
  gone.pick(['a', 'b'], 0);
  gone.pick(['a', 'b'], TICKER_MS); // b
  assert.equal(gone.pick(['a', 'c'], TICKER_MS + 10), 'c', 'b went: c is news and the slot is free');
});

test('the ticker: a fresh line (a joiner) cuts in within 5 s; lines there from the start are not news', () => {
  const t = new TickerClock();
  const lines = ['premise', 'Dana joined gold'];
  assert.equal(t.pick(lines, 0), 'premise', 'the first look: nothing is news');
  assert.equal(t.pick(lines, 1000), 'premise');
  // Kev joins red 2 s in: up once the premise has had 5 s, not 20.
  const more = [...lines, 'Kev joined red'];
  assert.equal(t.pick(more, 2000), 'premise');
  assert.equal(t.pick(more, TICKER_FRESH_MS - 1), 'premise');
  assert.equal(t.pick(more, TICKER_FRESH_MS), 'Kev joined red');
  // Two more at once: each gets its 5 s, newest order kept, then the rotation carries on at 20 s.
  const burst = [...more, 'Bo joined gold', 'Nia crossed to red'];
  assert.equal(t.pick(burst, TICKER_FRESH_MS + 100), 'Kev joined red');
  assert.equal(t.pick(burst, 2 * TICKER_FRESH_MS), 'Bo joined gold');
  assert.equal(t.pick(burst, 3 * TICKER_FRESH_MS), 'Nia crossed to red');
  assert.equal(t.pick(burst, 3 * TICKER_FRESH_MS + TICKER_MS - 1), 'Nia crossed to red', 'no news left: 20 s again');
  assert.equal(t.pick(burst, 3 * TICKER_FRESH_MS + TICKER_MS), 'premise', 'and on round the list');
  // A fresh line that leaves the list before its turn never shows.
  const u = new TickerClock();
  u.pick(['a'], 0);
  u.pick(['a', 'brief'], 1000);
  assert.equal(u.pick(['a'], TICKER_FRESH_MS + 1000), 'a');
});

test('the ticker: the board’s NOW line holds the slot while it is set, then the rotation comes back', () => {
  const t = new TickerClock();
  const lines = ['premise', 'joined'];
  assert.equal(t.pick(lines, 0), 'premise');
  assert.equal(t.pick(lines, 1000, 'NOW: fix the bridge'), 'NOW: fix the bridge');
  assert.equal(t.pick(lines, 1000 + 3 * TICKER_MS, 'NOW: fix the bridge'), 'NOW: fix the bridge', 'held, however long');
  assert.equal(t.pick(lines, 2000 + 3 * TICKER_MS), 'premise', 'back to the top');
});

test('autoFrame under the Board: everyone fits in the view below the strip, centred in it', () => {
  // A 1080 px frame with the strip's bottom (plus margin) at 282 px.
  const top = 282 / 1080;
  for (const need of [6, 10, 23.5]) {
    const half = fitUnder(top, need);
    const lift = liftUnder(top, half);
    // Subjects span s ± need; the view spans c ± half with c = s + lift; the strip covers its top `top` share.
    const s = 3;
    const c = s + lift;
    const stripBottom = c + half - 2 * half * top;
    assert.ok(Math.abs(stripBottom - (s + need)) < 1e-9, 'the highest subject ends exactly at the strip');
    assert.ok(Math.abs(c - half - (s - need)) < 1e-9, 'and the lowest at the bottom of the frame');
  }
  // No Board: today's framing exactly.
  assert.equal(fitUnder(0, 10), 10);
  assert.equal(liftUnder(0, 10), 0);
  // A strip taller than half the frame (a squat window) counts as a half; nonsense as none.
  assert.equal(fitUnder(0.9, 10), 20);
  assert.equal(liftUnder(0.9, 20), 10);
  assert.equal(fitUnder(Number.NaN, 10), 10);
  // 1920×1080 with the strip at about a quarter of the height: a third more room, the centre up a quarter.
  assert.ok(Math.abs(fitUnder(0.25, 12) - 16) < 1e-12 && liftUnder(0.25, 16) === 4);
});

test('the tags keep out of the banner and the Board, as one rect', () => {
  const banner = { l: 700, t: 0, r: 1220, b: 420 },
    strip = { l: 340, t: 14, r: 1580, b: 282 };
  assert.deepEqual(reserved(banner, strip), { l: 340, t: 0, r: 1580, b: 420 });
  assert.equal(reserved(undefined, strip), strip);
  assert.equal(reserved(banner, undefined), banner);
  assert.equal(reserved(), undefined);
});

// --- the sheet and the page --------------------------------------------------------------------------

const HTML = readFileSync('client/dudes/index.html', 'utf8');
const CSS = HTML.slice(HTML.indexOf('<style>') + 7, HTML.indexOf('</style>')).replace(/\/\*[\s\S]*?\*\//g, '');
const RULES = [...CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, sel, body]) => ({
  sel: sel.trim(),
  decls: Object.fromEntries(
    body
      .split(';')
      .filter((d) => d.includes(':'))
      .map((d) => [d.slice(0, d.indexOf(':')).trim(), d.slice(d.indexOf(':') + 1).trim()]),
  ) as Record<string, string>,
}));
const decl = (sel: string, prop: string) => RULES.find((r) => r.sel === sel)?.decls[prop];
const MAIN = readFileSync('client/dudes/main.ts', 'utf8');

test('the strip’s sizes (design px at 1920×1080): 1240 wide, 96 px bars, words and tallies 64, chips and ticker 54', () => {
  assert.equal(decl('#board', 'width'), 'calc(1240 * var(--px))');
  assert.equal(decl('#board', 'position'), 'fixed');
  assert.equal(decl('#board', 'margin'), '0 auto', 'top centre');
  assert.equal(decl('#board', 'pointer-events'), 'none', 'never in the way of the view');
  assert.equal(decl('#board .bar', 'height'), 'calc(96 * var(--px))');
  assert.equal(decl('#board .bar', 'border-radius'), '999px', 'pill bars');
  assert.equal(decl('#board .bar', 'border'), 'var(--outline)');
  assert.equal(decl('#board .bar', 'box-shadow'), 'var(--drop)');
  assert.equal(decl('#board .word', 'font'), '700 calc(64 * var(--px))/1 var(--font-display)', 'the bar word: Fredoka 700, 64');
  assert.equal(decl('#board .n', 'font'), '700 calc(64 * var(--px))/.95 var(--font-display)', 'the tallies: 64');
  // Chips and the ticker are kit pills: Nunito 800 at 54 (sticker-ui.test.ts pins the pill itself).
  assert.match(decl('.pill,.card', 'font') ?? '', /^800 calc\(54 \* var\(--px\)\)/);
  assert.equal(decl('#board .pill', 'line-height'), '1.05');
  // Red takes cream text, gold takes ink, on the fills as on the chips.
  assert.equal(decl('#board .gold .fill', 'color'), 'var(--ink)');
  assert.equal(decl('#board .face', 'color'), 'var(--cream)');
  assert.equal(decl('#board .red .fill', 'color'), undefined, 'cream from the face');
  // The rope's colours meet at the knot, which slides (registered, so it eases) and never sits at rest animating.
  assert.match(decl('#board .rope', 'background') ?? '', /linear-gradient\(90deg,var\(--gold\) var\(--knot\),var\(--red\) 0\)/);
  assert.equal(decl('#board .knot', 'left'), 'var(--knot)');
  assert.equal(decl('@property --knot', 'syntax'), "'<percentage>'");
  assert.ok(!RULES.some((r) => /#board/.test(r.sel) && /infinite/.test(r.decls.animation ?? '')), 'nothing animates at rest');
  assert.equal(decl('#board .ticker[hidden]', 'display'), 'none', 'a pill’s flex never shows an empty ticker');
  // The crossfade dips: the outgoing line fades in 0.3 s, the incoming one fades in after it, so two lines never overlap.
  assert.equal(decl('#board .ticker .out', 'opacity'), '0', 'the outgoing line fades');
  assert.equal(decl('#board .ticker .line', 'transition'), 'opacity .3s ease-in');
  assert.equal(decl('#board .ticker .in', 'animation'), 'ticker-in .3s ease-out .3s both');
  assert.ok(RULES.some((r) => r.sel === '#board .ticker .in' && r.decls.animation === 'none'), 'reduced motion: no fade');
});

test('scenes: the strip fades out with the rest of the HUD; reduced motion: no slides or fades', () => {
  assert.equal(decl('#board', 'transition'), 'opacity .6s');
  assert.equal(decl('body.cinema #board', 'opacity'), '0');
  assert.ok(RULES.some((r) => r.sel === '#board,#board *' && r.decls.transition === 'none'));
  // The troublemaker banner and the stream's knockout board drop under the strip while it shows.
  assert.equal(decl('body.board #happening-wrap', 'top'), 'calc(var(--board-b,0px) + 12px)');
  assert.equal(decl('body.stream.board #side', 'top'), 'calc((var(--board-b,0px) + 12px) / var(--ui-scale,1))', '#side is zoomed on the stream');
  // On narrow pages the banner never sits higher than today's (118 px, 100 px on a phone), clear of the header.
  const banner = RULES.filter((r) => r.sel === 'body.board #happening-wrap').map((r) => r.decls.top);
  assert.deepEqual(banner, ['calc(var(--board-b,0px) + 12px)', 'max(118px,calc(var(--board-b,0px) + 12px))', 'max(100px,calc(var(--board-b,0px) + 12px))']);
  assert.ok(CSS.includes('@media(max-width:650px){body.board #happening-wrap{top:max(100px,'), 'the phone clamp in the phone query');
  // In a scene the banner and the Board have faded, so the tags and bubbles have the top of the frame back.
  assert.match(MAIN, /reserve: document\.body\.classList\.contains\('cinema'\) \? undefined : reserved\(bannerRect, boardUi\?\.rect\(\)\)/);
});

test('a new strip shows the knot in its place: --knot is set before anything measures the strip', () => {
  const BOARD_TS = readFileSync('client/dudes/board.ts', 'utf8');
  const body = BOARD_TS.slice(BOARD_TS.indexOf('function update('), BOARD_TS.indexOf('function rect('));
  const knotSet = body.indexOf("rope.style.setProperty('--knot'");
  assert.ok(knotSet > 0);
  assert.ok(knotSet < body.indexOf('setBar('), 'before the words are fitted (that reads the layout)');
  assert.ok(knotSet < body.indexOf('setLine('), 'and before the ticker is sized');
  assert.ok(body.indexOf('checkBoard(') < body.indexOf('if (!board)'), 'the board is checked first');
});

test('Story OFF: no #board in the markup, and the caravan panel comes back when the board goes', () => {
  assert.ok(!/id="board"/.test(HTML), 'board.ts builds it only while there is a board');
  assert.ok(HTML.includes('<div id="caravan" hidden'), 'the caravan panel is still on the page');
  // Wiring: the viewer page only, the caravan's panel only while there is no board.
  assert.match(MAIN, /const boardUi = !operatorMode && !playerMode \? createBoard\(document, reduced\) : undefined;/);
  assert.match(MAIN, /const board = boardFor\(next\.town, next\.dudes, location\.search, msg\.play\);/);
  assert.match(MAIN, /renderCaravan\(board && boardUi \? undefined : next\.town\?\.caravan, next\.town\?\.age\);/);
  // The only renderCaravan call is that one.
  assert.equal([...MAIN.matchAll(/renderCaravan\(/g)].length, 2, 'the definition and the one call');
});
