import type { WalkSegment } from '../shared/sceneTypes';

const MIN_WALK_MS = 1000;
const MAX_WALK_MS = 10000;

export class ProtagonistModel {
  x: number;
  state: 'idle' | 'walking' | 'working' = 'idle';
  walk?: WalkSegment;

  constructor(
    public homeX: number,
    public speedPxPerSec: number,
  ) {
    this.x = homeX;
  }

  startWalk(toX: number, now: number): void {
    const fromX = this.currentX(now);
    const dist = Math.abs(toX - fromX);
    const durationMs =
      dist < 5 ? 200 : Math.min(MAX_WALK_MS, Math.max(MIN_WALK_MS, (dist / this.speedPxPerSec) * 1000));
    this.walk = { fromX, toX, startedAt: now, durationMs };
    this.x = fromX;
    this.state = 'walking';
  }

  walkDone(now: number): boolean {
    return !this.walk || now >= this.walk.startedAt + this.walk.durationMs;
  }

  currentX(now: number): number {
    if (!this.walk) return this.x;
    const t = Math.min(1, Math.max(0, (now - this.walk.startedAt) / this.walk.durationMs));
    return this.walk.fromX + (this.walk.toX - this.walk.fromX) * t;
  }

  arrive(): void {
    if (this.walk) {
      this.x = this.walk.toX;
      this.walk = undefined;
    }
  }
}
