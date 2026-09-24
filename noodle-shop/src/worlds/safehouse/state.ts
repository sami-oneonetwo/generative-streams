import { z } from 'zod';
import {
  blueprintSchema,
  measureBlueprint,
  SCENERY_LIMITS,
  CHAT_LIMITS,
  ruleSchema,
  useSchema,
  MAX_RULES,
  pieceVerbSchema,
} from './blueprint';
import { SURVIVOR_START, HOUSE_ID, footprint, inflate, overlaps } from '../../shared/safehouseLayout';
import { freshCombat, freshWave, fenceObjects, initializeObject, intact, MAX_ZOMBIES } from './combat';
import { sceneryObjects, RETIRED_SCENERY_IDS, RELAID_SCENERY_IDS, BLOCK_SCENERY_IDS } from './scenery';
import { choosePlacement } from './placement';
import { freshNeighbours, NEIGHBOURS, OWNED_SLOTS, yardPiece, type NeighbourState } from './neighbours';
import type {
  CombatState,
  SafehouseObject,
  JobStatus,
  GroundPoint,
  SurvivorActivity,
  Regard,
  ErrandPhase,
  WorldEffect,
  VerbWord,
  VerbPose,
} from '../../shared/safehouseTypes';
import { VERB_WORDS, VERB_POSES } from '../../shared/safehouseTypes';
const point = z.object({ x: z.number().finite(), z: z.number().finite() });
/** Bumped together with the schema and migration below; index.ts reads it so the two can never disagree. */
export const STATE_VERSION = 9;
/**
 * What chat may add before Rook says the block is full. Geometry travels by reference
 * (see SafehouseObjectView), so these are bounded by rendering and routing, not by the wire.
 */
export const BUDGETS = { creations: 100, parts: 4000 };
export const objectSchema = z
  .object({
    id: z.string(),
    revision: z.number().int().positive(),
    blueprint: blueprintSchema,
    position: point,
    footprint: z.object({ width: z.number().positive().max(12), depth: z.number().positive().max(12) }),
    createdBy: z.string(),
    editedBy: z.string(),
    createdAt: z.number(),
    role: z.enum(['decoration', 'barrier', 'turret']).optional(),
    health: z.number().finite().nonnegative().optional(),
    maxHealth: z.number().finite().positive().optional(),
    damageRevision: z.number().int().nonnegative().optional(),
    lifecycle: z.number().int().positive().optional(),
    destroyedAt: z.number().nonnegative().optional(),
    nextShotAt: z.number().nonnegative().optional(),
    fixed: z.boolean().optional(),
    passable: z.boolean().optional(),
    owner: z.string().max(20).optional(),
    // Small life (no version bump; all optional): what a piece is for, behaviour as data, the block's own animals.
    uses: z.array(useSchema).max(6).optional(),
    rules: z.array(ruleSchema).max(MAX_RULES).optional(),
    wild: z.boolean().optional(),
    giftTo: z.string().max(20).optional(),
    verb: pieceVerbSchema.optional(),
    driven: z.object({ at: point, turn: z.number().finite(), by: z.string().max(40), until: z.number() }).optional(),
    creature: z
      .object({
        behaviour: z.enum(['rampage', 'fight', 'zoom', 'roam']),
        facing: z.number().finite(),
        moving: z.boolean(),
        path: z.array(point).max(2000),
        targetId: z.string().optional(),
        replanMs: z.number().finite(),
        cooldownMs: z.number().finite(),
        hits: z.number().int().nonnegative().optional(),
        flying: z.boolean().optional(),
        altitude: z.number().finite().nonnegative().optional(),
        nemesis: z.string().optional(),
        nemesisOwner: z.string().max(40).optional(),
        goal: z
          .object({
            rule: z.number().int().nonnegative(),
            targetId: z.string().optional(),
            point: point.optional(),
            dwellMs: z.number().finite(),
            arrived: z.boolean().optional(),
            perched: z.boolean().optional(),
            altitude: z.number().finite().nonnegative().optional(),
          })
          .optional(),
        scaredMs: z.number().finite().nonnegative().optional(),
        heldMs: z.number().finite().nonnegative().optional(),
        freeMs: z.number().finite().nonnegative().optional(),
        busyMs: z.number().finite().nonnegative().optional(),
      })
      .optional(),
  })
  .superRefine((object, ctx) => {
    try {
      const bounds = measureBlueprint(object.blueprint, object.fixed ? SCENERY_LIMITS : CHAT_LIMITS);
      if (object.footprint.width + 0.001 < bounds.width || object.footprint.depth + 0.001 < bounds.depth) {
        ctx.addIssue({ code: 'custom', message: 'Saved footprint does not contain its geometry' });
      }
    } catch {
      ctx.addIssue({ code: 'custom', message: 'Saved geometry exceeds world bounds' });
    }
  });
