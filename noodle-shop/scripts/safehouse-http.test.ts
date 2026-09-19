import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import WebSocket from 'ws';
import { Engine } from '../src/engine/engine';
import { blankWorld } from '../src/worlds/blank';
import { createHttpServer } from '../src/server/http';
import { WsHub } from '../src/server/ws';
import { KickAuth } from '../src/kick/oauth';
import { EchoGuard } from '../src/kick/echo';
import { config } from '../src/config';

test('HTTP chat reaches the same pipeline and WebSocket reconnect gets latest snapshot', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'world-http-'));
  const token = config.ADMIN_TOKEN;
  config.ADMIN_TOKEN = undefined;
  const engine = new Engine(blankWorld, {
    dataDir: dir,
    confidenceThreshold: 0.6,
    flags: { devTimeScale: 1, kickRepliesEnabled: false },
  });
  const received: string[] = [];
  engine.pipeline.handle = async (msg) => {
    received.push(msg.text);
  };
  const auth = new KickAuth(dir, () => {});
  let hub: WsHub;
  const server = createHttpServer({
    engine,
    auth,
    echo: new EchoGuard(),
    dataDir: dir,
    wsClientCount: () => hub.clientCount,
    kickSubscription: {},
  });
  hub = new WsHub(server, 'blank');
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const response = await fetch(url + '/admin/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'test', text: 'a new creation' }),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(received, ['a new creation']);
    const bad = await fetch(url + '/admin/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'test', text: 'x'.repeat(1001) }),
    });
    assert.equal(bad.status, 400);
    const unconfirmed = await fetch(url + '/admin/api/reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.equal(unconfirmed.status, 400, 'reset needs the literal confirmation');
    const reset = await fetch(url + '/admin/api/reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirm: 'RESET' }),
    });
    assert.equal(reset.status, 200);
    assert.ok(
      fs.readdirSync(dir).some((f) => f.includes('before-reset')),
      'reset leaves a backup behind',
    );
    const scene = engine.buildScene(1000);
    hub.broadcast({ t: 'state', rev: 42, serverTime: 1000, scene });
    for (let i = 0; i < 2; i++) {
      const messages = await new Promise<any[]>((resolve, reject) => {
        const socket = new WebSocket(url.replace('http:', 'ws:') + '/ws');
        const rows: any[] = [];
        const timer = setTimeout(() => {
          socket.terminate();
          reject(new Error('socket timed out'));
        }, 5000);
        socket.on('error', reject);
        socket.on('message', (data) => {
          rows.push(JSON.parse(String(data)));
          if (rows.length === 2) {
            clearTimeout(timer);
            socket.close();
            resolve(rows);
          }
        });
      });
      assert.equal(messages[0].worldId, 'blank');
      assert.equal(messages[1].rev, 42);
      assert.deepEqual(messages[1].scene, JSON.parse(JSON.stringify(scene)));
    }
  } finally {
    engine.stop();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    config.ADMIN_TOKEN = token;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
