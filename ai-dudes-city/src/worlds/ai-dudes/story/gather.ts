// Gathering (FK-018, FK-019): while a Call or a scene runs, chat lines become bubbles and keywords
// (1–10, us, coming, red, gold, warn, help), never agent turns; moves and builds queue for the release.
// Everyone awake is walked to a tiered ring slot round a STORY_SITES anchor (`dude.gather`).
//
// Gather mode (FK-018). hear() and the /play page's `say` hand a line here once it has shown as a bubble
// (index.ts): nothing reaches an inbox, spokeTo, overhear or leaveVisit, and the turns characters take
// on their own wait for the release (pumpAgents, idleLife). So the crowd's own words are the show, and
// fifteen lines in a scene cost no model calls at all.
//
// A keyword counts only as the whole message: trimmed, any case, a trailing "!" or "." and Kick emotes
// aside (FK-012's rule), so "us" is a vote and "us lot should build a wall" is a line. A number 1–10 is
// RATE IT (each chatter's latest counts once in the average), and each word counts each chatter once:
// `us` (the Rally's pips), `coming` (who comes to Wren's fire), `warn` (gold's pings to /mayor), and the
// side words `red`, `gold` and `help` (FK-012 joins the side from hearInGather). The tally is one
// gathering's (a scene's `id:at`), kept in memory only: a restart ends the scene anyway (releaseShow).
//
// Free building keeps working: a move or build line ("build me a hut", "go to the café") waits on its
// chatter (`dude.queuedLine`, saved; their latest one wins, so one queued turn each at most) and goes to
// their agent after the release, one chatter at a time and at least 2 s apart (takeQueued). A newcomer's
// first line waits too, so their agent meets them; if all they said was a vote, their arrival stands in
// for it (a vote never goes to an agent: `red` joins a side, FK-012).
//
// The ring (FK-019, bible §4 "The Bell"). The Call (callRing) gives every awake dude a slot in a tiered
// ring round a STORY_SITES anchor, gold in front, neither side in the middle, red at the back, each row
// a half place over from the one before so faces show between heads; away dudes pad a thin crowd as a
// party's do. They run there (sim.ts runGather, RING.pace × walking speed, ahead of visits and outings)
// and stand facing the anchor. The gathering starts once 70% are there (8 s after the Call at the
// soonest, so the bell and the banner land), or when the 25 s walk is up: stragglers vanish in a puff
// and appear at their slots, and the Call's scene plays. Latecomers (a new chatter, one back from away,
// a player who just logged in) go to the back: walking while the others do, appearing there after the
// start. The release lets them go a few at a time over RING.releaseMs,
// so nobody moves off as one block, and gather mode ends as it begins. The ring itself lives in memory:
// each dude's `gather` is saved, and every boot lets everyone go (show.ts releaseShow). A gathering is
// never a party: it never calls caravanSaw('party') nor sets city.party.
import { LOCK_CAPS } from '../../../shared/scenes';
import { STORY_SITES } from '../../../shared/storyMap';
import { contains, footprint, inflate } from '../../../shared/layout';
import type { GroundPoint } from '../../../shared/objectTypes';
import type { DudeView, TownView } from '../../../shared/dudesTypes';
import { hashOf } from '../agent';
import { TOWN, leaveVisit } from '../city';
import { setAltitude } from '../movers';
import { GROUND, onGround } from '../placement';
import { isPiloted } from '../players';
import { addEffect, awake, endUse, parkObject } from '../sim';
import { storyOn, type Dude, type DudesState } from '../state';
import { lockCapOf, playShow, storyScene } from './show';
import { joinInGather, sideNow } from './sides'; // hook FK-012 (joinInGather)

/** The words gather mode counts, besides a number 1–10. */
export const GATHER_WORDS = ['us', 'coming', 'warn', 'red', 'gold', 'help'] as const;
export type GatherWord = (typeof GATHER_WORDS)[number];
/** A line that was a keyword: a word, or a RATE IT number. */
export type Keyword = { word: GatherWord } | { word: 'rate'; n: number };

