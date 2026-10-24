// The Finders Keepers pieces the design board makes (docs/story-bible-2026-10-24.md, board/design-system.md):
// each age's Folly, the band and the head in every age, and the pets. Data, prompts' facts and the
// checks that run on what astra sends back; zero AI and no files, so scripts/design-story.test.ts can
// test it. design/astra.ts makes the calls (`folly`, `cast`, `pets`) and writes design/spec/{folly,cast,pets}.
// Nothing here runs in the game; the engineering cards read the specs it writes (FK-016, FK-023, FK-027).
import { AGES, AGE_IDS, type AgeId } from '../src/shared/ages';
import { ACCESSORIES, HATS, type Accessory, type DudeLook, type Hat } from '../src/shared/dudesTypes';
import { OUTFIT_BONES, OUTFIT_HIDES, type Outfit, type OutfitHide, type OutfitPart } from '../src/shared/outfits';
import { blueprintBounds } from '../src/worlds/ai-dudes/blueprint';
import type { Blueprint, Primitive } from '../src/shared/objectTypes';

// ---- colours ---------------------------------------------------------------------------------------
/** The locked story colours (design-system.md §2): they skip restyleColour in every age and mean one thing each. */
export const STORY = { red: '#B3262E', redDeep: '#7A1419', gold: '#FFC633', goldDeep: '#A86E00', ink: '#1E1914', cream: '#FFF6E0' } as const;

