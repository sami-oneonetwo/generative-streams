// The sound board at /sounds (FK-159, client/sounds/): the page where Sami plays every cue, every
// voice and a crowd, because agents can't hear. These check that it plays the stream's own sound
// (client/dudes/audio.ts through the board's context asks for exactly what it asks on the stream,
// into the board's output instead of the speakers, and the board's clock ticks the tune as the
// stream page's timer does), that its voices are the stream's, that every cue is on it, that the
// phone speaker and the meter are what they say, that the crowd talks as chat does, and that the page
// is built, served from public/ and talks to no server.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { CUES, createAudio, type AudioHandles, type AudioLevels, type Cue } from '../client/dudes/audio';
import {
  CLOCK,
  CLOCK_MS,
  CROWD_LINES,
  CROWD_MAX,
  DISTANCES,
  LISTEN,
  PHONE,
  RATES,
  SNAPSHOT_MS,
  VOICES,
  WHAT,
  boardContext,
  createMeter,
  createOutput,
  crowd,
  crowdLines,
  cueGroups,
  cueLabel,
  dbfs,
  isBed,
  measure,
  placeAt,
  seedFrom,
  seedOf,
  seeded as crowdRandom,
  tickClock,
} from '../client/sounds/board';
import { FakeContext, FakeNode, FakeOfflineContext, FakeParam, seeded, type Ev } from './audio-fake';

const ROOT = path.join(import.meta.dirname, '..');
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8');
/** The stream page's levels (main.ts, its createAudio call). */
const LEVELS: AudioLevels = { music: 0.5, sfx: 0.8, ambience: 0.6 };

/** The fake Web Audio, with the two nodes only the board's output asks for: a splitter, and analysers that hear a steady 0.25. */
class BoardFake extends FakeContext {
  createChannelSplitter() {
    return new FakeNode(this, 'splitter');
  }
  createAnalyser() {
    return Object.assign(new FakeNode(this, 'analyser'), { fftSize: 2048, getFloatTimeDomainData: (b: Float32Array) => b.fill(0.25) });
  }
}
const asCtx = (c: FakeContext) => c as unknown as AudioContext;

interface Made {
  audio: AudioHandles;
  /** Where createAudio()'s own events start in the context's log. */
  from: number;
  timers: { tick: () => void; ms: number }[];
  listeners: string[];
  ms: number;
}
/** createAudio() on `ctx` with a seeded random and a still clock 10 s in, its timers and wake-up listeners caught, the camera where the board's looks. */
function make(ctx: AudioContext, log: FakeContext, seed = 7): Made {
  const m: Made = { audio: undefined as unknown as AudioHandles, from: log.log.length, timers: [], listeners: [], ms: 10_000 };
  const g = globalThis as unknown as Record<string, unknown>;
  const keep = { addEventListener: g.addEventListener, setInterval: g.setInterval };
  g.setInterval = (tick: () => void, ms: number) => m.timers.push({ tick, ms });
  g.addEventListener = (ev: string) => m.listeners.push(ev);
  try {
    m.audio = createAudio(true, LEVELS, { ctx, rand: seeded(seed), now: () => m.ms });
  } finally {
    for (const [k, v] of Object.entries(keep)) {
      if (v === undefined) delete g[k];
      else g[k] = v;
    }
  }
  m.audio.listen(LISTEN.x, LISTEN.z, LISTEN.half);
  return m;
}
/** The board's way: its output on a context, and createAudio() on the board's view of it. */
function board(seed = 7) {
  const ctx = new BoardFake();
  const out = createOutput(asCtx(ctx));
  return { ctx, out, ...make(boardContext(asCtx(ctx), out.input), ctx, seed) };
}
/** What a call asked of the context. */
function heard(ctx: FakeContext, fn: () => void): Ev[] {
  const from = ctx.log.length;
  fn();
  return ctx.log.slice(from);
}
/** Events as plain rows, nodes by kind, so two contexts compare; `speakers` is the node standing in for ctx.destination. */
const shape = (evs: Ev[], speakers?: FakeNode) => {
  const kind = (n: FakeNode) => (n === speakers ? 'destination' : n.kind);
  return evs.map((e) => [kind(e.node), e.op, e.v instanceof FakeNode ? kind(e.v) : e.v instanceof FakeParam ? `${kind(e.v.node)}.${e.v.name}` : e.v, e.t, e.tc]);
};
/** Two event lists row for row; a failure shows the first row that differs. */
function same(a: unknown[][], b: unknown[][], what: string) {
  let i = 0;
  while (i < a.length && i < b.length && JSON.stringify(a[i]) === JSON.stringify(b[i])) i++;
  assert.deepEqual({ rows: a.length, [`row ${i}`]: a[i] }, { rows: b.length, [`row ${i}`]: b[i] }, what);
}
const loudest = (evs: Ev[]) => Math.max(0, ...evs.filter((e) => e.op === 'gain.exponentialRampToValueAtTime' && typeof e.v === 'number').map((e) => e.v as number));

