// The caravan (docs/ages.md, slice 2 v1): every age a band of travellers camps across the river.
// Their leader brings three visits' worth of asks to the town. Feed us, set our specialist up, then
// build the Wonder together, and finishing the third visit moves the town into the next age. The
// travellers come into town and spend like residents do; the specialist settles for good. Counts
// scale with how many chatters are about, and a list left open for 45 minutes is trimmed once.
// Everything is checked by the app from what happens in town (builds, shifts, visits, parties, the
// community project); zero AI here.
//
// The Stone Age opens with the band stranded across the river: the bridge is down and nobody crosses
// until the streamer plays the opening (admin) and a share of the active chatters mend it ('help').
// Then the travellers walk over and the first visit opens. A daughter travels with every caravan and
// grows up age by age: the story's through-line. With Finders Keepers' Story switch on, the band is
// the cast (story/cast.ts): the same five in every age, spared when travellers go home, and the
// caravan's scenes are ticked by the show runtime (tickCaravanScene, FK-127) instead of tickCaravan.
import type { WorldCtx } from '../../engine/world';
import { BUS_STOP, LANDING, PITCH, VENUES, type VenueKind } from '../../shared/city';
import { contains } from '../../shared/layout';
import { BRIDGE, FACING_TOWN, SCENES, STEP_FORWARD, STRANDED, type SceneId } from '../../shared/scenes';
import { LAST_AGE, ageStyle, venueName } from '../../shared/ages';
import type { DudeLook } from '../../shared/dudesTypes';
import { ageOf, cityOf, headName, projectOf, proposeWonder, setAge, startLabour, tell, wonderOf } from './city';
import { addEffect, awake } from './sim';
import { route } from './placement';
import { defaultLook, hashOf } from './agent';
import { pushFeed, storyOn, type DudesState, type Townie } from './state';
import { CAST, castArrival, castId, castIn, castTownie, isCastId, keepsCast } from './story/cast';
import { ageHeroes, credit, creditBuilds, crierAgeTurned, crierBridgeDone, crierBridgeOpened, crierVisitDone, crierVisitOpened, tickCrier } from './crier';

export type AskKind = 'build' | 'serve' | 'operate' | 'party' | 'project' | 'bridge';
export interface CaravanAsk {
  id: string;
  kind: AskKind;
  venues?: VenueKind[];
  label: string;
  need: number;
  have: number;
}
export interface Caravan {
  age: number;
  /** 0, 1, 2: the visit under way. */
  visit: number;
  openedAt: number;
  asks: CaravanAsk[];
  /** Townie ids of the travellers in town (the leader first). */
  travellers: string[];
  trimmed?: boolean;
  /** Between visits: when the next one opens. */
  nextAt?: number;
  /** Places the travellers have already gone to see this visit. */
  seen?: string[];
  /** Across the river with the bridge down: they wait at the camp until it is mended. */
  stranded?: boolean;
  /** Who has put in a shift on the bridge (dude ids): each counts once. */
  helpers?: string[];
  /** Who has been asked to go and help at the bridge, until when: sent back if anything knocks them off it. */
  volunteers?: { id: string; until: number; nudged?: number }[];
  /** The age is turning (the Wonder stands): the scene plays, they head back to camp (`left`), and the
   * next age's caravan walks in at `arriveAt`. `final`: the last age; nobody comes after. */
  turn?: { at: number; arriveAt?: number; final?: boolean; left?: boolean };
  /** The revision of each place of an asked sort when the visit opened: a new one, or one done up since, counts for "build". */
  revs?: Record<string, number>;
}
/** A scene playing (shared/scenes.ts): which, when it started, how many of its beats have played, and the words it fills in. */
export interface SceneState {
  id: SceneId;
  at: number;
  beat: number;
  vars?: Record<string, string>;
}

const FOOD: VenueKind[] = ['restaurant', 'cafe', 'bakery', 'market'];
const WORK: VenueKind[] = ['workshop'];

