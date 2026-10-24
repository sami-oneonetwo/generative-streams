// The town. Everyone who turns up gets a lot of their own (shared/city.ts lays them out), builds on
// it, and what they build is for something: a home, a café, a club. People go out on their own when
// they need to (needs run down; a low one sends them to the best place in town for it, preferably
// somebody else's), pay the owner, and the owner hears about it, even when they were away. The
// town's own residents keep places busy when chat is quiet, and gossip about what is popular. Big
// things for everyone (a pool, a station) are community projects on the square: designed first so
// everyone can see the ghost, then paid for and built together, with a grand opening. Zero AI here:
// the agents only pick what to do; every number, price and outcome is the app's.
import { footprint } from '../../shared/layout';
import type { GroundPoint, SafehouseObject } from '../../shared/objectTypes';
import {
  BUS_STOP,
  CITY,
  LAYOUT,
  DISTRICT_NAMES,
  NEEDS,
  SQUARE,
  VENUES,
  WONDER,
  allPlots,
  blockKey,
  homePlots,
  moodOf,
  plotAt,
  plotById,
  projectPlots, // hook FK-077: community projects keep to the square's west half
  venueKindOf,
  type Need,
  type Needs,
  type PlotInfo,
  type VenueKind,
  type VenueSpec,
} from '../../shared/city';
import type { DudeLook, DudeView, Emote, HappeningView, TownView } from '../../shared/dudesTypes';
import { MODERN, NO_AGE, SANDBOX_DESIGN, ageStyle, clampAge, dressFor, venueName } from '../../shared/ages';
import { BRIDGE_ROAD, BRIDGE_SHIFT_MS, volunteer, bridgeHelped, bridgeOpen, bridgeProgress, bridgeSpot, caravanLine, caravanOf, caravanSaw, caravanView, daughterTitle, sceneView, tickCaravan } from './caravan';
import { BRIDGE, FACING_TOWN } from '../../shared/scenes';
import { blueprintBounds, fitBlueprint, interactionOf, measureBlueprint } from './blueprint';
import { defaultLook, hashOf } from './agent';
import { choosePlacement, clampToGround, route, workSpots } from './placement';
import { addEffect, awake, endUse, face, reserved, step, walkTo } from './sim';
import { moversNear } from './movers';
import { credit } from './crier';
import { LIMITS, nextId, pushFeed, pushLine, type City, type Dude, type DudesState, type Ledger, type Project, type Tie, type Townie, type Visit } from './state';
import { storyTownView } from './story/view'; // FK-001

export const TOWN = {
  startCoins: 150,
  /** Odd jobs: every awake character earns this much a minute, so nobody stays broke. */
  oddJobs: 1,
  shiftMs: 45_000,
  wage: 12,
  /** Needs fall this much a minute while their chatter is around (a fifth of it while away). */
  decay: { hunger: 2, energy: 1.2, fun: 2.4, social: 2.2 } as Needs,
  awayFactor: 0.2,
  /** Nothing bad happens while you are away: needs never fall below this then. */
  awayFloor: 35,
  /** A need under this sends a free character out for it. */
  low: 55,
  /** At least this long between one character's outings of its own. */
  outingGapMs: 25_000,
  apartmentSize: 6,
  feedGapMs: 40_000,
  projectMs: 40 * 60_000,
  /** Labour goes on until the building work is done or they are asked for something else; this is only a cap. */
  labourMs: 5 * 60_000,
  partyMs: 75_000,
  /** How far someone walks to an outing of their own before picking somewhere nearer. */
  reach: 90,
  /** A new look (hat, colours, clothes) from the tailor, after the first one; and the council's fine. Paid as far as they can. */
  lookFee: 10,
  fine: 15,
  /** An empty lot whose owner has been away this many days (and has nothing standing anywhere) goes to the next newcomer (env DUDES_LOT_RECLAIM_DAYS). */
  reclaimDays: Number(process.env.DUDES_LOT_RECLAIM_DAYS) > 0 ? Number(process.env.DUDES_LOT_RECLAIM_DAYS) : 14,
};

const TOWN_NAMES = ['Larkhaven', 'Puddleby', 'Little Hollow', 'New Bramley', 'Sunnymead', 'Kettlewick', 'Applecross', 'Fernley Green'];
const TOWNIE_NAMES = ['Mrs Okafor', 'Old Tom', 'Priya', 'Dev', 'Nana Rose', 'Mr Lindqvist', 'Wren', 'Bao', 'Auntie Mags', 'Felix', 'Signora Bassi', 'Kwame', 'Ivy', 'Mr Patel', 'June', 'Rafa'];

const dist = (a: GroundPoint, b: GroundPoint) => Math.hypot(a.x - b.x, a.z - b.z);
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export function cityOf(state: DudesState): City {
  return (state.city ??= {
    name: TOWN_NAMES[hashOf(`town:${state.createdAt}`) % TOWN_NAMES.length],
    layout: LAYOUT,
    plots: {},
    done: [],
    stats: {},
    townies: [],
    unmet: {},
    nextProjectId: 1,
    age: 0,
  });
}

/** The age the town lives in (shared/ages.ts). A new town starts in the Stone Age; a save from before ages keeps the look it had, the Modern age. */
export function ageOf(state: DudesState): number {
  const c = cityOf(state);
  return (c.age ??= state.objects.some((o) => !o.fixed) ? MODERN : 0);
}
/** Into another age at once (the operator's control; the wave comes later). Everything is drawn the new age's way from the next snapshot. */
export function setAge(state: DudesState, age: number, now: number): void {
  const c = cityOf(state);
  const next = clampAge(age);
  if (next === ageOf(state)) return;
  c.age = next;
  queueRestyles(state);
  state.worldRevision++;
  pushFeed(state, now, `${c.name} is in ${ageStyle(next).name} now`);
}
/** Every build not made in the town's age goes in the queue to be remade for it (the town's design pump takes them one at a time). */
export function queueRestyles(state: DudesState): void {
  const age = ageOf(state);
  // The town's own landmarks keep the look of the age they were raised in: a Wonder (and any community
  // project) is a piece of that age's history, so only people's builds are remade.
  cityOf(state).restyle = { age, ids: state.objects.filter((o) => !o.wild && !o.civic && o.wonder === undefined && originOf(o) !== age).map((o) => o.id) };
}

/** What the streamer's character is called in this age: "The Chief". */
/** The age themes are on (off: the theme-free sandbox world, admin). */
export const themed = (state: DudesState) => state.ai.themes !== false;
/** The age things are named in: the town's, or everyday names in the sandbox. */
export const namingAge = (state: DudesState) => (themed(state) ? ageOf(state) : MODERN);
/** A build's own age for the restyles: made in the sandbox is in none. */
export const originOf = (o: SafehouseObject) => (o.free ? NO_AGE : (o.age ?? MODERN));
/** Stamp a build (new or redesigned) with how it was made now: in the town's age, or in no age in the sandbox. */
export function stampAge(state: DudesState, o: SafehouseObject): SafehouseObject {
  if (themed(state)) {
    o.age = ageOf(state);
    delete o.free;
  } else {
    o.free = true;
    delete o.age;
  }
  return o;
}
/** The design call's direction: how the town's age makes things, or the sandbox's anything-goes. */
export const designDirection = (state: DudesState) => (themed(state) ? ageStyle(ageOf(state)).design : SANDBOX_DESIGN);
/** What someone wears: the age's clothes over their own colours, or just their own in the sandbox. */
export const dressed = (state: DudesState, look: DudeLook, who: Parameters<typeof dressFor>[2]): DudeLook => (themed(state) ? dressFor(look, ageOf(state), who) : look);
export const headName = (state: DudesState): string => state.mayor?.title ?? `The ${ageStyle(namingAge(state)).head.title}`;

export const coinsOf = (d: Dude) => d.coins ?? TOWN.startCoins;
/** Coins that leave town (a fine, a new look): what they can pay of it, floated up in red over them. Returns what was paid. */
export function spend(state: DudesState, d: Dude, amount: number, now: number): number {
  const paid = Math.max(0, Math.min(Math.floor(amount), coinsOf(d)));
  if (!paid) return 0;
  d.coins = coinsOf(d) - paid;
  addEffect(state, { kind: 'coins', at: now, to: { ...d.position }, amount: -paid });
  return paid;
}
export function needsOf(d: Dude): Needs {
  return (d.needs ??= { hunger: 70, energy: 80, fun: 65, social: 60 });
}
/** A fresh arrival's needs: a little different for everyone, so they do not all get hungry at once. */
export function freshNeeds(rng: () => number): Needs {
  return { hunger: 55 + Math.round(rng() * 35), energy: 70 + Math.round(rng() * 30), fun: 50 + Math.round(rng() * 35), social: 50 + Math.round(rng() * 35) };
}

// ---- lots -----------------------------------------------------------------------------------
/** The lot this character owns, if any. */
export const ownLot = (state: DudesState, d: Dude): PlotInfo | undefined => (d.plot && cityOf(state).plots[d.plot]?.owner === d.id ? plotById(d.plot) : undefined);
/** Every lot this character may build on: their own and the ones a friend gave them a key to. */
export function lotsOf(state: DudesState, d: Dude): PlotInfo[] {
  const c = cityOf(state);
  return Object.entries(c.plots)
    .filter(([, claim]) => claim.owner === d.id || claim.coOwners.includes(d.id))
    .map(([id]) => plotById(id)!)
    .filter(Boolean)
    .sort((a, b) => (c.plots[a.id].owner === d.id ? -1 : 0) - (c.plots[b.id].owner === d.id ? -1 : 0));
}
export function ownerOfLot(state: DudesState, plotId: string | undefined): Dude | undefined {
  const claim = plotId ? cityOf(state).plots[plotId] : undefined;
  return claim ? state.dudes.find((d) => d.id === claim.owner) : undefined;
}
export const freeLots = (state: DudesState) => homePlots().filter((p) => !cityOf(state).plots[p.id]);

/** Hand a newcomer the next free lot (block by block from the bridge, shared/city.ts BLOCK_ORDER). Undefined when the town is full. */ // hook FK-075
export function claimLot(state: DudesState, d: Dude, now: number): PlotInfo | undefined {
  const own = ownLot(state, d);
  if (own) return own;
  // An empty one first: anyone can build on a free lot, so some have builds on them already.
  const free = freeLots(state);
  const lot = free.find((l) => !state.objects.some((o) => o.plot === l.id)) ?? free[0] ?? reclaimLot(state, now);
  if (!lot) return undefined;
  cityOf(state).plots[lot.id] = { owner: d.id, coOwners: [], claimedAt: now };
  d.plot = lot.id;
  d.rentsAt = undefined;
  // The neighbours on the same block hear about it.
  for (const n of neighboursOf(state, lot)) tell(state, n, `${d.name} moved in next door, at ${lot.address}`, now);
  return lot;
}
/**
 * The town is full: an empty lot comes back from someone long gone. Its owner has been away at least
 * `TOWN.reclaimDays` (or is no longer in town at all), has nothing standing anywhere, and nothing
 * stands on the lot or is on its way there. The longest-gone first. Released here; undefined when none.
 */
