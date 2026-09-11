// Pure tests for capacity-aware chaos: chaosLevel() itself (unit-level, no
// engine/state needed), plus a couple of checks wired through the real
// server-room buildScene to prove the field lands on the actual Scene and
// that other worlds never grow it.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chaosLevel } from '../src/worlds/server-room/display';
import { buildScene, LAYOUT } from '../src/worlds/server-room/scene';
import { createInitialState, roomCapacityPerMin, type Server } from '../src/worlds/server-room/state';
import type { EngineView } from '../src/engine/world';
import type { SceneTraffic } from '../src/shared/sceneTypes';
import { buildScene as noodleScene } from '../src/worlds/noodle-shop/scene';
import { createInitialState as initialNoodles } from '../src/worlds/noodle-shop/state';

const now = 1_800_000_000_000;
const view: EngineView = {
  now, protagonist: { x: LAYOUT.homeX, state: 'idle' },
  pendingTasks: [], logLines: [], recentChat: [], chatRevision: 0,
};

/** Minimal SceneTraffic fixture; only demand/capacity/load feed chaosLevel. */
function traffic(overrides: Partial<SceneTraffic> = {}): SceneTraffic {
  return {
    demand: 0,
    capacity: 0,
    backlog: 0,
    lagSeconds: null,
    load: null,
    status: 'NOTHING GETTING THROUGH',
    delivered: 0,
    dropped: 0,
    ...overrides,
  };
}

test('chaos is calm at/under 30% load and pinned to 1 at/over full load', () => {
  assert.equal(chaosLevel(traffic({ demand: 0, capacity: 100, load: 0 }), false), 0);
  assert.equal(chaosLevel(traffic({ demand: 30, capacity: 100, load: 0.3 }), false), 0);
  assert.equal(chaosLevel(traffic({ demand: 100, capacity: 100, load: 1 }), false), 1);
  assert.equal(chaosLevel(traffic({ demand: 400, capacity: 100, load: 4 }), false), 1);
});

test('chaos rises monotonically with load and is not just a flat step', () => {
  const capacity = 100;
  const loads = [0, 0.2, 0.3, 0.45, 0.6, 0.75, 0.9, 1, 1.5];
  const chaoses = loads.map((load) => chaosLevel(traffic({ demand: load * capacity, capacity, load }), false));
  for (let i = 1; i < chaoses.length; i++) {
    assert.ok(
      chaoses[i] >= chaoses[i - 1],
      `chaos should never fall as load rises: load ${loads[i - 1]} -> ${loads[i]} gave ${chaoses[i - 1]} -> ${chaoses[i]}`,
    );
  }
  assert.ok(chaoses[chaoses.length - 1] > chaoses[0], 'the ramp must carry real signal, not be flat throughout');
});

test('zero capacity is a breaker: chaos only maxes out once something is actually arriving', () => {
  assert.equal(chaosLevel(traffic({ demand: 0, capacity: 0, load: null }), false), 0);
  assert.equal(chaosLevel(traffic({ demand: 1, capacity: 0, load: null }), false), 1);
  assert.equal(chaosLevel(traffic({ demand: 500, capacity: 0, load: null }), false), 1);
});

test('an emergency is chaos on its own, even with nothing arriving right now', () => {
  assert.equal(chaosLevel(traffic({ demand: 0, capacity: 0, load: null }), true), 1);
  assert.equal(chaosLevel(traffic({ demand: 0, capacity: 100, load: 0 }), true), 1);
  assert.equal(chaosLevel(traffic({ demand: 500, capacity: 100, load: 5 }), true), 1);
});

test('chaosLevel is always a safe, finite number in [0, 1], however it is fed', () => {
  const cases: SceneTraffic[] = [
    traffic({ demand: NaN, capacity: 100, load: NaN }),
    traffic({ demand: 50, capacity: NaN, load: NaN }),
    traffic({ demand: Infinity, capacity: 100, load: Infinity }),
    traffic({ demand: -10, capacity: 100, load: -0.1 }),
    traffic({ demand: 50, capacity: -10, load: null }),
    traffic({ demand: Infinity, capacity: Infinity, load: NaN }),
  ];
  for (const t of cases) {
    for (const emergency of [false, true]) {
      const v = chaosLevel(t, emergency);
      assert.ok(Number.isFinite(v), `expected a finite number, got ${v} for ${JSON.stringify(t)} emergency=${emergency}`);
      assert.ok(v >= 0 && v <= 1, `expected a value in [0, 1], got ${v}`);
    }
  }
});

/** A server-room state with `count` healthy, unupgraded servers and a fixed chat demand. */
function roomWithServers(count: number, demandPerMin: number) {
  const state = createInitialState(now);
  for (let i = 0; i < count; i++) {
    const server: Server = {
      id: `srv-${i}`, slot: i, ownerUserId: `user-${i}`, ownerName: `guest-${i}`, name: `server-${i}`,
      health: 95, level: 0, temperature: 22, powerDrawW: 150,
      uptimeDays: 1, delivered: 0, createdAt: now, darkStreams: 0,
    };
    state.servers[server.id] = server;
  }
  state.traffic.capacityPerMin = roomCapacityPerMin(state);
  state.traffic.demandPerMin = demandPerMin;
  return state;
}

test('real increased capacity at equal demand reduces chaos, wired through the actual scene', () => {
  const demand = 45; // held fixed; only the room's real capacity changes below
  const lean = buildScene(roomWithServers(2, demand), view); // few servers -> high load
  const staffed = buildScene(roomWithServers(5, demand), view); // more real servers -> lower load, same demand
  assert.equal(typeof lean.chaos, 'number');
  assert.equal(typeof staffed.chaos, 'number');
  assert.ok(
    staffed.chaos! < lean.chaos!,
    `more real capacity at the same demand should cool chaos, got lean=${lean.chaos} staffed=${staffed.chaos}`,
  );
});

test('upgrading the same servers calms the same demand despite a stale tick capacity', () => {
  const state = roomWithServers(4, 75);
  const before = buildScene(state, view).chaos!;
  for (const server of Object.values(state.servers)) server.level = 3;
  assert.ok(buildScene(state, view).chaos! < before);
  state.power.breakerTripped = true;
  assert.equal(buildScene(state, view).chaos, 1);
  state.traffic.demandPerMin = 0;
  assert.equal(buildScene(state, view).chaos, 0);
});

test('an actual emergency scene reports full chaos regardless of the traffic snapshot', () => {
  const state = roomWithServers(3, 0); // no demand at all right now
  state.emergency = { startedAt: now, serverIds: ['srv-0'], index: 0, stage: 'pull' };
  const scene = buildScene(state, view);
  assert.equal(scene.chaos, 1);
});

test('a calm, well-staffed room reports zero chaos through the real scene', () => {
  const scene = buildScene(roomWithServers(6, 20), view);
  assert.equal(scene.chaos, 0);
});

test('a world that never wires chaos in has no chaos field on its scene', () => {
  const scene = noodleScene(initialNoodles(now), { ...view, protagonist: { x: 720, state: 'idle' } });
  assert.equal(scene.chaos, undefined);
  assert.ok(!('chaos' in scene), 'noodle-shop scenes must not carry a chaos key at all');
});
