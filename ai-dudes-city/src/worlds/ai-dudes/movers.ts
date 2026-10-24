// Builds that go about town on their own: a donkey roaming the streets, a car driving round the
// blocks, a spaceship flying over the roofs. The designer marks them (`blueprint.moves`), or the
// request plainly asks for it ("a donkey that roams the street"); once built they set off. Anyone
// can ride or drive one (a chatter's `use … ride/drive`, the Mayor's R key): while someone is
// aboard it goes where they take it, and when they get off it carries on from there. They never
// block anyone's way and never count as a place to visit. Zero AI: the app owns the routes and speeds.
// With the Story switch on, a chatter's small roamer is their pet instead: it trails them (PETS below).
import type { GroundPoint, Moves, SafehouseObject } from '../../shared/objectTypes';
import { CITY_BOUNDS, roadLines } from '../../shared/city';
import { contains, footprint, inflate } from '../../shared/layout';
import { abilitiesOf, movesFromRequest, petSized } from './blueprint';
import { GROUND, onGround, route } from './placement';
import { WALK_SPEED, addEffect, awake, step } from './sim';
import { homeOf, lotsOf } from './city';
import { storyOn, type Dude, type DudesState } from './state';
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

/**
 * Pets (Finders Keepers, Story ON only): a chatter's first small roamer (blueprint.ts `petSized`)
 * trails them round town instead of wandering. It goes the way they went (their breadcrumbs, no
 * path search) to a spot behind their left shoulder, a little quicker than they go; it sits when
 * they stop, and sleeps on their lot while their chatter is away or they are indoors. With Story
 * OFF it roams as it always has. (board/motion-budget.md, Pets.)
 */
