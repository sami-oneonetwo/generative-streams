// The approved neighborhood as world objects. Everything here can be inspected,
// painted, redesigned, moved, damaged and rebuilt like a chat creation. Rook's
// house is one closed, roofed piece in the middle of the yard so chat builds
// around it; there is no interior to see or furnish.
import type { Blueprint, GroundPoint, Primitive, SafehouseObject } from '../../shared/safehouseTypes';
import { HOUSE_ID } from '../../shared/safehouseLayout';
import { SCENERY_LIMITS, measureBlueprint } from './blueprint';
import { initializeObject } from './combat';
import { rotateBlueprint } from './edits';

const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;
const box = (
  w: number,
  h: number,
  d: number,
  color: number,
  x: number,
  y: number,
  z: number,
  rotation: [number, number, number] = [0, 0, 0],
): Primitive => ({
  shape: 'box',
  position: [x, y, z],
  size: [w, h, d],
  rotation,
  color: hex(color),
});
const cyl = (
  r: number,
  h: number,
  color: number,
  x: number,
  y: number,
  z: number,
  rotation: [number, number, number] = [0, 0, 0],
): Primitive => ({
  shape: 'cylinder',
  position: [x, y, z],
  size: [r * 2, h, r * 2],
  rotation,
  color: hex(color),
});
const ball = (r: number, color: number, x: number, y: number, z: number, squash = 1): Primitive => ({
  shape: 'sphere',
  position: [x, y, z],
  size: [r * 2, r * 2 * squash, r * 2],
  rotation: [0, 0, 0],
  color: hex(color),
});

interface Options {
  role?: SafehouseObject['role'];
  health: number;
  passable?: boolean;
  description?: string;
}
function piece(
  id: string,
  name: string,
  position: GroundPoint,
  parts: Primitive[],
  opts: Options,
): SafehouseObject {
  const blueprint: Blueprint = { name, description: opts.description ?? 'Part of the neighborhood', parts };
  return initializeObject({
    id: `scenery-${id}`,
    revision: 1,
    blueprint,
    position,
    footprint: measureBlueprint(blueprint, SCENERY_LIMITS),
    createdBy: 'Neighborhood',
    editedBy: 'Neighborhood',
    createdAt: 0,
    role: opts.role ?? 'decoration',
    health: opts.health,
    maxHealth: opts.health,
    fixed: true,
    passable: opts.passable,
  });
}

/** Pieces of the old cutaway house (walls, floor, furniture). Saves that still have them lose them in the v5 migration. */
export const RETIRED_SCENERY_IDS = [
  'scenery-floor',
  'scenery-back-1',
  'scenery-back-2',
  'scenery-back-3',
  'scenery-west-1',
  'scenery-west-2',
  'scenery-front-1',
  'scenery-front-2',
  'scenery-front-3',
  'scenery-east-1',
  'scenery-east-2',
  'scenery-partition',
  'scenery-half-wall',
  'scenery-counter',
  'scenery-fridge',
  'scenery-table',
  'scenery-bed',
  'scenery-nightstand',
  'scenery-wardrobe',
  'scenery-couch',
  'scenery-coffee-table',
];
/** Yard clutter that moved with the house; untouched copies follow it, edited ones stay put. */
export const RELAID_SCENERY_IDS = ['scenery-barricade', 'scenery-crate', 'scenery-planks', 'scenery-board'];