function hsl(hex: string): [number, number, number] | undefined {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
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
/** Would a viewer read this as the red side's red? A saturated mid red (the hide browns, ochres and oranges are not). */
export function readsRed(hex: string): boolean {
  const c = hsl(hex);
  return !!c && (c[0] >= 345 || c[0] <= 8) && c[1] >= 0.45 && c[2] >= 0.2 && c[2] <= 0.62;
}
/** Would a viewer read this as the gold side's gold? A bright saturated yellow-gold (bronze browns and sand are not). */
export function readsGold(hex: string): boolean {
  const c = hsl(hex);
  return !!c && c[0] >= 38 && c[0] <= 54 && c[1] >= 0.7 && c[2] >= 0.45 && c[2] <= 0.75;
}
const same = (a: string, b: string) => a.trim().toLowerCase() === b.toLowerCase();

/**
 * The story in a paragraph, for every Finders Keepers call: who the head is, what the Folly is for,
 * and what red and gold mean. The model is told it, so it never spends a story colour on decoration.
 */
export const STORY_TEXT = `The story (Finders Keepers): the town's head (the streamer's character: ${AGES.map((a) => a.head.title).join(', ')}, one title per age) keeps building monuments to himself on other people's ground: one Folly per age, put up under a tarp behind a gold cordon and unveiled to the whole town, and it stays standing for the rest of the run as evidence against him. He is a vain, funny idiot, never cruel: his selfishness is in what he builds. The travelling band whose camp he took (Wren, her father Ash, Old Moss, Oak the builder and the boy Kit) keep count; Wren leads them. Story colours are locked and mean one thing each: red ${STORY.red} is Wren and her side, gold ${STORY.gold} is the head, his side and his Folly. Nothing else uses them as a main colour.`;

// ---- parts -----------------------------------------------------------------------------------------
/** A board part: the game's primitive, plus a light flag and, on story pieces, a hero tag the engine finds it by. */
export interface StoryPart extends Primitive {
  glow?: boolean;
  tag?: string;
}
const SHAPES = ['box', 'cylinder', 'sphere', 'cone'] as const;
const vec3 = (a: unknown, d: number): [number, number, number] =>
  Array.isArray(a) && a.length === 3 && a.every((n) => Number.isFinite(Number(n))) ? (a.map(Number) as [number, number, number]) : [d, d, d];
/**
 * A model's parts made safe to draw: a known shape, three numbers for each vector, sizes at least
 * 0.02 m, a #rrggbb colour, at most `max`. A tag survives only if it is one of `tags`. `fixed` counts
 * parts that needed a shape or colour, `dropped` the ones over `max`, `untagged` the unknown tags removed.
 */
export function cleanParts(raw: unknown, max = 160, tags: readonly string[] = []): { parts: StoryPart[]; fixed: number; dropped: number; untagged: number } {
  const list = Array.isArray(raw) ? raw.filter((p): p is Record<string, unknown> => !!p && typeof p === 'object') : [];
  let fixed = 0,
    untagged = 0;
  const parts = list.slice(0, max).map((p) => {
    const shape = SHAPES.includes(p.shape as (typeof SHAPES)[number]) ? (p.shape as StoryPart['shape']) : (fixed++, 'box');
    const color = typeof p.color === 'string' && /^#[0-9a-f]{6}$/i.test(p.color) ? p.color : (fixed++, '#8f8a82');
    const out: StoryPart = { shape, position: vec3(p.position, 0), size: vec3(p.size, 0.3).map((n) => Math.max(0.02, Math.abs(n))) as [number, number, number], rotation: vec3(p.rotation, 0), color };
    if (p.glow === true) out.glow = true;
    if (typeof p.tag === 'string' && p.tag) {
      if (tags.includes(p.tag)) out.tag = p.tag;
      else untagged++;
    }
    return out;
  });
  return { parts, fixed, dropped: Math.max(0, list.length - max), untagged };
}
const bounds = (parts: StoryPart[]) => blueprintBounds({ name: '', description: '', parts } as Blueprint);

// ---- the Follies -----------------------------------------------------------------------------------
export interface Folly {
  /** The title on the Unveiling card. */
  name: string;
  brief: string;
  /** The room on the Folly plot (STORY_SITES.folly is 16×16 m in M1): |x|,|z| ≤ half, 0 ≤ y ≤ height. */
  half: number;
  height: number;
  /** Hero parts the engine finds by tag (a door to frame, a deck to raise, a belt to run), with what each is. */
  tags: Record<string, string>;
  /** Tags that must be on at least one part. */
  required: string[];
  /** The only tags whose parts may be story gold or story red (design-system.md §2: they mean something). */
  gold: string[];
  red?: string[];
}
/** One Folly per age (story bible §3). Every one faces +Z, the camera's side (src/worlds/ai-dudes/design.ts:33). */
export const FOLLIES: Record<AgeId, Folly> = {
  stone: {
    name: 'The Big Hut',
    brief: `The Chief's Big Hut, on the camp plot where the band's settlement stood. A huge, pompous hut with a comically tiny door (0.6 m wide, 1 m tall) in the middle of its +Z front. It is made of the band's own things: their carved post with a red handprint (${STORY.red}) is his doorpost, their ring of hearth stones is his doormat, their hides and logs are its walls. A gold stick-flag (${STORY.gold}) on the very top and an antler crest over the door. Stone Age materials only (logs, hides, thatch, bone, boulders): no metal, no sawn planks.`,
    half: 7,
    height: 11,
    tags: {
      door: 'the tiny door, 0.6 m wide and 1 m tall, centred on the +Z front',
      plaque: 'a flat slab or board about 1 × 0.6 m beside the door, facing +Z, where the game hangs his name plaque (not gold)',
      flag: 'the gold stick-flag on the very top',
      crown: 'the antler crest over the door',
      handprint: "the red handprints on the band's carved post",
      doormat: "the band's hearth stones laid as his doormat",
    },
    required: ['door', 'plaque', 'flag'],
    gold: ['flag', 'crown'],
    red: ['handprint'],
  },
  bronze: {
    name: 'The Golden Me',
    brief: `A 20 m statue of the High Priest himself, poured in bright bronze from the band's red stone: him in his robes and gold sash (${STORY.gold}) with his tall hat (1.2× the Chief's), one arm raised in a heroic pose, on a stepped mud-brick plinth. The statue is the hero: it rises out of the plinth at the Unveiling, so every statue part is tagged; the plinth stays put.`,
    half: 7,
    height: 21,
    tags: { statue: 'every part of the statue itself (it rises at the Unveiling)', plinth: 'the stepped plinth', plaque: "a plate on the plinth's +Z face", crown: 'his hat' },
    required: ['statue', 'plinth', 'plaque'],
    gold: ['statue', 'crown'],
  },
  medieval: {
    name: 'The Royal Moat',
    brief: `The King's palace inside a moat, between the town and the band's camp: a small, showy keep with towers and gold banners (${STORY.gold}), ringed by moat water. A drawbridge on the +Z side is the hero: it rises behind the King at the Unveiling and cuts the camp off ("A bridge that only opens for me"). Make the drawbridge one flat deck lying across the moat with its hinge at the palace end, and its chains.`,
    half: 8,
    height: 13,
    tags: { drawbridge: 'the flat deck that rises (the game hinges it at the palace end)', chain: 'the drawbridge chains', water: 'the moat water', flag: 'the gold banners', crown: 'a gold crown on the keep', plaque: 'a plate by the gate, facing +Z' },
    required: ['drawbridge', 'water', 'flag', 'plaque'],
    gold: ['flag', 'crown'],
  },
  industrial: {
    name: 'The Bust Works',
    brief: `The Alderman's factory that turns out little busts of himself: red brick and iron, a tall chimney, a big arched door on the +Z front and a conveyor belt running out through it with a row of little gold busts (${STORY.gold}) of him riding on it, and a giant bust of him on the roof. The conveyor is the hero: it starts at the Unveiling.`,
    half: 7,
    height: 12,
    tags: { conveyor: 'the belt (the game runs it)', bust: 'the little busts on the belt and the giant one on the roof', chimney: 'the chimney (it smokes)', flag: 'a gold pennant', plaque: 'a plate by the door, facing +Z' },
    required: ['conveyor', 'bust', 'plaque'],
    gold: ['bust', 'flag'],
  },
  modern: {
    name: "The Members' Golf Course",
    brief: `The Mayor's private golf course over the riverbank and the band's camp: a velvet-green fairway and a putting green with the 18th flag (gold, ${STORY.gold}), a white rope fence, a little clubhouse with a bunker hatch in its floor, a blank sign board (the game paints "MEMBERS: 1" on it) and a parked golf cart. Smug and spotless.`,
    half: 8,
    height: 8,
    tags: { flag: 'the 18th flag on its pin', hatch: 'the bunker hatch (he hides down it when the world ends)', sign: 'the blank MEMBERS: 1 board, facing +Z', cart: 'the golf cart', plaque: 'a plate on the clubhouse, facing +Z' },
    required: ['flag', 'hatch', 'sign', 'plaque'],
    gold: ['flag'],
  },
  future: {
    name: 'One Seat',
    brief: `His last Folly is the town's own Wonder: he cordons chat's scrap rocket and puts his name on it. All he adds is one seat for himself: a gold throne (${STORY.gold}) for the rocket's nose, padded scrap and gold paint, a seatbelt, a tiny cup holder. Everything round the gold is wasteland scrap.`,
    half: 2,
    height: 3,
    tags: { seat: 'the throne', belt: 'the seatbelt', plaque: 'a plate on the back of the seat' },
    required: ['seat', 'plaque'],
    gold: ['seat'],
  },
};
/** The three takes a Folly is drawn in, one per variant, so Sami picks between real alternatives. */
export const FOLLY_TAKES = [
  'Played straight: the brief exactly, pompous and symmetrical, a monument to himself.',
  "Cobbled: lopsided and rushed, the borrowed bits obviously other people's (mismatched, patched, still showing who they belonged to).",
  'The joke pushed furthest: the hero detail and his vanity exaggerated as far as it still reads from the stream camera.',
];

export interface FollySpec {
  name: string;
  description: string;
  notes?: string;
  parts: StoryPart[];
  /** Part indices by hero tag. */
  heroes: Record<string, number[]>;
  checks?: string[];
}
/** A Folly variant as astra sent it, cleaned and checked against its room, its hero tags and the story colours. */
export function checkFolly(age: AgeId, raw: unknown): FollySpec {
  const f = FOLLIES[age];
  const r = (raw && typeof raw === 'object' ? raw : {}) as { name?: unknown; description?: unknown; notes?: unknown; parts?: unknown };
  const { parts, fixed, dropped, untagged } = cleanParts(r.parts, 160, Object.keys(f.tags));
  const checks: string[] = [];
  if (!parts.length) checks.push('no parts');
  if (dropped) checks.push(`${dropped} parts over the 160 limit were dropped`);
  if (fixed) checks.push(`${fixed} bad shapes or colours replaced`);
  if (untagged) checks.push(`${untagged} unknown tags removed`);
  const heroes: Record<string, number[]> = {};
  parts.forEach((p, i) => p.tag && (heroes[p.tag] ??= []).push(i));
  const missing = f.required.filter((t) => !heroes[t]);
  if (missing.length) checks.push(`no part tagged ${missing.join(', ')}`);
  if (parts.length) {
    const b = bounds(parts);
    const w = Math.max(-b.minX, b.maxX),
      d = Math.max(-b.minZ, b.maxZ);
    if (w > f.half + 0.05 || d > f.half + 0.05) checks.push(`reaches ${(2 * w).toFixed(1)} × ${(2 * d).toFixed(1)} m (room ${2 * f.half} × ${2 * f.half})`);
    if (b.maxY > f.height + 0.05) checks.push(`${b.maxY.toFixed(1)} m tall (room ${f.height} m)`);
    if (b.minY < -0.15) checks.push(`sinks ${(-b.minY).toFixed(2)} m below the ground`);
  }
  const offGold = parts.filter((p) => same(p.color, STORY.gold) && !f.gold.includes(p.tag ?? '')).length;
  if (offGold) checks.push(`${offGold} parts story gold outside ${f.gold.join('/')}`);
  const offRed = parts.filter((p) => readsRed(p.color) && !(f.red ?? []).includes(p.tag ?? '')).length;
  if (offRed) checks.push(`${offRed} parts read as story red${f.red?.length ? ` outside ${f.red.join('/')}` : ''}`);
  return {
    name: String(r.name ?? f.name).slice(0, 70),
    description: String(r.description ?? '').slice(0, 240),
    ...(r.notes ? { notes: String(r.notes).slice(0, 240) } : {}),
    parts,
    heroes,
    ...(checks.length ? { checks } : {}),
  };
}

// ---- the cast --------------------------------------------------------------------------------------
export const CAST_ROLES = ['wren', 'ash', 'moss', 'oak', 'kit', 'head'] as const;
export type CastRole = (typeof CAST_ROLES)[number];
export interface CastMember {
  /** The name on their tag; the head's is the age's title. */
  name: string;
  /** Their locked colour (design-system.md §2); the head's is gold. */
  colour: string;
  /** Figure scale (the game's look height stays 1; this is the townie's scale, as DAUGHTER_SCALE is today). */
  scale: Partial<Record<AgeId, number>>;
  /** The silhouette that survives every restyle. */
  rule: string;
  /** What they wear or carry in each age; ages missing from `scale` have no one to dress (Ash dies in Bronze). */
  looks: Partial<Record<AgeId, string>>;
  /** What they sit or lie on, per age (drawn as a prop round their feet). */
  props?: Partial<Record<AgeId, string>>;
  /** Locked colours that must show on them. */
  must: string[];
  /** May wear story red / story gold (anyone else doing so is a check failure). */
  red?: boolean;
  gold?: boolean;
}
const every = (n: number): Record<AgeId, number> => Object.fromEntries(AGE_IDS.map((a) => [a, n])) as Record<AgeId, number>;
/** The hat grows every age (story bible, the head's constants): Chief ×1.0 up to Overseer ×2.0. */
export const HAT_LADDER: Record<AgeId, number> = { stone: 1, bronze: 1.2, medieval: 1.4, industrial: 1.6, modern: 1.8, future: 2 };
/** The band and the head, from design-system.md §6 and the story bible's cast table. */
export const CAST: Record<CastRole, CastMember> = {
  wren: {
    name: 'Wren',
    colour: STORY.red,
    scale: { stone: 0.82, bronze: 0.9, medieval: 1, industrial: 1, modern: 1, future: 1 },
    rule: `The daughter, who leads the band. The top third of her silhouette is red ${STORY.red} in every age (hair, headwear and shoulders): her red is the biggest shape in any frame she is in.`,
    looks: {
      stone: 'A teenager: a red hair cord with long tails, a red-ochre shoulder hide, a bone whistle on a cord round her neck.',
      bronze: 'A red headband and a red shawl.',
      medieval: 'A woman now: a big red hood and a short red cape.',
      industrial: 'A red scarf wound high, and a cap.',
      modern: 'A red hoodie, the hood up.',
      future: 'A red bandana and a hooded duster.',
    },
    must: [STORY.red],
    red: true,
  },
  ash: {
    name: 'Ash the hunter',
    colour: '#6E7680',
    scale: { stone: 1.15, bronze: 1.2 },
    rule: "Wren's father and the expedition leader: the tallest of them. Grey-streaked hair and beard #6E7680, a cream bandage on his left leg, a carved staff 2.1 m tall in his right hand, a thin red cord on his wrist (his only red).",
    looks: { stone: 'Back from a hard winter: worn furs, the bandaged left leg, the carved staff.', bronze: 'The same, sick now: thinner, a blanket over his shoulders (the game lays him on his bedroll).' },
    props: { bronze: 'his bedroll: a hide roll and a straw pillow, about 2 × 0.8 m, beside him' },
    must: ['#6E7680'],
    red: true,
  },
  moss: {
    name: 'Old Moss',
    colour: '#4E8A3A',
    scale: every(1),
    rule: 'The elder, always seated. A green shawl #4E8A3A over her head and shoulders, a knotted cord in her lap with one bead-knot per Folly.',
    looks: { stone: 'Furs under the shawl.', bronze: 'Linen under the shawl.', medieval: 'A plain wool gown under the shawl.', industrial: 'A dark dress and apron under the shawl.', modern: 'A cardigan under the shawl.', future: 'Patched layers under the shawl.' },
    props: { stone: 'a tree stump', bronze: 'a clay-brick stool', medieval: 'a wooden bench', industrial: 'an iron chair', modern: 'a folding chair', future: 'an old tyre' },
    must: ['#4E8A3A'],
  },
  oak: {
    name: 'Oak the builder',
    colour: '#E8762B',
    scale: every(1.25),
    rule: 'Big, gentle, built to last: broad shoulders, an orange apron #E8762B (a hi-vis orange vest in the Modern age), a tool belt, and a mallet with a 0.35 m head in his right hand.',
    looks: { stone: 'Hides, the apron in orange-dyed leather, a stone-headed mallet.', bronze: 'A kilt, the apron, a bronze-headed mallet.', medieval: 'A tunic and hose, the apron, an iron mallet.', industrial: 'Shirt sleeves and braces, the apron, a sledgehammer.', modern: 'Work clothes and the hi-vis orange vest, a mallet.', future: 'Scrap armour pieces under the orange apron, a mallet made of a pipe and a block.' },
    must: ['#E8762B'],
  },
  kit: {
    name: 'Kit',
    colour: '#2F6FD0',
    scale: every(0.7),
    rule: `The band's small boy, the head's biggest fan: plain blue #2F6FD0 all over and a 0.16 m gold badge (${STORY.gold}) on his chest. From the Crossing on he wears a tiny blue copy of the Boss's hat.`,
    looks: { stone: 'A blue-dyed hide tunic.', bronze: 'A blue tunic.', medieval: 'A blue tunic and a wooden sword.', industrial: 'A blue jacket and cap.', modern: 'A blue hoodie.', future: 'Captain of the guard: blue scrap armour, a pipe spear.' },
    must: ['#2F6FD0', STORY.gold],
    gold: true,
  },
  head: {
    name: 'the head',
    colour: STORY.gold,
    scale: every(1),
    rule: `The streamer's character. A gold sash ${STORY.gold} in every age and a hat that grows every age (×1.0 Chief, ×1.2 High Priest, ×1.4 King, ×1.6 Alderman, ×1.8 Mayor, ×2.0 Overseer). Never any red anywhere: red is Wren's.`,
    looks: {
      stone: 'The Chief: an antler headdress at ×1.0, the gold sash over his furs.',
      bronze: 'The High Priest: a tall gold-trimmed hat at ×1.2, robes, the gold sash.',
      medieval: 'The King: a crown at ×1.4, a cape (never red), the gold sash.',
      industrial: 'The Alderman: a top hat at ×1.6, a chain of office, the gold sash.',
      modern: 'The Mayor: a hat at ×1.8, a suit, the gold sash.',
      future: 'The Overseer: a scrap helmet at ×2.0, a scrap-plate mantle, the gold sash.',
    },
    must: [STORY.gold],
    gold: true,
  },
};
/** Who is in the cast in an age (Ash dies at the end of Bronze). */
export const castIn = (age: AgeId): CastRole[] => CAST_ROLES.filter((r) => CAST[r].scale[age] !== undefined);

export interface CastLook {
  role: CastRole;
  name: string;
  scale: number;
  /** The head's hat on the ladder. */
  hatScale?: number;
  /** The shipped kit they are pinned on ("stone:2", "stone:head"; src/shared/outfits.ts outfitByKey). */
  base: string;
  /** Fixed colours: never restyled, so the kit's role colours resolve to these in every age. */
  look: DudeLook;
  /** The pinned kit's parts followed by the hand-made ones, ready for the page's compose (client/dudes/dudes.ts). */
  outfit: Outfit;
  /** How many of outfit.parts are hand-made (the last ones). */
  extras: number;
  /** What they sit or lie on, in world metres round their feet. */
  prop?: { name: string; parts: StoryPart[] };
  notes?: string;
  checks?: string[];
}

const ROLE = /^(shirt|pants|hat|accent|skin|hair)(:(dark|light))?$|^#[0-9a-f]{6}$/i;
/** Garment parts made safe, by the same rules design/export.mjs applies to the age kits. */
export function cleanKitParts(raw: unknown, max = 40): OutfitPart[] {
  const list = Array.isArray(raw) ? raw.filter((p): p is Record<string, unknown> => !!p && typeof p === 'object') : [];
  return list
    .filter((p) => OUTFIT_BONES.includes(p.bone as OutfitPart['bone']) && SHAPES.includes(p.shape as OutfitPart['shape']))
    .slice(0, max)
    .map((p) => ({
      bone: p.bone as OutfitPart['bone'],
      shape: p.shape as OutfitPart['shape'],
      position: vec3(p.position, 0),
      size: vec3(p.size, 0.1).map((n) => Math.min(2.5, Math.max(0.01, Math.abs(n)))) as [number, number, number],
      rotation: vec3(p.rotation, 0),
      colour: ROLE.test(String(p.colour ?? '')) ? String(p.colour) : 'shirt',
    }));
}
const hex = (v: unknown, d: string) => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v : d);
/** A cast look's colours as the page resolves them: every role and fixed colour it wears (skin aside). */
export function castColours(c: Pick<CastLook, 'look' | 'outfit'>): string[] {
  const roles: Record<string, string> = { shirt: c.look.shirt, pants: c.look.pants, hat: c.look.hatColor, accent: c.look.accessoryColor, hair: c.look.hair };
  const worn = new Set<string>([c.look.shirt, c.look.pants, c.look.hair]);
  if (c.look.hat !== 'none' && !c.outfit.hide?.includes('hat')) worn.add(c.look.hatColor);
  if (c.look.accessory !== 'none' && !c.outfit.hide?.includes('accessory')) worn.add(c.look.accessoryColor);
  for (const p of c.outfit.parts) {
    const role = p.colour.split(':')[0];
    if (role !== 'skin') worn.add(p.colour.startsWith('#') ? p.colour : (roles[role] ?? c.look.shirt));
  }
  return [...worn];
}

