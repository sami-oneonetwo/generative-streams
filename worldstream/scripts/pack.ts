// Asset pipeline: assets/worlds/<world>/{catalogue.json,palette.txt,font.txt,sprites/*.sprite,character/*.sprite}
//   -> dist/worlds/<world>/atlas.json  (what the server sends renderers)
//   -> dist/worlds/<world>/sheet.png   (contact sheet for eyeballing the art)
//
// Sprite files: header lines "key: value", a line "---", then frames separated
// by a line "--". Rows are palette keys; "N* row" repeats a row N times; short
// rows are padded with "." so ragged art is fine. Every pixel must be a palette
// key, which is what keeps the world on one palette.
//
//   npx tsx scripts/pack.ts [world]

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { Atlas, AtlasSprite, FontData, PixelFrame } from '../src/shared/atlas.js';
import type { Catalogue } from '../src/shared/catalogue.js';
import type { CharacterMode } from '../src/shared/state.js';
import type { ItemSlot, Wardrobe, WardrobeItem } from '../src/shared/wardrobe.js';
import { CLOTHING_COLOURS, ITEM_SLOTS } from '../src/shared/wardrobe.js';
import { encodePng } from './png.js';

const ROOT = process.cwd();
let world = 'cyberpunk';
let DIR = join(ROOT, 'assets/worlds', world);
let OUT = join(ROOT, 'dist/worlds', world);

class PackError extends Error {}
function fail(msg: string): never {
  throw new PackError(msg);
}

interface SpriteFile {
  meta: Record<string, string>;
  frames: PixelFrame[];
}

function parsePalette(text: string): Record<string, string> {
  const keys: Record<string, string> = { '.': '' };
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const [key, hex] = line.split(/\s+/);
    if (!key || key.length !== 1 || key === '#') fail(`palette: bad key in "${line}"`);
    if (key === '.') continue;
    if (!/^#[0-9a-fA-F]{6}$/.test(hex ?? '')) fail(`palette: bad colour for "${key}"`);
    keys[key] = hex.toLowerCase();
  }
  return keys;
}

function parseSpriteFile(text: string, file: string): SpriteFile {
  const lines = text.split('\n').map((l) => l.replace(/\s+$/, ''));
  const sep = lines.findIndex((l) => l === '---');
  if (sep < 0) fail(`${file}: missing "---" between header and pixels`);
  const meta: Record<string, string> = {};
  for (const l of lines.slice(0, sep)) {
    const t = l.trim();
    if (!t || t.startsWith('#')) continue;
    const m = /^([a-z_]+):\s*(.*)$/.exec(t);
    if (!m) fail(`${file}: bad header line "${t}"`);
    meta[m[1]] = m[2].trim();
  }
  const groups: string[][] = [[]];
  for (const l of lines.slice(sep + 1)) {
    if (l === '--') {
      groups.push([]);
      continue;
    }
    if (l === '' || l.startsWith('#')) continue;
    const rep = /^(\d+)\*\s?(.*)$/.exec(l);
    if (rep) for (let i = 0; i < Number(rep[1]); i++) groups[groups.length - 1].push(rep[2]);
    else groups[groups.length - 1].push(l);
  }
  const frames = groups.filter((g) => g.length > 0);
  if (frames.length === 0) fail(`${file}: no pixel rows`);
  const w = Math.max(...frames.flat().map((r) => r.length));
  const h = Math.max(...frames.map((f) => f.length));
  return {
    meta,
    frames: frames.map((rows) => {
      const out = rows.map((r) => r.padEnd(w, '.'));
      while (out.length < h) out.push('.'.repeat(w));
      return { w, h, rows: out };
    }),
  };
}

function validateFrames(frames: PixelFrame[], keys: Record<string, string>, file: string): void {
  for (const f of frames)
    for (const row of f.rows)
      for (const ch of row) if (!(ch in keys)) fail(`${file}: "${ch}" is not a palette key`);
}

