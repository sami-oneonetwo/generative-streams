import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SceneChaos, lightDip } from '../client/renderer/chaos';

test('chaos initializes from snapshot and resets between worlds', () => {
  const chaos = new SceneChaos();
  assert.deepEqual(chaos.frame(1, 0, true), { chaos: 1, mess: 4, animate: true });
  chaos.reset();
  assert.deepEqual(chaos.frame(0, 1, false), { chaos: 0, mess: 0, animate: false });
});

test('easing is frame-rate independent and recovers more slowly', () => {
  function run(target: number, step: number) {
    const chaos = new SceneChaos();
    chaos.frame(1 - target, 0, true);
    for (let at = step; at < 1000; at += step) chaos.frame(target, at, true);
    return chaos.frame(target, 1000, true);
  }
  assert.ok(Math.abs(run(1, 10).chaos - run(1, 40).chaos) < 1e-10);
  assert.ok(run(1, 10).chaos > 0.85);
  assert.ok(run(0, 10).chaos > 0.65);
});

test('mess stages have hysteresis and reduced motion keeps the mess', () => {
  const chaos = new SceneChaos();
  assert.equal(chaos.frame(0.41, 0, false).mess, 2);
  assert.equal(chaos.frame(0.39, 60000, false).mess, 2);
  assert.equal(chaos.frame(0.36, 120000, false).mess, 1);
  assert.equal(chaos.frame(0.41, 180000, false).mess, 1);
  assert.deepEqual(chaos.frame(1, 240000, false), { chaos: 1, mess: 4, animate: false });
});

test('targets are finite, bounded, and backwards clocks do not advance', () => {
  for (const target of [NaN, Infinity, -Infinity, -3, 7]) {
    const chaos = new SceneChaos();
    const frame = chaos.frame(target, 1000, true);
    assert.ok(Number.isFinite(frame.chaos) && frame.chaos >= 0 && frame.chaos <= 1);
    assert.equal(chaos.frame(1, 500, true).chaos, frame.chaos);
  }
});

test('local lighting dips are deterministic, bounded and sparse', () => {
  let active = 0;
  const seed = 3;
  for (let now = 0; now < 30000; now += 10) {
    assert.equal(lightDip(now, seed, 0), 0);
    const dip = lightDip(now, seed, 1);
    assert.ok(dip >= 0 && dip <= 1);
    assert.equal(dip, lightDip(now, seed, 1));
    if (dip > 0) active++;
  }
  assert.ok(active > 0 && active < 600, 'lighting dips occupy under 20% of the time');
});
