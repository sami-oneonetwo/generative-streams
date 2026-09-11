// Procedural music, synthesised in the page with Web Audio so the OBS browser
// source carries it. One theme per world; the mix follows the world state:
// weather, night, how crowded the street is, the character's body, and travel.
import type { World, WorldState } from '../shared/state.js';

const midiHz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

interface Theme {
  tempo: number;
  /** MIDI note of the tonic. */
  root: number;
  scale: number[];
  /** One chord per bar, as scale-degree indices. */
  progression: number[][];
  bassWave: OscillatorType;
  leadWave: OscillatorType;
  padWave: OscillatorType;
  kick: number[];
  snare: number[];
  hat: number[];
  tom: number[];
  shaker: number[];
  /** Chord-tone index per sixteenth, or null for no arpeggio. */
  arp: number[] | null;
  bassSteps: number[];
  leadDensity: number;
  leadOctave: number;
  padLevel: number;
  bassLevel: number;
  arpLevel: number;
  leadLevel: number;
  drumLevel: number;
  padCutoff: number;
  ambience: 'city' | 'wind' | 'meadow' | 'castle';
}

const MINOR = [0, 2, 3, 5, 7, 8, 10];
const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const PHRYGIAN_DOMINANT = [0, 1, 4, 5, 7, 8, 10];

const THEMES: Record<World, Theme> = {
  cyberpunk: {
    tempo: 92, root: 45, scale: MINOR,
    progression: [[0, 2, 4], [5, 0, 2], [2, 4, 6], [4, 6, 1]],
    bassWave: 'square', leadWave: 'square', padWave: 'sawtooth',
    kick: [0, 7, 8, 11], snare: [4, 12], hat: [0, 2, 4, 6, 8, 10, 12, 14], tom: [], shaker: [],
    arp: [0, 1, 2, 1, 0, 2, 1, 2], bassSteps: [0, 2, 4, 6, 8, 10, 12, 14],
    leadDensity: 0.5, leadOctave: 2,
    padLevel: 0.16, bassLevel: 0.2, arpLevel: 0.09, leadLevel: 0.11, drumLevel: 0.5, padCutoff: 1400,
    ambience: 'city',
  },
  desert: {
    tempo: 68, root: 50, scale: PHRYGIAN_DOMINANT,
    progression: [[0, 2, 4], [0, 2, 4], [0, 2, 4], [1, 3, 5]],
    bassWave: 'triangle', leadWave: 'triangle', padWave: 'sawtooth',
    kick: [], snare: [], hat: [], tom: [0, 6, 10, 14], shaker: [2, 6, 10, 14],
    arp: null, bassSteps: [0, 8],
    leadDensity: 0.3, leadOctave: 2,
    padLevel: 0.15, bassLevel: 0.12, arpLevel: 0, leadLevel: 0.14, drumLevel: 0.4, padCutoff: 700,
    ambience: 'wind',
  },
  countryside: {
    tempo: 84, root: 48, scale: MAJOR,
    progression: [[0, 2, 4], [4, 6, 1], [5, 0, 2], [3, 5, 0]],
    bassWave: 'triangle', leadWave: 'triangle', padWave: 'triangle',
    kick: [0, 8], snare: [], hat: [], tom: [], shaker: [0, 4, 8, 12],
    arp: [0, 1, 2, 1], bassSteps: [0, 6, 8, 14],
    leadDensity: 0.45, leadOctave: 2,
    padLevel: 0.14, bassLevel: 0.14, arpLevel: 0.07, leadLevel: 0.12, drumLevel: 0.3, padCutoff: 1800,
    ambience: 'meadow',
  },
  castle: {
    tempo: 60, root: 50, scale: MINOR,
    progression: [[0, 2, 4], [3, 5, 0], [4, 6, 1], [0, 2, 4]],
    bassWave: 'sawtooth', leadWave: 'square', padWave: 'square',
    kick: [0, 10], snare: [], hat: [], tom: [4, 12], shaker: [],
    arp: null, bassSteps: [0, 8],
    leadDensity: 0.3, leadOctave: 1,
    padLevel: 0.2, bassLevel: 0.14, arpLevel: 0, leadLevel: 0.1, drumLevel: 0.35, padCutoff: 900,
    ambience: 'castle',
  },
};