// --- the sound is the stream's ---

test("the board plays the stream's sound: createAudio() asks its context for the same set-up, cues and blips, into the board's output", () => {
  const b = board();
  const plain = new FakeOfflineContext();
  const p = make(asCtx(plain), plain);
  same(shape(b.ctx.log.slice(b.from), b.out.input as unknown as FakeNode), shape(plain.log.slice(p.from)), 'the set-up, the board output standing in for the speakers');
  const comp = b.ctx.nodes.find((n) => n.kind === 'compressor')!;
  assert.deepEqual(comp.out, [b.out.input], "the town's compressor plays into the board's output, not straight to the speakers");
  assert.equal(
    b.ctx.nodes.filter((n) => n.out.includes(b.ctx.destination)).length,
    1,
    'one node reaches the speakers: the end of the board output',
  );
  for (const cue of CUES.filter((c) => !CLOCK.includes(c.name))) {
    b.ms += 60_000;
    p.ms += 60_000;
    const at = cue.placed ? placeAt('near') : undefined;
    same(shape(heard(b.ctx, () => cue.play(b.audio, at))), shape(heard(plain, () => cue.play(p.audio, at))), cue.name);
  }
  for (const v of VOICES) {
    b.ms += 60_000;
    p.ms += 60_000;
    const line = (a: AudioHandles) => a.speech(v.seed, 'Hello! Welcome to my town!', placeAt('mid'), v.low);
    same(shape(heard(b.ctx, () => line(b.audio))), shape(heard(plain, () => line(p.audio))), `voice ${v.label}`);
  }
});

test("the board is the town's clock: no timer of the town's own, nothing woken on a click; tickClock beats as the stream page's timer", () => {
  const b = board();
  assert.deepEqual(b.timers, [], "no 100 ms timer: a stopped tune doesn't play on under a muted bus");
  assert.deepEqual(b.listeners, [], 'the board starts its context with its own click');
  assert.equal(CLOCK_MS, 100, 'the board beats ten times a second, as the page timer does');
  // The stream page: a live context, its own timer run by hand every 100 ms for 30 s.
  const live = new FakeContext();
  const l = make(asCtx(live), live);
  assert.equal(l.timers.length, 1);
  const beat = (ctx: FakeContext, fn: () => void) =>
    heard(ctx, () => {
      for (let i = 0; i / 10 + 0.4 < 30; i++) {
        ctx.currentTime = i / 10;
        fn();
      }
    });
  const page = beat(live, () => l.timers[0].tick());
  same(shape(beat(b.ctx, () => tickClock(b.audio, true, true))), shape(page), '30 s of the tune and the birds, tick for tick');
  // One part at a time: just the tune, just the birds, or nothing at all.
  const tuneOnly = board();
  const tune = beat(tuneOnly.ctx, () => tickClock(tuneOnly.audio, true, false));
  assert.ok(tune.some((e) => e.op === 'frequency.exponentialRampToValueAtTime' && e.v === 45), 'the tune: its kick drum');
  assert.ok(!tune.some((e) => e.op === 'pan.value'), 'and no birds (each bird call is panned)');
  const birdsOnly = board();
  const birds = beat(birdsOnly.ctx, () => tickClock(birdsOnly.audio, false, true));
  assert.ok(birds.some((e) => e.op === 'pan.value') && !birds.some((e) => e.v === 45), 'the birds without the tune');
  const quiet = board();
  assert.deepEqual(beat(quiet.ctx, () => tickClock(quiet.audio, false, false)), [], 'both off: nothing at all');
});

// --- voices ---

