// FK-158: createAudio() takes its context, its random and its clock from the caller, so the town's
// sounds can be rendered offline (FK-161), fingerprinted (FK-160) and auditioned on /sounds (FK-159)
// the same way twice. These drive client/dudes/audio.ts on the fake Web Audio (scripts/audio-fake.ts)
// with a seeded random and Math.random off limits, and check every cue in CUES plays back event for
// event.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { CUES, createAudio, type AudioHandles, type AudioLevels, type Bus, type Cue } from '../client/dudes/audio';
import { FakeContext, FakeNode, FakeOfflineContext, FakeParam, seeded, type Ev } from './audio-fake';

/** The stream page's levels (main.ts, its createAudio call). */
const LEVELS: AudioLevels = { music: 0.5, sfx: 0.8, ambience: 0.6 };
/** Where placed cues play: 5 from the camera, at full. */
const HERE = { x: 3, z: 4 };
/** Too far from the camera to hear anything. */
const FAR = { x: 300, z: 400 };
const AUDIO_TS = path.join(import.meta.dirname, '..', 'client', 'dudes', 'audio.ts');

/** Runs `fn` with Math.random throwing: with a rand of its own, audio.ts must never reach for it. */
function noMathRandom<T>(fn: () => T): T {
  const random = Math.random;
  Math.random = () => {
    throw new Error('audio.ts called Math.random although it was given a rand');
  };
  try {
    return fn();
  } finally {
    Math.random = random;
  }
}

interface Made {
  audio: AudioHandles;
  ctx: FakeContext;
  /** The page's clock for the throttles, in ms: well past the page's start, and still unless a test moves it. */
  ms: number;
  /** What it asked of the page: timers (never started here) and the events it listens for. */
  timers: { tick: () => void; ms: number }[];
  listeners: string[];
  /** The nodes createAudio() itself made. */
  setup: FakeNode[];
}
/** createAudio() on a fake offline context (or `ctx`) with a seeded random and a clock of its own, the camera at the origin. */
function make(seed: number, ctx: FakeContext = new FakeOfflineContext()): Made {
  const m: Made = { ctx, ms: 10_000, timers: [], listeners: [], setup: [], audio: undefined as unknown as AudioHandles };
  const g = globalThis as unknown as Record<string, unknown>;
  const keep = { addEventListener: g.addEventListener, setInterval: g.setInterval };
  g.setInterval = (tick: () => void, ms: number) => m.timers.push({ tick, ms });
  g.addEventListener = (ev: string) => m.listeners.push(ev);
  try {
    m.audio = noMathRandom(() => createAudio(true, LEVELS, { ctx: ctx as unknown as OfflineAudioContext, rand: seeded(seed), now: () => m.ms }));
  } finally {
    for (const [k, v] of Object.entries(keep)) {
      if (v === undefined) delete g[k];
      else g[k] = v;
    }
  }
  m.setup = ctx.nodes.slice();
  m.audio.listen(0, 0, 20);
  return m;
}

/** Events as plain rows: nodes by the order they were made in, values exact. */
function rows(ctx: FakeContext, evs: Ev[]) {
  const ids = new Map(ctx.nodes.map((n, i) => [n, `#${i}`]));
  const id = (n: FakeNode) => ids.get(n)!;
  return evs.map((e) => [id(e.node), e.op, e.v instanceof FakeNode ? id(e.v) : e.v instanceof FakeParam ? `${id(e.v.node)}.${e.v.name}` : e.v, e.t, e.tc]);
}
/** Two event lists row for row; a failure shows the first row that differs, not thousands. */
function same(a: unknown[][], b: unknown[][], what: string) {
  let i = 0;
  while (i < a.length && i < b.length && JSON.stringify(a[i]) === JSON.stringify(b[i])) i++;
  assert.deepEqual({ rows: a.length, [`row ${i}`]: a[i] }, { rows: b.length, [`row ${i}`]: b[i] }, what);
}

/** What one call asked of the context. */
function heard(m: Made, fn: (a: AudioHandles) => void): Ev[] {
  const from = m.ctx.log.length;
  noMathRandom(() => fn(m.audio));
  return m.ctx.log.slice(from);
}
const play = (m: Made, cue: Cue, at = cue.placed ? HERE : undefined) => heard(m, (a) => cue.play(a, at));

