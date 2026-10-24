// Characters talking to each other, and something to talk about when chat is quiet. Zero AI here:
// this only decides who gets a nudge (their agent answers on a turn of its own, against the same
// allowance as every other turn) and what the nudge says.
//
// A line that names someone near (or is said to the one person right in front of you) nudges them to
// answer; their answer goes back the same way, and a back-and-forth stops after a few lines so two
// agents can't talk the allowance away between themselves. Nothing here is saved: a restart just
// starts every conversation fresh.
import type { GroundPoint } from '../../shared/objectTypes';
import { VENUES } from '../../shared/city';
import { bestPlaceFor, cityOf, coinsOf, feelings, needsOf, placesOf, projectOf, recentVisits, warmth } from './city';
import { nudge } from './state';
import { awake } from './sim';
import { isPiloted } from './players';
import type { Dude, DudesState } from './state';

export const TALK = {
  /** Only someone this close hears themselves spoken to. */
  reach: 10,
  /** Said with no name, to the one person this close and in front of you. */
  faceReach: 3.5,
  /** Lines in one back-and-forth (the opener and the answers) before it is left there. */
  maxExchanges: 3,
  /** A conversation that has gone quiet this long starts over. */
  resetMs: 3 * 60_000,
  /** An answer is owed this long; after that the other has moved on. */
  replyMs: 90_000,
};

const dist = (a: GroundPoint, b: GroundPoint) => Math.hypot(a.x - b.x, a.z - b.z);
const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
/** Lines so far in each pair's back-and-forth (not saved). */
const exchanges = new Map<string, { n: number; at: number }>();
/** Who is owed an answer by whom: `owes.get(b) = a` while b's answer to a is pending. */
const owes = new Map<string, { to: string; at: number }>();