interface AgeCaravan {
  name: string;
  leader: string;
  /** Who else walks with them (the daughter comes second, after the leader, in every age). */
  travellers: string[];
  specialist: string;
  wonder: string;
  /** The Wonder as the leader proposes it: what the designer is asked for (the age's style is added). */
  wonderWhat: string;
  /** What the leader says when each visit opens. */
  problems: [string, string, string];
  /** Walking in from the camp (every age after the first); and saying goodbye when the age turns. */
  greeting: string;
  farewell: string;
  /** The daughter, when this age's caravan arrives (she grows up between them); the Stone Age's is the finale's. */
  daughterLine: string;
}
const CARAVANS: AgeCaravan[] = [
  { name: 'the Mammoth Herders', leader: 'Toma', travellers: ['Old Ura', 'Bo the Herder', 'Tusk'], specialist: 'Kesa the Potter', wonder: 'the Furnace', wonderWhat: 'The Furnace: a great clay-and-stone smelting furnace with a tall chimney, leather bellows and a ring of stone anvils, glowing at its mouth, where the first bronze is poured',  problems: ["We've walked a long way and the little ones are hungry. Somewhere with a fire to eat at, and we'll stay.", 'Kesa the Potter travels with us. She needs a place to work, and hands to help her.', 'Our metalworker says a great furnace could melt stone into bronze. Build it on the square, all of you.'], greeting: 'Hello.', farewell: "We'll tell every river about this town. Goodbye, and thank you.", daughterLine: 'I was a little girl at the river when you mended the bridge. Look how far you came.' },
  { name: 'the River Traders', leader: 'Captain Nebet', travellers: ['Hori the Boatman', 'Mina'], specialist: 'Tamu the Scribe', wonder: 'the Keep', wonderWhat: 'The Keep: a tall square keep of dressed stone and timber with battlements, a banner and a heavy gate, watching over the river',  problems: ['Our barges are full of grain and empty of bread. Feed my crew.', 'Tamu the Scribe would settle here, if there were a workshop worth writing about.', 'Raiders watch the river. Raise a keep on the square and we will trade here for good.'], greeting: 'Ho, the town! We heard there was a furnace here. We have grain to trade.', farewell: 'The river will carry your name downstream. Fair winds.', daughterLine: 'I was small when we crossed your bridge. I remember the fire pits.' },
  { name: 'the Travelling Court', leader: 'Sir Aldric', travellers: ['Pip the Jester', 'Minstrel Robin'], specialist: 'Master Wick the Millwright', wonder: 'the Steam Engine', wonderWhat: 'The Steam Engine: a great beam engine house of brick with a tall chimney, a huge flywheel, pistons and a brass boiler, puffing steam',  problems: ['The court is hungry and the jester is worse. Feast us!', 'Master Wick the Millwright seeks a smithy and willing hands.', 'Wick dreams of an engine that runs on steam. Build it on the square and the world will change.'], greeting: 'Make way for the court! We have heard of your keep.', farewell: 'The court must ride on. This town has earned its place in the songs.', daughterLine: 'My father is gone now. I travel with the court, and I asked them to come this way.' },
  { name: 'the Railway Barons', leader: 'Mr Hargreaves', travellers: ['Porter Jones', 'Miss Clay'], specialist: 'Ada the Engineer', wonder: 'the Power Station', wonderWhat: 'The Power Station: a brick power station with tall chimneys, turbine halls and pylons carrying wires out over the town, its windows lit',  problems: ['The line brings hungry passengers. Feed them and the trains will keep coming.', 'Ada the Engineer needs a works to build her machines in.', 'Ada says lightning can run through wires. Build a power station on the square.'], greeting: 'The line reaches you at last. There is money to be made in this town.', farewell: "The line runs on. You'll be on every timetable now.", daughterLine: 'I told the barons about the girl at the river. Nobody believed me until they saw the place.' },
  { name: 'the Tour Coach', leader: 'Guide Lena', travellers: ['Tourist Bob', 'Influencer Kai'], specialist: 'Dr Rao the Researcher', wonder: 'the Launch Tower', wonderWhat: 'The Launch Tower: a tall steel launch tower with a gantry and walkways, a slim rocket standing ready beside it, floodlights and a blast pad',  problems: ["The coach is starving and the reviews are due. Feed my group!", 'Dr Rao wants to open a lab here. Give her a workshop and some help.', 'Dr Rao is reaching for the stars. Build a launch tower on the square.'], greeting: 'Everyone off the coach, please. This is the town from the reviews.', farewell: 'Five stars. Everyone back on the coach, please.', daughterLine: 'Every age I come back, and every age the town is bigger.' },
  { name: 'the Scrap Convoy', leader: 'Road Boss Roxy', travellers: ['Rust', 'Patch'], specialist: 'Sparks the Tinker', wonder: 'the Scrap Rocket', wonderWhat: 'The Scrap Rocket: a tall rocket welded together from scrap, oil drums and old car panels, fins of sheet metal, standing on a launch pad of salvage, ready to fly',  problems: ["The convoy has run dry. Food, clean water, anything. Feed us and we'll park the rigs.", 'Sparks the Tinker can mend anything, given a scrapyard to work in and a few hands.', 'There is one way out of the wastes, and it is up. Build a rocket from the scrap on the square, and the journey ends among the stars.'], greeting: "Easy. We're not raiders. We saw your lights from the road.", farewell: "We'll see you up there.", daughterLine: 'The roads are empty now. This town is the last light on them.' },
];
export const caravanOf = (age: number): AgeCaravan => CARAVANS[Math.max(0, Math.min(CARAVANS.length - 1, age))];
/** The travellers renamed so nobody shares a name with the cast (FK-128; Road Boss Mara too, in case the bible's fallback
 * cast names are ever used). A save from before may still hold them under the old names: city.ts renames them where they stand. */
export const RENAMED_TRAVELLERS: ReadonlyMap<string, string> = new Map([
  ['Ashur the Boatman', 'Hori the Boatman'],
  ['Minstrel Wren', 'Minstrel Robin'],
  ['Mr Ashby', 'Mr Hargreaves'],
  ['Road Boss Mara', 'Road Boss Roxy'],
]);

/**
 * The band as the town hears of them. With Story on it is the same five every age (FK-014), so the age's
 * own band never shows (FK-128): the cast's leader speaks for them (Ash, then Wren from Medieval), not
 * Toma or Captain Nebet; they are "the travellers", not the Mammoth Herders; and the lines that only fit
 * a new band (its greeting walking in, its goodbye, the daughter's line on arriving) are dropped. A
 * scene line that comes out empty is skipped (shared/scenes.ts fillLine).
 */
export function bandOf(state: DudesState, age: number): AgeCaravan {
  const c = caravanOf(age);
  return storyOn(state) ? { ...c, name: 'the travellers', leader: castIn(age)[0].name, greeting: '', farewell: '', daughterLine: '' } : c;
}
/** The band's leader as a pronoun: Ash's, or Wren's once she leads (Story on); today's leaders are all "his". */
const leaderHis = (state: DudesState, age: number) => (storyOn(state) && castIn(age)[0].role === 'wren' ? 'her' : 'his');

/** The daughter: a small child at the river in the Stone Age, grown up by the Future (docs/ages.md, the
 * through-line). Her name is the town's (admin can change it; chat may get to choose). With Story on she
 * is the cast's Wren; the town's own name for her (`city.daughter`) is kept for when Story goes off. */
export const DAUGHTER = 'Ama';
const DAUGHTER_SCALE = [0.56, 0.8, 0.96, 1, 1, 1];
export const daughterOf = (state: DudesState): string => (storyOn(state) ? CAST.wren.name : (cityOf(state).daughter ?? DAUGHTER));
/** The leader's daughter, in Stone; later ages say who she travels with. Today's band only: the cast's tags carry no title. */
export const daughterTitle = (age: number) => (age === 0 ? 'his daughter' : age === 1 ? 'Toma\u2019s daughter, grown' : 'once the girl at the river');

/** The bridge needs this share of the chatters who are around, each putting in a shift. */
const BRIDGE_SHARE = 0.4;
const BRIDGE_MAX = 8;
/** One shift at the bridge, once there. */
export const BRIDGE_SHIFT_MS = 9000;

/** Sandbox mode is the caravan switched off: no travellers, no asks, the age stays put. */
export const caravanOn = (state: DudesState) => state.ai.caravan !== false;

/** Minutes a visit may sit open before its biggest ask is trimmed. */
const TRIM_MS = 45 * 60_000;
const BETWEEN_MS = 20_000;
/** After the age turns: the old caravan heads home, then this long before the next one walks in. */
const BREATHER_MS = 75_000;
/** The leader tries again this long after a Wonder's plans fell through. */
const WONDER_RETRY_MS = 60_000;
/** Where travellers come in: on the avenue just east of the square (the walk from the camp is skipped). */
const GATE = { x: PITCH / 2, z: 0 };

