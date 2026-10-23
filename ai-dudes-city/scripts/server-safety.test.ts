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

test('a player socket opens only from the play site or the town itself', () => {
  const req = (headers: Record<string, string>) => ({ headers }) as unknown as http.IncomingMessage;
  const allowed = ['https://stream-play.kick-product.com'];
  assert.equal(playerOriginAllowed(req({ host: 'x.ngrok-free.dev', origin: 'https://stream-play.kick-product.com' }), allowed), true);
  assert.equal(playerOriginAllowed(req({ host: 'localhost:4600', origin: 'http://localhost:4600' }), allowed), true);
  assert.equal(playerOriginAllowed(req({ host: 'x.ngrok-free.dev', origin: 'https://evil.example' }), allowed), false);
  assert.equal(playerOriginAllowed(req({ host: 'x.ngrok-free.dev' }), allowed), false);
  assert.equal(playerOriginAllowed(req({ host: 'x.ngrok-free.dev', origin: 'not a url' }), allowed), false);
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
