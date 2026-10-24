// The show on the stream (client/dudes/show.ts, FK-021): the GATHER banner in the top strip in place of
// the Board, the NOW card, the title card and the subtitle in the bottom bar; never more than two text
// layers in a scene; long lines shown in parts of ≤ 42 characters; the speaker chips' colours;
// `?demo=show`'s round; the server's show checked; the sheet's sizes; Story OFF without any of it.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  CALL_MS,
  DEMO,
  DEMO_SCENE,
  LINE_MAX,
  NOW_MS,
  checkShow,
  countdown,
  createShow,
  demoShow,
  demoShowOn,
  layers,
  lineParts,
  partAt,
  speakerTone,
  titleTone,
  type Piece,
  type SceneSay,
  type ShowCue,
} from '../client/dudes/show';
import { AGES } from '../src/shared/ages';
import type { ShowView } from '../src/shared/dudesTypes';
import { SCENES, fillLine, sceneLine } from '../src/shared/scenes';
import { STORY_SCENES } from '../src/shared/storyScenes';
import { caravanOf } from '../src/worlds/ai-dudes/caravan';

const PIECES: Piece[] = ['board', 'banner', 'subtitle', 'title', 'prompt', 'now'];

test('never more than two text layers: in a scene the subtitle and one other, the strip empty', () => {
  for (let m = 0; m < 1 << PIECES.length; m++) {
    const want = Object.fromEntries(PIECES.map((p, i) => [p, !!(m & (1 << i))]));
    for (const cinema of [true, false]) {
      const up = layers(want, cinema);
      assert.ok(up.length <= 2, `${JSON.stringify(want)} ${cinema}: ${up}`);
      assert.ok(up.every((p) => want[p]), 'only what wants to be up');
      if (cinema) {
        assert.ok(!up.includes('banner') && !up.includes('board'), 'the strip holds nothing in a scene');
        if (want.subtitle) assert.equal(up[0], 'subtitle', 'the subtitle is always one of the two');
      } else {
        assert.ok(!up.includes('subtitle'), 'no subtitle outside a scene');
        assert.ok(!(up.includes('banner') && up.includes('board')), 'the strip holds one thing');
        if (want.now) assert.ok(!up.includes('board'), 'the Board steps aside for the NOW card');
      }
    }
  }
  // The scenes the bible draws (the FK-005 mock's frames).
  assert.deepEqual(layers({ subtitle: true, title: true, prompt: true }, true), ['subtitle', 'title'], 'the reveal with a line: title over RATE IT');
  assert.deepEqual(layers({ title: true, prompt: true }, true), ['title', 'prompt'], 'the reveal: the title card and RATE IT');
  assert.deepEqual(layers({ board: true, banner: true }, false), ['banner'], 'the Call: the banner in place of the Board');
  assert.deepEqual(layers({ board: true, now: true }, false), ['now'], 'after a scene: the NOW card alone, one text layer');
  assert.deepEqual(layers({ board: true }, false), ['board'], 'free play');
  assert.deepEqual(layers({ board: true, banner: true, now: true }, false), ['banner', 'now']);
});

test('the Call’s clock: "0:25" down to "0:00", whole seconds rounded up', () => {
  assert.equal(countdown(25_000, 0), '0:25');
  assert.equal(countdown(25_000, 1), '0:25', 'a second only goes once it has gone');
  assert.equal(countdown(25_000, 15_001), '0:10');
  assert.equal(countdown(1000, 999), '0:01');
  assert.equal(countdown(1000, 1000), '0:00');
  assert.equal(countdown(1000, 5000), '0:00', 'never below');
  assert.equal(countdown(95_000, 0), '1:35');
  assert.equal(countdown(Number.NaN, 0), '0:00');
});

