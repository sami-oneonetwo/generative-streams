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
import type { NeighbourActivity, NeighbourView, Regard } from '../../shared/safehouseTypes';
import { contains, footprint, inflate, overlaps, HOUSE_ID, LANDMARKS, YARD_BOUNDS, type Rect } from '../../shared/safehouseLayout';
import { SCENERY_LIMITS, fitBlueprint, measureBlueprint, type Limits } from './blueprint';
import { MAX_CREATURES, TACTICS, initializeObject, intact, isHostile } from './combat';
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
  /** What they do with a quiet moment when a piece on their lot allows it, in order of preference (slice 2 `use` jobs). */
  pastimes: ('hoop' | 'seat' | 'music')[];
  /** Walks to the front of the lot and waves when the pavement fills up; the other just has a word about it. */
  greetsCrowd: boolean;
  /**
   * How they regard chatters (grudges). `grudges`: keeps score against whoever's creatures wreck their
   * place or who messes with their things, and acts on it in tiers. `favourites`: warms to chatters
   * whose builds they admire and never holds anything against anyone.
   */
  temper: 'grudges' | 'favourites';
  /**
   * Counters chat's tactics: fills in a hole (`trap`) near their place once it has caught something
   * or simply sat there, and pulls the plug on speakers (`music`) in earshot once they have gone on
   * long enough. The other just thinks the hole is sick and dances to the speakers.
   */
  tidy: boolean;
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
  | 'retheme' // redoing a piece to match what the block has become
  | 'play' // shooting at the hoop
  | 'sit' // a sit-down on a seat
  | 'crowd' // the pavement has filled up with viewers
  | 'grudge' // a look at the build of someone they hold something against
  | 'kerb' // moving that chatter's piece to the kerb
  | 'beige' // repainting it beige
  | 'vendetta' // the hunter gets their name
  | 'gift' // a chatter built them something
  | 'favourite' // a chatter became one of theirs
  | 'hole' // a hole has appeared: Marge sets off to fill it, Jake has a word
  | 'fill' // the hole is filled
  | 'unplug' // the speakers go off
  | 'dance' // a tune is on
  | 'cheer' // a chatter's `!shoot` went in at a hoop near them
  | 'miss' // ...or did not
  | 'lawn' // somebody is playing ball on Marge's lot
  | 'horn' // a chatter honked a car nearby
  | 'mine' // a chatter used one of Marge's things (a piece's own verb: `!swim` in her pool, `!sit` on her bench)
  | 'splash' // somebody swimming within earshot of Marge's house
  | 'fun' // Jake on a chatter doing a piece's verb near his place
  | 'scrap' // a chatter squaring up to a living build (`!fight`) near Jake
  | 'scrapWon' // ...and winning
  | 'scrapLost' // ...or getting flattened
  | 'wheels' // a chatter driving something (`!drive`) near Jake
  | 'yeehaw' // a chatter riding something (`!ride`) near Jake
  | 'brawl' // a scrap outside Marge's house
  | 'myDog' // a scrap with a creature of Marge's own
  | 'racers'; // somebody driving past Marge's house

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
      play: ['Basketball. At my age.', 'One throw. For the exercise.', 'This is undignified. Watch.'],
      sit: ['Sitting down. Five minutes.', 'My feet.', 'A moment. Then back to it.'],
      crowd: ["Don't they have homes to go to.", 'Pfft. An audience. Wonderful.', 'Gawkers. Mind the roses.'],
      grudge: ['Oh. You again.', 'I remember the gorilla, {user}.', "Is this an apology? It doesn't look like one.", 'Hm. {user}. Of course.'],
      kerb: ['This is going on the kerb, {user}.', 'Not on my street. Out it goes.', 'The kerb. Where it belongs.'],
      beige: ['Beige. Much better.', "There. Now it's tasteful.", 'A sensible colour for once.'],
      vendetta: ['Right. That does it, {user}.', 'I have had quite enough of {user}.', 'The hunter knows your name now, {user}.'],
      gift: ['For me? Hm. It will do.', 'Well. That is… something. Thank you, I suppose.', "I didn't ask for it. But fine."],
      favourite: ['Favourites are for children.', "I don't do favourites."],
      hole: ['Someone dug a hole in my street.', 'A hole. In the street. Honestly.', 'Who digs a hole and just leaves it.'],
      fill: ['There. Filled.', 'Filled in. As if it never happened.', 'That is what a spade is for.'],
      unplug: ['Off. Some of us have gardens.', 'Enough of that racket.', 'The plug. Where it belongs. Out.'],
      dance: ['Absolutely not.', 'Turn that off.'],
      cheer: ['Adequate.', 'Hm. Lucky.'],
      miss: ['Pfft.', 'As expected.'],
      lawn: ['Not on my lawn.', 'Take your ball game elsewhere.', 'Mind the roses, {user}.'],
      horn: ['Must you.', 'Some of us have nerves.', 'That horn. Honestly.'],
      mine: ['That is not for the public.', 'Off. It is not a playground.', 'Pfft. Tourists.', '{user}. That is mine.'],
      splash: ['Splashing. Wonderful.', 'Must they splash.', 'Some of us are trying to garden.'],
      fun: ['Hm.', 'If you must.'],
      scrap: ['Fighting. In the street.', 'Oh, grow up.'],
      scrapWon: ['Hm. Lucky.', 'Pfft.'],
      scrapLost: ['Serves you right.', 'As expected.'],
      wheels: ['Slow down.', 'This is not a racetrack.'],
      yeehaw: ['Undignified.', 'Get down from there.'],
      brawl: ['Take that elsewhere.', 'Not outside my house.', 'Brawling. In my street. Honestly.'],
      myDog: ['Leave my dog alone.', "That one's mine. Hands off.", 'Pick on your own dog, {user}.'],
      racers: ['Boy racers now. Wonderful.', 'Slow down.', 'This is a residential street.'],
    },
    pastimes: ['seat'],
    greetsCrowd: false,
    temper: 'grudges',
    tidy: true,
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
      play: ["Quick game. Don't watch.", 'Swish. Nothing but net.', 'Ok. Three pointer. Watch this.'],
      sit: ['Five minutes. Legs are cooked.', 'Sit down. Enjoy the view.', 'Break time. Earned it.'],
      crowd: ['Sup chat! Big crowd today.', 'Hey! You lot watching this? Sick.', 'Yo! Welcome to the street!'],
      // Jake holds nothing against anyone; these never play, but every beat has lines.
      grudge: ['No hard feelings, {user}. Ever.', "Ah it's all good, {user}."],
      kerb: ["Nah, I'd never.", 'Not my style.'],
      beige: ['Beige? Never.', 'Colour is life.'],
      vendetta: ["Can't imagine holding a grudge.", 'Life is too short.'],
      gift: ['For me?! Legend!', '{user}! You absolute legend!', 'No way. Thank you!'],
      favourite: ['{user}! Legend.', '{user} is my favourite. Sorry everyone else.', 'Whatever {user} builds, I am there.'],
      hole: ['Yo. That hole is sick.', 'A hole! Zombies are gonna hate that.'],
      // Jake fills nothing in and unplugs nothing; these never play, but every beat has lines.
      fill: ['Nah, leave it.', 'It is a feature.'],
      unplug: ['Never. Turn it up.', 'Nope. Louder.'],
      dance: ['Tune! Get in here Marge.', 'Yesss. Turn it up.', 'Oh this is the one. Dance break.'],
      cheer: ['Buckets!', 'Oh! Nothing but net!', '{user}! Swish!'],
      miss: ['Unlucky. Go again.', 'Close! Again.', 'Rim. So close, {user}.'],
      lawn: ['Play on, play on.', 'Ball is life.'],
      horn: ['Beep beep!', 'Ha! Nice horn.', 'Yo, was that you {user}?'],
      mine: ['Go for it!', 'Use it, that is what it is for.'],
      splash: ['Cannonball!', 'Ha! Water is freezing, {user}.'],
      fun: ['Yes! Go on!', 'Ha! Love it.', '{user} living their best life.', 'This street, honestly. Love it.'],
      scrap: ['Fight! Fight!', 'Oh here we go.', 'Square up, {user}!'],
      scrapWon: ['{user} won! Legend.', 'Get in!', 'Flawless victory!'],
      scrapLost: ['Oof. Get up, {user}.', 'Ha! Flattened.', 'Walk it off, {user}.'],
      wheels: ['Nice wheels, {user}!', 'Floor it!', 'Yo, take it round the block!'],
      yeehaw: ['Yeehaw!', 'Giddy up, {user}!', "Ride 'em, {user}!"],
      // Jake minds no scrap and no driving; these never play, but every beat has lines.
      brawl: ['Let them fight.', 'Bit of biff. Love it.'],
      myDog: ['Go easy on him.', 'He bites, you know.'],
      racers: ['Vroom vroom!', 'Go on, floor it!'],
    },
    pastimes: ['music', 'hoop', 'seat'],
    greetsCrowd: true,
    temper: 'favourites',
    tidy: false,
  },
];
export const specOf = (id: string): NeighbourSpec | undefined => NEIGHBOURS.find((n) => n.id === id);
export const NEIGHBOUR_HOUSE_IDS = NEIGHBOURS.map((n) => n.houseId);

