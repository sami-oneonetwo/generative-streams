// The Town Crier: the town's voice in Kick chat. It keeps a tally of deeds done for the age's
// caravan (builds of the sort asked for, travellers fed, shifts worked, parties, community
// projects) and says so at the beats chat cares about: a caravan arriving, an ask met, a new name
// at the top, the age turning. Chatters can ask for the board with !top, the caravan's list with
// !town, and their own place with !me. Now and then it also picks out someone's build and says a
// word about it. In sandbox mode (the caravan switched off) it never mentions the caravan: no
// deeds, and !top / !me are about builds instead. Lines wait in `out` for the world's tick to post them, so
// nothing here needs the engine. Zero AI; every line is a template, so nothing is said that
// wasn't written here.
import { ageStyle, venueName } from '../../shared/ages';
import { plotAt } from '../../shared/city';
import type { SafehouseObject } from '../../shared/objectTypes';
import { awake } from './sim';
import { cityOf, namingAge, tell } from './city';
import { caravanOf, type Caravan } from './caravan';
import type { DudesState } from './state';
import { config } from '../../config';

export interface Crier {
  age: number;
  /** Deeds this age, by dude id. */
  tally: Record<string, number>;
  /** Deeds this visit, by dude id: who gets thanked when it is done. */
  visit: Record<string, number>;
  /** Builds already counted this visit (object ids). */
  builds: string[];
  /** Who was on top when the crier last said so, and when. */
  leader?: string;
  leaderAt?: number;
  /** The last "still waiting" line, and the last deed anyone did. */
  nudgeAt?: number;
  deedAt?: number;
  /** Builds picked out lately (ids, newest last), and when the next one is due. */
  spot?: string[];
  spotAt?: number;
  /** Lines waiting to go out to chat, oldest first. */
  out: string[];
}

export const CRIER = {
  /** What each deed is worth. */
  deed: { build: 5, serve: 2, operate: 2, party: 4, project: 5, bridge: 4 },
  /** A new leader is announced at most this often, and only once they have this many. */
  leaderMs: 6 * 60_000,
  leaderMin: 10,
  /** A visit open this long with no deed in the last while gets a reminder. */
  nudgeMs: 12 * 60_000,
  /** Chat commands: once per chatter this often, and one answer for everyone this often. */
  askMs: 60_000,
  answerMs: 8_000,
  outMax: 6,
  /** A build picked out every this-many minutes or so (random within the range), while someone's about. */
  spotMs: [9 * 60_000, 18 * 60_000] as const,
};

const pick = <T>(xs: readonly T[], seed: number): T => xs[Math.abs(seed) % xs.length];

export function crierOf(state: DudesState): Crier {
  const city = cityOf(state);
  const age = city.age ?? 0;
  if (!city.crier || city.crier.age !== age) {
    const was = city.crier;
    city.crier = { age, tally: {}, visit: {}, builds: [], out: was?.out ?? [], ...(was?.spot ? { spot: was.spot } : {}), ...(was?.spotAt ? { spotAt: was.spotAt } : {}) };
  }
  return city.crier;
}

function say(state: DudesState, line: string): void {
  const c = crierOf(state);
  c.out.push(line.slice(0, 480));
  if (c.out.length > CRIER.outMax) c.out.shift();
}

/** A line of the world's own (sandbox on or off). */
export function crierSays(state: DudesState, line: string): void {
  say(state, line);
}

/** Lines ready for chat; the world's tick posts them. */
export function takeCrierLines(state: DudesState): string[] {
  const c = cityOf(state).crier;
  if (!c?.out.length) return [];
  const lines = c.out;
  c.out = [];
  return lines;
}

const nameOf = (state: DudesState, id: string) => state.dudes.find((d) => d.id === id)?.name;
/** The age's top names on the board so far (for the age-turn scene and the finale's roll call). */
export const ageHeroes = (state: DudesState, n = 3): string[] => ranked(state, crierOf(state).tally).slice(0, n).map(([id]) => nameOf(state, id)!);
const tag = (state: DudesState, id: string) => `@${nameOf(state, id) ?? '?'}`;

