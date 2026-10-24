// The stats overlay (`?stats=1`, client/dudes/stats.ts): off unless asked for, frames a second and
// the page's work from a window of frames, people walking in the frame, the builds on the move by
// kind, and the motion budget's limits flagged (board/motion-budget.md).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { FrameWindow, STATS_BUDGET, createStats, framer, statsRows, tally, type MoverAt, type PersonAt, type StatsSample } from '../client/dudes/stats';
import { createObjectsLayer } from '../client/dudes/objects';
import type { SafehouseObjectView } from '../client/dudes/types';

/** The stream's camera, looking down on the square from the south-east, 20 m half-height. */
function streamCamera(): THREE.OrthographicCamera {
  const cam = new THREE.OrthographicCamera(-20 * (16 / 9), 20 * (16 / 9), 20, -20, 0.1, 2400);
  cam.position.set(300, 400, 300);
  cam.lookAt(0, 0, 0);
  cam.updateMatrixWorld();
  return cam;
}

test('off by default: no handle, and the renderer is left alone', () => {
  for (const search of ['', '?stream=1', '?stats=0', '?stats=true', '?stats']) {
    const renderer = { info: { autoReset: true } };
    // No DOM here: anything that tried to make the panel would throw.
    const handle = createStats(new URLSearchParams(search), renderer as never, streamCamera(), { each: () => assert.fail('counted') }, { movers: () => assert.fail('counted') });
    assert.equal(handle, undefined, search);
    assert.equal(renderer.info.autoReset, true, `${search}: the draw count is three.js's own`);
  }
});

test('in frame: what the camera sees, not what is behind its edges', () => {
  const inFrame = framer(streamCamera());
  assert.ok(inFrame(0, 1, 0), 'the centre of the shot');
  assert.ok(inFrame(15, 0, -15), 'off to the side but in view');
  assert.ok(!inFrame(80, 0, -80), 'far off to the right');
  assert.ok(!inFrame(-60, 0, -60), 'behind the top edge');
});

test('walking in frame: people on foot moving; standing, riding, inside a build or out of shot are not', () => {
  const inFrame = framer(streamCamera());
  const people: PersonAt[] = [
    { x: 0, y: 0, z: 0, speed: 2.4 }, // walking
    { x: 2, y: 0, z: 1, speed: 1.3 }, // wandering
    { x: -3, y: 0, z: 2, speed: 0.1 }, // turning on the spot
    { x: 4, y: 0, z: -2, speed: 0 }, // standing
    { x: 1, y: 1.2, z: 1, speed: 5.5, riding: true }, // aboard a car: the car is the mover
    { x: 3, y: 0, z: 3, speed: 2.4, hidden: true }, // inside a build
    { x: 80, y: 0, z: -80, speed: 2.4 }, // walking, but out of shot
  ];
  const t = tally(people, [], inFrame);
  assert.equal(t.walking, 2);
  assert.equal(t.people, 5, 'everyone drawn in the frame, walking or not');
});

test('movers: the ones moving town-wide by kind, and how many of them are in frame', () => {
  const inFrame = framer(streamCamera());
  const movers: MoverAt[] = [
    { x: 0, y: 0, z: 0, kind: 'drive', moving: true },
    { x: 5, y: 0, z: 5, kind: 'drive', moving: false }, // waiting at the lights
    { x: 2, y: 6, z: -2, kind: 'fly', moving: true },
    { x: 90, y: 0, z: 90, kind: 'roam', moving: true }, // across town
    { x: -90, y: 0, z: 40, kind: 'roam', moving: true },
    { x: 1, y: 0, z: 1, kind: 'ridden', moving: true },
  ];
  const t = tally([], movers, inFrame);
  assert.equal(t.moving, 5);
  assert.deepEqual(t.kinds, { drive: 1, fly: 1, roam: 2, ridden: 1 });
  assert.equal(t.moversInFrame, 3);
});

test('a window of frames: fps, the mean and worst work, draws and triangles per frame', () => {
  const w = new FrameWindow();
  w.add(1000, 9, 99, 999); // starts the clock only
  assert.equal(w.take(1000), undefined);
  for (let i = 1; i <= 30; i++) w.add(1000 + i * (500 / 30), i === 10 ? 14 : 4, 800 + i, 100_000);
  const s = w.take(1500)!;
  assert.ok(Math.abs(s.fps - 60) < 1e-9, `30 frames in half a second is 60 fps (got ${s.fps})`);
  assert.ok(Math.abs(s.ms - (29 * 4 + 14) / 30) < 1e-9);
  assert.equal(s.worst, 14);
  assert.equal(s.draws, 815.5);
  assert.equal(s.tris, 100_000);
  // A fresh window: nothing to say until the next half second is up.
  w.add(1600, 5, 10, 10);
  assert.equal(w.take(1700), undefined);
  w.add(2000, 5, 10, 10);
  assert.equal(w.take(2000)!.fps, 4, 'two frames in the half second since the last sample');
});

test('a hidden tab: the gap is dropped, not reported as one slow window', () => {
  const w = new FrameWindow();
  w.add(1000, 4, 800, 100_000);
  w.add(1016, 4, 800, 100_000);
  w.restart(); // hidden for a minute: main.ts draws nothing
  w.add(61_000, 4, 800, 100_000); // back: starts the clock only
  assert.equal(w.take(61_000), undefined);
  for (let i = 1; i <= 30; i++) w.add(61_000 + i * (500 / 30), 4, 800, 100_000);
  const s = w.take(61_500)!;
  assert.ok(Math.abs(s.fps - 60) < 1e-9, `60 fps from the first half second back, not a minute's gap (got ${s.fps})`);
  assert.equal(s.draws, 800);
});