/** At least this long between two chatters' queued lines going to their agents after a release. */
export const REPLAY_GAP_MS = 2000;
/** The longest queued line kept (hear() cuts a chat line to this already). */
const LINE_MAX = 300;
/** What a newcomer's agent hears after the release when all they said in the gathering was a vote. */
export const ARRIVED_LINE = 'you arrived in town in the middle of the show and joined the crowd';

/**
 * A scene playing, the head on his mark for one, or anyone held in a ring: chat is in gather mode. A
 * ring being let go no longer is (its last few are walking off). Never with Story off.
 */
export function gathering(state: DudesState): boolean {
  if (!storyOn(state)) return false;
  return !!state.city?.story?.scene || !!state.mayor?.lock || (state.dudes.some((d) => d.gather) && !memos.get(state)?.releasing);
}

const EMOTE = /\[emote:\d{1,12}:[^\]]{0,60}\]/g;

/** The message as one bare word, the way keywords are matched: trimmed, lower case, Kick emotes and a trailing "!" or "." aside. */
export function wholeWord(text: string): string {
  return text.replace(EMOTE, ' ').trim().toLowerCase().replace(/[!.]+$/, '').trimEnd();
}

/** The keyword a whole message is, if it is one: "US!", "coming", "7", "7/10", "8.5". "11", "0" and "us lot" are lines. */
export function keywordOf(text: string): Keyword | undefined {
  const w = wholeWord(text);
  if ((GATHER_WORDS as readonly string[]).includes(w)) return { word: w as GatherWord };
  const m = /^(\d{1,2}(?:\.\d)?)(?:\s*\/\s*10)?$/.exec(w);
  const n = m ? Number(m[1]) : NaN;
  return n >= 1 && n <= 10 ? { word: 'rate', n } : undefined;
}

/**
 * A line that asks the character to do something in the world: build or change something, go
 * somewhere, take part. Only decides what waits for the release, so it leans towards yes: a line it
 * lets through costs one turn after the scene; a build it missed would be lost.
 */
const MOVE_OR_BUILD =
  /\b(build|make|create|construct|craft|put up|set up|add|plant|dig|design|paint|colou?r|decorate|edit|change|upgrade|extend|expand|rebuild|rename|fix|repair|mend|restore|remove|demolish|destroy|delete|tear (it |that )?down|knock (it |that )?down|bulldoze|get rid of|go|walk|run|move|head|visit|follow|ride|drive|fly|sail|come (to|over|here|back|with)|take me|bring|give|share|invite|rent|buy|sell|pay|chip in|contribute|donate|work|help (me|us|with|at|out|build|fix|mend)|throw|party|shoot|punch|attack|fight|hug|high ?five|explore|find|meet|eat|sleep|nap)\b/i;
export const movesOrBuilds = (line: string): boolean => MOVE_OR_BUILD.test(line);

/** One gathering's votes: each RATE IT voter's latest number, and who said each word, first first. */
interface Tally {
  key: string;
  lines: number;
  rates: Map<string, number>;
  words: Record<GatherWord, Set<string>>;
}
/**
 * Per world state (tests make many): the tally, ones a new gathering cut off before a tick logged them,
 * when the next queued line may go, the ring called (FK-019), and whether its crowd is being let go.
 */
interface Memo {
  tally?: Tally;
  ended: Tally[];
  nextReplayAt: number;
  ring?: Ring;
  releasing?: boolean;
}
const memos = new WeakMap<DudesState, Memo>();
const memoOf = (state: DudesState): Memo => memos.get(state) ?? memos.set(state, { ended: [], nextReplayAt: 0 }).get(state)!;

/** Which gathering this is: a scene by its `id:at`, else the ring or the head's mark on their own. */
function keyOf(state: DudesState): string {
  const sc = state.city?.story?.scene;
  return sc ? `${sc.id}:${sc.at}` : 'gather';
}

/** This gathering's tally, begun on its first line. One left from another gathering waits for tickGather to log it. */
function tallyOf(state: DudesState): Tally {
  const memo = memoOf(state);
  const key = keyOf(state);
  if (memo.tally?.key === key) return memo.tally;
  if (memo.tally && memo.ended.length < 4) memo.ended.push(memo.tally);
  memo.tally = { key, lines: 0, rates: new Map(), words: Object.fromEntries(GATHER_WORDS.map((w) => [w, new Set<string>()])) as Tally['words'] };
  return memo.tally;
}

