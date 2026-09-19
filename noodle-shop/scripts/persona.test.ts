// Admin's character card and the world summary injected into every dialogue
// call. The summary is written for salience — what's wrong first, settled
// background last — and it's the only place his lines can get their facts, so
// these pin that nothing he might be asked about goes missing.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { QueueEntryView, TaskSpec, WorldCtx } from '../src/engine/world';
import {
  createInitialState,
  type Server,
  type ServerRoomState,
} from '../src/worlds/server-room/state';
import { IDLE_OPENERS, persona } from '../src/worlds/server-room/persona';
import { openTickets, raiseTicket, sweepTickets } from '../src/worlds/server-room/tickets';
import { tuning } from '../src/worlds/server-room/tuning';

const now = 1_800_000_000_000;

function server(state: ServerRoomState, slot: number, over: Partial<Server> = {}): Server {
  const s: Server = {
    id: `server-${slot}`, slot, ownerUserId: `user-${slot}`, ownerName: `guest${slot}`, name: `server-${slot}`,
    health: 100, level: 0, temperature: 22,
    powerDrawW: tuning.baseDrawW, uptimeDays: 3,
    delivered: 400_000, createdAt: now, darkStreams: 0, ...over,
  };
  state.servers[s.id] = s;
  return s;
}

function ctxFor(state: ServerRoomState) {
  const tasks: TaskSpec<ServerRoomState>[] = [];
  return {
    get state() { return state; },
    get now() { return now; },
    log: () => {}, say: () => {},
    enqueueTask: (spec: TaskSpec<ServerRoomState>) => { tasks.push(spec); return { id: `t${tasks.length}` }; },
    get queue(): ReadonlyArray<QueueEntryView> {
      return tasks.map((t, i) => ({ id: `t${i}`, kind: t.kind, label: t.label, requestedBy: t.requestedBy }));
    },
    llm: { dialogue: async () => null, moderate: async (text: string) => ({ ok: true, cleaned: text }) },
    tuning,
    get chatRatePerMin() { return 0; },
    rng: () => 0.5,
  } as WorldCtx<ServerRoomState>;
}

const summary = (state: ServerRoomState) => persona.summarizeState(state, now);

// ------------------------------------------------------------------- card

test('the character card carries the two-layer why without giving either away', () => {
  const card = persona.systemPrompt;
  // Public duty and the wound both have to be in there for him to play right.
  assert.match(card, /off the books/i);
  assert.match(card, /nobody else remembers it exists/i);
  assert.match(card, /asked to be posted here/i);
  assert.match(card, /never explain that/i);
  // LEGACY-01 is the private want, and the cable is the thing he never confirms.
  assert.match(card, /LEGACY-01/);
  assert.match(card, /never confirm the cable/i);
  assert.match(card, /never suggest turning it off/i);
  // The guardrails that keep him from inventing a room that doesn't exist.
  assert.match(card, /never invent servers, owners or figures/i);
  assert.match(card, /never mention being an AI/i);
});

test('the card teaches every verb chat actually has, and no verb it does not', () => {
  const card = persona.systemPrompt.toLowerCase();
  for (const verb of ['give me a server', 'upgrade mine', 'restart mine', 'spot', 'board']) {
    assert.ok(card.includes(verb), `the card should mention ${verb}`);
  }
  // Verbs that no longer exist must not be taught, or he will offer them.
  // Phrases, not bare words: the ban list below deliberately names the jargon,
  // and 'mod' hides inside 'model'.
  for (const gone of ['patch my', 'patch it', 'clear the disk', 'clean the fans', 'mod queue', 'auth box']) {
    assert.ok(!card.includes(gone), `the card should not teach "${gone}"`);
  }
  // And the ownership rule, which is the most common thing he has to refuse.
  assert.match(persona.systemPrompt, /theirs only/i);
});

/**
 * He was reading like a status report: every line about the servers, no jokes,
 * no curiosity about the people watching. These pin the permissions that make
 * him good company, because they are the first thing a future edit would trim.
 */
