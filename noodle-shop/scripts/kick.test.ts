import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { test } from 'node:test';
import type { Request, Response } from 'express';
import { EchoGuard } from '../src/kick/echo';
import { makeWebhookHandler, verifySignature } from '../src/kick/webhook';
import type { ChatMessage } from '../src/engine/world';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Engine } from '../src/engine/engine';
import { createSafehouseWorld } from '../src/worlds/safehouse';

const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const publicPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();

const BROADCASTER_ID = 28683256; // the connected token's own account

function sign(messageId: string, timestamp: string, body: string): string {
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(Buffer.from(`${messageId}.${timestamp}.${body}`));
  signer.end();
  return signer.sign(privateKey).toString('base64');
}

function chatPayload(content: string, messageId = crypto.randomUUID(), senderId = BROADCASTER_ID) {
  return JSON.stringify({
    message_id: messageId,
    broadcaster: { user_id: BROADCASTER_ID, username: 'Sami' },
    sender: { user_id: senderId, username: senderId === BROADCASTER_ID ? 'Sami' : `viewer${senderId}` },
    content,
  });
}

/** Drives the real handler with a correctly signed request; returns what reached the pipeline. */
async function deliver(echo: EchoGuard, body: string, eventType = 'chat.message.sent'): Promise<ChatMessage[]> {
  const messageId = crypto.randomUUID();
  const timestamp = new Date().toISOString();
  const headers: Record<string, string> = {
    'Kick-Event-Message-Id': messageId,
    'Kick-Event-Message-Timestamp': timestamp,
    'Kick-Event-Signature': sign(messageId, timestamp, body),
    'Kick-Event-Type': eventType,
  };
  const received: ChatMessage[] = [];
  const handler = makeWebhookHandler({
    dataDir: 'data',
    log: () => {},
    isEcho: (id, content) => echo.isEcho(id, content),
    onChatMessage: (msg) => received.push(msg),
    onWebhook: () => {},
    publicKey: async () => publicPem,
  });

  let status = 0;
  const req = { header: (n: string) => headers[n], body: Buffer.from(body) } as unknown as Request;
  const res = {
    status(code: number) {
      status = code;
      return this;
    },
    send() {
      return this;
    },
    end() {
      status ||= 200;
      return this;
    },
  } as unknown as Response;

  await handler(req, res);
  assert.equal(status, 200, `expected 200, got ${status}`);
  return received;
}

test('signed chat fixture enters safehouse pipeline and completes one durable creation', async () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'safehouse-kick-'));
  const world=createSafehouseWorld({ seedScenery: false,fixture:true,workMs:500});
  const engine=new Engine(world,{dataDir:dir,confidenceThreshold:.6,flags:{devTimeScale:1,kickRepliesEnabled:false}});
  try {
    const messages=await deliver(new EchoGuard(),chatPayload('Build a duck tower',crypto.randomUUID(),99999));
    await engine.pipeline.handle(messages[0]); await engine.pipeline.handle(messages[0]);
    for(let i=0;i<180&&engine.state.objects.length===0;i++){world.tick(engine.ctx,500);await new Promise(r=>setImmediate(r));}
    assert.equal(engine.state.objects.length,1);assert.equal(engine.state.objects[0].createdBy,'viewer99999');
    assert.equal(engine.state.jobs.length,1);assert.equal(engine.state.jobs[0].userId,'kick:99999');
  } finally {engine.stop();fs.rmSync(dir,{recursive:true,force:true});}
});

test('signature verification accepts a correctly signed body and rejects tampering', () => {
  const body = chatPayload('hello');
  const messageId = 'abc';
  const timestamp = new Date().toISOString();
  const sig = sign(messageId, timestamp, body);
  assert.ok(verifySignature(publicPem, messageId, timestamp, Buffer.from(body), sig));
  assert.ok(!verifySignature(publicPem, messageId, timestamp, Buffer.from(body + ' '), sig));
  assert.ok(!verifySignature(publicPem, 'other-id', timestamp, Buffer.from(body), sig));
});

test('the streamer typing in their own channel reaches the pipeline', async () => {
  const echo = new EchoGuard();
  const received = await deliver(echo, chatPayload("There's a rat"));
  assert.equal(received.length, 1);
  assert.equal(received[0].text, "There's a rat");
  assert.equal(received[0].username, 'Sami');
  assert.equal(received[0].userId, `kick:${BROADCASTER_ID}`);
  assert.equal(received[0].source, 'kick');
});

test('our own outbound post is suppressed by message_id', async () => {
  const echo = new EchoGuard();
  const ourId = crypto.randomUUID();
  echo.noteSending('AC is back. it was the fan bearing.');
  echo.noteSentId(ourId);
  const received = await deliver(echo, chatPayload('AC is back. it was the fan bearing.', ourId));
  assert.equal(received.length, 0);
});

test('our own outbound post is suppressed by content when Kick returns no id', async () => {
  const echo = new EchoGuard();
  echo.noteSending("door's shut. dust everywhere.");
  const received = await deliver(echo, chatPayload("Door's shut.  Dust everywhere."));
  assert.equal(received.length, 0, 'content match should be whitespace- and case-insensitive');
});

test('a content entry is consumed once, so a later identical viewer message gets through', async () => {
  const echo = new EchoGuard();
  echo.noteSending('same words');
  assert.equal((await deliver(echo, chatPayload('same words'))).length, 0);
  const received = await deliver(echo, chatPayload('same words', crypto.randomUUID(), 99999));
  assert.equal(received.length, 1);
  assert.equal(received[0].userId, 'kick:99999');
});

test('non-chat event types are acked but never reach the pipeline', async () => {
  const echo = new EchoGuard();
  const received = await deliver(echo, chatPayload('ignored'), 'livestream.status.updated');
  assert.equal(received.length, 0);
});
