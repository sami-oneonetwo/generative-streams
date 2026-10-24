// The sound board's workings (FK-159), apart from the page so the tests can run them: the voices and
// the crowd, the cues as the page lays them out, the board's output (the phone speaker and the meter
// sit between the town and the speakers) and the context it hands createAudio(). Nothing here changes
// how anything sounds: the board plays client/dudes/audio.ts exactly as the stream does.
import type { AudioHandles, Cue } from '../dudes/audio';

type At = { x: number; z: number };

// --- voices ---

/** A copy of seedOf in client/dudes/main.ts (scripts/audio-board.test.ts checks it is still that line): a speaker's id to the seed their voice comes from. */
export const seedOf = (id: string) => [...id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);

export interface Voice {
  label: string;
  seed: number;
  low: boolean;
}
/** The nine voices (a speaker's is their seed % 9), then the head's low one, from the id the Mayor speaks as (mayor.ts: `id: 'mayor'`). */
export const VOICES: readonly Voice[] = [...Array.from({ length: 9 }, (_, i) => ({ label: String(i + 1), seed: i, low: false })), { label: 'Mayor', seed: seedOf('mayor'), low: true }];

/** The speech tester's seed box: digits are a seed as they stand, anything else a speaker's id (`dev:test-kev`, `kick:41871633`, `mayor`). */
export function seedFrom(input: string): number | undefined {
  const s = input.trim();
  if (!s) return undefined;
  return /^\d+$/.test(s) ? Number(s) >>> 0 : seedOf(s);
}

// --- where things play ---

/** Where the board's camera looks: the origin, at the stream's opening framing (main.ts: `half = 16`), so earshot reaches about 34 m. */
export const LISTEN = { x: 0, z: 0, half: 16 } as const;
/** How far from the camera the placed cues and the speech tester play. */
export const DISTANCES = [
  { key: 'near', label: 'Near', note: 'on camera', metres: 0 },
  { key: 'mid', label: 'Mid', note: '15 m out', metres: 15 },
  { key: 'far', label: 'Far', note: '30 m out', metres: 30 },
] as const;
export type Distance = (typeof DISTANCES)[number]['key'];
export const placeAt = (d: Distance): At => ({ x: LISTEN.x + DISTANCES.find((x) => x.key === d)!.metres, z: LISTEN.z });

// --- the cues ---

/** The clock's two parts in CUES ('music', 'birds'): the board plays them from Music, for as long as they are on, not as one-offs. */
export const CLOCK: readonly string[] = ['music', 'birds'];
/** A bed holds until it is stopped (`beds(0, 0)`). */
export const isBed = (c: Cue) => c.name.startsWith('beds:');

/** What each cue is on the stream: the moment it marks. A cue that lands without a line here shows its name alone. */
export const WHAT: Readonly<Record<string, string>> = {
  doorbell: 'a new neighbour',
  fanfare: 'a grand opening, a party',
  sting: 'a troublemaker turns up',
  built: 'a new build appears',
  hammer: 'someone building',
  coins: 'coins change hands',
  boom: 'an explosion',
  pew: 'a shot',
  bonk: 'someone knocked out',
  thud: 'a hit, a slam, a throw',
  bray: 'the donkey',
  whistle: "Wren's bone whistle",
  bell: 'the Call',
  'play:shoot': 'hoops',
  'play:swim': 'a swim',
  'play:strum': 'a strum',
  'play:jump': 'a jump',
  'play:swing': 'a swing',
  'play:kick': 'a kick',
  'play:punch': 'a punch',
  'play:lift': 'a lift',
  'play:other': 'any other pose',
  'burst:smoke': 'a teleport',
  'burst:confetti': 'confetti',
  'burst:hearts': 'hearts',
  'burst:sparkles': 'sparkles',
  'beds:engines': 'cars on the road',
  'beds:fountain': 'by the square',
};

export interface CueGroup {
  key: string;
  title: string;
  note: string;
  cues: Cue[];
}
const GROUPS: Readonly<Record<string, { title: string; note: string }>> = {
  '': { title: 'Town', note: 'the one-offs' },
  play: { title: 'Play', note: "doing a build's thing, by pose" },
  burst: { title: 'Bursts', note: "a bit's flourish" },
  beds: { title: 'Beds', note: 'hold until clicked again, one at a time' },
};
/**
 * Every cue but the clock, grouped by what comes before the colon in its name, in CUES order: so a cue
 * added to CUES (the whistle and the bell, FK-126) is on the board with nothing to change here.
 */
export function cueGroups(cues: readonly Cue[]): CueGroup[] {
  const by = new Map<string, Cue[]>(Object.keys(GROUPS).map((k) => [k, []]));
  for (const c of cues) {
    if (CLOCK.includes(c.name)) continue;
    const key = c.name.includes(':') ? c.name.slice(0, c.name.indexOf(':')) : '';
    by.set(key, [...(by.get(key) ?? []), c]);
  }
  return [...by].filter(([, cs]) => cs.length).map(([key, cs]) => ({ key, ...(GROUPS[key] ?? { title: key, note: '' }), cues: cs }));
}
/** A cue's button: the part after the colon ('play:strum' → 'strum'). */
export const cueLabel = (c: Cue) => c.name.slice(c.name.indexOf(':') + 1);