test('a malformed show from the server blanks a piece at worst, never throws', () => {
  assert.equal(checkShow(undefined), undefined);
  assert.equal(checkShow({}), undefined, 'nothing in it is no show');
  const ok: ShowView = {
    banner: { title: ' GATHER:  THE UNVEILING ', premise: 'The Chief’s secret build', until: 9 },
    now: { word: 'MEND THE BRIDGE', chip: 'type red', side: 'red', until: 9 },
    title: { text: 'THE CHIEF’S BIG HUT', until: 9 },
  };
  assert.deepEqual(checkShow(ok), { ...ok, banner: { ...ok.banner!, title: 'GATHER: THE UNVEILING' } }, 'spaces tidied, the rest as sent');
  const bad = {
    banner: { title: '', until: 9 },
    now: { word: 'GO', chip: 7, side: 'purple', until: 9 },
    title: { text: 'X', until: Number.POSITIVE_INFINITY },
    prompt: { label: 'no kind' },
  } as unknown as ShowView;
  assert.deepEqual(checkShow(bad), { now: { word: 'GO', until: 9 } }, 'a banner without words, a title without a time and a prompt without a kind go; a bad chip and side drop');
  assert.equal(checkShow({ now: { word: 'GO' } } as unknown as ShowView), undefined, 'no until, no piece');
  assert.equal(checkShow('nonsense' as unknown as ShowView), undefined);
  const prompt = { kind: 'rate', label: 'RATE IT', value: 5 };
  assert.deepEqual(checkShow({ prompt }), { prompt }, 'the prompt goes through to FK-022');
});

test('the speaker chips: gold for the head, red for Wren, the band in their own colours, cream for anyone else', () => {
  assert.equal(speakerTone('Wren'), 'red');
  assert.equal(speakerTone('The Chief', 'The Chief'), 'gold');
  assert.equal(speakerTone('the chief', 'The Chief'), 'gold', 'any case');
  assert.equal(speakerTone('Lord Sami', 'Lord Sami'), 'gold', 'the head by the name the town gives him');
  for (const a of AGES) assert.equal(speakerTone(`The ${a.head.title}`, 'The Chief'), 'gold', `${a.head.title}: him in any age`);
  assert.equal(speakerTone('Old Moss'), 'moss');
  assert.equal(speakerTone('Oak'), 'oak');
  assert.equal(speakerTone('Kit'), 'kit');
  assert.equal(speakerTone('Ash'), 'ash');
  assert.equal(speakerTone('Mr Ashby'), 'cream', 'a name with Ash in it is not Ash');
  assert.equal(speakerTone('Ashur the Boatman'), 'cream');
  assert.equal(speakerTone('Toma'), 'cream', 'the caravan’s leader');
  assert.equal(speakerTone('Heroes of the Stone Age', 'The Chief'), 'cream');
  assert.equal(speakerTone(''), 'cream');
  // The title card: gold is his.
  assert.equal(titleTone("The Chief's Big Hut", 'The Chief'), 'gold');
  assert.equal(titleTone('THE CHIEF’S BIG HUT', 'The Chief'), 'gold');
  assert.equal(titleTone('Friends of the Chief', 'The Chief'), 'gold');
  assert.equal(titleTone('The Bronze Age', 'The Chief'), 'cream');
  assert.equal(titleTone('Mischief', 'The Chief'), 'cream', 'a whole word only');
  assert.equal(titleTone('ASH', 'The Chief'), 'cream');
  assert.equal(titleTone('The journey is complete'), 'cream');
});