export function reclaimLot(state: DudesState, now: number): PlotInfo | undefined {
  const c = cityOf(state);
  const cutoff = now - TOWN.reclaimDays * 24 * 60 * 60_000;
  const gone = Object.entries(c.plots)
    .map(([id, claim]) => ({ id, claim, owner: state.dudes.find((x) => x.id === claim.owner) }))
    .filter(({ id, claim, owner }) => {
      if (owner ? owner.lastHeardAt > cutoff : claim.claimedAt > cutoff) return false;
      if (owner && state.objects.some((o) => o.owner === owner.id)) return false;
      if (state.objects.some((o) => o.plot === id) || state.jobs.some((j) => j.plot === id && j.status !== 'done' && j.status !== 'failed')) return false;
      return !!plotById(id) && !plotById(id)!.civic;
    })
    .sort((a, b) => (a.owner?.lastHeardAt ?? a.claim.claimedAt) - (b.owner?.lastHeardAt ?? b.claim.claimedAt))[0];
  if (!gone) return undefined;
  const lot = plotById(gone.id)!;
  releaseLot(state, gone.id);
  if (gone.owner) tell(state, gone.owner, `your empty lot at ${lot.address} went to a newcomer while you were away; you can still build on any lot with room (say where), or ask a friend to share theirs`, now);
  return lot;
}
/** Owners of the other lots on the same block. */
export function neighboursOf(state: DudesState, lot: PlotInfo): Dude[] {
  const c = cityOf(state);
  return allPlots()
    .filter((p) => p.id !== lot.id && p.bx === lot.bx && p.bz === lot.bz && c.plots[p.id])
    .map((p) => state.dudes.find((d) => d.id === c.plots[p.id].owner))
    .filter((d): d is Dude => !!d);
}
/** Give the lot back (operator, or a character's removal): its builds stay until someone clears them. */
export function releaseLot(state: DudesState, plotId: string): void {
  const c = cityOf(state);
  const claim = c.plots[plotId];
  if (!claim) return;
  delete c.plots[plotId];
  for (const d of state.dudes) if (d.plot === plotId) d.plot = undefined;
}
/** A friend gets a key: they can build on your lot too. */
export function shareLot(state: DudesState, owner: Dude, friend: Dude, now: number): string | undefined {
  const lot = ownLot(state, owner);
  if (!lot) return 'you have no lot of your own to share';
  const claim = cityOf(state).plots[lot.id];
  if (friend.id === owner.id) return 'it is already yours';
  if (claim.coOwners.includes(friend.id)) return `${friend.name} already has a key to your lot`;
  if (claim.coOwners.length >= 6) return 'your lot already has six people with keys';
  claim.coOwners.push(friend.id);
  tell(state, friend, `${owner.name} gave you a key to their lot at ${lot.address}: you can build there too`, now, true);
  pushFeed(state, now, `${owner.name} and ${friend.name} share ${lot.address} now`);
  return undefined;
}

/** Someone with no lot (the town is full) gets a flat in whichever apartment block has room. */
export function findFlat(state: DudesState, d: Dude): SafehouseObject | undefined {
  const blocks = state.objects.filter((o) => o.venue === 'apartments');
  const tenants = (o: SafehouseObject) => state.dudes.filter((x) => x.rentsAt === o.id).length;
  return blocks.filter((o) => tenants(o) < TOWN.apartmentSize && o.owner !== d.id).sort((a, b) => tenants(a) - tenants(b))[0];
}

// ---- places ---------------------------------------------------------------------------------
export interface Place {
  id: string; // a build's id, or `town:<id>`
  name: string;
  kind: VenueKind | 'town';
  spec: VenueSpec;
  at: GroundPoint;
  footprint: { width: number; depth: number };
  owner?: string; // dude id
  ownerName?: string;
  plot?: string;
  civic?: boolean;
}
/** The square's own places: always there, so nobody is ever stuck with nowhere to go. */
const TOWN_PLACES: Place[] = [
  {
    id: 'town:fountain',
    name: 'the fountain',
    kind: 'town',
    spec: { label: 'fountain', gives: { fun: 20, social: 25, energy: 5 }, price: 0, visit: 'sit', visitMs: 15_000, verb: 'sat by' },
    at: { x: SQUARE.fountain.x, z: SQUARE.fountain.z },
    footprint: { width: SQUARE.fountain.r * 2, depth: SQUARE.fountain.r * 2 },
  },
  {
    id: 'town:market',
    name: 'the market stall',
    kind: 'town',
    spec: { label: 'market stall', gives: { hunger: 35, social: 5 }, price: 4, visit: 'look', visitMs: 10_000, verb: 'grabbed a bite at' },
    at: { x: SQUARE.market.x, z: SQUARE.market.z },
    footprint: { width: SQUARE.market.w, depth: SQUARE.market.d },
  },
];
export function placeOfObject(state: DudesState, o: SafehouseObject): Place | undefined {
  // Something that goes about on its own (a donkey, a car) is not a place anyone visits.
  if (!o.venue || o.destroyedAt !== undefined || o.blueprint.moves) return undefined;
  const owner = o.owner ? state.dudes.find((d) => d.id === o.owner) : undefined;
  // Something you do a thing at (a court, a pool): a visit is doing it. Free unless it is a business.
  const play = interactionOf(o.blueprint);
  const base = VENUES[o.venue];
  const spec: VenueSpec = play
    ? {
        ...base,
        gives: { fun: 40, social: 15, ...(play.pose === 'lift' || play.pose === 'swim' ? { energy: -5 } : {}) },
        price: base.group && base.group !== 'green' && o.venue !== 'decor' ? base.price : 0,
        visit: 'play',
        visitMs: Math.round(Math.max(8, Math.min(24, play.seconds * 1.6)) * 1000),
        verb: `went to ${play.verb} at`,
        pose: play.pose,
        spot: play.spot,
        ...(play.pop ? { pop: play.pop } : {}),
      }
    : base;
  return {
    id: o.id,
    name: o.blueprint.name,
    kind: o.venue,
    spec,
    at: o.driven?.at ?? o.position,
    footprint: o.footprint,
    ...(owner ? { owner: owner.id, ownerName: owner.name } : {}),
    ...(o.plot ? { plot: o.plot } : {}),
    ...(o.civic ? { civic: true } : {}),
  };
}
export function placesOf(state: DudesState): Place[] {
  // The age's Wonder stands where the centrepiece was: it is the place to sit by now.
  const town = wonderOf(state) ? TOWN_PLACES.filter((p) => p.id !== 'town:fountain') : TOWN_PLACES;
  return [...town, ...state.objects.map((o) => placeOfObject(state, o)).filter((p): p is Place => !!p)];
}
export const placeById = (state: DudesState, id: string | undefined): Place | undefined =>
  !id ? undefined : id.startsWith('town:') ? TOWN_PLACES.find((p) => p.id === id) : (() => {
    const o = state.objects.find((x) => x.id === id);
    return o ? placeOfObject(state, o) : undefined;
  })();
export const townPlaceNames = () => TOWN_PLACES.map((p) => p.name);

/** Their home: a home they built (on any lot), a home on a lot they own or share, a flat they rent, or nothing. */
export function homeOf(state: DudesState, d: Dude): Place | undefined {
  // A home they built wherever they built it (anyone can build on any lot), then one on their lots.
  const own = state.objects.find((o) => o.venue === 'home' && o.owner === d.id);
  if (own) return placeOfObject(state, own);
  const lots = lotsOf(state, d).map((l) => l.id);
  const mine = state.objects.filter((o) => (o.venue === 'home' || o.venue === 'apartments') && o.plot && lots.includes(o.plot));
  const pick = mine.find((o) => o.venue === 'home' && o.owner === d.id) ?? mine.find((o) => o.venue === 'home') ?? mine[0];
  if (pick) return placeOfObject(state, pick);
  const flat = d.rentsAt ? state.objects.find((o) => o.id === d.rentsAt) : undefined;
  return flat ? placeOfObject(state, flat) : undefined;
}
/** May this character go in? Homes are for the people who live there; everything else is open. */
export function mayVisit(state: DudesState, d: Dude, p: Place): boolean {
  if (p.kind !== 'home') return true;
  if (p.owner === d.id) return true;
  return !!p.plot && (cityOf(state).plots[p.plot]?.coOwners.includes(d.id) ?? false);
}
const placeFor = (spec: VenueSpec, need: Need) => spec.gives[need] ?? 0;

/**
 * The best place for a need: what it gives, whether it is somebody else's (people's creations are
 * meant to be used: other people's places are preferred), how far, and whether they can pay.
 */
export function bestPlaceFor(state: DudesState, who: { id: string; position: GroundPoint; coins: number }, need: Need, now: number, rng: () => number, d?: Dude): Place | undefined {
  let best: Place | undefined,
    score = 0;
  for (const p of placesOf(state)) {
    const gives = placeFor(p.spec, need);
    if (gives <= 0) continue;
    if (d && !mayVisit(state, d, p)) continue;
    if (!d && (p.kind === 'home' || p.kind === 'apartments')) continue; // residents do not wander into people's homes
    if (p.spec.price > who.coins) continue;
    const far = dist(p.at, who.position);
    if (far > TOWN.reach && p.kind !== 'home') continue;
    // Somebody else's, and more so a friend's (less so someone who keeps knocking your things about).
    const theirs = p.owner && p.owner !== who.id ? 1.35 * (d ? 1 + clamp(warmth(d, p.owner), -5, 10) * 0.04 : 1) : 1;
    const busy = Math.min(5, recentVisits(state, p.id, now)) * 0.04; // a little pull toward what is popular
    const s = gives * theirs * (1 + busy) - far * 0.25 + rng() * 12 - (p.kind === 'town' ? 6 : 0);
    if (s > score) [best, score] = [p, s];
  }
  return best;
}
export function recentVisits(state: DudesState, placeId: string, now: number): number {
  return (cityOf(state).stats[placeId]?.recent ?? []).filter((t) => now - t < 30 * 60_000).length;
}

// ---- visits ---------------------------------------------------------------------------------
/** Start going to a place. Returns a reason when it cannot start. */
export function startVisit(state: DudesState, d: Dude, p: Place, why: Visit['why'], now: number, need?: Need): string | undefined {
  if (!mayVisit(state, d, p)) return `${p.name} is ${p.ownerName ?? 'someone'}'s home; you cannot just walk in (greet them instead)`;
  if (why !== 'work' && p.spec.price > coinsOf(d) && why === 'asked') return `you cannot afford ${p.name} (§${p.spec.price}; you have §${coinsOf(d)})`;
  endUse(state, d, now);
  d.labour = undefined;
  const spots = workSpots(p.at, p.footprint, d.position);
  if (!spots.some((s) => walkTo(state, d, s, 'visit')) && !spots.some((s) => dist(s, d.position) < 0.8)) return `you could not find a way to ${p.name}`;
  d.emote = undefined;
  d.visit = { placeId: p.id, phase: 'going', why, ...(need ? { need } : {}) };
  return undefined;
}

/** On the court, in the pool, at the easel: in place and in the pose, with the first shout. */
type Player = { position: GroundPoint; facing: number; emote?: { pose: Emote; until: number }; y?: number };
function startPlaying(state: DudesState, d: Player, p: Place, v: { until?: number; popAt?: number } | undefined, now: number, until?: number, lift = true): void {
  const end = until ?? v?.until ?? now + 10_000;
  if (p.spec.spot === 'on') {
    // Somewhere on it (not all on one spot), facing its middle; up on top of something small and raised.
    const w = p.footprint.width * 0.3,
      dpt = p.footprint.depth * 0.3;
    d.position = { x: p.at.x + (Math.random() * 2 - 1) * w, z: p.at.z + (Math.random() * 2 - 1) * dpt };
    const o = state.objects.find((x) => x.id === p.id);
    const top = o ? Math.max(0, Math.min(3, blueprintBounds(o.blueprint).maxY)) : 0;
    if (lift) d.y = Math.max(p.footprint.width, p.footprint.depth) < 4 ? top : p.spec.pose === 'swim' ? Math.max(0, top - 0.6) : Math.min(top, 0.25);
  }
  face(d, p.at);
  d.emote = { pose: (p.spec.pose ?? 'cheer') as Emote, until: end };
  if (p.spec.pop) addEffect(state, { kind: 'pop', at: now, to: { ...d.position }, label: p.spec.pop, pose: p.spec.pose });
  if (v) v.popAt = now + 2500 + Math.random() * 2000;
}
export { startPlaying };

