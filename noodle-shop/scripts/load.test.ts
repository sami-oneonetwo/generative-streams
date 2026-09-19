// The load model (brief §5.7). These tests pin the shape of the curve, not the
// exact numbers — tuning constants are meant to move.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadState, statePath, StateVersionError } from '../src/engine/persistence';
import { serverRoomWorld } from '../src/worlds/server-room/index';
import type { QueueEntryView, TaskSpec, WorldCtx } from '../src/engine/world';
import { ChatRateMeter } from '../src/engine/chatRate';
import {
  adminFallbackCapacityPerMin,
  chatLagSeconds,
  computeDrawW,
  createInitialState,
  demandPerMin,
  migrateState,
  roomCapacityPerMin,
  serverCapacityPerMin,
  trafficStatus,
  utilisation,
  type Server,
  type ServerRoomState,
} from '../src/worlds/server-room/state';
import { startWave, updateTraffic } from '../src/worlds/server-room/traffic';
import { tick } from '../src/worlds/server-room/tick';
import { tuning } from '../src/worlds/server-room/tuning';

const now = 1_800_000_000_000;

function server(state: ServerRoomState, slot: number, health = 100, level = 0): Server {
  const s: Server = {
    id: `server-${slot}`, slot, ownerUserId: `user-${slot}`, ownerName: `guest${slot}`, name: `server-${slot}`,
    health, level, temperature: 22, powerDrawW: tuning.baseDrawW,
    uptimeDays: 0, delivered: 0, createdAt: now, darkStreams: 0,
  };
  state.servers[s.id] = s;
  return s;
}

interface Harness {
  ctx: WorldCtx<ServerRoomState>;
  state: ServerRoomState;
  said: string[];
  logged: string[];
  tasks: TaskSpec<ServerRoomState>[];
  setNow(at: number): void;
  setChatRate(perMin: number): void;
}

function harness(state = createInitialState(now)): Harness {
  let clock = now;
  let chatRate = 0;
  const said: string[] = [];
  const logged: string[] = [];
  const tasks: TaskSpec<ServerRoomState>[] = [];
  const ctx: WorldCtx<ServerRoomState> = {
    get state() { return state; },
    get now() { return clock; },
    log: (line) => { logged.push(line); },
    say: (text) => { said.push(text); },
    enqueueTask: (spec) => { tasks.push(spec); return { id: `task-${tasks.length}` }; },
    get queue(): ReadonlyArray<QueueEntryView> {
      return tasks.map((t, i) => ({ id: `task-${i}`, kind: t.kind, label: t.label, requestedBy: t.requestedBy }));
    },
    llm: {
      dialogue: async () => null,
      moderate: async (text: string) => ({ ok: true, cleaned: text }),
    },
    tuning,
    get chatRatePerMin() { return chatRate; },
    rng: () => 0.5,
  };
  return {
    ctx, state, said, logged, tasks,
    setNow: (at) => { clock = at; },
    setChatRate: (perMin) => { chatRate = perMin; },
  };
}

/** Run the traffic model for a stretch of time in small steps. */
function run(h: Harness, minutes: number, stepMs = 5_000): void {
  const steps = Math.round((minutes * 60_000) / stepMs);
  for (let i = 0; i < steps; i++) {
    h.setNow(now + i * stepMs);
    updateTraffic(h.ctx, stepMs);
  }
}

// ------------------------------------------------------------------ capacity

test("an empty room carries only Admin's own machine, and every server adds to it", () => {
  const state = createInitialState(now);
  assert.equal(roomCapacityPerMin(state), tuning.adminFallbackPerMin);

  server(state, 0);
  assert.equal(roomCapacityPerMin(state), tuning.adminFallbackPerMin + tuning.serverBasePerMin);
});

/**
 * The scale is the whole design: Admin alone must fold under a chat that is
 * merely lively, and one server has to be a visible rescue. If a handful of
 * people talking doesn't trouble him, chat never learns why the room needs them.
 */
