// The design board's catalogue: every piece of the town's fabric and a handful of example builds,
// each with its role in the game, the tile it is shown on, and the room it has. The ages come from
// src/shared/ages.ts. Sami's notes (2026-10-20) are the brief every design and critique answers to.
// Nothing here runs in the game; it feeds design/astra.ts and the board renderer.
import { AGE_IDS, type AgeId } from '../src/shared/ages';

export { AGE_IDS, type AgeId };

/** How a cell's ground is laid before the element's own parts go on it (the renderer draws these from the age's surfaces). */
export type Tile =
  | 'land' // countryside all over
  | 'street' // a road across the middle (x runs along it), the walking edge either side, lot ground beyond
  | 'lot-rough' // an unclaimed lot, with the street along its front (+z)
  | 'lot-claimed' // a claimed lot, the street along its front (+z)
  | 'square' // the town square's paving
  | 'river' // water across the middle (x runs along it), banks either side
  | 'none'; // just the age's ground under a figure or a build

export interface Element {
  id: string;
  label: string;
  board: 'fabric' | 'life';
  tile: Tile;
  /** Half-width of the room the parts must stay inside, metres (|x|,|z| ≤ this), and the height cap. */
  half: number;
  height: number;
  /** What it is in the game and what it must do; the designer's brief. */
  brief: string;
  /** Example builds go through the game's own design prompt (DESIGN_SYSTEM + age), not the board's. */
  build?: { request: string; kind?: string; lot?: number };
}