/** How far a point is from a place's footprint (0 inside it). */
function gapTo(at: GroundPoint, p: Place): number {
  const dx = Math.max(0, Math.abs(at.x - p.at.x) - p.footprint.width / 2),
    dz = Math.max(0, Math.abs(at.z - p.at.z) - p.footprint.depth / 2);
  return Math.hypot(dx, dz);
}

const POSE: Record<VenueSpec['visit'], 'sit' | 'dance' | 'point' | 'lie' | undefined> = { enter: undefined, sit: 'sit', dance: 'dance', look: 'point', lie: 'lie', play: undefined };

/** One tick of a visit. Returns false when there is none. */
export function runVisit(state: DudesState, d: Dude, now: number): boolean {
  const v = d.visit;
  if (!v) return false;
  const p = placeById(state, v.placeId);
  if (!p) {
    endVisit(d);
    return true;
  }
  if (v.phase === 'going') {
    if (d.path.length) return true;
    d.walkingFor = undefined;
    if (gapTo(d.position, p) > 2.5) {
      endVisit(d);
      pushLine(d.history, { from: 'world', text: `you could not get to ${p.name}`, at: now }, LIMITS.history);
      return true;
    }
    v.phase = 'in';
    const party = v.why === 'party';
    v.until = now + (v.why === 'work' ? TOWN.shiftMs : party ? Math.max(8000, (cityOf(state).party?.until ?? now) - now) : p.spec.visitMs);
    face(d, p.at);
    if (v.why === 'work') d.emote = { pose: 'wave', until: v.until };
    else if (party) d.emote = { pose: 'dance', until: v.until };
    else if (p.spec.visit === 'enter') d.hidden = true;
    else if (p.spec.visit === 'play') startPlaying(state, d, p, v, now);
    else if (POSE[p.spec.visit]) d.emote = { pose: POSE[p.spec.visit]!, until: v.until };
    return true;
  }
  // Doing its thing: a shout now and then ("SWISH").
  if (p.spec.visit === 'play' && v.why !== 'party' && v.why !== 'work' && p.spec.pop && now >= (v.popAt ?? 0)) {
    addEffect(state, { kind: 'pop', at: now, to: { ...d.position }, label: p.spec.pop, pose: p.spec.pose });
    v.popAt = now + 2800 + Math.random() * 2000;
  }
  if (v.why === 'work' && d.emote && d.emote.until - now < 2000) d.emote = { pose: (['wave', 'point', 'bow'] as const)[Math.floor(now / 4000) % 3], until: v.until ?? now };
  if (now < (v.until ?? now)) return true;
  finishVisit(state, d, p, v, now);
  return true;
}

function endVisit(d: Dude): void {
  const played = d.visit?.phase === 'in';
  d.visit = undefined;
  d.hidden = undefined;
  if (played) d.y = undefined;
  if (d.emote && (['sit', 'dance', 'lie', 'wave', 'shoot', 'swing', 'strum', 'swim', 'lift', 'paint', 'jump', 'kick', 'punch', 'cheer', 'think'] as string[]).includes(d.emote.pose)) d.emote = undefined;
  if (d.walkingFor === 'visit') {
    d.path = [];
    d.walkingFor = undefined;
  }
}
/** Called when a character is asked to do something else mid-visit: they leave without it counting. */
export function leaveVisit(d: Dude): void {
  if (d.visit) endVisit(d);
  d.labour = undefined;
}

function finishVisit(state: DudesState, d: Dude, p: Place, v: Visit, now: number): void {
  endVisit(d);
  if (v.why === 'work') {
    d.coins = coinsOf(d) + TOWN.wage;
    pushLine(d.history, { from: 'world', text: `you worked a shift at ${p.name} and earned §${TOWN.wage}`, at: now }, LIMITS.history);
    pushFeed(state, now, `${d.name} worked a shift at ${p.name}`);
    if (p.kind !== 'town') caravanSaw(state, 'operate', now, p.kind, undefined, d.id);
    const needs = needsOf(d);
    needs.social = clamp(needs.social + 15, 0, 100);
    needs.energy = clamp(needs.energy - 8, 0, 100);
    return;
  }
  if (v.why === 'party') {
    const needs = needsOf(d);
    needs.fun = clamp(needs.fun + 40, 0, 100);
    needs.social = clamp(needs.social + 40, 0, 100);
    return;
  }
  const paid = pay(state, d.name, d, p, now);
  if (p.owner && p.owner !== d.id) noteTie(state, d.id, p.owner, 'visit', now);
  const owed = p.owner === d.id ? 0 : p.spec.price;
  const scale = paid < owed ? 0.5 : 1; // broke: a glass of water, not dinner
  const needs = needsOf(d);
  for (const n of NEEDS) needs[n] = clamp(needs[n] + (p.spec.gives[n] ?? 0) * scale, 0, 100);
  // Two people at the same place at the same time had a chat.
  const company = state.dudes.filter((o) => o !== d && o.visit?.placeId === p.id && o.visit.phase === 'in');
  if (company.length) needs.social = clamp(needs.social + 10, 0, 100);
  const theirs = p.owner && p.owner !== d.id ? ` (${p.ownerName}'s)` : '';
  pushLine(
    d.history,
    { from: 'world', text: `you ${p.spec.verb} ${p.name}${theirs}${paid ? ` for §${paid}` : scale < 1 ? ' but could not pay, so it was only a glass of water' : ''}`, at: now },
    LIMITS.history,
  );
}

/** A visitor pays the owner; the owner hears about it (or finds it in their ledger later). Returns what was paid. */
export function pay(state: DudesState, visitorName: string, visitor: Dude | undefined, p: Place, now: number): number {
  const c = cityOf(state);
  const price = visitor && visitor.id === p.owner ? 0 : p.spec.price;
  const paid = visitor ? Math.min(price, coinsOf(visitor)) : price;
  if (visitor) visitor.coins = coinsOf(visitor) - paid;
  const owner = p.owner ? state.dudes.find((x) => x.id === p.owner) : undefined;
  if (owner && owner !== visitor) owner.coins = coinsOf(owner) + paid;
  if (p.id.startsWith('town:')) return paid;
  if (!visitor && p.kind !== 'town') caravanSaw(state, 'serve', now, p.kind, visitorName, owner?.id);
  const s = (c.stats[p.id] ??= { visits: 0, coins: 0, recent: [], lastVisitors: [] });
  if (owner === visitor) return paid; // using your own place is not business
  const lastAt = s.recent.at(-1) ?? 0;
  s.visits++;
  s.coins += paid;
  pushLine(s.recent, now, 60);
  if (s.lastVisitors.at(-1) !== visitorName) pushLine(s.lastVisitors, visitorName, 6);
  if (paid) addEffect(state, { kind: 'coins', objectId: p.id, at: now, to: { x: p.at.x, z: p.at.z }, amount: paid });
  if (owner && !awake(owner, now)) {
    const l = ledgerOf(owner, now);
    l.visits++;
    l.coins += paid;
    if (!l.visitors.includes(visitorName)) pushLine(l.visitors, visitorName, 8);
  }
  if (now - lastAt > TOWN.feedGapMs) pushFeed(state, now, `${visitorName} ${p.spec.verb} ${p.name}${paid ? ` (+§${paid} to ${p.ownerName ?? 'the town'})` : ''}`);
  return paid;
}

// ---- needs and going out on your own -------------------------------------------------------------
export function tickNeeds(state: DudesState, dt: number, now: number): void {
  const c = cityOf(state);
  const minutes = dt / 60_000;
  for (const d of state.dudes) {
    const n = needsOf(d);
    const up = awake(d, now);
    for (const k of NEEDS) {
      const floor = up ? 0 : TOWN.awayFloor;
      const next = n[k] - TOWN.decay[k] * minutes * (up ? 1 : TOWN.awayFactor);
      n[k] = Math.max(Math.min(floor, n[k]), next);
    }
    // Asleep at home (or in a flat) restores energy slowly as long as they stay in.
    if (d.visit?.phase === 'in' && d.hidden) n.energy = clamp(n.energy + minutes * 4, 0, 100);
  }
  // Odd jobs: a coin a minute for everyone whose chatter is around.
  const minute = Math.floor(now / 60_000);
  if (c.paidMinute !== minute) {
    c.paidMinute = minute;
    for (const d of state.dudes) if (awake(d, now)) d.coins = coinsOf(d) + TOWN.oddJobs;
  }
}

const NEED_WANT: Record<Need, keyof City['unmet']> = { hunger: 'food', energy: 'rest', fun: 'fun', social: 'social' };
const lastOuting = new WeakMap<Dude, number>();

/**
 * A free character with nothing asked of it: go where its lowest need is met, join a party, or
 * look in on a friend. Returns true when it set off somewhere. Zero AI.
 */
export function autonomy(state: DudesState, d: Dude, now: number, rng: () => number): boolean {
  if (d.visit || d.labour) return true;
  if (state.ai.townLife === false) return false;
  const c = cityOf(state);
  const up = awake(d, now);
  // A party or a grand opening: everyone about goes, and about half of those whose chatter is away
  // turn up too (the same half all party long), so the square fills even when chat is quiet.
  const joins = up || (hashOf(`${d.id}:${c.party?.until ?? 0}`) % 2 === 0 && dist(d.position, c.party?.at ?? d.position) < TOWN.reach);
  if (c.party && joins && now < c.party.until - 8000 && dist(d.position, c.party.at) > 4) {
    const p = placeById(state, c.party.placeId) ?? { ...TOWN_PLACES[0], at: c.party.at };
    return !startVisit(state, d, p, 'party', now);
  }
  if (now - (lastOuting.get(d) ?? 0) < TOWN.outingGapMs * (up ? 1 : 6)) return false;
  const needs = needsOf(d);
  const need = NEEDS.reduce((a, b) => (needs[b] < needs[a] ? b : a));
  if (needs[need] >= TOWN.low) return false;
  lastOuting.set(d, now);
  // Lonely: go and find somebody first.
  if (need === 'social' && up) {
    const near = state.dudes.filter((o) => o !== d && awake(o, now) && !o.hidden && !o.riding && dist(o.position, d.position) < 25);
    if (near.length && rng() < 0.6) {
      const o = near[Math.floor(rng() * near.length)];
      d.meet = { dudeId: o.id, how: rng() < 0.6 ? 'wave' : 'handshake', giveUpAt: now + 25_000 };
      return true;
    }
  }
  // Tired: home first, whatever else is in town.
  const home = need === 'energy' ? homeOf(state, d) : undefined;
  const p = home ?? bestPlaceFor(state, { id: d.id, position: d.position, coins: coinsOf(d) }, need, now, rng, d);
  if (!p) {
    c.unmet[NEED_WANT[need]] = (c.unmet[NEED_WANT[need]] ?? 0) + 1;
    if (need === 'energy') {
      d.emote = { pose: 'lie', until: now + 20_000 };
      needs.energy = clamp(needs.energy + 15, 0, 100);
      return true;
    }
    return false;
  }
  return !startVisit(state, d, p, 'need', now, need);
}

