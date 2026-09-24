// The crowd: viewers as figures on the pavement across the street. Whoever has spoken in chat
// lately stands in a row on the far kerb, waves when they speak (the page reads `wavedAt`),
// drifts along the pavement to line up with their own build while Rook puts it up, and runs
// for the ends of the block when a wave lands. Zero AI calls, no pathfinding for the row: the
// pavement line is clear of everything (the hoarding and the far trees stand at z ≥ 15, the cars
// on the road at z ≤ 11.3), so a member on the row only ever moves along x.
//
// Chat verbs (verbs.ts) send a member off the pavement on an **errand**: `!shoot` jogs them to
// a hoop, holds them there for the throw, and jogs them back to their slot. That is real 2-D
// routing (`route`, so they walk round holes and walls like Rook), one straight run per tick
// like his, and while they are away the row logic leaves them alone. Crowd figures block nobody.
//
// Kick usernames already appear in Rook's bubble ("Got your idea, dave"); the tag over a
// figure's head is the same content. Positions live in the state so a restart does not empty
// the pavement, but nothing checkpoints on a step — the 15 s autosave picks them up.
import type { CrowdView, GroundPoint, PieceVerb, SafehouseObject, VerbPose, VerbWord, WorldEffect } from '../../shared/safehouseTypes';
import { isCreatureVerb, isRunVerb } from '../../shared/safehouseTypes';
import { footprint, YARD_BOUNDS, contains, inflate } from '../../shared/safehouseLayout';
import { blueprintBounds } from './blueprint';
import { intact } from './combat';
import { route, straighten } from './placement';
import { active, MAX_CROWD, MAX_SCORES, type CrowdMember, type SafehouseState, type Score } from './state';

/** The far kerb: the pavement strip is drawn at z 14.4, a little over a metre wide. */
export const PAVEMENT_Z = 14.6;
/** Spacing along the pavement between neighbours in the row. */
export const SLOT_SPACING = 1.3;
/** How far along the pavement anyone goes: the ends they run to in a wave, and the furthest they follow a build. */
export const PAVEMENT_REACH = 40;
/** Ten quiet minutes and a viewer wanders off. */
export const EXPIRE_MS = 600_000;
/** How long they stay lined up with their build after it lands. */
export const WATCH_MS = 60_000;
export const WALK_SPEED = 1.6,
  RUN_SPEED = 3;
/** Facing toward the yard (−z): the survivor's convention is `atan2(dx, dz)`. */
const FACE_YARD = Math.PI;
/** An errand (`!shoot`): jog speed, how far back from the hoop to stand, how long the throw takes, the odds, the queue. */
export const ERRAND = {
  speed: 3, // m/s, a jog
  hoopOff: 2.75, // metres back from the hoop's footprint
  shotMs: 4_000,
  hitChance: 0.45,
  queue: 3, // shooters waiting on one hoop
  shotShownMs: 3_000, // how long the page gets the SWISH / MISS
};
/**
 * A piece's own verb (`!swim` at a pool, `!ring` at a bell): how far off a `beside` piece to stand, how
 * far inside an `on` piece, how many may do it at once, how long the page shows the pop.
 */
export const VERB_ERRAND = {
  besideOff: 0.75, // metres off the footprint for a `beside` verb
  inset: 0.4, // how far inside the footprint an `on` verb stands
  doers: 3, // at once, per piece; the rest queue like shooters
  popShownMs: 4_000, // long enough to read off a stream (client VERB_POP_MS matches)
  /** Standing height on a piece: full height for standing poses, half for sitting/lying/swimming (the water is the top). */
  standY: { max: 1.2 },
  lowY: { factor: 0.5, max: 0.6 },
};
/**
 * A run (`!drive`, or `!ride` on something that cannot move by itself): the piece pulls out to the
 * street, goes as far as the road is clear each way, and parks back where it was, the figure aboard.
 * The piece's true position never changes; the page draws it at `driven.at`.
 */
export const RUN = {
  speed: 5, // m/s, a trundle
  lanes: [10, 8.6, 11.4], // z of the lane to drive along (the road is z 7.5–12.5); the first it can pull straight out to
  legMin: 6, // metres of clear road each way, or the run is off ("boxed in")
  legMax: 22,
  clearance: 0.4, // metres round the piece's footprint that must be clear of anything solid
  seatY: { factor: 0.6, max: 1 }, // where the figure sits: part way up the piece
  graceMs: 6_000, // a run may overrun its verb's seconds by this much before it is parked where it is
};
/** Chasing a living build (`!ride`, `!fight`): close enough counts; it may wander off a few times. */
export const CHASE = { reach: 2.5, tries: 3 };
/** Sitting on a living build's back: part way up it, capped. */
export const MOUNT = { factor: 0.85, maxY: 1.6 };
/** A scrap with a living build: the odds, how long the figure celebrates or lies flat, how long the loser bolts. */
export const SCRAP = { winChance: 0.4, roundsMaxS: 8, celebrateMs: 2_500, downMs: 3_500, boltMs: 10_000 };
/** Poses that stand on top of a piece rather than sink into it. */
const UPRIGHT: readonly VerbPose[] = ['stand', 'jump', 'wave', 'cheer', 'punch'];
/** A horn or the like lives this long in the snapshot. */
export const EFFECT_TTL_MS = 10_000;
export const MAX_EFFECTS = 20;

