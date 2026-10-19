// What the field remembers between restarts: every dude (the chatter's figure, its agent's
// personality, memory and conversation), every build, the builds in flight, and the operator's
// cost controls. Versioned and validated like every world in this engine; nothing here is
// model-authored code, only data the world interprets.
import { z } from 'zod';
import { blueprintSchema } from './blueprint';
import { listenerSchema } from './listener';
import { ACCESSORIES, ATTACKS, BIT_BURSTS, BIT_PROPS, EMOTES, HATS, USE_HOWS, type BitBurst, type BitProp, type AttackWith, type FieldEffect, type Hat, type DudeLook, type Emote, type FeedItem, type JobKind, type JobStatus, type UseHow } from '../../shared/dudesTypes';
import type { GroundPoint, SafehouseObject } from '../../shared/objectTypes';
import { NEEDS, VENUE_KINDS, type Needs, type VenueKind } from '../../shared/city';

export const STATE_VERSION = 1;

/** Caps. A dude past its build cap must remove one of its own first; the field never deletes for it. */
export const LIMITS = {
  dudes: 400, // kept in the save; the snapshot carries the most recent ones
  dudesOnScreen: 150,
  objects: 1000, // a technical ceiling (rendering and the save), not a per-chatter limit
  jobsPerDude: 5, // queued + in flight: a queue, not a cap on how many builds anyone has
  inbox: 8, // messages waiting for the agent; the oldest drop past this
  history: 14, // exchanges the agent sees (chatter lines and its own)
  memory: 16, // facts the agent chose to keep
  overheard: 6,
  feed: 24,
  persona: 420,
  title: 32,
  say: 240,
};

const point = z.object({ x: z.number().finite(), z: z.number().finite() });
const needsSchema = z.object(Object.fromEntries(NEEDS.map((n) => [n, z.number().min(0).max(100)])) as Record<(typeof NEEDS)[number], z.ZodNumber>) as unknown as z.ZodType<Needs>;
const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);

export const lookSchema: z.ZodType<DudeLook> = z.object({
  skin: hex,
  shirt: hex,
  pants: hex,
  hair: hex,
  hat: z.enum(HATS),
  hatColor: hex,
  accessory: z.enum(ACCESSORIES),
  accessoryColor: hex,
  height: z.number().min(0.85).max(1.15),
  build: z.number().min(0.85).max(1.2),
});

export const objectSchema: z.ZodType<SafehouseObject> = z.object({
  id: z.string(),
  revision: z.number().int().positive(),
  blueprint: blueprintSchema,
  position: point,
  footprint: z.object({ width: z.number().positive().max(45), depth: z.number().positive().max(45) }),
  createdBy: z.string(),
  editedBy: z.string(),
  createdAt: z.number(),
  owner: z.string().max(80).optional(), // the dude (chatter userId) whose build it is
  // Moved by someone (drive/ride/push): drawn at `at`, turned by `turn`; stays set once parked.
  driven: z.object({ at: point, turn: z.number().finite(), by: z.string().max(40), until: z.number() }).optional(),
  plot: z.string().max(20).optional(), // the lot it stands on (a home lot, or a community lot for a town project)
  venue: z.enum(VENUE_KINDS).optional(), // what it is for: a home, a café, a club … (city.ts runs the visits)
  civic: z.boolean().optional(), // the town's: a finished community project
  passable: z.boolean().optional(), // never blocks a path or a build (anything that moves about on its own)
  altitude: z.number().min(0).max(40).optional(), // a flying build in the air while someone flies it
  // Goes about town on its own (movers.ts): where it is heading and how; the app's numbers only.
  creature: z
    .object({
      behaviour: z.enum(['rampage', 'fight', 'zoom', 'roam']),
      facing: z.number().finite(),
      moving: z.boolean(),
      path: z.array(point).max(400),
      replanMs: z.number().finite(),
      cooldownMs: z.number().finite(),
      flying: z.boolean().optional(),
      altitude: z.number().finite().optional(),
      node: z.string().max(12).optional(),
      prevNode: z.string().max(12).optional(),
    })
    .optional(),
}) as unknown as z.ZodType<SafehouseObject>;