const NEED_HEADING: Record<Need, string> = { hunger: 'hungry', energy: 'tired', fun: 'bored', social: 'lonely' };
/** Why and where someone is walking, for the line under their name ("hungry → Sara's Bakery"); nothing when not on the way anywhere. */
export function headingOf(state: DudesState, d: Dude): string | undefined {
  const v = d.visit;
  if (v?.phase === 'going') {
    const p = placeById(state, v.placeId);
    if (!p) return undefined;
    const why = v.why === 'need' && v.need ? NEED_HEADING[v.need] : v.why === 'work' ? 'shift' : v.why === 'party' ? 'party' : undefined;
    return `${why ? `${why} → ` : '→ '}${p.name}`.slice(0, 48);
  }
  if (d.labour?.phase === 'going') return d.labour.site === 'bridge' ? 'helping → the bridge' : `helping → ${projectOf(state)?.name ?? 'the project'}`.slice(0, 48);
  return undefined;
}

/** At most this many characters whose chatter is away are out on an outing of their own at once. */
const AWAY_OUT_MAX = 4;
/**
 * A character whose chatter is away, now and then (zero AI): a shift where the travellers asked for
 * one, or round to somebody else's place, so the town does not empty between chat bursts. Never
 * anything that costs more than they can easily spare. Returns true when they set off.
 */
export function awayOuting(state: DudesState, d: Dude, now: number, rng: () => number): boolean {
  if (state.ai.townLife === false || d.visit || d.labour || awake(d, now)) return false;
  if (state.dudes.filter((x) => x.visit && !awake(x, now)).length >= AWAY_OUT_MAX) return false;
  const roll = rng();
  const cv = cityOf(state).caravan;
  const ask = cv && !cv.nextAt && !cv.stranded ? cv.asks.find((a) => a.kind === 'operate' && a.have < a.need) : undefined;
  if (ask && roll < 0.2) {
    const job = placesOf(state)
      .filter((p) => p.kind !== 'town' && ask.venues?.includes(p.kind as VenueKind) && dist(p.at, d.position) < TOWN.reach)
      .sort((a, b) => dist(a.at, d.position) - dist(b.at, d.position))[0];
    if (job && !startVisit(state, d, job, 'work', now)) return true;
  }
  if (roll < 0.1 && coinsOf(d) >= 40) {
    const needs = needsOf(d);
    const need = NEEDS.filter((n) => n !== 'energy').reduce((a, b) => (needs[b] < needs[a] ? b : a));
    const p = bestPlaceFor(state, { id: d.id, position: d.position, coins: Math.min(coinsOf(d) - 30, 15) }, need, now, rng, d);
    if (p && p.owner && p.owner !== d.id && !startVisit(state, d, p, 'need', now, need)) return true;
  }
  return false;
}

/** Two characters greeted each other: both feel better for it. */
export function socialised(a: Dude, b: Dude): void {
  for (const d of [a, b]) {
    const n = needsOf(d);
    n.social = clamp(n.social + 20, 0, 100);
  }
}

// ---- who has history with whom: a small ledger per pair (on each side), zero AI ---------------------
/** At most this many people on one character's ledger; the stalest go first. */
const TIES_MAX = 24;
/** `d`'s side of their history with `other` (made on first use). */
export function tieWith(d: Dude, otherId: string, now: number): Tie {
  const ties = (d.ties ??= {});
  let t = ties[otherId];
  if (!t) {
    const ids = Object.keys(ties);
    if (ids.length >= TIES_MAX) delete ties[ids.sort((a, b) => ties[a].at - ties[b].at)[0]];
    t = ties[otherId] = { came: 0, went: 0, gifts: 0, hits: 0, together: 0, at: now };
  }
  t.at = now;
  return t;
}
/** Something passed between two characters: both sides of the ledger hear about it. */
export function noteTie(state: DudesState, fromId: string, toId: string, what: 'visit' | 'gift' | 'hit' | 'together', now: number, amount = 1): void {
  if (fromId === toId) return;
  const from = state.dudes.find((x) => x.id === fromId),
    to = state.dudes.find((x) => x.id === toId);
  if (!from || !to) return;
  const a = tieWith(from, toId, now),
    b = tieWith(to, fromId, now);
  if (what === 'visit') {
    a.went++;
    b.came++;
  } else if (what === 'gift') b.gifts += amount;
  else if (what === 'hit') b.hits++;
  else {
    a.together++;
    b.together++;
  }
}
/** How warmly `d` thinks of someone: visits and shared work count, hits count against. */
export function warmth(d: Dude, otherId: string): number {
  const t = d.ties?.[otherId];
  if (!t) return 0;
  return t.came + t.went + Math.min(10, t.gifts / 10) + t.together * 2 - t.hits * 2;
}
/** For the agent: who keeps coming to your places, who you get on with, and who has been at your things. */
export function tiesForAgent(state: DudesState, d: Dude): { yourRegulars?: string[]; friends?: string[]; whoHasBeenAtYourStuff?: string[] } {
  const name = (id: string) => state.dudes.find((x) => x.id === id)?.name;
  const rows = Object.entries(d.ties ?? {})
    .map(([id, t]) => ({ id, t, name: name(id) }))
    .filter((r): r is { id: string; t: Tie; name: string } => !!r.name);
  const regulars = rows.filter((r) => r.t.came >= 2).sort((a, b) => b.t.came - a.t.came).slice(0, 3).map((r) => `${r.name} (${r.t.came} visits${r.t.gifts ? `, gave you §${r.t.gifts}` : ''})`);
  const friends = rows
    .filter((r) => warmth(d, r.id) >= 3 && r.t.came < 2)
    .sort((a, b) => warmth(d, b.id) - warmth(d, a.id))
    .slice(0, 3)
    .map((r) => `${r.name}${r.t.together ? ` (built ${r.t.together} thing${r.t.together === 1 ? '' : 's'} together)` : r.t.gifts ? ` (gave you §${r.t.gifts})` : ''}`);
  const rough = rows.filter((r) => r.t.hits > 0).sort((a, b) => b.t.hits - a.t.hits).slice(0, 3).map((r) => `${r.name} (hit you or your things ${r.t.hits} time${r.t.hits === 1 ? '' : 's'})`);
  return { ...(regulars.length ? { yourRegulars: regulars } : {}), ...(friends.length ? { friends } : {}), ...(rough.length ? { whoHasBeenAtYourStuff: rough } : {}) };
}

// ---- the ledger: what happened while you were away -------------------------------------------------
function ledgerOf(d: Dude, now: number): Ledger {
  return (d.ledger ??= { since: now, visits: 0, coins: 0, visitors: [], notes: [] });
}
/** Something a character should hear about: straight away if their chatter is around, or when they come back. */
export function tell(state: DudesState, d: Dude, text: string, now: number, nudgeNow = false): void {
  if (awake(d, now)) {
    pushLine(d.history, { from: 'world', text, at: now }, LIMITS.history);
    if (nudgeNow) {
      d.nudges ??= [];
      if (d.nudges.length < 4) d.nudges.push(text.slice(0, 240));
    }
    return;
  }
  pushLine(ledgerOf(d, now).notes, text.slice(0, 200), 8);
}
/** Coming back: one paragraph of what happened, for the agent to react to, and a line in the feed. Clears the ledger. */
export function welcomeBack(state: DudesState, d: Dude, now: number): string | undefined {
  const l = d.ledger;
  d.ledger = undefined;
  if (!l || (!l.visits && !l.notes.length)) return undefined;
  const mins = Math.max(1, Math.round((now - l.since) / 60_000));
  const away = mins >= 120 ? `${Math.round(mins / 60)} hours` : `${mins} minutes`;
  const bits: string[] = [];
  if (l.visits) bits.push(`${l.visits} visitor${l.visits === 1 ? '' : 's'} came to your places and paid §${l.coins} (${l.visitors.slice(-4).join(', ')})`);
  bits.push(...l.notes);
  if (l.visits) pushFeed(state, now, `${d.name} is back: ${l.visits} visitor${l.visits === 1 ? '' : 's'} and §${l.coins} while away`);
  return `While you were away (${away}): ${bits.join('; ')}.`.slice(0, 600);
}

// ---- community projects ----------------------------------------------------------------------------
export function projectOf(state: DudesState): Project | undefined {
  const p = cityOf(state).project;
  return p && (p.status === 'designing' || p.status === 'gathering') ? p : undefined;
}
const civicTaken = (state: DudesState) => new Set([...state.objects.filter((o) => o.civic).map((o) => o.plot), cityOf(state).project?.plot]);

/** Someone proposes something for everyone. One at a time; it goes on a free lot in the square's west half (the river side is kept open). */ // hook FK-077
export function proposeProject(state: DudesState, d: Dude, what: string, now: number): string | undefined {
  const c = cityOf(state);
  const current = projectOf(state);
  if (current) return `the town is already building ${current.name ?? current.what.slice(0, 50)}; help finish that first`;
  const taken = civicTaken(state);
  const lot = projectPlots().find((p) => !taken.has(p.id)); // hook FK-077
  if (!lot) return 'the square has no room left for another community project';
  const awakeCount = state.dudes.filter((x) => awake(x, now)).length;
  c.project = {
    id: `c${c.nextProjectId++}`,
    what: what.slice(0, 300),
    by: d.id,
    plot: lot.id,
    status: 'designing',
    coins: 0,
    coinsNeed: clamp(80 + 25 * awakeCount, 120, 600),
    work: 0,
    workNeed: clamp(60 + 20 * awakeCount, 90, 400),
    contributors: {},
    createdAt: now,
    until: now + TOWN.projectMs,
  };
  pushFeed(state, now, `${d.name} proposed a community project: ${what.slice(0, 70)}`);
  return undefined;
}

/** The Wonder standing on its spot in the middle of the square, if one does. */
export const wonderOf = (state: DudesState): SafehouseObject | undefined => state.objects.find((o) => o.plot === WONDER.plot);
/** What a Wonder costs: it grows with the age, so the last ones are the town's biggest effort. */
export function wonderCost(age: number, awakeCount: number): { coins: number; work: number } {
  const k = 1 + 0.3 * Math.max(0, age);
  return { coins: Math.round(clamp(100 + 25 * awakeCount, 150, 500) * k), work: Math.round(clamp(80 + 20 * awakeCount, 120, 400) * (1 + 0.2 * Math.max(0, age))) };
}
/**
 * The caravan's leader proposes the age's Wonder (caravan.ts, the third visit). It goes on its own spot
 * in the middle of the square, never a community lot, and only it can finish the Wonder ask. It waits
 * while another project is under way. Shelved only after hours, not the usual 40 minutes.
 */
export function proposeWonder(state: DudesState, age: number, what: string, now: number): boolean {
  const c = cityOf(state);
  if (projectOf(state)) return false;
  const cost = wonderCost(age, state.dudes.filter((x) => awake(x, now)).length);
  c.project = {
    id: `c${c.nextProjectId++}`,
    what: what.slice(0, 300),
    by: 'caravan',
    plot: WONDER.plot,
    status: 'designing',
    coins: 0,
    coinsNeed: cost.coins,
    work: 0,
    workNeed: cost.work,
    contributors: {},
    createdAt: now,
    until: now + 6 * 3600_000,
    wonder: age,
  };
  return true;
}
/** The new Wonder's ghost goes up on the spot: the last age's Wonder makes way. It moves to a free
 * community lot as a keepsake when two or more are free; otherwise it is taken down. */
