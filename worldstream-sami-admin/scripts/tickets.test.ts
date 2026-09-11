// The board (brief §5.9). Jobs are declarative — each kind knows how to detect
// its own problem — so these pin that the board self-corrects: it puts up
// what's wrong without being told, takes down what's fixed, and hands Admin the
// top of the list. Job ids exist for dedupe only and must never be spoken.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ChatMessage, QueueEntryView, TaskSpec, WorldCtx } from '../src/engine/world';
import {
  createInitialState,
  type Server,
  type ServerRoomState,
} from '../src/worlds/server-room/state';
import {
  boardOrder,
  closeTicket,
  findTicket,
  openTickets,
  raiseTicket,
  sweepTickets,
  TICKET_KINDS,
} from '../src/worlds/server-room/tickets';
import { applyOfflineTime } from '../src/worlds/server-room/offline';
import { tick } from '../src/worlds/server-room/tick';
import { crateX } from '../src/worlds/server-room/scene';
import { events } from '../src/worlds/server-room/events';
import { serverRoomStateSchema } from '../src/worlds/server-room/state';
import { statusScreen } from '../src/worlds/server-room/screens';
import { intents } from '../src/worlds/server-room/intents';
import { tuning } from '../src/worlds/server-room/tuning';
import type { EngineView } from '../src/engine/world';

const now = 1_800_000_000_000;
const view: EngineView = {
  now, protagonist: { x: 0, state: 'idle' }, pendingTasks: [], logLines: [], recentChat: [], chatRevision: 0,
};

function server(state: ServerRoomState, slot: number, health = 100): Server {
  const s: Server = {
    id: `server-${slot}`, slot, ownerUserId: `user-${slot}`, ownerName: `guest${slot}`, name: `server-${slot}`,
    health, level: 0, temperature: 22, powerDrawW: tuning.baseDrawW,
    uptimeDays: 0, delivered: 0, createdAt: now, darkStreams: 0,
  };
  state.servers[s.id] = s;
  return s;
}

function harness(state = createInitialState(now)) {
  let clock = now;
  const said: string[] = [];
  const logged: string[] = [];
  let tasks: TaskSpec<ServerRoomState>[] = [];
  const ctx: WorldCtx<ServerRoomState> = {
    get state() { return state; },
    get now() { return clock; },
    log: (line) => { logged.push(line); },
    say: (text) => { said.push(text); },
    enqueueTask: (spec) => { tasks.push(spec); return { id: `task-${tasks.length}` }; },
    get queue(): ReadonlyArray<QueueEntryView> {
      return tasks.map((t, i) => ({ id: `task-${i}`, kind: t.kind, label: t.label, requestedBy: t.requestedBy }));
    },
    llm: { dialogue: async () => null, moderate: async (text: string) => ({ ok: true, cleaned: text }) },
    tuning,
    get chatRatePerMin() { return 0; },
    rng: () => 0.5,
  };
  return {
    ctx, state, said, logged,
    get tasks() { return tasks; },
    /** Run every queued task to completion, the way the real queue would. */
    finishTasks() {
      const pending = tasks;
      tasks = [];
      for (const task of pending) task.onComplete(ctx);
    },
    setNow: (at: number) => { clock = at; },
  };
}

const message = (user: string, text: string): ChatMessage => ({
  id: `${user}-${Math.random()}`, userId: `u:${user}`, username: user, text, ts: now, source: 'kick',
});

const say = (intent: string, h: ReturnType<typeof harness>, user: string, text: string, params?: unknown) =>
  intents.find((i) => i.name === intent)!.handle(h.ctx, message(user, text), params);

test('old maintenance tickets retire at boot and during emergency ticks without repair chores', () => {
  for (const run of [applyOfflineTime, (ctx: WorldCtx<ServerRoomState>) => tick(ctx, 1000), sweepTickets]) {
    const h = harness();
    h.state.door = { open: true, openedAt: now - 600_000 };
    h.state.cooling.working = false;
    const old = ['door', 'cooling'].map(kind => raiseTicket(h.ctx, { kind }).ticket);
    old[1].state = 'active';
    h.state.emergency = { startedAt: now, serverIds: [], index: 0, stage: 'pull' };
    const loaded = serverRoomStateSchema.parse(JSON.parse(JSON.stringify(h.state)));
    assert.equal(loaded.version, 6);
    assert.deepEqual(loaded.door, h.state.door);
    run(h.ctx);
    assert.ok(old.every(t => t.state === 'resolved' && t.closedAt === now));
    assert.ok(!openTickets(h.state).some(t => t.kind === 'door' || t.kind === 'cooling'));
    assert.ok(!h.tasks.some(t => /ac-repair|close-door/.test(t.kind)));
    const logged = h.logged.length;
    sweepTickets(h.ctx);
    assert.equal(h.logged.length, logged, 'retirement is idempotent');
  }
});

