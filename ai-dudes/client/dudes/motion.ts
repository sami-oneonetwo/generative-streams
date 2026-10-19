// Snapshot interpolation for the safehouse page.
//
// The server publishes the world twice a second. Drawing each snapshot where it lands
// makes everything that moves lurch — a dash to the new spot, then standing for the rest
// of the half second — because the page only ever knows where a thing *is*, never where
// it is going. So the page draws the world a little behind the server instead, about a
// snapshot and a half. At that moment it always holds the snapshot before and the one
// after, and slides every mover between them at the speed the server actually moved it.
// Server time drives the clock, so a snapshot that arrives late (a slow save on the
// server) neither stretches nor squashes the walk; the delay is there to absorb it.
//
// `Timeline` keeps that clock. A `Track` is one mover's recent samples. Everything
// discrete in a snapshot (a zombie gone, a piece flattened, the HUD) is applied when the
// drawn clock reaches that snapshot (`Timeline.applyAt`), so hits, dust and removals land
// where the movers are drawn, not half a second ahead of them.

export interface Sample {
  t: number; // server time, ms
  x: number;
  y: number;
  z: number;
  facing: number;
  tag?: string; // the server's word for what the mover was doing when this was taken
}
export interface Pose {
  x: number;
  y: number;
  z: number;
  facing: number;
  moving: boolean; // sliding between two different spots right now
  tag?: string;
}

const KEEP = 8; // samples per track: four seconds at two a second, more than the longest delay
const TELEPORT_SPEED = 12; // m/s: nothing here legitimately moves this fast; a jump is a reset or a respawn
const TELEPORT_GAP_MS = 4000; // a hole this long in the stream is a restart, not a walk

function hold(s: Sample): Pose {
  return { x: s.x, y: s.y, z: s.z, facing: s.facing, moving: false, tag: s.tag };
}

/** The short way round between two headings. */
export function turn(a: number, b: number, u: number): number {
  let d = (b - a) % (2 * Math.PI);
  if (d > Math.PI) d -= 2 * Math.PI;
  else if (d < -Math.PI) d += 2 * Math.PI;
  return a + d * u;
}

export class Track {
  private samples: Sample[] = [];

  sample(s: Sample): void {
    const last = this.samples[this.samples.length - 1];
    if (last) {
      if (s.t < last.t) return; // out of order: the newer one is already here
      if (s.t === last.t) {
        this.samples[this.samples.length - 1] = s;
        return;
      }
      const gap = s.t - last.t;
      const speed = Math.hypot(s.x - last.x, s.y - last.y, s.z - last.z) / (gap / 1000);
      if (gap > TELEPORT_GAP_MS || speed > TELEPORT_SPEED) this.samples.length = 0; // appear there, don't glide
    }
    this.samples.push(s);
    if (this.samples.length > KEEP) this.samples.splice(0, this.samples.length - KEEP);
  }

  get latest(): Sample | undefined {
    return this.samples[this.samples.length - 1];
  }

  /** Where the mover is at server time `t`; held at either end when `t` is outside what is known. */
  at(t: number): Pose | undefined {
    const s = this.samples;
    if (!s.length) return undefined;
    if (t >= s[s.length - 1].t) return hold(s[s.length - 1]);
    if (t <= s[0].t) return hold(s[0]);
    let i = s.length - 2;
    while (i > 0 && s[i].t > t) i--;
    const a = s[i],
      b = s[i + 1],
      u = (t - a.t) / (b.t - a.t);
    return {
      x: a.x + (b.x - a.x) * u,
      y: a.y + (b.y - a.y) * u,
      z: a.z + (b.z - a.z) * u,
      facing: turn(a.facing, b.facing, u),
      moving: Math.hypot(b.x - a.x, b.z - a.z) > 0.01,
      tag: b.tag, // what the server said it was doing over the stretch that ends at b
    };
  }
}

export class Timeline {
  private offset = NaN; // server clock minus page clock, as seen on the quickest delivery so far
  private shown = NaN; // offset minus delay, as actually drawn: eased, so the world never skips
  private spacing = 500; // the widest recent gap between snapshots, in server time; forgets slowly
  private late = 0; // how late snapshots have been arriving lately, against the quickest
  private lastServer = 0;
  private lastLocal = 0;
  private observed = 0;

  get ready(): boolean {
    return !Number.isNaN(this.shown);
  }
  /** How far behind the newest snapshot the page draws: a snapshot and a half, plus recent lateness. */
  get delay(): number {
    return Math.min(2500, Math.max(500, this.spacing * 1.5 + Math.min(this.late, 400)));
  }
  /** How far the drawn world trails the server right now, ms. */
  get lag(): number {
    return this.ready ? this.offset - this.shown : 0;
  }

  /** A snapshot stamped `serverTime` arrived at page time `local`. */
  observe(serverTime: number, local: number): void {
    const sample = serverTime - local;
    this.observed++;
    if (!this.ready) {
      this.offset = sample;
      this.shown = sample - this.delay;
    } else {
      // The quickest delivery sets the clock; a late one only widens the delay. The mark drifts
      // back slowly so a server that has become steadily slower is followed rather than waited for.
      this.offset = Math.max(sample, this.offset - (local - this.lastLocal) * 0.002);
      this.late = Math.max(this.offset - sample, this.late * 0.97);
      // A skipped tick (a 1 s gap) widens the delay for the next half minute or so, so the same
      // hiccup again is absorbed rather than shown as a short freeze; the clock eases back after.
      const gap = serverTime - this.lastServer;
      if (gap > 0 && gap < 3000) this.spacing = Math.max(gap, this.spacing * 0.98);
    }
    this.lastServer = serverTime;
    this.lastLocal = local;
  }

  /**
   * Once a frame: ease the drawn clock toward its target, a few percent of time dilation at
   * most. Until the second live snapshot it snaps instead (the first message after connecting
   * is the hub's stored snapshot and may be half a second stale), as does any big correction.
   */
  tick(dtMs: number): void {
    if (!this.ready) return;
    const target = this.offset - this.delay,
      diff = target - this.shown;
    if (Math.abs(diff) > 1000 || this.observed <= 2) this.shown = target;
    else {
      const max = dtMs * 0.04;
      this.shown += Math.max(-max, Math.min(max, diff));
    }
  }

  /** The server time the page is drawing at page time `local`. */
  renderTime(local: number): number {
    return this.ready ? local + this.shown : -Infinity;
  }
  /** The page time at which the drawn world reaches server time `serverTime`. */
  applyAt(serverTime: number): number {
    return this.ready ? serverTime - this.shown : 0;
  }
}
