// Chat verbs: builds unlock bang commands. `!shoot` exists while a basketball hoop stands,
// `!honk` while a car does, `!dance` while speakers play; `!verbs` (or `!help`) says which are
// on. The chatter's own figure on the pavement does the thing (crowd.ts errands): jogs to the
// hoop and takes the shot, dances on the kerb. A verb never spends Rook's time or a model call,
// and every one has a cooldown so a busy chat cannot turn the yard into a fairground. Nothing is
// accepted while a wave is on. Zero AI.
import type { Use, VerbView, HoopsRow, VerbWord } from '../../shared/safehouseTypes';
import { VERB_WORDS, isCreatureVerb } from '../../shared/safehouseTypes';
import { intact } from './combat';
import { addEffect, nearestWithUse, nearestWithVerb, startShoot, startVerb, verbKind, waveOn } from './crowd';
import { noteVerb } from './neighbours';
import type { SafehouseState } from './state';

export type Verb = 'shoot' | 'honk' | 'dance';
/** A piece's own verb (PieceVerb): any word in the dictionary that is not a built-in. */
export const GENERIC_COOLDOWN_MS = 30_000;
/** The moving verbs take longer and move more, so a chatter waits longer between goes. */
export const WORD_COOLDOWN_MS: Partial<Record<VerbWord, number>> = { drive: 60_000, ride: 45_000, fight: 60_000 };
const BUILT_IN = new Set(['shoot', 'honk', 'dance', 'verbs', 'help', 'delete']);
export const isGenericWord = (word: string): word is VerbWord => (VERB_WORDS as readonly string[]).includes(word) && !BUILT_IN.has(word);
export interface VerbSpec {
  verb: Verb;
  use: Use; // the piece that unlocks it
  needs: string; // for the HUD hint and the refusal: "a basketball hoop"
  build: string; // what to tell chat to build
  cooldownMs: number; // per chatter
}
export const VERBS: readonly VerbSpec[] = [
  { verb: 'shoot', use: 'hoop', needs: 'a basketball hoop', build: 'a basketball hoop', cooldownMs: 45_000 },
  { verb: 'honk', use: 'vehicle', needs: 'a car or a van', build: 'a car', cooldownMs: 30_000 },
  { verb: 'dance', use: 'music', needs: 'speakers', build: 'speakers', cooldownMs: 20_000 },
];
/** A vehicle sounds its horn at most this often; a horn scatters birds this far; a `!dance` lasts this long. */
export const HONK_GAP_MS = 8_000,
  HONK_SCARE_M = 12,
  DANCE_MS = 8_000,
  /** The scoreboard shows chatters who shot within this long. */
  BOARD_WINDOW_MS = 30 * 60_000,
  BOARD_ROWS = 5;

type World = SafehouseState;
const key = (username: string) => username.trim().toLowerCase();

// Cooldowns and horn gates are not worth a save; a restart forgives them.
const cooldowns = new Map<string, Map<string, number>>(); // chatter → verb word → until
const honkedAt = new Map<string, number>(); // vehicle id → when
let firstShotAnnounced = false;
export function resetVerbMemory(): void {
  cooldowns.clear();
  honkedAt.clear();
  firstShotAnnounced = false;
}

export type ParsedVerb =
  | { verb: Verb | 'verbs'; rest: string; generic?: false }
  | { verb: VerbWord; rest: string; generic: true };
/**
 * `!shoot`, `!honk`, `!dance`, `!verbs` / `!help`, or any word from the dictionary a piece may carry
 * (`!swim`, `!bounce`) — with whatever follows. Anything else is not a verb and goes on to the request
 * path (only `!delete` is a command elsewhere).
 */
export function parseVerb(text: string): ParsedVerb | undefined {
  const m = /^\s*!([a-z]+)\b\s*([\s\S]*)$/i.exec(text);
  if (!m) return undefined;
  const word = m[1].toLowerCase(),
    rest = m[2].trim();
  if (word === 'help' || word === 'verbs') return { verb: 'verbs', rest };
  if (word === 'shoot' || word === 'honk' || word === 'dance') return { verb: word, rest };
  if (isGenericWord(word)) return { verb: word, rest, generic: true };
  return undefined;
}

const standing = (w: { objects: SafehouseState['objects'] }, use: Use) =>
  w.objects.filter((o) => intact(o) && !o.creature && o.uses?.includes(use));
/** The pieces that carry verbs, one entry per distinct word (the first by name), for the listing. */
export function standingVerbs(w: { objects: SafehouseState['objects'] }): { word: VerbWord; piece: SafehouseState['objects'][number] }[] {
  const out = new Map<VerbWord, SafehouseState['objects'][number]>();
  for (const o of [...w.objects].sort((a, b) => a.blueprint.name.localeCompare(b.blueprint.name))) {
    if (!intact(o) || !o.verb || !isGenericWord(o.verb.word) || (o.creature && !isCreatureVerb(o.verb.word))) continue;
    if (!out.has(o.verb.word)) out.set(o.verb.word, o);
  }
  return [...out.entries()].map(([word, piece]) => ({ word, piece }));
}

