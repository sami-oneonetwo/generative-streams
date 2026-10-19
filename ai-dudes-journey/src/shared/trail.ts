// The journey's ground, the same on the server and the page: a forest path that winds gently on
// forever toward −z, and a wide glade along it that is the walkable, buildable window. Everything
// here is a pure function of the journey's seed, so the page draws the very trees the server
// routes round and chat can chop, without one tree ever going over the wire.
import type { Rect } from './layout';

export const TRAIL = {
  /** Half the glade's width either side of the path: how far from the path you can walk and build. */
  glade: 22,
  /** How far the window reaches behind the camp (+z) and ahead of it (−z). */
  behind: 70,
  ahead: 50,
  chunk: 40,
  /** Interactable edge scenery (trees you can chop, boulders) stands this far from the path. */
  edgeMin: 13,
  edgeMax: 20,
  /** The forest proper starts here, beyond the glade; it never reaches into it. */
  forestMin: 27,
  forestMax: 90,
};

/** mulberry32: small, fast, deterministic. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashText(text: string): number {
  let h = 2166136261;
  for (const c of text) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
}

const mix = (seed: number, n: number) => (Math.imul(seed ^ 0x9e3779b9, 2654435761) ^ Math.imul(n | 0, 40503)) >>> 0;

let phases = { seed: -1, p1: 0, p2: 0, f0: 0 };
/** The path's centre line: a slow meander (≤ 8 m either way, wavelengths of a few hundred metres), 0 at z = 0. */
export function trailX(seed: number, z: number): number {
  if (phases.seed !== seed) {
    const r = seeded(seed);
    const p1 = r() * Math.PI * 2,
      p2 = r() * Math.PI * 2;
    phases = { seed, p1, p2, f0: 5 * Math.sin(p1) + 3 * Math.sin(p2) };
  }
  return 5 * Math.sin(z / 60 + phases.p1) + 3 * Math.sin(z / 37 + phases.p2) - phases.f0;
}

/**
 * The walkable, buildable stretch round the camp, as a bounding rectangle: the glade from `behind`
 * back to `ahead` on. The glade itself bends with the path; `inGlade` is the exact test.
 */
export function windowAt(seed: number, campZ: number): Rect {
  let lo = Infinity,
    hi = -Infinity;
  for (let z = campZ - TRAIL.ahead; z <= campZ + TRAIL.behind; z += 5) {
    const x = trailX(seed, z);
    lo = Math.min(lo, x);
    hi = Math.max(hi, x);
  }
  return { minX: lo - TRAIL.glade, maxX: hi + TRAIL.glade, minZ: campZ - TRAIL.ahead, maxZ: campZ + TRAIL.behind };
}

/** Within the glade's width of the path (the z range is the window's business). */
export const inGlade = (seed: number, p: { x: number; z: number }, margin = 0) => Math.abs(p.x - trailX(seed, p.z)) <= TRAIL.glade - margin;

export type SceneryKind = 'pine' | 'oak' | 'birch' | 'boulder';
export interface SceneryItem {
  id: string;
  kind: SceneryKind;
  x: number;
  z: number;
  scale: number;
  /** In the glade, near enough to walk up to: blocks walking and can be used (chop a tree). */
  edge: boolean;
}
export const SCENERY_NAMES: Record<SceneryKind, string> = { pine: 'pine tree', oak: 'oak tree', birch: 'birch tree', boulder: 'boulder' };
/** Footprint side of an edge item, metres. */
export const sceneryFootprint = (s: SceneryItem) => (s.kind === 'boulder' ? 1.6 * s.scale : 1.1);

/** The chunk a z falls in: chunk i covers z in (−(i+1)·40, −i·40]. */
export const chunkOf = (z: number) => Math.floor(-z / TRAIL.chunk);

/** Everything standing in one 40 m stretch: a few edge trees and boulders in the glade, and the forest beyond. */
export function sceneryChunk(seed: number, i: number, forest = true): SceneryItem[] {
  const r = seeded(mix(seed, i));
  const out: SceneryItem[] = [];
  const z0 = -i * TRAIL.chunk;
  const kinds: SceneryKind[] = ['pine', 'pine', 'oak', 'birch'];
  // Edge things: two or three a side, spaced so a path always runs between them.
  for (const side of [-1, 1]) {
    const n = 2 + Math.floor(r() * 2);
    for (let k = 0; k < n; k++) {
      const z = z0 - ((k + 0.2 + r() * 0.6) / n) * TRAIL.chunk;
      const lateral = TRAIL.edgeMin + r() * (TRAIL.edgeMax - TRAIL.edgeMin);
      const boulder = r() < 0.25;
      out.push({
        id: `s${i}${side < 0 ? 'l' : 'r'}${k}`,
        kind: boulder ? 'boulder' : kinds[Math.floor(r() * kinds.length)],
        x: trailX(seed, z) + side * lateral,
        z,
        scale: boulder ? 0.8 + r() * 0.7 : 0.9 + r() * 0.5,
        edge: true,
      });
    }
  }
  if (!forest) return out;
  // The forest: dense either side, thinning with distance. Only the page draws these.
  for (let k = 0; k < 90; k++) {
    const z = z0 - r() * TRAIL.chunk;
    const side = r() < 0.5 ? -1 : 1;
    const lateral = TRAIL.forestMin + Math.pow(r(), 1.4) * (TRAIL.forestMax - TRAIL.forestMin);
    out.push({
      id: `f${i}-${k}`,
      kind: r() < 0.06 ? 'boulder' : kinds[Math.floor(r() * kinds.length)],
      x: trailX(seed, z) + side * lateral,
      z,
      scale: 0.9 + r() * 0.8,
      edge: false,
    });
  }
  return out;
}

/** Edge scenery between two z values (the server's view: no forest). */
export function edgeSceneryBetween(seed: number, minZ: number, maxZ: number): SceneryItem[] {
  const out: SceneryItem[] = [];
  for (let i = chunkOf(maxZ); i <= chunkOf(minZ); i++) for (const s of sceneryChunk(seed, i, false)) if (s.z >= minZ && s.z <= maxZ) out.push(s);
  return out;
}
