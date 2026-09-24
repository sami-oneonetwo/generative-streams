import {
  REAR_LOT,
  YARD_BOUNDS,
  contains,
  footprint,
  inflate,
  overlaps,
  type Rect,
} from '../../shared/safehouseLayout';
import type { GroundPoint, SafehouseObject } from '../../shared/safehouseTypes';
const STEP = 0.5,
  margin = 0.25;
/** A standing hole (`trap` use): ground to stand on, but nobody with sense walks into it, and nothing is built on it. */
export const isTrap = (o: SafehouseObject): boolean => o.destroyedAt === undefined && !!o.uses?.includes('trap');
/** The hole `p` stands in, if any. */
export const insideTrap = (p: GroundPoint, traps: SafehouseObject[]): SafehouseObject | undefined =>
  traps.find((t) => contains(footprint(t.position, t.footprint.width, t.footprint.depth), p));
/**
 * The first point along `a`→`b` that lies in a hole, sampled every quarter metre so a fast thing
 * cannot clear a hole inside one step. Undefined when the way is clear.
 */
export function crossesTrap(a: GroundPoint, b: GroundPoint, traps: SafehouseObject[]): GroundPoint | undefined {
  if (!traps.length) return undefined;
  const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 0.25));
  for (let i = 1; i <= n; i++) {
    const p = { x: a.x + ((b.x - a.x) * i) / n, z: a.z + ((b.z - a.z) * i) / n };
    if (insideTrap(p, traps)) return p;
  }
  return undefined;
}
export interface RouteOptions {
  /** The horde does not look where it is going: holes are not obstacles to it. Everyone else walks round. */
  ignoreTraps?: boolean;
}
// Every collider is a world object now; rubble, passable floors and living creatures never block.
// A hole is passable ground but counts as an obstacle for anyone who knows better (the default).
function obstacles(objects: SafehouseObject[], exclude?: string, ignoreTraps = false): Rect[] {
  return objects
    .filter(
      (o) =>
        o.id !== exclude &&
        o.destroyedAt === undefined &&
        !o.creature &&
        (!o.passable || (!ignoreTraps && isTrap(o))),
    )
    .map((o) => footprint(o.position, o.footprint.width, o.footprint.depth));
}
export function walkableSegment(a: GroundPoint, b: GroundPoint, objects: SafehouseObject[], opts: RouteOptions = {}): boolean {
  const blocked = obstacles(objects, undefined, opts.ignoreTraps).map((r) => inflate(r, margin));
  const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 0.1));
  for (let i = 0; i <= n; i++) {
    const p = { x: a.x + ((b.x - a.x) * i) / n, z: a.z + ((b.z - a.z) * i) / n };
    if (!contains(YARD_BOUNDS, p) || blocked.some((r) => contains(r, p))) return false;
  }
  return true;
}
export function route(from: GroundPoint, to: GroundPoint, objects: SafehouseObject[], opts: RouteOptions = {}): GroundPoint[] | null {
  const blocked = obstacles(objects, undefined, opts.ignoreTraps).map((r) => inflate(r, margin));
  const walk = (p: GroundPoint) => contains(YARD_BOUNDS, p) && !blocked.some((r) => contains(r, p));
  const snap = (p: GroundPoint) => ({ x: Math.round(p.x / STEP) * STEP, z: Math.round(p.z / STEP) * STEP });
  const start = snap(from),
    end = snap(to),
    key = (p: GroundPoint) => `${p.x},${p.z}`;
  // The walker may be standing where something is about to go (Rook at a work
  // spot, a zombie against a wall); he can always step out, so only the
  // destination and every step after the first must be clear.
  if (!contains(YARD_BOUNDS, start) || !walk(end)) return null;
  const queue = [start],
    visited = new Map<string, GroundPoint | null>([[key(start), null]]);
  let cursor = 0;
  while (cursor < queue.length) {
    const p = queue[cursor++];
    if (key(p) === key(end)) {
      const path: GroundPoint[] = [];
      let current: GroundPoint | null = p;
      while (current && key(current) !== key(start)) {
        path.unshift(current);
        current = visited.get(key(current)) ?? null;
      }
      return [start, ...path];
    }
    for (const [dx, dz] of [
      [STEP, 0],
      [-STEP, 0],
      [0, STEP],
      [0, -STEP],
    ]) {
      const n = { x: p.x + dx, z: p.z + dz };
      if (!visited.has(key(n)) && walk(n)) {
        visited.set(key(n), p);
        queue.push(n);
      }
    }
  }
  return null;
}
/**
 * Merge collinear grid steps into straight runs for the walker. A run is covered in
 * one go and he still stops at every corner, so the client never interpolates
 * across one. Safe on these BFS paths: adjacent walkable grid points are 0.5 m apart
 * and every obstacle is inflated past that, so the ground between them is clear.
 */
