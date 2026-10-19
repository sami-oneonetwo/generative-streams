// The city's ground, the same on the server and the page: a grid of blocks with roads between them,
// every block split into four lots, and the town square in the middle. Everything here is a pure
// function of the constants, so the page draws the very lots the server hands out, and an address
// ("7 Maple Street") means the same thing to both. Zero AI.
import type { Rect } from './layout';
import type { GroundPoint } from './objectTypes';

export const CITY = {
  /** A lot is this many metres square. */
  plot: 16,
  sidewalk: 2,
  road: 8,
  /** Blocks out from the square in each direction: (2·rings+1)² blocks. */
  rings: 2,
};
/** Centre to centre of neighbouring blocks: two lots, two pavements, one road. */
export const PITCH = 2 * CITY.plot + 2 * CITY.sidewalk + CITY.road; // 44
/** Half a block, pavement included: the road starts here. */
export const BLOCK_HALF = CITY.plot + CITY.sidewalk; // 18
/** The walkable, buildable city: every block and the ring road round the outside. */
export const CITY_BOUNDS: Rect = (() => {
  const e = CITY.rings * PITCH + BLOCK_HALF + CITY.road;
  return { minX: -e, maxX: e, minZ: -e, maxZ: e };
})();

// Streets run between the blocks: avenues north–south (constant x), streets east–west (constant z).
const AVENUES = ['Larch Avenue', 'First Avenue', 'Second Avenue', 'Third Avenue', 'Fourth Avenue', 'Fifth Avenue', 'Sixth Avenue', 'Seventh Avenue'];
const STREETS = ['Willow Street', 'Elm Street', 'Oak Street', 'Maple Street', 'Birch Street', 'Cedar Street', 'Hazel Street', 'Rowan Street'];
/** Road centre lines: k from −rings−1 to rings, the road at block·PITCH + PITCH/2. */
export function roadLines(): number[] {
  const out: number[] = [];
  for (let k = -CITY.rings - 1; k <= CITY.rings; k++) out.push(k * PITCH + PITCH / 2);
  return out;
}
export const avenueName = (k: number) => AVENUES[(k + CITY.rings + 1) % AVENUES.length];
export const streetName = (k: number) => STREETS[(k + CITY.rings + 1) % STREETS.length];

export interface PlotInfo {
  id: string; // `p<bx>_<bz>_<q>`
  bx: number;
  bz: number;
  /** Which corner of its block: x side and z side (−1 or 1). */
  sx: number;
  sz: number;
  centre: GroundPoint;
  rect: Rect;
  address: string;
  /** Where its sign stands: the pavement corner on its street side. */
  sign: GroundPoint;
  /** The town square's lots are for community projects, never anyone's home. */
  civic: boolean;
  /** Order lots are handed out in: nearest the square first. */
  rank: number;
}

export function plotId(bx: number, bz: number, sx: number, sz: number): string {
  return `p${bx}_${bz}_${(sx > 0 ? 1 : 0) + (sz > 0 ? 2 : 0)}`;
}

/** The town square: the middle block, a cross of paving with the fountain where the paths meet. */
export const SQUARE = {
  /** Half the width of the paved cross. */
  path: 3,
  fountain: { x: 0, z: 0, r: 2.2 },
  market: { x: 0, z: 6.5, w: 2.6, d: 1.6 },
  /** The four community lots round the cross: smaller than a home lot. */
  site: 13,
};

