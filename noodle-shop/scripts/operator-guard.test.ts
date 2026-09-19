import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import http from 'node:http';

function request(url: string, headers: Record<string, string> = {}): Promise<{ status: number }> {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { headers }, res => { res.resume(); res.on('end', () => resolve({ status: res.statusCode! })); });
    req.on('error', reject);
  });
}
import type { AddressInfo } from 'node:net';
import { operatorGuard } from '../src/server/operatorGuard';

// Use node:http because fetch normalizes Host instead of preserving spoofed test headers.
function fetch(url: string, opts?: { headers: Record<string, string> }): Promise<{ status: number }> {
  return request(url, opts?.headers);
}

async function withServer(token: string | undefined, run: (url: string) => Promise<void>): Promise<void> {
  const app = express();
  app.use(operatorGuard(token));
  app.all('/check', (_req, res) => res.json({ ok: true }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  try { await run(`http://127.0.0.1:${(server.address() as AddressInfo).port}/check`); }
  finally { await new Promise<void>(resolve => server.close(() => resolve())); }
}

test('local operator requests allowed, public hosts and forwarded tunnels denied', async () => {
  await withServer(undefined, async url => {
    assert.equal((await fetch(url)).status, 200);
    assert.equal((await fetch(url, { headers: { Host: 'stream.example.com' } })).status, 403);
    assert.equal((await fetch(url, { headers: { 'X-Forwarded-For': '198.51.100.1' } })).status, 403);
    assert.equal((await fetch(url, { headers: { Origin: 'https://attacker.example' } })).status, 403);
    assert.equal((await fetch(url, { headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
  });
});

test('configured token required even locally and permits authenticated proxy access', async () => {
  await withServer('safehouse-operator-test-token', async url => {
    assert.equal((await fetch(url)).status, 401);
    assert.equal((await fetch(url, { headers: { Authorization: 'Bearer wrong' } })).status, 401);
    const headers = { Authorization: 'Bearer safehouse-operator-test-token', Host: 'stream.example.com', 'X-Forwarded-For': '198.51.100.1' };
    assert.equal((await fetch(url, { headers })).status, 200);
    assert.equal((await fetch(url, { headers: { ...headers, Origin: 'https://attacker.example' } })).status, 403);
    assert.equal((await fetch(url, { headers: { ...headers, Origin: 'https://stream.example.com' } })).status, 200);
  });
});
