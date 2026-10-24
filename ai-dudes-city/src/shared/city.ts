// The city's ground, the same on the server and the page: a grid of blocks with roads between them,
// every block three lots by three with a green courtyard in the middle cell (so every lot fronts a
// road, and blocks are fewer, bigger and less alike), and the town square in the middle block. Everything here is a pure
// function of the constants, so the page draws the very lots the server hands out, and an address
// ("7 Maple Street") means the same thing to both. Zero AI.
import type { Rect } from './layout';
import type { GroundPoint } from './objectTypes';

export const CITY = {
  /** A lot is this many metres square. */
  plot: 12,
  sidewalk: 1.5,
  road: 6,
  /** Blocks out from the square in each direction: (2·rings+1)² blocks. */
  rings: 1,
  /** A block is this many lots a side; the middle cell is the block's courtyard, not a lot. */
  cells: 3,
  /** The corner blocks are little parks, not lots: a cross of four home blocks round the square. */
  parks: true,
};
/**
 * Which layout a save was laid out on (state.city.layout): 1 was 5×5 blocks of four 16 m lots; 2 was
 * 3×3 blocks of eight 22 m lots (64 lots, 242 m across); 3 is the same plan at 12 m lots with the
 * corner blocks made parks (32 lots, 141 m across), small enough to read on a phone.
 */
export const LAYOUT = 3;
/** Centre to centre of neighbouring blocks: three lots, two pavements, one road. */
export const PITCH = CITY.cells * CITY.plot + 2 * CITY.sidewalk + CITY.road; // 45
/** Half a block, pavement included: the road starts here. */
export const BLOCK_HALF = (CITY.cells * CITY.plot) / 2 + CITY.sidewalk; // 19.5
/** The walkable, buildable city: every block and the ring road round the outside. */
export const CITY_BOUNDS: Rect = (() => {
  const e = CITY.rings * PITCH + BLOCK_HALF + CITY.road;
  return { minX: -e, maxX: e, minZ: -e, maxZ: e };
})();
/** A corner block left as a park (no lots). */
export const isPark = (bx: number, bz: number): boolean => CITY.parks && bx !== 0 && bz !== 0;

/** The river past the ring road on the east side (docs/ages.md): the caravans camp across it. Centre line and width, metres. */
export const RIVER = { x: CITY_BOUNDS.maxX + 16, width: 14 };

// Streets run between the blocks: avenues north–south (constant x), streets east–west (constant z).
// No Oak Street: Oak is one of the cast (FK-128), so that one is Alder Street.
const AVENUES = ['Larch Avenue', 'First Avenue', 'Second Avenue', 'Third Avenue', 'Fourth Avenue', 'Fifth Avenue', 'Sixth Avenue', 'Seventh Avenue'];
const STREETS = ['Willow Street', 'Elm Street', 'Alder Street', 'Maple Street', 'Birch Street', 'Cedar Street', 'Hazel Street', 'Rowan Street'];
/** Road centre lines: k from −rings−1 to rings, the road at block·PITCH + PITCH/2. */
export function roadLines(): number[] {
  const out: number[] = [];
  for (let k = -CITY.rings - 1; k <= CITY.rings; k++) out.push(k * PITCH + PITCH / 2);
  return out;
}
export const avenueName = (k: number) => AVENUES[(k + CITY.rings + 1) % AVENUES.length];
export const streetName = (k: number) => STREETS[(k + CITY.rings + 1) % STREETS.length];

export interface PlotInfo {
  id: string; // `q<bx>_<bz>_<sx>_<sz>`
  bx: number;
  bz: number;
  /** Which cell of its block: x side and z side (−1, 0 or 1; never both 0, that is the courtyard). The square's community lots are its four corners. */
  sx: number;
  sz: number;
  /** The way to the road it fronts (and is addressed on): ±z a street, ±x an avenue. */
  front: GroundPoint;
  centre: GroundPoint;
  rect: Rect;
  address: string;
  /** Where its sign stands: the pavement corner on its street side. */
  sign: GroundPoint;
  /** The town square's lots are for community projects, never anyone's home. */
  civic: boolean;
  /** Order lots are handed out in: the square's first, then block by block from the bridge (BLOCK_ORDER). */
  rank: number;
}

