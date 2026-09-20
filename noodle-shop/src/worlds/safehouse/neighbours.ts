// The neighbours: Marge next door to the west, Jake to the east. Two more people on the
// block who keep their own places up — paint the house, grow vegetables, build a car in
// the front yard — and, when chat's creatures start breaking things near them, put up a
// barricade, build something to hunt the creature, or set up a turret.
//
// Two temperaments. Jake is stoked about everything — his own builds, chat's, Marge's — and
// wanders over to admire them; he never competes. Marge is never impressed by anyone else's
// work ("Pfft.") and answers every creation of Jake's with a bigger, "better" one of the same
// (oneUp below: his design scaled up, on a plinth, its top picked out in gold); she may sniff
// at chat's builds and try the same on them.
//
// After their first round of projects they keep going. They notice how the block changes
// and react to it: chat builds something and they wander over to look (and sometimes
// build an answer to it), a wave clears and they add something practical, night falls and
// a light goes up, a pet turns up and gets a kennel, Rook's house falls and a crate of
// supplies appears by his porch. Between times they have whims — small odd things in a
// handful of rotating slots, so the yard keeps changing without ever filling up — move
// their own pieces about, or walk over for a word with each other.
//
// Every number is the app's. Designs come from the hand-written catalogue below, from a
// little procedural generator of oddities, or — when the operator allows model calls and
// the world is not in fixture mode — from the design model, prompted with a hand-written
// idea in the neighbour's own taste (index.ts dispatches; see takeWish/fulfilWish). Model
// designs are decoration or a barrier, never a turret; a "pet" idea becomes a roaming
// creature, never a fighter. Everything obeys the same pause/allowance switches as chat.
//
// A neighbour is not an object (nothing attacks them, they never die) but everything
// they build is an ordinary world object with `owner` set: inspect it, paint it, move
// it, break it, rebuild it. Owned pieces are `fixed` (they spend none of chat's budgets),
// zombies leave them alone (the horde is after Rook's yard), rampaging creatures do not,
// and Rook leaves their upkeep to them.
//
// Job machinery mirrors Rook's without sharing it: plan → walk (one straight run per
// snapshot, so the page never draws anyone through a wall) → work → commit, with the
// same revision/lifecycle checks so an edit chat made in the meantime wins.
import crypto from 'node:crypto';
import type { Blueprint, CombatState, GroundPoint, Primitive, SafehouseObject } from '../../shared/safehouseTypes';
import type { NeighbourActivity, NeighbourView } from '../../shared/safehouseTypes';
import { contains, footprint, inflate, overlaps, HOUSE_ID, LANDMARKS, type Rect } from '../../shared/safehouseLayout';
import { SCENERY_LIMITS, fitBlueprint, measureBlueprint, type Limits } from './blueprint';
import { MAX_CREATURES, initializeObject, intact, isHostile } from './combat';
import { freshCreature, flies } from './creatures';
import { choosePlacement, route, straighten, walkableSegment } from './placement';
import { rotateBlueprint } from './edits';
import type { SurveyInput, ThemeSurvey, WorldCensus } from './survey';
import { ttlFor } from './voice';

// ---- Who lives here ------------------------------------------------------------------------

export interface NeighbourSpec {
  id: string; // 'west' | 'east': the owner key on everything they build
  name: string;
  persona: string; // one line for the design model's benefit
  houseId: string;
  home: GroundPoint; // where they stand when nothing is on: just off the front door
  lot: Rect; // their ground: builds and repairs happen inside it
  front: Rect;
  back: Rect;
  tint: number; // shirt colour on the page
  hat: 'sun' | 'cap';
  /** Answers the other neighbour's creations with a bigger one of the same thing, and may try it on chat's. */
  rival: boolean;
  projects: string[]; // one-off builds in the order they get to them
  whims: string[]; // catalogue whims, in rotation
  ideas: string[]; // things they might ask the model to draw up
  paints: string[]; // house colours they cycle through
  lines: Record<Beat, string[]>;
}
export type Beat =
  | 'alarm' // a hostile creature is near
  | 'barricade'
  | 'hunter'
  | 'turret'
  | 'calm' // the threat has gone
  | 'repair'
  | 'start' // a peacetime project begins
  | 'done'
  | 'paint'
  | 'tend'
  | 'visit' // looking at something chat built
  | 'admire' // looking at something the other neighbour built
  | 'rival' // building an answer to it
  | 'fortify' // after a wave
  | 'light' // night fell
  | 'pet' // a harmless creature is about
  | 'care' // Rook's house fell
  | 'hunker' // a wave is about to land
  | 'social' // over at the other neighbour's
  | 'idea' // waiting on the model
  | 'whim' // something odd going up
  | 'retheme'; // redoing a piece to match what the block has become

export const NEIGHBOURS: readonly NeighbourSpec[] = [
  {
    id: 'west',
    name: 'Marge',
    persona:
      "the older gardener next door: proud, competitive and a bit of a snob — nothing on this street is done properly unless she does it, nobody else's work impresses her, and whatever the neighbour builds she builds bigger and better",
    houseId: 'scenery-house-west',
    home: { x: -20, z: 0.9 },
    lot: { minX: -30, maxX: -12.5, minZ: -17.5, maxZ: 4.6 },
    front: { minX: -26, maxX: -14.2, minZ: 0.6, maxZ: 4.3 },
    back: { minX: -26, maxX: -14, minZ: -17, maxZ: -8.8 },
    tint: 0x8d6b7c,
    hat: 'sun',
    rival: true,
    projects: ['veg', 'flowers', 'washing', 'birdbath', 'letterbox', 'scarecrow', 'bench'],
    whims: ['gnome', 'flamingos', 'sunflower', 'hammock', 'firewood', 'tank', 'feeder', 'planter'],
    ideas: [
      'a garden gnome with attitude',
      'a scarecrow dressed like a zombie',
      'a birdhouse shaped like her own house',
      'a wind chime made of old cutlery',
      'a little shrine to her late cat',
      'a sunflower taller than the fence',
      'a wheelbarrow overflowing with pumpkins',
      'a tower of pot plants',
      'a rainwater tank with a tap',
      'three plastic lawn flamingos',
      'a tiny greenhouse',
      'a cat',
      'a stone birdbath with a frog on it',
      'a rocking chair on the lawn',
      'a garden arch with climbing roses',
      'a fat ceramic toad',
    ],
    paints: ['#7f8f6a', '#cfc4a1', '#6e8794', '#a5735a', '#7d5c6b', '#d6d2c2'],
    lines: {
      alarm: ["Oh no you don't.", 'Not near my garden.', "Right. That's enough of that.", 'Here we go again. Nobody else will deal with it.'],
      barricade: ['Fence first. Tea after.', 'A few planks never hurt anyone.', 'Up it goes. Properly.'],
      hunter: ['Go on. Get it.', 'Meet your new friend, {threat}.', 'Built you some company, {threat}.'],
      turret: ["Never thought I'd own one of these.", 'Well. Needs must.', 'Somebody on this street has to be competent.'],
      calm: ['Peace and quiet. Finally.', 'Gone. Good riddance.', 'About time.'],
      repair: ['Look at the state of this.', 'Fixing it. Again. Nobody else will.', 'Honestly. Who raised these things.'],
      start: ['Someone on this street has to have standards.', 'Right. Doing this properly.', 'A little job before lunch. A proper one.'],
      done: ['There. Lovely. Unlike some yards.', "That'll do nicely. Better than next door, anyway.", 'Now that is how it is done.'],
      paint: ["This colour's had its day.", 'Fresh coat. Someone has to keep the street presentable.', 'Something tasteful, I think. For a change.'],
      tend: ['Come on. Grow.', 'Tomatoes by spring. Real ones.', 'Bit of water, bit of luck. Mostly skill.'],
      visit: ['Pfft.', 'Well. That is... something.', 'Is it meant to look like that.', "I've seen better. Mine, for instance.", 'I suppose someone likes it.', 'Who approved that.'],
      admire: ['Hm.', 'Pfft. Seen it.', 'If you like that sort of thing.'],
      rival: ['Pfft. Bigger. Watch.', 'Oh, he thinks that is good.', 'Cute. Now watch how it is done.', 'Anything he can do.', 'Right. Mine will be bigger. Obviously.'],
      fortify: ['That was close. Sandbags.', 'A bit more between me and them.', 'Never again. Well. Less.'],
      light: ['Getting dark.', 'A bit of light out here. Since nobody else thought of it.', "Can't see a thing."],
      pet: ['Poor thing needs somewhere to sleep.', 'Come here, you.', 'It can stay if it behaves. Unlike some.'],
      care: ["Left you something, Rook. Don't get used to it.", 'Casserole. Eat it.', "You'd do the same. Eventually."],
      hunker: ['Inside. Now.', 'Right. Heads down.', 'Here they come.'],
      social: ['Jake. Still at it, I see.', 'Hello Jake. That is... a choice.', 'Just seeing what you have done wrong now.'],
      idea: ['Thinking. Unlike some.', 'Give me a minute.', 'Something is brewing.'],
      whim: ['Someone has to raise the tone.', 'Nobody asked. Nobody has taste.', 'Every yard needs one. Mine especially.'],
      retheme: [
        'If that is the fashion now, I will do it properly.',
        'Out with the old. It was getting tired anyway.',
        'One cannot be seen to be behind.',
        'Mine will suit it better than theirs does.',
      ],
    },
  },
  {
    id: 'east',
    name: 'Jake',
    persona:
      "the young bloke next door: into cars, gadgets and scrap, builds things for the fun of it and is genuinely stoked about everything — his own builds, chat's, the neighbour's — never competitive, just happy to see cool things go up",
    houseId: 'scenery-house-east',
    home: { x: 23, z: -0.1 },
    lot: { minX: 14.5, maxX: 30, minZ: -17.5, maxZ: 4.6 },
    front: { minX: 18, maxX: 28.5, minZ: -0.3, maxZ: 4.3 },
    back: { minX: 18, maxX: 28.5, minZ: -17, maxZ: -9.8 },
    tint: 0x5f7f9a,
    hat: 'cap',
    rival: false,
    projects: ['car', 'tyres', 'workbench', 'bbq', 'hoop', 'letterbox', 'shed', 'junk'],
    whims: ['tvpile', 'ramp', 'weights', 'dish', 'firebarrel', 'firewood', 'tank', 'kennel'],
    ideas: [
      'a go-kart made from a shopping trolley',
      'a skateboard ramp',
      'a home-made drone on a stand',
      'an old beer fridge',
      'a weights bench with rusty dumbbells',
      'a satellite dish pointing the wrong way',
      'a jet ski on a trailer',
      'a pile of old TVs',
      'a foosball table',
      'a giant speaker stack',
      'a dartboard on a post',
      'a brick pizza oven',
      'a sculpture of a hand made from car parts',
      'a dog',
      'an engine block on a stand',
      'a couch on the lawn',
    ],
    paints: ['#6e8794', '#8c8b78', '#5e8580', '#b89a4e', '#9a8f7c'],
    lines: {
      alarm: ['Whoa whoa whoa. Not the car!', 'Oi! OI!', 'Ok ok, this is happening.', 'Heads up, it is here!'],
      barricade: ['Pallets! Sorted!', 'Quick fence. Actually kind of nice.', 'Not pretty. Love it anyway.'],
      hunter: ["Go get 'em, buddy!", 'Built you a mate, {threat}!', 'Say hi to {threat}. Go go go!'],
      turret: ['Ok THAT is overkill. Sick.', 'This thing is awesome.'],
      calm: ['Yes! Back to it.', 'Gone? Gone. Sweet.', 'We did it. Team effort.'],
      repair: ['Ah well. Fixable!', 'Duct tape time. Love duct tape.', 'Good excuse to upgrade it.'],
      start: ['Oh this is going to be GOOD.', 'Got an hour. Building something awesome.', 'Been dreaming about this one.'],
      done: ['YES. Look at it!', 'Coolest thing I have made. So far.', 'Oh that came out great.', 'Nailed it!'],
      paint: ['New colour! Feels like a new house.', 'Paint day! Best day.'],
      tend: ["She'll run one day. Today's the day. Maybe.", 'Bit more on the car. Getting there!', 'Listen to that. Nearly.'],
      visit: ['YES. Look at that thing!', "Oh that's sick. Chat, you legends.", 'How did you even come up with that. Love it.', 'Best thing on the street. Easily.', 'I would put that in my yard in a heartbeat.'],
      admire: ["Marge! That's massive! Love it.", 'Oh she went bigger. Good on her.', "Look at Marge's one. Unreal.", "That's so good, Marge!"],
      rival: ['Ooh. I want one too!', 'That is so cool I might build one.'],
      fortify: ['Sandbags! Feel safer already.', 'Bit of insurance. Cool insurance.', 'Not doing that again. Building something!'],
      light: ['Lights! Then snacks.', 'Dark already? Fire barrel time.', 'Ooh. Ambience.'],
      pet: ['Mate! Come here! You are staying.', 'It can have the shed. Not the car. Love him though.', 'Best day. We have a pet.'],
      care: ['Rook! Grab this. You are a legend.', 'Beers and batteries. The essentials.', "Sorry about the house, man. It'll come back even better."],
      hunker: ['Ok ok ok, inside!', 'Nope nope. Inside though!', 'Here we go! Inside!'],
      social: ['Marge! Nice tomatoes!', 'Sup Marge. Yard is looking great.', 'Marge, that thing you built. Incredible.'],
      idea: ['Ooh. Ooh. Give me a sec.', 'Cooking something up. Something great.', 'Hmm. Hmm! Yes.'],
      whim: ['Because it is awesome.', 'Why does anyone build anything. Because it is fun!', 'Trust the process. The process is great.'],
      retheme: [
        'Have you SEEN what is going up out there? I want in.',
        'New look. Whole yard. Starting now.',
        'The street did a thing, so I am doing the thing.',
        'Out with this, in with the good stuff.',
      ],
    },
  },
];
export const specOf = (id: string): NeighbourSpec | undefined => NEIGHBOURS.find((n) => n.id === id);
export const NEIGHBOUR_HOUSE_IDS = NEIGHBOURS.map((n) => n.houseId);

// ---- State --------------------------------------------------------------------------------