let PLOTS: PlotInfo[] | undefined;
/** Every lot in the city, home lots and the square's community lots, in hand-out order. */
export function allPlots(): PlotInfo[] {
  if (PLOTS) return PLOTS;
  const out: PlotInfo[] = [];
  const R = CITY.rings,
    half = CITY.plot / 2;
  for (let bx = -R; bx <= R; bx++)
    for (let bz = -R; bz <= R; bz++)
      for (const sx of [-1, 1])
        for (const sz of [-1, 1]) {
          const civic = bx === 0 && bz === 0;
          const cx = bx * PITCH + sx * (civic ? SQUARE.path + SQUARE.site / 2 : half),
            cz = bz * PITCH + sz * (civic ? SQUARE.path + SQUARE.site / 2 : half);
          const h = civic ? SQUARE.site / 2 : half;
          // The lot faces the east–west street on its side of the block; numbers run west to east,
          // odd on the north side of the street and even on the south.
          const k = sz > 0 ? bz : bz - 1;
          const n = (bx + R) * 2 + (sx < 0 ? 1 : 2);
          const number = sz > 0 ? n * 2 - 1 : n * 2;
          const corner = { x: cx + sx * (h + 0.6), z: bz * PITCH + sz * (BLOCK_HALF - 0.7) };
          out.push({
            id: plotId(bx, bz, sx, sz),
            bx,
            bz,
            sx,
            sz,
            centre: { x: cx, z: cz },
            rect: { minX: cx - h, maxX: cx + h, minZ: cz - h, maxZ: cz + h },
            address: civic ? `Town Square ${sz < 0 ? 'North' : 'South'}${sx < 0 ? 'west' : 'east'}` : `${number} ${streetName(k)}`,
            sign: civic ? { x: cx - sx * (h - 0.6), z: cz - sz * (h - 0.6) } : { x: corner.x - sx * 1.4, z: corner.z },
            civic,
            rank: 0,
          });
        }
  // Nearest the square first; round each ring in turn so a block fills before the next one starts.
  const score = (p: PlotInfo) => Math.max(Math.abs(p.bx), Math.abs(p.bz)) * 1000 + Math.hypot(p.centre.x, p.centre.z) + Math.atan2(p.centre.z, p.centre.x) * 0.01;
  out.sort((a, b) => score(a) - score(b));
  out.forEach((p, i) => (p.rank = i));
  PLOTS = out;
  return out;
}
export const plotById = (id: string | undefined) => (id ? allPlots().find((p) => p.id === id) : undefined);
export const homePlots = () => allPlots().filter((p) => !p.civic);
export const civicPlots = () => allPlots().filter((p) => p.civic);
/** The lot a point stands on, if any. */
export const plotAt = (p: GroundPoint) => allPlots().find((l) => p.x >= l.rect.minX && p.x <= l.rect.maxX && p.z >= l.rect.minZ && p.z <= l.rect.maxZ);
/** The block a lot belongs to, as a key (districts are counted by block). */
export const blockKey = (p: { bx: number; bz: number }) => `${p.bx},${p.bz}`;

/** Where people arrive in town: the bus stop on the square's south side. */
export const BUS_STOP: GroundPoint = { x: 4.5, z: BLOCK_HALF + 1.2 };

// ---- what buildings are for -----------------------------------------------------------------
/** What a person can need. Each runs 0..100; 100 is fully satisfied. */
export const NEEDS = ['hunger', 'energy', 'fun', 'social'] as const;
export type Need = (typeof NEEDS)[number];
export type Needs = Record<Need, number>;

/**
 * What a building can be. The agent names one when it builds; the app owns everything else: what a
 * visit does for you, what it costs, how long it takes. Prices are in coins (§), paid to the owner.
 */
export const VENUE_KINDS = ['home', 'cafe', 'restaurant', 'bakery', 'bar', 'club', 'shop', 'market', 'workshop', 'apartments', 'gym', 'park', 'library', 'florist', 'venue', 'decor'] as const;
export type VenueKind = (typeof VENUE_KINDS)[number];
export interface VenueSpec {
  label: string;
  /** Need → how much one visit restores. */
  gives: Partial<Needs>;
  price: number;
  /** How a visit looks: inside (hidden a while) or at it (sitting, dancing, browsing), or doing its thing (`play`). */
  visit: 'enter' | 'sit' | 'dance' | 'look' | 'lie' | 'play';
  /** `play`: the pose, where to stand (on it, or beside), and the shout floated up now and then. */
  pose?: string;
  spot?: 'on' | 'beside';
  pop?: string;
  visitMs: number;
  /** What a visit is called in the feed and the visitor's memory. */
  verb: string;
  /** Grouping for districts ("Food Street") and for what the town is missing. */
  group?: 'food' | 'night' | 'shops' | 'culture' | 'green' | 'living';
}
export const VENUES: Record<VenueKind, VenueSpec> = {
  home: { label: 'home', gives: { energy: 70, fun: 10 }, price: 0, visit: 'enter', visitMs: 40_000, verb: 'had a rest at', group: 'living' },
  cafe: { label: 'café', gives: { hunger: 30, social: 25, energy: 15 }, price: 5, visit: 'sit', visitMs: 20_000, verb: 'had a coffee at', group: 'food' },
  restaurant: { label: 'restaurant', gives: { hunger: 65, social: 30 }, price: 12, visit: 'sit', visitMs: 28_000, verb: 'had dinner at', group: 'food' },
  bakery: { label: 'bakery', gives: { hunger: 40, fun: 5 }, price: 4, visit: 'enter', visitMs: 12_000, verb: 'picked up a pastry from', group: 'food' },
  bar: { label: 'bar', gives: { social: 45, fun: 30 }, price: 8, visit: 'sit', visitMs: 24_000, verb: 'had a drink at', group: 'night' },
  club: { label: 'club', gives: { fun: 60, social: 35, energy: -10 }, price: 10, visit: 'dance', visitMs: 24_000, verb: 'danced at', group: 'night' },
  shop: { label: 'shop', gives: { fun: 30 }, price: 7, visit: 'enter', visitMs: 14_000, verb: 'went shopping at', group: 'shops' },
  market: { label: 'market', gives: { hunger: 25, fun: 20, social: 15 }, price: 5, visit: 'look', visitMs: 16_000, verb: 'browsed', group: 'shops' },
  workshop: { label: 'workshop', gives: { fun: 45, social: 10 }, price: 9, visit: 'enter', visitMs: 22_000, verb: 'learned something at', group: 'shops' },
  apartments: { label: 'apartments', gives: { energy: 55, social: 20 }, price: 3, visit: 'enter', visitMs: 30_000, verb: 'visited a flat in', group: 'living' },
  gym: { label: 'gym', gives: { fun: 35, energy: -15 }, price: 6, visit: 'enter', visitMs: 20_000, verb: 'worked out at', group: 'culture' },
  park: { label: 'park', gives: { fun: 35, social: 25, energy: 10 }, price: 0, visit: 'sit', visitMs: 22_000, verb: 'relaxed in', group: 'green' },
  library: { label: 'library', gives: { fun: 35, energy: 10 }, price: 0, visit: 'enter', visitMs: 22_000, verb: 'read at', group: 'culture' },
  florist: { label: 'florist', gives: { fun: 25, social: 10 }, price: 6, visit: 'enter', visitMs: 12_000, verb: 'bought flowers at', group: 'shops' },
  venue: { label: 'events venue', gives: { fun: 50, social: 45 }, price: 10, visit: 'dance', visitMs: 26_000, verb: 'went to a party at', group: 'culture' },
  decor: { label: 'decoration', gives: { fun: 10 }, price: 0, visit: 'look', visitMs: 8000, verb: 'admired' },
};

