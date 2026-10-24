// The speech blips' record: FK-157's golden, lifted out of scripts/audio-voice.test.ts by FK-160 so the
// sound board can fingerprint the voices exactly as the guard does. The fake Web Audio (fake.ts) writes
// down every node, connection, parameter ramp and start/stop that createAudio() and speech() ask for
// (client/dudes/audio.ts), with Math.random and the page's clock under control for each call. The
// record is the voice path, the pitch table, the syllable counts, the two Math.random extremes, the
// throttle, the falloff, seedOf and five chat lines; its hash is what Sami approves. The guard's pins
// (scripts/audio-voice.test.ts) read the same rig, and one of them checks this record, made here the
// board's way, is the one made the stream's way (createAudio() making its own context, as main.ts does).
//
// Nothing here may change what the record holds: the approved hash (client/dudes/audio-approved.json)
// is of it, and the guard fails the moment it moves.
import { createAudio, type AudioHandles, type AudioLevels } from '../dudes/audio';
import { emoteNames } from '../../src/shared/emotes';
import { seedOf } from './board';
import { FakeContext, FakeNode, FakeOfflineContext, FakeParam, seeded, type Ev, type Val } from './fake';

/** The largest Math.random can return. */
export const ONE = 1 - Number.EPSILON / 2;

export const sig = (x: number) => Number(x.toPrecision(6));
export const usec = (t: number) => Math.round(t * 1e6) / 1e6;

/** The stream page's levels (main.ts, its createAudio call). */
export const LEVELS: AudioLevels = { music: 0.5, sfx: 0.8, ambience: 0.6 };
/** Where the camera looks in the record. */
export const CAM = { x: 10, z: -5 };
export type XZ = { x: number; z: number };
/** A spot `d` from the camera. */
export const spot = (d: number): XZ => ({ x: CAM.x + d * 0.6, z: CAM.z + d * 0.8 });

export interface Rig {
  audio: AudioHandles;
  ctx: FakeContext;
  /** The nodes createAudio() made, by what they are: out, compressor, master, music, sfx, ambience, voice, reverb, the rest by kind. */
  names: Map<FakeNode, string>;
  /** What createAudio() itself asked for. */
  setup: Ev[];
  /** performance.now(), in ms: well past the page's start, as in a browser. */
  ms: number;
}

/**
 * How a rig gets the town's sound: createAudio() at `levels`, and the fake it plays on. Math.random is
 * seeded around the call (the reverb and noise buffers), so createAudio() must use its default random.
 */
export type Maker = (levels: AudioLevels) => { audio: AudioHandles; ctx: FakeContext };
/**
 * The board's way: the fake handed in as an offline context, so createAudio() starts no timer and
 * listens for no click (there is no page to touch). The guard's pins make it the stream's way too,
 * and check the two ask for the same.
 */
export const offline: Maker = (levels) => {
  const ctx = new FakeOfflineContext();
  return { ctx, audio: createAudio(true, levels, { ctx: ctx as unknown as OfflineAudioContext }) };
};

/** A fresh createAudio() on the fake, at the stream page's levels, with its nodes named. */
export function rig(make: Maker = offline): Rig {
  const random = Math.random;
  Math.random = seeded(1); // the reverb and noise buffers
  let made: ReturnType<Maker>;
  try {
    made = make(LEVELS);
  } finally {
    Math.random = random;
  }
  const { audio, ctx } = made;
  const setup = ctx.log.slice();
  const names = nameChain(ctx, audio, LEVELS);
  ctx.nodes.forEach((n, i) => names.has(n) || names.set(n, `${n.kind}@${i}`));
  return { audio, ctx, names, setup, ms: 10_000 };
}

/**
 * The town's own nodes by what they are: out, compressor, master, the buses (music, sfx, ambience,
 * voice) and the reverb. The rest are left to the caller. createAudio() made them at `levels`.
 */