export function plotId(bx: number, bz: number, sx: number, sz: number): string {
  return `q${bx}_${bz}_${sx}_${sz}`;
}
/** The middle of a block's courtyard (every home block has one: grass and a tree or two). */
export const courtyards = (): GroundPoint[] => {
  const out: GroundPoint[] = [];
  for (let bx = -CITY.rings; bx <= CITY.rings; bx++) for (let bz = -CITY.rings; bz <= CITY.rings; bz++) if ((bx || bz) && !isPark(bx, bz)) out.push({ x: bx * PITCH, z: bz * PITCH });
  return out;
};
/** The middle of every corner park. */
export const parks = (): GroundPoint[] => {
  const out: GroundPoint[] = [];
  for (let bx = -CITY.rings; bx <= CITY.rings; bx++) for (let bz = -CITY.rings; bz <= CITY.rings; bz++) if (isPark(bx, bz)) out.push({ x: bx * PITCH, z: bz * PITCH });
  return out;
};

/** The town square: the middle block, a cross of paving with the fountain where the paths meet. */
export const SQUARE = {
  /** Half the width of the paved cross. */
  path: 2.5,
  fountain: { x: 0, z: 0, r: 2.2 },
  market: { x: 0, z: 5.5, w: 2.6, d: 1.6 },
  /** The four community lots round the cross. */
  site: 13,
};
/**
 * The square's river-side half, kept open for the town to gather in: a crowd ring, the Rising (layout
 * A+, Sami 2026-10-24). Community projects never take its two lots, q0_0_1_±1 (`isOpenSquare`), so they
 * keep to the west half. From the middle of the cross to the pavement's edge, 19.5 × 39 m; the Wonder
 * in the middle leans 3.2 m into it.
 */
export const OPEN_SQUARE: Rect = { minX: 0, maxX: BLOCK_HALF, minZ: -BLOCK_HALF, maxZ: BLOCK_HALF };
/**
 * The Wonder's own spot (docs/ages.md): where the paths cross, in place of the centrepiece. Each age's
 * Wonder goes up here and replaces the last, so the community lots in the square's west half stay for
 * chat's projects and a six-age run never runs out of room. `size` is its footprint a side (it may lean
 * a little into the lots' inner corners), `height` how tall it may stand.
 */
export const WONDER = { x: 0, z: 0, size: 6.4, height: 26, plot: 'wonder' };
/** The Wonder's spot as a lot, for fitting and placing: never handed out, never in `allPlots`. */
export const wonderLot = (): PlotInfo => {
  const h = WONDER.size / 2;
  return {
    id: WONDER.plot,
    bx: 0,
    bz: 0,
    sx: 0,
    sz: 0,
    front: { x: 0, z: 1 },
    centre: { x: WONDER.x, z: WONDER.z },
    rect: { minX: WONDER.x - h, maxX: WONDER.x + h, minZ: WONDER.z - h, maxZ: WONDER.z + h },
    address: 'the middle of the Town Square',
    sign: { x: WONDER.x, z: WONDER.z + h },
    civic: true,
    rank: -1,
  };
};

/** The numbers a layout is drawn from (the current one is CITY and SQUARE; relayout.ts rebuilds older ones). */
export interface LayoutSpec {
  plot: number;
  sidewalk: number;
  road: number;
  rings: number;
  cells: number;
  parks: boolean;
  path: number;
  site: number;
}
export const CURRENT_LAYOUT: LayoutSpec = { ...CITY, path: SQUARE.path, site: SQUARE.site };