/**
 * A chatter's line in gather mode, once the caller has shown its bubble. A keyword is counted; any other
 * line that is a move or build waits for the release (`queue`: hear()'s lines, not the /play page's,
 * whose builds have a button of their own). So does a newcomer's first line, so their agent meets them
 * after the release: their first words, or their arrival if all they have said is a vote. Says which
 * keyword it was, if any.
 */
export function hearInGather(state: DudesState, dude: Dude, line: string, now: number, queue = true): Keyword | undefined {
  const t = tallyOf(state);
  t.lines++;
  const k = keywordOf(line);
  if (k?.word === 'rate') t.rates.set(dude.id, k.n);
  else if (k) t.words[k.word].add(dude.id);
  // hook FK-012: the side, never its job, until the release; the other side's word, refused this age, isn't counted for it
  if ((k?.word === 'red' || k?.word === 'gold' || k?.word === 'help') && !joinInGather(state, dude, k.word, now)) t.words[k.word].delete(dude.id);
  if (!queue) return k;
  const newcomer = dude.turns === 0 && (!dude.queuedLine || !!dude.queuedLine.world);
  if (!k && (movesOrBuilds(line) || newcomer)) dude.queuedLine = { text: line.slice(0, LINE_MAX), at: now };
  else if (k && newcomer && !dude.queuedLine) dude.queuedLine = { text: ARRIVED_LINE, at: now, world: true };
  return k;
}

/** What chat has said in this gathering so far: for the prompt tiles (FK-022), the Rally (FK-026), the warn pings (FK-057) and the candles (FK-091). */
export interface GatherTally {
  /** Every line heard in gather mode, keywords included. */
  lines: number;
  /** RATE IT: the average of each voter's latest number, and how many voted. */
  rate?: { avg: number; n: number };
  /** Who said each word (dude ids), first first. */
  words: Record<GatherWord, string[]>;
}

/** This gathering's tally; an empty one when chat isn't in gather mode. */
export function gatherTally(state: DudesState): GatherTally {
  const t = gathering(state) ? memos.get(state)?.tally : undefined;
  const live = t?.key === keyOf(state) ? t : undefined;
  const rates = [...(live?.rates.values() ?? [])];
  return {
    lines: live?.lines ?? 0,
    ...(rates.length ? { rate: { avg: rates.reduce((a, b) => a + b, 0) / rates.length, n: rates.length } } : {}),
    words: Object.fromEntries(GATHER_WORDS.map((w) => [w, [...(live?.words[w] ?? [])]])) as GatherTally['words'],
  };
}

/** Every world tick: once a gathering is over (or another has begun), its tally goes into the log and is dropped. */
export function tickGather(state: DudesState, log: (line: string) => void): void {
  const memo = memos.get(state);
  if (!memo) return;
  for (const t of memo.ended.splice(0)) closeTally(state, t, log);
  const t = memo.tally;
  if (!t || (gathering(state) && t.key === keyOf(state))) return;
  memo.tally = undefined;
  closeTally(state, t, log);
}

/** A gathering's tally, summed up in one log line. */
function closeTally(state: DudesState, t: Tally, log: (line: string) => void): void {
  const rates = [...t.rates.values()];
  const counts = [
    ...(rates.length ? [`RATE IT ${(rates.reduce((a, b) => a + b, 0) / rates.length).toFixed(1)} from ${rates.length}`] : []),
    ...GATHER_WORDS.filter((w) => t.words[w].size).map((w) => `${w} ${t.words[w].size}`),
  ];
  const queued = state.dudes.filter((d) => d.queuedLine).length;
  const what = t.key === 'gather' ? 'the gathering' : `the ${t.key.slice(0, t.key.lastIndexOf(':'))} scene`;
  log(
    `story: gather mode over (${what}): ${t.lines} line${t.lines === 1 ? '' : 's'}, none to an agent` +
      `${counts.length ? `; ${counts.join(', ')}` : ''}${queued ? `; ${queued} queued for ${queued === 1 ? 'its agent' : 'their agents'} after the release` : ''}`,
  );
}

/**
 * The next queued line due to its agent, taken off its chatter: none while chat is in gather mode, nor
 * within REPLAY_GAP_MS of the last one; then the chatter who has waited longest.
 */
