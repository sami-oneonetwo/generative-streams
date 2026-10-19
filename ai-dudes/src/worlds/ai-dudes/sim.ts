// The field's own clockwork, zero AI: dudes walk their paths, work their jobs, hold their poses,
// and wander a little when their chatter is around but quiet. Every dude runs its own job at the
// same time as everyone else's, so twenty builds can go up at once.
import { FIELD, contains, footprint, type Rect } from '../../shared/layout';
import type { GroundPoint, SafehouseObject } from '../../shared/objectTypes';
import { blueprintBounds, measureBlueprint } from './blueprint';
import { choosePlacement, route, route as findRoute, walkableSegment, workSpots } from './placement';
import { LIMITS, nextId, pushFeed, pushLine, type Dude, type DudesState, type Job, type UseTask } from './state';
import type { Emote, FieldEffect, UseHow } from '../../shared/dudesTypes';
import { claimHat, restore } from './events';
import { knockedOut, recover, runAttack, runOver } from './combat';
import { listen } from './listener';

export const WALK_SPEED = 2.4; // m/s
export const WANDER_SPEED = 1.3;
/** A chatter quiet this long and their dude naps where it stands. */
export const AWAKE_MS = 15 * 60_000;
/** Poses that hold until the dude does something else (the server keeps them alive this long at most). */
export const HOLD_MS = 90_000;

export const isActive = (j: Job) => j.status !== 'done' && j.status !== 'failed';
export const awake = (d: Dude, now: number) => now - d.lastHeardAt < AWAKE_MS;
const dist = (a: GroundPoint, b: GroundPoint) => Math.hypot(a.x - b.x, a.z - b.z);

/** Ground claimed by builds in flight (designed and placed, not yet standing), except `exceptJob`. */
export function reserved(state: DudesState, exceptJob?: string): Rect[] {
  return state.jobs
    .filter((j) => j.id !== exceptJob && j.kind === 'build' && j.position && j.footprint && isActive(j))
    .map((j) => footprint(j.position!, j.footprint!.width, j.footprint!.depth));
}

export function workMsFor(job: Job): number {
  if (job.kind === 'remove') return 4000;
  const parts = job.blueprint?.parts.length ?? 10;
  const base = Math.min(25_000, Math.max(6000, 4000 + parts * 350));
  return job.kind === 'edit' ? Math.round(base * 0.6) : base;
}

/** A designed job gets its ground: a new build near its anchor, an edit where the old one stands. */
export function placeJob(state: DudesState, job: Job): void {
  if (!job.blueprint) throw new Error('nothing designed');
  const size = measureBlueprint(job.blueprint);
  job.footprint = size;
  if (job.kind === 'build') {
    job.position = choosePlacement(size, state.objects, job.anchor, reserved(state, job.id));
    return;
  }
  const target = state.objects.find((o) => o.id === job.targetId);
  if (!target) throw new Error('that build is gone');
  const others = state.objects.filter((o) => o.id !== target.id);
  const rect = footprint(target.position, size.width, size.depth);
  const clear =
    contains(FIELD, { x: rect.minX, z: rect.minZ }) &&
    contains(FIELD, { x: rect.maxX, z: rect.maxZ }) &&
    !others.some((o) => {
      const r = footprint(o.position, o.footprint.width, o.footprint.depth);
      return r.minX < rect.maxX && r.maxX > rect.minX && r.minZ < rect.maxZ && r.maxZ > rect.minZ;
    });
  // A bigger redesign that would now overlap a neighbour's build moves over to the nearest free ground.
  job.position = clear ? target.position : choosePlacement(size, others, target.position, reserved(state, job.id));
}

export function walkTo(state: DudesState, dude: Dude, to: GroundPoint, why: Dude['walkingFor']): boolean {
  const path = route(dude.position, to, state.objects);
  if (!path) return false;
  dude.path = path.slice(1);
  dude.walkingFor = why;
  return true;
}

/** Send a dude to a point (a `move` action): next to it if the point itself is taken. */
export function sendDude(state: DudesState, dude: Dude, to: GroundPoint): boolean {
  const clampTo = { x: Math.max(FIELD.minX + 1, Math.min(FIELD.maxX - 1, to.x)), z: Math.max(FIELD.minZ + 1, Math.min(FIELD.maxZ - 1, to.z)) };
  if (walkTo(state, dude, clampTo, 'move')) return true;
  for (let r = 1; r <= 4; r += 1)
    for (let a = 0; a < 8; a++) {
      const p = { x: clampTo.x + Math.cos((a * Math.PI) / 4) * r, z: clampTo.z + Math.sin((a * Math.PI) / 4) * r };
      if (contains(FIELD, p) && walkTo(state, dude, p, 'move')) return true;
    }
  return false;
}