export function nameChain(ctx: FakeContext, audio: AudioHandles, levels: AudioLevels): Map<FakeNode, string> {
  const names = new Map<FakeNode, string>([[ctx.destination, 'out']]);
  const into = (to: FakeNode) => ctx.nodes.filter((n) => n.out.includes(to));
  const comp = into(ctx.destination).find((n) => n.kind === 'compressor');
  const master = comp && into(comp).find((n) => n.kind === 'gain');
  if (comp) names.set(comp, 'compressor');
  if (master) names.set(master, 'master');
  // A bus is the gain that follows its level: nudge each level and see which gain moves. The sfx
  // level moves two (FK-162): the effects' bus, which the engines' drone is wired into here, and the
  // voices' own, which nothing is until a line is said.
  const gains = ctx.nodes.filter((n) => n.kind === 'gain');
  for (const bus of ['music', 'sfx', 'ambience'] as const) {
    const before = gains.map((n) => settles(ctx, n)?.[0]);
    audio.levels({ [bus]: levels[bus] / 2 + 0.01 });
    const moved = gains.filter((n, i) => settles(ctx, n)?.[0] !== before[i]);
    audio.levels({ [bus]: levels[bus] });
    if (bus !== 'sfx' && moved.length === 1) names.set(moved[0], bus);
    const fed = moved.filter((n) => ctx.nodes.some((m) => m.out.includes(n)));
    if (bus === 'sfx' && moved.length === 2 && fed.length === 1) {
      names.set(fed[0], 'sfx');
      names.set(moved.find((n) => n !== fed[0])!, 'voice');
    }
  }
  const reverb = ctx.nodes.find((n) => n.kind === 'convolver');
  if (reverb) names.set(reverb, 'reverb');
  return names;
}

/** The level a gain was last told to settle at, and how fast. */
function settles(ctx: FakeContext, n: FakeNode | undefined): [number, number] | undefined {
  for (let i = ctx.log.length - 1; i >= 0; i--) {
    const e = ctx.log[i];
    if (e.node === n && e.op === 'gain.setTargetAtTime') return [e.v as number, e.tc!];
  }
  return undefined;
}

export const named = (r: Rig, name: string) => [...r.names].find(([, n]) => n === name)?.[0];
/** The level a gain was last told to settle at, and how fast. */
export const target = (r: Rig, n: FakeNode | undefined) => settles(r.ctx, n);
/** Time passes: the page's clock (the throttle) and the audio clock (the schedule) together. */
export function later(r: Rig, ms: number) {
  r.ms += ms;
  r.ctx.currentTime += ms / 1000;
}

/** One oscillator of a syllable, read back from the events: times are from the moment of the call. */
export interface Blip {
  wave: string;
  freq: number;
  glide?: number;
  glideAt?: number;
  /** Where the oscillator goes (its own gain), and where that gain goes. */
  via: string[];
  to: string[];
  /** The gain's automation: [call, value, time]. */
  envelope: [string, number, number][];
  peak: number;
  start: number;
  stop: number;
}
export interface Said {
  evs: Ev[];
  t0: number;
  blips: Blip[];
}

/** One line through speech() at the rig's moment, with a known Math.random. */
export function say(r: Rig, seed: number, text: string, o: { at?: XZ; low?: boolean; rand?: () => number } = {}): Said {
  const random = Math.random,
    now = performance.now;
  const from = r.ctx.log.length,
    t0 = r.ctx.currentTime;
  Math.random = o.rand ?? seeded(seed);
  performance.now = () => r.ms;
  try {
    r.audio.speech(seed, text, o.at, o.low);
  } finally {
    Math.random = random;
    performance.now = now;
  }
  const evs = r.ctx.log.slice(from);
  return { evs, t0, blips: blips(r, evs, t0) };
}