export type NeighbourPurpose = 'defense' | 'upkeep' | 'project';
export type ImpulseKind = 'whim' | 'rival' | 'fortify' | 'light' | 'pet' | 'care' | 'visit' | 'rearrange' | 'social' | 'retheme';
/** A design ready to build: from the catalogue, the oddity generator or the model. */
export interface ReadyDesign {
  blueprint: Blueprint;
  name: string;
  role?: 'decoration' | 'barrier';
  pet?: boolean; // a roaming creature, never a fighter
  flying?: boolean;
  reply?: string; // the model's one line in the neighbour's voice: their bubble when the build starts
}
/** An idea a neighbour has had and not acted on yet. */
export interface Impulse {
  kind: ImpulseKind;
  idea: string; // what, in words; also the model's brief
  name?: string; // the thing it is about
  targetId?: string;
  at: number;
  noAi?: boolean; // the model already failed or is off: the catalogue does it
  design?: ReadyDesign;
  /** A retheme: the look the whole yard is going for, so one piece is designed to match the rest. */
  brief?: string;
}
/** An impulse handed to the model; index.ts dispatches and brings back a ReadyDesign or nothing. */
export interface Wish {
  kind: ImpulseKind;
  idea: string;
  name?: string;
  targetId?: string;
  at: number;
  brief?: string;
}
export interface Seen {
  creationAt: number; // newest chat creation they know of
  otherAt: number; // newest thing the other neighbour built
  wave: number;
  fell?: number;
  lighting: 'day' | 'night';
  pet?: boolean;
  hunkered?: number;
}
export interface NeighbourJob {
  kind: 'build' | 'edit' | 'repair' | 'rebuild' | 'tend' | 'look';
  purpose: NeighbourPurpose;
  label: string;
  status: 'walking' | 'working';
  path: GroundPoint[];
  spot: GroundPoint; // where the work is; they face it
  workedMs: number;
  workMs: number;
  preview?: SafehouseObject; // build/edit/repair/rebuild: what goes in when the work is done
  targetId?: string;
  baseRevision?: number;
  baseLifecycle?: number;
  project?: string; // catalogue key, for stages and the done line
  reason?: string; // the impulse behind it, for the log and Rook's remark
}
export interface NeighbourThreat {
  id: string;
  level: number; // escalation so far against this creature
  quietMs: number; // how long since it was last seen or felt
  waitMs: number; // countdown to the next response
  sinceMs?: number; // how long it has been about altogether
}
/** A creature nothing on the ladder can finish (a flyer, say) stops being a reason to hide after this long: life goes on, repairs first. */
const LOCKDOWN_MS = 4 * 60_000;
export interface NeighbourState {
  id: string;
  position: GroundPoint;
  facing: number;
  activity: NeighbourActivity;
  path: GroundPoint[]; // the stroll home
  job?: NeighbourJob;
  restMs: number; // countdown to the next peacetime project
  stages: Record<string, number>; // staged projects: veg growth, the car
  paint?: string;
  threat?: NeighbourThreat;
  wear: number; // damage seen on their house and builds last tick
  say?: { text: string; until: number };
  seen?: Seen;
  impulses?: Impulse[];
  wish?: Wish;
  aiAt?: number; // when the model last drew something up for them
  whimSeq?: number;
  /** The look they have decided their yard should have, from reading the block (survey.ts). */
  theme?: { name: string; brief: string; adoptedAt: number };
  /** Ideas from the survey still to be spent, one per retheme; emptied as the yard converts. */
  plan?: string[];
  /** Slot object id → the theme it was built in. Cleared whenever a new theme is adopted, so
   *  anything missing from here is a piece still waiting to be redone. */
  themed?: Record<string, string>;
  /** A survey handed to the model; index.ts dispatches and brings back a theme or nothing. */
  survey?: { sig: string; at: number };
  surveyAt?: number; // when the block was last surveyed (asked, not answered)
  surveySig?: string; // the block as it looked then: no point asking again until it changes
}
interface World {
  objects: SafehouseObject[];
  combat: CombatState;
  neighbours: NeighbourState[];
  worldRevision: number;
  survivor: { position: GroundPoint };
  lighting?: 'day' | 'night';
}
export interface NeighbourEvent {
  kind: 'alarm' | 'defense' | 'hunter' | 'project' | 'repair' | 'standdown' | 'visit' | 'care';
  who: string; // the neighbour's name
  id: string;
  name?: string; // the piece
  threat?: string; // the creature, named
  reason?: string; // the impulse behind a project
}
export interface Pace {
  workMs?: number; // every job takes this long (tests)
  restMs: number; // typical gap between peacetime projects
  ai: boolean; // may hand ideas to the design model
  aiGapMs: number; // least time between one neighbour's model designs
  /** May read the block and adopt a theme. Its own switch: a separate, much cheaper call. */
  survey: boolean;
  /** Least time between one neighbour's readings of the block, whatever else changes out there. */
  surveyGapMs: number;
}
export const DEFAULT_PACE: Pace = { restMs: 110_000, ai: false, aiGapMs: 10 * 60_000, survey: false, surveyGapMs: 8 * 60_000 };
export const FIXTURE_PACE: Pace = { restMs: 9_000, ai: false, aiGapMs: 20_000, survey: false, surveyGapMs: 20_000 };
/**
 * Static pieces a neighbour keeps standing at once, house and creatures not counted. This is the
 * whole cap: once the slots are full a new design replaces the oldest rather than adding to the
 * yard (slotFor below), so the block stops growing without anyone having to enforce a limit.
 */
export const OWNED_SLOTS = 5;
/**
 * Moving pieces the neighbours may have between them — hunters, pets, anything the model gives a
 * creature. Shared, not per neighbour, and well inside MAX_CREATURES so chat always has room for
 * its own: moving objects are the most expensive thing in the scene and the only ones that keep
 * the shadow map re-rendering.
 */
export const NEIGHBOUR_CREATURE_BUDGET = 5;
/** The model's designs for the neighbours are kept small: yard things, not landmarks. */
export const NEIGHBOUR_AI_LIMITS: Limits = { width: 4, depth: 4, height: 4.5 };
const WALK_SPEED = 2.1;
const THREAT_RANGE = 26; // metres from their house for a hostile creature to count
const STAND_DOWN_MS = 30_000;
const WISH_TIMEOUT_MS = 110_000; // the model never answered: the catalogue does it
const IMPULSE_DELAY_MS = 2_500; // a beat between noticing and acting

export function freshNeighbour(spec: NeighbourSpec): NeighbourState {
  return {
    id: spec.id,
    position: { ...spec.home },
    facing: 0,
    activity: 'idle',
    path: [],
    restMs: 15_000,
    stages: {},
    wear: 0,
  };
}
export const freshNeighbours = (): NeighbourState[] => NEIGHBOURS.map(freshNeighbour);
export const ownedBy = (o: SafehouseObject, id: string) => o.owner === id;
/** A neighbour's house and everything they built: what Rook leaves to them. */
export function ownedByNeighbours(o: { id: string; owner?: string }): boolean {
  return !!o.owner || NEIGHBOUR_HOUSE_IDS.includes(o.id);
}
/** The builds neighbours are walking to or working on, as obstacles for anyone else's placement. */
export function neighbourGhosts(w: { neighbours?: NeighbourState[] }): SafehouseObject[] {
  return (w.neighbours ?? []).flatMap((n) => (n.job?.preview && n.job.kind === 'build' ? [n.job.preview] : []));
}

// ---- The catalogue -------------------------------------------------------------------------

const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;
type V3 = [number, number, number];
const box = (w: number, h: number, d: number, color: number | string, x: number, y: number, z: number, rotation: V3 = [0, 0, 0]): Primitive => ({
  shape: 'box',
  position: [x, y, z],
  size: [w, h, d],
  rotation,
  color: typeof color === 'number' ? hex(color) : color,
});
const cyl = (r: number, h: number, color: number | string, x: number, y: number, z: number, rotation: V3 = [0, 0, 0]): Primitive => ({
  shape: 'cylinder',
  position: [x, y, z],
  size: [r * 2, h, r * 2],
  rotation,
  color: typeof color === 'number' ? hex(color) : color,
});
const ball = (r: number, color: number | string, x: number, y: number, z: number, squash = 1): Primitive => ({
  shape: 'sphere',
  position: [x, y, z],
  size: [r * 2, r * 2 * squash, r * 2],
  rotation: [0, 0, 0],
  color: typeof color === 'number' ? hex(color) : color,
});
const cone = (r: number, h: number, color: number | string, x: number, y: number, z: number, rotation: V3 = [0, 0, 0]): Primitive => ({
  shape: 'cone',
  position: [x, y, z],
  size: [r * 2, h, r * 2],
  rotation,
  color: typeof color === 'number' ? hex(color) : color,
});
const PLANK = 0x8d7856,
  POST = 0x6b5e4a,
  SANDBAG = 0x8b7d5c,
  STEEL = 0x8b8f86,
  RUST = 0x7a5a3e;

