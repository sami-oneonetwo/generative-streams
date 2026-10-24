// The speech blips are Sami's (FK-157; board/BOARD.md → Ground rules): "The noises as people speak
// right now are fantastic and I love them." Agents can't hear them, so this pins what they are made
// of. A fake Web Audio (client/sounds/fake.ts) writes down every node, connection, parameter ramp and
// start/stop that createAudio() and speech() ask for (client/dudes/audio.ts), with Math.random and the
// clock under the test's control. The tests spell the voice out one property at a time; the last one
// hashes all of it and compares the hash with client/dudes/audio-approved.json, which only Sami's
// Approve on /sounds writes (FK-160). Change a blip and this fails until he has heard it.
//
// The rig and the record live in client/sounds/voiceRecord.ts (lifted from here by FK-160), because the
// sound board fingerprints the blips with them to show and send what Sami approves. The rig here makes
// the town's sound the stream's way (createAudio() making its own context, as main.ts calls it), and
// a pin checks the board's way records exactly the same.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { createAudio } from '../client/dudes/audio';
import { emoteNames } from '../src/shared/emotes';
import { FakeContext, type FakeNode } from '../client/sounds/fake';
import { lined, printOf } from '../client/sounds/prints';
import {
  FALLOFF,
  LEVELS,
  LINES,
  LONG,
  ONE,
  PITCH_SEEDS,
  THROTTLE,
  named,
  peaksAt,
  pitchOf,
  rig as rigWith,
  rows,
  say,
  sig,
  sine,
  target,
  throttle,
  tri,
  usec,
  voiceRecord,
  later,
  type Maker,
} from '../client/sounds/voiceRecord';

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

// --- the rig: createAudio() as the stream page makes it, and lines through speech() ---

/**
 * The stream's way: createAudio() with no context handed in makes its own from window.AudioContext, as
 * main.ts's call does; here that is the fake. It also starts the music's timer and listens for a
 * click to wake on: neither ever fires here, so only speech() schedules anything.
 */
const live: Maker = (levels) => {
  const g = globalThis as unknown as Record<string, unknown>;
  const keep = { window: g.window, addEventListener: g.addEventListener, setInterval: g.setInterval };
  let ctx: FakeContext | undefined;
  g.window = {
    AudioContext: class extends FakeContext {
      constructor() {
        super();
        ctx = this;
      }
    },
  };
  g.addEventListener = () => {};
  g.setInterval = () => 0;
  try {
    return { audio: createAudio(true, levels), ctx: ctx! };
  } finally {
    for (const [k, v] of Object.entries(keep)) {
      if (v === undefined) delete g[k];
      else g[k] = v;
    }
  }
};
/** A fresh createAudio() the stream's way, at the stream page's levels, with its nodes named. */
const rig = () => rigWith(live);

/** A Math.random answering from a list, and loud if speech() asks it more often than it does today. */
const list = (...xs: number[]) => () => {
  if (!xs.length) throw new Error('speech() asked Math.random more often than its four times a syllable');
  return xs.shift()!;
};
const close = (got: number | undefined, want: number, what: string) =>
  assert.ok(got !== undefined && Math.abs(got - want) <= 1e-9 * Math.max(1, Math.abs(want)), `${what}: got ${got}, want ${want}`);

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

// --- the record ---

/** Everything the pins spell out, in one record (voiceRecord.ts), made the stream's way. Its hash is what Sami approves. */
const golden = () => voiceRecord(live);
const hashOf = (record: unknown) => createHash('sha256').update(JSON.stringify(record)).digest('hex');

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

// FK-160: the sound board shows and sends the blips' hash, and works it out its own way, in the page:
// createAudio() handed the fake as an offline context (no window to make one from), and sha-256 by hand
// (a browser keeps crypto.subtle for secure pages). So its record has to be this one, and its hash node's.
pin("the sound board fingerprints the blips as this guard does: its record (the board's way) is this one (the stream's), and its hash node's", () => {
  const board = voiceRecord(),
    stream = golden();
  assert.deepEqual(board, stream, 'the record made with the fake handed in is the one made the way main.ts makes its sound');
  assert.equal(printOf(board), hashOf(stream), "the board's sha-256 is node's");
});
