// Who has been here, what they did, what they named. Persisted so the
// character can greet regulars by name and refer back to their things.
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import type { Command } from '../../shared/commands.js';
import type { ChatUser } from '../ingest.js';

export interface ViewerProfile {
  id: string;
  name: string;
  firstSeen: number;
  lastSeen: number;
  messages: number;
  commands: number;
  adds: number;
  recentAdds: string[];
  named: string[];
  wins: number;
  losses: number;
  greeted: boolean;
  saves?: number;
}

export class Profiles {
  private readonly byId = new Map<string, ViewerProfile>();
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly file: string) {
    if (existsSync(file)) {
      try {
        const parsed = JSON.parse(readFileSync(file, 'utf8')) as ViewerProfile[];
        for (const p of parsed) this.byId.set(p.id, p);
      } catch {
        /* start fresh */
      }
    }
  }

  get count(): number {
    return this.byId.size;
  }

  get(id: string): ViewerProfile | undefined {
    return this.byId.get(id);
  }

  /** Record a message; returns the profile and whether this is a first-ever message. */
  touch(user: ChatUser, now: number): { profile: ViewerProfile; isNew: boolean } {
    let p = this.byId.get(user.id);
    const isNew = !p;
    if (!p) {
      p = { id: user.id, name: user.name, firstSeen: now, lastSeen: now, messages: 0, commands: 0, adds: 0, recentAdds: [], named: [], wins: 0, losses: 0, greeted: false };
      this.byId.set(user.id, p);
    }
    p.name = user.name;
    p.lastSeen = now;
    p.messages++;
    this.saveSoon();
    return { profile: p, isNew };
  }

  recordCommand(id: string, cmd: Command, applied: boolean, sprite?: string): void {
    const p = this.byId.get(id);
    if (!p) return;
    p.commands++;
    if (applied && (cmd.kind === 'add' || cmd.kind === 'sign')) {
      p.adds++;
      if (sprite) {
        p.recentAdds.push(sprite);
        if (p.recentAdds.length > 8) p.recentAdds.splice(0, p.recentAdds.length - 8);
      }
    }
    this.saveSoon();
  }

  recordName(id: string, name: string): void {
    const p = this.byId.get(id);
    if (!p) return;
    p.named.push(name);
    if (p.named.length > 8) p.named.splice(0, p.named.length - 8);
    this.saveSoon();
  }

  recordBet(id: string, won: boolean): void {
    const p = this.byId.get(id);
    if (!p) return;
    if (won) p.wins++;
    else p.losses++;
    this.saveSoon();
  }

  recordSave(id: string): void {
    const p = this.byId.get(id);
    if (!p) return;
    p.saves = (p.saves ?? 0) + 1;
    this.saveSoon();
  }

  markGreeted(id: string): void {
    const p = this.byId.get(id);
    if (p) p.greeted = true;
  }

  /** People who spoke within `withinMs` and have done things before. */
  regulars(now: number, withinMs: number): ViewerProfile[] {
    return [...this.byId.values()].filter((p) => now - p.lastSeen <= withinMs && p.adds >= 2).sort((a, b) => b.lastSeen - a.lastSeen);
  }

  /** One line for a prompt. */
  summary(id: string): string | undefined {
    const p = this.byId.get(id);
    if (!p) return undefined;
    const bits = [`${p.messages} msgs`, `${p.adds} adds`];
    if (p.recentAdds.length) bits.push(`recently added ${p.recentAdds.slice(-3).join(', ')}`);
    if (p.named.length) bits.push(`named ${p.named.slice(-2).join(', ')}`);
    if (p.wins + p.losses) bits.push(`bets ${p.wins}-${p.losses}`);
    if (p.saves) bits.push(`saved his life ${p.saves}x`);
    return `${p.name}: ${bits.join(', ')}`;
  }

  private saveSoon(): void {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.save();
    }, 5000);
  }

  save(): void {
    try {
      const tmp = this.file + '.tmp';
      writeFileSync(tmp, JSON.stringify([...this.byId.values()], null, 2));
      renameSync(tmp, this.file);
    } catch {
      /* best effort */
    }
  }
}
