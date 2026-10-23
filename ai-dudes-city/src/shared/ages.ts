// The ages the town lives through, Stone to the Wasteland (docs/ages.md; the last age keeps the id 'future'). Each age is a style sheet as data,
// the same on the server and the page: what things are called, how the ground and sky look, what
// people wear, what the streamer's character is called, and the direction the design call gets so a
// skyscraper asked for in the Stone Age comes out as stacked boulders. A build designed in one age
// and shown in another gets a deterministic colour swap (`restyleColour`) until a proper restyle of
// it exists. Needs, prices and visit lengths never change between ages; only names and looks do.
// Zero AI.
import type { VenueKind } from './city';
import type { DudeLook, Hat } from './dudesTypes';
import BIBLES from './ageBibles.json';
import { outfitFor } from './outfits';

export const AGE_IDS = ['stone', 'bronze', 'medieval', 'industrial', 'modern', 'future'] as const;
export type AgeId = (typeof AGE_IDS)[number];
/** The age every build made before ages existed was designed in. */
export const MODERN = 4;
export const LAST_AGE = AGE_IDS.length - 1;
/** Drawn in no age (the theme-free sandbox): colours stay exactly as designed. As a build's origin: made in no age, so every age restyles it. */
export const NO_AGE = -1;
/** The design call's direction in the theme-free sandbox. */
export const SANDBOX_DESIGN = 'Sandbox: no age and no theme. Make exactly what was asked, in whatever style suits it best (everyday, fantasy, sci-fi, silly), in its own colours.';

/** How a colour from another age is pulled into this one: hues drawn toward the age's anchors, saturation capped, lightness squeezed. */
export interface AgePalette {
  /** Hues (degrees) the age's colours sit on; each colour is pulled toward the nearest. */
  anchors: number[];
  /** 0 keeps the hue, 1 lands on the anchor. */
  pull: number;
  satCap: number;
  /** Greys get this hue and this much saturation: the age's neutral (warm stone, cool steel). */
  neutral: number;
  neutralSat: number;
  /** Lightness is mapped into this range. */
  light: [number, number];
  /** Bright, strong colours glow (light strips). */
  glow?: boolean;
}

export interface AgeStyle {
  id: AgeId;
  /** "the Stone Age" */
  name: string;
  /** The streamer's character: what the town calls them now, and what they wear. */
  head: { title: string; look: DudeLook };
  /** For the design call: how things are made in this age, with an example or two. */
  design: string;
  /** For every agent: one line on living in this age. */
  living: string;
  /** What each kind of place is called in this age. */
  venues: Record<VenueKind, string>;
  palette?: AgePalette; // absent: colours stay as designed (the Modern age)
  /** Hats that belong in this age; any other is swapped for `fallback`. Absent: every hat. */
  hats?: { allowed: Hat[]; fallback: Hat };
}

const look = (l: Partial<DudeLook> & Pick<DudeLook, 'shirt' | 'pants' | 'hat' | 'hatColor' | 'accessory' | 'accessoryColor'>): DudeLook => ({
  skin: '#e0ac85',
  hair: '#2b2018',
  height: 1.12,
  build: 1.1,
  ...l,
});