/**
 * One cast member from astra's answer: their pinned kit (base: 0–3 for an everyday kit, "head" or
 * "leader") with the hand-made parts after it, their fixed colours, their scale from the catalogue
 * (never the model's), and the checks for the locked colours. `kits` is the age's shipped kits.
 */
export function composeCast(age: AgeId, role: CastRole, raw: unknown, kits: { kits?: Outfit[]; head?: Outfit; leader?: Outfit } | undefined): CastLook {
  const m = CAST[role];
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const checks: string[] = [];
  const which = r.base === 'head' || r.base === 'leader' ? r.base : Number.isInteger(Number(r.base)) && kits?.kits?.[Number(r.base)] ? Number(r.base) : role === 'head' ? 'head' : 0;
  const pinned = typeof which === 'number' ? kits?.kits?.[which] : kits?.[which];
  if (!pinned) checks.push(`no shipped ${age} kit "${String(r.base ?? which)}" to pin on`);
  const l = (r.look && typeof r.look === 'object' ? r.look : {}) as Record<string, unknown>;
  const look: DudeLook = {
    skin: hex(l.skin, '#d9a27a'),
    hair: hex(l.hair, '#2b2018'),
    shirt: hex(l.shirt, m.colour),
    pants: hex(l.pants, '#5a4532'),
    hat: HATS.includes(l.hat as Hat) ? (l.hat as Hat) : 'none',
    hatColor: hex(l.hatColor, m.colour),
    accessory: ACCESSORIES.includes(l.accessory as Accessory) ? (l.accessory as Accessory) : 'none',
    accessoryColor: hex(l.accessoryColor, m.colour),
    height: 1,
    build: Math.max(0.85, Math.min(1.2, Number(l.build) || 1)),
  };
  const extras = cleanKitParts(r.parts);
  const hide = [...new Set([...(pinned?.hide ?? []), ...(Array.isArray(r.hide) ? r.hide : []).filter((h): h is OutfitHide => OUTFIT_HIDES.includes(h as OutfitHide))])];
  const outfit: Outfit = { name: String(r.name ?? m.name).slice(0, 60), ...(hide.length ? { hide } : {}), parts: [...(pinned?.parts ?? []), ...extras] };
  const p = r.prop && typeof r.prop === 'object' ? (r.prop as { name?: unknown; parts?: unknown }) : undefined;
  const prop = p && m.props?.[age] ? { name: String(p.name ?? m.props[age]).slice(0, 60), parts: cleanParts(p.parts, 40).parts } : undefined;
  if (m.props?.[age] && !prop?.parts.length) checks.push(`no ${m.props[age]}`);
  const c: CastLook = {
    role,
    name: role === 'head' ? AGES[AGE_IDS.indexOf(age)].head.title : m.name,
    scale: m.scale[age] ?? 1,
    ...(role === 'head' ? { hatScale: HAT_LADDER[age] } : {}),
    base: `${age}:${which}`,
    look,
    outfit,
    extras: extras.length,
    ...(prop ? { prop } : {}),
    ...(r.notes ? { notes: String(r.notes).slice(0, 240) } : {}),
  };
  checks.push(...castChecks(c));
  return checks.length ? { ...c, checks } : c;
}