test('retired fixtures have no event or sabotage action, while deliveries reach their crate', async () => {
  assert.ok(!events.some(e => /ac-failure|door-left-open/.test(e.name)));
  const hinder = intents.find(i => i.name === 'hinder')!;
  for (const action of ['ac_off', 'door_open']) {
    assert.equal(hinder.paramsSchema!.safeParse({ action }).success, false);
    const h = harness();
    await say('hinder', h, `retired-${action}`, 'old fixture request', { action });
    assert.equal(h.tasks.length, 0);
  }
  const h = harness();
  h.state.incidents.delivery = { arrivedAt: now };
  sweepTickets(h.ctx);
  assert.equal(h.tasks[0].kind, 'unpack');
  assert.equal(h.tasks[0].targetX, crateX());
  h.finishTasks();
  assert.equal(h.state.incidents.delivery, undefined);
});

// ------------------------------------------------------------------ raising

test('the sweep puts anything wrong on the board, without being told', () => {
  const h = harness();
  h.state.incidents.junkTraffic = { startedAt: now, endsAt: now + 300_000 };
  h.state.incidents.delivery = { arrivedAt: now };
  const sick = server(h.state, 0);
  sick.health = 10;

  sweepTickets(h.ctx);
  const kinds = openTickets(h.state).map((t) => t.kind);
  assert.ok(kinds.includes('junk-traffic'));
  assert.ok(kinds.includes('crate'));
  assert.ok(kinds.includes('server-down'));
  // Chat never spotted any of these, so the board credits the room itself.
  assert.ok(openTickets(h.state).every((t) => t.raisedBy === 'SENSOR'));
  assert.ok(h.logged.some((l) => /on the board \(spotted by SENSOR\)/.test(l)));
  // And every title reads as plain English, not as a code.
  for (const t of openTickets(h.state)) assert.doesNotMatch(t.title, /WO-|SEV\d/, t.title);
});

test('one problem is one job, however many times it is swept or reported', async () => {
  const h = harness();
  h.state.incidents.junkTraffic = { startedAt: now, endsAt: now + 300_000 };
  for (let i = 0; i < 5; i++) sweepTickets(h.ctx);
  assert.equal(openTickets(h.state).filter((t) => t.kind === 'junk-traffic').length, 1);

  await say('report', h, 'kaz', 'junk traffic is hammering us');
  await say('report', h, 'mireille', 'why are the fans racing');
  const ticket = findTicket(h.state, 'junk-traffic')!;
  assert.deepEqual(ticket.claimedBy, ['kaz', 'mireille'], 'both spotters get their name on the one job');
  assert.equal(openTickets(h.state).filter((t) => t.kind === 'junk-traffic').length, 1);
});

/**
 * A viewer who has never seen a server room should never have to learn a code.
 * Ids stay for dedupe and lookup; nothing Admin says or any screen shows may
 * contain one.
 */
test('job ids are internal: never spoken, never on a screen', async () => {
  const h = harness();
  h.state.incidents.junkTraffic = { startedAt: now, endsAt: now + 300_000 };
  sweepTickets(h.ctx);
  const ticket = findTicket(h.state, 'junk-traffic')!;

  await say('claim', h, 'kaz', "I'll take it");
  await say('report', h, 'mireille', 'junk traffic is hammering us');
  for (const line of h.said) assert.ok(!line.includes(ticket.id), line);

  const screen = statusScreen(h.state, view);
  const text = [screen.label, ...screen.pages.flatMap((p) => [p.title, p.footer ?? '', ...p.lines]), ...(screen.alerts ?? [])].join(' | ');
  assert.ok(!text.includes(ticket.id), text);
  assert.doesNotMatch(text, /WO-|SEV\d/, text);
});

// ------------------------------------------------------------------ closing

