// The HUD sticker-kit mock (FK-005, design/hud): the page that ships is the up-to-date, self-contained
// build of its source; it draws to board/design-system.md's numbers (type sizes, letterbox, strip,
// side disc, the locked palette); scene frames keep to two text layers and one-line subtitles; and
// the colour claims it makes to Sami (contrast, greyscale) are true for the tokens it uses. The page's
// own hudAudit() checks the same size rules on the page as drawn (the verify shots run it).
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { HUD_DIR, build, inline } from '../design/hud/build';
import { HUD_RUBRIC } from '../design/story';

const src = readFileSync(path.join(HUD_DIR, 'fk-hud.src.html'), 'utf8');
const style = src.slice(src.indexOf('<style>') + 7, src.indexOf('</style>')).replace(/\/\*[\s\S]*?\*\//g, '');
const body = src.slice(src.indexOf('<main>'), src.indexOf('</main>'));
/** Every CSS rule as [selector, declarations]. */
const rules = [...style.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => [m[1].trim(), m[2]] as const).filter(([sel]) => !sel.startsWith('@'));
const rule = (selector: string) => {
  const found = rules.find(([sel]) => sel === selector);
  assert.ok(found, `no CSS rule for ${selector}`);
  return found[1];
};
/** The px font size a rule sets (from `font:` or `font-size:`). */
const fontPx = (decl: string) => {
  const m = /font-size:\s*([\d.]+)px/.exec(decl) ?? /font:[^;]*?\s([\d.]+)px(?:\/[\d.]+)?\s/.exec(decl);
  return m ? Number(m[1]) : undefined;
};
const tokens = Object.fromEntries([...style.matchAll(/--([\w-]+):(#[0-9A-Fa-f]{6,8})/g)].map((m) => [m[1], m[2]]));
const lum = (hex: string) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const contrast = (a: string, b: string) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
const lightness = (hex: string) => 116 * Math.cbrt(lum(hex)) - 16;

test('fk-hud.html is the build of fk-hud.src.html as it is now (run npx tsx design/hud/build.ts after an edit)', () => {
  assert.equal(readFileSync(path.join(HUD_DIR, 'fk-hud.html'), 'utf8'), build());
});

test('the built page is one self-contained file: it loads nothing else, so it can be copied to public/ alone', () => {
  const html = build();
  assert.doesNotMatch(html, /url\((?!data:)/, 'every url() is inlined');
  assert.doesNotMatch(html, /\b(?:src|href)="(?!#)/, 'no src or href to another file');
  assert.doesNotMatch(html, /https?:\/\/(?!www\.w3\.org)/, 'nothing from the network');
  // The inliner swaps local fonts and shots and leaves everything else alone.
  assert.equal(inline('a{background:url(#x)} b{src:url(data:font/woff2;base64,AA)}'), 'a{background:url(#x)} b{src:url(data:font/woff2;base64,AA)}');
  assert.match(inline("x{src:url('fonts/nunito-800-latin.woff2')}"), /^x\{src:url\(data:font\/woff2;base64,d09GMg/);
});

test('fonts: Fredoka 600 and 700 and Nunito 800, self-hosted woff2 with their OFL licences', () => {
  for (const [family, weight, file] of [['Fredoka', 600, 'fredoka-600-latin'], ['Fredoka', 700, 'fredoka-700-latin'], ['Nunito', 800, 'nunito-800-latin']] as const) {
    assert.ok(style.includes(`font-family:${family};font-weight:${weight};font-display:block;src:url(fonts/${file}.woff2)`), `${family} ${weight}`);
    assert.equal(readFileSync(path.join(HUD_DIR, 'fonts', `${file}.woff2`)).subarray(0, 4).toString('latin1'), 'wOF2', file);
  }
  for (const f of ['OFL-Fredoka.txt', 'OFL-Nunito.txt']) assert.match(readFileSync(path.join(HUD_DIR, 'fonts', f), 'utf8'), /SIL Open Font License, Version 1\.1/);
  // Every face the HUD names is one of the two (Trebuchet / Segoe only as fallbacks behind them).
  for (const [, decl] of rules) for (const m of decl.matchAll(/font:[^;]*?var\(--(\w+)\)/g)) assert.ok(['display', 'text'].includes(m[1]), m[0]);
});

test('the locked palette: the tokens are design-system §2, and the HUD paints with tokens only', () => {
  assert.deepEqual(
    { red: tokens.red, 'red-deep': tokens['red-deep'], gold: tokens.gold, 'gold-deep': tokens['gold-deep'], ink: tokens.ink, cream: tokens.cream, dust: tokens.dust },
    { red: '#B3262E', 'red-deep': '#7A1419', gold: '#FFC633', 'gold-deep': '#A86E00', ink: '#1E1914', cream: '#FFF6E0', dust: '#8C8577' },
  );
  assert.deepEqual([tokens.moss, tokens.oak, tokens.kit, tokens.ash], ['#4E8A3A', '#E8762B', '#2F6FD0', '#6E7680']);
  // Past the tokens and the page chrome, the only raw colour is the hard shadow.
  const hud = style.slice(style.indexOf('.pill{'));
  assert.deepEqual([...new Set(hud.match(/#[0-9A-Fa-f]{3,8}\b/g))], ['#0006']);
});

test("what the kit sheet tells Sami about colour is true: contrast pairs, and red and gold apart in greyscale", () => {
  assert.ok(Math.abs(contrast(tokens.cream, tokens.red) - 6.0) < 0.05, 'cream on red 6.0:1');
  assert.ok(Math.abs(contrast(tokens.ink, tokens.gold) - 11) < 0.2, 'ink on gold 11:1');
  assert.ok(Math.abs(contrast(tokens.red, tokens.ink) - 2.7) < 0.05, 'red on ink 2.7:1, never used for text');
  assert.equal(Math.round(lightness(tokens.red)), 40);
  assert.equal(Math.round(lightness(tokens.gold)), 83);
  // So no HUD rule ever sets red text on an ink panel.
  for (const [sel, decl] of rules) assert.ok(!(/color:var\(--red\)/.test(decl) && /background:var\(--ink/.test(decl)), sel);
});

test('type sizes are design-system §3: nothing to be read under 54 px but the 40 px chatter tags', () => {
  const sizes: Record<string, number> = {
    '.titlecard': 140,
    '.rate .n': 160,
    '.now .word': 96,
    '.chip.big': 64,
    '.gather h2': 72,
    '.gather p': 54,
    '.bar .lab': 64,
    '.bar .lab.long': 54,
    '.num': 64,
    '.chip': 54,
    '.ticker': 54,
    '.sub .line': 58,
    '.tag.cast,.tag.head': 54,
    '.tag.chatter': 40,
    '.wonder .lab': 64,
    '.plaque p': 54,
  };
  for (const [sel, px] of Object.entries(sizes)) assert.equal(fontPx(rule(sel)), px, sel);
  // And every other HUD rule that sets a size: 54 or more (the kit sheet's notes are annotations, not HUD).
  const hud = rules.slice(rules.findIndex(([sel]) => sel === '.pill'));
  for (const [sel, decl] of hud) {
    const px = fontPx(decl);
    if (px === undefined || sel === '.tag.chatter' || sel === '.kit .note') continue;
    assert.ok(px >= 54, `${sel} ${px}px`);
  }
});

test('shapes and layout: 6 px ink outline, hard shadow, radius-28 cards, the 1240 px strip, 76 px letterbox, the 1.3 m disc', () => {
  assert.match(style, /--line:6px solid var\(--ink\)/);
  assert.match(style, /--drop:0 8px 0 #0006/);
  assert.match(rule('.card'), /border-radius:28px/);
  assert.match(rule('.pill'), /border-radius:999px/);
  assert.match(rule('.strip'), /width:1240px/);
  assert.match(rule('.wonder'), /width:1240px;height:96px/);
  assert.match(rule('.bar'), /height:96px/);
  assert.match(rule('.lb::before,.lb::after'), /height:76px/);
  assert.match(rule('.sub'), /height:76px/);
  // The Board's and THE WONDER's words: cream with an ink keyline, so they read over any fill.
  assert.match(rule('.bar .lab,.wonder .lab .word'), /color:var\(--cream\);-webkit-text-stroke:16px var\(--ink\);paint-order:stroke fill;letter-spacing:\.025em/);
  assert.match(rule('.titlecard'), /-webkit-text-stroke:20px var\(--ink\);paint-order:stroke fill/);
  assert.match(rule('.disc'), /width:calc\(1\.3px \* var\(--m\)\)/);
  assert.match(rule('.disc'), /0 0 0 calc\(\.1px \* var\(--m\)\) var\(--cream\),0 0 0 calc\(\.15px \* var\(--m\)\) var\(--ink\)/);
  // Pop-in 0.85 -> 1.06 -> 1 over 300 ms; the ticker is the only thing that loops.
  assert.match(style, /@keyframes pop\{0%\{scale:\.85;opacity:0\}60%\{scale:1\.06;opacity:1\}100%\{scale:1\}\}/);
  assert.match(style, /\.pop\{animation:pop \.3s ease-out both\}/);
  assert.deepEqual([...style.matchAll(/animation:(\w+)[^;}]*infinite/g)].map((m) => m[1]), ['tick']);
});

test('every piece on the card is drawn, crown with gold and flag with red', () => {
  const pieces: Record<string, RegExp> = {
    'gold bar with the crown': /class="bar gold[^"]*"[^>]*>[\s\S]*?href="#crown"/,
    'red bar with the flag': /class="bar red[^"]*"[^>]*>[\s\S]*?href="#flag"/,
    'tug line with its knot': /class="rope"><span class="cord"><i><\/i><\/span><i class="mid"><\/i><i class="knot"/,
    ticker: /class="ticker ink pill/,
    'GATHER banner': /class="gather card ink[\s\S]*?GATHER: THE UNVEILING/,
    'NOW card': /class="now card ink[\s\S]*?class="word"/,
    'title card': /class="titlecard/,
    subtitle: /class="sub"/,
    'cast tag': /class="tag cast wren/,
    'head tag': /class="tag head"/,
    'chatter tags': /class="tag chatter sided/,
    'side discs': /class="disc gold"[\s\S]*class="disc red"|class="disc red"[\s\S]*class="disc gold"/,
    'RATE IT tile': /class="rate card[\s\S]*?RATE IT/,
    'rally pips': /class="pips ink pill/,
    'ON STREAM chip': /class="chip dust pill">[\s\S]*?ON STREAM/,
    'plaque card': /class="plaque card/,
    'home through the ages': /class="home card ink[\s\S]*?class="ages"/,
    'THE WONDER': /class="wonder pill[\s\S]*?THE WONDER/,
  };
  for (const [name, re] of Object.entries(pieces)) assert.match(body, re, name);
  // Side marks: a gold chatter badge holds the crown, a red one the flag; never the other way round.
  assert.doesNotMatch(body, /class="badge gold"><svg><use href="#flag/);
  assert.doesNotMatch(body, /class="badge red"><svg><use href="#crown/);
});

test('scene frames: letterboxed, two text layers at most, subtitles one line of 42 characters or fewer', () => {
  const frames = [...body.matchAll(/<section id="(\w+)"[\s\S]*?<\/section>/g)];
  assert.deepEqual(frames.map((f) => f[1]), ['free', 'call', 'reveal', 'plaque', 'rally', 'now', 'wonder', 'home', 'kit']);
  const scenes = frames.filter((f) => /data-scene="1"/.test(f[0]));
  assert.deepEqual(scenes.map((f) => f[1]), ['reveal', 'plaque', 'rally']);
  for (const [frame, id] of scenes) {
    assert.match(frame, /class="frame lb"/, id);
    assert.ok((frame.match(/data-layer/g) ?? []).length <= 2, id);
    assert.doesNotMatch(frame, /class="(strip|tag )/, `${id}: no Board and no tags in a scene`);
  }
  for (const m of body.matchAll(/<span class="line">([^<]*)<\/span><\/div>/g)) assert.ok(m[1].length <= 42, m[1]);
});

test('the town shots are real 1920-wide frames in WebP, and the page fits a phone', () => {
  for (const f of ['town-band.webp', 'town-bridge.webp', 'town-lots.webp']) {
    const buf = readFileSync(path.join(HUD_DIR, f));
    assert.equal(buf.subarray(0, 4).toString('latin1') + buf.subarray(8, 12).toString('latin1'), 'RIFFWEBP', f);
    // Chrome writes the extended header: the canvas size, less one, in two 24-bit fields.
    assert.equal(buf.subarray(12, 16).toString('latin1'), 'VP8X', f);
    assert.deepEqual([1 + buf.readUIntLE(24, 3), 1 + buf.readUIntLE(27, 3)], [1920, 1080], f);
  }
  assert.ok(existsSync(path.join(HUD_DIR, 'town-shot.js')), 'how the shots were taken');
  assert.match(src, /<meta name="viewport" content="width=device-width,initial-scale=1">/);
  assert.ok(Buffer.byteLength(build()) < 600 * 1024, 'small enough to open on a phone over the tunnel');
});

test('critique-image --hud judges a HUD mock on the HUD rubric', () => {
  for (const want of [/390 px/, /54 px/, /two text layers/, /crown = gold and flag = red/, /Fredoka/, /#B3262E/, /#FFC633/]) assert.match(HUD_RUBRIC, want);
  const astra = readFileSync('design/astra.ts', 'utf8');
  assert.match(astra, /hud: 'hud' in flags/);
  assert.match(astra, /o\.hud\s*\? `You are the art director of AI DUDES reviewing a HUD mock\. \$\{STORY_TEXT\}\\n\$\{HUD_RUBRIC\}/);
});
