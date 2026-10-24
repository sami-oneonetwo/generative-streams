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
  /** The age's garment kit drawn over the figure (src/shared/outfits.ts), e.g. "stone:2". Set for the view, never saved. */
  outfit?: string;
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
  /** One of the age's caravan (their leader brings the asks); `asking` while the leader has asks open. */
  traveller?: boolean;
  leader?: boolean;
  asking?: boolean;
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
  /** Off somewhere on an errand of their own, why and where, for under the name: "hungry → Sara's Bakery". */
  heading?: string;
  /** Acting something out (a bit): what is going on, for under the name, and what they are holding. */
  bit?: { caption: string; prop?: BitProp };
  /** Drawn this many times bigger (a boss). */
  scale?: number;
  /** Its agent is mid-turn right now: the page shows a thought bubble. */
  thinking?: boolean;
  /** Its chatter has said something its agent hasn't got to yet (waiting for a free slot): a dim marker on the tag. */
  queued?: boolean;
  /** Spoke within the last couple of seconds: the page waves an arm. */
  heardAt?: number;
  /** The chatter has been quiet a while: the dude naps where it is (or sleepwalks after the group), dimmed. */
  away?: boolean;
  /** Walked by its chatter in person from the /play page: its own messages carry it between snapshots. */
  piloted?: boolean;
  /** Carrying a weapon (the Mayor's or a player's page, weapons.ts): drawn in hand. */
  armed?: Weapon;
  /** Collectables, grouped: [kind, how many], oldest kind first. */
  badges?: [string, number][];
  /** Show every badge (the chatter asked to see them) rather than the newest few. */
  badgesOpen?: boolean;
  /** Finders Keepers: the side they took (the ground disc and the tag's crown or flag). */
  side?: 'red' | 'gold';
  /** Finders Keepers: called to a gathering's ring (story/gather.ts): their slot and the way they face there. A /play player's page walks with the server until it goes. */
  gather?: { slot: GroundPoint; face: number };
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
/** What the Mayor or a player can carry and fire from their own page (weapons.ts). `cannon` is a weapon build's own gun, fired while aboard. */
export const WEAPONS = ['blaster', 'rocket'] as const;
export type Weapon = (typeof WEAPONS)[number];

/**
 * Something brief for the page to show, played once per id: a build rattled (`shake`), a shot or a
 * thrown thing flying from one point to another (`shot`, `throw`), a lit bomb sitting on the ground
 * until it goes off (`bomb`, `until`), the explosion (`boom`, `radius`), a character knocked out (`ko`),
 * a rocket or a cannon shell flying from one point to another and going off where it lands (`shell`, `radius`),
 * a build taking a hit (`hit`: dust and chips at `to`, `height` up), and a build coming down (`collapse`, `radius`).
 */
export interface FieldEffect {
  id: number;
  kind: 'shake' | 'shot' | 'throw' | 'bomb' | 'boom' | 'ko' | 'splash' | 'slam' | 'coins' | 'pop' | 'burst' | 'shell' | 'hit' | 'collapse';
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
  /** `hit`, `shot`, `shell`: how high (metres) it lands or leaves from. */
  height?: number;
  fromHeight?: number;
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
  /** The stream camera is on this person instead (their id), chosen on the operator page. */
  focus?: string;
  /** The operator page is open and sending. */
  live: boolean;
  /** The operator has hidden the Mayor: the camera still follows where he is, but nobody sees him. */
  hidden?: boolean;
  /** Aboard a build: which, how it gets about (and so how fast he can take it), where he sits, how high a flyer is, and whether it has a gun. */
  riding?: { id: string; moves: 'roam' | 'drive' | 'fly' | 'vehicle'; seat: number; altitude: number; size: number; gun?: boolean };
  /** What he is carrying (weapons.ts). */
  armed?: Weapon;
  /** The stream's sound as the operator set it (0..1): music, and everything else. */
  audio?: { music: number; sfx: number };
  /** Bumped each time the server puts him somewhere (onto a court): the operator page jumps there too. */
  moved?: number;
  /** The aide's last wish and answer, for the operator page; `thinking` while its model call is out. */
  aide?: { asked: string; reply: string; ok: boolean; at: number; thinking: boolean };
  /** Finders Keepers: the show strip on the operator page (story/board.ts). */
  show?: MayorShowView;
  /** Finders Keepers: put on his mark for a scene; the operator page ignores WASD until it goes. */
  lock?: { at: GroundPoint; facing: number };
  /** Finders Keepers: H's own say while the show decides whether he is seen (on his mark, a flashback); `hidden` is the show's. */
  ownHidden?: boolean; // hook FK-020
}

/**
 * The operator page's show strip (Finders Keepers): the next beat and its lamp (`locked`, `armed`,
 * `firing`, or `scene` while one plays), why it is locked ("folly 72%"), the three cue-card lines,
 * the plaque names to read out, the shot under way, and the ON STREAM chip.
 */
export interface MayorShowView {
  next?: string;
  state?: string;
  why?: string;
  cue?: string[];
  plaque?: string[];
  shot?: { n: number; of: number; t: number };
  chip?: string;
}