function ranked(state: DudesState, table: Record<string, number>): [string, number][] {
  return Object.entries(table)
    .filter(([id, n]) => n > 0 && nameOf(state, id))
    .sort((a, b) => b[1] - a[1]);
}
const podium = (state: DudesState, rows: [string, number][], n = 3) => rows.slice(0, n).map(([id, pts]) => `${tag(state, id)} (${pts})`);
const ord = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th')}`;
const list = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`);

/** Someone did something the caravan asked for (or helped finish a community project). */
export function credit(state: DudesState, id: string | undefined, kind: keyof typeof CRIER.deed, now: number, extra = 0): void {
  if (!id || state.ai.caravan === false || !state.dudes.some((d) => d.id === id)) return;
  const c = crierOf(state);
  const pts = CRIER.deed[kind] + extra;
  c.tally[id] = (c.tally[id] ?? 0) + pts;
  c.visit[id] = (c.visit[id] ?? 0) + pts;
  c.deedAt = now;
  const top = ranked(state, c.tally)[0];
  if (!top || top[0] === c.leader || top[1] < CRIER.leaderMin) return;
  if (c.leaderAt && now - c.leaderAt < CRIER.leaderMs) return;
  const age = ageStyle(c.age).name;
  const was = c.leader && nameOf(state, c.leader) ? tag(state, c.leader) : undefined;
  const me = tag(state, top[0]);
  say(
    state,
    was
      ? pick(
          [
            `New name at the top of ${age}: ${me}, on ${top[1]} deeds. ${was}, that spot was yours a minute ago.`,
            `${me} has overtaken ${was} and leads ${age} with ${top[1]} deeds. !top for the board.`,
            `The board has turned over. ${me} leads with ${top[1]}. ${was} is not going to like this.`,
          ],
          top[1] + now,
        )
      : pick(
          [
            `First real name on the board for ${age}: ${me}, with ${top[1]} deeds. Everyone else, !town to see what's wanted.`,
            `${me} leads ${age} with ${top[1]} deeds. It's early. !top for the board.`,
          ],
          top[1] + now,
        ),
  );
  c.leader = top[0];
  c.leaderAt = now;
}

/** Whose places count towards a build ask this visit, credited once each. */
export function creditBuilds(state: DudesState, ids: { id: string; owner?: string }[], now: number): void {
  const c = crierOf(state);
  for (const o of ids) {
    if (c.builds.includes(o.id)) continue;
    c.builds.push(o.id);
    if (c.builds.length > 40) c.builds.shift();
    credit(state, o.owner, 'build', now);
  }
}

// ---- the beats ---------------------------------------------------------------------------------
/** A visit has opened (the first one is the caravan arriving). */
export function crierVisitOpened(state: DudesState, cv: Caravan, now: number): void {
  const c = crierOf(state);
  c.visit = {};
  c.builds = [];
  c.nudgeAt = now;
  const k = caravanOf(cv.age);
  const age = ageStyle(cv.age).name;
  const lines =
    cv.visit === 0
      ? [
          `Hear ye. ${cap(k.name)} have made camp across the river, and ${k.leader} wants feeding. Build places to eat and serve them. Every deed is written down. !town for the list, !top for the board.`,
          `${k.leader} of ${k.name} is at the river with an empty stomach and a long memory. Feed them. Whoever helps most gets named here. !town for what's wanted.`,
          `${cap(ageStyle(cv.age).name)} begins. ${cap(k.name)} are camped across the river and hungry. Tell your character to build somewhere to eat and feed them. !town for the list.`,
        ]
      : cv.visit === 1
        ? [
            `${k.leader} is back. ${k.specialist} wants a ${venueName(cv.age, 'workshop')}, some shifts worked in it, and a party to say welcome. The board is open: !top.`,
            `Next for ${k.name}: a ${venueName(cv.age, 'workshop')} for ${k.specialist}, hands to work it, and a welcome party. Deeds count. !town for the list.`,
          ]
        : [
            `The last ask of ${age}: ${k.wonder}, in the middle of the square, built together. ${k.leader} has drawn it up. Chip in and lend a hand. The age's top name gets a laurel on their tag.`,
            `${k.leader} wants ${k.wonder} in the middle of the square. Tell your character to chip in and help build it, and the town moves on from ${age}. Whoever tops the board gets the laurel. !top`,
          ];
  say(state, pick(lines, now));
}