function blips(r: Rig, evs: Ev[], t0: number): Blip[] {
  const of = (n: FakeNode) => evs.filter((e) => e.node === n);
  const name = (n: FakeNode) => r.names.get(n) ?? n.kind;
  const at = (e: Ev | undefined) => usec((e?.t ?? NaN) - t0);
  return evs
    .filter((e) => e.op === 'create' && e.node.kind === 'oscillator')
    .map(({ node: o }) => {
      const ev = of(o);
      const f = ev.find((e) => e.op === 'frequency.setValueAtTime');
      const glide = ev.find((e) => e.op === 'frequency.exponentialRampToValueAtTime');
      const gain = o.out[0];
      const envelope = (gain ? of(gain) : []).filter((e) => e.op.startsWith('gain.')).map((e): [string, number, number] => [e.op.slice(5), sig(e.v as number), at(e)]);
      return {
        wave: String(ev.find((e) => e.op === 'type')?.v ?? 'sine'),
        freq: f?.v as number,
        ...(glide ? { glide: (glide.v as number) / (f?.v as number), glideAt: at(glide) } : {}),
        via: o.out.map(name),
        to: gain ? gain.out.map(name) : [],
        envelope,
        peak: envelope[1]?.[1],
        start: at(ev.find((e) => e.op === 'start')),
        stop: at(ev.find((e) => e.op === 'stop')),
      };
    });
}
export const tri = (b: Blip) => b.wave === 'triangle';
export const sine = (b: Blip) => b.wave === 'sine';

/** A call's events as plain rows, rounded: the nodes it made are #0, #1…, the rig's by name; times from t0. */
export function rows(r: Rig, evs: Ev[], t0: number): Val[][] {
  const made = new Map<FakeNode, string>();
  const name = (n: FakeNode) => made.get(n) ?? r.names.get(n) ?? n.kind;
  return evs.map((e) => {
    if (e.op === 'create' && !r.names.has(e.node)) made.set(e.node, `#${made.size}`);
    const v = e.v instanceof FakeNode ? name(e.v) : e.v instanceof FakeParam ? `${name(e.v.node)}.${e.v.name}` : typeof e.v === 'number' ? sig(e.v) : e.v;
    return [name(e.node), e.op, ...(v === undefined ? [] : [v]), ...(e.t === undefined ? [] : [usec(e.t - t0)]), ...(e.tc === undefined ? [] : [sig(e.tc)])];
  });
}

// --- what is pinned ---

/** Every one of the nine voices, and seeds past nine (they wrap round). */
export const PITCH_SEEDS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 157, 4294967295];
/** Lines through speech() as main.ts sends them: the speaker's id through seedOf, the text through emoteNames. */
export const LINES: { who: string; text: string; at: XZ; low?: boolean }[] = [
  { who: 'dev:test-kev', text: 'hi', at: { x: 12, z: -3 } },
  { who: 'dev:test-dana', text: 'hello there friend', at: spot(20) }, // 20 from the camera: at 0.65
  { who: 'kick:41871633', text: 'lol [emote:37226:KEKW] that is so good', at: { x: 4, z: -9 } },
  { who: 'dev:test-bo', text: 'please build me a big house by the river', at: { x: 10, z: 3 } }, // nine words, seven syllables
  { who: 'mayor', text: 'Hello! Welcome to my town!', at: { x: 10, z: -2 }, low: true }, // the head's low voice
];
/** A long chat line (211 characters, 43 words): still seven syllables, not cut or dropped. */
export const LONG =
  'ok so i just got here and this town is honestly the best thing on kick right now, can someone ask the mayor to fix the bridge ' +
  'so the travellers can get across before the rain comes back and floods the market lol';
