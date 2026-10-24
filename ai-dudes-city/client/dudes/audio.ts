// The town's sound, made on the spot with Web Audio: nothing to download, nothing licensed, and the
// music is never the same twice.
//
//   music     a mellow neighbourhood tune in the spirit of a life-sim's build mode: electric-piano
//             chords on jazzy progressions, a walking bass, brushed drums, a vibraphone line now and
//             then; a new progression and sometimes a new key every sixteen bars. Quiet, so it sits
//             under the streamer's voice.
//   ambience  birdsong, a soft town hum, the fountain when the camera is near the square.
//   effects   speech as cheerful gibberish blips (each character its own pitch), coins changing
//             hands, hammering while things go up, a chime when they are done, a doorbell for a new
//             neighbour, a fanfare and cheering for a grand opening, a sting for a troublemaker,
//             car engines and the odd bray, pops and booms. Quieter the further from the camera.
//
// Browsers only start sound after a click or a key (OBS's browser source does not wait); until
// then everything here is silently skipped.
//
// The caller may hand in the context, the random and the clock (FK-158): an OfflineAudioContext, a
// seeded random and a clock of its own play the same sound every time, for the sound board (/sounds),
// the offline render and level check, and the fingerprints Sami approves. CUES lists every sound.

export type Bus = 'music' | 'sfx' | 'ambience';
export interface AudioLevels {
  music: number; // 0..1
  sfx: number;
  ambience: number;
}
export interface AudioHandles {
  /** Where the camera is looking and how far out it is: effects fade with distance from here. */
  listen(x: number, z: number, half: number): void;
  levels(next: Partial<AudioLevels>): void;
  readonly on: boolean;
  /** One-off sounds; `at` places them (omitted: heard everywhere). */
  speech(seed: number, text: string, at?: { x: number; z: number }, low?: boolean): void;
  coins(at?: { x: number; z: number }): void;
  hammer(at?: { x: number; z: number }): void;
  built(at?: { x: number; z: number }): void;
  doorbell(): void;
  fanfare(): void;
  sting(): void;
  boom(at?: { x: number; z: number }): void;
  pew(at?: { x: number; z: number }): void;
  bonk(at?: { x: number; z: number }): void;
  thud(at?: { x: number; z: number }): void;
  bray(at?: { x: number; z: number }): void;
  /** The sound of doing a build's thing, by its pose: a swish, a splash, a strum, a boing. */
  play(pose: string | undefined, at?: { x: number; z: number }): void;
  /** A bit's flourish: a whoosh for a teleport, a chime for sparkles, a pop for confetti, a coo for hearts. */
  burst(kind: string | undefined, at?: { x: number; z: number }): void;
  /** Per frame: how loud the cars are (0..1, nearest moving ones) and how near the fountain is (0..1). */
  beds(engines: number, fountain: number): void;
  /**
   * The clock in one go: the bars of music and the birds that start in the next `seconds` from the
   * context's time, scheduled now just as the page's timer would have (a tick every 100 ms, each
   * looking 0.4 s ahead). An offline render needs it: its clock stands still until it renders, so it
   * asks once for the whole length. `only` runs one of the two, for a cue of its own.
   */
  ahead(seconds: number, only?: 'music' | 'birds'): void;
}
/** What createAudio plays into, where its random choices come from, and its clock. */
export interface AudioOptions {
  /**
   * Default: a new AudioContext. An OfflineAudioContext renders whatever is scheduled before it
   * starts, so it counts as running, with no timer and no wake-up listeners: ahead() is its clock.
   * A render that measures levels plays after the buses and the limiter settle (they glide from 1
   * to their levels for about a second): ctx.suspend(2), then play the cue, then ctx.resume().
   */
  ctx?: AudioContext | OfflineAudioContext;
  /** Every random choice: the reverb, the noise, the music, the birds, the blips (default Math.random). */
  rand?: () => number;
  /**
   * The page's clock in ms, for the throttles (default performance.now). A render passes its own: it
   * schedules faster than real time, and a page a moment old would still be inside the fanfare's 4 s.
   * Start it at least 6000 in (1e4, say): every throttle starts from 0, so below the bray's 6 s gap
   * the first call of a throttled cue is dropped.
   */
  now?: () => number;
}
type At = { x: number; z: number };
/** One of the town's sounds as the stream plays it: for /sounds (FK-159), the offline render (FK-161) and the fingerprints (FK-160). */
export interface Cue {
  /** The handle it calls, with the pose, kind or bed after a colon ('play:strum', 'beds:fountain'); the clock's two parts are 'music' and 'birds'. */
  name: string;
  /** The bus it is heard on (a reverb send skips the bus: see tone()). */
  bus: Bus;
  /** Whether `at` matters: a placed sound fades with distance from where the camera looks. */
  placed: boolean;
  /**
   * Plays it once on `a` (at `at` if it is placed) from the context's time now; a bed holds until
   * `a.beds(0, 0)`. Offline, play it once the context has settled (see AudioOptions.ctx).
   */
  play(a: AudioHandles, at?: At): void;
}