interface World {
  crowd?: CrowdMember[];
  crowdHidden?: boolean;
  jobs: SafehouseState['jobs'];
  objects: SafehouseState['objects'];
  combat: SafehouseState['combat'];
  scores?: Record<string, Score>;
  effects?: WorldEffect[];
}
/** What a tick of the crowd produced that Rook or the neighbours may want to hear about. */
export type CrowdEvent =
  | {
      kind: 'shot';
      user: string; // lowercased
      name: string; // as typed
      targetId: string; // the hoop
      hit: boolean;
      streak: number; // hits in a row after this one
      misses: number; // misses in a row after this one
    }
  | {
      /** A figure has arrived at a piece and is doing its verb (`!swim` at the pool). */
      kind: 'verb';
      user: string;
      name: string;
      targetId: string;
      word: PieceVerb['word'];
      /** A `fight` decided (a second event for the same bout). */
      result?: 'won' | 'lost';
    };

// Errand bookkeeping outside the save: who is waiting on which piece (keyed by piece and what for,
// so shooters at a hoop and jumpers on it queue apart), and miss runs for Rook's lines.
const queues = new Map<string, string[]>(); // `${pieceId}:${shoot|word}` → member ids waiting
const missRun = new Map<string, number>();
export function resetCrowdMemory(): void {
  queues.clear();
  missRun.clear();
}
const queueKey = (targetId: string, what: string) => `${targetId}:${what}`;
const errandKey = (e: NonNullable<CrowdMember['errand']>) => queueKey(e.targetId, e.kind === 'shoot' ? 'shoot' : (e.word ?? 'verb'));

/** Where slot `i` stands: outward from the middle, alternating sides, so the row grows from x = 0. */
export function slotPosition(slot: number): GroundPoint {
  const ring = Math.ceil(slot / 2);
  const side = slot % 2 ? -1 : 1;
  return { x: ring * SLOT_SPACING * side, z: PAVEMENT_Z };
}

const lowestFreeSlot = (crowd: CrowdMember[]): number => {
  const taken = new Set(crowd.map((m) => m.slot));
  let slot = 0;
  while (taken.has(slot)) slot++;
  return slot;
};

/**
 * Someone spoke. A newcomer takes the lowest free spot; a regular gets their `lastAt` refreshed
 * and their name as they type it now. A full pavement hands the quietest member's spot to the
 * newcomer. Returns whether the pavement was empty a moment ago (Rook says hello) and the size.
 */
export function noteChatter(
  w: World,
  msg: { userId: string; username: string },
  now: number,
): { first: boolean; count: number } {
  const crowd = (w.crowd ??= []);
  const first = crowd.length === 0;
  const name = msg.username.trim().slice(0, 40) || msg.userId.slice(0, 40);
  const existing = crowd.find((m) => m.id === msg.userId);
  if (existing) {
    existing.lastAt = now;
    existing.name = name;
    return { first, count: crowd.length };
  }
  let slot: number;
  if (crowd.length >= MAX_CROWD) {
    // The quietest makes room (never someone mid-errand); the newcomer stands where they stood.
    const candidates = crowd.filter((m) => !m.errand);
    const quietest = (candidates.length ? candidates : crowd).reduce((a, b) => (b.lastAt < a.lastAt ? b : a));
    crowd.splice(crowd.indexOf(quietest), 1);
    slot = quietest.slot;
  } else slot = lowestFreeSlot(crowd);
  crowd.push({
    id: msg.userId,
    name,
    since: now,
    lastAt: now,
    slot,
    position: slotPosition(slot),
    facing: FACE_YARD,
  });
  return { first, count: crowd.length };
}

/** A viewer's build is going up (or just landed): they line up with it on the pavement. */
export function watchBuild(w: World, userId: string, objectId: string, now: number, landed = false): void {
  const m = w.crowd?.find((x) => x.id === userId);
  if (!m) return;
  m.watching = objectId;
  m.watchingUntil = landed ? now + WATCH_MS : undefined;
}

/** The horde is on the street: everyone runs for the ends of the block. */
export const waveOn = (w: World): boolean =>
  !w.combat.paused && w.combat.wave.phase === 'wave' && w.combat.zombies.length > 0;

const clampX = (x: number) => Math.max(-PAVEMENT_REACH, Math.min(PAVEMENT_REACH, x));
const distance = (a: GroundPoint, b: GroundPoint) => Math.hypot(a.x - b.x, a.z - b.z);

/** Where a member wants to be on the pavement right now, and whether they are running for it. */
function targetOf(w: World, m: CrowdMember): { x: number; running: boolean } {
  // Each side of the row runs for its own end of the block.
  if (waveOn(w)) return { x: m.slot % 2 ? -PAVEMENT_REACH : PAVEMENT_REACH, running: true };
  if (m.watching) {
    const job = w.jobs.find((j) => active(j) && j.preview?.id === m.watching);
    const piece = job?.preview ?? w.objects.find((o) => o.id === m.watching && intact(o));
    if (piece) return { x: clampX(piece.position.x), running: false };
  }
  return { x: slotPosition(m.slot).x, running: false };
}

// ---- Errands: off the pavement on a chat verb ------------------------------------------------

