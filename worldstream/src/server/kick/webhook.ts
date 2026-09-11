// Receives Kick webhooks: verifies the signature, drops duplicates, answers 200
// fast, then hands the event on.
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { IncomingChat } from '../ingest.js';
import { log } from '../log.js';
import { readKickHeaders, verifyKickSignature } from './signature.js';

export interface KickChatMessageEvent {
  message_id: string;
  broadcaster: { user_id: number; username: string; channel_slug?: string };
  sender: {
    user_id: number;
    username: string;
    is_verified?: boolean;
    is_anonymous?: boolean;
    channel_slug?: string;
    identity?: { username_color?: string; badges?: Array<{ text: string; type: string; count?: number }> } | null;
  };
  content: string;
  emotes?: Array<{ emote_id: string; positions: Array<{ s: number; e: number }> }>;
  created_at: string;
  replies_to?: { message_id: string; content: string; sender: { user_id: number; username: string } } | null;
}

export function toIncomingChat(ev: KickChatMessageEvent): IncomingChat {
  const badges = (ev.sender.identity?.badges ?? []).map((b) => b.type);
  if (ev.sender.user_id === ev.broadcaster.user_id && !badges.includes('broadcaster')) badges.push('broadcaster');
  return {
    id: ev.message_id,
    user: { id: `kick:${ev.sender.user_id}`, name: ev.sender.username, badges },
    content: ev.content ?? '',
    at: Date.parse(ev.created_at) || Date.now(),
    source: 'kick',
  };
}

export interface WebhookOptions {
  publicKey: () => Promise<string>;
  refreshPublicKey: () => Promise<string>;
  onEvent: (type: string, version: string, payload: unknown) => void;
  /** Development only: accept unsigned requests. */
  skipVerify?: boolean;
}

export class WebhookReceiver {
  private readonly seen = new Set<string>();

  constructor(private readonly opts: WebhookOptions) {}

  async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const headers = readKickHeaders(req.headers);
    if (!headers && !this.opts.skipVerify) {
      res.writeHead(400).end('missing kick headers');
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
      size += (chunk as Buffer).length;
      if (size > 1_048_576) {
        res.writeHead(413).end('too large');
        return;
      }
      chunks.push(chunk as Buffer);
    }
    const raw = Buffer.concat(chunks);

    if (headers && !this.opts.skipVerify) {
      let ok = verifyKickSignature(await this.opts.publicKey(), headers.messageId, headers.timestamp, raw, headers.signature);
      if (!ok) ok = verifyKickSignature(await this.opts.refreshPublicKey(), headers.messageId, headers.timestamp, raw, headers.signature);
      if (!ok) {
        log('kick', 'rejected webhook with a bad signature', { type: headers.eventType, id: headers.messageId });
        res.writeHead(401).end('bad signature');
        return;
      }
    }

    const id = headers?.messageId ?? `unsigned-${Date.now()}`;
    if (this.seen.has(id)) {
      res.writeHead(200).end('duplicate');
      return;
    }
    this.seen.add(id);
    if (this.seen.size > 5000) for (const k of Array.from(this.seen).slice(0, 2500)) this.seen.delete(k);

    res.writeHead(200).end('ok');

    let payload: unknown;
    try {
      payload = JSON.parse(raw.toString('utf8'));
    } catch {
      log('kick', 'webhook body was not json', { id });
      return;
    }
    const type = headers?.eventType ?? (req.headers['x-dev-event-type'] as string | undefined) ?? 'unknown';
    this.opts.onEvent(type, headers?.eventVersion ?? '1', payload);
  }
}