const NOTE = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

// Chords as semitones from the key's root: [bass root, chord tones above it].
type Chord = [number, number[]];
const PROGRESSIONS: Chord[][] = [
  // I maj7 – vi m7 – ii m7 – V7
  [[0, [4, 7, 11, 14]], [9, [3, 7, 10, 14]], [2, [3, 7, 10, 14]], [7, [4, 7, 10, 14]]],
  // IV maj7 – iii m7 – ii m7 – V9
  [[5, [4, 7, 11, 14]], [4, [3, 7, 10, 14]], [2, [3, 7, 10, 14]], [7, [4, 10, 14, 16]]],
  // I maj7 – IV maj7 – iii m7 – vi m7
  [[0, [4, 7, 11, 14]], [5, [4, 7, 11, 16]], [4, [3, 7, 10, 14]], [9, [3, 7, 10, 14]]],
  // ii m7 – V7 – I maj7 – I6
  [[2, [3, 7, 10, 14]], [7, [4, 7, 10, 13]], [0, [4, 7, 11, 14]], [0, [4, 7, 9, 14]]],
];
const SCALE = [0, 2, 4, 7, 9, 12, 14, 16]; // major pentatonic, for the vibraphone line
const BPM = 86;

export function createAudio(enabled: boolean, initial: AudioLevels, opts: AudioOptions = {}): AudioHandles {
  const ctx = enabled ? (opts.ctx ?? live()) : undefined;
  return ctx ? town(ctx, initial, opts) : silent();
}

