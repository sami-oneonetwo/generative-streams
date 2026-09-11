// The character builds things: walks to a spot, places the pieces one at a
// time, then shows chat. Builds can be his own idea, a commission from a viewer,
// or a welcome spot with a newcomer's name on it.
import { randomUUID } from 'node:crypto';
import type { BuildDef, Catalogue } from '../shared/catalogue.js';
import { VIEW, type Entity } from '../shared/state.js';
import type { ChatUser } from './ingest.js';
import { isPrivileged } from './ingest.js';
import type { InterpreterContext } from './interpreter.js';
import { placeY } from './interpreter.js';
import { log } from './log.js';

export interface BuildPlan {
  def: BuildDef;
  forUser?: ChatUser;
  /** Say something when the last piece lands. */
  announce?: (plan: BuildPlan) => string | undefined;
}

interface Active {
  plan: BuildPlan;
  anchorX: number;
  idx: number;
  nextAt: number;
  startedAt: number;
}

export type BuildVerdict = { ok: true; etaMs: number } | { ok: false; reason: string };

const WALK_MS = 2500;
const PIECE_MS = 1200;
const BUILD_TTL_MS = 35 * 60_000;

export class Builder {
  private active: Active | null = null;
  private readonly queue: BuildPlan[] = [];
  private readonly lastByUser = new Map<string, number>();
  private lastBuildAt = 0;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly ctx: InterpreterContext,
    private readonly say: (text: string) => void,
    private readonly now: () => number = Date.now,
  ) {}

  start(): void {
    if (!this.timer) this.timer = setInterval(() => this.step(this.now()), 400);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  get busy(): boolean {
    return this.active !== null || this.queue.length > 0;
  }

  get lastFinishedAt(): number {
    return this.lastBuildAt;
  }

  /** Builds the current world offers, excluding welcome spots. */
  showcases(): BuildDef[] {
    return (this.ctx.catalogue.builds ?? []).filter((b) => !b.welcome);
  }

  welcomeBuild(): BuildDef | undefined {
    return (this.ctx.catalogue.builds ?? []).find((b) => b.welcome);
  }

  find(query: string): BuildDef | undefined {
    const q = query.trim().toLowerCase().replace(/[\s-]+/g, '_');
    return this.showcases().find((b) => b.name === q || (b.aliases ?? []).some((a) => a.toLowerCase().replace(/[\s-]+/g, '_') === q));
  }

  /** Queue a build. Viewers get one commission every two minutes; moderators are exempt. */
  request(plan: BuildPlan): BuildVerdict {
    const now = this.now();
    if (plan.forUser && !isPrivileged(plan.forUser)) {
      const last = this.lastByUser.get(plan.forUser.id) ?? 0;
      if (now - last < 120_000) return { ok: false, reason: `${plan.forUser.name}, one build at a time. give it ${Math.ceil((120_000 - (now - last)) / 1000)}s` };
    }
    if (this.queue.length >= 3) return { ok: false, reason: 'my hands are full. later.' };
    if (!this.makeRoom(plan.def.items.length)) return { ok: false, reason: 'no room. chat, clear some space or I will.' };
    if (plan.forUser) this.lastByUser.set(plan.forUser.id, now);
    this.queue.push(plan);
    const ahead = (this.active ? this.active.plan.def.items.length - this.active.idx : 0) + this.queue.slice(0, -1).reduce((a, p) => a + p.def.items.length, 0);
    return { ok: true, etaMs: WALK_MS + (ahead + plan.def.items.length) * PIECE_MS };
  }

  /** Advance the current build. Public so tests can drive it. */
  step(now: number): void {
    const store = this.ctx.store;
    const s = store.state;
    if (s.transition || s.character.vitals.collapsed || s.character.vitals.blackout) return;

    if (!this.active) {
      const plan = this.queue.shift();
      if (!plan) return;
      const anchorX = this.pickAnchor(plan.def);
      this.active = { plan, anchorX, idx: 0, nextAt: now + WALK_MS, startedAt: now };
      const c = s.character;
      const standX = Math.round(Math.max(8, Math.min(VIEW.worldW - 8, anchorX - 10)));
      store.dispatch({ type: 'set_character', patch: { targetX: standX, facing: standX < c.x ? 'l' : 'r', mode: 'walk' } }, 'builder');
      log('builder', `building ${plan.def.name}${plan.forUser ? ` for ${plan.forUser.name}` : ''} at x=${anchorX}`);
      return;
    }

    const a = this.active;
    if (now < a.nextAt) return;
    const item = a.plan.def.items[a.idx];
    const def = this.ctx.catalogue.sprites.find((d) => d.name === item.sprite);
    if (def) {
      const layer = def.layers[0];
      const text = def.acceptsText ? (item.text ?? 'HELLO').replace('{name}', (a.plan.forUser?.name ?? 'FRIEND').toUpperCase()).slice(0, this.ctx.cfg.limits.signMaxChars) : undefined;
      const entity: Entity = {
        id: randomUUID().slice(0, 8),
        sprite: def.name,
        layer,
        x: Math.round(Math.max(0, Math.min(VIEW.worldW - def.w, a.anchorX + item.dx))),
        y: placeY(layer, def.h),
        text,
        addedBy: a.plan.forUser?.id ?? 'wanderer',
        addedByName: a.plan.forUser?.name ?? 'the wanderer',
        addedAt: now,
        touchedAt: now,
        expiresAt: now + BUILD_TTL_MS,
      };
      store.dispatch({ type: 'add_entity', entity }, 'builder');
      const c = store.state.character;
      store.dispatch({ type: 'set_character', patch: { facing: entity.x + def.w / 2 < c.x ? 'l' : 'r' } }, 'builder');
    }
    a.idx++;
    a.nextAt = now + PIECE_MS;
    if (a.idx >= a.plan.def.items.length) {
      this.active = null;
      this.lastBuildAt = now;
      const line = a.plan.announce?.(a.plan);
      if (line) this.say(line);
      log('builder', `finished ${a.plan.def.name}`);
    }
  }

  /** Somewhere near him with the fewest things in the way, on the visible screen. */
  private pickAnchor(def: BuildDef): number {
    const s = this.ctx.store.state;
    const span = Math.max(...def.items.map((i) => i.dx)) + 24;
    const cam = s.camera.x;
    const candidates = [s.character.x + 30, s.character.x - 30 - span, cam + 40, cam + VIEW.w - 40 - span].map((x) => Math.round(Math.max(0, Math.min(VIEW.worldW - span, x))));
    const crowd = (x: number) => s.entities.filter((e) => e.x >= x - 10 && e.x <= x + span + 10 && e.layer === 'stage').length;
    return candidates.sort((a, b) => crowd(a) - crowd(b) || Math.abs(a - s.character.x) - Math.abs(b - s.character.x))[0];
  }

  /** Drop his own oldest clutter so a build fits under the cap. */
  private makeRoom(pieces: number): boolean {
    const store = this.ctx.store;
    const cap = this.ctx.cfg.limits.maxEntities;
    let mine = store.state.entities.filter((e) => e.addedBy === 'wanderer').sort((a, b) => a.addedAt - b.addedAt);
    while (store.state.entities.length + pieces > cap && mine.length) {
      store.dispatch({ type: 'remove_entity', id: mine[0].id }, 'builder');
      mine = mine.slice(1);
    }
    return store.state.entities.length + pieces <= cap;
  }
}

export function catalogueBuilds(cat: Catalogue): BuildDef[] {
  return (cat.builds ?? []).filter((b) => !b.welcome);
}
