export interface FrameEffects {
  chaos: number;
  mess: number;
  animate: boolean;
}

export const STILL_EFFECTS: FrameEffects = { chaos: 0, mess: 0, animate: false };
const thresholds = [0.18, 0.4, 0.65, 0.86];

function bounded(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
}

// Cosmetic state only: quick build-up, slower recovery, no cup/hair chatter at thresholds.
export class SceneChaos {
  private value = 0;
  private stage = 0;
  private lastAt: number | undefined;

  reset(): void {
    this.value = 0;
    this.stage = 0;
    this.lastAt = undefined;
  }

  frame(target: number, at: number, animate: boolean): FrameEffects {
    target = bounded(target);
    if (this.lastAt === undefined) {
      this.value = target;
      this.stage = thresholds.filter(t => target >= t).length;
    } else {
      const elapsed = Math.max(0, at - this.lastAt);
      const timeConstant = target > this.value ? 450 : 2600;
      this.value += (target - this.value) * (1 - Math.exp(-elapsed / timeConstant));
      while (this.stage < thresholds.length && this.value >= thresholds[this.stage] + 0.025) this.stage++;
      while (this.stage > 0 && this.value < thresholds[this.stage - 1] - 0.025) this.stage--;
    }
    this.lastAt = at;
    return { chaos: this.value, mess: this.stage, animate };
  }
}

// Each fixture/window has a stable phase. At most one local dip per ~2.4 seconds.
export function lightDip(now: number, seed: number, chaos: number): number {
  if (chaos < 0.15) return 0;
  const cycle = 2800 + (seed % 5) * 173;
  const shifted = now + seed * 733;
  const event = Math.floor(shifted / cycle);
  if (((event * 17 + seed * 13) % 11 + 11) % 11 / 11 > chaos) return 0;
  const phase = ((shifted % cycle) + cycle) % cycle;
  const duration = 180 + chaos * 300;
  if (phase >= duration) return 0;
  return Math.sin(phase / duration * Math.PI) * chaos;
}