/** The town's sound on `ctx`. */
function town(ctx: AudioContext | OfflineAudioContext, initial: AudioLevels, opts: AudioOptions): AudioHandles {
  // Looked up at each call by default, as Math.random and performance.now always were; seeded, two
  // runs are one sound.
  const rand = opts.rand ?? (() => Math.random());
  const pageNow = opts.now ?? (() => performance.now());
  const offline = 'startRendering' in ctx; // an OfflineAudioContext: see AudioOptions.ctx
  const master = ctx.createGain();
  master.gain.value = 0.9;
  // A gentle limiter so a busy moment never clips the stream's audio.
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -14;
  comp.ratio.value = 6;
  master.connect(comp).connect(ctx.destination);
  const buses: Record<Bus, GainNode> = { music: ctx.createGain(), sfx: ctx.createGain(), ambience: ctx.createGain() };
  for (const b of Object.values(buses)) b.connect(master);
  const levels: AudioLevels = { ...initial };
  const applyLevels = () => {
    buses.music.gain.setTargetAtTime(levels.music * 0.32, ctx.currentTime, 0.3);
    buses.sfx.gain.setTargetAtTime(levels.sfx * 0.7, ctx.currentTime, 0.1);
    buses.ambience.gain.setTargetAtTime(levels.ambience * 0.5, ctx.currentTime, 0.3);
  };
  applyLevels();
  // A room for the music and the chimes to sit in: a short synthetic reverb.
  const reverb = ctx.createConvolver();
  {
    const len = ctx.sampleRate * 1.6,
      buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (rand() * 2 - 1) * Math.pow(1 - i / len, 2.6);
    }
    reverb.buffer = buf;
  }
  const wet = ctx.createGain();
  wet.gain.value = 0.22;
  reverb.connect(wet).connect(master);
  const noise = (() => {
    const len = ctx.sampleRate * 2,
      buf = ctx.createBuffer(1, len, ctx.sampleRate),
      d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = rand() * 2 - 1;
    return buf;
  })();
  const running = () => offline || ctx.state === 'running';
  if (!offline) {
    // Sound needs a gesture in a normal browser; OBS starts it straight away.
    const wake = () => void ctx.resume().catch(() => {});
    for (const ev of ['pointerdown', 'keydown']) addEventListener(ev, wake, { once: false, passive: true });
    wake();
  }

  // --- the camera, for distance ---
  let lx = 0,
    lz = 0,
    lhalf = 20;
  const near = (at?: { x: number; z: number }) => {
    if (!at) return 1;
    const d = Math.hypot(at.x - lx, at.z - lz);
    const reach = lhalf * 1.4 + 12;
    return Math.max(0, Math.min(1, 1.15 - d / reach));
  };

  // --- building blocks ---
  function tone(freq: number, t: number, dur: number, opts: { type?: OscillatorType; gain?: number; attack?: number; bus?: Bus; detune?: number; glideTo?: number; send?: number; pan?: number } = {}) {
    const o = ctx.createOscillator();
    o.type = opts.type ?? 'sine';
    o.frequency.setValueAtTime(freq, t);
    if (opts.glideTo) o.frequency.exponentialRampToValueAtTime(opts.glideTo, t + dur);
    if (opts.detune) o.detune.value = opts.detune;
    const g = ctx.createGain();
    const peak = opts.gain ?? 0.2,
      a = opts.attack ?? 0.01;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let out: AudioNode = o.connect(g);
    if (opts.pan) {
      const p = ctx.createStereoPanner();
      p.pan.value = opts.pan;
      out = out.connect(p);
    }
    out.connect(buses[opts.bus ?? 'sfx']);
    if (opts.send) {
      const s = ctx.createGain();
      s.gain.value = opts.send;
      out.connect(s).connect(reverb);
    }
    o.start(t);
    o.stop(t + dur + 0.05);
  }
  function hiss(t: number, dur: number, opts: { freq: number; q?: number; gain?: number; bus?: Bus; type?: BiquadFilterType; attack?: number }) {
    const s = ctx.createBufferSource();
    s.buffer = noise;
    s.playbackRate.value = 0.8 + rand() * 0.4;
    const f = ctx.createBiquadFilter();
    f.type = opts.type ?? 'bandpass';
    f.frequency.value = opts.freq;
    f.Q.value = opts.q ?? 1;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(opts.gain ?? 0.2, t + (opts.attack ?? 0.005));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(buses[opts.bus ?? 'sfx']);
    s.start(t, rand());
    s.stop(t + dur + 0.05);
  }

  // --- music: a scheduler a little ahead of the clock ---
  const beat = 60 / BPM;
  let key = 53 - 12; // F
  let prog = PROGRESSIONS[0];
  let bar = 0,
    nextBarAt = 0,
    melodyNote = 4;
  function epiano(midi: number, t: number, dur: number, gain: number) {
    // Two partials and a soft bell on top: a cheap, warm electric piano.
    tone(NOTE(midi), t, dur, { type: 'sine', gain, attack: 0.012, bus: 'music', send: 0.25 });
    tone(NOTE(midi) * 2, t, dur * 0.5, { type: 'triangle', gain: gain * 0.18, attack: 0.008, bus: 'music', detune: 4 });
    tone(NOTE(midi) * 4, t, 0.25, { type: 'sine', gain: gain * 0.05, attack: 0.004, bus: 'music' });
  }
  function scheduleBar(t: number) {
    if (bar % 16 === 0 && bar > 0) {
      prog = PROGRESSIONS[Math.floor(rand() * PROGRESSIONS.length)];
      if (rand() < 0.35) key = 48 + [0, 2, 5, 7, 3][Math.floor(rand() * 5)] - 7;
    }
    const [root, tones] = prog[bar % prog.length];
    // Chords: on the one and, lazily, the "and" of two, a little late (swing feel).
    const voicing = tones.map((s) => key + 12 + root + s).map((m) => (m > key + 31 ? m - 12 : m));
    for (const [i, m] of voicing.entries()) epiano(m, t + i * 0.012, beat * 2.6, 0.05);
    if (rand() < 0.7) for (const m of voicing.slice(1)) epiano(m, t + beat * 1.66, beat * 1.2, 0.03);
    // Walking bass: root, a passing note, the fifth, a lead-in to the next chord.
    const next = prog[(bar + 1) % prog.length][0];
    const walk = [root, root + (rand() < 0.5 ? 2 : 4), root + 7, next + (rand() < 0.5 ? -1 : 1)];
    walk.forEach((s, i) => tone(NOTE(key - 12 + s), t + i * beat, beat * 0.9, { type: 'triangle', gain: 0.16, attack: 0.02, bus: 'music' }));
    // Brushes: a soft kick on one and three, a swish on every beat, swung hats.
    for (let i = 0; i < 4; i++) {
      const bt = t + i * beat;
      if (i % 2 === 0) tone(110, bt, 0.25, { type: 'sine', gain: 0.18, attack: 0.003, bus: 'music', glideTo: 45 });
      hiss(bt, beat * 0.7, { freq: 4500, q: 0.6, gain: i % 2 ? 0.035 : 0.022, bus: 'music', attack: 0.04 });
      hiss(bt + beat * 0.66, 0.05, { freq: 8000, q: 1.2, gain: 0.025, bus: 'music', type: 'highpass' });
    }
    // Now and then a vibraphone line wanders over the top.
    if (bar % 8 >= 4 && rand() < 0.8)
      for (let i = 0; i < 4; i++) {
        if (rand() < 0.35) continue;
        melodyNote = Math.max(0, Math.min(SCALE.length - 1, melodyNote + Math.round((rand() - 0.5) * 3)));
        const m = key + 24 + SCALE[melodyNote];
        const bt = t + i * beat + (i % 2 ? beat * 0.16 : 0);
        tone(NOTE(m), bt, beat * 1.6, { type: 'sine', gain: 0.05, attack: 0.005, bus: 'music', send: 0.5 });
        tone(NOTE(m) * 3.01, bt, 0.3, { type: 'sine', gain: 0.012, attack: 0.003, bus: 'music' });
      }
    bar++;
  }

  // --- ambience: birds now and then, a hum underneath, the fountain when near ---
  let nextBirdAt = 0;
  function bird(t: number) {
    const base = 2400 + rand() * 1800,
      n = 2 + Math.floor(rand() * 4),
      pan = rand() * 1.4 - 0.7;
    for (let i = 0; i < n; i++) tone(base * (1 + rand() * 0.25), t + i * 0.11, 0.08, { type: 'sine', gain: 0.03, attack: 0.005, bus: 'ambience', glideTo: base * (0.75 + rand() * 0.6), pan });
  }
  const bed = (freq: number, q: number, type: BiquadFilterType) => {
    const s = ctx.createBufferSource();
    s.buffer = noise;
    s.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.value = 0;
    s.connect(f).connect(g);
    s.start();
    return g;
  };
  const hum = bed(260, 0.4, 'lowpass');
  hum.connect(buses.ambience);
  hum.gain.value = 0.05;
  const fountainBed = bed(1800, 0.5, 'bandpass');
  fountainBed.connect(buses.ambience);
  // Engines: a low saw through a filter, as loud as the nearest moving car.
  const engine = ctx.createOscillator();
  engine.type = 'sawtooth';
  engine.frequency.value = 52;
  const engineFilter = ctx.createBiquadFilter();
  engineFilter.type = 'lowpass';
  engineFilter.frequency.value = 380;
  const engineGain = ctx.createGain();
  engineGain.gain.value = 0;
  engine.connect(engineFilter).connect(engineGain).connect(buses.sfx);
  engine.start();

  // The clock: a quarter of a second ahead, checked ten times a second (offline: by ahead()).
  function tick(now: number, only?: 'music' | 'birds') {
    if (only !== 'birds') {
      if (nextBarAt < now) nextBarAt = now + 0.1;
      while (nextBarAt < now + 0.4) {
        scheduleBar(nextBarAt);
        nextBarAt += beat * 4;
      }
    }
    if (only !== 'music' && now > nextBirdAt) {
      bird(now + 0.05);
      nextBirdAt = now + 2 + rand() * 6;
    }
  }
  if (!offline)
    setInterval(() => {
      if (running()) tick(ctx.currentTime);
    }, 100);

  // Effects within a burst of each other are thinned (a crowd talking is not a wall of blips).
  const last = new Map<string, number>();
  const gap = (kind: string, ms: number) => {
    const t = pageNow();
    if ((last.get(kind) ?? 0) > t - ms) return false;
    last.set(kind, t);
    return true;
  };
  const when = () => ctx.currentTime + 0.02;

  return {
    get on() {
      return running();
    },
    listen(x, z, half) {
      // A camera mid-change can hand over a NaN (a perspective one, say), and a NaN gain throws:
      // keep the last good place and size instead.
      if (Number.isFinite(x) && Number.isFinite(z)) {
        lx = x;
        lz = z;
      }
      if (Number.isFinite(half)) lhalf = half;
    },
    levels(next) {
      Object.assign(levels, next);
      applyLevels();
    },
    speech(seed, text, at, low) {
      const v = near(at);
      if (!running() || v < 0.05 || !gap(`say:${seed}`, 400)) return;
      // Gibberish: a syllable a word, up to seven, each a little bend at the character's own pitch.
      const base = (low ? 150 : 230) + (seed % 9) * (low ? 8 : 22);
      const words = Math.min(7, Math.max(2, text.split(/\s+/).length));
      let t = when();
      for (let i = 0; i < words; i++) {
        const f = base * (0.85 + rand() * 0.45);
        const d = 0.07 + rand() * 0.06;
        tone(f, t, d, { type: 'triangle', gain: 0.07 * v, attack: 0.01, glideTo: f * (rand() < 0.5 ? 1.25 : 0.82) });
        tone(f * 2, t, d * 0.8, { type: 'sine', gain: 0.025 * v, attack: 0.01 });
        t += d + 0.03 + rand() * 0.05;
      }
    },
    coins(at) {
      const v = near(at);
      if (!running() || v < 0.05 || !gap('coins', 250)) return;
      const t = when();
      tone(1568, t, 0.12, { type: 'square', gain: 0.035 * v, attack: 0.002 });
      tone(2093, t + 0.07, 0.35, { type: 'square', gain: 0.035 * v, attack: 0.002, send: 0.3 });
      hiss(t, 0.2, { freq: 6000, q: 2, gain: 0.03 * v });
    },
    hammer(at) {
      const v = near(at);
      if (!running() || v < 0.05) return;
      const t = when();
      tone(180, t, 0.08, { type: 'square', gain: 0.05 * v, attack: 0.001, glideTo: 90 });
      hiss(t, 0.06, { freq: 2500, q: 3, gain: 0.08 * v });
    },
    built(at) {
      const v = near(at);
      if (!running() || v < 0.05 || !gap('built', 600)) return;
      const t = when();
      [0, 4, 7, 12].forEach((s, i) => tone(NOTE(72 + s), t + i * 0.07, 0.6, { type: 'triangle', gain: 0.06 * v, attack: 0.005, send: 0.5 }));
    },
    doorbell() {
      if (!running() || !gap('door', 1500)) return;
      const t = when();
      tone(NOTE(76), t, 0.9, { type: 'sine', gain: 0.07, attack: 0.005, send: 0.5 });
      tone(NOTE(72), t + 0.35, 1.2, { type: 'sine', gain: 0.07, attack: 0.005, send: 0.5 });
    },
    fanfare() {
      if (!running() || !gap('fanfare', 4000)) return;
      const t = when();
      [0, 4, 7, 12, 7, 12].forEach((s, i) => {
        const d = i === 5 ? 1.1 : 0.16;
        tone(NOTE(67 + s), t + i * 0.15, d, { type: 'sawtooth', gain: 0.035, attack: 0.02, send: 0.4 });
        tone(NOTE(67 + s) * 1.003, t + i * 0.15, d, { type: 'sawtooth', gain: 0.025, attack: 0.02 });
      });
      // The crowd: a swell of noise like cheering.
      hiss(t + 0.5, 2.2, { freq: 1400, q: 0.5, gain: 0.08, attack: 0.4 });
    },
    sting() {
      if (!running() || !gap('sting', 4000)) return;
      const t = when();
      [7, 6, 5, 4].forEach((s, i) => tone(NOTE(55 + s), t + i * 0.22, i === 3 ? 0.7 : 0.2, { type: 'square', gain: 0.04, attack: 0.01, glideTo: i === 3 ? NOTE(55 + s) * 0.9 : undefined }));
    },
    boom(at) {
      const v = near(at);
      if (!running() || v < 0.05) return;
      const t = when();
      tone(80, t, 0.9, { type: 'sine', gain: 0.35 * v, attack: 0.002, glideTo: 30 });
      hiss(t, 0.8, { freq: 300, q: 0.4, gain: 0.25 * v, type: 'lowpass' });
    },
    pew(at) {
      const v = near(at);
      if (!running() || v < 0.05 || !gap('pew', 80)) return;
      tone(1400, when(), 0.15, { type: 'square', gain: 0.04 * v, attack: 0.002, glideTo: 300 });
    },
    bonk(at) {
      const v = near(at);
      if (!running() || v < 0.05 || !gap('bonk', 150)) return;
      tone(520, when(), 0.18, { type: 'triangle', gain: 0.1 * v, attack: 0.002, glideTo: 260 });
    },
    thud(at) {
      const v = near(at);
      if (!running() || v < 0.05 || !gap('thud', 150)) return;
      tone(120, when(), 0.2, { type: 'sine', gain: 0.15 * v, attack: 0.002, glideTo: 60 });
    },
    bray(at) {
      const v = near(at);
      if (!running() || v < 0.08 || !gap('bray', 6000)) return;
      // Hee… haw: up and down on a buzzy reed, twice.
      let t = when();
      for (let i = 0; i < 2; i++) {
        tone(520, t, 0.35, { type: 'sawtooth', gain: 0.03 * v, attack: 0.03, glideTo: 700 });
        tone(330, t + 0.38, 0.45, { type: 'sawtooth', gain: 0.035 * v, attack: 0.03, glideTo: 240 });
        t += 0.9;
      }
    },
    play(pose, at) {
      const v = near(at);
      if (!running() || v < 0.05 || !gap(`play:${pose}`, 300)) return;
      const t = when();
      switch (pose) {
        case 'shoot': // the bounce, the release, the swish of the net
          tone(140, t, 0.12, { type: 'sine', gain: 0.12 * v, attack: 0.002, glideTo: 90 });
          hiss(t + 0.45, 0.35, { freq: 5200, q: 0.8, gain: 0.09 * v, attack: 0.08 });
          break;
        case 'swim':
          hiss(t, 0.6, { freq: 900, q: 0.6, gain: 0.12 * v, attack: 0.02 });
          hiss(t + 0.08, 0.4, { freq: 3200, q: 1, gain: 0.05 * v });
          break;
        case 'strum':
          [0, 4, 7, 12, 16].forEach((s, i) => tone(NOTE(55 + s), t + i * 0.03, 1.2, { type: 'triangle', gain: 0.05 * v, attack: 0.003, send: 0.4 }));
          break;
        case 'jump':
          tone(220, t, 0.35, { type: 'sine', gain: 0.1 * v, attack: 0.005, glideTo: 660 });
          break;
        case 'swing':
          hiss(t, 0.25, { freq: 1800, q: 0.7, gain: 0.07 * v, attack: 0.1 });
          tone(900, t + 0.22, 0.08, { type: 'square', gain: 0.05 * v, attack: 0.001, glideTo: 400 });
          break;
        case 'kick':
        case 'punch':
          tone(160, t, 0.15, { type: 'sine', gain: 0.18 * v, attack: 0.002, glideTo: 70 });
          hiss(t, 0.08, { freq: 1500, q: 1, gain: 0.08 * v });
          break;
        case 'lift':
          tone(110, t, 0.3, { type: 'sawtooth', gain: 0.04 * v, attack: 0.03, glideTo: 95 });
          break;
        default:
          tone(NOTE(79), t, 0.25, { type: 'triangle', gain: 0.05 * v, attack: 0.004, send: 0.3 });
      }
    },
    burst(kind, at) {
      const v = near(at);
      if (!running() || v < 0.05 || !gap(`burst:${kind}`, 250)) return;
      const t = when();
      if (kind === 'smoke') hiss(t, 0.5, { freq: 700, q: 0.5, gain: 0.12 * v, attack: 0.03 });
      else if (kind === 'confetti') {
        tone(1200, t, 0.08, { type: 'square', gain: 0.05 * v, attack: 0.001, glideTo: 300 });
        hiss(t, 0.25, { freq: 5000, q: 0.7, gain: 0.06 * v });
      } else if (kind === 'hearts') [0, 7].forEach((s, i) => tone(NOTE(76 + s), t + i * 0.12, 0.5, { type: 'sine', gain: 0.05 * v, attack: 0.01, send: 0.4 }));
      else [0, 4, 7, 11, 14].forEach((s, i) => tone(NOTE(84 + s), t + i * 0.04, 0.5, { type: 'sine', gain: 0.035 * v, attack: 0.003, send: 0.5 }));
    },
    beds(engines, fountain) {
      if (!running()) return;
      const t = ctx.currentTime;
      engineGain.gain.setTargetAtTime(Math.min(1, engines) * 0.06, t, 0.25);
      engine.frequency.setTargetAtTime(48 + engines * 30, t, 0.4);
      fountainBed.gain.setTargetAtTime(fountain * 0.07, t, 0.4);
    },
    ahead(seconds, only) {
      if (!running() || !Number.isFinite(seconds)) return;
      const now = ctx.currentTime;
      for (let i = 0; i / 10 + 0.4 < seconds; i++) tick(now + i / 10, only);
    },
  };
}