/** Every ask of a visit is met. */
export function crierVisitDone(state: DudesState, cv: Caravan, now: number): void {
  if (cv.visit >= 2) return; // the age turning says it instead
  const c = crierOf(state);
  const k = caravanOf(cv.age);
  const rows = ranked(state, c.visit);
  if (!rows.length) {
    say(state, `${k.leader} is satisfied. Nobody in particular gets the credit, which is its own kind of teamwork. More asks shortly.`);
    return;
  }
  const [first, ...rest] = podium(state, rows);
  const others = rest.length ? ` ${pick(['Also', 'With help from', 'Not forgetting'], now)} ${list(rest)}.` : '';
  const done = cv.visit === 0 ? `${cap(k.name)} are fed` : `${k.specialist} has settled in`;
  say(
    state,
    pick(
      [
        `${done}. Mostly thanks to ${first}.${others} Next ask in a moment.`,
        `${done}, and ${k.leader} will remember ${first}. So will I.${others}`,
        `${done}. The ledger says ${first} did the heavy lifting.${others} !top for the age so far.`,
      ],
      now,
    ),
  );
}

/** The opening has played: the band is stuck across the river and the bridge wants mending. */
export function crierBridgeOpened(state: DudesState, cv: Caravan, need: number, now: number): void {
  const c = crierOf(state);
  c.visit = {};
  c.builds = [];
  c.nudgeAt = now;
  const k = caravanOf(cv.age);
  const hands = need === 1 ? 'One pair of hands' : `${need} pairs of hands`;
  say(
    state,
    pick(
      [
        `Hear ye. ${k.leader} and his people are stuck across the river, a little girl among them. The bridge is gone. ${hands} will mend it: tell your character to help at the bridge. !town for the list.`,
        `There are travellers at the river and no way over. ${k.leader} asked for help. ${hands} at the bridge and they can cross. Names go in the ledger.`,
      ],
      now,
    ),
  );
}
/** The bridge is mended and the travellers cross: who did it. */
export function crierBridgeDone(state: DudesState, cv: Caravan, now: number): void {
  const c = crierOf(state);
  const k = caravanOf(cv.age);
  const who = (cv.helpers ?? []).filter((id) => nameOf(state, id)).map((id) => tag(state, id));
  say(state, who.length ? `The bridge is mended. ${list(who)} did it, and ${k.name} are crossing into town. ${k.leader} will have more to ask shortly.` : `The bridge is mended and ${k.name} are crossing into town. ${k.leader} will have more to ask shortly.`);
  c.visit = {};
}

/** The Wonder is done: the age's results, its hero's laurel, and a fresh board. */
export function crierAgeTurned(state: DudesState, from: number, now: number, final = false): void {
  const c = crierOf(state);
  const k = caravanOf(from);
  const rows = ranked(state, c.tally);
  const was = ageStyle(from).name;
  const hero = rows[0];
  if (hero) {
    const d = state.dudes.find((x) => x.id === hero[0]);
    if (d) {
      (d.badges ??= []).push({ kind: `hero:${from}`, at: now });
      if (d.badges.length > 500) d.badges.shift();
      tell(state, d, `the Town Crier named you hero of ${was} in Kick chat: ${hero[1]} deeds, and a laurel on your name tag`, now, true);
    }
  }
  const runners = podium(state, rows.slice(1), 2);
  const tail = runners.length ? ` Runners-up: ${list(runners)}.` : '';
  if (final) {
    say(state, hero ? `${cap(k.wonder)} has launched. The journey is over. Hero of ${was}: ${tag(state, hero[0])}, ${hero[1]} deeds.${tail} Thank you all. The town will remember, at least until the reset.` : `${cap(k.wonder)} has launched. The journey is over. Thank you all.`);
    return;
  }
  const next = ageStyle(from + 1).name;
  say(
    state,
    hero
      ? pick(
          [
            `${cap(k.wonder)} stands. ${cap(was)} is over and ${next} begins. Hero of the age: ${tag(state, hero[0])}, ${hero[1]} deeds, laurel on the tag.${tail} The board is wiped. Anyone can top the next one.`,
            `That's ${was} done. ${tag(state, hero[0])} carried it with ${hero[1]} deeds and gets the laurel.${tail} ${cap(next)} starts with an empty board.`,
          ],
          now,
        )
      : `${cap(k.wonder)} stands, and ${next} begins. Nobody's name on the board this time. It's empty again; make it yours.`,
  );
  // The new age's tally starts empty (crierOf resets it on the age change); queued lines carry over.
}