interface Params {
  enabled: boolean;
  volume: number;
  world: World;
  night: boolean;
  day: boolean;
  rain: boolean;
  storm: boolean;
  fog: boolean;
  /** 0..1 from how many things chat has placed. */
  intensity: number;
  danger: boolean;
  silent: boolean;
  thriving: boolean;
  spiritLow: boolean;
  fade: number; // 0..1 multiplier for travel
}

export class Music {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private musicBus!: GainNode;
  private ambBus!: GainNode;
  private heartBus!: GainNode;
  private delay!: DelayNode;
  private delaySend!: GainNode;
  private reverb!: ConvolverNode;
  private reverbSend!: GainNode;
  private noiseBuf!: AudioBuffer;
  private rainGain!: GainNode;
  private rumbleGain!: GainNode;
  private windGain!: GainNode;
  private humGain!: GainNode;
  private theme: Theme = THEMES.cyberpunk;
  private params: Params | null = null;
  private step = 0;
  private nextStepAt = 0;
  private leadDegree = 7;
  private nextBirdAt = 0;
  private timer: number | null = null;
  private localMute = false;
  needsGesture = false;

  constructor() {
    this.boot();
  }

  private boot(): void {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    this.ctx = ctx;
    const g = () => ctx.createGain();

    this.master = g();
    this.master.gain.value = 0;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.ratio.value = 4;
    this.master.connect(comp);
    comp.connect(ctx.destination);

    this.musicBus = g();
    this.ambBus = g();
    this.heartBus = g();
    this.heartBus.gain.value = 0;
    for (const b of [this.musicBus, this.ambBus, this.heartBus]) b.connect(this.master);

    // effects
    this.delay = ctx.createDelay(1.5);
    this.delay.delayTime.value = 0.375;
    const fb = g();
    fb.gain.value = 0.35;
    this.delay.connect(fb);
    fb.connect(this.delay);
    this.delaySend = g();
    this.delaySend.gain.value = 0.25;
    this.delaySend.connect(this.delay);
    this.delay.connect(this.musicBus);

    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.impulse(1.8);
    this.reverbSend = g();
    this.reverbSend.gain.value = 0.3;
    this.reverbSend.connect(this.reverb);
    this.reverb.connect(this.musicBus);

    // ambience beds
    this.noiseBuf = this.noise(2);
    this.rainGain = this.bed(2600, 'bandpass', 0.7);
    this.rumbleGain = this.bed(110, 'lowpass', 0.5);
    this.windGain = this.bed(480, 'lowpass', 0.4);
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.23;
    const lfoGain = g();
    lfoGain.gain.value = 0.35;
    lfo.connect(lfoGain);
    const windLevel = g();
    windLevel.gain.value = 1;
    lfoGain.connect(windLevel.gain);
    this.windGain.disconnect();
    this.windGain.connect(windLevel);
    windLevel.connect(this.ambBus);
    lfo.start();

    this.humGain = g();
    this.humGain.gain.value = 0;
    for (const f of [55, 55.6]) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      o.connect(this.humGain);
      o.start();
    }
    this.humGain.connect(this.ambBus);

    if (ctx.state === 'suspended') {
      this.needsGesture = true;
      const resume = () => {
        void ctx.resume().then(() => {
          this.needsGesture = false;
        });
        window.removeEventListener('pointerdown', resume);
        window.removeEventListener('keydown', resume);
      };
      window.addEventListener('pointerdown', resume);
      window.addEventListener('keydown', resume);
    }
    window.addEventListener('keydown', (e) => {
      if (e.key === 'm' || e.key === 'M') this.localMute = !this.localMute;
    });