/** The hoop a member would shoot at: the nearest standing one. */
export function nearestWithUse(w: World, from: GroundPoint, use: 'hoop' | 'vehicle' | 'music'): SafehouseObject | undefined {
  return w.objects
    .filter((o) => intact(o) && !o.creature && o.uses?.includes(use))
    .sort((a, b) => distance(from, a.position) - distance(from, b.position))[0];
}
/** The nearest standing piece that carries this verb word (`!swim` → the pond, or a chat pool). */
export function nearestWithVerb(w: World, from: GroundPoint, word: PieceVerb['word']): SafehouseObject | undefined {
  return w.objects
    .filter((o) => intact(o) && o.verb?.word === word && (!o.creature || isCreatureVerb(word)))
    .sort((a, b) => distance(from, a.position) - distance(from, b.position))[0];
}
/**
 * What a verb on this piece amounts to: `hold` a pose there (most words), a `run` up the street with
 * the piece (`drive`/`ride` on something that cannot move by itself), a `mount` on a living build's
 * back (`ride`), or a `scrap` with one (`fight`).
 */
export type VerbKind = 'hold' | 'run' | 'mount' | 'scrap';
export function verbKind(piece: SafehouseObject, word: VerbWord): VerbKind {
  if (piece.creature) return word === 'fight' ? 'scrap' : word === 'ride' ? 'mount' : 'hold';
  return isRunVerb(word) ? 'run' : 'hold';
}
/** How many may do a verb at one piece at once: one driver, one rider, one opponent; three for the rest. */
export const doersFor = (piece: SafehouseObject, word: VerbWord): number => (verbKind(piece, word) === 'hold' ? VERB_ERRAND.doers : 1);
const topOf = (piece: SafehouseObject) => Math.max(0, blueprintBounds(piece.blueprint).maxY);
/** Where a driver sits in a piece: part way up it. */
export const seatHeight = (piece: SafehouseObject): number => Math.min(RUN.seatY.max, topOf(piece) * RUN.seatY.factor);
/** Where a rider sits on a living build: on its back, plus a flyer's height. */
export const mountHeight = (c: SafehouseObject): number => (c.creature?.altitude ?? 0) + Math.min(MOUNT.maxY, topOf(c) * MOUNT.factor);
/**
 * How a piece is turned to travel a heading, relative to its design: its long axis goes along the way,
 * and it never turns more than a quarter round — so a car parked along the street drives forwards one
 * way and reverses the other, rather than swinging about.
 */
export function turnFor(piece: SafehouseObject, heading: number): number {
  const axis = piece.footprint.width >= piece.footprint.depth ? Math.PI / 2 : 0;
  let t = heading - axis;
  while (t > Math.PI / 2) t -= Math.PI;
  while (t <= -Math.PI / 2) t += Math.PI;
  return t;
}
/**
 * The piece's waypoints for a run, ending back where it stands: straight out to the first lane it can
 * reach, as far as the road is clear each way (longer leg first), back to the lane point, home. Solid
 * pieces (never creatures) inflated by the piece's own half-size plus a margin; nothing if it cannot
 * pull out or the road is boxed in both ways.
 */
export function planRun(w: World, piece: SafehouseObject, seconds: number): GroundPoint[] | undefined {
  const half = Math.max(piece.footprint.width, piece.footprint.depth) / 2 + RUN.clearance;
  const blocked = w.objects
    .filter((o) => o.id !== piece.id && intact(o) && !o.passable && !o.creature)
    .map((o) => inflate(footprint(o.position, o.footprint.width, o.footprint.depth), half));
  const inside = inflate(YARD_BOUNDS, -half);
  const clear = (p: GroundPoint) => contains(inside, p) && !blocked.some((r) => contains(r, p));
  const clearSegment = (a: GroundPoint, b: GroundPoint) => {
    const n = Math.max(1, Math.ceil(distance(a, b) / 0.25));
    for (let i = 1; i <= n; i++) if (!clear({ x: a.x + ((b.x - a.x) * i) / n, z: a.z + ((b.z - a.z) * i) / n })) return false;
    return true;
  };
  const home = { x: piece.position.x, z: piece.position.z };
  let entry: GroundPoint | undefined;
  for (const z of RUN.lanes) {
    const e = { x: home.x, z };
    if (Math.abs(home.z - z) < 0.5 ? clear(e) : clearSegment(home, e)) {
      entry = e;
      break;
    }
  }
  if (!entry) return undefined;
  const lane = entry;
  const extent = (dir: 1 | -1) => {
    let d = 0;
    while (d < RUN.legMax && clear({ x: lane.x + (d + 0.5) * dir, z: lane.z })) d += 0.5;
    return d;
  };
  const out = distance(home, lane);
  const leg = Math.max(RUN.legMin, Math.min(RUN.legMax, (RUN.speed * seconds - 2 * out) / 4));
  const east = Math.min(leg, extent(1)),
    west = Math.min(leg, extent(-1));
  if (Math.max(east, west) < RUN.legMin) return undefined;
  const legs = (east >= west ? [east, -west] : [-west, east]).filter((l) => Math.abs(l) >= RUN.legMin);
  const path: GroundPoint[] = [];
  const onLane = out <= 0.01;
  if (!onLane) path.push(lane);
  for (const l of legs) path.push({ x: lane.x + l, z: lane.z }, lane);
  if (!onLane) path.push(home);
  return path;
}
/** The four spots a set distance off a footprint, nearest to `from` first. */
function sidesOf(piece: SafehouseObject, off: number, from: GroundPoint, centre: GroundPoint = piece.position): GroundPoint[] {
  const r = footprint(centre, piece.footprint.width, piece.footprint.depth);
  return [
    { x: centre.x, z: r.maxZ + off },
    { x: centre.x, z: r.minZ - off },
    { x: r.minX - off, z: centre.z },
    { x: r.maxX + off, z: centre.z },
  ].sort((a, b) => distance(a, from) - distance(b, from));
}
/** The standing height on a piece for a pose: its top for standing poses, half way for sitting, lying and swimming (a pool's water is its top). */
export function verbHeight(piece: SafehouseObject, pose: VerbPose): number {
  const top = Math.max(0, blueprintBounds(piece.blueprint).maxY);
  return UPRIGHT.includes(pose)
    ? Math.min(VERB_ERRAND.standY.max, top)
    : Math.min(VERB_ERRAND.lowY.max, top * VERB_ERRAND.lowY.factor);
}
/**
 * Where a member stands to do a piece's verb, and the way there. `beside`: 0.75 m off the nearest
 * reachable side. `on`: the route ends at that side spot and the member steps to a point inside the
 * footprint (`at`), spread away from anyone already doing it there; `y` is the height they stand at.
 */