test("the board's voices are the stream's: seedOf is still main.ts's, nine voices and the Mayor's low one", () => {
  const body = 'seedOf = (id: string) => [...id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);';
  assert.ok(read('client/dudes/main.ts').split('\n').some((l) => l.trim() === `const ${body}`), "main.ts's seedOf is the one copied");
  assert.ok(read('client/sounds/board.ts').split('\n').some((l) => l.trim() === `export const ${body}`), "the board's copy is still that line");
  assert.equal(seedOf('dev:test-kev'), 841176557, 'as scripts/audio-voice.test.ts pins it');
  assert.equal(seedOf('mayor'), 304077409);
  assert.equal(VOICES.length, 10);
  assert.deepEqual(
    VOICES.slice(0, 9).map((v) => [v.seed % 9, v.low]),
    Array.from({ length: 9 }, (_, i) => [i, false]),
    'one of each of the nine voices',
  );
  assert.deepEqual(VOICES[9], { label: 'Mayor', seed: seedOf('mayor'), low: true }, "the head's low voice, as the Mayor speaks (mayor.ts: id 'mayor')");
  assert.match(read('src/worlds/ai-dudes/mayor.ts'), /id: 'mayor',/);
});

test('the seed box: digits are a seed as they stand, anything else a speaker id', () => {
  assert.equal(seedFrom('12'), 12);
  assert.equal(seedFrom(' 4294967297 '), 1, 'wraps as a seed does (a uint32)');
  assert.equal(seedFrom('dev:test-kev'), 841176557);
  assert.equal(seedFrom('mayor'), seedOf('mayor'));
  assert.equal(seedFrom('12a'), seedOf('12a'));
  assert.equal(seedFrom(''), undefined);
  assert.equal(seedFrom('   '), undefined);
});

// --- cues ---

test('every cue but the clock is on the board once, grouped by its name; a cue added to CUES lands on it unasked', () => {
  for (const n of CLOCK) assert.ok(CUES.some((c) => c.name === n), `${n} is a cue (the clock's part the Music section plays)`);
  const groups = cueGroups(CUES);
  const names = groups.flatMap((g) => g.cues.map((c) => c.name));
  assert.deepEqual(
    [...names].sort(),
    CUES.map((c) => c.name)
      .filter((n) => !CLOCK.includes(n))
      .sort(),
    'each once',
  );
  assert.deepEqual(
    groups.map((g) => g.title),
    ['Town', 'Play', 'Bursts', 'Beds'],
  );
  assert.deepEqual(groups[3].cues, CUES.filter(isBed), 'the beds hold');
  for (const n of names) assert.ok(WHAT[n], `${n}: a line saying what it marks on the stream`);
  assert.equal(cueLabel(CUES.find((c) => c.name === 'play:strum')!), 'strum');
  assert.equal(cueLabel(CUES.find((c) => c.name === 'doorbell')!), 'doorbell');
  // FK-126's whistle and bell, and a cue of a kind the board hasn't seen.
  const more: Cue[] = [...CUES, ...['whistle', 'bell', 'ui:pop'].map((name) => ({ name, bus: 'sfx' as const, placed: false, play: () => {} }))];
  const next = cueGroups(more);
  assert.deepEqual(next[0].cues.slice(-2).map((c) => c.name), ['whistle', 'bell'], 'story cues join the town one-offs');
  assert.deepEqual([next.at(-1)!.title, next.at(-1)!.cues.map((c) => c.name)], ['ui', ['ui:pop']], 'a new kind gets a group of its own');
});

test('where it plays: near is on the camera, mid and far are quieter and still in earshot', () => {
  assert.deepEqual(placeAt('near'), { x: LISTEN.x, z: LISTEN.z });
  const b = board();
  const boom = CUES.find((c) => c.name === 'boom')!;
  const levels = DISTANCES.map((d) => {
    b.ms += 60_000;
    return loudest(heard(b.ctx, () => boom.play(b.audio, placeAt(d.key))));
  });
  assert.equal(levels[0], 0.35, 'near: the boom at full');
  assert.ok(levels[0] > levels[1] && levels[1] > levels[2] && levels[2] > 0.05, `quieter with distance, far still heard: ${levels.join(', ')}`);
});

// --- the output ---

