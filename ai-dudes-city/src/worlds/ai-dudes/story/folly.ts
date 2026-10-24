// The head's Folly (FK-023): one per age on STORY_SITES.folly, under wraps behind its cordon, filling
// on a timer (`city.story.folly`) with the gold side's names on its plaque until the Unveiling.
//
// Raising the cordon (Story (dev) now, the Intro's beat later) stands the age's Folly on its plot as
// one civic build with `folly` and `silhouette` set: the design from design/spec/folly/<age>.json
// (FK-007), or the age's catalogue hut as a stand-in until it lands. Never designed live (bible §9).
// `silhouette` already means "under wraps": breakable(), the agents' nearby builds and the idle hooks
// skip it, and the page draws it dark until FK-024's tarp. The bar fills on its own in FOLLY.fillMs,
// so Sami's beat never waits on gold helpers. The Unveiling's `unveil` beat (FK-025) takes the tarp
// off; after that it is still unbreakable (damage.ts) and never restyled (city.ts queueRestyles).
// While Story is on its plot and the crowd's ring take no build (sim.ts reserved()). Story OFF takes
// it off the map (and its lines off the feed) and Story ON puts it back, unveiled or not as the save
// says, so Story OFF is today's town. Zero AI.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { WorldCtx } from '../../../engine/world';
import { AGE_IDS } from '../../../shared/ages';
import { PITCH, type PlotInfo } from '../../../shared/city';
import type { TownView } from '../../../shared/dudesTypes';
import { contains, footprint, overlaps } from '../../../shared/layout';
import type { Blueprint, SafehouseObject, Vec3 } from '../../../shared/objectTypes';
import { STORY_SITES } from '../../../shared/storyMap';
import { blueprintBounds, blueprintSchema, fitBlueprint, measureBlueprint } from '../blueprint';
import { ageOf, cityOf, headName, stampAge } from '../city';
import { choosePlacement, workSpots } from '../placement';
import { isActive, reserved } from '../sim';
import { LIMITS, STORY_CAPS, nextId, pushFeed, storyOn, type Dude, type DudesState, type Story } from '../state';

export const FOLLY = {
  /** Its plot's id, as WONDER.plot is the Wonder's: never handed out, never in allPlots. */
  plot: 'folly',
  /** From the cordon to 100% on its own: the bible has the cordon up at ~0:05 and the Unveiling at ~0:45. */
  fillMs: 40 * 60_000,
  /** The box a Folly is fitted to (FK-007 designs to it): a metre inside the 16 m plot all round, for the cordon. */
  box: { width: 14, depth: 14, height: 11 },
};

/** Each age's Folly (the bible, §3): what the town calls it, and its one word on the Board. */
export const FOLLIES: readonly { name: string; word: string }[] = [
  { name: 'The Big Hut', word: 'BIG HUT' },
  { name: 'The Golden Me', word: 'GOLDEN ME' },
  { name: 'The Royal Moat', word: 'MOAT' },
  { name: 'The Bust Works', word: 'BUST WORKS' },
  { name: "The Members' Golf Course", word: 'GOLF COURSE' },
  { name: 'One Seat', word: 'ONE SEAT' },
];
const follyName = (age: number) => (FOLLIES[age] ?? FOLLIES[0]).name;

/** The Folly's plot as a lot, for placing (as wonderLot is the Wonder's): never handed out, never in allPlots. */
export const follyLot = (): PlotInfo => {
  const s = STORY_SITES.folly;
  const front = { x: Math.round(Math.sin(s.facing)), z: Math.round(Math.cos(s.facing)) };
  return {
    id: FOLLY.plot,
    bx: Math.round(s.at.x / PITCH),
    bz: Math.round(s.at.z / PITCH),
    sx: 0,
    sz: 0,
    front,
    centre: { ...s.at },
    rect: { ...s.rect },
    address: "the band's old camp",
    sign: { x: s.at.x + (front.x * s.size) / 2, z: s.at.z + (front.z * s.size) / 2 },
    civic: true,
    rank: -1,
  };
};