function clearWonderSpot(state: DudesState, now: number): void {
  const old = wonderOf(state);
  if (!old) return;
  const taken = civicTaken(state);
  const free = projectPlots().filter((p) => !taken.has(p.id)); // hook FK-077
  if (free.length >= 2) {
    const lot = free[0];
    old.plot = lot.id;
    old.position = { ...lot.centre };
    old.revision++;
    pushFeed(state, now, `${old.blueprint.name} is moved to ${lot.address} to make way for the new Wonder`);
  } else {
    state.objects = state.objects.filter((o) => o !== old);
    pushFeed(state, now, `${old.blueprint.name} is taken down to make way for the new Wonder`);
  }
  state.worldRevision++;
}

/** The design came back (or did not): the ghost goes up on the square and the gathering begins. */
export function projectDesigned(state: DudesState, blueprint: Project['blueprint'] | undefined, now: number, why?: string): void {
  const c = cityOf(state);
  const p = c.project;
  if (!p || p.status !== 'designing') return;
  const proposer = state.dudes.find((d) => d.id === p.by);
  const lot = plotById(p.plot)!;
  if (!blueprint) {
    p.status = 'failed';
    pushFeed(state, now, `the plans for ${p.what.slice(0, 50)} fell through`);
    if (proposer) tell(state, proposer, `the plans for your community project fell through${why ? ` (${why})` : ''}; you can propose it again`, now);
    c.project = undefined;
    return;
  }
  try {
    const fitted = fitToLot(blueprint, lot);
    p.blueprint = fitted;
    p.footprint = measureBlueprint(fitted);
    p.position = { ...lot.centre };
    p.name = fitted.name;
    p.status = 'gathering';
    if (p.plot === WONDER.plot) clearWonderSpot(state, now);
  } catch (e) {
    p.status = 'failed';
    c.project = undefined;
    if (proposer) tell(state, proposer, `the community project could not fit on the square: ${(e as Error).message}`, now);
    return;
  }
  const wonder = p.wonder !== undefined;
  pushFeed(state, now, `${wonder ? 'THE WONDER' : 'COMMUNITY PROJECT'}: ${p.name} on the square (§${p.coinsNeed} and many hands needed)`);
  const by = proposer?.name ?? (wonder ? `${caravanOf(p.wonder!).leader} of the caravan` : 'someone');
  for (const d of state.dudes) if (awake(d, now)) tell(state, d, `The town is building ${p.name}${wonder ? ", the age's Wonder, in the middle of the square" : ' on the square'} (proposed by ${by}). Chip in coins with "contribute" or help build it with "help".`, now, d.id !== p.by);
}

function contributor(p: Project, id: string) {
  return (p.contributors[id] ??= { coins: 0, secs: 0 });
}
export function contribute(state: DudesState, d: Dude, amount: number, now: number): string | undefined {
  const p = projectOf(state);
  if (!p) return 'there is no community project to put money into right now; propose one';
  if (p.status === 'designing') return `the plans for ${p.what.slice(0, 40)} are still being drawn up; try again in a minute`;
  const want = Math.max(0, p.coinsNeed - p.coins);
  if (!want) return `${p.name} already has all the money it needs; help build it instead`;
  const give = Math.min(Math.max(1, Math.floor(amount || 10)), coinsOf(d), want);
  if (give <= 0) return 'you have no coins to give';
  d.coins = coinsOf(d) - give;
  p.coins += give;
  contributor(p, d.id).coins += give;
  pushFeed(state, now, `${d.name} put §${give} toward ${p.name}`);
  addEffect(state, { kind: 'coins', at: now, to: p.position, amount: give });
  return undefined;
}
export function startLabour(state: DudesState, d: Dude, now: number): string | undefined {
  // The travellers stuck at the river come first: out along the path to the bridge, a shift on it, and back.
  if (bridgeOpen(state)) {
    const helpers = cityOf(state).caravan?.helpers ?? [];
    if (helpers.includes(d.id)) return 'you have already done your shift on the bridge; it needs other hands now';
    if (d.labour?.site === 'bridge') return undefined; // already on the way, or at it
    leaveVisit(d);
    endUse(state, d, now);
    if (!walkTo(state, d, BRIDGE_ROAD, 'job')) return 'you could not find a way to the bridge';
    const at = bridgeSpot(state.dudes.filter((x) => x.labour?.site === 'bridge').length + helpers.length);
    d.path.push({ x: at.x, z: at.z });
    d.emote = undefined;
    d.labour = { phase: 'going', at, until: now + 120_000, site: 'bridge' };
    volunteer(state, d.id, now);
    return undefined;
  }
  const p = projectOf(state);
  if (!p) return 'there is no community project to help build right now; propose one';
  if (p.status === 'designing' || !p.position || !p.footprint) return 'the plans are still being drawn up; try again in a minute';
  if (p.work >= p.workNeed) return `${p.name} has all the hands it needs; it is waiting for money now (contribute)`;
  leaveVisit(d);
  endUse(state, d, now);
  const spots = workSpots(p.position, p.footprint, d.position);
  const spot = spots.find((s) => walkTo(state, d, s, 'job'));
  if (!spot) return `you could not find a way to ${p.name}`;
  d.emote = undefined;
  d.labour = { phase: 'going', at: spot, until: now + 90_000 };
  return undefined;
}
/** Off the bridge path and back into town (the path is outside the town's ground, so it's laid by hand). */
function leaveBridge(d: Dude): void {
  d.labour = undefined;
  if (d.emote?.pose === 'hammer') d.emote = undefined;
  if (d.position.x > BRIDGE_ROAD.x + 0.5) {
    d.path = [{ x: BRIDGE_ROAD.x, z: d.position.z }];
    d.walkingFor = 'move';
  }
}
function runBridgeLabour(state: DudesState, d: Dude, now: number): boolean {
  const l = d.labour!;
  // (Only the walk out can time out: a shift that has run its length is finished, below, however the ticks fall.)
  const late = l.phase === 'going' && now > l.until;
  if (late || !cityOf(state).caravan?.stranded) {
    pushLine(d.history, { from: 'world', text: late ? 'you ran out of time to get to the bridge' : 'the bridge no longer needs you', at: now }, LIMITS.history);
    leaveBridge(d);
    return false;
  }
  if (l.phase === 'going') {
    if (d.path.length) return true;
    d.walkingFor = undefined;
    l.phase = 'working';
    l.until = now + BRIDGE_SHIFT_MS;
    face(d, { x: BRIDGE.x, z: d.position.z });
    d.emote = { pose: 'hammer', until: l.until };
    pushLine(d.history, { from: 'world', text: 'you reached the bridge and set to work mending it', at: now }, LIMITS.history);
    return true;
  }
  if (now >= l.until) {
    leaveBridge(d);
    pushLine(d.history, { from: 'world', text: 'you finished your shift on the bridge', at: now }, LIMITS.history);
    bridgeHelped(state, d.id, now);
    return false;
  }
  if (!d.emote || d.emote.pose !== 'hammer') d.emote = { pose: 'hammer', until: l.until };
  return true;
}
export function runLabour(state: DudesState, d: Dude, dt: number, now: number): boolean {
  const l = d.labour;
  if (!l) return false;
  if (l.site === 'bridge') return runBridgeLabour(state, d, now);
  const p = projectOf(state);
  if (!p || p.status !== 'gathering' || p.work >= p.workNeed || now > l.until) {
    d.labour = undefined;
    if (d.emote?.pose === 'hammer') d.emote = undefined;
    return false;
  }
  if (l.phase === 'going') {
    if (d.path.length) return true;
    d.walkingFor = undefined;
    l.phase = 'working';
    l.until = now + TOWN.labourMs;
    face(d, p.position!);
    d.emote = { pose: 'hammer', until: l.until };
    return true;
  }
  const secs = dt / 1000;
  p.work = Math.min(p.workNeed, p.work + secs);
  contributor(p, d.id).secs += secs;
  if (!d.emote || d.emote.pose !== 'hammer') d.emote = { pose: 'hammer', until: l.until };
  return true;
}

/** Projects finish when paid for and built; are shelved (coins back) when nobody finishes them in time. */
export function tickProject(state: DudesState, now: number): void {
  const c = cityOf(state);
  const p = c.project;
  if (!p) return;
  if (p.status === 'done' || p.status === 'failed') {
    c.project = undefined;
    return;
  }
  if (p.status !== 'gathering') return;
  if (p.coins >= p.coinsNeed && p.work >= p.workNeed && p.blueprint && p.position && p.footprint) return completeProject(state, p, now);
  if (now > p.until) {
    for (const [id, put] of Object.entries(p.contributors)) {
      const d = state.dudes.find((x) => x.id === id);
      if (d && put.coins) {
        d.coins = coinsOf(d) + put.coins;
        tell(state, d, `${p.name} was shelved; your §${put.coins} came back to you`, now);
      }
    }
    pushFeed(state, now, `${p.name} was shelved for now`);
    p.status = 'failed';
  }
}

function completeProject(state: DudesState, p: Project, now: number): void {
  const c = cityOf(state);
  const proposer = state.dudes.find((d) => d.id === p.by);
  const object: SafehouseObject = {
    id: nextId(state, 'b'),
    revision: 1,
    blueprint: p.blueprint!,
    position: p.position!,
    footprint: p.footprint!,
    createdBy: proposer?.name ?? 'the town',
    editedBy: proposer?.name ?? 'the town',
    createdAt: now,
    plot: p.plot,
    venue: p.wonder !== undefined ? 'decor' : civicVenue(p),
    civic: true,
    ...(p.wonder !== undefined ? { wonder: p.wonder } : {}),
  };
  stampAge(state, object);
  state.objects.push(object);
  // Nobody stays inside the footprint of what just went up.
  const rect = footprint(object.position, object.footprint.width + 0.6, object.footprint.depth + 0.6);
  for (const d of state.dudes)
    if (d.position.x > rect.minX && d.position.x < rect.maxX && d.position.z > rect.minZ && d.position.z < rect.maxZ) {
      const out = workSpots(object.position, object.footprint, d.position)[0];
      if (out) d.position = out;
      d.path = [];
    }
  state.worldRevision++;
  p.status = 'done';
  c.done.push(p.name ?? p.what.slice(0, 60));
  // Everyone who put something in gets the deed, more for more; before the caravan hears, since
  // this may be the Wonder and the age's board is read when it turns.
  for (const [id, put] of Object.entries(p.contributors)) credit(state, id, 'project', now, Math.min(15, Math.floor(put.coins / 25) + Math.floor(put.secs / 120)));
  // Only the caravan's own Wonder finishes the Wonder ask; anything else the town builds is just a project.
  if (p.wonder !== undefined) caravanSaw(state, 'project', now);
  // Everyone who built it together has that in common now (a dozen of them at most, so it stays cheap).
  const builders = Object.keys(p.contributors).slice(0, 12);
  for (let i = 0; i < builders.length; i++) for (let j = i + 1; j < builders.length; j++) noteTie(state, builders[i], builders[j], 'together', now);
  if (c.done.length > 200) c.done.shift();
  const names: string[] = [];
  for (const id of Object.keys(p.contributors)) {
    const d = state.dudes.find((x) => x.id === id);
    if (!d) continue;
    names.push(d.name);
    (d.badges ??= []).push({ kind: 'project', at: now });
    if (d.badges.length > 500) d.badges.shift();
    tell(state, d, `${p.name} is finished, and you helped make it: it is the town's now. Grand opening on the square!`, now, true);
  }
  if (proposer) {
    (proposer.badges ??= []).push({ kind: 'host', at: now });
  }
  c.party = { title: `GRAND OPENING: ${(p.name ?? 'the project').toUpperCase()}`, at: object.position, placeId: object.id, until: now + TOWN.partyMs, host: proposer?.name };
  callToParty(state, now);
  pushFeed(state, now, `${p.name} is open! Built by ${names.slice(0, 5).join(', ')}${names.length > 5 ? ` and ${names.length - 5} more` : ''}`);
}
const civicVenue = (p: Project): VenueKind => {
  const k = venueKindOf(p.what, p.name, p.blueprint?.description);
  return k === 'home' || k === 'apartments' ? 'park' : k;
};