function carParts(color: number): Primitive[] {
  const parts = [
    box(1.8, 0.65, 3.9, color, 0, 0.85, 0),
    box(1.5, 0.65, 1.9, color, 0, 1.5, -0.2),
    box(1.36, 0.48, 0.045, 0x687776, 0, 1.54, 0.79),
    box(1.36, 0.45, 0.045, 0x5b6966, 0, 1.54, -1.19),
    box(1.65, 0.15, 0.17, 0x8a9086, 0, 0.66, 2),
    box(0.75, 0.03, 0.6, 0x776652, 0.3, 1.2, -1.45),
  ];
  for (const x of [-0.79, 0.79]) parts.push(box(0.03, 0.4, 1.45, 0x566360, x, 1.57, -0.2));
  for (const x of [-0.87, 0.87])
    for (const z of [-1.2, 1.25]) parts.push(cyl(0.36, 0.18, 0x303633, x, 0.56, z, [0, 0, Math.PI / 2]));
  for (const x of [-0.58, 0.58]) parts.push(box(0.35, 0.22, 0.06, 0xc8c29c, x, 0.92, 1.98));
  return parts;
}
function crate(x: number, z: number): Primitive[] {
  return [
    box(0.72, 0.62, 0.72, 0xa08c63, x, 0.44, z),
    box(0.75, 0.055, 0.75, 0x75694b, x, 0.25, z),
    box(0.75, 0.055, 0.75, 0x75694b, x, 0.58, z),
  ];
}
function barrel(x: number, z: number): Primitive[] {
  return [
    cyl(0.4, 1.05, 0x586f75, x, 0.64, z),
    cyl(0.415, 0.065, 0x48585b, x, 0.3, z),
    cyl(0.415, 0.065, 0x48585b, x, 0.9, z),
    cyl(0.34, 0.02, 0x344849, x, 1.175, z),
  ];
}
function house(): Primitive[] {
  return [
    box(9, 3.6, 7, 0x8c8b78, 0, 1.8, 0),
    box(10, 0.28, 4.8, 0x656d63, 0, 4.05, -1.75, [0.4, 0, 0]),
    box(10, 0.28, 4.8, 0x656d63, 0, 4.05, 1.75, [-0.4, 0, 0]),
    box(1.4, 1.35, 0.04, 0x47554e, -2.8, 1.9, 3.53),
    box(1.4, 1.35, 0.04, 0x47554e, 2.8, 1.9, 3.53),
    box(1.15, 2.1, 0.04, 0x655f4c, 0, 1.05, 3.54),
  ];
}
/**
 * Rook's place: a boarded-up bungalow with a porch facing the street. The body
 * sits at local z -1 so the porch steps and the roof overhang balance around
 * the origin (footprints are measured symmetrically). Parts are ordered so a
 * rebuild rises foundation → walls → roof → porch → boards.
 */