/** The level a gain was last told to settle at. */
function target(m: Made, n: FakeNode) {
  for (let i = m.ctx.log.length - 1; i >= 0; i--) if (m.ctx.log[i].node === n && m.ctx.log[i].op === 'gain.setTargetAtTime') return m.ctx.log[i].v;
}
/**
 * The four buses, found by what they do: nudge a level and see which gains follow. The sfx level moves
 * two (FK-162): the effects' bus, which the engines' drone is wired into at set-up, and the voices' own,
 * which nothing createAudio() made is wired into.
 */
function buses(m: Made): Map<FakeNode, Bus> {
  const found = new Map<FakeNode, Bus>();
  const gains = m.ctx.nodes.filter((n) => n.kind === 'gain');
  for (const bus of ['music', 'sfx', 'ambience'] as const) {
    const before = gains.map((n) => target(m, n));
    heard(m, (a) => a.levels({ [bus]: 0.123 }));
    const moved = gains.filter((n, i) => target(m, n) !== before[i]);
    heard(m, (a) => a.levels(LEVELS));
    if (bus !== 'sfx') {
      assert.equal(moved.length, 1, `levels({ ${bus} }) moves one gain`);
      found.set(moved[0], bus);
      continue;
    }
    const fed = moved.filter((n) => m.setup.some((s) => s.out.includes(n)));
    assert.ok(moved.length === 2 && fed.length === 1, "levels({ sfx }) moves two gains: the effects' bus and the voices' bus, which nothing is wired into at set-up");
    found.set(fed[0], 'sfx');
    found.set(moved.find((n) => n !== fed[0])!, 'voice');
  }
  return found;
}

/** The buses a cue's sound goes through: from each source it starts and each gain it opens, down the wires (a reverb send has no bus). */
function busesHeard(evs: Ev[], bus: Map<FakeNode, Bus>): Bus[] {
  const sounding = evs.filter((e) => e.op === 'start' || (e.op.startsWith('gain.') && typeof e.v === 'number' && e.v > 0)).map((e) => e.node);
  const reached = new Set<Bus>(),
    seen = new Set<FakeNode>();
  const walk = (n: FakeNode) => {
    if (seen.has(n)) return;
    seen.add(n);
    const b = bus.get(n);
    if (b) reached.add(b);
    else n.out.forEach(walk);
  };
  sounding.forEach(walk);
  return [...reached].sort();
}

const madeBy = (evs: Ev[], kind: string) => evs.filter((e) => e.op === 'create' && e.node.kind === kind).length;
/** The kick drum's downbeats (on one and three of each bar): its 110 → 45 Hz glide ends 0.25 s in. */
const kicks = (evs: Ev[]) => evs.filter((e) => e.op === 'frequency.exponentialRampToValueAtTime' && e.v === 45).map((e) => e.t! - 0.25);
const BAR = (4 * 60) / 86;

// --- the tests ---

test('every cue, played twice from the same seed, asks for exactly the same thing', () => {
  assert.ok(CUES.length > 0);
  for (const cue of CUES) {
    const a = make(7),
      b = make(7);
    same(rows(a.ctx, a.ctx.log), rows(b.ctx, b.ctx.log), `${cue.name}: the set-up`);
    const first = play(a, cue),
      again = play(b, cue);
    assert.ok(first.length > 0, `${cue.name} plays something`);
    same(rows(a.ctx, first), rows(b.ctx, again), `${cue.name}: the second time is the first`);
  }
});

test('another seed changes the cues that have chance in them: the music, the birds and every noise', () => {
  for (const cue of CUES) {
    const a = make(7),
      b = make(8);
    const first = play(a, cue);
    const varies = JSON.stringify(rows(a.ctx, first)) !== JSON.stringify(rows(b.ctx, play(b, cue)));
    const chance = cue.name === 'music' || cue.name === 'birds' || madeBy(first, 'buffer-source') > 0;
    assert.equal(varies, chance, `${cue.name}: ${chance ? 'its random parts come from the seed' : 'nothing in it is left to chance'}`);
  }
});

test('the reverb and the noise are made from the seed', () => {
  const buffers = (m: Made) => {
    const reverb = m.ctx.nodes.find((n) => n.kind === 'convolver') as unknown as { buffer: AudioBuffer };
    const noise = m.ctx.nodes.find((n) => n.kind === 'buffer-source') as unknown as { buffer: AudioBuffer };
    return [reverb.buffer.getChannelData(0), reverb.buffer.getChannelData(1), noise.buffer.getChannelData(0)];
  };
  const [a, b, c] = [make(7), make(7), make(8)].map(buffers);
  a.forEach((d, i) => {
    assert.ok(d.some((x) => x !== 0), `buffer ${i} is filled`);
    assert.ok(d.length === b[i].length && d.every((x, j) => x === b[i][j]), `buffer ${i}: the same seed, the same buffer`);
    assert.ok(d.some((x, j) => x !== c[i][j]), `buffer ${i}: another seed, another buffer`);
  });
});

