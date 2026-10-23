// The operations safety nets: a copy of the live save still loads (so a schema change can't take the
// stream down on hot reload), loadState refuses to boot rather than overwrite real data, saveState is
// atomic, the /play seats admit and queue, and the model client retries and times out as it should.
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { z } from 'zod';
import type { WebSocket } from 'ws';
import { config } from '../src/config';
import type { WorldModule } from '../src/engine/world';
import { StateVersionError, loadState, saveState, statePath } from '../src/engine/persistence';
import { PlaySeats, signPlayToken, verifyPlayToken } from '../src/server/play';
import { stateSchema } from '../src/worlds/ai-dudes/state';
import { harness } from './harness';

const FIXTURE = path.join(import.meta.dirname, 'fixtures', 'world-ai-dudes.live-2026-10-23.json');
const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'dudes-ops-'));

// ---- the live save ------------------------------------------------------------------------------

test('a copy of the live save (chat lines scrubbed) still parses against the state schema', () => {
  const raw = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
  const parsed = stateSchema.safeParse(raw);
  assert.ok(parsed.success, parsed.success ? '' : `${parsed.error.issues[0]?.path.join('.')}: ${parsed.error.issues[0]?.message}`);
});

test('the live save loads through loadState, starts, ticks and draws without throwing', async () => {
  const { world, ctx, h, tick } = harness();
  const dir = tmpDir();
  fs.copyFileSync(FIXTURE, statePath(dir, world.meta.id));
  h.state = loadState(world, dir, () => {});
  world.start!(ctx);
  await tick(5000);
  assert.ok(h.state.dudes.length > 0);
  assert.doesNotThrow(() => world.buildScene(h.state, { now: h.now } as never));
  assert.doesNotThrow(() => world.adminStatus?.(h.state, h.now));
  // And what it saves loads again.
  saveState(world, dir, h.state);
  assert.ok(stateSchema.safeParse(JSON.parse(fs.readFileSync(statePath(dir, world.meta.id), 'utf8'))).success);
  fs.rmSync(dir, { recursive: true, force: true });
});

// ---- loadState / saveState ------------------------------------------------------------------------

interface Tiny {
  version: number;
  n: number;
}
function tinyWorld(stateVersion = 2): WorldModule<Tiny> & { migrated: number[] } {
  const migrated: number[] = [];
  return {
    meta: { id: 'tiny', name: 'tiny', stateVersion },
    stateSchema: z.object({ version: z.number().int(), n: z.number() }) as unknown as z.ZodType<Tiny>,
    createInitialState: () => ({ version: stateVersion, n: 0 }),
    migrate: (raw: unknown, from: number) => {
      migrated.push(from);
      return { ...(raw as Tiny), version: stateVersion };
    },
    migrated,
  } as unknown as WorldModule<Tiny> & { migrated: number[] };
}
const write = (dir: string, data: unknown, suffix = '') => fs.writeFileSync(statePath(dir, 'tiny') + suffix, typeof data === 'string' ? data : JSON.stringify(data));

