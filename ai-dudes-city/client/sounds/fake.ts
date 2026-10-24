// A fake Web Audio (lifted from scripts/audio-voice.test.ts by FK-158, so the cue tests use the very
// fake the speech-blip guard does; moved here from scripts/audio-fake.ts by FK-160, because the sound
// board runs it too: it fingerprints the voices and every cue in the browser, as the tests do, to show
// what Sami has approved). It writes down every node, connection, parameter ramp and start/stop asked
// of it, and like a browser it throws on a non-finite value, a time before zero or an exponential ramp
// to zero. Nothing here touches the page or the speakers.

export type Val = number | string | boolean;
export interface Ev {
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

export class FakeParam {
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

export class FakeNode {
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

export class FakeContext {
  readonly log: Ev[] = [];
  readonly nodes: FakeNode[] = [];
  readonly sampleRate = 48_000;
  currentTime = 0;
  state = 'running'; // as in OBS, which never waits for a click
  readonly destination = new FakeNode(this, 'destination');
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

/**
 * Like an OfflineAudioContext before it renders: its clock at 0, 'suspended', and a startRendering().
 * suspend(t) holds the render at `t` as a real one does (FK-160's renders play each part of a cue
 * there): startRendering() moves the clock to each in turn and lets what waits on it run first.
 */
export class FakeOfflineContext extends FakeContext {
  override state = 'suspended';
  private holds: { t: number; go: () => void }[] = [];
  suspend(t: number) {
    return new Promise<void>((go) => this.holds.push({ t: time(t, 'suspend'), go }));
  }
  async startRendering() {
    for (const h of this.holds.sort((a, b) => a.t - b.t)) {
      this.currentTime = h.t;
      h.go();
      await new Promise((r) => setTimeout(r, 0));
    }
    this.holds = [];
    return this.createBuffer(2, 1, this.sampleRate);
  }
}

/** mulberry32: a Math.random that gives the same numbers every run. */
export const seeded = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