/** Who a line is said to: awake characters near the speaker that it names, or the one right in front of them. */
export function addressed(state: DudesState, speaker: Pick<Dude, 'id' | 'position' | 'facing'>, text: string, now: number, namedOnly = false): Dude[] {
  const near = state.dudes.filter((d) => d.id !== speaker.id && awake(d, now) && !d.muted && !isPiloted(d.id) && dist(d.position, speaker.position) < TALK.reach);
  if (!near.length) return [];
  const words = text.toLowerCase().split(/[\s,.!?:;"()]+/).map((w) => w.replace(/^@/, '').replace(/'s$/, '')).filter((w) => w.length > 2);
  const named = near.filter((d) => {
    const name = d.name.toLowerCase();
    const first = name.split(/[\s_]+/)[0];
    return words.some((w) => w === name || w === first || (w.length >= 4 && name.startsWith(w)));
  });
  if (named.length || namedOnly) return named.slice(0, 2);
  // Nobody named: the one person right there, in front of the speaker.
  const fx = Math.sin(speaker.facing),
    fz = Math.cos(speaker.facing);
  const facing = near.filter((d) => {
    const m = dist(d.position, speaker.position);
    if (m > TALK.faceReach) return false;
    return ((d.position.x - speaker.position.x) * fx + (d.position.z - speaker.position.z) * fz) / (m || 1) > 0.5;
  });
  return facing.length === 1 ? facing : [];
}

/**
 * Something a character said out loud: whoever it was said to is nudged to answer, unless the two
 * have already gone back and forth enough. An answer owed to the speaker counts as said to them
 * (they need not use the name). Returns who was nudged.
 */
export function spokeTo(state: DudesState, speaker: Dude, text: string, now: number, namedOnly = false): Dude[] {
  if (state.ai.idleLife === false) return [];
  const targets = addressed(state, speaker, text, now, namedOnly);
  const owed = owes.get(speaker.id);
  owes.delete(speaker.id);
  if (owed && now - owed.at < TALK.replyMs) {
    const back = state.dudes.find((d) => d.id === owed.to);
    if (back && !targets.includes(back) && awake(back, now) && !back.muted && !isPiloted(back.id) && dist(back.position, speaker.position) < TALK.reach * 1.5) targets.unshift(back);
  }
  const told: Dude[] = [];
  for (const d of targets.slice(0, 2)) {
    const key = pairKey(speaker.id, d.id);
    let x = exchanges.get(key);
    if (!x || now - x.at > TALK.resetMs) x = { n: 0, at: now };
    x.n++;
    x.at = now;
    exchanges.set(key, x);
    // The opener and the answers so far are the conversation; the last line just gets heard.
    if (x.n >= TALK.maxExchanges) continue;
    const quoted = text.length > 160 ? `${text.slice(0, 157)}...` : text;
    nudge(state, d, `${speaker.name} (${Math.round(dist(d.position, speaker.position))} m away) said to you: "${quoted}". Answer them out loud, in a sentence or two.`, now);
    owes.set(d.id, { to: speaker.id, at: now });
    told.push(d);
  }
  return told;
}

// ---- something to say when it has been quiet --------------------------------------------------------
const pick = <T>(list: T[], rng: () => number): T => list[Math.floor(rng() * list.length) % list.length];

/** What an open caravan ask means a character could do about it on its own (no builds, no fights). */
function askHook(state: DudesState, d: Dude, now: number): string | undefined {
  const cv = cityOf(state).caravan;
  if (!cv || cv.nextAt || !cv.asks?.length) return undefined;
  const open = cv.asks.filter((a) => a.have < a.need);
  for (const a of open) {
    if (a.kind === 'bridge') return `The travellers are still stuck at the river (${a.have}/${a.need} shifts on the bridge). You could go and help mend it ("help").`;
    if (a.kind === 'operate') {
      const where = placesOf(state).filter((p) => p.kind !== 'town' && a.venues?.includes(p.kind as never)).sort((x, y) => dist(x.at, d.position) - dist(y.at, d.position))[0];
      if (where) return `The travellers still need: ${a.label} (${a.have}/${a.need}). You could work a shift at ${where.name} ("work").`;
    }
    if (a.kind === 'project') {
      const p = projectOf(state);
      if (p?.status === 'gathering') return `The travellers are waiting on ${p.name ?? 'the community project'} (§${p.coins}/${p.coinsNeed}, ${Math.round((p.work / p.workNeed) * 100)}% built). You could help build it ("help"), or chip in a few coins.`;
    }
  }
  const a = open[0];
  return a && now - cv.openedAt > 60_000 ? `The travellers' leader is still asking: ${a.label} (${a.have}/${a.need}). Say what you make of it, or nudge a neighbour about it.` : undefined;
}

/**
 * A concrete hook for an idle turn: something new next door, a rival place doing well, an open
 * ask, a need, someone nearby to talk to. Falls back to the old line when the town has nothing.
 */
export function idleHook(state: DudesState, d: Dude, now: number, rng: () => number): string {
  const hooks: string[] = [];
  const ask = askHook(state, d, now);
  if (ask) hooks.push(ask, ask);
  const p = projectOf(state);
  if (p?.status === 'gathering' && !p.contributors[d.id]) hooks.push(`The town is building ${p.name ?? 'something'} on the square and you have not helped yet (§${p.coins}/${p.coinsNeed}, ${Math.round((p.work / p.workNeed) * 100)}% built). Help build it, or chip in a few coins.`);
  // Something new nearby, by someone else.
  const fresh = state.objects
    .filter((o) => o.owner && o.owner !== d.id && !o.civic && !o.silhouette && now - o.createdAt < 20 * 60_000 && dist(o.position, d.position) < 45)
    .sort((a, b) => b.createdAt - a.createdAt)[0];
  if (fresh) hooks.push(`${fresh.createdBy} just put up ${fresh.blueprint.name}, ${Math.round(dist(fresh.position, d.position))} m from you. Go and have a look, and tell them what you think.`);
  // A rival: somebody else's place of the same sort as one of yours, doing better.
  const mine = state.objects.filter((o) => o.owner === d.id && o.venue && o.venue !== 'decor' && o.venue !== 'home');
  for (const o of mine) {
    const rival = placesOf(state).find((x) => x.owner && x.owner !== d.id && x.kind === o.venue && recentVisits(state, x.id, now) > recentVisits(state, o.id, now));
    if (rival) {
      hooks.push(`${rival.ownerName}'s ${rival.name} is the same sort of place as your ${o.blueprint.name}, and it has had more visitors lately (${recentVisits(state, rival.id, now)} to your ${recentVisits(state, o.id, now)}). Go and see what they do, or say something about it.`);
      break;
    }
  }
  // A need running low: where they would go for it.
  const needs = needsOf(d);
  const low = (Object.keys(needs) as (keyof typeof needs)[]).sort((a, b) => needs[a] - needs[b])[0];
  if (needs[low] < 50) {
    const where = bestPlaceFor(state, { id: d.id, position: d.position, coins: coinsOf(d) }, low, now, rng, d);
    hooks.push(`You are feeling ${feelings(d)}.${where ? ` ${where.name}${where.ownerName ? ` (${where.ownerName}'s)` : ''} would sort that out.` : ''}`);
  }
  // Somebody near to talk to: a friend first.
  const near = state.dudes.filter((o) => o.id !== d.id && awake(o, now) && !o.hidden && dist(o.position, d.position) < 15).sort((a, b) => warmth(d, b.id) - warmth(d, a.id));
  if (near.length) {
    const o = near[0];
    const why = warmth(d, o.id) >= 3 ? 'you get on well' : o.title ? `the ${o.title}` : 'you have not talked much';
    hooks.push(`${o.name} is ${Math.round(dist(o.position, d.position))} m away (${why}). Say something to them, by name.`);
  }
  // What the town is short of, now and then.
  const kinds = new Set(state.objects.map((o) => o.venue).filter(Boolean));
  const missing = (Object.keys(VENUES) as (keyof typeof VENUES)[]).filter((k) => k !== 'decor' && k !== 'home' && k !== 'apartments' && !kinds.has(k));
  if (missing.length && rng() < 0.3) hooks.push(`Nobody in town has a ${VENUES[pick(missing, rng)].label} yet. Say what you make of that.`);
  return hooks.length ? pick(hooks, rng) : 'It has been quiet for a bit.';
}

/** Forget every conversation (tests). */
export function resetTalk(): void {
  exchanges.clear();
  owes.clear();
}