// ---- parties -----------------------------------------------------------------------------------
export function throwParty(state: DudesState, at: GroundPoint, title: string, now: number, placeId?: string, host?: string): void {
  cityOf(state).party = { title: title.slice(0, 80), at, ...(placeId ? { placeId } : {}), until: now + TOWN.partyMs, ...(host ? { host } : {}) };
  callToParty(state, now);
  pushFeed(state, now, title.slice(0, 120));
  caravanSaw(state, 'party', now, undefined, undefined, host ? state.dudes.find((d) => d.name === host)?.id : undefined);
}
/** Everyone free looks up at once (within a few seconds of each other), rather than at their next idle moment. */
function callToParty(state: DudesState, now: number): void {
  for (const d of state.dudes) if (!d.visit && !d.labour && !d.path.length) d.idleUntil = now + 500 + (hashOf(d.id) % 4000);
}
function tickParty(state: DudesState, now: number): void {
  const c = cityOf(state);
  if (c.party && now >= c.party.until) {
    c.party = undefined;
    for (const d of state.dudes) if (d.visit?.why === 'party') d.visit.until = now;
  }
}

// ---- the town's residents ------------------------------------------------------------------------
const TOWNIE_SPEED = 1.5;
/** A resident strolls this long (ms) after a visit before going anywhere else. */
const TOWNIE_REST_MS = [20_000, 60_000];
function wantedTownies(state: DudesState, now: number): number {
  const awakeCount = state.dudes.filter((d) => awake(d, now)).length;
  const blocks = state.objects.filter((o) => o.venue === 'apartments').length;
  return clamp(5 + blocks * 2 - Math.floor(awakeCount / 2), 2, 14);
}
/** A walkable spot somewhere on the streets near a point. */
function streetSpotNear(at: GroundPoint, rng: () => number, spread = 18): GroundPoint {
  for (let i = 0; i < 12; i++) {
    const p = clampToGround({ x: at.x + (rng() * 2 - 1) * spread, z: at.z + (rng() * 2 - 1) * spread }, 2);
    if (!plotAt(p)) return p;
  }
  return clampToGround(at, 2);
}
function townieGo(state: DudesState, t: Townie, to: GroundPoint): boolean {
  const path = route(t.position, to, state.objects);
  if (!path) return false;
  t.path = path.slice(1);
  return true;
}

// ---- the caravan's travellers: they wait on the square, and go to see what the town builds for them ----
/** Where each traveller stands on the square: the leader by the centrepiece, the others beside them. */
const TRAVELLER_SPOTS: GroundPoint[] = [
  { x: 4.1, z: 4.1 },
  { x: 6.2, z: 0.4 },
  { x: 0.6, z: 7.6 },
];
function travellerSpot(state: DudesState, t: Townie): GroundPoint {
  const i = Math.max(0, cityOf(state).caravan?.travellers.indexOf(t.id) ?? 0);
  return TRAVELLER_SPOTS[i % TRAVELLER_SPOTS.length];
}
function tickTraveller(state: DudesState, t: Townie, now: number, rng: () => number): void {
  const cv = cityOf(state).caravan;
  // The age has turned and they have said goodbye: back at the camp across the river, facing the town.
  if (cv?.turn?.left) {
    t.facing = FACING_TOWN;
    t.until = now + 5000;
    return;
  }
  // Across the river, waiting: facing the town, fidgeting; the leader calls over now and then. Quiet while a scene plays.
  if (cv?.stranded) {
    t.facing = FACING_TOWN;
    t.until = now + 4000 + rng() * 4000;
    if (cityOf(state).scene) return;
    const a = cv.asks[0];
    if (t.leader && a && a.have < a.need && rng() < 0.1) {
      const left = a.need - a.have;
      t.say = { text: rng() < 0.5 ? `We're still here. The bridge needs ${left === 1 ? 'one more pair' : `${left} more pairs`} of hands.` : 'Is anyone coming? The little one is cold.', until: now + 7000 };
    } else if (!t.leader && rng() < 0.14) {
      const elder = cv.travellers.indexOf(t.id) === 2;
      t.emote = elder ? { pose: 'sit', until: now + 20_000 } : { pose: (['think', 'shrug', 'point', 'wave'] as const)[Math.floor(rng() * 4)], until: now + 2500 };
    }
    return;
  }
  // Something the town built for them: the first traveller free goes to see it (and uses it, which counts).
  if (cv && cv.asks.length && !cv.nextAt) {
    const wanted = new Set(cv.asks.filter((a) => a.venues).flatMap((a) => a.venues!));
    const seen = (cv.seen ??= []);
    const fresh = placesOf(state).find((p) => p.kind !== 'town' && wanted.has(p.kind) && !seen.includes(p.id) && (state.objects.find((o) => o.id === p.id)?.createdAt ?? 0) >= cv.openedAt);
    if (fresh) {
      const spot = workSpots(fresh.at, fresh.footprint, t.position).find((s) => townieGo(state, t, s));
      if (spot) {
        seen.push(fresh.id);
        if (seen.length > 30) seen.shift();
        t.doing = 'going';
        t.placeId = fresh.id;
        t.say = { text: `Ah, ${fresh.name}! Let's see it.`, until: now + 5000 };
        return;
      }
    }
  }
  const home = travellerSpot(state, t);
  if (dist(t.position, home) > 1.2) {
    if (townieGo(state, t, home)) return;
  }
  // Waiting on the square, facing the centrepiece; the leader reminds the town what is still needed.
  t.facing = Math.atan2(-t.position.x, -t.position.z);
  t.until = now + 3000 + rng() * 3000;
  if (t.leader && cv && !cv.nextAt && cv.asks.length && rng() < 0.12) {
    const left = cv.asks.filter((a) => a.have < a.need);
    if (left.length) t.say = { text: `We still need: ${left.map((a) => `${a.label.replace(/\s*\(.*\)$/, '')} (${a.have}/${a.need})`).join('; ')}`.slice(0, 200), until: now + 9000 };
  } else if (!t.leader && rng() < 0.15) t.emote = { pose: (['wave', 'point', 'think'] as const)[Math.floor(rng() * 3)], until: now + 2500 };
}

export function tickTownies(state: DudesState, dt: number, now: number, rng: () => number): void {
  const c = cityOf(state);
  const want = wantedTownies(state, now);
  // One newcomer at a time, off the bus.
  if (c.townies.filter((x) => !x.traveller).length < want && rng() < dt / 15_000) {
    const used = new Set(c.townies.map((t) => t.name));
    const name = TOWNIE_NAMES.find((n) => !used.has(n));
    if (name) {
      const blocks = state.objects.filter((o) => o.venue === 'apartments');
      const home = blocks.length ? blocks[Math.floor(rng() * blocks.length)] : undefined;
      c.townies.push({ id: `t${hashOf(name).toString(36)}`, name, look: defaultLook(name), position: { ...BUS_STOP }, facing: Math.PI, path: [], doing: 'stroll', until: now + 4000, ...(home ? { home: home.id } : {}) });
      if (home) pushFeed(state, now, `${name} moved into ${home.blueprint.name}`);
    }
  }
  for (const t of c.townies) {
    if (t.say && t.say.until <= now) t.say = undefined;
    if (t.emote && t.emote.until <= now) t.emote = undefined;
    if (t.path.length) {
      step(t, dt, TOWNIE_SPEED);
      continue;
    }
    if (t.doing === 'going') {
      const p = placeById(state, t.placeId);
      if (!p) {
        t.doing = 'stroll';
        t.until = now;
        continue;
      }
      t.doing = 'in';
      t.until = now + p.spec.visitMs * 0.8;
      t.facing = Math.atan2(p.at.x - t.position.x, p.at.z - t.position.z);
      if (p.spec.visit === 'enter') t.hidden = true;
      else if (p.spec.visit === 'play') {
        // Residents shoot hoops too (at ground level: their figures are drawn there).
        startPlaying(state, t, p, undefined, now, t.until, false);
      } else if (POSE[p.spec.visit]) t.emote = { pose: POSE[p.spec.visit]!, until: t.until };
      continue;
    }
    if (now < t.until) continue;
    if (t.doing === 'in') {
      const p = placeById(state, t.placeId);
      t.hidden = undefined;
      t.emote = undefined;
      if (p) pay(state, t.name, undefined, p, now);
      t.last = t.placeId;
      // Out of a busy place with something to say about it, sometimes; then a good long stroll
      // before the next place, so a place gets custom without being besieged by the same faces.
      if (t.traveller) {
        // Back to the square, where the caravan waits.
        townieGo(state, t, travellerSpot(state, t));
        t.doing = 'stroll';
        t.until = now + 4000;
        continue;
      }
      if (rng() < 0.35) t.say = { text: gossip(state, now, rng, p), until: now + 6000 };
      townieGo(state, t, streetSpotNear(t.position, rng, 26));
      t.doing = 'stroll';
      t.until = now + TOWNIE_REST_MS[0] + rng() * (TOWNIE_REST_MS[1] - TOWNIE_REST_MS[0]);
      continue;
    }
    if (t.traveller) {
      tickTraveller(state, t, now, rng);
      continue;
    }
    // Too many residents: one of them catches the bus home (never a caravan's specialist, ids "s…": they settled for good).
    if (t.id.startsWith('t') && c.townies.filter((x) => !x.traveller).length > want) {
      c.townies = c.townies.filter((x) => x !== t);
      continue;
    }
    const roll = rng();
    const all = placesOf(state).filter((p) => p.kind !== 'home' && (p.kind !== 'apartments' || p.id === t.home));
    const places = all.length > 1 ? all.filter((p) => p.id !== t.last) : all;
    if (roll < 0.45 && places.length) {
      // Somewhere to go: anything in town, weighted toward people's own places and what is popular.
      const weights = places.map((p) => (p.kind === 'town' ? 0.6 : 1.5) + Math.min(4, recentVisits(state, p.id, now)) * 0.3 + (p.id === t.home ? 1 : 0));
      let r = rng() * weights.reduce((a, b) => a + b, 0);
      const p = places.find((_, i) => (r -= weights[i]) <= 0) ?? places[0];
      const spot = workSpots(p.at, p.footprint, t.position).find((s) => townieGo(state, t, s));
      if (spot) {
        t.doing = 'going';
        t.placeId = p.id;
        continue;
      }
    }
    if (roll < 0.75) {
      // A word with whoever is about.
      const near = [...state.dudes.filter((d) => awake(d, now) && !d.hidden), ...c.townies.filter((o) => o !== t && !o.hidden)].filter((o) => dist(o.position, t.position) < 20);
      const o = near[Math.floor(rng() * near.length)];
      if (o) {
        const dx = t.position.x - o.position.x,
          dz = t.position.z - o.position.z,
          d = Math.hypot(dx, dz) || 1;
        townieGo(state, t, { x: o.position.x + (dx / d) * 1.3, z: o.position.z + (dz / d) * 1.3 });
        t.doing = 'chat';
        t.until = now + 9000;
        t.emote = { pose: 'wave', until: now + 2500 };
        t.say = { text: gossip(state, now, rng), until: now + 6500 };
        continue;
      }
    }
    townieGo(state, t, streetSpotNear(t.position, rng));
    t.doing = 'stroll';
    t.until = now + 3000 + rng() * 6000;
  }
}
export function townieViews(state: DudesState): DudeView[] {
  const age = ageOf(state);
  return cityOf(state).townies.map((t) => ({
    id: t.id,
    name: t.name,
    resident: true,
    position: t.position,
    facing: t.facing,
    activity: t.path.length ? 'walking' : t.emote ? 'emote' : 'idle',
    look: dressed(state, t.look, { id: t.id, ...(t.leader ? { role: 'leader' as const } : t.daughter ? { role: 'daughter' as const } : {}) }),
    ...(t.traveller ? { traveller: true, ...(t.leader ? { title: 'leader of the travellers' } : t.daughter ? { title: daughterTitle(age) } : {}) } : {}),
    ...(t.scale && t.scale !== 1 ? { scale: t.scale } : {}),
    ...(t.leader ? { leader: true, ...(caravanView(state)?.asks.some((a) => a.have < a.need) ? { asking: true } : {}) } : {}),
    ...(t.hidden ? { hidden: true } : {}),
    ...(t.emote ? { emote: t.emote } : {}),
    ...(t.say ? { say: t.say } : {}),
  }));
}

