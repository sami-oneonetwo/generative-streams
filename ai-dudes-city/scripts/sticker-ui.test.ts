// The Sticker Toy UI base (FK-009, board/design-system.md): the two self-hosted fonts are declared,
// shipped and copied by the build; the colour tokens are the locked story and cast colours; the
// story look (`body.story`) comes on with Story or a `?demo=` page, slims the letterbox to 7vh and
// hides the feed, the invite and the caravan panel on the stream, and Story OFF keeps today's page.
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';
import { STORY_FONTS, setStoryLook, storyLook } from '../client/dudes/sticker';
import { CAST, STORY } from '../design/story';

const HTML = readFileSync('client/dudes/index.html', 'utf8');
const CSS = HTML.slice(HTML.indexOf('<style>') + 7, HTML.indexOf('</style>')).replace(/\/\*[\s\S]*?\*\//g, '');
const FONTS = 'client/dudes/fonts';

/** Every innermost rule in the sheet (inside an @media too), as its selector and declarations. */
const RULES = [...CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, sel, body]) => ({
  sel: sel.trim(),
  decls: Object.fromEntries(
    body
      .split(';')
      .filter((d) => d.includes(':'))
      .map((d) => [d.slice(0, d.indexOf(':')).trim(), d.slice(d.indexOf(':') + 1).trim()]),
  ) as Record<string, string>,
}));
const rule = (sel: string) => RULES.filter((r) => r.sel === sel);
/** Every place a custom property is set, by name. */
const defs = (name: string) => RULES.filter((r) => name in r.decls).map((r) => ({ sel: r.sel, value: r.decls[name] }));
const token = (name: string) => {
  const d = defs(name);
  assert.equal(d.length, 1, `${name} is set once (${d.map((x) => x.sel).join(', ')})`);
  assert.equal(d[0].sel, ':root', `${name} lives on :root`);
  return d[0].value;
};

test('the story look: Story ON or any ?demo= page; a plain stream stays as it is', () => {
  const p = (q: string) => new URLSearchParams(q);
  assert.equal(storyLook(undefined, p('stream=1')), false, 'Story OFF');
  assert.equal(storyLook(undefined, p('')), false);
  assert.equal(storyLook(false, p('stream=1&stats=1&persp=1')), false, 'other story params alone do not switch the look');
  assert.equal(storyLook(true, p('stream=1')), true, 'Story ON');
  assert.equal(storyLook(undefined, p('stream=1&demo=board')), true, '?demo=board');
  assert.equal(storyLook(undefined, p('demo=show')), true, 'any demo, any page');
  assert.equal(storyLook(undefined, p('stream=1&demo=')), true, 'a ?demo= param is present');
});

test('setStoryLook toggles body.story and asks for the fonts once, the first time it goes on', async () => {
  const calls: [string, boolean][] = [];
  const loads: string[] = [];
  const page = {
    body: { classList: { toggle: (name: string, force: boolean) => (calls.push([name, force]), force) } },
    fonts: { load: (font: string) => (loads.push(font), font.includes('Nunito') ? Promise.reject(new Error('offline')) : Promise.resolve([])) },
  };
  setStoryLook(false, page);
  assert.deepEqual(loads, [], 'Story OFF loads nothing');
  setStoryLook(true, page);
  setStoryLook(true, page);
  setStoryLook(false, page);
  setStoryLook(true, page);
  assert.deepEqual(calls, [['story', false], ['story', true], ['story', true], ['story', false], ['story', true]]);
  assert.deepEqual(loads, [...STORY_FONTS], 'each face once, however often Story flips');
  await new Promise((r) => setImmediate(r)); // a failed load is swallowed: the page falls back, nothing throws
  // A page without the font loading API still gets the class.
  const bare = { body: { classList: { toggle: (_: string, force: boolean) => force } } };
  assert.doesNotThrow(() => setStoryLook(true, bare));
});

