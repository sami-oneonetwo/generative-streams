// The show on stream (FK-021, board/design-system.md §3–4, the FK-005 mock design/hud/fk-hud.html):
// what a gathering puts on screen, from `TownView.show` (story/show.ts) and the scene playing.
//
//   the Call      [🔔 GATHER: THE UNVEILING      (0:25)]   in the top strip, in place of the Board
//                 [   The Chief's secret build          ]
//   a scene          THE CHIEF'S BIG HUT                    the title card: 140 px caps, 10 px of ink stroke
//                 ▬▬▬ [⚑ WREN] That was our fire. ▬▬▬       the subtitle in the bottom bar: 58 px, ≤ 42 characters
//   after it        [NOW] MEND THE BRIDGE                   the NOW card, centre-lower, 6 s
//                          [⚑ type red]
//
// Never more than two text layers in a scene: the subtitle, then one other (layers()). The strip holds
// the Board in free play, the banner during a Call and nothing in a scene; while the NOW card is up the
// Board steps aside as well, so one text layer shows. Everything at the top fades with the letterbox
// (0.9 s, index.html). A line longer than 42 characters is shown in parts, one after another, each on
// one line (lineParts()), so nothing is cut that a scene says.
//
// Only the viewer page draws it (the stream and the plain page), like the Board: /mayor and /play keep
// today's subtitles. Each piece is built the first time it is needed, so Story OFF has none of them.
//
// `?demo=show` cycles the pieces locally, with no server change, every 20 s: the Call, a short scene
// (the camera holds still, as at a reveal) with the title card and two subtitles, then the NOW card.
// With `?demo=board&demo=show` the Board is there too, stepping aside and coming back as it would. A
// real `town.show` or scene from the server always wins.
import type { ShowView, TownView } from '../../src/shared/dudesTypes';
import { AGES } from '../../src/shared/ages';
import type { Scene } from '../../src/shared/scenes';
import type { Rect } from './board';
import { fitWords } from './feed';
import { CREAM, INK, SIDE_HEX, sideIcon } from './sideMarks';

/** A Call runs 25 s (bible §6) and the NOW card stays 6 s after a scene. The server's `until`s decide; the demo uses these. */
export const CALL_MS = 25_000;
export const NOW_MS = 6_000;
/** A subtitle is one line of at most this many characters (design-system §3); a longer line is shown in parts. */
export const LINE_MAX = 42;
/** Type sizes (design px at 1920×1080) and the least a long text shrinks to: nothing to read under 54, cards 96 or more. */
export const PX = { title: 140, titleMin: 96, banner: 72, bannerMin: 54, premise: 54, sub: 58, subMin: 54, now: 96, chip: 64, speaker: 54 } as const;

// --- what is up ----------------------------------------------------------------------------------

/** What the show can have up: the strip's two (the Board, the banner), the scene's two (the subtitle, the title card), FK-022's prompt tile, the NOW card. */
export type Piece = 'board' | 'banner' | 'subtitle' | 'title' | 'prompt' | 'now';

/**
 * Which pieces are up, from those that want to be: never more than two text layers.
 * - In a scene the strip is empty: the subtitle first, then the title card, the prompt, the NOW card.
 * - In free play the strip holds the banner during a Call, else the Board, which steps aside while the
 *   NOW card is up (it comes back when the card goes); then the NOW card, the title card, the prompt.
 */
export function layers(want: Partial<Record<Piece, boolean>>, cinema: boolean): Piece[] {
  const order: Piece[] = cinema ? ['subtitle', 'title', 'prompt', 'now'] : [want.banner ? 'banner' : 'board', 'now', 'title', 'prompt'];
  return order.filter((p) => want[p] && !(p === 'board' && want.now)).slice(0, 2);
}