// ---- the design ----------------------------------------------------------------------------------
const SPEC = path.join(import.meta.dirname, '..', '..', '..', '..', 'design', 'spec');
/** If neither file reads: a plain hut with a small door, so the cordon always has something under it. */
const STAND_IN: Blueprint = {
  name: FOLLIES[0].name,
  description: 'Under wraps.',
  parts: [
    { shape: 'cylinder', position: [0, 2.5, 0], size: [10, 5, 10], rotation: [0, 0, 0], color: '#8a6a48' },
    { shape: 'cone', position: [0, 7.5, 0], size: [12, 5, 12], rotation: [0, 0, 0], color: '#c9a66b' },
    { shape: 'box', position: [0, 0.5, 5], size: [0.6, 1, 0.3], rotation: [0, 0, 0], color: '#2b2018' },
  ],
};
const designs = new Map<number, Blueprint>();
/** The age's Folly as designed (FK-007's design/spec/folly/<age>.json), else the age's catalogue hut, as big as FOLLY.box allows. */
export function follyBlueprint(age: number): Blueprint {
  let bp = designs.get(age);
  if (!bp) designs.set(age, (bp = designed(age)));
  return structuredClone(bp);
}
function designed(age: number): Blueprint {
  const id = AGE_IDS[age] ?? AGE_IDS[0];
  for (const file of [path.join(SPEC, 'folly', `${id}.json`), path.join(SPEC, id, 'home.json')]) {
    try {
      const spec = JSON.parse(readFileSync(file, 'utf8')) as { description?: string; parts: Blueprint['parts']; animations?: unknown };
      // Only what a part is: the board's extras (glow, hero tags) stay on the board.
      const parts = spec.parts.slice(0, 160).map(({ shape, position, size, rotation, color }) => ({ shape, position, size, rotation, color }));
      const base = { name: follyName(age), description: String(spec.description ?? '').slice(0, 240), parts };
      const moving = blueprintSchema.safeParse({ ...base, animations: spec.animations });
      return toBox(moving.success ? moving.data : blueprintSchema.parse(base));
    } catch {
      // Not there yet, not a design, or too big to fit: the next one.
    }
  }
  return toBox({ ...structuredClone(STAND_IN), name: follyName(age) });
}
/** Centred, on the ground, and scaled (down, or up: a stand-in hut comes up to Folly size) to fill FOLLY.box. */
function toBox(bp: Blueprint): Blueprint {
  const out = fitBlueprint(bp, FOLLY.box).blueprint;
  const b = blueprintBounds(out);
  const lo = Math.min(0, b.minY);
  const grow = Math.min(FOLLY.box.width / (2 * Math.max(-b.minX, b.maxX)), FOLLY.box.depth / (2 * Math.max(-b.minZ, b.maxZ)), FOLLY.box.height / (b.maxY - lo)) * (1 - 1e-6);
  if (grow > 1)
    for (const p of out.parts) {
      p.position = [p.position[0] * grow, (p.position[1] - lo) * grow, p.position[2] * grow] as Vec3;
      p.size = p.size.map((v) => v * grow) as Vec3;
    }
  return out;
}

// ---- the cordon ----------------------------------------------------------------------------------
type Folly = NonNullable<Story['folly']>;
/** This age's Folly count and plaque, once its cordon has gone up. */
export const follyNow = (state: DudesState): Folly | undefined => {
  const f = state.city?.story?.folly;
  return f && f.age === ageOf(state) ? f : undefined;
};
/** The age's Folly standing in town (under wraps or not). */
export const follyOf = (state: DudesState, age = ageOf(state)): SafehouseObject | undefined => state.objects.find((o) => o.folly === AGE_IDS[age]);

/** Raise the cordon: the age's Folly goes up under wraps on its plot, at 0%. Or says why not, and changes nothing. */
export function raiseFolly(state: DudesState, now: number): string | undefined {
  if (!storyOn(state)) return 'Story is off';
  const age = ageOf(state);
  const up = follyOf(state, age);
  if (up) return `The cordon is already up: ${up.blueprint.name} ${up.silhouette ? 'is under wraps' : 'stands unveiled'}`;
  if (state.objects.length >= LIMITS.objects) return 'The town is full: no room for the Folly';
  const story = (cityOf(state).story ??= {});
  // A new age's Folly starts from nothing; this age's, put back up (after the head took it down), keeps
  // its count and plaque, and goes up under wraps for another Unveiling.
  if (story.folly?.age !== age) story.folly = { age, pct: 0, startedAt: now, plaque: [] };
  delete story.folly.unveiled;
  standFolly(state, age, now);
  pushFeed(state, now, `${headName(state)}'s cordon goes up by the old camp: KEEP OUT. SOMETHING AMAZING.`);
  return undefined;
}

/** Set how far the Folly is (0..100), from Story (dev). The timer carries on from there. */
export function setFollyProgress(state: DudesState, pct: number): string | undefined {
  if (!storyOn(state)) return 'Story is off';
  const f = follyNow(state);
  if (!f) return 'No cordon in this age yet: raise it first';
  if (!Number.isFinite(pct)) return 'A percentage, 0 to 100';
  f.pct = Math.max(0, Math.min(100, pct));
  return undefined;
}

