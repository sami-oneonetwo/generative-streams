// Builds that go about town on their own: a donkey roaming the streets, a car driving round the
// blocks, a spaceship flying over the roofs. The designer marks them (`blueprint.moves`), or the
// request plainly asks for it ("a donkey that roams the street"); once built they set off. Anyone
// can ride or drive one (a chatter's `use … ride/drive`, the Mayor's R key): while someone is
// aboard it goes where they take it, and when they get off it carries on from there. They never
// block anyone's way and never count as a place to visit. Zero AI: the app owns the routes and speeds.
import type { GroundPoint, Moves, SafehouseObject } from '../../shared/objectTypes';
import { CITY_BOUNDS, roadLines } from '../../shared/city';
import { abilitiesOf, movesFromRequest } from './blueprint';
import { onGround, route } from './placement';
import { addEffect, step } from './sim';
import type { DudesState } from './state';
import { breakable, damageBuild, ruined } from './damage';
import { smashes } from './weapons';
import { knockOut, knockedOut } from './combat';

export const MOVERS = {
  /** Metres a second on their own. */
  speed: { roam: 1.4, drive: 5.5, fly: 6.5 } as Record<Moves, number>,
  /** Ridden or driven by the Mayor (the operator page moves him at this pace). */
  ridden: { roam: 5.5, drive: 11, fly: 13 } as Record<Moves, number>,
  /** A flyer's cruising height, metres, and as high as anyone can take one. */
  altitude: 6,
  ceiling: 30,
  climb: 2.5,
  /** How long they stand about between legs (roamers graze; cars wait at the lights). */
  pause: { roam: [2000, 8000], drive: [500, 2500], fly: [0, 1500] } as Record<Moves, [number, number]>,
  /** Off the lot and on their way this long after going up. */
  startMs: 4000,
  /** Cars keep to the right of the road's centre line. */
  lane: 1.8,
};

/** A monster on the loose (a T-rex, a kaiju): it picks a build nearby, stomps over and knocks it about until it falls. */
export const RAMPAGE = {
  /** How far it looks for something to smash (metres). */
  sight: 18,
  speed: 2,
  stompMs: 2200,
  damage: 8,
  /** Knocks down this many, then has a lie-down for a while (milliseconds). */
  spree: 1,
  restMs: [120_000, 240_000] as [number, number],
  /** People this close to a stomp are knocked flat. */
  splash: 1.6,
  /** At most this many monsters go on the rampage in town at once (the oldest), one per owner; the rest just wander. */
  maxLoose: 2,
};

/** The monsters allowed to smash things right now: the oldest few, no more than one each owner. */
function looseMonsters(state: DudesState): Set<string> {
  const loose = new Set<string>(),
    owners = new Set<string>();
  const monsters = state.objects.filter((o) => o.creature && o.blueprint.moves && !ruined(o) && smashes(o)).sort((a, b) => a.createdAt - b.createdAt);
  for (const o of monsters) {
    if (loose.size >= RAMPAGE.maxLoose) break;
    const who = o.owner ?? o.createdBy;
    if (owners.has(who)) continue;
    owners.add(who);
    loose.add(o.id);
  }
  return loose;
}

export const movesOf = (o: SafehouseObject): Moves | undefined => o.blueprint.moves;
/** Can be ridden or driven: anything that moves on its own, or anything built as a vehicle. */
export const rideable = (o: SafehouseObject) => !!o.blueprint.moves || abilitiesOf(o.blueprint).has('vehicle');

/** Can fly: anything that flies about on its own, and anything built to fly (a helicopter, a jetpack, a balloon). */
export const flies = (o: SafehouseObject) => o.blueprint.moves === 'fly' || abilitiesOf(o.blueprint).has('flies');
/** How high it is right now (metres). */
export const altitudeOf = (o: SafehouseObject) => o.creature?.altitude ?? o.altitude ?? 0;
export function setAltitude(o: SafehouseObject, v: number): void {
  const a = Math.max(0, Math.min(MOVERS.ceiling, v));
  if (o.creature) o.creature.altitude = a;
  else o.altitude = a > 0.05 ? a : undefined;
}

/** A build that has just gone up: if it is a mover, it becomes a living one (set off shortly). */
export function startMoving(o: SafehouseObject, request: string): void {
  // A monster built to smash things (a T-rex, a kaiju) goes looking for something to smash, asked or not.
  const beast = abilitiesOf(o.blueprint).has('smash') && !abilitiesOf(o.blueprint).has('vehicle') ? 'roam' : undefined;
  const moves = o.blueprint.moves ?? movesFromRequest(request) ?? beast;
  if (!moves) return;
  o.blueprint.moves = moves;
  o.passable = true; // never in anyone's way, never holds up a build
  o.creature = {
    behaviour: moves === 'drive' ? 'zoom' : 'roam',
    facing: 0,
    moving: false,
    path: [],
    replanMs: MOVERS.startMs,
    cooldownMs: 0,
    ...(moves === 'fly' ? { flying: true, altitude: 0 } : {}),
  };
}