// ---- what the town is talking about ---------------------------------------------------------------
const pick = <T>(list: T[], rng: () => number) => list[Math.floor(rng() * list.length)];
export function gossip(state: DudesState, now: number, rng: () => number, justLeft?: Place): string {
  const lines: string[] = [];
  const places = placesOf(state).filter((p) => !p.id.startsWith('town:') && p.kind !== 'decor' && p.kind !== 'home');
  if (justLeft && justLeft.owner) lines.push(`${justLeft.name} was lovely. Good on ${justLeft.ownerName}.`, `I could get used to ${justLeft.name}.`);
  const hot = places.map((p) => ({ p, n: recentVisits(state, p.id, now) })).sort((a, b) => b.n - a.n)[0];
  if (hot && hot.n >= 3) lines.push(`${hot.p.name} is packed today.`, `Everyone's going to ${hot.p.name} lately.`);
  const theirs = places.filter((p) => p.ownerName);
  if (theirs.length) {
    const p = pick(theirs, rng);
    lines.push(`Have you tried ${p.name}? ${p.ownerName} runs it.`);
  }
  const newest = [...state.objects].filter((o) => !o.civic).sort((a, b) => b.createdAt - a.createdAt)[0];
  if (newest && now - newest.createdAt < 10 * 60_000) lines.push(`Did you see ${newest.createdBy} put up ${newest.blueprint.name}?`);
  for (const w of wantsOf(state, now)) lines.push(`This town could do with ${w}.`);
  for (const d of districtsOf(state)) lines.push(`${d.name} is getting busy these days.`);
  const p = projectOf(state);
  if (p?.name) lines.push(`I hear the ${p.name} needs more hands.`, `I put a coin in for the ${p.name}.`);
  const c = cityOf(state);
  if (c.done.length) lines.push(`Still can't believe we built ${c.done.at(-1)}.`);
  if (!lines.length) lines.push('Quiet little town, this.', 'Somebody should open a café.', `Lovely day in ${c.name}.`, 'Have you met the new neighbours?');
  return pick(lines, rng);
}

/** What the town is missing, most pressing first (at most three), from what stands and what went unmet. */
export function wantsOf(state: DudesState, now: number): string[] {
  const c = cityOf(state);
  const kinds = new Map<string, number>();
  for (const o of state.objects) if (o.venue) kinds.set(o.venue, (kinds.get(o.venue) ?? 0) + 1);
  const groups = new Map<string, number>();
  for (const [k, n] of kinds) {
    const g = VENUES[k as VenueKind].group;
    if (g) groups.set(g, (groups.get(g) ?? 0) + n);
  }
  const people = state.dudes.filter((d) => awake(d, now)).length;
  const has = (k: string) => (kinds.get(k) ?? 0) > 0;
  const out: [number, string][] = [];
  const unmet = (k: keyof City['unmet']) => c.unmet[k] ?? 0;
  if (!groups.get('food')) out.push([10 + unmet('food'), 'somewhere to eat']);
  if (people >= 3 && !groups.get('night')) out.push([6 + unmet('fun') / 2, 'somewhere to go out at night']);
  if (!groups.get('green')) out.push([5, 'a park or a garden']);
  if ((kinds.get('home') ?? 0) < Math.min(people, 6) && unmet('rest') > 0) out.push([4 + unmet('rest'), 'more homes']);
  if (state.dudes.some((d) => !d.plot && !d.rentsAt) && !has('apartments')) out.push([9, 'apartments for the newcomers']);
  if (has('venue') && !has('florist')) out.push([7, 'a florist for all the parties']);
  if ((kinds.get('restaurant') ?? 0) >= 2 && !has('market')) out.push([6, 'a market for fresh food']);
  if (has('club') && !has('cafe')) out.push([6, 'a café for the morning after']);
  if ((kinds.get('home') ?? 0) >= 5 && !groups.get('shops')) out.push([6, 'a shop']);
  if (people >= 5 && !groups.get('culture')) out.push([4, 'a library, a gallery or a gym']);
  if ((kinds.get('bar') ?? 0) >= 2 && !has('restaurant')) out.push([5, 'somewhere to eat after the pub']);
  return out.sort((a, b) => b[0] - a[0]).slice(0, 3).map(([, w]) => w);
}

/** Blocks where one sort of place has gathered, named for it: "Food Street". */
export function districtsOf(state: DudesState): { key: string; name: string; at: GroundPoint }[] {
  const byBlock = new Map<string, Map<string, number>>();
  for (const o of state.objects) {
    const lot = plotById(o.plot);
    const g = o.venue ? VENUES[o.venue].group : undefined;
    if (!lot || lot.civic || !g) continue;
    const key = blockKey(lot);
    const m = byBlock.get(key) ?? new Map<string, number>();
    m.set(g, (m.get(g) ?? 0) + 1);
    byBlock.set(key, m);
  }
  const out: { key: string; name: string; at: GroundPoint }[] = [];
  for (const [key, m] of byBlock) {
    const [g, n] = [...m].sort((a, b) => b[1] - a[1])[0];
    if (n < (g === 'living' ? 3 : 2)) continue;
    const names = DISTRICT_NAMES[g as keyof typeof DISTRICT_NAMES];
    const [bx, bz] = key.split(',').map(Number);
    out.push({ key, name: names[hashOf(key) % names.length], at: { x: bx * 40, z: bz * 40 } });
  }
  return out;
}

// ---- the tick, the scene, the agents' view ---------------------------------------------------------
export function tickCity(state: DudesState, dt: number, now: number, rng: () => number): void {
  const c = cityOf(state);
  // Takings for builds that are gone go with them.
  if (rng() < dt / 30_000) for (const id of Object.keys(c.stats)) if (!state.objects.some((o) => o.id === id)) delete c.stats[id];
  tickNeeds(state, dt, now);
  tickProject(state, now);
  tickParty(state, now);
  if (state.ai.townLife !== false) {
    tickTownies(state, dt, now, rng);
    tickCaravan(state, now);
  } else cityOf(state).townies = [];
}

export function townView(state: DudesState, now: number): TownView {
  const c = cityOf(state);
  const p = projectOf(state);
  return {
    name: c.name,
    age: ageOf(state),
    ...(themed(state) ? {} : { sandbox: true }),
    head: headName(state),
    ...(caravanView(state) ? { caravan: caravanView(state) } : {}),
    ...(sceneView(state) ? { scene: sceneView(state) } : {}),
    ...(bridgeProgress(state) !== undefined ? { bridge: bridgeProgress(state) } : {}),
    lots: Object.entries(c.plots).map(([id, claim]) => {
      const owner = state.dudes.find((d) => d.id === claim.owner);
      return { id, owner: owner?.name ?? '?', shirt: owner?.look.shirt ?? '#8f8a82', away: !owner || !awake(owner, now) };
    }),
    districts: districtsOf(state).map((d) => ({ name: d.name, at: d.at })),
    wants: wantsOf(state, now),
    hot: placesOf(state)
      .filter((pl) => !pl.id.startsWith('town:'))
      .map((pl) => ({ id: pl.id, n: recentVisits(state, pl.id, now) }))
      .filter((x) => x.n >= 2)
      .sort((a, b) => b.n - a.n)
      .slice(0, 3)
      .map((x) => x.id),
    ...(wonderOf(state) || (p?.plot === WONDER.plot && p.status === 'gathering') ? { wonder: true } : {}),
    ...(p ? { project: { name: p.name ?? p.what.slice(0, 40), status: p.status, coins: p.coins, coinsNeed: p.coinsNeed, work: Math.round(p.work), workNeed: p.workNeed, plot: p.plot, ...(projectPreview(state) ? { preview: projectPreview(state)!.object } : {}) } } : {}),
    ...(c.party ? { party: { title: c.party.title, at: c.party.at, until: c.party.until } } : {}),
    places: Object.fromEntries(Object.entries(c.stats).filter(([id]) => state.objects.some((o) => o.id === id)).map(([id, st]) => [id, [st.visits, st.coins] as [number, number]])),
    // Finders Keepers' pieces, last: a story scene overrides the caravan's. Nothing while Story is off (FK-001).
    ...storyTownView(state, now),
  };
}

/** The banner across the top: a grand opening, or the community project's progress. */
export function townBanner(state: DudesState, now: number): HappeningView | undefined {
  const c = cityOf(state);
  if (c.party && now < c.party.until) return { kind: 'party', title: c.party.title, text: c.party.host ? `Everyone to the square: ${c.party.host} is hosting.` : 'Everyone is invited.', until: c.party.until };
  const p = projectOf(state);
  if (!p) return undefined;
  if (p.status === 'designing') return { kind: 'project', title: 'COMMUNITY PROJECT', text: `Drawing up the plans: ${p.what.slice(0, 80)}` };
  return {
    kind: 'project',
    title: `BUILDING ${(p.name ?? 'IT').toUpperCase()}`,
    text: 'Say "chip in" to give coins, or "help build it" to lend a hand.',
    bars: [
      { label: 'coins', value: p.coins / p.coinsNeed, note: `§${p.coins}/${p.coinsNeed}` },
      { label: 'built', value: p.work / p.workNeed, note: `${Math.round((p.work / p.workNeed) * 100)}%` },
    ],
  };
}

/** The ghost of the community project on the square, drawn filling up as it gets paid for and built. */
export function projectPreview(state: DudesState): { object: SafehouseObject; progress: number } | undefined {
  const p = projectOf(state);
  if (!p || p.status !== 'gathering' || !p.blueprint || !p.position || !p.footprint) return undefined;
  return {
    object: { id: `project-${p.id}`, revision: 1, blueprint: p.blueprint, position: p.position, footprint: p.footprint, createdBy: 'the town', editedBy: 'the town', createdAt: p.createdAt, plot: p.plot, ...(themed(state) ? { age: ageOf(state) } : { free: true }) },
    progress: Math.min(p.coins / p.coinsNeed, p.work / p.workNeed),
  };
}