function barricade(): Primitive[] {
  const parts: Primitive[] = [];
  for (let i = 0; i < 5; i++) parts.push(box(0.16, 1.75, 0.16, 0x8d7653, -1.16 + i * 0.58, 1.12, -0.1));
  for (let i = 0; i < 3; i++)
    parts.push(box(3, 0.18, 0.15, i % 2 ? 0xa5936a : 0x8e7b57, 0, 0.66 + i * 0.4, 0, [0, 0, i % 2 ? 0.045 : -0.04]));
  parts.push(ball(0.3, SANDBAG, -0.9, 0.2, 0.32, 0.7), ball(0.3, SANDBAG, 0.9, 0.2, 0.32, 0.7));
  return parts;
}
function turret(): Primitive[] {
  const parts: Primitive[] = [cyl(0.7, 0.36, 0x6b6a5c, 0, 0.18, 0)];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    parts.push(ball(0.32, SANDBAG, Math.sin(a) * 0.78, 0.24, Math.cos(a) * 0.78, 0.7));
  }
  for (const [x, z] of [
    [-0.32, -0.2],
    [0.32, -0.2],
    [0, 0.36],
  ])
    parts.push(cyl(0.045, 1.05, 0x4a4f4a, x * 0.55, 0.85, z * 0.55, [z * 0.45, 0, -x * 0.45]));
  parts.push(
    box(0.5, 0.34, 0.6, 0x5c665c, 0, 1.12, 0),
    cyl(0.07, 1.3, 0x3a403b, 0, 1.18, 0.72, [Math.PI / 2, 0, 0]),
    box(0.34, 0.24, 0.26, 0x6f6a4e, 0.5, 0.5, 0.1),
  );
  return parts;
}
/** The thing they build to hunt a creature: a low, heavy, blocky beast with a spiked collar. */
function hunter(tone: number): Primitive[] {
  const dark = tone,
    darker = Math.max(0, tone - 0x0a0806);
  const parts: Primitive[] = [
    box(0.7, 0.6, 1.3, dark, 0, 0.75, -0.1),
    box(0.78, 0.52, 0.55, darker, 0, 0.82, 0.55),
    box(0.5, 0.46, 0.6, darker, 0, 1.02, 1.05),
    box(0.42, 0.15, 0.36, 0x2a2724, 0, 0.78, 1.2),
    ball(0.06, 0xd9a23a, -0.15, 1.1, 1.36),
    ball(0.06, 0xd9a23a, 0.15, 1.1, 1.36),
    cone(0.1, 0.26, dark, -0.18, 1.34, 0.95),
    cone(0.1, 0.26, dark, 0.18, 1.34, 0.95),
    cyl(0.05, 0.62, dark, 0, 0.92, -0.9, [0.9, 0, 0]),
  ];
  for (const x of [-0.25, 0.25]) for (const z of [-0.5, 0.35]) parts.push(box(0.2, 0.55, 0.22, dark, x, 0.28, z));
  for (let i = 0; i < 5; i++) {
    const a = -0.9 + i * 0.45;
    parts.push(cone(0.06, 0.18, 0x9aa3a5, Math.sin(a) * 0.42, 1.06 + Math.cos(a) * 0.3, 0.32, [0, 0, -a]));
  }
  return parts;
}
/** A raised vegetable bed that grows in four stages: soil, sprouts, leafy rows, ripe. */
export function vegPatch(stage: number): Primitive[] {
  const parts: Primitive[] = [
    box(2.6, 0.22, 1.2, 0x4d4436, 0, 0.11, 0),
    box(2.8, 0.18, 0.08, 0x9a8760, 0, 0.2, -0.6),
    box(2.8, 0.18, 0.08, 0x9a8760, 0, 0.2, 0.6),
    box(0.08, 0.18, 1.3, 0x9a8760, -1.36, 0.2, 0),
    box(0.08, 0.18, 1.3, 0x9a8760, 1.36, 0.2, 0),
  ];
  if (stage <= 0) return parts;
  for (let i = 0; i < 6; i++) {
    const x = -1.05 + i * 0.42;
    for (const z of [-0.3, 0.3]) {
      if (stage === 1) parts.push(box(0.08, 0.2, 0.08, 0x7f9a5a, x, 0.32, z));
      else {
        parts.push(box(0.28, 0.32, 0.28, z < 0 ? 0x5f7f4a : 0x6f8c52, x, 0.38, z));
        parts.push(ball(0.12, 0x86a35e, x, 0.58, z, 0.6));
      }
    }
  }
  if (stage >= 2) for (const x of [-0.8, 0, 0.8]) parts.push(cyl(0.02, 0.95, PLANK, x, 0.65, 0.3));
  if (stage >= 3) {
    for (let i = 0; i < 6; i++) parts.push(ball(0.08, 0xb8453a, -1.05 + i * 0.42, 0.66, 0.42));
    for (const x of [-0.84, 0.0, 0.84]) parts.push(ball(0.17, 0xc7833a, x, 0.33, -0.28, 0.8));
  }
  return parts;
}
function flowerBed(): Primitive[] {
  const parts: Primitive[] = [box(1.7, 0.16, 1.0, 0x5a5040, 0, 0.08, 0), box(1.8, 0.1, 0.06, 0x8c8578, 0, 0.16, -0.5), box(1.8, 0.1, 0.06, 0x8c8578, 0, 0.16, 0.5)];
  const colours = [0xcb8b91, 0xd9c26b, 0xdedbcb, 0xb56b8c, 0xc7833a];
  for (let i = 0; i < 8; i++) {
    const x = -0.65 + (i % 4) * 0.43,
      z = i < 4 ? -0.22 : 0.22;
    parts.push(cyl(0.015, 0.32, 0x6d8a4d, x, 0.3, z), ball(0.09, colours[(i * 3) % colours.length], x, 0.48, z));
  }
  return parts;
}
function washingLine(): Primitive[] {
  const parts: Primitive[] = [];
  for (const x of [-1.5, 1.5]) parts.push(cyl(0.05, 1.9, POST, x, 0.95, 0), box(0.6, 0.05, 0.05, POST, x, 1.9, 0));
  parts.push(box(3, 0.02, 0.02, 0xd8d3c0, 0, 1.9, 0));
  [0xc5d0d9, 0x8b6b7c, 0xd9c98c, 0x6f8a9a].forEach((c, i) => parts.push(box(0.3, 0.46, 0.03, c, -0.9 + i * 0.6, 1.64, 0)));
  return parts;
}
function birdBath(): Primitive[] {
  return [
    cyl(0.26, 0.06, 0x8a8a80, 0, 0.03, 0),
    cyl(0.09, 0.8, 0x9a9a90, 0, 0.43, 0),
    cyl(0.46, 0.1, 0x9a9a90, 0, 0.88, 0),
    cyl(0.38, 0.03, 0x5a7a86, 0, 0.945, 0),
    ball(0.06, 0x3a3f44, 0.3, 1.01, 0),
  ];
}
function scarecrow(): Primitive[] {
  return [
    cyl(0.04, 2.0, PLANK, 0, 1, 0),
    box(1.2, 0.05, 0.05, PLANK, 0, 1.5, 0),
    box(0.42, 0.7, 0.2, 0x8a5a4a, 0, 1.32, 0),
    box(0.5, 0.12, 0.14, 0x8a5a4a, -0.5, 1.5, 0),
    box(0.5, 0.12, 0.14, 0x8a5a4a, 0.5, 1.5, 0),
    ball(0.16, 0xd9c98c, 0, 1.86, 0),
    cone(0.3, 0.26, 0xb89a4e, 0, 2.08, 0),
  ];
}
function bench(): Primitive[] {
  return [
    box(1.8, 0.08, 0.45, PLANK, 0, 0.5, 0),
    box(1.8, 0.5, 0.06, PLANK, 0, 0.85, -0.22, [-0.15, 0, 0]),
    box(0.08, 0.5, 0.45, 0x4c524d, -0.8, 0.25, 0),
    box(0.08, 0.5, 0.45, 0x4c524d, 0.8, 0.25, 0),
  ];
}
function letterbox(): Primitive[] {
  return [cyl(0.04, 1.0, POST, 0, 0.5, 0), box(0.3, 0.25, 0.45, 0x7a4a3f, 0, 1.1, 0), box(0.02, 0.14, 0.12, 0xc7833a, 0.17, 1.22, 0.1)];
}
/** Dev's car, in four stages: a frame on blocks, wheels and an engine, a primed shell, the finished thing. */
export function carProject(stage: number): Primitive[] {
  const parts: Primitive[] = [];
  if (stage < 3) for (const x of [-0.8, 0.8]) for (const z of [-1.3, 1.3]) parts.push(box(0.3, 0.3, 0.3, 0x6d6a60, x, 0.15, z));
  parts.push(box(1.6, 0.12, 3.6, 0x4f4f4b, 0, stage < 3 ? 0.42 : 0.5, 0));
  for (const x of [-0.7, 0.7]) parts.push(box(0.1, 0.16, 3.6, 0x4f4f4b, x, stage < 3 ? 0.5 : 0.58, 0));
  if (stage >= 1) {
    for (const x of [-0.9, 0.9]) for (const z of [-1.2, 1.25]) parts.push(cyl(0.36, 0.2, 0x2e3230, x, 0.4, z, [0, 0, Math.PI / 2]));
    if (stage < 3) parts.push(box(0.7, 0.4, 0.6, 0x555a57, 0, 0.75, 1.0));
  }
  if (stage === 2) parts.push(box(1.8, 0.6, 3.9, 0x8f8f86, 0, 0.9, 0));
  if (stage >= 3) {
    const paint = 0x4f7f9a;
    parts.push(
      box(1.8, 0.65, 3.9, paint, 0, 0.85, 0),
      box(1.5, 0.65, 1.9, paint, 0, 1.5, -0.2),
      box(1.36, 0.48, 0.045, 0x687776, 0, 1.54, 0.79),
      box(1.36, 0.45, 0.045, 0x5b6966, 0, 1.54, -1.19),
      box(1.65, 0.15, 0.17, 0x8a9086, 0, 0.66, 2),
    );
    for (const x of [-0.79, 0.79]) parts.push(box(0.03, 0.4, 1.45, 0x566360, x, 1.57, -0.2));
    for (const x of [-0.58, 0.58]) parts.push(box(0.35, 0.22, 0.06, 0xc8c29c, x, 0.92, 1.98));
  }
  return parts;
}
function bbq(): Primitive[] {
  const parts: Primitive[] = [cyl(0.3, 0.85, 0x3a3f41, 0, 0.8, 0, [0, 0, Math.PI / 2]), box(0.75, 0.03, 0.5, STEEL, 0, 1.11, 0), box(0.4, 0.06, 0.5, 0x3a3f41, 0.65, 0.8, 0)];
  for (const x of [-0.3, 0.3]) for (const z of [-0.2, 0.2]) parts.push(cyl(0.03, 0.55, 0x4a4f4a, x, 0.28, z));
  return parts;
}
function shed(): Primitive[] {
  return [box(2.4, 2.1, 2, 0x76705c, 0, 1.05, 0), box(2.7, 0.16, 2.3, 0x555c52, 0, 2.2, 0, [0.12, 0, 0]), box(0.8, 1.6, 0.05, 0x4f4a3f, 0, 0.8, 1.03)];
}
function hoop(): Primitive[] {
  return [
    cyl(0.06, 3.2, 0x6f7a72, 0, 1.6, -0.3),
    box(1.2, 0.8, 0.05, 0xd9d3c0, 0, 2.9, -0.05),
    box(0.5, 0.35, 0.03, 0xc7602f, 0, 2.75, -0.02),
    cyl(0.24, 0.03, 0xc7602f, 0, 2.55, 0.2),
    box(0.4, 0.3, 0.4, 0x6d6a60, 0, 0.15, -0.3),
  ];
}
function tyres(): Primitive[] {
  return [cyl(0.36, 0.22, 0x2e3230, 0, 0.11, 0), cyl(0.36, 0.22, 0x2e3230, 0.05, 0.33, 0.03), cyl(0.36, 0.22, 0x33373a, -0.03, 0.55, -0.02), cyl(0.36, 0.22, 0x2e3230, 0.75, 0.36, 0.1, [0, 0, 1.45])];
}
function workbench(): Primitive[] {
  const parts: Primitive[] = [box(1.6, 0.08, 0.7, 0x9d8860, 0, 0.85, 0), box(0.2, 0.2, 0.2, 0x555a57, 0.55, 0.99, 0.15), box(0.3, 0.04, 0.12, STEEL, -0.4, 0.91, 0.1), box(0.12, 0.04, 0.35, STEEL, -0.1, 0.91, -0.15)];
  for (const x of [-0.7, 0.7]) for (const z of [-0.28, 0.28]) parts.push(box(0.08, 0.82, 0.08, 0x6f6249, x, 0.41, z));
  return parts;
}
function junkSculpture(): Primitive[] {
  return [
    cyl(0.5, 0.3, RUST, 0, 0.15, 0),
    cone(0.35, 1.4, 0xb7410e, 0, 1.0, 0),
    ball(0.28, STEEL, 0, 1.95, 0),
    cyl(0.03, 1.2, 0x6f6a4e, 0.35, 1.3, 0.1, [0, 0, -0.5]),
    cyl(0.03, 1.0, 0x6f6a4e, -0.3, 1.2, -0.1, [0.3, 0, 0.6]),
    box(0.4, 0.05, 0.4, 0xc4402f, 0.3, 2.05, 0.1, [0.2, 0.6, 0]),
  ];
}
// ---- Whims and reactions: small things that come and go.
function gnome(): Primitive[] {
  return [
    cyl(0.16, 0.5, 0x5b6b8a, 0, 0.25, 0),
    ball(0.16, 0xe0c3a0, 0, 0.6, 0),
    ball(0.13, 0xdedbcb, 0, 0.5, 0.1, 0.8),
    cone(0.16, 0.42, 0xc4402f, 0, 0.9, 0),
    box(0.08, 0.06, 0.16, 0x3a3f41, -0.12, 0.05, 0.08),
    box(0.08, 0.06, 0.16, 0x3a3f41, 0.12, 0.05, 0.08),
  ];
}
function flamingos(): Primitive[] {
  const parts: Primitive[] = [];
  [-0.5, 0.1, 0.6].forEach((x, i) => {
    const z = (i % 2) * 0.4 - 0.2;
    parts.push(cyl(0.015, 0.55, 0x3a3f41, x - 0.05, 0.28, z), cyl(0.015, 0.55, 0x3a3f41, x + 0.05, 0.28, z));
    parts.push(ball(0.16, 0xe28aa0, x, 0.68, z, 0.8), cyl(0.03, 0.4, 0xe28aa0, x + 0.1, 0.95, z + 0.05, [0.3, 0, -0.2]));
    parts.push(ball(0.07, 0xe28aa0, x + 0.17, 1.15, z + 0.1), cone(0.03, 0.12, 0x2a2724, x + 0.22, 1.12, z + 0.16, [Math.PI / 2, 0, 0.6]));
  });
  return parts;
}
function sunflower(): Primitive[] {
  const parts: Primitive[] = [cyl(0.04, 2.6, 0x5f7f4a, 0, 1.3, 0)];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    parts.push(box(0.16, 0.34, 0.03, 0xd9b53a, Math.sin(a) * 0.3, 2.6 + Math.cos(a) * 0.3, 0.02, [0, 0, -a]));
  }
  parts.push(cyl(0.16, 0.06, 0x4d3a2a, 0, 2.6, 0.03, [Math.PI / 2, 0, 0]));
  for (const y of [1.2, 1.8]) parts.push(box(0.5, 0.03, 0.2, 0x6f8c52, y === 1.2 ? -0.28 : 0.28, y, 0, [0, 0, y === 1.2 ? 0.4 : -0.4]));
  return parts;
}
function hammock(): Primitive[] {
  return [
    cyl(0.07, 1.8, POST, -1.5, 0.9, 0),
    cyl(0.07, 1.8, POST, 1.5, 0.9, 0),
    box(2.2, 0.06, 0.8, 0xa9563f, 0, 0.85, 0, [0, 0, 0]),
    cyl(0.015, 0.7, 0xd8d3c0, -1.15, 1.35, 0, [0, 0, 0.6]),
    cyl(0.015, 0.7, 0xd8d3c0, 1.15, 1.35, 0, [0, 0, -0.6]),
    box(0.4, 0.15, 0.3, 0xdedbcb, -0.6, 0.95, 0),
  ];
}
function firewood(): Primitive[] {
  const parts: Primitive[] = [];
  for (let row = 0; row < 3; row++)
    for (let i = 0; i < 5 - row; i++) parts.push(cyl(0.1, 0.9, row % 2 ? 0x6b5233 : 0x7a5f3c, -0.4 + i * 0.2 + row * 0.1, 0.1 + row * 0.18, 0, [Math.PI / 2, 0, 0]));
  return parts;
}
function tank(): Primitive[] {
  return [
    cyl(0.6, 1.6, 0x6f8a6a, 0, 0.8, 0),
    cyl(0.62, 0.08, 0x5a6f57, 0, 1.62, 0),
    cyl(0.05, 0.3, STEEL, 0, 0.35, 0.65, [Math.PI / 2, 0, 0]),
    box(0.1, 0.1, 0.1, 0xc7602f, 0, 0.35, 0.82),
    box(1.3, 0.12, 1.3, 0x6d6a60, 0, 0.06, 0),
  ];
}
function feeder(): Primitive[] {
  return [
    cyl(0.04, 1.5, POST, 0, 0.75, 0),
    box(0.5, 0.05, 0.4, PLANK, 0, 1.52, 0),
    box(0.4, 0.3, 0.3, 0xa9906a, 0, 1.7, 0),
    box(0.55, 0.05, 0.45, 0x6b5233, 0, 1.87, 0, [0.15, 0, 0]),
    ball(0.05, 0x3a3f44, 0.2, 1.6, 0.1),
  ];
}
function planter(): Primitive[] {
  const parts: Primitive[] = [];
  [0, 0.45, 0.85].forEach((y, i) => {
    const r = 0.5 - i * 0.13;
    parts.push(cyl(r, 0.4, 0xa9563f, 0, y + 0.2, 0));
    parts.push(cyl(r - 0.02, 0.03, 0x4d4436, 0, y + 0.41, 0));
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2 + i;
      parts.push(ball(0.11, [0x6f8c52, 0xcb8b91, 0xd9c26b][(i + k) % 3], Math.sin(a) * (r - 0.15), y + 0.5, Math.cos(a) * (r - 0.15)));
    }
  });
  return parts;
}
function sandbags(): Primitive[] {
  const parts: Primitive[] = [];
  for (let row = 0; row < 3; row++)
    for (let i = 0; i < 6 - row; i++) parts.push(ball(0.28, row % 2 ? 0x8b7d5c : 0x9a8c6a, -1.25 + i * 0.5 + row * 0.25, 0.2 + row * 0.32, 0, 0.65));
  return parts;
}
function bell(): Primitive[] {
  return [
    cyl(0.06, 2.4, POST, 0, 1.2, 0),
    box(0.7, 0.06, 0.06, POST, 0.25, 2.35, 0),
    cone(0.18, 0.28, 0xb89a4e, 0.5, 2.05, 0),
    ball(0.05, 0x6d6a60, 0.5, 1.88, 0),
    cyl(0.02, 0.5, 0xd8d3c0, 0.5, 1.6, 0),
  ];
}
function lookout(): Primitive[] {
  const parts: Primitive[] = [];
  for (const x of [-0.5, 0.5]) for (const z of [-0.5, 0.5]) parts.push(cyl(0.06, 2.4, POST, x, 1.2, z));
  parts.push(box(1.3, 0.1, 1.3, PLANK, 0, 2.4, 0));
  for (const z of [-0.6, 0.6]) parts.push(box(1.3, 0.06, 0.06, PLANK, 0, 2.95, z));
  for (let i = 0; i < 4; i++) parts.push(box(0.5, 0.05, 0.05, 0x9d8860, 0, 0.5 + i * 0.5, 0.62));
  return parts;
}
function firebarrel(): Primitive[] {
  return [
    cyl(0.32, 0.9, 0x4a4340, 0, 0.45, 0),
    cyl(0.33, 0.06, 0x3a3f41, 0, 0.3, 0),
    cyl(0.33, 0.06, 0x3a3f41, 0, 0.7, 0),
    cone(0.2, 0.5, 0xe2803a, 0, 1.1, 0),
    cone(0.12, 0.35, 0xf2c14e, 0, 1.25, 0.02),
  ];
}
function lantern(): Primitive[] {
  return [
    cyl(0.05, 2.2, 0x4a4f4a, 0, 1.1, 0),
    box(0.5, 0.05, 0.05, 0x4a4f4a, 0.2, 2.15, 0),
    box(0.26, 0.34, 0.26, 0xf2d27a, 0.42, 1.95, 0),
    box(0.3, 0.05, 0.3, 0x4a4f4a, 0.42, 2.14, 0),
    cone(0.18, 0.12, 0x4a4f4a, 0.42, 2.2, 0),
  ];
}
function kennel(): Primitive[] {
  return [
    box(1.2, 0.9, 1.3, 0x8a6f52, 0, 0.45, 0),
    box(1.35, 0.1, 0.8, 0x5b4a3a, 0, 1.0, -0.35, [0.7, 0, 0]),
    box(1.35, 0.1, 0.8, 0x5b4a3a, 0, 1.0, 0.35, [-0.7, 0, 0]),
    box(0.45, 0.55, 0.05, 0x2a2724, 0, 0.3, 0.66),
    cyl(0.16, 0.06, 0x8b8f86, 0.8, 0.03, 0.4),
  ];
}
function crate(): Primitive[] {
  return [
    box(0.9, 0.7, 0.9, 0xa08c63, 0, 0.35, 0),
    box(0.95, 0.06, 0.95, 0x75694b, 0, 0.3, 0),
    box(0.95, 0.06, 0.95, 0x75694b, 0, 0.66, 0),
    box(0.5, 0.2, 0.3, 0xc4402f, 0.15, 0.8, 0.1),
    cyl(0.1, 0.3, 0x6f8a6a, -0.25, 0.85, -0.2),
  ];
}
function tvpile(): Primitive[] {
  return [
    box(1.1, 0.8, 0.9, 0x4a4340, 0, 0.4, 0),
    box(0.9, 0.6, 0.05, 0x5a7a86, 0, 0.45, 0.46),
    box(0.9, 0.7, 0.75, 0x3a3f41, 0.15, 1.15, -0.05, [0, 0.2, 0]),
    box(0.7, 0.5, 0.05, 0x6f8a9a, 0.15, 1.15, 0.33, [0, 0.2, 0]),
    box(0.6, 0.45, 0.55, 0x8b8f86, -0.3, 1.6, 0.1, [0, -0.4, 0.1]),
    cyl(0.02, 0.6, 0x9aa3a5, 0.4, 1.8, -0.2, [0, 0, -0.4]),
  ];
}
function ramp(): Primitive[] {
  return [
    box(1.2, 0.1, 2.2, 0x8f8f86, 0, 0.55, 0, [-0.45, 0, 0]),
    box(0.1, 1.0, 0.8, PLANK, -0.55, 0.5, -0.7),
    box(0.1, 1.0, 0.8, PLANK, 0.55, 0.5, -0.7),
    box(1.2, 0.1, 0.8, 0x8f8f86, 0, 1.02, -0.7),
  ];
}
function weights(): Primitive[] {
  const parts: Primitive[] = [box(1.4, 0.1, 0.4, 0x3a3f41, 0, 0.45, 0), box(0.5, 0.1, 0.4, 0x3a3f41, -0.4, 0.75, 0, [0, 0, 0.6])];
  for (const x of [-0.5, 0.5]) parts.push(box(0.08, 0.45, 0.4, STEEL, x, 0.22, 0));
  parts.push(cyl(0.02, 1.8, STEEL, 0.2, 1.25, 0, [0, 0, Math.PI / 2]));
  for (const x of [-0.65, 0.95]) parts.push(cyl(0.2, 0.08, RUST, x, 1.25, 0, [0, 0, Math.PI / 2]), cyl(0.15, 0.06, RUST, x + (x < 0 ? -0.08 : 0.08), 1.25, 0, [0, 0, Math.PI / 2]));
  return parts;
}
function dish(): Primitive[] {
  return [
    box(0.5, 0.15, 0.5, 0x6d6a60, 0, 0.08, 0),
    cyl(0.05, 1.4, 0x4a4f4a, 0, 0.8, 0),
    cyl(0.55, 0.1, 0xb9b9b0, 0.2, 1.65, 0.1, [0.9, 0, -0.5]),
    cyl(0.015, 0.6, STEEL, 0.35, 1.9, 0.4, [0.9, 0, -0.5]),
  ];
}
interface Project {
  name: (spec: NeighbourSpec) => string;
  parts: (stage: number, spec: NeighbourSpec) => Primitive[];
  where: 'front' | 'back';
  offset: GroundPoint; // preferred spot relative to the middle of that yard
  health: number;
  role?: SafehouseObject['role'];
  stages?: number; // grows through this many stages on later visits
  beat: Beat;
}
export const CATALOGUE: Record<string, Project> = {
  veg: { name: (s) => `${s.name}'s vegetable patch`, parts: vegPatch, where: 'back', offset: { x: 0, z: 1 }, health: 150, stages: 4, beat: 'tend' },
  flowers: { name: (s) => `${s.name}'s flower bed`, parts: flowerBed, where: 'front', offset: { x: -3.2, z: 0.3 }, health: 120, beat: 'start' },
  washing: { name: (s) => `${s.name}'s washing line`, parts: washingLine, where: 'back', offset: { x: -3.5, z: -2 }, health: 120, beat: 'start' },
  birdbath: { name: (s) => `${s.name}'s bird bath`, parts: birdBath, where: 'front', offset: { x: 3.2, z: 0.5 }, health: 120, beat: 'start' },
  letterbox: { name: (s) => `${s.name}'s letterbox`, parts: letterbox, where: 'front', offset: { x: 2.2, z: 1.7 }, health: 80, beat: 'start' },
  scarecrow: { name: (s) => `${s.name}'s scarecrow`, parts: scarecrow, where: 'back', offset: { x: 3.4, z: -1.2 }, health: 100, beat: 'start' },
  bench: { name: (s) => `${s.name}'s bench`, parts: bench, where: 'front', offset: { x: -1.5, z: 1.4 }, health: 150, beat: 'start' },
  car: { name: (s) => `${s.name}'s project car`, parts: carProject, where: 'front', offset: { x: 2.6, z: 0.4 }, health: 300, stages: 4, beat: 'tend' },
  tyres: { name: (s) => `${s.name}'s tyre pile`, parts: tyres, where: 'front', offset: { x: -3.6, z: -0.2 }, health: 120, beat: 'start' },
  workbench: { name: (s) => `${s.name}'s workbench`, parts: workbench, where: 'back', offset: { x: -2.5, z: 1.5 }, health: 150, beat: 'start' },
  bbq: { name: (s) => `${s.name}'s barbecue`, parts: bbq, where: 'back', offset: { x: 1.5, z: 1.5 }, health: 120, beat: 'start' },
  hoop: { name: (s) => `${s.name}'s basketball hoop`, parts: hoop, where: 'front', offset: { x: -1.2, z: 1.6 }, health: 200, beat: 'start' },
  shed: { name: (s) => `${s.name}'s shed`, parts: shed, where: 'back', offset: { x: 3.4, z: -1.8 }, health: 400, role: 'barrier', beat: 'start' },
  junk: { name: (s) => `${s.name}'s scrap sculpture`, parts: junkSculpture, where: 'back', offset: { x: -2, z: -2.4 }, health: 120, beat: 'start' },
};
interface Whim {
  name: string; // without the owner: "garden gnome"
  parts: () => Primitive[];
  health: number;
  role?: 'decoration' | 'barrier';
}
/** Small things that come and go through the whim slots, plus the fixed reactions (light, kennel, care). */
export const WHIMS: Record<string, Whim> = {
  gnome: { name: 'garden gnome', parts: gnome, health: 60 },
  flamingos: { name: 'lawn flamingos', parts: flamingos, health: 60 },
  sunflower: { name: 'giant sunflower', parts: sunflower, health: 80 },
  hammock: { name: 'hammock', parts: hammock, health: 120 },
  firewood: { name: 'firewood stack', parts: firewood, health: 120 },
  tank: { name: 'water tank', parts: tank, health: 200 },
  feeder: { name: 'bird feeder', parts: feeder, health: 60 },
  planter: { name: 'pot plant tower', parts: planter, health: 80 },
  sandbags: { name: 'sandbags', parts: sandbags, health: 260, role: 'barrier' },
  bell: { name: 'warning bell', parts: bell, health: 120 },
  lookout: { name: 'lookout platform', parts: lookout, health: 200 },
  firebarrel: { name: 'fire barrel', parts: firebarrel, health: 120 },
  lantern: { name: 'lantern post', parts: lantern, health: 100 },
  kennel: { name: 'kennel', parts: kennel, health: 150 },
  crate: { name: 'crate of supplies', parts: crate, health: 100 },
  tvpile: { name: 'pile of old TVs', parts: tvpile, health: 120 },
  ramp: { name: 'skate ramp', parts: ramp, health: 200 },
  weights: { name: 'weights bench', parts: weights, health: 150 },
  dish: { name: 'satellite dish', parts: dish, health: 100 },
};
/** Every blueprint the neighbours can put up, at every stage: tests measure them all. */
export function catalogueBlueprints(): Blueprint[] {
  const spec = NEIGHBOURS[0];
  const out: Blueprint[] = [
    { name: 'barricade', description: '', parts: barricade() },
    { name: 'turret', description: '', parts: turret() },
    { name: 'hunter', description: '', parts: hunter(0x4a4038) },
  ];
  for (const [key, p] of Object.entries(CATALOGUE))
    for (let s = 0; s < (p.stages ?? 1); s++) out.push({ name: key, description: '', parts: p.parts(s, spec) });
  for (const [key, w] of Object.entries(WHIMS)) out.push({ name: key, description: '', parts: w.parts() });
  return out;
}
/**
 * Something odd, never the same twice: a base, a body, a top and a few accents in weathered
 * colours with one bright note. Stays under 2.6 m and inside a 1.6 m footprint.
 */