export interface Line {
  from: 'chatter' | 'dude' | 'world';
  text: string;
  at: number;
}
const lineSchema = z.object({ from: z.enum(['chatter', 'dude', 'world']), text: z.string().max(600), at: z.number() });

export interface Dude {
  id: string; // chatter userId: `kick:<id>` or `dev:<name>`
  name: string; // as last typed
  createdAt: number;
  lastHeardAt: number; // the chatter last spoke
  lastTurnAt: number; // the agent last answered
  turns: number;
  /** Who this dude is, in the agent's own words, built from how the chatter talks; empty until the first turn. */
  persona: string;
  title?: string;
  look: DudeLook;
  memory: string[];
  history: Line[];
  /** Chat waiting for the agent's next turn. Saved, so a restart answers rather than forgets. */
  inbox: Line[];
  /** What other dudes said nearby since this one last thought. */
  overheard: { from: string; text: string; at: number }[];
  position: GroundPoint;
  facing: number;
  path: GroundPoint[]; // remaining waypoints
  /** Why it is walking: to a spot, to work on a job, a little idle wander, or keeping up with the group. */
  walkingFor?: 'move' | 'job' | 'wander' | 'visit' | 'design';
  emote?: { pose: Emote; until: number };
  say?: { text: string; until: number; placard?: boolean };
  idleUntil?: number; // next idle wander is not before this
  greet?: string; // strolling over to stand with this character
  lookAt?: GroundPoint; // strolling over to look at this spot
  muted?: boolean; // operator: the agent ignores this chatter
  lastError?: string;
  /** Using a build (the `use` action): heading over, then doing it; a run carries the vehicle's route. */
  use?: UseTask;
  /** Things that happened to it that its agent should react to on a turn of its own (events, idle life). */
  nudges?: string[];
  /** Knocked out until this time (combat.ts). */
  ko?: { until: number; by: string };
  /** An attack in progress: walking into range, or a bomb planted and running. */
  attack?: AttackTask;
  riding?: string; // object id while aboard
  y?: number; // metres off the ground while on top of or aboard something
  hidden?: boolean; // inside a build
  /** Wandering between nearby things, looking at each (the `explore` action), until this time. */
  explore?: { until: number; looking?: GroundPoint };
  /** Walking over to someone to greet them together (`greet`): a high five, a handshake, a hug. */
  meet?: { dudeId: string; how: 'highfive' | 'handshake' | 'hug' | 'wave' | 'bow'; giveUpAt: number };
  /** Sticking with another character (the `follow` action) until this time. */
  follow?: { dudeId: string; until: number };
  /** Coins (§): spent at other people's places and on the town's projects, earned from visitors and shifts. */
  coins?: number;
  /** How they are doing, 0..100 each; low needs send them out on their own (city.ts `autonomy`). */
  needs?: Needs;
  /** Their own lot, by id (shared/city.ts); co-owned lots are on the lot's record. */
  plot?: string;
  /** No lot of their own (the town was full): a flat in someone's apartment block, by build id. */
  rentsAt?: string;
  /** Out at a place: walking there, then in it (or at it), then the visit does them good and is paid for. */
  visit?: Visit;
  /** Putting in labour on the town's community project. */
  labour?: { phase: 'going' | 'working'; at: GroundPoint; until: number };
  /** Acting something out that no other action covers (a bit): over to whoever it is about, then the poses. */
  bit?: Bit;
  /** Not before this can they teleport again. */
  teleportAt?: number;
  /** What happened to their things while their chatter was away, told to them when they come back. */
  ledger?: Ledger;
  /** Collectables, oldest first: `project:<id>` for each community project they put something into, `opening`, `host`. */
  badges?: { kind: string; at: number }[];
  /** Showing every badge on the name tag (the `show badges` action) until this time. */
  badgesOpenUntil?: number;
  /** Manning a weapon build (`use … fire`): the next shot is not before this. */
  nextShotAt?: number;
}

export interface AttackTask {
  with: AttackWith;
  kind: 'dude' | 'npc' | 'object' | 'boss';
  targetId: string;
  phase: 'going' | 'fuse';
  /** A planted bomb: where, and when it goes off. */
  bombAt?: GroundPoint;
  fuseUntil?: number;
  giveUpAt: number;
}

