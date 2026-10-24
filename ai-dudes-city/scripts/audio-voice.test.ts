// The speech blips are Sami's (FK-157; board/BOARD.md → Ground rules): "The noises as people speak
// right now are fantastic and I love them." Agents can't hear them, so this pins what they are made
// of. A fake Web Audio writes down every node, connection, parameter ramp and start/stop that
// createAudio() and speech() ask for (client/dudes/audio.ts, untouched), with Math.random and the
// clock under the test's control. The tests spell the voice out one property at a time; the last one
// hashes all of it and compares the hash with client/dudes/audio-approved.json, which only Sami's
// Approve on /sounds writes (FK-160). Change a blip and this fails until he has heard it.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { createAudio, type AudioHandles, type AudioLevels } from '../client/dudes/audio';
import { emoteNames } from '../src/shared/emotes';

const RULE =
  "Speech blips are Sami's (board/BOARD.md → Ground rules). Any change to speech(), tone(), seedOf, the voice or sfx bus gain, " +
  "the compressor, or anything that mutes, ducks, caps or replaces voices needs a sound-board link and Sami's Approve. " +
  "Agents never edit the golden file (client/dudes/audio-approved.json), and don't change this test to match: put it on /sounds and get Sami's Approve.";

/** A test whose failure carries the board rule and the way out. */
function pin(name: string, fn: () => void, opts: { todo?: string } = {}) {
  test(name, opts, () => {
    try {
      fn();
    } catch (e) {
      // A todo is a guard still to come (its card is named), not a change to the blips.
      if (e instanceof Error && !opts.todo) {
        const was = e.message,
          stack = e.stack; // read first: V8 writes the stack out lazily, with whatever the message is by then
        e.message = `${was}\n\n${RULE}`;
        if (stack) e.stack = stack.replace(was, e.message);
      }
      throw e;
    }
  });
}

// --- a fake Web Audio that writes down everything asked of it ---

type Val = number | string | boolean;
interface Ev {
  node: FakeNode;
  /** 'create', 'connect', a property ('type'), a value ('gain.value') or a call ('frequency.setValueAtTime', 'start'). */
  op: string;
  v?: Val | FakeNode | FakeParam;
  t?: number;
  tc?: number;
}

// Like a browser: a non-finite value throws (a NaN gain is a crash on stream, not a silence), and so
// does a time before zero or an exponential ramp to zero.
const finite = (x: number, what: string) => {
  if (!Number.isFinite(x)) throw new TypeError(`${what}: the provided float value is non-finite (${x})`);
  return x;
};
const time = (t: number, what: string) => {
  if (finite(t, what) < 0) throw new RangeError(`${what}: time ${t} is before zero`);
  return t;
};

class FakeParam {
  constructor(
    readonly node: FakeNode,
    readonly name: string,
    private v: number,
  ) {}
  get value() {
    return this.v;
  }
  set value(v: number) {
    this.v = finite(v, `${this.name}.value`);
    this.node.rec(`${this.name}.value`, { v });
  }
  setValueAtTime(v: number, t: number) {
    return this.at('setValueAtTime', v, t);
  }
  linearRampToValueAtTime(v: number, t: number) {
    return this.at('linearRampToValueAtTime', v, t);
  }
  exponentialRampToValueAtTime(v: number, t: number) {
    if (v === 0) throw new RangeError(`${this.name}: an exponential ramp can't reach 0`);
    return this.at('exponentialRampToValueAtTime', v, t);
  }
  setTargetAtTime(v: number, t: number, tc: number) {
    if (!(tc >= 0)) throw new RangeError(`${this.name}: time constant ${tc}`);
    return this.at('setTargetAtTime', v, t, tc);
  }
  cancelScheduledValues(t: number) {
    this.node.rec(`${this.name}.cancelScheduledValues`, { t: time(t, this.name) });
    return this;
  }
  private at(op: string, v: number, t: number, tc?: number) {
    this.node.rec(`${this.name}.${op}`, { v: finite(v, `${this.name}.${op}`), t: time(t, `${this.name}.${op}`), ...(tc === undefined ? {} : { tc }) });
    return this;
  }
}

class FakeNode {
  readonly out: FakeNode[] = [];
  constructor(
    readonly ctx: FakeContext,
    readonly kind: string,
  ) {
    ctx.nodes.push(this);
    this.rec('create', { v: kind });
  }
  rec(op: string, e: Omit<Ev, 'node' | 'op'> = {}) {
    this.ctx.log.push({ node: this, op, ...e });
  }
  connect<T extends FakeNode | FakeParam>(to: T): T {
    if (to instanceof FakeNode) this.out.push(to);
    this.rec('connect', { v: to });
    return to;
  }
  disconnect() {
    this.out.length = 0;
    this.rec('disconnect');
  }
}