export function verbSpot(
  w: World,
  from: GroundPoint,
  piece: SafehouseObject,
  verb: PieceVerb,
): { path: GroundPoint[]; at?: GroundPoint; y: number } | undefined {
  let way: GroundPoint[] | undefined;
  for (const spot of sidesOf(piece, VERB_ERRAND.besideOff, from)) {
    if (!contains(YARD_BOUNDS, spot)) continue;
    const path = route(from, spot, w.objects);
    if (path && path.length <= 400) {
      way = straighten(path);
      break;
    }
  }
  if (!way) return undefined;
  if (verb.spot === 'beside') return { path: way, y: 0 };
  const halfW = piece.footprint.width / 2,
    halfD = piece.footprint.depth / 2;
  const inset = Math.min(VERB_ERRAND.inset, Math.max(0.05, halfW - 0.05), Math.max(0.05, halfD - 0.05));
  const others = (w.crowd ?? [])
    .filter((m) => m.errand?.kind === 'verb' && m.errand.targetId === piece.id && m.errand.at)
    .map((m) => m.errand!.at!);
  const candidates: GroundPoint[] = [{ x: piece.position.x, z: piece.position.z }];
  for (const fx of [-1, 0, 1])
    for (const fz of [-1, 0, 1])
      if (fx || fz) candidates.push({ x: piece.position.x + fx * (halfW - inset), z: piece.position.z + fz * (halfD - inset) });
  const room = (p: GroundPoint) => (others.length ? Math.min(...others.map((o) => distance(o, p))) : 0);
  // Nobody there yet: the middle. Otherwise the spot with the most room.
  const at = others.length ? [...candidates].sort((a, b) => room(b) - room(a))[0] : candidates[0];
  return { path: way, at, y: verbHeight(piece, verb.pose) };
}
/**
 * A piece's own verb (`!swim`): send a member to the piece, or queue them behind the doers already
 * there. Returns `'going'`, `'queued'`, or the reason it could not happen.
 */
export function startVerb(w: World, memberId: string, word: PieceVerb['word'], now: number): 'going' | 'queued' | 'no-piece' | 'no-route' | 'busy' | 'queue-full' {
  const m = w.crowd?.find((x) => x.id === memberId);
  if (!m) return 'no-route';
  if (m.errand) return 'busy';
  const piece = nearestWithVerb(w, m.position, word);
  if (!piece?.verb) return 'no-piece';
  const qk = queueKey(piece.id, word);
  const line = queues.get(qk) ?? [];
  if (line.includes(memberId)) return 'busy';
  const doing = w.crowd!.filter((x) => x.errand?.kind === 'verb' && x.errand.targetId === piece.id && x.errand.word === word && x.errand.phase !== 'returning').length;
  if (doing >= doersFor(piece, word) || line.length) {
    if (line.length >= ERRAND.queue) return 'queue-full';
    line.push(memberId);
    queues.set(qk, line);
    return 'queued';
  }
  return dispatchVerb(w, m, piece, now) ? 'going' : 'no-route';
}
function dispatchVerb(w: World, m: CrowdMember, piece: SafehouseObject, _now: number): boolean {
  const verb = piece.verb;
  if (!verb) return false;
  const kind = verbKind(piece, verb.word);
  if (kind === 'run') {
    // Board from the nearest side; the piece's own route is planned now so a boxed-in car is refused up front.
    const run = planRun(w, piece, verb.seconds);
    const way = run ? verbSpot(w, m.position, piece, { ...verb, spot: 'beside' }) : undefined;
    if (!run || !way) return false;
    m.errand = { kind: 'verb', targetId: piece.id, phase: 'going', path: way.path, until: 0, word: verb.word, pose: 'sit', y: seatHeight(piece), run };
  } else if (kind === 'mount' || kind === 'scrap') {
    // A living build never blocks a route, so head for where it is now; the arrival re-plans if it has moved.
    const path = route(m.position, piece.position, w.objects);
    if (!path || path.length > 400) return false;
    m.errand = { kind: 'verb', targetId: piece.id, phase: 'going', path: straighten(path), until: 0, word: verb.word, pose: verb.pose, y: 0, tries: 0 };
  } else {
    const way = verbSpot(w, m.position, piece, verb);
    if (!way) return false;
    m.errand = { kind: 'verb', targetId: piece.id, phase: 'going', path: way.path, until: 0, word: verb.word, pose: verb.pose, at: way.at, y: way.y };
  }
  m.watching = undefined;
  m.watchingUntil = undefined;
  return true;
}
/**
 * Where to stand to throw at a hoop: 2.75 m off its footprint, the nearest side to the shooter
 * that they can reach (Jake's hoop sits in his front yard, so from the pavement that is the
 * street side and the throw goes into the yard, as his own does).
 */
