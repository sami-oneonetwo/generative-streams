// What the game ships, for the design board (FK-004): each age's world rules (src/shared/ageBibles.json),
// the town's pieces as the town draws them (client/dudes/agePieces.json: design/export.mjs leaves the
// big ground slabs and the kerb strips to the town) and the garment kits (src/shared/ageOutfits.json).
// With --shipped, design/render.mjs and render-outfits.mjs draw from these instead of design/spec, so
// a board Sami reviews shows the game as it is, not a design round nobody has exported yet.
import BIBLES from '../src/shared/ageBibles.json';
import PIECES from '../client/dudes/agePieces.json';
import OUTFITS from '../src/shared/ageOutfits.json';
import { AGE_IDS, type AgeId } from '../src/shared/ages';
import type { AgeOutfits } from '../src/shared/outfits';
import type { Primitive } from '../src/shared/objectTypes';

export interface ShippedPiece {
  name: string;
  parts: (Primitive & { glow?: boolean })[];
}
/** One age as the game has it: the board reads `bible` and `pieces` like design/spec, and draws people from `outfits`. */
export interface ShippedAge {
  id: AgeId;
  index: number;
  bible: { id: string; name: string; summary?: string } & Record<string, unknown>;
  pieces: Record<string, ShippedPiece>;
  outfits: AgeOutfits;
}

const bibles = BIBLES as unknown as ShippedAge['bible'][];
const pieces = PIECES as unknown as Record<string, Record<string, ShippedPiece>>;
const outfits = OUTFITS as unknown as Record<string, AgeOutfits>;

export function shippedAges(): ShippedAge[] {
  return AGE_IDS.map((id, index) => {
    const bible = bibles.find((b) => b.id === id);
    if (!bible) throw new Error(`src/shared/ageBibles.json has no ${id}`);
    return { id, index, bible, pieces: pieces[id] ?? {}, outfits: outfits[id] ?? { kits: [] } };
  });
}
