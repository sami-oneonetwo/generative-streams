// What people wear in each age (docs/ages.md): garment kits designed on the design board by
// gpt-6-astra (design/spec/<age>/outfits.json, exported to src/shared/ageOutfits.json). A kit is a
// handful of low-poly parts hung on the figure's bones, coloured by role so everyone's own colours
// still show through (a chatter's shirt colour becomes their fur tunic, their tabard, their coat),
// and may set aside base pieces (shoes in the Stone Age, a hat under the King's crown). Everyone gets
// one of the age's kits by their id; the town's head and the caravan leader have their own.
// The server only picks the kit (`outfitFor`); the page draws it (client/dudes/dudes.ts compose).
import OUTFITS from './ageOutfits.json';
import { AGE_IDS } from './ages';

export const OUTFIT_BONES = ['hips', 'head', 'armL', 'armR', 'legL', 'legR', 'cape'] as const;
export type OutfitBone = (typeof OUTFIT_BONES)[number];
/** Base pieces a kit can set aside: trousers, sleeves and shoes become bare skin; hair and the hat and accessory go. */
export const OUTFIT_HIDES = ['shoes', 'sleeves', 'trousers', 'hair', 'hat', 'accessory'] as const;
export type OutfitHide = (typeof OUTFIT_HIDES)[number];
export interface OutfitPart {
  bone: OutfitBone;
  shape: 'box' | 'cylinder' | 'sphere' | 'cone';
  position: [number, number, number];
  size: [number, number, number];
  rotation: [number, number, number];
  /** A role from the wearer's look (shirt, pants, hat, accent, skin, hair; ":dark" or ":light" for a shade of it) or a fixed "#rrggbb". */
  colour: string;
}
export interface Outfit {
  name: string;
  hide?: OutfitHide[];
  parts: OutfitPart[];
}
export interface AgeOutfits {
  kits: Outfit[];
  head?: Outfit;
  leader?: Outfit;
}
const ALL = OUTFITS as unknown as Partial<Record<(typeof AGE_IDS)[number], AgeOutfits>>;

const hash = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
};
/** The caravan daughter's kit in each age (docs/ages.md): an everyday kit that covers her up (some
 * leave the chest bare), and suits a child growing into a young woman. */
const DAUGHTER_KITS: Partial<Record<(typeof AGE_IDS)[number], number>> = { stone: 2, bronze: 0, medieval: 3, industrial: 3, modern: 1, future: 3 };
/** The kit someone wears in an age, as a key the page resolves ("stone:2", "medieval:head"); undefined when the age has none. */
export function outfitFor(age: number, id: string, role?: 'head' | 'leader' | 'daughter'): string | undefined {
  const ageId = AGE_IDS[age];
  const o = ageId ? ALL[ageId] : undefined;
  if (!o) return undefined;
  if (role === 'daughter') {
    const k = DAUGHTER_KITS[ageId];
    if (k !== undefined && o.kits?.[k]) return `${ageId}:${k}`;
  } else if (role && o[role]) return `${ageId}:${role}`;
  return o.kits?.length ? `${ageId}:${hash(id) % o.kits.length}` : undefined;
}
export function outfitByKey(key: string | undefined): Outfit | undefined {
  if (!key) return undefined;
  const [ageId, which] = key.split(':');
  const o = ALL[ageId as (typeof AGE_IDS)[number]];
  if (!o) return undefined;
  return which === 'head' || which === 'leader' ? o[which] : o.kits?.[Number(which)];
}