/** The Board across the top of the stream with Finders Keepers on (story/board.ts): the two bars, the tug line's tally, the ticker. */
export interface BoardView {
  /** The head's Folly: "BIG HUT", how far (0..100). */
  gold: { word: string; pct: number };
  /** Wren's ask: "BRIDGE", and how many of how many; no count yet reads "BRIDGE · soon". */
  red: { word: string; have?: number; need?: number };
  /** Awake chatters on each side. */
  tally: { red: number; gold: number };
  /** Lines for the ticker, one shown at a time. */
  ticker: string[];
  /** The NOW line under the bars, when there is one. */
  now?: string;
  /** THE WONDER once its visit is open: how far, and the red and gold shares of what went in (0..1). */
  wonder?: { word: string; pct: number; red: number; gold: number };
}

/** The show's on-screen pieces (story/show.ts): the Call's banner, a prompt tile, the NOW card, a title card. Times are server time. */
export interface ShowView {
  /** "GATHER: THE UNVEILING", its few-word premise, and when the Call runs out. */
  banner?: { title: string; premise?: string; until: number; sound?: 'whistle' | 'bell' };
  /** What chat is asked to type in a scene: `rate` (the live average), `pips` (one per "us"), `candles`. */
  prompt?: { kind: string; label: string; value?: number; count?: number };
  /** After a scene: one big word and the chip that says what to type ("type red"). */
  now?: { word: string; chip?: string; side?: 'red' | 'gold'; until: number };
  title?: { text: string; until: number };
}

/** A chatter's home through the ages (story/spotlight.ts): whose, which build, its name in every age so far. */
export interface SpotlightView {
  owner: string;
  objectId: string;
  names: string[];
  until?: number;
}

/** The town for the page: who has which lot, named districts, what is popular, the project, a party. */
export interface TownView {
  name: string;
  /** The age the town lives in (shared/ages.ts), and what the streamer's character is called in it. */
  age: number;
  /** The theme-free sandbox world: no age is drawn (plain ground, builds in their own colours). */
  sandbox?: boolean;
  head: string;
  /** The age's caravan and what its leader asks of the town (caravan.ts), for the board on screen. */
  caravan?: { name: string; leader: string; visit: number; of: number; problem: string; asks: { label: string; have: number; need: number }[]; between?: boolean; stranded?: boolean };
  /**
   * A cutscene playing (shared/scenes.ts, or a story scene in shared/storyScenes.ts): which, and when it
   * started (server time). A held story scene adds up `shift` and freezes at `heldAt` (scene time).
   */
  scene?: { id: string; at: number; leader?: string; vars?: Record<string, string>; shift?: number; heldAt?: number };
  /** A Wonder stands (or is going up) on its spot in the middle of the square: the centrepiece makes way. */
  wonder?: boolean;
  /** The river bridge is down: how far it has been mended (0..1). Absent when it stands whole. */
  bridge?: number;
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
  // ---- Finders Keepers: present only while it runs (story/view.ts) ----
  /** Finders Keepers is on: the page shows the story HUD instead of today's panels. */
  story?: true;
  board?: BoardView;
  show?: ShowView;
  spotlight?: SpotlightView;
  /** The band who stay through every age (story/cast.ts): their townie ids and the role on their tag ("Ash the hunter"). */
  cast?: { id: string; role: string; tag: string }[];
  /** The age's Folly (story/folly.ts): how far (0..100) and the plaque's names. */
  folly?: { pct: number; plaque: string[] };
  /** A gathering's ring while it holds its crowd (story/gather.ts): its centre, and whether it has started (until then they are walking in). */
  ring?: { at: GroundPoint; started?: true };
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
    townLife: boolean; // residents walk about and characters go out on their own
    caravan?: boolean; // the caravan game runs; off is sandbox mode
    themes?: boolean; // the age themes apply; off is the theme-free sandbox world
  };
  counts: { dudes: number; awake: number; builds: number };
  worldRevision: number;
}

export interface DudesAdminStatus {
  fixture: boolean;
  models: { agent: string; design: string; listener: string };
  ai: DudesScene['ai'] & {
    agentLimit: number;
    designLimit: number;
    waiting: number;
    /** The rolling budget (worlds/ai-dudes/budget.ts) and a rough spend estimate. */
    budget?: {
      agentPerHour: number;
      designPerHour: number;
      agentLeft: number;
      designLeft: number;
      agentHour: number;
      designHour: number;
      agent5m: number;
      design5m: number;
      /** Rough US dollars per call of each kind (config), and what the last hour and the last five minutes' pace come to. */
      agentUsd: number;
      designUsd: number;
      usdLastHour: number;
      usdPerHourNow: number;
    };
  };
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
    /** Heard from recently enough to be up and about (not napping). */
    awake: boolean;
    coins: number;
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
  /** Finders Keepers' Story (dev) card (worlds/ai-dudes/story/dev.ts): its buttons, built or not. */
  storyDev?: StoryDevButton[];
}

/**
 * A button on /admin's Story (dev) card (FK-002): it runs the admin action `action` with `value`, or
 * with the card's one argument box when `arg` is set (`arg` says what to type: "name red|gold|none").
 * `card`: the piece hasn't landed yet, so the button refuses with "not built yet: <card>".
 */
export interface StoryDevButton {
  action: string;
  label: string;
  group: 'scene' | 'folly' | 'people' | 'stage';
  value?: string | number;
  arg?: string;
  card?: string;
  /** What it does, for the tooltip. */
  hint?: string;
  /** Drawn as a danger button (the panic exit). */
  danger?: true;
  /** Asked before it runs (once it is built). */
  confirm?: string;
}