test('the output: the full sound or a phone (mono, 300 Hz–8 kHz, 24 dB an octave each side), then the speakers and the meter', () => {
  const ctx = new BoardFake();
  const out = createOutput(asCtx(ctx));
  const input = out.input as unknown as FakeNode;
  const set = (n: FakeNode, op: string) => ctx.log.filter((e) => e.node === n && e.op === op).map((e) => e.v);
  const [a, b] = input.out;
  const mono = [a, b].find((n) => (n as unknown as { channelCount?: number }).channelCount === 1)!;
  const full = [a, b].find((n) => n !== mono)!;
  assert.ok(mono && full && input.out.length === 2, 'the input splits two ways');
  assert.deepEqual(
    [(mono as unknown as AudioNode).channelCountMode, (mono as unknown as AudioNode).channelInterpretation],
    ['explicit', 'speakers'],
    'mono: L and R mixed down',
  );
  const filters: FakeNode[] = [];
  for (let n = mono.out[0]; n.kind === 'biquad'; n = n.out[0]) filters.push(n);
  assert.deepEqual(
    filters.map((f) => [set(f, 'type')[0], set(f, 'frequency.value')[0], set(f, 'Q.value')[0]]),
    [
      ['highpass', PHONE.low, Math.SQRT1_2],
      ['highpass', PHONE.low, Math.SQRT1_2],
      ['lowpass', PHONE.high, Math.SQRT1_2],
      ['lowpass', PHONE.high, Math.SQRT1_2],
    ],
  );
  assert.deepEqual([PHONE.low, PHONE.high], [300, 8000]);
  const phone = filters.at(-1)!.out[0];
  assert.deepEqual(set(phone, 'gain.value'), [0], 'the phone starts off');
  const end = full.out[0];
  assert.ok(phone.out[0] === end, 'both ways meet before the speakers');
  assert.deepEqual(end.out.map((n) => n.kind).sort(), ['destination', 'splitter']);
  const split = end.out.find((n) => n.kind === 'splitter')!;
  assert.deepEqual(split.out.map((n) => n.kind), ['analyser', 'analyser'], 'a meter on each channel');
  const target = (n: FakeNode) => set(n, 'gain.setTargetAtTime').at(-1);
  out.phone(true);
  assert.deepEqual([target(full), target(phone)], [0, 1], 'phone on: only the phone is heard');
  out.phone(false);
  assert.deepEqual([target(full), target(phone)], [1, 0], 'and off again');
  ctx.currentTime = 2;
  const hold = heard(ctx, () => out.hold(1.5)).map((e) => [e.op, e.v, e.t]);
  assert.deepEqual(hold, [
    ['gain.cancelScheduledValues', undefined, 2],
    ['gain.setValueAtTime', 0, 2],
    ['gain.setValueAtTime', 0, 3.5],
    ['gain.linearRampToValueAtTime', 1, 3.6],
  ]);
  const s = out.sample();
  assert.deepEqual([s.length, s[0].length, s[1][0]], [2, 2048, 0.25], "the last 2048 samples of each channel, from the analysers");
});

test('the meter: a half-scale sine peaks at −6.0 dBFS with an RMS of −9.0; the peak holds 1.5 s, then falls 20 dB a second', () => {
  const sine = (amp: number) => Float32Array.from({ length: 2048 }, (_, i) => amp * Math.sin((2 * Math.PI * 32 * i) / 2048));
  const silence = new Float32Array(2048);
  const r1 = (x: number) => Math.round(x * 10) / 10;
  const near = (x: { peak: number; ms: number }) => ({ peak: x.peak, ms: Math.round(x.ms * 1e6) / 1e6 }); // float32 samples
  assert.deepEqual(near(measure([sine(0.5)])), { peak: 0.5, ms: 0.125 });
  assert.deepEqual(near(measure([silence, sine(0.25)])), { peak: 0.25, ms: 0.03125 }, 'the louder channel');
  assert.equal(dbfs(1), 0);
  assert.equal(dbfs(0), -Infinity);
  const m = createMeter();
  const at = (chans: Float32Array[], t: number) => {
    const r = m.feed(chans, t);
    return Object.fromEntries(Object.entries(r).map(([k, v]) => [k, r1(v)]));
  };
  assert.deepEqual(at([sine(0.5), sine(0.5)], 10), { peak: -6, held: -6, rms: -9, playPeak: -6, playRms: -9 });
  const quiet = at([silence, silence], 11);
  assert.deepEqual([quiet.peak, quiet.held, quiet.playPeak], [-Infinity, -6, -6], 'held for 1.5 s; the play keeps its loudest');
  assert.equal(quiet.rms, r1(dbfs(Math.sqrt(0.125 * Math.exp(-1 / 0.3)))), 'the RMS settles over 300 ms');
  assert.equal(at([silence], 12).held, -16, 'half a second past the hold: 10 dB down');
  assert.equal(at([silence], 12.5).held, -26);
  m.mark();
  assert.equal(at([sine(0.25)], 12.6).playPeak, -12, 'a new play starts its own loudest');
});

// --- the crowd ---