/** The locked-colour rules (design-system.md §2, §6): who must show what, and who may never wear red or gold. */
export function castChecks(c: CastLook): string[] {
  const m = CAST[c.role];
  const worn = castColours(c);
  const out: string[] = [];
  for (const must of m.must) if (!worn.some((w) => same(w, must))) out.push(`no ${must} on ${m.name}`);
  if (!m.red && worn.some(readsRed)) out.push(`${m.name} wears red (${worn.filter(readsRed).join(', ')}): red is Wren's`);
  if (!m.gold && worn.some(readsGold)) out.push(`${m.name} wears gold (${worn.filter(readsGold).join(', ')}): gold is the head's`);
  if (c.role === 'wren') {
    const roles: Record<string, string> = { shirt: c.look.shirt, pants: c.look.pants, hat: c.look.hatColor, accent: c.look.accessoryColor, hair: c.look.hair };
    const up = c.outfit.parts.filter((p) => p.bone === 'head' || (p.bone === 'hips' && p.position[1] >= 0.45)).map((p) => (p.colour.startsWith('#') ? p.colour : (roles[p.colour.split(':')[0]] ?? c.look.shirt)));
    if (!(c.look.hat !== 'none' && readsRed(c.look.hatColor)) && !up.some(readsRed)) out.push('no red on her head or shoulders (her top third is red)');
  }
  return out;
}

