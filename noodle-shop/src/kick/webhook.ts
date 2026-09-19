import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Request, Response } from 'express';
import { API_BASE } from './oauth';
import type { ChatMessageSentEvent } from './types';
import type { ChatMessage } from '../engine/world';

type LogFn = (line: string, level?: 'info' | 'warn' | 'alert') => void;

const MAX_SKEW_MS = 5 * 60_000;
let cachedPem: string | null = null;

// Kick signs webhooks with RSA-SHA256 (PKCS#1 v1.5) over
// `${messageId}.${timestamp}.${rawBody}`. The public key comes from the API;
// cache it in memory and on disk so a Kick outage doesn't drop verification.
export async function getKickPublicKey(dataDir: string, log: LogFn): Promise<string | null> {
  if (cachedPem) return cachedPem;
  const cacheFile = path.join(dataDir, 'kick-public-key.pem');
  try {
    const res = await fetch(`${API_BASE}/public/v1/public-key`);
    if (res.ok) {
      const j = (await res.json()) as { data?: { public_key?: string } };
      const pem = j.data?.public_key;
      if (pem && pem.includes('BEGIN PUBLIC KEY')) {
        cachedPem = pem;
        fs.mkdirSync(dataDir, { recursive: true });
        fs.writeFileSync(cacheFile, pem);
        return pem;
      }
    }
    log(`kick public key fetch failed: ${res.status}`, 'warn');
  } catch (e) {
    log(`kick public key fetch error: ${(e as Error).message}`, 'warn');
  }
  try {
    if (fs.existsSync(cacheFile)) {
      cachedPem = fs.readFileSync(cacheFile, 'utf8');
      return cachedPem;
    }
  } catch {
    // fall through
  }
  return null;
}

export function verifySignature(
  publicKeyPem: string,
  messageId: string,
  timestamp: string,
  rawBody: Buffer,
  signatureB64: string,
): boolean {
  try {
    const payload = Buffer.from(`${messageId}.${timestamp}.${rawBody.toString('utf8')}`);
    const verifier = crypto.createVerify('RSA-SHA256');
    verifier.update(payload);
    verifier.end();
    return verifier.verify(publicKeyPem, Buffer.from(signatureB64, 'base64'));
  } catch {
    return false;
  }
}

export interface WebhookDeps {
  dataDir: string;
  log: LogFn;
  /** Suppresses our own outbound posts arriving back through the webhook. */
  isEcho: (messageId: string | undefined, content: string) => boolean;
  onChatMessage: (msg: ChatMessage) => void;
  onWebhook: () => void;
  /** Override the verification key source; defaults to Kick's published key. */
  publicKey?: () => Promise<string | null>;
}

export function makeWebhookHandler(deps: WebhookDeps) {
  return async (req: Request, res: Response): Promise<void> => {
    const messageId = req.header('Kick-Event-Message-Id');
    const timestamp = req.header('Kick-Event-Message-Timestamp');
    const signature = req.header('Kick-Event-Signature');
    const eventType = req.header('Kick-Event-Type');

    if (!messageId || !timestamp || !signature) {
      res.status(400).send('missing signature headers');
      return;
    }
    const ts = Date.parse(timestamp);
    if (!Number.isFinite(ts) || Math.abs(Date.now() - ts) > MAX_SKEW_MS) {
      deps.log('kick webhook rejected: stale timestamp', 'warn');
      res.status(401).send('stale timestamp');
      return;
    }
    const pem = await (deps.publicKey?.() ?? getKickPublicKey(deps.dataDir, deps.log));
    if (!pem) {
      res.status(503).send('verification key unavailable');
      return;
    }
    const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from('');
    if (!verifySignature(pem, messageId, timestamp, rawBody, signature)) {
      deps.log('kick webhook rejected: bad signature', 'warn');
      res.status(401).send('bad signature');
      return;
    }

    res.status(200).end(); // ack fast; process async
    deps.onWebhook();

    if (eventType !== 'chat.message.sent') return;
    try {
      const payload = JSON.parse(rawBody.toString('utf8')) as ChatMessageSentEvent;
      if (!payload.sender || typeof payload.content !== 'string') return;
      if (deps.isEcho(payload.message_id, payload.content)) return;
      const username = String(payload.sender.username ?? `user${payload.sender.user_id}`);
      deps.log(`kick chat <${username}> ${payload.content}`);
      deps.onChatMessage({
        id: `kick:${payload.message_id ?? messageId}`,
        userId: `kick:${payload.sender.user_id}`,
        username,
        text: payload.content,
        ts: Date.now(),
        source: 'kick',
      });
    } catch (e) {
      deps.log(`kick webhook payload parse failed: ${(e as Error).message}`, 'warn');
    }
  };
}