const rand = (rng: () => number, [a, b]: [number, number]) => a + rng() * (b - a);

/** The road grid: intersections at every pair of road lines. */
const LINES = roadLines();
const nearestLine = (v: number) => LINES.reduce((best, k, i) => (Math.abs(k - v) < Math.abs(LINES[best] - v) ? i : best), 0);

/** The next leg for a car: from the intersection it is at (or nearest) to a neighbouring one, never straight back. */
function driveLeg(o: SafehouseObject, rng: () => number): GroundPoint[] {
  const c = o.creature!;
  const [ci, cj] = (c.node ?? '').split(',').map(Number);
  const i = Number.isFinite(ci) ? ci : nearestLine(o.position.x),
    j = Number.isFinite(cj) ? cj : nearestLine(o.position.z);
  const [pi, pj] = (c.prevNode ?? '').split(',').map(Number);
  const options = [
    [i + 1, j],
    [i - 1, j],
    [i, j + 1],
    [i, j - 1],
  ].filter(([a, b]) => a >= 0 && b >= 0 && a < LINES.length && b < LINES.length && !(a === pi && b === pj));
  const [ni, nj] = options[Math.floor(rng() * options.length)] ?? [i, j];
  c.prevNode = `${i},${j}`;
  c.node = `${ni},${nj}`;
  // Keep right: offset from the centre line by the way it is heading.
  const dx = Math.sign(LINES[ni] - LINES[i]),
    dz = Math.sign(LINES[nj] - LINES[j]);
  const to = { x: LINES[ni] - dz * MOVERS.lane, z: LINES[nj] + dx * MOVERS.lane };
  const here = { x: LINES[i] - dz * MOVERS.lane, z: LINES[j] + dx * MOVERS.lane };
  // Not on the grid yet (just built on a lot): out to the road first.
  const onRoad = Math.abs(o.position.x - LINES[i]) < 3 || Math.abs(o.position.z - LINES[j]) < 3;
  return onRoad ? [to] : [here, to];
}

/** Somewhere to wander: a walkable spot within twenty-odd metres, routed round what is built. */
function roamLeg(state: DudesState, o: SafehouseObject, rng: () => number): GroundPoint[] {
  for (let tries = 0; tries < 6; tries++) {
    const a = rng() * Math.PI * 2,
      r = 6 + rng() * 18;
    const to = { x: o.position.x + Math.cos(a) * r, z: o.position.z + Math.sin(a) * r };
    if (!onGround(to, 2)) continue;
    const path = route(o.position, to, state.objects);
    if (path) return path.slice(1);
  }
  return [];
}

/** Anywhere over town, in a straight line. */
function flyLeg(o: SafehouseObject, rng: () => number): GroundPoint[] {
  const b = CITY_BOUNDS;
  return [{ x: b.minX + 6 + rng() * (b.maxX - b.minX - 12), z: b.minZ + 6 + rng() * (b.maxZ - b.minZ - 12) }];
}

export function tickMovers(state: DudesState, dt: number, now: number, rng: () => number): void {
  let loose: Set<string> | undefined;
  for (const o of state.objects) {
    const moves = movesOf(o);
    const c = o.creature;
    if (!moves || !c) continue;
    if (ruined(o)) {
      c.moving = false; // knocked down itself: it lies where it fell until it is put back up
      continue;
    }
    // Somebody is aboard (they move it: sim.ts runUse, or the Mayor), or on their way to get on
    // (it waits for them, and a flyer comes down to be boarded). Aboard, a flyer goes back up.
    const boarding = state.dudes.some((d) => d.use?.objectId === o.id && d.use.phase === 'going');
    if (boarding || state.dudes.some((d) => d.use?.objectId === o.id || d.riding === o.id) || state.mayor?.riding === o.id) {
      c.moving = false;
      c.path = [];
      // (Under the Mayor, his page says how high.)
      if (c.flying && state.mayor?.riding !== o.id)
        c.altitude = boarding ? Math.max(0, (c.altitude ?? 0) - (MOVERS.climb * 2 * dt) / 1000) : Math.min(MOVERS.altitude, (c.altitude ?? 0) + (MOVERS.climb * dt) / 1000);
      continue;
    }
    // Just got off: it carries on from where it was left, facing the way it was going.
    if (o.driven) {
      o.position = { ...o.driven.at };
      c.facing = o.driven.turn;
      o.driven = undefined;
      c.path = [];
      c.node = undefined;
      c.replanMs = rand(rng, MOVERS.pause[moves]);
      state.worldRevision++;
    }
    // A monster goes after the town's builds (between rests); otherwise it wanders like anything else.
    if (smashes(o) && (loose ??= looseMonsters(state)).has(o.id) && rampage(state, o, dt, now, rng)) continue;
    // Back to cruising height, up or down, at a climb (left high by the Mayor, it sinks gently).
    if (c.flying) {
      const step = (MOVERS.climb * dt) / 1000,
        alt = c.altitude ?? 0;
      c.altitude = alt < MOVERS.altitude ? Math.min(MOVERS.altitude, alt + step) : Math.max(MOVERS.altitude, alt - step);
    }
    if (!c.path.length) {
      c.moving = false;
      c.replanMs -= dt;
      if (c.replanMs > 0) continue;
      c.path = moves === 'drive' ? driveLeg(o, rng) : moves === 'fly' ? flyLeg(o, rng) : roamLeg(state, o, rng);
      c.replanMs = rand(rng, MOVERS.pause[moves]);
      if (!c.path.length) continue;
    }
    const walker = { path: c.path, position: o.position, facing: c.facing };
    step(walker, dt, MOVERS.speed[moves]);
    o.position = walker.position;
    c.facing = walker.facing;
    c.path = walker.path;
    c.moving = true;
  }
}