export function takeQueued(state: DudesState, now: number): { dude: Dude; text: string; at: number; world?: boolean } | undefined {
  if (gathering(state)) return undefined;
  const memo = memoOf(state);
  if (now < memo.nextReplayAt) return undefined;
  let next: Dude | undefined;
  for (const d of state.dudes) if (d.queuedLine && (!next || d.queuedLine.at < next.queuedLine!.at)) next = d;
  if (!next) return undefined;
  const q = next.queuedLine!;
  next.queuedLine = undefined;
  memo.nextReplayAt = now + REPLAY_GAP_MS;
  return { dude: next, ...q };
}

// ---- The ring (FK-019) ---------------------------------------------------------------------------

/** How a ring is laid out, walked into and let go (bible §4 "The Bell" and §5; motion-budget.md "Release"). */
export const RING = {
  /** The called run to their slots at this many times walking pace. */
  pace: 1.8,
  /** The gathering starts once this share of the crowd is in place, or when the walk is up (LOCK_CAPS.walk, 25 s) … */
  startShare: 0.7,
  /** … but never sooner than this after the Call, so the bell and the banner land first, whoever was standing near. */
  minMs: 8000,
  /** This close to their slot (m) counts as there. */
  thereM: 0.75,
  /** Rows this far apart (m); neighbours this far apart along a row (m), out to this angle either side of the ring's bearing. */
  rowGap: 1.5,
  slotGap: 1.4,
  arc: Math.PI / 3,
  /** Rows past the ring's outer edge, for a crowd too big for it and for latecomers. */
  extraRows: 3,
  /** Away dudes pad a crowd smaller than this: the half of them a party would get (city.ts autonomy), nearest first. */
  padTo: 20,
  /** The release: one at a time, spread over this long, players first (their keys come back). */
  releaseMs: 8000,
  /** A ring with no scene (Story (dev) → Gather) holds until Stop, or this long at most: the head's lock cap (mayor.ts MAYOR.lockMs). */
  holdMs: 5 * 60_000,
  /** At most this many set off in one tick (finding the way is a grid search); the rest a tick later, looking up at the bell meanwhile. */
  routesPerTick: 8,
};

/** Where a ring stands: its centre (everyone faces it), the bearing the crowd stands on from it, and its rows' radii (STORY_SITES.crowd). */
export interface RingSite {
  at: GroundPoint;
  side: number;
  inner: number;
  outer: number;
}
/** A place in a ring: where, the way it faces (the centre), and its bearing off the ring's own. */
export interface RingSlot {
  at: GroundPoint;
  face: number;
  /** Its bearing from the centre, off the ring's own (−π..π): who comes from the left stands on the left. */
  off: number;
}
interface Ring {
  site: RingSite;
  calledAt: number;
  startedAt?: number;
  /** When everyone goes if nothing has let them go before: the scene's walk and lock caps (or holdMs), and the release. */
  until: number;
  /** A town gathering: everyone awake comes, latecomers too. A rally names who (FK-026). */
  everyone: boolean;
  scene?: string;
  vars?: Record<string, string>;
  banner?: { title: string; premise?: string };
  /** Each row's slots, front to back, each row from the middle out. */
  rows: RingSlot[][];
  taken: Set<RingSlot>;
}

/** What a Call asks for. Nothing: the town gathering at the Folly with no scene. */
export interface RingCall {
  site?: RingSite;
  /** Only these (dude ids), in this order: a rally's comers (FK-026). Absent: everyone awake, the padding and latecomers. */
  who?: string[];
  /** The story scene that plays at the start (story/show.ts), and its lines' `{name}`s. */
  scene?: string;
  vars?: Record<string, string>;
  /** The Call's banner (FK-021 draws it): "GATHER: THE UNVEILING" and its few-word premise, up until the start. */
  banner?: { title: string; premise?: string };
}
/** Who a Call sent to the ring, for the log. */
export interface RingCalled {
  called: number;
  away: number;
  gold: number;
  red: number;
}

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const dist = (a: GroundPoint, b: GroundPoint) => Math.hypot(a.x - b.x, a.z - b.z);
const secs = (ms: number) => `${Math.round(ms / 100) / 10} s`;
/** Gold in front, neither side in the middle, red at the back: the split shows in the crowd (bible §6, the Unveiling). */
function tierOf(state: DudesState, d: Dude): number {
  const side = sideNow(state, d);
  return side === 'gold' ? 0 : side === 'red' ? 2 : 1;
}
const isThere = (d: Dude) => !!d.gather && dist(d.position, d.gather.slot) <= RING.thereM;

