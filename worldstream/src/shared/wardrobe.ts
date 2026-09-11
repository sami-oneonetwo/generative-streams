// The character's wardrobe: garments recoloured by palette key, and accessories
// drawn over (or behind) the base frames at fixed offsets. Shared by the server
// (parsing what chat asks for) and the renderer (composing the dressed frames).
import type { PixelFrame } from './atlas.js';

/** Garments that are part of the base drawing; changing one is a palette swap. */
export const COLOUR_SLOTS = ['coat', 'hood', 'scarf', 'boots'] as const;
export type ColourSlot = (typeof COLOUR_SLOTS)[number];

/** Places an accessory can go. One item per slot. */
export const ITEM_SLOTS = ['head', 'face', 'back', 'hand'] as const;
export type ItemSlot = (typeof ITEM_SLOTS)[number];

/** Base-frame palette key each garment is drawn with. */
export const SLOT_KEYS: Record<ColourSlot, string> = { coat: '9', hood: 'a', scarf: 'h', boots: '8' };

/** Clothing colours are world-independent so an outfit survives travel. */
export const CLOTHING_COLOURS: Record<string, string> = {
  red: '#ff3b3b',
  crimson: '#b0165a',
  orange: '#ff8a3d',
  amber: '#ffb347',
  yellow: '#ffe066',
  gold: '#e0b400',
  green: '#2fbf71',
  lime: '#7cff4f',
  teal: '#00a3b8',
  cyan: '#00e5ff',
  blue: '#4f7cff',
  navy: '#26205e',
  purple: '#8b5cf6',
  lilac: '#c4a7ff',
  pink: '#ff5fa2',
  magenta: '#ff2bd6',
  white: '#f4f4ff',
  grey: '#6e6e96',
  black: '#0b0a1e',
  brown: '#5c3a1e',
  sand: '#e0c9a6',
};

const COLOUR_ALIASES: Record<string, string> = {
  scarlet: 'red', ruby: 'red', maroon: 'crimson', wine: 'crimson', burgundy: 'crimson',
  tangerine: 'orange', mustard: 'amber', golden: 'gold', lemon: 'yellow',
  emerald: 'green', forest: 'green', neon: 'lime', mint: 'lime', turquoise: 'teal', aqua: 'cyan', sky: 'cyan',
  azure: 'blue', cobalt: 'blue', indigo: 'navy', violet: 'purple', lavender: 'lilac', rose: 'pink', hot: 'magenta', fuchsia: 'magenta',
  silver: 'grey', gray: 'grey', charcoal: 'black', dark: 'black', tan: 'sand', beige: 'sand', cream: 'sand', khaki: 'sand', chocolate: 'brown',
};

const SLOT_ALIASES: Record<string, ColourSlot> = {
  coat: 'coat', jacket: 'coat', robe: 'coat', cloak: 'coat', shirt: 'coat', hoodie: 'coat', outfit: 'coat', clothes: 'coat', suit: 'coat', top: 'coat', body: 'coat',
  hood: 'hood', hair: 'hood', head: 'hood',
  scarf: 'scarf', bandana: 'scarf', neck: 'scarf', collar: 'scarf',
  boots: 'boots', boot: 'boots', shoes: 'boots', shoe: 'boots', feet: 'boots', sneakers: 'boots', trainers: 'boots',
};

const ITEM_SLOT_WORDS: Record<string, ItemSlot> = { hat: 'head', helmet: 'head', headwear: 'head', glasses: 'face', shades: 'face', accessory: 'hand', weapon: 'hand', cape: 'back', backpack: 'back', wings: 'back' };

export interface Outfit {
  /** Colour name per garment; omitted means the base drawing. 'none' hides the scarf. */
  colours?: Partial<Record<ColourSlot, string>>;
  items?: Partial<Record<ItemSlot, { name: string; colour?: string }>>;
}

export interface WardrobeItem {
  name: string;
  slot: ItemSlot;
  aliases: string[];
  tags: string[];
  frame: PixelFrame;
  /** Offset of the item's top-left from the character frame's top-left. */
  dx: number;
  dy: number;
  /** Drawn behind the character instead of over it. */
  behind?: boolean;
  /** Default colour name for the item's tintable ('X') pixels; absent means the item is not tintable. */
  tint?: string;
}