test('a subtitle is one line of ≤ 42 characters: a longer line shows in parts, split at a sentence where it can', () => {
  assert.deepEqual(lineParts('That was our fire.'), ['That was our fire.']);
  assert.deepEqual(lineParts('  '), []);
  assert.deepEqual(lineParts("We'll tell every river about this town. Goodbye, and thank you."), ["We'll tell every river about this town.", 'Goodbye, and thank you.']);
  assert.deepEqual(lineParts('I was a little girl at the river when you mended the bridge. Look how far you came.'), [
    'I was a little girl at the river when you',
    'mended the bridge. Look how far you came.',
  ]);
  assert.deepEqual(lineParts('Supercalifragilisticexpialidociousandthensome-and-more'), ['Supercalifragilisticexpialidociousandthensome-and-more'], 'one long word stays whole');
  // Every line the caravans and the scripts can say comes out in parts that fit, and nothing is lost.
  const said: string[] = [];
  for (let age = 0; age < AGES.length; age++) {
    const c = caravanOf(age);
    said.push(c.greeting, c.farewell, c.daughterLine, ...c.problems);
  }
  for (const s of [...Object.values(SCENES), ...Object.values(STORY_SCENES)]) for (const l of s!.lines) said.push(l.text);
  for (const line of said) {
    const parts = lineParts(line);
    for (const p of parts) assert.ok(p.length <= LINE_MAX || !p.includes(' '), `"${p}" (${p.length})`);
    assert.equal(parts.join(' '), line.replace(/\s+/g, ' ').trim());
  }
  // Each part is up for its share of the line's time, by its length.
  const parts = ['aaaa', 'bb', 'cccc'];
  assert.deepEqual([0, 0.3, 0.4, 0.55, 0.6, 0.99, 1, 7, -1, Number.NaN].map((k) => partAt(parts, k)), [0, 0, 1, 1, 2, 2, 2, 2, 0, 0]);
  assert.equal(partAt(['one'], 0.9), 0);
  assert.equal(partAt([], 0.5), 0);
});

test('story scenes write their subtitles short: one line of ≤ 42 characters each (design-system §3)', () => {
  for (const s of Object.values(STORY_SCENES))
    for (const l of s.lines) if (!l.title && !l.text.includes('{')) assert.ok(l.text.length <= LINE_MAX, `${s.id}: "${l.text}" is ${l.text.length}`);
  for (const l of DEMO_SCENE.lines) assert.ok(l.text.length <= LINE_MAX);
});

test('?demo=show: the Call at 4 s, a scene with the title card and a subtitle at 8 s, the NOW card at 12 s, round again every 20 s', () => {
  assert.equal(demoShowOn('?stream=1&demo=show'), true);
  assert.equal(demoShowOn('?demo=board&demo=show'), true, 'next to the demo Board');
  assert.equal(demoShowOn('?demo=board'), false);
  assert.equal(demoShowOn('?stream=1'), false);
  assert.deepEqual(demoShow(500), {}, 'a breath first while the page loads');
  const call = demoShow(4000);
  assert.deepEqual(call.show?.banner, { title: 'GATHER: THE UNVEILING', premise: "The Chief's secret build", until: DEMO.call + CALL_MS });
  assert.equal(countdown(call.show!.banner!.until, 4000), '0:23');
  assert.equal(call.scene, undefined);
  const scene = demoShow(8000, 'The King');
  assert.deepEqual(scene.scene, { id: DEMO_SCENE.id, at: DEMO.scene, vars: { head: 'The King' } });
  assert.equal(scene.show?.banner, undefined, 'the Call is over at the scene');
  assert.equal(scene.show?.title?.text, "The King's Big Hut");
  const line = sceneLine(DEMO_SCENE, 8000 - DEMO.scene, scene.scene!.vars);
  assert.equal(fillLine(line?.who, scene.scene!.vars), 'The King');
  assert.deepEqual(layers({ title: !!scene.show?.title, subtitle: !!line }, true), ['subtitle', 'title'], 'two text layers, the most a scene shows');
  const now = demoShow(12_000);
  assert.deepEqual(now.show?.now, { word: 'MEND THE BRIDGE', chip: 'type red', side: 'red', until: DEMO.scene + DEMO.sceneMs + NOW_MS });
  assert.equal(now.scene, undefined);
  assert.deepEqual(demoShow(18_500), {}, 'a breather: the Board alone');
  assert.deepEqual(demoShow(DEMO.every + 4000).show?.banner?.until, DEMO.every + DEMO.call + CALL_MS, 'the next round');
  // The scene has no shots: the camera holds where it was (as at a reveal), and it fits between the Call and the NOW card.
  assert.deepEqual(DEMO_SCENE.shots, []);
  assert.equal(DEMO_SCENE.ms, DEMO.sceneMs);
  assert.ok(DEMO.scene + DEMO.sceneMs + NOW_MS < DEMO.every);
  assert.ok(!(DEMO_SCENE.id in SCENES) && !(DEMO_SCENE.id in STORY_SCENES), 'never a real scene’s id');
});

