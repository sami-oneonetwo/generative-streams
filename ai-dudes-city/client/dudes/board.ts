// The Board (FK-010, board/design-system.md §4): the one thing always on screen in free play while
// Story is ON, in a top-centre strip 1240 px wide (design px at 1920×1080).
//
//   [♛ BIG HUT 35%  ████░░░░]  [░░░░████  BRIDGE 3/8 ⚑]
//   [type gold] (7) ━━━━━━━●━━━━ (4) [type red]
//            ( The Chief took Wren's home )
//
// Gold on the left is the head's Folly: the crown first, the word inside a fill that grows from the
// left. Red on the right is Wren's job: the flag at the outer end, filling from the right. Under them
// the tug line: each side's word to type, the awake chatters on it, and a rope that is gold up to
// the knot and red after it, the knot sitting at gold's share of everyone on a side (more rope in
// your colour, more of you: the bible's `GOLD 7 ═════╪═══ RED 4`). Then the ticker, one line at a
// time, crossfading every 20 s; a fresh line (a joiner, a turncoat) cuts in within 5 s. The strip
// fades out for scenes, and nothing on it moves at rest but the ticker's crossfade.
//
// Only the viewer page draws it (the stream and the plain page): /mayor gets its own strip (FK-038)
// and /play keeps today's panels. The element is built the first time there is a board and removed
// when it goes, so Story OFF has no #board at all and the caravan panel comes back.
//
// `?demo=board` fills it with fake data, locally, with no server change: BIG HUT 35%, BRIDGE 3/8,
// the tally from the fake sides FK-013 draws on the dudes (so the numbers match the discs), and a
// few ticker lines. A real `town.board` from the server (FK-011) always wins. Wren's site sign
// (FK-125) reads the same board through boardFor().
import type { BoardView, DudeView, TownView } from '../../src/shared/dudesTypes';
import { fitWords } from './feed';
import { demoSidesOn, sideIcon, sideOf, type Side } from './sideMarks';

/** How long each ticker line stays up. */
export const TICKER_MS = 20_000;
/** A fresh ticker line (a joiner, a turncoat) cuts in once the line on show has had this long. */
export const TICKER_FRESH_MS = 5_000;
/** The knot never quite reaches an end of the rope, so it always reads as a knot. */
export const KNOT_END = 0.06;
/** The bar word's size and the smallest it shrinks to for a long word (design px; nothing to read is under 54). */
export const WORD_PX = 64;
export const WORD_MIN_PX = 54;

const clamp01 = (n: number) => (Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0);
const count = (n: number) => (Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0);

// --- what it says ---------------------------------------------------------------------------------

/** The gold bar: "BIG HUT 35%". */
export function goldText(b: BoardView): string {
  return `${b.gold.word} ${goldCount(b)}`;
}
/** The gold bar's number: "35%". */
export function goldCount(b: BoardView): string {
  return `${Math.round(goldFill(b) * 100)}%`;
}
/** How full the gold bar is (0..1). */
export function goldFill(b: BoardView): number {
  return clamp01(b.gold.pct / 100);
}
/** The red bar: "BRIDGE 3/8", or "BRIDGE · soon" while the ask has no count yet (before the opening). */
export function redText(b: BoardView): string {
  return `${b.red.word} ${redCount(b)}`;
}
/** The red bar's number: "3/8", or "· soon". */
export function redCount(b: BoardView): string {
  const { have, need } = b.red;
  if (!need || have === undefined) return '· soon';
  return `${Math.min(count(have), count(need))}/${count(need)}`;
}
/**
 * A bar's word and number as they fit (`fits` measures): the number always whole, only the word cut at
 * a word ("HEALER'S… 2/4"), because the number is what the bar is there to show.
 */
export function fitBar(word: string, num: string, fits: (t: string) => boolean): string {
  const join = (w: string) => `${w} ${num}`;
  return join(fitWords(word, (w) => fits(join(w))));
}
/** How full the red bar is (0..1); empty until the ask has a count. */
export function redFill(b: BoardView): number {
  return b.red.need ? clamp01((b.red.have ?? 0) / b.red.need) : 0;
}
/**
 * Where the knot sits on the rope, from the gold end (0) to the red end (1): gold's share of everyone
 * on a side, so the rope is gold up to the knot and red after it. The middle while nobody is on a side.
 */
export function knotAt(tally: BoardView['tally']): number {
  const gold = count(tally.gold),
    red = count(tally.red);
  const share = gold + red ? gold / (gold + red) : 0.5;
  return KNOT_END + share * (1 - 2 * KNOT_END);
}

/**
 * The board with its parts checked, since the server's data is new (FK-011): a missing tally counts
 * nobody, a missing ticker shows no line, and a board without its two bars is no board. So a malformed
 * board blanks the strip at worst, never throws in apply() ahead of the dudes and the builds.
 */