export function step(dude: { path: GroundPoint[]; position: GroundPoint; facing: number; walkingFor?: string }, dt: number, speed?: number): void {
  let budget = ((speed ?? (dude.walkingFor === 'wander' ? WANDER_SPEED : WALK_SPEED)) * dt) / 1000;
  while (budget > 0 && dude.path.length) {
    const next = dude.path[0];
    const dx = next.x - dude.position.x,
      dz = next.z - dude.position.z,
      d = Math.hypot(dx, dz);
    if (d > 1e-6) dude.facing = Math.atan2(dx, dz);
    if (d <= budget) {
      dude.position = { x: next.x, z: next.z };
      dude.path.shift();
      budget -= d;
    } else {
      dude.position = { x: dude.position.x + (dx / d) * budget, z: dude.position.z + (dz / d) * budget };
      budget = 0;
    }
  }
}

export function face(dude: { position: GroundPoint; facing: number }, at: GroundPoint): void {
  const dx = at.x - dude.position.x,
    dz = at.z - dude.position.z;
  if (Math.hypot(dx, dz) > 1e-3) dude.facing = Math.atan2(dx, dz);
}

/** What the world tells the dude's agent next turn, and the field's feed, when a job ends. */
function finish(state: DudesState, dude: Dude, job: Job, now: number, ok: boolean, text: string, feed?: string): void {
  job.status = ok ? 'done' : 'failed';
  if (!ok) {
    job.error = text;
    dude.lastError = text;
    listen(state, 'failed', dude.name, `${job.kind} "${job.request.slice(0, 80)}": ${text}`, now);
  }
  pushLine(dude.history, { from: 'world', text, at: now }, LIMITS.history);
  if (feed) pushFeed(state, now, feed);
}

function commit(state: DudesState, dude: Dude, job: Job, now: number): void {
  if (job.kind === 'remove') {
    const at = state.objects.findIndex((o) => o.id === job.targetId);
    const name = at >= 0 ? state.objects[at].blueprint.name : 'it';
    if (at >= 0) state.objects.splice(at, 1);
    state.worldRevision++;
    finish(state, dude, job, now, true, `you took down ${name}`, `${dude.name} took down ${name}`);
    return;
  }
  if (!job.blueprint || !job.position || !job.footprint) return finish(state, dude, job, now, false, 'the build lost its design');
  if (job.kind === 'edit') {
    const target = state.objects.find((o) => o.id === job.targetId);
    if (!target) return finish(state, dude, job, now, false, 'the build you were changing is gone');
    target.revision++;
    target.blueprint = job.blueprint;
    target.footprint = job.footprint;
    // Placement only moves an edit when the new shape no longer fits where it stood; a build driven
    // somewhere else while it was being redesigned stays where it is now.
    const relocated = job.position.x !== job.anchor.x || job.position.z !== job.anchor.z;
    if (relocated) {
      target.position = job.position;
      target.driven = undefined;
    }
    // A parked build keeps its heading through a redesign; its footprint turns with it.
    if (target.driven) target.footprint = turnedFootprint(job.footprint, target.driven.turn);
    target.editedBy = dude.name;
    state.worldRevision++;
    return finish(state, dude, job, now, true, `you finished changing ${target.blueprint.name}`, `${dude.name} redid ${target.blueprint.name}`);
  }
  if (state.objects.length >= LIMITS.objects) return finish(state, dude, job, now, false, 'the field is full, nothing more fits');
  const object: SafehouseObject = {
    id: nextId(state, 'b'),
    revision: 1,
    blueprint: job.blueprint,
    position: job.position,
    footprint: job.footprint,
    createdBy: dude.name,
    editedBy: dude.name,
    createdAt: now,
    owner: dude.id,
  };
  state.objects.push(object);
  clearFootprint(state, object);
  state.worldRevision++;
  finish(state, dude, job, now, true, `you finished building ${object.blueprint.name}`, `${dude.name} built ${object.blueprint.name}`);
}