/** A node with its AudioParams, its recorded properties (`o.type = 'triangle'`) and, for sources, start/stop. */
function node(ctx: FakeContext, kind: string, params: Record<string, number>, props: Record<string, unknown> = {}, source = false) {
  const n = new FakeNode(ctx, kind);
  const fields = n as unknown as Record<string, unknown>;
  for (const [name, v] of Object.entries(params)) fields[name] = new FakeParam(n, name, v);
  for (const [name, init] of Object.entries(props)) {
    let cur = init;
    Object.defineProperty(n, name, {
      get: () => cur,
      set: (v: unknown) => {
        cur = v;
        n.rec(name, { v: v !== null && typeof v === 'object' ? 'buffer' : (v as Val) });
      },
    });
  }
  if (source) {
    fields.start = (t = 0) => n.rec('start', { t: time(t, `${kind}.start`) });
    fields.stop = (t = 0) => n.rec('stop', { t: time(t, `${kind}.stop`) });
  }
  return n;
}

class FakeContext {
  static made: FakeContext[] = [];
  readonly log: Ev[] = [];
  readonly nodes: FakeNode[] = [];
  readonly sampleRate = 48_000;
  currentTime = 0;
  state = 'running'; // as in OBS, which never waits for a click
  readonly destination = new FakeNode(this, 'destination');
  constructor() {
    FakeContext.made.push(this);
  }
  resume() {
    return Promise.resolve();
  }
  createGain() {
    return node(this, 'gain', { gain: 1 });
  }
  createOscillator() {
    return node(this, 'oscillator', { frequency: 440, detune: 0 }, { type: 'sine' }, true);
  }
  createBufferSource() {
    return node(this, 'buffer-source', { playbackRate: 1, detune: 0 }, { buffer: null, loop: false }, true);
  }
  createBiquadFilter() {
    return node(this, 'biquad', { frequency: 350, Q: 1, gain: 0, detune: 0 }, { type: 'lowpass' });
  }
  createStereoPanner() {
    return node(this, 'panner', { pan: 0 });
  }
  createConvolver() {
    return node(this, 'convolver', {}, { buffer: null, normalize: true });
  }
  createDynamicsCompressor() {
    return node(this, 'compressor', { threshold: -24, knee: 30, ratio: 12, attack: 0.003, release: 0.25 });
  }
  createBuffer(channels: number, length: number, sampleRate: number) {
    const data = Array.from({ length: channels }, () => new Float32Array(length));
    return { numberOfChannels: channels, length, sampleRate, duration: length / sampleRate, getChannelData: (i: number) => data[i] };
  }
}

// --- the rig: createAudio() on the fake, and lines through speech() ---

/** mulberry32: a Math.random that gives the same numbers every run. */
const seeded = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
/** A Math.random answering from a list, and loud if speech() asks it more often than it does today. */
const list = (...xs: number[]) => () => {
  if (!xs.length) throw new Error('speech() asked Math.random more often than its four times a syllable');
  return xs.shift()!;
};
/** The largest Math.random can return. */
const ONE = 1 - Number.EPSILON / 2;

const sig = (x: number) => Number(x.toPrecision(6));
const usec = (t: number) => Math.round(t * 1e6) / 1e6;
const close = (got: number | undefined, want: number, what: string) =>
  assert.ok(got !== undefined && Math.abs(got - want) <= 1e-9 * Math.max(1, Math.abs(want)), `${what}: got ${got}, want ${want}`);

/** The stream page's levels (main.ts, its createAudio call). */
const LEVELS: AudioLevels = { music: 0.5, sfx: 0.8, ambience: 0.6 };
/** Where the camera looks in these tests. */
const CAM = { x: 10, z: -5 };
type XZ = { x: number; z: number };
/** A spot `d` from the camera. */
const spot = (d: number): XZ => ({ x: CAM.x + d * 0.6, z: CAM.z + d * 0.8 });

interface Rig {
  audio: AudioHandles;
  ctx: FakeContext;
  /** The nodes createAudio() made, by what they are: out, compressor, master, music, sfx, ambience, reverb, the rest by kind. */
  names: Map<FakeNode, string>;
  /** What createAudio() itself asked for. */
  setup: Ev[];
  /** performance.now(), in ms: well past the page's start, as in a browser. */
  ms: number;
}