/** Built by scripts/pack.ts from assets/character/wardrobe, sent in the hello message. */
export interface Wardrobe {
  /** Wardrobe palette key -> hex. 'X' is the tint key and maps to ''. */
  keys: Record<string, string>;
  items: WardrobeItem[];
}

export type WearAction =
  | { kind: 'colour'; slot: ColourSlot; colour: string }
  | { kind: 'item'; item: WardrobeItem; colour?: string }
  | { kind: 'remove'; slot: ColourSlot | ItemSlot | 'all' }
  | { kind: 'unknown'; text: string };

const norm = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9\s_-]/g, '').replace(/[\s_-]+/g, ' ').trim();
const FILLER = /\b(a|an|the|some|his|him|he|please|pls|on|to|with|wear|wearing|dress|dressed|in|into|up|put|give|make|get|for|me|my|new|nice|little|big|cool|fancy)\b/g;

export function colourNamed(word: string): string | undefined {
  const w = norm(word);
  if (!w) return undefined;
  if (CLOTHING_COLOURS[w]) return w;
  return COLOUR_ALIASES[w];
}

export function findItem(wardrobe: Wardrobe, query: string, rnd: () => number = Math.random): WardrobeItem | undefined {
  const q = norm(query).replace(/s$/, '');
  if (!q) return undefined;
  const flat = (s: string) => norm(s).replace(/s$/, '');
  const exact = wardrobe.items.find((i) => flat(i.name) === q || i.aliases.some((a) => flat(a) === q));
  if (exact) return exact;
  const head = q.split(' ').pop()!;
  const byHead = wardrobe.items.find((i) => flat(i.name) === head || i.aliases.some((a) => flat(a) === head));
  if (byHead) return byHead;
  const tagHits = wardrobe.items.filter((i) => i.tags.some((t) => flat(t) === head || flat(t) === q));
  if (tagHits.length) return tagHits[Math.floor(rnd() * tagHits.length)];
  return undefined;
}

/**
 * Turn "red coat", "top hat", "a green cape", "hat", "no scarf" into an action.
 * `off` means the viewer asked to take something off.
 */
export function resolveWear(wardrobe: Wardrobe, text: string, off = false, rnd: () => number = Math.random): WearAction {
  let t = norm(text).replace(FILLER, ' ').replace(/\s+/g, ' ').trim();
  if (/^(nothing|none|default|reset|normal|usual|everything|all|it all|clothes)?$/.test(t)) return off || t ? { kind: 'remove', slot: 'all' } : { kind: 'unknown', text };
  const noMatch = /^(no|off|without|remove|lose|drop|ditch)\s+(.+)$/.exec(t);
  if (noMatch) {
    off = true;
    t = noMatch[2];
  }
  const words = t.split(' ');
  let colour: string | undefined;
  const rest: string[] = [];
  for (const w of words) {
    const c = colourNamed(w);
    if (c && !colour) colour = c;
    else rest.push(w);
  }
  const noun = rest.join(' ').trim();
  const nounHead = noun.split(' ').pop() ?? '';
  const colourSlot = SLOT_ALIASES[noun] ?? SLOT_ALIASES[nounHead] ?? SLOT_ALIASES[noun.replace(/s$/, '')];

  if (off) {
    if (colourSlot) return { kind: 'remove', slot: colourSlot };
    const item = findItem(wardrobe, noun, rnd);
    if (item) return { kind: 'remove', slot: item.slot };
    const slotWord = ITEM_SLOT_WORDS[noun] ?? ITEM_SLOT_WORDS[nounHead] ?? ITEM_SLOT_WORDS[noun.replace(/s$/, '')];
    if (slotWord) return { kind: 'remove', slot: slotWord };
    if (!noun && colour) return { kind: 'remove', slot: 'all' };
    return { kind: 'unknown', text };
  }

  if (colourSlot && colour) return { kind: 'colour', slot: colourSlot, colour };
  if (colourSlot && !colour) return { kind: 'unknown', text };
  const item = noun ? findItem(wardrobe, noun, rnd) : undefined;
  if (item) return { kind: 'item', item, colour: item.tint ? colour : undefined };
  if (!noun && colour) return { kind: 'colour', slot: 'coat', colour };
  return { kind: 'unknown', text };
}

