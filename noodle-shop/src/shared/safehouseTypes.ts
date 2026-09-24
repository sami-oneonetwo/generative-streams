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
/**
 * Part motion the page applies every frame, by part index. Data, not code: the app owns the four
 * kinds and clamps every number (rules.ts). `sway` rotates the part about its own centre on `axis`
 * (chains, stems, wings), `drift` slides it along `axis` (a canopy in the wind), `spin` turns it
 * continuously (wheels, dishes), `bob` lifts and lowers it. Speed in cycles per second, amplitude
 * in radians for sway and metres for drift/bob.
 */
export interface PartAnimation {
  part: number; // index into blueprint.parts
  kind: 'sway' | 'drift' | 'spin' | 'bob';
  axis?: 'x' | 'y' | 'z'; // default: z for sway, x for drift, y for spin
  speed?: number; // cycles (or revolutions) per second; default 0.3
  amplitude?: number; // default 0.08 rad / 0.08 m
  phase?: number; // radians, so identical parts do not move in lockstep
}
export interface Blueprint {
  name: string;
  description: string;
  parts: Primitive[];
  /** Small; rides in every snapshot with the view rather than with the parts. Absent means still. */
  animations?: PartAnimation[];
}
/**
 * What a piece is for, in the app's closed vocabulary. Hand-authored on the neighborhood and the
 * neighbours' catalogue today; rules (below) refer to pieces by these, never by name.
 *   perch  birds land on it (a tree, a pole, a fence, a roof, a bird bath)
 *   seat   a person or a cat can sit on it
 *   scare  birds keep clear of it (a scarecrow)
 *   tree   a tree, for anything that only wants trees
 *   vehicle a car or a van
 *   hoop   a basketball hoop: Jake shoots at it when he has nothing on
 *   trap   a hole or pit: ground (passable), and anything that walks into it is held a while — a
 *          zombie, a creature, the cat; runners jump it, brutes climb out fast, flyers never land in it.
 *          Rook and the neighbours walk round it; the horde does not. Marge fills holes in.
 *   music  speakers: the horde within earshot comes for the sound and dances before it chews;
 *          idle people dance to it; Marge unplugs it when it has gone on long enough.
 */
export type Use = 'perch' | 'seat' | 'scare' | 'tree' | 'vehicle' | 'hoop' | 'trap' | 'music';
export const USES: readonly Use[] = ['perch', 'seat', 'scare', 'tree', 'vehicle', 'hoop', 'trap', 'music'];
/** Fixed behaviours the app knows how to run; the model only picks one. Profiles live in combat.ts. */
export type CreatureBehaviour = 'rampage' | 'fight' | 'zoom' | 'roam';
/**
 * The rule grammar (state v9, "small life"): when / target / do, with the app's numbers. A creature
 * with rules runs them ahead of its preset behaviour each tick (rules.ts); the first rule whose
 * trigger fires and whose target resolves takes the tick, and `near` rules may interrupt a goal.
 * Nothing here is model-authored yet: the design call learns the grammar in a later slice, and the
 * interpreter clamps every number regardless of who wrote it.
 */
export type RuleTrigger = 'tick' | 'near' | 'night' | 'day';
export type RuleAction = 'visit' | 'perch' | 'flee';
export interface RuleTarget {
  tag?: Use; // pieces with this use
  kind?: 'zombie' | 'creature' | 'rook' | 'neighbour' | 'viewer'; // movers
  pick?: 'nearest' | 'random'; // default nearest
  within?: number; // metres; the interpreter clamps it
}
export interface Rule {
  when: RuleTrigger;
  target?: RuleTarget;
  do: RuleAction;
  dwell?: [number, number]; // seconds to stay once there (visit/perch); clamped
}
/** What a rule has committed a creature to right now. */
export interface CreatureGoal {
  rule: number; // index into the object's rules
  targetId?: string; // the piece or mover it is about
  point?: GroundPoint; // where it is heading
  dwellMs: number; // time left at the destination once reached; counts down
  arrived?: boolean;
  /** Sitting on top of the target: the flyer settles to this height and the page stills its gait. */
  perched?: boolean;
  altitude?: number; // metres, when perched
}
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
  /** A fighter built to go after one particular creature: it hunts that id first, wherever it is on the block. */
  nemesis?: string;
  /**
   * A vendetta (grudges): the lowercased chatter whose creatures this fighter goes for first, hostile
   * or not, ahead of its usual targets. Set and cleared by the neighbour who holds the grudge.
   */
  nemesisOwner?: string;
  /** What its rules have it doing (rules.ts); absent while the preset behaviour has the tick. */
  goal?: CreatureGoal;
  /** Countdown after a scare before its rules may pick a perch again, so it does not land straight back. */
  scaredMs?: number;
  /** Stuck in a hole (a `trap` piece): no moving or hitting until this runs out. Flyers are never held. */
  heldMs?: number;
  /** Grace after climbing out, so the same hole does not take it straight back. */
  freeMs?: number;
  /** Squaring up to a viewer's figure (a `fight` verb, crowd.ts): stands its ground facing them, no behaviour until this runs out. */
  busyMs?: number;
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
  /** Built and kept up by a neighbour (their id): fixed like the rest of the neighborhood, theirs to repair, never a zombie's target. */
  owner?: string;
  /** What the piece is for (closed vocabulary); rules and idle behaviour find pieces by these. */
  uses?: Use[];
  /** Behaviour as data, run by rules.ts every tick for a creature; at most a handful per object. */
  rules?: Rule[];
  /**
   * The block's own small life (wildlife.ts): birds, a cat, rats. Counts against nobody's budget,
   * is never repaired or archived — a downed one is removed and the pool refills after a while.
   */
  wild?: boolean;
  /** Built by a chatter for a neighbour ("build marge a bench"): their id. Still the chatter's creation; the neighbour takes it as amends. */
  giftTo?: string;
  /** The one thing a viewer can do at this piece by typing `!word` (PieceVerb); absent for most pieces. */
  verb?: PieceVerb;
  /** On a run under a viewer (`!drive`): drawn at `driven.at`, turned by `driven.turn`, until the run ends. */
  driven?: DrivenState;
}
/**
 * How someone on the block regards a chatter (grudges). Positive is a grudge, negative a favour:
 * Marge only ever climbs, Jake only ever warms, Rook holds a small grudge of his own. Keyed by
 * lowercased username. Scores decay slowly and persist in the save, so a chatter who wrecked the
 * garden on Tuesday finds Marge still cold on Friday.
 */