// ---- pets ------------------------------------------------------------------------------------------
/** The companion spec (design-system.md §7), as numbers the checks use and the words the prompt gets; `reference` is the pet height the age kits are drawn for. */
export const PET = { minHeight: 0.4, maxHeight: 0.9, maxLength: 1.2, minParts: 10, maxParts: 24, reference: 0.6 } as const;
export const PET_SPEC = `a companion that follows its owner about: ${PET.minHeight}–${PET.maxHeight} m tall, at most ${PET.maxLength} m long and wide, the head at least 40% of the body, stubby legs, one hero feature (big ears, a horn, a tail), ${PET.minParts}–${PET.maxParts} parts, cute and chunky, facing +Z. No collar: the game adds one in its owner's side colour.`;
/**
 * The pet branch for the game's design prompt, appended to DESIGN_SYSTEM by `astra.ts pets` until
 * FK-070 ships it in src/worlds/ai-dudes/design.ts (design-system.md §8 item 4); same words both places.
 */
export const PET_BRANCH = `Pets: when "isFor" is "pet", design ${PET_SPEC} Give it "moves":"roam".`;
/** The eight Stone pets (FK-071); each goes through the game's own design prompt. */
export const PETS = [
  { id: 'wolf-pup', request: 'a wolf pup' },
  { id: 'goat-kid', request: 'a goat kid' },
  { id: 'piglet', request: 'a piglet' },
  { id: 'mammoth-calf', request: 'a baby mammoth' },
  { id: 'owl', request: 'an owl' },
  { id: 'cat', request: 'a cat' },
  { id: 'lizard', request: 'a lizard' },
  { id: 'beetle', request: 'a beetle' },
] as const;
/** The instant, no-LLM touch a pet gets in each age while its restyle is queued (design-system.md §7, FK-051). */
export const PET_KITS: Record<AgeId, string> = { stone: 'a string of beads', bronze: 'a bronze name tag', medieval: 'a little bell', industrial: 'a brass name tag', modern: 'an LED collar light', future: 'scrap goggles' };
/** Where a pet kit's part hangs: the collar's centre at the front of the neck, or the face (eyes level, front of the head). */
export const PET_ANCHORS = ['neck', 'face'] as const;
export interface PetKitPart extends StoryPart {
  at: (typeof PET_ANCHORS)[number];
}