/** Anyone standing where a build just went up steps out beside it, rather than standing inside it. */
function clearFootprint(state: DudesState, o: SafehouseObject): void {
  const rect = footprint(o.position, o.footprint.width + 0.6, o.footprint.depth + 0.6);
  for (const d of state.dudes) {
    if (d.riding || d.y || d.hidden || !contains(rect, d.position)) continue;
    const out = workSpots(o.position, o.footprint, d.position)[0];
    if (out) {
      d.position = out;
      d.path = [];
    }
  }
}

/** Start, walk to, and work on this dude's next job. Each dude has one job in hand at a time. */
function runJobs(state: DudesState, dude: Dude, dt: number, now: number): void {
  let job = state.jobs.find((j) => j.dudeId === dude.id && (j.status === 'walking' || j.status === 'building'));
  if (!job) {
    job = state.jobs.find((j) => j.dudeId === dude.id && j.status === 'ready');
    if (!job) return;
    const at = job.position ?? state.objects.find((o) => o.id === job!.targetId)?.position;
    const size = job.footprint ?? state.objects.find((o) => o.id === job!.targetId)?.footprint;
    if (!at || !size) return finish(state, dude, job, now, false, 'nowhere to work on that');
    const spot = workSpots(at, size, dude.position).find((p) => walkTo(state, dude, p, 'job'));
    if (!spot) return finish(state, dude, job, now, false, 'could not reach the spot for that build', `${dude.name} could not reach their build site`);
    dude.emote = undefined;
    job.status = 'walking';
    job.workMs = workMsFor(job);
    job.workedMs = 0;
    return;
  }
  const at = job.position ?? state.objects.find((o) => o.id === job!.targetId)?.position;
  if (job.status === 'walking') {
    // Someone moved it out from under us, or the walk was cut short: back to ready, re-plan next tick.
    if (dude.walkingFor !== 'job') {
      job.status = 'ready';
      return;
    }
    if (dude.path.length) return;
    dude.walkingFor = undefined;
    job.status = 'building';
    if (at) face(dude, at);
    return;
  }
  if (at) face(dude, at);
  job.workedMs = (job.workedMs ?? 0) + dt;
  if (job.workedMs >= (job.workMs ?? workMsFor(job))) commit(state, dude, job, now);
}

/**
 * Something to do when nobody has asked for anything: stroll, go and stand with someone, go and look
 * at a build, sit down a while. Zero AI. Napping characters (chatter away) only shift about now and then.
 */
function idle(state: DudesState, dude: Dude, now: number, rng: () => number): void {
  if (dude.path.length) return;
  if (dude.idleUntil === undefined) {
    dude.idleUntil = now + 3000 + rng() * 8000;
    return;
  }
  if (now < dude.idleUntil) return;
  const away = !awake(dude, now);
  dude.idleUntil = now + (away ? 60_000 + rng() * 120_000 : 6000 + rng() * 12_000);
  if (dude.emote && dude.emote.until > now && dude.emote.pose !== 'sit') return;
  const roll = rng();
  const strollFrom = (centre: GroundPoint, r0: number, r1: number) => {
    const a = rng() * Math.PI * 2,
      r = r0 + rng() * (r1 - r0);
    const to = { x: centre.x + Math.cos(a) * r, z: centre.z + Math.sin(a) * r };
    if (contains(FIELD, to)) {
      dude.emote = undefined;
      walkTo(state, dude, to, 'wander');
    }
  };
  if (away) {
    if (roll < 0.5) strollFrom(dude.position, 1, 3);
    return;
  }
  const others = state.dudes.filter((d) => d !== dude && awake(d, now) && !d.hidden && !d.riding && Math.hypot(d.position.x - dude.position.x, d.position.z - dude.position.z) < 18);
  if (roll < 0.3 && others.length) {
    // Go and stand with someone; they turn to say hello when we get there (see `greet`).
    const o = others[Math.floor(rng() * others.length)];
    const a = rng() * Math.PI * 2;
    dude.emote = undefined;
    if (walkTo(state, dude, { x: o.position.x + Math.cos(a) * 1.3, z: o.position.z + Math.sin(a) * 1.3 }, 'wander')) dude.greet = o.id;
    return;
  }
  if (roll < 0.55 && state.objects.length) {
    // Go and have a look at something: one of ours, or whatever is near.
    const own = state.objects.filter((o) => o.owner === dude.id);
    const near = state.objects.filter((o) => Math.hypot(o.position.x - dude.position.x, o.position.z - dude.position.z) < 20);
    const pool = own.length && rng() < 0.4 ? own : near.length ? near : state.objects;
    const o = pool[Math.floor(rng() * pool.length)];
    const at = o.driven?.at ?? o.position;
    const reach = Math.max(o.footprint.width, o.footprint.depth) / 2 + 1.2;
    const a = rng() * Math.PI * 2;
    dude.emote = undefined;
    if (walkTo(state, dude, { x: at.x + Math.cos(a) * reach, z: at.z + Math.sin(a) * reach }, 'wander')) dude.lookAt = at;
    return;
  }
  if (roll < 0.62) {
    dude.emote = { pose: rng() < 0.8 ? 'sit' : 'lie', until: now + 8000 + rng() * 14_000 };
    return;
  }
  if (roll < 0.67) {
    dude.emote = { pose: (['think', 'point', 'wave', 'jump'] as const)[Math.floor(rng() * 4)], until: now + 3000 };
    return;
  }
  strollFrom(dude.position, 3, 9);
}

