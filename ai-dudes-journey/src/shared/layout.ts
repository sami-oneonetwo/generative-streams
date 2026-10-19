import type { GroundPoint } from './objectTypes';
export interface Rect {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}
/** The field: an empty meadow, everything inside is walkable and buildable; beyond it is backdrop. */
export const FIELD: Rect = { minX: -80, maxX: 80, minZ: -56, maxZ: 56 };
export const FIELD_CENTRE: GroundPoint = { x: 0, z: 0 };
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