export interface Job {
  id: string;
  text: string;
  username: string;
  userId: string;
  status: JobStatus;
  createdAt: number;
  attempts: number;
  label: string;
  error?: string;
  preview?: SafehouseObject;
  targetId?: string;
  baseRevision?: number;
  path: GroundPoint[];
  workedMs: number;
  workMs: number;
  resolvedTarget?: string;
  requestedPosition?: GroundPoint;
  requestedArea?: string;
  relativeTo?: {
    objectId: string;
    side: 'next to' | 'beside' | 'in front of' | 'behind' | 'left of' | 'right of';
  };
  angle?: number;
  operation?: 'repair' | 'rebuild' | 'turret' | 'barrier' | 'move' | 'rotate';
  baseLifecycle?: number;
  quick?: { kind: 'recolor' | 'scale'; color?: string; factor?: number; axis?: 'all' | 'height' };
  /** "build marge a bench": the piece is for that neighbour (their id) and goes on their lot. */
  giftTo?: string;
}
const jobSchema = z.object({
  id: z.string(),
  text: z.string().max(1000),
  username: z.string().max(40),
  userId: z.string(),
  status: z.enum(['queued', 'designing', 'walking', 'building', 'complete', 'failed']),
  createdAt: z.number(),
  attempts: z.number().int().min(0).max(2),
  label: z.string(),
  error: z.string().optional(),
  preview: objectSchema.optional(),
  targetId: z.string().optional(),
  baseRevision: z.number().optional(),
  path: z.array(point).max(2000),
  workedMs: z.number().nonnegative(),
  workMs: z.number().positive(),
  resolvedTarget: z.string().optional(),
  requestedPosition: point.optional(),
  requestedArea: z.string().max(40).optional(),
  relativeTo: z
    .object({
      objectId: z.string(),
      side: z.enum(['next to', 'beside', 'in front of', 'behind', 'left of', 'right of']),
    })
    .optional(),
  angle: z.number().finite().optional(),
  operation: z.enum(['repair', 'rebuild', 'turret', 'barrier', 'move', 'rotate']).optional(),
  baseLifecycle: z.number().optional(),
  quick: z
    .object({
      kind: z.enum(['recolor', 'scale']),
      color: z.string().optional(),
      factor: z.number().positive().max(2).optional(),
      axis: z.enum(['all', 'height']).optional(),
    })
    .optional(),
  giftTo: z.string().max(20).optional(),
});
/** Grudges and favours (Regard in safehouseTypes.ts): a small table per neighbour, and one for Rook. */
const regardSchema = z.object({
  score: z.number().finite(),
  since: z.number(),
  lastAt: z.number(),
  reason: z.string().max(120).optional(),
  acts: z.number().int().nonnegative().optional(),
  lastActAt: z.number().optional(),
});
const regardTable = z.record(z.string().max(40), regardSchema);
export const MAX_REGARD = 60; // chatters remembered per table; the coldest entries are dropped past this
// The neighbours' own job machinery (neighbours.ts): a build or an edit in flight, with its ghost.
const neighbourJobSchema = z.object({
  // `use`: shooting at a hoop or sitting on a seat (targetId is the piece).
  kind: z.enum(['build', 'edit', 'repair', 'rebuild', 'tend', 'look', 'use']),
  purpose: z.enum(['defense', 'upkeep', 'project']),
  label: z.string().max(80),
  status: z.enum(['walking', 'working']),
  path: z.array(point).max(2000),
  spot: point,
  workedMs: z.number().nonnegative(),
  workMs: z.number().positive(),
  preview: objectSchema.optional(),
  targetId: z.string().optional(),
  baseRevision: z.number().optional(),
  baseLifecycle: z.number().optional(),
  project: z.string().max(20).optional(),
  reason: z.string().max(20).optional(),
});
const impulseKind = z.enum(['whim', 'rival', 'fortify', 'light', 'pet', 'care', 'visit', 'rearrange', 'social', 'retheme', 'crowd', 'grudge', 'gift']);
// An idea a neighbour has had and not yet acted on; a design the model drew up for it rides along.
const impulseSchema = z.object({
  kind: impulseKind,
  idea: z.string().max(300),
  name: z.string().max(80).optional(),
  targetId: z.string().optional(),
  at: z.number(),
  noAi: z.boolean().optional(),
  brief: z.string().max(200).optional(),
  design: z
    .object({
      blueprint: blueprintSchema,
      name: z.string().max(70),
      role: z.enum(['decoration', 'barrier']).optional(),
      pet: z.boolean().optional(),
      flying: z.boolean().optional(),
      reply: z.string().max(240).optional(),
    })
    .optional(),
});
const neighbourSchema: z.ZodType<NeighbourState> = z.object({
  id: z.string().max(20),
  position: point,
  facing: z.number().finite(),
  activity: z.enum(['idle', 'walking', 'building', 'repairing', 'tending', 'painting', 'looking', 'playing', 'sitting', 'waving', 'dancing']),
  path: z.array(point).max(2000),
  job: neighbourJobSchema.optional(),
  restMs: z.number().finite(),
  stages: z.record(z.string(), z.number().int().nonnegative()),
  paint: z.string().max(12).optional(),
  threat: z
    .object({
      id: z.string(),
      level: z.number().int().nonnegative(),
      quietMs: z.number().finite(),
      waitMs: z.number().finite(),
      sinceMs: z.number().finite().optional(),
    })
    .optional(),
  wear: z.number().finite(),
  say: z.object({ text: z.string().max(200), until: z.number() }).optional(),
  // What they have already noticed, so news is news once (added after v8; older saves start fresh).
  seen: z
    .object({
      creationAt: z.number(),
      otherAt: z.number(),
      wave: z.number().int().nonnegative(),
      fell: z.number().int().optional(),
      lighting: z.enum(['day', 'night']),
      pet: z.boolean().optional(),
      hunkered: z.number().int().optional(),
      /** The crowd size they last remarked on (a wave to the pavement once it fills up). */
      crowd: z.number().int().nonnegative().optional(),
      crowdAt: z.number().optional(),
    })
    .optional(),
  impulses: z.array(impulseSchema).max(6).optional(),
  wish: z
    .object({
      kind: impulseKind,
      idea: z.string().max(300),
      name: z.string().max(80).optional(),
      targetId: z.string().optional(),
      at: z.number(),
      brief: z.string().max(200).optional(),
    })
    .optional(),
  aiAt: z.number().optional(),
  whimSeq: z.number().int().nonnegative().optional(),
  // The look they are redoing the yard in, read off the block (state v9), and how far along they are.
  theme: z.object({ name: z.string().max(40), brief: z.string().max(200), adoptedAt: z.number() }).optional(),
  plan: z.array(z.string().max(120)).max(8).optional(),
  themed: z.record(z.string(), z.string().max(40)).optional(),
  survey: z.object({ sig: z.string().max(40), at: z.number() }).optional(),
  surveyAt: z.number().optional(),
  surveySig: z.string().max(40).optional(),
  // Grudges (Marge) and favourites (Jake), by lowercased chatter.
  regard: regardTable.optional(),
});
/** One viewer on the pavement. Positions are transient (autosave picks them up; nothing checkpoints on a step). */
export interface CrowdMember {
  id: string; // the chatter's userId
  name: string; // as last typed; the tag over the head
  since: number; // when they first spoke this visit
  lastAt: number; // when they last spoke; ten quiet minutes and they wander off
  slot: number; // their spot along the pavement, handed out outward from the middle
  position: GroundPoint;
  facing: number;
  watching?: string; // a piece of theirs going up: they drift along the pavement to line up with it
  watchingUntil?: number; // and stay a while after it lands
  /**
   * A chat verb sent them off the pavement (verbs.ts): the route there, the phase, when the phase ends.
   * A `verb` errand carries the piece's word and pose, the spot to stand at (`at`, on or beside the
   * piece) and the height to stand at (`y`).
   */
  errand?: {
    kind: 'shoot' | 'verb';
    targetId: string;
    phase: ErrandPhase;
    path: GroundPoint[];
    until: number;
    word?: VerbWord;
    pose?: VerbPose;
    at?: GroundPoint;
    y?: number;
    /** A run (`!drive`): the piece's remaining waypoints; the figure rides along and the piece's `driven.at` follows. */
    run?: GroundPoint[];
    /** Chasing a living build (`!ride`, `!fight`): how many times the route has been replanned because it moved. */
    tries?: number;
    /** A `fight` decided: celebrating or flat out for a moment before heading home. */
    result?: 'won' | 'lost';
  };
  /** The last shot they took, for the page's SWISH/MISS pop. */
  shot?: { hit: boolean; at: number };
  /** A verb's pop word and when it went up. */
  pop?: { text: string; at: number };
  /** `!dance`: bouncing until this time. */
  dancingUntil?: number;
}
const crowdMemberSchema: z.ZodType<CrowdMember> = z.object({
  id: z.string().max(80),
  name: z.string().max(40),
  since: z.number(),
  lastAt: z.number(),
  slot: z.number().int().nonnegative().max(200),
  position: point,
  facing: z.number().finite(),
  watching: z.string().optional(),
  watchingUntil: z.number().optional(),
  errand: z
    .object({
      kind: z.enum(['shoot', 'verb']),
      targetId: z.string(),
      phase: z.enum(['going', 'doing', 'returning']),
      path: z.array(point).max(2000),
      until: z.number(),
      word: z.enum(VERB_WORDS).optional(),
      pose: z.enum(VERB_POSES).optional(),
      at: point.optional(),
      y: z.number().finite().nonnegative().optional(),
      run: z.array(point).max(16).optional(),
      tries: z.number().int().nonnegative().max(9).optional(),
      result: z.enum(['won', 'lost']).optional(),
    })
    .optional(),
  shot: z.object({ hit: z.boolean(), at: z.number() }).optional(),
  pop: z.object({ text: z.string().max(12), at: z.number() }).optional(),
  dancingUntil: z.number().optional(),
});
export const MAX_CROWD = 40;
/** A chatter's hoops record (verbs.ts `!shoot`), by lowercased username. */
export interface Score {
  shots: number;
  hits: number;
  streak: number; // current run of hits
  best: number; // longest run
  lastAt: number;
}
const scoreSchema: z.ZodType<Score> = z.object({
  shots: z.number().int().nonnegative(),
  hits: z.number().int().nonnegative(),
  streak: z.number().int().nonnegative(),
  best: z.number().int().nonnegative(),
  lastAt: z.number(),
});
export const MAX_SCORES = 200;
const effectSchema: z.ZodType<WorldEffect> = z.object({
  id: z.number().int().nonnegative(),
  kind: z.literal('honk'),
  objectId: z.string(),
  user: z.string().max(40),
  at: z.number(),
});
export interface SafehouseState {
  version: 9;
  combat: CombatState;
  targets: { userId: string; objectId: string }[];
  idlePath: GroundPoint[];
  generationPaused: boolean;
  callsRemaining: number;
  /** Operator switch for the call allowance; undefined means enforced. False: unlimited, still counted. */
  allowanceEnforced?: boolean;
  /** Model calls made by this world (designs and replies), whatever the allowance says. */
  callsUsed?: number;
  /** Operator switch for Rook's own repair rounds; undefined means running. */
  repairsPaused?: boolean;
  /** Operator switch for the neighbours; undefined means they are about. */
  neighboursPaused?: boolean;
  /** Operator switch for the neighbours reading the block (state v9); undefined means they read it. */
  surveyPaused?: boolean;
  /** The block readings' own allowance, kept apart from chat's so the two never compete. */
  surveyCallsRemaining?: number;
  /** Block readings made, also counted into `callsUsed` so the world's total stays honest. */
  surveyCallsUsed?: number;
  /** Chatters the operator trusts, as lowercased usernames: no design time limit, and `!delete <name>`. */
  privileged?: string[];
  /** Viewers on the pavement (crowd.ts): whoever spoke lately, where they stand, when they last spoke. */
  crowd?: CrowdMember[];
  /** Operator switch: the crowd stays off the page (and out of the snapshot) while true. */
  crowdHidden?: boolean;
  /** Operator switch: the block's birds, cat and rats are sent away while true (wildlife.ts). */
  wildlifePaused?: boolean;
  /** Rook's own grudges, by lowercased chatter: whose creatures keep knocking his yard down. */
  grudges?: Record<string, Regard>;
  /** The hoops scoreboard (`!shoot`), by lowercased chatter. */
  scores?: Record<string, Score>;
  /** Brief happenings for the page (a horn): the last few, trimmed every tick. */
  effects?: WorldEffect[];
  objects: SafehouseObject[];
  jobs: Job[];
  /** The people next door (state v8). */
  neighbours: NeighbourState[];
  survivor: { position: GroundPoint; activity: SurvivorActivity; facing: number };
  lighting: 'day' | 'night';
  worldRevision: number;
  notice: string;
  seen: string[];
  /** Undo history. `removed` marks a `!delete`: `previous` is the whole object, put back as it was. */
  edits: { objectId: string; previous?: SafehouseObject; revision: number; removed?: boolean }[];
}
const zombieKind = z.enum(['walker', 'runner', 'brute']);
const combatSchema = z.object({
  paused: z.boolean(),
  time: z.number().nonnegative(),
  sequence: z.number().int().nonnegative(),
  kills: z.number().int().nonnegative(),
  zombies: z
    .array(
      z.object({
        id: z.string(),
        kind: zombieKind.optional(),
        position: point,
        health: z.number().finite(),
        maxHealth: z.number().positive().optional(),
        facing: z.number().finite(),
        targetId: z.string().optional(),
        attackAt: z.number(),
        path: z.array(point).max(10000),
        replanAt: z.number(),
        heldUntil: z.number().optional(),
        heldIn: z.string().optional(),
        freeUntil: z.number().optional(),
        dancingUntil: z.number().optional(),
      }),
    )
    .max(MAX_ZOMBIES),
  shots: z
    .array(z.object({ id: z.number(), from: point, to: point, toY: z.number().finite().optional(), at: z.number() }))
    .max(32),
  archive: z.array(objectSchema).max(100),
  wave: z.object({
    number: z.number().int().positive(),
    phase: z.enum(['prep', 'wave']),
    phaseEndsAt: z.number(),
    queue: z.array(zombieKind).max(64),
    nextSpawnAt: z.number(),
    spawned: z.number().int().nonnegative(),
    killed: z.number().int().nonnegative(),
    best: z.number().int().nonnegative(),
    fell: z.number().int().positive().optional(),
    warned: z.number().optional(),
    fellThisWave: z.boolean().optional(),
  }),
});
export const stateSchema: z.ZodType<SafehouseState> = z.object({
  version: z.literal(9),
  combat: combatSchema,
  targets: z.array(z.object({ userId: z.string(), objectId: z.string() })).max(200),
  idlePath: z.array(point).max(2000),
  generationPaused: z.boolean(),
  callsRemaining: z.number().int().min(0).max(1_000_000),
  allowanceEnforced: z.boolean().optional(),
  callsUsed: z.number().int().nonnegative().optional(),
  repairsPaused: z.boolean().optional(),
  neighboursPaused: z.boolean().optional(),
  surveyPaused: z.boolean().optional(),
  surveyCallsRemaining: z.number().int().min(0).max(1_000_000).optional(),
  surveyCallsUsed: z.number().int().nonnegative().optional(),
  privileged: z.array(z.string().min(1).max(40)).max(100).optional(),
  crowd: z.array(crowdMemberSchema).max(MAX_CROWD).optional(),
  crowdHidden: z.boolean().optional(),
  wildlifePaused: z.boolean().optional(),
  grudges: regardTable.optional(),
  scores: z.record(z.string().max(40), scoreSchema).optional(),
  effects: z.array(effectSchema).max(20).optional(),
  objects: z.array(objectSchema).max(600),
  jobs: z.array(jobSchema).max(40),
  neighbours: z.array(neighbourSchema).max(8),
  survivor: z.object({
    position: point,
    activity: z.enum(['idle', 'walking', 'building', 'repairing', 'sitting', 'dancing']),
    facing: z.number().finite(),
  }),
  lighting: z.enum(['day', 'night']),
  worldRevision: z.number().int().nonnegative(),
  notice: z.string(),
  seen: z.array(z.string()).max(1000),
  edits: z
    .array(
      z.object({
        objectId: z.string(),
        previous: objectSchema.optional(),
        revision: z.number(),
        removed: z.boolean().optional(),
      }),
    )
    .max(20),
});
export function defaultAllowance(): number {
  const n = Number(process.env.SAFEHOUSE_CALL_ALLOWANCE ?? 20);
  return Number.isInteger(n) && n >= 0 && n <= 10000 ? n : 20;
}
/**
 * The block readings' own allowance. Generous next to chat's twenty because each one is a short
 * text call on the fast model rather than a design, and because it is only spent when the street
 * has actually changed.
 */