/** Open ground to stand on: in town, off the river, the fountain and the market, and clear of every build (as the way there, placement.ts route, sees them). */
function standable(state: DudesState, p: GroundPoint): boolean {
  if (!onGround(p, 0.5)) return false;
  const builds = state.objects.filter((o) => o.destroyedAt === undefined && !o.passable).map((o) => footprint(o.position, o.footprint.width, o.footprint.depth));
  return ![...GROUND.water, ...GROUND.blocks, ...builds].some((r) => contains(inflate(r, 0.5), p));
}

/**
 * Every slot of a ring, row by row from the front, each row from the middle out; odd rows sit half a
 * place over, so nobody stands straight behind anyone. Slots on a build, in the river or off the
 * ground are left out (a build that went up in the park before Story was on, say).
 */
export function ringRows(state: DudesState, site: RingSite): RingSlot[][] {
  const rows: RingSlot[][] = [];
  const n = Math.floor((site.outer - site.inner) / RING.rowGap + 1e-9) + 1 + RING.extraRows;
  for (let row = 0; row < n; row++) {
    const r = site.inner + row * RING.rowGap;
    const step = RING.slotGap / r;
    const half = (row % 2) / 2; // odd rows: half a place over, no one in the middle
    const offs = half ? [] : [0];
    for (let i = 1; (i - half) * step <= RING.arc + 1e-9; i++) offs.push((i - half) * step, -(i - half) * step);
    rows.push(
      offs.flatMap((off) => {
        const b = site.side + off;
        const at = { x: site.at.x + Math.sin(b) * r, z: site.at.z + Math.cos(b) * r };
        return standable(state, at) ? [{ at, face: Math.atan2(site.at.x - at.x, site.at.z - at.z), off }] : [];
      }),
    );
  }
  return rows;
}

/**
 * Called to the ring: out of whatever they were in, on or at (a visit, the party, a shift, a ride, a
 * bit, a build they were using; a player's ride is parked where it stands), on their feet, and off to
 * `slot` (sim.ts runGather walks them). A build of theirs going up waits for them (runGather's release).
 */
function summon(state: DudesState, d: Dude, slot: RingSlot, until: number, now: number): void {
  endUse(state, d, now);
  leaveVisit(d);
  const ride = d.riding && state.objects.find((o) => o.id === d.riding);
  if (ride) {
    if (!ride.creature) setAltitude(ride, 0);
    parkObject(state, ride, d.name);
  }
  Object.assign(d, { path: [], walkingFor: undefined, emote: undefined, riding: undefined, y: undefined, hidden: undefined });
  Object.assign(d, { bit: undefined, explore: undefined, follow: undefined, meet: undefined, greet: undefined, lookAt: undefined, attack: undefined });
  d.gather = { slot: { ...slot.at }, face: slot.face, until };
}

/** Out of sight where they are, and into their slot in a puff: a straggler at the start, a latecomer after it (bible §4). */
function appear(state: DudesState, d: Dude, now: number): void {
  const g = d.gather!;
  if (dist(d.position, g.slot) > 2) addEffect(state, { kind: 'burst', at: now, to: { ...d.position }, label: 'smoke' });
  Object.assign(d, { position: { ...g.slot }, facing: g.face, path: [], walkingFor: undefined });
  addEffect(state, { kind: 'burst', at: now, to: { ...g.slot }, label: 'smoke' });
}

/** One row's worth of the crowd into its free slots: by bearing, so who comes from the left stands on the left and few paths cross. */
function seat(state: DudesState, ring: Ring, group: Dude[], open: RingSlot[], now: number): void {
  const off = (p: GroundPoint) => wrap(Math.atan2(p.x - ring.site.at.x, p.z - ring.site.at.z) - ring.site.side);
  const slots = [...open].sort((a, b) => a.off - b.off);
  [...group]
    .sort((a, b) => off(a.position) - off(b.position))
    .forEach((d, i) => {
      ring.taken.add(slots[i]);
      summon(state, d, slots[i], ring.until, now);
    });
}

