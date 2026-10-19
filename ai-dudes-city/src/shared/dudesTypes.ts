// The ai-dudes wire and state vocabulary. Every chatter has a dude in the field, and every dude is
// driven by its own agent: the chatter's messages go straight to it, it answers in a closed grammar
// (say / build / edit / remove / move / emote / look / persona / remember), and the world runs that.
// The agent never writes code and never touches anyone else's things; every number is the app's.
import type { GroundPoint, SafehouseObject, SafehouseObjectView } from './objectTypes';

export const HATS = ['none', 'cap', 'beanie', 'tophat', 'cowboy', 'crown', 'bucket', 'helmet', 'party', 'headband', 'wizard', 'propeller'] as const;
export type Hat = (typeof HATS)[number];
export const ACCESSORIES = ['none', 'backpack', 'cape', 'scarf', 'glasses', 'toolbelt'] as const;
export type Accessory = (typeof ACCESSORIES)[number];
/** What a dude looks like. Colours are `#rrggbb`; height and build are clamped scale factors. */
export interface DudeLook {
  skin: string;
  shirt: string;
  pants: string;
  hair: string;
  hat: Hat;
  hatColor: string;
  accessory: Accessory;
  accessoryColor: string;
  height: number; // 0.85–1.15
  build: number; // 0.85–1.2: shoulders and body width
}
export const LOOK_LIMITS = { height: [0.85, 1.15] as const, build: [0.85, 1.2] as const };

/** Poses the page can draw. `sit`, `lie` and `think` hold until the dude does something else. */
export const EMOTES = ['wave', 'cheer', 'dance', 'sit', 'lie', 'jump', 'punch', 'bow', 'think', 'point', 'kick', 'hug', 'push', 'lean', 'drive', 'highfive', 'handshake', 'laugh', 'shrug', 'stagger', 'chop', 'hammer', 'cast', 'shoot', 'swing', 'strum', 'swim', 'lift', 'paint'] as const;
export type Emote = (typeof EMOTES)[number];

/** `designing`: at the build site on their lot with the plans out, while the design is being drawn up. */
export type DudeActivity = 'idle' | 'walking' | 'building' | 'emote' | 'sleeping' | 'using' | 'designing';

/**
 * Ways to use any build (the agent's `use` action). The app owns the motion for each; the agent only
 * picks the build, the way, and for a run where to go. `drive`/`ride` take the build along with the
 * character aboard and park it where the run ends; `sit`/`lie`/`stand` put the character on top;
 * `enter` hides them inside a while; `push` shoves it a few metres; `fix` undoes what a troublemaker did
 * to it (paint, squash); the rest are poses beside it.
 */
export const USE_HOWS = ['drive', 'ride', 'sit', 'lie', 'stand', 'enter', 'push', 'hug', 'kick', 'punch', 'lean', 'look', 'dance', 'fix', 'fire'] as const;
export type UseHow = (typeof USE_HOWS)[number];
export type JobKind = 'build' | 'edit' | 'remove';
export type JobStatus = 'queued' | 'designing' | 'ready' | 'walking' | 'building' | 'done' | 'failed';