/** A fresh createAudio() on the fake, at the stream page's levels, with its nodes named. */
function rig(): Rig {
  const g = globalThis as unknown as Record<string, unknown>;
  const keep = { window: g.window, addEventListener: g.addEventListener, setInterval: g.setInterval };
  const random = Math.random;
  g.window = { AudioContext: FakeContext };
  g.addEventListener = () => {};
  g.setInterval = () => 0; // the music's clock never starts: only speech() schedules anything
  Math.random = seeded(1); // the reverb and noise buffers
  let audio: AudioHandles;
  try {
    audio = createAudio(true, LEVELS);
  } finally {
    for (const [k, v] of Object.entries(keep)) {
      if (v === undefined) delete g[k];
      else g[k] = v;
    }
    Math.random = random;
  }
  const ctx = FakeContext.made.pop()!;
  const r: Rig = { audio, ctx, names: new Map(), setup: ctx.log.slice(), ms: 10_000 };
  const { names } = r;
  names.set(ctx.destination, 'out');
  const into = (to: FakeNode) => ctx.nodes.filter((n) => n.out.includes(to));
  const comp = into(ctx.destination).find((n) => n.kind === 'compressor');
  const master = comp && into(comp).find((n) => n.kind === 'gain');
  if (comp) names.set(comp, 'compressor');
  if (master) names.set(master, 'master');
  // A bus is the gain that follows its level: nudge each level and see which gain moves.
  const gains = ctx.nodes.filter((n) => n.kind === 'gain');
  for (const bus of ['music', 'sfx', 'ambience'] as const) {
    const before = gains.map((n) => target(r, n)?.[0]);
    audio.levels({ [bus]: LEVELS[bus] / 2 + 0.01 });
    const moved = gains.filter((n, i) => target(r, n)?.[0] !== before[i]);
    audio.levels({ [bus]: LEVELS[bus] });
    if (moved.length === 1) names.set(moved[0], bus);
  }
  const reverb = ctx.nodes.find((n) => n.kind === 'convolver');
  if (reverb) names.set(reverb, 'reverb');
  ctx.nodes.forEach((n, i) => names.has(n) || names.set(n, `${n.kind}@${i}`));
  return r;
}

const named = (r: Rig, name: string) => [...r.names].find(([, n]) => n === name)?.[0];
/** The level a gain was last told to settle at, and how fast. */
function target(r: Rig, n: FakeNode | undefined): [number, number] | undefined {
  for (let i = r.ctx.log.length - 1; i >= 0; i--) {
    const e = r.ctx.log[i];
    if (e.node === n && e.op === 'gain.setTargetAtTime') return [e.v as number, e.tc!];
  }
  return undefined;
}
/** Time passes: the page's clock (the throttle) and the audio clock (the schedule) together. */
function later(r: Rig, ms: number) {
  r.ms += ms;
  r.ctx.currentTime += ms / 1000;
}