export interface UseTask {
  objectId: string;
  how: UseHow;
  phase: 'going' | 'doing';
  /** Where a run (drive/ride/push) is headed, resolved when the agent asked. */
  to?: GroundPoint;
  /** The vehicle's remaining route while doing a run. */
  route?: GroundPoint[];
  until?: number; // when a held use (sit, enter, a pose) ends
}

const dudeSchema: z.ZodType<Dude> = z.object({
  id: z.string().max(80),
  name: z.string().max(40),
  createdAt: z.number(),
  lastHeardAt: z.number(),
  lastTurnAt: z.number(),
  turns: z.number().int().nonnegative(),
  persona: z.string().max(LIMITS.persona),
  title: z.string().max(LIMITS.title).optional(),
  look: lookSchema,
  memory: z.array(z.string().max(200)).max(LIMITS.memory),
  history: z.array(lineSchema).max(LIMITS.history),
  inbox: z.array(lineSchema).max(LIMITS.inbox),
  overheard: z.array(z.object({ from: z.string().max(40), text: z.string().max(LIMITS.say), at: z.number() })).max(LIMITS.overheard),
  position: point,
  facing: z.number().finite(),
  path: z.array(point).max(400),
  walkingFor: z.enum(['move', 'job', 'wander', 'visit', 'design']).optional(),
  emote: z.object({ pose: z.enum(EMOTES), until: z.number() }).optional(),
  say: z.object({ text: z.string().max(LIMITS.say), until: z.number(), placard: z.boolean().optional() }).optional(),
  idleUntil: z.number().optional(),
  greet: z.string().optional(),
  lookAt: point.optional(),
  muted: z.boolean().optional(),
  lastError: z.string().max(300).optional(),
  use: z
    .object({
      objectId: z.string(),
      how: z.enum(USE_HOWS),
      phase: z.enum(['going', 'doing']),
      to: point.optional(),
      route: z.array(point).max(400).optional(),
      until: z.number().optional(),
    })
    .optional(),
  nudges: z.array(z.string().max(240)).max(4).optional(),
  ko: z.object({ until: z.number(), by: z.string().max(40) }).optional(),
  attack: z
    .object({
      with: z.enum(ATTACKS),
      kind: z.enum(['dude', 'npc', 'object', 'boss']),
      targetId: z.string(),
      phase: z.enum(['going', 'fuse']),
      bombAt: point.optional(),
      fuseUntil: z.number().optional(),
      giveUpAt: z.number(),
    })
    .optional(),
  riding: z.string().optional(),
  y: z.number().min(0).max(32).optional(),
  hidden: z.boolean().optional(),
  explore: z.object({ until: z.number(), looking: point.optional() }).optional(),
  meet: z.object({ dudeId: z.string(), how: z.enum(['highfive', 'handshake', 'hug', 'wave', 'bow']), giveUpAt: z.number() }).optional(),
  follow: z.object({ dudeId: z.string(), until: z.number() }).optional(),
  coins: z.number().int().min(0).max(10_000_000).optional(),
  needs: needsSchema.optional(),
  plot: z.string().max(20).optional(),
  rentsAt: z.string().max(40).optional(),
  visit: z.lazy(() => visitSchema).optional(),
  labour: z.object({ phase: z.enum(['going', 'working']), at: point, until: z.number() }).optional(),
  bit: z.lazy(() => bitSchema).optional(),
  teleportAt: z.number().optional(),
  ledger: z.lazy(() => ledgerSchema).optional(),
  badges: z.array(z.object({ kind: z.string().max(40), at: z.number() })).max(500).optional(),
  badgesOpenUntil: z.number().optional(),
  nextShotAt: z.number().optional(),
});