function scaled(state: DudesState, base: number, now: number): number {
  const awakeCount = state.dudes.filter((d) => awake(d, now)).length;
  return Math.max(1, Math.round(base * Math.max(0.6, Math.min(2, awakeCount / 3))));
}

function asksFor(state: DudesState, age: number, visit: number, now: number): CaravanAsk[] {
  const n = (kind: VenueKind) => venueName(age, kind);
  const c = caravanOf(age);
  // A town that already has places of the asked sort needs fewer new ones, and doing up one it has
  // counts too: the 32 lots would fill up over six ages otherwise.
  const standing = (kinds: VenueKind[]) => state.objects.filter((o) => o.venue && kinds.includes(o.venue) && !o.civic && o.destroyedAt === undefined).length;
  if (visit === 0) {
    const builds = Math.max(1, scaled(state, 2, now) - Math.floor(standing(FOOD) / 2)),
      fed = scaled(state, 4, now);
    return [
      { id: 'food', kind: 'build', venues: FOOD, label: `Build or do up ${builds === 1 ? 'a place' : `${builds} places`} to eat (${n('restaurant')}, ${n('cafe')}…)`, need: builds, have: 0 },
      { id: 'fed', kind: 'serve', venues: FOOD, label: `Feed ${fed} of the travellers at your places to eat`, need: fed, have: 0 },
    ];
  }
  if (visit === 1) {
    const shifts = scaled(state, 4, now);
    return [
      { id: 'work', kind: 'build', venues: WORK, label: `Build or do up a ${n('workshop')} for ${c.specialist}`, need: 1, have: 0 },
      { id: 'shifts', kind: 'operate', venues: WORK, label: `Work ${shifts} shifts at a ${n('workshop')}`, need: shifts, have: 0 },
      { id: 'party', kind: 'party', label: `Throw a party to welcome ${c.specialist} (tell your character to throw one)`, need: 1, have: 0 },
    ];
  }
  return [{ id: 'wonder', kind: 'project', label: `Build ${c.wonder} in the middle of the square together (chip in coins and lend a hand)`, need: 1, have: 0 }];
}

const travellerLook = (name: string, age: number): DudeLook => {
  const l = defaultLook(name);
  const tints = ['#8a5a3c', '#3f6f8a', '#8a3f5a', '#5a7a3a'];
  return { ...l, shirt: tints[hashOf(name + age) % tints.length] };
};

/** The age's band into town (those not here already), and their ids, leader first. `fresh`: a new caravan
 * arriving, so cast members who stayed from the last one are put back on their marks too. */
function bringTravellers(state: DudesState, age: number, now: number, strand = false, fresh = false): string[] {
  const city = cityOf(state);
  const c = caravanOf(age);
  const stranded = !!city.caravan?.stranded || strand;
  const spot = (i: number) => (stranded ? { ...STRANDED[i] } : { x: GATE.x, z: GATE.z + (i - 1) * 1.2 });
  // Finders Keepers: the cast are the band, under ids of their own, so the same five come through every age (FK-014).
  if (storyOn(state))
    return castIn(age).map((m, i) => {
      const t = castArrival(m, i, age, spot(i), stranded ? FACING_TOWN : -Math.PI / 2, now);
      const was = city.townies.find((x) => x.id === t.id);
      if (!was) city.townies.push(t);
      // Still here from the last caravan: the same townie, on their marks and in their place for this one.
      else if (fresh) Object.assign(was, { placeId: undefined, hidden: undefined, say: undefined, emote: undefined, leader: undefined, daughter: undefined, scale: undefined }, t);
      return t.id;
    });
  const names = [c.leader, daughterOf(state), ...c.travellers].slice(0, STRANDED.length);
  const ids: string[] = [];
  names.forEach((name, i) => {
    // One of the band here already keeps their id, though it was made from another name: renamed where
    // they stood (a save from before FK-128's renames, or the daughter named by admin), they're still them.
    const id = city.townies.find((t) => t.traveller && !t.role && t.name === name)?.id ?? `c${hashOf(`${name}:${age}`).toString(36)}`.slice(0, 20);
    ids.push(id);
    if (city.townies.some((t) => t.id === id)) return;
    const at = spot(i);
    const look = travellerLook(name, age);
    // The elder of the Stone Age band is grey.
    if (age === 0 && name === 'Old Ura') look.hair = '#c9c4ba';
    const t: Townie = {
      id,
      name,
      look,
      position: at,
      facing: stranded ? FACING_TOWN : -Math.PI / 2,
      path: [],
      doing: 'stroll',
      until: now + 2000 + i * 1500,
      traveller: true,
      ...(i === 0 ? { leader: true } : {}),
      ...(i === 1 ? { daughter: true, scale: DAUGHTER_SCALE[age] ?? 1 } : {}),
    };
    city.townies.push(t);
  });
  return ids;
}

/** The travellers go home: all but the age's cast, who stay through every age while Story is on (FK-014). */
function sendTravellersHome(state: DudesState, age: number): void {
  const city = cityOf(state);
  const goes = (t: Townie) => !!t.traveller && !keepsCast(state, t, age);
  if (city.townies.some(goes)) city.townies = city.townies.filter((t) => !goes(t));
}

/**
 * The band follows the Story switch (FK-014): switched on, the age's cast take the travellers' places;
 * switched off, today's band comes back. Each takes over where the one before them stood and was going,
 * so a swap mid-visit (or mid-walk) carries on from there.
 */
function bandFollowsStory(state: DudesState, cv: Caravan, now: number): void {
  const cast = castIn(cv.age).map((m) => castId(m.role));
  if (storyOn(state) ? cv.travellers.length === cast.length && cv.travellers.every((id, i) => id === cast[i]) : !cv.travellers.some(isCastId)) return;
  const city = cityOf(state);
  const was = cv.travellers.map((id) => city.townies.find((t) => t.id === id));
  sendTravellersHome(state, cv.age);
  cv.travellers = bringTravellers(state, cv.age, now);
  cv.travellers.forEach((id, i) => {
    const t = city.townies.find((x) => x.id === id);
    const w = was[i];
    if (!t || w === t) return;
    // Nobody to take over from (switched on in Bronze's breather: today's band is 4, the cast 5): wait at the camp with the rest.
    if (!w) {
      if (cv.turn?.left) Object.assign(t, { position: { ...STRANDED[i % STRANDED.length] }, facing: FACING_TOWN, path: [] });
      return;
    }
    Object.assign(t, { position: { ...w.position }, facing: w.facing, path: w.path.map((p) => ({ ...p })), doing: w.doing, placeId: w.placeId, hidden: w.hidden, until: w.until });
  });
  state.worldRevision++;
}
/** Story (dev) → Reset the cast: the band as new, on this caravan's marks, as a new caravan brings them. */ // hook FK-002
export function resetCast(state: DudesState, cv: Caravan, now: number): void {
  sendTravellersHome(state, cv.age);
  cv.travellers = bringTravellers(state, cv.age, now, false, true);
  state.worldRevision++;
} // hook FK-002

