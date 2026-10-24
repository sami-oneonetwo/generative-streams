// Ground, routes and where a build may stand. Adapted from the safehouse world's placement.ts for
// the city: anyone can walk anywhere inside the town (streets, pavements, across a lawn), builds
// go up inside a lot, and a straight line is used wherever one is clear, falling back to the
// half-metre grid search round whatever has been built.
import { contains, footprint, inflate, overlaps, type Rect } from '../../shared/layout';
import type { GroundPoint, SafehouseObject } from '../../shared/objectTypes';
import { LANDING, RIVER, SQUARE, TOWN_GROUND } from '../../shared/city';

/** Half the bridge's deck, across the river on z = 0: three logs side by side, about 3.4 m wide (client/dudes/agePieces.json). */
const DECK_HALF = 1.7;
/** The river where the bridge crosses it, between the town's ground and the landing on the far bank. */
const CROSSING: Rect = { minX: RIVER.x - RIVER.width / 2, maxX: RIVER.x + RIVER.width / 2, minZ: LANDING.minZ, maxZ: LANDING.maxZ };
/** The river at the crossing, but for the bridge's deck while the bridge stands. */
const riverWater = (deck: boolean): Rect[] => (deck ? [{ ...CROSSING, maxZ: -DECK_HALF }, { ...CROSSING, minZ: DECK_HALF }] : [{ ...CROSSING }]);

/**
 * The ground (layout A+, FK-078): the town and the River Bank down to the water (`bounds`), the way over
 * the river to the landing on the far bank (`over`), and what on it blocks walking that is not a build: the
 * fountain and the market stall on the square, and the river at the crossing (`water`), all of it but the
 * bridge's deck while the bridge stands (bridgeStands). `blocks` is here so tests can add to it.
 */
export const GROUND: { bounds: Rect; over: Rect; blocks: Rect[]; water: Rect[] } = {
  bounds: { ...TOWN_GROUND },
  over: { minX: TOWN_GROUND.maxX, maxX: LANDING.maxX, minZ: LANDING.minZ, maxZ: LANDING.maxZ },
  blocks: [
    footprint(SQUARE.fountain, SQUARE.fountain.r * 2, SQUARE.fountain.r * 2),
    footprint(SQUARE.market, SQUARE.market.w, SQUARE.market.d),
  ],
  water: riverWater(true),
};
let deckOpen = true;
/** The bridge stands or not (as the page draws it: city.ts townView's `bridge`): the river can be walked over only on its deck. */
export function bridgeStands(whole: boolean): void {
  if (whole !== deckOpen) [deckOpen, GROUND.water] = [whole, riverWater(whole)];
}
const inWater = (p: GroundPoint) => GROUND.water.some((r) => contains(r, p));
/** On the ground, `margin` metres in from its edge: in the town, or on the way over and the landing (water or not: that is route's). */
export function onGround(p: GroundPoint, margin = 0): boolean {
  const b = GROUND.bounds,
    o = GROUND.over;
  if (!(p.x < b.minX + margin || p.x > b.maxX - margin || p.z < b.minZ + margin || p.z > b.maxZ - margin)) return true;
  // The way over meets the town at the water's edge: no margin on that side.
  return !(p.x < o.minX - margin || p.x > o.maxX - margin || p.z < o.minZ + margin || p.z > o.maxZ - margin);
}
/** A point pulled onto the ground, `margin` metres in from its edge: where it is on the bridge or the landing, else inside the town (out of the river too). */
export function clampToGround(p: GroundPoint, margin = 1): GroundPoint {
  if (p.x > GROUND.bounds.maxX - margin && onGround(p, margin) && !inWater(p)) return { x: p.x, z: p.z };
  const b = GROUND.bounds;
  return { x: Math.max(b.minX + margin, Math.min(b.maxX - margin, p.x)), z: Math.max(b.minZ + margin, Math.min(b.maxZ - margin, p.z)) };
}
/**
 * The river cuts `a` off from `b`: the bridge is down and they are on opposite banks (one of them on the
 * landing), so there is no searching the whole town to find that out. Someone standing in it can still wade out.
 */
function cutOff(a: GroundPoint, b: GroundPoint): boolean {
  const o = GROUND.over;
  return GROUND.water.some((w) => w.minZ <= o.minZ && w.maxZ >= o.maxZ && !contains(w, a) && !contains(w, b) && (a.x < w.minX) !== (b.x < w.minX));
}

const STEP = 0.5,
  margin = 0.3;

/** Footprints that block walking and building: every standing build, plus any extra reserved ground. */
function obstacles(objects: SafehouseObject[], exclude?: string, reserved: Rect[] = [], overWater = false): Rect[] {
  return [
    ...(overWater ? [] : GROUND.water),
    ...objects
      .filter((o) => o.id !== exclude && o.destroyedAt === undefined && !o.passable)
      .map((o) => footprint(o.position, o.footprint.width, o.footprint.depth)),
    ...GROUND.blocks,
    ...reserved,
  ];
}