/** Every verb and whether a piece that unlocks it stands, for the HUD hint: the built-ins, then any piece's own verb that stands. */
export function verbViews(w: { objects: SafehouseState['objects'] }): VerbView[] {
  return [
    ...VERBS.map((v) => ({ verb: `!${v.verb}`, needs: v.needs, unlocked: standing(w, v.use).length > 0 })),
    ...standingVerbs(w).map(({ word, piece }) => ({ verb: `!${word}`, needs: piece.blueprint.name, unlocked: true })),
  ];
}

/** The hoops scoreboard: best shooters first (hits, then fewer shots), only chatters who shot lately. */
export function hoopsBoard(w: { scores?: SafehouseState['scores'] }, now: number): HoopsRow[] {
  return Object.entries(w.scores ?? {})
    .filter(([, s]) => now - s.lastAt <= BOARD_WINDOW_MS)
    .sort(([, a], [, b]) => b.hits - a.hits || a.shots - b.shots || b.lastAt - a.lastAt)
    .slice(0, BOARD_ROWS)
    .map(([user, s]) => ({ user, hits: s.hits, shots: s.shots, streak: s.streak }));
}

/** What `!verbs` says: the unlocked ones with the piece behind each, and what would unlock the rest. */
export function describeVerbs(w: World, from?: { x: number; z: number }): string {
  const on: string[] = [],
    off: string[] = [];
  for (const v of VERBS) {
    const pieces = standing(w, v.use);
    if (!pieces.length) {
      off.push(`${v.build} for !${v.verb}`);
      continue;
    }
    const piece = from ? nearestWithUse(w, from, v.use as 'hoop' | 'vehicle' | 'music') ?? pieces[0] : pieces[0];
    on.push(`!${v.verb} (${piece.blueprint.name})`);
  }
  // A piece's own verb: the nearest piece with that word, or the first by name.
  for (const { word, piece } of standingVerbs(w)) {
    const nearest = from ? nearestWithVerb(w, from, word) ?? piece : piece;
    on.push(`!${word} (${nearest.blueprint.name})`);
  }
  const unlocked = on.length ? `Unlocked: ${on.join(', ')}.` : 'Nothing unlocked yet.';
  const locked = off.length ? ` Build ${off.join(', ')}.` : '';
  return `${unlocked}${locked}`.slice(0, 240);
}

export interface VerbResult {
  reply?: string; // a plain status line for chat
  event?: 'first-shot' | 'honk' | 'dance' | 'verb';
  objectId?: string;
  word?: VerbWord; // a piece's own verb
}
/** What a piece with this verb is, for a refusal: "something to swim in". */
const somethingTo = (word: VerbWord) => {
  const at: Partial<Record<VerbWord, string>> = { swim: 'swim in', sit: 'sit on', lie: 'lie on', sleep: 'sleep on', nap: 'nap on', bounce: 'bounce on', jump: 'jump on', climb: 'climb', ring: 'ring', slide: 'slide down', swing: 'swing on', drive: 'drive', ride: 'ride', fight: 'fight' };
  return `something to ${at[word] ?? `${word} at`}`;
};
/**
 * Run a verb for a chatter. Mutates the state (an errand, a horn effect, a dance) and says what to
 * tell chat. The message has already put the chatter on the pavement (`receiveMessage`); if not,
 * they are added here so the figure exists to do the thing.
 */