function openVisit(state: DudesState, cv: Caravan, now: number): void {
  cv.openedAt = now;
  cv.trimmed = undefined;
  cv.nextAt = undefined;
  cv.seen = [];
  cv.asks = asksFor(state, cv.age, cv.visit, now);
  const kinds = new Set(cv.asks.flatMap((a) => (a.kind === 'build' ? (a.venues ?? []) : [])));
  cv.revs = Object.fromEntries(state.objects.filter((o) => o.venue && kinds.has(o.venue)).map((o) => [o.id, o.revision]));
  const c = bandOf(state, cv.age);
  const line = c.problems[cv.visit] ?? c.problems[0];
  const leader = cityOf(state).townies.find((t) => t.id === cv.travellers[0]);
  if (leader) {
    leader.say = { text: line, until: now + 12_000 };
    leader.path = [];
  }
  pushFeed(state, now, `${c.leader} of ${c.name}: ${line}`);
  crierVisitOpened(state, cv, now);
  for (const d of state.dudes) if (awake(d, now)) tell(state, d, `${c.leader} of ${c.name} (camped across the river) asks the town: ${cv.asks.map((a) => a.label).join('; ')}. Helping them moves the town into the next age.`, now, false);
  if (cv.asks.some((a) => a.kind === 'project')) leaderProposesWonder(state, cv, now);
}

/** The Wonder visit: the leader puts the age's Wonder forward as the town's project (once nothing else is
 * being built), on its own spot in the middle of the square. Only it finishes the ask. */
let wonderTriedAt = 0;
function leaderProposesWonder(state: DudesState, cv: Caravan, now: number): void {
  const p = cityOf(state).project;
  if (p && (p.status === 'designing' || p.status === 'gathering')) return;
  if (now - wonderTriedAt < WONDER_RETRY_MS && wonderTriedAt <= now) return;
  wonderTriedAt = now;
  const c = bandOf(state, cv.age);
  if (!proposeWonder(state, cv.age, c.wonderWhat, now)) return;
  pushFeed(state, now, `${c.leader} has drawn up ${c.wonder} for the middle of the square`);
}

/** A caravan for the town's age, arriving now. The Stone Age's (or any, with `strand`) waits across
 * the river with the bridge down: nothing is asked until the opening has played. */
export function startCaravan(state: DudesState, now: number, strand = ageOf(state) === 0, walkIn = false): Caravan {
  const age = ageOf(state);
  const city = cityOf(state);
  // Last age's travellers go home (the cast stay, FK-014).
  sendTravellersHome(state, age);
  city.scene = undefined;
  city.caravan = undefined;
  // Walking in: they start at the camp, like the stranded band, and cross the (mended) bridge.
  const travellers = bringTravellers(state, age, now, strand || walkIn, true);
  const cv: Caravan = { age, visit: 0, openedAt: now, asks: [], travellers, ...(strand ? { stranded: true, helpers: [] } : {}) };
  city.caravan = cv;
  state.worldRevision++;
  const c = bandOf(state, age);
  pushFeed(state, now, strand ? `${cap(c.name)} are stuck across the river: the bridge is down` : `${c.name} have made camp across the river`);
  if (strand) return cv;
  if (walkIn) {
    // The arrival: over the bridge and into town; the first visit opens once they are across. With Story
    // on it is the cast walking back in, so neither a new band's greeting nor the daughter's line (FK-128).
    walkOver(state, cv, now);
    cv.nextAt = now + SCENES.arrival.ms + 4000;
    city.scene = { id: 'arrival', at: now, beat: 0, vars: { greeting: c.greeting, daughter: daughterOf(state), daughterLine: c.daughterLine } };
    return cv;
  }
  openVisit(state, cv, now);
  return cv;
}
/** From the camp over the bridge in file and up the bank (laid by hand, so they cross in file); tickTraveller takes them on into town. */
function walkOver(state: DudesState, cv: Caravan, now: number): void {
  const city = cityOf(state);
  cv.travellers.forEach((id, i) => {
    const t = city.townies.find((x) => x.id === id);
    if (!t) return;
    const z = (i % 2 ? -0.5 : 0.5) * (i ? 1 : 0);
    t.path = [{ x: BRIDGE.far + 0.5 + i * 0.2, z }, { x: BRIDGE.near - 0.5, z }, { x: BRIDGE_ROAD.x, z: BRIDGE_ROAD.z + z }];
    t.doing = 'stroll';
    t.until = now + 2000;
    t.emote = undefined;
  });
  state.worldRevision++;
}
/** The age has turned: the old caravan walks back over the bridge to its camp, and waits there. */
function walkBack(state: DudesState, cv: Caravan, now: number): void {
  const city = cityOf(state);
  cv.travellers.forEach((id, i) => {
    const t = city.townies.find((x) => x.id === id);
    if (!t) return;
    const z = (i % 2 ? -0.5 : 0.5) * (i ? 1 : 0);
    const into = route(t.position, BRIDGE_ROAD, state.objects) ?? [];
    t.path = [...into.slice(1), { x: BRIDGE_ROAD.x, z: BRIDGE_ROAD.z + z }, { x: BRIDGE.near - 0.5, z }, { x: BRIDGE.far + 0.5, z }, { ...STRANDED[i % STRANDED.length] }];
    t.doing = 'stroll';
    t.placeId = undefined;
    t.hidden = undefined;
    t.say = undefined;
    t.until = now + 2000;
  });
  if (cv.turn) cv.turn.left = true;
  state.worldRevision++;
}
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// ---- the bridge and the scenes --------------------------------------------------------------------
/** Admin: play a scene now. The opening puts the caravan back across the river first if it isn't. */
export function playScene(state: DudesState, id: SceneId, now: number): void {
  const city = cityOf(state);
  if (id === 'opening') {
    const cv = city.caravan;
    if (!cv || cv.age !== ageOf(state) || !cv.stranded || cv.asks.length) startCaravan(state, now, true);
    // Everyone back to their marks, quiet.
    for (const [i, tid] of city.caravan!.travellers.entries()) {
      const t = city.townies.find((x) => x.id === tid);
      if (!t) continue;
      t.position = { ...STRANDED[i] };
      t.facing = FACING_TOWN;
      t.path = [];
      t.say = undefined;
      t.emote = undefined;
    }
  }
  city.scene = { id, at: now, beat: 0 };
}