/** One tick of a monster's rampage. False when it is resting or there is nothing in reach to smash (it wanders). */
function rampage(state: DudesState, o: SafehouseObject, dt: number, now: number, rng: () => number): boolean {
  const c = o.creature!;
  if (state.ai.destruction === false) return false; // nothing falls down: it is just an animal about town
  if (c.restMs && c.restMs > 0) {
    c.restMs -= dt;
    return false;
  }
  c.cooldownMs = Math.max(0, (c.cooldownMs ?? 0) - dt);
  const here = o.position;
  const far = (t: SafehouseObject) => Math.hypot(t.position.x - here.x, t.position.z - here.z);
  let target = c.targetId ? state.objects.find((t) => t.id === c.targetId) : undefined;
  if (!target || ruined(target)) {
    // Someone else's: never its own owner's builds, never the town's projects, never other things that go about.
    target = state.objects
      .filter((t) => t !== o && breakable(t) && !ruined(t) && !((t.guardUntil ?? 0) > now) && !t.creature && !t.civic && !t.blueprint.moves && (!o.owner || t.owner !== o.owner) && far(t) < RAMPAGE.sight)
      .sort((a, b) => far(a) - far(b))[Math.floor(rng() * 2)];
    c.targetId = target?.id;
    c.path = [];
    if (!target) return false;
  }
  const size = Math.max(o.footprint.width, o.footprint.depth) / 2;
  const reach = Math.max(target.footprint.width, target.footprint.depth) / 2 + size * 0.6 + 0.6;
  const d = far(target);
  if (d > reach) {
    // Stomp over, straight at it.
    const dx = here.x - target.position.x,
      dz = here.z - target.position.z,
      len = Math.hypot(dx, dz) || 1;
    c.path = [{ x: target.position.x + (dx / len) * (reach - 0.4), z: target.position.z + (dz / len) * (reach - 0.4) }];
    const walker = { path: c.path, position: o.position, facing: c.facing };
    step(walker, dt, RAMPAGE.speed);
    o.position = walker.position;
    c.facing = walker.facing;
    c.path = walker.path;
    c.moving = true;
    return true;
  }
  c.moving = false;
  c.path = [];
  c.facing = Math.atan2(target.position.x - here.x, target.position.z - here.z);
  if (c.cooldownMs > 0) return true;
  c.cooldownMs = RAMPAGE.stompMs;
  const owner = o.owner ? state.dudes.find((x) => x.id === o.owner) : undefined;
  const by = { name: owner ? `${owner.name}'s ${o.blueprint.name}` : o.blueprint.name, id: owner?.id };
  const contact = { x: here.x + Math.sin(c.facing) * size, z: here.z + Math.cos(c.facing) * size };
  addEffect(state, { kind: 'slam', from: contact, radius: 2 + size * 0.5, at: now });
  // Anyone underfoot goes flat.
  for (const d2 of state.dudes)
    if (!d2.hidden && !d2.riding && !knockedOut(d2, now) && Math.hypot(d2.position.x - contact.x, d2.position.z - contact.z) < RAMPAGE.splash)
      knockOut(state, d2, owner && owner.id !== d2.id ? owner : undefined, owner && owner.id !== d2.id ? `stomped (with ${o.blueprint.name})` : `stomped by ${o.blueprint.name}`, now, { ms: 5000 });
  if (damageBuild(state, target, RAMPAGE.damage, by, now, contact, 1.6) === 'fell') {
    c.targetId = undefined;
    c.hits = (c.hits ?? 0) + 1;
    if (c.hits >= RAMPAGE.spree) {
      c.hits = 0;
      c.restMs = rand(rng, RAMPAGE.restMs);
    }
  }
  return true;
}

/** For agents and the operator: what moves about town and who can ride it. */
export function moversNear(state: DudesState, at: GroundPoint, n = 4): { name: string; moves: Moves; metres: number }[] {
  return state.objects
    .filter((o) => o.blueprint.moves)
    .map((o) => ({ name: o.blueprint.name, moves: o.blueprint.moves!, metres: Math.round(Math.hypot((o.driven?.at ?? o.position).x - at.x, (o.driven?.at ?? o.position).z - at.z)) }))
    .sort((a, b) => a.metres - b.metres)
    .slice(0, n);
}