test('a problem that clears takes its own job off the board, with a resolution', () => {
  const h = harness();
  h.state.incidents.junkTraffic = { startedAt: now, endsAt: now + 300_000 };
  sweepTickets(h.ctx);
  const ticket = findTicket(h.state, 'junk-traffic')!;

  h.state.incidents.junkTraffic = undefined;
  sweepTickets(h.ctx);
  assert.equal(ticket.state, 'resolved');
  assert.equal(ticket.resolution, TICKET_KINDS['junk-traffic'].resolution);
  assert.equal(ticket.closedAt, now);
  assert.equal(findTicket(h.state, 'junk-traffic'), undefined);
  // Nothing else is wrong with a fresh room, so the board is genuinely clear.
  assert.deepEqual(openTickets(h.state), []);
});

test('Admin works the board: the top job becomes real work and closes when it lands', () => {
  const h = harness();
  h.state.incidents.junkTraffic = { startedAt: now, endsAt: now + 300_000 };
  sweepTickets(h.ctx);

  const ticket = findTicket(h.state, 'junk-traffic')!;
  assert.equal(ticket.state, 'active', 'the board handed it to him');
  const task = h.tasks.find((t) => t.kind === 'block-traffic');
  assert.ok(task, 'and it became real work');

  h.finishTasks();
  assert.equal(h.state.incidents.junkTraffic, undefined);
  sweepTickets(h.ctx);
  assert.equal(ticket.state, 'resolved');
});

test('a fixed problem does not come back, and the board keeps a short tail', () => {
  const h = harness();
  for (let i = 0; i < tuning.ticketHistory + 6; i++) {
    h.setNow(now + i * 1000);
    const { ticket } = raiseTicket(h.ctx, { kind: 'upstream', subject: `notice ${i}` });
    closeTicket(h.ctx, ticket, 'resolved', 'acknowledged');
    sweepTickets(h.ctx);
  }
  const closed = h.state.tickets.filter((t) => t.state !== 'open' && t.state !== 'active');
  assert.ok(closed.length <= tuning.ticketHistory, `kept ${closed.length}`);
});

// -------------------------------------------------------------------- order

test('the board sorts by how bad it is, then by the claim vote, then by age', () => {
  const h = harness();
  h.setNow(now);
  const { ticket: sev3 } = raiseTicket(h.ctx, { kind: 'crate' });
  h.setNow(now + 1000);
  const { ticket: sev2a } = raiseTicket(h.ctx, { kind: 'rat' });
  h.setNow(now + 2000);
  const { ticket: sev2b } = raiseTicket(h.ctx, { kind: 'junk-traffic' });
  h.setNow(now + 3000);
  const { ticket: sev1 } = raiseTicket(h.ctx, { kind: 'breaker' });

  assert.deepEqual(openTickets(h.state).sort(boardOrder).map((t) => t.id), [sev1, sev2a, sev2b, sev3].map((t) => t.id));

  // Claims are the vote: two names move a ticket above an older peer.
  sev2b.claimedBy.push('kaz', 'mireille');
  assert.deepEqual(openTickets(h.state).sort(boardOrder).map((t) => t.id), [sev1, sev2b, sev2a, sev3].map((t) => t.id));
});

test('Admin takes the worst thing on the board first', () => {
  const h = harness();
  h.state.incidents.delivery = { arrivedAt: now }; // sev3
  h.state.incidents.junkTraffic = { startedAt: now, endsAt: now + 300_000 }; // sev2
  sweepTickets(h.ctx);
  assert.equal(h.tasks[0].kind, 'block-traffic', 'the junk traffic before the delivery');
});

// -------------------------------------------------------------------- claim

test('claiming puts your name on a job and moves it up, without doing the work', async () => {
  const h = harness();
  h.state.incidents.delivery = { arrivedAt: now };
  sweepTickets(h.ctx);
  const ticket = findTicket(h.state, 'crate')!;
  const tasksBefore = h.tasks.length;

  await say('claim', h, 'kaz', "I'll take the delivery one", { about: 'crate' });
  assert.deepEqual(ticket.claimedBy, ['kaz']);
  assert.equal(h.tasks.length, tasksBefore, 'chat claims; Admin works');
  // He names the problem back, so the viewer knows which one they got.
  assert.ok(h.said.some((l) => l.includes('delivery')), h.said.join(' | '));

  // Twice by the same person is a no-op, and a second person adds a vote.
  await say('claim', h, 'kaz', 'mine', { about: 'crate' });
  assert.deepEqual(ticket.claimedBy, ['kaz']);
  await say('claim', h, 'benji', 'the delivery is mine', { about: 'crate' });
  assert.deepEqual(ticket.claimedBy, ['kaz', 'benji']);
});