test('Fredoka 600/700 and Nunito 800 are self-hosted woff2 (latin and latin-ext), with their OFL texts', () => {
  const faces = RULES.filter((r) => r.sel === '@font-face').map((r) => r.decls);
  const seen = faces.map((f) => `${f['font-family']} ${f['font-weight']} ${/-(latin(?:-ext)?)\.woff2/.exec(f.src)?.[1]}`).sort();
  assert.deepEqual(seen, ['Fredoka 600 latin', 'Fredoka 600 latin-ext', 'Fredoka 700 latin', 'Fredoka 700 latin-ext', 'Nunito 800 latin', 'Nunito 800 latin-ext']);
  const shipped = new Set(readdirSync(FONTS).filter((f) => f.endsWith('.woff2')));
  for (const f of faces) {
    const url = /^url\(\/fonts\/([\w-]+\.woff2)\) format\('woff2'\)$/.exec(f.src);
    assert.ok(url, `served from /fonts as woff2: ${f.src}`);
    const file = readFileSync(`${FONTS}/${url[1]}`);
    assert.equal(file.subarray(0, 4).toString('latin1'), 'wOF2', `${url[1]} is a woff2`);
    shipped.delete(url[1]);
    assert.equal(f['font-display'], 'block', 'no fallback face flashes up on stream');
    assert.match(f['unicode-range'], /^U\+/, 'each cut loads only when its letters are on the page');
  }
  assert.deepEqual([...shipped], [], 'no font file ships without a face that uses it');
  for (const fam of ['Fredoka', 'Nunito']) assert.match(readFileSync(`${FONTS}/OFL-${fam}.txt`, 'utf8'), /SIL Open Font License, Version 1\.1/);
  // The build copies the folder next to the page, where /fonts/… finds it.
  assert.match(readFileSync('scripts/build-client.mjs', 'utf8'), /cpSync\('client\/dudes\/fonts', 'public\/fonts', \{ recursive: true \}\)/);
  assert.ok(existsSync(`${FONTS}/fredoka-700-latin.woff2`));
  // What the page asks for first is exactly what it declares.
  for (const want of STORY_FONTS) {
    const [, weight, family] = /^(\d+) \d+px (\w+)$/.exec(want)!;
    assert.ok(faces.some((f) => f['font-family'] === family && f['font-weight'] === weight), `${want} is declared`);
  }
  assert.match(token('--font-display'), /^Fredoka,/);
  assert.match(token('--font-text'), /^Nunito,/);
});

test('the colour tokens are the locked story and cast colours (design/story.ts)', () => {
  const hex = (v: string) => v.toUpperCase();
  assert.equal(hex(token('--red')), STORY.red);
  assert.equal(hex(token('--red-deep')), STORY.redDeep);
  assert.equal(hex(token('--gold')), STORY.gold);
  assert.equal(hex(token('--gold-deep')), STORY.goldDeep);
  assert.equal(hex(token('--ink')), STORY.ink);
  assert.equal(hex(token('--cream')), STORY.cream);
  assert.equal(hex(token('--dust')), '#8C8577');
  assert.equal(token('--wren'), 'var(--red)', 'Wren is RED');
  assert.equal(CAST.wren.colour, STORY.red);
  for (const who of ['ash', 'moss', 'oak', 'kit'] as const) assert.equal(hex(token(`--${who}`)), CAST[who].colour.toUpperCase(), who);
  // Today's light text colour kept its value under its own name, so --ink is free to be the ink.
  assert.equal(defs('--text')[0]?.value, '#e4e2cf');
});

