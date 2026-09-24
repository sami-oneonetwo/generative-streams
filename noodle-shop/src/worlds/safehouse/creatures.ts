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
// A creature may also carry `rules` (rules.ts): behaviour as data, run ahead of the
// preset every tick — the block's birds perch and scatter this way. When a rule has
// the tick the preset is skipped; when nothing resolves the preset takes over.
//
// Creatures never block placement or anyone's path (placement.ts, combat.ts), so a
// dog under a build site is simply a dog standing in the way for a moment.
import type { CreatureBehaviour, CreatureState, SafehouseObject } from '../../shared/safehouseTypes';
import { contains, HOUSE_ID, YARD_BOUNDS } from '../../shared/safehouseLayout';
import { route, straighten } from './placement';
import { CREATURES, damageObject, intact, isHostile } from './combat';
import {
  FLIGHT,
  advance,
  canReach,
  distance,
  flies,
  head,
  heldStep,
  inReach,
  objectDistance,
  routeTo,
  routeToPoint,
  solidFor,
  trapsIn,
  type World,
} from './locomotion';
import { stepRules } from './rules';

export { FLIGHT, flies, canReach } from './locomotion';
export type { World } from './locomotion';

export interface CreatureEvent {
  kind: 'hit' | 'down' | 'kill'; // a hit landed; an object fell; a zombie was killed
  id: string; // the creature
  targetId: string; // what it hit / felled / killed
}

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

function rampage(
  c: SafehouseObject,
  st: CreatureState,
  w: World,
  solid: SafehouseObject[],
  traps: SafehouseObject[],
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
  advance(c, st, solid, dt, traps);
  return false;
}

function fight(
  c: SafehouseObject,
  st: CreatureState,
  w: World,
  solid: SafehouseObject[],
  traps: SafehouseObject[],
  dt: number,
  events: CreatureEvent[],
): boolean {
  const profile = CREATURES.fight;
  // A vendetta (grudges): anything a particular chatter built that moves, hostile or not, is fair
  // game — never the block's own birds, never something belonging to the fighter's own owner.
  const vendetta = (o: SafehouseObject) =>
    !!st.nemesisOwner &&
    !!o.creature &&
    !o.wild &&
    o.id !== c.id &&
    !(c.owner && o.owner === c.owner) &&
    (o.createdBy ?? '').trim().toLowerCase() === st.nemesisOwner;
  let enemy = w.objects.find((o) => o.id === st.targetId && intact(o) && (isHostile(o) || vendetta(o)));
  let zombie = w.combat.zombies.find((z) => z.id === st.targetId && z.health > 0);
  const lost = st.targetId !== undefined && !enemy && !zombie;
  // Built to hunt one particular creature (a neighbour's answer to the yard gorilla): that one
  // first, wherever it is on the block; forgotten once it is down.
  if (st.nemesis && !w.objects.some((o) => o.id === st.nemesis && intact(o))) st.nemesis = undefined;
  const nemesis = st.nemesis ? w.objects.find((o) => o.id === st.nemesis && isHostile(o) && intact(o) && canReach(c, o)) : undefined;
  if (lost || st.replanMs === 0) {
    st.path = [];
    // The chatter's things first, nearest first; then the creature it was built against.
    const marked = st.nemesisOwner
      ? w.objects
          .filter((o) => vendetta(o) && intact(o) && canReach(c, o))
          .map((o) => ({ o, d: objectDistance(c.position, o) }))
          .sort((a, b) => a.d - b.d)
          .find((x) => inReach(c, x.o, 1.2) || routeTo(c, st, x.o, solid))
      : undefined;
    const hunted = marked ?? (nemesis && (inReach(c, nemesis, 1.2) || routeTo(c, st, nemesis, solid)) ? { o: nemesis, d: 0 } : undefined);
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
    advance(c, st, solid, dt, traps);
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
    advance(c, st, solid, dt, traps);
    return false;
  }
  // Nobody to fight: on the way to Rook, or standing by him.
  advance(c, st, solid, dt, traps);
  return false;
}

/** zoom and roam: somewhere to go, a breather, somewhere else. Flyers pick the spot and go straight there. */
function cruise(
  c: SafehouseObject,
  st: CreatureState,
  solid: SafehouseObject[],
  traps: SafehouseObject[],
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
  advance(c, st, solid, dt, traps);
}

/** Climb to cruise, dip over a ground target, settle onto a perch, fall when downed. */
function settleAltitude(c: SafehouseObject, st: CreatureState, w: World, step: number) {
  const current = st.altitude ?? 0;
  if (!intact(c)) {
    st.altitude = Math.max(0, current - (step / 1000) * 8);
    return;
  }
  const cruise = st.behaviour === 'zoom' ? FLIGHT.cruiseZoom : FLIGHT.cruise;
  let wanted: number;
  if (st.goal?.perched && st.goal.altitude !== undefined) wanted = st.goal.altitude;
  else if (c.rules?.length) wanted = cruise; // a ruled creature never strikes; its targetId is just where it last sat
  else {
    const target = w.objects.find((o) => o.id === st.targetId) ?? w.combat.zombies.find((z) => z.id === st.targetId);
    const striking = !!target && distance(c.position, target.position) <= 2.5 && !(target as SafehouseObject).creature?.flying;
    wanted = striking ? FLIGHT.swoop : cruise;
  }
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
  // Holes (TACTICS.trap): anything on the ground that walks into one is stuck a while.
  const traps = trapsIn(w.objects);
  for (const c of w.objects) {
    const st = c.creature;
    if (!st) continue;
    if (!intact(c)) {
      if (st.flying && (st.altitude ?? 0) > 0) settleAltitude(c, st, w, step);
      continue;
    }
    st.replanMs = Math.max(0, st.replanMs - step);
    st.cooldownMs = Math.max(0, st.cooldownMs - step);
    // Stuck in a hole: nothing else this tick, not even a bite at the fence beside it.
    if (heldStep(c, st, traps, step)) continue;
    // In a scrap with a viewer's figure (`!fight`, crowd.ts): stands its ground until the bout is decided.
    if (st.busyMs) {
      st.busyMs = Math.max(0, st.busyMs - step);
      st.moving = false;
      st.path = [];
      if (st.flying) settleAltitude(c, st, w, step);
      continue;
    }
    const solid = solidFor(w.objects, c.id);
    // Behaviour as data first; the preset only when no rule has the tick.
    if (c.rules?.length && stepRules(c, st, w, solid, step, rng)) {
      if (st.flying) settleAltitude(c, st, w, step);
      continue;
    }
    switch (st.behaviour) {
      case 'rampage':
        if (rampage(c, st, w, solid, traps, step, rng, events)) changed = true;
        break;
      case 'fight':
        if (fight(c, st, w, solid, traps, step, events)) changed = true;
        break;
      case 'zoom':
        cruise(c, st, solid, traps, step, rng, true);
        break;
      case 'roam':
        cruise(c, st, solid, traps, step, rng, false);
        break;
    }
    if (st.flying) settleAltitude(c, st, w, step);
  }
  return { changed, events };
}