export const AGES: AgeStyle[] = [
  {
    id: 'stone',
    name: 'the Stone Age',
    head: { title: 'Chief', look: look({ shirt: '#8a6a48', pants: '#5a4532', hat: 'headband', hatColor: '#c9b48a', accessory: 'cape', accessoryColor: '#6b5236' }) },
    design:
      'The Stone Age: everything is made by hand from what lies about: rough grey boulders, logs, sticks, animal hides and furs, bone and mammoth tusks, thatch and mud. No metal, no glass, no wheels, no machines, no writing (painted symbols instead). Earthy colours: stone greys, hide browns, ochre, moss green, firelight orange. A skyscraper is a teetering tower of stacked boulders; a car is a log sledge; a café is a fire pit ringed with log seats; a dog is a shaggy, muddy hound.',
    living: 'Everyone lives as people did then: builds are boulders, logs, hides and bone, and places are what they were then (a café is a fire pit, a bar a brew pit, a shop a trading rock).',
    venues: {
      home: 'hut', cafe: 'fire pit', restaurant: 'roasting pit', bakery: 'flatbread stone', bar: 'brew pit', club: 'drum circle', shop: 'trading rock', market: 'gathering ground', workshop: 'knapping hut', apartments: 'longhouse', gym: 'wrestling ring', park: 'grove', library: 'painted cave', florist: 'herb patch', venue: 'ceremony circle', decor: 'standing stone',
    },
    palette: { anchors: [10, 28, 40, 95, 205], pull: 0.8, satCap: 0.42, neutral: 32, neutralSat: 0.08, light: [0.2, 0.72] },
    hats: { allowed: ['none', 'headband', 'crown', 'helmet', 'wizard'], fallback: 'headband' },
  },
  {
    id: 'bronze',
    name: 'the Bronze Age',
    head: { title: 'High Priest', look: look({ shirt: '#efe4c8', pants: '#d8c9a2', hat: 'wizard', hatColor: '#d9a23a', accessory: 'cape', accessoryColor: '#2f5fa8' }) },
    design:
      'The Bronze Age: mud brick, sandstone, cedar timber, reed thatch, woven cloth, clay pots, polished bronze and gold trim, lapis-blue paint. Flat roofs, columns, stepped ziggurats, chariots with spoked wheels, oil lamps and braziers. No glass windows, no iron, no engines. A skyscraper is a stepped ziggurat; a car is a chariot; a café is a hearth house with clay cups.',
    living: 'Builds are mud brick, sandstone, cedar and bronze; places are what they were then (a café is a hearth house, a bar a beer house, a shop a trader\'s stall).',
    venues: {
      home: 'mud-brick house', cafe: 'hearth house', restaurant: 'feast hall', bakery: 'bread oven', bar: 'beer house', club: 'dance court', shop: "trader's stall", market: 'bazaar', workshop: 'bronze workshop', apartments: 'terrace houses', gym: 'training yard', park: 'garden', library: 'tablet house', florist: 'perfumer', venue: 'temple court', decor: 'statue',
    },
    palette: { anchors: [22, 38, 48, 120, 222], pull: 0.7, satCap: 0.55, neutral: 40, neutralSat: 0.14, light: [0.25, 0.8] },
    hats: { allowed: ['none', 'headband', 'crown', 'helmet', 'wizard'], fallback: 'headband' },
  },
  {
    id: 'medieval',
    name: 'the Middle Ages',
    head: { title: 'King', look: look({ shirt: '#8a1f2a', pants: '#3a2a20', hat: 'crown', hatColor: '#e0b030', accessory: 'cape', accessoryColor: '#b0262f' }) },
    design:
      'The Middle Ages: grey stone blocks, timber framing with white plaster, thatch and slate roofs, iron studs, heraldic banners and shields in bold red, blue and gold, torches and candles. Castles, towers with battlements, carts and horses, jesters and knights. No engines, no electricity. A skyscraper is a tall castle keep; a car is a horse and cart; a café is a cookshop with trestle tables.',
    living: 'Builds are stone, timber and thatch with banners; places are what they were then (a café is a cookshop, a bar a tavern, a club a minstrel hall).',
    venues: {
      home: 'cottage', cafe: 'cookshop', restaurant: 'banquet hall', bakery: 'bakehouse', bar: 'tavern', club: 'minstrel hall', shop: 'stall', market: 'market cross', workshop: 'smithy', apartments: 'inn', gym: 'jousting yard', park: 'herb garden', library: 'scriptorium', florist: 'flower seller', venue: 'great hall', decor: 'banner',
    },
    palette: { anchors: [0, 30, 48, 110, 220], pull: 0.6, satCap: 0.55, neutral: 35, neutralSat: 0.06, light: [0.2, 0.82] },
    hats: { allowed: ['none', 'beanie', 'crown', 'helmet', 'wizard', 'headband', 'party'], fallback: 'beanie' },
  },
  {
    id: 'industrial',
    name: 'the Industrial Age',
    head: { title: 'Alderman', look: look({ shirt: '#1f1f24', pants: '#2b2b30', hat: 'tophat', hatColor: '#141418', accessory: 'scarf', accessoryColor: '#d9a23a' }) },
    design:
      'The Industrial Age (Victorian): red brick, cast iron, riveted steel, soot-dark timber, brass and copper, tall smokestacks, steam, gas lamps, cobbles, glass in small panes. Steam engines, locomotives, penny-farthings, factories with chimneys. No plastic, no screens, no cars with engines in front. A skyscraper is a tall brick-and-iron mill tower; a car is a steam carriage; a café is a coffee house with gas lamps.',
    living: 'Builds are red brick, iron, brass and steam; places are what they were then (a café is a coffee house, a bar a public house, a club a music hall).',
    venues: {
      home: 'terrace house', cafe: 'coffee house', restaurant: 'dining rooms', bakery: 'steam bakery', bar: 'public house', club: 'music hall', shop: 'emporium', market: 'covered market', workshop: 'works', apartments: 'tenements', gym: 'boxing club', park: 'pleasure gardens', library: 'reading room', florist: 'flower stall', venue: 'assembly rooms', decor: 'monument',
    },
    palette: { anchors: [8, 22, 40, 150, 210], pull: 0.55, satCap: 0.48, neutral: 25, neutralSat: 0.06, light: [0.14, 0.72] },
    hats: { allowed: ['none', 'cap', 'beanie', 'tophat', 'bucket', 'helmet', 'crown', 'party'], fallback: 'cap' },
  },
  {
    id: 'modern',
    name: 'the Modern Age',
    head: { title: 'Mayor', look: look({ shirt: '#2b2f3a', pants: '#22252c', hat: 'propeller', hatColor: '#c4402f', accessory: 'scarf', accessoryColor: '#d9a23a' }) },
    design: "The Modern Age: today's world: concrete, glass, steel, plastic, bright paint, neon signs, cars, screens and electricity.",
    living: "It is today's world: concrete, glass, cars and neon.",
    venues: {
      home: 'home', cafe: 'café', restaurant: 'restaurant', bakery: 'bakery', bar: 'bar', club: 'club', shop: 'shop', market: 'market', workshop: 'workshop', apartments: 'apartments', gym: 'gym', park: 'park', library: 'library', florist: 'florist', venue: 'events venue', decor: 'decoration',
    },
  },
  {
    id: 'future',
    name: 'the Wasteland',
    head: { title: 'Overseer', look: look({ shirt: '#6b5a44', pants: '#4a4238', hat: 'helmet', hatColor: '#7a6a52', accessory: 'glasses', accessoryColor: '#c98a3a' }) },
    design:
      'The Wasteland: the modern world has fallen and the town is rebuilt from its ruins: rusty corrugated sheet metal, scrap timber, shipping containers, old tyres, cracked concrete, sandbags, patched tarps and canvas, bolted plates, pipes, oil drums, junk wind turbines, fire barrels and strings of dim salvaged bulbs. Dusty, faded colours: rust, ochre, sand, olive drab, oily black, with hand-painted signs. A skyscraper is a teetering tower of stacked containers and scaffolding; a car is a rust-bucket buggy with a roll cage; a café is a ration counter under a tarp; a dog is a scruffy mutt in a patched harness.',
    living: 'The old world has fallen: builds are scrap metal, containers, tyres and tarps, and people scavenge; places are what survivors make of them (a café is a ration counter, a bar a saloon, a shop a trading post).',
    venues: {
      home: 'shack', cafe: 'ration counter', restaurant: 'mess hall', bakery: 'drum oven', bar: 'saloon', club: 'scrap rave', shop: 'trading post', market: 'swap meet', workshop: 'scrapyard', apartments: 'container stacks', gym: 'fight pit', park: 'survivor garden', library: 'salvage archive', florist: 'seed bank', venue: 'arena', decor: 'totem',
    },
    palette: { anchors: [18, 32, 46, 85, 190], pull: 0.65, satCap: 0.38, neutral: 30, neutralSat: 0.06, light: [0.16, 0.7] },
    hats: { allowed: ['none', 'helmet', 'cap', 'beanie', 'bucket', 'cowboy', 'headband', 'crown'], fallback: 'beanie' },
  },
];

