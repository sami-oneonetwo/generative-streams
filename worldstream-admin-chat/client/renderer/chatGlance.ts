export const GLANCE_DURATION_MS = 2200;
export const GLANCE_COOLDOWN_MS = 8000;

// Cosmetic attention only: chat never interrupts a world task or extends a glance.
export class ChatGlance {
  private revision: number | undefined;
  private startedAt = -Infinity;

  reset(): void {
    this.revision = undefined;
    this.startedAt = -Infinity;
  }

  observe(revision: number | undefined, seated: boolean, now: number): void {
    if (!seated) this.startedAt = -Infinity;
    if (revision === undefined) { this.reset(); return; }
    const previous = this.revision;
    this.revision = revision;
    if (previous === undefined || revision <= previous) return;
    if (seated && now - this.startedAt >= GLANCE_COOLDOWN_MS) this.startedAt = now;
  }

  amount(now: number): number {
    const elapsed = now - this.startedAt;
    if (elapsed < 0 || elapsed >= GLANCE_DURATION_MS) return 0;
    const t = Math.min(1, elapsed / 350, (GLANCE_DURATION_MS - elapsed) / 450);
    return t * t * (3 - 2 * t);
  }
}