/** Every tick: a reminder when a visit has sat with nothing done for a while. */
export function tickCrier(state: DudesState, cv: Caravan | undefined, now: number): void {
  if (!cv?.asks.length || cv.nextAt) return;
  const c = crierOf(state);
  const quiet = Math.max(c.nudgeAt ?? 0, c.deedAt ?? 0, cv.openedAt);
  if (now - quiet < CRIER.nudgeMs) return;
  c.nudgeAt = now;
  const left = cv.asks.filter((a) => a.have < a.need);
  if (!left.length) return;
  const k = caravanOf(cv.age);
  const mins = Math.round((now - Math.max(c.deedAt ?? cv.openedAt, cv.openedAt)) / 60_000);
  const what = left.map((a) => `${short(a.label)} (${a.have}/${a.need})`).join('; ');
  say(
    state,
    pick(
      [
        `${k.leader} is still waiting: ${what}. Nobody has lifted a finger in ${mins} minutes. The top spot is right there.`,
        `Still wanted by ${k.name}: ${what}. Tell your character to do it and your name goes in the ledger.`,
        `${k.leader} has started tapping a foot. Wanted: ${what}.`,
      ],
      now,
    ),
  );
}

// ---- chat commands -----------------------------------------------------------------------------
/** Who asked what when, per world, and answers waiting for the gap (not saved: a restart forgets them). */
const cooldowns = new WeakMap<DudesState, { asked: Map<string, number>; answeredAt: number; pending: string[] }>();

const COMMAND = /^!(top|board|leaders|town|caravan|me|rank|help|commands|play|walk)\b/i;
/** A command the crier answers (anything else starting with "!" is for some other bot). */
export const isCrierCommand = (text: string) => COMMAND.test(text.trim());

