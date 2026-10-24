// The server's own safety nets: the Kick connection only from this machine, player sockets only from
// the play site, the terminal log rolling over, and a /play seat that idles out despite the heartbeat.
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import type http from 'node:http';
import type { WebSocket } from 'ws';
import { isLocalRequest } from '../src/server/operatorGuard';
import { playerOriginAllowed } from '../src/server/ws';
import { PLAY_PATHS, ngrokPolicy, tunnelAllows, tunnelAllowsUpgrade } from '../src/server/tunnelGuard';
import { LOG_ROTATE_BYTES, TerminalLog, readTail } from '../src/engine/log';
import { PlaySeats } from '../src/server/play';

const expressReq = (headers: Record<string, string>, remoteAddress = '127.0.0.1') => ({
  get: (name: string) => headers[name.toLowerCase()],
  socket: { remoteAddress },
});

test('the Kick connection routes answer only on this machine, never through the tunnel', () => {
  assert.equal(isLocalRequest(expressReq({ host: 'localhost:4600' })), true);
  // ngrok reaches the server on loopback, but with its own Host and forwarded headers.
  assert.equal(isLocalRequest(expressReq({ host: 'x.ngrok-free.dev', 'x-forwarded-for': '1.2.3.4' })), false);
  assert.equal(isLocalRequest(expressReq({ host: 'localhost:4600', 'x-forwarded-for': '1.2.3.4' })), false);
  assert.equal(isLocalRequest(expressReq({ host: 'localhost:4600' }, '10.0.0.5')), false);
});

test('a trusted address counts as this machine, straight to the IP only', () => {
  const trusted = ['104.30.132.38'];
  const from = (headers: Record<string, string>, ip: string) => isLocalRequest(expressReq(headers, ip), trusted);
  assert.equal(from({ host: '16.144.61.114:4600' }, '104.30.132.38'), true);
  assert.equal(from({ host: '16.144.61.114:4600' }, '::ffff:104.30.132.38'), true);
  assert.equal(from({ host: '16.144.61.114:4600' }, '104.30.132.39'), false);
  // A domain name in Host could be another site rebinding its name to this box.
  assert.equal(from({ host: 'evil.example:4600' }, '104.30.132.38'), false);
  assert.equal(from({ host: '16.144.61.114:4600', 'x-forwarded-for': '104.30.132.38' }, '127.0.0.1'), false);
  // Loopback with a public Host is still not this machine (the tunnel's case).
  assert.equal(from({ host: '16.144.61.114:4600' }, '127.0.0.1'), false);
});

test('a player socket opens only from the play site or the town itself', () => {
  const req = (headers: Record<string, string>) => ({ headers }) as unknown as http.IncomingMessage;
  const allowed = ['https://stream-play.kick-product.com'];
  assert.equal(playerOriginAllowed(req({ host: 'x.ngrok-free.dev', origin: 'https://stream-play.kick-product.com' }), allowed), true);
  assert.equal(playerOriginAllowed(req({ host: 'localhost:4600', origin: 'http://localhost:4600' }), allowed), true);
  assert.equal(playerOriginAllowed(req({ host: 'x.ngrok-free.dev', origin: 'https://evil.example' }), allowed), false);
  assert.equal(playerOriginAllowed(req({ host: 'x.ngrok-free.dev' }), allowed), false);
  assert.equal(playerOriginAllowed(req({ host: 'x.ngrok-free.dev', origin: 'not a url' }), allowed), false);
});

test('through the tunnel only the webhook and the play paths (with the Worker key) get in', () => {
  const key = 'k'.repeat(40);
  const remote = (method: string, path: string, k?: string) => tunnelAllows({ local: false, method, path, key: k }, key);
  assert.equal(remote('POST', '/kick/webhook'), true);
  assert.equal(remote('GET', '/kick/webhook'), false);
  assert.equal(remote('GET', '/play', key), true);
  assert.equal(remote('GET', '/ws/player', key), true);
  assert.equal(remote('GET', '/play'), false);
  assert.equal(remote('GET', '/play', 'wrong'), false);
  for (const p of ['/', '/admin', '/admin.html', '/admin/api/state', '/ws/mayor', '/mayor', '/kick/login', '/play/dev-login'])
    assert.equal(remote('GET', p, key), false, p);
  // This machine is never held to it; without a key the play paths are open, nothing else is.
  assert.equal(tunnelAllows({ local: true, method: 'GET', path: '/admin' }, key), true);
  assert.equal(tunnelAllows({ local: false, method: 'GET', path: '/play' }), true);
  assert.equal(tunnelAllows({ local: false, method: 'GET', path: '/admin.html' }), false);
});