/** A latecomer's slot: the first free one in the back row in use, or behind it. Undefined once the ring is full. */
function backSlot(ring: Ring): RingSlot | undefined {
  let back = 0;
  ring.rows.forEach((r, i) => r.some((s) => ring.taken.has(s)) && (back = i));
  for (const row of ring.rows.slice(back)) for (const s of row) if (!ring.taken.has(s)) return s;
  return undefined;
}

/**
 * The Call (bible §4): every awake dude (or a rally's `who`) gets a slot in the ring and sets off for it
 * at a run; on a thin night away dudes pad the crowd. Each tier starts a fresh row: gold, then neither
 * side, then red; within a tier the nearest stand at the front and the padding at the back. Says why
 * not, and changes nothing, while Story is off, while another ring holds its crowd, or for a scene this
 * build doesn't know; the last few of a ring being let go are let go at once. Putting the head on his
 * mark is the caller's (mayor.ts prepareHead), and so is any check on a scene already playing.
 */
export function callRing(state: DudesState, now: number, call: RingCall = {}): RingCalled | string {
  if (!storyOn(state)) return 'Story is off';
  const memo = memoOf(state);
  if (memo.ring && !memo.releasing) return 'Everyone is gathered already: Stop it first';
  const scene = call.scene === undefined ? undefined : storyScene(call.scene);
  if (call.scene !== undefined && !scene) return `No story scene called "${call.scene.slice(0, 40)}"`;
  for (const d of state.dudes) d.gather = undefined;
  memo.releasing = false;
  const site = call.site ?? STORY_SITES.crowd;
  const ring: Ring = {
    site: { at: { ...site.at }, side: site.side, inner: site.inner, outer: site.outer },
    calledAt: now,
    until: now + (scene ? LOCK_CAPS.walk + lockCapOf(scene) : RING.holdMs) + RING.releaseMs,
    everyone: !call.who,
    ...(call.scene ? { scene: call.scene } : {}),
    ...(call.vars ? { vars: { ...call.vars } } : {}),
    ...(call.banner ? { banner: { ...call.banner } } : {}),
    rows: ringRows(state, site),
    taken: new Set(),
  };
  memo.ring = ring;
  const near = (a: Dude, b: Dude) => dist(a.position, site.at) - dist(b.position, site.at);
  const named = call.who?.map((id) => state.dudes.find((d) => d.id === id)).filter((d): d is Dude => !!d);
  const up = named ?? state.dudes.filter((d) => awake(d, now)).sort(near);
  // The party's half of the sleepers within reach (a different half each time), so the square fills on a quiet night.
  const pad = named
    ? []
    : state.dudes
        .filter((d) => !awake(d, now) && hashOf(`${d.id}:${now}`) % 2 === 0 && dist(d.position, site.at) < TOWN.reach)
        .sort(near)
        .slice(0, Math.max(0, RING.padTo - up.length));
  const tiers: Dude[][] = [[], [], []];
  for (const d of [...up, ...pad]) tiers[tierOf(state, d)].push(d);
  let row = 0;
  for (const tier of tiers)
    for (let i = 0; i < tier.length && row < ring.rows.length; row++) {
      const open = ring.rows[row].slice(0, tier.length - i);
      seat(state, ring, tier.slice(i, i + open.length), open, now);
      i += open.length;
    }
  const held = state.dudes.filter((d) => d.gather);
  return {
    called: held.length,
    away: pad.filter((d) => d.gather).length,
    gold: held.filter((d) => tierOf(state, d) === 0).length,
    red: held.filter((d) => tierOf(state, d) === 2).length,
  };
}

/**
 * Every world tick while Story is on: latecomers to the back; the start, once 70% are there (after
 * RING.minMs) or the walk is up: stragglers appear at their slots and the Call's scene plays; a ring
 * with no scene let go at its hold cap; and the ring forgotten once its last dude has gone.
 */