export interface Regard {
  score: number;
  since: number; // when it started this time
  lastAt: number; // last change
  reason?: string; // the last thing that moved it, for Rook's summary ("the gorilla ate the beans")
  acts?: number; // grudge acts taken so far
  lastActAt?: number;
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
  /** In a hole (combat time): held still, an easy shot; `heldIn` is the trap piece. */
  heldUntil?: number;
  heldIn?: string;
  /** Just climbed out: the same hole leaves it alone until this passes. */
  freeUntil?: number;
  /** Beside a `music` piece: dancing before it chews (combat time). */
  dancingUntil?: number;
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
/** `repairing` is Rook fixing zombie damage on his own; the client swings the hammer harder. `sitting`: nothing on for a while, on the porch steps or a nearby seat; `dancing`: the same, with speakers in earshot. */
export type SurvivorActivity = 'idle' | 'walking' | 'building' | 'repairing' | 'sitting' | 'dancing';
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
  animations?: PartAnimation[]; // present only when the piece moves
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
      ...(blueprint.animations?.length ? { animations: blueprint.animations } : {}),
    },
  };
}
/** The key the page caches geometry under. */
export const partsKey = (id: string, revision: number): string => `${id}:${revision}`;
/** `playing`: shooting at a hoop; `sitting`: on a seat; `waving`: at the crowd on the pavement; `dancing`: to a `music` piece. */
export type NeighbourActivity =
  | 'idle'
  | 'walking'
  | 'building'
  | 'repairing'
  | 'tending'
  | 'painting'
  | 'looking'
  | 'playing'
  | 'sitting'
  | 'waving'
  | 'dancing';
/** A neighbour as the page draws them: where they are, what they are doing, the piece in flight, what they just said. */
export interface NeighbourView {
  id: string;
  name: string;
  position: GroundPoint;
  facing: number;
  activity: NeighbourActivity;
  alert: boolean; // responding to a creature right now
  tint: string; // shirt colour
  hat: 'sun' | 'cap';
  job?: {
    label: string;
    status: 'walking' | 'working';
    progress: number;
    purpose: 'defense' | 'upkeep' | 'project';
    preview?: SafehouseObject; // a new build's ghost, full geometry inline like Rook's
    /** The piece being used (a hoop, a seat): where the page aims the ball or seats the figure. */
    at?: GroundPoint;
  };
  say?: { text: string; until: number };
  /** The look they are currently redoing their yard in, read off the block; shown on their tag. */
  theme?: string;
  /** The chatter they feel most strongly about right now and the phrase for the tag ("not speaking to dave", "big fan of erin"). */
  regard?: { user: string; score: number; phrase: string };
}
/**
 * A viewer on the pavement across the street (crowd.ts): whoever has spoken in chat lately gets a
 * small figure that waves when they speak, drifts along the pavement to watch their own build go
 * up, and runs for the ends of the block when a wave lands. Kick usernames already show in Rook's
 * bubble; the tag over the head is the same content.
 */
/**
 * Verbs as data (verbs.ts). A piece may carry one verb: the word chat types after `!`, the pose the
 * figure holds there, whether they stand on it or beside it, for how long, and the word that pops over
 * the head. The word comes from a closed dictionary and the pose from a closed menu, so the model only
 * ever picks; the app owns the jog there, the pose, the pop and the cooldown. `!shoot`, `!honk` and
 * `!dance` stay hand-written on top (the ball, the horn, the scoreboard).
 */
