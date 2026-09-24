// How a living build gets about: the routing and stepping shared by the preset behaviours
// (creatures.ts) and the rule interpreter (rules.ts). Pure helpers over the world; no state
// of their own. Split out of creatures.ts so rules.ts can use them without a circular import.
import type { CombatState, CreatureState, GroundPoint, SafehouseObject } from '../../shared/safehouseTypes';
import { contains, footprint, YARD_BOUNDS } from '../../shared/safehouseLayout';
import { crossesTrap, insideTrap, isTrap, route, straighten, walkableSegment } from './placement';
import { CREATURES, TACTICS, intact } from './combat';

/** What the creature tick sees of the world. Everything past `survivor` is optional so tests can stay small. */
export interface World {
  objects: SafehouseObject[];
  combat: CombatState;
  survivor: { position: GroundPoint };
  /** The neighbours: a fighter they built sticks with its owner rather than with Rook; rules can flee them. */
  neighbours?: { id: string; position: GroundPoint }[];
  /** Viewers on the pavement (crowd.ts): a rule target (`kind: 'viewer'`); absent means nobody is watching. */
  crowd?: { position: GroundPoint }[];
  /** For `night`/`day` rule triggers; absent means day. */
  lighting?: 'day' | 'night';
}

/** Flight profile: cruise height by behaviour, the dip for a strike, and the floor speed (nothing flaps at 1 m/s). */
export const FLIGHT = { cruise: 6.5, cruiseZoom: 8, swoop: 2.5, minSpeed: 3 };

export const objectDistance = (p: GroundPoint, o: SafehouseObject): number => {
  const r = footprint(o.position, o.footprint.width, o.footprint.depth);
  return Math.hypot(Math.max(r.minX - p.x, 0, p.x - r.maxX), Math.max(r.minZ - p.z, 0, p.z - r.maxZ));
};
export const distance = (a: GroundPoint, b: GroundPoint): number => Math.hypot(a.x - b.x, a.z - b.z);
export const flies = (o: SafehouseObject): boolean => !!o.creature?.flying;
/** Can `a` get at `b`? Anything reaches the ground; only a flyer reaches a flyer. */
export const canReach = (a: SafehouseObject, b: SafehouseObject): boolean => flies(a) || !flies(b);
export const speedOf = (st: CreatureState): number =>
  st.flying ? Math.max(FLIGHT.minSpeed, CREATURES[st.behaviour].speed) : CREATURES[st.behaviour].speed;
/** What a creature has to walk around: standing solid pieces, never other creatures or itself. */
export const solidFor = (objects: SafehouseObject[], self: string): SafehouseObject[] =>
  objects.filter((o) => intact(o) && !o.passable && !o.creature && o.id !== self);
/** Standing spots beside a piece, nearest first. */
export function approaches(o: SafehouseObject, from: GroundPoint): GroundPoint[] {
  const r = footprint(o.position, o.footprint.width, o.footprint.depth);
  return [
    { x: o.position.x, z: r.maxZ + 0.75 },
    { x: o.position.x, z: r.minZ - 0.75 },
    { x: r.minX - 0.75, z: o.position.z },
    { x: r.maxX + 0.75, z: o.position.z },
  ].sort((a, b) => distance(a, from) - distance(b, from));
}
export function head(c: SafehouseObject, st: CreatureState, to: GroundPoint): void {
  const dx = to.x - c.position.x,
    dz = to.z - c.position.z;
  if (Math.hypot(dx, dz) > 0.001) st.facing = Math.atan2(dx, dz);
}
/** Plan a way to `target`: a flyer goes straight for the spot above it; a walker routes to a side. */
export function routeTo(c: SafehouseObject, st: CreatureState, target: SafehouseObject, solid: SafehouseObject[]): boolean {
  if (st.flying) {
    st.path = [{ ...target.position }];
    return true;
  }
  for (const p of approaches(target, c.position)) {
    const path = route(c.position, p, solid);
    if (path) {
      st.path = straighten(path);
      return true;
    }
  }
  return false;
}
export function routeToPoint(c: SafehouseObject, st: CreatureState, p: GroundPoint, solid: SafehouseObject[]): boolean {
  if (st.flying) {
    if (!contains(YARD_BOUNDS, p)) return false;
    st.path = [{ ...p }];
    return true;
  }
  const path = route(c.position, p, solid);
  if (!path) return false;
  st.path = straighten(path);
  return true;
}
/** The standing holes among the objects: what a walker can fall into. */
export const trapsIn = (objects: SafehouseObject[]): SafehouseObject[] => objects.filter(isTrap);
export { crossesTrap, insideTrap } from './placement';
/** It walked into a hole: stuck for a while, path forgotten. */
function fallIn(c: SafehouseObject, st: CreatureState, at: GroundPoint): void {
  c.position = { ...at };
  st.path = [];
  st.moving = false;
  st.heldMs = TACTICS.trap.creatureHoldMs;
  st.freeMs = undefined;
}
/**
 * The hole bookkeeping for one tick, before the creature does anything else: time held counts
 * down (nothing moves or bites while stuck), the grace after climbing out counts down, and a
 * ground creature standing in a fresh hole falls in. Flyers never do. True while it is stuck.
 */
