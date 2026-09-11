// Does a chat line answer what the character just asked? Plain rules; the
// model is only consulted for free-text judging elsewhere.
import { findSprite, type Catalogue } from '../../shared/catalogue.js';
import type { Command } from '../../shared/commands.js';
import type { IncomingChat } from '../ingest.js';
import type { Outcome } from '../interpreter.js';

export type AnswerSpec =
  | { type: 'choice'; options: string[] }
  | { type: 'yesno' }
  | { type: 'name'; maxLen?: number }
  | { type: 'command'; kind: 'add' | 'sign' | 'weather' | 'time' | 'name' | 'wear'; tags?: string[]; sprites?: string[] }
  | { type: 'text'; from?: string; minLen?: number }
  | { type: 'none' };

export interface Detected {
  matched: boolean;
  value: string;
}

const NO: Detected = { matched: false, value: '' };
const YES_WORDS = new Set(['yes', 'y', 'yeah', 'yep', 'yup', 'aye', 'sure', 'ok', 'okay', 'ye']);
const NO_WORDS = new Set(['no', 'n', 'nope', 'nah', 'never']);
const NOT_NAMES = new Set(['yes', 'no', 'lol', 'hi', 'hello', 'hey', 'what', 'the', 'a', 'an', 'it', 'this', 'that', 'cat', 'dog', 'wanderer', 'ok', 'okay', 'left', 'right', 'lmao', 'gg', 'pog', 'kekw']);

function words(text: string): string[] {
  return text.toLowerCase().replace(/[^a-z0-9'\s]/g, ' ').split(/\s+/).filter(Boolean);
}

export function detectAnswer(spec: AnswerSpec, msg: IncomingChat, cmd: Command | null, outcome: Outcome | null, catalogue: Catalogue): Detected {
  switch (spec.type) {
    case 'none':
      return NO;
    case 'choice': {
      if (cmd) return NO;
      const ws = words(msg.content);
      const hit = spec.options.find((o) => ws.includes(o.toLowerCase()));
      return hit ? { matched: true, value: hit } : NO;
    }
    case 'yesno': {
      if (cmd) return NO;
      const ws = words(msg.content);
      if (ws.some((w) => YES_WORDS.has(w))) return { matched: true, value: 'yes' };
      if (ws.some((w) => NO_WORDS.has(w))) return { matched: true, value: 'no' };
      return NO;
    }
    case 'name': {
      if (cmd) return NO;
      const raw = msg.content.replace(/["“”']/g, '').trim();
      const ws = raw.split(/\s+/).filter(Boolean);
      if (ws.length === 0 || ws.length > 2) return NO;
      if (!ws.every((w) => /^[A-Za-z][A-Za-z-]{0,14}$/.test(w))) return NO;
      if (ws.length === 1 && NOT_NAMES.has(ws[0].toLowerCase())) return NO;
      const name = ws.map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
      if (name.length > (spec.maxLen ?? 12)) return NO;
      return { matched: true, value: name };
    }
    case 'command': {
      if (!cmd || !outcome?.applied) return NO;
      if (spec.kind === 'sign') {
        if (cmd.kind === 'sign') return { matched: true, value: cmd.text ?? '' };
        if (cmd.kind === 'add' && findSprite(catalogue, cmd.sprite)?.acceptsText) return { matched: true, value: cmd.text ?? '' };
        return NO;
      }
      if (cmd.kind !== spec.kind) return NO;
      if (cmd.kind === 'add') {
        const def = findSprite(catalogue, cmd.sprite);
        if (!def) return NO;
        if (spec.sprites && !spec.sprites.includes(def.name)) return NO;
        if (spec.tags && !spec.tags.some((t) => def.tags.includes(t))) return NO;
        return { matched: true, value: def.name };
      }
      if (cmd.kind === 'weather') return { matched: true, value: cmd.weather };
      if (cmd.kind === 'time') return { matched: true, value: cmd.preset };
      if (cmd.kind === 'name') return { matched: true, value: cmd.name };
      if (cmd.kind === 'wear') return cmd.off ? NO : { matched: true, value: cmd.text };
      return NO;
    }
    case 'text': {
      if (cmd) return NO;
      if (spec.from && msg.user.id !== spec.from) return NO;
      const t = msg.content.trim();
      return t.length >= (spec.minLen ?? 2) ? { matched: true, value: t } : NO;
    }
  }
}