export function hoopSpot(w: World, from: GroundPoint, hoop: SafehouseObject): { spot: GroundPoint; path: GroundPoint[] } | undefined {
  const r = footprint(hoop.position, hoop.footprint.width, hoop.footprint.depth);
  const off = ERRAND.hoopOff;
  const around = [
    { x: hoop.position.x, z: r.maxZ + off },
    { x: hoop.position.x, z: r.minZ - off },
    { x: r.minX - off, z: hoop.position.z },
    { x: r.maxX + off, z: hoop.position.z },
  ].sort((a, b) => distance(a, from) - distance(b, from));
  for (const spot of around) {
    if (!contains(YARD_BOUNDS, spot)) continue;
    const path = route(from, spot, w.objects);
    if (path && path.length <= 400) return { spot, path: straighten(path) };
  }
  return undefined;
}
/**
 * `!shoot`: send a member to the hoop, or put them in the queue behind whoever is at it. Returns
 * `'going'`, `'queued'`, or a reason it could not happen.
 */
export function startShoot(w: World, memberId: string, now: number): 'going' | 'queued' | 'no-hoop' | 'no-route' | 'busy' | 'queue-full' {
  const m = w.crowd?.find((x) => x.id === memberId);
  if (!m) return 'no-route';
  if (m.errand) return 'busy';
  const hoop = nearestWithUse(w, m.position, 'hoop');
  if (!hoop) return 'no-hoop';
  const qk = queueKey(hoop.id, 'shoot');
  const line = queues.get(qk) ?? [];
  if (line.includes(memberId)) return 'busy';
  const shooting = w.crowd!.some((x) => x.errand?.kind === 'shoot' && x.errand.targetId === hoop.id);
  if (shooting || line.length) {
    if (line.length >= ERRAND.queue) return 'queue-full';
    line.push(memberId);
    queues.set(qk, line);
    return 'queued';
  }
  return dispatch(w, m, hoop, now) ? 'going' : 'no-route';
}
function dispatch(w: World, m: CrowdMember, hoop: SafehouseObject, _now: number): boolean {
  const way = hoopSpot(w, m.position, hoop);
  if (!way) return false;
  m.errand = { kind: 'shoot', targetId: hoop.id, phase: 'going', path: way.path, until: 0 };
  m.watching = undefined;
  m.watchingUntil = undefined;
  return true;
}
/** One straight run per tick along the path at jog speed, facing the way they go. True when the path is done. */
function jog(m: CrowdMember, dt: number): boolean {
  const path = m.errand!.path;
  let budget = (Math.min(dt, 10_000) / 1000) * ERRAND.speed;
  while (path.length && budget > 0) {
    const next = path[0],
      dx = next.x - m.position.x,
      dz = next.z - m.position.z,
      length = Math.hypot(dx, dz);
    if (length > 0.001) m.facing = Math.atan2(dx, dz);
    if (length <= budget) {
      m.position = { ...next };
      path.shift();
      budget -= length;
      if (length > 0.001) break; // one straight segment per snapshot, like Rook, so the page never slides through a corner
    } else {
      m.position.x += (dx / length) * budget;
      m.position.z += (dz / length) * budget;
      budget = 0;
    }
  }
  return path.length === 0;
}
/**
 * Head home: a route back to the slot. From on top of a solid piece the first step may be inside its
 * footprint, so the way out goes via a side spot; a straight line is the last resort so nobody is stranded.
 */
