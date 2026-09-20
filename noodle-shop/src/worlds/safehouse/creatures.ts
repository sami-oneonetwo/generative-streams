// Life in the yard: chat's living builds. A creature is an ordinary world object
// (inspect it, paint it, rebuild it) with a `creature` state that this module runs
// every world tick, zombies paused or not. The model only picks one of four
// behaviours (and whether it flies) and draws the body; every number here is the
// app's (CREATURES in combat.ts), and nothing a creature does is a mechanic the
// model invented.
//
//   rampage  runs to the nearest fence, build or bit of clutter and breaks it — never
//            the house — then picks something else; hits back at a fighter biting it
//   fight    goes for rampaging creatures first, then zombies, and otherwise stays
//            close to Rook
//   zoom     drives fast to a far point, then another, and never touches anything
//   roam     ambles a few metres, waits, ambles again
//
// Flight is a property any of them can have. A flyer moves in straight lines at
// roof height over everything (no routing, no obstacles), climbs after it is built
// and falls when it is downed. Ground creatures cannot reach a flyer; flyers reach
// anything, dipping to strike a ground target; turrets shoot hostile flyers like
// anything else.
//
// Creatures never block placement or anyone's path (placement.ts, combat.ts), so a
// dog under a build site is simply a dog standing in the way for a moment.
import type {
  CombatState,
  CreatureBehaviour,
  CreatureState,
  GroundPoint,
  SafehouseObject,
} from '../../shared/safehouseTypes';
import { contains, footprint, HOUSE_ID, YARD_BOUNDS } from '../../shared/safehouseLayout';
import { route, straighten, walkableSegment } from './placement';
import { CREATURES, damageObject, intact, isHostile } from './combat';

export interface CreatureEvent {
  kind: 'hit' | 'down' | 'kill'; // a hit landed; an object fell; a zombie was killed
  id: string; // the creature
  targetId: string; // what it hit / felled / killed
}
interface World {
  objects: SafehouseObject[];
  combat: CombatState;
  survivor: { position: GroundPoint };
  /** The neighbours: a fighter they built sticks with its owner rather than with Rook. */
  neighbours?: { id: string; position: GroundPoint }[];
}

/** Flight profile: cruise height by behaviour, the dip for a strike, and the floor speed (nothing flaps at 1 m/s). */
export const FLIGHT = { cruise: 6.5, cruiseZoom: 8, swoop: 2.5, minSpeed: 3 };

export function freshCreature(behaviour: CreatureBehaviour, flying = false): CreatureState {
  return {
    behaviour,
    facing: Math.PI,
    moving: false,
    path: [],
    replanMs: 0,
    cooldownMs: 0,
    ...(flying ? { flying: true, altitude: 0 } : {}),
  };
}

const objectDistance = (p: GroundPoint, o: SafehouseObject) => {
  const r = footprint(o.position, o.footprint.width, o.footprint.depth);
  return Math.hypot(Math.max(r.minX - p.x, 0, p.x - r.maxX), Math.max(r.minZ - p.z, 0, p.z - r.maxZ));
};
const distance = (a: GroundPoint, b: GroundPoint) => Math.hypot(a.x - b.x, a.z - b.z);
export const flies = (o: SafehouseObject) => !!o.creature?.flying;
/** Can `a` get at `b`? Anything reaches the ground; only a flyer reaches a flyer. */
export const canReach = (a: SafehouseObject, b: SafehouseObject) => flies(a) || !flies(b);
const speedOf = (st: CreatureState) =>
  st.flying ? Math.max(FLIGHT.minSpeed, CREATURES[st.behaviour].speed) : CREATURES[st.behaviour].speed;
/** What a creature has to walk around: standing solid pieces, never other creatures or itself. */
const solidFor = (objects: SafehouseObject[], self: string) =>
  objects.filter((o) => intact(o) && !o.passable && !o.creature && o.id !== self);
