// The sounds' fingerprints (FK-160), what Sami approves on /sounds and the tests hold the sound to. A
// fingerprint is the record of everything a sound asks of Web Audio, made on the fake (fake.ts) with a
// seeded random and a still clock, so it comes out the same every time, hashed with sha-256: the blips'
// record is FK-157's (voiceRecord.ts), each cue's is made here. The page and the tests run this same
// code, so the hash the board shows and sends with Approve is the one scripts/audio-cues.test.ts and
// scripts/audio-voice.test.ts check client/dudes/audio-approved.json against. And the renders that the
// board keeps at Approve, for its A/B: each plays its sound from the fingerprint's own seed.
import { CUES, createAudio, type AudioHandles, type AudioLevels, type Cue } from '../dudes/audio';
import { VOICE, type Item } from '../../src/shared/audioApproved';
import { LISTEN, VOICES, isBed, placeAt, type Distance } from './board';
import { FakeNode, FakeOfflineContext, FakeParam, seeded, type Ev } from './fake';
import { LEVELS, nameChain, rows, voiceRecord, type Rig } from './voiceRecord';

// --- sha-256 ---

// The page can't use crypto.subtle: a browser keeps it for secure pages, and 4600 is plain http on an
// IP. So sha-256 by hand (FIPS 180-4); the tests check it against node:crypto.
const K = Uint32Array.of(
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
);
const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));
/** The sha-256 of `text` (as UTF-8), in lower-case hex. */
export function sha256(text: string): string {
  const bytes = new TextEncoder().encode(text);
  const n = bytes.length;
  // The message, a 1 bit, zeros, and its length in bits, in 512-bit blocks of big-endian words.
  const words = new Uint32Array(((n + 8) >> 6) * 16 + 16);
  for (let i = 0; i < n; i++) words[i >> 2] |= bytes[i] << (24 - (i & 3) * 8);
  words[n >> 2] |= 0x80 << (24 - (n & 3) * 8);
  words[words.length - 2] = Math.floor(n / 0x20000000);
  words[words.length - 1] = n * 8;
  const h = Uint32Array.of(0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19);
  const w = new Uint32Array(64);
  for (let at = 0; at < words.length; at += 16) {
    for (let i = 0; i < 64; i++) {
      if (i < 16) w[i] = words[at + i];
      else {
        const x = w[i - 15],
          y = w[i - 2];
        w[i] = w[i - 16] + (rotr(x, 7) ^ rotr(x, 18) ^ (x >>> 3)) + w[i - 7] + (rotr(y, 17) ^ rotr(y, 19) ^ (y >>> 10));
      }
    }
    let [a, b, c, d, e, f, g, k] = h;
    for (let i = 0; i < 64; i++) {
      const t1 = (k + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) | 0;
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
      k = g;
      g = f;
      f = e;
      e = (d + t1) | 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) | 0;
    }
    h[0] += a;
    h[1] += b;
    h[2] += c;
    h[3] += d;
    h[4] += e;
    h[5] += f;
    h[6] += g;
    h[7] += k;
  }
  return [...h].map((x) => x.toString(16).padStart(8, '0')).join('');
}

/** A record's fingerprint: the sha-256 of its JSON (scripts/audio-voice.test.ts hashes the blips' the same way with node:crypto). */
export const printOf = (record: unknown) => sha256(JSON.stringify(record));

/** A record as JSON with a row a line, so two of them diff well. */
export function lined(x: unknown, pad = ''): string {
  if (x === null || typeof x !== 'object' || (Array.isArray(x) && !x.some((v) => v !== null && typeof v === 'object'))) return JSON.stringify(x);
  const inner = `${pad} `;
  const items = Array.isArray(x) ? x.map((v) => inner + lined(v, inner)) : Object.entries(x).map(([k, v]) => `${inner}${JSON.stringify(k)}: ${lined(v, inner)}`);
  const [open, shut] = Array.isArray(x) ? '[]' : '{}';
  return `${open}\n${items.join(',\n')}\n${pad}${shut}`;
}

// --- the cues ---

/** The seed every cue's fingerprint, and every render the board keeps, plays from. */
export const PRINT_SEED = 160;
/** The page's clock in a fingerprint, in ms: past every throttle's first rest (the bray's is 6 s from 0). */
const PRINT_MS = 10_000;
/**
 * Seconds in, when a cue plays: the buses glide from 1 to their levels in their first second
 * (AudioOptions.ctx), so a render plays nothing before; and a fingerprint plays its cue then too, as
 * a moment into a running clock is what the stream's sound always is (the tune's first bar lands
 * 0.1 s after it: from 0 it would land at 0).
 */