/** A pet design against the companion spec: size, part count, and that it roams. */
export function petChecks(b: Blueprint): string[] {
  const out: string[] = [];
  const box = blueprintBounds(b);
  const h = box.maxY,
    long = box.maxZ - box.minZ,
    wide = box.maxX - box.minX;
  if (h < PET.minHeight || h > PET.maxHeight) out.push(`${h.toFixed(2)} m tall (${PET.minHeight}–${PET.maxHeight})`);
  if (long > PET.maxLength) out.push(`${long.toFixed(2)} m long (max ${PET.maxLength})`);
  if (wide > PET.maxLength) out.push(`${wide.toFixed(2)} m wide (max ${PET.maxLength})`);
  if (b.parts.length < PET.minParts || b.parts.length > PET.maxParts) out.push(`${b.parts.length} parts (${PET.minParts}–${PET.maxParts})`);
  if (b.moves !== 'roam') out.push(`moves is ${b.moves ?? 'unset'}, not roam`);
  if (b.parts.some((p) => readsRed(p.color) || same(p.color, STORY.gold))) out.push('a story colour on the pet (the collar carries the side)');
  return out;
}

/** The six age kits as astra sent them: anchored parts, small (≤ 0.4 m), at most 8 each. */
export function cleanPetKits(raw: unknown): { kits: Partial<Record<AgeId, { name: string; parts: PetKitPart[] }>>; checks: string[] } {
  const r = (raw && typeof raw === 'object' ? (raw as { kits?: unknown }).kits ?? raw : {}) as Record<string, { name?: unknown; parts?: unknown }>;
  const kits: Partial<Record<AgeId, { name: string; parts: PetKitPart[] }>> = {};
  const checks: string[] = [];
  for (const age of AGE_IDS) {
    const k = r[age];
    if (!k || typeof k !== 'object') {
      checks.push(`no ${age} kit`);
      continue;
    }
    // Only the object parts, as cleanParts keeps them, so each part's anchor lines up with its part.
    const raws = Array.isArray(k.parts) ? k.parts.filter((p): p is Record<string, unknown> => !!p && typeof p === 'object') : [];
    const parts = cleanParts(raws, 8).parts.map((p, i) => ({
      ...p,
      size: p.size.map((n) => Math.min(0.4, n)) as [number, number, number],
      at: PET_ANCHORS.includes(raws[i]?.at as PetKitPart['at']) ? (raws[i].at as PetKitPart['at']) : 'neck',
    }));
    if (!parts.length) checks.push(`${age} kit has no parts`);
    kits[age] = { name: String(k.name ?? PET_KITS[age]).slice(0, 60), parts };
  }
  return { kits, checks };
}