test('Admin alone folds under a lively chat, and the very first server rescues it', () => {
  const state = createInitialState(now);
  const lively = 25; // messages a minute — a few people actually talking

  assert.ok(adminFallbackCapacityPerMin(state) < lively, 'a cold-start room must visibly fail');
  assert.ok(adminFallbackCapacityPerMin(state) >= 5, 'but a quiet chat should still land');

  server(state, 0);
  assert.ok(roomCapacityPerMin(state) > lively, 'one server takes the room from failing to holding');
  assert.ok(
    roomCapacityPerMin(state) >= adminFallbackCapacityPerMin(state) * 2,
    'and it should at least double what he can do alone, or it is not worth asking for',
  );
});

test('what a server carries scales with health, drops in a hot room, and is zero with the power off', () => {
  const state = createInitialState(now);
  const s = server(state, 0, 50);
  assert.equal(serverCapacityPerMin(s, state), tuning.serverBasePerMin * 0.5);

  state.roomTempC = tuning.throttleTempC;
  assert.equal(serverCapacityPerMin(s, state), tuning.serverBasePerMin * 0.5 * tuning.throttleCapacityFactor);
  assert.equal(
    adminFallbackCapacityPerMin(state),
    tuning.adminFallbackPerMin * tuning.throttleCapacityFactor,
    "Admin's own machine is in the same hot room",
  );

  s.health = 0;
  assert.equal(serverCapacityPerMin(s, state), 0);

  state.power.breakerTripped = true;
  assert.equal(roomCapacityPerMin(state), 0);
});

test('each upgrade level makes a server carry more and draw more', () => {
  const state = createInitialState(now);
  const s = server(state, 0);
  const base = serverCapacityPerMin(s, state);
  s.level = 1;
  assert.equal(serverCapacityPerMin(s, state), base + tuning.upgradeCapacityPerMin);
  s.level = tuning.upgradeMaxLevel;
  assert.equal(
    serverCapacityPerMin(s, state),
    base + tuning.upgradeMaxLevel * tuning.upgradeCapacityPerMin,
  );
  assert.equal(computeDrawW(s), tuning.baseDrawW + tuning.upgradeMaxLevel * tuning.upgradeDrawW);
});

/**
 * The wiring, end to end at the world level: what the meter says chat is doing
 * is what the ledger records as the load, with nothing added on the way.
 */
test('what chat types is what lands in the ledger, tick after tick', () => {
  const h = harness();
  server(h.state, 0);

  h.setChatRate(0);
  updateTraffic(h.ctx, 5_000);
  assert.equal(h.state.traffic.demandPerMin, 0, 'silence is not load');

  for (const rate of [3, 12, 47, 8]) {
    h.setChatRate(rate);
    updateTraffic(h.ctx, 5_000);
    assert.equal(h.state.traffic.demandPerMin, rate, `chat at ${rate} should read ${rate}`);
  }
  // And it goes back down again when they stop.
  h.setChatRate(0);
  updateTraffic(h.ctx, 5_000);
  assert.equal(h.state.traffic.demandPerMin, 0);
});

/**
 * There used to be a simulated regional baseline of ~260-360 messages a minute
 * underneath everything, which meant the number on the wall barely moved when
 * somebody typed. The displayed load has to be the real chat and nothing else,
 * or the room is reporting a fiction at its audience.
 */
test('what the room has to carry is exactly what chat is typing, and nothing invented', () => {
  const state = createInitialState(now);
  assert.equal(demandPerMin(state, now, 0), 0, 'a silent chat is no load at all');
  assert.equal(demandPerMin(state, now, 17), 17, 'and a busy one is precisely itself');
  // Time of day must not move it: there is no daily curve any more.
  for (const at of [now, now + 6 * 3_600_000, now + 13 * 3_600_000, now + 20 * 3_600_000]) {
    assert.equal(demandPerMin(state, at, 12), 12, `time of day moved the load at ${at}`);
  }
  // A wave is the one thing that adds to it, and it is announced when it lands.
  startWave(harness(state).ctx, 'the room next door', 30, 60_000);
  assert.equal(demandPerMin(state, now, 12), 42);
});