/** A build in flight for one dude: designed (in parallel with everyone else's), walked to, put up. */
export interface Job {
  id: string;
  dudeId: string;
  kind: JobKind;
  /** What the agent asked for, in its words ("a crooked lighthouse with a red stripe"). */
  request: string;
  targetId?: string; // edit/remove: the dude's own build
  anchor: GroundPoint; // build: where to put it near
  status: JobStatus;
  createdAt: number;
  blueprint?: z.infer<typeof blueprintSchema>;
  position?: GroundPoint; // chosen once designed; reserved from then on
  footprint?: { width: number; depth: number };
  workMs?: number;
  workedMs?: number;
  error?: string;
  reply?: string;
  /** The lot it goes on, and what it is for (a home, a café …). */
  plot?: string;
  venue?: VenueKind;
  /** The square marked out on the lot for it while it is designed (metres a side). */
  site?: number;
  /** The Mayor's build on someone's lot: theirs once it is up (their id). */
  gift?: string;
  /** What the chatter actually typed when they asked for it (the agent's `request` is its rewording). */
  asked?: string;
}
const jobSchema: z.ZodType<Job> = z.object({
  id: z.string(),
  dudeId: z.string().max(80),
  kind: z.enum(['build', 'edit', 'remove']),
  request: z.string().max(300),
  targetId: z.string().optional(),
  anchor: point,
  status: z.enum(['queued', 'designing', 'ready', 'walking', 'building', 'done', 'failed']),
  createdAt: z.number(),
  blueprint: blueprintSchema.optional(),
  position: point.optional(),
  footprint: z.object({ width: z.number().positive(), depth: z.number().positive() }).optional(),
  workMs: z.number().optional(),
  workedMs: z.number().optional(),
  error: z.string().max(300).optional(),
  reply: z.string().max(240).optional(),
  plot: z.string().max(20).optional(),
  venue: z.enum(VENUE_KINDS).optional(),
  site: z.number().positive().max(20).optional(),
  gift: z.string().max(80).optional(),
  asked: z.string().max(300).optional(),
});

export interface AiSettings {
  /** Quiet characters take a turn of their own now and then (costs calls; operator switch). */
  idleLife?: boolean;
  /** Troublemakers come by (events.ts; no calls of their own, but their victims react). */
  events?: boolean;
  /** The town lives on its own: residents walk about, and characters go out when they need to (city.ts). */
  townLife?: boolean;
  paused: boolean;
  enforced: boolean;
  callsRemaining: number;
  callsUsed: number;
}

export interface DudesState {
  version: number;
  createdAt: number;
  dudes: Dude[];
  objects: SafehouseObject[];
  jobs: Job[];
  feed: FeedItem[];
  ai: AiSettings;
  worldRevision: number;
  nextId: number;
  /** Troublemakers on the field right now (events.ts). */
  npcs?: Npc[];
  /** The event in progress, for the banner and every agent's context. */
  happening?: Happening;
  nextHappeningAt?: number;
  /** What a troublemaker did to a build, so `use … fix` can put it back: object id → the design before. */
  vandalised?: Record<string, { by: string; kind: 'painted' | 'squashed' | 'wrecked'; original: z.infer<typeof blueprintSchema> }>;
  /** Stolen hats waiting in a pile build: pile object id → owner dude id → the hat. */
  hatPiles?: Record<string, Record<string, { hat: Hat; color: string }>>;
  /** Brief happenings for the page (a kicked build rattles, a shot, a bomb); the last few seconds' worth. */
  effects?: FieldEffect[];
  /** The Listener's wishlist, tips and what it has heard since its last reading (listener.ts). */
  listener?: import('./listener').ListenerState;
  /** Knockouts given and taken, by chatter id. */
  scores?: Record<string, { kos: number; downs: number }>;
  /** The town: who owns which lot, the community project, the residents, what is popular (city.ts). */
  city?: City;
  /** The streamer's own figure, walked from the operator page (mayor.ts). */
  mayor?: Mayor;
}

