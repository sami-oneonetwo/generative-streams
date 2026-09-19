import type { GroundPoint } from './safehouseTypes';
export interface Rect {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}
// Everything inside the playable rectangle is a world object; beyond it is backdrop. The block is
// three lots wide: the corner shop's lot to the west, Rook's in the middle, the park to the east.
export const YARD_BOUNDS: Rect = { minX: -54, maxX: 54, minZ: -18, maxZ: 19 };
export const REAR_LOT: Rect = { minX: -9, maxX: 11, minZ: -17, maxZ: -11 };
/** Rook's spot: the foot of his porch steps. The house sits at (0, -5.7) in the middle of the yard. */
export const SURVIVOR_START: GroundPoint = { x: 0, z: -0.5 };
/** Rook's house is the one seeded piece the request grammar knows by name ("the house"). */
export const HOUSE_ID = 'scenery-house';
/** Where Rook paces while he waits on a design: inside the fence, around the house. */
export const WANDER_AREA: Rect = { minX: -10, maxX: 12, minZ: -17, maxZ: 4 };
// Named areas chat can use instead of coordinates. Placement still checks each spot.
export const LANDMARKS: Record<string, Rect> = {
  'across the street': { minX: -50, maxX: 50, minZ: 15, maxZ: 18 },
  'west lot': { minX: -50, maxX: -30, minZ: -16, maxZ: 4 },
  'next door west': { minX: -50, maxX: -30, minZ: -16, maxZ: 4 },
  shop: { minX: -48, maxX: -36, minZ: -1.5, maxZ: 4 },
  'corner shop': { minX: -48, maxX: -36, minZ: -1.5, maxZ: 4 },
  'outside the shop': { minX: -48, maxX: -36, minZ: -1.5, maxZ: 4 },
  'bus stop': { minX: -42, maxX: -34, minZ: 1, maxZ: 5 },
  'east lot': { minX: 30, maxX: 50, minZ: -16, maxZ: 4 },
  'next door east': { minX: 30, maxX: 50, minZ: -16, maxZ: 4 },
  park: { minX: 30, maxX: 52, minZ: -17, maxZ: 3 },
  playground: { minX: 34, maxX: 48, minZ: -11, maxZ: -5 },
  pond: { minX: 36, maxX: 44, minZ: -17, maxZ: -11 },
  'in front of the house': { minX: -6, maxX: 6, minZ: -1.3, maxZ: 4.2 },
  'front yard': { minX: -6, maxX: 6, minZ: -1.3, maxZ: 4.2 },
  'behind the house': { minX: -6, maxX: 6, minZ: -17.5, maxZ: -10.9 },
  'back of the house': { minX: -6, maxX: 6, minZ: -17.5, maxZ: -10.9 },
  'beside the garage': { minX: 12.2, maxX: 18, minZ: -9, maxZ: -3 },
  'by the garage': { minX: 12.2, maxX: 18, minZ: -9, maxZ: -3 },
  driveway: { minX: 6.6, maxX: 11.4, minZ: -3.4, maxZ: 4.3 },
  'rear yard': REAR_LOT,
  'back yard': REAR_LOT,
  backyard: REAR_LOT,
  garden: { minX: -10.5, maxX: -7.3, minZ: -8.5, maxZ: 3.5 },
  street: { minX: -50, maxX: 50, minZ: 7.5, maxZ: 12.5 },
  road: { minX: -50, maxX: 50, minZ: 7.5, maxZ: 12.5 },
};
export function overlaps(a: Rect, b: Rect): boolean {
  return a.minX < b.maxX && a.maxX > b.minX && a.minZ < b.maxZ && a.maxZ > b.minZ;
}
export function contains(r: Rect, p: GroundPoint): boolean {
  return p.x >= r.minX && p.x <= r.maxX && p.z >= r.minZ && p.z <= r.maxZ;
}
export function inflate(r: Rect, n: number): Rect {
  return { minX: r.minX - n, maxX: r.maxX + n, minZ: r.minZ - n, maxZ: r.maxZ + n };
}
export function footprint(position: GroundPoint, width: number, depth: number): Rect {
  return {
    minX: position.x - width / 2,
    maxX: position.x + width / 2,
    minZ: position.z - depth / 2,
    maxZ: position.z + depth / 2,
  };
}
/** Half-metre grid over an area, nearest the middle first, so placement prefers the obvious spot. */
export function areaCandidates(area: Rect): GroundPoint[] {
  const cx = (area.minX + area.maxX) / 2,
    cz = (area.minZ + area.maxZ) / 2,
    points: GroundPoint[] = [];
  for (let x = Math.ceil(area.minX * 2) / 2; x <= area.maxX; x += 0.5)
    for (let z = Math.ceil(area.minZ * 2) / 2; z <= area.maxZ; z += 0.5) points.push({ x, z });
  return points.sort((a, b) => Math.hypot(a.x - cx, a.z - cz) - Math.hypot(b.x - cx, b.z - cz));
}