export function tickRing(state: DudesState, now: number, log: (line: string) => void): void {
  const memo = memos.get(state);
  if (memo?.releasing) {
    if (!state.dudes.some((d) => d.gather)) [memo.releasing, memo.ring] = [false, undefined];
    return;
  }
  const ring = memo?.ring;
  if (!ring) return;
  const started = ring.startedAt !== undefined;
  // A new chatter, someone back from away, a player just logged in: to the back, walking or (once it has started) there.
  if (ring.everyone)
    for (const d of state.dudes) {
      if (d.gather || !awake(d, now)) continue;
      const slot = backSlot(ring);
      if (!slot) break;
      ring.taken.add(slot);
      summon(state, d, slot, ring.until, now);
      if (started) appear(state, d, now);
    }
  const held = state.dudes.filter((d) => d.gather);
  if (!started) {
    const since = now - ring.calledAt;
    const there = held.filter(isThere).length;
    if (since < LOCK_CAPS.walk && (since < RING.minMs || there < RING.startShare * held.length)) return;
    ring.startedAt = now;
    for (const d of held) if (!isThere(d)) appear(state, d, now);
    log(`story: the gathering starts ${secs(since)} after the Call: ${there} of ${held.length} walked in${held.length > there ? `, ${held.length - there} appeared in their places` : ''}`);
    const why = ring.scene ? playShow(state, ring.scene, now, ring.vars) : undefined;
    if (!why) return;
    log(`story: the gathering's ${ring.scene} scene couldn't start (${why}): everyone is let go`);
    releaseRing(state, now);
    return;
  }
  // Its scene's end lets a ring go (show.ts); a ring whose scene went some other way, or one with none held its longest, lets go here.
  if (ring.scene ? state.city?.story?.scene?.id === ring.scene : now - ring.calledAt < RING.holdMs) return;
  const n = releaseRing(state, now);
  log(`story: the gathering ${ring.scene ? `lost its ${ring.scene} scene` : `held its longest (${secs(RING.holdMs)})`}: letting ${n} go`);
}

/**
 * The release (bible §4): everyone in the ring is let go one at a time over RING.releaseMs, players
 * first (their keys come back), the rest in no set order, so the crowd thins out rather than moving off
 * as one block. Gather mode ends now. Returns how many it let go.
 */
export function releaseRing(state: DudesState, now: number): number {
  const memo = memoOf(state);
  const held = state.dudes.filter((d) => d.gather);
  memo.releasing = held.length > 0;
  if (!held.length) memo.ring = undefined;
  const order = held.sort((a, b) => Number(isPiloted(b.id)) - Number(isPiloted(a.id)) || hashOf(`${a.id}:${now}`) - hashOf(`${b.id}:${now}`));
  order.forEach((d, i) => (d.gather!.until = Math.min(d.gather!.until, now + Math.round((i / order.length) * RING.releaseMs))));
  return held.length;
}

/** The crowd is being let go: sim.ts runGather lets anyone given something else to do go at once. */
export const releasing = (state: DudesState): boolean => !!memos.get(state)?.releasing;

/** Forget the ring at once: the panic exit, Stop, Story OFF and every boot (show.ts releaseShow clears each dude's `gather`). */
export function dropRing(state: DudesState): void {
  const memo = memos.get(state);
  if (memo) [memo.ring, memo.releasing] = [undefined, false];
}

/** The ring on the page while it holds its crowd: where it is and whether it has started (FK-134's walk shot), and the Call's banner until then (FK-021). */
export function ringView(state: DudesState): Partial<TownView> {
  const memo = memos.get(state);
  const ring = memo?.ring;
  if (!ring || memo.releasing) return {};
  const started = ring.startedAt !== undefined;
  return {
    ring: { at: { ...ring.site.at }, ...(started ? { started: true as const } : {}) },
    ...(!started && ring.banner ? { show: { banner: { ...ring.banner, until: ring.calledAt + LOCK_CAPS.walk } } } : {}),
  };
}

/** A dude in a ring, on the page: their slot and the way they face there (the /play page follows the walk; FK-167's patter counts the walkers). */
export const gatherView = (d: Dude): Partial<DudeView> => (d.gather ? { gather: { slot: { ...d.gather.slot }, face: d.gather.face } } : {});