// --- the pieces on a page: a small stand-in for the DOM -------------------------------------------

class El {
  id = '';
  hidden = false;
  innerHTML = '';
  children: El[] = [];
  parent?: El;
  classes = new Set<string>();
  attrs = new Map<string, string>();
  style = { fontSize: '', props: new Map<string, string>(), setProperty: (k: string, v: string) => this.style.props.set(k, v), removeProperty: (k: string) => this.style.props.delete(k) };
  offsetLeft = 0;
  offsetTop = 14;
  offsetWidth = 1240;
  offsetHeight = 190;
  clientWidth = 0;
  scrollWidth = 0;
  private text = '';
  constructor(readonly tag: string) {}
  get className() {
    return [...this.classes].join(' ');
  }
  set className(v: string) {
    this.classes = new Set(v.split(/\s+/).filter(Boolean));
  }
  classList = {
    add: (...c: string[]) => c.forEach((x) => this.classes.add(x)),
    remove: (...c: string[]) => c.forEach((x) => this.classes.delete(x)),
    contains: (c: string) => this.classes.has(c),
    toggle: (c: string, on: boolean) => (on ? this.classes.add(c) : this.classes.delete(c), on),
  };
  get textContent(): string {
    return this.text + this.children.map((c) => c.textContent).join('');
  }
  set textContent(v: string) {
    this.text = v;
    this.children = [];
  }
  append(...xs: (El | string)[]) {
    for (const x of xs)
      if (typeof x === 'string') this.text += x;
      else {
        x.parent = this;
        this.children.push(x);
      }
  }
  replaceChildren() {
    this.children = [];
    this.text = '';
  }
  remove() {
    if (this.parent) this.parent.children = this.parent.children.filter((c) => c !== this);
    this.parent = undefined;
  }
  setAttribute(k: string, v: string) {
    this.attrs.set(k, v);
  }
  addEventListener() {}
  find(id: string): El | undefined {
    return this.children.find((c) => c.id === id);
  }
}
function page(search = '', story = true) {
  const body = new El('body'),
    root = new El('html');
  // main.ts puts the page in the story look (Story ON, or any ?demo=) before it hands over a snapshot.
  if (story) body.classes.add('story');
  let pageMs = 0;
  const doc = { body, documentElement: root, createElement: (tag: string) => new El(tag), defaultView: { location: { search }, addEventListener() {} } };
  const cues: ShowCue[] = [];
  const ui = createShow(doc as unknown as Document, false, { search, pageMs: () => pageMs, cue: (c) => cues.push(c) });
  /** Every piece on the page that is up. */
  const up = () => body.children.filter((c) => c.id.startsWith('show-') && c.classes.has('up')).map((c) => c.id);
  return { ui, body, root, cues, up, at: (ms: number) => (pageMs = ms) };
}
/** The server's clock is far from the page's: the demo pins one onto the other. */
const T0 = 1_700_000_000_000;

