import type { Layer, Weather, World } from './state.js';

/** One addable sprite. Until the atlas exists, `colour` drives a placeholder. */
export interface SpriteDef {
  name: string;
  /** Allowed layers; the first is the default placement. */
  layers: Layer[];
  w: number;
  h: number;
  colour: string;
  tags: string[];
  aliases?: string[];
  acceptsText?: boolean;
  /** Frame count for animated sprites. */
  animated?: number;
  /** Drawn by the renderer from code instead of pixels (see atlas.ts). */
  procedural?: string;
  /** Which way the art faces; moving things are flipped to match their direction. */
  faces?: 'l' | 'r';
  /** Only the world places this (e.g. the train), chat cannot add it. */
  ambientOnly?: boolean;
  /** How this thing moves about on its own once placed. */
  behaviour?: Behaviour;
  /** Pixels per second for its behaviour. */
  speed?: number;
  /** Things it says when the character is near. */
  lines?: string[];
  /** Eaten once and gone, rather than a stand that keeps serving. */
  consumable?: boolean;
  /** Drawn by the model at a viewer's request, not by hand. */
  generated?: boolean;
}

/** How this world wears the character down and what restores them. Rates are points per second. */
export interface SurvivalDef {
  comfort: 'warmth' | 'water';
  comfortDrain: { base: number; night: number; day: number; rain: number; storm: number; fog: number };
  comfortTags: string[];
  foodTags: string[];
  restTags: string[];
  spiritTags: string[];
}

export type Behaviour = 'wander' | 'patrol' | 'flee' | 'visit' | 'perch';

/** A scheduled ambient event: a sprite that crosses the scene on its own. */
export interface AmbientDef {
  name: string;
  sprite: string;
  layer: Layer;
  /** Fixed y, or a range to pick from. */
  y: number | [number, number];
  from: number;
  to: number;
  durationMs: number;
  /** Min and max gap between occurrences. */
  everyMs: [number, number];
  /** Things the character might say when it happens. */
  lines?: string[];
  /** Spawned when the character leaves this world (the train, the caravan). */
  departure?: boolean;
}

/** What the character says, per world. Templates take {user}, {thing}, {text}. */
export interface Lines {
  ambient?: string[];
  weather?: Partial<Record<Weather, string[]>>;
  added?: string[];
  addedText?: string[];
  removed?: string[];
}

/** One piece of a build, placed relative to the build's anchor. */
export interface BuildItem {
  sprite: string;
  dx: number;
  /** Sign text; "{name}" becomes the viewer's name when built for someone. */
  text?: string;
}

/** A small composition the character builds and shows off. */
export interface BuildDef {
  name: string;
  aliases?: string[];
  items: BuildItem[];
  /** Only used for welcome builds, never picked for showcases. */
  welcome?: boolean;
}

export interface Catalogue {
  world: World;
  palette: string[];
  sprites: SpriteDef[];
  weatherWeights?: Partial<Record<Weather, number>>;
  ambient?: AmbientDef[];
  lines?: Lines;
  survival?: SurvivalDef;
  builds?: BuildDef[];
}

export function normaliseName(q: string): string {
  return q
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s_-]/g, '')
    .replace(/[\s-]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/** Resolve free text ("neon sign", "cats", "kitty") to a sprite chat may add. */
export function findSprite(cat: Catalogue, query: string): SpriteDef | undefined {
  const q = normaliseName(query);
  if (!q) return undefined;
  const pool = cat.sprites.filter((s) => !s.ambientOnly);
  const candidates = new Set([q, q.replace(/s$/, ''), q.replace(/es$/, ''), q.replace(/ies$/, 'y')]);
  for (const c of candidates) {
    const hit = pool.find((s) => s.name === c || (s.aliases ?? []).some((a) => normaliseName(a) === c));
    if (hit) return hit;
  }
  const head = q.split('_').pop()!;
  const byHead = pool.find((s) => s.name === head);
  if (byHead) return byHead;
  const tagHits = pool.filter((s) => s.tags.includes(head));
  return tagHits.length === 1 ? tagHits[0] : undefined;
}