/** The `unveil` beat (FK-025): the tarp comes off, and the Folly is done. It still takes no damage (damage.ts). */
export function unveilFolly(state: DudesState, now: number): string | undefined {
  if (!storyOn(state)) return 'Story is off';
  const o = follyOf(state);
  if (!o) return 'No Folly stands in this age: raise the cordon first';
  if (!o.silhouette) return `${o.blueprint.name} is already unveiled`;
  delete o.silhouette;
  const f = follyNow(state);
  // Saved, so a restart with Story off brings it back unveiled, with its plaque closed.
  if (f) Object.assign(f, { pct: 100, unveiled: true });
  state.worldRevision++;
  pushFeed(state, now, `${headName(state)} unveils ${o.blueprint.name}!`);
  return undefined;
}

/** The tarp back over the Folly, for another Unveiling (Story (dev)). Its count and plaque stay. */
export function retarpFolly(state: DudesState): string | undefined {
  if (!storyOn(state)) return 'Story is off';
  const o = follyOf(state);
  if (!o) return 'No Folly stands in this age: raise the cordon first';
  if (o.silhouette) return `${o.blueprint.name} is already under wraps`;
  o.silhouette = true;
  const f = follyNow(state);
  if (f) delete f.unveiled;
  state.worldRevision++;
  return undefined;
}

/** The age's Folly as a build on its plot (under wraps, but for one unveiled before a restart), with room made for it. */
function standFolly(state: DudesState, age: number, now: number, unveiled = false): SafehouseObject {
  const lot = follyLot();
  const blueprint = follyBlueprint(age);
  const o: SafehouseObject = {
    id: nextId(state, 'b'),
    revision: 1,
    blueprint,
    position: { ...lot.centre },
    footprint: measureBlueprint(blueprint, FOLLY.box),
    createdBy: headName(state),
    editedBy: headName(state),
    createdAt: now,
    civic: true,
    folly: AGE_IDS[age],
    ...(unveiled ? {} : { silhouette: true }),
  };
  stampAge(state, o);
  makeRoom(state, o, now);
  state.objects.push(o);
  state.worldRevision++;
  return o;
}
/**
 * Room on the plot: an earlier age's Folly on the same spot comes down (FK-079 gives each age a spot
 * of its own), anything else standing there, or on its way up there, moves to the nearest free ground
 * (it can only be there from before Story was on), and nobody is left standing inside.
 */
function makeRoom(state: DudesState, folly: SafehouseObject, now: number): void {
  const plot = follyLot().rect;
  for (const x of state.objects.filter((o) => !o.passable && overlaps(footprint(o.driven?.at ?? o.position, o.footprint.width, o.footprint.depth), plot))) {
    if (x.folly) {
      state.objects = state.objects.filter((o) => o !== x);
      pushFeed(state, now, `${x.blueprint.name} comes down to make way for ${folly.blueprint.name}`);
      continue;
    }
    try {
      const to = choosePlacement(x.footprint, state.objects.filter((o) => o !== x), x.driven?.at ?? x.position, [...reserved(state), plot]);
      x.position = to;
      if (x.driven) x.driven = { ...x.driven, at: to };
    } catch {
      // Nowhere free in town: it stays where it is.
    }
  }
  // An off-lot build in flight, placed on the plot while Story was off: new ground, and its builder starts over there.
  for (const j of state.jobs.filter((j) => j.kind === 'build' && !j.plot && j.position && j.footprint && isActive(j))) {
    if (!overlaps(footprint(j.position!, j.footprint!.width, j.footprint!.depth), plot)) continue;
    try {
      j.position = choosePlacement(j.footprint!, state.objects, j.position!, [...reserved(state, j.id), plot]);
      if (j.status === 'walking' || j.status === 'building') j.status = 'ready';
    } catch {
      // Nowhere free in town: it goes up where it was placed.
    }
  }
  const inside = footprint(folly.position, folly.footprint.width + 0.6, folly.footprint.depth + 0.6);
  for (const d of state.dudes)
    if (contains(inside, d.position)) {
      const out = workSpots(folly.position, folly.footprint, d.position)[0];
      if (out) d.position = out;
      d.path = [];
    }
  state.worldRevision++;
}

// ---- the tick: the switch, the timer, the plaque ---------------------------------------------------
/** Story's last state seen by the tick, and the Follies Story OFF took off the map (back as they were at Story ON). */
const wasOn = new WeakMap<DudesState, boolean>();
const stowed = new WeakMap<DudesState, SafehouseObject[]>();