/** Arrived next to someone (or a build) on an idle stroll: face them, and both say hello with a gesture. */
function arrive(state: DudesState, dude: Dude, now: number, rng: () => number): void {
  if (dude.greet) {
    const o = state.dudes.find((d) => d.id === dude.greet);
    dude.greet = undefined;
    if (o && Math.hypot(o.position.x - dude.position.x, o.position.z - dude.position.z) < 3) {
      face(dude, o.position);
      dude.emote = { pose: rng() < 0.5 ? 'wave' : 'point', until: now + 2500 };
      if (!o.path.length && !o.use && !(o.emote && o.emote.until > now)) {
        face(o, dude.position);
        o.emote = { pose: rng() < 0.5 ? 'wave' : 'think', until: now + 2500 };
      }
    }
  }
  if (dude.lookAt) {
    face(dude, dude.lookAt);
    dude.lookAt = undefined;
    if (rng() < 0.4) dude.emote = { pose: 'point', until: now + 2500 };
  }
}

export function tickDudes(state: DudesState, dt: number, now: number, rng: () => number): void {
  for (const dude of state.dudes) {
    if (dude.say && dude.say.until <= now) dude.say = undefined;
    recover(dude, now);
    if (knockedOut(dude, now)) continue; // flat on its back: nothing moves until it gets up
    if (dude.emote && dude.emote.until <= now) dude.emote = undefined;
    if (dude.path.length) {
      step(dude, dt);
      if (!dude.path.length && dude.walkingFor !== 'job') {
        if (dude.walkingFor === 'wander') arrive(state, dude, now, rng);
        dude.walkingFor = undefined;
      }
    }
    if (dude.attack) runAttack(state, dude, now, rng);
    else if (dude.use) runUse(state, dude, dt, now);
    else runJobs(state, dude, dt, now);
    if (!dude.use && !dude.attack && !state.jobs.some((j) => j.dudeId === dude.id && isActive(j) && j.status !== 'queued' && j.status !== 'designing'))
      idle(state, dude, now, rng);
  }
  // Finished and failed jobs have told their dude already; they leave the list.
  state.jobs = state.jobs.filter(isActive);
  if (state.effects?.length) state.effects = state.effects.filter((e) => now - e.at < 4000 || (e.until ?? 0) > now);
}

/** Every dude near `from` (awake) hears what `speaker` said, for its next turn. */
export function overhear(state: DudesState, speaker: Dude, text: string, now: number): void {
  for (const d of state.dudes)
    if (d.id !== speaker.id && awake(d, now) && dist(d.position, speaker.position) < 10)
      pushLine(d.overheard, { from: speaker.name, text, at: now }, LIMITS.overheard);
}