// --------------------------------------------------------------------- queue

test('under capacity everything is carried, nothing queues, and servers get the credit', () => {
  const h = harness();
  const a = server(h.state, 0);
  const b = server(h.state, 1);
  h.setChatRate(6);
  run(h, 10);

  const traffic = h.state.traffic;
  assert.equal(Math.round(traffic.backlog), 0);
  assert.equal(traffic.dropped, 0);
  assert.equal(trafficStatus(h.state), 'clear');
  assert.ok(utilisation(h.state) < 1);

  // 10 minutes at roughly the demand rate.
  assert.ok(traffic.delivered > traffic.demandPerMin * 9, `delivered ${traffic.delivered}`);
  assert.ok(traffic.delivered < traffic.demandPerMin * 11, `delivered ${traffic.delivered}`);

  // Two identical servers split the work evenly, and neither is credited with
  // Ray's share.
  assert.ok(Math.abs(a.delivered - b.delivered) < 1);
  assert.ok(a.delivered + b.delivered < traffic.delivered, "Admin's share belongs to nobody");
  const expectedShare = tuning.serverBasePerMin / roomCapacityPerMin(h.state);
  assert.ok(Math.abs(a.delivered / traffic.delivered - expectedShare) < 0.02);
});

test('credit follows the work: a healthier server carries and earns proportionally more', () => {
  const h = harness();
  const strong = server(h.state, 0, 100);
  const weak = server(h.state, 1, 25);
  h.setChatRate(10);
  run(h, 20);

  assert.ok(Math.abs(strong.delivered / weak.delivered - 4) < 0.05, 'a healthy server carries 4x one at a quarter health');
  // Every credited share plus Admin's uncredited one accounts for the whole total.
  const credited = strong.delivered + weak.delivered;
  const adminShare =
    adminFallbackCapacityPerMin(h.state) / roomCapacityPerMin(h.state) * h.state.traffic.delivered;
  assert.ok(
    Math.abs(credited + adminShare - h.state.traffic.delivered) < h.state.traffic.delivered * 0.02,
    'shares should account for the full delivered total',
  );
});

test('a server carrying nothing earns nothing, and one that is off is skipped entirely', () => {
  const h = harness();
  const live = server(h.state, 0);
  const dark = server(h.state, 1, 0);
  h.setChatRate(3);
  run(h, 5);
  assert.ok(live.delivered > 0);
  assert.equal(dark.delivered, 0);
});

test('over capacity chat falls behind before anything is lost, then drops', () => {
  const h = harness();
  h.setChatRate(400); // far past anything the room can carry
  run(h, 1);

  assert.equal(trafficStatus(h.state), 'dropping');
  assert.ok(h.state.traffic.backlog > 0);
  assert.ok(h.state.traffic.dropped > 0);
  // The queue is bounded: it never grows past the drop threshold.
  assert.ok(h.state.traffic.backlog <= tuning.backlogDropAt + 0.001);
  assert.ok(chatLagSeconds(h.state) > 60, 'chat should be visibly behind');
  // Whichever variant he picks, it has to say what is happening and ask chat
  // for the thing that fixes it. That is the whole point of saying it.
  const alarm = h.said.find((line) => /losing|dropping/i.test(line))!;
  assert.ok(alarm, h.said.join(' | '));
  assert.match(alarm, /server/i, alarm);
});

test('the gradient runs clear -> busy -> saturated -> dropping as demand climbs', () => {
  // Chat rates are derived from the floor at this instant, so the test doesn't
  // depend on what time of day it happens to run.
  const reference = createInitialState(now);
  for (let i = 0; i < 4; i++) server(reference, i);
  const capacity = roomCapacityPerMin(reference);
  const chatFor = (targetUtilisation: number) => capacity * targetUtilisation;

  const seen = [0.4, 0.8, 1.05, 8].map((target) => {
    const h = harness();
    for (let i = 0; i < 4; i++) server(h.state, i);
    h.setChatRate(chatFor(target));
    run(h, 3);
    return trafficStatus(h.state);
  });
  assert.deepEqual(seen, ['clear', 'busy', 'saturated', 'dropping']);
});

