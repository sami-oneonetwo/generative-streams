import { FONT_ADVANCE, isAtlas, textSpriteWidth, type Atlas, type AtlasSprite, type FontData, type PixelFrame } from '../shared/atlas.js';
import type { Catalogue, SpriteDef } from '../shared/catalogue.js';
import { characterKeys, DRESS_PAD, itemKeys, type Outfit, type Wardrobe } from '../shared/wardrobe.js';
import { PARALLAX, VIEW, type CharacterMode, type CharacterState, type Entity, type Layer, type Weather, type World, type WorldState } from '../shared/state.js';

// ---------------------------------------------------------------------------
// Renderer: 480x270 internal canvas, nearest-neighbour scaled to the screen.
// Draws from the packed atlas of whichever world the state is in (pixel
// sprites, bitmap font, character frames) over a procedural, themed backdrop.
// Falls back to coloured placeholders when a world has no packed atlas.
// ---------------------------------------------------------------------------

type Canvas = HTMLCanvasElement;

function makeCanvas(w: number, h: number): Canvas {
  const c = document.createElement('canvas');
  c.width = Math.max(1, w);
  c.height = Math.max(1, h);
  return c;
}

function hexToRgb(hex: string): [number, number, number] {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}

function rasterise(frame: PixelFrame, keys: Record<string, string>): Canvas {
  const c = makeCanvas(frame.w, frame.h);
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(frame.w, frame.h);
  for (let y = 0; y < frame.h; y++) {
    const row = frame.rows[y];
    for (let x = 0; x < frame.w; x++) {
      const hex = keys[row[x]];
      if (!hex) continue;
      const [r, g, b] = hexToRgb(hex);
      const i = (y * frame.w + x) * 4;
      img.data[i] = r;
      img.data[i + 1] = g;
      img.data[i + 2] = b;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

function flipH(src: Canvas): Canvas {
  const c = makeCanvas(src.width, src.height);
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  ctx.translate(src.width, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(src, 0, 0);
  return c;
}

/** World x of an entity, following scripted motion when it has any. */
function entityX(e: Entity, now: number): number {
  if (!e.motion) return e.x;
  const { fromX, toX, startAt, endAt } = e.motion;
  const u = Math.max(0, Math.min(1, (now - startAt) / Math.max(1, endAt - startAt)));
  return Math.round(fromX + (toX - fromX) * u);
}

function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// -- bitmap font --------------------------------------------------------------

class PixelFont {
  private readonly glyphCache = new Map<string, Canvas>();
  private readonly textCache = new Map<string, Canvas>();

  constructor(readonly data: FontData) {}

  chars(text: string): string[] {
    return [...text.toUpperCase()];
  }

  measure(text: string): number {
    const n = this.chars(text).length;
    return n === 0 ? 0 : n * FONT_ADVANCE - 1;
  }

  private glyph(ch: string, colour: string): Canvas | null {
    const rows = this.data.glyphs[ch] ?? this.data.glyphs['?'];
    if (!rows) return null;
    const key = ch + colour;
    let c = this.glyphCache.get(key);
    if (c) return c;
    c = makeCanvas(this.data.w, this.data.h);
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = colour;
    rows.forEach((r, y) => {
      for (let x = 0; x < r.length; x++) if (r[x] === '#') ctx.fillRect(x, y, 1, 1);
    });
    this.glyphCache.set(key, c);
    return c;
  }

  draw(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, colour: string): void {
    let cx = x;
    for (const ch of this.chars(text)) {
      if (ch !== ' ') {
        const g = this.glyph(ch, colour);
        if (g) ctx.drawImage(g, cx, y);
      }
      cx += FONT_ADVANCE;
    }
  }

  /** Text with a 1px glow, pre-rendered and cached. The canvas is 1px larger on every side. */
  glow(text: string, colour: string, core: string): Canvas {
    const key = `${text}|${colour}|${core}`;
    let c = this.textCache.get(key);
    if (c) return c;
    if (this.textCache.size > 400) this.textCache.clear();
    c = makeCanvas(this.measure(text) + 2, this.data.h + 2);
    const ctx = c.getContext('2d')!;
    ctx.globalAlpha = 0.4;
    for (const [dx, dy] of [[0, 1], [2, 1], [1, 0], [1, 2]] as const) this.draw(ctx, text, dx, dy, colour);
    ctx.globalAlpha = 1;
    this.draw(ctx, text, 1, 1, colour);
    ctx.globalAlpha = 0.55;
    this.draw(ctx, text, 1, 1, core);
    this.textCache.set(key, c);
    return c;
  }

  wrap(text: string, maxChars: number, maxLines: number): string[] {
    const words = text.split(/\s+/).filter(Boolean);
    const lines: string[] = [];
    let cur = '';
    for (const w of words) {
      const next = cur ? `${cur} ${w}` : w;
      if (this.chars(next).length <= maxChars || !cur) cur = next;
      else {
        lines.push(cur);
        cur = w;
      }
    }
    if (cur) lines.push(cur);
    if (lines.length > maxLines) {
      const kept = lines.slice(0, maxLines);
      kept[maxLines - 1] = kept[maxLines - 1].slice(0, Math.max(0, maxChars - 3)) + '...';
      return kept;
    }
    return lines;
  }
}

// -- themes -------------------------------------------------------------------

type SkyKey = 'night' | 'dusk' | 'dawn' | 'day';

interface Theme {
  kind: 'city' | 'dunes' | 'castle';
  sky: Record<SkyKey, string[]>;
  ground: string;
  groundLine: string;
  groundDash: string;
  haze: string[];
  /** Falling weather: cold rain or blown sand. */
  precip: 'rain' | 'sand';
  layers: { far: string[]; mid: string[]; near: string[] };
  sun: boolean;
  /** Flat-topped rock on the horizon (desert); off for soft hills. */
  mesas?: boolean;
}

const NIGHT_CITY_SKY: Record<SkyKey, string[]> = {
  night: ['#07061a', '#0b0a1e', '#141238', '#1c1b4a', '#26205e'],
  dusk: ['#12082b', '#2a1247', '#5a1f5a', '#8f2f5a', '#c4534a'],
  dawn: ['#0f1a38', '#22335f', '#4a5288', '#8a6f92', '#c98a6a'],
  day: ['#2c4a7a', '#3f6ba0', '#5a8cc0', '#7fb0dc', '#a3cbe8'],
};

const OPEN_SKY: Record<SkyKey, string[]> = {
  night: ['#0b0620', '#1a0f2e', '#2a1a4a', '#3b2d6a', '#4a3a7a'],
  dusk: ['#2a1040', '#6b2a5a', '#c0392b', '#ff9f43', '#ffb347'],
  dawn: ['#2a1a4a', '#5d3f7a', '#c47a5a', '#ffb347', '#f2d5a0'],
  day: ['#3a8fd1', '#6fb1e6', '#8fc4ee', '#b5d9f5', '#e8e0c8'],
};

const THEMES: Record<World, Theme> = {
  cyberpunk: {
    kind: 'city',
    sky: NIGHT_CITY_SKY,
    ground: '#0a0916',
    groundLine: '#1e1c3a',
    groundDash: '#141230',
    haze: ['#26205e', '#3b2d7a', '#5a3fa0'],
    precip: 'rain',
    layers: { far: ['#141238', '#1a1745', '#1c1b4a'], mid: ['#1a1a2e', '#20203a', '#26205e'], near: ['#0f0f1c', '#141426', '#1a1a2e'] },
    sun: false,
  },
  desert: {
    kind: 'dunes',
    sky: OPEN_SKY,
    ground: '#b3703b',
    groundLine: '#f2d5a0',
    groundDash: '#a3653a',
    haze: ['#c47a5a', '#ff9f43', '#ffb347'],
    precip: 'sand',
    layers: { far: ['#7a4a2a', '#a34b2a', '#8a4a30'], mid: ['#b3703b', '#c08048', '#a86a38'], near: ['#d9a86c', '#e0b070', '#d4a060'] },
    sun: true,
    mesas: true,
  },
  countryside: {
    kind: 'dunes',
    sky: OPEN_SKY,
    ground: '#3f7d3a',
    groundLine: '#8fd14f',
    groundDash: '#2f6b2a',
    haze: ['#4a6a8a', '#6a8aa8', '#b8d97a'],
    precip: 'rain',
    layers: { far: ['#3a5a7a', '#46688a', '#2f4f6a'], mid: ['#2f6b2a', '#357a30', '#2a5f26'], near: ['#4f9a3a', '#5aa844', '#468c34'] },
    sun: true,
  },
  castle: {
    kind: 'castle',
    sky: NIGHT_CITY_SKY,
    ground: '#3a3646',
    groundLine: '#8c889a',
    groundDash: '#2e2a38',
    haze: ['#2e2a38', '#4a4658', '#6e6a7c'],
    precip: 'rain',
    layers: { far: ['#1a1420', '#241e2c', '#2e2a38'], mid: ['#4a4658', '#3e3a4a', '#544e62'], near: ['#2e2a38', '#3a3646', '#4a4658'] },
    sun: true,
  },
};

function skyKey(time: number): SkyKey {
  if (time >= 21 || time < 5) return 'night';
  if (time < 8) return 'dawn';
  if (time < 17) return 'day';
  return 'dusk';
}

const MOON = [
  '...ddddd...',
  '.ddddddddd.',
  '.ddcdddddd.',
  'ddddddddddd',
  'dddddcdddcd',
  'ddddddddddd',
  'dddcddddddd',
  'ddddddcdddd',
  '.ddddddddd.',
  '.ddddddddd.',
  '...ddddd...',
];

// -- procedural backdrop ------------------------------------------------------

interface Building {
  x: number;
  w: number;
  h: number;
  colour: string;
  windows: Array<[number, number, number, string]>; // x, y, phase, colour
  antenna: boolean;
  tank: boolean;
  shop?: { x: number; w: number; colour: string };
  castle?: boolean;
}

interface Dune {
  /** Height above the layer baseline for every world x (wraps). */
  heights: number[];
  colour: string;
  marks: Array<[number, number, string]>; // x, extra height, colour
}

interface Backdrop {
  far: Building[];
  mid: Building[];
  near: Building[];
  dunes?: { far: Dune; mid: Dune; near: Dune; mesas: Building[] };
  stars: Array<[number, number, number]>;
  rail?: { y: number };
}

const BASELINE = { far: 192, mid: 206, near: VIEW.groundY } as const;

function makeDune(rnd: () => number, base: number, amp: number, colour: string, markColours: string[], markDensity: number): Dune {
  const heights: number[] = [];
  const p1 = rnd() * Math.PI * 2;
  const p2 = rnd() * Math.PI * 2;
  const f1 = 1 + Math.floor(rnd() * 2);
  const f2 = 3 + Math.floor(rnd() * 3);
  for (let x = 0; x < VIEW.worldW; x++) {
    const u = (x / VIEW.worldW) * Math.PI * 2;
    heights.push(Math.round(base + amp * (0.6 * Math.sin(u * f1 + p1) + 0.4 * Math.sin(u * f2 + p2))));
  }
  const marks: Dune['marks'] = [];
  for (let x = 0; x < VIEW.worldW; x += 6) if (rnd() < markDensity) marks.push([x, Math.floor(rnd() * 3), markColours[Math.floor(rnd() * markColours.length)]]);
  return { heights, colour, marks };
}

function makeBackdrop(world: string): Backdrop {
  const rnd = mulberry32(hashStr(world));
  const theme = THEMES[world as World] ?? THEMES.cyberpunk;
  const windowColours = ['#ffe066', '#00e5ff', '#ff5fa2', '#c9c9e8', '#ff8a3d'];
  const gen = (wMin: number, wMax: number, hMin: number, hMax: number, colours: string[], density: number, shops: boolean): Building[] => {
    const out: Building[] = [];
    let x = -20;
    while (x < VIEW.worldW + 40) {
      const w = Math.round(wMin + rnd() * (wMax - wMin));
      const h = Math.round(hMin + rnd() * (hMax - hMin));
      const colour = colours[Math.floor(rnd() * colours.length)];
      const windows: Building['windows'] = [];
      for (let wy = 4; wy < h - 6; wy += 5)
        for (let wx = 3; wx < w - 3; wx += 4)
          if (rnd() < density) windows.push([wx, wy, Math.floor(rnd() * 97), windowColours[Math.floor(rnd() * windowColours.length)]]);
      const b: Building = { x, w, h, colour, windows, antenna: rnd() < 0.25, tank: rnd() < 0.3 };
      if (shops && w >= 40 && rnd() < 0.5) {
        const sw = 10 + Math.floor(rnd() * Math.min(20, w - 16));
        b.shop = { x: 3 + Math.floor(rnd() * (w - sw - 6)), w: sw, colour: windowColours[Math.floor(rnd() * windowColours.length)] };
      }
      out.push(b);
      x += w + Math.round(rnd() * 6) - 2;
    }
    return out;
  };
  const stars: Backdrop['stars'] = [];
  for (let i = 0; i < 70; i++) stars.push([Math.floor(rnd() * VIEW.worldW), Math.floor(rnd() * 110), Math.floor(rnd() * 50)]);

  if (theme.kind === 'castle') {
    const walls = (wMin: number, wMax: number, hMin: number, hMax: number, colours: string[]): Building[] => {
      const out: Building[] = [];
      let x = -20;
      while (x < VIEW.worldW + 40) {
        const tower = rnd() < 0.35;
        const w = tower ? 10 + Math.round(rnd() * 8) : Math.round(wMin + rnd() * (wMax - wMin));
        const h = tower ? Math.round(hMax * (0.9 + rnd() * 0.5)) : Math.round(hMin + rnd() * (hMax - hMin));
        const windows: Building['windows'] = [];
        for (let wy = 8; wy < h - 8; wy += 9) for (let wx = 3; wx < w - 2; wx += 6) if (rnd() < 0.35) windows.push([wx, wy, Math.floor(rnd() * 97), rnd() < 0.7 ? '#ffb347' : '#ff8a3d']);
        out.push({ x, w, h, colour: colours[Math.floor(rnd() * colours.length)], windows, antenna: false, tank: false, castle: true });
        x += w + (tower ? 0 : Math.round(rnd() * 3));
      }
      return out;
    };
    return {
      far: [],
      mid: walls(40, 90, 50, 80, theme.layers.mid),
      near: walls(50, 110, 40, 60, theme.layers.near),
      dunes: { far: makeDune(rnd, 40, 26, theme.layers.far[0], [theme.layers.far[2]], 0.02), mid: makeDune(rnd, 0, 0, 'transparent', [], 0), near: makeDune(rnd, 0, 0, 'transparent', [], 0), mesas: [] },
      stars,
    };
  }
  if (theme.kind === 'dunes') {
    const mesas: Building[] = [];
    let mx = theme.mesas ? -40 : Infinity;
    while (mx < VIEW.worldW + 40) {
      const w = 30 + Math.round(rnd() * 70);
      if (rnd() < 0.55) mesas.push({ x: mx, w, h: 14 + Math.round(rnd() * 26), colour: theme.layers.far[Math.floor(rnd() * 3)], windows: [], antenna: false, tank: false });
      mx += w + 20 + Math.round(rnd() * 80);
    }
    return {
      far: [],
      mid: [],
      near: [],
      dunes: {
        far: makeDune(rnd, theme.mesas ? 26 : 44, theme.mesas ? 12 : 22, theme.layers.far[0], [theme.layers.far[2]], 0.05),
        mid: makeDune(rnd, 24, 14, theme.layers.mid[0], ['#3f7d3a', '#2c5a2a', theme.layers.mid[2]], 0.12),
        near: makeDune(rnd, 18, 12, theme.layers.near[0], ['#3f7d3a', '#a34b2a', theme.layers.near[2]], 0.16),
        mesas,
      },
      stars,
    };
  }
  return {
    far: gen(10, 34, 40, 120, theme.layers.far, 0.12, false),
    mid: gen(18, 56, 60, 140, theme.layers.mid, 0.28, false),
    near: gen(36, 90, 60, 104, theme.layers.near, 0.2, true),
    stars,
    rail: world === 'cyberpunk' ? { y: 150 } : undefined,
  };
}

function makeHaze(colours: string[]): Canvas {
  // Dithered glow above the horizon.
  const c = makeCanvas(VIEW.w, 40);
  const ctx = c.getContext('2d')!;
  for (let y = 0; y < 40; y++) {
    const density = y / 40;
    for (let x = 0; x < VIEW.w; x++) {
      const dither = ((x * 7 + y * 13) % 17) / 17;
      if (dither < density * 0.3) {
        ctx.fillStyle = colours[(x + y) % colours.length];
        ctx.fillRect(x, y, 1, 1);
      }
    }
  }
  return c;
}

// -- renderer -----------------------------------------------------------------

export interface RendererOptions {
  hud?: boolean;
}

const NEON = ['#ff2bd6', '#00e5ff', '#ffb347', '#7cff4f', '#ff5fa2'];
const SPRAY = ['#7cff4f', '#ff5fa2', '#00e5ff', '#ffe066'];
const FADE_IN_MS = 1500;

export class Renderer {
  private readonly buf: Canvas;
  private readonly g: CanvasRenderingContext2D;
  private readonly out: CanvasRenderingContext2D;
  private backdrop: Backdrop;
  private haze: Canvas;
  private theme: Theme = THEMES.cyberpunk;
  private world: World | null = null;
  private worlds: Partial<Record<World, Catalogue | Atlas>> = {};
  private fadeInStart: number | null = null;
  private sprites = new Map<string, AtlasSprite | SpriteDef>();
  private readonly frames = new Map<string, Canvas[]>();
  private readonly flipped = new Map<string, Canvas[]>();
  /** Dressed character frames for the current outfit (composed from the base frames plus wardrobe items). */
  private character: Partial<Record<CharacterMode, { r: Canvas[]; l: Canvas[] }>> = {};
  private baseCharacter: Partial<Record<CharacterMode, PixelFrame[]>> = {};
  private baseKeys: Record<string, string> = {};
  private wardrobe: Wardrobe | null = null;
  private dressedSig: string | null = null;
  /** Where the base frame sits inside a dressed frame. */
  private charPad = { x: 0, top: 0 };
  private font: PixelFont | null = null;
  private characterName = '';
  private displayX: number | null = null;
  private lastT = 0;
  private now = 0;
  /** Set by main when the audio context is waiting for a user gesture. */
  soundHint = false;
  /** Draw the need meters; off by default, the body still shows through asks and collapses. */
  showMeters = false;

  constructor(private readonly screen: Canvas, private readonly opts: RendererOptions = {}) {
    this.buf = makeCanvas(VIEW.w, VIEW.h);
    this.g = this.buf.getContext('2d')!;
    this.out = screen.getContext('2d')!;
    this.backdrop = makeBackdrop('cyberpunk');
    this.haze = makeHaze(THEMES.cyberpunk.haze);
  }

  setWorlds(worlds: Partial<Record<World, Catalogue | Atlas>>, characterName: string): void {
    this.worlds = worlds;
    this.characterName = characterName;
    this.world = null; // forces a reload on the next frame
  }

  /** Load one world's art. Called when the state's world differs from what is loaded. */
  private useWorld(world: World): void {
    const cat = this.worlds[world];
    if (!cat) return;
    const arriving = this.world !== null;
    this.world = world;
    this.theme = THEMES[world] ?? THEMES.cyberpunk;
    this.haze = makeHaze(this.theme.haze);
    if (arriving) this.fadeInStart = this.lastT;
    this.backdrop = makeBackdrop(cat.world);
    this.sprites = new Map(cat.sprites.map((s) => [s.name, s]));
    this.frames.clear();
    this.flipped.clear();
    this.character = {};
    this.baseCharacter = {};
    this.dressedSig = null;
    this.font = null;
    if (!isAtlas(cat)) return;
    this.font = new PixelFont(cat.font);
    for (const s of cat.sprites) if (s.frames) this.frames.set(s.name, s.frames.map((f) => rasterise(f, cat.keys)));
    this.baseCharacter = cat.character;
    this.baseKeys = cat.keys;
  }

  setWardrobe(w: Wardrobe): void {
    this.wardrobe = w;
    this.dressedSig = null;
  }

  /** Rebuild the character frames when the outfit changes: recolour garments by key, then layer accessories. */
  private ensureDressed(outfit: Outfit | undefined): void {
    const sig = JSON.stringify(outfit ?? null);
    if (sig === this.dressedSig) return;
    this.dressedSig = sig;
    this.character = {};
    const base = this.baseCharacter.idle;
    if (!base) return;
    const keys = characterKeys(this.baseKeys, outfit);
    const items = (['back', 'head', 'face', 'hand'] as const)
      .map((slot) => {
        const worn = outfit?.items?.[slot];
        const def = worn && this.wardrobe?.items.find((i) => i.name === worn.name);
        return def ? { def, canvas: rasterise(def.frame, itemKeys(this.wardrobe!, def, worn.colour)) } : null;
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);
    const pad = items.length ? DRESS_PAD : { x: 0, top: 0 };
    this.charPad = pad;
    for (const [mode, frames] of Object.entries(this.baseCharacter) as Array<[CharacterMode, PixelFrame[] | undefined]>) {
      if (!frames) continue;
      const r = frames.map((f) => {
        const c = makeCanvas(f.w + pad.x * 2, f.h + pad.top);
        const g = c.getContext('2d')!;
        g.imageSmoothingEnabled = false;
        for (const it of items) if (it.def.behind) g.drawImage(it.canvas, pad.x + it.def.dx, pad.top + it.def.dy);
        g.drawImage(rasterise(f, keys), pad.x, pad.top);
        for (const it of items) if (!it.def.behind) g.drawImage(it.canvas, pad.x + it.def.dx, pad.top + it.def.dy);
        return c;
      });
      this.character[mode] = { r, l: r.map(flipH) };
    }
  }

  /** A sprite drawn during the session: remember it for its world and start drawing it if we are there. */
  addSprite(world: World, sprite: AtlasSprite): void {
    const cat = this.worlds[world];
    if (!cat) return;
    const i = cat.sprites.findIndex((s) => s.name === sprite.name);
    if (i >= 0) cat.sprites[i] = sprite;
    else cat.sprites.push(sprite);
    if (this.world === world && isAtlas(cat)) {
      this.sprites.set(sprite.name, sprite);
      if (sprite.frames) this.frames.set(sprite.name, sprite.frames.map((f) => rasterise(f, cat.keys)));
      this.flipped.delete(sprite.name);
    }
  }

  removeSprite(world: World, name: string): void {
    const cat = this.worlds[world];
    if (cat) cat.sprites = cat.sprites.filter((s) => s.name !== name);
    if (this.world === world) {
      this.sprites.delete(name);
      this.frames.delete(name);
      this.flipped.delete(name);
    }
  }

  render(state: WorldState | null, t: number, connected: boolean, now: number = Date.now()): void {
    const g = this.g;
    const dt = this.lastT ? Math.min(0.1, (t - this.lastT) / 1000) : 0;
    this.lastT = t;
    this.now = now;
    g.imageSmoothingEnabled = false;
    g.clearRect(0, 0, VIEW.w, VIEW.h);

    if (!state) {
      g.fillStyle = '#0b0a1e';
      g.fillRect(0, 0, VIEW.w, VIEW.h);
      this.text(connected ? 'WAITING FOR WORLD...' : 'CONNECTING...', 8, VIEW.h - 12, '#6e6e96');
      this.blit();
      return;
    }

    if (this.world !== state.world) this.useWorld(state.world);
    const cam = state.camera.x;
    const key = skyKey(state.time);
    const windowAlpha = key === 'day' ? 0.35 : key === 'night' ? 1 : 0.7;
    this.drawSky(state.time, cam, t);
    this.drawLayer('far', cam, t, windowAlpha);
    this.drawEntities(state, 'far', cam, t);
    this.drawLayer('mid', cam, t, windowAlpha);
    this.drawEntities(state, 'mid', cam, t);
    this.drawLayer('near', cam, t, windowAlpha);
    this.drawRail(cam * PARALLAX.near);
    this.drawEntities(state, 'near', cam, t);
    this.drawGround(state, cam, t);
    this.drawEntities(state, 'stage', cam, t);
    this.drawCharacter(state.character, cam, t, dt);
    this.drawEntities(state, 'fg', cam, t);
    this.drawTint(key);
    this.drawWeather(state.weather, t);
    this.drawEntitySpeech(state, cam);
    this.drawBubble(state.character, cam);
    this.drawVote(state);
    this.drawAsk(state);
    this.drawHint(state);
    this.drawBag(state);
    this.drawVitals(state);
    if (this.soundHint && this.font) {
      const line = 'CLICK OR PRESS A KEY FOR SOUND';
      const w = this.font.measure(line) + 8;
      this.g.fillStyle = 'rgba(7,6,26,0.7)';
      this.g.fillRect(Math.floor((VIEW.w - w) / 2), VIEW.h - 30, w, 12);
      this.font.draw(this.g, line, Math.floor((VIEW.w - w) / 2) + 4, VIEW.h - 27, '#ffb347');
    }
    this.drawTransition(state, t);
    if (this.opts.hud) this.drawHud(state, connected);
    this.drawBlackout(state);
    this.blit();
  }

  private blit(): void {
    this.out.imageSmoothingEnabled = false;
    this.out.clearRect(0, 0, this.screen.width, this.screen.height);
    this.out.drawImage(this.buf, 0, 0, VIEW.w, VIEW.h, 0, 0, this.screen.width, this.screen.height);
  }

  /** Text in the bitmap font when available, otherwise the canvas font. */
  private text(s: string, x: number, y: number, colour: string): number {
    const g = this.g;
    if (this.font) {
      this.font.draw(g, s, x, y, colour);
      return this.font.measure(s);
    }
    g.font = '8px monospace';
    g.textBaseline = 'top';
    g.fillStyle = colour;
    g.fillText(s, x, y);
    return Math.ceil(g.measureText(s).width);
  }

  // -- backdrop ---------------------------------------------------------------

  private drawSky(time: number, cam: number, t: number): void {
    const g = this.g;
    const key = skyKey(time);
    const ramp = this.theme.sky[key];
    const bands = 10;
    const bandH = Math.ceil(VIEW.h / bands);
    for (let i = 0; i < bands; i++) {
      g.fillStyle = ramp[Math.min(ramp.length - 1, Math.floor((i * ramp.length) / bands))];
      g.fillRect(0, i * bandH, VIEW.w, bandH);
    }
    if (key === 'night' || key === 'dusk') {
      g.fillStyle = key === 'night' ? '#c9c9e8' : '#8a7fa8';
      for (const [sx, sy, ph] of this.backdrop.stars) {
        if ((ph + Math.floor(t / 900)) % 11 === 0) continue;
        const x = (((sx - cam * 0.02) % VIEW.worldW) + VIEW.worldW) % VIEW.worldW;
        if (x < VIEW.w) g.fillRect(Math.floor(x), sy, 1, 1);
      }
      const mx = Math.round(392 - cam * 0.03);
      const moonKeys: Record<string, string> = { d: key === 'night' ? '#f2e9c8' : '#e8c9a6', c: key === 'night' ? '#d9cfa8' : '#cfae8a', '.': '' };
      MOON.forEach((row, y) => {
        for (let x = 0; x < row.length; x++) {
          const col = moonKeys[row[x]];
          if (col) {
            g.fillStyle = col;
            g.fillRect(mx + x, 36 + y, 1, 1);
          }
        }
      });
      g.globalAlpha = key === 'night' ? 0.9 : 0.5;
      g.drawImage(this.haze, 0, BASELINE.far - 70);
      g.globalAlpha = 1;
    } else if (this.theme.sun) {
      const sx = Math.round(80 + (time - 8) * 32 - cam * 0.03);
      const sy = 70 - Math.round(Math.sin(((time - 8) / 9) * Math.PI) * 44);
      g.fillStyle = key === 'day' ? '#fff3b0' : '#ffb347';
      MOON.forEach((row, y) => {
        for (let x = 0; x < row.length; x++) if (row[x] !== '.') g.fillRect(sx + x, sy + y, 1, 1);
      });
      g.globalAlpha = 0.35;
      g.drawImage(this.haze, 0, BASELINE.far - 70);
      g.globalAlpha = 1;
    }
  }

  private drawLayer(layer: 'far' | 'mid' | 'near', cam: number, t: number, windowAlpha: number): void {
    const offset = cam * PARALLAX[layer];
    const d = this.backdrop.dunes;
    if (this.theme.kind === 'castle' && d) {
      if (layer === 'far') this.drawDune(d.far, BASELINE.far, offset);
      else this.drawBuildings(this.backdrop[layer], BASELINE[layer], offset, t, layer, windowAlpha);
      return;
    }
    if (d) {
      if (layer === 'far') this.drawBuildings(d.mesas, BASELINE.far - 22, offset, t, 'far', 0);
      this.drawDune(d[layer], BASELINE[layer], offset);
      return;
    }
    this.drawBuildings(this.backdrop[layer], BASELINE[layer], offset, t, layer, windowAlpha);
  }

  private drawDune(d: Dune, baseline: number, offset: number): void {
    const g = this.g;
    g.fillStyle = d.colour;
    for (let sx = 0; sx < VIEW.w; sx++) {
      const wx = (((sx + Math.round(offset)) % VIEW.worldW) + VIEW.worldW) % VIEW.worldW;
      const h = d.heights[wx];
      g.fillRect(sx, baseline - h, 1, h);
    }
    for (const [mx, dy, colour] of d.marks) {
      for (const shift of [0, -VIEW.worldW, VIEW.worldW]) {
        const x = Math.round(mx - offset) + shift;
        if (x < 0 || x >= VIEW.w) continue;
        g.fillStyle = colour;
        const top = baseline - d.heights[mx] - 3 - dy;
        g.fillRect(x, top, 1, 3 + dy);
        g.fillRect(x - 1, top + 1, 3, 1);
      }
    }
  }

  private drawBuildings(list: Building[], baseline: number, offset: number, t: number, layer: 'far' | 'mid' | 'near', windowAlpha: number): void {
    const g = this.g;
    const flicker = Math.floor(t / 700);
    for (const b of list) {
      for (const shift of [0, -VIEW.worldW, VIEW.worldW]) {
        const sx = Math.round(b.x - offset + shift);
        if (sx + b.w < 0 || sx > VIEW.w) continue;
        const top = baseline - b.h;
        g.fillStyle = b.colour;
        g.fillRect(sx, top, b.w, b.h);
        if (b.castle) {
          // crenellations, a darker mortar line, slit windows, and a roof on the towers
          for (let cx = 0; cx < b.w; cx += 4) g.fillRect(sx + cx, top - 3, 2, 3);
          g.fillStyle = 'rgba(0,0,0,0.25)';
          for (let my = top + 6; my < baseline; my += 6) g.fillRect(sx, my, b.w, 1);
          if (b.w <= 18) {
            g.fillStyle = '#1a1420';
            for (let r = 0; r < 8; r++) g.fillRect(sx + r, top - 4 - (8 - r), b.w - r * 2, 1);
            g.fillStyle = '#b0165a';
            g.fillRect(sx + Math.floor(b.w / 2), top - 16, 1, 5);
            g.fillRect(sx + Math.floor(b.w / 2) + 1, top - 16, 3, 2);
          }
          g.globalAlpha = windowAlpha;
          for (const [wx, wy, ph, colour] of b.windows) {
            if ((ph + flicker) % 17 === 0) continue;
            g.fillStyle = colour;
            g.fillRect(sx + wx, top + wy, 1, 3);
          }
          g.globalAlpha = 1;
          continue;
        }
        if (layer !== 'far') {
          g.fillStyle = 'rgba(255,255,255,0.05)';
          g.fillRect(sx, top, b.w, 1);
          if (b.tank) {
            g.fillStyle = '#2a2a44';
            g.fillRect(sx + b.w - 9, top - 5, 6, 5);
            g.fillRect(sx + b.w - 8, top - 6, 4, 1);
          }
        }
        if (b.antenna) {
          g.fillStyle = '#2a2a44';
          g.fillRect(sx + Math.floor(b.w / 2), top - 8, 1, 8);
          g.fillStyle = (flicker + b.x) % 2 === 0 ? '#ff3b3b' : '#8a1c1c';
          g.fillRect(sx + Math.floor(b.w / 2), top - 9, 1, 1);
        }
        if (windowAlpha > 0) {
          g.globalAlpha = windowAlpha;
          for (const [wx, wy, ph, colour] of b.windows) {
            if ((ph + flicker) % 13 === 0) continue;
            g.fillStyle = layer === 'far' ? '#3d3d5c' : colour;
            const s = layer === 'far' ? 1 : 2;
            g.fillRect(sx + wx, top + wy, s, s);
          }
          if (b.shop && layer === 'near') {
            g.fillStyle = b.shop.colour;
            g.fillRect(sx + b.shop.x, baseline - 14, b.shop.w, 10);
            g.fillStyle = 'rgba(0,0,0,0.35)';
            g.fillRect(sx + b.shop.x + 1, baseline - 13, b.shop.w - 2, 8);
            g.fillStyle = b.shop.colour;
            g.fillRect(sx + b.shop.x + b.shop.w + 3, baseline - 12, 5, 12);
            g.fillStyle = '#0b0a1e';
            g.fillRect(sx + b.shop.x + b.shop.w + 4, baseline - 11, 3, 11);
          }
          g.globalAlpha = 1;
        }
      }
    }
  }

  private drawRail(offset: number): void {
    const rail = this.backdrop.rail;
    if (!rail) return;
    const g = this.g;
    g.fillStyle = '#3d3d5c';
    g.fillRect(0, rail.y, VIEW.w, 2);
    g.fillStyle = '#1a1a2e';
    g.fillRect(0, rail.y + 2, VIEW.w, 2);
    g.fillStyle = '#2a2a44';
    const start = -(((offset % 64) + 64) % 64);
    for (let x = start; x < VIEW.w; x += 64) {
      g.fillRect(Math.round(x), rail.y + 4, 3, VIEW.groundY - rail.y - 4);
      g.fillRect(Math.round(x) - 2, rail.y + 4, 7, 2);
    }
  }

  private drawGround(state: WorldState, cam: number, t: number): void {
    const g = this.g;
    g.fillStyle = this.theme.ground;
    g.fillRect(0, VIEW.groundY, VIEW.w, VIEW.h - VIEW.groundY);
    g.fillStyle = this.theme.groundLine;
    g.fillRect(0, VIEW.groundY, VIEW.w, 1);
    g.fillStyle = this.theme.groundDash;
    for (let x = -(cam % 24); x < VIEW.w; x += 24) g.fillRect(Math.round(x), VIEW.groundY + 1, 1, VIEW.h - VIEW.groundY);
    if (this.theme.precip === 'rain' && (state.weather === 'rain' || state.weather === 'storm')) {
      const shimmer = Math.floor(t / 250);
      for (let i = 0; i < 18; i++) {
        const px = ((i * 53 + shimmer * 3) % (VIEW.w + 40)) - 20;
        const py = VIEW.groundY + 6 + ((i * 17) % 40);
        g.fillStyle = i % 3 === 0 ? '#0d5c6b' : i % 3 === 1 ? '#3b2d7a' : '#b0165a';
        g.fillRect(px, py, 6 + (i % 4) * 3, 1);
      }
    }
  }

  private drawTint(key: SkyKey): void {
    const g = this.g;
    if (key === 'day') g.fillStyle = this.theme.kind === 'city' ? 'rgba(120,150,220,0.28)' : 'rgba(255,240,200,0.10)';
    else if (key === 'dawn') g.fillStyle = 'rgba(200,140,110,0.14)';
    else if (key === 'dusk') g.fillStyle = 'rgba(180,80,120,0.12)';
    else return;
    g.fillRect(0, 0, VIEW.w, VIEW.h);
  }

  // -- entities ---------------------------------------------------------------

  private drawEntities(state: WorldState, layer: Layer, cam: number, t: number): void {
    const factor = PARALLAX[layer];
    const list = state.entities.filter((e) => e.layer === layer);
    if (layer === 'stage') list.sort((a, b) => a.x - b.x);
    for (const e of list) {
      const def = this.sprites.get(e.sprite);
      const sx = Math.round(entityX(e, this.now) - cam * factor);
      if (!def) {
        this.g.fillStyle = '#ff2bd6';
        this.g.fillRect(sx, e.y, 8, 8);
        continue;
      }
      const w = textSpriteWidth(def, e.text);
      if (sx + w < 0 || sx > VIEW.w) continue;
      if (def.procedural) this.drawProcedural(e, def, sx, t, w);
      else this.drawSprite(e, def, sx, t);
      const age = this.now - e.addedAt;
      if (age >= 0 && age < 700) {
        const g = this.g;
        const rise = Math.floor(age / 60);
        g.fillStyle = age < 350 ? '#f4f4ff' : '#c9c9e8';
        const cx = sx + Math.floor(w / 2);
        const base = e.y + Math.floor(def.h / 2);
        g.fillRect(cx - 4 - Math.floor(rise / 3), base - rise, 1, 1);
        g.fillRect(cx + 4 + Math.floor(rise / 3), base - rise + 1, 1, 1);
        g.fillRect(cx, base - rise - 2, 1, 1);
        g.fillRect(cx - 1, base - Math.floor(rise / 2), 1, 1);
      }
      if (e.label) this.drawLabel(e.label, sx + Math.floor(w / 2), e.y);
    }
  }

  private drawLabel(label: string, cx: number, top: number): void {
    if (!this.font) return;
    const g = this.g;
    const w = this.font.measure(label);
    const x = Math.max(1, Math.min(VIEW.w - w - 1, cx - Math.floor(w / 2)));
    const y = Math.max(1, top - 10);
    g.fillStyle = 'rgba(7,6,26,0.7)';
    g.fillRect(x - 1, y - 1, w + 2, this.font.data.h + 2);
    this.font.draw(g, label, x, y, '#ffe066');
  }

  /** Small bubbles for things that talk when the character is near. */
  private drawEntitySpeech(state: WorldState, cam: number): void {
    if (!this.font) return;
    const g = this.g;
    for (const e of state.entities) {
      if (!e.say || e.say.until <= this.now) continue;
      const def = this.sprites.get(e.sprite);
      const w = def ? textSpriteWidth(def, e.text) : 8;
      const sx = Math.round(entityX(e, this.now) - cam * PARALLAX[e.layer]);
      const lines = this.font.wrap(e.say.text, 22, 2);
      const bw = Math.max(...lines.map((l) => this.font!.measure(l))) + 6;
      const bh = lines.length * (this.font.data.h + 2) + 3;
      const cx = sx + Math.floor(w / 2);
      const bx = Math.max(2, Math.min(VIEW.w - bw - 2, cx - Math.floor(bw / 2)));
      const by = Math.max(2, e.y - (e.label ? 12 : 2) - bh - 4);
      g.fillStyle = '#c9c9e8';
      g.fillRect(bx, by, bw, bh);
      g.fillStyle = '#0b0a1e';
      g.fillRect(bx, by + bh, bw, 1);
      g.fillRect(cx - 1, by + bh, 2, 2);
      lines.forEach((l, i) => this.font!.draw(g, l, bx + 3, by + 2 + i * (this.font!.data.h + 2), '#0b0a1e'));
    }
  }

  /** Frames facing the direction of travel: flipped when the art faces the other way. */
  private framesFor(def: SpriteDef, e: Entity): Canvas[] | undefined {
    const base = this.frames.get(def.name);
    if (!base || !e.motion) return base;
    const movingLeft = e.motion.toX < e.motion.fromX;
    if (movingLeft === (def.faces === 'l')) return base;
    let flipped = this.flipped.get(def.name);
    if (!flipped) {
      flipped = base.map(flipH);
      this.flipped.set(def.name, flipped);
    }
    return flipped;
  }

  private drawSprite(e: Entity, def: SpriteDef, sx: number, t: number): void {
    const g = this.g;
    const h = hashStr(e.id);
    const flying = def.tags.includes('flying');
    const sy = e.y + (flying ? Math.round(Math.sin(t / 320 + (h % 7)) * 2) : 0);
    const frames = this.framesFor(def, e);
    if (!frames) {
      g.fillStyle = def.colour;
      g.fillRect(sx, sy, def.w, def.h);
      g.fillStyle = 'rgba(0,0,0,0.45)';
      g.fillRect(sx, sy, def.w, 1);
      g.fillRect(sx, sy + def.h - 1, def.w, 1);
      return;
    }
    const idx = frames.length > 1 ? Math.floor(t / 260 + (h % 5)) % frames.length : 0;
    g.drawImage(frames[idx], sx, sy);
  }

  private drawProcedural(e: Entity, def: SpriteDef, sx: number, t: number, w: number): void {
    const g = this.g;
    const h = hashStr(e.id);
    const sy = e.y;
    switch (def.procedural) {
      case 'neon_sign': {
        const colour = NEON[h % NEON.length];
        const flick = (h + Math.floor(t / 90)) % 59 === 0;
        g.fillStyle = 'rgba(11,10,30,0.85)';
        g.fillRect(sx, sy, w, def.h);
        g.globalAlpha = flick ? 0.35 : 1;
        g.fillStyle = colour;
        g.fillRect(sx, sy, w, 1);
        g.fillRect(sx, sy + def.h - 1, w, 1);
        g.fillRect(sx, sy, 1, def.h);
        g.fillRect(sx + w - 1, sy, 1, def.h);
        g.globalAlpha = flick ? 0.1 : 0.25;
        g.fillRect(sx - 1, sy - 1, w + 2, 1);
        g.fillRect(sx - 1, sy + def.h, w + 2, 1);
        g.fillRect(sx - 1, sy, 1, def.h);
        g.fillRect(sx + w, sy, 1, def.h);
        g.globalAlpha = flick ? 0.4 : 1;
        this.drawGlowText(e.text ?? '', colour, sx, sy, w, def.h);
        g.globalAlpha = 1;
        g.fillStyle = '#3d3d5c';
        g.fillRect(sx + 2, sy - 3, 1, 3);
        g.fillRect(sx + w - 3, sy - 3, 1, 3);
        return;
      }
      case 'holo_screen': {
        const jitter = (h + Math.floor(t / 70)) % 43 === 0 ? 1 : 0;
        g.fillStyle = 'rgba(13,92,107,0.75)';
        g.fillRect(sx, sy, w, def.h);
        g.fillStyle = '#00a3b8';
        g.fillRect(sx, sy, w, 1);
        g.fillRect(sx, sy + def.h - 1, w, 1);
        g.fillRect(sx, sy, 1, def.h);
        g.fillRect(sx + w - 1, sy, 1, def.h);
        this.drawGlowText(e.text ?? '', '#00e5ff', sx, sy + jitter, w, def.h);
        g.fillStyle = 'rgba(0,0,0,0.28)';
        for (let y = sy + 1; y < sy + def.h - 1; y += 2) g.fillRect(sx + 1, y, w - 2, 1);
        g.fillStyle = Math.floor(t / 500) % 2 === 0 ? '#ff3b3b' : '#8a1c1c';
        g.fillRect(sx + w - 3, sy + 2, 1, 1);
        return;
      }
      case 'graffiti': {
        const colour = SPRAY[h % SPRAY.length];
        const text = e.text ?? '';
        if (!this.font) {
          this.text(text, sx, sy, colour);
          return;
        }
        const tx = sx + Math.floor((w - this.font.measure(text)) / 2);
        g.globalAlpha = 0.6;
        this.font.draw(g, text, tx + 1, sy + 2, '#07061a');
        g.globalAlpha = 0.95;
        this.font.draw(g, text, tx, sy + 1, colour);
        g.globalAlpha = 0.7;
        const chars = this.font.chars(text);
        for (let i = 0; i < chars.length; i++) {
          if ((h + i * 31) % 4 !== 0 || chars[i] === ' ') continue;
          g.fillStyle = colour;
          g.fillRect(tx + i * FONT_ADVANCE + 2, sy + 8, 1, 2 + ((h + i) % 4));
        }
        g.globalAlpha = 1;
        return;
      }
      case 'wood_sign': {
        const plankH = 12;
        g.fillStyle = '#5c3a1e';
        g.fillRect(sx + Math.floor(w / 2) - 1, sy + plankH - 1, 3, def.h - plankH + 1);
        g.fillRect(sx, sy, w, plankH);
        g.fillStyle = '#7a4a2a';
        g.fillRect(sx, sy, w, 1);
        g.fillRect(sx, sy, 1, plankH);
        g.fillStyle = '#2a1a14';
        g.fillRect(sx, sy + plankH - 1, w, 1);
        g.fillRect(sx + w - 1, sy, 1, plankH);
        if (this.font) {
          const text = e.text ?? '';
          this.font.draw(g, text, sx + Math.floor((w - this.font.measure(text)) / 2), sy + Math.floor((plankH - this.font.data.h) / 2), '#efe9dd');
        }
        return;
      }
      case 'cables': {
        g.fillStyle = '#07061a';
        for (let k = 0; k < 3; k++) {
          const sag = 7 + k * 6 + (h % 3);
          for (let x = 0; x < w; x++) {
            const u = (2 * x) / w - 1;
            g.fillRect(sx + x, sy + Math.round(sag * (1 - u * u)), 1, 1);
          }
        }
        g.fillStyle = '#1a1a2e';
        g.fillRect(sx + Math.floor(w / 2) - 1, sy + 7 + (h % 3), 3, 2);
        return;
      }
      default:
        g.fillStyle = def.colour;
        g.fillRect(sx, sy, w, def.h);
    }
  }

  private drawGlowText(text: string, colour: string, sx: number, sy: number, w: number, h: number): void {
    if (!this.font) {
      this.text(text, sx + 2, sy + 3, colour);
      return;
    }
    const img = this.font.glow(text, colour, '#f4f4ff');
    const tx = sx + Math.floor((w - (img.width - 2)) / 2) - 1;
    const ty = sy + Math.floor((h - this.font.data.h) / 2) - 1;
    this.g.drawImage(img, tx, ty);
  }

  // -- character --------------------------------------------------------------

  private drawCharacter(c: CharacterState, cam: number, t: number, dt: number): void {
    const g = this.g;
    if (this.displayX === null || Math.abs(this.displayX - c.x) > 48) this.displayX = c.x;
    else {
      const maxStep = 34 * dt;
      const d = c.x - this.displayX;
      this.displayX += Math.max(-maxStep, Math.min(maxStep, d));
    }
    const x = Math.round(this.displayX - cam);
    this.ensureDressed(c.outfit);
    const moving = c.mode === 'walk' || c.mode === 'travel' || Math.abs(c.x - this.displayX) > 0.5;
    const mode: CharacterMode = moving ? 'walk' : c.mode;
    const set = this.character[mode] ?? this.character.idle;
    if (set) {
      const frames = c.facing === 'l' ? set.l : set.r;
      const down = c.vitals?.collapsed || c.sleeping;
      if (down) {
        // Crouched: the top of the idle frame, dropped to the ground, plus what is wrong.
        const f = (this.character.idle ?? set).r[0];
        const padTop = this.charPad.top;
        const keep = Math.max(8, f.height - padTop - 6);
        g.drawImage(f, 0, 0, f.width, padTop + keep, x - Math.floor(f.width / 2), c.y - keep + 4 - padTop, f.width, padTop + keep);
        if (c.sleeping && this.font) {
          const z = Math.floor(t / 500) % 3;
          this.font.draw(g, 'Z', x + 8, c.y - keep - 2 - z * 3, '#c9c9e8');
          if (z > 0) this.font.draw(g, 'Z', x + 13, c.y - keep - 8 - z * 2, '#6e6e96');
        }
        if (c.vitals?.collapsed && this.font) {
          const col = c.vitals.collapsed;
          const secs = Math.max(0, Math.ceil((col.until - this.now) / 1000));
          const label = `${col.need === 'comfort' ? (this.worlds[this.world ?? 'cyberpunk']?.survival?.comfort ?? 'warmth') : col.need} ${secs}`.toUpperCase();
          const w = this.font.measure(label) + 6;
          const bx = Math.max(2, Math.min(VIEW.w - w - 2, x - Math.floor(w / 2)));
          const by = c.y - keep - 14;
          const blink = Math.floor(t / 400) % 2 === 0;
          g.fillStyle = blink ? '#ff3b3b' : '#8a1c1c';
          g.fillRect(bx, by, w, this.font.data.h + 4);
          this.font.draw(g, label, bx + 3, by + 2, '#f4f4ff');
          const total = Math.max(1, col.until - col.since);
          g.fillStyle = '#f4f4ff';
          g.fillRect(bx, by + this.font.data.h + 4, Math.round((w * Math.max(0, col.until - this.now)) / total), 1);
        }
        return;
      }
      const period = mode === 'walk' ? 130 : mode === 'talk' ? 240 : 700;
      const f = frames[Math.floor(t / period) % frames.length];
      g.drawImage(f, x - Math.floor(f.width / 2), c.y - f.height);
      g.fillStyle = 'rgba(255,43,214,0.12)';
      g.fillRect(x - 6, c.y, 12, 1);
      return;
    }
    const step = moving ? Math.floor(t / 140) % 2 : 0;
    g.fillStyle = '#3d3d5c';
    g.fillRect(x - 4, c.y - 17 - step, 8, 12);
    g.fillStyle = '#ff2bd6';
    g.fillRect(x - 4, c.y - 16 - step, 8, 2);
    g.fillStyle = '#e0c9a6';
    g.fillRect(x - 3, c.y - 23 - step, 6, 6);
    g.fillStyle = '#2a2a44';
    g.fillRect(x - 3, c.y - 5, 2, 5);
    g.fillRect(x + 1, c.y - 5, 2, 5);
  }

  private drawBubble(c: CharacterState, cam: number): void {
    if (!c.bubble) return;
    const g = this.g;
    const cx = Math.round((this.displayX ?? c.x) - cam);
    const maxW = 156;
    let lines: string[];
    let lineH: number;
    let w: number;
    if (this.font) {
      lines = this.font.wrap(c.bubble.text, Math.floor(maxW / FONT_ADVANCE), 4);
      lineH = this.font.data.h + 2;
      w = Math.max(...lines.map((l) => this.font!.measure(l))) + 8;
    } else {
      g.font = '8px monospace';
      lines = [c.bubble.text.slice(0, 40)];
      lineH = 9;
      w = Math.ceil(g.measureText(lines[0]).width) + 8;
    }
    const h = lines.length * lineH + 5;
    let bx = cx - Math.floor(w / 2);
    bx = Math.max(2, Math.min(VIEW.w - w - 2, bx));
    const by = Math.max(2, c.y - 22 - h - 6);
    g.fillStyle = '#f4f4ff';
    g.fillRect(bx, by, w, h);
    g.fillStyle = '#0b0a1e';
    g.fillRect(bx, by, w, 1);
    g.fillRect(bx, by + h - 1, w, 1);
    g.fillRect(bx, by, 1, h);
    g.fillRect(bx + w - 1, by, 1, h);
    g.fillStyle = '#f4f4ff';
    g.fillRect(cx - 1, by + h, 3, 1);
    g.fillRect(cx, by + h + 1, 1, 2);
    lines.forEach((l, i) => this.text(l, bx + 4, by + 3 + i * lineH, '#0b0a1e'));
  }

  // -- travel -----------------------------------------------------------------

  private drawVote(state: WorldState): void {
    if (!state.vote || !this.font) return;
    const g = this.g;
    const secs = Math.max(0, Math.ceil((state.vote.until - this.now) / 1000));
    const line = `TRAVEL TO ${state.vote.to.toUpperCase()}? ${state.vote.count}/${state.vote.needed}  !VOTE  ${secs}S`;
    const w = this.font.measure(line) + 8;
    const x = VIEW.w - w - 4;
    const y = VIEW.h - 16;
    g.fillStyle = 'rgba(7,6,26,0.8)';
    g.fillRect(x, y, w, 12);
    g.fillStyle = '#ffb347';
    g.fillRect(x, y, w, 1);
    this.font.draw(g, line, x + 4, y + 3, '#ffe066');
  }

  /** Four small meters, top right: food, warmth or water, rest, spirit, plus days and deaths. */
  private drawVitals(state: WorldState): void {
    const v = state.character.vitals;
    if (!v || !this.font || !this.showMeters) return;
    const g = this.g;
    const comfortLabel = (this.worlds[state.world]?.survival?.comfort ?? 'warmth').toUpperCase();
    const rows: Array<[string, number, string]> = [
      ['FOOD', v.food, '#ffb347'],
      [comfortLabel, v.comfort, comfortLabel === 'WATER' ? '#00e5ff' : '#ff8a3d'],
      ['REST', v.rest, '#8b5cf6'],
      ['SPIRIT', v.spirit, '#ff2bd6'],
    ];
    const labelW = 6 * FONT_ADVANCE;
    const barW = 40;
    const w = labelW + 4 + barW + 8;
    const x = VIEW.w - w - 4;
    const y = 4;
    const h = rows.length * 9 + 14;
    g.fillStyle = 'rgba(7,6,26,0.7)';
    g.fillRect(x, y, w, h);
    rows.forEach(([label, value, colour], i) => {
      const ry = y + 4 + i * 9;
      const low = value < 25;
      const blink = low && Math.floor(this.now / 400) % 2 === 0;
      this.font!.draw(g, label, x + 4, ry, low ? '#ff5fa2' : '#c9c9e8');
      g.fillStyle = '#26205e';
      g.fillRect(x + 4 + labelW + 4, ry + 1, barW, 5);
      g.fillStyle = blink ? '#ff3b3b' : colour;
      g.fillRect(x + 4 + labelW + 4, ry + 1, Math.round((barW * Math.max(0, Math.min(100, value))) / 100), 5);
    });
    const foot = `DAY ${v.days}${v.deaths ? `  RIP ${v.deaths}` : ''}`;
    this.font.draw(g, foot, x + 4, y + 4 + rows.length * 9 + 1, '#6e6e96');
  }

  /** Lights out after a death: a tombstone until he walks back in. */
  private drawBlackout(state: WorldState): void {
    const b = state.character.vitals?.blackout;
    if (!b || !this.font) return;
    const g = this.g;
    const p = Math.max(0, Math.min(1, (this.now - b.since) / 1500));
    g.fillStyle = `rgba(7,6,26,${(0.94 * p).toFixed(3)})`;
    g.fillRect(0, 0, VIEW.w, VIEW.h);
    if (p < 1) return;
    const secs = Math.max(0, Math.ceil((b.until - this.now) / 1000));
    const lines = [`HERE LIES ${this.characterName.toUpperCase() || 'THE WANDERER'}`, `DEATHS: ${state.character.vitals.deaths}`, `BACK IN ${secs}S`];
    const sx = Math.floor(VIEW.w / 2) - 10;
    const sy = Math.floor(VIEW.h / 2) - 30;
    g.fillStyle = '#3d3d5c';
    g.fillRect(sx + 4, sy, 12, 4);
    g.fillRect(sx + 2, sy + 2, 16, 18);
    g.fillStyle = '#2a2a44';
    g.fillRect(sx + 6, sy + 6, 8, 1);
    g.fillRect(sx + 6, sy + 9, 8, 1);
    g.fillRect(sx, sy + 20, 20, 2);
    lines.forEach((l, i) => this.font!.draw(g, l, Math.floor((VIEW.w - this.font!.measure(l)) / 2), sy + 28 + i * 10, i === 0 ? '#f4f4ff' : '#6e6e96'));
  }

  /** The character's open question to chat, with a shrinking timer bar. */
  private drawAsk(state: WorldState): void {
    const ask = state.host?.ask;
    if (!ask || !this.font) return;
    const g = this.g;
    const lines = this.font.wrap(ask.text, 44, 2);
    const lineH = this.font.data.h + 2;
    const w = Math.max(...lines.map((l) => this.font!.measure(l))) + 12;
    const h = lines.length * lineH + 9;
    const x = Math.floor((VIEW.w - w) / 2);
    const y = this.opts.hud ? 28 : 6;
    g.fillStyle = 'rgba(7,6,26,0.82)';
    g.fillRect(x, y, w, h);
    g.fillStyle = '#ffb347';
    g.fillRect(x, y, w, 1);
    lines.forEach((l, i) => this.font!.draw(g, l, x + 6, y + 4 + i * lineH, '#f4f4ff'));
    const remaining = Math.max(0, Math.min(1, (ask.until - this.now) / Math.max(1, ask.totalMs)));
    g.fillStyle = '#26205e';
    g.fillRect(x, y + h - 2, w, 2);
    g.fillStyle = remaining < 0.25 ? '#ff5fa2' : '#ffb347';
    g.fillRect(x, y + h - 2, Math.round(w * remaining), 2);
  }

  private drawBag(state: WorldState): void {
    const bag = state.character.inventory;
    if (!bag?.length || !this.font) return;
    const g = this.g;
    const line = `BAG: ${bag.map((i) => i.replace(/_/g, ' ').toUpperCase()).join(' · ')}`;
    const w = this.font.measure(line) + 8;
    const y = VIEW.h - 30;
    g.fillStyle = 'rgba(7,6,26,0.6)';
    g.fillRect(4, y, w, 12);
    this.font.draw(g, line, 8, y + 3, '#ffb347');
  }

  /** One rotating suggestion, bottom left, so nobody has to read a manual. */
  private drawHint(state: WorldState): void {
    const hint = state.host?.hint;
    if (!hint || !this.font || state.host?.ask) return;
    const g = this.g;
    const w = this.font.measure(hint) + 8;
    const x = 4;
    const y = VIEW.h - 16;
    g.fillStyle = 'rgba(7,6,26,0.6)';
    g.fillRect(x, y, w, 12);
    this.font.draw(g, hint, x + 4, y + 3, '#6e6e96');
  }

  private drawTransition(state: WorldState, t: number): void {
    const g = this.g;
    let alpha = 0;
    if (state.transition) {
      const p = (this.now - state.transition.startedAt) / Math.max(1, state.transition.durationMs);
      alpha = Math.max(0, Math.min(1, (p - 0.35) / 0.45));
      this.fadeInStart = null;
    } else if (this.fadeInStart !== null) {
      alpha = 1 - Math.min(1, (t - this.fadeInStart) / FADE_IN_MS);
      if (alpha <= 0) this.fadeInStart = null;
    }
    if (alpha <= 0) return;
    g.fillStyle = `rgba(7,6,26,${alpha.toFixed(3)})`;
    g.fillRect(0, 0, VIEW.w, VIEW.h);
    if (state.transition && alpha > 0.6 && this.font) {
      const line = `NEXT STOP: ${state.transition.to.toUpperCase()}`;
      this.font.draw(g, line, Math.floor((VIEW.w - this.font.measure(line)) / 2), Math.floor(VIEW.h / 2) - 4, '#f4f4ff');
    }
  }

  // -- weather ----------------------------------------------------------------

  private drawWeather(w: Weather, t: number): void {
    const g = this.g;
    if (this.theme.precip === 'sand' && w === 'storm') {
      g.fillStyle = 'rgba(242,213,160,0.55)';
      for (let i = 0; i < 160; i++) {
        const speed = 1.4 + (i % 5) * 0.2;
        const x = ((i * 37 + Math.floor(t * speed)) % (VIEW.w + 60)) - 30;
        const y = ((i * 53 + Math.floor(t * 0.05 * speed)) % (VIEW.h + 20)) - 10;
        g.fillRect(x, y, 5 + (i % 3), 1);
      }
      g.fillStyle = 'rgba(217,168,108,0.25)';
      g.fillRect(0, 0, VIEW.w, VIEW.h);
      return;
    }
    if (w === 'rain' || w === 'storm') {
      const n = w === 'storm' ? 140 : 80;
      g.fillStyle = w === 'storm' ? 'rgba(180,210,255,0.55)' : 'rgba(140,190,255,0.42)';
      for (let i = 0; i < n; i++) {
        const speed = 0.9 + (i % 5) * 0.08;
        const x = ((i * 37 + Math.floor(t * 0.32 * speed)) % (VIEW.w + 60)) - 30;
        const y = ((i * 53 + Math.floor(t * speed)) % (VIEW.h + 30)) - 15;
        g.fillRect(x, y, 1, 4);
        g.fillRect(x - 1, y + 4, 1, 3);
      }
      if (w === 'storm' && t % 6100 < 70) {
        g.fillStyle = 'rgba(255,255,255,0.35)';
        g.fillRect(0, 0, VIEW.w, VIEW.h);
      }
    } else if (w === 'fog') {
      const tint = this.theme.precip === 'sand' ? '217,168,108' : '110,110,150';
      for (let i = 0; i < 6; i++) {
        const y = 120 + i * 18 + Math.round(Math.sin(t / 2000 + i) * 3);
        g.fillStyle = `rgba(${tint},${0.1 + i * 0.03})`;
        g.fillRect(0, y, VIEW.w, 14);
      }
    } else if (w === 'snow') {
      g.fillStyle = '#f4f4ff';
      for (let i = 0; i < 90; i++) {
        const x = (((i * 41 + Math.floor(Math.sin(t / 1300 + i) * 6) + Math.floor(t * 0.02)) % VIEW.w) + VIEW.w) % VIEW.w;
        const y = ((i * 29 + Math.floor(t * 0.06 * (0.6 + (i % 4) * 0.2))) % (VIEW.h + 10)) - 5;
        g.fillRect(x, y, 1, 1);
      }
    }
  }

  // -- hud --------------------------------------------------------------------

  private drawHud(state: WorldState, connected: boolean): void {
    const g = this.g;
    const hh = Math.floor(state.time);
    const mm = Math.floor((state.time - hh) * 60);
    const line = `${state.world} ${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')} ${state.weather} ${state.entities.length} ENT V${state.version}${connected ? '' : ' OFFLINE'}`;
    const colour = connected ? '#7cff4f' : '#ff3b3b';
    g.fillStyle = 'rgba(0,0,0,0.6)';
    g.fillRect(2, 2, (this.font ? this.font.measure(line) : line.length * 5) + 6, 22);
    this.text(line, 5, 4, colour);
    if (this.characterName) this.text(this.characterName, 5, 14, colour);
  }
}