export const SETTLE = 2;

/**
 * createAudio() as a fingerprint hears it: on the fake, at the stream's levels, from PRINT_SEED, the
 * camera where the board's looks, the page's clock still and the audio clock SETTLE seconds in.
 */
function stage(): Rig {
  const ctx = new FakeOfflineContext();
  const audio = createAudio(true, LEVELS, { ctx: ctx as unknown as OfflineAudioContext, rand: seeded(PRINT_SEED), now: () => PRINT_MS });
  const setup = ctx.log.slice();
  const names = nameChain(ctx, audio, LEVELS);
  // The rest by where they lead (the engines' drone is 'gain>sfx', the fountain's bed 'gain>ambience#2'),
  // so a node added somewhere else in the town renames nothing a cue goes through.
  const taken = new Set(names.values());
  const pathName = (n: FakeNode): string => {
    const known = names.get(n);
    if (known) return known;
    const base = n.out[0] ? `${n.kind}>${pathName(n.out[0])}` : n.kind;
    let name = base;
    for (let i = 2; taken.has(name); i++) name = `${base}#${i}`;
    names.set(n, name);
    taken.add(name);
    return name;
  };
  ctx.nodes.forEach(pathName);
  audio.listen(LISTEN.x, LISTEN.z, LISTEN.half);
  ctx.currentTime = SETTLE;
  return { audio, ctx, names, setup, ms: PRINT_MS };
}

type Samples = { numberOfChannels: number; length: number; getChannelData(c: number): Float32Array };
const digests = new WeakMap<Samples, string>();
/**
 * What a node's buffer holds (the reverb's tail, the noise every hiss plays): its samples to six
 * decimals, folded into 32 bits (FNV-1a). The events only say a buffer was set, and these are part of
 * the sound too.
 */
function digest(n: FakeNode): string {
  const b = (n as unknown as { buffer?: Samples | null }).buffer;
  if (!b) return 'none';
  let d = digests.get(b);
  if (!d) {
    let h = 0x811c9dc5;
    for (let c = 0; c < b.numberOfChannels; c++) {
      const data = b.getChannelData(c);
      for (let i = 0; i < data.length; i++) h = Math.imul(h ^ Math.round(data[i] * 1e6), 0x01000193);
    }
    d = `${b.numberOfChannels}×${b.length}:${(h >>> 0).toString(16).padStart(8, '0')}`;
    digests.set(b, d);
  }
  return d;
}
/** Events as the voice record writes them (voiceRecord.ts: rows), with what each buffer set holds. */
const rowsOf = (s: Rig, evs: Ev[], t0: number) => rows(s, evs, t0).map((row, i) => (evs[i].op === 'buffer' ? [row[0], 'buffer', digest(evs[i].node)] : row));

/**
 * The town's own nodes a cue's sound passes through, as createAudio() set them up, node by node (so
 * the order they happen to be made in doesn't matter): the bus and its level, the reverb and its send
 * back, the master, the compressor; for a bed, its source and filter too. The mix every cue sits in.
 */
function chainOf(s: Rig, evs: Ev[]) {
  const town = new Set(s.setup.filter((e) => e.op === 'create').map((e) => e.node));
  const on = new Set<FakeNode>();
  // On the way out from everything the cue makes, sets or plays into; and back up to the source of
  // any node of the town's it sets (a bed's gain: its noise and filter).
  const down = (n: FakeNode) => {
    if (town.has(n) && on.has(n)) return;
    if (town.has(n)) on.add(n);
    n.out.forEach(down);
  };
  const up = (n: FakeNode) => {
    for (const m of town)
      if (m.out.includes(n) && !on.has(m)) {
        on.add(m);
        up(m);
      }
  };
  for (const e of evs) {
    [e.node, e.v instanceof FakeNode ? e.v : e.v instanceof FakeParam ? e.v.node : undefined].forEach((n) => n && down(n));
    if (town.has(e.node)) up(e.node);
  }
  const name = (n: FakeNode) => s.names.get(n)!;
  return Object.fromEntries(
    [...on]
      .map((n): [string, unknown[]] => [name(n), rowsOf(s, s.setup.filter((e) => e.node === n), 0).map((row) => row.slice(1))])
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  );
}

/**
 * A cue's record: what it asks for, played as the stream plays it, from PRINT_SEED with the clock
 * still, and the chain it sounds through. A placed cue plays twice, at the camera and 15 m out, on a
 * fresh town each time, so a change to how it fades is a change too.
 */