function bridgeNeed(state: DudesState, now: number): number {
  const around = state.dudes.filter((d) => awake(d, now)).length;
  return Math.max(1, Math.min(BRIDGE_MAX, Math.ceil(around * BRIDGE_SHARE)));
}
/** The opening has played: the board asks for the bridge. */
function openBridge(state: DudesState, cv: Caravan, now: number): void {
  const c = bandOf(state, cv.age);
  const need = bridgeNeed(state, now);
  cv.openedAt = now;
  cv.trimmed = undefined;
  cv.helpers = [];
  cv.asks = [{ id: 'bridge', kind: 'bridge', label: `Mend the bridge: ${need === 1 ? 'one of you' : `${need} of you`} lend a hand (tell your character to help at the bridge)`, need, have: 0 }];
  const line = `${c.leader} of ${c.name}: "The bridge is gone. We can't cross. Can you mend it?"`;
  pushFeed(state, now, line);
  crierBridgeOpened(state, cv, need, now);
  for (const d of state.dudes) if (awake(d, now)) tell(state, d, `${c.leader} of ${c.name} is stuck across the river with ${leaderHis(state, cv.age)} people: the bridge is broken. ${need} of the town need to help mend it ("help" goes to the bridge). Once they cross, they will have more to ask.`, now, false);
}
/** A helper at the bridge site: where they stand on the town bank by the water, spread out along it. */
export function bridgeSpot(i: number): { x: number; z: number } {
  return { x: BRIDGE.near - 1.4, z: [-0.9, 0.9, -2, 2, 0, -3, 3, -1.5][i % 8] };
}
/** The town end of the bridge, up the bank from the water (FK-078): the band walks off the deck to here and back from it, and helpers step back to it after a shift, clear of the deck. */
export const BRIDGE_ROAD = { x: BRIDGE.near - 6, z: 0 };
/**
 * At start (FK-078): a band saved waiting across the river where it used to run (layout A+ moved it east)
 * would stand on the new town bank. Whoever of it isn't on the landing goes back on their mark there,
 * facing the town, and anyone on their way to the old bridge (or mending it) is let go: still a volunteer,
 * they are sent to the new one (keepVolunteers). How many of the band moved.
 */
export function bandAcrossRiver(state: DudesState): number {
  const city = state.city;
  const cv = city?.caravan;
  if (!city || !cv || !(cv.stranded || cv.turn?.left)) return 0;
  let moved = 0;
  cv.travellers.forEach((id, i) => {
    const t = city.townies.find((x) => x.id === id);
    if (!t || contains(LANDING, t.position)) return;
    Object.assign(t, { position: { ...STRANDED[i % STRANDED.length] }, facing: FACING_TOWN, path: [] });
    moved++;
  });
  for (const d of state.dudes) {
    if (d.labour?.site !== 'bridge' || d.labour.at.x >= BRIDGE.near - 3) continue;
    d.labour = undefined;
    if (d.emote?.pose === 'hammer') d.emote = undefined;
    if (d.walkingFor === 'job') [d.path, d.walkingFor] = [[], undefined];
  }
  return moved;
}
/** Is the bridge asking for hands right now? */
export function bridgeOpen(state: DudesState): boolean {
  const cv = cityOf(state).caravan;
  return !!(caravanOn(state) && cv?.stranded && cv.asks.some((a) => a.kind === 'bridge' && a.have < a.need));
}
/** A dude finished a shift on the bridge. */
export function bridgeHelped(state: DudesState, dudeId: string, now: number): void {
  const cv = cityOf(state).caravan;
  if (!cv?.stranded) return;
  const helpers = (cv.helpers ??= []);
  if (helpers.includes(dudeId)) return;
  helpers.push(dudeId);
  cv.volunteers = (cv.volunteers ?? []).filter((v) => v.id !== dudeId);
  state.worldRevision++;
  caravanSaw(state, 'bridge', now, undefined, undefined, dudeId);
}
/** How mended the bridge is (0..1), while it is down; undefined when whole. */
export function bridgeProgress(state: DudesState): number | undefined {
  const cv = cityOf(state).caravan;
  if (!caravanOn(state) || !cv?.stranded) return undefined;
  const a = cv.asks.find((x) => x.kind === 'bridge');
  return a ? Math.min(1, a.have / Math.max(1, a.need)) : 0;
}
/** Mended: the travellers walk over, the crossing plays, and the first visit opens a little later. */
function crossOver(state: DudesState, cv: Caravan, now: number): void {
  const city = cityOf(state);
  const c = bandOf(state, cv.age);
  cv.stranded = undefined;
  cv.asks = [];
  cv.visit = 0;
  cv.nextAt = now + SCENES.crossing.ms + 4000;
  walkOver(state, cv, now);
  pushFeed(state, now, `The bridge is mended! ${cap(c.name)} are crossing into town`);
  crierBridgeDone(state, cv, now);
  city.scene = { id: 'crossing', at: now, beat: 0 };
}

/** While the bridge is down, a bridge someone set out to build on their own lot is called off, and
 * they go and mend the real one instead. */
function noLotBridges(state: DudesState, now: number): void {
  for (const j of state.jobs) {
    if (j.kind !== 'build' || !['queued', 'ready', 'walking', 'building'].includes(j.status) || !/\bbridge\b/i.test(j.request ?? '')) continue;
    const d = state.dudes.find((x) => x.id === j.dudeId);
    if (!d) continue;
    j.status = 'failed';
    if (d.walkingFor === 'job') {
      d.path = [];
      d.walkingFor = undefined;
    }
    tell(state, d, 'you were about to build a bridge on your lot, but the travellers need the real one over the river mended: you went to help there instead', now, false);
    startLabour(state, d, now);
  }
}