test('speech() takes its jitter, lengths and glides from the seed too', () => {
  const line = (m: Made) => rows(m.ctx, heard(m, (a) => a.speech(4, 'hello there friend', HERE)));
  const [a, b, c] = [make(7), make(7), make(8)].map(line);
  assert.ok(a.length > 0, 'the line plays');
  same(a, b, 'the same seed, the same line');
  assert.notEqual(JSON.stringify(a), JSON.stringify(c), 'another seed, another line');
});

test('every Math.random in audio.ts goes through rand: the one left is its default', () => {
  const calls = fs
    .readFileSync(AUDIO_TS, 'utf8')
    .split('\n')
    .filter((l) => l.includes('Math.random('));
  assert.deepEqual(calls.map((l) => l.trim()), ['const rand = opts.rand ?? (() => Math.random());']);
});

test('each cue is heard on the bus it names, and a placed cue fades out of earshot', () => {
  const names = CUES.map((c) => c.name);
  assert.equal(new Set(names).size, names.length, 'no two cues share a name');
  for (const cue of CUES) {
    const m = make(7);
    const handle = cue.name === 'music' || cue.name === 'birds' ? 'ahead' : cue.name.split(':')[0];
    assert.equal(typeof (m.audio as unknown as Record<string, unknown>)[handle], 'function', `${cue.name}: a handle called ${handle}`);
    const evs = play(m, cue);
    assert.deepEqual(busesHeard(evs, buses(m)), [cue.bus], `${cue.name} is heard on ${cue.bus}`);
    if (cue.placed) assert.equal(play(make(7), cue, FAR).length, 0, `${cue.name}: silent out of earshot`);
  }
});

test('speech() plays into the voice bus alone and no cue does; levels({ sfx: 0 }) silences both (FK-162)', () => {
  /** Where a call plays into: the nodes its connections reach that it didn't make itself, by bus or kind. */
  const into = (evs: Ev[], bus: Map<FakeNode, Bus>) => {
    const own = new Set(evs.filter((e) => e.op === 'create').map((e) => e.node));
    const outside = evs.flatMap((e) => (e.op === 'connect' && e.v instanceof FakeNode && !own.has(e.v) ? [e.v] : []));
    return [...new Set(outside.map((n) => bus.get(n) ?? n.kind))].sort();
  };
  const busNode = (bus: Map<FakeNode, Bus>, b: Bus) => [...bus].find(([, x]) => x === b)![0];
  const m = make(7);
  const bus = buses(m);
  assert.deepEqual([...bus.values()].sort(), ['ambience', 'music', 'sfx', 'voice']);
  const voice = busNode(bus, 'voice'),
    sfx = busNode(bus, 'sfx');
  assert.ok(voice.out.length === 1 && voice.out[0] === sfx.out[0] && sfx.out.length === 1, 'the voice bus feeds the master the sfx bus feeds, beside it (not through it)');
  for (const [text, at] of [
    ['hello there friend', HERE],
    ['Hello! Welcome to my town!', undefined],
  ] as const) {
    m.ms += 1000;
    const line = heard(m, (a) => a.speech(4, text, at));
    assert.ok(line.length > 0, `"${text}" plays`);
    assert.deepEqual(into(line, bus), ['voice'], `"${text}" plays into the voice bus and nothing else (no reverb send, not the sfx bus)`);
    assert.deepEqual(busesHeard(line, bus), ['voice']);
  }
  for (const cue of CUES) {
    const c = make(7);
    const evs = play(c, cue);
    const theirs = buses(c);
    assert.ok(evs.length > 0 && !into(evs, theirs).includes('voice'), `${cue.name} keeps off the voice bus`);
    assert.ok(!c.ctx.nodes.some((n) => n.out.includes(busNode(theirs, 'voice'))), `${cue.name}: nothing at all is wired into the voice bus`);
  }
  // N on /mayor sets the operator's sfx to 0, and the stream page passes it on: both buses go quiet,
  // just as the one sfx bus did; the music and the ambience don't move.
  const levels = () => Object.fromEntries([...bus].map(([n, b]) => [b, target(m, n)]));
  heard(m, (a) => a.levels({ sfx: 0 }));
  assert.deepEqual(levels(), { music: LEVELS.music * 0.32, sfx: 0, ambience: LEVELS.ambience * 0.5, voice: 0 });
  heard(m, (a) => a.levels({ sfx: LEVELS.sfx }));
  assert.deepEqual(levels(), { music: LEVELS.music * 0.32, sfx: LEVELS.sfx * 0.7, ambience: LEVELS.ambience * 0.5, voice: LEVELS.sfx * 0.7 });
});