/** A dude as the page draws it. Positions are server-authoritative; the page slides between snapshots. */
export interface DudeView {
  id: string; // the chatter's userId
  name: string; // as last typed
  title?: string; // a few words the agent chose ("the pigeon whisperer"), shown on the tag
  position: GroundPoint;
  facing: number; // radians, atan2(dx, dz)
  activity: DudeActivity;
  look: DudeLook;
  /** Holding a pose until this server time (or, for sit/lie/think, until it does something else). */
  emote?: { pose: Emote; until: number };
  say?: { text: string; until: number; placard?: boolean };
  /** Metres off the ground: on top of a build, or aboard one. Absent means on the ground. */
  y?: number;
  /** Inside a build (`use` … `enter`): not drawn until it comes out. */
  hidden?: boolean;
  /** Aboard this object (drive/ride): the server moves the character with the object's `driven.at`. */
  riding?: string;
  /** Using a build: heading there, or doing it. The pose to draw is in `emote`. */
  use?: { how: UseHow; targetId: string; phase: 'going' | 'doing' };
  /** Knocked out until this server time: lying flat, seeing stars; gets back up after. */
  ko?: number;
  /** On the way to attack something (walking into range, or running from a lit bomb). */
  attacking?: { with: AttackWith; targetId: string };
  /** A troublemaker the field sends in (events.ts), not a chatter: drawn like a character, tagged differently. */
  npc?: boolean;
  /** One of the town's own residents (city.ts): no chatter behind them; a quieter tag, no mood. */
  resident?: boolean;
  /** The streamer's own figure (mayor.ts): moved from the operator page, drawn with a gold tag. */
  mayor?: boolean;
  /** How they are doing, 0..100 (the average of their needs): the diamond over their head. */
  mood?: number;
  /** Their coins (§), for the inspect panel. */
  coins?: number;
  /** Their needs, for the inspect panel. */
  needs?: { hunger: number; energy: number; fun: number; social: number };
  /** Their lot's address (or "rents a flat"), for the inspect panel. */
  address?: string;
  /** Acting something out (a bit): what is going on, for under the name, and what they are holding. */
  bit?: { caption: string; prop?: BitProp };
  /** Drawn this many times bigger (a boss). */
  scale?: number;
  /** Its agent is mid-turn right now: the page shows a thought bubble. */
  thinking?: boolean;
  /** Spoke within the last couple of seconds: the page waves an arm. */
  heardAt?: number;
  /** The chatter has been quiet a while: the dude naps where it is (or sleepwalks after the group), dimmed. */
  away?: boolean;
  /** Collectables, grouped: [kind, how many], oldest kind first. */
  badges?: [string, number][];
  /** Show every badge (the chatter asked to see them) rather than the newest few. */
  badgesOpen?: boolean;
  job?: {
    id: string;
    kind: JobKind;
    label: string;
    status: JobStatus;
    progress: number; // 0..1 while building
    /** A new build's or an edit's ghost, full geometry inline (one object per dude in flight). */
    preview?: SafehouseObject;
    at?: GroundPoint; // where the work is
    /** While designing on a lot: the size of the square marked out for it (metres a side). */
    site?: number;
  };
}

export interface FeedItem {
  at: number;
  text: string;
}

/** What a character can hold while acting something out (a bit). */
export const BIT_PROPS = ['sign', 'drink', 'flowers', 'megaphone'] as const;
export type BitProp = (typeof BIT_PROPS)[number];
/** Bursts a bit can go off with. */
export const BIT_BURSTS = ['sparkles', 'smoke', 'confetti', 'hearts'] as const;
export type BitBurst = (typeof BIT_BURSTS)[number];

/** Ways to attack (the agent's `attack` action). Cartoon violence: a knocked-out character gets back up. */
export const ATTACKS = ['shove', 'punch', 'kick', 'shoot', 'throw', 'bomb'] as const;
export type AttackWith = (typeof ATTACKS)[number];

/**
 * Something brief for the page to show, played once per id: a build rattled (`shake`), a shot or a
 * thrown thing flying from one point to another (`shot`, `throw`), a lit bomb sitting on the ground
 * until it goes off (`bomb`, `until`), the explosion (`boom`, `radius`), a character knocked out (`ko`).
 */
export interface FieldEffect {
  id: number;
  kind: 'shake' | 'shot' | 'throw' | 'bomb' | 'boom' | 'ko' | 'splash' | 'slam' | 'coins' | 'pop' | 'burst';
  at: number; // server time
  objectId?: string;
  dudeId?: string;
  from?: GroundPoint;
  to?: GroundPoint;
  until?: number;
  radius?: number;
  /** `coins`: how many changed hands, floated up over the place (objectId) or a point (to). */
  amount?: number;
  /** `pop`: a word floated up over someone doing something at a build ("SWISH"), and the pose, for the sound.
   * `burst`: which (sparkles, smoke, confetti, hearts). */
  label?: string;
  pose?: string;
}

/** What a troublemaker is up to, for a banner across the top while it lasts. */
export interface HappeningView {
  kind: string;
  title: string; // "GARY THE PAINTER"
  text: string; // "is repainting everyone's builds. Ask your character to fix yours."
  until?: number; // server time a deadline runs out (the mayor's decree)
  /** Progress bars under the text (a challenge: who is across, the bridge, the boss's health). */
  bars?: { label: string; value: number; note?: string }[];
}

/** A wish the Listener heard from chat, for the stream's "chat wants" panel. */
export interface WishView {
  wish: string;
  count: number;
  status: 'works-now' | 'needs-feature' | 'blocked';
}

export interface ScoreRow {
  name: string;
  kos: number; // knocked others out
  downs: number; // got knocked out
}