export function straighten(path: GroundPoint[]): GroundPoint[] {
  if (path.length < 3) return path;
  const out: GroundPoint[] = [path[0]];
  for (let i = 1; i < path.length - 1; i++) {
    const a = out[out.length - 1],
      b = path[i],
      c = path[i + 1];
    if (Math.abs((b.x - a.x) * (c.z - b.z) - (b.z - a.z) * (c.x - b.x)) > 1e-9) out.push(b);
  }
  out.push(path[path.length - 1]);
  return out;
}
/**
 * Where a footprint can stand and Rook can reach a spot beside it. `requested`
 * spots are tried in order; without one, an edit stays put and a new build
 * prefers the rear lot, then anywhere free in the neighborhood.
 */
export function choosePlacement(
  size: { width: number; depth: number },
  objects: SafehouseObject[],
  from: GroundPoint,
  target?: SafehouseObject,
  requested?: GroundPoint | GroundPoint[],
): { position: GroundPoint; path: GroundPoint[] } {
  const candidates: GroundPoint[] = requested ? [requested].flat() : target ? [target.position] : [];
  if (!target && !requested) {
    for (let z = REAR_LOT.maxZ - size.depth / 2; z >= REAR_LOT.minZ + size.depth / 2; z -= 0.5)
      for (let x = REAR_LOT.minX + size.width / 2; x <= REAR_LOT.maxX - size.width / 2; x += 0.5)
        candidates.push({ x, z });
    for (let z = YARD_BOUNDS.minZ + size.depth / 2; z < YARD_BOUNDS.maxZ - size.depth / 2; z += 2)
      for (let x = YARD_BOUNDS.minX + size.width / 2; x < YARD_BOUNDS.maxX - size.width / 2; x += 2)
        candidates.push({ x, z });
  }
  const others = objects.filter((o) => o.id !== target?.id),
    blocked = obstacles(objects, target?.id);
  for (const position of candidates) {
    const rect = footprint(position, size.width, size.depth);
    // Repairing or repainting a piece in place may touch its neighbors or hug the
    // edge of the yard (the back fence sits on it); it already stands there.
    const inPlace =
      !!target &&
      Math.abs(position.x - target.position.x) < 1e-6 &&
      Math.abs(position.z - target.position.z) < 1e-6 &&
      size.width <= target.footprint.width + 0.001 &&
      size.depth <= target.footprint.depth + 0.001;
    if (
      !inPlace &&
      (rect.minX < YARD_BOUNDS.minX ||
        rect.maxX > YARD_BOUNDS.maxX ||
        rect.minZ < YARD_BOUNDS.minZ ||
        rect.maxZ > YARD_BOUNDS.maxZ)
    )
      continue;
    if (!inPlace && blocked.some((r) => overlaps(rect, inflate(r, 0.35)))) continue;
    const synthetic: SafehouseObject = {
      id: 'placement-preview',
      revision: 1,
      blueprint: { name: '', description: '', parts: [] },
      position,
      footprint: size,
      createdBy: '',
      editedBy: '',
      createdAt: 0,
    };
    const work = [
      { x: position.x, z: rect.maxZ + 0.75 },
      { x: rect.maxX + 0.75, z: position.z },
      { x: rect.minX - 0.75, z: position.z },
      { x: position.x, z: rect.minZ - 0.75 },
    ].sort((a, b) => Math.hypot(a.x - from.x, a.z - from.z) - Math.hypot(b.x - from.x, b.z - from.z));
    // Standing on the spot itself (he just finished the previous job there): the
    // ground is free by construction, so he simply steps out to the nearest side.
    const standingOnIt = contains(inflate(rect, margin), from);
    for (const p of work) {
      if (standingOnIt) {
        if (contains(YARD_BOUNDS, p) && walkableSegment(from, p, others)) return { position, path: [p] };
        continue;
      }
      const path = route(from, p, [...others, synthetic]);
      if (path) return { position, path: straighten(path) };
    }
  }
  throw new Error(
    requested
      ? 'That spot is blocked, outside the neighborhood, or unreachable. Try another spot or a smaller size.'
      : target
        ? 'That change would overlap something or block access. Try a smaller edit.'
        : 'No free, reachable ground for that size anywhere. Try a smaller creation.',
  );
}
