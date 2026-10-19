// Ground, routes and where a build may stand. Adapted from the safehouse world's placement.ts for
// an open field: no traps, no rear lot, and a straight line wherever one is clear (most of the
// time out here), falling back to the half-metre grid search round whatever chat has built.
import { FIELD, contains, footprint, inflate, overlaps, type Rect } from '../../shared/layout';
import type { GroundPoint, SafehouseObject } from '../../shared/objectTypes';

const STEP = 0.5,
  margin = 0.3;

/** Footprints that block walking and building: every standing build, plus any extra reserved ground. */
function obstacles(objects: SafehouseObject[], exclude?: string, reserved: Rect[] = []): Rect[] {
  return [
    ...objects
      .filter((o) => o.id !== exclude && o.destroyedAt === undefined && !o.passable)
      .map((o) => footprint(o.position, o.footprint.width, o.footprint.depth)),
    ...reserved,
  ];
}

export function walkableSegment(a: GroundPoint, b: GroundPoint, objects: SafehouseObject[], reserved: Rect[] = []): boolean {
  // Whatever the walker is standing in (a build dropped on top of them) never holds them: they can walk out.
  const blocked = obstacles(objects, undefined, reserved)
    .map((r) => inflate(r, margin))
    .filter((r) => !contains(r, a));
  const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 0.2));
  // The first sample is where the walker stands; it can always step out of wherever that is.
  for (let i = 1; i <= n; i++) {
    const p = { x: a.x + ((b.x - a.x) * i) / n, z: a.z + ((b.z - a.z) * i) / n };
    if (!contains(FIELD, p) || blocked.some((r) => contains(r, p))) return false;
  }
  return true;
}

/** A path from `from` to `to` round every build, or null when `to` is blocked or unreachable. */
export function route(from: GroundPoint, to: GroundPoint, objects: SafehouseObject[], reserved: Rect[] = []): GroundPoint[] | null {
  if (walkableSegment(from, to, objects, reserved)) return [from, to];
  // As above: anything the walker is standing inside does not count, so they can always get out.
  const blocked = obstacles(objects, undefined, reserved)
    .map((r) => inflate(r, margin))
    .filter((r) => !contains(r, from));
  const walk = (p: GroundPoint) => contains(FIELD, p) && !blocked.some((r) => contains(r, p));
  const snap = (p: GroundPoint) => ({ x: Math.round(p.x / STEP) * STEP, z: Math.round(p.z / STEP) * STEP });
  const key = (p: GroundPoint) => `${p.x},${p.z}`;
  const start = snap(from);
  // A destination under something (the middle of the field with a build on it) means the nearest open ground to it.
  let end = snap(to);
  if (!walk(end)) {
    const near = nearestOpen(end, walk);
    if (!near) return null;
    end = near;
    if (walkableSegment(from, end, objects, reserved)) return [from, end];
  }
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
      return straighten([from, ...path]);
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

/** The closest walkable grid point to `p`, searching outward up to 8 m. */
function nearestOpen(p: GroundPoint, walk: (p: GroundPoint) => boolean): GroundPoint | undefined {
  for (let r = STEP; r <= 8; r += STEP)
    for (let i = 0; i < Math.ceil((2 * Math.PI * r) / STEP); i++) {
      const a = (i / Math.ceil((2 * Math.PI * r) / STEP)) * 2 * Math.PI;
      const q = { x: Math.round((p.x + Math.cos(a) * r) / STEP) * STEP, z: Math.round((p.z + Math.sin(a) * r) / STEP) * STEP };
      if (walk(q)) return q;
    }
  return undefined;
}

/** Merge collinear grid steps into straight runs. */
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

/** The four spots beside a footprint where someone stands to work on it, nearest `from` first. */
export function workSpots(position: GroundPoint, size: { width: number; depth: number }, from: GroundPoint): GroundPoint[] {
  const rect = footprint(position, size.width, size.depth);
  // The four sides first, then the corners, then a step further out: crowded fields leave some side open.
  const spots: GroundPoint[] = [];
  for (const off of [0.8, 1.6])
    spots.push(
      { x: position.x, z: rect.maxZ + off },
      { x: rect.maxX + off, z: position.z },
      { x: rect.minX - off, z: position.z },
      { x: position.x, z: rect.minZ - off },
      { x: rect.maxX + off * 0.7, z: rect.maxZ + off * 0.7 },
      { x: rect.minX - off * 0.7, z: rect.maxZ + off * 0.7 },
      { x: rect.maxX + off * 0.7, z: rect.minZ - off * 0.7 },
      { x: rect.minX - off * 0.7, z: rect.minZ - off * 0.7 },
    );
  return spots
    .filter((p) => contains(FIELD, p))
    .sort((a, b) => Math.hypot(a.x - from.x, a.z - from.z) - Math.hypot(b.x - from.x, b.z - from.z));
}

/**
 * Free ground for a footprint as close to `anchor` as it comes: rings outward half a metre at a
 * time, never overlapping a standing build or ground another dude has already claimed for a build
 * in flight (`reserved`), so twenty dudes building at once never put two things in one place.
 */
export function choosePlacement(
  size: { width: number; depth: number },
  objects: SafehouseObject[],
  anchor: GroundPoint,
  reserved: Rect[] = [],
): GroundPoint {
  const blocked = obstacles(objects, undefined, reserved);
  const fits = (p: GroundPoint) => {
    const rect = footprint(p, size.width, size.depth);
    if (rect.minX < FIELD.minX + 0.5 || rect.maxX > FIELD.maxX - 0.5 || rect.minZ < FIELD.minZ + 0.5 || rect.maxZ > FIELD.maxZ - 0.5)
      return false;
    return !blocked.some((r) => overlaps(rect, inflate(r, 1.4))); // room to walk between builds
  };
  // Start a little off the anchor so a dude building "here" does not build on its own head.
  const start = Math.max(size.width, size.depth) / 2 + 1.2;
  for (let radius = start; radius < 90; radius += 0.5) {
    const steps = Math.max(8, Math.ceil((2 * Math.PI * radius) / 0.75));
    const offset = (radius * 7.3) % (2 * Math.PI); // vary the starting angle ring to ring
    for (let i = 0; i < steps; i++) {
      const a = offset + (i / steps) * 2 * Math.PI;
      const p = { x: Math.round((anchor.x + Math.cos(a) * radius) * 2) / 2, z: Math.round((anchor.z + Math.sin(a) * radius) * 2) / 2 };
      if (fits(p)) return p;
    }
  }
  throw new Error('The field is full. Remove something first.');
}

/** A free spot for a new dude to appear on: near the middle, not inside anything, not on another dude. */
export function spawnPoint(objects: SafehouseObject[], taken: GroundPoint[], rng: () => number): GroundPoint {
  const blocked = obstacles(objects).map((r) => inflate(r, 0.8));
  for (let tries = 0; tries < 400; tries++) {
    const spread = 6 + tries * 0.08;
    const p = {
      x: Math.max(FIELD.minX + 2, Math.min(FIELD.maxX - 2, (rng() * 2 - 1) * spread * 1.4)),
      z: Math.max(FIELD.minZ + 2, Math.min(FIELD.maxZ - 2, (rng() * 2 - 1) * spread)),
    };
    if (blocked.some((r) => contains(r, p))) continue;
    if (taken.some((t) => Math.hypot(t.x - p.x, t.z - p.z) < 1.4)) continue;
    return p;
  }
  return { x: 0, z: 0 };
}