test('the crowd: 6 or 15 test chatters in earshot, each in their own voice, on the snapshots at the chosen rate, the same crowd each run', () => {
  const six = crowd(6, crowdRandom(159));
  assert.equal(six.length, 6);
  assert.equal(crowd(15, crowdRandom(159)).length, CROWD_MAX);
  assert.equal(CROWD_MAX, 15);
  assert.equal(crowd(99, crowdRandom(1)).length, 15);
  assert.deepEqual(crowd(6, crowdRandom(159)), six, 'the same seed, the same crowd');
  const all = crowd(15, crowdRandom(159));
  assert.equal(new Set(all.map((t) => t.id)).size, 15);
  assert.equal(all[0].id, 'dev:test-kev', "a test chatter's id, as /admin's Test chat makes them");
  for (const t of all) {
    assert.equal(t.seed, seedOf(t.id));
    const d = Math.hypot(t.at.x - LISTEN.x, t.at.z - LISTEN.z);
    assert.ok(d >= 5 && d <= 11, `${t.name} stands 5 to 11 m out (${d.toFixed(1)})`);
  }
  // Every talker is heard where they stand.
  const b = board();
  for (const t of all) assert.ok(heard(b.ctx, () => b.audio.speech(t.seed, 'hello there', t.at)).length > 0, `${t.name} is heard`);
  // The rates: over 20 minutes of snapshots, each talker speaks about once every `every` seconds.
  assert.equal(SNAPSHOT_MS, 500);
  for (const r of RATES) {
    const rand = crowdRandom(42);
    let lines = 0;
    const snaps = (20 * 60 * 1000) / SNAPSHOT_MS;
    for (let i = 0; i < snaps; i++) lines += crowdLines(all, r.every, rand).length;
    const per = (lines / all.length / (snaps * SNAPSHOT_MS)) * 1000;
    assert.ok(Math.abs(per * r.every - 1) < 0.1, `${r.label}: a line every ${r.every} s (got one every ${(1 / per).toFixed(2)} s)`);
  }
  const run = () => {
    const rand = crowdRandom(159);
    return Array.from({ length: 40 }, () => crowdLines(all, 4, rand).map(([t, l]) => `${t.name}: ${l}`));
  };
  assert.deepEqual(run(), run(), 'the same lines at the same snapshots, run after run');
  const words = CROWD_LINES.map((l) => l.split(/\s+/).length);
  assert.ok(Math.min(...words) < 2 && Math.max(...words) > 7, 'lines short and long enough to reach both ends of the 2–7 syllables');
});

// --- the page ---

test('the page: every section labelled, every element the script asks for is in it, built into public/sounds/, and it talks to no server', () => {
  const html = read('client/sounds/index.html');
  const main = read('client/sounds/main.ts');
  const headings = [...html.matchAll(/<h2[^>]*>([^<]+)<\/h2>/g)].map((m) => m[1]);
  assert.deepEqual(headings, ['Cues', 'Speech', 'Crowd', 'Music', 'Meter', 'Phone speaker', 'Where it plays']);
  assert.match(html, /<button id="start"[^>]*>Start sound<\/button>/, 'the big Start button: browsers play nothing before a click');
  assert.match(html, /<main id="board" inert>/, 'nothing to press until the sound is on');
  const ids = new Set([...html.matchAll(/\bid="([\w-]+)"/g)].map((m) => m[1]));
  const asked = [...main.matchAll(/\$\('([\w-]+)'\)/g)].map((m) => m[1]);
  // And the ones the script builds from a name: the level sliders and their readouts, the two crowds.
  asked.push(...['music', 'sfx', 'ambience'].flatMap((k) => [`lv-${k}`, `lv-${k}-v`]), 'crowd-6', `crowd-${CROWD_MAX}`);
  assert.ok(main.includes('$(`lv-${k}`)') && main.includes('$(`lv-${k}-v`)') && main.includes('$(`crowd-${n}`)'));
  for (const id of asked) assert.ok(ids.has(id), `#${id} is in client/sounds/index.html`);
  assert.match(html, /<script src="\/sounds\/main\.js"><\/script>/);
  // It reads nothing from the server and writes nothing (FK-160's Approve is the first that will).
  for (const f of fs.readdirSync(path.join(ROOT, 'client/sounds')).filter((f) => f.endsWith('.ts')))
    assert.doesNotMatch(read(`client/sounds/${f}`), /\b(fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon|localStorage|indexedDB)\b/, `${f} talks to nothing`);
  // The build: the page to public/sounds/index.html (express.static serves it at /sounds/) and the script to /sounds/main.js.
  const build = read('scripts/build-client.mjs').split('\n');
  assert.ok(build.some((l) => l.startsWith("PAGES['client/sounds/index.html'] = 'public/sounds/index.html'; // hook FK-159")));
  assert.ok(build.some((l) => l.trim().startsWith("'sounds/main': 'client/sounds/main.ts', // hook FK-159")));
});