test('a socket upgrade through the tunnel is held to the same rule', () => {
  const key = 'k'.repeat(40);
  const req = (url: string, headers: Record<string, string>, remoteAddress = '127.0.0.1') =>
    ({ url, method: 'GET', headers, socket: { remoteAddress } }) as unknown as http.IncomingMessage;
  const tunnel = { host: 'x.ngrok-free.dev', 'x-forwarded-for': '1.2.3.4' };
  assert.equal(tunnelAllowsUpgrade(req('/ws/player', { ...tunnel, 'x-town-key': key }), key), true);
  assert.equal(tunnelAllowsUpgrade(req('/ws/player', tunnel), key), false);
  assert.equal(tunnelAllowsUpgrade(req('/ws/mayor?token=x', { ...tunnel, 'x-town-key': key }), key), false);
  assert.equal(tunnelAllowsUpgrade(req('/ws/mayor', { host: 'localhost:4600' }), key), true);
});

test('the ngrok policy denies everything but the webhook and the keyed play paths', () => {
  const key = 'a'.repeat(64);
  const policy = ngrokPolicy(key);
  assert.match(policy, /type: deny/);
  assert.match(policy, /req\.url\.path == '\/kick\/webhook'/);
  for (const p of PLAY_PATHS) assert.ok(policy.includes(`'${p}'`), p);
  assert.ok(policy.includes(`req.headers['x-town-key'][0] == '${key}'`));
  assert.throws(() => ngrokPolicy("x' || true || '"));
});

test('the terminal log rolls over past its size and only its tail is read back', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dudes-log-'));
  const file = path.join(dir, 'log', 'terminal.jsonl');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, 'x'.repeat(LOG_ROTATE_BYTES + 10));
  new TerminalLog(dir);
  assert.equal(fs.existsSync(path.join(dir, 'log', 'terminal.1.jsonl')), true);
  assert.equal(fs.existsSync(file), false);
  fs.writeFileSync(file, 'first\nsecond\nthird\n');
  assert.equal(readTail(file, 6), 'third\n');
  assert.equal(readTail(path.join(dir, 'missing.jsonl'), 100), '');
  fs.rmSync(dir, { recursive: true, force: true });
});

class FakeSocket extends EventEmitter {
  readyState = 1;
  sent: unknown[] = [];
  closed?: number;
  send(data: string) {
    this.sent.push(JSON.parse(data));
  }
  close(code: number) {
    this.closed = code;
    this.readyState = 3;
  }
}

test('a /play seat: the heartbeat is not input, and a failing join turns the player away politely', () => {
  let joinThrows = false;
  const seats = new PlaySeats(
    2,
    {
      join: () => {
        if (joinThrows) throw new Error('boom');
        return { id: 'd1', position: { x: 0, z: 0 }, facing: 0 };
      },
      input: () => {},
      leave: () => {},
    },
    () => {},
  );
  const ws = new FakeSocket();
  seats.connect({ userId: 'kick:1', name: 'alex' }, ws as unknown as WebSocket);
  const seat = seats.seats.get('kick:1')!;
  seat.lastInputAt = 0;
  ws.emit('message', JSON.stringify({ t: 'move', x: 1, z: 1, facing: 0, moving: false }));
  assert.equal(seat.lastInputAt, 0);
  ws.emit('message', JSON.stringify({ t: 'move', x: 2, z: 1, facing: 0, moving: true }));
  assert.ok(seat.lastInputAt > 0);

  joinThrows = true;
  const other = new FakeSocket();
  assert.doesNotThrow(() => seats.connect({ userId: 'kick:2', name: 'sam' }, other as unknown as WebSocket));
  assert.equal(other.closed, 4004);
  assert.equal(seats.seats.has('kick:2'), false);
});