/** The Mayor (the streamer's figure) and the camera the operator page is steering. */
export interface MayorView {
  position: GroundPoint;
  facing: number;
  moving: boolean;
  running?: boolean;
  say?: { text: string; until: number };
  emote?: { pose: Emote; until: number };
  /** The operator's camera: yaw (radians), orthographic half-height (metres), and where it looks (the Mayor, unless set free). */
  cam: { yaw: number; half: number; x?: number; z?: number };
  /** The stream view follows the Mayor's camera (otherwise it frames everyone, as before). */
  follow: boolean;
  /** The operator page is open and sending. */
  live: boolean;
  /** The operator has hidden the Mayor: the camera still follows where he is, but nobody sees him. */
  hidden?: boolean;
  /** Aboard a build: which, how it gets about (and so how fast he can take it), where he sits, how high a flyer is. */
  riding?: { id: string; moves: 'roam' | 'drive' | 'fly' | 'vehicle'; seat: number; altitude: number; size: number };
  /** The stream's sound as the operator set it (0..1): music, and everything else. */
  audio?: { music: number; sfx: number };
  /** Bumped each time the server puts him somewhere (onto a court): the operator page jumps there too. */
  moved?: number;
}

/** The town for the page: who has which lot, named districts, what is popular, the project, a party. */
export interface TownView {
  name: string;
  lots: { id: string; owner: string; shirt: string; away: boolean }[];
  districts: { name: string; at: GroundPoint }[];
  /** What the town is missing, most pressing first. */
  wants: string[];
  /** The busiest places right now (build ids), busiest first. */
  hot: string[];
  project?: { name: string; status: string; coins: number; coinsNeed: number; work: number; workNeed: number; plot: string; preview?: SafehouseObject };
  party?: { title: string; at: GroundPoint; until: number };
  /** Visits and takings per place (build id → [visits, coins]), for the inspect panel. */
  places?: Record<string, [number, number]>;
}

export interface DudesScene {
  schema: 1;
  town?: TownView;
  mayor?: MayorView;
  /** The Mayor's builds in flight: designing (a site marked out) and going up (a ghost filling in). */
  mayorBuilds?: { id: string; label: string; status: JobStatus; at?: GroundPoint; site?: number; progress: number; preview?: SafehouseObject }[];
  /** What chat keeps asking for (the Listener), most wanted first; blocked wishes never appear. */
  wishes?: WishView[];
  /** Most knockouts first; absent until somebody has knocked somebody out. */
  scores?: ScoreRow[];
  happening?: HappeningView;
  /** The last few seconds' effects; the page plays each id once. */
  effects?: FieldEffect[];
  fixture: boolean;
  objects: SafehouseObjectView[];
  dudes: DudeView[];
  /** The last few things that happened, newest last. */
  feed: FeedItem[];
  ai: {
    available: boolean; // a key is configured or fixtures are on
    paused: boolean;
    enforced: boolean;
    callsRemaining: number;
    callsUsed: number;
    thinking: number; // agent turns in flight
    designing: number; // design calls in flight
    idleLife: boolean; // quiet characters take a turn of their own now and then
    events: boolean; // troublemakers come by
  };
  counts: { dudes: number; awake: number; builds: number };
  worldRevision: number;
}

export interface DudesAdminStatus {
  fixture: boolean;
  models: { agent: string; design: string; listener: string };
  ai: DudesScene['ai'] & { agentLimit: number; designLimit: number; waiting: number };
  dudes: {
    id: string;
    name: string;
    title?: string;
    persona: string;
    memory: string[];
    turns: number;
    builds: number;
    inbox: number;
    lastHeardAt: number;
    muted: boolean;
    lastError?: string;
  }[];
  objects: { id: string; name: string; createdBy: string; damage?: string }[];
  town?: TownView;
  happening?: HappeningView;
  nextHappeningInS?: number;
  listener?: {
    enabled: boolean;
    runs: number;
    buffered: number;
    lastRunAt: number;
    lastError?: string;
    tips: string[];
    wishes: (WishView & { id: string; askers: string[]; examples: string[]; how: string })[];
    /** The Builder's attempts at the wishes: a patch each (scripts/wish-builder.mjs). */
    proposals?: { id: string; wish: string; status: string; tests?: string; at: string }[];
  };
  jobs: { id: string; dude: string; kind: JobKind; label: string; status: JobStatus; error?: string }[];
}
