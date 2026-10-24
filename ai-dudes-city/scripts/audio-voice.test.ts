// The speech blips are Sami's (FK-157; board/BOARD.md → Ground rules): "The noises as people speak
// right now are fantastic and I love them." Agents can't hear them, so this pins what they are made
// of. A fake Web Audio (scripts/audio-fake.ts) writes down every node, connection, parameter ramp and
// start/stop that createAudio() and speech() ask for (client/dudes/audio.ts), with Math.random and the
// clock under the test's control. The tests spell the voice out one property at a time; the last one
// hashes all of it and compares the hash with client/dudes/audio-approved.json, which only Sami's
// Approve on /sounds writes (FK-160). Change a blip and this fails until he has heard it.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { createAudio, type AudioHandles, type AudioLevels } from '../client/dudes/audio';
import { emoteNames } from '../src/shared/emotes';
import { FakeContext, FakeNode, FakeParam, seeded, type Ev, type Val } from './audio-fake';

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

// --- the rig: createAudio() on the fake, and lines through speech() ---

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
  /** The nodes createAudio() made, by what they are: out, compressor, master, music, sfx, ambience, voice, reverb, the rest by kind. */
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
  // A bus is the gain that follows its level: nudge each level and see which gain moves. The sfx
  // level moves two (FK-162): the effects' bus, which the engines' drone is wired into here, and the
  // voices' own, which nothing is until a line is said.
  const gains = ctx.nodes.filter((n) => n.kind === 'gain');
  for (const bus of ['music', 'sfx', 'ambience'] as const) {
    const before = gains.map((n) => target(r, n)?.[0]);
    audio.levels({ [bus]: LEVELS[bus] / 2 + 0.01 });
    const moved = gains.filter((n, i) => target(r, n)?.[0] !== before[i]);
    audio.levels({ [bus]: LEVELS[bus] });
    if (bus !== 'sfx' && moved.length === 1) names.set(moved[0], bus);
    const fed = moved.filter((n) => ctx.nodes.some((m) => m.out.includes(n)));
    if (bus === 'sfx' && moved.length === 2 && fed.length === 1) {
      names.set(fed[0], 'sfx');
      names.set(moved.find((n) => n !== fed[0])!, 'voice');
    }
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
// And how main.ts feeds speech(), found the same way (main.ts:796 and :778/:792 on 2026-10-24): every
// new line a dude says, in their own voice, emotes read as words, where they stand, the head low; and
// the stream's sfx level the figures here assume (LEVELS.sfx), and the operator's slider on top of it.
const SPEECH = 'if (text && text !== lastSaid.get(d.id)) audio.speech(seedOf(d.id), emoteNames(text), d.position, d.mayor);';
const SFX_OPERATOR = "sfx: a.sfx * level('sfx', 0.8) * 1.25";
const MAIN_TS = path.join(import.meta.dirname, '..', 'client', 'dudes', 'main.ts');

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
/** A long chat line (211 characters, 43 words): still seven syllables, not cut or dropped. */
const LONG =
  'ok so i just got here and this town is honestly the best thing on kick right now, can someone ask the mayor to fix the bridge ' +
  'so the travellers can get across before the rain comes back and floods the market lol';
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

/**
 * The record calls the voices' bus 'sfx': the blips were on the sfx bus when Sami approved them
 * (FK-157). Since FK-162 they have a bus of their own, made just as the sfx bus is (the twin test
 * below), so the record and its hash are what they were: the proof that the split changed nothing.
 * The effects' bus carries no blip, so it is in no row of the record.
 */
const AS_APPROVED = new Map([
  ['voice', 'sfx'],
  ['sfx', 'effects'],
]);

/** Everything above in one record. Its hash is what Sami approves. */
function golden() {
  const r = rig();
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
  return { chain, pitch, syllables, extremes, throttle: throttle(rig()), falloff, lines, seedOf: LINES.map((l) => [l.who, seedOf(l.who)]) };
}
const hashOf = (record: unknown) => createHash('sha256').update(JSON.stringify(record)).digest('hex');
/** A record as JSON with a row a line, so two of them diff well. */
function lined(x: unknown, pad = ''): string {
  if (x === null || typeof x !== 'object' || (Array.isArray(x) && !x.some((v) => v !== null && typeof v === 'object'))) return JSON.stringify(x);
  const inner = `${pad} `;
  const items = Array.isArray(x) ? x.map((v) => inner + lined(v, inner)) : Object.entries(x).map(([k, v]) => `${inner}${JSON.stringify(k)}: ${lined(v, inner)}`);
  const [open, shut] = Array.isArray(x) ? '[]' : '{}';
  return `${open}\n${items.join(',\n')}\n${pad}${shut}`;
}

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
    [LONG, 7], // a long line is still heard: nothing caps or mutes by length
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

pin("a triangle at 0.07 and a sine at 0.025, both dry, straight onto the voices' own bus", () => {
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
    assert.deepEqual(b.to, ['voice'], `the ${b.wave}'s gain goes only to the voices' bus (dry: nothing to the reverb; nothing to the effects' bus)`);
  }
  assert.deepEqual(blips.map((b) => b.wave), Array(3).fill(['triangle', 'sine']).flat());
});