// ---- bits (bits.ts) -----------------------------------------------------------------------------
export interface BitStep {
  pose: Emote;
  seconds: number;
  say?: string;
}
export interface Bit {
  caption: string;
  steps: BitStep[];
  /** Whom or what it is about: they go there first (a character, the Mayor, a build, a spot). */
  target?: { kind: 'dude' | 'mayor' | 'townie' | 'object' | 'point'; id?: string; at: GroundPoint };
  prop?: BitProp;
  sign?: string;
  burst?: BitBurst;
  teleport?: boolean;
  /** A hat for whoever it is about, put on when they get there. */
  giveHat?: Hat;
  phase: 'going' | 'doing';
  step: number;
  stepUntil?: number;
  /** However it goes, it is over by this. */
  until: number;
}
const bitSchema: z.ZodType<Bit> = z.object({
  caption: z.string().max(60),
  steps: z.array(z.object({ pose: z.enum(EMOTES), seconds: z.number().min(0.5).max(8), say: z.string().max(LIMITS.say).optional() })).max(4),
  target: z.object({ kind: z.enum(['dude', 'mayor', 'townie', 'object', 'point']), id: z.string().max(80).optional(), at: point }).optional(),
  prop: z.enum(BIT_PROPS).optional(),
  sign: z.string().max(40).optional(),
  burst: z.enum(BIT_BURSTS).optional(),
  teleport: z.boolean().optional(),
  giveHat: z.enum(HATS).optional(),
  phase: z.enum(['going', 'doing']),
  step: z.number().int().nonnegative(),
  stepUntil: z.number().optional(),
  until: z.number(),
});

// ---- the Mayor (mayor.ts) --------------------------------------------------------------------------
export interface Mayor {
  position: GroundPoint;
  facing: number;
  moving: boolean;
  running?: boolean;
  say?: { text: string; until: number };
  emote?: { pose: Emote; until: number };
  cam: { yaw: number; half: number; x?: number; z?: number };
  follow: boolean;
  /** Hidden: not drawn, not heard; the operator's camera goes on without him. */
  hidden?: boolean;
  /** Aboard a build (riding the donkey, driving the car): its id. */
  riding?: string;
  /** The stream's sound, as the operator set it (0..1 each). */
  audio?: { music: number; sfx: number };
  /** Doing a build's thing (shooting hoops): where, until when, the next shout; and how high he stands. */
  playing?: { placeId: string; until: number; popAt: number };
  y?: number;
  /** Counts the times the server put him somewhere (onto the court): the operator page jumps there too. */
  moved?: number;
  /** A hat a chatter put on him (a bit), worn until this time. */
  hatGift?: { hat: Hat; color: string; by: string; until: number };
  lastInputAt: number;
}
const mayorSchema: z.ZodType<Mayor> = z.object({
  position: point,
  facing: z.number().finite(),
  moving: z.boolean(),
  running: z.boolean().optional(),
  say: z.object({ text: z.string().max(LIMITS.say), until: z.number() }).optional(),
  emote: z.object({ pose: z.enum(EMOTES), until: z.number() }).optional(),
  cam: z.object({ yaw: z.number().finite(), half: z.number().finite(), x: z.number().finite().optional(), z: z.number().finite().optional() }),
  follow: z.boolean(),
  hidden: z.boolean().optional(),
  riding: z.string().max(40).optional(),
  audio: z.object({ music: z.number().min(0).max(1), sfx: z.number().min(0).max(1) }).optional(),
  playing: z.object({ placeId: z.string().max(60), until: z.number(), popAt: z.number() }).optional(),
  y: z.number().min(0).max(10).optional(),
  moved: z.number().int().nonnegative().optional(),
  hatGift: z.object({ hat: z.enum(HATS), color: hex, by: z.string().max(40), until: z.number() }).optional(),
  lastInputAt: z.number(),
});

// ---- the town (city.ts) ---------------------------------------------------------------------------
/** A visit to a place: a build with a `venue`, or one of the square's own (the fountain, the market stall). */
export interface Visit {
  /** A build's id, or `town:<id>` for the square's own places. */
  placeId: string;
  phase: 'going' | 'in';
  /** Why they went: the need it was for, chat asking, or a shift behind the counter. */
  why: 'need' | 'asked' | 'work' | 'party';
  need?: (typeof NEEDS)[number];
  until?: number;
  /** Who they went with (an invitation accepted), for the feed. */
  with?: string;
  /** Doing a build's thing (shooting hoops): the next shout is not before this. */
  popAt?: number;
}
const visitSchema: z.ZodType<Visit> = z.object({
  placeId: z.string().max(60),
  phase: z.enum(['going', 'in']),
  why: z.enum(['need', 'asked', 'work', 'party']),
  need: z.enum(NEEDS).optional(),
  until: z.number().optional(),
  with: z.string().max(40).optional(),
  popAt: z.number().optional(),
});