export function checkBoard(b: BoardView | undefined): BoardView | undefined {
  if (!b?.gold || !b.red) return undefined;
  const ticker = Array.isArray(b.ticker) ? b.ticker.filter((l) => typeof l === 'string' && l) : [];
  return {
    ...b,
    gold: { word: String(b.gold.word ?? ''), pct: b.gold.pct },
    red: { ...b.red, word: String(b.red.word ?? '') },
    tally: { red: b.tally?.red ?? 0, gold: b.tally?.gold ?? 0 },
    ticker,
    now: typeof b.now === 'string' && b.now ? b.now : undefined,
  };
}

// --- the demo -------------------------------------------------------------------------------------

/** The demo's two jobs: the head's Folly a third of the way up, Wren's bridge at 3 of 8. */
export const DEMO_BOARD = { gold: { word: 'BIG HUT', pct: 35 }, red: { word: 'BRIDGE', have: 3, need: 8 } } as const;

const isChatter = (d: DudeView) => !d.resident && !d.traveller && !d.mayor;
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
/** A play URL as people type it: no scheme, no trailing slash. */
export const shortUrl = (url: string) => url.replace(/^https?:\/\//, '').replace(/\/$/, '');

/**
 * `?demo=board`'s board, from the dudes in town: the tally counts awake chatters by the side their
 * marks show (FK-013's `sideOf`, demo sides included), and the ticker carries the premise, one
 * joiner a side and the !play line (it moves from the retired invite panel to the ticker).
 */
export function demoBoard(dudes: readonly DudeView[], head = 'The Chief', play?: { url: string }): BoardView {
  const tally = { red: 0, gold: 0 };
  const joined: Partial<Record<Side, string>> = {};
  for (const d of dudes) {
    if (d.away || !isChatter(d)) continue;
    const side = sideOf(d, true);
    if (!side) continue;
    tally[side]++;
    joined[side] ??= `${capital(d.name)} joined ${side}`;
  }
  const ticker = [`${head} took Wren's home`, 'Type red or gold to pick a side'];
  for (const side of ['red', 'gold'] as const) if (joined[side]) ticker.push(joined[side]);
  if (play) ticker.push(`Walk your character: ${shortUrl(play.url)}`);
  return { gold: { ...DEMO_BOARD.gold }, red: { ...DEMO_BOARD.red }, tally, ticker };
}

/**
 * The board to show: the server's while Story is ON (FK-011), else the demo's on `?demo=board`, else
 * none (Story OFF: today's page). `search` is the page's query string.
 */
export function boardFor(town: TownView | undefined, dudes: readonly DudeView[], search: string, play?: { url: string }): BoardView | undefined {
  // hook FK-011: the server's ticker has no !play line; it rides `play`, which comes only while the /play doors are open.
  if (town?.board && play) return { ...town.board, ticker: [...(Array.isArray(town.board.ticker) ? town.board.ticker : []), `Walk your character: ${shortUrl(play.url)}`] };
  if (town?.board) return town.board;
  if (!demoSidesOn(search)) return undefined;
  return demoBoard(dudes, town?.head, play);
}

// --- the ticker -----------------------------------------------------------------------------------

/**
 * Which ticker line is up. Each line stays TICKER_MS, then the next in the board's order comes round.
 * A line that wasn't in the list before (a joiner, a turncoat) jumps the queue: it is up as soon as
 * the line on show has had TICKER_FRESH_MS. Lines there from the first look are not news. The board's
 * `now` line, while it is set, holds the slot.
 */
export class TickerClock {
  private line: string | undefined;
  private since = 0;
  private known: Set<string> | undefined;
  private fresh: string[] = [];

  pick(lines: readonly string[], now: number, pinned?: string): string | undefined {
    const before = this.known;
    this.known = new Set(lines);
    if (before) for (const l of lines) if (!before.has(l) && !this.fresh.includes(l)) this.fresh.push(l);
    this.fresh = this.fresh.filter((l) => this.known!.has(l) && l !== this.line);
    if (pinned) return this.show(pinned, now);
    if (!lines.length) return (this.line = undefined);
    const held = this.line !== undefined && lines.includes(this.line);
    if (held && now - this.since < (this.fresh.length ? TICKER_FRESH_MS : TICKER_MS)) return this.line;
    // Next: the newest news first, else on round the list (from the top after a pinned line).
    const next = this.fresh.shift() ?? lines[(lines.indexOf(this.line ?? '') + 1) % lines.length];
    return this.show(next, now);
  }
  private show(line: string, now: number): string {
    if (line !== this.line) {
      this.line = line;
      this.since = now;
    } else if (now - this.since >= TICKER_MS) this.since = now; // a list of one: it just stays
    return line;
  }
}

// --- framing under the strip ----------------------------------------------------------------------

// autoFrame with the Board up. `top` is the share of the view's height the strip takes, down to its
// bottom edge. The subjects' half-height then has to fit in the rest of the view, and they sit in the
// middle of it rather than of the whole frame. The share is capped at a half, so a tall strip on a
// squat window can't blow the framing up.
const share = (top: number) => Math.max(0, Math.min(0.5, Number.isFinite(top) ? top : 0));
/** The view's half-height that fits the subjects' half-height `need` below the strip. */
export function fitUnder(top: number, need: number): number {
  return need / (1 - share(top));
}
/** How far to move the view's centre up (world units, at half-height `half`) so the subjects sit in the middle of the view below the strip. */
export function liftUnder(top: number, half: number): number {
  return half * share(top);
}

// --- on the page ----------------------------------------------------------------------------------

export type Rect = { l: number; t: number; r: number; b: number };
/** The HUD's rects at the top (the banner, the Board) as the one rect the tags keep out of. */
export function reserved(a?: Rect, b?: Rect): Rect | undefined {
  if (!a || !b) return a ?? b;
  return { l: Math.min(a.l, b.l), t: Math.min(a.t, b.t), r: Math.max(a.r, b.r), b: Math.max(a.b, b.b) };
}
export interface BoardUi {
  /** Each snapshot: the board to show (undefined takes it away) at the drawn server time. */
  update(board: BoardView | undefined, now: number): void;
  /** Where the strip sits at rest (CSS px, transforms ignored); undefined while there is none. */
  rect(): Rect | undefined;
}

type Bar = { root: HTMLElement; fill: HTMLElement; words: HTMLElement[]; word: string; num: string; fill01: number };

const make = <K extends keyof HTMLElementTagNameMap>(doc: Document, tag: K, cls?: string, text?: string) => {
  const e = doc.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

/** The Board on the page. Built on the first board, removed when the board goes. */
export function createBoard(doc: Document = document, reduced = matchMedia('(prefers-reduced-motion: reduce)').matches): BoardUi {
  const win = doc.defaultView ?? window;
  let root: HTMLElement | undefined;
  let gold: Bar, red: Bar;
  let rope: HTMLElement, goldN: HTMLElement, redN: HTMLElement, ticker: HTMLElement;
  let knot = -1;
  let shown: string | undefined;
  const clock = new TickerClock();
  let at: Rect | undefined;
  let measured = false;

  /** One bar: a track face (cream on ink) and the same face again in the side's colour, clipped to the fill. */
  function bar(side: Side): Bar {
    const box = make(doc, 'div', `bar ${side}`);
    const words: HTMLElement[] = [];
    const face = (cls: string) => {
      const f = make(doc, 'div', cls);
      const icon = make(doc, 'span', 'icon');
      icon.innerHTML = sideIcon(side);
      const word = make(doc, 'b', 'word');
      words.push(word);
      f.append(icon, word);
      return f;
    };
    const fill = face('face fill');
    fill.setAttribute('aria-hidden', 'true');
    box.append(face('face'), fill);
    return { root: box, fill, words, word: '', num: '', fill01: -1 };
  }

  function build(): HTMLElement {
    const el = make(doc, 'div', reduced ? '' : 'pop-in');
    // Once it has popped in, the class goes, so its held keyframes never sit over the scene fade.
    el.addEventListener('animationend', (e) => e.target === el && el.classList.remove('pop-in'));
    el.id = 'board';
    el.setAttribute('role', 'region');
    el.setAttribute('aria-label', 'The Board');
    gold = bar('gold');
    red = bar('red');
    const bars = make(doc, 'div', 'bars');
    bars.append(gold.root, red.root);
    const tug = make(doc, 'div', 'tug');
    goldN = make(doc, 'b', 'n');
    redN = make(doc, 'b', 'n');
    rope = make(doc, 'span', 'rope');
    rope.setAttribute('aria-hidden', 'true');
    rope.append(make(doc, 'i', 'knot'));
    tug.append(make(doc, 'span', 'pill gold cmd', 'type gold'), goldN, rope, redN, make(doc, 'span', 'pill red cmd', 'type red'));
    ticker = make(doc, 'div', 'pill ink ticker');
    ticker.hidden = true;
    el.append(bars, tug, ticker);
    doc.body.append(el);
    return el;
  }

  /** The word at 64 px, smaller for a long one (never under 54); if even that won't fit, the word is cut at a word and the number stays whole. */
  function fit(b: Bar) {
    const [probe] = b.words;
    const text = `${b.word} ${b.num}`;
    for (const w of b.words) {
      w.style.fontSize = '';
      w.textContent = text;
    }
    const room = probe.clientWidth;
    if (!room || probe.scrollWidth <= room) return;
    const size = Math.max(WORD_MIN_PX, Math.floor((WORD_PX * room) / probe.scrollWidth));
    for (const w of b.words) w.style.fontSize = `calc(${size} * var(--px))`;
    if (probe.scrollWidth <= probe.clientWidth) return;
    const cut = fitBar(b.word, b.num, (t) => ((probe.textContent = t), probe.scrollWidth <= probe.clientWidth));
    for (const w of b.words) w.textContent = cut;
  }
  function setBar(b: Bar, word: string, num: string, fill01: number, from: 'left' | 'right') {
    if (word !== b.word || num !== b.num) {
      b.word = word;
      b.num = num;
      b.root.setAttribute('aria-label', `${word} ${num}`);
      fit(b);
      measured = false;
    }
    if (fill01 !== b.fill01) {
      b.fill01 = fill01;
      const rest = `${((1 - fill01) * 100).toFixed(2)}%`;
      b.fill.style.clipPath = from === 'left' ? `inset(0 ${rest} 0 0)` : `inset(0 0 0 ${rest})`;
    }
  }

  /** The ticker pill: the old line fades out, then the new one in (never both at once), while the pill's width eases from one to the other. */
  function setLine(line: string | undefined) {
    if (line === shown) return;
    const first = shown === undefined;
    shown = line;
    measured = false;
    ticker.hidden = line === undefined;
    if (line === undefined) {
      ticker.replaceChildren();
      ticker.style.width = '';
      return;
    }
    const incoming = make(doc, 'span', first || reduced ? 'line' : 'line in', line);
    for (const old of ticker.querySelectorAll('.line')) {
      if (first || reduced || old.classList.contains('out')) old.remove();
      else {
        old.classList.add('out');
        win.setTimeout(() => old.remove(), 700);
      }
    }
    ticker.append(incoming);
    sizeTicker(incoming, line);
  }
  function sizeTicker(span: HTMLElement, line: string) {
    const cs = win.getComputedStyle(ticker);
    const chrome = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight) + parseFloat(cs.borderLeftWidth) + parseFloat(cs.borderRightWidth);
    const room = parseFloat(cs.maxWidth) - chrome;
    span.textContent = line;
    if (room > 0 && span.offsetWidth > room) span.textContent = fitWords(line, (t) => ((span.textContent = t), span.offsetWidth <= room));
    ticker.style.width = `${Math.ceil(span.offsetWidth + chrome)}px`;
  }
  /** The fonts arrived or the window changed: words and the ticker measure again. */
  function refit() {
    if (!root) return;
    for (const b of [gold, red]) fit(b);
    const last = ticker.querySelector<HTMLElement>('.line:not(.out)');
    if (last && shown) sizeTicker(last, shown);
    measured = false;
  }
  win.addEventListener('resize', refit);
  doc.fonts?.addEventListener('loadingdone', refit);

  function update(given: BoardView | undefined, now: number) {
    const board = checkBoard(given);
    if (!board) {
      if (!root) return;
      root.remove();
      root = undefined;
      shown = undefined;
      knot = -1;
      at = undefined;
      doc.body.classList.remove('board');
      doc.documentElement.style.removeProperty('--board-b');
      return;
    }
    if (!root) {
      root = build();
      doc.body.classList.add('board');
    }
    // The knot first: on a new strip it is set before anything measures (fitting the words does), so
    // the rope's first style already has it and the knot appears in its place, not sliding from the middle.
    const k = knotAt(board.tally);
    if (k !== knot) {
      knot = k;
      rope.style.setProperty('--knot', `${(k * 100).toFixed(2)}%`);
    }
    setBar(gold, board.gold.word, goldCount(board), goldFill(board), 'left');
    setBar(red, board.red.word, redCount(board), redFill(board), 'right');
    const g = String(count(board.tally.gold)),
      r = String(count(board.tally.red));
    if (goldN.textContent !== g) goldN.textContent = g;
    if (redN.textContent !== r) redN.textContent = r;
    setLine(clock.pick(board.ticker, now, board.now));
    if (!measured) rect(); // so the banner, measured next, already sits under the strip
  }

  function rect(): Rect | undefined {
    if (!root) return undefined;
    if (!measured) {
      measured = true;
      // Layout box, not the pop-in's scale: where it rests. It is position: fixed, so these are viewport px.
      const l = root.offsetLeft,
        t = root.offsetTop;
      at = { l, t, r: l + root.offsetWidth, b: t + root.offsetHeight };
      doc.documentElement.style.setProperty('--board-b', `${Math.ceil(at.b)}px`);
    }
    return at;
  }

  return { update, rect };
}