/** Remember who set off for the bridge; anyone knocked off it before their shift counted goes back. */
export function volunteer(state: DudesState, dudeId: string, now: number): void {
  const cv = cityOf(state).caravan;
  if (!cv?.stranded) return;
  const v = (cv.volunteers ??= []).filter((x) => x.until > now && x.id !== dudeId);
  v.push({ id: dudeId, until: now + 150_000 });
  cv.volunteers = v.slice(-20);
}
function keepVolunteers(state: DudesState, cv: Caravan, now: number): void {
  for (const v of cv.volunteers ?? []) {
    if (v.until <= now || cv.helpers?.includes(v.id)) continue;
    const d = state.dudes.find((x) => x.id === v.id);
    if (!d || d.labour?.site === 'bridge') continue;
    if (v.nudged && now - v.nudged < 3000) continue;
    v.nudged = now;
    const what = d.visit ? `a visit to ${d.visit.placeId}` : d.use ? `using ${d.use.objectId}` : d.bit ? 'a bit' : d.attack ? 'a fight' : d.labour ? 'the community project' : d.walkingFor ? `walking (${d.walkingFor})` : 'nothing';
    const why = startLabour(state, d, now);
    tell(state, d, why ? `you could not get back to the bridge: ${why}` : `something pulled you off the bridge (you were on ${what}); you went straight back to it`, now, false);
  }
}

/** Who a scene's beat moves: the traveller at that place in the caravan; with Story on, the age's cast
 * member at that place in castIn's order, found by role (FK-127), so a band out of order (or no caravan
 * at all, a Story (dev) look) still has the right one wave. */
function beatWho(state: DudesState, cv: Caravan | undefined, who: number): Townie | undefined {
  if (!storyOn(state)) return cityOf(state).townies.find((x) => x.id === cv?.travellers[who]);
  const m = castIn(cv?.age ?? ageOf(state))[who];
  return m && castTownie(state, m.role);
}

/** Every tick while a scene plays: its beats, and what follows when it ends. */
function tickScene(state: DudesState, now: number): void {
  const city = cityOf(state);
  const sc = city.scene;
  if (!sc) return;
  const cv = city.caravan;
  const scene = SCENES[sc.id];
  const t = now - sc.at;
  while (sc.beat < scene.beats.length && scene.beats[sc.beat].at <= t) {
    const b = scene.beats[sc.beat++];
    if (b.do === 'age') {
      // The wave: the town turns into the next age, on camera.
      if (cv?.turn && !cv.turn.final && ageOf(state) === cv.age) setAge(state, cv.age + 1, now);
      continue;
    }
    if (b.do === 'leave') {
      // Only an age really turning sends the band home: a Story (dev) look at the scene leaves them be.
      if (cv?.turn) walkBack(state, cv, now);
      continue;
    }
    if (b.do === 'launch') {
      const at = wonderOf(state)?.position ?? { x: 0, z: 0 };
      addEffect(state, { kind: 'boom', at: now, from: { ...at }, radius: 5 });
      for (let i = 0; i < 4; i++) addEffect(state, { kind: 'burst', at: now, to: { x: at.x + Math.cos(i * 1.7) * 4, z: at.z + Math.sin(i * 1.7) * 4 }, label: 'confetti' });
      continue;
    }
    const who = beatWho(state, cv, b.who);
    if (!who) continue;
    if (b.do === 'step') {
      who.path = [{ x: who.position.x - STEP_FORWARD, z: who.position.z }];
      who.facing = FACING_TOWN;
    } else if (b.pose) who.emote = { pose: b.pose, until: now + (b.ms ?? 2500) };
  }
  if (t < scene.ms) return;
  city.scene = undefined;
  if (sc.id === 'opening' && cv?.stranded && !cv.asks.length) openBridge(state, cv, now);
  if (sc.id === 'ageTurn' && cv?.turn && !cv.turn.arriveAt) cv.turn.arriveAt = now + BREATHER_MS;
}

/**
 * With Story on, today's caravan scenes tick here, from the show runtime (story/show.ts tickShow,
 * FK-127), and tickCaravan leaves them alone: so one plays out whatever the caravan, town life and the
 * chatters are doing, with nobody awake and the caravan off. The same script, the same `city.scene`
 * (the page, the save and everything waiting on a scene see no difference) and the same endings (the
 * bridge ask after the opening, the breather after the age turn); only the people are found by role
 * (beatWho). A story scene has the page (story/view.ts): a caravan scene that comes up under one waits
 * for it to end, then starts from the top. Never throws: a scene that breaks ends, with an alert.
 */
export function tickCaravanScene(state: DudesState, now: number, log: WorldCtx<DudesState>['log']): void {
  const city = state.city;
  const sc = city?.scene;
  if (!city || !sc) return;
  try {
    if (city.story?.scene && sc.beat === 0) {
      sc.at = now;
      return;
    }
    tickScene(state, now);
  } catch (e) {
    city.scene = undefined;
    log(`story: PANIC EXIT from today's ${String(sc.id).slice(0, 40)} scene: it threw: ${e instanceof Error ? e.message : String(e)}`, 'alert');
  }
}

/**
 * Story (dev) → Play: Opening, Crossing or Age turn (FK-127): today's scene now, ticked by the show
 * runtime (tickCaravanScene). Says why not, and changes nothing, while a scene plays. The opening needs
 * what /admin's scene-opening needs (the caravan and town life on: it opens the bridge ask); the other two
 * need nothing, not the caravan, not anyone awake. With the band waiting across the river, the Crossing
 * is the crossing for real (the bridge mended, the band walks over, the first visit opens after); else
 * it is a look. The age turn is always a look: its lines as they would read now, and the age stays (only
 * the Wonder standing turns it).
 */
export function playStoryScene(state: DudesState, id: 'opening' | 'crossing' | 'ageTurn', now: number): string | undefined {
  const city = cityOf(state);
  if (city.scene) return `The ${city.scene.id} scene is playing: let it finish first`;
  if (city.story?.scene) return `The ${city.story.scene.id} scene is playing: Stop it first`;
  const cv = city.caravan;
  const age = ageOf(state);
  if (id === 'opening') {
    if (!caravanOn(state)) return 'The caravan is off (sandbox mode): switch it on first';
    if (state.ai.townLife === false) return 'Town life is off: switch it on first (the travellers are townsfolk)';
    playScene(state, 'opening', now);
  } else if (id === 'crossing') {
    if (cv?.stranded && cv.age === age) crossOver(state, cv, now);
    else playScene(state, 'crossing', now);
  } else {
    const c = bandOf(state, age);
    const vars = { head: headName(state), wonder: c.wonder, was: ageStyle(age).name, age: ageStyle(Math.min(age + 1, LAST_AGE)).name, heroes: names(ageHeroes(state, 3)), farewell: c.farewell };
    city.scene = { id: 'ageTurn', at: now, beat: 0, vars };
  }
  return undefined;
}