/**
 * The order home blocks are handed out in (layout A+, Sami 2026-10-24): from the bridge. The block
 * between the square and the river, then south, south-east, north, north-east, west, south-west and
 * north-west, so the first chatters live together by the water instead of one per side of the square.
 * The corners are parks with no lots while `CITY.parks` holds, so today it runs E, S, N, W.
 */
export const BLOCK_ORDER = [
  [1, 0],
  [0, 1],
  [1, 1],
  [0, -1],
  [1, -1],
  [-1, 0],
  [-1, 1],
  [-1, -1],
] as const;
/** The east block's middle row, the two lots Bridge Lane will run through from the square to the bridge (FK-076). */
export const isBridgeLane = (p: { bx: number; bz: number; sz: number }): boolean => p.bx === 1 && p.bz === 0 && p.sz === 0;
/** The square's two river-side lots, the ones in OPEN_SQUARE: kept open, never given to a community project (FK-077). */
export const isOpenSquare = (p: { bx: number; bz: number; sx: number }): boolean => p.bx === 0 && p.bz === 0 && p.sx > 0;

let PLOTS: PlotInfo[] | undefined;
/** Every lot in the city, home lots and the square's community lots, in hand-out order. */
export function allPlots(): PlotInfo[] {
  return (PLOTS ??= layoutPlots(CURRENT_LAYOUT));
}
/** Every lot of a layout, in hand-out order. */
export function layoutPlots(L: LayoutSpec): PlotInfo[] {
  const out: PlotInfo[] = [];
  const R = L.rings,
    half = L.plot / 2,
    C = (L.cells - 1) / 2;
  const pitch = L.cells * L.plot + 2 * L.sidewalk + L.road,
    blockHalf = (L.cells * L.plot) / 2 + L.sidewalk;
  for (let bx = -R; bx <= R; bx++)
    for (let bz = -R; bz <= R; bz++) {
      if (L.parks && bx && bz) continue;
      const civic = bx === 0 && bz === 0;
      for (let sx = -C; sx <= C; sx++)
        for (let sz = -C; sz <= C; sz++) {
          if (civic ? !sx || !sz : !sx && !sz) continue;
          const cx = bx * pitch + (civic ? sx * (L.path + L.site / 2) : sx * L.plot),
            cz = bz * pitch + (civic ? sz * (L.path + L.site / 2) : sz * L.plot);
          const h = civic ? L.site / 2 : half;
          // A lot fronts the east–west street on its side of the block, or (the middle row) the
          // north–south avenue. Numbers run west to east along a street (north to south along an
          // avenue), odd on the north (east) side and even on the other.
          const onStreet = sz !== 0;
          const front = onStreet ? { x: 0, z: sz } : { x: sx, z: 0 };
          const k = onStreet ? (sz > 0 ? bz : bz - 1) : sx > 0 ? bx : bx - 1;
          const n = onStreet ? (bx + R) * L.cells + sx + C + 1 : (bz + R) * L.cells + sz + C + 1;
          const number = (onStreet ? sz : sx) > 0 ? n * 2 - 1 : n * 2;
          out.push({
            id: plotId(bx, bz, sx, sz),
            bx,
            bz,
            sx,
            sz,
            front,
            centre: { x: cx, z: cz },
            rect: { minX: cx - h, maxX: cx + h, minZ: cz - h, maxZ: cz + h },
            address: civic ? `Town Square ${sz < 0 ? 'North' : 'South'}${sx < 0 ? 'west' : 'east'}` : `${number} ${onStreet ? streetName(k) : avenueName(k)}`,
            sign: civic ? { x: cx - sx * (h - 0.6), z: cz - sz * (h - 0.6) } : onStreet ? { x: cx + sx * (h - 0.8), z: bz * pitch + sz * (blockHalf - 0.7) } : { x: bx * pitch + sx * (blockHalf - 0.7), z: cz },
            civic,
            rank: 0,
          });
        }
    }
  // The square's lots first, round from the north-west as ever (community projects take the first free
  // one of the west two, `projectPlots`). Then home lots block by block in BLOCK_ORDER, each block's
  // river-side (east) cells first, then the ones nearest Bridge Lane (z = 0), south before north. Bridge
  // Lane's own two cells go last of all, so they are still free when FK-076 takes them out.
  const block = (p: PlotInfo) => {
    if (p.civic) return -1;
    if (isBridgeLane(p)) return 1e6;
    const i = BLOCK_ORDER.findIndex(([bx, bz]) => bx === p.bx && bz === p.bz);
    // A wider town (none today) carries on ring by ring.
    return i >= 0 ? i : BLOCK_ORDER.length + Math.max(Math.abs(p.bx), Math.abs(p.bz)) * 10 + Math.atan2(p.bz, p.bx) + Math.PI;
  };
  out.sort(
    (a, b) =>
      block(a) - block(b) ||
      (a.civic ? Math.atan2(a.centre.z, a.centre.x) - Math.atan2(b.centre.z, b.centre.x) : b.centre.x - a.centre.x || Math.abs(a.centre.z) - Math.abs(b.centre.z) || b.centre.z - a.centre.z),
  );
  out.forEach((p, i) => (p.rank = i));
  return out;
}
export const plotById = (id: string | undefined) => (!id ? undefined : id === WONDER.plot ? wonderLot() : allPlots().find((p) => p.id === id));
export const homePlots = () => allPlots().filter((p) => !p.civic);
export const civicPlots = () => allPlots().filter((p) => p.civic);
/** The square's lots a community project (or an old Wonder kept as a keepsake) may go on, in hand-out order: the west half's, north-west then south-west. */
export const projectPlots = () => civicPlots().filter((p) => !isOpenSquare(p));
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
  bakery: { label: 'bakery', gives: { hunger: 40, fun: 5 }, price: 4, visit: 'look', visitMs: 12_000, verb: 'picked up a pastry from', group: 'food' },
  bar: { label: 'bar', gives: { social: 45, fun: 30 }, price: 8, visit: 'sit', visitMs: 24_000, verb: 'had a drink at', group: 'night' },
  club: { label: 'club', gives: { fun: 60, social: 35, energy: -10 }, price: 10, visit: 'dance', visitMs: 24_000, verb: 'danced at', group: 'night' },
  shop: { label: 'shop', gives: { fun: 30 }, price: 7, visit: 'look', visitMs: 14_000, verb: 'went shopping at', group: 'shops' },
  market: { label: 'market', gives: { hunger: 25, fun: 20, social: 15 }, price: 5, visit: 'look', visitMs: 16_000, verb: 'browsed', group: 'shops' },
  workshop: { label: 'workshop', gives: { fun: 45, social: 10 }, price: 9, visit: 'look', visitMs: 22_000, verb: 'learned something at', group: 'shops' },
  apartments: { label: 'apartments', gives: { energy: 55, social: 20 }, price: 3, visit: 'enter', visitMs: 30_000, verb: 'visited a flat in', group: 'living' },
  gym: { label: 'gym', gives: { fun: 35, energy: -15 }, price: 6, visit: 'enter', visitMs: 20_000, verb: 'worked out at', group: 'culture' },
  park: { label: 'park', gives: { fun: 35, social: 25, energy: 10 }, price: 0, visit: 'sit', visitMs: 22_000, verb: 'relaxed in', group: 'green' },
  library: { label: 'library', gives: { fun: 35, energy: 10 }, price: 0, visit: 'sit', visitMs: 22_000, verb: 'read at', group: 'culture' },
  florist: { label: 'florist', gives: { fun: 25, social: 10 }, price: 6, visit: 'look', visitMs: 12_000, verb: 'bought flowers at', group: 'shops' },
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