export const clampAge = (n: unknown): number => {
  const v = Math.round(Number(n));
  return Number.isFinite(v) ? Math.max(0, Math.min(LAST_AGE, v)) : MODERN;
};
export const ageStyle = (age: number | undefined): AgeStyle => AGES[clampAge(age ?? MODERN)];
/** The age's world rules from the design board (src/shared/ageBibles.json, design/export.mjs): the design call's direction comes from here when the board has one. */
const BOARD = BIBLES as unknown as { id: AgeId; summary?: string; designDirection?: string }[];
for (const a of AGES) {
  const b = BOARD.find((x) => x.id === a.id);
  if (b?.designDirection) a.design = `${a.name[0].toUpperCase()}${a.name.slice(1)}: ${b.designDirection}`;
}
/** "stone", "Bronze Age", "3", "future", "wasteland" → an age index; undefined when it names none. */
export function parseAge(text: string): number | undefined {
  const s = text.trim().toLowerCase();
  if (/^\d$/.test(s)) return Number(s) <= LAST_AGE ? Number(s) : undefined;
  const i = AGES.findIndex((a) => s.includes(a.id) || s === a.name.toLowerCase() || (a.id === 'medieval' && /middle|dark/.test(s)) || (a.id === 'future' && /waste|apocal/.test(s)));
  return i >= 0 ? i : undefined;
}
/** What a kind of place is called in an age: "fire pit". */
export const venueName = (age: number | undefined, kind: VenueKind): string => ageStyle(age).venues[kind];