export function cueRecord(cue: Cue) {
  const plays = (cue.placed ? (['near', 'mid'] as const) : [undefined]).map((where) => {
    const { s, evs, t0 } = printPlay(cue, where);
    return { where: where ?? 'anywhere', chain: chainOf(s, evs), events: rowsOf(s, evs, t0) };
  });
  return { cue: cue.name, plays };
}
/** One play of a cue as its fingerprint hears it (at `where`, if it is placed): the town it played in, and what it asked for from `t0`. */
export function printPlay(cue: Cue, where?: Distance) {
  const s = stage();
  const from = s.ctx.log.length,
    t0 = s.ctx.currentTime;
  cue.play(s.audio, where && placeAt(where));
  return { s, evs: s.ctx.log.slice(from), t0 };
}

// --- what Sami approves ---

/** Everything on the board with an Approve: the blips (all ten voices as one), then every cue in CUES. */
export const ITEMS: readonly Item[] = [{ kind: 'voice', name: VOICE }, ...CUES.map((c): Item => ({ kind: 'cue', name: c.name }))];
const cueOf = (item: Item) => {
  const cue = item.kind === 'cue' ? CUES.find((c) => c.name === item.name) : undefined;
  if (!cue) throw new Error(`no ${item.kind} called ${item.name} on the board`);
  return cue;
};
/** An item's record: the blips' (FK-157's golden) or a cue's. */
export const recordOf = (item: Item): unknown => (item.kind === 'voice' && item.name === VOICE ? voiceRecord() : cueRecord(cueOf(item)));
/** An item's fingerprint, as Approve sends it and the tests check it. */
export const printOfItem = (item: Item) => printOf(recordOf(item));

// --- renders, for the A/B ---

/** The renders' rate: the fake's, so the reverb and noise come out of the seed exactly as in the fingerprint. */
export const RATE = 48_000;
/** The line the voices' render says, each voice in turn (the board's own line). */
export const RENDER_LINE = 'Hello! Welcome to my town!';
/** What a render plays, and when (seconds from its start). */
export interface Plan {
  seconds: number;
  /** The effects always; the music and the ambience only for a sound on them, as the board plays a cue. */
  levels: AudioLevels;
  steps: { at: number; run: (a: AudioHandles) => void }[];
  /** Where the part worth keeping starts: just before the first step. */
  from: number;
}
/**
 * How an item is rendered for the A/B: the blips as the ten voices saying RENDER_LINE 1.2 s apart; a
 * cue as its tile plays it (a placed one at the camera); a bed held for 4 s; the tune's first 24 s
 * (about eight bars) and 20 s of birds.
 */
export function renderPlan(item: Item): Plan {
  const quiet = { music: 0, sfx: LEVELS.sfx, ambience: 0 };
  if (item.kind === 'voice')
    return { seconds: SETTLE + VOICES.length * 1.2 + 1, levels: quiet, steps: VOICES.map((v, i) => ({ at: SETTLE + i * 1.2, run: (a) => a.speech(v.seed, RENDER_LINE, placeAt('near'), v.low) })), from: SETTLE - 0.05 };
  const cue = cueOf(item);
  const levels = { ...quiet, [cue.bus]: LEVELS[cue.bus as keyof AudioLevels] };
  const play = { at: SETTLE, run: (a: AudioHandles) => cue.play(a, cue.placed ? placeAt('near') : undefined) };
  if (isBed(cue)) return { seconds: SETTLE + 5.5, levels, steps: [play, { at: SETTLE + 4, run: (a) => a.beds(0, 0) }], from: SETTLE - 0.05 };
  const hold = cue.name === 'music' ? 24 : cue.name === 'birds' ? 20 : 5;
  return { seconds: SETTLE + hold, levels, steps: [play], from: SETTLE - 0.05 };
}

/** An OfflineAudioContext, or the fake one. */
type Offline = BaseAudioContext & { suspend(t: number): Promise<void>; resume(): Promise<void>; startRendering(): Promise<AudioBuffer> };
/**
 * Renders `plan` on `ctx` (an OfflineAudioContext at RATE, `plan.seconds` long) from PRINT_SEED, as a
 * fingerprint plays: a cue's render is the very sound its fingerprint describes.
 */
export function renderOn(ctx: Offline, plan: Plan): Promise<AudioBuffer> {
  const audio = createAudio(true, plan.levels, { ctx: ctx as OfflineAudioContext, rand: seeded(PRINT_SEED), now: () => PRINT_MS + ctx.currentTime * 1000 });
  audio.listen(LISTEN.x, LISTEN.z, LISTEN.half);
  for (const step of plan.steps)
    void ctx.suspend(step.at).then(() => {
      step.run(audio);
      return ctx.resume();
    });
  return ctx.startRendering();
}