test('?demo=show on a page: each piece shows in its turn, never more than two, and the Board steps aside for the banner and the NOW card', () => {
  const p = page('?stream=1&demo=show');
  p.at(0);
  p.ui.frame(T0, false);
  assert.deepEqual(p.body.children, [], 'nothing before the first snapshot');
  p.ui.update(undefined, { head: 'The Chief' });
  const run = (t: number) => {
    p.at(t);
    const now = T0 + t;
    const sc = p.ui.demoScene(now);
    let said: SceneSay | undefined;
    if (sc) {
      const st = now - sc.at;
      const l = sceneLine(DEMO_SCENE, st, sc.vars);
      if (l) said = { who: fillLine(l.who, sc.vars!), text: fillLine(l.text, sc.vars!), title: !!l.title, k: (st - l.at) / l.ms, key: `${sc.at}:${l.at}` };
    }
    p.ui.frame(now, !!sc, said);
    return { scene: !!sc, up: p.up() };
  };
  assert.deepEqual(run(4000), { scene: false, up: ['show-banner'] });
  const banner = p.body.find('show-banner')!;
  assert.equal(banner.children.find((c) => c.classes.has('clock'))?.textContent, '0:23', 'the clock counts on the server’s time');
  assert.equal(banner.children.find((c) => c.classes.has('title'))?.textContent, 'GATHER: THE UNVEILING');
  assert.ok(p.body.classes.has('show-call'), 'the Board steps aside');
  assert.ok(p.ui.rect(), 'the strip’s rect is the banner’s');
  assert.equal(p.root.style.props.get('--show-b'), '204px', 'the troublemaker banner drops under it');
  run(4600);
  assert.equal(banner.children.find((c) => c.classes.has('clock'))?.textContent, '0:22');
  assert.deepEqual(run(8000), { scene: true, up: ['show-title', 'show-sub'] }, 'the scene: the title card and the subtitle, two layers');
  assert.ok(!p.body.classes.has('show-call') && p.ui.rect() === undefined, 'the strip is empty in a scene');
  const sub = p.body.find('show-sub')!;
  const says = () => sub.textContent;
  assert.equal(says(), 'The ChiefBehold! A hut fit for me. Only me.');
  assert.ok(sub.children[0].classes.has('gold'), 'his chip is gold');
  assert.equal(p.body.find('show-title')!.textContent, "The Chief's Big Hut");
  assert.ok(p.body.find('show-title')!.classes.has('gold'), 'his title is gold');
  assert.deepEqual(run(9800), { scene: true, up: ['show-sub'] });
  assert.ok(sub.children[0].classes.has('red') && says() === 'WrenThat was our fire.', 'Wren in red');
  assert.deepEqual(run(12_000), { scene: false, up: ['show-now'] });
  assert.ok(p.body.classes.has('show-now'), 'the Board steps aside for the NOW card');
  assert.equal(p.body.find('show-now')!.textContent, 'NOWMEND THE BRIDGEtype red');
  assert.deepEqual(run(18_000), { scene: false, up: [] });
  assert.ok(!p.body.classes.has('show-now') && !p.body.classes.has('show-call'), 'the Board is back');
  // Next round: the same pieces again, each cue once a round.
  for (let t = 20_000; t < 40_000; t += 250) assert.ok(run(t).up.length <= 2);
  assert.deepEqual(p.cues, ['banner', 'title', 'now', 'banner', 'title', 'now']);
});

test('the server’s show wins over the demo; its pieces go when their time is up; Story OFF takes them all off the page', () => {
  const p = page('?demo=show');
  p.ui.update({ now: { word: 'BRIDGE 3/8', chip: 'type red', side: 'red', until: T0 + 6000 } }, { head: 'The Chief', story: true });
  p.at(4000);
  p.ui.frame(T0 + 4000, false);
  assert.deepEqual(p.up(), ['show-now'], 'the server’s NOW card, not the demo’s Call');
  assert.equal(p.ui.demoScene(T0 + 8000), undefined, 'and no demo scene');
  p.ui.frame(T0 + 6000, false);
  assert.deepEqual(p.up(), [], 'gone at its until');
  // A real scene stands the demo down too.
  const q = page('?demo=show');
  q.ui.update(undefined, { head: 'The Chief', scene: { id: 'opening', at: T0 } });
  q.at(4000);
  q.ui.frame(T0 + 4000, true);
  assert.deepEqual(q.up(), []);
  assert.equal(q.ui.demoScene(T0 + 8000), undefined);
  // Story OFF: no piece is ever made; and a page that had them loses them.
  const off = page('?stream=1', false);
  off.ui.update(undefined, { head: 'The Chief' });
  for (let t = 0; t < 20_000; t += 500) off.ui.frame(T0 + t, false);
  assert.deepEqual(off.body.children, [], 'nothing on a Story OFF page');
  off.body.classes.add('story');
  off.ui.update({ banner: { title: 'GATHER: THE UNVEILING', until: T0 + 30_000 } }, { head: 'The Chief', story: true });
  off.ui.frame(T0 + 1000, false);
  assert.deepEqual(off.up(), ['show-banner']);
  off.body.classes.delete('story');
  off.ui.update(undefined, { head: 'The Chief' });
  off.ui.frame(T0 + 1500, false);
  assert.deepEqual(off.body.children, [], 'Story OFF: the banner is off the page');
  assert.ok(!off.body.classes.has('show-call') && !off.root.style.props.has('--show-b'));
  // ?demo=board on a Story OFF town is in the story look too: a scene's lines stay up across snapshots.
  const board = page('?stream=1&demo=board');
  board.ui.update(undefined, { head: 'The Chief', scene: { id: 'opening', at: T0 } });
  board.ui.frame(T0 + 12_000, true, { who: 'Toma', text: 'Hello.', title: false, k: 0.5, key: 'hello' });
  board.ui.update(undefined, { head: 'The Chief', scene: { id: 'opening', at: T0 } });
  assert.deepEqual(board.up(), ['show-sub']);
  // A show that isn't one never throws.
  assert.doesNotThrow(() => off.ui.update({ banner: { title: 5 } } as unknown as ShowView, { head: 'The Chief', story: true }));
  assert.doesNotThrow(() => off.ui.frame(T0 + 2000, false));
});

