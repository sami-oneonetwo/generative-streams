// Localhost-only operator page: live state, the recent chat with what the
// interpreter did with it, and a few levers for during the stream.
import { readFileSync } from 'node:fs';
import { CLOTHING_COLOURS, COLOUR_SLOTS, describeOutfit } from '../shared/wardrobe.js';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { HELP_TEXT } from '../shared/commands.js';
import type { IncomingChat } from './ingest.js';
import { runCommand, type InterpreterContext, type Outcome } from './interpreter.js';
import type { Generator } from './generator.js';
import type { Host } from './host/engine.js';
import type { KickStatus } from './kick/index.js';
import type { TickControl } from './tick.js';

export interface ChatLogEntry {
  at: number;
  user: string;
  badges: string[];
  content: string;
  source: string;
  applied: boolean;
  reply?: string;
  queued?: boolean;
}

export class ChatLog {
  private items: ChatLogEntry[] = [];

  push(msg: IncomingChat, outcome: Outcome): void {
    this.items.push({ at: msg.at, user: msg.user.name, badges: msg.user.badges, content: msg.content, source: msg.source, applied: outcome.applied, reply: outcome.reply, queued: outcome.queued });
    if (this.items.length > 100) this.items.splice(0, this.items.length - 100);
  }

  list(): ChatLogEntry[] {
    return this.items.slice().reverse();
  }
}

export interface AdminDeps {
  ctx: InterpreterContext;
  chatLog: ChatLog;
  tick: TickControl;
  htmlPath: string;
  kickStatus: () => KickStatus | null;
  brainPending: () => number;
  worlds: string[];
  host: Host;
  /** Echo an operator line into Kick chat. */
  speak: (text: string) => void;
  /** Flip posting into Kick chat; returns the new setting, or null when Kick is not wired up. */
  setKickChat: (on: boolean) => boolean | null;
  generator: Generator;
}

const OPERATOR: IncomingChat['user'] = { id: 'operator', name: 'operator', badges: ['broadcaster'] };

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const text = Buffer.concat(chunks).toString('utf8');
  return text ? (JSON.parse(text) as Record<string, unknown>) : {};
}