test('loadState: no snapshot starts fresh; a good one loads; an older one is migrated', () => {
  const dir = tmpDir();
  assert.deepEqual(loadState(tinyWorld(), dir, () => {}), { version: 2, n: 0 });
  write(dir, { version: 2, n: 5 });
  assert.equal(loadState(tinyWorld(), dir, () => {}).n, 5);
  write(dir, { version: 1, n: 7 });
  const w = tinyWorld();
  assert.deepEqual(loadState(w, dir, () => {}), { version: 2, n: 7 });
  assert.deepEqual(w.migrated, [1]);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('loadState refuses to boot on newer data, on data that fails the schema, and when nothing is readable', () => {
  const dir = tmpDir();
  write(dir, { version: 3, n: 1 });
  assert.throws(() => loadState(tinyWorld(), dir, () => {}), StateVersionError);
  write(dir, { version: 2, n: 'not a number' });
  assert.throws(() => loadState(tinyWorld(), dir, () => {}), StateVersionError);
  write(dir, '{ torn json');
  assert.throws(() => loadState(tinyWorld(), dir, () => {}), StateVersionError);
  // The backup is tried before refusing.
  write(dir, { version: 2, n: 9 }, '.bak');
  assert.equal(loadState(tinyWorld(), dir, () => {}).n, 9);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('saveState writes atomically and keeps the previous snapshot as .bak', () => {
  const dir = tmpDir();
  const w = tinyWorld();
  saveState(w, dir, { version: 2, n: 1 });
  saveState(w, dir, { version: 2, n: 2 });
  const file = statePath(dir, 'tiny');
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).n, 2);
  assert.equal(JSON.parse(fs.readFileSync(`${file}.bak`, 'utf8')).n, 1);
  assert.equal(fs.existsSync(`${file}.tmp`), false);
  fs.rmSync(dir, { recursive: true, force: true });
});

// ---- /play seats ----------------------------------------------------------------------------------

class FakeSocket extends EventEmitter {
  readyState = 1;
  sent: { t: string; [k: string]: unknown }[] = [];
  closed?: number;
  send(data: string) {
    this.sent.push(JSON.parse(data));
  }
  close(code: number) {
    this.closed = code;
    this.readyState = 3;
    this.emit('close');
  }
}
const sock = () => new FakeSocket();
const asWs = (s: FakeSocket) => s as unknown as WebSocket;

test('play tokens: signed ones verify, tampered or expired ones do not', () => {
  const secret = 'x'.repeat(32);
  const ok = signPlayToken('123', 'alex', secret, 60_000);
  assert.deepEqual(verifyPlayToken(ok, secret), { userId: 'kick:123', name: 'alex' });
  assert.equal(verifyPlayToken(ok, 'y'.repeat(32)), undefined);
  assert.equal(verifyPlayToken(ok.replace(/^./, (c) => (c === 'a' ? 'b' : 'a')), secret), undefined);
  assert.equal(verifyPlayToken(signPlayToken('123', 'alex', secret, -1), secret), undefined);
  assert.equal(verifyPlayToken(signPlayToken('not-a-number', 'alex', secret, 60_000), secret), undefined);
});

test('play seats: up to the cap, then a line that moves up when a seat is given back; kicked players stay out', () => {
  const joined: string[] = [],
    left: string[] = [];
  const seats = new PlaySeats(
    2,
    { join: (id) => (joined.push(id), { id, position: { x: 0, z: 0 }, facing: 0 }), input: () => {}, leave: (id) => void left.push(id) },
    () => {},
  );
  const [a, b, c] = [sock(), sock(), sock()];
  seats.connect({ userId: 'kick:1', name: 'a' }, asWs(a));
  seats.connect({ userId: 'kick:2', name: 'b' }, asWs(b));
  seats.connect({ userId: 'kick:3', name: 'c' }, asWs(c));
  assert.equal(a.sent[0].t, 'welcome');
  assert.equal(c.sent.at(-1)!.t, 'queue');
  assert.equal(c.sent.at(-1)!.position, 1);
  assert.deepEqual(seats.count(), { used: 2, cap: 2, open: true, waiting: 1 });

  seats.release('kick:1', 'test');
  assert.deepEqual(left, ['kick:1']);
  assert.equal(a.closed, 4000);
  assert.equal(c.sent.at(-1)!.t, 'welcome', 'the first in line got the seat');
  assert.deepEqual(joined, ['kick:1', 'kick:2', 'kick:3']);

  assert.equal(seats.kick('kick:2', 10), true);
  const again = sock();
  seats.connect({ userId: 'kick:2', name: 'b' }, asWs(again));
  assert.equal(again.closed, 4003);
  assert.equal(seats.unkick('kick:2'), true);

  seats.open = false;
  const late = sock();
  seats.connect({ userId: 'kick:9', name: 'z' }, asWs(late));
  assert.equal(late.closed, 4002);
});

// ---- the model client -----------------------------------------------------------------------------

/** A key the client sees (config was parsed long before this), and fetch swapped for a script. */
async function client(script: ((init: RequestInit) => Promise<Response>)[]) {
  config.OPENROUTER_API_KEY = 'test-key';
  const { chatCompletion } = await import('../src/llm/openrouter');
  let calls = 0;
  const real = globalThis.fetch;
  globalThis.fetch = (async (_url: unknown, init: RequestInit) => script[Math.min(calls++, script.length - 1)](init)) as typeof fetch;
  return { chatCompletion, calls: () => calls, restore: () => void (globalThis.fetch = real) };
}
const answer = (content: string, finish = 'stop') => async () => new Response(JSON.stringify({ choices: [{ finish_reason: finish, message: { content } }] }), { status: 200 });
const status = (code: number) => async () => new Response('nope', { status: code });
/** A request that only ends when it is aborted. */
const hang = (init: RequestInit) => new Promise<Response>((_, reject) => init.signal!.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))));
const base = { model: 'm', messages: [{ role: 'user' as const, content: 'hi' }] };

test('chatCompletion retries once on a 5xx, then answers', async () => {
  const c = await client([status(503), answer('hello')]);
  try {
    assert.equal(await c.chatCompletion({ ...base, attempts: 2 }), 'hello');
    assert.equal(c.calls(), 2);
  } finally {
    c.restore();
  }
});

test('chatCompletion does not retry a 4xx, or an answer that ran out of room', async () => {
  const c = await client([status(400)]);
  try {
    await assert.rejects(c.chatCompletion({ ...base, attempts: 2 }), /openrouter 400/);
    assert.equal(c.calls(), 1);
  } finally {
    c.restore();
  }
  const d = await client([answer('{"a":', 'length')]);
  try {
    await assert.rejects(d.chatCompletion({ ...base, json: true, attempts: 2 }), /output limit/);
    assert.equal(d.calls(), 1);
  } finally {
    d.restore();
  }
});

test('chatCompletion gives up at its timeout, and stops at once when the caller aborts', async () => {
  const c = await client([hang]);
  try {
    const t0 = Date.now();
    await assert.rejects(c.chatCompletion({ ...base, timeoutMs: 50, attempts: 1 }));
    assert.ok(Date.now() - t0 < 2000);
    const ac = new AbortController();
    const p = c.chatCompletion({ ...base, timeoutMs: 60_000, attempts: 2, signal: ac.signal });
    setTimeout(() => ac.abort(), 20);
    await assert.rejects(p);
    assert.equal(c.calls(), 2, 'no retry after the caller aborted');
  } finally {
    c.restore();
  }
});