/** Standing spots beside a piece, nearest first. */
function approaches(o: SafehouseObject, from: GroundPoint): GroundPoint[] {
  const r = footprint(o.position, o.footprint.width, o.footprint.depth);
  return [
    { x: o.position.x, z: r.maxZ + 0.75 },
    { x: o.position.x, z: r.minZ - 0.75 },
    { x: r.minX - 0.75, z: o.position.z },
    { x: r.maxX + 0.75, z: o.position.z },
  ].sort((a, b) => distance(a, from) - distance(b, from));
}
function head(c: SafehouseObject, st: CreatureState, to: GroundPoint) {
  const dx = to.x - c.position.x,
    dz = to.z - c.position.z;
  if (Math.hypot(dx, dz) > 0.001) st.facing = Math.atan2(dx, dz);
}
/** Plan a way to `target`: a flyer goes straight for the spot above it; a walker routes to a side. */
function routeTo(c: SafehouseObject, st: CreatureState, target: SafehouseObject, solid: SafehouseObject[]): boolean {
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
function routeToPoint(c: SafehouseObject, st: CreatureState, p: GroundPoint, solid: SafehouseObject[]): boolean {
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
/** Spend the step's travel along the path; the whole budget, across waypoints. Flyers never check the ground. */
function advance(c: SafehouseObject, st: CreatureState, solid: SafehouseObject[], dt: number) {
  let budget = (dt / 1000) * speedOf(st);
  st.moving = false;
  while (budget > 0 && st.path[0]) {
    const next = st.path[0];
    if (!st.flying && !walkableSegment(c.position, next, solid)) {
      st.path = [];
      st.replanMs = 0;
      break;
    }
    const dx = next.x - c.position.x,
      dz = next.z - c.position.z,
      d = Math.hypot(dx, dz);
    if (d > 0.001) st.facing = Math.atan2(dx, dz);
    st.moving = true;
    if (d <= budget) {
      c.position = { ...next };
      st.path.shift();
      budget -= d;
    } else {
      c.position.x += (dx / d) * budget;
      c.position.z += (dz / d) * budget;
      budget = 0;
    }
  }
}
/** Within striking distance: beside it on the ground, or right over it from the air. */
const inReach = (c: SafehouseObject, target: SafehouseObject, reach: number) =>
  flies(c) ? distance(c.position, target.position) <= Math.max(reach, target.footprint.width / 2) : objectDistance(c.position, target) <= reach;

function rampage(
  c: SafehouseObject,
  st: CreatureState,
  w: World,
  solid: SafehouseObject[],
  dt: number,
  rng: () => number,
  events: CreatureEvent[],
): boolean {
  const profile = CREATURES.rampage;
  // A fighter at its heels gets its attention first — if it can get at it.
  const biter = w.objects.find(
    (o) =>
      o.creature?.behaviour === 'fight' &&
      intact(o) &&
      o.creature.targetId === c.id &&
      canReach(c, o) &&
      distance(c.position, o.position) <= 2.2,
  );
  if (biter && st.targetId !== biter.id) {
    st.targetId = biter.id;
    st.path = [];
    st.hits = 0;
  }
  let target = w.objects.find((o) => o.id === st.targetId && intact(o));
  if (!target || (st.replanMs === 0 && !inReach(c, target, 1.1))) {
    // Something breakable nearby, never the house, never another rampager, nothing it cannot reach: one of the closest few.
    const choices = w.objects
      .filter((o) => intact(o) && !o.passable && o.id !== c.id && o.id !== HOUSE_ID && !isHostile(o) && canReach(c, o))
      .map((o) => ({ o, d: objectDistance(c.position, o) }))
      .filter((x) => x.d <= (st.flying ? 30 : 18))
      .sort((a, b) => a.d - b.d)
      .slice(0, 5);
    target = undefined;
    st.path = [];
    st.hits = 0;
    while (choices.length) {
      const i = Math.min(choices.length - 1, Math.floor(rng() * choices.length));
      const [pick] = choices.splice(i, 1);
      if (inReach(c, pick.o, 1.1) || routeTo(c, st, pick.o, solid)) {
        target = pick.o;
        break;
      }
    }
    st.targetId = target?.id;
    st.replanMs = target ? 9000 : 3000;
  }
  if (!target) {
    st.moving = false;
    return false;
  }
  if (inReach(c, target, 1.1)) {
    st.moving = false;
    head(c, st, target.position);
    if (st.cooldownMs > 0) return false;
    damageObject(target, profile.damage, w.combat.time);
    st.cooldownMs = profile.cooldownMs;
    st.hits = (st.hits ?? 0) + 1;
    events.push({ kind: 'hit', id: c.id, targetId: target.id });
    if (!intact(target)) events.push({ kind: 'down', id: c.id, targetId: target.id });
    // Enough of that one; find something else to wreck.
    if (!intact(target) || st.hits >= 6) {
      st.targetId = undefined;
      st.replanMs = 0;
    }
    return true;
  }
  advance(c, st, solid, dt);
  return false;
}

function fight(
  c: SafehouseObject,
  st: CreatureState,
  w: World,
  solid: SafehouseObject[],
  dt: number,
  events: CreatureEvent[],
): boolean {
  const profile = CREATURES.fight;
  let enemy = w.objects.find((o) => o.id === st.targetId && isHostile(o) && intact(o));
  let zombie = w.combat.zombies.find((z) => z.id === st.targetId && z.health > 0);
  const lost = st.targetId !== undefined && !enemy && !zombie;
  // Built to hunt one particular creature (a neighbour's answer to the yard gorilla): that one
  // first, wherever it is on the block; forgotten once it is down.
  if (st.nemesis && !w.objects.some((o) => o.id === st.nemesis && intact(o))) st.nemesis = undefined;
  const nemesis = st.nemesis ? w.objects.find((o) => o.id === st.nemesis && isHostile(o) && intact(o) && canReach(c, o)) : undefined;
  if (lost || st.replanMs === 0) {
    st.path = [];
    const hunted = nemesis && (inReach(c, nemesis, 1.2) || routeTo(c, st, nemesis, solid)) ? { o: nemesis, d: 0 } : undefined;
    const rampager =
      hunted ??
      w.objects
        .filter((o) => isHostile(o) && intact(o) && canReach(c, o))
        .map((o) => ({ o, d: objectDistance(c.position, o) }))
        .filter((x) => x.d <= (st.flying ? 30 : 18))
        .sort((a, b) => a.d - b.d)
        .find((x) => inReach(c, x.o, 1.2) || routeTo(c, st, x.o, solid));
    if (rampager) {
      st.targetId = rampager.o.id;
      st.replanMs = 2500;
      enemy = rampager.o;
    } else {
      const prey = w.combat.zombies
        .filter((z) => z.health > 0)
        .map((z) => ({ z, d: distance(c.position, z.position) }))
        .filter((x) => x.d <= (st.flying ? 24 : 14))
        .sort((a, b) => a.d - b.d)
        .find((x) => x.d <= 1.2 || routeToPoint(c, st, x.z.position, solid));
      if (prey) {
        st.targetId = prey.z.id;
        st.replanMs = 1500; // zombies move: re-aim often
        zombie = prey.z;
      } else {
        // Nobody to fight: stay close to whoever it belongs to — a neighbour for their hunter, else Rook.
        st.targetId = undefined;
        st.replanMs = 2000;
        const keeper = (c.owner && w.neighbours?.find((n) => n.id === c.owner)?.position) || w.survivor.position;
        if (distance(c.position, keeper) > 4) {
          const spots = [
            { x: keeper.x + 1.5, z: keeper.z },
            { x: keeper.x - 1.5, z: keeper.z },
            { x: keeper.x, z: keeper.z + 1.5 },
            { x: keeper.x, z: keeper.z - 1.5 },
          ].sort((a, b) => distance(a, c.position) - distance(b, c.position));
          for (const p of spots) if (routeToPoint(c, st, p, solid)) break;
        } else head(c, st, keeper);
      }
    }
  }
  if (enemy) {
    if (inReach(c, enemy, 1.2)) {
      st.moving = false;
      head(c, st, enemy.position);
      if (st.cooldownMs > 0) return false;
      damageObject(enemy, profile.damage, w.combat.time);
      st.cooldownMs = profile.cooldownMs;
      events.push({ kind: 'hit', id: c.id, targetId: enemy.id });
      if (!intact(enemy)) {
        events.push({ kind: 'down', id: c.id, targetId: enemy.id });
        st.targetId = undefined;
        st.replanMs = 0;
      }
      return true;
    }
    advance(c, st, solid, dt);
    return false;
  }
  if (zombie) {
    if (distance(c.position, zombie.position) <= 1.2) {
      st.moving = false;
      head(c, st, zombie.position);
      if (st.cooldownMs > 0) return false;
      zombie.health -= profile.damage;
      st.cooldownMs = profile.cooldownMs;
      events.push({ kind: 'hit', id: c.id, targetId: zombie.id });
      if (zombie.health <= 0) {
        w.combat.zombies = w.combat.zombies.filter((z) => z !== zombie);
        w.combat.kills++;
        w.combat.wave.killed++;
        events.push({ kind: 'kill', id: c.id, targetId: zombie.id });
        st.targetId = undefined;
        st.replanMs = 0;
      }
      return true;
    }
    advance(c, st, solid, dt);
    return false;
  }
  // Nobody to fight: on the way to Rook, or standing by him.
  advance(c, st, solid, dt);
  return false;
}

/** zoom and roam: somewhere to go, a breather, somewhere else. Flyers pick the spot and go straight there. */
function cruise(
  c: SafehouseObject,
  st: CreatureState,
  solid: SafehouseObject[],
  dt: number,
  rng: () => number,
  far: boolean,
) {
  if (!st.path.length) {
    st.moving = false;
    if (st.replanMs > 0) return;
    const snap = (v: number) => Math.round(v * 2) / 2;
    for (let i = 0; i < 8; i++) {
      const target = far
        ? {
            x: snap(YARD_BOUNDS.minX + 1 + rng() * (YARD_BOUNDS.maxX - YARD_BOUNDS.minX - 2)),
            z: snap(YARD_BOUNDS.minZ + 1 + rng() * (YARD_BOUNDS.maxZ - YARD_BOUNDS.minZ - 2)),
          }
        : { x: snap(c.position.x + (rng() - 0.5) * 16), z: snap(c.position.z + (rng() - 0.5) * 16) };
      const d = distance(target, c.position);
      if (d < (far ? 10 : 2.5)) continue;
      if (st.flying) {
        if (!contains(YARD_BOUNDS, target)) continue;
        st.path = [target];
        break;
      }
      const path = route(c.position, target, solid);
      if (path && path.length <= (far ? 260 : 40)) {
        st.path = straighten(path);
        break;
      }
    }
    // Arrived (or nowhere to go): a moment before the next leg. The car barely pauses; a bird hangs in the air.
    st.replanMs = far ? 300 : 2000 + rng() * 4000;
    if (!st.path.length) return;
  }
  advance(c, st, solid, dt);
}

/** Climb to cruise, dip over a ground target, fall when downed. */
function settleAltitude(c: SafehouseObject, st: CreatureState, w: World, step: number) {
  const current = st.altitude ?? 0;
  if (!intact(c)) {
    st.altitude = Math.max(0, current - (step / 1000) * 8);
    return;
  }
  const target = w.objects.find((o) => o.id === st.targetId) ?? w.combat.zombies.find((z) => z.id === st.targetId);
  const striking = !!target && distance(c.position, target.position) <= 2.5 && !(target as SafehouseObject).creature?.flying;
  const wanted = striking ? FLIGHT.swoop : st.behaviour === 'zoom' ? FLIGHT.cruiseZoom : FLIGHT.cruise;
  st.altitude = current + (wanted - current) * (1 - Math.exp(-(step / 1000) * 1.2));
}

/**
 * One world tick for every living build. Returns whether anything durable changed
 * (damage or a kill) plus the events Rook may want to comment on.
 */
export function tickCreatures(
  w: World,
  dt: number,
  rng: () => number,
): { changed: boolean; events: CreatureEvent[] } {
  const events: CreatureEvent[] = [];
  let changed = false;
  const step = Math.min(Math.max(dt, 0), 2000);
  for (const c of w.objects) {
    const st = c.creature;
    if (!st) continue;
    if (!intact(c)) {
      if (st.flying && (st.altitude ?? 0) > 0) settleAltitude(c, st, w, step);
      continue;
    }
    st.replanMs = Math.max(0, st.replanMs - step);
    st.cooldownMs = Math.max(0, st.cooldownMs - step);
    const solid = solidFor(w.objects, c.id);
    switch (st.behaviour) {
      case 'rampage':
        if (rampage(c, st, w, solid, step, rng, events)) changed = true;
        break;
      case 'fight':
        if (fight(c, st, w, solid, step, events)) changed = true;
        break;
      case 'zoom':
        cruise(c, st, solid, step, rng, true);
        break;
      case 'roam':
        cruise(c, st, solid, step, rng, false);
        break;
    }
    if (st.flying) settleAltitude(c, st, w, step);
  }
  return { changed, events };
}