export function runVerb(
  w: World,
  msg: { userId: string; username: string; text: string },
  now: number,
  rng: () => number,
): VerbResult {
  const parsed = parseVerb(msg.text);
  if (!parsed) return {};
  const user = key(msg.username);
  if (parsed.verb === 'verbs') {
    const me = w.crowd?.find((m) => m.id === msg.userId);
    return { reply: describeVerbs(w, me?.position) };
  }
  const mine = cooldowns.get(user) ?? new Map<string, number>();
  // The figure that does it.
  const stand = () => {
    const crowd = (w.crowd ??= []);
    let me = crowd.find((m) => m.id === msg.userId);
    if (!me) {
      // Not on the pavement (a message that skipped receiveMessage): stand them up first.
      const slot = [...Array(crowd.length + 1).keys()].find((s) => !crowd.some((m) => m.slot === s))!;
      me = { id: msg.userId, name: msg.username.trim().slice(0, 40), since: now, lastAt: now, slot, position: { x: 0, z: 14.6 }, facing: Math.PI };
      crowd.push(me);
    }
    return me;
  };
  if (parsed.generic) {
    // A piece's own verb: the nearest standing piece with that word; the figure jogs there and does it.
    const word = parsed.verb;
    const me0 = w.crowd?.find((m) => m.id === msg.userId);
    const piece = nearestWithVerb(w, me0?.position ?? { x: 0, z: 14.6 }, word);
    if (!piece) return { reply: `!${word} needs ${somethingTo(word)} standing. Build one.` };
    if (waveOn(w)) return { reply: `!${word} can wait till the wave's done.` };
    if ((mine.get(word) ?? 0) > now) return { reply: `Give it a moment, ${msg.username}.` };
    const me = stand();
    const outcome = startVerb(w, me.id, word, now);
    if (outcome === 'no-piece') return { reply: `!${word} needs ${somethingTo(word)} standing. Build one.` };
    if (outcome === 'busy') return { reply: `You're already on your way, ${msg.username}.` };
    if (outcome === 'queue-full') return { reply: `${piece.blueprint.name} has a queue. Give it a minute, ${msg.username}.` };
    if (outcome === 'no-route')
      return {
        // A run needs a way out to the road and clear road to drive; the rest need a way to the piece.
        reply:
          verbKind(piece, word) === 'run'
            ? `${piece.blueprint.name} is boxed in. Nowhere to drive it right now, ${msg.username}.`
            : `No way through to ${piece.blueprint.name} right now, ${msg.username}.`,
      };
    mine.set(word, now + (WORD_COOLDOWN_MS[word] ?? GENERIC_COOLDOWN_MS));
    cooldowns.set(user, mine);
    const name = piece.blueprint.name.replace(/^(the|a|an)\s+/i, '');
    const kind = verbKind(piece, word);
    return {
      reply:
        outcome === 'queued'
          ? `${msg.username} is next ${kind === 'hold' ? 'at' : 'for'} the ${name.toLowerCase()}.`
          : kind === 'run'
            ? `${msg.username} is taking the ${name.toLowerCase()} for a spin.`
            : kind === 'scrap'
              ? `${msg.username} is squaring up to the ${name.toLowerCase()}.`
              : `${msg.username} is off to the ${name.toLowerCase()}.`,
      event: 'verb',
      word,
      objectId: piece.id,
    };
  }
  const spec = VERBS.find((v) => v.verb === parsed.verb)!;
  if (!standing(w, spec.use).length) return { reply: `!${spec.verb} needs ${spec.needs} standing. Build one.` };
  if (waveOn(w)) return { reply: `!${spec.verb} can wait till the wave's done.` };
  if ((mine.get(spec.verb) ?? 0) > now) return { reply: `Give it a moment, ${msg.username}.` };
  const me = stand();
  const arm = () => {
    mine.set(spec.verb, now + spec.cooldownMs);
    cooldowns.set(user, mine);
  };
  if (spec.verb === 'shoot') {
    const outcome = startShoot(w, msg.userId, now);
    if (outcome === 'no-hoop') return { reply: `!shoot needs ${spec.needs} standing. Build one.` };
    if (outcome === 'busy') return { reply: `You're already on your way, ${msg.username}.` };
    if (outcome === 'queue-full') return { reply: `The hoop has a queue. Give it a minute, ${msg.username}.` };
    if (outcome === 'no-route') return { reply: `No way through to the hoop right now, ${msg.username}.` };
    arm();
    const first = !firstShotAnnounced && !Object.keys(w.scores ?? {}).length;
    if (first) firstShotAnnounced = true;
    const hoop = nearestWithUse(w, me.position, 'hoop');
    return {
      // A plain line so chat sees the figure was sent: the shot itself lands a few seconds later on the page.
      reply: outcome === 'queued' ? `${msg.username} is next at the hoop.` : `${msg.username} is off to ${hoop?.blueprint.name ?? 'the hoop'}.`,
      event: first ? 'first-shot' : undefined,
      objectId: me.errand?.targetId ?? hoop?.id,
    };
  }
  if (spec.verb === 'honk') {
    const car = nearestWithUse(w, me.position, 'vehicle');
    if (!car) return { reply: `!honk needs ${spec.needs} standing. Build one.` };
    if ((honkedAt.get(car.id) ?? 0) > now - HONK_GAP_MS) return { reply: `${car.blueprint.name} is still ringing, ${msg.username}.` };
    honkedAt.set(car.id, now);
    arm();
    addEffect(w, { kind: 'honk', objectId: car.id, user, at: now });
    // The birds take off.
    for (const o of w.objects) {
      if (!o.wild || !o.creature?.flying || !intact(o)) continue;
      if (Math.hypot(o.position.x - car.position.x, o.position.z - car.position.z) > HONK_SCARE_M) continue;
      o.creature.scaredMs = 8_000;
      o.creature.goal = undefined;
      o.creature.path = [];
      o.creature.replanMs = 0;
    }
    noteVerb(w, 'honk', user, car.id, {}, now);
    return { event: 'honk', objectId: car.id };
  }
  // dance
  arm();
  me.dancingUntil = now + DANCE_MS;
  const speakers = nearestWithUse(w, me.position, 'music');
  noteVerb(w, 'dance', user, speakers?.id, {}, now);
  return { event: 'dance', objectId: speakers?.id };
}
