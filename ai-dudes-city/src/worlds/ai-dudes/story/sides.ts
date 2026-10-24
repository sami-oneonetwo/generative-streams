// Red and gold (FK-012): chat's core choice, one word and no AI call. With Story on, `red`, `gold` and
// `help` count only as the whole message (trimmed, any case, trailing `!`s): hear() asks hearSide()
// before anything goes to the agent (a newcomer's first line too: the newcomer branch only stops emotes
// and `!` commands, then comes through dudeFor to the same check). So "make my house gold" stays a
// build line and "help me build a hut" an agent line. Not in crierCommand: that only takes `!` words.
// - A side word sets `dude.side` and `dude.sideAge`, puts it on the ticker (`city.story.sideLog`: "Kev
//   joined red", or "Kev crossed to gold" when last age's side was the other) and starts the side's
//   job. The same word again just does the job again.
// - One pick per age: the other side's word in the same age is refused through the crier ("You're red
//   this age, @kev."), and nothing changes. The Defection Window (FK-092) opens it up.
// - `help` works your side's job. A neutral's goes to Wren's and joins red (bible §4: neutral help
//   routes to Wren); last age's side picks itself up again.
// - Red's job: a shift on the bridge while its ask is open (one per chatter, city.ts startLabour), else a
//   walk to Wren's site sign (STORY_SITES.redSign). Gold's: the name goes on the Folly's plaque (folly.ts
//   carves gold's names every tick once the cordon is up) and a walk to the cordon. No gold shifts in
//   stream 1: the Folly fills on its timer only (bible §9; FK-096 in Bronze).
// The chatter's agent only reads what happened, in its history. Zero AI.
import type { WorldCtx } from '../../../engine/world';
import type { DudeView } from '../../../shared/dudesTypes';
import type { GroundPoint } from '../../../shared/objectTypes';
import { STORY_SITES } from '../../../shared/storyMap';
import { hashOf } from '../agent';
import { bridgeOpen } from '../caravan';
import { ageOf, cityOf, headName, leaveVisit, startLabour } from '../city';
import { knockedOut } from '../combat';
import { crierReply } from '../crier';
import { clampToGround } from '../placement';
import { isPiloted } from '../players';
import { endUse, isActive, sendDude } from '../sim';
import { LIMITS, STORY_CAPS, pushLine, storyOn, type Dude, type DudesState, type Side } from '../state';
import { CAST } from './cast';
import { FOLLIES } from './folly';

export const SIDES = {
  /** At the sign or the cordon this long before going about again (as the agent's `move` stays). */
  stayMs: 45_000,
  /** Red stands this far from Wren's sign, on the town side of it, spread by chatter. */
  signRing: [2.2, 4.6] as const,
  /** Gold stands this far out from the Folly's plot, along its front. */
  cordonOut: 1.2,
};

/** The three words, as `sideWord` reads them. */
export type SideWord = Side | 'help';
const WORD = /^(red|gold|help)!*$/i;

/** The side word a line is, if the whole line is one: "red", "GOLD!", " help " yes; "make my house gold" no. */
export function sideWord(text: string): SideWord | undefined {
  const m = WORD.exec(text.trim());
  return m ? (m[1].toLowerCase() as SideWord) : undefined;
}

/** The side a chatter is on this age, if any: one taken in an earlier age doesn't count, as on the Folly's
 * plaque (story/folly.ts carve). The Board's tally (FK-011) counts by it. */
export function sideNow(state: DudesState, d: Dude): Side | undefined {
  if (!d.side) return undefined;
  const age = ageOf(state);
  return (d.sideAge ?? age) === age ? d.side : undefined;
}

/**
 * hear()'s fast path, before the agent: true when the line was a side word and is dealt with (the
 * side, its job, or the crier's "You're red this age"), false to carry on as today. Story off: always false.
 */
export function hearSide(state: DudesState, d: Dude, text: string, now: number): boolean {
  if (!storyOn(state)) return false;
  const word = sideWord(text);
  if (!word) return false;
  const was = sideNow(state, d);
  const side: Side = word === 'help' ? (was ?? d.side ?? 'red') : word;
  const refused = takeSide(state, d, side, now);
  if (refused) crierReply(state, d.id, 'side', refused, now);
  else sideJob(state, d, side, now, !was);
  return true;
}

/**
 * Onto a side for this age (the Rally's "us" too, FK-026), logged for the ticker; nothing if they're on it
 * already. Or, when they took the other one this age, the crier's line saying so, and nothing changes.
 */
export function takeSide(state: DudesState, d: Dude, side: Side, now: number): string | undefined {
  const was = sideNow(state, d);
  if (was && was !== side) return `You're ${was} this age, @${d.name}.`;
  setSide(state, d, side, now);
  return undefined;
}

/** On `side` this age, on the ticker unless they already were: "joined", or "crossed to" from last age's other side. */
function setSide(state: DudesState, d: Dude, side: Side, now: number): void {
  // (A side with no age, from before the age was kept, counts as this age's: now it says so.)
  if (sideNow(state, d) === side) return void (d.sideAge ??= ageOf(state));
  const from = d.side && d.side !== side ? d.side : undefined;
  d.side = side;
  d.sideAge = ageOf(state);
  logSide(state, d, side, now, from);
}

function logSide(state: DudesState, d: Dude, side: Side, now: number, from?: Side): void {
  const log = ((cityOf(state).story ??= {}).sideLog ??= []);
  log.push({ at: now, id: d.id.slice(0, 80), name: d.name.slice(0, 40), side, ...(from ? { from } : {}) });
  if (log.length > STORY_CAPS.sideLog) log.splice(0, log.length - STORY_CAPS.sideLog);
}