// --- the crowd ---

export interface Talker {
  id: string;
  name: string;
  seed: number;
  at: At;
}
const NAMES = ['Kev', 'Dana', 'Bo', 'Nia', 'Raj', 'Mo', 'Ivy', 'Sam', 'Lou', 'Ada', 'Finn', 'Zoe', 'Theo', 'Pip', 'Kai'];
export const CROWD_MAX = NAMES.length;
/** Chat as it comes in: short, shouty, an emote now and then (read as its name, as main.ts reads it). */
export const CROWD_LINES: readonly string[] = [
  'hi',
  'hello everyone',
  'red',
  'gold',
  'make my house gold',
  'build me a hut',
  'get me a pet dog',
  'lol [emote:37226:KEKW]',
  '7',
  'this town is amazing',
  'who broke the bridge',
  'wren is right',
  'us',
  'coming',
  'can i have a castle please',
  "where's my house",
  'gold gold gold',
  'LETS GOOO',
  'the mayor is up to something',
  'please build me a big house by the river',
];
/**
 * `n` chatters standing round the camera as a gathering does, 5 to 11 m out, each with a test chatter's
 * id (`dev:test-kev`, as /admin's Test chat names them) and so that chatter's voice.
 */
export function crowd(n: number, rand: () => number): Talker[] {
  return NAMES.slice(0, Math.max(0, Math.min(CROWD_MAX, n))).map((name, i) => {
    const turn = ((i + rand() * 0.4) / n) * Math.PI * 2,
      r = 5 + rand() * 6;
    const id = `dev:test-${name.toLowerCase()}`;
    return { id, name, seed: seedOf(id), at: { x: LISTEN.x + Math.cos(turn) * r, z: LISTEN.z + Math.sin(turn) * r } };
  });
}
/** How often each talker says something: a line every `every` seconds on average. */
export const RATES = [
  { key: 'chatty', label: 'Chatty', every: 8 },
  { key: 'busy', label: 'Busy', every: 4 },
  { key: 'rush', label: 'Rush', every: 2 },
] as const;
export type Rate = (typeof RATES)[number]['key'];
/**
 * The stream hears chat in snapshots, one at most every 500 ms (src/engine/loop.ts, BROADCAST_MIN_MS),
 * and main.ts plays every new line in a snapshot at once: so do the crowd's lines.
 */
export const SNAPSHOT_MS = 500;
/** One snapshot of the crowd: who speaks in it, and what. */
export function crowdLines(talkers: readonly Talker[], every: number, rand: () => number): [Talker, string][] {
  const chance = SNAPSHOT_MS / 1000 / every;
  return talkers.flatMap((t): [Talker, string][] => (rand() < chance ? [[t, CROWD_LINES[Math.floor(rand() * CROWD_LINES.length)]]] : []));
}

/** mulberry32: the crowd's random, so a crowd run twice says the same lines at the same moments. */
export const seeded = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

// --- the board's context and clock ---

/**
 * The context createAudio() is handed: the board's own, except that the town plays into `out` rather
 * than the speakers (the phone speaker and the meter sit in between), and that the town keeps no clock.
 * createAudio() takes a context that can render (an OfflineAudioContext) as one whose caller is the
 * clock: no 100 ms timer, nothing woken on a click, everything asked of it played (AudioOptions.ctx).
 * The board is that caller (tickClock): it runs the tune and the birds only while they are on, so a
 * stopped tune is silent, where the stream's M only turns the music bus down and leaves its reverb.
 */
export function boardContext<C extends BaseAudioContext>(ctx: C, out: AudioNode): C {
  return new Proxy(ctx, {
    get: (t, k) => {
      if (k === 'destination') return out;
      const v: unknown = Reflect.get(t, k, t);
      return typeof v === 'function' ? v.bind(t) : v;
    },
    has: (t, k) => k === 'startRendering' || Reflect.has(t, k),
  });
}
/** The board's clock beats every 100 ms, as the stream page's timer does. */
export const CLOCK_MS = 100;
/** One beat of the board's clock: the parts that are on, scheduled 0.4 s ahead. ahead(0.5) is exactly one of the page timer's ticks. */
export function tickClock(a: AudioHandles, tune: boolean, birds: boolean) {
  if (tune || birds) a.ahead(0.5, tune && birds ? undefined : tune ? 'music' : 'birds');
}

// --- the output: the phone speaker and the meter ---