/** The page's own context: a new AudioContext, if the browser has Web Audio. */
function live(): AudioContext | undefined {
  const Ctx = (window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext) as typeof AudioContext | undefined;
  return Ctx && new Ctx();
}

const placed = (name: string, play: (a: AudioHandles, at?: At) => void): Cue => ({ name, bus: 'sfx', placed: true, play });
/** Every sound but the blips (speech() is pinned on its own, scripts/audio-voice.test.ts), as main.ts calls them. */
export const CUES: readonly Cue[] = [
  { name: 'doorbell', bus: 'sfx', placed: false, play: (a) => a.doorbell() },
  { name: 'fanfare', bus: 'sfx', placed: false, play: (a) => a.fanfare() },
  { name: 'sting', bus: 'sfx', placed: false, play: (a) => a.sting() },
  placed('built', (a, at) => a.built(at)),
  placed('hammer', (a, at) => a.hammer(at)),
  placed('coins', (a, at) => a.coins(at)),
  placed('boom', (a, at) => a.boom(at)),
  placed('pew', (a, at) => a.pew(at)),
  placed('bonk', (a, at) => a.bonk(at)),
  placed('thud', (a, at) => a.thud(at)),
  placed('bray', (a, at) => a.bray(at)),
  // Each pose play() has a sound for, then the chime every other pose gets.
  ...['shoot', 'swim', 'strum', 'jump', 'swing', 'kick', 'punch', 'lift'].map((pose) => placed(`play:${pose}`, (a, at) => a.play(pose, at))),
  placed('play:other', (a, at) => a.play(undefined, at)),
  ...['smoke', 'confetti', 'hearts', 'sparkles'].map((kind) => placed(`burst:${kind}`, (a, at) => a.burst(kind, at))),
  { name: 'beds:engines', bus: 'sfx', placed: false, play: (a) => a.beds(1, 0) },
  { name: 'beds:fountain', bus: 'ambience', placed: false, play: (a) => a.beds(0, 1) },
  // The clock: 32 bars of the town tune (89 s), and a minute of birds (one call every 2–8 s).
  { name: 'music', bus: 'music', placed: false, play: (a) => a.ahead((32 * 4 * 60) / BPM, 'music') },
  { name: 'birds', bus: 'ambience', placed: false, play: (a) => a.ahead(60, 'birds') },
];

/** No sound at all (switched off, or no Web Audio). */
function silent(): AudioHandles {
  const nothing = () => {};
  return { on: false, burst: nothing, play: nothing, listen: nothing, levels: nothing, speech: nothing, coins: nothing, hammer: nothing, built: nothing, doorbell: nothing, fanfare: nothing, sting: nothing, boom: nothing, pew: nothing, bonk: nothing, thud: nothing, bray: nothing, beds: nothing, ahead: nothing };
}