export const ELEMENTS: Element[] = [
  {
    id: 'ground',
    label: 'Countryside',
    board: 'fabric',
    tile: 'land',
    half: 6,
    height: 3,
    brief:
      'What the land beyond the town looks like: the parts are small scattered ground features on the countryside surface (tufts, stones, flowers, logs, puddles, crystals: whatever fits the age). Low, sparse, never blocking the view. 6–20 parts.',
  },
  {
    id: 'street',
    label: 'Street',
    board: 'fabric',
    tile: 'street',
    half: 6,
    height: 2,
    brief:
      'A stretch of the town\'s streets. The road surface and the walking edge (pavement, or none) are drawn from the age\'s surfaces; the road runs along x, 8 m wide (|z| ≤ 4), with the walking edge from |z| 4 to 6 when the age has one. The parts are what sits on and along the road: ruts, puddles, stepping stones, kerbs, gutters, drains, bollards, markings, cart tracks, guide lights. They must make the age obvious at a glance. Keep the middle of the road clear for walking. 6–30 parts, all low (under 1.2 m).',
  },
  {
    id: 'lot-sale',
    label: 'Free lot + marker',
    board: 'fabric',
    tile: 'lot-rough',
    half: 6,
    height: 3,
    brief:
      'An unclaimed 16 m lot waiting for a newcomer. The parts are the marker that says "free to claim" (today a red FOR SALE sign on a post; in the Stone Age sticks and mud, a cairn or a hide on a pole). Stand it near the front (+z edge, around z 4.5, x 4.5). It must read as "available" from far away without words, though a board with a painted mark is fine. Add a little rough ground clutter. 4–20 parts.',
  },
  {
    id: 'lot-claimed',
    label: 'Claimed lot',
    board: 'fabric',
    tile: 'lot-claimed',
    half: 6.5,
    height: 3,
    brief:
      'A lot someone has moved into: its boundary along the back (z −6) and the inner side (x −6), open to the street at the front (+z), with a gate or gap; and the owner\'s name marker by the front corner (today a sign board on a post with their name; a carved post, a painted shield, a brass plate, a name daubed on scrap metal). The owner\'s colour shows on the gate post or the marker (use #d9534f as the owner colour). Low boundary (under 1.2 m) so builds behind stay visible. 10–40 parts.',
  },
  {
    id: 'street-tree',
    label: 'Street tree',
    board: 'fabric',
    tile: 'street',
    half: 6,
    height: 9,
    brief:
      'The tree that lines the streets, standing on the walking edge at z 5. Two different trees side by side (x −3 and x 3) so the variety shows: trees are never identical. They must look like that age plants or tends trees (in the Stone Age there are no planted street trees: wild, lopsided, uneven trees and scrub). Asymmetric: tilted trunks, uneven crowns, different heights. 10–40 parts.',
  },
  {
    id: 'wild-tree',
    label: 'Wild trees',
    board: 'fabric',
    tile: 'land',
    half: 6,
    height: 12,
    brief:
      'The countryside\'s trees and scrub: three different ones (a tall one, a broad one, a bush or young one), irregular and natural, never symmetrical lollipops. They fill the land round the town. 12–50 parts.',
  },
  {
    id: 'street-light',
    label: 'Street light',
    board: 'fabric',
    tile: 'street',
    half: 6,
    height: 6,
    brief:
      'What lights the street corners: torch on a stake, brazier, lantern post, gas lamp, street light, light pillar. Stand it on the walking edge at x 0, z 5. Mark the light-giving parts with "glow": true. 4–20 parts.',
  },
  {
    id: 'centrepiece',
    label: 'Square centrepiece',
    board: 'fabric',
    tile: 'square',
    half: 5,
    height: 7,
    brief:
      'The heart of the town square, where people gather (today a stone fountain). Each age has its own: a bonfire ringed with stones and log seats in the Stone Age, a well or altar, a market cross or fountain, a cast-iron fountain or clock, a modern fountain or sculpture, a fire barrel ringed with scrap seats under a junk wind turbine. About 4.5 m across. Glowing parts (fire, light) get "glow": true. 15–60 parts.',
  },
  {
    id: 'bench',
    label: 'Seating',
    board: 'fabric',
    tile: 'square',
    half: 3,
    height: 2,
    brief: 'Where people sit round the square (today a park bench): a log or a flat rock, a stone ledge, a wooden bench, a cast-iron bench, a modern bench, a car seat bolted onto tyres. Seat height about 0.45 m, room for two. 3–16 parts.',
  },
  {
    id: 'market',
    label: 'Market stall',
    board: 'fabric',
    tile: 'square',
    half: 3,
    height: 4,
    brief: 'The square\'s market stall with goods on show: a hide spread with goods on the ground, a reed-roofed stall, a striped-awning stall, a covered barrow, a modern kiosk, a scrap-metal barter stall under a tarp. About 2.6 × 1.6 m. 10–40 parts.',
  },
  {
    id: 'arrival',
    label: 'Arrival point',
    board: 'fabric',
    tile: 'street',
    half: 6,
    height: 5,
    brief:
      'Where newcomers arrive in town (today a bus stop with a BUS sign) together with what brings them: a mammoth-drawn sledge, a chariot, a horse cart, a steam tram, a bus, an armoured scrap bus. The stop stands on the walking edge (z 5); the vehicle waits on the road (z 0, along x, about 5 m long). 20–70 parts.',
  },
  {
    id: 'river',
    label: 'River + crossing',
    board: 'fabric',
    tile: 'river',
    half: 7,
    height: 6,
    brief:
      'The river east of town (water along x, 14 m wide: |z| ≤ 7; the tile shows the middle 12 m) and how people cross it in this age: stepping stones and a fallen log, a stone arch, a drawbridge, an iron viaduct, a concrete road bridge, a light bridge. The crossing runs along z, about 4 m wide, its deck about 1 m above the water at the banks. Add bank details (reeds, rocks, piers). 15–70 parts.',
  },
  {
    id: 'civic-lot',
    label: 'Community lot',
    board: 'fabric',
    tile: 'lot-rough',
    half: 6,
    height: 4,
    brief:
      'One of the square\'s four lots for town projects, before anything is built: the ground is marked out as the town\'s, with a marker saying "build something for everyone here" (today a green TOWN LOT sign). Corner stakes or stones marking it out, and the marker near the front. 8–30 parts.',
  },
  {
    id: 'camp',
    label: 'Caravan camp',
    board: 'fabric',
    tile: 'land',
    half: 7,
    height: 6,
    brief:
      'The travelling caravan\'s camp across the river: mammoth herders\' hide tents and a fire, river traders\' barges and awnings, a travelling court\'s pavilions and banners, railway barons\' carriages, tourists\' coach and parasols, a scrap convoy\'s rigs and tarps. Two or three shelters, a fire or light, goods, an animal or vehicle. 25–90 parts.',
  },
  {
    id: 'resident',
    label: 'Resident',
    board: 'life',
    tile: 'none',
    half: 1.2,
    height: 2.4,
    brief:
      'A townsperson (not a chatter) dressed for the age. Start from the base figure and add clothes, hair, hat and one carried thing. Two figures side by side (x −0.6 and x 0.6) so variety shows. 20–60 parts.',
  },
  {
    id: 'head',
    label: 'The town\'s head',
    board: 'life',
    tile: 'none',
    half: 1.2,
    height: 2.8,
    brief:
      'The streamer\'s character, the town\'s head: the Chief, the High Priest, the King, the Alderman, the Mayor, the Overseer. Grander than a resident, instantly recognisable, with a symbol of office (headdress and bone staff, sun disc, crown and cape, top hat and chain, sash and ribbon scissors, a scrap-plate mantle with a salvaged radio and keys). Start from the base figure. 20–60 parts.',
  },
  {
    id: 'leader',
    label: 'Caravan leader',
    board: 'life',
    tile: 'none',
    half: 1.5,
    height: 2.8,
    brief: 'The leader of the age\'s caravan: a mammoth herder, a river trader, a jester with the travelling court, a railway baron, a tour guide, a scrap convoy\'s road boss. Start from the base figure; give them something that says "from far away". 20–60 parts.',
  },
  { id: 'home', label: 'Example: a home', board: 'life', tile: 'none', half: 8, height: 18, brief: '', build: { request: 'a cosy family home', kind: 'home', lot: 14 } },
  { id: 'cafe', label: 'Example: a café', board: 'life', tile: 'none', half: 8, height: 18, brief: '', build: { request: 'a little café where friends meet', kind: 'cafe', lot: 14 } },
  { id: 'skyscraper', label: 'Example: a skyscraper', board: 'life', tile: 'none', half: 8, height: 18, brief: '', build: { request: 'build a skyscraper', lot: 14 } },
  { id: 'dog', label: 'Example: a dog', board: 'life', tile: 'none', half: 3, height: 3, brief: '', build: { request: 'a dog that roams the streets' } },
  { id: 'car', label: 'Example: a car', board: 'life', tile: 'none', half: 4, height: 4, brief: '', build: { request: 'a car that drives round the blocks' } },
];