export function defaultSurveyAllowance(): number {
  const n = Number(process.env.SAFEHOUSE_SURVEY_ALLOWANCE ?? 40);
  return Number.isInteger(n) && n >= 0 && n <= 10000 ? n : 40;
}
/**
 * v5: the cutaway house becomes Rook's closed house in the middle of the yard.
 * Old walls and furniture go (from the archive too), untouched yard clutter
 * follows the house, and any community creation now under the house is moved
 * to free ground — or archived for rebuild if there is none. Jobs in flight are
 * failed rather than left pointing at geometry that moved.
 */
function relayHouse(s: Record<string, unknown>): Record<string, unknown> {
  const retired = new Set(RETIRED_SCENERY_IDS);
  const fresh = new Map(sceneryObjects().map((o) => [o.id, o]));
  const combat = s.combat as CombatState;
  let objects = (s.objects as SafehouseObject[]).filter((o) => !retired.has(o.id));
  let archive = combat.archive.filter((o) => !retired.has(o.id));
  objects = objects.map((o) => {
    const relaid = fresh.get(o.id);
    if (!relaid || !RELAID_SCENERY_IDS.includes(o.id) || o.revision !== 1) return o;
    return {
      ...relaid,
      health: o.health,
      damageRevision: o.damageRevision,
      lifecycle: o.lifecycle,
      destroyedAt: o.destroyedAt,
    };
  });
  const house = fresh.get(HOUSE_ID)!;
  if (!objects.some((o) => o.id === HOUSE_ID) && !archive.some((o) => o.id === HOUSE_ID)) objects.push(house);
  const zone = inflate(footprint(house.position, house.footprint.width, house.footprint.depth), 0.35);
  for (const o of objects) {
    if (o.id === HOUSE_ID || o.fixed || o.passable || !intact(o)) continue;
    if (!overlaps(footprint(o.position, o.footprint.width, o.footprint.depth), zone)) continue;
    try {
      o.position = choosePlacement(
        o.footprint,
        objects.filter((x) => x.id !== o.id),
        SURVIVOR_START,
      ).position;
    } catch {
      // Nowhere free: keep the design for "rebuild <name>" instead of losing it.
      objects = objects.filter((x) => x.id !== o.id);
      archive = [...archive, { ...o, destroyedAt: 0, lifecycle: (o.lifecycle ?? 1) + 1 }].slice(-100);
    }
  }
  const jobs = (s.jobs as SafehouseState['jobs']).map((j) =>
    ['complete', 'failed'].includes(j.status)
      ? j
      : { ...j, status: 'failed' as const, error: 'The neighborhood changed during an update.', path: [] },
  );
  return {
    ...s,
    objects,
    jobs,
    combat: { ...combat, archive, zombies: [], paused: true },
    edits: (s.edits as SafehouseState['edits']).filter((e) => !retired.has(e.objectId)),
    targets: (s.targets as SafehouseState['targets']).filter((t) => !retired.has(t.objectId)),
    idlePath: [],
    survivor: { position: { ...SURVIVOR_START }, activity: 'idle', facing: Math.PI },
  };
}
/** v6: the zombie trickle becomes waves. Existing zombies are walkers; the first prep starts now. */
function addWaves(s: Record<string, unknown>): Record<string, unknown> {
  const { nextSpawn: _trickle, ...combat } = s.combat as CombatState & { nextSpawn?: number };
  return {
    ...s,
    combat: {
      ...combat,
      zombies: combat.zombies.map((z) => ({ ...z, kind: z.kind ?? 'walker', maxHealth: z.maxHealth ?? 60 })),
      wave: freshWave(combat.time),
    },
  };
}
/**
 * v7: the block grows two lots — the corner shop to the west, the park to the east — seeded
 * into older worlds as neighborhood pieces. Nothing standing moves and the wave clock is left
 * alone. A piece is skipped where chat has already built (the bounds widened a little before
 * this ran) or where it was knocked down and archived under the same id.
 */