/** Returns true when the request was an admin route. Caller has already checked it is local. */
export async function handleAdmin(req: IncomingMessage, res: ServerResponse, url: URL, deps: AdminDeps): Promise<boolean> {
  if (url.pathname === '/admin') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' });
    res.end(readFileSync(deps.htmlPath));
    return true;
  }
  if (url.pathname === '/admin/api/snapshot') {
    const { ctx } = deps;
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-cache' });
    res.end(
      JSON.stringify({
        state: ctx.store.state,
        chat: deps.chatLog.list(),
        drift: { paused: deps.tick.paused, muted: deps.tick.muted },
        ambient: (ctx.catalogue.ambient ?? []).map((a) => ({ name: a.name, sprite: a.sprite, departure: Boolean(a.departure) })),
        sprites: ctx.catalogue.sprites
          .filter((s) => !s.ambientOnly)
          .map((s) => ({ name: s.name, aliases: s.aliases ?? [], layers: s.layers, acceptsText: Boolean(s.acceptsText), animated: Boolean(s.animated) })),
        commands: HELP_TEXT,
        generate: deps.generator.status(),
        generated: (ctx.catalogue.sprites as Array<{ name: string; generated?: boolean; frames?: Array<{ w: number; h: number; rows: string[] }>; aliases?: string[] }>)
          .filter((s) => s.generated && s.frames)
          .map((s) => ({ name: s.name, w: s.frames![0].w, h: s.frames![0].h, rows: s.frames![0].rows, aliases: s.aliases ?? [] })),
        keys: (ctx.catalogue as { keys?: Record<string, string> }).keys ?? {},
        builds: (ctx.catalogue.builds ?? []).filter((b) => !b.welcome).map((b) => ({ name: b.name, aliases: b.aliases ?? [], pieces: b.items.map((i) => i.sprite) })),
        limits: { maxEntities: ctx.cfg.limits.maxEntities, addCooldownMs: ctx.cfg.limits.addCooldownMs, entityTtlMs: ctx.cfg.limits.entityTtlMs, signMaxChars: ctx.cfg.limits.signMaxChars, voters: ctx.cfg.votes.worldChangeVoters },
        worlds: deps.worlds,
        host: deps.host.status(),
        voiceHeldForS: Math.ceil(deps.ctx.store.voiceHeldForMs / 1000),
        comfort: ctx.catalogue.survival?.comfort ?? 'warmth',
        nl: { mode: ctx.cfg.nl.mode, model: ctx.cfg.nl.model, pending: deps.brainPending() },
        kick: deps.kickStatus(),
        character: ctx.cfg.character.name,
        outfit: describeOutfit(ctx.store.state.character.outfit),
        wardrobe: ctx.wardrobe
          ? { items: ctx.wardrobe.items.map((i) => ({ name: i.name, slot: i.slot, aliases: i.aliases, tint: i.tint ?? null })), colours: Object.keys(CLOTHING_COLOURS), slots: COLOUR_SLOTS }
          : null,
      }),
    );
    return true;
  }
  if (url.pathname === '/admin/api/action' && req.method === 'POST') {
    const body = await readJson(req);
    const now = Date.now();
    const op: IncomingChat = { id: `op-${now}`, user: OPERATOR, content: String(body.command ?? ''), at: now, source: 'mock' };
    let result: unknown;
    switch (body.action) {
      case 'pause':
        deps.tick.pause();
        result = { paused: true };
        break;
      case 'resume':
        deps.tick.resume();
        result = { paused: false };
        break;
      case 'mute':
        deps.tick.mute();
        result = { muted: true };
        break;
      case 'vitals': {
        const patch = (body.patch ?? {}) as Record<string, unknown>;
        const clean: Record<string, number> = {};
        for (const k of ['food', 'comfort', 'rest', 'spirit']) if (typeof patch[k] === 'number') clean[k] = patch[k] as number;
        deps.ctx.store.dispatch({ type: 'set_vitals', patch: clean }, 'operator');
        if (body.wake) deps.ctx.store.dispatch({ type: 'wake' }, 'operator');
        result = deps.ctx.store.state.character.vitals;
        break;
      }
      case 'music': {
        deps.ctx.store.dispatch({ type: 'set_music', enabled: typeof body.enabled === 'boolean' ? body.enabled : undefined, volume: typeof body.volume === 'number' ? body.volume : undefined }, 'operator');
        result = deps.ctx.store.state.music ?? { enabled: true, volume: 0.6 };
        break;
      }
      case 'kick_chat': {
        const on = deps.setKickChat(Boolean(body.enabled));
        result = { kickChat: on };
        break;
      }
      case 'delete_sprite': {
        const ok = deps.generator.remove(deps.ctx.store.state.world, String(body.name ?? ''));
        result = { removed: ok };
        break;
      }
      case 'host_ask':
        await deps.host.forceAsk();
        result = deps.host.status();
        break;
      case 'host_skip':
        deps.host.skip();
        result = deps.host.status();
        break;
      case 'host_pause':
        deps.host.pause();
        result = deps.host.status();
        break;
      case 'host_resume':
        deps.host.resume();
        result = deps.host.status();
        break;
      case 'unmute':
        deps.tick.unmute();
        result = { muted: false };
        break;
      case 'clear':
        deps.ctx.store.dispatch({ type: 'clear_entities' }, 'operator');
        result = { cleared: true };
        break;
      case 'remove':
        deps.ctx.store.dispatch({ type: 'remove_entity', id: String(body.id ?? '') }, 'operator');
        result = { removed: body.id };
        break;
      case 'say': {
        const text = String(body.text ?? '').trim().slice(0, 140);
        if (text) {
          deps.ctx.store.holdVoice(deps.ctx.cfg.host.operatorHoldMs);
          deps.ctx.store.dispatch({ type: 'set_character', patch: { bubble: { text, until: now + deps.ctx.cfg.drift.bubbleMs }, mode: 'talk' } }, 'operator');
          deps.speak(text);
        }
        result = { said: text, voiceHeldForS: Math.ceil(deps.ctx.store.voiceHeldForMs / 1000) };
        break;
      }
      case 'release': {
        deps.ctx.store.releaseVoice();
        result = { voiceHeldForS: 0 };
        break;
      }
      case 'command': {
        const { parseCommand } = await import('../shared/commands.js');
        const cmd = parseCommand(op.content);
        result = cmd ? runCommand(cmd, op, deps.ctx) : { applied: false, reply: 'not a command' };
        break;
      }
      default:
        res.writeHead(400, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'unknown action' }));
        return true;
    }
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(result));
    return true;
  }
  return false;
}