export interface Output {
  /** Where the town plays into, in place of the speakers. */
  readonly input: AudioNode;
  /** A phone's speaker: 300 Hz–8 kHz, in mono; or the full sound. A 10 ms crossfade, so no click. */
  phone(on: boolean): void;
  /** Silent from now for `seconds`, then up: createAudio()'s buses glide from 1 to their levels in their first second. */
  hold(seconds: number): void;
  /** The last 2048 samples of each channel, as they reach the speakers (after the phone speaker). */
  sample(): Float32Array[];
}
/** The phone speaker's band: a phone has next to nothing under 300 Hz or over 8 kHz. */
export const PHONE = { low: 300, high: 8000 } as const;

/**
 * town → input → (full | mono → 2 highpasses at 300 Hz → 2 lowpasses at 8 kHz) → the speakers, with a
 * splitter and two analysers on the way out for the meter. Each pair of filters is 24 dB an octave.
 */
export function createOutput(ctx: BaseAudioContext): Output {
  const input = ctx.createGain(),
    full = ctx.createGain(),
    phone = ctx.createGain(),
    out = ctx.createGain();
  phone.gain.value = 0;
  // Stereo to mono: a gain of one channel, set explicitly, mixes L and R down (½(L + R)); the speakers
  // then hear it in both ears, as a phone held in front of you.
  const mono = ctx.createGain();
  mono.channelCount = 1;
  mono.channelCountMode = 'explicit';
  mono.channelInterpretation = 'speakers';
  let chain: AudioNode = input.connect(mono);
  for (const [type, freq] of [['highpass', PHONE.low], ['highpass', PHONE.low], ['lowpass', PHONE.high], ['lowpass', PHONE.high]] as const) {
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = Math.SQRT1_2;
    chain = chain.connect(f);
  }
  chain.connect(phone).connect(out);
  input.connect(full).connect(out);
  out.connect(ctx.destination);
  const split = ctx.createChannelSplitter(2);
  out.connect(split);
  const meters = [0, 1].map((ch) => {
    const a = ctx.createAnalyser();
    a.fftSize = 2048;
    split.connect(a, ch);
    return a;
  });
  const bufs = meters.map((a) => new Float32Array(a.fftSize));
  return {
    input,
    phone(on) {
      const t = ctx.currentTime;
      full.gain.setTargetAtTime(on ? 0 : 1, t, 0.01);
      phone.gain.setTargetAtTime(on ? 1 : 0, t, 0.01);
    },
    hold(seconds) {
      const t = ctx.currentTime;
      out.gain.cancelScheduledValues(t);
      out.gain.setValueAtTime(0, t);
      out.gain.setValueAtTime(0, t + seconds);
      out.gain.linearRampToValueAtTime(1, t + seconds + 0.1);
    },
    sample() {
      meters.forEach((a, i) => a.getFloatTimeDomainData(bufs[i]));
      return bufs;
    },
  };
}

/** Linear to dBFS (silence is −Infinity). */
export const dbfs = (x: number) => (x > 0 ? 20 * Math.log10(x) : -Infinity);
/** The loudest sample and the mean square across the channels (the louder channel's). */
export function measure(chans: readonly Float32Array[]) {
  let peak = 0,
    ms = 0;
  for (const d of chans) {
    let sum = 0;
    for (const s of d) {
      const a = Math.abs(s);
      if (a > peak) peak = a;
      sum += s * s;
    }
    if (d.length) ms = Math.max(ms, sum / d.length);
  }
  return { peak, ms };
}
/** What the meter shows, in dBFS: the peak now and held, the RMS, and the loudest of each since the last play. */
export interface Reading {
  peak: number;
  held: number;
  rms: number;
  playPeak: number;
  playRms: number;
}
/**
 * The meter: fed the output's samples each frame, at `t` seconds. The RMS settles over 300 ms (a VU's
 * pace); the peak holds for 1.5 s, then falls 20 dB a second. mark() starts a new play's maxima.
 */
export function createMeter(rmsSeconds = 0.3, holdSeconds = 1.5) {
  let ms = 0,
    held = 0,
    heldAt = -Infinity,
    last: number | undefined,
    playPeak = 0,
    playMs = 0;
  return {
    feed(chans: readonly Float32Array[], t: number): Reading {
      const now = measure(chans);
      const dt = last === undefined ? Infinity : Math.max(0, t - last);
      last = t;
      ms += (now.ms - ms) * (1 - Math.exp(-dt / rmsSeconds));
      if (now.peak >= held) {
        held = now.peak;
        heldAt = t;
      } else if (t - heldAt > holdSeconds) held = Math.max(now.peak, held * Math.pow(10, -Math.min(dt, t - heldAt - holdSeconds)));
      playPeak = Math.max(playPeak, now.peak);
      playMs = Math.max(playMs, ms);
      return { peak: dbfs(now.peak), held: dbfs(held), rms: dbfs(Math.sqrt(ms)), playPeak: dbfs(playPeak), playRms: dbfs(Math.sqrt(playMs)) };
    },
    mark() {
      playPeak = 0;
      playMs = 0;
    },
  };
}
