// The /play site and combat: seats wait in line and turns end while others wait, kicks outlive a
// restart, muted chatters stay quiet, the server checks steps and rams itself, and griefing has a lid
// (rebuilds from the first hit, a minute's shrug after, away owners' builds take less, no chain KOs).
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import type { WebSocket } from 'ws';
import { PlaySeats } from '../src/server/play';
import { PLAYER, allowedStep, pilot, pilots, solidStep } from '../src/worlds/ai-dudes/players';
import { DAMAGE, damageBuild, hpOf, maxHpOf } from '../src/worlds/ai-dudes/damage';
import { knockOut, knockedOut, recover, COMBAT } from '../src/worlds/ai-dudes/combat';
import { harness } from './harness';
import type { AgentReply } from '../src/worlds/ai-dudes/agent';
import type { SafehouseObject } from '../src/shared/objectTypes';

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
const seatsFor = (cap: number, file?: string) =>
  new PlaySeats(cap, { join: (id) => ({ id, position: { x: 0, z: 0 }, facing: 0 }), input: () => {}, leave: () => {} }, () => {}, file);
const sock = () => new FakeSocket();
const ws = (s: FakeSocket) => s as unknown as WebSocket;

test('a full town: newcomers wait in line with their place shown, and get the next free seat', () => {
  const seats = seatsFor(1);
  const a = sock(),
    b = sock(),
    c = sock();
  seats.connect({ userId: 'kick:1', name: 'alex' }, ws(a));
  seats.connect({ userId: 'kick:2', name: 'sam' }, ws(b));
  seats.connect({ userId: 'kick:3', name: 'kim' }, ws(c));
  assert.equal(a.sent[0].t, 'welcome');
  assert.deepEqual([b.sent.at(-1)?.t, b.sent.at(-1)?.position], ['queue', 1]);
  assert.deepEqual([c.sent.at(-1)?.t, c.sent.at(-1)?.position], ['queue', 2]);
  assert.equal(b.closed, undefined, 'the line keeps its socket open');
  seats.release('kick:1', 'left');
  assert.equal(b.sent.at(-1)?.t, 'welcome', 'the front of the line gets the seat');
  assert.equal(c.sent.at(-1)?.position, 1, 'and everyone moves up');
  // Someone in line who closes the page leaves the line.
  c.close(1000);
  assert.equal(seats.queue.length, 0);
});

test('while others wait, a turn lasts fifteen minutes (with a minute’s warning)', () => {
  const seats = seatsFor(1);
  const a = sock(),
    b = sock();
  seats.connect({ userId: 'kick:1', name: 'alex' }, ws(a));
  seats.connect({ userId: 'kick:2', name: 'sam' }, ws(b));
  const now = Date.now();
  const seat = seats.seats.get('kick:1')!;
  seat.since = now - PlaySeats.SESSION_MS;
  seat.lastInputAt = now;
  const sweep = (t: number) => (seats as unknown as { sweep(n: number): void }).sweep(t);
  sweep(now);
  assert.ok(a.sent.some((m) => m.t === 'note' && /one more minute/i.test(String(m.text))), 'warned');
  assert.ok(seats.seats.has('kick:1'), 'still in for the minute');
  seats.seats.get('kick:1')!.lastInputAt = now + PlaySeats.WARN_MS;
  sweep(now + PlaySeats.WARN_MS);
  assert.equal(seats.seats.has('kick:1'), false, 'time is up');
  assert.equal(b.sent.at(-1)?.t, 'welcome', 'the next in line is in');
});

test('a kick is kept in a file: a restart does not let them back in', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dudes-play-'));
  const file = path.join(dir, 'play-kicks.json');
  const first = seatsFor(2, file);
  first.connect({ userId: 'kick:9', name: 'troll' }, ws(sock()));
  assert.equal(first.kick('kick:9', 60), true);
  const again = seatsFor(2, file);
  const s = sock();
  again.connect({ userId: 'kick:9', name: 'troll' }, ws(s));
  assert.equal(s.closed, 4003, 'still sent out after the restart');
  assert.ok(again.unkick('kick:9'));
  const t = sock();
  again.connect({ userId: 'kick:9', name: 'troll' }, ws(t));
  assert.equal(t.sent[0].t, 'welcome');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a step is held to a one-second distance budget, however many messages it comes in', () => {
  const p = pilot('dev:speedy', 'speedy', { x: 0, z: 0 }, 0);
  let x = 0;
  // Forty messages a second, each claiming half a metre (20 m/s), for two seconds.
  for (let i = 1; i <= 80; i++) {
    const at = i * 25;
    const to = allowedStep(p, { x: x + 0.5, z: 0 }, at);
    x = to.x;
    p.last = { at, x: to.x, z: to.z };
  }
  assert.ok(x <= PLAYER.run * 3 + 1, `no faster than running, give or take a second's catch-up (got ${x.toFixed(1)} m)`);
  assert.ok(x >= PLAYER.run * 2 - 1, 'but running speed itself is fine');
  pilots.delete('dev:speedy');
});