export function heldStep(c: SafehouseObject, st: CreatureState, traps: SafehouseObject[], dt: number): boolean {
  if ((st.heldMs ?? 0) > 0) {
    const stuckIn = insideTrap(c.position, traps);
    // The hole was filled or is gone: out at once.
    st.heldMs = stuckIn ? Math.max(0, (st.heldMs ?? 0) - dt) : 0;
    if (st.heldMs > 0) {
      st.moving = false;
      return true;
    }
    st.heldMs = undefined;
    st.freeMs = TACTICS.trap.graceMs;
    st.replanMs = 0;
    return false;
  }
  if ((st.freeMs ?? 0) > 0) {
    st.freeMs = Math.max(0, (st.freeMs ?? 0) - dt);
    if (st.freeMs === 0) st.freeMs = undefined;
    return false;
  }
  if (!st.flying && insideTrap(c.position, traps)) {
    fallIn(c, st, c.position);
    return true;
  }
  return false;
}
/**
 * Spend the step's travel along the path; the whole budget, across waypoints. Flyers never check
 * the ground. A walker whose way crosses a hole stops in it and is held (`traps`).
 */
export function advance(c: SafehouseObject, st: CreatureState, solid: SafehouseObject[], dt: number, traps: SafehouseObject[] = []): void {
  if ((st.heldMs ?? 0) > 0) {
    st.moving = false;
    return;
  }
  let budget = (dt / 1000) * speedOf(st);
  st.moving = false;
  while (budget > 0 && st.path[0]) {
    const next = st.path[0];
    if (!st.flying && !walkableSegment(c.position, next, solid, { ignoreTraps: true })) {
      st.path = [];
      st.replanMs = 0;
      break;
    }
    const dx = next.x - c.position.x,
      dz = next.z - c.position.z,
      d = Math.hypot(dx, dz);
    if (d > 0.001) st.facing = Math.atan2(dx, dz);
    st.moving = true;
    const reach = Math.min(d, budget);
    const to = d <= budget ? { ...next } : { x: c.position.x + (dx / d) * budget, z: c.position.z + (dz / d) * budget };
    if (!st.flying && (st.freeMs ?? 0) === 0) {
      const hole = crossesTrap(c.position, to, traps);
      if (hole) {
        fallIn(c, st, hole);
        return;
      }
    }
    c.position = to;
    if (d <= budget) st.path.shift();
    budget -= reach;
  }
}
/** Within striking distance: beside it on the ground, or right over it from the air. */
export const inReach = (c: SafehouseObject, target: SafehouseObject, reach: number): boolean =>
  flies(c) ? distance(c.position, target.position) <= Math.max(reach, target.footprint.width / 2) : objectDistance(c.position, target) <= reach;