/** While-you-were-away: visitors to their places, coins earned, and what happened round them. */
export interface Ledger {
  since: number;
  visits: number;
  coins: number;
  /** A few names of who came, newest last. */
  visitors: string[];
  /** Things worth hearing about: "Mo opened a bakery next door", "the town finished the pool". */
  notes: string[];
}
const ledgerSchema: z.ZodType<Ledger> = z.object({
  since: z.number(),
  visits: z.number().int().nonnegative(),
  coins: z.number().int().nonnegative(),
  visitors: z.array(z.string().max(40)).max(8),
  notes: z.array(z.string().max(200)).max(8),
});

export interface PlotClaim {
  owner: string; // dude id
  /** Friends with a key: they can build here too. */
  coOwners: string[];
  claimedAt: number;
}

/** The town's community project: designed first (so everyone can see it), then paid for and built together. */
export interface Project {
  id: string;
  what: string;
  /** Who proposed it (dude id) and its name once designed. */
  by: string;
  name?: string;
  plot: string;
  status: 'designing' | 'gathering' | 'done' | 'failed';
  blueprint?: z.infer<typeof blueprintSchema>;
  position?: GroundPoint;
  footprint?: { width: number; depth: number };
  coins: number;
  coinsNeed: number;
  /** Person-seconds of labour put in, and needed. */
  work: number;
  workNeed: number;
  /** Who put what in: coins and seconds. Everyone here gets the project's badge. */
  contributors: Record<string, { coins: number; secs: number }>;
  createdAt: number;
  /** Ran out of interest: after this it is shelved (coins go back). */
  until: number;
}
const projectSchema: z.ZodType<Project> = z.object({
  id: z.string().max(20),
  what: z.string().max(300),
  by: z.string().max(80),
  name: z.string().max(80).optional(),
  plot: z.string().max(20),
  status: z.enum(['designing', 'gathering', 'done', 'failed']),
  blueprint: blueprintSchema.optional(),
  position: point.optional(),
  footprint: z.object({ width: z.number().positive(), depth: z.number().positive() }).optional(),
  coins: z.number().int().nonnegative(),
  coinsNeed: z.number().int().positive(),
  work: z.number().nonnegative(),
  workNeed: z.number().positive(),
  contributors: z.record(z.string(), z.object({ coins: z.number().int().nonnegative(), secs: z.number().nonnegative() })),
  createdAt: z.number(),
  until: z.number(),
});

/** One of the town's own residents: no agent, no chat; they go about, use people's places, and gossip. */
export interface Townie {
  id: string;
  name: string;
  look: DudeLook;
  position: GroundPoint;
  facing: number;
  path: GroundPoint[];
  /** What they are up to: strolling somewhere, or at a place until a time. */
  doing: 'stroll' | 'going' | 'in' | 'chat';
  placeId?: string;
  until: number;
  /** The apartment block they moved into, if they came with one. */
  home?: string;
  /** The last place they went: they go somewhere else next. */
  last?: string;
  hidden?: boolean;
  say?: { text: string; until: number };
  emote?: { pose: Emote; until: number };
}
const townieSchema: z.ZodType<Townie> = z.object({
  id: z.string().max(20),
  name: z.string().max(40),
  look: lookSchema,
  position: point,
  facing: z.number().finite(),
  path: z.array(point).max(400),
  doing: z.enum(['stroll', 'going', 'in', 'chat']),
  placeId: z.string().max(60).optional(),
  until: z.number(),
  home: z.string().max(40).optional(),
  last: z.string().max(60).optional(),
  hidden: z.boolean().optional(),
  say: z.object({ text: z.string().max(LIMITS.say), until: z.number() }).optional(),
  emote: z.object({ pose: z.enum(EMOTES), until: z.number() }).optional(),
});

/** A place's takings: visits and coins ever, and the times of recent visits (what is popular right now). */
export interface PlaceStats {
  visits: number;
  coins: number;
  recent: number[];
  /** Who came most recently (names), for the owner's agent and the inspect panel. */
  lastVisitors: string[];
}
const statsSchema: z.ZodType<PlaceStats> = z.object({
  visits: z.number().int().nonnegative(),
  coins: z.number().int().nonnegative(),
  recent: z.array(z.number()).max(60),
  lastVisitors: z.array(z.string().max(40)).max(6),
});

