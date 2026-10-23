// Players: chatters who logged in with Kick on the /play page and walk their own character, the
// way the streamer walks the Mayor. The seat (one of ten) is held by the server (src/server/play.ts);
// this is the world's side: which characters are being driven right now, and how far a step may go.
// While a character is driven its agent leaves the body alone (no turns, no errands, no strolls):
// the player is the character. Its builds still go through the designer, and rise on their own.
// Nothing here is saved: a restart hands every character back to its agent.
//
// The page is never trusted with numbers that matter: how far a step goes is checked against a
// one-second distance budget, a step into a build is refused (the page slides along it the same
// way), and how fast something was driven into a build comes from the steps the server accepted.
import type { GroundPoint, SafehouseObject } from '../../shared/objectTypes';

export interface Pilot {
  name: string;
  since: number;
  lastInputAt: number;
  moving: boolean;
  running: boolean;
  /** The last accepted step, in server time, for the speed check and the stream's clock. */
  last?: { at: number; x: number; z: number };
  clock: { offset: number; last: number; lastNow: number };
  /** Rate limits: not before these. */
  sayAt: number;
  buildAt: number;
  /** Carrying a weapon (weapons.ts). */
  armed?: import('../../shared/dudesTypes').Weapon;
  /** Metres they may still cover right now: refills at top speed, holds at most a second's worth. */
  budget?: number;
  /** The last half second or so of accepted steps: how fast they are really going (a ram's speed). */
  trail?: { at: number; x: number; z: number }[];
  /** Metres driven since the last ram: a ram needs a run-up. */
  travel?: number;
  /** Builds asked for this visit (a budget per seat, so ten players cannot keep the designer to themselves). */
  builds?: number;
  /** Not before this: F (fix your own build), E (go in / use what is here). */
  fixAt?: number;
  useAt?: number;
  /** The knockout the page was last told about (its `until`), so it is told once. */
  koTold?: number;
}

export const PLAYER = {
  walk: 3.4,
  run: 7,
  /** The distance budget: at most this many seconds of top speed in one go (a laggy page catching up). */
  budgetS: 1,
  /** Slack on top of the budget (metres): rounding, a frame or two. */
  slack: 0.3,
  sayGapMs: 1200,
  buildGapMs: 8000,
  /** Builds a player may ask for in one visit (edits and removals are not counted). */
  sessionBuilds: 6,
  fixGapMs: 20_000,
  /** How long the speed trail runs back (ms). */
  trailMs: 500,
};

export const pilots = new Map<string, Pilot>();
export const isPiloted = (id: string) => pilots.has(id);

export function pilot(id: string, name: string, at: GroundPoint, now: number): Pilot {
  let p = pilots.get(id);
  if (!p) {
    p = { name, since: now, lastInputAt: now, moving: false, running: false, clock: { offset: NaN, last: 0, lastNow: 0 }, sayAt: 0, buildAt: 0, last: { at: now, x: at.x, z: at.z } };
    pilots.set(id, p);
  }
  p.name = name;
  return p;
}

/** The page's own stamp turned into server time, like the Mayor's (mayor.ts `stampOf`), one clock per player. */
export function stampOf(p: Pilot, at: unknown, now: number): number {
  const c = p.clock;
  if (typeof at !== 'number' || !Number.isFinite(at)) return now;
  const sample = now - at;
  c.offset = Number.isNaN(c.offset) ? sample : Math.min(sample, c.offset + (now - c.lastNow) * 0.002);
  c.lastNow = now;
  const t = Math.max(c.last + 1, Math.min(now, Math.max(now - 1000, at + c.offset)));
  c.last = t;
  return t;
}

/**
 * Where a step may land: as far as their distance budget goes, no further. The budget refills at top
 * speed and holds a second's worth, so a page that stalls and catches up in one step is fine, but
 * forty small steps a second each claiming slack add up to nothing extra.
 */
export function allowedStep(p: Pilot, to: GroundPoint, at: number, speed = PLAYER.run): GroundPoint {
  const last = p.last;
  if (!last) return to;
  const cap = speed * PLAYER.budgetS;
  const dt = Math.max(0, Math.min(PLAYER.budgetS, (at - last.at) / 1000));
  // The slack may be borrowed, never given twice: going over leaves the budget owing it.
  const budget = Math.min(cap, (p.budget ?? cap) + speed * dt);
  const allowed = Math.max(0, budget + PLAYER.slack);
  const dx = to.x - last.x,
    dz = to.z - last.z;
  const d = Math.hypot(dx, dz);
  if (d <= allowed) {
    p.budget = budget - d;
    return to;
  }
  p.budget = -PLAYER.slack;
  return { x: last.x + (dx / d) * allowed, z: last.z + (dz / d) * allowed };
}

/** Remember an accepted step: the speed trail, and the run-up toward the next ram. */
export function stepped(p: Pilot, at: number, to: GroundPoint): void {
  const last = p.last;
  if (last) p.travel = Math.min(100, (p.travel ?? 0) + Math.hypot(to.x - last.x, to.z - last.z));
  const trail = (p.trail ??= []);
  trail.push({ at, x: to.x, z: to.z });
  while (trail.length > 2 && at - trail[0].at > PLAYER.trailMs) trail.shift();
}

/** How fast they have really been going lately (m/s), from the steps the server accepted. */
export function trailSpeed(p: Pilot, now: number): number {
  const trail = (p.trail ?? []).filter((s) => now - s.at <= PLAYER.trailMs + 250);
  if (trail.length < 2) return 0;
  const a = trail[0],
    b = trail[trail.length - 1];
  const dt = Math.max(0.1, (b.at - a.at) / 1000);
  let d = 0;
  for (let i = 1; i < trail.length; i++) d += Math.hypot(trail[i].x - trail[i - 1].x, trail[i].z - trail[i - 1].z);
  return d / dt;
}

/** Standing inside a build (with a little give, so a page a frame out of step is not refused). */
function inside(objects: readonly SafehouseObject[], p: GroundPoint, skip?: string): boolean {
  for (const o of objects) {
    // Things that go about are drawn a moment behind on the page: never a wall here.
    if (o.passable || o.creature || o.blueprint.moves || o.destroyedAt !== undefined || o.id === skip) continue;
    const at = o.driven?.at ?? o.position;
    if (Math.abs(p.x - at.x) < o.footprint.width / 2 - 0.15 && Math.abs(p.z - at.z) < o.footprint.depth / 2 - 0.15) return true;
  }
  return false;
}

/**
 * Builds are solid on the server too: a step that ends inside one slides along it (as the page does)
 * or stays put. Someone already inside one (it went up round them) may walk out.
 */
export function solidStep(objects: readonly SafehouseObject[], from: GroundPoint, to: GroundPoint, skip?: string): GroundPoint {
  if (!inside(objects, to, skip) || inside(objects, from, skip)) return to;
  const slideX = { x: to.x, z: from.z };
  if (!inside(objects, slideX, skip)) return slideX;
  const slideZ = { x: from.x, z: to.z };
  if (!inside(objects, slideZ, skip)) return slideZ;
  return { ...from };
}