test('the card gives him permission to be funny and to talk about something else', () => {
  const card = persona.systemPrompt;
  assert.match(card, /do NOT have to talk about the servers/);
  assert.match(card, /reference material, not an agenda/i, 'the state dump must not read as a to-do list');
  assert.match(card, /remember people/i);
  assert.match(card, /ask things back/i);
  assert.match(card, /question/i);
  assert.match(card, /tease people/i);
  assert.match(card, /have opinions/i);
  // And the thing that keeps banter from eating the job.
  assert.match(card, /when something in here is actually going wrong, that wins/i);
  // Style: he should not be told to be dry and nothing else.
  assert.match(card, /don't repeat yourself/i);
  assert.match(card, /vary your openings/i);
});

/**
 * The whole point of the earlier rewrite: a viewer who knows nothing about
 * computers has to be able to follow him. This pins the vocabulary out of the
 * card itself.
 */
/**
 * He was reading calm while the room fell over. On a live stream the pressure
 * moment is the one that recruits people, so the card has to point him at chat
 * rather than at the dial.
 */
test('the card tells him to get loud and ask chat for help when it is going wrong', () => {
  const card = persona.systemPrompt;
  assert.match(card, /UNDER PRESSURE/);
  assert.match(card, /you need help/i);
  assert.match(card, /ask people directly, by name/i);
  assert.match(card, /more servers means chat stays up/i);
  assert.match(card, /give chat the credit/i);
  assert.match(card, /stressed, not miserable/i);
  assert.match(card, /buzzing/i);
  // He is allowed to shout, which the old lowercase-only style rule forbade.
  assert.match(card, /allowed capitals/i);
  assert.match(card, /swearing is fine/i);
});

test('under pressure, idle focus points him at a person who can actually help', () => {
  const state = createInitialState(now);
  server(state, 0);
  state.chatters['u:kaz'] = { name: 'kaz', firstSeen: now - 86_400_000, lastSeen: now, reports: 0 };

  // Filling up, nothing lost yet: he should be recruiting, by name.
  state.traffic.demandPerMin = 800;
  state.traffic.capacityPerMin = 900;
  const busy = persona.idleFocus!(state)!;
  assert.match(busy, /kaz/, busy);
  assert.match(busy, /give me a server/i, busy);
  assert.match(busy, /urgent|buzzing/i, busy);

  // Actually losing them: louder, and still pointed at somebody.
  state.traffic.demandPerMin = 2000;
  state.traffic.capacityPerMin = 300;
  state.traffic.backlog = tuning.backlogDropAt;
  const losing = persona.idleFocus!(state)!;
  assert.match(losing, /RIGHT NOW/, losing);
  assert.match(losing, /cannot fix it alone/i, losing);
  assert.match(losing, /kaz/, losing);
});

test('the card bans the jargon a non-technical viewer would not follow', () => {
  const card = persona.systemPrompt.toLowerCase();
  for (const word of ['capacity', 'throughput', 'utilisation', 'latency', 'patching', 'ram', 'firewall']) {
    assert.ok(card.includes(word), `the ban list should name ${word}`);
  }
  assert.match(persona.systemPrompt, /assume nobody in chat knows anything about computers/i);
});

// ---------------------------------------------------------------- salience

test('the summary leads with the board and ends with the settled background', () => {
  const state = createInitialState(now);
  state.incidents.junkTraffic = { startedAt: now, endsAt: now + 300_000 };
  server(state, 0);
  sweepTickets(ctxFor(state));

  const lines = summary(state).split('\n');
  assert.match(lines[0], /^jobs on the board/, 'the board is the first thing he reads');
  const index = (re: RegExp) => lines.findIndex((l) => re.test(l));
  assert.ok(index(/^chat:/) < index(/^room:/), 'how chat is flowing outranks the room');
  assert.ok(index(/^room:/) < index(/^servers:/));
  assert.ok(index(/^servers:/) < index(/^LEGACY-01/), 'the mystery is background, not news');
  assert.ok(index(/^LEGACY-01/) < index(/^tank:/));
});

test('a clear board says so rather than going quiet', () => {
  const state = createInitialState(now);
  server(state, 0);
  server(state, 1);
  state.traffic.demandPerMin = 100;
  state.traffic.capacityPerMin = 900;
  assert.match(summary(state), /jobs on the board: nothing\. all systems are green\./);
});

test('open jobs are listed worst first, with who spotted and who claimed', () => {
  const state = createInitialState(now);
  state.power.breakerTripped = true;
  state.incidents.delivery = { arrivedAt: now };
  sweepTickets(ctxFor(state));
  const breaker = openTickets(state).find((t) => t.kind === 'breaker')!;
  breaker.claimedBy.push('kaz', 'mireille');

  const lines = summary(state).split('\n');
  const first = lines.findIndex((l) => l.includes(breaker.title));
  const delivery = lines.findIndex((l) => /unopened delivery/.test(l));
  assert.ok(first >= 0 && first < delivery, 'losing power outranks a delivery');
  assert.match(lines[first], /urgent/);
  assert.match(lines[first], /spotted by SENSOR/);
  assert.match(lines[first], /kaz, mireille put their name on it/);
  // He must never be handed an id he could read out.
  for (const line of lines) assert.doesNotMatch(line, /job-\d|WO-|SEV\d/, line);
});

test('a long board is capped but says how much it left out', () => {
  const state = createInitialState(now);
  for (let i = 0; i < 10; i++) raiseTicket(ctxFor(state), { kind: 'upstream', subject: `notice ${i}` });
  const text = summary(state);
  assert.match(text, /jobs on the board \(10, worst first\)/);
  assert.match(text, /and 4 more, less important/);
});

// ----------------------------------------------------------------- servers

test('every server gets a line, so an owner asking about theirs can always be answered', () => {
  const state = createInitialState(now);
  for (let slot = 0; slot < 8; slot++) server(state, slot);
  const text = summary(state);
  for (let slot = 0; slot < 8; slot++) assert.ok(text.includes(`guest${slot}`), `guest${slot} missing`);
});

test('a server reads as a state in words, never as a health percentage', () => {
  const state = createInitialState(now);
  server(state, 0);
  server(state, 1, { health: 20 });
  server(state, 2, { health: 0 });
  server(state, 3, { level: 2 });
  const lines = summary(state).split('\n');

  assert.match(lines.find((l) => l.includes('guest0'))!, /is fine/);
  assert.match(lines.find((l) => l.includes('guest1'))!, /is in trouble/);
  // A dead server names the one person who can bring it back.
  assert.match(lines.find((l) => l.includes('guest2'))!, /is off — only guest2 can say "restart mine"/);
  assert.match(lines.find((l) => l.includes('guest3'))!, /upgraded 2 times/);

  // No number he could read out as a percentage of anything.
  for (const line of lines.filter((l) => /^ {2}slot/.test(l))) {
    assert.doesNotMatch(line, /health|patch|disk|%/, line);
  }
});

/**
 * He gets usernames in the chat log and no idea which of them he has met. This
 * is what lets him greet a regular as a regular and notice a first-timer.
 */
test('the summary says who is in chat, and which of them he already knows', () => {
  const state = createInitialState(now);
  const mine = server(state, 0);
  state.chatters = {
    'u:kaz': { name: 'kaz', firstSeen: now - 40 * 86_400_000, lastSeen: now - 30_000, reports: 2, serverId: mine.id },
    'u:new': { name: 'newbie', firstSeen: now - 60_000, lastSeen: now - 5_000, reports: 0 },
    'u:gone': { name: 'ghost', firstSeen: now - 40 * 86_400_000, lastSeen: now - 3 * 3_600_000, reports: 0 },
  };

  const line = summary(state).split('\n').find((l) => l.startsWith('in chat just now:'))!;
  assert.ok(line, summary(state));
  assert.match(line, /kaz \(a regular, owns the server in slot 1, currently fine\)/);
  assert.match(line, /newbie \(first time here\)/);
  assert.ok(!line.includes('ghost'), 'somebody who left hours ago is not in chat just now');
  // Most recent first, so the person he is mid-conversation with leads.
  assert.ok(line.indexOf('newbie') < line.indexOf('kaz'), line);
});

test('an empty rack says the room is running on his own machine', () => {
  assert.match(summary(createInitialState(now)), /rack is empty.*your own machine/);
});

// ----------------------------------------------------------------- numbers

test('the summary is deterministic for a given instant', () => {
  const state = createInitialState(now);
  server(state, 0);
  assert.equal(summary(state), summary(state));
});

test('an untouched uptime sign reads as no outage yet, not as zero days', () => {
  const state = createInitialState(now);
  assert.match(summary(state), /no outage on record yet/);
  state.uptime.lastOutageAt = now - 3 * 86_400_000;
  assert.match(summary(state), /3 days since the last outage/);
});

test('a server that has died is counted as off, and the room says how many are running', () => {
  const state = createInitialState(now);
  server(state, 0);
  server(state, 1, { health: 0 });
  assert.match(summary(state), /servers: 1 running, 1 off\./);
});

// -------------------------------------------------------------- idle focus

test('idle focus follows the room, worst first, and turns to chat when all is well', () => {
  const settled = createInitialState(now);
  server(settled, 0);
  server(settled, 1);
  settled.traffic.demandPerMin = 100;
  settled.traffic.capacityPerMin = 900;
  // A working room is not a subject. He talks to the people watching instead —
  // which is the whole reason he stopped sounding like a monitoring dashboard.
  const quiet = new Set(Array.from({ length: 60 }, () => persona.idleFocus!(settled)!));
  for (const focus of quiet) assert.ok(IDLE_OPENERS.includes(focus), focus);
  assert.ok(quiet.size > 1, 'the quiet-room line must vary, not settle into a catchphrase');

  // A server somebody has let die is worth a nudge: only they can fix it.
  const abandoned = createInitialState(now);
  server(abandoned, 0, { health: 0 });
  abandoned.traffic.demandPerMin = 100;
  abandoned.traffic.capacityPerMin = 900;
  assert.match(persona.idleFocus!(abandoned)!, /guest0's server is off/i);

  // An unclaimed serious problem outranks that.
  const faulty = createInitialState(now);
  faulty.traffic.demandPerMin = 100;
  faulty.traffic.capacityPerMin = 900;
  faulty.incidents.junkTraffic = { startedAt: now, endsAt: now + 300_000 };
  sweepTickets(ctxFor(faulty));
  const fault = openTickets(faulty).find((t) => t.kind === 'junk-traffic')!;
  fault.state = 'open'; // not yet in his hands
  const focus = persona.idleFocus!(faulty)!;
  assert.ok(focus.includes(fault.title), focus);
  assert.ok(!focus.includes(fault.id), 'he must not be handed an id to read out');

  // Losing messages outranks everything.
  const losing = createInitialState(now);
  losing.traffic.demandPerMin = 2000;
  losing.traffic.capacityPerMin = 300;
  losing.traffic.backlog = tuning.backlogDropAt;
  assert.match(persona.idleFocus!(losing)!, /losing chat messages/i);
});

test('idle focus never grumbles that nobody claimed the job he is already doing', () => {
  const state = createInitialState(now);
  state.traffic.demandPerMin = 100;
  state.traffic.capacityPerMin = 900;
  state.incidents.junkTraffic = { startedAt: now, endsAt: now + 300_000 };
  sweepTickets(ctxFor(state)); // hands him the traffic fault
  const fault = openTickets(state).find((t) => t.kind === 'junk-traffic')!;
  assert.equal(fault.state, 'active');

  const focus = persona.idleFocus!(state);
  assert.ok(!focus?.includes(fault.id), focus ?? '(none)');
});
