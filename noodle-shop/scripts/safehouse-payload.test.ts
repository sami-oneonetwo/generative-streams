// Snapshots carry everything about an object except its geometry; the parts travel
// once per id+revision through POST /api/objects/parts. This is what lets the world grow.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { Engine } from '../src/engine/engine';
import { createSafehouseWorld } from '../src/worlds/safehouse';
import { createHttpServer } from '../src/server/http';
import { WsHub } from '../src/server/ws';
import { KickAuth } from '../src/kick/oauth';
import { EchoGuard } from '../src/kick/echo';
import { config } from '../src/config';
import { viewOf, partsKey } from '../src/shared/safehouseTypes';
import { sceneryObjects } from '../src/worlds/safehouse/scenery';
import { HOUSE_ID } from '../src/shared/safehouseLayout';
import type { EngineView } from '../src/engine/world';

const engineView: EngineView = {
  protagonist: { x: 0, state: 'idle' },
  pendingTasks: [],
  logLines: [],
  recentChat: [],
  chatRevision: 0,
  now: 0,
};

test('a snapshot names objects and their revision but carries no geometry; the world serves it on request', () => {
  const house = sceneryObjects().find((o) => o.id === HOUSE_ID)!;
  const view = viewOf(house);
  assert.equal(view.blueprint.name, "Rook's house");
  assert.equal(view.blueprint.partCount, house.blueprint.parts.length);
  assert.equal(view.blueprint.color, house.blueprint.parts[0].color);
  assert.ok(!('parts' in view.blueprint));
  assert.equal(partsKey(house.id, 3), 'scenery-house:3');

  const world = createSafehouseWorld({ seedScenery: true, fixture: true });
  const state = world.createInitialState(0);
  // A ruin in the archive and a ghost in flight are also things the page will ask about.
  const ruin = { ...structuredClone(state.objects.find((o) => o.id === 'scenery-crate')!), destroyedAt: 1, revision: 4 };
  state.combat.archive.push(ruin);
  state.jobs.push({
    id: 'j1',
    text: 'Build a thing',
    username: 'dave',
    userId: 'dave',
    status: 'walking',
    createdAt: 0,
    attempts: 1,
    label: 'Thing',
    path: [],
    workedMs: 0,
    workMs: 1000,
    preview: { ...structuredClone(house), id: 'ghost-1', revision: 1 },
  });
  const scene = world.buildScene(state, engineView).safehouse!;
  const json = JSON.stringify(scene);
  assert.ok(!json.includes('"shape"') || json.split('"shape"').length - 1 === house.blueprint.parts.length, 'only the in-flight preview carries parts');
  assert.ok(scene.objects.every((o) => !('parts' in o.blueprint)));
  assert.ok(scene.combat!.archive.every((o) => !('parts' in o.blueprint)));
  const full = JSON.stringify({ ...scene, objects: state.objects, combat: state.combat }).length;
  // The fresh fixture world is mostly small pieces (and this snapshot still carries the ghost's
  // parts), so the win is ~3×; the live world with big community designs measured 7×.
  assert.ok(json.length < full / 2.5, `snapshot ${json.length} bytes vs ${full} with geometry inline`);

  assert.deepEqual(world.objectParts!(state, HOUSE_ID, 1), house.blueprint.parts);
  assert.deepEqual(world.objectParts!(state, 'scenery-crate', 4), ruin.blueprint.parts, 'archived revisions are served');
  assert.equal(world.objectParts!(state, 'ghost-1', 1), state.jobs[0].preview!.blueprint.parts, 'the ghost in flight is served');
  assert.equal(world.objectParts!(state, HOUSE_ID, 99), undefined, 'an unknown revision is not');
  assert.equal(world.objectParts!(state, 'nope', 1), undefined);
});

test('POST /api/objects/parts returns the parts for known id:revision keys, in one round trip, bounded', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'world-parts-'));
  const token = config.ADMIN_TOKEN;
  config.ADMIN_TOKEN = undefined;
  const world = createSafehouseWorld({ seedScenery: true, fixture: true });
  const engine = new Engine(world, {
    dataDir: dir,
    confidenceThreshold: 0.6,
    flags: { devTimeScale: 1, kickRepliesEnabled: false },
  });
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
  hub = new WsHub(server, 'safehouse');
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  try {
    const garage = engine.state.objects.find((o) => o.id === 'scenery-garage')!;
    const keys = [partsKey(HOUSE_ID, 1), partsKey(garage.id, garage.revision), 'scenery-garage:77', 'nonsense', 42];
    const r = await fetch(`http://127.0.0.1:${port}/api/objects/parts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keys }),
    });
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('cache-control'), 'no-store');
    const body = (await r.json()) as { parts: Record<string, unknown[]> };
    assert.deepEqual(Object.keys(body.parts).sort(), [partsKey(HOUSE_ID, 1), partsKey(garage.id, garage.revision)].sort());
    assert.equal(body.parts[partsKey(garage.id, garage.revision)].length, garage.blueprint.parts.length);
    const empty = await fetch(`http://127.0.0.1:${port}/api/objects/parts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nothing: true }),
    });
    assert.deepEqual(await empty.json(), { parts: {} });
  } finally {
    engine.stop();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    config.ADMIN_TOKEN = token;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