/** The Call's clock: "0:25", whole seconds rounded up, never under "0:00". */
export function countdown(until: number, now: number): string {
  const ms = until - now;
  const left = Number.isFinite(ms) ? Math.max(0, Math.ceil(ms / 1000)) : 0;
  return `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
}

const words = (v: unknown) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '');
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * The server's show with its parts checked, since the data is new (FK-017, FK-019, FK-025): a piece
 * without its words or its `until` is no piece, a side is red or gold or none. So a malformed show
 * blanks a piece at worst, never throws in the frame. Undefined when nothing is left.
 */
export function checkShow(s: ShowView | undefined): ShowView | undefined {
  if (!s || typeof s !== 'object') return undefined;
  const out: ShowView = {};
  const { banner: b, now: n, title: t, prompt: p } = s;
  if (b && words(b.title) && finite(b.until)) out.banner = { title: words(b.title), until: b.until, ...(words(b.premise) ? { premise: words(b.premise) } : {}) };
  if (n && words(n.word) && finite(n.until))
    out.now = { word: words(n.word), until: n.until, ...(words(n.chip) ? { chip: words(n.chip) } : {}), ...(n.side === 'red' || n.side === 'gold' ? { side: n.side } : {}) };
  if (t && words(t.text) && finite(t.until)) out.title = { text: words(t.text), until: t.until };
  if (p && typeof p === 'object' && words(p.kind)) out.prompt = p; // FK-022 draws it
  return out.banner || out.now || out.title || out.prompt ? out : undefined;
}

// --- who says it ---------------------------------------------------------------------------------

/** A speaker chip's colour: the story's two, the band's own, or cream. */
export type Tone = 'red' | 'gold' | 'moss' | 'oak' | 'kit' | 'ash' | 'cream';
/** The band's locked colours (design-system §2): Wren is red. */
const CAST_TONES: Record<string, Tone> = { wren: 'red', ash: 'ash', moss: 'moss', oak: 'oak', kit: 'kit' };
const HEAD_TITLES = new Set(AGES.map((a) => a.head.title.toLowerCase()));
const bare = (s: string | undefined) => (s ?? '').trim().toLowerCase().replace(/^the\s+/, '');

/**
 * The speaker chip's colour: gold for the head (the town's head by name, or any age's title for him:
 * "The Chief", "Mayor"), the band's own colour for one of the band ("Old Moss" is Moss's green), cream
 * for anyone else (the caravan's leader, "Heroes of the Stone Age").
 */
export function speakerTone(who: string, head?: string): Tone {
  const w = bare(who);
  if (!w) return 'cream';
  if ((head && w === bare(head)) || HEAD_TITLES.has(w)) return 'gold';
  for (const word of w.split(/[^a-z]+/)) if (Object.hasOwn(CAST_TONES, word)) return CAST_TONES[word];
  return 'cream';
}

/** The title card is gold when it is the head's (his name in it: "THE CHIEF'S BIG HUT"; gold is his), cream otherwise ("THE BRONZE AGE"). */
export function titleTone(text: string, head?: string): 'gold' | 'cream' {
  const h = bare(head);
  if (!h) return 'cream';
  const name = h.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
  return new RegExp(`(^|[^a-z])${name}(?=[^a-z]|$)`).test(text.toLowerCase()) ? 'gold' : 'cream';
}

// --- the subtitle --------------------------------------------------------------------------------

/**
 * A line in parts of at most `max` characters, so each shows on one line, in as few parts as it
 * takes: split where both halves fit, else where one does (the other is split again), else nearest
 * the middle; among those, at a sentence end if there is one, else a clause, else nearest the middle.
 * A word longer than `max` on its own stays whole.
 */
export function lineParts(text: string, max = LINE_MAX): string[] {
  const t = words(text);
  if (!t) return [];
  if (t.length <= max) return [t];
  let at = -1,
    best = Infinity;
  for (const m of t.matchAll(/ /g)) {
    const i = m.index;
    const head = t.slice(0, i),
      tail = t.length - i - 1;
    const fit = (head.length <= max ? 1 : 0) + (tail <= max ? 1 : 0);
    const end = /[.!?…]["'’”)]*$/.test(head) ? 2 : /[,;:–—]$/.test(head) ? 1 : 0;
    const score = (2 - fit) * 1000 - (fit ? end * 100 : 0) + Math.abs(i - t.length / 2);
    if (score < best) [best, at] = [score, i];
  }
  return at < 0 ? [t] : [...lineParts(t.slice(0, at), max), ...lineParts(t.slice(at + 1), max)];
}

/** Which part of a line is up `k` (0..1) of the way through it: each part gets a share of the line's time by its length. */
export function partAt(parts: readonly string[], k: number): number {
  if (parts.length < 2) return 0;
  let left = Math.max(0, Math.min(1, Number.isFinite(k) ? k : 0)) * parts.reduce((n, p) => n + p.length, 0);
  for (let i = 0; i < parts.length; i++) if ((left -= parts[i].length) < 0) return i;
  return parts.length - 1;
}

// --- the demo ------------------------------------------------------------------------------------

/** `?demo=show` (alone or next to `?demo=board`). */
export const demoShowOn = (search: string): boolean => new URLSearchParams(search).getAll('demo').includes('show');

/** `?demo=show`'s round, in ms from the page's start, over and over: the Call, the scene, the NOW card, a breather. */
export const DEMO = { every: 20_000, call: 1500, scene: 6500, sceneMs: 4500 } as const;
/**
 * The demo's title card, in scene time: once the letterbox is in and the strip has faded (0.9 s), over the
 * head's line, so the scene shows its two text layers.
 */
const DEMO_TITLE = { at: 900, ms: 2000 } as const;

/** The demo's scene: no shots (the camera holds where it is, as at a reveal) and two lines, the head's and Wren's. */
export const DEMO_SCENE: Scene = {
  id: 'demo-show',
  ms: DEMO.sceneMs,
  shots: [],
  lines: [
    { at: 1000, ms: 1900, who: '{head}', text: 'Behold! A hut fit for me. Only me.' },
    { at: 3000, ms: 1500, who: 'Wren', text: 'That was our fire.' },
  ],
  beats: [],
};

export interface DemoShow {
  show?: ShowView;
  scene?: { id: string; at: number; vars: Record<string, string> };
}

/**
 * `?demo=show` at page time `t` (ms since the page started), with every time in that clock: the
 * pieces up and the scene playing. The Call stops short at the scene, as a real one does once 70%
 * have arrived, so its clock never reaches 0:00 here.
 */
export function demoShow(t: number, head = 'The Chief'): DemoShow {
  const round = Math.floor(Math.max(0, t) / DEMO.every) * DEMO.every;
  const s = t - round;
  const sceneEnd = DEMO.scene + DEMO.sceneMs,
    title = DEMO.scene + DEMO_TITLE.at;
  const show: ShowView = {};
  if (s >= DEMO.call && s < DEMO.scene) show.banner = { title: 'GATHER: THE UNVEILING', premise: `${head}'s secret build`, until: round + DEMO.call + CALL_MS };
  if (s >= title && s < title + DEMO_TITLE.ms) show.title = { text: `${head}'s Big Hut`, until: round + title + DEMO_TITLE.ms };
  if (s >= sceneEnd && s < sceneEnd + NOW_MS) show.now = { word: 'MEND THE BRIDGE', chip: 'type red', side: 'red', until: round + sceneEnd + NOW_MS };
  const out: DemoShow = {};
  if (show.banner || show.title || show.now) out.show = show;
  if (s >= DEMO.scene && s < sceneEnd) out.scene = { id: DEMO_SCENE.id, at: round + DEMO.scene, vars: { head } };
  return out;
}