// ---- using builds -------------------------------------------------------------------------------
// The agent picks any build and a way to use it (USE_HOWS); everything about the motion is here.
export const USE = {
  runSpeed: 5, // m/s, a vehicle under a character
  pushSpeed: 1.2,
  runLeg: [15, 35] as const, // metres per cruising leg
  /** A drive or a ride goes where it was told, then keeps cruising round the field until this runs out
   * (or the chatter asks for something else). A push is over when it has moved the build. */
  driveMs: 120_000,
  pushMs: 15_000,
  pushMetres: 4,
  holdMs: { fix: 6000, sit: 45_000, lie: 45_000, stand: 30_000, enter: 20_000, lean: 20_000, look: 12_000, dance: 10_000, hug: 6000, kick: 3000, punch: 3000 } as Partial<Record<UseHow, number>>,
};
const POSE_FOR: Record<UseHow, Emote | undefined> = {
  drive: 'drive', ride: 'sit', sit: 'sit', lie: 'lie', stand: undefined, enter: undefined, push: 'push',
  hug: 'hug', kick: 'kick', punch: 'punch', lean: 'lean', look: 'point', dance: 'dance', fix: 'punch',
};
const isRun = (how: UseHow) => how === 'drive' || how === 'ride' || how === 'push';

/** Height of a build's top, in metres. */
export function topOf(o: SafehouseObject): number {
  return Math.max(0, Math.min(30, blueprintBounds(o.blueprint).maxY));
}

/** The axis-aligned footprint of a build turned by `turn` radians. */
function turnedFootprint(size: { width: number; depth: number }, turn: number) {
  const c = Math.abs(Math.cos(turn)),
    s = Math.abs(Math.sin(turn));
  return { width: size.width * c + size.depth * s, depth: size.width * s + size.depth * c };
}

/** Someone else is aboard or mid-run with it. */
export function inUse(state: DudesState, objectId: string, except?: string): Dude | undefined {
  return state.dudes.find((d) => d.id !== except && d.use?.objectId === objectId && d.use.phase === 'doing' && isRun(d.use.how));
}

/** Start using a build: walk to the side of it nearest us. Returns a reason when it cannot start. */
export function startUse(state: DudesState, dude: Dude, o: SafehouseObject, how: UseHow, to: GroundPoint | undefined, now: number): string | undefined {
  if (isRun(how) && inUse(state, o.id, dude.id)) return `${inUse(state, o.id, dude.id)!.name} is already using ${o.blueprint.name}`;
  if (state.jobs.some((j) => j.targetId === o.id && isActive(j))) return `${o.blueprint.name} is being worked on right now`;
  endUse(state, dude, now);
  const at = o.driven?.at ?? o.position;
  const spot = workSpots(at, o.footprint, dude.position).find((p) => walkTo(state, dude, p, 'job'));
  if (!spot && !workSpots(at, o.footprint, dude.position).some((p) => Math.hypot(p.x - dude.position.x, p.z - dude.position.z) < 0.6))
    return `you could not find a way to ${o.blueprint.name}`;
  dude.emote = undefined;
  dude.use = { objectId: o.id, how, phase: 'going', ...(to ? { to } : {}) };
  return undefined;
}

/** Step off, climb down, come out: back on the ground beside the build. */
export function endUse(state: DudesState, dude: Dude, now: number): void {
  const use = dude.use;
  if (!use) return;
  const o = state.objects.find((x) => x.id === use.objectId);
  if (o && use.phase === 'doing' && isRun(use.how) && use.route) park(state, dude, o, now);
  if (o && (dude.y || dude.hidden || dude.riding)) {
    const at = o.driven?.at ?? o.position;
    const free = workSpots(at, o.footprint, dude.position).find((p) => walkableSegment(p, p, state.objects)) ?? workSpots(at, o.footprint, dude.position)[0];
    if (free) dude.position = free;
  }
  dude.use = undefined;
  dude.riding = undefined;
  dude.y = undefined;
  dude.hidden = undefined;
  if (dude.emote && (dude.emote.pose === 'drive' || dude.emote.pose === 'push')) dude.emote = undefined;
  if (dude.walkingFor === 'job') {
    dude.path = [];
    dude.walkingFor = undefined;
  }
}

/** A run is over: the build stays where it got to (or the nearest free ground), turned the way it was going. */
function park(state: DudesState, dude: Dude, o: SafehouseObject, _now: number): void {
  parkObject(state, o, dude.name);
  if (dude.use) dude.use.route = undefined;
}