function rookHouse(): Primitive[] {
  const wall = 0x9c9682,
    roof = 0x5b635a,
    plank = 0x8d7856,
    boarded = 0x3e4a44,
    porch = 0x7d6e52;
  const parts: Primitive[] = [
    box(8.8, 0.4, 6.8, 0x6d685a, 0, 0.2, -1), // foundation
    box(8.6, 3.4, 6.6, wall, 0, 1.7, -1), // walls
    box(9.6, 0.26, 4, roof, 0, 4, -2.55, [0.42, 0, 0]), // rear roof slab
    box(9.6, 0.26, 4, roof, 0, 4, 0.55, [-0.42, 0, 0]), // front roof slab
    box(9.7, 0.22, 0.4, 0x4c534b, 0, 4.85, -1), // ridge beam
    box(0.7, 1.7, 0.7, 0x6a5a50, 2.7, 4.6, -1.9), // chimney
    box(1.2, 0.06, 0.9, 0x746d5f, -2.4, 4.38, -3.09, [0.42, 0, 0]), // roof patch
    box(3.6, 0.3, 1.6, porch, 0, 0.3, 3.1), // porch deck
    box(2.2, 0.16, 0.5, porch, 0, 0.2, 4.15), // upper step
    box(2.2, 0.16, 0.5, 0x75664c, 0, 0.08, 4.65), // lower step
    box(3.9, 0.14, 1.9, roof, 0, 2.6, 3.15, [-0.12, 0, 0]), // porch roof
    cyl(0.08, 2.3, 0x6b5b45, -1.7, 1.45, 3.75), // porch posts
    cyl(0.08, 2.3, 0x6b5b45, 1.7, 1.45, 3.75),
    box(1.1, 2.1, 0.06, 0x5a5346, 0, 1.5, 2.33), // front door
    box(1.3, 0.16, 0.05, plank, 0, 1.55, 2.37, [0, 0, 0.35]), // door brace
    box(1.3, 1.2, 0.05, boarded, -2.6, 2, 2.33), // front windows, boarded over
    box(1.3, 1.2, 0.05, boarded, 2.6, 2, 2.33),
    box(0.05, 1.1, 1.2, boarded, -4.33, 2, -1.6), // side windows
    box(0.05, 1.1, 1.2, boarded, 4.33, 2, -1.6),
  ];
  for (const x of [-2.6, 2.6])
    for (let i = 0; i < 2; i++)
      parts.push(box(1.5, 0.17, 0.06, plank, x, 1.75 + i * 0.45, 2.37, [0, 0, i ? -0.1 : 0.12]));
  for (const x of [-4.37, 4.37])
    for (let i = 0; i < 2; i++)
      parts.push(box(0.06, 0.17, 1.4, plank, x, 1.8 + i * 0.4, -1.6, [i ? -0.1 : 0.12, 0, 0]));
  parts.push(
    box(1.6, 0.25, 0.05, plank, -3.3, 1, 2.34, [0, 0, 0.2]), // patch planks
    box(0.05, 0.25, 1.8, plank, 4.34, 1.1, 0.6, [0.15, 0, 0]),
  );
  for (const x of [-2.4, -1.9, 1.9, 2.4]) parts.push(ball(0.32, 0x8b7d5c, x, 0.25, 4.75, 0.7)); // sandbags
  // Slide everything back so the porch steps and the rear eave sit equally far from the origin.
  return parts.map((p) => ({ ...p, position: [p.position[0], p.position[1], p.position[2] - 0.3] }));
}
function tree(s: number): Primitive[] {
  const parts = [cyl(0.13 * s, 2.4 * s, 0x655b49, 0, 1.2 * s, 0)];
  [0x5e6f4d, 0x697b55, 0x77875c].forEach((color, j) =>
    parts.push(ball((1.15 - j * 0.16) * s, color, (j % 2) * 0.25 * s, (2.3 + j * 0.58) * s, 0, 0.85)),
  );
  return parts;
}
function pole(): Primitive[] {
  return [
    cyl(0.15, 7, 0x70624c, 0, 3.5, 0),
    box(2.1, 0.13, 0.13, 0x686653, 0, 6.55, 0),
    box(0.8, 0.09, 0.3, 0x727c70, 0, 5.9, -0.6),
  ];
}

