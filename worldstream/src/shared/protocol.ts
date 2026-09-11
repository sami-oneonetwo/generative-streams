import type { AtlasSprite } from './atlas.js';
import type { Catalogue } from './catalogue.js';
import type { VIEW, World, WorldState } from './state.js';
import type { Wardrobe } from './wardrobe.js';

export type ServerMessage =
  | { type: 'hello'; worlds: Partial<Record<World, Catalogue>>; world: World; character: { name: string }; view: typeof VIEW; ui?: { meters: boolean }; wardrobe?: Wardrobe }
  | { type: 'state'; state: WorldState; now: number }
  | { type: 'atlas_add'; world: World; sprite: AtlasSprite }
  | { type: 'atlas_remove'; world: World; name: string }
  | { type: 'toast'; text: string; at: number };

export type ClientMessage = { type: 'ping' };