/** Leave a moved build where it got to (or the nearest free ground), turned the way it was going. */
export function parkObject(state: DudesState, o: SafehouseObject, by: string): void {
  const at = o.driven?.at ?? o.position;
  const turn = o.driven?.turn ?? 0;
  // Footprints are axis-aligned: measure the design as built, then turn it the way it ended up facing.
  const size = turnedFootprint(measureBlueprint(o.blueprint), turn);
  const others = state.objects.filter((x) => x.id !== o.id);
  const rect = footprint(at, size.width, size.depth);
  const clear =
    rect.minX >= FIELD.minX + 0.5 && rect.maxX <= FIELD.maxX - 0.5 && rect.minZ >= FIELD.minZ + 0.5 && rect.maxZ <= FIELD.maxZ - 0.5 &&
    !others.some((x) => {
      const r = footprint(x.position, x.footprint.width, x.footprint.depth);
      return r.minX < rect.maxX + 0.4 && r.maxX > rect.minX - 0.4 && r.minZ < rect.maxZ + 0.4 && r.maxZ > rect.minZ - 0.4;
    }) &&
    !reserved(state).some((r) => r.minX < rect.maxX && r.maxX > rect.minX && r.minZ < rect.maxZ && r.maxZ > rect.minZ);
  let spot = at;
  if (!clear) {
    try {
      spot = choosePlacement(size, others, at, reserved(state));
    } catch {
      spot = o.position; // nowhere free: back where it started
    }
  }
  o.position = spot;
  o.footprint = size;
  o.driven = { at: spot, turn, by, until: Number.MAX_SAFE_INTEGER };
  state.worldRevision++;
}

export function shake(state: DudesState, objectId: string, now: number): void {
  addEffect(state, { kind: 'shake', objectId, at: now });
}

/** Queue something brief for the page; each gets the next id so the page plays it once. */
export function addEffect(state: DudesState, effect: Omit<FieldEffect, 'id'>): void {
  state.effects ??= [];
  const id = (state.effects.at(-1)?.id ?? effect.at) + 1;
  state.effects.push({ id, ...effect });
  while (state.effects.length > 60) state.effects.shift();
}

function beginDoing(state: DudesState, dude: Dude, o: SafehouseObject, use: UseTask, now: number): void {
  use.phase = 'doing';
  // The hat pile hands back whatever of yours is in it, however you go about using it.
  const claimed = claimHat(state, dude, o.id);
  if (claimed) {
    pushLine(dude.history, { from: 'world', text: claimed, at: now }, LIMITS.history);
    dude.emote = { pose: claimed.startsWith('you got') ? 'cheer' : 'think', until: now + 3000 };
    dude.use = undefined;
    return;
  }
  const at = o.driven?.at ?? o.position;
  const pose = POSE_FOR[use.how];
  const hold = USE.holdMs[use.how] ?? 8000;
  face(dude, at);
  if (isRun(use.how)) {
    let dest = use.to;
    if (use.how === 'push') {
      const dx = at.x - dude.position.x,
        dz = at.z - dude.position.z,
        d = Math.hypot(dx, dz) || 1;
      dest = { x: at.x + (dx / d) * USE.pushMetres, z: at.z + (dz / d) * USE.pushMetres };
    }
    if (!dest) {
      // Nowhere named: a spin out and back round where it stands.
      const a = Math.random() * Math.PI * 2,
        r = USE.runLeg[0] + Math.random() * (USE.runLeg[1] - USE.runLeg[0]);
      dest = { x: at.x + Math.cos(a) * r, z: at.z + Math.sin(a) * r };
    }
    dest = { x: Math.max(FIELD.minX + 2, Math.min(FIELD.maxX - 2, dest.x)), z: Math.max(FIELD.minZ + 2, Math.min(FIELD.maxZ - 2, dest.z)) };
    const others = state.objects.filter((x) => x.id !== o.id);
    const path = route(at, dest, others) ?? [at, dest].filter((p, i) => i === 0 || walkableSegment(at, p, others));
    use.route = path.slice(1);
    use.until = now + (use.how === 'push' ? USE.pushMs : USE.driveMs);
    o.driven = { at, turn: o.driven?.turn ?? 0, by: dude.name, until: Number.MAX_SAFE_INTEGER };
    if (use.how !== 'push') {
      dude.riding = o.id;
      dude.y = use.how === 'drive' ? Math.min(1.2, topOf(o) * 0.45) : Math.min(2.6, topOf(o) * 0.85);
      dude.position = { ...at };
    }
    if (pose) dude.emote = { pose, until: use.until };
    return;
  }
  use.until = now + hold;
  if (use.how === 'sit' || use.how === 'lie' || use.how === 'stand') {
    dude.position = { ...at };
    dude.y = topOf(o);
  }
  if (use.how === 'enter') dude.hidden = true;
  if (use.how === 'kick' || use.how === 'punch') shake(state, o.id, now);
  if (pose) dude.emote = { pose, until: use.until };
}

