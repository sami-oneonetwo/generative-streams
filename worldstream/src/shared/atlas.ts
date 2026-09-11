import type { Catalogue, SpriteDef } from './catalogue.js';
import type { CharacterMode } from './state.js';

/** A frame of pixels: each row is a string of palette keys ('.' = transparent). */
export interface PixelFrame {
  w: number;
  h: number;
  rows: string[];
}

/** Sprites the renderer draws from code rather than pixels (they size to their text). */
export type Procedural = 'neon_sign' | 'holo_screen' | 'graffiti' | 'cables';

export interface AtlasSprite extends SpriteDef {
  frames?: PixelFrame[];
  procedural?: Procedural | string;
}

export interface FontData {
  w: number;
  h: number;
  /** Glyph rows of '#' and '.' for each character. */
  glyphs: Record<string, string[]>;
}

/** Catalogue plus pixel data, built by scripts/pack.ts and sent in the hello message. */
export interface Atlas extends Catalogue {
  /** Palette key -> hex colour; '.' maps to ''. */
  keys: Record<string, string>;
  sprites: AtlasSprite[];
  font: FontData;
  character: Partial<Record<CharacterMode, PixelFrame[]>>;
}

export function isAtlas(c: Catalogue): c is Atlas {
  return 'keys' in c && 'font' in c && 'character' in c;
}

export const FONT_ADVANCE = 6; // 5px glyph + 1px gap

/** Width of a text-bearing procedural sprite for the given text. */
export function textSpriteWidth(def: SpriteDef, text: string | undefined): number {
  if (!def.acceptsText || !text) return def.w;
  return Math.max(def.w, text.length * FONT_ADVANCE + 8);
}