const sample = (over: Partial<StatsSample> = {}): StatsSample => ({
  fps: 59.6,
  ms: 6.04,
  worst: 11.6,
  draws: 1234.4,
  tris: 412_345,
  walking: 4,
  people: 11,
  moving: 3,
  moversInFrame: 1,
  kinds: { drive: 1, fly: 1, roam: 1, ridden: 0 },
  ...over,
});

test('the rows: rounded for a glance, the budget beside them, nothing flagged when within it', () => {
  const rows = statsRows(sample());
  assert.deepEqual(
    rows.map((r) => [r.label, r.value, r.note]),
    [
      ['fps', '60', 'page 6.0 ms · worst 12'],
      ['draws', '1,234', 'of 1,500'],
      ['tris', '412k', ''],
      ['walking', '4', 'of 11 in frame'],
      ['movers', '3', '1 in frame'],
      ['', '', 'drive 1 · fly 1 · roam 1'],
    ],
  );
  assert.ok(rows.every((r) => !r.over));
  assert.equal(statsRows(sample({ kinds: { drive: 1, fly: 0, roam: 0, ridden: 2 } }))[5].note, 'drive 1 · fly 0 · roam 0 · ridden 2');
  assert.equal(statsRows(sample({ tris: 2_345_678 }))[2].value, '2.3M');
  assert.equal(statsRows(sample({ tris: 8_765 }))[2].value, '8,765');
  assert.equal(statsRows(sample({ fps: 3.333 }))[0].value, '3.3', 'a slow page keeps its decimal');
});

test('over budget: frame time, draw calls, walkers and movers in a shot, and each kind town-wide', () => {
  const over = (s: Partial<StatsSample>) => statsRows(sample(s)).filter((r) => r.over).map((r) => r.label);
  assert.deepEqual(over({ ms: STATS_BUDGET.frameMs + 0.1 }), ['fps']);
  assert.deepEqual(over({ draws: STATS_BUDGET.draws + 1 }), ['draws']);
  assert.deepEqual(over({ draws: STATS_BUDGET.draws }), [], 'at the limit is within it');
  assert.deepEqual(over({ walking: 13, people: 20 }), ['walking']);
  assert.deepEqual(over({ moversInFrame: 9, moving: 9 }), ['movers']);
  assert.deepEqual(over({ kinds: { drive: 4, fly: 0, roam: 0, ridden: 0 } }), ['movers'], 'drive 3 at once');
  assert.deepEqual(over({ kinds: { drive: 0, fly: 3, roam: 0, ridden: 0 } }), ['movers'], 'fly 2 at once');
  assert.deepEqual(over({ kinds: { drive: 0, fly: 0, roam: 5, ridden: 0 } }), ['movers'], 'roam 4 at once');
  assert.deepEqual(over({ kinds: { drive: 3, fly: 2, roam: 4, ridden: 6 } }), [], 'ridden builds are outside the caps');
});

test('the objects layer reports its movers: kind from the creature, moving only while it slides', () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => ({ ok: true, json: async () => ({ parts: {} }) })) as never;
  try {
    const layer = createObjectsLayer(new THREE.Group());
    const view = (id: string, x: number, extra: Partial<SafehouseObjectView>): SafehouseObjectView =>
      ({ id, revision: 1, position: { x, z: 0 }, footprint: { width: 2, depth: 2 }, createdBy: 'dev:kim', editedBy: 'dev:kim', createdAt: 0, blueprint: { name: id, description: '', partCount: 1, color: '#888888' }, ...extra }) as SafehouseObjectView;
    const creature = (behaviour: 'zoom' | 'roam', flying = false) => ({ behaviour, facing: 0, moving: true, path: [], replanMs: 0, cooldownMs: 0, ...(flying ? { flying, altitude: 6 } : {}) });
    const at = (x: number) => [
      view('car', x, { creature: creature('zoom') }),
      view('goat', 10, { creature: creature('roam') }), // grazing: the same spot in both snapshots
      view('ufo', 20 + x, { creature: creature('roam', true) }),
      view('cart', 30 + x, { driven: { at: { x: 30 + x, z: 0 }, turn: 0 } } as never),
      view('house', 40, {}),
    ];
    layer.sample(at(0), 1000);
    layer.sample(at(2), 1500);
    layer.syncCommitted(at(2));
    const seen = () => {
      const out: Record<string, [string, boolean]> = {};
      layer.movers((x, _y, _z, kind, moving) => (out[Math.round(x)] = [kind, moving]));
      return out;
    };
    layer.update(0, false, 1250);
    assert.deepEqual(seen(), { 1: ['drive', true], 10: ['roam', false], 21: ['fly', true], 31: ['ridden', true] }, 'the house never moves, so it is not a mover');
    layer.update(16, true, Infinity);
    assert.ok(Object.values(seen()).every(([, moving]) => !moving), 'reduced motion: everything held still');
    layer.dispose();
  } finally {
    globalThis.fetch = realFetch;
  }
});