const NEED_WORDS: Record<Need, [string, string]> = {
  hunger: ['starving', 'peckish'],
  energy: ['exhausted', 'tired'],
  fun: ['bored stiff', 'a bit bored'],
  social: ['lonely', 'wanting company'],
};
/** How a character is doing, in words, for its agent ("peckish, a bit bored"). */
export function feelings(d: Dude): string {
  const n = needsOf(d);
  const out = NEEDS.filter((k) => n[k] < TOWN.low).map((k) => NEED_WORDS[k][n[k] < 25 ? 0 : 1]);
  const mood = moodOf(n);
  return out.length ? out.join(', ') : mood > 80 ? 'very happy' : 'fine';
}

/** The town as one agent sees it: their lot and places, what is near, what is going on. */
export function townForAgent(state: DudesState, d: Dude, now: number) {
  const c = cityOf(state);
  const lots = lotsOf(state, d);
  const mine = state.objects.filter((o) => o.owner === d.id);
  const near = placesOf(state)
    .filter((p) => p.owner !== d.id && (p.kind !== 'home' || mayVisit(state, d, p)))
    .map((p) => ({ p, m: dist(p.at, d.position) }))
    .sort((a, b) => a.m - b.m)
    .slice(0, 10)
    .map(({ p, m }) => ({
      name: p.name,
      kind: p.kind === 'town' ? p.spec.label : venueName(namingAge(state), p.kind),
      ...(p.ownerName ? { owner: p.ownerName } : p.civic ? { owner: 'the town' } : {}),
      price: p.spec.price,
      metres: Math.round(m),
      ...(p.spec.visit === 'play' ? { youCan: p.spec.verb.replace(/^went to /, '').replace(/ at$/, '') } : {}),
      ...(recentVisits(state, p.id, now) >= 3 ? { busy: true } : {}),
    }));
  const project = projectOf(state);
  const age = ageStyle(ageOf(state));
  return {
    town: c.name,
    age: themed(state)
      ? `${age.name[0].toUpperCase()}${age.name.slice(1)}. ${age.living} The streamer's character is the town's ${age.head.title} ("the ${age.head.title}", still "the Mayor" to the app).`
      : 'None: the town is a theme-free sandbox right now, with no age. Build anything at all, in any style (everyday, fantasy, sci-fi, silly), exactly as your chatter asks; places have their everyday names. The streamer\'s character is the Mayor.',
    yourLot: lots[0]
      ? `${lots[0].address}${c.plots[lots[0].id]?.owner === d.id ? '' : ` (shared with you by ${ownerOfLot(state, lots[0].id)?.name ?? 'a friend'})`}, ${Math.round(dist(lots[0].centre, d.position))} m away; ${lotRoom(state, lots[0])}`
      : d.rentsAt
        ? `no lot of your own; you rent a flat in ${state.objects.find((o) => o.id === d.rentsAt)?.blueprint.name ?? 'an apartment block'}`
        : 'no lot of your own: the town is full for now. You can still build on any lot with room (say where), rent a flat in an apartment block, or ask a friend to share their lot.',
    ...(lots.length > 1 ? { otherLots: lots.slice(1).map((l) => `${l.address} (shared by ${ownerOfLot(state, l.id)?.name ?? 'a friend'})`) } : {}),
    coins: coinsOf(d),
    feeling: feelings(d),
    yourPlaces: mine.map((o) => {
      const s = c.stats[o.id];
      return { name: o.blueprint.name, kind: o.venue ? venueName(namingAge(state), o.venue) : venueName(namingAge(state), 'decor'), ...(s ? { visits: s.visits, earned: s.coins, lastVisitors: s.lastVisitors.slice(-3) } : {}) };
    }),
    placesNearby: near,
    squarePlaces: townPlaceNames(),
    ...(moversNear(state, d.position).length ? { movingNearby: moversNear(state, d.position).map((m) => `${m.name} (${m.moves === 'roam' ? 'wanders about' : m.moves === 'drive' ? 'drives about' : 'flies about'}), ${m.metres} m away`) } : {}),
    ...(project ? { communityProject: `${project.name ?? project.what.slice(0, 60)}: ${project.status === 'designing' ? 'plans being drawn up' : `§${project.coins}/${project.coinsNeed} raised, ${Math.round((project.work / project.workNeed) * 100)}% built`}${project.contributors[d.id] ? ' (you have helped)' : ''}` } : {}),
    ...(c.done.length ? { builtTogether: c.done.slice(-5) } : {}),
    ...(c.party ? { partyNow: `${c.party.title} at the square` } : {}),
    townWants: wantsOf(state, now),
    ...(caravanLine(state) ? { caravan: caravanLine(state) } : {}),
    districts: districtsOf(state).map((x) => x.name),
    neighbours: lots[0] ? neighboursOf(state, lots[0]).map((n) => n.name) : [],
    ...tiesForAgent(state, d),
    lotsWithRoomNearby: lotsNear(state, d),
    residents: c.townies.length,
  };
}

/** A design scaled to fit on a lot (a little in from its edges, and not a skyscraper). */
export function fitToLot(blueprint: NonNullable<Project['blueprint']>, lot: PlotInfo): NonNullable<Project['blueprint']> {
  if (lot.id === WONDER.plot) return fitBlueprint(blueprint, { width: WONDER.size, depth: WONDER.size, height: WONDER.height }).blueprint;
  return fitBlueprint(blueprint, { width: lot.rect.maxX - lot.rect.minX - 0.6, depth: lot.rect.maxZ - lot.rect.minZ - 0.6, height: lot.civic ? 22 : 18 }).blueprint;
}

/**
 * The biggest square (metres a side) that still fits on a lot, round what stands there and what
 * is on its way. A design is asked for at this size, and one that comes back too big is shrunk to it.
 */
export function freeSpaceOn(state: DudesState, lot: PlotInfo, exceptJob?: string): number {
  return freeSpotOn(state, lot, exceptJob).side;
}
/** The biggest free square on a lot and where its middle is (the next build's site). */
export function freeSpotOn(state: DudesState, lot: PlotInfo, exceptJob?: string): { side: number; at: GroundPoint } {
  const full = Math.min(lot.rect.maxX - lot.rect.minX, lot.rect.maxZ - lot.rect.minZ) - 0.6;
  const objects = state.objects.filter((o) => o.plot === lot.id || Math.abs((o.driven?.at ?? o.position).x - lot.centre.x) < 20);
  const busy = reserved(state, exceptJob);
  // Toward the back of the lot first (the block's middle), so the front stays open to the street.
  const back = { x: lot.centre.x - lot.sx * 2.5, z: lot.centre.z - lot.sz * 2.5 };
  const spot = (side: number) => {
    try {
      return choosePlacement({ width: side, depth: side }, objects, back, busy, lot.rect);
    } catch {
      return undefined;
    }
  };
  // An empty lot: the first thing goes toward the back, so what comes next fits in front of it.
  if (spot(full)) return { side: full, at: back };
  let lo = 0,
    hi = full,
    at: GroundPoint = { ...lot.centre };
  for (let i = 0; i < 7; i++) {
    const mid = (lo + hi) / 2;
    const p = spot(mid);
    if (p) [lo, at] = [mid, p];
    else hi = mid;
  }
  return { side: Math.floor(lo * 2) / 2, at };
}
/** How much room is left on a lot, in words for the agent. */
function lotRoom(state: DudesState, lot: PlotInfo): string {
  const side = freeSpaceOn(state, lot);
  if (side >= CITY.plot - 2) return `empty, about ${CITY.plot - 1} m square`;
  if (side < 2.5) return 'full: to add something, edit one of your builds to include it (or remove one, if your chatter says so)';
  return `about ${Math.floor(side)} m × ${Math.floor(side)} m still free`;
}
/** What already stands on a lot, by name (for the designer and the agent). */
export const onLot = (state: DudesState, lot: PlotInfo) => state.objects.filter((o) => o.plot === lot.id).map((o) => o.blueprint.name);

/** Room a lot needs left for one more build. */
const ROOM_FOR_A_BUILD = 2.5;
/** "7 Maple Street" → "maple street": the street a lot's address is on. */
const streetOf = (l: PlotInfo) => l.address.toLowerCase().replace(/^\d+\s+/, '');
/**
 * Which lot a build request goes on. Anyone may build on any lot in town except the square's (those
 * are for community projects): an address, a street, someone's lot, next to a build, "here" (the lot
 * they stand on) or "a free lot". Said nowhere: their own lot, else the nearest free lot with room.
 * A string back is why it cannot go there.
 */
export function lotForBuild(state: DudesState, d: Dude, near: string | undefined): PlotInfo | string {
  const roomy = (l: PlotInfo) => freeSpaceOn(state, l) >= ROOM_FOR_A_BUILD;
  const nearest = (ls: PlotInfo[]) => [...ls].sort((a, b) => dist(a.centre, d.position) - dist(b.centre, d.position)).find(roomy);
  const one = (l: PlotInfo) => (roomy(l) ? l : `${l.address} is full; pick another lot`);
  const homes = homePlots();
  const p = (near ?? '').toLowerCase().trim();
  if (p) {
    if (/\b(square|fountain|plaza|town cent(re|er))\b/.test(p)) return 'the town square is kept for community projects; anywhere else in town is fine';
    const named = homes.find((l) => p.includes(l.address.toLowerCase()));
    if (named) return one(named);
    if (/\b(here|this lot|where i am|where i'm standing)\b/.test(p)) {
      const standing = plotAt(d.position);
      if (standing?.civic) return 'you are standing on the town square, which is kept for community projects';
      if (standing) return one(standing);
    }
    if (/\b(free|empty|vacant|unclaimed|new) (lot|plot|spot|space)\b/.test(p)) {
      const empty = freeLots(state).filter((l) => !state.objects.some((o) => o.plot === l.id));
      return nearest(empty) ?? nearest(freeLots(state)) ?? 'there are no free lots left; name a street or someone\'s lot';
    }
    const owner = state.dudes.find((o) => o.name.length >= 2 && new RegExp(`\\b${o.name.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(p));
    const theirs = owner && ownLot(state, owner);
    if (theirs) return one(theirs);
    const build = state.objects.find((o) => o.plot && plotById(o.plot) && !plotById(o.plot)!.civic && o.blueprint.name.length >= 3 && p.includes(o.blueprint.name.toLowerCase()));
    if (build) return one(plotById(build.plot)!);
    const street = homes.filter((l) => p.includes(streetOf(l)) || p.includes(streetOf(l).split(' ')[0]));
    if (street.length) return nearest(street) ?? `${street[0].address.replace(/^\d+\s+/, '')} has no room left`;
  }
  // Said nowhere: their own lot, even when full (the build then says it did not fit, as ever),
  // never someone else's by surprise. Without a lot, the nearest free one with room.
  const mine = lotsOf(state, d);
  if (mine.length) return mine.find(roomy) ?? mine[0];
  return nearest(freeLots(state)) ?? 'there is no free lot with room left; say whose lot or which street to build on';
}
/** The lots near someone that still have room (where they could build next), for the agent. */
export function lotsNear(state: DudesState, d: Dude, n = 4): string[] {
  const c = cityOf(state);
  return homePlots()
    .map((l) => ({ l, m: dist(l.centre, d.position) }))
    .sort((a, b) => a.m - b.m)
    .filter(({ l }) => freeSpaceOn(state, l) >= ROOM_FOR_A_BUILD)
    .slice(0, n)
    .map(({ l, m }) => `${l.address} (${c.plots[l.id] ? `${ownerOfLot(state, l.id)?.name ?? 'someone'}'s` : 'free'}, ${Math.round(m)} m away, ${lotRoom(state, l)})`);
}