function addBlock(s: Record<string, unknown>): Record<string, unknown> {
  const objects = s.objects as SafehouseObject[];
  const combat = s.combat as CombatState;
  const present = new Set([...objects, ...combat.archive].map((o) => o.id));
  const standing = objects.filter((o) => intact(o) && !o.passable).map((o) => inflate(footprint(o.position, o.footprint.width, o.footprint.depth), 0.35));
  const additions = sceneryObjects().filter(
    (o) =>
      BLOCK_SCENERY_IDS.includes(o.id) &&
      !present.has(o.id) &&
      !standing.some((r) => overlaps(r, footprint(o.position, o.footprint.width, o.footprint.depth))),
  );
  return { ...s, objects: [...objects, ...additions] };
}
/**
 * v8: the neighbours move in. Two people at their porches, nothing built yet; the houses next
 * door stop being "empty" in their description when nobody has changed it. Nothing else moves.
 */
function addNeighbours(s: Record<string, unknown>): Record<string, unknown> {
  const lived = new Map(NEIGHBOURS.map((n) => [n.houseId, n.name]));
  const describe = (o: SafehouseObject) =>
    lived.has(o.id) && o.blueprint.description === 'Empty house next door'
      ? { ...o, blueprint: { ...o.blueprint, description: `${lived.get(o.id)} lives here` } }
      : o;
  const combat = s.combat as CombatState;
  return {
    ...s,
    objects: (s.objects as SafehouseObject[]).map(describe),
    combat: { ...combat, archive: combat.archive.map(describe) },
    neighbours: freshNeighbours(),
  };
}
/**
 * v9: the neighbours stop hoarding. They kept up to 22 pieces each and rotated whims forever,
 * which made them the largest thing in the scene; from here they keep OWNED_SLOTS yard pieces
 * and redo those instead of adding more.
 *
 * Each neighbour keeps their newest few yard pieces and the surplus is **dropped outright**,
 * not archived: `planRepair` searches the archive and would rebuild them straight back, which
 * would undo the cull on the first quiet afternoon. So designs are lost here — take a backup
 * before deploying this (`data/world-safehouse.pre-v9-themes-<stamp>.json`). Defenses, pets,
 * lights, kennels, Rook's crate and both houses are untouched: they sit outside the cap.
 * Anything in flight is let go, since the piece it pointed at may be one of the dropped ones.
 * The wave clock and combat are left exactly as they were — removing scenery starts nothing.
 */