/** Everyone gathering somewhere for a while: a grand opening, or a street party the operator throws. */
export interface Party {
  title: string;
  at: GroundPoint;
  placeId?: string;
  until: number;
  host?: string;
}

export interface City {
  name: string;
  plots: Record<string, PlotClaim>;
  project?: Project;
  /** Finished community projects, oldest first (names), for agents and the history. */
  done: string[];
  stats: Record<string, PlaceStats>;
  townies: Townie[];
  /** Times a need went unmet because nothing in town gives it: what the town wants. */
  unmet: Partial<Record<VenueKind | 'food' | 'fun' | 'social' | 'rest', number>>;
  party?: Party;
  nextGossipAt?: number;
  nextProjectId: number;
  /** The last minute odd-jobs money was paid for. */
  paidMinute?: number;
}
export const citySchema: z.ZodType<City> = z.object({
  name: z.string().max(40),
  plots: z.record(z.string(), z.object({ owner: z.string().max(80), coOwners: z.array(z.string().max(80)).max(6), claimedAt: z.number() })),
  project: projectSchema.optional(),
  done: z.array(z.string().max(80)).max(200),
  stats: z.record(z.string(), statsSchema),
  townies: z.array(townieSchema).max(16),
  unmet: z.record(z.string(), z.number().nonnegative()) as unknown as z.ZodType<City['unmet']>,
  party: z.object({ title: z.string().max(80), at: point, placeId: z.string().max(60).optional(), until: z.number(), host: z.string().max(40).optional() }).optional(),
  nextGossipAt: z.number().optional(),
  nextProjectId: z.number().int().nonnegative(),
  paidMinute: z.number().optional(),
});

export const stateSchema: z.ZodType<DudesState> = z.object({
  version: z.number().int(),
  createdAt: z.number(),
  dudes: z.array(dudeSchema).max(LIMITS.dudes),
  objects: z.array(objectSchema).max(LIMITS.objects),
  jobs: z.array(jobSchema).max(LIMITS.dudes * LIMITS.jobsPerDude),
  feed: z.array(z.object({ at: z.number(), text: z.string().max(200) })).max(LIMITS.feed),
  ai: z.object({
    idleLife: z.boolean().optional(),
    events: z.boolean().optional(),
    townLife: z.boolean().optional(),
    paused: z.boolean(),
    enforced: z.boolean(),
    callsRemaining: z.number().int().nonnegative(),
    callsUsed: z.number().int().nonnegative(),
  }),
  worldRevision: z.number().int().nonnegative(),
  nextId: z.number().int().nonnegative(),
  effects: z
    .array(
      z.object({
        id: z.number(),
        kind: z.enum(['shake', 'shot', 'throw', 'bomb', 'boom', 'ko', 'splash', 'slam', 'coins', 'pop', 'burst']),
        at: z.number(),
        objectId: z.string().optional(),
        dudeId: z.string().optional(),
        from: point.optional(),
        to: point.optional(),
        until: z.number().optional(),
        radius: z.number().optional(),
        amount: z.number().optional(),
        label: z.string().max(14).optional(),
        pose: z.string().max(12).optional(),
      }),
    )
    .max(80)
    .optional(),
  listener: z.lazy(() => listenerSchema).optional(),
  scores: z.record(z.string(), z.object({ kos: z.number().int().nonnegative(), downs: z.number().int().nonnegative() })).optional(),
  npcs: z.array(z.lazy(() => npcSchema)).max(6).optional(),
  happening: z.lazy(() => happeningSchema).optional(),
  nextHappeningAt: z.number().optional(),
  vandalised: z.record(z.string(), z.object({ by: z.string().max(40), kind: z.enum(['painted', 'squashed', 'wrecked']), original: blueprintSchema })).optional(),
  hatPiles: z.record(z.string(), z.record(z.string(), z.object({ hat: z.enum(HATS), color: hex }))).optional(),
  city: z.lazy(() => citySchema).optional(),
  mayor: z.lazy(() => mayorSchema).optional(),
});

