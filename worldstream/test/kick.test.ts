import { constants, generateKeyPairSync, sign } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { readKickHeaders, signedPayload, verifyKickSignature } from '../src/server/kick/signature.js';
import { pkcePair } from '../src/server/kick/oauth.js';
import { toIncomingChat } from '../src/server/kick/webhook.js';

const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const pem = publicKey.export({ type: 'spki', format: 'pem' }).toString();

describe('kick webhook signatures', () => {
  const id = '01JXYZ';
  const ts = '2026-09-05T10:00:00Z';
  const body = Buffer.from(JSON.stringify({ content: 'hello', message_id: 'm1' }));
  const sig = sign('sha256', signedPayload(id, ts, body), { key: privateKey, padding: constants.RSA_PKCS1_PADDING }).toString('base64');

  it('accepts a correctly signed payload', () => {
    expect(verifyKickSignature(pem, id, ts, body, sig)).toBe(true);
  });

  it('rejects a tampered body, id, timestamp or key', () => {
    expect(verifyKickSignature(pem, id, ts, Buffer.from('{"content":"hell0"}'), sig)).toBe(false);
    expect(verifyKickSignature(pem, 'other', ts, body, sig)).toBe(false);
    expect(verifyKickSignature(pem, id, '2026-09-05T10:00:01Z', body, sig)).toBe(false);
    const other = generateKeyPairSync('rsa', { modulusLength: 2048 }).publicKey.export({ type: 'spki', format: 'pem' }).toString();
    expect(verifyKickSignature(other, id, ts, body, sig)).toBe(false);
    expect(verifyKickSignature('not a key', id, ts, body, sig)).toBe(false);
  });

  it('reads the six kick headers', () => {
    const h = readKickHeaders({
      'kick-event-message-id': id, 'kick-event-subscription-id': 'sub', 'kick-event-signature': sig,
      'kick-event-message-timestamp': ts, 'kick-event-type': 'chat.message.sent', 'kick-event-version': '1',
    });
    expect(h).toEqual({ messageId: id, subscriptionId: 'sub', signature: sig, timestamp: ts, eventType: 'chat.message.sent', eventVersion: '1' });
    expect(readKickHeaders({})).toBeNull();
  });
});

describe('kick chat payload', () => {
  it('maps a chat.message.sent payload onto IncomingChat with badges', () => {
    const msg = toIncomingChat({
      message_id: 'abc',
      broadcaster: { user_id: 1, username: 'sami' },
      sender: { user_id: 42, username: 'kai', identity: { username_color: '#fff', badges: [{ text: 'Moderator', type: 'moderator' }] } },
      content: '!add cat',
      created_at: '2026-09-05T10:00:00Z',
    });
    expect(msg.user).toEqual({ id: 'kick:42', name: 'kai', badges: ['moderator'] });
    expect(msg.source).toBe('kick');
    expect(msg.at).toBe(Date.parse('2026-09-05T10:00:00Z'));
    const own = toIncomingChat({ message_id: 'x', broadcaster: { user_id: 1, username: 'sami' }, sender: { user_id: 1, username: 'sami', identity: null }, content: 'hi', created_at: 'bad' });
    expect(own.user.badges).toContain('broadcaster');
  });

  it('makes S256 pkce pairs', () => {
    const { verifier, challenge } = pkcePair();
    expect(verifier.length).toBeGreaterThan(40);
    expect(challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });
});