pin("the voice path: the voices' bus at the sfx level × 0.7, the master at 0.9, the compressor at −14 dB and 6:1", () => {
  const r = rig();
  const voice = named(r, 'voice'),
    master = named(r, 'master'),
    comp = named(r, 'compressor');
  assert.ok(voice && master && comp, "the voices' bus, master and compressor are all there");
  const outOf = (n: FakeNode) => n.out.map((o) => r.names.get(o));
  assert.deepEqual(outOf(voice), ['master'], "the voices' bus feeds the master");
  assert.deepEqual(outOf(master), ['compressor'], 'the master feeds the compressor');
  assert.deepEqual(outOf(comp), ['out'], 'the compressor feeds the speakers');
  const set = (n: FakeNode) => r.setup.filter((e) => e.node === n && e.op.endsWith('.value')).map((e) => [e.op, e.v]);
  assert.deepEqual(set(master), [['gain.value', 0.9]]);
  assert.deepEqual(set(comp), [
    ['threshold.value', -14],
    ['ratio.value', 6],
  ]);
  const [level, tc] = target(r, voice)!;
  close(level, 0.8 * 0.7, "the voices' bus at the stream page's sfx level, 0.8");
  close(tc, 0.1, 'settling in 0.1 s');
  r.audio.levels({ sfx: 1 });
  close(target(r, voice)![0], 0.7, "the voices' bus at full");
  // So a syllable's triangle reaches the compressor at 0.07 × 0.56 × 0.9 at the stream's default level.
  close(0.07 * level * 0.9, 0.03528, 'a syllable into the compressor');
});