    this.nextStepAt = ctx.currentTime + 0.1;
    this.timer = window.setInterval(() => this.schedule(), 90);
  }

  // -- state in -------------------------------------------------------------

  update(state: WorldState | null, now: number): void {
    if (!this.ctx) return;
    if (!state) {
      this.ramp(this.master, 0, 0.5);
      return;
    }
    const v = state.character.vitals;
    const needs = v ? [v.food, v.comfort, v.rest, v.spirit] : [100, 100, 100, 100];
    let fade = 1;
    if (state.transition) fade = clamp(1 - (now - state.transition.startedAt) / Math.max(1, state.transition.durationMs * 0.7), 0, 1);
    const p: Params = {
      enabled: (state.music?.enabled ?? true) && !this.localMute,
      volume: state.music?.volume ?? 0.6,
      world: state.world,
      night: state.time >= 20 || state.time < 6,
      day: state.time >= 9 && state.time < 17,
      rain: state.weather === 'rain',
      storm: state.weather === 'storm',
      fog: state.weather === 'fog',
      intensity: clamp(state.entities.filter((e) => e.addedBy !== 'world').length / 18, 0, 1),
      danger: Boolean(v?.collapsed),
      silent: Boolean(v?.blackout),
      thriving: needs.every((n) => n >= 75),
      spiritLow: (v?.spirit ?? 100) < 30,
      fade,
    };
    const worldChanged = this.params?.world !== p.world;
    this.params = p;
    if (worldChanged) {
      this.theme = THEMES[p.world] ?? THEMES.cyberpunk;
      this.leadDegree = 7;
      this.delay.delayTime.setTargetAtTime(60 / this.theme.tempo / 2, this.ctx.currentTime, 0.2);
    }

    const target = p.enabled && !p.silent ? p.volume * 0.9 * p.fade : 0;
    this.ramp(this.master, target, p.silent ? 0.6 : 1.2);
    this.ramp(this.musicBus, p.danger ? 0.12 : 1, 0.8);
    this.ramp(this.heartBus, p.danger ? 1 : 0, 0.5);

    // ambience follows weather and world
    const th = this.theme;
    const wet = th.ambience !== 'wind';
    this.ramp(this.rainGain, wet ? (p.storm ? 0.16 : p.rain ? 0.1 : 0) : 0, 2);
    this.ramp(this.rumbleGain, p.storm ? 0.12 : 0, 2);
    const windBase = th.ambience === 'wind' ? 0.07 : th.ambience === 'castle' ? 0.05 : 0.015;
    this.ramp(this.windGain, th.ambience === 'wind' && p.storm ? 0.3 : windBase + (p.night ? 0.01 : 0), 2);
    this.ramp(this.humGain, th.ambience === 'city' ? (p.night ? 0.045 : 0.025) : 0, 2);
  }

  // -- scheduler -------------------------------------------------------------

  private schedule(): void {
    const ctx = this.ctx;
    if (!ctx || !this.params) return;
    const stepDur = 60 / this.theme.tempo / 4;
    if (this.nextStepAt < ctx.currentTime - 0.5) this.nextStepAt = ctx.currentTime + 0.05; // after a stall, do not spray notes
    while (this.nextStepAt < ctx.currentTime + 0.35) {
      this.playStep(this.step, this.nextStepAt, stepDur);
      this.step++;
      this.nextStepAt += stepDur;
    }
    if (this.theme.ambience === 'meadow' && this.params.day && ctx.currentTime > this.nextBirdAt) {
      this.nextBirdAt = ctx.currentTime + 2 + Math.random() * 5;
      this.bird(ctx.currentTime + 0.05);
    }
  }

  private degreeHz(degree: number, octave: number): number {
    const th = this.theme;
    const idx = ((degree % th.scale.length) + th.scale.length) % th.scale.length;
    const oct = Math.floor(degree / th.scale.length);
    return midiHz(th.root + th.scale[idx] + 12 * (octave + oct));
  }

  private playStep(step: number, t: number, stepDur: number): void {
    const p = this.params!;
    const th = this.theme;
    const s16 = step % 16;
    const bar = Math.floor(step / 16);
    const chord = th.progression[bar % th.progression.length];
    const barDur = stepDur * 16;

    if (p.danger) {
      if (s16 % 8 === 0) {
        this.kick(t, 0.9, this.heartBus);
        this.kick(t + stepDur * 1.6, 0.6, this.heartBus);
      }
      if (s16 === 0) {
        this.voice('sawtooth', this.degreeHz(chord[0], 1), t, barDur, 0.06, { attack: 1.2, release: 1, cutoff: 500, dest: this.heartBus });
        this.voice('sawtooth', this.degreeHz(chord[0], 1) * Math.pow(2, 1 / 12), t, barDur, 0.05, { attack: 1.2, release: 1, cutoff: 500, dest: this.heartBus });
      }
      return;
    }
    if (p.silent) return;

    const quiet = p.spiritLow ? 0.6 : 1;
    const nightF = p.night ? 0.75 : 1;

    if (s16 === 0) {
      const cutoff = th.padCutoff * (p.night ? 0.7 : 1) * (p.fog ? 0.6 : 1);
      for (const [i, deg] of chord.entries()) {
        const detune = i === 1 ? 6 : i === 2 ? -6 : 0;
        this.voice(th.padWave, this.degreeHz(deg, 1), t, barDur * 1.05, th.padLevel * quiet * 0.5, { attack: barDur * 0.3, release: barDur * 0.4, cutoff, detune, reverb: 0.6 });
      }
    }

    if (th.bassSteps.includes(s16)) {
      const up = s16 === 12 || s16 === 14;
      this.voice(th.bassWave, this.degreeHz(chord[0], up ? 1 : 0), t, stepDur * 1.8, th.bassLevel * quiet, { attack: 0.005, release: 0.08, cutoff: 900 });
    }

    if (th.arp && p.intensity > 0.12) {
      const sparse = p.intensity < 0.5;
      if (!sparse || s16 % 2 === 0) {
        const idx = th.arp[s16 % th.arp.length];
        this.voice('square', this.degreeHz(chord[idx % chord.length], 2 + (idx >= 3 ? 1 : 0)), t, stepDur * 0.9, th.arpLevel * (0.5 + p.intensity * 0.5) * quiet, { attack: 0.002, release: 0.06, cutoff: 3000, delay: 0.5, pan: s16 % 2 ? 0.4 : -0.4 });
      }
    }

    const d = th.drumLevel * (p.night ? 0.8 : 1);
    if (th.kick.includes(s16)) this.kick(t, d * 0.9);
    if (th.snare.includes(s16)) this.snare(t, d * 0.6);
    if (th.hat.includes(s16) && (!p.night || s16 % 4 === 0) && p.intensity > 0.05) this.hat(t, d * (s16 % 4 === 0 ? 0.35 : 0.2));
    if (th.tom.includes(s16)) this.tom(t, d * 0.7, s16 === 0 ? 90 : 120);
    if (th.shaker.includes(s16) && (p.day || th.ambience !== 'wind')) this.hat(t, d * 0.15, 9000);

    const leadOn = p.thriving || bar % 8 >= 5;
    if (leadOn && s16 % 2 === 0 && Math.random() < th.leadDensity * nightF) {
      const stepChoices = [-2, -1, -1, 1, 1, 2, 0];
      this.leadDegree = clamp(this.leadDegree + stepChoices[Math.floor(Math.random() * stepChoices.length)], 0, 13);
      const hold = Math.random() < 0.3 ? stepDur * 4 : stepDur * 1.8;
      this.voice(th.leadWave, this.degreeHz(this.leadDegree, th.leadOctave), t, hold, th.leadLevel * quiet, { attack: 0.01, release: 0.12, cutoff: 2600, delay: 0.4, reverb: 0.3, vibrato: th.ambience === 'wind' ? 6 : 0 });
      if (th.ambience === 'wind' && Math.random() < 0.25) this.voice(th.leadWave, this.degreeHz(this.leadDegree + 1, th.leadOctave), t - stepDur * 0.25, stepDur * 0.3, th.leadLevel * 0.6, { attack: 0.005, release: 0.05, cutoff: 2600 });
    }
  }

  // -- instruments ----------------------------------------------------------------

  private voice(
    type: OscillatorType,
    hz: number,
    t: number,
    dur: number,
    level: number,
    o: { attack?: number; release?: number; cutoff?: number; detune?: number; delay?: number; reverb?: number; pan?: number; dest?: AudioNode; vibrato?: number } = {},
  ): void {
    const ctx = this.ctx!;
    if (t < ctx.currentTime) t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = hz;
    if (o.detune) osc.detune.value = o.detune;
    if (o.vibrato) {
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 5.5;
      const lg = ctx.createGain();
      lg.gain.value = o.vibrato;
      lfo.connect(lg);
      lg.connect(osc.detune);
      lfo.start(t);
      lfo.stop(t + dur + 0.5);
    }
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = o.cutoff ?? 4000;
    const env = ctx.createGain();
    const a = o.attack ?? 0.01;
    const r = o.release ?? 0.1;
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(Math.max(0.0002, level), t + a);
    env.gain.setValueAtTime(Math.max(0.0002, level), t + Math.max(a, dur));
    env.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(a, dur) + r);
    osc.connect(filter);
    filter.connect(env);
    let out: AudioNode = env;
    if (o.pan !== undefined && ctx.createStereoPanner) {
      const pan = ctx.createStereoPanner();
      pan.pan.value = o.pan;
      env.connect(pan);
      out = pan;
    }
    out.connect(o.dest ?? this.musicBus);
    if (o.delay) {
      const s = ctx.createGain();
      s.gain.value = o.delay;
      out.connect(s);
      s.connect(this.delaySend);
    }
    if (o.reverb) {
      const s = ctx.createGain();
      s.gain.value = o.reverb;
      out.connect(s);
      s.connect(this.reverbSend);
    }
    osc.start(t);
    osc.stop(t + Math.max(a, dur) + r + 0.05);
  }

  private kick(t: number, level: number, dest: AudioNode = this.musicBus): void {
    const ctx = this.ctx!;
    if (t < ctx.currentTime) t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(130, t);
    osc.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    const env = ctx.createGain();
    env.gain.setValueAtTime(level, t);
    env.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
    osc.connect(env);
    env.connect(dest);
    osc.start(t);
    osc.stop(t + 0.3);
  }

  private tom(t: number, level: number, hz: number): void {
    const ctx = this.ctx!;
    if (t < ctx.currentTime) t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(hz, t);
    osc.frequency.exponentialRampToValueAtTime(hz * 0.6, t + 0.25);
    const env = ctx.createGain();
    env.gain.setValueAtTime(level, t);
    env.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
    osc.connect(env);
    env.connect(this.musicBus);
    const s = ctx.createGain();
    s.gain.value = 0.4;
    env.connect(s);
    s.connect(this.reverbSend);
    osc.start(t);
    osc.stop(t + 0.45);
  }

  private snare(t: number, level: number): void {
    this.burst(t, level, 0.16, 'bandpass', 1900);
    this.burst(t, level * 0.5, 0.08, 'highpass', 4000);
  }

  private hat(t: number, level: number, hz = 7000): void {
    this.burst(t, level, 0.045, 'highpass', hz);
  }

  private burst(t: number, level: number, dur: number, type: BiquadFilterType, hz: number): void {
    const ctx = this.ctx!;
    if (t < ctx.currentTime) t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = hz;
    const env = ctx.createGain();
    env.gain.setValueAtTime(level, t);
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f);
    f.connect(env);
    env.connect(this.musicBus);
    src.start(t);
    src.stop(t + dur + 0.02);
  }

  private bird(t: number): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    const f0 = 2600 + Math.random() * 1500;
    osc.frequency.setValueAtTime(f0, t);
    osc.frequency.exponentialRampToValueAtTime(f0 * 1.3, t + 0.06);
    osc.frequency.exponentialRampToValueAtTime(f0 * 0.9, t + 0.14);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(0.04, t + 0.02);
    env.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    osc.connect(env);
    env.connect(this.ambBus);
    osc.start(t);
    osc.stop(t + 0.2);
  }

  // -- utilities -------------------------------------------------------------------

  private bed(hz: number, type: BiquadFilterType, q: number): GainNode {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = hz;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.value = 0;
    src.connect(f);
    f.connect(g);
    g.connect(this.ambBus);
    src.start();
    return g;
  }

  private noise(seconds: number): AudioBuffer {
    const ctx = this.ctx!;
    const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  private impulse(seconds: number): AudioBuffer {
    const ctx = this.ctx!;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.5);
    }
    return buf;
  }

  private ramp(node: GainNode, target: number, seconds: number): void {
    const ctx = this.ctx!;
    node.gain.cancelScheduledValues(ctx.currentTime);
    node.gain.setTargetAtTime(target, ctx.currentTime, Math.max(0.02, seconds / 3));
  }
}