function sendHome(w: World, m: CrowdMember): void {
  const home = slotPosition(m.slot);
  const e = m.errand;
  let path = route(m.position, home, w.objects);
  if (!path && e?.at) {
    const piece = w.objects.find((o) => o.id === e.targetId);
    for (const side of piece ? sidesOf(piece, VERB_ERRAND.besideOff, home) : []) {
      const rest = route(side, home, w.objects);
      if (rest) {
        path = [m.position, side, ...rest];
        break;
      }
    }
  }
  m.errand = {
    kind: e?.kind ?? 'shoot',
    targetId: e?.targetId ?? '',
    phase: 'returning',
    path: path ? straighten(path) : [home],
    until: 0,
    ...(e?.word ? { word: e.word } : {}),
  };
}
/** The next in line for a hoop or a piece's verb sets off, as far as there is room. */
function nextInLine(w: World, qk: string, now: number): void {
  const line = queues.get(qk);
  if (!line?.length) return;
  const at = qk.lastIndexOf(':');
  const targetId = qk.slice(0, at),
    what = qk.slice(at + 1);
  const piece = w.objects.find((o) => o.id === targetId && intact(o));
  const room = () =>
    what === 'shoot'
      ? !w.crowd?.some((x) => x.errand?.kind === 'shoot' && x.errand.targetId === targetId)
      : (w.crowd?.filter((x) => x.errand?.kind === 'verb' && x.errand.targetId === targetId && x.errand.word === what && x.errand.phase !== 'returning').length ?? 0) <
        (piece ? doersFor(piece, what as VerbWord) : 0);
  while (line.length && piece && room()) {
    const id = line.shift()!;
    const m = w.crowd?.find((x) => x.id === id);
    if (!m || m.errand) continue;
    if (what === 'shoot') dispatch(w, m, piece, now);
    else if (piece.verb?.word === what) dispatchVerb(w, m, piece, now);
  }
  if (!piece) line.length = 0;
  if (!line.length) queues.delete(qk);
}
/** A shot landed: the scoreboard, the page's pop, the event. */
function land(w: World, m: CrowdMember, hoopId: string, now: number, rng: () => number, events: CrowdEvent[]): void {
  const user = m.name.trim().toLowerCase();
  const hit = rng() < ERRAND.hitChance;
  const scores = (w.scores ??= {});
  const s = (scores[user] ??= { shots: 0, hits: 0, streak: 0, best: 0, lastAt: now });
  s.shots++;
  if (hit) {
    s.hits++;
    s.streak++;
    s.best = Math.max(s.best, s.streak);
    missRun.set(user, 0);
  } else {
    s.streak = 0;
    missRun.set(user, (missRun.get(user) ?? 0) + 1);
  }
  s.lastAt = now;
  // The table stays bounded: the coldest chatters drop off.
  const keys = Object.keys(scores);
  if (keys.length > MAX_SCORES) {
    keys.sort((a, b) => scores[a].lastAt - scores[b].lastAt);
    for (const k of keys.slice(0, keys.length - MAX_SCORES)) delete scores[k];
  }
  m.shot = { hit, at: now };
  events.push({ kind: 'shot', user, name: m.name, targetId: hoopId, hit, streak: s.streak, misses: missRun.get(user) ?? 0 });
}
/** Move a driven piece along its run at driving pace: one straight segment per tick, like a jog. Returns the heading, or nothing if it did not move. */
function drive(p: SafehouseObject, run: GroundPoint[], dt: number): number | undefined {
  const d = p.driven!;
  let budget = (Math.min(dt, 10_000) / 1000) * RUN.speed;
  let heading: number | undefined;
  while (run.length && budget > 0) {
    const next = run[0],
      dx = next.x - d.at.x,
      dz = next.z - d.at.z,
      len = Math.hypot(dx, dz);
    if (len > 0.001) heading = Math.atan2(dx, dz);
    if (len <= budget) {
      d.at = { ...next };
      run.shift();
      budget -= len;
      if (len > 0.001) break;
    } else {
      d.at = { x: d.at.x + (dx / len) * budget, z: d.at.z + (dz / len) * budget };
      budget = 0;
    }
  }
  return heading;
}
/** Off a piece or a living build: the nearest side spot (of where it is drawn, for a piece mid-run), so the walk home starts on clear ground. */
function stepOff(m: CrowdMember, piece: SafehouseObject, centre: GroundPoint = piece.position): void {
  const side = sidesOf(piece, VERB_ERRAND.besideOff, m.position, centre).find((p) => contains(YARD_BOUNDS, p));
  if (side) m.position = side;
}
/** The piece went, lost its verb, or the horde is on the street: park it where it stands, let the creature go, walk back. */
function abandon(w: World, m: CrowdMember): void {
  const e = m.errand!;
  const raw = w.objects.find((o) => o.id === e.targetId);
  const wasAt = raw?.driven && e.run ? { ...raw.driven.at } : undefined; // the car goes back to its spot; dave is left on the road
  if (raw?.driven && e.run) raw.driven = undefined;
  if (raw?.creature && e.word === 'fight' && raw.creature.busyMs) raw.creature.busyMs = 0;
  if (raw && e.phase === 'doing' && (e.run || raw.creature)) stepOff(m, raw, wasAt);
  sendHome(w, m);
}
/**
 * One tick of a piece's-verb errand: jog there, then by kind — hold a pose on or beside it; take it up
 * the street and back (`run`); sit on a living build's back while it goes about its business (`mount`);
 * a scrap with one, decided when the rounds are up (`scrap`) — and jog back.
 */
