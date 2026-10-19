// What the field remembers between restarts: every dude (the chatter's figure, its agent's
// personality, memory and conversation), every build, the builds in flight, and the operator's
// cost controls. Versioned and validated like every world in this engine; nothing here is
// model-authored code, only data the world interprets.
import { z } from 'zod';
import { blueprintSchema } from './blueprint';
import { listenerSchema } from './listener';
import { ACCESSORIES, ATTACKS, EMOTES, HATS, USE_HOWS, type AttackWith, type FieldEffect, type Hat, type DudeLook, type Emote, type FeedItem, type JobKind, type JobStatus, type UseHow } from '../../shared/dudesTypes';
import type { GroundPoint, SafehouseObject } from '../../shared/objectTypes';

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
  say: 160,
};

const point = z.object({ x: z.number().finite(), z: z.number().finite() });
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
  /** Why it is walking: to a spot, to work on a job, or a little idle wander. */
  walkingFor?: 'move' | 'job' | 'wander';
  emote?: { pose: Emote; until: number };
  say?: { text: string; until: number };
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
}

export interface AttackTask {
  with: AttackWith;
  kind: 'dude' | 'npc' | 'object';
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
  walkingFor: z.enum(['move', 'job', 'wander']).optional(),
  emote: z.object({ pose: z.enum(EMOTES), until: z.number() }).optional(),
  say: z.object({ text: z.string().max(LIMITS.say), until: z.number() }).optional(),
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
      kind: z.enum(['dude', 'npc', 'object']),
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
});

export interface AiSettings {
  /** Quiet characters take a turn of their own now and then (costs calls; operator switch). */
  idleLife?: boolean;
  /** Troublemakers come by (events.ts; no calls of their own, but their victims react). */
  events?: boolean;
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
}

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
        kind: z.enum(['shake', 'shot', 'throw', 'bomb', 'boom', 'ko']),
        at: z.number(),
        objectId: z.string().optional(),
        dudeId: z.string().optional(),
        from: point.optional(),
        to: point.optional(),
        until: z.number().optional(),
        radius: z.number().optional(),
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
  | { do: 'goto'; to: GroundPoint }
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