/** One oscillator of a syllable, read back from the events: times are from the moment of the call. */
interface Blip {
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
interface Said {
  evs: Ev[];
  t0: number;
  blips: Blip[];
}

/** One line through speech() at the rig's moment, with a known Math.random. */
function say(r: Rig, seed: number, text: string, o: { at?: XZ; low?: boolean; rand?: () => number } = {}): Said {
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
const tri = (b: Blip) => b.wave === 'triangle';
const sine = (b: Blip) => b.wave === 'sine';

/** A call's events as plain rows, rounded: the nodes it made are #0, #1…, the rig's by name; times from t0. */
function rows(r: Rig, evs: Ev[], t0: number): Val[][] {
  const made = new Map<FakeNode, string>();
  const name = (n: FakeNode) => made.get(n) ?? r.names.get(n) ?? n.kind;
  return evs.map((e) => {
    if (e.op === 'create' && !r.names.has(e.node)) made.set(e.node, `#${made.size}`);
    const v = e.v instanceof FakeNode ? name(e.v) : e.v instanceof FakeParam ? `${name(e.v.node)}.${e.v.name}` : typeof e.v === 'number' ? sig(e.v) : e.v;
    return [name(e.node), e.op, ...(v === undefined ? [] : [v]), ...(e.t === undefined ? [] : [usec(e.t - t0)]), ...(e.tc === undefined ? [] : [sig(e.tc)])];
  });
}

// --- seedOf: each speaker's own voice ---

// A copy of seedOf in client/dudes/main.ts (Lane C's file: main.ts:752 in the audio plan, :786 on
// 2026-10-24), which turns a speaker's id into the seed speech() picks their voice from. main.ts can't
// load in Node (three.js and the DOM), so the seedOf test finds the line in the file, wherever it has
// moved to, to make sure this copy is still the real one.
const SEED_OF = 'const seedOf = (id: string) => [...id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);';
const seedOf = (id: string) => [...id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);

// --- what is pinned ---

/** Every one of the nine voices, and seeds past nine (they wrap round). */
const PITCH_SEEDS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 157, 4294967295];
/** Lines through speech() as main.ts sends them: the speaker's id through seedOf, the text through emoteNames. */
const LINES: { who: string; text: string; at: XZ; low?: boolean }[] = [
  { who: 'dev:test-kev', text: 'hi', at: { x: 12, z: -3 } },
  { who: 'dev:test-dana', text: 'hello there friend', at: spot(20) }, // 20 from the camera: at 0.65
  { who: 'kick:41871633', text: 'lol [emote:37226:KEKW] that is so good', at: { x: 4, z: -9 } },
  { who: 'dev:test-bo', text: 'please build me a big house by the river', at: { x: 10, z: 3 } }, // nine words, seven syllables
  { who: 'mayor', text: 'Hello! Welcome to my town!', at: { x: 10, z: -2 }, low: true }, // the head's low voice
];
const FAR = spot(500);
/** The throttle, step by step: [ms since the step before, speaker, where (omitted: heard everywhere), plays?, why]. */
const THROTTLE: [number, number, XZ | undefined, boolean, string][] = [
  [0, 1, undefined, true, 'the first line plays'],
  [399, 1, undefined, false, '399 ms later the same speaker is dropped'],
  [0, 2, undefined, true, 'another speaker in that same moment is not held up'],
  [1, 1, undefined, true, '400 ms after their last line, the first speaker plays again'],
  [400, 1, FAR, false, 'a line too far away to hear does not play'],
  [100, 1, undefined, true, "and it doesn't count: 100 ms later (500 since the last one heard) the next line plays"],
];
/** The falloff: [the camera's half-width, distance (omitted: no place, heard everywhere), loudness]. Reach is half × 1.4 + 12. */
const FALLOFF: [number, number | undefined, number][] = [
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

function pitchOf(r: Rig, seed: number, low: boolean) {
  later(r, 1000);
  return say(r, seed, 'la la', { low, rand: () => 0 }).blips;
}
function throttle(r: Rig) {
  return THROTTLE.map(([ms, seed, at]) => {
    later(r, ms);
    return say(r, seed, 'hi there', { at }).evs.length > 0;
  });
}
function peaksAt(r: Rig, half: number, d: number | undefined): [number, number] {
  r.audio.listen(CAM.x, CAM.z, half);
  later(r, 1000);
  const b = say(r, 7, 'hi', { at: d === undefined ? undefined : spot(d) }).blips;
  return b.length ? [b.find(tri)!.peak, b.find(sine)!.peak] : [0, 0];
}

/** Everything above in one record. Its hash is what Sami approves. */
function golden() {
  const r = rig();
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
  return { chain, pitch, syllables, extremes, throttle: throttle(rig()), falloff, lines, seedOf: LINES.map((l) => [l.who, seedOf(l.who)]) };
}
const voiceHash = () => createHash('sha256').update(JSON.stringify(golden())).digest('hex');

const APPROVED = path.join(import.meta.dirname, '..', 'client', 'dudes', 'audio-approved.json');
interface Approved {
  voice: { hash: string; by: string; date: string; note?: string };
  cues: Record<string, unknown>;
}

// --- the tests ---

pin("each voice's pitch: 230 + (seed % 9) × 22 Hz, the head's low voice 150 + (seed % 9) × 8 Hz, a sine an octave up", () => {
  const r = rig();
  for (const seed of PITCH_SEEDS)
    for (const low of [false, true]) {
      const base = low ? 150 + (seed % 9) * 8 : 230 + (seed % 9) * 22;
      const [t, s] = pitchOf(r, seed, low);
      // Math.random at 0 is the bottom of the jitter: ×0.85.
      close(t.freq / 0.85, base, `seed ${seed}${low ? ', low' : ''}: the voice`);
      close(s.freq, t.freq * 2, `seed ${seed}${low ? ', low' : ''}: the sine an octave up`);
    }
});

pin('a syllable a word, never fewer than 2 or more than 7; an emote counts as a word', () => {
  const r = rig();
  const cases: [string, number][] = [
    ['hi', 2],
    ['hello there', 2],
    ['hello there friend', 3],
    ['one two three four five six seven', 7],
    ['please build me a big house by the river', 7],
    [emoteNames('lol [emote:37226:KEKW] nice'), 3],
  ];
  for (const [text, n] of cases) {
    later(r, 1000);
    const { blips } = say(r, 3, text);
    assert.equal(blips.filter(tri).length, n, `"${text}": triangles`);
    assert.equal(blips.filter(sine).length, n, `"${text}": sines`);
    assert.equal(blips.length, 2 * n, `"${text}": nothing else plays`);
  }
});

pin('syllables of 70–130 ms, 30–80 ms apart, each with a 10 ms attack and an exponential decay', () => {
  const env = (peak: number, at: number, end: number) => [
    ['setValueAtTime', 0.0001, usec(at)],
    ['exponentialRampToValueAtTime', peak, usec(at + 0.01)],
    ['exponentialRampToValueAtTime', 0.0001, usec(end)],
  ];
  // Math.random at its bottom and at its top: the shortest syllables and gaps, then the longest.
  for (const [x, d, gap] of [
    [0, 0.07, 0.03],
    [ONE, 0.13, 0.08],
  ]) {
    const { blips } = say(rig(), 4, 'a b c', { rand: () => x });
    const ts = blips.filter(tri),
      ss = blips.filter(sine);
    assert.equal(ts.length, 3);
    ts.forEach((t, i) => {
      const at = 0.02 + i * (d + gap); // the first starts 20 ms from now
      const s = ss[i];
      assert.deepEqual(t.envelope, env(0.07, at, at + d), `Math.random ${x}, syllable ${i + 1}: the triangle`);
      assert.deepEqual(s.envelope, env(0.025, at, at + d * 0.8), `Math.random ${x}, syllable ${i + 1}: the sine`);
      close(t.start, at, `syllable ${i + 1} starts`);
      close(t.stop, at + d + 0.05, `syllable ${i + 1}: the triangle stops`);
      close(s.start, at, `syllable ${i + 1}: the sine starts with it`);
      close(s.stop, at + d * 0.8 + 0.05, `syllable ${i + 1}: the sine stops`);
    });
  }
});

pin("each syllable jitters ×0.85–1.30 around its voice and glides up ×1.25 or down ×0.82; the sine on top doesn't glide", () => {
  const base = 230 + 4 * 22;
  for (const [x, jitter, glide] of [
    [0, 0.85, 1.25],
    [ONE, 1.3, 0.82],
  ]) {
    const { blips } = say(rig(), 4, 'a b', { rand: () => x });
    for (const [i, t] of blips.filter(tri).entries()) {
      close(t.freq, base * jitter, `Math.random ${x}, syllable ${i + 1}: the jitter`);
      close(t.glide, glide, `Math.random ${x}, syllable ${i + 1}: the glide`);
      close(t.glideAt, t.envelope[2][2], 'the glide lasts the whole syllable');
    }
    for (const s of blips.filter(sine)) assert.equal(s.glide, undefined, 'the sine holds its note');
  }
  // Up or down at even odds: under 0.5 up, from 0.5 down.
  const { blips } = say(rig(), 4, 'a b', { rand: list(0, 0, 0.4999, 0, 0, 0, 0.5, 0) });
  const [a, b] = blips.filter(tri);
  close(a.glide, 1.25, 'Math.random 0.4999 glides up');
  close(b.glide, 0.82, 'Math.random 0.5 glides down');
});

pin('a triangle at 0.07 and a sine at 0.025, both dry, straight onto the sfx bus', () => {
  const r = rig();
  const { evs, blips } = say(r, 5, 'hello there friend');
  assert.deepEqual(
    evs.filter((e) => e.op === 'create').map((e) => e.node.kind),
    Array(3).fill(['oscillator', 'gain', 'oscillator', 'gain']).flat(),
    'four nodes a syllable: no panner, no filter, no reverb send',
  );
  for (const b of blips) {
    assert.equal(b.peak, b.wave === 'triangle' ? 0.07 : 0.025, `the ${b.wave}'s level`);
    assert.deepEqual(b.via, ['gain'], `the ${b.wave} goes only into its own gain`);
    assert.deepEqual(b.to, ['sfx'], `the ${b.wave}'s gain goes only to the sfx bus (dry: nothing to the reverb)`);
  }
  assert.deepEqual(blips.map((b) => b.wave), Array(3).fill(['triangle', 'sine']).flat());
});

pin('the voice path: the sfx bus at its level × 0.7, the master at 0.9, the compressor at −14 dB and 6:1', () => {
  const r = rig();
  const sfx = named(r, 'sfx'),
    master = named(r, 'master'),
    comp = named(r, 'compressor');
  assert.ok(sfx && master && comp, 'the sfx bus, master and compressor are all there');
  const outOf = (n: FakeNode) => n.out.map((o) => r.names.get(o));
  assert.deepEqual(outOf(sfx), ['master'], 'the sfx bus feeds the master');
  assert.deepEqual(outOf(master), ['compressor'], 'the master feeds the compressor');
  assert.deepEqual(outOf(comp), ['out'], 'the compressor feeds the speakers');
  const set = (n: FakeNode) => r.setup.filter((e) => e.node === n && e.op.endsWith('.value')).map((e) => [e.op, e.v]);
  assert.deepEqual(set(master), [['gain.value', 0.9]]);
  assert.deepEqual(set(comp), [
    ['threshold.value', -14],
    ['ratio.value', 6],
  ]);
  const [level, tc] = target(r, sfx)!;
  close(level, 0.8 * 0.7, "the sfx bus at the stream page's 0.8");
  close(tc, 0.1, 'settling in 0.1 s');
  r.audio.levels({ sfx: 1 });
  close(target(r, sfx)![0], 0.7, 'the sfx bus at full');
  // So a syllable's triangle reaches the compressor at 0.07 × 0.56 × 0.9 at the stream's default level.
  close(0.07 * level * 0.9, 0.03528, 'a syllable into the compressor');
});

pin("400 ms per speaker: a line inside it is dropped, another speaker isn't held up, a line nobody hears doesn't count", () => {
  const r = rig();
  throttle(r).forEach((played, i) => assert.equal(played, THROTTLE[i][3], THROTTLE[i][4]));
});

pin('quieter with distance from where the camera looks: full up close, silent past the reach', () => {
  const r = rig();
  for (const [half, d, v] of FALLOFF) {
    const [t, s] = peaksAt(r, half, d);
    const where = `half ${half}, ${d ?? 'no place'}`;
    close(t, sig(0.07 * v), `${where}: the triangle`);
    close(s, sig(0.025 * v), `${where}: the sine`);
  }
});

pin(
  'a NaN half from the camera never reaches a gain (exponentialRampToValueAtTime would throw)',
  () => {
    const r = rig();
    r.audio.listen(0, 0, NaN); // a perspective camera can pass one
    // The fake throws on a non-finite value, as a browser does; whether the line then plays is FK-158's call.
    const { evs } = say(r, 1, 'hello there', { at: { x: 3, z: 4 } });
    for (const e of evs) if (typeof e.v === 'number') assert.ok(Number.isFinite(e.v), `${e.op}: ${e.v}`);
  },
  { todo: "FK-158 adds the guard in near(); until then a NaN half throws, as it would on stream (remove this todo when it lands)" },
);

pin('seedOf: each speaker keeps their voice (this copy is still the line in main.ts)', () => {
  const main = fs.readFileSync(path.join(import.meta.dirname, '..', 'client', 'dudes', 'main.ts'), 'utf8');
  assert.ok(
    main.split('\n').some((l) => l.trim() === SEED_OF),
    'client/dudes/main.ts no longer has this exact seedOf: a changed seedOf changes every speaker\'s voice',
  );
  assert.deepEqual(Object.fromEntries(LINES.map((l) => [l.who, seedOf(l.who)])), {
    'dev:test-kev': 841176557,
    'dev:test-dana': 306456959,
    'kick:41871633': 3906050446,
    'dev:test-bo': 1274060444,
    mayor: 304077409,
  });
});

pin('the blips are the ones Sami approved (client/dudes/audio-approved.json)', () => {
  const approved = JSON.parse(fs.readFileSync(APPROVED, 'utf8')) as Approved;
  assert.match(approved.voice.hash, /^[0-9a-f]{64}$/, 'audio-approved.json has a voice hash');
  const hash = voiceHash();
  assert.equal(voiceHash(), hash, 'the record comes out the same every time');
  assert.equal(
    hash,
    approved.voice.hash,
    `The speech blips changed: they hash to ${hash}, and Sami approved ${approved.voice.hash} (${approved.voice.by}, ${approved.voice.date}). The tests above say what changed.`,
  );
});