// ---- The block beyond Rook's lot (state v7): the corner shop to the west, the park to the east.
/** A boarded corner shop: flat roof, red fascia, awning over the door, boards over the windows. */
function shop(): Primitive[] {
  const wall = 0x9a8f7c,
    trim = 0x5f6a63,
    board = 0x4a5450,
    plank = 0x8d7856;
  const parts: Primitive[] = [
    box(10, 0.4, 8, 0x6d685a, 0, 0.2, 0), // slab
    box(9.6, 3.8, 7.6, wall, 0, 2.1, 0), // body
    box(10.2, 0.3, 8.2, trim, 0, 4.15, 0), // flat roof
    box(10.4, 0.5, 0.3, 0x77413a, 0, 3.6, 3.95), // red fascia band
    box(6, 0.12, 1.6, 0x8a4a3f, 0, 3.05, 4.6, [0.25, 0, 0]), // awning
    box(4.2, 0.7, 0.06, 0xd9cfa8, 0, 3.6, 4.13), // sign plaque
    box(3.4, 1.9, 0.06, board, -2.6, 1.6, 3.83), // boarded windows
    box(3.4, 1.9, 0.06, board, 2.6, 1.6, 3.83),
    box(1.2, 2.3, 0.08, 0x5a5346, 0, 1.15, 3.85), // door
    box(0.9, 0.9, 0.7, 0x6b7a6f, -4.2, 0.45, -3), // air unit round the back
  ];
  for (const x of [-2.6, 2.6])
    for (let i = 0; i < 3; i++) parts.push(box(3.6, 0.16, 0.05, plank, x, 1 + i * 0.6, 3.87, [0, 0, i % 2 ? 0.08 : -0.06]));
  return parts;
}
function busShelter(): Primitive[] {
  const parts: Primitive[] = [];
  for (const x of [-1.4, 1.4]) for (const z of [-0.5, 0.5]) parts.push(cyl(0.06, 2.4, 0x5d6a63, x, 1.2, z));
  parts.push(
    box(3.2, 0.1, 1.4, 0x6f7a72, 0, 2.45, 0), // roof
    box(3, 1.3, 0.05, 0x8fa3a6, 0, 1.6, -0.55), // frosted back panel
    box(2.4, 0.08, 0.45, 0x8d7856, 0, 0.55, -0.2), // bench
    box(0.6, 1.1, 0.06, 0xc8bd97, 1.6, 1.7, 0), // timetable board
  );
  return parts;
}
function skip(): Primitive[] {
  return [
    box(2.2, 1.3, 1.3, 0x4f6a4e, 0, 0.75, 0),
    box(2.3, 0.12, 1.4, 0x3f563f, 0, 1.45, 0, [0, 0, 0.05]),
    box(0.15, 0.4, 0.15, 0x333833, -0.9, 0.2, 0),
    box(0.15, 0.4, 0.15, 0x333833, 0.9, 0.2, 0),
  ];
}
function hoarding(): Primitive[] {
  return [
    cyl(0.1, 3.2, 0x6b5e4a, -2.6, 1.6, 0),
    cyl(0.1, 3.2, 0x6b5e4a, 2.6, 1.6, 0),
    box(6, 2.6, 0.12, 0xb5ad8c, 0, 2.4, 0), // weathered poster board
    box(6.1, 0.15, 0.16, 0x5f5a4e, 0, 3.75, 0),
  ];
}
function slide(): Primitive[] {
  const parts: Primitive[] = [cyl(0.07, 2.2, 0x6f7a72, -0.5, 1.1, -1.2), cyl(0.07, 2.2, 0x6f7a72, 0.5, 1.1, -1.2)];
  for (let i = 0; i < 5; i++) parts.push(box(1, 0.05, 0.05, 0x8b8f86, 0, 0.5 + i * 0.4, -1.2)); // rungs
  parts.push(
    box(1.1, 0.1, 1.1, 0x8a9a8e, 0, 2.2, -0.9), // platform
    box(0.9, 0.08, 3.4, 0xc4552f, 0, 1.25, 0.6, [-0.55, 0, 0]), // chute
    box(0.08, 0.3, 3.4, 0xa8452a, -0.45, 1.4, 0.6, [-0.55, 0, 0]), // rails
    box(0.08, 0.3, 3.4, 0xa8452a, 0.45, 1.4, 0.6, [-0.55, 0, 0]),
  );
  return parts;
}
function swings(): Primitive[] {
  const parts: Primitive[] = [];
  for (const x of [-1.9, 1.9]) for (const z of [-0.55, 0.55]) parts.push(cyl(0.08, 2.9, 0x5d6a63, x, 1.4, z, [z < 0 ? 0.36 : -0.36, 0, 0]));
  parts.push(box(4.2, 0.12, 0.12, 0x5d6a63, 0, 2.7, 0)); // top bar
  for (const x of [-1, 1]) {
    parts.push(box(0.5, 0.06, 0.25, 0x7d5730, x, 0.6, 0)); // seat
    for (const dx of [-0.2, 0.2]) parts.push(cyl(0.015, 2.05, 0x8b8f86, x + dx, 1.65, 0)); // chains
  }
  return parts;
}
function sandpit(): Primitive[] {
  return [
    box(3, 0.12, 3, 0xd7c8a0, 0, 0.06, 0),
    box(3.2, 0.2, 0.15, 0x8d7856, 0, 0.1, -1.55),
    box(3.2, 0.2, 0.15, 0x8d7856, 0, 0.1, 1.55),
    box(0.15, 0.2, 3.2, 0x8d7856, -1.55, 0.1, 0),
    box(0.15, 0.2, 3.2, 0x8d7856, 1.55, 0.1, 0),
  ];
}
function pond(): Primitive[] {
  return [cyl(2.9, 0.1, 0x8a8a74, 0, 0.02, 0), cyl(2.6, 0.06, 0x5a7a86, 0, 0.07, 0)];
}
function bench(): Primitive[] {
  return [
    box(1.8, 0.08, 0.45, 0x8d7856, 0, 0.5, 0),
    box(1.8, 0.5, 0.06, 0x8d7856, 0, 0.85, -0.22, [-0.15, 0, 0]),
    box(0.08, 0.5, 0.45, 0x4c524d, -0.8, 0.25, 0),
    box(0.08, 0.5, 0.45, 0x4c524d, 0.8, 0.25, 0),
  ];
}
function picnicTable(): Primitive[] {
  return [
    box(1.8, 0.08, 0.8, 0x9d8860, 0, 0.75, 0),
    box(1.8, 0.06, 0.35, 0x9d8860, 0, 0.45, -0.7),
    box(1.8, 0.06, 0.35, 0x9d8860, 0, 0.45, 0.7),
    box(0.1, 0.7, 1.7, 0x6f6249, -0.6, 0.38, 0, [0, 0, 0.35]),
    box(0.1, 0.7, 1.7, 0x6f6249, 0.6, 0.38, 0, [0, 0, -0.35]),
  ];
}
function parkShed(): Primitive[] {
  return [
    box(3, 2.4, 2.2, 0x76705c, 0, 1.2, 0),
    box(3.3, 0.2, 2.5, 0x555c52, 0, 2.5, 0, [0.15, 0, 0]),
    box(0.9, 1.8, 0.05, 0x4f4a3f, 0, 0.9, 1.13),
  ];
}
/** Seeded with state v7; the migration adds exactly these to older worlds. */
export const BLOCK_SCENERY_IDS = [
  'scenery-shop',
  'scenery-bus-shelter',
  'scenery-skip',
  'scenery-hoarding',
  'scenery-car-far-west',
  'scenery-car-far-west-2',
  'scenery-pole-far-west',
  'scenery-slide',
  'scenery-swings',
  'scenery-sandpit',
  'scenery-pond',
  'scenery-bench-west',
  'scenery-bench-east',
  'scenery-picnic',
  'scenery-park-shed',
  'scenery-car-far-east',
  'scenery-pole-far-east',
  ...Array.from({ length: 7 }, (_, i) => `scenery-tree-${8 + i}`),
];
function blockObjects(): SafehouseObject[] {
  const rotatedCar = (color: number, angle: number) =>
    rotateBlueprint({ name: '', description: '', parts: carParts(color) }, angle).parts;
  const objects = [
    piece('shop', 'Corner shop', { x: -42, z: -6 }, shop(), {
      role: 'barrier',
      health: 1500,
      description: 'Boarded-up corner shop on the west lot',
    }),
    piece('bus-shelter', 'Bus shelter', { x: -38, z: 6.3 }, busShelter(), { health: 300 }),
    piece('skip', 'Skip bin', { x: -48, z: -13.5 }, skip(), { health: 200 }),
    piece('hoarding', 'Hoarding', { x: -46, z: 16.5 }, hoarding(), { health: 300 }),
    piece('car-far-west', 'Abandoned car (far west)', { x: -41, z: 10.6 }, rotatedCar(0x6f7a83, 1.5), { health: 300 }),
    piece('car-far-west-2', 'Abandoned van', { x: -50, z: 11.4 }, rotatedCar(0x8a8570, 1.7), { health: 300 }),
    piece('pole-far-west', 'Utility pole (far west)', { x: -45, z: 5.8 }, pole(), { health: 500 }),
    piece('slide', 'Slide', { x: 38, z: -9 }, slide(), { health: 300, description: 'Playground slide in the park' }),
    piece('swings', 'Swings', { x: 44, z: -9 }, swings(), { health: 300, description: 'Playground swings in the park' }),
    piece('sandpit', 'Sandpit', { x: 41, z: -4 }, sandpit(), { health: 100, passable: true }),
    piece('pond', 'Pond', { x: 40, z: -14.5 }, pond(), { health: 100, passable: true, description: 'A shallow pond in the park' }),
    piece('bench-west', 'Park bench (west)', { x: 34, z: -2 }, bench(), { health: 150 }),
    piece('bench-east', 'Park bench (east)', { x: 48, z: -2 }, bench(), { health: 150 }),
    piece('picnic', 'Picnic table', { x: 48, z: -13 }, picnicTable(), { health: 200 }),
    piece('park-shed', 'Park shed', { x: 52, z: -16.5 }, parkShed(), { role: 'barrier', health: 600 }),
    piece('car-far-east', 'Abandoned car (far east)', { x: 45, z: 10.6 }, rotatedCar(0x7a6a5e, 1.55), { health: 300 }),
    piece('pole-far-east', 'Utility pole (far east)', { x: 45, z: 5.8 }, pole(), { health: 500 }),
  ];
  (
    [
      [-52, -14, 1.4],
      [-31, 1.5, 1.1],
      [-33, 17, 1.2],
      [31, -15, 1.3],
      [47, 2, 1],
      [52, 15, 1.2],
      [36, 17, 1.1],
    ] as [number, number, number][]
  ).forEach(([x, z, s], i) => objects.push(piece(`tree-${8 + i}`, `Tree ${8 + i}`, { x, z }, tree(s), { health: 400 })));
  return objects;
}