function runUse(state: DudesState, dude: Dude, dt: number, now: number): void {
  const use = dude.use!;
  const o = state.objects.find((x) => x.id === use.objectId);
  if (!o) {
    endUse(state, dude, now);
    return;
  }
  if (use.phase === 'going') {
    if (dude.path.length) return;
    dude.walkingFor = undefined;
    if (isRun(use.how) && inUse(state, o.id, dude.id)) {
      pushLine(dude.history, { from: 'world', text: `${inUse(state, o.id, dude.id)!.name} got to ${o.blueprint.name} first`, at: now }, LIMITS.history);
      endUse(state, dude, now);
      return;
    }
    beginDoing(state, dude, o, use, now);
    if (use.how === 'drive' || use.how === 'ride') pushFeed(state, now, `${dude.name} took ${o.blueprint.name} for a ${use.how === 'drive' ? 'drive' : 'ride'}`);
    return;
  }
  if (!isRun(use.how)) {
    if (use.how === 'kick' || use.how === 'punch') {
      // A kick lands every couple of seconds while it lasts.
      if ((state.effects?.filter((e) => e.objectId === o.id).at(-1)?.at ?? 0) < now - 1500) shake(state, o.id, now);
    }
    if (now >= (use.until ?? now)) {
      if (use.how === 'fix') {
        const fixed = restore(state, o);
        pushLine(dude.history, { from: 'world', text: fixed ? `you fixed ${o.blueprint.name}` : `${o.blueprint.name} had nothing to fix`, at: now }, LIMITS.history);
        if (fixed) pushFeed(state, now, `${dude.name} fixed ${o.blueprint.name}`);
      }
      endUse(state, dude, now);
    }
    return;
  }
  // A run: the vehicle follows its route and the character with it (or behind it, pushing).
  const driven = o.driven!;
  let budget = ((use.how === 'push' ? USE.pushSpeed : USE.runSpeed) * dt) / 1000;
  const route = use.route ?? [];
  while (budget > 0 && route.length) {
    const next = route[0];
    const dx = next.x - driven.at.x,
      dz = next.z - driven.at.z,
      d = Math.hypot(dx, dz);
    if (d > 1e-6 && use.how !== 'push') driven.turn = Math.atan2(dx, dz);
    if (d <= budget) {
      driven.at = { x: next.x, z: next.z };
      route.shift();
      budget -= d;
    } else {
      driven.at = { x: driven.at.x + (dx / d) * budget, z: driven.at.z + (dz / d) * budget };
      budget = 0;
    }
  }
  if (use.how === 'push') {
    const dx = driven.at.x - dude.position.x,
      dz = driven.at.z - dude.position.z,
      d = Math.hypot(dx, dz) || 1,
      reach = Math.max(o.footprint.width, o.footprint.depth) / 2 + 0.6;
    dude.position = { x: driven.at.x - (dx / d) * reach, z: driven.at.z - (dz / d) * reach };
    dude.facing = Math.atan2(dx, dz);
  } else {
    dude.position = { ...driven.at };
    dude.facing = driven.turn;
    runOver(state, dude, driven.at, now, o);
  }
  // Got there with time to spare: pick another stretch of open field and keep going.
  if (!route.length && use.how !== 'push' && now < (use.until ?? now)) {
    const others = state.objects.filter((x) => x.id !== o.id);
    for (let tries = 0; tries < 6 && !route.length; tries++) {
      const a = Math.random() * Math.PI * 2,
        r = USE.runLeg[0] + Math.random() * (USE.runLeg[1] - USE.runLeg[0]);
      const next = { x: Math.max(FIELD.minX + 3, Math.min(FIELD.maxX - 3, driven.at.x + Math.cos(a) * r)), z: Math.max(FIELD.minZ + 3, Math.min(FIELD.maxZ - 3, driven.at.z + Math.sin(a) * r)) };
      const path = findRoute(driven.at, next, others);
      if (path) route.push(...path.slice(1));
    }
    use.route = route;
  }
  if (!route.length || now >= (use.until ?? now)) {
    park(state, dude, o, now);
    if (use.how !== 'push') pushLine(dude.history, { from: 'world', text: `you parked ${o.blueprint.name}`, at: now }, LIMITS.history);
    endUse(state, dude, now);
  }
}
