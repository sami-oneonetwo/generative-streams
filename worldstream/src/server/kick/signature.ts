// Kick signs every webhook: RSA-SHA256 (PKCS#1 v1.5) over
// "<Kick-Event-Message-Id>.<Kick-Event-Message-Timestamp>.<raw body>".
import { constants, createPublicKey, verify as cryptoVerify } from 'node:crypto';
import type { IncomingHttpHeaders } from 'node:http';

export interface KickEventHeaders {
  messageId: string;
  subscriptionId: string;
  signature: string;
  timestamp: string;
  eventType: string;
  eventVersion: string;
}

function one(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

export function readKickHeaders(h: IncomingHttpHeaders): KickEventHeaders | null {
  const messageId = one(h['kick-event-message-id']);
  const subscriptionId = one(h['kick-event-subscription-id']);
  const signature = one(h['kick-event-signature']);
  const timestamp = one(h['kick-event-message-timestamp']);
  const eventType = one(h['kick-event-type']);
  const eventVersion = one(h['kick-event-version']);
  if (!messageId || !signature || !timestamp || !eventType) return null;
  return { messageId, subscriptionId: subscriptionId ?? '', signature, timestamp, eventType, eventVersion: eventVersion ?? '1' };
}

export function signedPayload(messageId: string, timestamp: string, rawBody: Buffer | string): Buffer {
  const body = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody);
  return Buffer.concat([Buffer.from(`${messageId}.${timestamp}.`), body]);
}

export function verifyKickSignature(publicKeyPem: string, messageId: string, timestamp: string, rawBody: Buffer | string, signatureB64: string): boolean {
  try {
    const key = createPublicKey(publicKeyPem);
    return cryptoVerify('sha256', signedPayload(messageId, timestamp, rawBody), { key, padding: constants.RSA_PKCS1_PADDING }, Buffer.from(signatureB64, 'base64'));
  } catch {
    return false;
  }
}

/** Kick publishes its webhook public key; cache it, refetch on a verification miss. */
export async function fetchKickPublicKey(base = 'https://api.kick.com'): Promise<string> {
  const res = await fetch(`${base}/public/v1/public-key`);
  if (!res.ok) throw new Error(`public-key ${res.status}`);
  const json = (await res.json()) as { data?: { public_key?: string }; public_key?: string };
  const pem = json.data?.public_key ?? json.public_key;
  if (!pem) throw new Error('public-key response had no key');
  return pem;
}