export function oddity(rng: () => number, accent: number): { name: string; parts: Primitive[] } {
  const pick = <T>(xs: T[]) => xs[Math.min(xs.length - 1, Math.floor(rng() * xs.length))];
  const muted = [0x6f6a4e, 0x7a5a3e, 0x8b8f86, 0x5b6b8a, 0x6d6a60, 0x76705c, 0x4a4f4a, 0x9a8f7c];
  const parts: Primitive[] = [];
  const baseR = 0.35 + rng() * 0.35;
  const baseH = 0.15 + rng() * 0.3;
  parts.push(rng() < 0.5 ? cyl(baseR, baseH, pick(muted), 0, baseH / 2, 0) : box(baseR * 2, baseH, baseR * 2, pick(muted), 0, baseH / 2, 0));
  let y = baseH;
  const bodyH = 0.6 + rng() * 1.0;
  const bodyKind = rng();
  if (bodyKind < 0.35) parts.push(box(0.3 + rng() * 0.5, bodyH, 0.3 + rng() * 0.5, pick(muted), 0, y + bodyH / 2, 0, [0, rng() * 0.6, 0]));
  else if (bodyKind < 0.7) parts.push(cyl(0.15 + rng() * 0.25, bodyH, pick(muted), 0, y + bodyH / 2, 0));
  else parts.push(cone(0.3 + rng() * 0.3, bodyH, pick(muted), 0, y + bodyH / 2, 0));
  y += bodyH;
  const topKind = rng();
  const topR = 0.15 + rng() * 0.3;
  if (topKind < 0.4) parts.push(ball(topR, accent, 0, y + topR, 0));
  else if (topKind < 0.7) parts.push(cone(topR, topR * 2, accent, 0, y + topR, 0, [rng() * 0.5, 0, rng() * 0.5]));
  else parts.push(box(topR * 2, topR * 0.6, topR * 2, accent, 0, y + topR * 0.3, 0, [0, rng() * 1.2, 0]));
  const accents = 1 + Math.floor(rng() * 3);
  for (let i = 0; i < accents; i++) {
    const a = rng() * Math.PI * 2,
      r = 0.25 + rng() * 0.3,
      ay = baseH + rng() * bodyH;
    if (rng() < 0.5) parts.push(cyl(0.02 + rng() * 0.02, 0.4 + rng() * 0.6, pick(muted), Math.sin(a) * r, ay, Math.cos(a) * r, [rng() - 0.5, 0, rng() - 0.5]));
    else parts.push(ball(0.06 + rng() * 0.08, rng() < 0.5 ? accent : pick(muted), Math.sin(a) * r, ay, Math.cos(a) * r));
  }
  const name = pick([
    'odd sculpture',
    'thing made of scrap',
    'garden ornament',
    'art, apparently',
    'totem',
    'whatever this is',
    'conversation piece',
    'experiment',
    'monument to something',
  ]);
  return { name, parts };
}

// ---- Helpers --------------------------------------------------------------------------------

const distance = (a: GroundPoint, b: GroundPoint) => Math.hypot(a.x - b.x, a.z - b.z);
const rectOf = (o: SafehouseObject) => footprint(o.position, o.footprint.width, o.footprint.depth);
const distanceTo = (p: GroundPoint, o: SafehouseObject) => {
  const r = rectOf(o);
  return Math.hypot(Math.max(r.minX - p.x, 0, p.x - r.maxX), Math.max(r.minZ - p.z, 0, p.z - r.maxZ));
};
const speakThreat = (o: SafehouseObject | undefined) => (o ? o.blueprint.name.replace(/^(the|a|an)\s+/i, '').toLowerCase() : 'that thing');
/** "Yard gorilla" → "gorilla", "Laundry-thief T-rex" → "t-rex": the last word is usually the animal. */
const threatNoun = (o: SafehouseObject) => {
  const words = o.blueprint.name.toLowerCase().replace(/[^a-z0-9 -]/g, '').trim().split(/\s+/);
  return words[words.length - 1] || 'monster';
};
/**
 * A hunter is built heavy: the app's fighter profile is a yard dog, and a dog loses to a
 * rampager one on one (8 damage a second against 150 health beats 10 against 300). At this
 * health a hunter narrowly wins the same fight, badly hurt. Fixed by the app like every other stat.
 */
export const HUNTER_HEALTH = 260;
const ownId = (spec: NeighbourSpec, key: string) => `neighbour-${spec.id}-${key}`;
const owned = (w: World, spec: NeighbourSpec) => w.objects.filter((o) => o.owner === spec.id);
const ownedArchived = (w: World, spec: NeighbourSpec) => w.combat.archive.filter((o) => o.owner === spec.id);
/**
 * A yard piece: one of the five slots, and the only thing a theme may redo. Defenses (barricades,
 * a turret), creatures and the fixed reactions — a light for the dark, a kennel for a stray, the
 * crate on Rook's porch — sit outside the cap and outside the theme. They answer events rather
 * than taste, they are each separately limited already, and a Jurassic phase must never quietly
 * replace the barricade holding a rampager off the house.
 */
export const yardPiece = (o: SafehouseObject) =>
  !o.creature && (o.role ?? 'decoration') === 'decoration' && !/-(light|kennel|care)$/.test(o.id);