// FK-163 (the mix director) is expected to change the effects' bus. That card relaxes this pin's
// effects' half (and audio-replay.test.ts's "beside it") through Sami's Approve, as the rule asks; the
// voices' rows pinned here and the approved record stay as they are.
pin("the voices' bus is the sfx bus's twin (FK-162): made the same way, at the same level, and N on /mayor (sfx 0) mutes both", () => {
  const r = rig();
  const sfx = named(r, 'sfx'),
    voice = named(r, 'voice');
  assert.ok(sfx && voice, "two buses follow the sfx level: the effects' and the voices'");
  const made = (n: FakeNode) => rows(r, r.setup.filter((e) => e.node === n), 0).map((row) => row.slice(1));
  assert.deepEqual(made(voice), made(sfx), "the voices' bus is made just as the effects' is");
  assert.deepEqual(made(voice), [
    ['create', 'gain'],
    ['connect', 'master'],
    ['gain.setTargetAtTime', 0.56, 0, 0.1],
  ]);
  // The stream page's level, full, a quarter, and N on /mayor (the operator's sfx at 0, main.ts).
  for (const x of [0.8, 1, 0.25, 0]) {
    r.audio.levels({ sfx: x });
    assert.deepEqual(target(r, voice), target(r, sfx), `sfx ${x}: the voices follow the effects`);
    close(target(r, voice)![0], x * 0.7, `sfx ${x}: the voices' bus`);
  }
  // The music and the ambience leave the voices alone.
  r.audio.levels({ sfx: 0.8, music: 0, ambience: 0 });
  close(target(r, voice)![0], 0.56, "music and ambience at 0: the voices' bus stays at 0.56");
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

pin('a NaN half from the camera never reaches a gain (exponentialRampToValueAtTime would throw): listen() keeps the last good one', () => {
  const r = rig();
  r.audio.listen(0, 0, 8);
  r.audio.listen(0, 0, NaN); // a perspective camera can pass one
  // The fake throws on a non-finite value, as a browser does. The line plays as at half 8 (FK-158).
  const { evs, blips } = say(r, 1, 'hello there', { at: { x: 3, z: 4 } });
  for (const e of evs) if (typeof e.v === 'number') assert.ok(Number.isFinite(e.v), `${e.op}: ${e.v}`);
  close(blips.find(tri)?.peak, sig(0.07 * (1.15 - 5 / (8 * 1.4 + 12))), '5 from the camera at half 8');
});

pin('seedOf: each speaker keeps their voice (this copy is still the line in main.ts)', () => {
  const main = fs.readFileSync(MAIN_TS, 'utf8');
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

pin("main.ts feeds speech() every new line in the speaker's own voice, the head's low, at the stream's sfx level", () => {
  const lines = fs.readFileSync(MAIN_TS, 'utf8').split('\n');
  assert.ok(
    lines.some((l) => l.trim() === SPEECH),
    "client/dudes/main.ts no longer has this exact call: a changed seed, text, place or low voice changes how speakers sound",
  );
  assert.equal(lines.filter((l) => l.includes('audio.speech(')).length, 1, 'main.ts calls speech() from that one line only');
  // A fragment ends at its own `,` or ` }`, so `* 1.25 * 0.5` or `0.85` doesn't pass for it.
  const has = (l: string, frag: string) => l.includes(`${frag},`) || l.includes(`${frag} }`);
  const made = lines.filter((l) => l.includes('createAudio(') && !l.includes('import'));
  assert.equal(made.length, 1, 'main.ts makes its audio once');
  assert.ok(has(made[0], `sfx: level('sfx', ${LEVELS.sfx})`), `the stream page starts the sfx bus at ${LEVELS.sfx}, as LEVELS here says`);
  const operator = lines.filter((l) => l.includes('audio.levels(') && l.includes('sfx'));
  assert.ok(operator.length > 0 && operator.every((l) => has(l, SFX_OPERATOR)), `the operator's slider sets the sfx bus as ${SFX_OPERATOR}`);
});

pin('the blips are the ones Sami approved (client/dudes/audio-approved.json)', () => {
  const approved = JSON.parse(fs.readFileSync(APPROVED, 'utf8')) as Approved;
  assert.match(approved.voice.hash, /^[0-9a-f]{64}$/, 'audio-approved.json has a voice hash');
  const record = golden(),
    hash = hashOf(record);
  assert.equal(hashOf(golden()), hash, 'the record comes out the same every time');
  // The record, written down so a change can be diffed: to AUDIO_VOICE_RECORD whenever it names a file
  // (run it so on main for the approved one), and otherwise to a temp file when the hash has moved.
  const out = process.env.AUDIO_VOICE_RECORD || (hash === approved.voice.hash ? '' : path.join(os.tmpdir(), `audio-voice-${hash.slice(0, 12)}.json`));
  if (out) fs.writeFileSync(out, `${lined(record)}\n`);
  assert.equal(
    hash,
    approved.voice.hash,
    `The speech blips changed: they hash to ${hash}, and Sami approved ${approved.voice.hash} (${approved.voice.by}, ${approved.voice.date}). ` +
      "The tests above say what changed; if this is the only one failing, it is something they don't spell out (a detune, another parameter, a new node). " +
      `This record is in ${out}: write the approved one with AUDIO_VOICE_RECORD=/tmp/audio-voice-approved.json npx tsx --test scripts/audio-voice.test.ts in a checkout of main, and diff the two.`,
  );
});