// ---- the colour swap ------------------------------------------------------------------------------
function hexToHsl(hex: string): [number, number, number] | undefined {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return undefined;
  const n = parseInt(m[1], 16);
  const r = ((n >> 16) & 255) / 255,
    g = ((n >> 8) & 255) / 255,
    b = (n & 255) / 255;
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b),
    l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}
function hslToHex(h: number, s: number, l: number): string {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const to = (x: number) => Math.round(Math.max(0, Math.min(1, x)) * 255).toString(16).padStart(2, '0');
  return `#${to(f(0))}${to(f(8))}${to(f(4))}`;
}
const hueGap = (a: number, b: number) => ((b - a + 540) % 360) - 180;

/**
 * A colour as this age would make it: pulled toward the age's hues, its saturation capped, its
 * lightness squeezed into the age's range. Pure and deterministic, so every page and every reload
 * agree. The Modern age (no palette) leaves colours as they are.
 */
export function restyleColour(hex: string, age: number): { color: string; glow: boolean } {
  const p = ageStyle(age).palette;
  const hsl = p && hexToHsl(hex);
  if (!p || !hsl) return { color: hex, glow: false };
  const [h0, s0, l0] = hsl;
  let h: number, s: number;
  if (s0 < 0.12) {
    h = p.neutral;
    s = p.neutralSat;
  } else {
    const anchor = p.anchors.reduce((best, a) => (Math.abs(hueGap(h0, a)) < Math.abs(hueGap(h0, best)) ? a : best), p.anchors[0]);
    h = (h0 + hueGap(h0, anchor) * p.pull + 360) % 360;
    s = Math.min(s0, p.satCap);
  }
  const l = p.light[0] + l0 * (p.light[1] - p.light[0]);
  return { color: hslToHex(h, s, l), glow: !!p.glow && s0 > 0.55 && l0 > 0.45 };
}

/** What someone wears in an age: their colours swapped like a build's, and a hat from the period. Skin, hair and shape stay theirs; `who` adds the age's garment kit for them. */
export function dressFor(l: DudeLook, age: number, who?: { id: string; role?: 'head' | 'leader' | 'daughter' }): DudeLook {
  const a = ageStyle(age);
  // The age's garment kit over the top (src/shared/outfits.ts), chosen by who they are.
  const outfit = who ? outfitFor(age, who.id, who.role) : undefined;
  const kit = outfit ? { outfit } : {};
  if (!a.palette && !a.hats) return { ...l, ...kit };
  const c = (hex: string) => restyleColour(hex, age).color;
  return {
    ...l,
    ...kit,
    shirt: c(l.shirt),
    pants: c(l.pants),
    hatColor: c(l.hatColor),
    accessoryColor: c(l.accessoryColor),
    hat: !a.hats || a.hats.allowed.includes(l.hat) ? l.hat : a.hats.fallback,
  };
}
