// The journey: everyone walks together down an endless forest path. The group's anchor (the camp)
// moves along the trail at a steady walk; the walkable window moves with it (`syncGround`), every
// character keeps up with its own loose spot in the crowd (sim.ts `keepUp`), and whatever was built
// and left standing slides out behind and is gone. Builds someone is driving or riding come along.
// Zero AI: the trail, the pace and the scenery are the app's (src/shared/trail.ts).
import { footprint, type Rect } from '../../shared/layout';
import type { Blueprint, GroundPoint, SafehouseObject } from '../../shared/objectTypes';
import { edgeSceneryBetween, hashText, SCENERY_NAMES, sceneryFootprint, trailX, TRAIL, windowAt, type SceneryItem } from '../../shared/trail';
import type { JourneyView } from '../../shared/dudesTypes';
import { setGround, GROUND } from './placement';
import { LIMITS, pushFeed, pushLine, type Dude, type DudesState, type Journey } from './state';

export const CARAVAN = {
  speed: 1.5, // m/s: slower than a walk (2.4), so anyone who stopped a moment catches up
  run: 4.2, // a straggler far behind runs
  farBehind: 25,
  /** The camp waits while most of the awake group is further back than this. */
  waitFor: 18,
  /** A character this close to its spot just walks along. */
  near: 0.6,
  chopMs: 6000,
  logsPerDude: 1,
};

export function journeyOf(state: DudesState): Journey {
  return (state.journey ??= { seed: hashText(`trail:${state.createdAt}`) % 1_000_000, campZ: 0, leg: 1, phase: 'travel', walked: 0, felled: [] });
}

export function campOf(state: DudesState): GroundPoint {
  const j = journeyOf(state);
  return { x: trailX(j.seed, j.campZ), z: j.campZ };
}

/** The walking group is on the move (not stopped at a challenge, not paused by the operator). */
export function travelling(state: DudesState): boolean {
  const j = journeyOf(state);
  return !j.paused && (j.phase === 'travel' || j.phase === 'approach' || (j.phase === 'arrived' && !!j.arriving));
}

/** Edge trees and boulders in the window right now, minus the felled ones. */
export function sceneryNow(state: DudesState): SceneryItem[] {
  const j = journeyOf(state),
    w = windowAt(j.seed, j.campZ);
  const felled = new Set(j.felled);
  return edgeSceneryBetween(j.seed, w.minZ - 2, w.maxZ + 2).filter((s) => !felled.has(s.id));
}

export function sceneryRect(s: SceneryItem): Rect {
  const side = sceneryFootprint(s);
  return footprint(s, side, side);
}

/**
 * The water across the trail near the group: each river, all of it, unless frozen over; a finished
 * bridge opens a lane along the path.
 */
export function waterRects(state: DudesState): Rect[] {
  const j = journeyOf(state);
  const out: Rect[] = [];
  for (const f of j.features ?? []) {
    if (f.ice >= 1) continue;
    const minZ = f.z - f.half,
      maxZ = f.z + f.half;
    const wide = { minX: -1e6, maxX: 1e6, minZ, maxZ };
    if (f.bridge < 1) out.push(wide);
    else {
      const mid = trailX(j.seed, f.z);
      out.push({ ...wide, maxX: mid - 2 }, { ...wide, minX: mid + 2 });
    }
  }
  return out;
}

/** Point the router and placement at the window round the camp, with the edge scenery and the water blocking. */
export function syncGround(state: DudesState): void {
  const j = journeyOf(state);
  setGround(windowAt(j.seed, j.campZ), sceneryNow(state).map(sceneryRect), j.seed, waterRects(state));
}

/**
 * Where this character walks within the group: a loose spot round the camp, its own from its id,
 * spread wider and deeper the more people there are. Nappers trail along at the back.
 */
export function slotOf(state: DudesState, dude: Dude, awakeCount: number, away: boolean): GroundPoint {
  const j = journeyOf(state);
  const h = hashText(dude.id);
  const width = 4 + Math.min(9, awakeCount * 0.45),
    depth = 3 + Math.min(14, awakeCount * 0.5);
  const lateral = (((h & 1023) / 1023) * 2 - 1) * width;
  // Aim a little ahead of the spot while the group walks, so the walk is smooth rather than stop-start.
  const lead = travelling(state) ? 1.2 : 0;
  const back = 1.5 + ((h >>> 10) & 1023) / 1023 * depth + (away ? 8 : 0) - lead;
  const z = j.campZ + back;
  return { x: trailX(j.seed, z) + lateral, z };
}

const dist = (a: GroundPoint, b: GroundPoint) => Math.hypot(a.x - b.x, a.z - b.z);

/** Pace of a character keeping up: the group's walk, faster when it has fallen back. */
export function keepUpSpeed(state: DudesState, dude: Dude, slot: GroundPoint): number {
  const d = dist(dude.position, slot);
  if (d > CARAVAN.farBehind) return CARAVAN.run;
  return Math.max(1, Math.min(2.8, (travelling(state) ? CARAVAN.speed : 1.3) + (d - 1) * 0.6));
}

/**
 * One tick of the walk: the camp moves on (waiting for a group that has fallen behind, and standing
 * still when nobody is awake), and builds left behind the window are gone.
 */