/**
 * The side's job, at once (`joined`: they took the side with this line). Not for a body someone else has
 * (a player walking it on /play, a gathering holding it, flat on its back), and a build under way comes
 * first. Its agent is told what happened, in its history: no turn.
 */
export function sideJob(state: DudesState, d: Dude, side: Side, now: number, joined = false): void {
  const tell = (what?: string) => {
    const took = joined ? `you joined ${side}, ${whose(state, side)} side` : '';
    const text = took && what ? `${took}, and ${what}` : took || (what ? `you ${what}` : '');
    if (text && d.history.at(-1)?.text !== text) pushLine(d.history, { from: 'world', text, at: now }, LIMITS.history);
  };
  if (isPiloted(d.id) || d.gather || knockedOut(d, now)) return tell();
  if (side === 'red' && d.labour?.site === 'bridge') return tell();
  if (side === 'red' && bridgeOpen(state) && !(cityOf(state).caravan?.helpers ?? []).includes(d.id) && !startLabour(state, d, now))
    return tell('set off to help mend the bridge for the travellers');
  if (state.jobs.some((j) => j.dudeId === d.id && isActive(j) && j.status !== 'queued' && j.status !== 'designing')) return tell('carry on with your build first');
  const { spot, look } = side === 'red' ? signSpot(d) : cordonSpot(d);
  // Whatever small errand they were on gives way, as for the agent's own `move`.
  leaveVisit(d);
  endUse(state, d, now);
  Object.assign(d, { follow: undefined, explore: undefined, meet: undefined, bit: undefined, greet: undefined, lookAt: undefined, emote: undefined });
  if (!sendDude(state, d, spot)) return tell();
  // A last step of a few centimetres towards it, so they stop facing it.
  const end = d.path.at(-1) ?? d.position;
  const dist = Math.hypot(look.x - end.x, look.z - end.z);
  if (dist > 0.1) d.path.push({ x: end.x + ((look.x - end.x) / dist) * 0.05, z: end.z + ((look.z - end.z) / dist) * 0.05 });
  d.idleUntil = now + SIDES.stayMs;
  const folly = (FOLLIES[ageOf(state)] ?? FOLLIES[0]).name;
  tell(side === 'red' ? `went over to ${CAST.wren.name}'s sign by the bridge` : `went over to the cordon round ${folly} (your name goes on its plaque)`);
}

/** "Wren's" or "the Chief's". */
const whose = (state: DudesState, side: Side) => `${side === 'red' ? CAST.wren.name : headName(state).replace(/^The /, 'the ')}'s`;

/** A chatter's own place by Wren's sign: a half ring on the town side of it, steady per chatter. */
function signSpot(d: Dude): { spot: GroundPoint; look: GroundPoint } {
  const at = STORY_SITES.redSign.at;
  const h = hashOf(`side:${d.id}`);
  const a = Math.PI / 2 + ((h % 997) / 997) * Math.PI;
  const r = SIDES.signRing[0] + (((h >>> 10) % 100) / 100) * (SIDES.signRing[1] - SIDES.signRing[0]);
  return { spot: clampToGround({ x: at.x + Math.cos(a) * r, z: at.z + Math.sin(a) * r }, 1), look: at };
}

/** A chatter's own place along the cordon's front (the crowd's side of the Folly), steady per chatter. */
function cordonSpot(d: Dude): { spot: GroundPoint; look: GroundPoint } {
  const s = STORY_SITES.folly;
  const front = { x: Math.sin(s.facing), z: Math.cos(s.facing) };
  const along = { x: front.z, z: -front.x };
  const out = s.size / 2 + SIDES.cordonOut;
  const off = (((hashOf(`side:${d.id}`) % 997) / 997) * 2 - 1) * (s.size / 2 - 1);
  return { spot: clampToGround({ x: s.at.x + front.x * out + along.x * off, z: s.at.z + front.z * out + along.z * off }, 1), look: { ...s.at } };
}

/** A chatter's side on the page (`side`: the disc under them and the tag's crown or flag), this age's only. */
export function sidesView(state: DudesState, d: Dude, _now: number): Partial<DudeView> {
  const side = sideNow(state, d);
  return side ? { side } : {};
}

// ---- Story (dev) ------------------------------------------------------------------------------------
type Run = (ctx: WorldCtx<DudesState>, value?: number | string) => void | string;
/** Story (dev) → Set side: "name red|gold|none". Sets it outright (no one-per-age limit, no job) and puts it on the ticker. */
export const SIDES_DEV: Record<'side-set', Run> = {
  'side-set': (ctx, value) => {
    const m = /^\s*@?(.+?)\s+(red|gold|none)\s*$/i.exec(String(value ?? ''));
    if (!m) return 'A name and red, gold or none ("kev red")';
    const want = m[1].toLowerCase();
    const d = ctx.state.dudes.find((x) => x.name.toLowerCase() === want) ?? ctx.state.dudes.find((x) => x.name.toLowerCase().startsWith(want));
    if (!d) return `There is no chatter called "${m[1]}"`;
    const side = m[2].toLowerCase();
    if (side === 'none') {
      d.side = undefined;
      d.sideAge = undefined;
    } else setSide(ctx.state, d, side as Side, ctx.now);
    ctx.log(`story: ${d.name} is ${side === 'none' ? 'on no side' : side} (admin, Story (dev))`);
  },
};