/** A show's times moved by `by` ms (the demo's page clock onto the server's). */
function shifted(s: ShowView, by: number): ShowView {
  const out: ShowView = {};
  if (s.banner) out.banner = { ...s.banner, until: s.banner.until + by };
  if (s.now) out.now = { ...s.now, until: s.now.until + by };
  if (s.title) out.title = { ...s.title, until: s.title.until + by };
  return out;
}

// --- on the page ---------------------------------------------------------------------------------

/** The scene's line as the page has it (cinema() in main.ts): who says it, what (filled), whether it is a title, how far through it (0..1). */
export interface SceneSay {
  who: string;
  text: string;
  title: boolean;
  k: number;
  /** Which line of which scene, so a part change is the only re-draw. */
  key: string;
}

export interface ShowUi {
  /**
   * Each snapshot, after the story look is set: the server's show (undefined: none), and the town: the
   * head's name colours his lines, and a real scene stands the demo down. Out of the story look (Story
   * OFF, no `?demo=`) every piece goes from the page.
   */
  update(show: ShowView | undefined, town?: Pick<TownView, 'head' | 'scene' | 'story'>): void;
  /** `?demo=show`'s scene at server time `now`, while the server plays none. */
  demoScene(now: number): TownView['scene'] | undefined;
  /** Each frame, after cinema(): the drawn server time, whether a scene has the letterbox, and its line. */
  frame(now: number, cinema: boolean, said?: SceneSay): void;
  /** Where the GATHER banner sits at rest while it holds the strip (CSS px); undefined while it's down. */
  rect(): Rect | undefined;
}

/** A piece first showing, for a sound (FK-126's Call bell, FK-171's NOW chime: one line in main.ts). */
export type ShowCue = 'banner' | 'now' | 'title';