/** Their moving pieces, across both neighbours: the shared creature budget. */
const neighbourCreatures = (w: World) => w.objects.filter((o) => o.owner && o.creature && intact(o)).length;
const house = (w: World, spec: NeighbourSpec) => w.objects.find((o) => o.id === spec.houseId);
const archivedHouse = (w: World, spec: NeighbourSpec) => w.combat.archive.find((o) => o.id === spec.houseId);
const pick = <T>(list: T[], rng: () => number): T => list[Math.min(list.length - 1, Math.floor(rng() * list.length))];
const lower = (name: string) => name.replace(/^[\w.]+['’]s\s+/, '').replace(/^(the|a|an)\s+/i, '').toLowerCase();
// A piece they could not build or fix waits a while before they try again (chat may have built on the spot).
const skips = new Map<string, number>();
export function resetNeighbourMemory(): void {
  skips.clear();
}

function say(n: NeighbourState, spec: NeighbourSpec, beat: Beat, now: number, rng: () => number, vars: { threat?: string } = {}) {
  if (n.say && n.say.until > now) return;
  const text = pick(spec.lines[beat], rng).replace('{threat}', vars.threat ?? 'you');
  n.say = { text, until: now + Math.min(7000, ttlFor(text)) };
}
function impulse(n: NeighbourState, imp: Omit<Impulse, 'at'>, now: number) {
  n.impulses ??= [];
  if (n.impulses.some((i) => i.kind === imp.kind && i.targetId === imp.targetId && i.name === imp.name)) return;
  n.impulses.push({ ...imp, at: now });
  if (n.impulses.length > 6) n.impulses.shift();
}

function ownObject(spec: NeighbourSpec, id: string, name: string, parts: Primitive[], position: GroundPoint, size: { width: number; depth: number }, opts: { health: number; role?: SafehouseObject['role']; creature?: SafehouseObject['creature']; description?: string }, now: number): SafehouseObject {
  return initializeObject({
    id,
    revision: 1,
    blueprint: { name, description: opts.description ?? `Built by ${spec.name} next door`, parts },
    position,
    footprint: size,
    createdBy: spec.name,
    editedBy: spec.name,
    createdAt: now,
    role: opts.role ?? 'decoration',
    health: opts.health,
    maxHealth: opts.health,
    fixed: true,
    owner: spec.id,
    creature: opts.creature,
  });
}

/** Candidate spots: a small patch around the preferred point first, then the whole yard, nearest that point first. */
function spotsAround(area: Rect, preferred: GroundPoint): GroundPoint[] {
  const points: GroundPoint[] = [];
  for (let x = Math.ceil(area.minX * 2) / 2; x <= area.maxX; x += 0.5)
    for (let z = Math.ceil(area.minZ * 2) / 2; z <= area.maxZ; z += 0.5) points.push({ x, z });
  return points.sort((a, b) => distance(a, preferred) - distance(b, preferred));
}
const middle = (r: Rect): GroundPoint => ({ x: (r.minX + r.maxX) / 2, z: (r.minZ + r.maxZ) / 2 });
const randomIn = (r: Rect, rng: () => number): GroundPoint => ({ x: r.minX + rng() * (r.maxX - r.minX), z: r.minZ + rng() * (r.maxZ - r.minZ) });

/** Try a placement; undefined rather than a throw, and never outside the given ground. */
function place(size: { width: number; depth: number }, w: World, from: GroundPoint, candidates: GroundPoint[], within: Rect, target?: SafehouseObject) {
  const inside = candidates.filter((p) => {
    const r = footprint(p, size.width, size.depth);
    return r.minX >= within.minX && r.maxX <= within.maxX && r.minZ >= within.minZ && r.maxZ <= within.maxZ;
  });
  if (!inside.length) return undefined;
  try {
    return choosePlacement(size, [...w.objects, ...neighbourGhosts(w)], from, target, inside);
  } catch {
    return undefined;
  }
}
/** In place, where the piece already stands (repairs) or stood (rebuilds); a rebuild checks the ground is still free. */
function placeInPlace(w: World, from: GroundPoint, target: SafehouseObject, standing: boolean) {
  if (!standing) {
    const zone = inflate(rectOf(target), 0.3);
    const blocked = [...w.objects, ...neighbourGhosts(w)].some(
      (o) => o.id !== target.id && intact(o) && !o.passable && !o.creature && overlaps(zone, rectOf(o)),
    );
    if (blocked) return undefined;
  }
  try {
    return choosePlacement(target.footprint, w.objects, from, target, target.position);
  } catch {
    return undefined;
  }
}

// ---- Planning ------------------------------------------------------------------------------

function startJob(n: NeighbourState, job: NeighbourJob) {
  n.job = job;
  n.path = [];
  n.activity = 'walking';
}
const workFor = (pace: Pace, parts: number, base = 8000) => pace.workMs ?? Math.min(45_000, Math.max(12_000, base + parts * 900));
const repairFor = (pace: Pace, missing: number) => pace.workMs ?? Math.min(60_000, Math.max(4000, missing * 40));

/** What they respond with at this escalation level, or nothing when the ladder is spent. */
function planDefense(n: NeighbourState, spec: NeighbourSpec, w: World, threat: SafehouseObject, pace: Pace, now: number, rng: () => number): boolean {
  const t = n.threat!;
  const mine = owned(w, spec).filter(intact);
  const barricades = mine.filter((o) => o.id.startsWith(ownId(spec, 'barricade'))).length;
  const hasTurret = mine.some((o) => o.id === ownId(spec, 'turret'));
  const hasHunter = mine.some((o) => o.id === ownId(spec, 'hunter'));
  const airborne = flies(threat);
  const home = house(w, spec);
  const creatures = w.objects.filter((o) => o.creature && intact(o)).length;
  // Defenses are outside the yard-slot cap: each rung is already limited on its own (two
  // barricades, one hunter, one turret) and a full yard must never stop them answering a threat.
  const room = w.objects.length < 560;
  // The ladder: planks, then something with teeth, then a gun. A flyer skips straight to the gun.
  for (; t.level < 3; t.level++) {
    if (t.level === 0 && !airborne && barricades < 2 && room && home) {
      const r = rectOf(home),
        c = home.position;
      // The side of the house the creature is on; a run of spots along that face, then the corners.
      const dx = threat.position.x - c.x,
        dz = threat.position.z - c.z;
      const side: 'x' | 'z' = Math.abs(dx) * (r.maxZ - r.minZ) > Math.abs(dz) * (r.maxX - r.minX) ? 'x' : 'z';
      const out = 2.4;
      const spots: GroundPoint[] = [];
      for (const j of [0, 1.6, -1.6, 3.2, -3.2, 4.8, -4.8])
        spots.push(
          side === 'z'
            ? { x: c.x + j, z: dz > 0 ? r.maxZ + out : r.minZ - out }
            : { x: dx > 0 ? r.maxX + out : r.minX - out, z: c.z + j },
        );
      spots.sort((a, b) => distance(a, threat.position) - distance(b, threat.position)); // nearest the creature first
      const parts = side === 'x' ? rotateBlueprint({ name: '', description: '', parts: barricade() }, Math.PI / 2).parts : barricade();
      const blueprint = { name: `${spec.name}'s barricade`, description: '', parts };
      const size = measureBlueprint(blueprint, SCENERY_LIMITS);
      const placed = place(size, w, n.position, spots, spec.lot);
      if (!placed) continue;
      const id = `${ownId(spec, 'barricade')}-${barricades + 1}-${crypto.randomUUID().slice(0, 4)}`;
      const preview = ownObject(spec, id, blueprint.name, parts, placed.position, size, { health: 300, role: 'barrier', description: `Put up by ${spec.name} against ${speakThreat(threat)}` }, now);
      startJob(n, { kind: 'build', purpose: 'defense', label: blueprint.name, status: 'walking', path: placed.path, spot: placed.position, workedMs: 0, workMs: workFor(pace, parts.length, 6000), preview });
      say(n, spec, 'barricade', now, rng);
      t.level++;
      return true;
    }
    if (t.level === 1 && !airborne && !hasHunter && room && neighbourCreatures(w) < NEIGHBOUR_CREATURE_BUDGET && creatures < MAX_CREATURES) {
      const noun = threatNoun(threat);
      const parts = hunter(spec.id === 'west' ? 0x4a4038 : 0x3b3f44);
      const name = `${spec.name}'s ${noun} hunter`;
      const size = measureBlueprint({ name, description: '', parts }, SCENERY_LIMITS);
      const placed = place(size, w, n.position, spotsAround(spec.front, { x: spec.home.x + (spec.id === 'west' ? -2.5 : 2.5), z: spec.home.z + 1.2 }), spec.lot);
      if (!placed) continue;
      const creature = { ...freshCreature('fight'), nemesis: threat.id };
      const preview = ownObject(spec, ownId(spec, 'hunter'), name, parts, placed.position, size, { health: HUNTER_HEALTH, creature, description: `${spec.name} built it to go after ${speakThreat(threat)}` }, now);
      startJob(n, { kind: 'build', purpose: 'defense', label: name, status: 'walking', path: placed.path, spot: placed.position, workedMs: 0, workMs: workFor(pace, parts.length, 10_000), preview });
      say(n, spec, 'hunter', now, rng, { threat: speakThreat(threat) });
      t.level++;
      return true;
    }
    if (t.level === 2 && !hasTurret && room) {
      const parts = turret();
      const name = `${spec.name}'s turret`;
      const size = measureBlueprint({ name, description: '', parts }, SCENERY_LIMITS);
      const toward = { x: spec.home.x + Math.sign(threat.position.x - spec.home.x) * 3, z: Math.min(spec.front.maxZ - 1, Math.max(spec.front.minZ + 1, threat.position.z)) };
      const placed = place(size, w, n.position, spotsAround(spec.front, toward), spec.lot);
      if (!placed) continue;
      const preview = ownObject(spec, ownId(spec, 'turret'), name, parts, placed.position, size, { health: 120, role: 'turret', description: `${spec.name}'s answer to ${speakThreat(threat)}` }, now);
      startJob(n, { kind: 'build', purpose: 'defense', label: name, status: 'walking', path: placed.path, spot: placed.position, workedMs: 0, workMs: workFor(pace, parts.length, 9000), preview });
      say(n, spec, 'turret', now, rng);
      t.level++;
      return true;
    }
  }
  return false;
}

/** Their own house first, then defenses, then the rest; knocked-down before scuffed; nearest first. */
function planRepair(n: NeighbourState, spec: NeighbourSpec, w: World, pace: Pace, now: number, rng: () => number): boolean {
  const mine = [...owned(w, spec), ...ownedArchived(w, spec)];
  const home = house(w, spec) ?? archivedHouse(w, spec);
  const needs = (o: SafehouseObject) => {
    if (o.creature) return !intact(o); // their hunter comes back when it is down; scratches on it are its own business
    const max = o.maxHealth ?? 80;
    return !intact(o) || (o.health ?? max) < max * (o.id === spec.houseId ? 0.8 : 0.7);
  };
  const tier = (o: SafehouseObject) => (o.id === spec.houseId ? 0 : o.role === 'barrier' || o.role === 'turret' || o.creature ? 1 : 2);
  const candidates = [...(home ? [home] : []), ...mine]
    .filter((o) => needs(o) && (skips.get(o.id) ?? 0) <= now)
    .sort((a, b) => tier(a) - tier(b) || Number(intact(a)) - Number(intact(b)) || distanceTo(n.position, a) - distanceTo(n.position, b));
  for (const target of candidates) {
    const standing = w.objects.includes(target);
    if (!standing && !intact(target) && w.objects.length >= 560) continue;
    if (
      target.creature &&
      (neighbourCreatures(w) >= NEIGHBOUR_CREATURE_BUDGET || w.objects.filter((o) => o.creature && intact(o)).length >= MAX_CREATURES)
    )
      continue;
    const placed = placeInPlace(w, n.position, target, standing && intact(target));
    if (!placed) {
      skips.set(target.id, now + 120_000);
      continue;
    }
    const max = target.maxHealth ?? 80;
    const missing = intact(target) ? max - (target.health ?? max) : max;
    const preview = structuredClone(target);
    preview.revision = target.revision + 1;
    preview.lifecycle = intact(target) ? (target.lifecycle ?? 1) : (target.lifecycle ?? 1) + 1;
    delete preview.destroyedAt; // a rebuild stands again; the rubble mark stays on the archived copy only
    if (preview.creature) {
      preview.creature.path = [];
      preview.creature.targetId = undefined;
      preview.creature.moving = false;
      preview.creature.replanMs = 0;
    }
    const rebuild = !intact(target);
    startJob(n, {
      kind: rebuild ? 'rebuild' : 'repair',
      purpose: 'upkeep',
      label: `${rebuild ? 'Rebuilding' : 'Fixing'} ${target.blueprint.name}`,
      status: 'walking',
      path: placed.path,
      spot: target.position,
      workedMs: 0,
      workMs: repairFor(pace, missing),
      preview,
      targetId: target.id,
      baseRevision: target.revision,
      baseLifecycle: target.lifecycle,
    });
    say(n, spec, 'repair', now, rng);
    return true;
  }
  return false;
}

/** The dominant colour of a design (by part volume): what "the walls" means on any house design. */
function dominantColor(b: Blueprint): string {
  const volume = new Map<string, number>();
  for (const p of b.parts) volume.set(p.color, (volume.get(p.color) ?? 0) + p.size[0] * p.size[1] * p.size[2]);
  return [...volume.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '#8c8b78';
}

/**
 * A slot for something new: a fixed one (`light`, `kennel`, `care`) or one of their yard slots.
 *
 * The pool is a *count*, not a list of ids — whatever yard pieces they happen to have, however
 * they got them. Under the cap they take fresh ground; at it, the oldest piece is the one that
 * gets redone, so a yard of five keeps changing without ever becoming a yard of six. Because
 * replacing an occupant reuses its id and bumps its revision, the cap needs no enforcement of
 * its own: the pool size *is* the cap.
 */
function slotFor(n: NeighbourState, spec: NeighbourSpec, w: World, key?: string): { id: string; existing?: SafehouseObject } {
  const all = [...w.objects, ...w.combat.archive];
  if (key) {
    const id = ownId(spec, key);
    return { id, existing: all.find((o) => o.id === id) };
  }
  // Archived pieces count: one of theirs in rubble is a slot waiting on a repair, not free ground.
  const mine = all.filter((o) => o.owner === spec.id && yardPiece(o));
  if (mine.length < OWNED_SLOTS) return { id: `${ownId(spec, 'slot')}-${crypto.randomUUID().slice(0, 4)}` };
  // The oldest piece goes — except that a staged project still growing (the vegetables, the car)
  // is passed over while there is anything else to take. They are built first, so they are always
  // the oldest, and without this Marge's vegetables would be demolished before they ever sprouted.
  // Nothing is protected outright: a theme that names the piece replaces it like any other.
  const growing = (o: SafehouseObject) =>
    Object.keys(n.stages ?? {}).some((k) => o.id === ownId(spec, k) && (CATALOGUE[k]?.stages ?? 0) > 0);
  const oldestOf = (list: SafehouseObject[]) => list.reduce((a, b) => (b.createdAt < a.createdAt ? b : a));
  const spare = mine.filter((o) => !growing(o));
  const target = oldestOf(spare.length ? spare : mine);
  return { id: target.id, existing: target };
}
/**
 * Put a design up: in a slot on their own lot (or, for the care crate, in front of Rook's), as a
 * fresh build or as a replacement of the slot's old occupant. Returns whether a job started.
 */
function build(
  n: NeighbourState,
  spec: NeighbourSpec,
  w: World,
  design: ReadyDesign,
  slot: { id: string; existing?: SafehouseObject },
  where: { area: Rect; preferred: GroundPoint; within: Rect },
  pace: Pace,
  now: number,
  rng: () => number,
  reason: ImpulseKind,
  health: number,
  beat: Beat,
): boolean {
  // No per-neighbour cap needed here: slotFor only hands out a fresh yard slot while they are
  // under OWNED_SLOTS, and the named slots (a light, a kennel, Rook's crate) sit outside it by
  // design. All that is left to respect is the world's own object ceiling.
  if (!slot.existing && w.objects.length >= 560) return false;
  let creature: SafehouseObject['creature'];
  if (design.pet) {
    if (neighbourCreatures(w) >= NEIGHBOUR_CREATURE_BUDGET) return false;
    if (w.objects.filter((o) => o.creature && intact(o)).length >= MAX_CREATURES) return false;
    creature = freshCreature('roam', !!design.flying);
  }
  let size: { width: number; depth: number };
  try {
    size = measureBlueprint(design.blueprint, SCENERY_LIMITS);
  } catch {
    return false;
  }
  const standing = slot.existing && w.objects.includes(slot.existing) && intact(slot.existing);
  const placed = place(size, w, n.position, spotsAround(where.area, where.preferred), where.within, standing ? slot.existing : undefined);
  if (!placed) {
    skips.set(slot.id, now + 120_000);
    return false;
  }
  const name = /^[\w.]+['’]s\s/.test(design.name) ? design.name : `${spec.name}'s ${lower(design.name)}`;
  // The model's own description stays (it is what Inspect shows); catalogue pieces get the plain one.
  const description = design.blueprint.description?.trim() ? design.blueprint.description.trim().slice(0, 240) : `Built by ${spec.name} next door`;
  const preview = ownObject(spec, slot.id, name.slice(0, 70), design.blueprint.parts, placed.position, size, { health, role: design.role ?? 'decoration', creature, description }, now);
  if (slot.existing) {
    preview.revision = slot.existing.revision + 1;
    preview.lifecycle = slot.existing.lifecycle ?? 1;
  }
  startJob(n, {
    kind: 'build',
    purpose: 'project',
    label: name,
    status: 'walking',
    path: placed.path,
    spot: placed.position,
    workedMs: 0,
    workMs: workFor(pace, design.blueprint.parts.length),
    preview,
    targetId: slot.existing?.id,
    baseRevision: slot.existing?.revision,
    baseLifecycle: slot.existing?.lifecycle,
    reason,
  });
  if (design.reply?.trim()) n.say = { text: design.reply.trim().slice(0, 180), until: now + Math.min(8000, ttlFor(design.reply)) };
  else say(n, spec, beat, now, rng);
  return true;
}
const whimDesign = (key: string): ReadyDesign => {
  const wm = WHIMS[key];
  return { blueprint: { name: wm.name, description: '', parts: wm.parts() }, name: wm.name, role: wm.role };
};
const yardOf = (spec: NeighbourSpec, rng: () => number) => (rng() < 0.55 ? spec.front : spec.back);

/** The next whim from the catalogue in rotation, or an oddity. */
function nextWhim(n: NeighbourState, spec: NeighbourSpec, rng: () => number): { design: ReadyDesign; health: number } {
  const seq = n.whimSeq ?? 0;
  n.whimSeq = seq + 1;
  if (rng() < 0.4) {
    const odd = oddity(rng, [0xc4402f, 0xd9b53a, 0x5a7a86, 0xe28aa0, 0x6f8c52][seq % 5]);
    return { design: { blueprint: { name: odd.name, description: '', parts: odd.parts }, name: odd.name }, health: 80 };
  }
  const key = spec.whims[seq % spec.whims.length];
  return { design: whimDesign(key), health: WHIMS[key].health };
}

// ---- One-upping ------------------------------------------------------------------------------

/** A build worth one-upping: a creation, not a defense, a pet, or one of the fixed reactions (light, kennel, crate). */
const outdoable = (o: SafehouseObject) =>
  !o.creature && (o.role ?? 'decoration') === 'decoration' && !/-(light|kennel|care)$/.test(o.id);
const ONE_UP = ['bigger', 'better', 'deluxe', 'superior', 'proper', 'grander'];
/** How much bigger the answer is, and the most room it may take: a yard thing, not a landmark. */
const ONE_UP_SCALE = 1.3;
export const ONE_UP_LIMITS: Limits = { width: 5.5, depth: 5.5, height: 6 };
const GOLD = '#d9b53a';
/**
 * The same thing, bigger and "better": the design scaled up, set on a plinth, its topmost part
 * picked out in gold, named for it (`bigger bird bath`, the adjectives in rotation) and a quarter
 * tougher. Nothing that cannot come out at least a tenth larger — the shed, a car already at the
 * limit, one of chat's big builds — there is no showing anyone up with that, and the caller lets it go.
 */
export function oneUp(spec: NeighbourSpec, target: SafehouseObject, seq: number): { design: ReadyDesign; health: number } | undefined {
  if (target.blueprint.parts.length >= 100) return undefined;
  let before: { width: number; depth: number }, fitted: Blueprint;
  try {
    before = measureBlueprint(target.blueprint, SCENERY_LIMITS);
    const parts = target.blueprint.parts.map((p) => ({
      ...p,
      position: p.position.map((v) => v * ONE_UP_SCALE) as Primitive['position'],
      size: p.size.map((v) => v * ONE_UP_SCALE) as Primitive['size'],
    }));
    fitted = fitBlueprint({ name: '', description: '', parts }, ONE_UP_LIMITS, true).blueprint;
  } catch {
    return undefined;
  }
  const after = measureBlueprint(fitted, SCENERY_LIMITS);
  if (Math.max(after.width / before.width, after.depth / before.depth) < 1.1) return undefined;
  const plinth = 0.18;
  const top = fitted.parts.reduce((best, p) => (p.position[1] + p.size[1] / 2 > best.position[1] + best.size[1] / 2 ? p : best), fitted.parts[0]);
  top.color = GOLD;
  for (const p of fitted.parts) p.position[1] += plinth;
  fitted.parts.unshift(box(after.width + 0.3, plinth, after.depth + 0.3, 0x8b8f86, 0, plinth / 2, 0));
  const other = NEIGHBOURS.find((s) => s.id === target.owner);
  const whose = other ? `${other.name}'s` : "chat's";
  const name = `${ONE_UP[seq % ONE_UP.length]} ${lower(target.blueprint.name)}`;
  const blueprint: Blueprint = {
    name,
    description: `Built by ${spec.name} next door. Bigger than ${whose}, as it should be.`,
    parts: fitted.parts,
  };
  return { design: { blueprint, name, role: 'decoration' }, health: Math.round((target.maxHealth ?? 100) * 1.25) };
}

// ---- Names ----------------------------------------------------------------------------------------

/** Names a neighbour went by in older saves, by id. */
const FORMER_NAMES: Record<string, string[]> = { east: ['Dev'] };
/**
 * What an older save built under a former name takes the current one: "Dev's project car" →
 * "Jake's project car", "Dev lives here", the builder fields, a job label in flight. Run at
 * start-up (index.ts); no version bump. Returns whether anything changed.
 */
export function adoptNames(w: { objects: SafehouseObject[]; combat: CombatState; neighbours: NeighbourState[] }): boolean {
  let changed = false;
  for (const spec of NEIGHBOURS) {
    for (const old of FORMER_NAMES[spec.id] ?? []) {
      const prefix = new RegExp(`^${old}['’]s\\s`);
      const rename = (s: string) => s.replace(prefix, `${spec.name}'s `);
      for (const o of [...w.objects, ...w.combat.archive]) {
        if (o.id === spec.houseId) {
          if (o.blueprint.description === `${old} lives here`) {
            o.blueprint = { ...o.blueprint, description: `${spec.name} lives here` };
            changed = true;
          }
          if (o.editedBy === old) {
            o.editedBy = spec.name;
            changed = true;
          }
          continue;
        }
        if (o.owner !== spec.id) continue;
        const name = rename(o.blueprint.name);
        const description = o.blueprint.description === `Built by ${old} next door` ? `Built by ${spec.name} next door` : o.blueprint.description;
        if (name === o.blueprint.name && description === o.blueprint.description && o.createdBy !== old && o.editedBy !== old) continue;
        o.blueprint = { ...o.blueprint, name, description };
        if (o.createdBy === old) o.createdBy = spec.name;
        if (o.editedBy === old) o.editedBy = spec.name;
        changed = true;
      }
      const job = w.neighbours.find((x) => x.id === spec.id)?.job;
      if (job && prefix.test(job.label)) {
        job.label = rename(job.label);
        changed = true;
      }
      if (job?.preview && (prefix.test(job.preview.blueprint.name) || job.preview.createdBy === old)) {
        job.preview.blueprint = { ...job.preview.blueprint, name: rename(job.preview.blueprint.name) };
        if (job.preview.createdBy === old) job.preview.createdBy = spec.name;
        if (job.preview.editedBy === old) job.preview.editedBy = spec.name;
        changed = true;
      }
    }
  }
  return changed;
}

/** Act on an idea. Some go to the model first (when allowed and not too soon after the last); the rest are done here. */
function act(n: NeighbourState, spec: NeighbourSpec, w: World, imp: Impulse, pace: Pace, now: number, rng: () => number, events: NeighbourEvent[]): boolean {
  const other = NEIGHBOURS.find((s) => s.id !== spec.id)!;
  const wantsModel =
    !imp.design &&
    !imp.noAi &&
    pace.ai &&
    (imp.kind === 'whim' || imp.kind === 'rival' || imp.kind === 'fortify' || imp.kind === 'retheme') &&
    now - (n.aiAt ?? 0) >= pace.aiGapMs;
  if (wantsModel) {
    n.wish = { kind: imp.kind, idea: imp.idea, name: imp.name, targetId: imp.targetId, brief: imp.brief, at: now };
    n.aiAt = now; // the gap runs from the ask, so a failure does not bring the next ask forward
    say(n, spec, 'idea', now, rng);
    return true; // nothing in hand yet; the design comes back through fulfilWish
  }
  switch (imp.kind) {
    case 'visit': {
      const target = w.objects.find((o) => o.id === imp.targetId && intact(o));
      if (!target) return false;
      const r = rectOf(target);
      const sides = [
        { x: target.position.x, z: r.maxZ + 1.0 },
        { x: target.position.x, z: r.minZ - 1.0 },
        { x: r.minX - 1.0, z: target.position.z },
        { x: r.maxX + 1.0, z: target.position.z },
      ].sort((a, b) => distance(a, n.position) - distance(b, n.position));
      // Rook remarks on a visit to something of chat's, not on the neighbours eyeing each other's things.
      const reason = target.owner ? 'admire' : 'visit';
      for (const p of sides) {
        const path = route(n.position, p, w.objects);
        if (!path || path.length > 200) continue;
        startJob(n, { kind: 'look', purpose: 'project', label: `Having a look at ${lower(target.blueprint.name)}`, status: 'walking', path: straighten(path), spot: target.position, workedMs: 0, workMs: pace.workMs ?? 6000 + rng() * 4000, targetId: target.id, reason });
        events.push({ kind: 'visit', who: spec.name, id: spec.id, name: target.blueprint.name, reason });
        return true;
      }
      return false;
    }
    case 'social': {
      const spot = { x: other.home.x + (spec.id === 'west' ? -2.2 : 2.2), z: other.home.z + 0.6 };
      const path = route(n.position, spot, w.objects);
      if (!path) return false;
      startJob(n, { kind: 'look', purpose: 'project', label: `Over at ${other.name}'s`, status: 'walking', path: straighten(path), spot: other.home, workedMs: 0, workMs: pace.workMs ?? 7000 + rng() * 5000, reason: 'social' });
      say(n, spec, 'social', now, rng);
      events.push({ kind: 'visit', who: spec.name, id: spec.id, name: `${other.name}'s place`, reason: 'social' });
      return true;
    }
    case 'rearrange': {
      const movable = owned(w, spec).filter((o) => intact(o) && !o.creature && o.role === 'decoration' && !o.id.includes('-veg') && !o.id.includes('-car'));
      if (!movable.length) return false;
      const piece = pick(movable, rng);
      const area = yardOf(spec, rng);
      const placed = place(piece.footprint, w, n.position, spotsAround(area, randomIn(area, rng)), spec.lot, piece);
      if (!placed || distance(placed.position, piece.position) < 1.5) return false;
      const preview: SafehouseObject = { ...structuredClone(piece), revision: piece.revision + 1, position: placed.position, editedBy: spec.name };
      startJob(n, { kind: 'edit', purpose: 'project', label: `Moving ${lower(piece.blueprint.name)}`, status: 'walking', path: placed.path, spot: placed.position, workedMs: 0, workMs: pace.workMs ?? 6000, preview, targetId: piece.id, baseRevision: piece.revision, baseLifecycle: piece.lifecycle, reason: 'rearrange' });
      say(n, spec, 'whim', now, rng);
      return true;
    }
    case 'light': {
      const slot = slotFor(n, spec, w, 'light');
      if (slot.existing && w.objects.includes(slot.existing) && intact(slot.existing)) return false;
      const key = spec.id === 'west' ? 'lantern' : 'firebarrel';
      return build(n, spec, w, imp.design ?? whimDesign(key), slot, { area: spec.front, preferred: { x: spec.home.x + (spec.id === 'west' ? 2 : -2), z: spec.home.z + 1.4 }, within: spec.lot }, pace, now, rng, 'light', WHIMS[key].health, 'light');
    }
    case 'pet': {
      const slot = slotFor(n, spec, w, 'kennel');
      if (slot.existing && w.objects.includes(slot.existing) && intact(slot.existing)) return false;
      const key = spec.id === 'west' ? 'feeder' : 'kennel';
      return build(n, spec, w, imp.design ?? whimDesign(key), slot, { area: spec.back, preferred: middle(spec.back), within: spec.lot }, pace, now, rng, 'pet', WHIMS[key].health, 'pet');
    }
    case 'care': {
      const slot = slotFor(n, spec, w, 'care');
      if (slot.existing && w.objects.includes(slot.existing) && intact(slot.existing)) return false;
      const yard = LANDMARKS['front yard'];
      const ok = build(n, spec, w, whimDesign('crate'), slot, { area: yard, preferred: { x: spec.id === 'west' ? -3 : 3, z: 2.2 }, within: inflate(yard, 2) }, pace, now, rng, 'care', WHIMS.crate.health, 'care');
      if (ok) {
        n.job!.label = `Dropping off supplies for Rook`;
        events.push({ kind: 'care', who: spec.name, id: spec.id, name: n.job!.preview!.blueprint.name, reason: 'care' });
      }
      return ok;
    }
    case 'fortify': {
      const design = imp.design ?? whimDesign(pick(['sandbags', 'bell', 'lookout'], rng));
      const health = imp.design ? (design.role === 'barrier' ? 260 : 120) : WHIMS[design.name === 'sandbags' ? 'sandbags' : design.name === 'warning bell' ? 'bell' : 'lookout'].health;
      return build(n, spec, w, design, slotFor(n, spec, w), { area: spec.front, preferred: { x: spec.home.x + (rng() - 0.5) * 6, z: spec.front.maxZ - 0.8 }, within: spec.lot }, pace, now, rng, 'fortify', health, 'fortify');
    }
    case 'rival': {
      // The model's answer if one came; else the thing itself, bigger. Nothing to outdo — it went, or
      // it cannot be made bigger — chat's gets any old whim in reply and the neighbour's is let go.
      const target = [...w.objects, ...w.combat.archive].find((o) => o.id === imp.targetId);
      const bigger = target && !imp.design ? oneUp(spec, target, n.whimSeq ?? 0) : undefined;
      if (bigger) n.whimSeq = (n.whimSeq ?? 0) + 1;
      const fallback = !imp.design && !bigger && target && !target.owner ? nextWhim(n, spec, rng) : undefined;
      const design = imp.design ?? bigger?.design ?? fallback?.design;
      if (!design) return false;
      const health = imp.design ? (design.role === 'barrier' ? 260 : design.pet ? 60 : 100) : (bigger ?? fallback)!.health;
      // A bigger thing goes where there is room for it: the front yard is shallow.
      let area = yardOf(spec, rng);
      try {
        const size = measureBlueprint(design.blueprint, SCENERY_LIMITS);
        if (size.depth > spec.front.maxZ - spec.front.minZ - 0.4 || size.width > spec.front.maxX - spec.front.minX - 0.4) area = spec.back;
      } catch {
        return false;
      }
      return build(n, spec, w, design, slotFor(n, spec, w), { area, preferred: randomIn(area, rng), within: spec.lot }, pace, now, rng, 'rival', health, 'rival');
    }
    case 'retheme': {
      // The piece this idea was drawn up for, if it still stands; otherwise the oldest yard slot,
      // so a theme keeps converting even when chat has been rearranging things underneath.
      const target = imp.targetId ? w.objects.find((o) => o.id === imp.targetId && intact(o) && yardPiece(o)) : undefined;
      const slot = target ? { id: target.id, existing: target } : slotFor(n, spec, w);
      // No model design (off, paused, failed or would not fit): the catalogue redoes the piece
      // instead, so a yard still converts — just in their own old taste rather than the theme.
      const fallback = imp.design ? undefined : nextWhim(n, spec, rng);
      const design = imp.design ?? fallback!.design;
      const health = imp.design ? (design.role === 'barrier' ? 260 : design.pet ? 60 : 100) : fallback!.health;
      // Redone where it stood: the piece is replaced, not relocated across the garden.
      const area = slot.existing ? (contains(spec.front, slot.existing.position) ? spec.front : spec.back) : yardOf(spec, rng);
      const preferred = slot.existing ? slot.existing.position : randomIn(area, rng);
      return build(n, spec, w, design, slot, { area, preferred, within: spec.lot }, pace, now, rng, 'retheme', health, 'retheme');
    }
    case 'whim': {
      const fallback = nextWhim(n, spec, rng);
      const design = imp.design ?? fallback.design;
      const health = imp.design ? (design.role === 'barrier' ? 260 : design.pet ? 60 : 100) : fallback.health;
      const area = yardOf(spec, rng);
      return build(n, spec, w, design, slotFor(n, spec, w), { area, preferred: randomIn(area, rng), within: spec.lot }, pace, now, rng, 'whim', health, 'whim');
    }
  }
}

/** Something to do with the afternoon: the next one-off, a stage of a staged build, a fresh coat, or a whim. */
function planProject(n: NeighbourState, spec: NeighbourSpec, w: World, pace: Pace, now: number, rng: () => number): boolean {
  const mine = owned(w, spec);
  const home = house(w, spec);
  const present = new Set([...w.objects, ...w.combat.archive].map((o) => o.id));
  // Catalogue one-offs build their own ids rather than going through slotFor, so the yard-slot
  // cap has to be checked here by hand — otherwise the offline fallback would walk past it.
  const room = mine.filter((o) => intact(o) && yardPiece(o)).length < OWNED_SLOTS && w.objects.length < 560;
  // 0. Bringing the yard into line with the block. This comes ahead of the old project list
  //    because the theme is now the main thing they do with an afternoon: one piece per cycle,
  //    so five slots convert over an afternoon rather than all at once in a single hitch.
  if (n.theme && n.plan?.length && !(n.impulses ?? []).some((i) => i.kind === 'retheme')) {
    const standing = mine.filter((o) => intact(o) && yardPiece(o));
    const offTheme = standing.filter((o) => n.themed?.[o.id] !== n.theme!.name);
    // Bare ground first: fill the yard to its five, then start redoing what is already there.
    const fresh = standing.length < OWNED_SLOTS;
    if (fresh || offTheme.length) {
      const idea = n.plan[0];
      n.plan = n.plan.slice(1);
      impulse(n, { kind: 'retheme', idea, brief: n.theme.brief, targetId: fresh ? undefined : offTheme[0].id }, now - IMPULSE_DELAY_MS);
      return true;
    }
  }
  const options: (() => boolean)[] = [];
  /** Pieces part-way through a sequence (the vegetables, the car): finished before anything new starts. */
  const staged: (() => boolean)[] = [];
  // 1. The next thing on the list that is not there yet.
  const next = spec.projects.find((key) => !present.has(ownId(spec, key)) && (skips.get(ownId(spec, key)) ?? 0) <= now);
  const buildListed = (key: string) => () => {
    const p = CATALOGUE[key];
    const stage = 0;
    const parts = p.parts(stage, spec);
    const name = p.name(spec);
    const blueprint = { name, description: '', parts };
    let size: { width: number; depth: number };
    try {
      size = measureBlueprint(blueprint, SCENERY_LIMITS);
    } catch {
      return false;
    }
    const area = spec[p.where];
    const wanted = { x: middle(area).x + p.offset.x, z: middle(area).z + p.offset.z };
    const placed = place(size, w, n.position, spotsAround(area, wanted), spec.lot);
    if (!placed) {
      skips.set(ownId(spec, key), now + 180_000);
      return false;
    }
    const preview = ownObject(spec, ownId(spec, key), name, parts, placed.position, size, { health: p.health, role: p.role }, now);
    n.stages[key] = stage;
    startJob(n, { kind: 'build', purpose: 'project', label: name, status: 'walking', path: placed.path, spot: placed.position, workedMs: 0, workMs: workFor(pace, parts.length), preview, project: key });
    say(n, spec, 'start', now, rng);
    return true;
  };
  if (next && room) options.push(buildListed(next));
  // 2. A staged build that can grow: the vegetables, the car. Ripe vegetables get picked (back to sprouts).
  for (const key of spec.projects) {
    const p = CATALOGUE[key];
    if (!p.stages) continue;
    const piece = mine.find((o) => o.id === ownId(spec, key) && intact(o));
    if (!piece) continue;
    // Only a piece we planted and have not since built over: without this, a themed piece that
    // took this slot's id would be grown into a vegetable patch on the next quiet afternoon.
    if (n.stages[key] === undefined) continue;
    const stage = n.stages[key];
    const nextStage = stage + 1 >= p.stages ? (key === 'veg' ? 1 : undefined) : stage + 1;
    if (nextStage === undefined) {
      // Finished: a look over it now and then, hands on, nothing changes.
      options.push(() => tend(n, spec, w, piece, pace, now, rng, key));
      continue;
    }
    staged.push(() => {
      const parts = p.parts(nextStage, spec);
      const blueprint = { ...piece.blueprint, name: nextStage === p.stages! - 1 && key === 'car' ? `${spec.name}'s car` : piece.blueprint.name, parts };
      let size: { width: number; depth: number };
      try {
        size = measureBlueprint(blueprint, SCENERY_LIMITS);
      } catch {
        return false;
      }
      let placed;
      try {
        placed = choosePlacement(size, w.objects, n.position, piece, piece.position);
      } catch {
        return false;
      }
      const preview: SafehouseObject = { ...structuredClone(piece), revision: piece.revision + 1, blueprint, footprint: size, editedBy: spec.name };
      startJob(n, { kind: 'edit', purpose: 'project', label: key === 'veg' ? (stage + 1 >= p.stages! ? 'Picking the vegetables' : 'Tending the vegetables') : 'Working on the car', status: 'walking', path: placed.path, spot: piece.position, workedMs: 0, workMs: pace.workMs ?? (key === 'veg' ? 9000 : 22_000), preview, targetId: piece.id, baseRevision: piece.revision, baseLifecycle: piece.lifecycle, project: key });
      n.stages[key] = nextStage;
      say(n, spec, 'tend', now, rng);
      return true;
    });
  }
  // 3. A fresh coat on the house.
  if (home && intact(home)) {
    options.push(() => {
      const current = dominantColor(home.blueprint);
      const choices = spec.paints.filter((c) => c !== current && c !== n.paint);
      const colour = pick(choices.length ? choices : spec.paints, rng);
      const parts = home.blueprint.parts.map((p) => (p.color === current ? { ...p, color: colour } : p));
      let placed;
      try {
        placed = choosePlacement(home.footprint, w.objects, n.position, home, home.position);
      } catch {
        return false;
      }
      const preview: SafehouseObject = { ...structuredClone(home), revision: home.revision + 1, blueprint: { ...home.blueprint, parts }, editedBy: spec.name };
      n.paint = colour;
      startJob(n, { kind: 'edit', purpose: 'project', label: 'Painting the house', status: 'walking', path: placed.path, spot: home.position, workedMs: 0, workMs: pace.workMs ?? 26_000, preview, targetId: home.id, baseRevision: home.revision, baseLifecycle: home.lifecycle, project: 'paint' });
      say(n, spec, 'paint', now, rng);
      return true;
    });
  }
  // 4. Once the list is done — or there is no room left for any more of it, which is the usual
  //    case now the list is longer than the yard — the afternoon is mostly whims: something odd,
  //    a move, a word next door. Without the `!room` arm a full yard would stall here forever:
  //    `next` never runs out, so whims (and with them every model ask) would never start.
  if (!next || !room) {
    const whimsy = () => {
      const roll = rng();
      const kind: ImpulseKind = roll < 0.6 ? 'whim' : roll < 0.8 ? 'rearrange' : 'social';
      const idea = kind === 'whim' ? pick(spec.ideas, rng) : kind;
      impulse(n, { kind, idea }, now - IMPULSE_DELAY_MS);
      return true;
    };
    options.push(whimsy, whimsy);
  }
  // The list first while there is one. Then anything mid-sequence: a yard of five fills up fast,
  // so if the vegetables and the car had to win a coin toss against whims every afternoon they
  // would simply never grow. Whatever is half-done finishes, then the rest is a toss-up.
  if (next && room && options[0]()) return true;
  for (const grow of staged) if (grow()) return true;
  const rest = next && room ? options.slice(1) : options;
  for (let i = rest.length; i > 0; i--) {
    const j = Math.floor(rng() * i);
    const [choice] = rest.splice(j, 1);
    if (choice()) return true;
  }
  return false;
}
function tend(n: NeighbourState, spec: NeighbourSpec, w: World, piece: SafehouseObject, pace: Pace, now: number, rng: () => number, key: string): boolean {
  const r = rectOf(piece);
  const sides = [
    { x: piece.position.x, z: r.maxZ + 0.7 },
    { x: piece.position.x, z: r.minZ - 0.7 },
    { x: r.minX - 0.7, z: piece.position.z },
    { x: r.maxX + 0.7, z: piece.position.z },
  ].sort((a, b) => distance(a, n.position) - distance(b, n.position));
  for (const p of sides) {
    const path = route(n.position, p, w.objects);
    if (!path) continue;
    startJob(n, { kind: 'tend', purpose: 'project', label: key === 'car' ? 'Tinkering with the car' : 'Tending the vegetables', status: 'walking', path: straighten(path), spot: piece.position, workedMs: 0, workMs: pace.workMs ?? 7000, project: key });
    say(n, spec, 'tend', now, rng);
    return true;
  }
  return false;
}

// ---- Noticing -------------------------------------------------------------------------------

/** What has changed on the block since they last looked, turned into impulses. */
function notice(n: NeighbourState, spec: NeighbourSpec, w: World, now: number, rng: () => number) {
  const wave = w.combat.wave;
  if (!n.seen) {
    // First look: everything already here is old news.
    n.seen = { creationAt: now, otherAt: now, wave: wave.number, fell: wave.fell, lighting: w.lighting ?? 'day' };
    return;
  }
  const seen = n.seen;
  // Chat built something: wander over for a look, and maybe answer it.
  const fresh = w.objects
    .filter((o) => !o.fixed && !o.owner && intact(o) && o.createdAt > seen.creationAt && !isHostile(o))
    .sort((a, b) => a.createdAt - b.createdAt);
  if (fresh.length) {
    const newest = fresh[fresh.length - 1];
    seen.creationAt = newest.createdAt;
    if (!newest.creature && rng() < 0.75) impulse(n, { kind: 'visit', idea: `chat's ${newest.blueprint.name}`, name: newest.blueprint.name, targetId: newest.id }, now);
  }
  // The other neighbour built something. Marge answers a creation of Jake's with a bigger one of
  // the same, every time; Jake goes over to admire whatever Marge put up.
  const other = NEIGHBOURS.find((s) => s.id !== spec.id)!;
  const theirs = w.objects
    .filter((o) => o.owner === other.id && intact(o) && o.createdAt > seen.otherAt)
    .sort((a, b) => a.createdAt - b.createdAt);
  if (theirs.length) {
    const newest = theirs[theirs.length - 1];
    seen.otherAt = newest.createdAt;
    const creation = [...theirs].reverse().find(outdoable);
    if (spec.rival && creation) {
      impulse(n, { kind: 'rival', idea: `a bigger and better version of ${other.name}'s ${lower(creation.blueprint.name)}`, name: creation.blueprint.name, targetId: creation.id }, now);
      say(n, spec, 'rival', now, rng);
    } else if (!spec.rival && !newest.creature && rng() < 0.6) {
      impulse(n, { kind: 'visit', idea: `${other.name}'s ${lower(newest.blueprint.name)}`, name: newest.blueprint.name, targetId: newest.id }, now);
    }
  }
  // Waves: one cleared, something practical goes up; the house fell, supplies for Rook.
  if (wave.number !== seen.wave) {
    if (!w.combat.paused && wave.number > seen.wave && seen.wave > 0)
      impulse(n, { kind: 'fortify', idea: `something practical after surviving wave ${seen.wave}: sandbags, a lookout, a warning bell, that sort of thing`, name: `wave ${seen.wave}` }, now);
    seen.wave = wave.number;
  }
  if (wave.fell !== undefined && wave.fell !== seen.fell) {
    seen.fell = wave.fell;
    impulse(n, { kind: 'care', idea: 'supplies for Rook', name: "Rook's house" }, now);
  }
  // Night falls: a light.
  const lighting = w.lighting ?? 'day';
  if (lighting !== seen.lighting) {
    seen.lighting = lighting;
    if (lighting === 'night') impulse(n, { kind: 'light', idea: 'something with a light in it' }, now);
  }
  // A harmless creature about the block (not theirs, not a fighter): somewhere for it.
  const pet = w.objects.find((o) => o.creature && intact(o) && !isHostile(o) && o.creature.behaviour !== 'fight' && o.owner !== spec.id);
  if (pet && !seen.pet) {
    seen.pet = true;
    impulse(n, { kind: 'pet', idea: `somewhere for ${lower(pet.blueprint.name)}`, name: pet.blueprint.name, targetId: pet.id }, now);
  } else if (!pet) seen.pet = false;
  // A wave about to land: whatever they were pottering at can wait.
  if (!w.combat.paused && wave.phase === 'prep' && wave.phaseEndsAt - w.combat.time < 45_000 && seen.hunkered !== wave.number) {
    seen.hunkered = wave.number;
    if (n.job && n.job.purpose === 'project') drop(n);
    say(n, spec, 'hunker', now, rng);
  }
}

// ---- The model ----------------------------------------------------------------------------

/** The next idea waiting on the model, with its brief; index.ts dispatches one at a time. */
export function takeWish(w: { neighbours?: NeighbourState[] }, now: number): { id: string; wish: Wish; prompt: string } | undefined {
  for (const n of w.neighbours ?? []) {
    const spec = specOf(n.id);
    if (!n.wish || !spec || now - n.wish.at > WISH_TIMEOUT_MS) continue;
    return { id: n.id, wish: n.wish, prompt: wishPrompt(spec, n.wish) };
  }
  return undefined;
}
export function wishPrompt(spec: NeighbourSpec, wish: Wish): string {
  const who = `${spec.name} (${spec.persona})`;
  const brief =
    wish.kind === 'rival'
      ? `wants to build ${wish.idea} — the same kind of thing as "${wish.name}", plainly bigger and grander, to show them up; not a copy`
      : wish.kind === 'fortify'
        ? `wants to build ${wish.idea}`
        : wish.kind === 'retheme'
          ? `is redoing their whole yard to one look — ${wish.brief || 'their own taste'} — and this piece is ${wish.idea}. ` +
            `It replaces what stands on that spot now, so make it read as part of that look rather than a one-off`
          : `wants to build ${wish.idea} in their own yard, just because`;
  return (
    `${who} ${brief}. Design it as a build: small (under 4 m wide, under 4.5 m tall), ground only, 6–25 parts, ` +
    `no text or lettering, weathered colours with one bright accent. Decoration unless it is plainly a wall or sandbags (then "barrier"); ` +
    `never a turret. If it is an animal, add "creature":{"behaviour":"roam"} (and "flying":true for a bird). Reply in one short sentence as yourself.`
  );
}
/**
 * The model answered (or did not). A design is kept for the impulse it was asked for and built
 * next; nothing, or a design that will not fit, falls back to the catalogue.
 */
export function fulfilWish(w: { neighbours?: NeighbourState[] }, id: string, design: ReadyDesign | undefined, now: number): void {
  const n = (w.neighbours ?? []).find((x) => x.id === id);
  if (!n?.wish) return;
  const wish = n.wish;
  n.wish = undefined;
  let ready: ReadyDesign | undefined;
  if (design) {
    try {
      const fit = fitBlueprint(design.blueprint, NEIGHBOUR_AI_LIMITS, true);
      ready = { ...design, blueprint: { ...fit.blueprint, name: design.name.slice(0, 70) } };
    } catch {
      ready = undefined;
    }
  }
  n.impulses ??= [];
  n.impulses.unshift({ kind: wish.kind, idea: wish.idea, name: wish.name, targetId: wish.targetId, brief: wish.brief, at: now - IMPULSE_DELAY_MS, design: ready, noAi: true });
}

// ---- Reading the block --------------------------------------------------------------------

/**
 * What the block looks like from their front step: chat's standing creations and whatever is
 * walking around, newest first. Names and descriptions only — geometry would dwarf the prompt,
 * and a theme is decided by what things *are*, not how they are built.
 */
export function census(w: World): WorldCensus {
  const builds = w.objects
    .filter((o) => !o.fixed && !o.owner && intact(o) && !o.creature)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 24)
    .map((o) => ({ name: o.blueprint.name, description: o.blueprint.description }));
  const creatures = w.objects
    .filter((o) => o.creature && intact(o) && !o.owner)
    .slice(0, 12)
    .map((o) => ({ name: o.blueprint.name, behaviour: o.creature!.behaviour }));
  return { builds, creatures, wave: w.combat.wave.number, lighting: w.lighting ?? 'day' };
}
/**
 * The block as a short string: if this has not changed there is nothing new to read, so no call
 * goes out however long the gap. Names only — a piece being repainted or moved is not news.
 */
export function signatureOf(c: WorldCensus): string {
  const names = [...c.builds.map((b) => b.name), ...c.creatures.map((x) => `${x.name}:${x.behaviour}`)]
    .map((s) => s.toLowerCase().trim())
    .sort();
  return crypto.createHash('sha1').update(names.join('|')).digest('hex').slice(0, 12);
}
/** The one line of intent handed to the survey call, in their own voice. */
export function surveyPrompt(spec: NeighbourSpec): string {
  return (
    `${spec.name} is looking over the block and deciding whether to redo their own yard to match what the street has become. ` +
    `They keep ${OWNED_SLOTS} pieces in their yard, so give ${OWNED_SLOTS} ideas.`
  );
}
/** The next block reading waiting on the model; index.ts dispatches one at a time, behind chat. */
export function takeSurvey(w: World, now: number): { id: string; at: number; input: SurveyInput } | undefined {
  for (const n of w.neighbours ?? []) {
    const spec = specOf(n.id);
    if (!n.survey || !spec || now - n.survey.at > WISH_TIMEOUT_MS) continue;
    return { id: n.id, at: n.survey.at, input: { who: spec.name, persona: spec.persona, census: census(w), prompt: surveyPrompt(spec) } };
  }
  return undefined;
}
/**
 * A theme came back (or did not). Adopting one clears the record of what has already been done,
 * so every piece in the yard is now off-theme and gets redone one at a time as they work through
 * the plan. A failure leaves the old theme in place and does *not* record the signature, so the
 * same block is read again after the gap rather than being written off.
 */
export function adoptTheme(w: { neighbours?: NeighbourState[] }, id: string, theme: ThemeSurvey | undefined, now: number): boolean {
  const n = (w.neighbours ?? []).find((x) => x.id === id);
  if (!n?.survey) return false;
  const sig = n.survey.sig;
  n.survey = undefined;
  if (!theme || !theme.ideas.length) return false;
  n.surveySig = sig;
  // The same look again is not a change: keep the plan running rather than starting it over.
  if (n.theme?.name === theme.theme) {
    n.plan = [...theme.ideas];
    return false;
  }
  n.theme = { name: theme.theme.slice(0, 40), brief: theme.brief.slice(0, 200), adoptedAt: now };
  n.plan = [...theme.ideas];
  n.themed = {};
  return true;
}

// ---- Doing -----------------------------------------------------------------------------------

function advance(n: NeighbourState, w: World, dt: number, speed: number): 'walking' | 'arrived' | 'blocked' {
  const path = n.job ? n.job.path : n.path;
  if (!path.length) return 'arrived';
  let budget = (Math.min(dt, 10_000) / 1000) * speed;
  while (path.length && budget > 0) {
    const pos = n.position,
      next = path[0],
      dx = next.x - pos.x,
      dz = next.z - pos.z,
      length = Math.hypot(dx, dz);
    if (!walkableSegment(pos, next, w.objects)) return 'blocked';
    if (length > 0.001) n.facing = Math.atan2(dx, dz);
    if (length <= budget) {
      n.position = { ...next };
      path.shift();
      budget -= length;
      if (length > 0.001) break; // one straight run per snapshot: the page never interpolates across a corner
    } else {
      pos.x += (dx / length) * budget;
      pos.z += (dz / length) * budget;
      budget = 0;
    }
  }
  return path.length ? 'walking' : 'arrived';
}
const activityFor = (job: NeighbourJob): NeighbourActivity =>
  job.kind === 'repair' || job.kind === 'rebuild'
    ? 'repairing'
    : job.kind === 'tend'
      ? 'tending'
      : job.kind === 'look'
        ? 'looking'
        : job.project === 'paint'
          ? 'painting'
          : 'building';

function drop(n: NeighbourState) {
  n.job = undefined;
  n.activity = 'idle';
}

/** The work is done: put the piece in, with the same checks Rook makes so a change chat made meanwhile wins. */
function commit(n: NeighbourState, spec: NeighbourSpec, w: World, now: number, rng: () => number, events: NeighbourEvent[]): boolean {
  const job = n.job!;
  if (job.kind === 'tend' || job.kind === 'look') {
    const looked = job.kind === 'look' && (job.reason === 'visit' || job.reason === 'admire') ? w.objects.find((o) => o.id === job.targetId) : undefined;
    drop(n);
    if (job.kind === 'tend') n.restMs = 0.6 * DEFAULT_PACE.restMs;
    if (looked) {
      say(n, spec, job.reason === 'admire' ? 'admire' : 'visit', now, rng);
      // Marge's sniff at chat's build sometimes turns into showing them how it is done; Jake just enjoys it.
      if (spec.rival && job.reason === 'visit' && rng() < 0.4)
        impulse(n, { kind: 'rival', idea: `a bigger and better version of chat's "${looked.blueprint.name}" (${looked.blueprint.description || 'no description'})`, name: looked.blueprint.name, targetId: looked.id }, now);
    }
    return false;
  }
  const preview = job.preview!;
  const target = job.targetId ? [...w.objects, ...w.combat.archive].find((o) => o.id === job.targetId) : undefined;
  if (job.targetId && (!target || target.revision !== job.baseRevision || target.lifecycle !== job.baseLifecycle)) {
    drop(n); // it changed under them; whatever changed it wins
    return false;
  }
  try {
    choosePlacement(preview.footprint, w.objects, n.position, target, preview.position);
  } catch {
    if (job.project) skips.set(preview.id, now + 180_000);
    drop(n);
    return false;
  }
  if (target && (job.kind === 'repair' || job.kind === 'rebuild')) preview.health = preview.maxHealth;
  else if (target && job.kind === 'edit') preview.health = target.health; // a repaint or a move carries the damage
  // a `build` into an occupied slot is a new thing: it keeps the health it was made with
  preview.damageRevision = target?.damageRevision ?? 0;
  preview.nextShotAt = w.combat.time + 1000;
  w.combat.archive = w.combat.archive.filter((o) => o.id !== preview.id);
  w.objects = w.objects.filter((o) => o.id !== preview.id);
  w.objects.push(preview);
  w.worldRevision++;
  const kind = job.kind;
  const purpose = job.purpose;
  const reason = job.reason;
  // Marked only once the piece is actually standing, so a job that fell through on a revision
  // check or a placement re-check leaves the slot still waiting to be redone.
  if (reason === 'retheme' && n.theme) {
    n.themed ??= {};
    n.themed[preview.id] = n.theme.name;
  }
  // A staged project that has just been built over is no longer growing: drop the bookkeeping, or
  // the staged path below would later apply vegetable parts to whatever now stands on that spot.
  if (kind === 'build' && job.targetId) {
    for (const k of Object.keys(n.stages ?? {})) if (ownId(spec, k) === job.targetId) delete n.stages[k];
  }
  drop(n);
  if (purpose === 'defense') {
    events.push({ kind: preview.creature ? 'hunter' : 'defense', who: spec.name, id: spec.id, name: preview.blueprint.name, threat: n.threat ? speakThreat(w.objects.find((o) => o.id === n.threat!.id)) : undefined });
    if (n.threat) n.threat.waitMs = 12_000 + rng() * 8000;
  } else if (purpose === 'upkeep') events.push({ kind: 'repair', who: spec.name, id: spec.id, name: preview.blueprint.name });
  else {
    // A coat of paint is "the paint job" in Rook's mouth, not "the neighbor house (west)".
    events.push({ kind: 'project', who: spec.name, id: spec.id, name: job.project === 'paint' ? `${spec.name}'s paint job` : preview.blueprint.name, reason });
    if (kind === 'build' && reason !== 'care') say(n, spec, 'done', now, rng);
  }
  return true;
}

/**
 * One world tick for the neighbours. Returns whether anything worth saving changed, whether the
 * objects changed (the caller bumps the world revision), and what Rook might remark on.
 */
export function tickNeighbours(
  w: World,
  dt: number,
  now: number,
  rng: () => number,
  pace: Pace = DEFAULT_PACE,
  paused = false,
): { changed: boolean; events: NeighbourEvent[] } {
  const events: NeighbourEvent[] = [];
  let changed = false;
  const step = Math.min(Math.max(dt, 0), 10_000);
  for (const spec of NEIGHBOURS) {
    let n = w.neighbours.find((x) => x.id === spec.id);
    if (!n) {
      n = freshNeighbour(spec);
      w.neighbours.push(n);
      changed = true;
    }
    if (n.say && n.say.until <= now) n.say = undefined;
    const home = house(w, spec);
    const homeGone = !home && !archivedHouse(w, spec);
    if (homeGone) {
      // Nobody lives here (a test world without the scenery): stand at the porch and do nothing.
      n.activity = 'idle';
      continue;
    }
    // 1. Sensing: a hostile creature near the house, or damage arriving on their things while one is about.
    const mine = [home, ...owned(w, spec), ...ownedArchived(w, spec)].filter((o): o is SafehouseObject => !!o);
    const wear = mine.reduce((s, o) => s + (o.damageRevision ?? 0), 0);
    const hostiles = w.objects.filter((o) => isHostile(o) && intact(o));
    const anchor = home ?? archivedHouse(w, spec)!;
    const near = hostiles.map((o) => ({ o, d: distanceTo(o.position, anchor) })).filter((x) => x.d <= THREAT_RANGE).sort((a, b) => a.d - b.d);
    const felt = wear > n.wear && hostiles.length > 0;
    n.wear = wear;
    const current = n.threat ? hostiles.find((o) => o.id === n.threat!.id) : undefined;
    const sensed = current ?? near[0]?.o ?? (felt ? hostiles.sort((a, b) => distanceTo(a.position, anchor) - distanceTo(b.position, anchor))[0] : undefined);
    if (sensed && (near.some((x) => x.o.id === sensed.id) || felt || current)) {
      if (!n.threat || n.threat.id !== sensed.id) {
        n.threat = { id: sensed.id, level: 0, quietMs: 0, waitMs: 1500 + rng() * 2500 };
        events.push({ kind: 'alarm', who: spec.name, id: spec.id, threat: speakThreat(sensed) });
        say(n, spec, 'alarm', now, rng);
        if (n.job && n.job.purpose !== 'defense') drop(n); // the afternoon's project can wait
        changed = true;
      } else {
        n.threat.sinceMs = (n.threat.sinceMs ?? 0) + step;
        if (near.some((x) => x.o.id === sensed.id) || felt) n.threat.quietMs = 0;
        else n.threat.quietMs += step;
      }
    } else if (n.threat) {
      n.threat.quietMs += step;
      if (!current || n.threat.quietMs > STAND_DOWN_MS) {
        n.threat = undefined;
        events.push({ kind: 'standdown', who: spec.name, id: spec.id });
        say(n, spec, 'calm', now, rng);
        n.restMs = Math.min(n.restMs, 20_000);
        changed = true;
      }
    }
    // 2. Noticing the rest of the block, and an idea the model never answered.
    notice(n, spec, w, now, rng);
    if (n.wish && now - n.wish.at > WISH_TIMEOUT_MS) {
      const wish = n.wish;
      n.wish = undefined;
      impulse(n, { kind: wish.kind, idea: wish.idea, name: wish.name, targetId: wish.targetId, brief: wish.brief, noAi: true }, now - IMPULSE_DELAY_MS);
    }
    // 2b. Reading the block. Only queues the request — index.ts dispatches it, and only when
    //     nothing chat asked for is waiting. Asked again when the block changes, never on a
    //     bare timer, so a quiet street costs nothing.
    if (n.survey && now - n.survey.at > WISH_TIMEOUT_MS) n.survey = undefined;
    if (pace.survey && !n.survey && !paused) {
      const sig = signatureOf(census(w));
      if (sig !== n.surveySig && now - (n.surveyAt ?? 0) >= pace.surveyGapMs) {
        n.survey = { sig, at: now };
        n.surveyAt = now; // the gap runs from the ask, so a failure does not bring the next one forward
        changed = true;
      }
    }
    // A theme outlives the pieces it was applied to: forget slots that no longer stand.
    if (n.themed) for (const id of Object.keys(n.themed)) if (!w.objects.some((o) => o.id === id)) delete n.themed[id];
    // 3. A job in hand.
    if (n.job) {
      const job = n.job;
      if (job.status === 'walking') {
        n.activity = 'walking';
        const r = advance(n, w, step, WALK_SPEED);
        if (r === 'blocked') {
          // Something now stands in the way: plan again from here, or let it go.
          const again = route(n.position, job.path[job.path.length - 1], w.objects);
          if (again) job.path = straighten(again);
          else drop(n);
        } else if (r === 'arrived') {
          job.status = 'working';
          n.activity = activityFor(job);
          n.facing = Math.atan2(job.spot.x - n.position.x, job.spot.z - n.position.z);
          changed = true;
        }
      } else {
        n.activity = activityFor(job);
        job.workedMs = Math.min(job.workMs, job.workedMs + step);
        if (job.workedMs >= job.workMs) {
          const purpose = job.purpose;
          commit(n, spec, w, now, rng, events);
          if (purpose === 'project') n.restMs = pace.restMs * (0.7 + rng() * 0.7);
          changed = true;
        }
      }
      continue;
    }
    if (paused) {
      strollHome(n, spec, w, step);
      continue;
    }
    // 4. Nothing in hand: the threat, then their own damage, then an idea, then the afternoon's project.
    const threat = n.threat ? hostiles.find((o) => o.id === n.threat!.id) : undefined;
    if (n.threat && threat) {
      n.threat.waitMs -= step;
      if (n.threat.waitMs <= 0 && planDefense(n, spec, w, threat, pace, now, rng)) {
        changed = true;
        continue;
      }
      if (n.threat.waitMs <= 0) n.threat.waitMs = 6000; // nothing more to put up just now; look again shortly
    }
    if (planRepair(n, spec, w, pace, now, rng)) {
      changed = true;
      continue;
    }
    // Watching it from the step — unless it has been about for ages with the ladder spent (a flyer
    // nothing of theirs can reach): then they get on with their afternoon, repairs still first.
    const lockedDown = !!threat && !(n.threat!.level >= 3 && (n.threat!.sinceMs ?? 0) >= LOCKDOWN_MS);
    if (lockedDown) {
      strollHome(n, spec, w, step);
      if (!n.path.length) n.facing = Math.atan2(threat!.position.x - n.position.x, threat!.position.z - n.position.z);
      continue;
    }
    if (n.wish) {
      // Waiting on the model: potter at home.
      strollHome(n, spec, w, step);
      continue;
    }
    const due = (n.impulses ?? []).find((i) => now - i.at >= IMPULSE_DELAY_MS);
    if (due) {
      n.impulses = n.impulses!.filter((i) => i !== due);
      if (act(n, spec, w, due, pace, now, rng, events)) {
        changed = true;
        continue;
      }
    }
    n.restMs -= step;
    if (n.restMs <= 0) {
      if (planProject(n, spec, w, pace, now, rng)) {
        changed = true;
        continue;
      }
      n.restMs = pace.restMs * (0.5 + rng() * 0.5); // nothing to do; try again later
    }
    strollHome(n, spec, w, step);
  }
  return { changed, events };
}
function strollHome(n: NeighbourState, spec: NeighbourSpec, w: World, step: number) {
  if (!n.path.length && distance(n.position, spec.home) > 0.3) {
    const path = route(n.position, spec.home, w.objects);
    n.path = path ? straighten(path) : [];
  }
  if (n.path.length) {
    const r = advance(n, w, step, WALK_SPEED * 0.8);
    n.activity = 'walking';
    if (r === 'blocked') n.path = [];
    if (r !== 'walking') n.activity = 'idle';
  } else {
    n.activity = 'idle';
    if (distance(n.position, spec.home) <= 0.3) n.facing = 0; // watching the street
  }
}

// ---- Views ----------------------------------------------------------------------------------

export function neighbourViews(w: { neighbours?: NeighbourState[] }): NeighbourView[] {
  return (w.neighbours ?? []).flatMap((n) => {
    const spec = specOf(n.id);
    if (!spec) return [];
    return [
      {
        id: n.id,
        name: spec.name,
        position: n.position,
        facing: n.facing,
        activity: n.activity,
        alert: !!n.threat,
        tint: hex(spec.tint),
        hat: spec.hat,
        job: n.job
          ? {
              label: n.job.label,
              status: n.job.status,
              progress: n.job.workedMs / n.job.workMs,
              purpose: n.job.purpose,
              preview: n.job.kind === 'build' || n.job.kind === 'rebuild' ? n.job.preview : undefined,
            }
          : undefined,
        say: n.say,
        theme: n.theme?.name,
      },
    ];
  });
}
/** A line for Rook's state summary: what each neighbour is up to. */
export function describeNeighbours(w: { neighbours?: NeighbourState[]; objects: SafehouseObject[] }): string {
  const parts = (w.neighbours ?? []).map((n) => {
    const spec = specOf(n.id);
    if (!spec) return '';
    const threat = n.threat ? w.objects.find((o) => o.id === n.threat!.id) : undefined;
    const doing = n.job
      ? `${n.job.status === 'walking' ? 'heading out to' : 'busy with'} "${n.job.label}"`
      : threat
        ? `keeping an eye on ${speakThreat(threat)}`
        : n.wish
          ? `drawing up an idea (${n.wish.idea})`
          : 'pottering about at home';
    const built = w.objects.filter((o) => o.owner === n.id && intact(o)).length;
    // The theme matters to Rook: it is why their yard keeps changing, and viewers ask him about it.
    const look = n.theme ? `; redoing the yard ${n.theme.name}${n.plan?.length ? ` (${n.plan.length} piece${n.plan.length === 1 ? '' : 's'} to go)` : ''}` : '';
    return `${spec.name} (${n.id === 'west' ? 'next door west' : 'next door east'}) is ${doing}${built ? `; has built ${built} thing${built === 1 ? '' : 's'}` : ''}${look}`;
  });
  return parts.filter(Boolean).join('. ');
}
