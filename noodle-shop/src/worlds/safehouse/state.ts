import { z } from 'zod';
import { blueprintSchema, measureBlueprint, SCENERY_LIMITS, CHAT_LIMITS } from './blueprint';
import { SURVIVOR_START, HOUSE_ID, footprint, inflate, overlaps } from '../../shared/safehouseLayout';
import { freshCombat, freshWave, fenceObjects, initializeObject, intact, MAX_ZOMBIES } from './combat';
import { sceneryObjects, RETIRED_SCENERY_IDS, RELAID_SCENERY_IDS, BLOCK_SCENERY_IDS } from './scenery';
import { choosePlacement } from './placement';
import type {
  CombatState,
  SafehouseObject,
  JobStatus,
  GroundPoint,
  SurvivorActivity,
} from '../../shared/safehouseTypes';
const point = z.object({ x: z.number().finite(), z: z.number().finite() });
/** Bumped together with the schema and migration below; index.ts reads it so the two can never disagree. */
export const STATE_VERSION = 7;
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
});
export interface SafehouseState {
  version: 7;
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
  objects: SafehouseObject[];
  jobs: Job[];
  survivor: { position: GroundPoint; activity: SurvivorActivity; facing: number };
  lighting: 'day' | 'night';
  worldRevision: number;
  notice: string;
  seen: string[];
  edits: { objectId: string; previous?: SafehouseObject; revision: number }[];
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
  version: z.literal(7),
  combat: combatSchema,
  targets: z.array(z.object({ userId: z.string(), objectId: z.string() })).max(200),
  idlePath: z.array(point).max(2000),
  generationPaused: z.boolean(),
  callsRemaining: z.number().int().min(0).max(1_000_000),
  allowanceEnforced: z.boolean().optional(),
  callsUsed: z.number().int().nonnegative().optional(),
  repairsPaused: z.boolean().optional(),
  objects: z.array(objectSchema).max(600),
  jobs: z.array(jobSchema).max(40),
  survivor: z.object({
    position: point,
    activity: z.enum(['idle', 'walking', 'building', 'repairing']),
    facing: z.number().finite(),
  }),
  lighting: z.enum(['day', 'night']),
  worldRevision: z.number().int().nonnegative(),
  notice: z.string(),
  seen: z.array(z.string()).max(1000),
  edits: z
    .array(z.object({ objectId: z.string(), previous: objectSchema.optional(), revision: z.number() }))
    .max(20),
});
export function defaultAllowance(): number {
  const n = Number(process.env.SAFEHOUSE_CALL_ALLOWANCE ?? 20);
  return Number.isInteger(n) && n >= 0 && n <= 10000 ? n : 20;
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
export function migrateState(raw: unknown, version: number): SafehouseState {
  if (![1, 2, 3, 4, 5, 6].includes(version) || !raw || typeof raw !== 'object')
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
    survivor: { position: { ...SURVIVOR_START }, activity: 'idle', facing: Math.PI },
    lighting: 'day',
    worldRevision: 0,
    notice: 'Tell me what to build, or what to move. Everything here is fair game.',
    seen: [],
    edits: [],
  };
}
export const active = (job: Job) => !['complete', 'failed'].includes(job.status);