/** A kind from whatever the agent wrote, or from the build's own words. */
const KIND_WORDS: [RegExp, VenueKind][] = [
  [/\b(apartments?|flats?|tower block|condos?|tenement|hostel|hotel|inn)\b/, 'apartments'],
  [/\b(house|home|cottage|cabin|bungalow|villa|mansion|hut|shack|treehouse|igloo|bedroom|dwelling)\b/, 'home'],
  [/\b(caf[eé]|coffee|tea ?room|tea ?house|espresso|cuppa)\b/, 'cafe'],
  [/\b(bakery|bakers?|patisserie|donut|doughnut|cupcake|cake shop|bagel)\b/, 'bakery'],
  [/\b(restaurant|diner|bistro|pizzeria|pizza|burger|noodle|ramen|sushi|taco|kebab|chippy|grill|steakhouse|food truck|canteen|eatery)\b/, 'restaurant'],
  [/\b(club|nightclub|disco|rave|dance ?hall|karaoke)\b/, 'club'],
  [/\b(bar|pub|tavern|saloon|brewery|winery|lounge)\b/, 'bar'],
  [/\b(market|stall|farmers|bazaar|food hall)\b/, 'market'],
  [/\b(workshop|studio|forge|smithy|garage|lab|makerspace|pottery|carpent)\b/, 'workshop'],
  [/\b(gym|fitness|boxing|dojo|skate ?park|climbing wall|arena|stadium|pool|swimming)\b/, 'gym'],
  [/\b(park|garden|playground|plaza|square|pond|orchard|greenhouse|allotment|picnic)\b/, 'park'],
  [/\b(library|museum|gallery|bookshop|book shop|school|observatory|theatre|theater|cinema)\b/, 'library'],
  [/\b(florist|flower shop|flowers)\b/, 'florist'],
  [/\b(wedding|chapel|venue|ballroom|bandstand|stage|concert|amphitheatre|town hall|hall)\b/, 'venue'],
  [/\b(shop|store|boutique|emporium|mart|arcade|toy|record shop|pawn|salon|barber)\b/, 'shop'],
];
export function venueKindOf(...texts: (string | undefined)[]): VenueKind {
  for (const t of texts) {
    if (!t) continue;
    const s = t.trim().toLowerCase();
    if ((VENUE_KINDS as readonly string[]).includes(s)) return s as VenueKind;
    if (s === 'café' || s === 'coffee shop') return 'cafe';
    if (s === 'house' || s === 'my house') return 'home';
    for (const [re, k] of KIND_WORDS) if (re.test(s)) return k;
  }
  return 'decor';
}

/** District names a block earns when two or more of one kind of place stand on it. */
export const DISTRICT_NAMES: Record<NonNullable<VenueSpec['group']>, string[]> = {
  food: ['Food Street', 'the Kitchen Quarter', 'Supper Row'],
  night: ['the Late Quarter', 'Neon Row', 'the Night Strip'],
  shops: ['the High Street', 'Market Row', 'the Shopping Lanes'],
  culture: ['the Arts Quarter', 'Gallery Row', 'the Old Town'],
  green: ['the Green Belt', 'Garden Row', 'the Leafy End'],
  living: ['the Residential End', 'Quiet Row', 'the Neighbourhood'],
};

/** Mood from needs: the average, as the page colours it (green, amber, red). */
export const moodOf = (n: Needs) => Math.round((n.hunger + n.energy + n.fun + n.social) / 4);