test('the music cue is 32 bars of the town tune, and ahead() schedules the bars that start in its window', () => {
  const music = CUES.find((c) => c.name === 'music')!;
  const ks = kicks(play(make(7), music));
  assert.equal(ks.length, 64, 'a kick on one and three of 32 bars');
  assert.ok(Math.abs(ks.at(-2)! - 31 * BAR) < 1e-9, 'the last bar starts 31 bars in');
  // ahead(10): the four bars that start in the first 10 s (at 0, 2.8, 5.6 and 8.4 s), not the fifth at 11.2.
  const downbeats = kicks(heard(make(7), (a) => a.ahead(10))).filter((_, i) => i % 2 === 0);
  assert.deepEqual(
    downbeats.map((t) => Math.round((t / BAR) * 1e6) / 1e6),
    [0, 1, 2, 3],
  );
});

test('the throttles run on the clock it is given, not the real one', () => {
  const m = make(7);
  const fanfare = () => heard(m, (a) => a.fanfare()).length > 0;
  assert.equal(fanfare(), true, 'the first fanfare plays');
  assert.equal(fanfare(), false, 'a second in the same moment is held back');
  m.ms += 3999;
  assert.equal(fanfare(), false, '3999 ms later, still held');
  m.ms += 1;
  assert.equal(fanfare(), true, '4 s on, it plays again');
});

test("ahead() schedules just what the page's timer would have, tick for tick", () => {
  // The same seed on a live context, its timer run by hand every 100 ms.
  const live = make(7, new FakeContext());
  assert.deepEqual(
    live.timers.map((t) => t.ms),
    [100],
    'a live context gets the page timer, ten times a second',
  );
  const from = live.ctx.log.length;
  noMathRandom(() => {
    for (let i = 0; i / 10 + 0.4 < 30; i++) {
      live.ctx.currentTime = i / 10;
      live.timers[0].tick();
    }
  });
  const offline = make(7);
  const timed = rows(live.ctx, live.ctx.log.slice(from));
  assert.ok(kicks(live.ctx.log.slice(from)).length === 22, 'the timer played 11 bars in 30 s');
  same(rows(offline.ctx, heard(offline, (a) => a.ahead(30))), timed, '30 s of music and birds');
});

test('an offline context counts as running, with no timer and no wake-up listeners', () => {
  const m = make(7);
  assert.equal(m.ctx.state, 'suspended', 'an OfflineAudioContext is suspended until it renders');
  assert.equal(m.audio.on, true, 'and still plays everything asked of it');
  assert.equal(m.timers.length, 0, 'no timer: ahead() is its clock');
  assert.deepEqual(m.listeners, [], 'nothing to wake on a click');
  // A live context passed in is woken like the page's own.
  assert.deepEqual(make(7, new FakeContext()).listeners, ['pointerdown', 'keydown']);
});

test('listen() keeps the last good place and size when handed a NaN or an infinity', () => {
  const boom = CUES.find((c) => c.name === 'boom')!;
  const at = (fn: (a: AudioHandles) => void) => {
    const m = make(7);
    m.audio.listen(0, 0, 8);
    heard(m, fn);
    return rows(m.ctx, play(m, boom));
  };
  const good = at(() => {});
  assert.ok(good.length > 0, 'the boom is heard at half 8');
  for (const bad of [NaN, Infinity, -Infinity])
    for (const [what, fn] of [
      ['half', (a: AudioHandles) => a.listen(0, 0, bad)],
      ['x', (a: AudioHandles) => a.listen(bad, 0, 8)],
      ['z', (a: AudioHandles) => a.listen(0, bad, 8)],
    ] as const)
      same(at(fn), good, `${what} ${bad}`);
});

test('sound switched off still has every handle, ahead() included', () => {
  const off = createAudio(false, LEVELS);
  assert.equal(off.on, false);
  for (const cue of CUES) cue.play(off, HERE);
});