/** Where chatters walk their own character, without the scheme. */
const playSite = () => config.PLAY_URL.replace(/^https?:\/\//, '').replace(/\/$/, '');

/**
 * `!top`, `!town`, `!me`, `!help`, `!play`: handled (the character doesn't hear it) and, when the
 * crier is free, the answer to post. Inside the gap between answers the answer waits and goes out
 * with the others in one line (`tickCrierAnswers`), rather than being dropped.
 */
export function crierCommand(state: DudesState, dudeId: string, text: string, now: number): { handled: boolean; line?: string } {
  const m = COMMAND.exec(text.trim());
  if (!m) return { handled: false };
  const cmd = m[1].toLowerCase();
  const key = `${dudeId}:${cmd}`;
  let cd = cooldowns.get(state);
  if (!cd) cooldowns.set(state, (cd = { asked: new Map(), answeredAt: -Infinity, pending: [] }));
  if (now - (cd.asked.get(key) ?? -Infinity) < CRIER.askMs) return { handled: true };
  cd.asked.set(key, now);
  if (cd.asked.size > 500) cd.asked.clear();
  const line = commandAnswer(state, cmd, dudeId);
  if (!line) return { handled: true };
  if (now - cd.answeredAt < CRIER.answerMs || cd.pending.length) {
    if (!cd.pending.includes(line)) cd.pending.push(line);
    if (cd.pending.length > 12) cd.pending.shift();
    return { handled: true };
  }
  cd.answeredAt = now;
  return { handled: true, line };
}

/** Every tick: answers that waited out the gap go out together, as many as fit in one chat line. */
export function tickCrierAnswers(state: DudesState, now: number): void {
  const cd = cooldowns.get(state);
  if (!cd?.pending.length || now - cd.answeredAt < CRIER.answerMs) return;
  let line = cd.pending.shift()!;
  while (cd.pending.length && line.length + 3 + cd.pending[0].length <= 480) line += ` · ${cd.pending.shift()!}`;
  cd.answeredAt = now;
  say(state, line);
}

function commandAnswer(state: DudesState, cmd: string, dudeId: string): string | undefined {
  const me = state.dudes.find((d) => d.id === dudeId);
  if (cmd === 'help' || cmd === 'commands')
    return `Say anything in chat and your character moves in and does it: build, visit, work, help the travellers. !town what's wanted, !top the board, !me how you're doing, !play walk your own character.`;
  if (cmd === 'play' || cmd === 'walk') return `${me ? `@${me.name} w` : 'W'}alk your own character round town: ${playSite()} (log in with Kick; a few seats at a time).`;
  const c = crierOf(state);
  const age = ageStyle(c.age).name;
  const rows = ranked(state, c.tally);
  const cv = cityOf(state).caravan;
  if (state.ai.caravan === false) return sandboxAnswer(state, cmd, dudeId);
  if (cmd === 'town' || cmd === 'caravan') {
    if (!cv || cv.visit > 2) return `No caravan at the river right now. The journey's done; the board stands.`;
    const k = caravanOf(cv.age);
    if (cv.nextAt || !cv.asks.length) return `${k.leader} is thinking about what to ask for next. Hold on.`;
    return `${k.leader} of ${k.name} wants: ${cv.asks.map((a) => `${short(a.label)} (${a.have}/${a.need})`).join('; ')}. Visit ${cv.visit + 1} of 3 in ${age}. Tell your character to do it.`;
  }
  if (cmd === 'me' || cmd === 'rank') {
    const at = rows.findIndex(([id]) => id === dudeId);
    if (!me) return undefined;
    if (at < 0) return `@${me.name} no deeds yet in ${age}. !town for what's wanted.`;
    if (at === 0) return `@${me.name} you lead ${age} with ${rows[0][1]} deeds.${rows[1] ? ` ${tag(state, rows[1][0])} is ${rows[0][1] - rows[1][1]} behind.` : ''}`;
    return `@${me.name} you're ${ord(at + 1)} in ${age} with ${rows[at][1]} deeds, ${rows[0][1] - rows[at][1]} behind ${tag(state, rows[0][0])}.`;
  }
  if (!rows.length) return `Nobody has done anything for the caravan yet in ${age}. First deed takes the top spot. !town for how.`;
  return `${cap(age)} so far: ${rows.slice(0, 5).map(([id, n], i) => `${i + 1}. ${tag(state, id)} ${n}`).join(', ')}.${richAndBusy(state)} Deeds come from helping the caravan: !town`;
}

/** " Richest: Sara §420. Busiest: The Bun Oven (12 visits)." for the board (names without @, so nobody is pinged). */
function richAndBusy(state: DudesState): string {
  const rich = [...state.dudes].sort((a, b) => (b.coins ?? 0) - (a.coins ?? 0))[0];
  const stats = cityOf(state).stats;
  const busy = state.objects
    .filter((o) => o.owner && !o.civic && (stats[o.id]?.visits ?? 0) > 0)
    .sort((a, b) => (stats[b.id]?.visits ?? 0) - (stats[a.id]?.visits ?? 0))[0];
  return `${rich && (rich.coins ?? 0) > 0 ? ` Richest: ${rich.name} §${rich.coins}.` : ''}${busy ? ` Busiest: ${busy.blueprint.name} (${stats[busy.id].visits} visits).` : ''}`;
}

// ---- sandbox: about builds, not deeds ------------------------------------------------------------
/** Builds chatters made (not the Mayor's, not the town's), standing. */
const chatterBuilds = (state: DudesState) => state.objects.filter((o) => o.owner && !o.civic && !o.destroyedAt && state.dudes.some((d) => d.id === o.owner));
const visitsOf = (state: DudesState, o: SafehouseObject) => cityOf(state).stats[o.id]?.visits ?? 0;

function sandboxAnswer(state: DudesState, cmd: string, dudeId: string): string | undefined {
  const builds = chatterBuilds(state);
  if (cmd === 'town' || cmd === 'caravan') return `Free build right now: no asks, no rules. Tell your character what to make and it goes up. !top for the busiest places in town.`;
  if (cmd === 'me' || cmd === 'rank') {
    const me = state.dudes.find((d) => d.id === dudeId);
    if (!me) return undefined;
    const mine = builds.filter((o) => o.owner === dudeId).sort((a, b) => visitsOf(state, b) - visitsOf(state, a));
    if (!mine.length) return `@${me.name} nothing of yours in town yet. Tell your character what to build.`;
    const best = mine[0];
    return `@${me.name} you have ${mine.length} build${mine.length === 1 ? '' : 's'} in town.${visitsOf(state, best) ? ` The busiest is ${best.blueprint.name}, ${visitsOf(state, best)} visits.` : ` Nobody's been inside any of them yet.`}`;
  }
  const busy = builds.filter((o) => visitsOf(state, o) > 0).sort((a, b) => visitsOf(state, b) - visitsOf(state, a)).slice(0, 4);
  if (!busy.length) return builds.length ? `${builds.length} builds in town and not one visitor between them. Somebody go somewhere.` : `Nothing built yet. The first build in town is anyone's.`;
  return `Busiest places in town: ${busy.map((o, i) => `${i + 1}. ${o.blueprint.name} by ${tag(state, o.owner!)} (${visitsOf(state, o)})`).join(', ')}.`;
}

/** Every tick: now and then, a word about someone's build. */
export function tickSpotlight(state: DudesState, now: number, rng: () => number): void {
  const c = crierOf(state);
  const [lo, hi] = CRIER.spotMs;
  if (!c.spotAt) c.spotAt = now + lo + rng() * (hi - lo);
  if (now < c.spotAt) return;
  c.spotAt = now + lo + rng() * (hi - lo);
  if (!state.dudes.some((d) => awake(d, now))) return;
  const recent = new Set(c.spot ?? []);
  const pool = chatterBuilds(state).filter((o) => !recent.has(o.id));
  if (!pool.length) return;
  // Newer builds and ones people actually use come up more often, but anything can.
  const weight = (o: SafehouseObject) => 1 + Math.min(4, visitsOf(state, o) / 5) + (now - o.createdAt < 30 * 60_000 ? 3 : 0);
  let roll = rng() * pool.reduce((n, o) => n + weight(o), 0);
  const o = pool.find((x) => (roll -= weight(x)) <= 0) ?? pool[0];
  c.spot = [...(c.spot ?? []), o.id].slice(-8);
  say(state, spotlight(state, o, now, Math.floor(rng() * 1000)));
}

function spotlight(state: DudesState, o: SafehouseObject, now: number, seed: number): string {
  const who = tag(state, o.owner!);
  const name = o.blueprint.name;
  const where = plotAt(o.position)?.address;
  const on = where ? ` on ${where}` : '';
  const visits = visitsOf(state, o);
  const kind = o.venue && o.venue !== 'decor' ? venueName(namingAge(state), o.venue) : undefined;
  const age = Math.round((now - o.createdAt) / 3_600_000);
  const tail = kind
    ? visits
      ? pick([`${visits} visits and counting.`, `${visits} people have been through the door.`, `Popular, too: ${visits} visits.`], seed)
      : pick([`Nobody's been in yet. Be the first.`, `Zero visitors so far. Somebody fix that.`, `Still waiting on its first customer.`], seed)
    : pick([`It doesn't do anything. It doesn't have to.`, `Go and have a look.`, `The town is better for it, probably.`, `Worth the walk.`], seed);
  return pick(
    [
      `Spotted${on}: ${name}, by ${who}. ${tail}`,
      `A word for ${name}, ${who}'s ${kind ?? 'handiwork'}${on}. ${tail}`,
      `If you're passing${on || ' by'}, look up: ${name}. ${who} built that. ${tail}`,
      `Today's pick from around town: ${name} by ${who}.${age >= 2 ? ` Standing ${age} hours now.` : ''} ${tail}`,
      `The crier's eye falls on ${name}${on}. Credit to ${who}. ${tail}`,
    ],
    seed + o.id.length,
  );
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
/** An ask's label without its parenthetical how-to ("(propose it as a community project)"). */
const short = (label: string) => label.replace(/\s*\([^)]*\)\s*$/, '').replace(/^./, (ch) => ch.toLowerCase());