// The Call's bell and the long-poled pennant (the FK-005 mock's). An icon in a chip sits on a cream seal: the
// pennant on red, the crown on gold. (The tag's small flag, in a seal, reads as a "play" button at stream size.)
const BELL = `<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M32 8c-11 0-17 9-17 20v9l-6 9h46l-6-9v-9c0-11-6-20-17-20z" fill="${SIDE_HEX.gold}" stroke="${INK}" stroke-width="5" stroke-linejoin="round"/><circle cx="32" cy="52" r="6" fill="${CREAM}" stroke="${INK}" stroke-width="4.5"/><path d="M32 3v6" stroke="${INK}" stroke-width="5" stroke-linecap="round"/><path d="M5 22c1-6 4-10 8-13M59 22c-1-6-4-10-8-13" fill="none" stroke="${INK}" stroke-width="4" stroke-linecap="round"/></svg>`;
const FLAG = `<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M15 7v52" stroke="${INK}" stroke-width="7" stroke-linecap="round"/><path d="M18 9c12 2 26 6 40 12-13 6-27 10-40 14z" fill="${SIDE_HEX.red}" stroke="${INK}" stroke-width="5" stroke-linejoin="round"/></svg>`;
/** A side's icon on its cream seal, for a chip. */
function seal(doc: Document, side: 'red' | 'gold'): HTMLElement {
  const e = make(doc, 'span', 'seal');
  e.innerHTML = side === 'red' ? FLAG : sideIcon('gold');
  return e;
}

const make = <K extends keyof HTMLElementTagNameMap>(doc: Document, tag: K, cls?: string, text?: string) => {
  const e = doc.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};
const size = (px: number) => `calc(${px} * var(--px))`;

