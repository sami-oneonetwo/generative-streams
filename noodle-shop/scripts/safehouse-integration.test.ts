import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Engine } from '../src/engine/engine';
import { loadState, StateVersionError } from '../src/engine/persistence';
import { blankWorld } from '../src/worlds/blank';
import type { WorldModule } from '../src/engine/world';

// Generic engine changes must remain safe for old worlds, too.
test('world service starts with live context, checkpoints and stops exactly once', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'world-service-'));
  let starts = 0,
    stops = 0;
  const world: WorldModule<ReturnType<typeof blankWorld.createInitialState>> = {
    ...blankWorld,
    start(ctx) {
      starts++;
      ctx.checkpoint?.();
      return () => {
        stops++;
      };
    },
  };
  try {
    const engine = new Engine(world, {
      dataDir: dir,
      confidenceThreshold: 0.6,
      flags: { devTimeScale: 1, kickRepliesEnabled: false },
    });
    assert.equal(starts, 1);
    assert.ok(fs.existsSync(path.join(dir, 'world-blank.json')));
    engine.stop();
    engine.stop();
    assert.equal(stops, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('operator reset backs up the world, starts fresh, and keeps cost controls', async () => {
  const { createSafehouseWorld } = await import('../src/worlds/safehouse');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'world-reset-'));
  try {
    const world = createSafehouseWorld({ fixture: true, workMs: 500 });
    const engine = new Engine(world, {
      dataDir: dir,
      confidenceThreshold: 0.6,
      flags: { devTimeScale: 1, kickRepliesEnabled: false },
    });
    const couch = engine.state.objects.find((o) => o.blueprint.name === "Rook's house")!;
    couch.health = 5;
    engine.state.callsRemaining = 3;
    engine.state.generationPaused = true;
    engine.state.combat.zombies.push({
      id: 'z1',
      position: { x: 0, z: 10 },
      health: 60,
      facing: 0,
      attackAt: 0,
      path: [],
      replanAt: 0,
    });
    engine.save();
    const { backup } = engine.reset();
    assert.ok(backup && fs.existsSync(backup), 'backup written before reset');
    assert.equal(
      JSON.parse(fs.readFileSync(backup!, 'utf8')).objects.find((o: { id: string }) => o.id === couch.id)
        .health,
      5,
    );
    const fresh = engine.state.objects.find((o) => o.blueprint.name === "Rook's house")!;
    assert.equal(fresh.health, fresh.maxHealth);
    assert.equal(engine.state.combat.zombies.length, 0);
    assert.equal(engine.state.combat.paused, true);
    assert.equal(engine.state.callsRemaining, 3, 'allowance survives a reset');
    assert.equal(engine.state.generationPaused, true, 'pause survives a reset');
    assert.equal(engine.state.jobs.length, 0);
    engine.stop();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('corrupt primary and backup cannot silently become an empty world', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'world-corrupt-'));
  const file = path.join(dir, 'world-blank.json');
  try {
    fs.writeFileSync(file, '{unfinished');
    fs.writeFileSync(file + '.bak', '{also unfinished');
    assert.throws(() => loadState(blankWorld, dir, () => {}), StateVersionError);
    assert.equal(fs.readFileSync(file, 'utf8'), '{unfinished');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('valid backup still recovers an interrupted primary write', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'world-backup-'));
  const file = path.join(dir, 'world-blank.json');
  try {
    fs.writeFileSync(file, '{unfinished');
    const state = blankWorld.createInitialState(100);
    fs.writeFileSync(file + '.bak', JSON.stringify(state));
    assert.deepEqual(
      loadState(blankWorld, dir, () => {}),
      state,
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