test('pills and cards: the 6 px ink outline, the hard 8 px shadow, pill ends, 28 px card corners, the pop-in', () => {
  assert.equal(token('--px'), 'min(100vw / 1920,100vh / 1080)', 'design px at 1920x1080, scaled with the frame');
  assert.equal(token('--outline'), 'calc(6 * var(--px)) solid var(--ink)');
  assert.equal(token('--drop'), '0 calc(8 * var(--px)) 0 #0006');
  const both = rule('.pill,.card')[0]?.decls;
  assert.ok(both, 'one rule for both');
  assert.equal(both.border, 'var(--outline)');
  assert.equal(both['box-shadow'], 'var(--drop)');
  assert.match(both.font, /^800 calc\(54 \* var\(--px\)\)\/[\d.]+ var\(--font-text\)$/, 'Nunito 800, never under 54 px');
  assert.equal(rule('.pill')[0]?.decls['border-radius'], '999px', 'radius = height / 2');
  assert.equal(rule('.card')[0]?.decls['border-radius'], 'calc(28 * var(--px))');
  // Red takes cream text only; gold takes ink.
  assert.equal(rule(':is(.pill,.card).red')[0]?.decls.color, 'var(--cream)');
  assert.equal(rule(':is(.pill,.card).gold')[0]?.decls.color, 'var(--ink)');
  // 0.85 -> 1.06 -> 1 over 300 ms, and still under reduced motion.
  assert.match(rule('.pop-in')[0]?.decls.animation ?? '', /^sticker-in \.3s /);
  const frames = /@keyframes sticker-in\{([^]*?\})\}/.exec(CSS)?.[1] ?? '';
  assert.deepEqual([...frames.matchAll(/scale:([\d.]+)/g)].map((m) => Number(m[1])), [0.85, 1.06, 1]);
  assert.ok(RULES.some((r) => r.sel === '.pop-in' && r.decls.animation === 'none'), 'reduced motion: no pop');
});

test('the letterbox: 11vh as today, 7vh (76 px at 1080) in the story look, the subtitle riding on it', () => {
  assert.deepEqual(
    defs('--letterbox'),
    [
      { sel: ':root', value: '11vh' },
      { sel: 'body.story', value: '7vh' },
    ],
    'Story OFF: the bars are what they were; only the story look slims them',
  );
  assert.deepEqual(rule('body.story')[0]?.decls, { '--letterbox': '7vh' });
  assert.equal(Math.round((7 / 100) * 1080), 76);
  assert.equal(rule('body.cinema::before,body.cinema::after')[0]?.decls.height, 'var(--letterbox)');
  assert.equal(rule('#subtitle')[0]?.decls.bottom, 'calc(var(--letterbox) + 22px)', '22 px above the bar, either way');
  assert.ok(!/\b11vh\b/.test(CSS.replace('--letterbox:11vh', '')), 'no other rule still says 11vh');
});

test('Story OFF is today: the story look only adds, and only today’s three panels step aside on the stream', () => {
  const hide = RULES.filter((r) => r.decls.display === 'none!important' && /\.story\b/.test(r.sel));
  assert.deepEqual(hide.map((r) => r.sel), ['body.stream.story :is(#feed,.invite,#caravan)'], 'on the stream, in the story look');
  for (const r of RULES) if (/\.story\b/.test(r.sel)) assert.match(r.sel, /^body(\.stream)?\.story\b/, `${r.sel}: keyed off body.story`);
  // Today's rules never reach for the story's tokens, so they draw exactly as before. The Board's rules
  // (FK-010) and the show's (FK-021) may: board.ts and show.ts build #board and #show-* only while there
  // is a board or a show piece (Story ON, or a ?demo= page), and the markup has neither.
  const KIT = /^(:root|@font-face|body\.story|body\.stream\.story .*|\.pill.*|\.card|:is\(\.pill,\.card\)\..*|\.pop-in|body\.cinema::before,body\.cinema::after|#subtitle|(body\.cinema )?#board\b.*|(body\.cinema )?#show-\w+\b.*|:is\(#show-banner,#show-now,#show-sub\) .*)$/;
  assert.ok(!/id="board"/.test(HTML), 'no #board in the markup');
  assert.ok(!/id="show-/.test(HTML), 'no #show- piece in the markup');
  const STORY_VARS = /var\(--(?:red|red-deep|gold|gold-deep|ink|cream|dust|wren|moss|oak|kit|ash|font-display|font-text|px|outline|drop)\)/;
  for (const r of RULES) if (!KIT.test(r.sel)) assert.ok(!STORY_VARS.test(Object.values(r.decls).join(';')), `${r.sel} uses a story token`);
  // The /play gate card kept its look under its own class: `.card` is the sticker card now.
  assert.ok(rule('#pl-gate .gate').length === 1 && HTML.includes('<div id="pl-gate" hidden><div class="gate">'));
  assert.ok(!/class="card"/.test(HTML), 'no markup of today wears the sticker card by accident');
});