export function walkableSegment(a: GroundPoint, b: GroundPoint, objects: SafehouseObject[], reserved: Rect[] = [], overWater = false): boolean {
  // Whatever the walker is standing in (a build dropped on top of them) never holds them: they can walk out.
  const blocked = obstacles(objects, undefined, reserved, overWater)
    .map((r) => inflate(r, margin))
    .filter((r) => !contains(r, a));
  const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 0.2));
  // The first sample is where the walker stands; it can always step out of wherever that is.
  for (let i = 1; i <= n; i++) {
    const p = { x: a.x + ((b.x - a.x) * i) / n, z: a.z + ((b.z - a.z) * i) / n };
    if (!onGround(p) || blocked.some((r) => contains(r, p))) return false;
  }
  return true;
}

/** A path from `from` to `to` round every build, or null when `to` is blocked or unreachable. */
export function route(from: GroundPoint, to: GroundPoint, objects: SafehouseObject[], reserved: Rect[] = [], overWater = false): GroundPoint[] | null {
  if (walkableSegment(from, to, objects, reserved, overWater)) return [from, to];
  if (!overWater && cutOff(from, to)) return null;
  // As above: anything the walker is standing inside does not count, so they can always get out.
  const blocked = obstacles(objects, undefined, reserved, overWater)
    .map((r) => inflate(r, margin))
    .filter((r) => !contains(r, from));
  const walk = (p: GroundPoint) => onGround(p) && !blocked.some((r) => contains(r, p));
  const snap = (p: GroundPoint) => ({ x: Math.round(p.x / STEP) * STEP, z: Math.round(p.z / STEP) * STEP });
  const key = (p: GroundPoint) => `${p.x},${p.z}`;
  const start = snap(from);
  // A destination under something (the middle of the field with a build on it) means the nearest open ground to it.
  let end = snap(to);
  if (!walk(end)) {
    const near = nearestOpen(end, walk);
    if (!near) return null;
    end = near;
    if (walkableSegment(from, end, objects, reserved, overWater)) return [from, end];
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
    .filter((p) => onGround(p))
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
  /** A lot: the whole footprint must stand inside it, and the search starts at the anchor itself. */
  within?: Rect,
): GroundPoint {
  const blocked = obstacles(objects, undefined, reserved);
  const fits = (p: GroundPoint) => {
    const rect = footprint(p, size.width, size.depth);
    if (within) {
      if (rect.minX < within.minX + 0.2 || rect.maxX > within.maxX - 0.2 || rect.minZ < within.minZ + 0.2 || rect.maxZ > within.maxZ - 0.2) return false;
      // Inside a lot, things may stand closer together: it is one person's garden.
      return !blocked.some((r) => overlaps(rect, inflate(r, 0.6)));
    }
    const corners = [
      { x: rect.minX, z: rect.minZ },
      { x: rect.maxX, z: rect.minZ },
      { x: rect.minX, z: rect.maxZ },
      { x: rect.maxX, z: rect.maxZ },
    ];
    if (!corners.every((c) => onGround(c, 0.5))) return false;
    return !blocked.some((r) => overlaps(rect, inflate(r, 1.4))); // room to walk between builds
  };
  if (within && fits(anchor)) return { x: Math.round(anchor.x * 2) / 2, z: Math.round(anchor.z * 2) / 2 };
  // Start a little off the anchor so a dude building "here" does not build on its own head.
  const start = within ? 0.5 : Math.max(size.width, size.depth) / 2 + 1.2;
  const reach = within ? Math.hypot(within.maxX - within.minX, within.maxZ - within.minZ) : 90;
  for (let radius = start; radius < reach; radius += 0.5) {
    const steps = Math.max(8, Math.ceil((2 * Math.PI * radius) / 0.75));
    const offset = (radius * 7.3) % (2 * Math.PI); // vary the starting angle ring to ring
    for (let i = 0; i < steps; i++) {
      const a = offset + (i / steps) * 2 * Math.PI;
      const p = { x: Math.round((anchor.x + Math.cos(a) * radius) * 2) / 2, z: Math.round((anchor.z + Math.sin(a) * radius) * 2) / 2 };
      if (fits(p)) return p;
    }
  }
  throw new Error(within ? 'There is no room left on your lot for that. Remove something, or ask for something smaller.' : 'The town is full. Remove something first.');
}

/** A free spot for a new dude to appear on: near `centre` (the group), not inside anything, not on another dude. */
export function spawnPoint(objects: SafehouseObject[], taken: GroundPoint[], rng: () => number, centre: GroundPoint = { x: 0, z: 0 }): GroundPoint {
  const blocked = obstacles(objects).map((r) => inflate(r, 0.8));
  for (let tries = 0; tries < 400; tries++) {
    const spread = 6 + tries * 0.08;
    const p = clampToGround({ x: centre.x + (rng() * 2 - 1) * spread * 1.4, z: centre.z + (rng() * 2 - 1) * spread }, 2);
    if (blocked.some((r) => contains(r, p))) continue;
    if (taken.some((t) => Math.hypot(t.x - p.x, t.z - p.z) < 1.4)) continue;
    return p;
  }
  return { ...centre };
}