/** Apply an action to an outfit, returning the new outfit (or the same reference when nothing changes). */
export function applyWear(outfit: Outfit | undefined, action: WearAction): Outfit | undefined {
  const cur: Outfit = { colours: { ...(outfit?.colours ?? {}) }, items: { ...(outfit?.items ?? {}) } };
  switch (action.kind) {
    case 'colour':
      if (cur.colours![action.slot] === action.colour) return outfit;
      cur.colours![action.slot] = action.colour;
      break;
    case 'item': {
      const have = cur.items![action.item.slot];
      if (have && have.name === action.item.name && (have.colour ?? undefined) === (action.colour ?? undefined)) return outfit;
      cur.items![action.item.slot] = action.colour ? { name: action.item.name, colour: action.colour } : { name: action.item.name };
      break;
    }
    case 'remove':
      if (action.slot === 'all') return outfit && (Object.keys(outfit.colours ?? {}).length || Object.keys(outfit.items ?? {}).length) ? undefined : outfit;
      if ((COLOUR_SLOTS as readonly string[]).includes(action.slot)) {
        const slot = action.slot as ColourSlot;
        if (slot === 'scarf') {
          if (cur.colours!.scarf === 'none') return outfit;
          cur.colours!.scarf = 'none';
        } else {
          if (!cur.colours![slot]) return outfit;
          delete cur.colours![slot];
        }
      } else {
        const slot = action.slot as ItemSlot;
        if (!cur.items![slot]) return outfit;
        delete cur.items![slot];
      }
      break;
    case 'unknown':
      return outfit;
  }
  return tidy(cur);
}

export function tidy(o: Outfit): Outfit | undefined {
  const colours = Object.fromEntries(Object.entries(o.colours ?? {}).filter(([, v]) => v)) as Outfit['colours'];
  const items = Object.fromEntries(Object.entries(o.items ?? {}).filter(([, v]) => v)) as Outfit['items'];
  const out: Outfit = {};
  if (colours && Object.keys(colours).length) out.colours = colours;
  if (items && Object.keys(items).length) out.items = items;
  return Object.keys(out).length ? out : undefined;
}

export const pretty = (s: string) => s.replace(/_/g, ' ');

/** "red coat, no scarf, top hat, sunglasses" or "his usual clothes". */
export function describeOutfit(o: Outfit | undefined): string {
  if (!o) return 'his usual clothes';
  const parts: string[] = [];
  for (const slot of COLOUR_SLOTS) {
    const c = o.colours?.[slot];
    if (c === 'none') parts.push(`no ${slot}`);
    else if (c) parts.push(`${c} ${slot}`);
  }
  for (const slot of ITEM_SLOTS) {
    const it = o.items?.[slot];
    if (it) parts.push(`${it.colour ? it.colour + ' ' : ''}${pretty(it.name)}`);
  }
  return parts.length ? parts.join(', ') : 'his usual clothes';
}

/** The base palette with the outfit's garment colours swapped in. */
export function characterKeys(base: Record<string, string>, outfit: Outfit | undefined): Record<string, string> {
  if (!outfit?.colours) return base;
  const keys = { ...base };
  for (const slot of COLOUR_SLOTS) {
    const c = outfit.colours[slot];
    if (!c) continue;
    keys[SLOT_KEYS[slot]] = c === 'none' ? '' : (CLOTHING_COLOURS[c] ?? keys[SLOT_KEYS[slot]]);
  }
  return keys;
}

/** The wardrobe palette with the tint key set for one item. */
export function itemKeys(wardrobe: Wardrobe, item: WardrobeItem, colour: string | undefined): Record<string, string> {
  const tint = CLOTHING_COLOURS[colour ?? item.tint ?? ''] ?? '';
  return { ...wardrobe.keys, X: tint };
}

/** Bounds of the composed (dressed) frame around a base frame: room for hats above and things held out to the side. */
export const DRESS_PAD = { x: 8, top: 8 } as const;