// ---- State --------------------------------------------------------------------------------

export type NeighbourPurpose = 'defense' | 'upkeep' | 'project';
export type ImpulseKind = 'whim' | 'rival' | 'fortify' | 'light' | 'pet' | 'care' | 'visit' | 'rearrange' | 'social' | 'retheme' | 'crowd' | 'grudge' | 'gift';
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
  /** The crowd size they last remarked on, and when (a wave to the pavement once it fills up). */
  crowd?: number;
  crowdAt?: number;
}
export interface NeighbourJob {
  kind: 'build' | 'edit' | 'repair' | 'rebuild' | 'tend' | 'look' | 'use';
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
  /** Grudges (Marge) or favourites (Jake), by lowercased chatter; see Regard. */
  regard?: Record<string, Regard>;
}
interface World {
  objects: SafehouseObject[];
  combat: CombatState;
  neighbours: NeighbourState[];
  worldRevision: number;
  survivor: { position: GroundPoint };
  lighting?: 'day' | 'night';
  /** Viewers on the far pavement (crowd.ts); a full pavement gets a wave from Jake and a word from Marge. */
  crowd?: { position: GroundPoint }[];
}
export interface NeighbourEvent {
  /**
   * `use`: shooting hoops or sitting down (`reason` says which); `crowd`: waving at the pavement;
   * `grudge`: a grudge act against a chatter (`user`, `act` = remark | kerb | beige | vendetta, `name` the piece);
   * `favourite`: a chatter became one of Jake's (`user`); `gift`: a chatter built them something (`user`, `name`).
   */
  kind:
    | 'alarm'
    | 'defense'
    | 'hunter'
    | 'project'
    | 'repair'
    | 'standdown'
    | 'visit'
    | 'care'
    | 'use'
    | 'crowd'
    | 'grudge'
    | 'favourite'
    | 'gift'
    | 'fill' // Marge filled a hole in (`name` the hole, `user` who dug it)
    | 'unplug'; // Marge unplugged a `music` piece (`name`, `user`)
  who: string; // the neighbour's name
  id: string;
  name?: string; // the piece
  threat?: string; // the creature, named
  reason?: string; // the impulse behind a project
  user?: string; // the chatter concerned, lowercased
  act?: 'remark' | 'kerb' | 'beige' | 'vendetta';
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
  /** What the piece is for, to the block's animals (rules.ts): birds perch on the bird bath and keep off the scarecrow. */
  uses?: SafehouseObject['uses'];
}
export const CATALOGUE: Record<string, Project> = {
  veg: { name: (s) => `${s.name}'s vegetable patch`, parts: vegPatch, where: 'back', offset: { x: 0, z: 1 }, health: 150, stages: 4, beat: 'tend' },
  flowers: { name: (s) => `${s.name}'s flower bed`, parts: flowerBed, where: 'front', offset: { x: -3.2, z: 0.3 }, health: 120, beat: 'start' },
  washing: { name: (s) => `${s.name}'s washing line`, parts: washingLine, where: 'back', offset: { x: -3.5, z: -2 }, health: 120, beat: 'start' },
  birdbath: { name: (s) => `${s.name}'s bird bath`, parts: birdBath, where: 'front', offset: { x: 3.2, z: 0.5 }, health: 120, beat: 'start', uses: ['perch'] },
  letterbox: { name: (s) => `${s.name}'s letterbox`, parts: letterbox, where: 'front', offset: { x: 2.2, z: 1.7 }, health: 80, beat: 'start' },
  scarecrow: { name: (s) => `${s.name}'s scarecrow`, parts: scarecrow, where: 'back', offset: { x: 3.4, z: -1.2 }, health: 100, beat: 'start', uses: ['scare'] },
  bench: { name: (s) => `${s.name}'s bench`, parts: bench, where: 'front', offset: { x: -1.5, z: 1.4 }, health: 150, beat: 'start', uses: ['seat'] },
  car: { name: (s) => `${s.name}'s project car`, parts: carProject, where: 'front', offset: { x: 2.6, z: 0.4 }, health: 300, stages: 4, beat: 'tend' },
  tyres: { name: (s) => `${s.name}'s tyre pile`, parts: tyres, where: 'front', offset: { x: -3.6, z: -0.2 }, health: 120, beat: 'start' },
  workbench: { name: (s) => `${s.name}'s workbench`, parts: workbench, where: 'back', offset: { x: -2.5, z: 1.5 }, health: 150, beat: 'start' },
  bbq: { name: (s) => `${s.name}'s barbecue`, parts: bbq, where: 'back', offset: { x: 1.5, z: 1.5 }, health: 120, beat: 'start' },
  hoop: { name: (s) => `${s.name}'s basketball hoop`, parts: hoop, where: 'front', offset: { x: -1.2, z: 1.6 }, health: 200, beat: 'start', uses: ['hoop'] },
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
/** A threat episode's bookkeeping for the grudge table: which of their pieces still stood, whether the house has been hit. Keyed `${neighbour}:${creature}`. */
const episodes = new Map<string, { standing: Set<string>; houseHit: boolean }>();
/** Chat's holes: when first seen, whether one has caught anything, who has had their word about it. By piece id. */
const holes = new Map<string, { seenAt: number; held: boolean; remarked: Set<string> }>();
/** Chat's speakers in the world: standing since when, and how many quarter-hour charges have gone on the grudge. By piece id. */
const noise = new Map<string, { since: number; charged: number }>();
let lastFillAt = -Infinity; // at most one hole filled in every HOLE_FILL_GAP_MS
// Chat verbs (verbs.ts → noteVerb below): the odds of a word are drawn with the world's rng, which
// `noteVerb` has no argument for, so the tick leaves its rng here; a line that is gated (Marge on
// her lawn, on a horn) remembers when it may next be said; a `!dance` asks Jake to join in on his
// next tick, when the pace is to hand.
let verbRng: () => number = Math.random;
const verbGates = new Map<string, number>(); // `${neighbour}:${beat}` → not before
const danceRequests = new Set<string>(); // neighbour ids asked to dance along
const funWarmedAt = new Map<string, number>(); // `${neighbour}:${chatter}` → when a piece's verb last warmed them; once per FUN_WARM_GAP_MS
let tacticsPrimed = false; // the first look after a start finds what already stands: old news, nobody remarks
export function resetNeighbourMemory(): void {
  skips.clear();
  episodes.clear();
  pendingFavourites.clear();
  holes.clear();
  noise.clear();
  lastFillAt = -Infinity;
  tacticsPrimed = false;
  verbRng = Math.random;
  verbGates.clear();
  danceRequests.clear();
  funWarmedAt.clear();
}

// ---- Regard: grudges and favourites ---------------------------------------------------------
//
// Marge keeps score against whoever's creatures come for her place and whoever messes with her
// things through chat, and acts on it in tiers: a cold word when their next build lands, then
// their latest piece on the kerb or painted beige, then her hunter with their name on it. Jake
// only ever warms: to whoever's builds he wanders over to admire, and to anyone who fixes his
// things or builds him something. A gift ("build marge a bench") is the way back into her good
// books. Every number here is the app's; a score decays a point every quarter hour and the
// whole thing lives in the save, so a chatter who wrecked the garden on Tuesday finds Marge still
// cold on Friday.

export const REGARD_CAP = 20;
export const REGARD_DECAY_MS = 15 * 60_000;
export const REGARD_FORGET_MS = 60 * 60_000; // at zero this long and the entry goes
/** Mirrors MAX_REGARD in state.ts (not imported: state.ts imports this module). */
const REGARD_MEMORY = 60;
export const GRUDGE_TIERS: readonly [number, number, number] = [3, 6, 10];
export const GRUDGE_ACT_GAP_MS = 4 * 60_000;
export const FAVOURITE_AT = -3;
export const BEIGE = '#c9bfa6';
/** Names that are never a chatter: the neighborhood, Rook, the neighbours themselves. */
const NOBODY = new Set(['neighborhood', 'neighbourhood', 'rook', ...NEIGHBOURS.map((s) => s.name.toLowerCase())]);
/** The table key for whoever made a piece, or nothing when it was not a chatter. */
export function chatter(name: string | undefined): string | undefined {
  const key = name?.trim().toLowerCase().slice(0, 40);
  if (!key || NOBODY.has(key)) return undefined;
  return key;
}
/**
 * Move a chatter's standing with a neighbour. A `grudges` temper never goes below zero, a
 * `favourites` temper never above; scores clamp at ±REGARD_CAP; nothing is recorded for a change
 * that leaves nothing behind. Returns the entry and the score before, or nothing.
 */
function adjust(n: NeighbourState, spec: NeighbourSpec, user: string | undefined, delta: number, reason: string, now: number): { entry: Regard; before: number } | undefined {
  if (!user || !Number.isFinite(delta) || delta === 0) return undefined;
  const table = (n.regard ??= {});
  const existing = table[user];
  const before = existing?.score ?? 0;
  let score = before + delta;
  score = spec.temper === 'grudges' ? Math.max(0, score) : Math.min(0, score);
  score = Math.max(-REGARD_CAP, Math.min(REGARD_CAP, score));
  if (score === before && !existing) return undefined;
  const entry: Regard = existing ?? { score: 0, since: now, lastAt: now };
  if (before === 0 && score !== 0) entry.since = now; // it starts (again) here
  entry.score = score;
  entry.lastAt = now;
  entry.reason = reason.slice(0, 120);
  table[user] = entry;
  // Only so many people remembered: the coldest go first.
  const keys = Object.keys(table);
  if (keys.length > REGARD_MEMORY) {
    keys.sort((a, b) => Math.abs(table[a].score) - Math.abs(table[b].score) || table[a].lastAt - table[b].lastAt);
    for (const k of keys.slice(0, keys.length - REGARD_MEMORY)) if (k !== user) delete table[k];
  }
  return { entry, before };
}
/** A point toward zero every quarter hour since the last change; an hour at zero and they are forgotten. */
function decayRegard(n: NeighbourState, now: number): boolean {
  if (!n.regard) return false;
  let changed = false;
  for (const [user, r] of Object.entries(n.regard)) {
    while (r.score !== 0 && now - r.lastAt >= REGARD_DECAY_MS) {
      r.score -= Math.sign(r.score);
      r.lastAt += REGARD_DECAY_MS;
      changed = true;
    }
    if (r.score === 0 && now - r.lastAt >= REGARD_FORGET_MS) {
      delete n.regard[user];
      changed = true;
    }
  }
  if (!Object.keys(n.regard).length) delete n.regard;
  return changed;
}
const scoreOf = (n: NeighbourState, user: string | undefined) => (user ? n.regard?.[user]?.score ?? 0 : 0);
/** 0 (nothing), 1 (a cold word), 2 (the kerb, beige), 3 (the hunter). */
export function grudgeTier(score: number): 0 | 1 | 2 | 3 {
  return score >= GRUDGE_TIERS[2] ? 3 : score >= GRUDGE_TIERS[1] ? 2 : score >= GRUDGE_TIERS[0] ? 1 : 0;
}
/** How the tag and the admin page put it. */
export function regardPhrase(spec: NeighbourSpec, user: string, score: number): string {
  if (spec.temper === 'favourites') return score <= FAVOURITE_AT ? `big fan of ${user}` : `warming to ${user}`;
  switch (grudgeTier(score)) {
    case 3:
      return `at war with ${user}`;
    case 2:
      return `not speaking to ${user}`;
    case 1:
      return `cross with ${user}`;
    default:
      return `wary of ${user}`;
  }
}
/** The entry that matters most right now, past the first tier either way. */
function strongest(n: NeighbourState): [string, Regard] | undefined {
  const entries = Object.entries(n.regard ?? {}).filter(([, r]) => Math.abs(r.score) >= GRUDGE_TIERS[0]);
  return entries.sort((a, b) => Math.abs(b[1].score) - Math.abs(a[1].score) || a[1].lastAt - b[1].lastAt)[0];
}
/** A chatter's latest standing creation Marge could take it out on: not a creature, not a floor, not a gift. */
function latestCreationBy(w: World, user: string): SafehouseObject | undefined {
  return w.objects
    .filter((o) => !o.fixed && !o.owner && intact(o) && !o.creature && !o.passable && !o.giftTo && chatter(o.createdBy) === user)
    .sort((a, b) => b.createdAt - a.createdAt)[0];
}

function say(n: NeighbourState, spec: NeighbourSpec, beat: Beat, now: number, rng: () => number, vars: { threat?: string; user?: string } = {}) {
  if (n.say && n.say.until > now) return;
  const text = pick(spec.lines[beat], rng)
    .replace('{threat}', vars.threat ?? 'you')
    .replace(/\{user\}/g, vars.user ?? 'you');
  n.say = { text, until: now + Math.min(7000, ttlFor(text)) };
}
function impulse(n: NeighbourState, imp: Omit<Impulse, 'at'>, now: number) {
  n.impulses ??= [];
  if (n.impulses.some((i) => i.kind === imp.kind && i.targetId === imp.targetId && i.name === imp.name)) return;
  n.impulses.push({ ...imp, at: now });
  if (n.impulses.length > 6) n.impulses.shift();
}

function ownObject(spec: NeighbourSpec, id: string, name: string, parts: Primitive[], position: GroundPoint, size: { width: number; depth: number }, opts: { health: number; role?: SafehouseObject['role']; creature?: SafehouseObject['creature']; description?: string; uses?: SafehouseObject['uses'] }, now: number): SafehouseObject {
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
    ...(opts.uses?.length ? { uses: opts.uses } : {}),
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
  const creatures = w.objects.filter((o) => o.creature && intact(o) && !o.wild).length;
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
      (neighbourCreatures(w) >= NEIGHBOUR_CREATURE_BUDGET || w.objects.filter((o) => o.creature && intact(o) && !o.wild).length >= MAX_CREATURES)
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
    if (w.objects.filter((o) => o.creature && intact(o) && !o.wild).length >= MAX_CREATURES) return false;
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
    case 'grudge':
    case 'gift': {
      // A look at the piece — a cold one, or a grateful one — with the line said on arrival (commit).
      const target = w.objects.find((o) => o.id === imp.targetId && intact(o));
      if (!target) return false;
      const user = chatter(target.createdBy);
      const r = rectOf(target);
      const sides = [
        { x: target.position.x, z: r.maxZ + 1.0 },
        { x: target.position.x, z: r.minZ - 1.0 },
        { x: r.minX - 1.0, z: target.position.z },
        { x: r.maxX + 1.0, z: target.position.z },
      ].sort((a, b) => distance(a, n.position) - distance(b, n.position));
      for (const p of sides) {
        const path = route(n.position, p, w.objects);
        if (!path || path.length > 200) continue;
        startJob(n, {
          kind: 'look',
          purpose: 'project',
          label: imp.kind === 'gift' ? `Having a look at the present` : `Having a look at ${lower(target.blueprint.name)}`,
          status: 'walking',
          path: straighten(path),
          spot: target.position,
          workedMs: 0,
          workMs: pace.workMs ?? 6000 + rng() * 4000,
          targetId: target.id,
          reason: imp.kind,
        });
        // A remark is not an act: `acts` counts the kerb and the beige, whose turn it is next.
        if (imp.kind === 'gift') events.push({ kind: 'gift', who: spec.name, id: spec.id, name: target.blueprint.name, user });
        else events.push({ kind: 'grudge', who: spec.name, id: spec.id, name: target.blueprint.name, user, act: 'remark' });
        return true;
      }
      return false;
    }
    case 'crowd': {
      // The pavement has filled up. Jake goes to the front of his lot and waves at them; Marge has a word from where she stands.
      say(n, spec, 'crowd', now, rng);
      if (!spec.greetsCrowd) return false;
      const front = { x: spec.home.x, z: spec.front.maxZ - 0.3 };
      for (const dx of [0, 2, -2, 4, -4]) {
        const p = { x: front.x + dx, z: front.z };
        if (!contains(spec.lot, p)) continue;
        const path = route(n.position, p, w.objects);
        if (!path || path.length > 200) continue;
        // `spot` is what they face on arrival: the pavement across the road, where the crowd stands.
        startJob(n, { kind: 'use', purpose: 'upkeep', label: 'Waving at the crowd', status: 'walking', path: straighten(path), spot: { x: p.x, z: 14.6 }, workedMs: 0, workMs: pace.workMs ?? 6000 + rng() * 4000, reason: 'crowd' });
        events.push({ kind: 'crowd', who: spec.name, id: spec.id });
        return true;
      }
      return false;
    }
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
    const preview = ownObject(spec, ownId(spec, key), name, parts, placed.position, size, { health: p.health, role: p.role, uses: p.uses }, now);
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

// ---- Using what stands on the lot -----------------------------------------------------------

/** Standing pieces on their lot with a use they have a pastime for, in their order of preference. */
export type Pastime = NeighbourSpec['pastimes'][number];
function usablePieces(spec: NeighbourSpec, w: World): { piece: SafehouseObject; use: Pastime }[] {
  const out: { piece: SafehouseObject; use: Pastime }[] = [];
  for (const use of spec.pastimes)
    for (const o of w.objects) {
      if (!intact(o) || o.creature || o.passable || !o.uses?.includes(use)) continue;
      // A hoop or a seat has to be on their own lot; a tune carries, so speakers within earshot of home will do, whoever's they are.
      const near = use === 'music' ? distanceTo(spec.home, o) <= DANCE_RANGE : contains(spec.lot, o.position);
      if (near) out.push({ piece: o, use });
    }
  return out;
}
/**
 * A quiet moment with something on the lot to enjoy: Jake shoots at his hoop, either of them sits
 * on a seat. Nothing in the world changes; a `use` job walks them over, holds the pose for a
 * while and lets go. Threats drop it like any peacetime job.
 */
function planUse(n: NeighbourState, spec: NeighbourSpec, w: World, pace: Pace, now: number, rng: () => number, events: NeighbourEvent[]): boolean {
  const options = usablePieces(spec, w);
  if (!options.length) return false;
  // Nearest of the preferred kind first: the hoop for Jake, whichever seat is closest for Marge.
  const preferred = options.filter((o) => o.use === options[0].use).sort((a, b) => distanceTo(n.position, a.piece) - distanceTo(n.position, b.piece));
  for (const { piece, use } of preferred) {
    const r = rectOf(piece);
    // The yard the piece stands in: a throw at the hoop crosses that yard rather than the house wall.
    const yard = contains(spec.front, piece.position) ? spec.front : contains(spec.back, piece.position) ? spec.back : spec.lot;
    // Back from a hoop to throw, a couple of metres off the speakers to dance, right beside a seat.
    const off = use === 'hoop' ? 2.75 : use === 'music' ? 2 : 0.75;
    const around = [
      { x: piece.position.x, z: r.maxZ + off },
      { x: piece.position.x, z: r.minZ - off },
      { x: r.minX - off, z: piece.position.z },
      { x: r.maxX + off, z: piece.position.z },
    ];
    const spots =
      use === 'hoop'
        ? around.sort((a, b) => distance(a, middle(yard)) - distance(b, middle(yard))) // the side facing the middle of its yard
        : around.sort((a, b) => distance(a, n.position) - distance(b, n.position));
    for (const p of spots) {
      if (!contains(YARD_BOUNDS, p)) continue;
      const path = route(n.position, p, w.objects);
      if (!path || path.length > 200) continue;
      startJob(n, {
        kind: 'use',
        purpose: 'upkeep',
        label: use === 'hoop' ? 'Shooting hoops' : use === 'music' ? 'Dancing' : 'Sitting down',
        status: 'walking',
        path: straighten(path),
        spot: piece.position,
        workedMs: 0,
        workMs: pace.workMs ?? 20_000 + rng() * 25_000,
        targetId: piece.id,
        reason: use,
      });
      if (rng() < 0.6) say(n, spec, use === 'hoop' ? 'play' : use === 'music' ? 'dance' : 'sit', now, rng);
      events.push({ kind: 'use', who: spec.name, id: spec.id, name: piece.blueprint.name, reason: use });
      return true;
    }
  }
  return false;
}

// ---- Tidying up after chat's tactics --------------------------------------------------------
//
// Chat's holes (`trap`) and speakers (`music`) are meant to be countered, and Marge is the
// counter: a hole near her place is filled in once it has caught something or simply sat there,
// and speakers in earshot wear on her by the quarter hour until she pulls the plug. Both are
// edits of the chatter's own piece — the hole becomes a mound of turned earth, the speakers lose
// their `music` — with her name on them and a point or three on the chatter's grudge. Jake
// counters nothing: he thinks the hole is sick and dances to the speakers.

const HOLE_RANGE = 22; // metres from her house for a hole to be her business
const HOLE_REMARK_RANGE = 25; // metres from Jake's home for him to have a word about one
const HOLE_FILL_AFTER_MS = 3 * 60_000; // a hole that has caught nothing is left this long first
const HOLE_FILL_GAP_MS = 3 * 60_000; // at most one fill this often
const NOISE_TICK_MS = 4 * 60_000; // every so long in earshot: a point against whoever put the speakers there
const NOISE_LIMIT_MS = 12 * 60_000; // and after this long she pulls the plug whatever the score
const DANCE_RANGE = 15; // metres from Jake's home for a stack to be worth a dance, on his lot or not
const isTrap = (o: SafehouseObject) => intact(o) && !!o.passable && !!o.uses?.includes('trap');
const isSpeakers = (o: SafehouseObject) => intact(o) && !o.passable && !o.creature && !!o.uses?.includes('music');

/** Once a tick: which of chat's holes and speakers stand, since when, and whether a hole has caught anything. */
function watchTactics(w: World, now: number) {
  const traps = new Set<string>(),
    stacks = new Set<string>();
  for (const o of w.objects) {
    if (o.owner) continue;
    if (isTrap(o)) {
      traps.add(o.id);
      let h = holes.get(o.id);
      if (!h) holes.set(o.id, (h = { seenAt: now, held: false, remarked: new Set(tacticsPrimed ? [] : NEIGHBOURS.map((s) => s.id)) }));
      if (!h.held && w.combat.zombies.some((z) => z.heldIn === o.id)) h.held = true;
    } else if (isSpeakers(o)) {
      stacks.add(o.id);
      if (!noise.has(o.id)) noise.set(o.id, { since: now, charged: 0 });
    }
  }
  for (const id of [...holes.keys()]) if (!traps.has(id)) holes.delete(id);
  for (const id of [...noise.keys()]) if (!stacks.has(id)) noise.delete(id);
  tacticsPrimed = true;
}
/** Jake's word about a new hole near his place, once per hole. Marge has hers when she sets off to fill it. */
function noticeTactics(n: NeighbourState, spec: NeighbourSpec, w: World, now: number, rng: () => number) {
  if (spec.tidy) return;
  for (const [id, h] of holes) {
    if (h.remarked.has(spec.id)) continue;
    const o = w.objects.find((x) => x.id === id);
    if (!o) continue;
    h.remarked.add(spec.id);
    if (distanceTo(spec.home, o) <= HOLE_REMARK_RANGE) say(n, spec, 'hole', now, rng);
  }
}
/** Speakers in earshot of her house: a point against whoever put them there for every quarter hour they have played. */
function chargeNoise(n: NeighbourState, spec: NeighbourSpec, w: World, now: number): boolean {
  if (!spec.tidy) return false;
  const home = house(w, spec) ?? archivedHouse(w, spec);
  if (!home) return false;
  let changed = false;
  for (const stack of w.objects) {
    if (stack.owner || !isSpeakers(stack) || distanceTo(stack.position, home) > TACTICS.music.earshot) continue;
    const e = noise.get(stack.id);
    if (!e) continue;
    const charges = Math.floor((now - e.since) / NOISE_TICK_MS);
    while (e.charged < charges) {
      e.charged++;
      if (adjust(n, spec, chatter(stack.createdBy), 1, 'that noise', now)) changed = true;
    }
  }
  return changed;
}
/** What a filled-in hole looks like: a low disc of turned earth with a few clods on it, sized to the hole. */
function moundParts(fp: { width: number; depth: number }): Primitive[] {
  const r = Math.max(0.4, Math.min(fp.width, fp.depth) / 2 - 0.05);
  const parts: Primitive[] = [cyl(r, 0.12, 0x6b563f, 0, 0.06, 0)];
  const clods: [number, number, number][] = [
    [0.35, 0.2, 0.12],
    [-0.3, -0.15, 0.15],
    [0.1, -0.45, 0.11],
    [-0.45, 0.35, 0.13],
  ];
  for (const [fx, fz, radius] of clods) parts.push(ball(radius, 0x7a6448, fx * r, radius, fz * r, 0.7));
  return parts;
}
/** Stand beside a piece: the nearest of its four sides with a route to it, or nothing. */
function besidePath(n: NeighbourState, w: World, piece: SafehouseObject, off: number): GroundPoint[] | undefined {
  const r = rectOf(piece);
  const sides = [
    { x: piece.position.x, z: r.maxZ + off },
    { x: piece.position.x, z: r.minZ - off },
    { x: r.minX - off, z: piece.position.z },
    { x: r.maxX + off, z: piece.position.z },
  ]
    .filter((p) => contains(YARD_BOUNDS, p))
    .sort((a, b) => distance(a, n.position) - distance(b, n.position));
  for (const p of sides) {
    const path = route(n.position, p, w.objects);
    if (path && path.length <= 200) return straighten(path);
  }
  return undefined;
}
/**
 * A hole near her place — within HOLE_RANGE of the house, or anywhere on the street in front of
 * her lot — that has caught something or has stood HOLE_FILL_AFTER_MS: she walks over and fills
 * it. The piece stays the chatter's (their creation, their `#reference`) but becomes a mound with
 * no `trap` on it, edited by her; the chatter gets three on the grudge for the digging. At most
 * one fill every HOLE_FILL_GAP_MS; nothing while a threat is about or a repair is due (the caller).
 */
function planFill(n: NeighbourState, spec: NeighbourSpec, w: World, pace: Pace, now: number, rng: () => number): boolean {
  if (!spec.tidy || now - lastFillAt < HOLE_FILL_GAP_MS) return false;
  const home = house(w, spec) ?? archivedHouse(w, spec);
  if (!home) return false;
  const street = LANDMARKS.street;
  const myStreet: Rect = { minX: spec.lot.minX, maxX: spec.lot.maxX, minZ: street.minZ, maxZ: street.maxZ };
  const due = w.objects
    .filter((o) => !o.owner && isTrap(o) && (skips.get(o.id) ?? 0) <= now)
    .filter((o) => distanceTo(o.position, home) <= HOLE_RANGE || contains(myStreet, o.position))
    .filter((o) => {
      const h = holes.get(o.id);
      return !!h && (h.held || now - h.seenAt >= HOLE_FILL_AFTER_MS);
    })
    .sort((a, b) => distanceTo(n.position, a) - distanceTo(n.position, b));
  for (const hole of due) {
    const path = besidePath(n, w, hole, 0.75);
    if (!path) {
      skips.set(hole.id, now + 120_000);
      continue;
    }
    const preview: SafehouseObject = {
      ...structuredClone(hole),
      revision: hole.revision + 1,
      editedBy: spec.name,
      passable: true,
      blueprint: { name: 'Filled-in hole', description: `Filled in by ${spec.name}`, parts: moundParts(hole.footprint) },
    };
    delete preview.uses;
    delete preview.rules;
    startJob(n, {
      kind: 'edit',
      purpose: 'upkeep',
      label: 'Filling in the hole',
      status: 'walking',
      path,
      spot: hole.position,
      workedMs: 0,
      workMs: pace.workMs ?? 15_000 + rng() * 10_000,
      preview,
      targetId: hole.id,
      baseRevision: hole.revision,
      baseLifecycle: hole.lifecycle,
      reason: 'fill',
    });
    lastFillAt = now;
    adjust(n, spec, chatter(hole.createdBy), 3, 'dug a hole in the street', now);
    say(n, spec, 'hole', now, rng);
    return true;
  }
  return false;
}
/**
 * Speakers in earshot of her house: once her grudge against whoever put them there has reached the
 * first tier (the noise itself gets it there in three quarters of an hour), or after NOISE_LIMIT_MS
 * of it regardless, she walks over and pulls the plug — the piece loses its `music`, keeps its
 * looks, and says so in its description. Chat can turn it back on with a redesign that names music.
 */
function planUnplug(n: NeighbourState, spec: NeighbourSpec, w: World, pace: Pace, now: number, rng: () => number): boolean {
  if (!spec.tidy) return false;
  const home = house(w, spec) ?? archivedHouse(w, spec);
  if (!home) return false;
  const due = w.objects
    .filter((o) => !o.owner && isSpeakers(o) && (skips.get(o.id) ?? 0) <= now && distanceTo(o.position, home) <= TACTICS.music.earshot)
    .filter((o) => {
      const e = noise.get(o.id);
      return !!e && (grudgeTier(scoreOf(n, chatter(o.createdBy))) >= 1 || now - e.since >= NOISE_LIMIT_MS);
    })
    .sort((a, b) => distanceTo(n.position, a) - distanceTo(n.position, b));
  for (const stack of due) {
    let placed;
    try {
      placed = choosePlacement(stack.footprint, w.objects, n.position, stack, stack.position);
    } catch {
      skips.set(stack.id, now + 120_000);
      continue;
    }
    const uses = (stack.uses ?? []).filter((u) => u !== 'music');
    const description = stack.blueprint.description.endsWith('(unplugged)') ? stack.blueprint.description : `${stack.blueprint.description} (unplugged)`.trim().slice(0, 240);
    const preview: SafehouseObject = { ...structuredClone(stack), revision: stack.revision + 1, editedBy: spec.name, blueprint: { ...stack.blueprint, description } };
    if (uses.length) preview.uses = uses;
    else delete preview.uses;
    startJob(n, {
      kind: 'edit',
      purpose: 'upkeep',
      label: 'Unplugging the speakers',
      status: 'walking',
      path: placed.path,
      spot: stack.position,
      workedMs: 0,
      workMs: pace.workMs ?? 6000 + rng() * 4000,
      preview,
      targetId: stack.id,
      baseRevision: stack.revision,
      baseLifecycle: stack.lifecycle,
      reason: 'unplug',
    });
    say(n, spec, 'unplug', now, rng);
    return true;
  }
  return false;
}
/** Her counters to chat's tactics, in turn: the hole first, then the noise. */
function planTidy(n: NeighbourState, spec: NeighbourSpec, w: World, pace: Pace, now: number, rng: () => number): boolean {
  return planFill(n, spec, w, pace, now, rng) || planUnplug(n, spec, w, pace, now, rng);
}

// ---- Settling scores --------------------------------------------------------------------------

/** Someone just became one of Jake's favourites: said and remarked on at the next tick, once. */
const pendingFavourites = new Map<string, Set<string>>();
function pendingFavourite(n: NeighbourState, user: string) {
  let set = pendingFavourites.get(n.id);
  if (!set) pendingFavourites.set(n.id, (set = new Set()));
  set.add(user);
}
function drainFavourites(n: NeighbourState, spec: NeighbourSpec, now: number, rng: () => number, events: NeighbourEvent[]) {
  const set = pendingFavourites.get(n.id);
  if (!set?.size) return;
  for (const user of set) {
    events.push({ kind: 'favourite', who: spec.name, id: spec.id, user });
    n.say = undefined; // this beats whatever he was saying about the build itself
    say(n, spec, 'favourite', now, rng, { user });
  }
  set.clear();
}
/** Their fighters with a name on them: the name comes off the tick the score drops below the top tier. */
function settleVendettas(n: NeighbourState, spec: NeighbourSpec, w: World): boolean {
  let changed = false;
  for (const o of w.objects) {
    if (o.owner !== spec.id || !o.creature?.nemesisOwner) continue;
    if (grudgeTier(scoreOf(n, o.creature.nemesisOwner)) < 3) {
      delete o.creature.nemesisOwner;
      changed = true;
    }
  }
  return changed;
}
/** Her fighter, standing: the one the vendetta goes on. */
const hunterOf = (w: World, spec: NeighbourSpec) => owned(w, spec).find((o) => intact(o) && o.creature?.behaviour === 'fight');
/**
 * A grudge past the second tier gets acted on — one act per chatter every GRUDGE_ACT_GAP_MS, and only
 * with nothing threatening and nothing to fix, because a grudge is an afternoon thing. At the top
 * tier the hunter gets their name first (built for the purpose if she has none); below that, their
 * latest standing creation goes on the kerb across the street or gets painted beige, in turn.
 * Nobody eligible, or nothing of theirs standing, and the grudge just sits.
 */
function planGrudge(n: NeighbourState, spec: NeighbourSpec, w: World, pace: Pace, now: number, rng: () => number, events: NeighbourEvent[]): boolean {
  if (spec.temper !== 'grudges' || !n.regard) return false;
  const due = Object.entries(n.regard)
    .filter(([, r]) => grudgeTier(r.score) >= 2 && now - (r.lastActAt ?? -Infinity) >= GRUDGE_ACT_GAP_MS)
    .sort((a, b) => b[1].score - a[1].score);
  for (const [user, r] of due) {
    const took = (act: NonNullable<NeighbourEvent['act']>, name?: string) => {
      r.acts = (r.acts ?? 0) + 1;
      r.lastActAt = now;
      events.push({ kind: 'grudge', who: spec.name, id: spec.id, user, act, name });
      return true;
    };
    // 3. The hunter learns their name.
    if (grudgeTier(r.score) >= 3) {
      const hunter = hunterOf(w, spec);
      const building = n.job?.preview?.creature?.behaviour === 'fight';
      if (hunter && hunter.creature!.nemesisOwner !== user) {
        hunter.creature!.nemesisOwner = user;
        say(n, spec, 'vendetta', now, rng, { user });
        return took('vendetta', hunter.blueprint.name);
      }
      if (!hunter && !building && buildVendettaHunter(n, spec, w, user, pace, now, rng)) return took('vendetta', n.job!.preview!.blueprint.name);
    }
    // 2. Their latest piece: the kerb and beige, in turn.
    const piece = latestCreationBy(w, user);
    if (!piece) continue;
    const kerb = (r.acts ?? 0) % 2 === 0;
    if (kerb) {
      const street = LANDMARKS['across the street'];
      const placed = place(piece.footprint, w, n.position, spotsAround(street, { x: piece.position.x, z: middle(street).z }), YARD_BOUNDS, piece);
      if (placed && distance(placed.position, piece.position) >= 1.5) {
        const preview: SafehouseObject = { ...structuredClone(piece), revision: piece.revision + 1, position: placed.position, editedBy: spec.name };
        startJob(n, { kind: 'edit', purpose: 'project', label: `Moving ${lower(piece.blueprint.name)} to the kerb`, status: 'walking', path: placed.path, spot: placed.position, workedMs: 0, workMs: pace.workMs ?? 8000, preview, targetId: piece.id, baseRevision: piece.revision, baseLifecycle: piece.lifecycle, reason: 'grudge' });
        say(n, spec, 'kerb', now, rng, { user });
        return took('kerb', piece.blueprint.name);
      }
      // Nowhere on the kerb for it: beige will do.
    }
    let placed;
    try {
      placed = choosePlacement(piece.footprint, w.objects, n.position, piece, piece.position);
    } catch {
      continue;
    }
    const blueprint: Blueprint = { ...piece.blueprint, parts: piece.blueprint.parts.map((p) => ({ ...p, color: BEIGE })) };
    const preview: SafehouseObject = { ...structuredClone(piece), revision: piece.revision + 1, blueprint, editedBy: spec.name };
    startJob(n, { kind: 'edit', purpose: 'project', label: `Repainting ${lower(piece.blueprint.name)}`, status: 'walking', path: placed.path, spot: piece.position, workedMs: 0, workMs: pace.workMs ?? 9000, preview, targetId: piece.id, baseRevision: piece.revision, baseLifecycle: piece.lifecycle, reason: 'grudge' });
    say(n, spec, 'beige', now, rng, { user });
    return took('beige', piece.blueprint.name);
  }
  return false;
}
/** A hunter built for a grudge rather than a threat: the same beast, with a chatter's name on it instead of a creature's. */
function buildVendettaHunter(n: NeighbourState, spec: NeighbourSpec, w: World, user: string, pace: Pace, now: number, rng: () => number): boolean {
  if (w.objects.length >= 560) return false;
  if (neighbourCreatures(w) >= NEIGHBOUR_CREATURE_BUDGET) return false;
  if (w.objects.filter((o) => o.creature && intact(o) && !o.wild).length >= MAX_CREATURES) return false;
  const parts = hunter(spec.id === 'west' ? 0x4a4038 : 0x3b3f44);
  const name = `${spec.name}'s ${user} hunter`.slice(0, 70);
  const size = measureBlueprint({ name, description: '', parts }, SCENERY_LIMITS);
  const placed = place(size, w, n.position, spotsAround(spec.front, { x: spec.home.x + (spec.id === 'west' ? -2.5 : 2.5), z: spec.home.z + 1.2 }), spec.lot);
  if (!placed) return false;
  const creature = { ...freshCreature('fight'), nemesisOwner: user };
  const preview = ownObject(spec, ownId(spec, 'hunter'), name, parts, placed.position, size, { health: HUNTER_HEALTH, creature, description: `${spec.name} built it with ${user}'s name on it` }, now);
  const existing = [...w.objects, ...w.combat.archive].find((o) => o.id === preview.id);
  if (existing) {
    preview.revision = existing.revision + 1;
    preview.lifecycle = existing.lifecycle ?? 1;
  }
  startJob(n, { kind: 'build', purpose: 'defense', label: name, status: 'walking', path: placed.path, spot: placed.position, workedMs: 0, workMs: workFor(pace, parts.length, 10_000), preview, targetId: existing?.id, baseRevision: existing?.revision, baseLifecycle: existing?.lifecycle, reason: 'grudge' });
  say(n, spec, 'vendetta', now, rng, { user });
  return true;
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
    // Something built for them: the way back into Marge's good books, and straight into Jake's.
    for (const gift of fresh.filter((o) => o.giftTo === spec.id)) {
      const user = chatter(gift.createdBy);
      const moved = adjust(n, spec, user, spec.temper === 'grudges' ? -6 : -3, 'built them something', now);
      impulse(n, { kind: 'gift', idea: `a present from ${user ?? 'chat'}`, name: gift.blueprint.name, targetId: gift.id }, now);
      if (moved && spec.temper === 'favourites' && moved.before > FAVOURITE_AT && moved.entry.score <= FAVOURITE_AT) pendingFavourite(n, user!);
    }
    if (newest.giftTo !== spec.id && !newest.creature) {
      const user = chatter(newest.createdBy);
      if (spec.temper === 'grudges' && grudgeTier(scoreOf(n, user)) >= 1) {
        // A cold look rather than a curious one: her remark, and no answering it with something bigger.
        impulse(n, { kind: 'grudge', idea: 'remark', name: newest.blueprint.name, targetId: newest.id }, now);
      } else if ((spec.temper === 'favourites' && scoreOf(n, user) <= FAVOURITE_AT) || rng() < 0.75)
        impulse(n, { kind: 'visit', idea: `chat's ${newest.blueprint.name}`, name: newest.blueprint.name, targetId: newest.id }, now);
    }
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
  const pet = w.objects.find((o) => o.creature && intact(o) && !o.wild && !isHostile(o) && o.creature.behaviour !== 'fight' && o.owner !== spec.id);
  if (pet && !seen.pet) {
    seen.pet = true;
    impulse(n, { kind: 'pet', idea: `somewhere for ${lower(pet.blueprint.name)}`, name: pet.blueprint.name, targetId: pet.id }, now);
  } else if (!pet) seen.pet = false;
  // The pavement fills up (three or more viewers): a wave from Jake, a word from Marge — once per
  // fill-up, and not again within ten minutes. A crowd that simply stays is old news.
  const crowd = w.crowd?.length ?? 0;
  if (crowd >= 3 && (seen.crowd ?? 0) < 3) {
    if (seen.crowdAt === undefined || now - seen.crowdAt >= 600_000) {
      seen.crowdAt = now;
      impulse(n, { kind: 'crowd', idea: 'the crowd on the pavement' }, now);
    }
    seen.crowd = crowd;
  } else if (crowd < 3) seen.crowd = crowd;
  // A wave about to land: whatever they were pottering at can wait.
  if (!w.combat.paused && wave.phase === 'prep' && wave.phaseEndsAt - w.combat.time < 45_000 && seen.hunkered !== wave.number) {
    seen.hunkered = wave.number;
    if (n.job && (n.job.purpose === 'project' || n.job.kind === 'use')) drop(n);
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
    .filter((o) => o.creature && intact(o) && !o.owner && !o.wild) // the block's own birds are not news
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
        : job.kind === 'use'
          ? job.reason === 'hoop'
            ? 'playing'
            : job.reason === 'crowd'
              ? 'waving'
              : job.reason === 'music'
                ? 'dancing'
                : 'sitting'
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
  if (job.kind === 'tend' || job.kind === 'look' || job.kind === 'use') {
    const looked =
      job.kind === 'look' && (job.reason === 'visit' || job.reason === 'admire' || job.reason === 'grudge' || job.reason === 'gift')
        ? w.objects.find((o) => o.id === job.targetId)
        : undefined;
    drop(n);
    if (job.kind === 'tend') n.restMs = 0.6 * DEFAULT_PACE.restMs;
    if (job.kind === 'use') return false; // a game or a sit-down leaves nothing behind
    if (looked) {
      const user = chatter(looked.createdBy);
      if (job.reason === 'grudge' || job.reason === 'gift') {
        // The cold word, or the grudging thanks; neither turns into showing them how it is done.
        say(n, spec, job.reason, now, rng, { user });
        return false;
      }
      say(n, spec, job.reason === 'admire' ? 'admire' : 'visit', now, rng);
      // Jake warms to whoever built the thing he came over to admire.
      if (job.reason === 'visit' && spec.temper === 'favourites') {
        const moved = adjust(n, spec, user, -1, 'liked something they built', now);
        if (moved && moved.before > FAVOURITE_AT && moved.entry.score <= FAVOURITE_AT) pendingFavourite(n, user!);
      }
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
  if (reason === 'fill' || reason === 'unplug') {
    // The hole is a mound, the speakers are off: her word on it, and Rook's; the chatter's grudge moved when she set off.
    say(n, spec, reason, now, rng);
    events.push({ kind: reason, who: spec.name, id: spec.id, name: target?.blueprint.name ?? preview.blueprint.name, user: chatter(target?.createdBy) });
  } else if (purpose === 'defense') {
    events.push({ kind: preview.creature ? 'hunter' : 'defense', who: spec.name, id: spec.id, name: preview.blueprint.name, threat: n.threat ? speakThreat(w.objects.find((o) => o.id === n.threat!.id)) : undefined });
    if (n.threat) n.threat.waitMs = 12_000 + rng() * 8000;
  } else if (purpose === 'upkeep') events.push({ kind: 'repair', who: spec.name, id: spec.id, name: preview.blueprint.name });
  else if (reason === 'grudge') {
    // The kerb or the beige: Rook heard about it when she set off; nothing more to say here.
  } else {
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
  verbRng = rng; // for noteVerb's odds between ticks
  watchTactics(w, now);
  for (const spec of NEIGHBOURS) {
    let n = w.neighbours.find((x) => x.id === spec.id);
    if (!n) {
      n = freshNeighbour(spec);
      w.neighbours.push(n);
      changed = true;
    }
    if (n.say && n.say.until <= now) n.say = undefined;
    if (decayRegard(n, now)) changed = true;
    if (chargeNoise(n, spec, w, now)) changed = true;
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
        // The grudge starts here: whoever built the thing is the one she remembers.
        adjust(n, spec, chatter(sensed.createdBy), 3, `the ${speakThreat(sensed)} came for the house`, now);
        episodes.set(`${spec.id}:${sensed.id}`, {
          standing: new Set(mine.filter((o) => o.id !== spec.houseId && intact(o) && w.objects.includes(o)).map((o) => o.id)),
          houseHit: !!home && intact(home) ? (home.health ?? home.maxHealth ?? 1) < (home.maxHealth ?? 1) * 0.8 : true,
        });
        changed = true;
      } else {
        n.threat.sinceMs = (n.threat.sinceMs ?? 0) + step;
        if (near.some((x) => x.o.id === sensed.id) || felt) n.threat.quietMs = 0;
        else n.threat.quietMs += step;
      }
      // While it is about: each of their pieces that goes down, and the house dropping under 80 %, count against its maker.
      const episode = episodes.get(`${spec.id}:${sensed.id}`);
      if (episode) {
        const culprit = chatter(sensed.createdBy);
        for (const id of [...episode.standing]) {
          const o = w.objects.find((x) => x.id === id);
          if (o && intact(o)) continue;
          episode.standing.delete(id);
          if (adjust(n, spec, culprit, 3, `the ${speakThreat(sensed)} knocked something of theirs down`, now)) changed = true;
        }
        const houseHurt = !home || !intact(home) || (home.health ?? home.maxHealth ?? 1) < (home.maxHealth ?? 1) * 0.8;
        if (!episode.houseHit && houseHurt) {
          episode.houseHit = true;
          if (adjust(n, spec, culprit, 2, `the ${speakThreat(sensed)} got at the house`, now)) changed = true;
        }
      }
    } else if (n.threat) {
      n.threat.quietMs += step;
      if (!current || n.threat.quietMs > STAND_DOWN_MS) {
        episodes.delete(`${spec.id}:${n.threat.id}`);
        n.threat = undefined;
        events.push({ kind: 'standdown', who: spec.name, id: spec.id });
        say(n, spec, 'calm', now, rng);
        n.restMs = Math.min(n.restMs, 20_000);
        changed = true;
      }
    }
    // A vendetta outlives its cause only as long as the score does.
    if (settleVendettas(n, spec, w)) changed = true;
    // 2. Noticing the rest of the block, and an idea the model never answered.
    notice(n, spec, w, now, rng);
    noticeTactics(n, spec, w, now, rng);
    drainFavourites(n, spec, now, rng, events);
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
          const purpose = job.purpose,
            kind = job.kind;
          commit(n, spec, w, now, rng, events);
          // A game or a sit-down counts as the afternoon's rest too, or they would go straight from the bench to a build.
          if (purpose === 'project' || kind === 'use') n.restMs = pace.restMs * (0.7 + rng() * 0.7);
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
    // Chat's tactics on her street: a hole to fill, speakers to unplug — with nothing threatening and nothing of hers to fix.
    if (!threat && planTidy(n, spec, w, pace, now, rng)) {
      changed = true;
      continue;
    }
    // Scores to settle: nothing threatening, nothing of theirs to fix, so a grudge gets its turn.
    if (!threat && planGrudge(n, spec, w, pace, now, rng, events)) {
      changed = true;
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
    // Somebody in chat is dancing (`!dance`): Jake joins in if he is free and a tune carries to his place.
    if (danceRequests.delete(n.id) && !n.job && !threat && usablePieces(spec, w).some((o) => o.use === 'music') && planUse(n, spec, w, pace, now, rng, events)) {
      changed = true;
      continue;
    }
    n.restMs -= step;
    if (n.restMs <= 0) {
      // About one quiet moment in three goes on what already stands there — a game at the hoop, a
      // sit-down — when there is such a thing on the lot (the rng is only drawn when there is, so
      // a yard with nothing to enjoy plays out exactly as before).
      if (usablePieces(spec, w).length && rng() < 0.34 && planUse(n, spec, w, pace, now, rng, events)) {
        changed = true;
        continue;
      }
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

export function neighbourViews(w: { neighbours?: NeighbourState[]; objects?: SafehouseObject[] }): NeighbourView[] {
  return (w.neighbours ?? []).flatMap((n) => {
    const spec = specOf(n.id);
    if (!spec) return [];
    // The piece being used (a hoop, a seat): the page aims the ball at it or seats the figure by it.
    const at = n.job?.kind === 'use' && n.job.targetId ? w.objects?.find((o) => o.id === n.job!.targetId)?.position : undefined;
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
              ...(at ? { at: { ...at } } : {}),
            }
          : undefined,
        say: n.say,
        theme: n.theme?.name,
        ...(() => {
          const top = strongest(n);
          return top ? { regard: { user: top[0], score: top[1].score, phrase: regardPhrase(spec, top[0], top[1].score) } } : {};
        })(),
      },
    ];
  });
}
/** A line for Rook's state summary: what each neighbour is up to. */
// ---- Grudges: the contract other modules call --------------------------------------------------
/** Something a chatter did to a neighbour's piece or house through chat (a repaint, a move, a redesign, a repair). */
export type ChatEditKind = 'paint' | 'resize' | 'move' | 'turn' | 'redesign' | 'repair' | 'rebuild' | 'delete';
/** What each kind of meddling costs with Marge (positive) — repairs are amends. Jake only notices the amends. */
const MEDDLING: Record<ChatEditKind, number> = { paint: 2, resize: 2, turn: 2, move: 3, redesign: 3, delete: 5, repair: -3, rebuild: -3 };
const MEDDLED: Record<ChatEditKind, string> = { paint: 'painted', resize: 'resized', turn: 'turned', move: 'moved', redesign: 'redesigned', delete: 'deleted', repair: 'fixed', rebuild: 'rebuilt' };
/** index.ts calls this when a chat job lands on a piece with an `owner` (never for Rook's own rounds). */
export function noteChatEdit(w: { neighbours?: NeighbourState[] }, o: SafehouseObject, username: string, kind: ChatEditKind, now: number): void {
  const spec = NEIGHBOURS.find((s) => o.owner === s.id || o.id === s.houseId);
  const n = spec ? w.neighbours?.find((x) => x.id === spec.id) : undefined;
  if (!spec || !n) return;
  const user = chatter(username);
  const what = o.id === spec.houseId ? 'the house' : 'something of theirs';
  const delta = spec.temper === 'grudges' ? MEDDLING[kind] : MEDDLING[kind] < 0 ? -1 : 0;
  const moved = adjust(n, spec, user, delta, `${MEDDLED[kind]} ${what}`, now);
  if (moved && spec.temper === 'favourites' && moved.before > FAVOURITE_AT && moved.entry.score <= FAVOURITE_AT) pendingFavourite(n, user!);
}
/** Operator: forgive one chatter (lowercased) everywhere, or everyone. Returns whether anything changed. */
export function forgive(w: { neighbours?: NeighbourState[]; objects: SafehouseObject[] }, user?: string): boolean {
  const key = user ? chatter(user) ?? user.trim().toLowerCase() : undefined;
  let changed = false;
  for (const n of w.neighbours ?? []) {
    if (!n.regard) continue;
    if (key) {
      if (key in n.regard) {
        delete n.regard[key];
        changed = true;
      }
      if (!Object.keys(n.regard).length) delete n.regard;
    } else {
      delete n.regard;
      changed = true;
    }
  }
  for (const o of w.objects) {
    const owner = o.creature?.nemesisOwner;
    if (owner && (!key || owner === key)) {
      delete o.creature!.nemesisOwner;
      changed = true;
    }
  }
  return changed;
}
/**
 * A chat verb happened (verbs.ts): `shoot` at a hoop (`detail.hit`), `honk` a vehicle, `dance` on the
 * pavement. The neighbours may react (Jake cheers a basket; Marge minds the noise). Implemented in the
 * verbs slice; index.ts calls it.
 */
const LAWN_GATE_MS = 3 * 60_000; // Marge on ball games in her garden: a word this often at most
const HORN_GATE_MS = 2 * 60_000; // ...and on horns
const CHEER_ODDS = 1 / 3, // Jake on a basket
  MISS_ODDS = 1 / 4, // ...and on a miss
  HORN_ODDS = 1 / 3, // ...and on a horn near his place
  FUN_ODDS = 1 / 3; // ...and on somebody doing a piece's own verb near his place
// A piece's own verb (`!swim`, `!bounce`, `!sit` …): Marge minds her things being used and the
// splashing within earshot; Jake enjoys it, and warms to a chatter for it at most once in ten
// minutes so a `!bounce` spam does not make a favourite inside a minute.
const MINE_GATE_MS = 3 * 60_000,
  SPLASH_GATE_MS = 3 * 60_000,
  FUN_WARM_GAP_MS = 10 * 60_000;
// The verbs that move things (`!drive`, `!ride`) and the scrap (`!fight`, a living build; the arrival
// is one call, the result another): Marge minds a brawl or a drive outside her house and anyone
// picking on a creature of hers; Jake calls the fight, cheers the winner and the wheels.
const BRAWL_GATE_MS = 3 * 60_000, // Marge on a scrap outside her house or with her hunter: a word this often at most
  RACERS_GATE_MS = 4 * 60_000, // ...and on somebody driving past
  STREET_M = 12, // how far from her house a scrap or a drive is her business
  SCRAP_ODDS = 1 / 2, // Jake on a scrap starting near his place
  WHEELS_ODDS = 1 / 3; // ...and on somebody driving near his place (a ride shares FUN_ODDS)
/** Jake warms to a chatter by one for a reason, at most once per chatter per reason in ten minutes; a favourite is told to Rook. */
function warmOnce(n: NeighbourState, spec: NeighbourSpec, key: string | undefined, reason: string, now: number): void {
  if (!key) return;
  const gate = `${spec.id}:${key}:${reason}`;
  if ((funWarmedAt.get(gate) ?? -Infinity) > now - FUN_WARM_GAP_MS) return;
  funWarmedAt.set(gate, now);
  const moved = adjust(n, spec, key, -1, reason, now);
  if (moved && moved.before > FAVOURITE_AT && moved.entry.score <= FAVOURITE_AT) pendingFavourite(n, key);
}
/** A gated word: said only when the gate for that neighbour and beat has passed, then shut again. */
function sayGated(n: NeighbourState, spec: NeighbourSpec, beat: Beat, gapMs: number, now: number, vars: { user?: string } = {}) {
  const key = `${spec.id}:${beat}`;
  if ((verbGates.get(key) ?? -Infinity) > now) return;
  verbGates.set(key, now + gapMs);
  say(n, spec, beat, now, verbRng, vars);
}
/** Something chat did with a verb: `shoot`/`honk`/`dance` are the built-ins; any other word is a piece's own verb (PieceVerb). */
export type VerbDone = 'shoot' | 'honk' | 'dance' | (string & {});
export function noteVerb(
  w: { neighbours?: NeighbourState[]; objects: SafehouseObject[] },
  verb: VerbDone,
  user: string,
  objectId: string | undefined,
  detail: { hit?: boolean; result?: 'won' | 'lost' },
  now: number,
): void {
  const key = chatter(user);
  const piece = objectId ? w.objects.find((o) => o.id === objectId && intact(o)) : undefined;
  for (const n of w.neighbours ?? []) {
    const spec = specOf(n.id);
    if (!spec) continue;
    const nearHome = (o: SafehouseObject) => distanceTo(spec.home, o) <= DANCE_RANGE;
    const face = (o: SafehouseObject) => {
      if (!n.job) n.facing = Math.atan2(o.position.x - n.position.x, o.position.z - n.position.z);
    };
    /** How far a piece stands from this neighbour's house (the seeded spot if the house is gone). */
    const fromHouse = (o: SafehouseObject) => {
      const home = w.objects.find((h) => h.id === spec.houseId && intact(h));
      return distanceTo(home?.position ?? spec.home, o);
    };
    if (verb === 'fight' && piece) {
      // A scrap with a living build: the arrival is one call, the result (detail.result) another.
      if (spec.temper === 'grudges') {
        if (detail.result) continue; // only the arrival moves Marge
        if (piece.owner === spec.id) {
          adjust(n, spec, key, 3, 'picking on her hunter', now);
          sayGated(n, spec, 'myDog', BRAWL_GATE_MS, now, { user: key });
        } else if (contains(spec.lot, piece.position) || fromHouse(piece) <= STREET_M) {
          adjust(n, spec, key, 2, 'brawling outside her house', now);
          sayGated(n, spec, 'brawl', BRAWL_GATE_MS, now, { user: key });
        }
      } else if (piece.owner === spec.id || nearHome(piece)) {
        face(piece);
        if (!detail.result) {
          if (verbRng() < SCRAP_ODDS) say(n, spec, 'scrap', now, verbRng, { user: key });
        } else if (detail.result === 'won') {
          warmOnce(n, spec, key, 'winning a scrap', now);
          say(n, spec, 'scrapWon', now, verbRng, { user: key });
        } else say(n, spec, 'scrapLost', now, verbRng, { user: key });
      }
    } else if (verb === 'drive' && piece) {
      if (detail.result) continue;
      if (spec.temper === 'grudges') {
        // Marge: a car going up and down outside her house.
        if (fromHouse(piece) > STREET_M) continue;
        adjust(n, spec, key, 1, 'boy racers', now);
        sayGated(n, spec, 'racers', RACERS_GATE_MS, now, { user: key });
      } else if (piece.owner === spec.id || nearHome(piece)) {
        face(piece);
        if (verbRng() < WHEELS_ODDS) say(n, spec, 'wheels', now, verbRng, { user: key });
      }
    } else if (verb === 'shoot' && piece) {
      if (spec.temper === 'favourites') {
        // Jake: a basket at his hoop, or any hoop near his place, warms him to the shooter and may get a cheer.
        if (piece.owner !== spec.id && !nearHome(piece)) continue;
        face(piece);
        if (detail.hit) {
          const moved = adjust(n, spec, key, -1, 'buckets', now);
          if (moved && moved.before > FAVOURITE_AT && moved.entry.score <= FAVOURITE_AT) pendingFavourite(n, key!);
          if (verbRng() < CHEER_ODDS) say(n, spec, 'cheer', now, verbRng, { user: key });
        } else if (verbRng() < MISS_ODDS) say(n, spec, 'miss', now, verbRng, { user: key });
      } else if (detail.hit && contains(spec.lot, piece.position)) {
        // Marge: a ball game in her garden is a point against whoever is playing.
        adjust(n, spec, key, 1, 'playing ball in my garden', now);
        sayGated(n, spec, 'lawn', LAWN_GATE_MS, now, { user: key });
      }
    } else if (verb === 'honk' && piece) {
      if (spec.temper === 'grudges') {
        const home = w.objects.find((o) => o.id === spec.houseId && intact(o));
        if (distanceTo(home?.position ?? spec.home, piece) > TACTICS.music.earshot) continue;
        adjust(n, spec, key, 1, 'that horn', now);
        sayGated(n, spec, 'horn', HORN_GATE_MS, now, { user: key });
      } else if (nearHome(piece) && verbRng() < HORN_ODDS) {
        face(piece);
        say(n, spec, 'horn', now, verbRng, { user: key });
      }
    } else if (verb === 'dance' && spec.pastimes.includes('music')) {
      // Jake joins in on his next tick if he is free and a tune carries to his place (tickNeighbours).
      danceRequests.add(spec.id);
    } else if (verb !== 'shoot' && verb !== 'honk' && verb !== 'dance' && piece) {
      // A piece's own verb (PieceVerb): somebody swimming in a pool, bouncing on a trampoline, sitting on a bench.
      if (detail.result) continue; // a result is a fight's; nothing else has one
      if (spec.temper === 'grudges') {
        if (verb === 'ride') continue; // somebody on a horse is not her business
        if (piece.owner === spec.id || contains(spec.lot, piece.position)) {
          // Her things, or anything on her lot, are not for the public.
          adjust(n, spec, key, 1, 'using my things', now);
          sayGated(n, spec, 'mine', MINE_GATE_MS, now, { user: key });
        } else if (verb === 'swim') {
          const home = w.objects.find((o) => o.id === spec.houseId && intact(o));
          if (distanceTo(home?.position ?? spec.home, piece) <= TACTICS.music.earshot) sayGated(n, spec, 'splash', SPLASH_GATE_MS, now, { user: key });
        }
      } else if (piece.owner === spec.id || nearHome(piece)) {
        // Jake: good fun near his place. A word one time in three (a rider gets his cowboy one); warmer by one, but not for the same chatter twice in ten minutes.
        face(piece);
        warmOnce(n, spec, key, 'having fun', now);
        if (verbRng() < FUN_ODDS) say(n, spec, verb === 'ride' ? 'yeehaw' : 'fun', now, verbRng, { user: key });
      }
    }
  }
}
/** For the admin page: every regard entry across the neighbours, strongest first. */
export function regardSummary(w: { neighbours?: NeighbourState[] }): { name: string; user: string; score: number; phrase: string }[] {
  const out: { name: string; user: string; score: number; phrase: string }[] = [];
  for (const n of w.neighbours ?? []) {
    const spec = specOf(n.id);
    if (!spec || !n.regard) continue;
    for (const [user, r] of Object.entries(n.regard)) if (r.score !== 0) out.push({ name: spec.name, user, score: r.score, phrase: regardPhrase(spec, user, r.score) });
  }
  return out.sort((a, b) => Math.abs(b.score) - Math.abs(a.score) || a.user.localeCompare(b.user));
}

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
    // Who they are cold with, or warm to: "cross with dave (7): the gorilla came for the house".
    const feelings = Object.entries(n.regard ?? {})
      .filter(([, r]) => Math.abs(r.score) >= GRUDGE_TIERS[0])
      .sort((a, b) => Math.abs(b[1].score) - Math.abs(a[1].score))
      .slice(0, 3)
      .map(([user, r]) => `${regardPhrase(spec, user, r.score)} (${Math.abs(r.score)})${r.reason && r.score > 0 ? `: ${r.reason}` : ''}`);
    const regard = feelings.length ? `; ${feelings.join('; ')}` : '';
    return `${spec.name} (${n.id === 'west' ? 'next door west' : 'next door east'}) is ${doing}${built ? `; has built ${built} thing${built === 1 ? '' : 's'}` : ''}${look}${regard}`;
  });
  return parts.filter(Boolean).join('. ');
}