export const VERB_WORDS = [
  'swim', 'bounce', 'jump', 'sit', 'lie', 'sleep', 'nap', 'rest', 'ring', 'climb', 'slide', 'swing',
  'kick', 'punch', 'drink', 'eat', 'cook', 'fish', 'pray', 'meditate', 'hide', 'read', 'wave', 'cheer',
  'pose', 'salute', 'bow', 'knock', 'push', 'pull', 'spin', 'hug', 'pat', 'feed', 'water', 'sweep',
  'run', 'hop', 'stretch', 'toast',
  'drive', 'ride', 'fight',
] as const;
export type VerbWord = (typeof VERB_WORDS)[number];
/**
 * Three words do more than hold a pose (crowd.ts): `drive` (and `ride` on something that does not
 * move by itself) takes the piece up the street and back with the figure aboard — the piece's true
 * position never changes, the page draws it where `driven.at` says; `ride` on a living build sits the
 * figure on its back while it goes about its business; `fight` on a living build is a scrap with a
 * result. A living build may carry only `ride` or `fight`.
 */
export const CREATURE_VERB_WORDS = ['ride', 'fight'] as const;
export const isCreatureVerb = (word: string): boolean => (CREATURE_VERB_WORDS as readonly string[]).includes(word);
/** The words the app moves a piece for (`!drive`, or `!ride` on a piece that cannot move by itself). */
export const isRunVerb = (word: string): boolean => word === 'drive' || word === 'ride';
/**
 * A piece on a run (`!drive`): where the page should draw it right now and which way it is turned,
 * relative to how it was designed (`turn`, radians about y). Transient — the true position stands
 * where it was, other movers still route round the parking spot, and a restart clears it.
 */
export interface DrivenState {
  at: GroundPoint;
  turn: number;
  by: string; // the driver's name as typed, for the tag
  until: number; // server time the run is over at the latest
}
/** What the page can draw a figure doing; every verb maps to one of these. */
export const VERB_POSES = ['stand', 'swim', 'jump', 'sit', 'lie', 'wave', 'cheer', 'punch'] as const;
export type VerbPose = (typeof VERB_POSES)[number];
export interface PieceVerb {
  word: VerbWord;
  pose: VerbPose;
  /** `on`: stand on or in the piece (a pool, a trampoline, a bench); `beside`: stand next to it (a bell, a bar). */
  spot: 'on' | 'beside';
  seconds: number; // how long they do it; clamped 3–20
  pop?: string; // what pops over the head on arrival ("SPLASH"); default the word upper-cased
}
/**
 * A viewer off the pavement on an errand a chat verb sent them on (verbs.ts): jogging to a hoop or a
 * piece with a verb, doing the thing, jogging back. Positions come from the server as always; the page
 * only poses.
 */
export type ErrandPhase = 'going' | 'doing' | 'returning';
export interface CrowdView {
  id: string; // the chatter's userId
  name: string;
  position: GroundPoint;
  facing: number;
  wavedAt: number; // server time they last spoke: the page raises an arm for a couple of seconds
  running?: boolean; // scattering from or returning after a wave
  watching?: string; // the id of the piece they walked over to see
  /**
   * On an errand: `shoot` is the hoop (the throw during `doing`); `verb` is a piece's own verb, with
   * the pose to hold during `doing` and the height to stand at (`y`, metres; on a piece's top, else 0).
   */
  errand?: {
    kind: 'shoot' | 'verb';
    phase: ErrandPhase;
    targetId: string;
    word?: VerbWord;
    pose?: VerbPose;
    y?: number;
    /** A `fight` decided: the figure celebrates (`cheer`) or lies flat (`lie`) for a moment before heading home. */
    result?: 'won' | 'lost';
  };
  /** The last shot they took (server time): the page pops SWISH or MISS over the head for a moment. */
  shot?: { hit: boolean; at: number };
  /** A verb's pop word ("SPLASH") and when it went up (server time); shown for a couple of seconds. */
  pop?: { text: string; at: number };
  /** `!dance`: bouncing on the pavement until this server time. */
  dancingUntil?: number;
}
/** A chat verb and what unlocks it, for the HUD hint and `!verbs`. */
export interface VerbView {
  verb: string; // "!shoot"
  needs: string; // "a basketball hoop"
  unlocked: boolean;
}
/** A hoops scoreboard row. */
export interface HoopsRow {
  user: string;
  hits: number;
  shots: number;
  streak: number;
}
/** Something brief that happened on the block for the page to show (a horn): kept a few seconds, never saved for long. */
export interface WorldEffect {
  id: number;
  kind: 'honk';
  objectId: string;
  user: string;
  at: number; // server time
}
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
  /** The people next door and what they are up to (state v8). */
  neighbours?: NeighbourView[];
  neighboursPaused?: boolean;
  /** Viewers on the pavement (crowd.ts); absent or empty when nobody has spoken lately or the operator hid them. */
  crowd?: CrowdView[];
  crowdHidden?: boolean;
  /** Chat verbs and whether a piece that unlocks each one stands (verbs.ts). */
  verbs?: VerbView[];
  /** The hoops scoreboard, best shooters first; absent when nobody has shot lately. */
  hoops?: HoopsRow[];
  /** Brief happenings for the page (a horn); the last few seconds' worth. */
  effects?: WorldEffect[];
  /** The operator has sent the block's birds, cat and rats away (wildlife.ts). */
  wildlifePaused?: boolean;
}