/** The base figure every person on the board starts from: the game's blocky proportions, about 1.8 m. */
export const BASE_FIGURE = `Base figure (metres, centred on x 0 z 0, facing +z): legs two boxes 0.17×0.78×0.2 at x ±0.1, y 0.39; hips box 0.42×0.16×0.24 at y 0.82; torso box 0.46×0.56×0.26 at y 1.16; arms two boxes 0.13×0.6×0.15 at x ±0.31, y 1.12; neck cylinder 0.12×0.08×0.12 at y 1.48; head box 0.34×0.34×0.32 at y 1.68; hair box on top of the head. Skin #d9a27a (vary it between people). Keep these proportions; clothes are boxes slightly larger than the body part they cover.`;

/** Sami's notes on the first pass (2026-10-20): every bible, design and critique answers to these. */
export const SAMI_NOTES = [
  'Everything in the world must be properly in line with its age, not today\'s town recoloured.',
  'Lot signs change with the age: in the Stone Age they are sticks and mud, not sign boards.',
  'The fountain in the middle of the square must become something fitting: a bonfire in the Stone Age.',
  'Sidewalks would not exist in the Stone Age, and roads are just mud.',
  'In the Middle Ages the roads are cobblestone; think hard about whether there would be sidewalks (probably not).',
  'Trees look too normal and symmetrical for the Stone Age: they must be wild, irregular, uneven.',
  'The sixth age is no longer a shiny future: the modern world has fallen and the town is a post-apocalyptic wasteland rebuilt from the ruins: rust, scrap, dust and fire barrels, muted and weathered, never bright or glowing neon. Keep colours dull and the ground calm so builds and people read.',
  'Think about the ages and the world as a full picture: every piece of the town changes with the age and they all agree with each other.',
];

/** The engine's limits every design must respect (the board's renderer and, later, the game). */
export const ENGINE_RULES = `Geometry: a list of parts, each exactly {"shape":"box"|"cylinder"|"sphere"|"cone","position":[x,y,z],"size":[width,height,depth],"rotation":[xRad,yRad,zRad],"color":"#rrggbb"} plus optional "glow":true for light-giving parts (fire, lamps, light strips, holograms). size is the bounding box of every shape; cylinders and cones stand along Y; ground is y 0 and every part sits at or above it (minY ≥ 0 counting rotation; flat ground details are about 0.02–0.1 m tall). Rotations are right-handed radians: positive x tips a part's +z end down; positive z lifts its +x end. Low-poly, chunky, readable from far away on a livestream viewed from above at about 40° (isometric-ish orthographic camera): prefer bold silhouettes and clear colour contrast over tiny detail; nothing thinner than 0.06 m. Max 160 parts. Characters are about 1.8 m tall: keep doors, benches, lamps and stalls at human scale.`;

export const elementById = (id: string) => ELEMENTS.find((e) => e.id === id);