function capYards(s: Record<string, unknown>): Record<string, unknown> {
  const combat = s.combat as CombatState;
  let objects = s.objects as SafehouseObject[];
  let archive = combat.archive;
  const dropped = new Set<string>();
  for (const spec of NEIGHBOURS) {
    const mine = [...objects, ...archive].filter((o) => o.owner === spec.id && yardPiece(o));
    // Newest first, standing ahead of rubble: those are the ones worth keeping.
    const ranked = [...mine].sort((a, b) => {
      const standing = (o: SafehouseObject) => (objects.includes(o) && intact(o) ? 1 : 0);
      return standing(b) - standing(a) || b.createdAt - a.createdAt;
    });
    for (const o of ranked.slice(OWNED_SLOTS)) dropped.add(o.id);
  }
  objects = objects.filter((o) => !dropped.has(o.id));
  archive = archive.filter((o) => !dropped.has(o.id));
  const neighbours = (s.neighbours as NeighbourState[]).map((n) => ({
    ...n,
    job: undefined,
    path: [],
    activity: 'idle' as const,
    impulses: [],
    wish: undefined,
  }));
  return {
    ...s,
    objects,
    neighbours,
    combat: { ...combat, archive },
    edits: (s.edits as SafehouseState['edits']).filter((e) => !dropped.has(e.objectId)),
    targets: (s.targets as SafehouseState['targets']).filter((t) => !dropped.has(t.objectId)),
  };
}
export function migrateState(raw: unknown, version: number): SafehouseState {
  if (![1, 2, 3, 4, 5, 6, 7, 8].includes(version) || !raw || typeof raw !== 'object')
    throw new Error('Unsupported safehouse save version');
  // Step through each version so a v1 world gets every later addition exactly once.
  let s = { ...(raw as Record<string, unknown>) };
  if (version < 2)
    s = { targets: [], idlePath: [], generationPaused: false, callsRemaining: defaultAllowance(), ...s };
  if (version < 3)
    s = {
      ...s,
      combat: freshCombat(true),
      objects: [...(s.objects as SafehouseObject[]).map(initializeObject), ...fenceObjects()],
    };
  if (version < 4) {
    const existing = new Set((s.objects as SafehouseObject[]).map((o) => o.id));
    // Migration must never start combat: new destructible pieces arrive with zombies paused.
    s = {
      ...s,
      objects: [...(s.objects as SafehouseObject[]), ...sceneryObjects().filter((o) => !existing.has(o.id))],
      combat: { ...(s.combat as CombatState), paused: true },
    };
  }
  if (version < 5) s = relayHouse(s);
  if (version < 6) s = addWaves(s);
  if (version < 7) s = addBlock(s);
  if (version < 8) s = addNeighbours(s);
  if (version < 9) s = capYards(s);
  return stateSchema.parse({ ...s, version: STATE_VERSION });
}
export function createInitialState(): SafehouseState {
  return {
    version: STATE_VERSION,
    combat: freshCombat(true),
    targets: [],
    idlePath: [],
    generationPaused: false,
    callsRemaining: defaultAllowance(),
    objects: [],
    jobs: [],
    neighbours: freshNeighbours(),
    survivor: { position: { ...SURVIVOR_START }, activity: 'idle', facing: Math.PI },
    lighting: 'day',
    worldRevision: 0,
    notice: 'Tell me what to build, or what to move. Everything here is fair game.',
    seen: [],
    edits: [],
  };
}
export const active = (job: Job) => !['complete', 'failed'].includes(job.status);