test('he asks for help before anything is lost, then says it is happening — once each', () => {
  const h = harness();
  server(h.state, 0);
  h.setChatRate(400);
  run(h, 2);
  // Two lines for two different moments, and not one per tick for either.
  assert.equal(h.said.length, 2, `expected pressure then loss, got: ${h.said.join(' | ')}`);
  assert.match(h.said[0], /server/i, 'the first line asks chat for help while it can still help');
  assert.doesNotMatch(h.said[0], /losing|dropping/i, 'nothing is lost yet when he first asks');
  assert.match(h.said[1], /losing|dropping/i, 'the second line is that it is now actually happening');

  // A reminder, but only after a long silence.
  h.state.traffic.lastDropNoticeAt = now - tuning.dropReminderMs - 1;
  updateTraffic(h.ctx, 5_000);
  assert.equal(h.said.length, 3);

  // Chat adds servers: the spell ends and Admin says so. That closure is what
  // tells chat the servers they asked for worked.
  h.setChatRate(0);
  for (let i = 0; i < 4; i++) server(h.state, i + 1);
  run(h, 5);
  assert.equal(h.state.traffic.droppingSince, undefined);
  assert.ok(/caught up|clear|back under/i.test(h.said[h.said.length - 1]), h.said[h.said.length - 1]);
});

/**
 * The window that matters for a live stream: the room is filling up but nothing
 * is lost yet, so chat can still prevent it. He has to notice and ask — this is
 * the only moment where asking changes the outcome.
 */
test('he asks chat for help while the room can still be saved, and names somebody', () => {
  const h = harness();
  server(h.state, 0);
  h.state.chatters['u:kaz'] = { name: 'kaz', firstSeen: now - 86_400_000, lastSeen: now, reports: 0 };
  // Busy but not overwhelmed: above the busy line, nowhere near dropping.
  h.setChatRate(roomCapacityPerMin(h.state) * 0.9);
  run(h, 1);

  assert.equal(trafficStatus(h.state), 'busy');
  assert.equal(h.state.traffic.dropped, 0, 'nothing is lost yet — that is the point');
  assert.equal(h.said.length, 1, 'once when it starts, not once per tick');
  assert.match(h.said[0], /kaz/, `he should shout at somebody by name: ${h.said[0]}`);
  assert.match(h.said[0], /give me a server/i, h.said[0]);
  assert.ok(h.state.traffic.busySince !== undefined, 'the spell is on the record');
});

test('with nobody in chat to ask, he shouts at the room instead of nobody', () => {
  const h = harness();
  server(h.state, 0);
  h.setChatRate(roomCapacityPerMin(h.state) * 0.9);
  run(h, 1);
  assert.equal(h.said.length, 1);
  assert.match(h.said[0], /chat|somebody/i, h.said[0]);
  assert.match(h.said[0], /server/i, h.said[0]);
});

test('the pressure spell reminds on its own timer and credits chat when it lifts', () => {
  const h = harness();
  server(h.state, 0);
  h.setChatRate(roomCapacityPerMin(h.state) * 0.9);
  run(h, 1);
  assert.equal(h.said.length, 1);

  // Sooner than the drop reminder: the window is still open, so asking again
  // is still worth something.
  h.state.traffic.lastBusyNoticeAt = now - tuning.busyReminderMs - 1;
  updateTraffic(h.ctx, 5_000);
  assert.equal(h.said.length, 2);
  assert.match(h.said[1], /server|limit|holding/i, h.said[1]);

  // Chat turns up with servers: he says so, and gives them the credit.
  h.setChatRate(0);
  for (let i = 0; i < 4; i++) server(h.state, i + 1);
  run(h, 2);
  assert.equal(h.state.traffic.busySince, undefined, 'the spell closed');
  assert.match(h.said[h.said.length - 1], /you|thank|held|back under/i, h.said[h.said.length - 1]);
});

