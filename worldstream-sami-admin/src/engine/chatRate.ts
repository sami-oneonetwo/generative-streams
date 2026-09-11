// Live audience volume, measured as messages per minute. The server room turns
// this into traffic its boxes have to carry (brief §5.7), so the reading has to
// be smooth enough not to whipsaw the simulation and quick enough that a raid
// landing is felt within a few seconds.
//
// A trailing window is its own smoothing: a burst decays over WINDOW_MS instead
// of spiking and vanishing between ticks.

const WINDOW_MS = 60_000;
const PRUNE_AT = 4096; // safety valve if nobody reads the meter for a while

export class ChatRateMeter {
  private stamps: number[] = [];

  record(at: number): void {
    this.stamps.push(at);
    if (this.stamps.length > PRUNE_AT) this.prune(at);
  }

  /** Messages per minute over the trailing window. */
  ratePerMin(now: number): number {
    this.prune(now);
    return this.stamps.length * (60_000 / WINDOW_MS);
  }

  private prune(now: number): void {
    const cutoff = now - WINDOW_MS;
    let stale = 0;
    while (stale < this.stamps.length && this.stamps[stale] < cutoff) stale++;
    if (stale) this.stamps.splice(0, stale);
  }
}
