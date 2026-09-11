import type { Config } from '../shared/config.js';
import type { Entity, Layer, WorldState } from '../shared/state.js';
import { isPrivileged, type ChatUser } from './ingest.js';

export type Verdict = { ok: true } | { ok: false; reason: string };
export type TextVerdict = { ok: true; text: string } | { ok: false; reason: string };

/**
 * Deterministic rules that every proposed change passes through, whether it
 * came from a command, a moderator, or (later) the language model.
 */
export class Policy {
  private readonly lastAdd = new Map<string, number>();
  private readonly lastDress = new Map<string, number>();
  private lastDressAny = 0;

  constructor(private readonly cfg: Config) {}

  canAdd(state: WorldState, user: ChatUser, layer: Layer, now: number): Verdict {
    if (state.entities.length >= this.cfg.limits.maxEntities) {
      return { ok: false, reason: 'the scene is full, remove something first' };
    }
    const cap = this.cfg.limits.maxPerLayer[layer];
    if (cap !== undefined && state.entities.filter((e) => e.layer === layer).length >= cap) {
      return { ok: false, reason: `no room left for that up there` };
    }
    const last = this.lastAdd.get(user.id);
    if (!isPrivileged(user) && last !== undefined && now - last < this.cfg.limits.addCooldownMs) {
      const s = Math.ceil((this.cfg.limits.addCooldownMs - (now - last)) / 1000);
      return { ok: false, reason: `${user.name}, give it ${s}s` };
    }
    return { ok: true };
  }

  noteAdd(user: ChatUser, now: number): void {
    this.lastAdd.set(user.id, now);
  }

  /** Dressing him: the add cooldown per viewer, and a short gap overall so he is not a strobe light. */
  canDress(user: ChatUser, now: number): Verdict {
    if (!isPrivileged(user) && now - this.lastDressAny < 4_000) return { ok: false, reason: `one at a time, ${user.name}` };
    const last = this.lastDress.get(user.id);
    if (!isPrivileged(user) && last !== undefined && now - last < this.cfg.limits.addCooldownMs) {
      const s = Math.ceil((this.cfg.limits.addCooldownMs - (now - last)) / 1000);
      return { ok: false, reason: `${user.name}, give it ${s}s` };
    }
    return { ok: true };
  }

  noteDress(user: ChatUser, now: number): void {
    this.lastDress.set(user.id, now);
    this.lastDressAny = now;
  }

  canRemove(user: ChatUser, entity: Entity): Verdict {
    if (entity.addedBy === user.id || isPrivileged(user)) return { ok: true };
    return { ok: false, reason: `that one belongs to ${entity.addedByName}` };
  }

  filterText(text: string): TextVerdict {
    const cleaned = text.replace(/\s+/g, ' ').trim();
    if (!cleaned) return { ok: false, reason: 'empty text' };
    if ([...cleaned].length > this.cfg.limits.signMaxChars) {
      return { ok: false, reason: `signs take up to ${this.cfg.limits.signMaxChars} characters` };
    }
    const flat = cleaned.toLowerCase().replace(/[^a-z0-9]/g, '');
    for (const bad of this.cfg.denylist) {
      const b = bad.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (b && flat.includes(b)) return { ok: false, reason: 'not putting that on a sign' };
    }
    return { ok: true, text: cleaned };
  }
}