/** Every tick (city.ts tickCity): the Folly follows the Story switch, fills on its timer and carves gold's names. */
export function tickFolly(state: DudesState, dt: number, now: number): void {
  const on = storyOn(state);
  const was = wasOn.get(state);
  wasOn.set(state, on);
  if (!on) {
    if (state.objects.some((o) => o.folly)) stow(state);
    return;
  }
  if (was === false) unstow(state, now);
  const f = follyNow(state);
  // Unveiled (or taken down): its count and its plaque are done.
  if (!f || f.unveiled || !follyOf(state)?.silhouette) return;
  if (f.pct < 100) {
    const next = f.pct + (dt / FOLLY.fillMs) * 100;
    // Thousands of small steps add up a hair short of the end: within a nanopercent is full.
    f.pct = next > 100 - 1e-9 ? 100 : next;
  }
  carve(state, f);
}
/** The Folly's own feed lines (the cordon going up, the unveil, an earlier Folly making way): Story OFF takes them off, so its feed is today's. */
const NAMES = FOLLIES.map((f) => f.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
const FEED_LINES = new RegExp(`'s cordon goes up by the old camp: KEEP OUT\\. SOMETHING AMAZING\\.$| unveils (${NAMES})!$|^(${NAMES}) comes down to make way for (${NAMES})$`);
/** Story OFF: every Folly off the map and its lines off the feed (its count, plaque and unveiling stay in the save). */
function stow(state: DudesState): void {
  stowed.set(state, [...(stowed.get(state) ?? []), ...state.objects.filter((o) => o.folly)]);
  state.objects = state.objects.filter((o) => !o.folly);
  state.feed = state.feed.filter((l) => !FEED_LINES.test(l.text));
  state.worldRevision++;
}
/**
 * Story ON again: the Follies come back as they were. After a restart with Story off nothing was kept,
 * so this age's goes back up from its count and plaque, unveiled if it was. Not into a full town
 * (the save refuses more than LIMITS.objects): the next Story ON tries again.
 */
function unstow(state: DudesState, now: number): void {
  const back = stowed.get(state) ?? [];
  stowed.delete(state);
  for (const o of back) {
    if (state.objects.length >= LIMITS.objects) break;
    makeRoom(state, o, now);
    state.objects.push(o);
  }
  const f = follyNow(state);
  if (f && !follyOf(state) && state.objects.length < LIMITS.objects) standFolly(state, f.age, now, f.unveiled);
  state.worldRevision++;
}

const plaqueName = (d: Dude) => d.name.slice(0, 40);
/** Gold's names onto the plaque, first joiners first (by the sides' log), up to its cap: the first carved stay. */
function carve(state: DudesState, f: Folly): void {
  if (f.plaque.length >= STORY_CAPS.plaque) return;
  const gold = state.dudes.filter((d) => d.side === 'gold' && (d.sideAge ?? f.age) === f.age);
  if (!gold.length) return;
  const carved = new Set(f.plaque.map((n) => n.toLowerCase()));
  const fresh = gold.filter((d) => !carved.has(plaqueName(d).toLowerCase()));
  if (!fresh.length) return;
  // When each joined gold (the latest time, if they crossed back); anyone the log has lost goes last.
  const joined = new Map<string, number>();
  for (const e of state.city?.story?.sideLog ?? []) if (e.side === 'gold') joined.set(e.id, e.at);
  fresh.sort((a, b) => (joined.get(a.id) ?? Infinity) - (joined.get(b.id) ?? Infinity));
  for (const d of fresh.slice(0, STORY_CAPS.plaque - f.plaque.length)) f.plaque.push(plaqueName(d));
}

// ---- the page and Story (dev) ----------------------------------------------------------------------
/** The Folly on the page (`folly`: how far, whole percent, so the bar only reads 100 when it is; the plaque). */
export function follyView(state: DudesState, _now: number): Partial<TownView> {
  const f = follyNow(state);
  return f ? { folly: { pct: Math.floor(f.pct), plaque: [...f.plaque] } } : {};
}

type Run = (ctx: WorldCtx<DudesState>, value?: number | string) => void | string;
/** Story (dev)'s Folly buttons (story/dev.ts calls these at the press, not at load: the modules import each other): each does it and logs, or says why not. */
export const FOLLY_DEV: Record<'folly-raise' | 'folly-progress' | 'folly-retarp', Run> = {
  'folly-raise': (ctx) => {
    const why = raiseFolly(ctx.state, ctx.now);
    if (!why) ctx.log(`story: the cordon is up (admin, Story (dev)): ${follyOf(ctx.state)!.blueprint.name} under wraps, full in ${FOLLY.fillMs / 60_000} min`);
    return why;
  },
  'folly-progress': (ctx, value) => {
    const why = setFollyProgress(ctx.state, Number(value));
    if (!why) ctx.log(`story: the Folly is at ${Math.floor(follyNow(ctx.state)!.pct)}% (admin, Story (dev))`);
    return why;
  },
  'folly-retarp': (ctx) => {
    const why = retarpFolly(ctx.state);
    if (!why) ctx.log(`story: ${follyOf(ctx.state)!.blueprint.name} is under wraps again (admin, Story (dev))`);
    return why;
  },
};