test('a scene line in the story look: a long one shows in parts in the bar, a title line becomes the title card', () => {
  const p = page();
  p.ui.update(undefined, { head: 'The Chief', story: true });
  const say = (text: string, k: number, title = false): SceneSay => ({ who: 'Toma', text, title, k, key: 'farewell' });
  const farewell = "We'll tell every river about this town. Goodbye, and thank you.";
  p.ui.frame(T0, true, say(farewell, 0.2));
  const line = () => p.body.find('show-sub')!.children[1].textContent;
  assert.equal(line(), "We'll tell every river about this town.");
  assert.ok(p.body.find('show-sub')!.children[0].classes.has('cream'), 'the caravan’s leader in cream');
  p.ui.frame(T0 + 1, true, say(farewell, 0.8));
  assert.equal(line(), 'Goodbye, and thank you.');
  p.ui.frame(T0 + 2, true, say('The Bronze Age', 0.5, true));
  assert.deepEqual(p.up(), ['show-title']);
  assert.ok(p.body.find('show-title')!.classes.has('cream'));
  assert.deepEqual(p.cues, ['title']);
});

// --- the sheet and the wiring -----------------------------------------------------------------------

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

test('the sizes (design px at 1920×1080): title 140 caps with 10 px of ink, NOW 96 + 64, banner 72 + 54, subtitle 58 + 54 in the 7vh bar', () => {
  assert.equal(decl('#show-title', 'font'), '700 calc(140 * var(--px))/1.1 var(--font-display)');
  assert.equal(decl('#show-title', 'text-transform'), 'uppercase');
  // A 20 px stroke painted under the fill: the inner half is covered, 10 px of ink shows outside.
  assert.equal(decl('#show-title', '-webkit-text-stroke'), 'calc(20 * var(--px)) var(--ink)');
  assert.equal(decl('#show-title', 'paint-order'), 'stroke fill');
  assert.equal(decl('#show-title', 'color'), 'var(--gold)', 'gold is his');
  assert.equal(decl('#show-title.cream', 'color'), 'var(--cream)');
  assert.equal(decl('#show-now .word', 'font'), '700 calc(96 * var(--px))/1.05 var(--font-display)');
  assert.equal(decl('#show-now .chip', 'font'), '700 calc(64 * var(--px))/1 var(--font-display)');
  assert.equal(decl('#show-now', 'top'), 'calc(612 * var(--px))', 'centre-lower');
  assert.equal(decl('#show-banner .title', 'font'), '700 calc(72 * var(--px))/1.05 var(--font-display)');
  assert.equal(decl('#show-banner .premise', 'font'), '800 calc(54 * var(--px))/1.1 var(--font-text)');
  assert.equal(decl('#show-banner .clock', 'font'), '700 calc(64 * var(--px))/1 var(--font-display)');
  assert.equal(decl('#show-banner', 'width'), 'calc(1240 * var(--px))', 'the strip’s width, where the Board sits');
  assert.equal(decl('#show-banner', 'top'), decl('#board', 'top'));
  assert.equal(decl('#show-sub .line', 'font'), '800 calc(58 * var(--px))/1.2 var(--font-text)');
  assert.equal(decl('#show-sub .line', 'white-space'), 'nowrap', 'one line');
  assert.equal(decl('#show-sub .who', 'font'), '700 calc(54 * var(--px))/1 var(--font-display)');
  assert.equal(decl('#show-sub', 'height'), 'var(--letterbox)', 'inside the bottom bar');
  assert.equal(decl('#show-sub', 'bottom'), '0');
  assert.ok(Number(decl('#show-sub', 'z-index')) > Number(decl('body::before,body::after', 'z-index')), 'over the bar');
  // Every size in a show rule: nothing to read under 54 px, but the chip's icon.
  const sizes = RULES.filter((r) => /^#show-/.test(r.sel) && r.decls.font).map((r) => Number(/calc\((\d+) \* var\(--px\)\)/.exec(r.decls.font)?.[1]));
  assert.ok(sizes.length >= 7 && sizes.every((n) => n >= 54), String(sizes));
});

test('the HUD fades with the letterbox (0.9 s) in the story look; the Board steps aside; reduced motion: no fades or pops', () => {
  assert.equal(decl('body.story :is(header,#side,#corner,#feed,#caravan,#happening-wrap,#people,#fixture,#board)', 'transition-duration'), '.9s');
  assert.match(decl('body::before,body::after', 'transition') ?? '', /height \.9s/, 'the bars take 0.9 s');
  assert.equal(decl('#show-banner', 'transition'), 'opacity .9s,visibility 0s .9s');
  assert.equal(decl('body.cinema #show-banner', 'opacity'), '0', 'the strip holds nothing in a scene');
  assert.equal(decl('body:is(.show-call,.show-now) #board', 'opacity'), '0');
  assert.ok(RULES.some((r) => r.sel.startsWith(':is(#show-banner,#show-now,#show-title,#show-sub),') && r.decls.transition === 'none'));
  assert.ok(RULES.some((r) => r.sel === '#show-sub .line.in' && r.decls.animation === 'none'));
  assert.ok(!RULES.some((r) => /#show-/.test(r.sel) && /infinite/.test(r.decls.animation ?? '')), 'nothing animates at rest');
  // The troublemaker banner sits under whichever is lower, the Board or the GATHER banner.
  assert.equal(decl('body.show-call #happening-wrap', 'top'), 'calc(max(var(--board-b,0px),var(--show-b,0px)) + 12px)');
});

test('the wiring: the viewer page only; the server’s show each snapshot, the frame after cinema(), the lines in the story look', () => {
  assert.match(MAIN, /const showUi = !operatorMode && !playerMode \? createShow\(document, reduced\) : undefined;/);
  assert.match(MAIN, /showUi\?\.update\(next\.town\?\.show, next\.town\);/);
  const draw = MAIN.slice(MAIN.indexOf('function draw('));
  assert.ok(draw.indexOf('cinema(serverNow);') < draw.indexOf("showUi?.frame(serverNow, document.body.classList.contains('cinema'), sceneSays);"));
  assert.match(MAIN, /const sc = state\?\.town\?\.scene \?\? showUi\?\.demoScene\(serverNow\);/, 'a real scene first');
  assert.match(MAIN, /const story = !!showUi && document\.body\.classList\.contains\('story'\);/);
  assert.match(MAIN, /const today = story \? undefined : line;/, 'Story OFF: today’s #subtitle, as it was');
  assert.match(MAIN, /const strip = reserved\(boardUi\?\.rect\(\), showUi\?\.rect\(\)\);/, 'autoFrame keeps everyone under the banner too');
  assert.ok(!/id="show-/.test(HTML), 'no piece in the markup: Story OFF has none');
  assert.ok(HTML.includes('<div id="subtitle" hidden aria-live="polite"><b id="subtitle-who"></b><span id="subtitle-text"></span></div>'), 'today’s subtitle is as it was');
});
