// Shared scene data. Model output is validated server-side before it reaches here.
/** What chat types after "#": eight hex chars of a generated id, or a readable seeded id in full. */
export const shortRef = (id: string): string => (/^[0-9a-f]{8}-/i.test(id) ? id.slice(0, 8) : id);
export type Vec3 = [number, number, number];
export interface GroundPoint {
  x: number;
  z: number;
}
export interface Primitive {
  shape: 'box' | 'cylinder' | 'sphere' | 'cone';
  position: Vec3;
  size: Vec3;
  rotation: Vec3;
  color: string;
}
export interface Blueprint {
  name: string;
  description: string;
  parts: Primitive[];
}
/** Fixed behaviours the app knows how to run; the model only picks one. Profiles live in combat.ts. */
export type CreatureBehaviour = 'rampage' | 'fight' | 'zoom' | 'roam';
/** A living object: where it is heading, what it is after, and the client's gait hints. */
export interface CreatureState {
  behaviour: CreatureBehaviour;
  facing: number;
  moving: boolean;
  path: GroundPoint[];
  targetId?: string; // an object id, or a zombie id ("z12") for fighters
  replanMs: number; // countdown until it picks a new target or leg
  cooldownMs: number; // countdown until its next hit
  hits?: number; // hits landed on the current target; a rampage moves on after a few
  /** Airborne: flies straight over everything at roof height; only turrets and other flyers can reach it. */
  flying?: boolean;
  altitude?: number; // metres off the ground right now (flyers climb after they are built, fall when downed)
}
export interface SafehouseObject {
  id: string;
  revision: number;
  blueprint: Blueprint;
  position: GroundPoint;
  footprint: { width: number; depth: number };
  createdBy: string;
  editedBy: string;
  createdAt: number;
  role?: 'decoration' | 'barrier' | 'turret';
  health?: number;
  maxHealth?: number;
  damageRevision?: number;
  lifecycle?: number;
  destroyedAt?: number;
  nextShotAt?: number;
  fixed?: boolean; // seeded neighborhood piece; still editable, movable and destructible
  passable?: boolean; // ground surface: never blocks, never targeted
  creature?: CreatureState; // a living build: moves on its own, never blocks anything
}
/** Server-owned zombie profiles (stats live in combat.ts); older saves have no kind and are walkers. */
export type ZombieKind = 'walker' | 'runner' | 'brute';
export interface Zombie {
  id: string;
  kind?: ZombieKind;
  position: GroundPoint;
  health: number;
  maxHealth?: number;
  facing: number;
  targetId?: string;
  attackAt: number;
  path: GroundPoint[];
  replanAt: number;
}
export interface Shot {
  id: number;
  from: GroundPoint;
  to: GroundPoint;
  toY?: number; // height of the mark when it is a flyer; zombies are hit at chest height
  at: number;
}
/** Tower-defence pacing: a prep countdown, then a queued roster that grows with the wave number. */
export interface WaveState {
  number: number; // the wave being prepared for or fought
  phase: 'prep' | 'wave';
  phaseEndsAt: number; // combat time: prep → wave start; wave → straggler cut-off
  queue: ZombieKind[]; // still to spawn this wave
  nextSpawnAt: number;
  spawned: number;
  killed: number;
  best: number; // highest wave cleared with the house standing
  fell?: number; // wave on which the house last fell
  warned?: number; // ms mark of the last prep warning spoken (60000, 10000)
  fellThisWave?: boolean;
}
export interface CombatState {
  paused: boolean;
  time: number;
  sequence: number;
  kills: number;
  zombies: Zombie[];
  shots: Shot[];
  archive: SafehouseObject[];
  wave: WaveState;
}
export type JobStatus = 'queued' | 'designing' | 'walking' | 'building' | 'complete' | 'failed';
/** `repairing` is Rook fixing zombie damage on his own; the client swings the hammer harder. */
export type SurvivorActivity = 'idle' | 'walking' | 'building' | 'repairing';
export interface SafehouseJobView {
  id: string;
  label: string;
  requestedBy: string;
  status: JobStatus;
  progress: number;
  error?: string;
  preview?: SafehouseObject;
}
/**
 * What the wire carries per object: everything but the geometry. Parts are fetched once per
 * id+revision (POST /api/objects/parts, batched per snapshot) and cached by the page, so a
 * snapshot of a hundred objects is tens of kilobytes rather than hundreds, twice a second.
 */
export interface BlueprintView {
  name: string;
  description: string;
  partCount: number;
  color: string; // the first part's colour: the tint for hit dust
}
export type SafehouseObjectView = Omit<SafehouseObject, 'blueprint'> & { blueprint: BlueprintView };
export type CombatView = Omit<CombatState, 'archive'> & { archive: SafehouseObjectView[] };
export function viewOf(o: SafehouseObject): SafehouseObjectView {
  const { blueprint, ...rest } = o;
  return {
    ...rest,
    blueprint: {
      name: blueprint.name,
      description: blueprint.description,
      partCount: blueprint.parts.length,
      color: blueprint.parts[0]?.color ?? '#b3ab98',
    },
  };
}
/** The key the page caches geometry under. */
export const partsKey = (id: string, revision: number): string => `${id}:${revision}`;
export interface SafehouseScene {
  schema: 1;
  fixture: boolean;
  lighting: 'day' | 'night';
  objects: SafehouseObjectView[];
  survivor: { position: GroundPoint; activity: SurvivorActivity; facing: number };
  current?: SafehouseJobView; // the preview inside keeps its full geometry: one object, in flight
  pending: SafehouseJobView[];
  recent: SafehouseJobView[];
  notice: string;
  generationAvailable: boolean;
  generationPaused: boolean;
  callsRemaining: number;
  /** Operator switch: false means the allowance is ignored and calls are unlimited (still counted). */
  allowanceEnforced: boolean;
  callsUsed: number;
  worldRevision: number;
  combat?: CombatView;
  repairsPaused?: boolean;
  /** Human roster of the wave being prepared for, e.g. "6 walkers, 1 runner". */
  upcomingWave?: string;
}