function tickVerbErrand(w: World, m: CrowdMember, now: number, dt: number, rng: () => number, events: CrowdEvent[]): void {
  const e = m.errand!;
  const piece = w.objects.find((o) => o.id === e.targetId && intact(o) && o.verb?.word === e.word);
  if (e.phase !== 'returning' && (!piece || waveOn(w))) {
    abandon(w, m);
    return;
  }
  const kind = piece ? verbKind(piece, e.word!) : 'hold';
  const user = m.name.trim().toLowerCase();
  if (e.phase === 'going') {
    if (!jog(m, dt)) return;
    const p = piece!,
      verb = p.verb!;
    if ((kind === 'mount' || kind === 'scrap') && distance(m.position, p.position) > CHASE.reach) {
      // It has wandered off: after it, a few times, then give up.
      const path = (e.tries ?? 0) < CHASE.tries ? route(m.position, p.position, w.objects) : null;
      if (path && path.length <= 400) {
        e.path = straighten(path);
        e.tries = (e.tries ?? 0) + 1;
      } else sendHome(w, m);
      return;
    }
    e.phase = 'doing';
    e.until = now + verb.seconds * 1000;
    if (kind === 'run') {
      // In: the figure sits where the piece stands and the piece starts moving under them.
      m.position = { x: p.position.x, z: p.position.z };
      m.facing = 0;
      p.driven = { at: { ...m.position }, turn: 0, by: m.name, until: e.until + RUN.graceMs };
    } else if (kind === 'mount') {
      m.position = { x: p.position.x, z: p.position.z };
      m.facing = p.creature!.facing;
      e.y = mountHeight(p);
    } else if (kind === 'scrap') {
      // Square up: both stand their ground facing each other for the rounds.
      const st = p.creature!;
      e.until = now + Math.min(verb.seconds, SCRAP.roundsMaxS) * 1000;
      st.busyMs = e.until - now + 500;
      st.path = [];
      st.moving = false;
      st.goal = undefined;
      st.facing = Math.atan2(m.position.x - p.position.x, m.position.z - p.position.z);
      m.facing = Math.atan2(p.position.x - m.position.x, p.position.z - m.position.z);
    } else {
      if (e.at) m.position = { ...e.at }; // the step onto the piece
      // On a piece they face the street; beside one they face it.
      m.facing = e.at ? 0 : Math.atan2(p.position.x - m.position.x, p.position.z - m.position.z);
    }
    m.pop = { text: verb.pop ?? verb.word.toUpperCase(), at: now };
    events.push({ kind: 'verb', user, name: m.name, targetId: p.id, word: verb.word });
    return;
  }
  if (e.phase === 'doing') {
    const p = piece!;
    if (kind === 'run') {
      if (p.driven && e.run?.length && now <= e.until + RUN.graceMs) {
        const heading = drive(p, e.run, dt);
        if (heading !== undefined) {
          p.driven.turn = turnFor(p, heading);
          m.facing = heading;
        }
        m.position = { ...p.driven.at };
        if (e.run.length) return;
      }
      // Parked (back where it started, or where it got to): out, and walk back.
      p.driven = undefined;
      stepOff(m, p);
      sendHome(w, m);
      return;
    }
    if (kind === 'mount') {
      m.position = { x: p.position.x, z: p.position.z };
      m.facing = p.creature!.facing;
      e.y = mountHeight(p);
      if (now < e.until) return;
      stepOff(m, p);
      sendHome(w, m);
      return;
    }
    if (kind === 'scrap') {
      if (now < e.until) return;
      const st = p.creature!;
      if (!e.result) {
        // The rounds are up: the app decides. The loser bolts; the figure celebrates or lies flat a moment.
        const won = rng() < SCRAP.winChance;
        e.result = won ? 'won' : 'lost';
        e.pose = won ? 'cheer' : 'lie';
        e.until = now + (won ? SCRAP.celebrateMs : SCRAP.downMs);
        m.pop = { text: won ? 'KO' : 'OOF', at: now };
        st.busyMs = 0;
        if (won) {
          st.scaredMs = SCRAP.boltMs;
          st.goal = undefined;
          st.path = [];
          st.replanMs = 0;
        }
        events.push({ kind: 'verb', user, name: m.name, targetId: p.id, word: 'fight', result: e.result });
        return;
      }
      sendHome(w, m);
      return;
    }
    if (now < e.until) return;
    sendHome(w, m);
    return;
  }
  if (jog(m, dt)) {
    const qk = errandKey(e);
    m.errand = undefined;
    m.position = slotPosition(m.slot);
    m.facing = FACE_YARD;
    nextInLine(w, qk, now);
  }
}
/** One tick of a member's errand. */
function tickErrand(w: World, m: CrowdMember, now: number, dt: number, rng: () => number, events: CrowdEvent[]): void {
  const e = m.errand!;
  if (e.kind === 'verb') return tickVerbErrand(w, m, now, dt, rng, events);
  const hoop = w.objects.find((o) => o.id === e.targetId && intact(o) && o.uses?.includes('hoop'));
  if (e.phase !== 'returning' && (!hoop || waveOn(w))) {
    // The hoop went, or the horde is on the street: back to the kerb.
    sendHome(w, m);
    return;
  }
  if (e.phase === 'going') {
    if (jog(m, dt)) {
      e.phase = 'doing';
      e.until = now + ERRAND.shotMs;
      if (hoop) m.facing = Math.atan2(hoop.position.x - m.position.x, hoop.position.z - m.position.z);
    }
    return;
  }
  if (e.phase === 'doing') {
    if (now < e.until) return;
    land(w, m, e.targetId, now, rng, events);
    sendHome(w, m);
    return;
  }
  // returning
  if (jog(m, dt)) {
    const qk = errandKey(e);
    m.errand = undefined;
    m.position = slotPosition(m.slot);
    m.facing = FACE_YARD;
    nextInLine(w, qk, now);
  }
}