function parseFont(text: string): FontData {
  const w = 5;
  const h = 7;
  const glyphs: Record<string, string[]> = {};
  let cur: string | null = null;
  for (const raw of text.split('\n')) {
    const l = raw.replace(/\s+$/, '');
    if (l.startsWith('=') && l.length >= 2) {
      cur = l[1];
      glyphs[cur] = [];
      continue;
    }
    if (!l || cur === null) continue;
    glyphs[cur].push(l);
  }
  for (const [ch, rows] of Object.entries(glyphs)) {
    if (rows.length !== h) fail(`font: glyph "${ch}" has ${rows.length} rows, want ${h}`);
    for (const r of rows) if (r.length !== w || /[^#.]/.test(r)) fail(`font: glyph "${ch}" has a bad row "${r}"`);
  }
  return { w, h, glyphs };
}

function hexToRgb(hex: string): [number, number, number] {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}

/** Contact sheet: every sprite frame, the character frames, then the font, scaled x4. */
function renderSheet(atlas: Atlas): Buffer {
  const S = 4;
  const GAP = 6;
  const MAXW = 300;
  const cells: { frame: PixelFrame; x: number; y: number }[] = [];
  let x = GAP;
  let y = GAP;
  let rowH = 0;
  const place = (frames: PixelFrame[]) => {
    const groupW = frames.reduce((a, f) => a + f.w + GAP, 0);
    if (x > GAP && x + groupW > MAXW) {
      x = GAP;
      y += rowH + GAP;
      rowH = 0;
    }
    for (const f of frames) {
      cells.push({ frame: f, x, y });
      x += f.w + GAP;
      rowH = Math.max(rowH, f.h);
    }
  };
  for (const s of atlas.sprites) if (s.frames) place(s.frames);
  x = GAP;
  y += rowH + GAP * 2;
  rowH = 0;
  for (const frames of Object.values(atlas.character)) if (frames) place(frames);
  x = GAP;
  y += rowH + GAP * 2;
  rowH = 0;
  for (const rows of Object.values(atlas.font.glyphs)) {
    if (x + atlas.font.w + 2 > MAXW) {
      x = GAP;
      y += atlas.font.h + 3;
    }
    cells.push({ frame: { w: atlas.font.w, h: atlas.font.h, rows: rows.map((r) => r.replace(/#/g, 'd')) }, x, y });
    x += atlas.font.w + 2;
    rowH = atlas.font.h;
  }
  const W = MAXW;
  const H = y + rowH + GAP;
  const rgba = new Uint8Array(W * S * H * S * 4);
  const bg = hexToRgb('#0b0a1e');
  for (let i = 0; i < W * S * H * S; i++) rgba.set([bg[0], bg[1], bg[2], 255], i * 4);
  const put = (px: number, py: number, hex: string) => {
    const [r, g, b] = hexToRgb(hex);
    for (let dy = 0; dy < S; dy++)
      for (let dx = 0; dx < S; dx++) {
        const i = ((py * S + dy) * W * S + px * S + dx) * 4;
        rgba[i] = r;
        rgba[i + 1] = g;
        rgba[i + 2] = b;
        rgba[i + 3] = 255;
      }
  };
  for (const c of cells)
    c.frame.rows.forEach((row, ry) => {
      for (let rx = 0; rx < row.length; rx++) {
        const hex = atlas.keys[row[rx]];
        if (hex) put(c.x + rx, c.y + ry, hex);
      }
    });
  return encodePng(W * S, H * S, rgba);
}

function main(): void {
  const catalogue = JSON.parse(readFileSync(join(DIR, 'catalogue.json'), 'utf8')) as Catalogue;
  const keys = parsePalette(readFileSync(join(DIR, 'palette.txt'), 'utf8'));
  const fontFile = existsSync(join(DIR, 'font.txt')) ? join(DIR, 'font.txt') : join(ROOT, 'assets/font.txt');
  const font = parseFont(readFileSync(fontFile, 'utf8'));
  const warnings: string[] = [];

  const byName = new Map<string, SpriteFile>();
  for (const sub of ['sprites', 'generated']) {
    const dir = join(DIR, sub);
    for (const f of existsSync(dir) ? readdirSync(dir).filter((n) => n.endsWith('.sprite')) : []) {
      const parsed = parseSpriteFile(readFileSync(join(dir, f), 'utf8'), `${sub}/${f}`);
      validateFrames(parsed.frames, keys, `${sub}/${f}`);
      byName.set(basename(f, '.sprite'), parsed);
    }
  }
  const generatedJson = join(DIR, 'generated.json');
  if (existsSync(generatedJson)) {
    for (const g of JSON.parse(readFileSync(generatedJson, 'utf8')) as Catalogue['sprites']) if (!catalogue.sprites.some((s) => s.name === g.name)) catalogue.sprites.push({ ...g, generated: true });
  }

  const sprites: AtlasSprite[] = catalogue.sprites.map((def) => {
    if (def.procedural) {
      if (byName.has(def.name)) warnings.push(`${def.name} is procedural, ignoring sprites/${def.name}.sprite`);
      return { ...def };
    }
    const sf = byName.get(def.name) ?? fail(`catalogue sprite "${def.name}" has no sprites/${def.name}.sprite`);
    const { w, h } = sf.frames[0];
    if (def.w !== w || def.h !== h) warnings.push(`${def.name}: catalogue says ${def.w}x${def.h}, sprite is ${w}x${h} (using the sprite)`);
    return { ...def, w, h, animated: sf.frames.length > 1 ? sf.frames.length : undefined, frames: sf.frames };
  });
  for (const name of byName.keys())
    if (!catalogue.sprites.some((s) => s.name === name)) warnings.push(`sprites/${name}.sprite is not in catalogue.json, skipped`);

  const character: Atlas['character'] = {};
  for (const mode of ['idle', 'walk', 'talk', 'travel'] as CharacterMode[]) {
    const own = join(DIR, 'character', `${mode}.sprite`);
    const f = existsSync(own) ? own : join(ROOT, 'assets/character', `${mode}.sprite`);
    if (!existsSync(f)) continue;
    const parsed = parseSpriteFile(readFileSync(f, 'utf8'), `character/${mode}.sprite`);
    validateFrames(parsed.frames, keys, `character/${mode}.sprite`);
    character[mode] = parsed.frames;
  }
  if (!character.idle) fail('character/idle.sprite is required');

  const atlas: Atlas = { ...catalogue, keys, sprites, font, character };
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, 'atlas.json'), JSON.stringify(atlas));
  writeFileSync(join(OUT, 'sheet.png'), renderSheet(atlas));

  const pixelSprites = sprites.filter((s) => s.frames).length;
  const frames = sprites.reduce((a, s) => a + (s.frames?.length ?? 0), 0);
  const charFrames = Object.values(character).reduce((a, f) => a + (f?.length ?? 0), 0);
  for (const w of warnings) console.log(`warn: ${w}`);
  console.log(
    `packed ${world}: ${pixelSprites} pixel sprites (${frames} frames), ${sprites.length - pixelSprites} procedural, character ${charFrames} frames, font ${Object.keys(font.glyphs).length} glyphs -> ${OUT}`,
  );
}

/** The character's wardrobe: assets/character/wardrobe/{palette.txt,*.sprite} -> dist/wardrobe.json. */
function packWardrobe(): void {
  const dir = join(ROOT, 'assets/character/wardrobe');
  if (!existsSync(join(dir, 'palette.txt'))) return;
  const keys = parsePalette(readFileSync(join(dir, 'palette.txt'), 'utf8'));
  keys.X = '';
  const items: WardrobeItem[] = [];
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.sprite')).sort()) {
    const file = `wardrobe/${f}`;
    const sf = parseSpriteFile(readFileSync(join(dir, f), 'utf8'), file);
    validateFrames(sf.frames, keys, file);
    const name = sf.meta.name || basename(f, '.sprite');
    const slot = sf.meta.slot as ItemSlot;
    if (!(ITEM_SLOTS as readonly string[]).includes(slot)) fail(`${file}: slot must be one of ${ITEM_SLOTS.join(', ')}`);
    const dx = Number(sf.meta.dx ?? 0);
    const dy = Number(sf.meta.dy ?? 0);
    if (!Number.isInteger(dx) || !Number.isInteger(dy)) fail(`${file}: dx and dy must be integers`);
    const tint = sf.meta.tint || undefined;
    if (tint && !CLOTHING_COLOURS[tint]) fail(`${file}: tint "${tint}" is not a clothing colour`);
    const hasX = sf.frames[0].rows.some((r) => r.includes('X'));
    if (hasX && !tint) fail(`${file}: uses the tint key X but names no default tint`);
    const list = (s: string | undefined) => (s ?? '').split(',').map((x) => x.trim()).filter(Boolean);
    items.push({ name, slot, aliases: list(sf.meta.aliases), tags: list(sf.meta.tags), frame: sf.frames[0], dx, dy, behind: /^(yes|true|1)$/i.test(sf.meta.behind ?? '') || undefined, tint });
  }
  const seen = new Set<string>();
  for (const i of items) {
    if (seen.has(i.name)) fail(`wardrobe: two items named ${i.name}`);
    seen.add(i.name);
  }
  const wardrobe: Wardrobe = { keys, items };
  mkdirSync(join(ROOT, 'dist'), { recursive: true });
  writeFileSync(join(ROOT, 'dist/wardrobe.json'), JSON.stringify(wardrobe));
  const bySlot = ITEM_SLOTS.map((s) => `${s} ${items.filter((i) => i.slot === s).length}`).join(', ');
  console.log(`packed wardrobe: ${items.length} items (${bySlot}) -> dist/wardrobe.json`);
}

const requested = process.argv[2];
const worlds = requested ? [requested] : readdirSync(join(ROOT, 'assets/worlds')).filter((d) => existsSync(join(ROOT, 'assets/worlds', d, 'catalogue.json')));
try {
  for (const w of worlds) {
    world = w;
    DIR = join(ROOT, 'assets/worlds', w);
    OUT = join(ROOT, 'dist/worlds', w);
    main();
  }
  if (!requested) packWardrobe();
} catch (err) {
  if (err instanceof PackError) {
    console.error(`pack: ${err.message}`);
    process.exit(1);
  }
  throw err;
}