/** The show on the page. Each piece is built the first time it shows, then kept and faded in and out. */
export function createShow(
  doc: Document = document,
  reduced = matchMedia('(prefers-reduced-motion: reduce)').matches,
  opts: { search?: string; pageMs?: () => number; cue?: (piece: ShowCue) => void } = {},
): ShowUi {
  const win = doc.defaultView ?? window;
  const demo = demoShowOn(opts.search ?? win.location.search);
  const pageMs = opts.pageMs ?? (() => win.performance.now());
  let server: ShowView | undefined;
  let head = 'The Chief';
  let real = false;
  let seen = false;
  let round = -1,
    anchor = 0;
  let demoAt = NaN,
    demoNow: DemoShow | undefined;

  /**
   * The demo at server time `now`, from the first snapshot on: its round runs on the page's own clock
   * (so a page's first round starts as it loads, whatever the drawn clock does meanwhile), and each
   * round's times are put on the server's clock once, as it starts, so they hold still through it.
   */
  function demoAtNow(now: number): DemoShow | undefined {
    if (!demo || !seen || server || real) return undefined;
    if (now !== demoAt) {
      demoAt = now;
      const t = pageMs();
      if (Math.floor(t / DEMO.every) !== round) {
        round = Math.floor(t / DEMO.every);
        anchor = now - t;
      }
      const d = demoShow(t, head);
      demoNow = {
        ...(d.show ? { show: shifted(d.show, anchor) } : {}),
        ...(d.scene ? { scene: { ...d.scene, at: d.scene.at + anchor } } : {}),
      };
    }
    return demoNow;
  }

  /** Up: shown, popping in; down: faded out, its words kept until it shows again. */
  function up(e: HTMLElement): boolean {
    if (e.classList.contains('up')) return false;
    e.classList.add('up');
    if (!reduced) e.classList.add('pop-in');
    return true;
  }
  /** Something new on a piece that is up: it pops in again (the layout read lets the animation start over). */
  function again(e: HTMLElement) {
    if (down(e)) void e.offsetWidth;
  }
  function down(e: HTMLElement | undefined): boolean {
    if (!e?.classList.contains('up')) return false;
    e.classList.remove('up', 'pop-in');
    return true;
  }
  function piece<K extends keyof HTMLElementTagNameMap>(tag: K, id: string, cls = ''): HTMLElementTagNameMap[K] {
    const e = make(doc, tag, cls);
    e.id = id;
    // Once it has popped in the class goes, so its held keyframes never sit over a fade.
    e.addEventListener('animationend', (ev) => ev.target === e && e.classList.remove('pop-in'));
    doc.body.append(e);
    return e;
  }

  /** Shrinks `e`'s font from `px` toward `min` until its text fits its box on one line; false when even `min` won't. */
  function shrink(e: HTMLElement, px: number, min: number): boolean {
    e.style.fontSize = '';
    const room = e.clientWidth;
    if (!room || e.scrollWidth <= room) return true;
    e.style.fontSize = size(Math.max(min, Math.floor((px * room) / e.scrollWidth)));
    return e.scrollWidth <= e.clientWidth;
  }
  /** Fits a one-line text: shrunk, then cut at a word ("…") if it still won't fit. */
  function fitLine(e: HTMLElement, text: string, px: number, min: number) {
    e.textContent = text;
    if (!shrink(e, px, min)) e.textContent = fitWords(text, (t) => ((e.textContent = t), e.scrollWidth <= e.clientWidth));
  }

  // The GATHER banner: the bell, the title (72), the clock (64), the premise (54).
  let banner: { root: HTMLElement; title: HTMLElement; clock: HTMLElement; premise: HTMLElement; words: [string, string] } | undefined;
  let at: Rect | undefined;
  let measured = false;
  function fitBanner() {
    if (!banner) return;
    fitLine(banner.title, banner.words[0], PX.banner, PX.bannerMin);
    fitLine(banner.premise, banner.words[1], PX.premise, PX.premise);
  }
  function setBanner(b: ShowView['banner'], now: number) {
    if (!b) {
      if (down(banner?.root)) {
        doc.body.classList.remove('show-call');
        doc.documentElement.style.removeProperty('--show-b');
        at = undefined;
      }
      return;
    }
    if (!banner) {
      const root = piece('div', 'show-banner', 'card ink');
      root.setAttribute('role', 'status');
      const bell = make(doc, 'span', 'seal');
      bell.innerHTML = BELL;
      banner = { root, title: make(doc, 'b', 'title'), clock: make(doc, 'span', 'pill gold clock'), premise: make(doc, 'span', 'premise'), words: ['', ''] };
      root.append(bell, banner.title, banner.clock, banner.premise);
    }
    const premise = b.premise ?? '';
    if (b.title !== banner.words[0] || premise !== banner.words[1]) {
      banner.words = [b.title, premise];
      banner.premise.hidden = !premise;
      banner.root.setAttribute('aria-label', `${b.title}. ${premise}`);
      measured = false;
    }
    const clock = countdown(b.until, now);
    if (banner.clock.textContent !== clock) banner.clock.textContent = clock;
    if (up(banner.root)) {
      doc.body.classList.add('show-call');
      measured = false;
      opts.cue?.('banner');
    }
    if (!measured) {
      fitBanner();
      rect();
    }
  }

  // The NOW card: the tab, the word (96, wrapping rather than shrinking), the chip (64) in its side's colour.
  let nowCard: { root: HTMLElement; word: HTMLElement; chip: HTMLElement; key: string } | undefined;
  function setNow(n: ShowView['now']) {
    if (!n) {
      if (down(nowCard?.root)) doc.body.classList.remove('show-now');
      return;
    }
    if (!nowCard) {
      const root = piece('div', 'show-now', 'card ink');
      root.setAttribute('role', 'status');
      nowCard = { root, word: make(doc, 'b', 'word'), chip: make(doc, 'span'), key: '' };
      root.append(make(doc, 'span', 'pill tab', 'NOW'), nowCard.word, nowCard.chip);
    }
    const key = `${n.word}\n${n.chip ?? ''}\n${n.side ?? ''}`;
    if (key !== nowCard.key) {
      nowCard.key = key;
      nowCard.word.textContent = n.word;
      nowCard.chip.className = `pill chip ${n.side ?? 'cream'}`;
      nowCard.chip.replaceChildren();
      if (n.side) nowCard.chip.append(seal(doc, n.side));
      nowCard.chip.append(n.chip ?? '');
      nowCard.chip.hidden = !n.chip;
      // A new card while one is up pops again: it says something new.
      again(nowCard.root);
    }
    if (up(nowCard.root)) {
      doc.body.classList.add('show-now');
      opts.cue?.('now');
    }
  }

  // The title card: 140 px caps, a line that shrinks to fit (never under 96), then wraps.
  let title: { root: HTMLElement; key: string } | undefined;
  function fitTitle() {
    if (!title) return;
    title.root.classList.remove('wrap');
    if (!shrink(title.root, PX.title, PX.titleMin)) title.root.classList.add('wrap');
  }
  function setTitle(text: string | undefined) {
    if (!text) return void down(title?.root);
    title ??= { root: piece('div', 'show-title'), key: '' };
    const tone = titleTone(text, head);
    const key = `${tone}\n${text}`;
    if (key !== title.key) {
      again(title.root);
      title.key = key;
      title.root.textContent = text;
      title.root.className = tone;
    }
    if (up(title.root)) {
      fitTitle();
      opts.cue?.('title');
    }
  }

  // The subtitle in the bottom bar: the speaker's chip (54) and one line (58), a long line in parts.
  let sub: { root: HTMLElement; who: HTMLElement; line: HTMLElement; key: string; parts: string[]; text: string } | undefined;
  function setSub(said: SceneSay | undefined) {
    if (!said) return void down(sub?.root);
    if (!sub) {
      const root = piece('div', 'show-sub');
      root.setAttribute('aria-live', 'polite');
      sub = { root, who: make(doc, 'span'), line: make(doc, 'span', 'line'), key: '', parts: [], text: '' };
      root.append(sub.who, sub.line);
    }
    if (said.key !== sub.key) {
      sub.key = said.key;
      sub.parts = lineParts(said.text);
      sub.text = '';
      const tone = speakerTone(said.who, head);
      sub.who.className = `pill who ${tone}`;
      sub.who.replaceChildren();
      if (tone === 'red' || tone === 'gold') sub.who.append(seal(doc, tone));
      sub.who.append(said.who);
      sub.who.hidden = !said.who;
    }
    const text = sub.parts[partAt(sub.parts, said.k)] ?? '';
    if (text !== sub.text) {
      sub.text = text;
      // A new part fades in again; the chip stays.
      sub.line.classList.remove('in');
      void sub.line.offsetWidth;
      if (!reduced) sub.line.classList.add('in');
      fitLine(sub.line, text, PX.sub, PX.subMin);
    }
    up(sub.root);
  }

  /** The fonts arrived or the window changed: everything on show measures again. */
  function refit() {
    if (banner?.root.classList.contains('up')) fitBanner();
    if (title?.root.classList.contains('up')) fitTitle();
    if (sub?.root.classList.contains('up')) fitLine(sub.line, sub.text, PX.sub, PX.subMin);
    measured = false;
  }
  win.addEventListener('resize', refit);
  doc.fonts?.addEventListener('loadingdone', refit);

  /** Out of the story look: every piece goes from the page, as if it had never been. */
  function clear() {
    if (!banner && !nowCard && !title && !sub) return;
    for (const e of [banner?.root, nowCard?.root, title?.root, sub?.root]) e?.remove();
    banner = nowCard = title = sub = undefined;
    at = undefined;
    doc.body.classList.remove('show-call', 'show-now');
    doc.documentElement.style.removeProperty('--show-b');
  }

  function rect(): Rect | undefined {
    if (!banner?.root.classList.contains('up')) return undefined;
    if (!measured) {
      measured = true;
      // Its layout box, not the pop-in's scale: where it rests. It is position: fixed, so these are viewport px.
      const r = banner.root;
      at = { l: r.offsetLeft, t: r.offsetTop, r: r.offsetLeft + r.offsetWidth, b: r.offsetTop + r.offsetHeight };
      doc.documentElement.style.setProperty('--show-b', `${Math.ceil(at.b)}px`);
    }
    return at;
  }

  return {
    update(show, town) {
      seen = true;
      server = checkShow(show);
      head = town?.head || 'The Chief';
      real = !!town?.scene;
      // Out of the story look (Story OFF, no ?demo=; main.ts sets it first) nothing of the show stays on the page.
      if (!doc.body.classList.contains('story')) clear();
    },
    demoScene(now) {
      return demoAtNow(now)?.scene;
    },
    frame(now, cinema, said) {
      const show = server ?? demoAtNow(now)?.show;
      const live = <P extends { until: number }>(p: P | undefined) => (p && now < p.until ? p : undefined);
      const banner = live(show?.banner),
        card = live(show?.now);
      const titled = live(show?.title)?.text ?? (said?.title ? said.text : undefined);
      const line = said && !said.title && said.text ? said : undefined;
      const on = layers({ board: true, banner: !!banner, now: !!card, title: !!titled, subtitle: !!line, prompt: !!show?.prompt }, cinema);
      setBanner(on.includes('banner') ? banner : undefined, now);
      setNow(on.includes('now') ? card : undefined);
      setTitle(on.includes('title') ? titled : undefined);
      setSub(on.includes('subtitle') ? line : undefined);
    },
    rect,
  };
}