/** Brief happenings (a horn) leave the snapshot after a few seconds; the list stays short. */
export function tickEffects(w: World, now: number): void {
  if (!w.effects?.length) return;
  const kept = w.effects.filter((e) => now - e.at <= EFFECT_TTL_MS).slice(-MAX_EFFECTS);
  if (kept.length !== w.effects.length) w.effects = kept;
}
/** Add a happening for the page. */
export function addEffect(w: World, effect: Omit<WorldEffect, 'id'>): WorldEffect {
  const list = (w.effects ??= []);
  const id = list.reduce((n, e) => Math.max(n, e.id), 0) + 1;
  const full = { id, ...effect };
  list.push(full);
  if (list.length > MAX_EFFECTS) list.splice(0, list.length - MAX_EFFECTS);
  return full;
}

/**
 * One world tick: the quiet wander off, watches are kept up to date from the job queue, and
 * everyone walks (or runs) along the kerb toward wherever they want to be. Members on an errand
 * follow their route instead and never expire until they are back. Returns what happened that
 * Rook may want to hear about (a shot landing).
 */
export function tickCrowd(w: World, now: number, dt: number, rng: () => number = Math.random): CrowdEvent[] {
  const events: CrowdEvent[] = [];
  tickEffects(w, now);
  const crowd = w.crowd;
  if (!crowd?.length) return events;
  const step = Math.min(Math.max(dt, 0), 10_000) / 1000;
  w.crowd = crowd.filter((m) => m.errand || now - m.lastAt <= EXPIRE_MS);
  for (const m of w.crowd) {
    if (m.dancingUntil !== undefined && m.dancingUntil <= now) m.dancingUntil = undefined;
    if (m.errand) {
      tickErrand(w, m, now, dt, rng, events);
      continue;
    }
    // Their own build in flight: watch it; once it has landed, stay a minute, then drift home.
    const mine = w.jobs.find(
      (j) => active(j) && j.userId === m.id && !!j.preview && (j.status === 'walking' || j.status === 'building'),
    );
    if (mine?.preview) {
      m.watching = mine.preview.id;
      m.watchingUntil = undefined;
    } else if (m.watching && m.watchingUntil === undefined) {
      const landed = w.objects.find((o) => o.id === m.watching && intact(o));
      if (landed) m.watchingUntil = now + WATCH_MS;
      else m.watching = undefined;
    } else if (m.watching && m.watchingUntil !== undefined && now > m.watchingUntil) {
      m.watching = undefined;
      m.watchingUntil = undefined;
    }
    const { x: targetX, running } = targetOf(w, m);
    const dx = targetX - m.position.x;
    const reach = (running ? RUN_SPEED : WALK_SPEED) * step;
    if (Math.abs(dx) <= 0.02) {
      m.position.x = targetX;
      m.facing = FACE_YARD;
    } else if (Math.abs(dx) <= reach) {
      m.position.x = targetX;
      m.facing = Math.atan2(dx, 0);
    } else {
      m.position.x += Math.sign(dx) * reach;
      m.facing = Math.atan2(dx, 0);
    }
    m.position.z = PAVEMENT_Z;
  }
  // Someone waiting on a hoop whose shooter has gone (expired, replaced), or on a piece with room again: let them go.
  for (const qk of [...queues.keys()]) nextInLine(w, qk, now);
  return events;
}

/** The pavement as the page draws it; nothing while the operator has hidden the crowd. */
export function crowdViews(w: World, now = Date.now()): CrowdView[] {
  if (w.crowdHidden || !w.crowd?.length) return [];
  const running = waveOn(w);
  return w.crowd.map((m) => ({
    id: m.id,
    name: m.name,
    position: { ...m.position },
    facing: m.facing,
    wavedAt: m.lastAt,
    // Scattering, on the way back from the ends with nothing to watch, or jogging home from an errand during a wave.
    ...((running && (!m.errand || m.errand.phase === 'returning')) || (!m.errand && !m.watching && Math.abs(m.position.x - slotPosition(m.slot).x) > 2)
      ? { running: true }
      : {}),
    ...(m.watching ? { watching: m.watching } : {}),
    ...(m.errand
      ? {
          errand: {
            kind: m.errand.kind,
            phase: m.errand.phase,
            targetId: m.errand.targetId,
            ...(m.errand.word ? { word: m.errand.word } : {}),
            ...(m.errand.pose ? { pose: m.errand.pose } : {}),
            ...(m.errand.y !== undefined ? { y: m.errand.y } : {}),
            ...(m.errand.result ? { result: m.errand.result } : {}),
          },
        }
      : {}),
    ...(m.shot && now - m.shot.at <= ERRAND.shotShownMs ? { shot: { ...m.shot } } : {}),
    ...(m.pop && now - m.pop.at <= VERB_ERRAND.popShownMs ? { pop: { ...m.pop } } : {}),
    ...(m.dancingUntil !== undefined && m.dancingUntil > now ? { dancingUntil: m.dancingUntil } : {}),
  }));
}

/** For Rook's state summary: who is on the pavement right now. */
export function describeCrowd(w: World, now: number): string | undefined {
  const here = (w.crowd ?? []).filter((m) => now - m.lastAt <= EXPIRE_MS).sort((a, b) => b.lastAt - a.lastAt);
  if (!here.length) return undefined;
  const names = here.slice(0, 6).map((m) => m.name);
  const more = here.length - names.length;
  return `watching from the pavement: ${here.length} ${here.length === 1 ? 'person' : 'people'} (${names.join(', ')}${more > 0 ? `, and ${more} more` : ''})`;
}