export const PETS = {
  /** Where it keeps to: this far from its owner (metres), this far round from straight behind them to their left (radians). */
  gap: 1.2,
  side: Math.PI / 4,
  /** Its pace against its owner's on the move; never slower than a trot (m/s) nor quicker than a dash. */
  pace: 1.2,
  minSpeed: 1.4,
  maxSpeed: 9,
  /** Further than this from its owner (metres): it is with them again in a puff of smoke. */
  teleport: 30,
  /** The owner's way: a crumb at least this far (metres) from the last, the newest this many kept. */
  crumb: 0.5,
  crumbs: 80,
  /** Within this of one of the crumbs (metres), it is on its owner's trail. */
  onTrail: 1.5,
  /** The owner has stood still this long (ms): it sits. */
  sitMs: 1000,
  /** The owner has been indoors this long away from home (ms): it stops waiting by the door and goes home to bed. */
  doorMs: 30_000,
  /** The owner went indoors this close to its bed (metres): it goes straight to bed. */
  homeNear: 14,
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

// ---- pets (Finders Keepers) ---------------------------------------------------------------------
/** What a pet keeps of its owner between ticks. Not saved: after a restart it picks them up afresh. */
interface Trail {
  owner: string;
  /** The way they went, oldest first, ending where they are. */
  crumbs: GroundPoint[];
  /** Where they were last tick, and the waypoint they were heading for (passed since: the corner they turned). */
  last: GroundPoint;
  next?: GroundPoint;
  /** Their pace on the move (m/s, smoothed); how long they have stood still and been indoors (ms). */
  speed: number;
  still: number;
  indoors: number;
  /** Following them; sitting by the door they went in at; or off home to bed (and where that is). */
  mode: 'follow' | 'door' | 'home';
  bed?: GroundPoint;
}
const trails = new WeakMap<DudesState, Map<string, Trail>>();
/** The world revision each town's pets were last handed out at. */
const adoptedAt = new WeakMap<DudesState, number>();
const dist = (a: GroundPoint, b: GroundPoint) => Math.hypot(a.x - b.x, a.z - b.z);

/** Each chatter's first small roamer (the oldest) becomes their pet; any more roam as before. */
export function adoptPets(state: DudesState): void {
  const has = new Set<string>();
  for (const o of state.objects) if (o.creature?.follows) has.add(o.creature.follows);
  const small = state.objects
    .filter((o) => o.creature && !o.creature.follows && o.owner && !has.has(o.owner) && !ruined(o) && petSized(o.blueprint))
    .sort((a, b) => a.createdAt - b.createdAt);
  for (const o of small) {
    if (has.has(o.owner!) || !state.dudes.some((d) => d.id === o.owner)) continue;
    o.creature!.follows = o.owner;
    has.add(o.owner!);
  }
}

/** Open ground a pet can stand on: in town, out of the water, clear of every standing build. */
function clearAt(state: DudesState, p: GroundPoint): boolean {
  if (!onGround(p, 0.5) || GROUND.water.some((r) => contains(r, p)) || GROUND.blocks.some((r) => contains(inflate(r, 0.2), p))) return false;
  return !state.objects.some((o) => !o.passable && o.destroyedAt === undefined && contains(footprint(o.position, o.footprint.width + 0.4, o.footprint.depth + 0.4), p));
}

/** Its place at heel: behind its owner's left shoulder, or the nearest of behind, behind-right, either side that is open. */
export function heelOf(state: DudesState, owner: Pick<Dude, 'position' | 'facing'>): GroundPoint {
  const f = owner.facing;
  for (const a of [PETS.side, 0, -PETS.side, Math.PI / 2, -Math.PI / 2]) {
    // Behind them is −(sin f, cos f); their left is (cos f, −sin f) (facing +z, the left hand is at +x).
    const p = { x: owner.position.x - Math.sin(f) * Math.cos(a) * PETS.gap + Math.cos(f) * Math.sin(a) * PETS.gap, z: owner.position.z - Math.cos(f) * Math.cos(a) * PETS.gap - Math.sin(f) * Math.sin(a) * PETS.gap };
    if (clearAt(state, p)) return p;
  }
  return { ...owner.position };
}

/** Where a pet sleeps: at the front of its owner's lot, off to one side (builds go toward the back); else beside their home; else where it is. */
export function bedOf(state: DudesState, owner: Dude, from: GroundPoint): GroundPoint {
  const lot = lotsOf(state, owner)[0];
  if (lot) {
    const f = lot.front,
      s = { x: -f.z, z: f.x };
    const half = (f.x ? lot.rect.maxX - lot.rect.minX : lot.rect.maxZ - lot.rect.minZ) / 2;
    for (const [out, along] of [[half - 1.4, 2.8], [half - 1.4, -2.8], [half - 1.4, 0], [half - 3, 4], [half - 3, -4]]) {
      const p = { x: lot.centre.x + f.x * out + s.x * along, z: lot.centre.z + f.z * out + s.z * along };
      if (clearAt(state, p)) return p;
    }
  }
  const home = homeOf(state, owner);
  if (home) {
    const r = footprint(home.at, home.footprint.width + 1.6, home.footprint.depth + 1.6);
    const beside = [{ x: home.at.x, z: r.maxZ }, { x: r.maxX, z: home.at.z }, { x: r.minX, z: home.at.z }, { x: home.at.x, z: r.minZ }].find((p) => clearAt(state, p));
    if (beside) return beside;
  }
  return { ...from };
}

/** Gone from here and there in a puff of smoke (both ends), like a teleport bit. */
function puff(state: DudesState, o: SafehouseObject, to: GroundPoint, now: number): void {
  addEffect(state, { kind: 'burst', at: now, to: { ...o.position }, label: 'smoke' });
  o.position = { ...to };
  addEffect(state, { kind: 'burst', at: now, to: { ...to }, label: 'smoke' });
  o.creature!.path = [];
}

/** A crumb onto the owner's trail, if they have gone far enough from the last one. */
function drop(t: Trail, p: GroundPoint): void {
  const last = t.crumbs[t.crumbs.length - 1];
  if (last && dist(last, p) < PETS.crumb) return;
  t.crumbs.push({ x: p.x, z: p.z });
  if (t.crumbs.length > PETS.crumbs) t.crumbs.splice(0, t.crumbs.length - PETS.crumbs);
}

/** This tick's news of the owner: where they went (and the corner they turned getting there), how fast, whether they stopped or went in. */
function watch(t: Trail, owner: Dude, dt: number): void {
  const moved = dist(owner.position, t.last);
  if (moved > 0.02 || owner.path.length) t.still = 0;
  else t.still += dt;
  if (moved > 0.02) {
    const turned = t.next && !(owner.path[0] && owner.path[0].x === t.next.x && owner.path[0].z === t.next.z);
    if (moved > PETS.teleport) t.crumbs = []; // they jumped (a teleport): no trail across the gap
    else {
      if (turned && dist(t.last, t.next!) + dist(t.next!, owner.position) < moved + 1) drop(t, t.next!);
      if (dt > 0) t.speed += (Math.min(PETS.maxSpeed, moved / (dt / 1000)) - t.speed) * 0.5;
    }
  }
  drop(t, owner.position);
  t.last = { ...owner.position };
  t.next = owner.path[0] ? { ...owner.path[0] } : undefined;
  t.indoors = owner.hidden ? t.indoors + dt : 0;
}

/**
 * One tick of a pet with its owner. False when the owner is not in town (it roams as before).
 * `was` is how it was resting last tick (a sitting pet stays sat while its owner only shuffles).
 */
function followOwner(state: DudesState, o: SafehouseObject, was: 'sit' | 'sleep' | undefined, dt: number, now: number): boolean {
  const c = o.creature!;
  const owner = state.dudes.find((d) => d.id === c.follows);
  if (!owner) return false;
  let mine = trails.get(state);
  if (!mine) trails.set(state, (mine = new Map()));
  let t = mine.get(o.id);
  if (!t || t.owner !== owner.id) mine.set(o.id, (t = { owner: owner.id, crumbs: [], last: { ...owner.position }, speed: WALK_SPEED, still: 0, indoors: 0, mode: 'follow' }));
  watch(t, owner, dt);

  // Away (their chatter has gone quiet) or indoors: off home to bed; or, if they went in somewhere else, a wait by the door first.
  // The wait is only while their chatter is still here: gone quiet mid-wait, it goes home (even once they come out).
  const away = !awake(owner, now);
  if (away || owner.hidden) {
    if (t.mode === 'follow') {
      t.bed = bedOf(state, owner, o.position);
      t.mode = away || dist(owner.position, t.bed) < PETS.homeNear ? 'home' : 'door';
      c.path = [];
    }
    if (t.mode === 'door' && !away && t.indoors < PETS.doorMs) {
      c.moving = false;
      c.rest = 'sit';
      return true;
    }
    if (t.mode === 'door') {
      t.mode = 'home';
      c.path = [];
    }
    // Something has gone up on its bed since: a new one.
    if (!clearAt(state, t.bed!)) {
      t.bed = bedOf(state, owner, o.position);
      c.path = [];
    }
    goToBed(state, o, t.bed!, now, dt);
    return true;
  }
  // Back with them (up from bed, or they came out): the trail starts again from here.
  if (t.mode !== 'follow') {
    t.mode = 'follow';
    t.bed = undefined;
    t.crumbs = [{ ...owner.position }];
    c.path = [];
  }

  // Where they will be once the town has walked them on this tick (people move after the movers): it keeps to heel there.
  const lead = { path: owner.path.slice(0, 4), position: { ...owner.position }, facing: owner.facing, walkingFor: owner.walkingFor };
  if (lead.path.length) step(lead, dt);
  const heel = heelOf(state, lead);
  if (dist(o.position, lead.position) > PETS.teleport) {
    puff(state, o, heel, now);
    c.facing = owner.facing;
    c.moving = false;
    return true;
  }
  // Sat down already and they have only shuffled about: it stays sat.
  if (was === 'sit' && t.still >= PETS.sitMs && dist(o.position, heel) < 0.8) {
    c.moving = false;
    c.rest = 'sit';
    return true;
  }
  // On their trail: the way they went from the newest crumb it is near (short of their heels), then its spot.
  // Off it (just up from bed, or they set off from somewhere it never was): round to them once the short way.
  let on = -1;
  for (let i = t.crumbs.length - 1; i >= 0; i--)
    if (dist(t.crumbs[i], o.position) <= PETS.onTrail) {
      on = i;
      break;
    }
  let way: GroundPoint[];
  if (on >= 0) {
    c.path = [];
    way = [...t.crumbs.slice(on + 1).filter((p) => dist(p, lead.position) > PETS.gap), heel];
  } else {
    if (!c.path.length) c.path = route(o.position, heel, state.objects)?.slice(1) ?? [heel];
    way = c.path;
  }
  const from = { ...o.position };
  const walker = { path: way, position: o.position, facing: c.facing };
  step(walker, dt, Math.min(PETS.maxSpeed, Math.max(PETS.minSpeed, PETS.pace * t.speed)));
  o.position = walker.position;
  c.facing = walker.facing;
  if (on < 0) c.path = walker.path;
  c.moving = dist(from, o.position) > 1e-3;
  if (!c.moving && t.still >= PETS.sitMs) {
    c.facing = owner.facing;
    c.rest = 'sit';
  }
  return true;
}

/** Home to its bed at a trot, the way round what is built; a long way off, or no way there, it goes in a puff. Then it sleeps. */
function goToBed(state: DudesState, o: SafehouseObject, bed: GroundPoint, now: number, dt: number): void {
  const c = o.creature!;
  if (dist(o.position, bed) < 0.05) {
    c.moving = false;
    c.path = [];
    c.rest = 'sleep';
    return;
  }
  if (!c.path.length) {
    const way = dist(o.position, bed) <= PETS.teleport ? route(o.position, bed, state.objects) : null;
    if (!way) {
      puff(state, o, bed, now);
      c.moving = false;
      c.rest = 'sleep';
      return;
    }
    c.path = [...way.slice(1, -1), bed];
  }
  const walker = { path: c.path, position: o.position, facing: c.facing };
  step(walker, dt, MOVERS.speed.roam);
  o.position = walker.position;
  c.facing = walker.facing;
  c.path = walker.path;
  c.moving = true;
}

export function tickMovers(state: DudesState, dt: number, now: number, rng: () => number): void {
  let loose: Set<string> | undefined;
  // Story ON: whenever something has gone up or changed, the chatters without a pet get their first small roamer as one.
  const story = storyOn(state);
  if (story && adoptedAt.get(state) !== state.worldRevision) {
    adoptPets(state);
    adoptedAt.set(state, state.worldRevision);
    // Trails of pets that are gone (taken down, or no longer anyone's) are let go.
    const mine = trails.get(state);
    if (mine) {
      const pets = new Set(state.objects.filter((o) => o.creature?.follows).map((o) => o.id));
      for (const id of mine.keys()) if (!pets.has(id)) mine.delete(id);
    }
  }
  for (const o of state.objects) {
    const c = o.creature;
    // A pet's rest is worked out afresh each tick (followOwner); anything else it was doing, it is up.
    const was = c?.rest;
    if (c && was) c.rest = undefined;
    // A pet keeps trotting after its owner even if a redesign forgot to say it goes about.
    const moves = movesOf(o) ?? (story && c?.follows ? 'roam' : undefined);
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
    // A pet goes with its owner (Story ON; when they are not in town it wanders like anything else).
    if (story && c.follows && followOwner(state, o, was, dt, now)) continue;
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