export const FAR = spot(500);
/** The throttle, step by step: [ms since the step before, speaker, where (omitted: heard everywhere), plays?, why]. */
export const THROTTLE: [number, number, XZ | undefined, boolean, string][] = [
  [0, 1, undefined, true, 'the first line plays'],
  [399, 1, undefined, false, '399 ms later the same speaker is dropped'],
  [0, 2, undefined, true, 'another speaker in that same moment is not held up'],
  [1, 1, undefined, true, '400 ms after their last line, the first speaker plays again'],
  [400, 1, FAR, false, 'a line too far away to hear does not play'],
  [100, 1, undefined, true, "and it doesn't count: 100 ms later (500 since the last one heard) the next line plays"],
];
/** The falloff: [the camera's half-width, distance (omitted: no place, heard everywhere), loudness]. Reach is half × 1.4 + 12. */
export const FALLOFF: [number, number | undefined, number][] = [
  [20, undefined, 1],
  [20, 0, 1],
  [20, 6, 1], // full up to reach × 0.15
  [20, 20, 0.65],
  [20, 30, 0.4],
  [20, 42, 0.1],
  [20, 45, 0], // under 0.05: not played at all
  [20, 90, 0],
  [40, 34, 0.65],
  [40, 68, 0.15],
  [40, 75, 0],
  [8, 11.6, 0.65],
];

export function pitchOf(r: Rig, seed: number, low: boolean) {
  later(r, 1000);
  return say(r, seed, 'la la', { low, rand: () => 0 }).blips;
}
export function throttle(r: Rig) {
  return THROTTLE.map(([ms, seed, at]) => {
    later(r, ms);
    return say(r, seed, 'hi there', { at }).evs.length > 0;
  });
}
export function peaksAt(r: Rig, half: number, d: number | undefined): [number, number] {
  r.audio.listen(CAM.x, CAM.z, half);
  later(r, 1000);
  const b = say(r, 7, 'hi', { at: d === undefined ? undefined : spot(d) }).blips;
  return b.length ? [b.find(tri)!.peak, b.find(sine)!.peak] : [0, 0];
}

/**
 * The record calls the voices' bus 'sfx': the blips were on the sfx bus when Sami approved them
 * (FK-157). Since FK-162 they have a bus of their own, made just as the sfx bus is (the twin test in
 * scripts/audio-voice.test.ts), so the record and its hash are what they were: the proof that the
 * split changed nothing. The effects' bus carries no blip, so it is in no row of the record.
 */
export const AS_APPROVED = new Map([
  ['voice', 'sfx'],
  ['sfx', 'effects'],
]);

/** Everything above in one record. Its hash is what Sami approves. */
export function voiceRecord(make: Maker = offline) {
  const r = rig(make);
  for (const [n, name] of r.names) r.names.set(n, AS_APPROVED.get(name) ?? name);
  const sfx = named(r, 'sfx');
  // Node by node, so the order createAudio() happens to make them in doesn't matter.
  const chain = {
    setup: Object.fromEntries(['sfx', 'master', 'compressor', 'out'].map((name) => [name, rows(r, r.setup.filter((e) => r.names.get(e.node) === name), 0).map((row) => row.slice(1))])),
    sfxLevel: [0.8, 1, 0.25].map((x) => {
      r.audio.levels({ sfx: x });
      return [x, ...target(r, sfx)!.map(sig)];
    }),
  };
  r.audio.levels(LEVELS);
  const pitch = PITCH_SEEDS.map((seed) => [seed, ...[false, true].flatMap((low) => pitchOf(r, seed, low).slice(0, 2).map((b) => sig(b.freq)))]);
  const syllables = [1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => {
    later(r, 1000);
    return [n, say(r, 3, Array(n).fill('la').join(' ')).blips.filter(tri).length];
  });
  const extremes = [0, ONE].map((x) => {
    later(r, 1000);
    const s = say(r, 4, 'a b c', { rand: () => x });
    return rows(r, s.evs, s.t0);
  });
  const falloff = FALLOFF.map(([half, d]) => [half, d ?? 'anywhere', ...peaksAt(r, half, d)]);
  r.audio.listen(CAM.x, CAM.z, 20);
  const lines = LINES.map((l, i) => {
    later(r, 1000);
    const s = say(r, seedOf(l.who), emoteNames(l.text), { at: l.at, low: l.low, rand: seeded(157 + i) });
    return [l.who, l.text, rows(r, s.evs, s.t0)];
  });
  return { chain, pitch, syllables, extremes, throttle: throttle(rig(make)), falloff, lines, seedOf: LINES.map((l) => [l.who, seedOf(l.who)]) };
}