test('pressure and loss never both speak about the same moment', () => {
  // Straight from calm to well past the drop threshold in one step: the loss
  // line is the right one, and the pressure line must stay out of its way.
  const h = harness();
  server(h.state, 0);
  h.setChatRate(8_000);
  updateTraffic(h.ctx, 60_000);
  assert.ok(h.state.traffic.dropped > 0);
  assert.equal(h.said.length, 1, `expected only the loss line, got: ${h.said.join(' | ')}`);
  assert.match(h.said[0], /losing|dropping/i, h.said[0]);
});

/**
 * Every one of these lines is drawn at random from a handful of variants, so a
 * single run only ever exercises one of them. Run the entry paths enough times
 * to hit them all, and hold every variant to the same contract — a phrase
 * pinned in one variant and missing from the other two is a test that passes
 * until it doesn't.
 */
test('every variant of the alarm lines says what is wrong and asks for servers', () => {
  const seen = { pressure: new Set<string>(), loss: new Set<string>() };
  for (let i = 0; i < 40; i++) {
    // Pressure entry: busy, nothing lost.
    const busy = harness();
    server(busy.state, 0);
    busy.state.chatters['u:kaz'] = { name: 'kaz', firstSeen: now - 86_400_000, lastSeen: now, reports: 0 };
    busy.setChatRate(roomCapacityPerMin(busy.state) * 0.9);
    updateTraffic(busy.ctx, 5_000);
    for (const line of busy.said) {
      seen.pressure.add(line);
      assert.match(line, /server/i, `pressure variant asks for nothing: ${line}`);
      assert.doesNotMatch(line, /undefined|NaN|\[object/, line);
      assert.doesNotMatch(line, /\b1 minutes\b/, line);
    }

    // Loss entry: straight past the threshold.
    const lost = harness();
    server(lost.state, 0);
    lost.state.chatters['u:kaz'] = { name: 'kaz', firstSeen: now - 86_400_000, lastSeen: now, reports: 0 };
    lost.setChatRate(8_000);
    updateTraffic(lost.ctx, 60_000);
    for (const line of lost.said) {
      seen.loss.add(line);
      assert.match(line, /losing|dropping/i, `loss variant does not say it: ${line}`);
      assert.match(line, /server/i, `loss variant asks for nothing: ${line}`);
      assert.doesNotMatch(line, /undefined|NaN|\[object/, line);
    }
  }
  // Enough draws that a broken variant cannot have hidden behind the others.
  assert.ok(seen.pressure.size >= 2, `only saw ${seen.pressure.size} pressure variant(s)`);
  assert.ok(seen.loss.size >= 2, `only saw ${seen.loss.size} loss variant(s)`);
});

// ------------------------------------------------------------------ overload

test('sustained near-capacity load wears servers without triggering a hardware emergency', () => {
  const h = harness();
  const b = server(h.state, 0);

  for (let i = 0; i < 120; i++) {
    h.setChatRate(roomCapacityPerMin(h.state) * 0.95);
    h.setNow(now + i * 30_000);
    tick(h.ctx, 30_000);
  }

  assert.ok(b.health < 100, 'overload is wear');
  assert.ok(b.health > 0, 'but an hour of it should not kill a healthy server outright');
});

test('passive cooling absorbs light loads while a busy rack still heats up', () => {
  const hour = (chatRatePerMin: number, count: number) => {
    const h = harness();
    for (let i = 0; i < count; i++) server(h.state, i);
    for (let i = 0; i < 120; i++) {
      h.setChatRate(chatRatePerMin > 0 ? roomCapacityPerMin(h.state) * 0.95 : 0);
      h.setNow(now + i * 30_000);
      tick(h.ctx, 30_000);
    }
    return h.state.roomTempC;
  };

  // Moderate pressure still tests the heat feedback below the shutdown threshold.
  assert.equal(hour(25, 1), tuning.ambientTempC);
  assert.ok(hour(25, 12) > hour(0, 12), 'overload heat exceeds passive dissipation near the power budget');
});

test('legacy door and cooling flags cannot change heat, wear or maintenance work', () => {
  const clean = harness();
  server(clean.state, 0);
  clean.state.roomTempC = 35;
  const old = harness(structuredClone(clean.state));
  old.state.cooling.working = false;
  old.state.door = { open: true, openedAt: now - 600_000, openedBy: 'old-viewer' };
  for (let i = 0; i < 120; i++) {
    for (const h of [clean, old]) {
      h.setNow(now + i * 30_000);
      tick(h.ctx, 30_000);
    }
    assert.equal(old.state.roomTempC, clean.state.roomTempC);
    assert.equal(old.state.servers['server-0'].health, clean.state.servers['server-0'].health);
  }
  assert.deepEqual(old.tasks, []);
  assert.equal(old.state.roomTempC, tuning.ambientTempC);
});

test('overload damage is capped so a huge wave cannot instantly kill the rack', () => {
  const modest = harness();
  server(modest.state, 0);
  modest.setChatRate(100);
  const extreme = harness();
  server(extreme.state, 0);
  extreme.setChatRate(10_000);

  for (const h of [modest, extreme]) {
    for (let i = 0; i < 2; i++) {
      h.setNow(now + i * 500);
      tick(h.ctx, 500);
    }
    assert.equal(h.state.emergency, undefined, 'short bursts do not burn out hardware');
  }
  const worn = (h: Harness) => 100 - Object.values(h.state.servers)[0].health;
  assert.ok(worn(extreme) < worn(modest) * 3, 'damage should not scale without limit');
  assert.ok(Object.values(extreme.state.servers)[0].health > 0);
});

test('the power going off leaves the room cut off: nothing carried, everything lost', () => {
  const h = harness();
  server(h.state, 0);
  h.state.power.breakerTripped = true;
  h.setChatRate(20);
  const startTemp = h.state.roomTempC;
  run(h, 20);

  assert.equal(trafficStatus(h.state), 'deaf');
  assert.equal(h.state.traffic.capacityPerMin, 0);
  assert.equal(h.state.traffic.delivered, 0);
  assert.ok(h.state.traffic.dropped > 0);
  assert.equal(chatLagSeconds(h.state), Infinity);
  assert.equal(utilisation(h.state), Infinity);
  assert.equal(h.state.roomTempC, startTemp, 'nothing is running, so nothing is cooking');
});

// ---------------------------------------------------------------------- wave

test('a wave adds demand, announces itself, and expires on its own', () => {
  const h = harness();
  server(h.state, 0);
  startWave(h.ctx, 'the room next door', tuning.waveRippleExtraPerMin, 60_000);
  const baseline = demandPerMin(h.state, now, 0) - tuning.waveRippleExtraPerMin;

  assert.equal(demandPerMin(h.state, now, 0) - baseline, tuning.waveRippleExtraPerMin);
  assert.ok(h.said.some((line) => /room next door/.test(line)));

  h.setNow(now + 61_000);
  updateTraffic(h.ctx, 5_000);
  assert.equal(h.state.traffic.wave, undefined);
  assert.equal(demandPerMin(h.state, h.ctx.now, 0), 0, 'with the wave gone and nobody typing, no load');
});

test('an announced peak needs several healthy servers to survive', () => {
  const survives = (servers: number) => {
    const h = harness();
    for (let i = 0; i < servers; i++) server(h.state, i);
    startWave(h.ctx, 'the room next door', tuning.wavePeakExtraPerMin, 3_600_000);
    run(h, 15);
    return h.state.traffic.dropped === 0;
  };
  assert.equal(survives(2), false, 'a small room should not shrug off a season peak');
  assert.equal(survives(6), true, 'a prepared room should hold');
});

// ----------------------------------------------------------------- plumbing

test('the chat rate meter tracks a burst and lets it decay out of the window', () => {
  const meter = new ChatRateMeter();
  for (let i = 0; i < 30; i++) meter.record(now + i * 100);
  assert.equal(meter.ratePerMin(now + 5_000), 30);
  assert.equal(meter.ratePerMin(now + 120_000), 0, 'old messages leave the window');
});

test('v2 snapshots gain a traffic ledger and per-server carried counts', () => {
  const fresh = createInitialState(now);
  server(fresh, 0);
  const v2 = JSON.parse(JSON.stringify(fresh)) as Record<string, unknown>;
  v2.version = 2;
  delete v2.traffic;
  delete (v2.servers as Record<string, Record<string, unknown>>)['server-0'].delivered;
  (v2.memorial as unknown[]) = [{ name: 'old friend', ownerName: 'guest', at: now }];

  const migrated = migrateState(v2, 2);
  assert.equal(migrated.version, 6, 'a v2 snapshot steps all the way up');
  assert.equal(migrated.traffic.backlog, 0);
  assert.equal(migrated.traffic.delivered, 0);
  assert.equal(migrated.servers['server-0'].delivered, 0);
  assert.equal(migrated.memorial[0].delivered, 0, 'old plaques have no count to recover');
  assert.throws(() => migrateState(v2, 6), /no migration path/);
});

/**
 * The v5 room is the technical one: boxes with jobs, patch levels, disk fill and
 * a list of fitted components. Nobody who earned a box should lose it, or lose
 * the count of what it carried, on the way to v6.
 */
test('a v5 snapshot becomes servers, keeping owners, counts, and paid-for upgrades', () => {
  const v5 = {
    version: 5,
    racks: [{ id: 'rack-0', slots: tuning.slots }],
    boxes: {
      'box-a': {
        id: 'box-a', slot: 0, ownerUserId: 'kick:1', ownerName: 'Sami', name: 'sami',
        job: 'delivery', health: 0, patchLevel: 40, diskPct: 90, temperature: 22,
        powerDrawW: 200, upgrades: ['ram'], compromised: false, uptimeDays: 3,
        delivered: 61_935, createdAt: now - 1000, darkStreams: 1,
      },
      'box-b': {
        id: 'box-b', slot: 1, ownerUserId: 'kick:2', ownerName: 'kaz', name: 'kaz',
        job: 'auth', health: 80, patchLevel: 100, diskPct: 5, temperature: 22,
        powerDrawW: 320, upgrades: ['ram', 'ssd', 'psu2'], compromised: true, uptimeDays: 1,
        delivered: 12, createdAt: now, darkStreams: 0,
      },
    },
    traffic: {
      backlog: 0, delivered: 272_058.12, dropped: 2250.46,
      demandPerMin: 400, capacityPerMin: 300, peakDemandPerMin: 900,
    },
    admission: { nextAdmitAt: 12, admitted: 5, heldTotal: 2 },
    moderation: { handled: 7 },
    tickets: [{
      id: 'WO-0001', kind: 'compromised', subject: 'box-b', title: 'old ticket',
      severity: 1, source: 'sensor', raisedBy: 'SENSOR', claimedBy: [], openedAt: now, state: 'open',
    }],
    ticketSeq: 61,
    power: { budgetW: 2000, breakerTripped: false },
    roomTempC: 24,
    cooling: { working: true },
    door: { open: false },
    incidents: { intruder: { boxId: 'box-b', startedAt: now, deadlineAt: now + 1000 } },
    legacy: { powerDrawW: 200, uptimeDays: 4211, clues: 1 },
    season: { quarter: 1, streams: 2, outages: 0 },
    uptime: { startedAt: now - 99 },
    memorial: [{ name: 'old friend', ownerName: 'guest', at: now, delivered: 5 }],
    chatters: { 'kick:1': { boxId: 'box-a', name: 'Sami', firstSeen: now, lastSeen: now, reports: 3 } },
    lastLiveAt: now,
  };

  const migrated = migrateState(v5, 5);
  assert.equal(migrated.version, 6);

  // Nobody loses a server, an owner, or a lifetime count.
  assert.equal(Object.keys(migrated.servers).length, 2);
  assert.equal(migrated.servers['box-a'].ownerName, 'Sami');
  assert.equal(migrated.servers['box-a'].delivered, 61_935);
  assert.equal(migrated.servers['box-a'].darkStreams, 1);
  assert.equal(migrated.traffic.delivered, 272_058.12);
  assert.equal(migrated.traffic.dropped, 2250.46);
  assert.equal(migrated.memorial[0].delivered, 5);
  assert.equal(migrated.chatters['kick:1'].reports, 3);

  // Each component they had fitted becomes one upgrade level, capped.
  assert.equal(migrated.servers['box-a'].level, 1);
  assert.equal(migrated.servers['box-b'].level, tuning.upgradeMaxLevel);

  // The chatter's pointer follows the rename.
  assert.equal(migrated.chatters['kick:1'].serverId, 'box-a');
  assert.equal((migrated.chatters['kick:1'] as Record<string, unknown>).boxId, undefined);

  // The technical fields are gone, along with the break-in that depended on them.
  const raw = migrated.servers['box-a'] as unknown as Record<string, unknown>;
  for (const dead of ['job', 'patchLevel', 'diskPct', 'upgrades', 'compromised']) {
    assert.equal(raw[dead], undefined, `${dead} should not survive v6`);
  }
  assert.equal((migrated.incidents as Record<string, unknown>).intruder, undefined);

  // Ticket kinds changed underneath, so the board starts clear and the sweep
  // re-raises whatever is still actually wrong.
  assert.deepEqual(migrated.tickets, []);
  assert.equal(migrated.ticketSeq, 0);
});

test('a versioned snapshot that fails the schema refuses to boot instead of resetting the room', () => {
  mkdirSync(new URL('../.preview/', import.meta.url), { recursive: true });
  const dir = mkdtempSync(fileURLToPath(new URL('../.preview/worldstream-state-', import.meta.url)));
  const world = serverRoomWorld;
  const logged: string[] = [];

  // A real room, but with a field the current schema requires missing — a
  // missing migration, or a stateVersion left un-bumped mid-edit.
  const good = createInitialState(now);
  server(good, 0);
  const broken = JSON.parse(JSON.stringify(good)) as Record<string, unknown>;
  delete broken.traffic;
  writeFileSync(statePath(dir, world.meta.id), JSON.stringify(broken));

  assert.throws(
    () => loadState(world, dir, (line) => logged.push(line)),
    (e: Error) => e instanceof StateVersionError && /Refusing to start/.test(e.message),
    'a fresh room must never be autosaved over a real one',
  );

  // Unreadable data may still be recoverable externally. Never overwrite it.
  writeFileSync(statePath(dir, world.meta.id), 'not json at all');
  assert.throws(() => loadState(world, dir, (line) => logged.push(line)), StateVersionError);
  rmSync(dir, { recursive: true, force: true });
});

test('lifetime totals survive a stream boundary but the queue does not', async () => {
  const { applyOfflineTime } = await import('../src/worlds/server-room/offline');
  const h = harness();
  h.state.traffic.delivered = 1_000_000;
  h.state.traffic.dropped = 42;
  h.state.traffic.backlog = 300;
  startWave(h.ctx, 'the room next door', 300, 60_000);
  h.state.lastLiveAt = now - 86_400_000;
  h.setNow(now);

  const facts = applyOfflineTime(h.ctx);
  assert.equal(h.state.traffic.backlog, 0, 'overnight queue is long gone');
  assert.equal(h.state.traffic.wave, undefined);
  assert.equal(h.state.traffic.delivered, 1_000_000);
  assert.equal(h.state.traffic.dropped, 42);
  assert.ok(facts.length);
});