test('builds are solid on the server: a step into one slides along it or stays put', () => {
  const wall = { id: 'w', position: { x: 0, z: 0 }, footprint: { width: 4, depth: 4 }, blueprint: { parts: [] } } as unknown as SafehouseObject;
  assert.deepEqual(solidStep([wall], { x: -3, z: 0 }, { x: -1, z: 0 }), { x: -3, z: 0 }, 'straight in: stays put');
  assert.deepEqual(solidStep([wall], { x: -3, z: 2.5 }, { x: -1, z: 2.5 }), { x: -1, z: 2.5 }, 'past the corner: fine');
  assert.deepEqual(solidStep([wall], { x: 0, z: 0 }, { x: 0.5, z: 0 }), { x: 0.5, z: 0 }, 'already inside (it went up round them): may walk out');
  const rubble = { ...wall, destroyedAt: 1 } as SafehouseObject;
  assert.deepEqual(solidStep([rubble], { x: -3, z: 0 }, { x: -1, z: 0 }), { x: -1, z: 0 }, 'over a heap of rubble');
});

test('griefing has a lid: rebuilt from the first hit, a minute’s shrug after, and an away owner’s build takes less', async () => {
  let script: AgentReply['actions'] = [];
  const { h, say, tick } = harness({ reply: (turn) => ({ actions: turn.messages.length ? script : [] }) });
  script = [{ do: 'build', what: 'a stone house', kind: 'home' }];
  await say('kim', 'build me a house');
  await tick(80_000);
  const house = h.state.objects[0];
  const max = maxHpOf(house);
  damageBuild(h.state, house, max * 0.3, { name: 'Sam' }, h.now);
  // A tap every minute does not keep it down: it is back four minutes after the first hit.
  for (let i = 0; i < 4; i++) {
    await tick(60_000, 5000);
    damageBuild(h.state, house, 1, { name: 'Sam' }, h.now);
  }
  await tick(10_000, 5000);
  assert.equal(house.health, undefined, 'rebuilt despite the taps');
  assert.ok((house.guardUntil ?? 0) > h.now, 'and shrugging off hits for a bit');
  damageBuild(h.state, house, 50, { name: 'Sam' }, h.now);
  assert.equal(hpOf(house), max, 'a hit just after only rattles it');
  await tick(DAMAGE.guardMs + 1000, 5000);
  // Kim's chatter has gone quiet: her build takes far less.
  h.state.dudes.find((d) => d.name === 'kim')!.lastHeardAt = h.now - 60 * 60_000;
  damageBuild(h.state, house, 100, { name: 'Sam' }, h.now);
  assert.ok(max - hpOf(house) <= 100 * DAMAGE.awayShare + 0.5, 'an away owner’s build takes a share of it');
});

test('knocked out, then back up: not again for a few seconds', async () => {
  const { h, say, tick } = harness({});
  await say('kim', 'hello');
  await say('sam', 'hi');
  await tick(2000);
  const [kim, sam] = h.state.dudes;
  knockOut(h.state, kim, sam, 'blew up', h.now, { ms: 5000 });
  assert.ok(knockedOut(kim, h.now));
  recover(kim, h.now + 5000);
  knockOut(h.state, kim, sam, 'blew up', h.now + 5500, { ms: 5000 });
  assert.equal(knockedOut(kim, h.now + 5500), false, 'still guarded just after standing');
  knockOut(h.state, kim, sam, 'blew up', h.now + 5000 + COMBAT.koGuardMs + 100, { ms: 5000 });
  assert.ok(knockedOut(kim, h.now + 5000 + COMBAT.koGuardMs + 200), 'fair game again after');
});

test('a muted chatter cannot walk, talk or build on /play', async () => {
  const { world, ctx, h, say, tick } = harness({});
  await say('kim', 'hello');
  await tick(1000);
  const kim = h.state.dudes[0];
  const joined = world.players!.join(ctx, kim.id, 'kim');
  assert.equal(typeof joined, 'object');
  kim.muted = true;
  const said = world.players!.input(ctx, kim.id, { t: 'say', text: 'hello stream' });
  assert.match(String(said?.note), /muted/);
  assert.notEqual(kim.say?.text, 'hello stream');
  assert.match(String(world.players!.input(ctx, kim.id, { t: 'build', what: 'a tower' })?.note), /muted/);
  world.players!.leave(ctx, kim.id);
  assert.equal(typeof world.players!.join(ctx, kim.id, 'kim'), 'string', 'and cannot come back in');
  pilots.clear();
});