export function sceneryObjects(): SafehouseObject[] {
  const barricade: Primitive[] = [];
  for (let i = 0; i < 5; i++) barricade.push(box(0.16, 1.75, 0.16, 0x8d7653, -1.16 + i * 0.58, 1.12, -0.1));
  for (let i = 0; i < 3; i++)
    barricade.push(
      box(3, 0.18, 0.15, i % 2 ? 0xa5936a : 0x8e7b57, 0, 0.66 + i * 0.4, 0, [0, 0, i % 2 ? 0.045 : -0.04]),
    );
  const garage = [
    box(5.3, 2.9, 5, 0x8a8e7a, 0, 1.45, 0),
    box(5.6, 0.22, 5.4, 0x626e68, 0, 3, 0),
    box(3.4, 2.3, 0.055, 0x626b64, 0, 1.18, 2.53),
    box(0.7, 0.22, 0.02, 0xbcb79a, 0, 2.65, 2.63),
  ];
  for (let x = -2.7; x <= 2.7; x += 0.3) garage.push(box(0.045, 0.06, 5.4, 0x778079, x, 3.14, 0));
  for (let y = 0.2; y < 2.3; y += 0.25) garage.push(box(3.4, 0.018, 0.05, 0x939887, 0, y, 2.58));
  for (const x of [-1.2, 1]) {
    garage.push(box(1.7, 0.09, 2.1, 0x40595f, x, 3.26, 0.2, [0.13, 0, 0]));
    for (let i = 0; i < 4; i++) garage.push(box(0.015, 0.02, 2, 0x718582, x - 0.64 + i * 0.42, 3.34, 0.2));
  }
  const gardenBed = (row: number) => {
    const parts = [
      box(2.7, 0.2, 1.12, 0x4d5140, 0, 0.12, 0),
      box(2.9, 0.16, 0.08, 0x9a8760, 0, 0.23, -0.55),
      box(2.9, 0.16, 0.08, 0x9a8760, 0, 0.23, 0.55),
    ];
    for (let i = 0; i < 5; i++)
      for (let j = 0; j < 3; j++)
        parts.push(
          box(0.08, 0.36, 0.29, [0x5c7847, 0x738950, 0x8d985b][row], -1 + i * 0.5, 0.4, 0, [
            0,
            j * 1.5,
            (j - 1) * 0.5,
          ]),
        );
    return parts;
  };
  const objects: SafehouseObject[] = [
    piece(HOUSE_ID.replace(/^scenery-/, ''), "Rook's house", { x: 0, z: -5.7 }, rookHouse(), {
      role: 'barrier',
      health: 4000,
      description: "Rook's boarded-up house. He lives here and keeps it standing.",
    }),
    // Yard clutter flanks the porch and leaves the ground straight in front of the steps free to build on.
    piece('barricade', 'Barricade', { x: -4.6, z: 0.4 }, barricade, {
      role: 'barrier',
      health: 300,
      description: 'Posts and planks leaning by the porch',
    }),
    piece('crate', 'Supply crate', { x: 3.9, z: -0.3 }, crate(0, 0), { health: 120 }),
    piece(
      'planks',
      'Plank stack',
      { x: 4.1, z: 1.4 },
      Array.from({ length: 5 }, (_, i) => box(2.4, 0.1, 0.18, 0x9d8860, 0, 0.16 + i * 0.11, 0)),
      { health: 120 },
    ),
    piece('board', 'Loose board', { x: -2.8, z: 1.9 }, [box(0.8, 0.05, 0.55, 0x757d6c, 0, 0.08, 0)], {
      health: 60,
    }),
    piece('garden-1', 'Garden bed 1', { x: -8.8, z: -6.5 }, gardenBed(0), { health: 150 }),
    piece('garden-2', 'Garden bed 2', { x: -8.8, z: -4.7 }, gardenBed(1), { health: 150 }),
    piece('garden-3', 'Garden bed 3', { x: -8.8, z: -2.9 }, gardenBed(2), { health: 150 }),
    piece('barrels', 'Rain barrels', { x: -8.9, z: -0.6 }, [...barrel(0.5, 0), ...barrel(-0.5, 0)], {
      health: 150,
    }),
    piece('crates', 'Storage crates', { x: -9.4, z: 2.65 }, [...crate(0.4, -0.15), ...crate(-0.4, 0.15)], {
      health: 150,
    }),
    piece('compost', 'Compost bin', { x: -9, z: -8.7 }, [box(1, 0.8, 1, 0x71684e, 0, 0.4, 0)], {
      health: 120,
    }),
    piece('garage', 'Garage', { x: 9, z: -6.4 }, garage, {
      role: 'barrier',
      health: 1200,
      description: 'Garage with solar panels and a roll-up door',
    }),
    piece('car', "Rook's car", { x: 9, z: 0.15 }, carParts(0x8a6a53), { health: 300 }),
    piece(
      'car-west',
      'Abandoned car (west)',
      { x: -7, z: 10.4 },
      rotateBlueprint({ name: '', description: '', parts: carParts(0x727d72) }, 1.4).parts,
      { health: 300 },
    ),
    piece(
      'car-east',
      'Abandoned car (east)',
      { x: 15, z: 11.3 },
      rotateBlueprint({ name: '', description: '', parts: carParts(0x786451) }, 1.9).parts,
      { health: 300 },
    ),
    piece('house-west', 'Neighbor house (west)', { x: -20, z: -4 }, house(), {
      health: 1500,
      description: 'Empty house next door',
    }),
    piece('house-east', 'Neighbor house (east)', { x: 23, z: -5 }, house(), {
      health: 1500,
      description: 'Empty house next door',
    }),
    piece('pole-west', 'Utility pole (west)', { x: -15, z: 5.8 }, pole(), { health: 500 }),
    piece('pole-east', 'Utility pole (east)', { x: 15, z: 5.8 }, pole(), { health: 500 }),
    piece(
      'bin',
      'Rubbish bin',
      { x: -10.2, z: 5.5 },
      [box(0.8, 1, 0.8, 0x586658, 0, 0.5, 0), box(0.9, 0.12, 0.9, 0x6b7769, 0, 1.05, 0)],
      { health: 120 },
    ),
    piece('gate-west', 'Gate post (west)', { x: 4.2, z: 4.6 }, [box(0.22, 2, 0.22, 0x746a53, 0, 1, 0)], {
      health: 200,
    }),
    piece(
      'gate-east',
      'Gate post (east)',
      { x: 9.5, z: 4.6 },
      [box(0.22, 2, 0.22, 0x746a53, 0, 1, 0), box(2.4, 0.5, 0.03, 0xb8af85, 0, 2.3, 0.08)],
      { health: 200 },
    ),
  ];
  (
    [
      [-13, -10, 1.4],
      [-13, 1, 1.1],
      [15, -10, 1.3],
      [17, 2, 1],
      [20, 17, 1.2],
      [-19, 17, 1.3],
      [-23, 7, 1.5],
    ] as [number, number, number][]
  ).forEach(([x, z, s], i) =>
    objects.push(piece(`tree-${i + 1}`, `Tree ${i + 1}`, { x, z }, tree(s), { health: 400 })),
  );
  return [...objects, ...blockObjects()];
}
