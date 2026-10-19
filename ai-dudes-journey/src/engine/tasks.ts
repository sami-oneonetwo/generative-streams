import type { ProtagonistModel } from './protagonist';
import type { QueueEntryView, TaskSpec, WorldCtx } from './world';

interface QueuedTask<S> {
  id: string;
  seq: number;
  spec: TaskSpec<S>;
  started?: boolean;
  workedMs?: number;
}

interface CurrentTask<S> extends QueuedTask<S> {
  phase: 'walking' | 'working';
  workStartedAt?: number;
}

export class TaskQueue<S> {
  private pending: QueuedTask<S>[] = [];
  current: CurrentTask<S> | null = null;
  private nextSeq = 1;

  enqueue(spec: TaskSpec<S>): { id: string } {
    const task: QueuedTask<S> = { id: `t${this.nextSeq}`, seq: this.nextSeq++, spec };
    this.pending.push(task);
    this.pending.sort((a, b) => (b.spec.priority ?? 0) - (a.spec.priority ?? 0) || a.seq - b.seq);
    return { id: task.id };
  }

  /** Drop everything, current job included; used when the world is reset. */
  clear(): void {
    this.pending = [];
    this.current = null;
  }

  /** Park ordinary work at the actual position, retaining completed work. */
  interrupt(now: number, protagonist: ProtagonistModel): boolean {
    const c = this.current;
    if (!c || c.spec.emergency) return false;
    if (c.phase === 'working') c.workedMs = (c.workedMs ?? 0) + Math.max(0, now - (c.workStartedAt ?? now));
    this.pending.push(c);
    this.pending.sort((a, b) => (b.spec.priority ?? 0) - (a.spec.priority ?? 0) || a.seq - b.seq);
    this.current = null;
    protagonist.x = protagonist.currentX(now);
    protagonist.walk = undefined;
    protagonist.state = 'idle';
    return true;
  }

  /** Advance the walk/work state machine. Returns true if anything changed. */
  advance(now: number, protagonist: ProtagonistModel, ctx: WorldCtx<S>, emergency = false): boolean {
    let changed = emergency && this.interrupt(now, protagonist);

    const c = this.current;
    if (c) {
      if (c.phase === 'walking' && protagonist.walkDone(now)) {
        protagonist.arrive();
        protagonist.state = 'working';
        c.phase = 'working';
        c.workStartedAt = now;
        try {
          if (!c.started) { c.started = true; c.spec.onStart?.(ctx); }
        } catch (e) {
          ctx.log(`task '${c.spec.kind}' onStart failed: ${(e as Error).message}`, 'warn');
        }
        changed = true;
      } else if (c.phase === 'working' && now >= (c.workStartedAt ?? now) + c.spec.workMs - (c.workedMs ?? 0)) {
        this.current = null;
        protagonist.state = 'idle';
        try {
          c.spec.onComplete(ctx);
        } catch (e) {
          ctx.log(`task '${c.spec.kind}' failed: ${(e as Error).message}`, 'warn');
        }
        changed = true;
      }
    }

    const nextIndex = this.pending.findIndex(t => !emergency || t.spec.emergency);
    if (!this.current && nextIndex >= 0) {
      const [next] = this.pending.splice(nextIndex, 1);
      this.current = { ...next, phase: 'walking' };
      protagonist.startWalk(next.spec.targetX, now);
      changed = true;
    }

    if (!emergency && !this.current && !this.pending.length) {
      // No work: finish any in-flight walk, then head home.
      if (protagonist.state === 'walking' && protagonist.walkDone(now)) {
        protagonist.arrive();
        protagonist.state = 'idle';
        changed = true;
      } else if (protagonist.state === 'idle' && Math.abs(protagonist.x - protagonist.homeX) > 2) {
        protagonist.startWalk(protagonist.homeX, now);
        changed = true;
      }
    }

    return changed;
  }

  progress(now: number): number {
    const c = this.current;
    if (!c || c.phase !== 'working' || c.workStartedAt === undefined) return 0;
    return Math.min(1, ((c.workedMs ?? 0) + now - c.workStartedAt) / Math.max(1, c.spec.workMs));
  }

  view(): QueueEntryView[] {
    const rows: QueueEntryView[] = [];
    if (this.current) {
      const { id, spec } = this.current;
      rows.push({ id, kind: spec.kind, label: spec.label, requestedBy: spec.requestedBy });
    }
    for (const t of this.pending) {
      rows.push({ id: t.id, kind: t.spec.kind, label: t.spec.label, requestedBy: t.spec.requestedBy });
    }
    return rows;
  }

  get pendingCount(): number {
    return this.pending.length;
  }

  pendingView(): { label: string; requestedBy?: string }[] {
    return this.pending.map((t) => ({ label: t.spec.label, requestedBy: t.spec.requestedBy }));
  }
}