export function tickJourney(state: DudesState, dt: number, now: number, awake: (d: Dude) => boolean): void {
  const j = journeyOf(state);
  if (travelling(state)) {
    const group = state.dudes.filter((d) => awake(d) && !d.muted);
    if (group.length) {
      // Most of the group further back than `waitFor` (busy building, sitting about): the camp waits.
      const behind = group.map((d) => d.position.z - j.campZ).sort((a, b) => a - b);
      const median = behind[Math.floor(behind.length / 2)];
      if (median < CARAVAN.waitFor + 12) {
        const step = (CARAVAN.speed * dt) / 1000;
        j.campZ -= step;
        j.walked += step;
      }
    }
  }
  syncGround(state);
  leaveBehind(state, now);
}

/** Builds wholly behind the window stay where they stood, which is to say: gone from the journey. */
function leaveBehind(state: DudesState, now: number): void {
  const back = GROUND.bounds.maxZ + 2;
  // Anything someone is aboard, on their way to use, or still working on is not left behind.
  const aboard = new Set([...state.dudes.flatMap((d) => [d.riding, d.use?.objectId]), ...state.jobs.map((j) => j.targetId)].filter(Boolean));
  const gone: SafehouseObject[] = [];
  state.objects = state.objects.filter((o) => {
    const at = o.driven?.at ?? o.position;
    const behind = at.z - o.footprint.depth / 2 > back && !aboard.has(o.id);
    if (behind) gone.push(o);
    return !behind;
  });
  if (gone.length) {
    state.worldRevision++;
    const ids = new Set(gone.map((o) => o.id));
    for (const d of state.dudes) {
      if (d.use && ids.has(d.use.objectId)) d.use = undefined;
      for (const o of gone) if (o.owner === d.id) pushLine(d.history, { from: 'world', text: `the group walked on and left your ${o.blueprint.name} behind`, at: now }, LIMITS.history);
    }
    for (const j of state.jobs) if (j.targetId && ids.has(j.targetId)) j.status = 'failed';
    if (state.vandalised) for (const id of ids) delete state.vandalised[id];
    if (state.hatPiles) for (const id of ids) delete state.hatPiles[id];
    pushFeed(state, now, gone.length === 1 ? `${gone[0].blueprint.name} was left behind` : `${gone.length} builds were left behind`);
  }
  // Felled trees and rivers far behind no longer matter.
  const j = journeyOf(state);
  if (j.features?.length && !j.challenge) j.features = j.features.filter((f) => f.z - f.half < back + 10);
  if (j.felled.length > 300) j.felled = j.felled.slice(-300);
}

// ---- trees -----------------------------------------------------------------------------------
/** Edge scenery near a character, nearest first, for its agent and for matching "that tree". */
export function sceneryNear(state: DudesState, at: GroundPoint, n = 6): { item: SceneryItem; name: string; metres: number }[] {
  return sceneryNow(state)
    .map((item) => ({ item, name: SCENERY_NAMES[item.kind], metres: Math.round(dist(item, at) * 10) / 10 }))
    .sort((a, b) => a.metres - b.metres)
    .slice(0, n);
}

/** A felled tree as a build: a log lying on the ground, the chopper's. */
export function logBlueprint(kind: SceneryItem['kind']): Blueprint {
  const bark = kind === 'birch' ? '#d9d4c4' : '#6b4f35',
    end = '#c9a46a';
  return {
    name: `${SCENERY_NAMES[kind].replace(' tree', '')} log`,
    description: `A ${SCENERY_NAMES[kind]} chopped down by the trail, lying on its side.`,
    parts: [
      { shape: 'cylinder', position: [0, 0.35, 0], size: [0.7, 4.2, 0.7], rotation: [0, 0, Math.PI / 2], color: bark },
      { shape: 'cylinder', position: [2.11, 0.35, 0], size: [0.6, 0.04, 0.6], rotation: [0, 0, Math.PI / 2], color: end },
      { shape: 'cylinder', position: [-2.11, 0.35, 0], size: [0.6, 0.04, 0.6], rotation: [0, 0, Math.PI / 2], color: end },
      { shape: 'box', position: [0.6, 0.72, 0.1], size: [0.5, 0.18, 0.12], rotation: [0, 0, 0.5], color: bark },
    ],
  } as Blueprint;
}


export function journeyView(state: DudesState): JourneyView {
  const j = journeyOf(state);
  return {
    seed: j.seed,
    camp: campOf(state),
    leg: j.leg,
    phase: j.phase,
    walked: Math.round(j.walked),
    ...(j.paused ? { paused: true } : {}),
    felled: j.felled,
    ...(j.features?.length ? { rivers: j.features.map((f) => ({ id: f.id, z: f.z, half: f.half, bridge: f.bridge, ice: f.ice })) } : {}),
  };
}

/** One line for every agent: where the group is and what it is doing. */
export function journeyLine(state: DudesState): string {
  const j = journeyOf(state);
  const km = (j.walked / 1000).toFixed(1);
  if (j.paused) return `The group has stopped on the forest path for now (${km} km walked so far).`;
  return `Everyone is walking together down a forest path toward something nobody has seen yet (${km} km so far). You walk along with the group unless you are doing something; builds you leave standing get left behind, but anything you drive or ride comes with you.`;
}