test('a bare claim takes the worst open job; an empty board says so', async () => {
  const empty = harness();
  await say('claim', empty, 'kaz', "I'll take it");
  assert.ok(empty.said.some((l) => /board's clear/i.test(l)), empty.said.join(' | '));

  const h = harness();
  h.state.incidents.delivery = { arrivedAt: now };
  h.state.power.breakerTripped = true;
  sweepTickets(h.ctx);
  await say('claim', h, 'kaz', "I'll take it");
  assert.deepEqual(findTicket(h.state, 'breaker')!.claimedBy, ['kaz'], 'the worst one, not the first one');
});

// ------------------------------------------------------------------- report

test('a report with nothing wrong closes as nothing wrong, with the name attached', async () => {
  const h = harness();
  await say('report', h, 'tomcat99', "something's beeping");

  const ticket = openTickets(h.state).find((t) => t.kind === 'nofault')!;
  assert.ok(ticket, 'Admin still walks over, and the board records who sent him');
  assert.equal(ticket.raisedBy, 'tomcat99');
  assert.equal(ticket.source, 'chat');

  h.finishTasks();
  assert.equal(ticket.state, 'nofault');
  assert.match(ticket.resolution!, /nothing wrong — tomcat99 sent me over/);
});

test('a correct report is credited to the reporter', async () => {
  const h = harness();
  h.state.incidents.junkTraffic = { startedAt: now, endsAt: now + 300_000 };
  sweepTickets(h.ctx);
  await say('report', h, 'kaz', 'junk traffic is hammering us');
  assert.equal(h.state.chatters['u:kaz'].reports, 1);
});

// ------------------------------------------------------------------ surfacing

/**
 * The board no longer has a screen of its own — the floor monitor is one fixed
 * status page and the worst problem rotates along its bottom edge. So what
 * matters is that a problem still reaches a viewer, in words, and that a job
 * only its owner can do names them.
 */
test('the worst problem reaches the floor monitor as a plain-English alert', () => {
  const h = harness();
  h.state.incidents.junkTraffic = { startedAt: now, endsAt: now + 300_000 };
  h.state.incidents.delivery = { arrivedAt: now };
  sweepTickets(h.ctx);

  const alerts = statusScreen(h.state, view).alerts ?? [];
  assert.ok(alerts.includes('JUNK TRAFFIC IS HAMMERING US'), alerts.join(' | '));
  assert.ok(alerts.includes('A DELIVERY IS WAITING'), alerts.join(' | '));
  // Worst first: junk traffic beats the delivery.
  assert.ok(alerts.indexOf('JUNK TRAFFIC IS HAMMERING US') < alerts.indexOf('A DELIVERY IS WAITING'));
});

test("a job only the owner can do names them and the words they need to say", () => {
  const h = harness();
  const dead = server(h.state, 0, 0);
  sweepTickets(h.ctx);

  const ticket = findTicket(h.state, 'server-down', dead.id)!;
  assert.match(TICKET_KINDS['server-down'].advice!(h.state, ticket.subject), /guest0: say "restart mine"/);
  // And the footer of the one page a viewer actually reads says the same.
  assert.match(statusScreen(h.state, view).pages[0].footer!, /guest0: say "restart mine"/);
});

test('what Admin is doing right now shows on the status page, in words', () => {
  const h = harness();
  h.state.incidents.junkTraffic = { startedAt: now, endsAt: now + 300_000 };
  sweepTickets(h.ctx);
  const working = { ...view, currentTask: { kind: 'block-traffic', label: 'shut out junk traffic', progress: 0.68 } };
  const lines = statusScreen(h.state, working).pages[0].lines.join(' | ');
  assert.match(lines, /ADMIN\s+on the junk traffic/);
  // No percentages and no task kinds leaking through as jargon.
  assert.doesNotMatch(lines, /68|block-traffic/);
});

test('the board reflects a server changing state rather than freezing its title', () => {
  const h = harness();
  const sick = server(h.state, 0, 10);
  sweepTickets(h.ctx);
  const ticket = findTicket(h.state, 'server-down', sick.id)!;
  assert.match(ticket.title, /in trouble/);
  sick.health = 0;
  sweepTickets(h.ctx);
  assert.match(ticket.title, /is off/);
});

test('a room with nothing wrong still tells a new viewer what to do', () => {
  const screen = statusScreen(createInitialState(now), view);
  assert.equal(screen.pages.length, 2, 'the room, and what it is for');
  assert.deepEqual(screen.alerts, ['ALL SYSTEMS ARE GREEN'], 'the bottom line always says something');
  assert.ok(screen.pages[0].footer?.includes('give me a server'));
});