export function freshState(now: number, allowance: number): DudesState {
  return {
    version: STATE_VERSION,
    createdAt: now,
    dudes: [],
    objects: [],
    jobs: [],
    feed: [],
    ai: { paused: false, enforced: true, callsRemaining: allowance, callsUsed: 0 },
    worldRevision: 0,
    nextId: 1,
  };
}

/** A fresh field that keeps the operator's cost controls (a reset must not silently undo them). */
export function resetState(previous: DudesState, now: number, allowance: number): DudesState {
  const next = freshState(now, allowance);
  next.ai = { ...previous.ai };
  return next;
}

export function nextId(state: DudesState, prefix: string): string {
  return `${prefix}${(state.nextId++).toString(36)}`;
}

export function pushFeed(state: DudesState, now: number, text: string): void {
  state.feed.push({ at: now, text: text.slice(0, 200) });
  while (state.feed.length > LIMITS.feed) state.feed.shift();
}

export function pushLine<T>(list: T[], item: T, cap: number): void {
  list.push(item);
  while (list.length > cap) list.shift();
}

// ---- troublemakers (events.ts) --------------------------------------------------------------------
export type NpcKind = 'painter' | 'squasher' | 'tow' | 'thief' | 'mayor';
/** One thing a troublemaker does next; it works through its plan in order. */
export type NpcStep =
  | { do: 'goto'; to: GroundPoint; camp?: boolean }
  | { do: 'goto-object'; objectId: string }
  | { do: 'goto-dude'; dudeId: string }
  | { do: 'wait'; ms: number; until?: number }
  | { do: 'say'; text: string }
  | { do: 'emote'; pose: Emote; ms: number }
  | { do: 'paint'; objectId: string }
  | { do: 'squash'; objectId: string }
  | { do: 'tow'; objectId: string; to: GroundPoint; route?: GroundPoint[] }
  | { do: 'steal-hat'; dudeId: string; tries?: number }
  | { do: 'drop-hats' }
  | { do: 'decree-check' }
  | { do: 'leave'; to: GroundPoint };
export interface Npc {
  id: string;
  kind: NpcKind;
  name: string;
  look: DudeLook;
  position: GroundPoint;
  facing: number;
  path: GroundPoint[];
  speed: number;
  plan: NpcStep[];
  say?: { text: string; until: number };
  emote?: { pose: Emote; until: number };
  loot?: { dudeId: string; hat: Hat; color: string }[];
  /** A towed build travels with it. */
  towing?: string;
  /** Knocked out by a character: lies there until this time, then gives up and leaves. */
  ko?: number;
}
export interface Happening {
  kind: NpcKind;
  npcId: string;
  title: string;
  text: string;
  startedAt: number;
  until?: number;
  /** The mayor's decree: what everyone must be wearing by `until`. */
  decree?: { colour: string; hex: string };
}
const stepSchema = z.object({ do: z.string() }).passthrough() as unknown as z.ZodType<NpcStep>;
const npcSchema: z.ZodType<Npc> = z.object({
  id: z.string(),
  kind: z.enum(['painter', 'squasher', 'tow', 'thief', 'mayor']),
  name: z.string().max(40),
  look: lookSchema,
  position: point,
  facing: z.number(),
  path: z.array(point).max(400),
  speed: z.number(),
  plan: z.array(stepSchema).max(60),
  say: z.object({ text: z.string().max(LIMITS.say), until: z.number() }).optional(),
  emote: z.object({ pose: z.enum(EMOTES), until: z.number() }).optional(),
  loot: z.array(z.object({ dudeId: z.string(), hat: z.enum(HATS), color: hex })).max(20).optional(),
  towing: z.string().optional(),
  ko: z.number().optional(),
});
const happeningSchema: z.ZodType<Happening> = z.object({
  kind: z.enum(['painter', 'squasher', 'tow', 'thief', 'mayor']),
  npcId: z.string(),
  title: z.string().max(60),
  text: z.string().max(200),
  startedAt: z.number(),
  until: z.number().optional(),
  decree: z.object({ colour: z.string().max(20), hex }).optional(),
});