export const sceneView = (state: DudesState) => {
  const city = cityOf(state);
  const sc = city.scene;
  // With Story on the cast's leader speaks even before any caravan has come (a Story (dev) look, FK-127).
  const age = city.caravan?.age ?? (storyOn(state) ? ageOf(state) : undefined);
  return sc ? { id: sc.id, at: sc.at, ...(age !== undefined ? { leader: bandOf(state, age).leader } : {}), ...(sc.vars ? { vars: sc.vars } : {}) } : undefined;
};

const names = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`);
/** The Wonder stands: write down the age's heroes, then the age turns on screen (or, the last age, the finale). */
function turnAge(state: DudesState, cv: Caravan, now: number, final: boolean): void {
  const city = cityOf(state);
  const c = bandOf(state, cv.age);
  const heroes = ageHeroes(state, 3);
  city.heroes = [...(city.heroes ?? []).filter((h) => h.age !== cv.age), { age: cv.age, names: heroes.map((h) => h.slice(0, 40)) }].slice(-6);
  cv.visit = 3;
  cv.asks = [];
  cv.nextAt = undefined;
  cv.turn = { at: now, ...(final ? { final: true } : {}) };
  const vars: Record<string, string> = { head: headName(state), wonder: c.wonder, was: ageStyle(cv.age).name };
  if (final) {
    const roll = Object.fromEntries(
      (city.heroes ?? []).flatMap((h, i) => [
        [`roll${i}Who`, `Heroes of ${ageStyle(h.age).name}`],
        [`roll${i}`, names(h.names)],
      ]),
    );
    city.scene = { id: 'finale', at: now, beat: 0, vars: { ...vars, ...roll, daughter: daughterOf(state), daughterLine: bandOf(state, 0).daughterLine } }; // with Story on, no line of Ama's for Wren (FK-128)
  } else city.scene = { id: 'ageTurn', at: now, beat: 0, vars: { ...vars, age: ageStyle(cv.age + 1).name, heroes: names(heroes), farewell: c.farewell } }; // no goodbye from the cast (FK-128)
  state.worldRevision++;
}
/** Why the daughter can't be named now: with Story on she is the cast's Wren (FK-128; /admin's name-daughter says so). */
export const daughterLocked = (state: DudesState): string | undefined => (storyOn(state) ? `Story is on: ${CAST.wren.name} is the daughter` : undefined);
/** Admin: name the daughter (her name follows her through every age). Never with Story on: the town's name for her stays as it was. */
export function nameDaughter(state: DudesState, name: string, now: number): void {
  if (daughterLocked(state)) return;
  const city = cityOf(state);
  const was = daughterOf(state);
  city.daughter = name;
  for (const t of city.townies) if (t.traveller && !t.role && t.name === was) t.name = name;
  pushFeed(state, now, `${was === name ? name : `The girl at the river is called ${name}`}`);
}

function complete(state: DudesState, cv: Caravan, now: number): void {
  const c = bandOf(state, cv.age);
  const city = cityOf(state);
  if (cv.stranded) return crossOver(state, cv, now);
  if (cv.visit === 1) {
    // The specialist settles in town for good, as a resident.
    const id = `s${hashOf(c.specialist).toString(36)}`.slice(0, 20);
    if (!city.townies.some((t) => t.id === id))
      city.townies.push({ id, name: c.specialist, look: travellerLook(c.specialist, cv.age), position: { ...GATE }, facing: -Math.PI / 2, path: [], doing: 'stroll', until: now + 3000 });
    pushFeed(state, now, `${c.specialist} has settled in town`);
  }
  if (cv.visit >= 2) {
    if (cv.age >= LAST_AGE) {
      turnAge(state, cv, now, true);
      crierAgeTurned(state, cv.age, now, true);
      pushFeed(state, now, `${c.name} cheer: the town has reached the stars. The journey is complete.`);
      return;
    }
    // The scene turns the age (its 'age' beat), the travellers say goodbye and go back to camp, and the
    // next age's caravan walks in after a breather (tickCaravan).
    const next = cv.age + 1;
    turnAge(state, cv, now, false);
    crierAgeTurned(state, cv.age, now);
    pushFeed(state, now, `${c.wonder} is finished! The town moves into ${ageStyle(next).name}.`);
    return;
  }
  pushFeed(state, now, `${c.leader} is pleased: the town did everything ${c.name} asked`);
  crierVisitDone(state, cv, now);
  cv.visit++;
  cv.asks = [];
  cv.nextAt = now + BETWEEN_MS;
}

/** Every tick: the caravan arrives (or follows the age), visits open, long lists are trimmed. */
export function tickCaravan(state: DudesState, now: number): void {
  const city = cityOf(state);
  if (!caravanOn(state)) {
    // The travellers go home (the cast stay); the caravan's place in the age is kept for when it comes back.
    sendTravellersHome(state, ageOf(state));
    return;
  }
  if (!state.dudes.some((d) => awake(d, now)) && !city.caravan) return;
  let cv = city.caravan;
  // The age is turning: the scene, the goodbye, a breather, then the next caravan walks in from the camp.
  if (cv?.turn) {
    bandFollowsStory(state, cv, now);
    // With Story on the show runtime ticks the scene (tickCaravanScene, FK-127).
    if (!storyOn(state)) tickScene(state, now);
    if (cv.turn.final) return;
    if (!city.scene && !cv.turn.arriveAt) cv.turn.arriveAt = now + BREATHER_MS;
    if (cv.turn.arriveAt && now >= cv.turn.arriveAt) arrive(state, cv, now);
    return;
  }
  if (!cv || cv.age !== ageOf(state)) cv = startCaravan(state, now);
  bandFollowsStory(state, cv, now);
  // Travellers who wandered off (town life switched off and back) come back.
  // Their ids are taken afresh: one made from an old name (a save from before FK-128) would otherwise dangle.
  if (cv.travellers.some((id) => !city.townies.some((t) => t.id === id)) && cv.visit < 3) cv.travellers = bringTravellers(state, cv.age, now);
  if (!storyOn(state)) tickScene(state, now);
  // The Wonder visit: the leader's Wonder goes forward as soon as the square is free to build it.
  if (!cv.nextAt && cv.asks.some((a) => a.kind === 'project' && a.have < a.need) && !projectOf(state)) leaderProposesWonder(state, cv, now);
  if (bridgeOpen(state)) {
    noLotBridges(state, now);
    keepVolunteers(state, cv, now);
  }
  if (cv.nextAt && now >= cv.nextAt) openVisit(state, cv, now);
  tickCrier(state, cv, now);
  if (!cv.asks.length) return;
  if (!cv.trimmed && now - cv.openedAt > TRIM_MS) {
    const left = cv.asks.filter((a) => a.have < a.need).sort((a, b) => b.need - b.have - (a.need - a.have))[0];
    if (left && left.need > 1) {
      left.need = Math.max(left.have + 1, Math.ceil(left.need * (2 / 3)));
      pushFeed(state, now, `${bandOf(state, cv.age).leader}: "We'll make do with less."`);
    }
    cv.trimmed = true;
  }
  // Builds count once they stand: new places of the asked sort since the visit opened, or ones done up since.
  const revs = cv.revs;
  for (const a of cv.asks) {
    if (a.kind !== 'build') continue;
    const fresh = (o: (typeof state.objects)[number]) => (revs && o.id in revs ? o.revision > revs[o.id] : o.createdAt >= cv!.openedAt);
    const built = state.objects.filter((o) => o.venue && a.venues?.includes(o.venue) && !o.civic && fresh(o));
    a.have = Math.min(a.need, built.length);
    creditBuilds(state, built.slice(0, a.need), now);
  }
  if (cv.asks.every((a) => a.have >= a.need)) complete(state, cv, now);
}

/** Something happened in town that an ask may be waiting for; `by` (a dude id) gets the deed, `who` is the
 * townie served (by id: a resident Wren paying for her meal is not the cast's Wren). */
export function caravanSaw(state: DudesState, kind: AskKind, now: number, venue?: VenueKind, who?: string, by?: string): void {
  const cv = cityOf(state).caravan;
  if (!caravanOn(state) || !cv?.asks.length || cv.nextAt) return;
  for (const a of cv.asks) {
    if (a.kind !== kind || a.have >= a.need) continue;
    if (a.venues && (!venue || !a.venues.includes(venue))) continue;
    if (kind === 'serve' && !(who && cityOf(state).townies.some((t) => t.traveller && t.id === who))) continue;
    a.have++;
    if (kind !== 'project') credit(state, by, kind, now);
  }
  if (cv.asks.every((a) => a.have >= a.need)) complete(state, cv, now);
}

/** For the page's board and every agent. */
export function caravanView(state: DudesState): { name: string; leader: string; visit: number; of: number; problem: string; asks: { label: string; have: number; need: number }[]; between?: boolean; stranded?: boolean } | undefined {
  const cv = cityOf(state).caravan;
  if (!caravanOn(state) || !cv || cv.visit > 2) return undefined;
  const c = bandOf(state, cv.age);
  if (cv.stranded) {
    // Nothing on the board until the opening has shown the town what's wrong.
    if (!cv.asks.length) return undefined;
    return { name: c.name, leader: c.leader, visit: 0, of: 3, problem: "The bridge is gone. We can't cross.", asks: cv.asks.map(({ label, have, need }) => ({ label, have, need })), stranded: true };
  }
  return { name: c.name, leader: c.leader, visit: cv.visit + 1, of: 3, problem: c.problems[cv.visit], asks: cv.asks.map(({ label, have, need }) => ({ label, have, need })), ...(cv.nextAt ? { between: true } : {}) };
}
export function caravanLine(state: DudesState): string | undefined {
  const cv = cityOf(state).caravan;
  if (caravanOn(state) && cv?.stranded) {
    const c = bandOf(state, cv.age);
    const a = cv.asks[0];
    // Who is waiting: today's leader and his little daughter, or with Story on the cast by their tags (FK-128).
    const who = storyOn(state) ? names(castIn(cv.age).map((m) => m.tag)) : `${c.leader} and ${daughterOf(state)}, his little daughter, with their people`;
    return a
      ? `${c.name} (${who}) are stuck across the river: the bridge is broken. ${a.have}/${a.need} have put in a shift mending it. "help" goes to the bridge: when your chatter says build, fix or mend the bridge, that is "help", never a build of your own. Once they cross, they will have more to ask.`
      : `${c.name} are camped across the river; the bridge is broken and nobody can cross yet.`;
  }
  const v = caravanView(state);
  if (!v || v.between) return undefined;
  return `${v.name} camp across the river (visit ${v.visit} of 3). Their leader ${v.leader} asks: ${v.asks.map((a) => `${a.label} (${a.have}/${a.need})`).join('; ')}. Doing what they ask moves the town into the next age.`;
}
/** Admin: the caravan game back on after sandbox. The visit under way opens again from scratch (fresh
 * counts, its ask said again), so what was built in the meantime doesn't finish it on the spot. */
export function resumeCaravan(state: DudesState, now: number): void {
  const cv = cityOf(state).caravan;
  if (!cv || cv.visit > 2) return;
  cv.travellers = bringTravellers(state, cv.age, now);
  if (cv.stranded) {
    if (cv.asks.length) openBridge(state, cv, now);
    return;
  }
  openVisit(state, cv, now);
}
/** After the breather: the next age's caravan walks in from the camp (the age has turned by now; if the scene was cut short, it turns here). */
function arrive(state: DudesState, cv: Caravan, now: number): void {
  if (ageOf(state) === cv.age && cv.age < LAST_AGE) setAge(state, cv.age + 1, now);
  startCaravan(state, now, false, true);
}
/** Admin: finish the visit under way now (or hurry an age turn along). */
export function skipVisit(state: DudesState, now: number): void {
  const city = cityOf(state);
  const cv = city.caravan;
  if (!cv) return void startCaravan(state, now);
  if (cv.turn) {
    if (cv.turn.final) return;
    city.scene = undefined;
    return arrive(state, cv, now);
  }
  if (cv.nextAt) return openVisit(state, cv, now);
  if (cv.stranded && !cv.asks.length) openBridge(state, cv, now);
  // The Wonder going up is finished on the spot, so it stands (its opening completes the visit) …
  const p = projectOf(state);
  if (p?.wonder === cv.age && p.status === 'gathering' && cv.asks.some((a) => a.kind === 'project')) {
    p.coins = p.coinsNeed;
    p.work = p.workNeed;
    return;
  }
  // … and plans still being drawn are dropped.
  if (p?.wonder !== undefined && p.status === 'designing') city.project = undefined;
  for (const a of cv.asks) a.have = a.need;
  complete(state, cv, now);
}
export { VENUES, BUS_STOP };
