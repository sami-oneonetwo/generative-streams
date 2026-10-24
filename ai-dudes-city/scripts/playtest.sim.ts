// Playtest simulation (not a test: the name keeps it out of `npm test`). Runs the ai-dudes world headless
// on the test harness with fixture agents and designs (no model calls, no network, nothing saved) and a
// scripted chat population, for a couple of hours of game time, and measures pacing: dead air, how often
// things happen, caravan progress per visit/age, coins, who is awake, and repetition.
//
//   DATA_DIR=/tmp/x npx --prefix ai-dudes-city tsx ai-dudes-city/scripts/playtest.sim.ts --chatters 5 --minutes 120 --seed 1
//
// Model latency is simulated in game time (agent turn ~2.5-6 s, design ~25-50 s), and the real AI budget
// (1200 agent / 90 design calls an hour, enforced) and concurrency (6 / 3) are used. The opening scene is
// played by "the operator" at minute 3 (it is an /admin button live). Prints tables; --json writes raw data.
import fs from 'node:fs';
import { harness, flush } from './harness';
import { fixtureAgent, fixtureDesign } from '../src/worlds/ai-dudes/fixtures';
import type { AgentAction, AgentFn, AgentReply } from '../src/worlds/ai-dudes/agent';
import type { DesignFn } from '../src/worlds/ai-dudes/design';
import { ageOf, cityOf } from '../src/worlds/ai-dudes/city';
import { awake } from '../src/worlds/ai-dudes/sim';

// ---- args -------------------------------------------------------------------------------------------
const arg = (k: string, d: string) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1] : d;
};
const N = Number(arg('chatters', '5'));
const MINUTES = Number(arg('minutes', '120'));
const SEED = Number(arg('seed', '1'));
const JSON_OUT = arg('json', '');
const OPENING_AT = Number(arg('opening', '3')) * 60_000; // when the operator plays the opening (-1: never)
const LULL = arg('lull', '55-70').split('-').map(Number); // minutes when chat goes nearly silent

let s = SEED * 7919 + 13;
const rnd = () => ((s = (s * 48271) % 2147483647) / 2147483647);
const pick = <T>(xs: readonly T[]) => xs[Math.floor(rnd() * xs.length) % xs.length];

// ---- game-time sleeping (model latency) --------------------------------------------------------------
const timers: { at: number; resolve: () => void }[] = [];
let H: { now: number } = { now: 0 };
const sleepGame = (ms: number) => new Promise<void>((resolve) => timers.push({ at: H.now + ms, resolve }));

// ---- the fake agent -----------------------------------------------------------------------------------
type TurnRec = { at: number; name: string; kind: 'chat' | 'talk' | 'idle' | 'nudge'; say?: string; actions: string[] };
const turnLog: TurnRec[] = [];
const IDLE_SAYS = [
  'nice day for it', 'anyone want a coffee', 'this street is getting busy', 'I should fix up my place', 'who built that thing',
  'the square looks good', 'I could eat', 'quiet today', 'that tower is new', 'I wonder what the travellers want',
  'my feet hurt', 'need a nap soon', 'somebody should open a bar', 'nice hat', 'the river is loud today', 'busy busy',
];
const REPLIES = ['ha, fair enough', 'not bad, you?', 'same here', 'come by my place later', 'sounds good', 'no idea, honestly', 'I saw that too', 'tell me about it'];
const agent: AgentFn = async (turn) => {
  const t0 = H.now;
  await sleepGame(2500 + rnd() * 3500);
  let reply: AgentReply;
  let kind: TurnRec['kind'];
  if (turn.messages.length) {
    kind = 'chat';
    reply = await fixtureAgent(turn, new AbortController().signal);
    const said = turn.messages.join(' ');
    // What the fixture agent doesn't read: parties, and the kind of a build.
    if (/\bparty\b/i.test(said)) reply.actions.unshift({ do: 'party', ...(/square/i.test(said) ? { at: 'square' } : {}) });
    for (const a of reply.actions)
      if (a.do === 'build') {
        const w = a.what.toLowerCase();
        a.kind = /restaurant|pizz|noodle|diner|grill/.test(w) ? 'restaurant' : /cafe|coffee/.test(w) ? 'cafe' : /bakery/.test(w) ? 'bakery' : /workshop|smithy|forge/.test(w) ? 'workshop' : /house|hut|home/.test(w) ? 'home' : /bar|pub/.test(w) ? 'bar' : 'decor';
      }
    reply.actions.splice(3);
  } else {
    const c = turn.content;
    const talk = /said to you/.test(c);
    kind = talk ? 'talk' : /knocked|hit you|attacked|shoved|zapped|blew up/i.test(c) ? 'nudge' : 'idle';
    const actions: AgentAction[] = [];
    // An unprompted turn may work a shift, help with the project, or chip in a little (never build or fight).
    if (!talk && /community project|Wonder|chip in|lend a hand/i.test(c) && rnd() < 0.35) actions.push(rnd() < 0.5 ? { do: 'help' } : { do: 'contribute', coins: 10 });
    reply = { say: talk ? pick(REPLIES) : pick(IDLE_SAYS), actions };
    if (!turn.persona) Object.assign(reply, { persona: 'I am a resident.', title: 'resident' });
  }
  turnLog.push({ at: t0, name: turn.name, kind, say: reply.say, actions: reply.actions.map((a) => a.do) });
  return reply;
};
const design: DesignFn = async (input, signal) => {
  await sleepGame(25_000 + rnd() * 25_000);
  return fixtureDesign(input, signal);
};

// ---- the world ----------------------------------------------------------------------------------------
const { world, ctx, h, say } = harness({ agent, design, idleLife: true, town: true, agentLimit: 6, designLimit: 3, agentPerHour: 1200, designPerHour: 90, turnGapMs: 2500 });
H = h;
h.state.ai.enforced = true;
const START = h.now;
const min = (t: number) => (t - START) / 60_000;

// ---- the chat population -------------------------------------------------------------------------------
type Chatter = { name: string; type: 'regular' | 'casual' | 'lurker'; rate: number; sessions: [number, number][]; goal: number; aggro: number; sent: number };
const NAMES = ['kim', 'ash', 'lee', 'max', 'sol', 'rin', 'jojo', 'pax', 'bea', 'cy', 'dom', 'eli', 'fen', 'gus', 'hal', 'ivo', 'jet', 'kai', 'lux', 'mo', 'nia', 'oz', 'pip', 'quin', 'rue', 'sky', 'tam', 'uma', 'vic', 'wes'];
const chatters: Chatter[] = [];
for (let i = 0; i < N; i++) {
  const r = rnd();
  const type: Chatter['type'] = i === 0 || r < 0.3 ? 'regular' : r < 0.8 ? 'casual' : 'lurker';
  const arrive = N <= 5 ? rnd() * 3 : i < 5 ? rnd() * 3 : 2 + rnd() * 25;
  const sessions: [number, number][] = [];
  if (type === 'regular') {
    const brk = 30 + rnd() * 60;
    sessions.push([arrive, brk], [brk + 10 + rnd() * 10, MINUTES]);
  } else if (type === 'casual') {
    const a = arrive,
      b = a + 20 + rnd() * 25;
    sessions.push([a, b]);
    if (rnd() < 0.6) {
      const c = b + 15 + rnd() * 30;
      sessions.push([c, c + 15 + rnd() * 30]);
    }
  } else sessions.push([arrive, MINUTES]);
  chatters.push({ name: NAMES[i % NAMES.length] + (i >= NAMES.length ? i : ''), type, rate: type === 'regular' ? 0.9 : type === 'casual' ? 0.4 : 0.12, sessions, goal: rnd() < 0.45 ? 0.45 : 0.1, aggro: rnd() < 0.3 ? 0.18 : 0.04, sent: 0 });
}
const present = (c: Chatter, m: number) => c.sessions.some(([a, b]) => m >= a && m < b);
const others = (c: Chatter) => h.state.dudes.filter((d) => d.name !== c.name);
const buildsOf = () => h.state.objects.filter((o) => !o.civic);

function message(c: Chatter): string {
  const cv = cityOf(h.state).caravan;
  const open = cv?.asks.filter((a) => a.have < a.need) ?? [];
  // Goal-aware chatters read the board (or !town) and push on what it asks.
  if (open.length && rnd() < c.goal) {
    const a = pick(open);
    if (a.kind === 'bridge') return pick(["I'll help at the bridge", 'go fix the bridge', 'help mend the bridge!']);
    if (a.kind === 'build' && a.id === 'food') return pick(['build a little noodle restaurant', 'build me a cafe', 'build a pizza restaurant']);
    if (a.kind === 'build') return pick(['build a workshop', 'build me a smithy workshop']);
    if (a.kind === 'serve') return pick(["I'm hungry", 'food?']);
    if (a.kind === 'operate') {
      const ws = h.state.objects.find((o) => o.venue === 'workshop');
      return ws ? `work at ${ws.blueprint.name}` : 'build a workshop';
    }
    if (a.kind === 'party') return pick(['throw a party on the square!', 'party time']);
    if (a.kind === 'project') return pick(['chip in 40', 'help build the wonder', 'donate 25', 'help with the wonder']);
  }
  if (rnd() < c.aggro) {
    const o = others(c),
      b = buildsOf();
    if (o.length && rnd() < 0.5) return `${pick(['punch', 'kick', 'shove'])} ${pick(o).name}`;
    if (b.length) return `${pick(['shoot', 'bomb', 'throw at'])} the ${pick(b).blueprint.name}`;
  }
  const w = rnd();
  if (c.sent === 0) return pick(['hi', 'hello everyone', 'yo whats this', 'hey chat']);
  if (w < 0.1) return pick(['hi', 'hello', 'hey all', 'back']);
  if (w < 0.33) return pick(['this is cool', 'lol', 'haha', 'what is this', 'nice', 'wow', 'gg', 'ok', 'how does this work', 'so cute', 'I love my guy', 'where am i']);
  if (w < 0.4) return pick(['[emote:37226:KEKW]', '[emote:37227:LULW]', '[emote:39261:PogU]']);
  if (w < 0.55) return pick(['build me a house', 'build a tower', 'build a red castle', 'build a cafe', 'build a bar', 'build a tree', 'build a car', 'build a little bakery']);
  if (w < 0.63) return pick(["I'm hungry", "I'm bored", "I'm tired"]);
  if (w < 0.71) {
    const o = others(c);
    if (o.length) return pick([`high five ${pick(o).name}`, `follow ${pick(o).name}`, `give ${pick(o).name} 10`, `hug ${pick(o).name}`, `invite ${pick(o).name}`]);
  }
  if (w < 0.74) return 'throw a party!';
  if (w < 0.79) return pick(['!town', '!me', '!top']);
  if (w < 0.81) return pick(['the town needs a fountain', 'we should build a big clock tower']);
  if (w < 0.86) {
    const p = h.state.objects.find((o) => o.venue && o.venue !== 'home' && o.venue !== 'decor');
    if (p) return `${pick(['visit', 'work at'])} ${p.blueprint.name}`;
  }
  if (w < 0.9) return pick(['dance', 'wave', 'cheer']);
  return pick(['paint my house red', 'build a workshop', 'build me a restaurant', 'lmao']);
}

// ---- observation ---------------------------------------------------------------------------------------
type Ev = { at: number; kind: string; text?: string };
const events: Ev[] = [];
const ev = (kind: string, text?: string) => events.push({ at: h.now, kind, ...(text ? { text } : {}) });
const feedLines: { at: number; text: string }[] = [];
let hooked: unknown;
function hookFeed() {
  const f = h.state.feed;
  if (f === hooked) return;
  hooked = f;
  const orig = f.push.bind(f);
  f.push = (...items: { at: number; text: string }[]) => {
    for (const it of items) feedLines.push({ at: h.now, text: it.text });
    return orig(...items);
  };
}
const townieSays: { at: number; who: string; text: string }[] = [];
const seenSay = new WeakSet<object>();
let prevParty: string | undefined, prevScene: string | undefined, prevCv = '', prevAge = 0;
const seenObj = new Map<string, number>();
const koSeen = new WeakMap<object, number>();
const attackSeen = new WeakMap<object, object>();
type Sample = { m: number; dudes: number; awake: number; away: number; hidden: number; bridge: number; labour: number; visiting: number; coins: number[]; total: number; jobsWaiting: number; designing: number; inbox: number; agentBucket?: number; designBucket?: number; townies: number };
const samples: Sample[] = [];
const caravanLog: { at: number; age: number; what: string; asks?: string }[] = [];
let lastAnnounced = 0;

function observe() {
  hookFeed();
  const st = h.state,
    c = cityOf(st),
    now = h.now;
  const party = c.party ? `${c.party.title}@${c.party.until}` : undefined;
  if (party && party !== prevParty) ev(/^GRAND OPENING/.test(c.party!.title) ? 'opening' : 'party', c.party!.title);
  prevParty = party;
  const scene = c.scene ? `${c.scene.id}@${c.scene.at}` : undefined;
  if (scene && scene !== prevScene) ev('scene', c.scene!.id);
  prevScene = scene;
  for (const o of st.objects) {
    const r = seenObj.get(o.id);
    if (r === undefined) ev(o.civic ? 'project-stands' : 'build-stands', o.blueprint.name);
    else if (o.revision > r) ev('rebuilt/restyled', o.blueprint.name);
    seenObj.set(o.id, o.revision);
  }
  for (const d of st.dudes) {
    if (d.ko && d.ko.until > now && koSeen.get(d) !== d.ko.until) {
      koSeen.set(d, d.ko.until);
      ev('ko', d.name);
    }
    if (d.attack && attackSeen.get(d) !== d.attack) {
      attackSeen.set(d, d.attack);
      ev('attack', d.name);
    }
  }
  for (const t of c.townies)
    if (t.say && !seenSay.has(t.say)) {
      seenSay.add(t.say);
      townieSays.push({ at: now, who: t.traveller ? 'traveller' : t.name, text: t.say.text });
    }
  const cv = c.caravan;
  const sig = cv ? `${cv.age}|${cv.visit}|${cv.stranded ? 's' : ''}|${cv.nextAt ? 'between' : ''}|${cv.turn ? 'turn' : ''}|${cv.asks.map((a) => `${a.id}:${a.have}/${a.need}`).join(',')}` : '';
  if (sig !== prevCv) {
    caravanLog.push({ at: now, age: cv?.age ?? -1, what: sig, asks: cv?.asks.map((a) => a.label).join(' | ') });
    if (cv && prevCv && sig.split('|').slice(0, 5).join('|') === prevCv.split('|').slice(0, 5).join('|')) ev('ask-progress');
  }
  prevCv = sig;
  if (ageOf(st) !== prevAge) {
    ev('age', String(ageOf(st)));
    prevAge = ageOf(st);
  }
  for (const line of h.announced.slice(lastAnnounced)) ev('crier', line);
  lastAnnounced = h.announced.length;
}
function sample() {
  const st = h.state,
    now = h.now;
  const b = (st.ai as unknown as { bucket?: { agent: number; design: number } }).bucket;
  samples.push({
    m: Math.round(min(now)),
    dudes: st.dudes.length,
    awake: st.dudes.filter((d) => awake(d, now)).length,
    away: st.dudes.filter((d) => !awake(d, now)).length,
    hidden: st.dudes.filter((d) => d.hidden).length,
    bridge: st.dudes.filter((d) => d.labour?.site === 'bridge').length,
    labour: st.dudes.filter((d) => d.labour && d.labour.site !== 'bridge').length,
    visiting: st.dudes.filter((d) => d.visit).length,
    coins: st.dudes.map((d) => d.coins ?? 150),
    total: st.dudes.reduce((a, d) => a + (d.coins ?? 150), 0),
    jobsWaiting: st.jobs.filter((j) => j.status === 'queued').length,
    designing: st.jobs.filter((j) => j.status === 'designing').length,
    inbox: st.dudes.reduce((a, d) => a + d.inbox.length, 0),
    ...(b ? { agentBucket: Math.round(b.agent), designBucket: Math.round(b.design) } : {}),
    townies: cityOf(st).townies.length,
  });
}

// ---- run -----------------------------------------------------------------------------------------------
const run = async () => {
  const STEP = 500;
  let openingDone = OPENING_AT < 0;
  const runAdmin = (id: string) => world.adminActions!.find((a) => a.id === id)!.run({ state: h.state, now: h.now, log: () => {} } as never, undefined as never);
  let msgs = 0;
  const msgTimes: number[] = [];
  for (let t = 0; t < MINUTES * 60_000; t += STEP) {
    const m = t / 60_000;
    if (!openingDone && t >= OPENING_AT) {
      runAdmin('scene-opening');
      openingDone = true;
    }
    const lull = m >= LULL[0] && m < LULL[1] ? 0.08 : 1;
    for (const c of chatters) {
      if (!present(c, m)) continue;
      const p = (c.rate * lull * STEP) / 60_000;
      if (c.sent === 0 || rnd() < p) {
        if (c.sent === 0 && rnd() > 0.02) continue; // first line comes soon after arriving
        const text = message(c);
        c.sent++;
        msgs++;
        msgTimes.push(h.now);
        await say(c.name, text);
      }
    }
    h.now += STEP;
    world.tick(ctx, STEP);
    for (const tm of timers.splice(0).filter((x) => (x.at <= h.now ? (x.resolve(), false) : true))) timers.push(tm);
    await flush();
    await flush();
    observe();
    if (t % 60_000 === 0) sample();
  }
  return { msgs, msgTimes };
};

const t0 = Date.now();
const { msgs, msgTimes } = await run();
const wall = (Date.now() - t0) / 1000;

// ---- analysis ------------------------------------------------------------------------------------------
const pct = (xs: number[], p: number) => {
  if (!xs.length) return NaN;
  const a = [...xs].sort((x, y) => x - y);
  return a[Math.min(a.length - 1, Math.floor(p * a.length))];
};
const gini = (xs: number[]) => {
  const a = [...xs].sort((x, y) => x - y),
    n = a.length,
    sum = a.reduce((x, y) => x + y, 0);
  if (!n || !sum) return 0;
  return a.reduce((acc, x, i) => acc + (2 * (i + 1) - n - 1) * x, 0) / (n * sum);
};
const f1 = (x: number) => (Number.isFinite(x) ? x.toFixed(1) : '-');
const table = (head: string[], rows: (string | number)[][]) => {
  console.log(`| ${head.join(' | ')} |`);
  console.log(`|${head.map(() => '---').join('|')}|`);
  for (const r of rows) console.log(`| ${r.join(' | ')} |`);
  console.log('');
};

// Feed categories.
const FEED_CATS: [string, RegExp][] = [
  ['visit/shift (routine)', /\(\+§\d+|worked a shift| ate | had | at .*§|is back:/],
  ['moved in', /moved into|arrived; no lot|took a flat/],
  ['caravan/story', /of the |bridge|caravan|camp|Wonder|is finished|settled in town|pleased|make do|drawn up|girl at the river|THE WONDER/],
  ['project', /COMMUNITY PROJECT|proposed a community project|toward|is open!|shelved|fell through/],
  ['combat/damage', /brought down|put back up|knocked|punched|kicked|shot|bomb|shoved|threw/],
  ['social', /gave|invited|share/],
];
const catOf = (t: string) => FEED_CATS.find(([, re]) => re.test(t))?.[0] ?? 'other';

// Noteworthy-on-screen moments for dead-air: strict = story/trouble/party/build/combat/talk; loose = + any feed line + agent bubbles.
const strictKinds = new Set(['opening', 'party', 'scene', 'build-stands', 'project-stands', 'ko', 'attack', 'ask-progress', 'age']);
const strictTimes = [
  ...events.filter((e) => strictKinds.has(e.kind)).map((e) => e.at),
  ...turnLog.filter((t) => t.kind === 'talk').map((t) => t.at),
  ...feedLines.filter((f) => !['visit/shift (routine)', 'other'].includes(catOf(f.text))).map((f) => f.at),
];
const looseTimes = [...strictTimes, ...feedLines.map((f) => f.at), ...turnLog.filter((t) => t.say).map((t) => t.at)];
function gaps(times: number[]) {
  const ts = [...new Set(times.map((t) => Math.floor((t - START) / 1000)))].sort((a, b) => a - b);
  const g: number[] = [];
  let prev = 0;
  for (const t of ts) {
    g.push(t - prev);
    prev = t;
  }
  g.push(MINUTES * 60 - prev);
  return g;
}
function gapStats(label: string, times: number[]) {
  const g = gaps(times);
  const over = (s: number) => g.filter((x) => x >= s);
  return [label, pct(g, 0.5), pct(g, 0.9), Math.max(...g), over(60).length, over(120).length, over(300).length, f1(over(60).reduce((a, b) => a + b, 0) / 60)];
}

console.log(`\n## Playtest: ${N} chatters, ${MINUTES} min, seed ${SEED} (wall ${wall.toFixed(0)} s)\n`);
console.log(`chatters: ${chatters.map((c) => `${c.name}(${c.type[0]})`).join(' ')}`);
console.log(`chat lines sent: ${msgs} (${f1(msgs / MINUTES)}/min); agent turns: ${turnLog.length} (chat ${turnLog.filter((t) => t.kind === 'chat').length}, talk ${turnLog.filter((t) => t.kind === 'talk').length}, idle ${turnLog.filter((t) => t.kind === 'idle').length}, nudge ${turnLog.filter((t) => t.kind === 'nudge').length}); lull ${LULL[0]}-${LULL[1]} min\n`);

const firstOf = (k: string) => events.find((e) => e.kind === k);
const firstFeed = feedLines[0];
console.log('### Time to first');
table(
  ['what', 'minute'],
  [
    ['first chat line', f1(min(msgTimes[0] ?? NaN))],
    ['first feed line', firstFeed ? f1(min(firstFeed.at)) + ` (${firstFeed.text.slice(0, 60)})` : '-'],
    ['first build stands', f1(firstOf('build-stands') ? min(firstOf('build-stands')!.at) : NaN)],
    ['first party', f1(firstOf('party') ? min(firstOf('party')!.at) : NaN)],
    ['first dude-to-dude talk', f1(turnLog.find((t) => t.kind === 'talk') ? min(turnLog.find((t) => t.kind === 'talk')!.at) : NaN)],
    ['first strict-noteworthy', f1(min(Math.min(...strictTimes)))],
  ],
);

console.log('### Dead air (gaps between noteworthy moments, seconds)');
table(['definition', 'p50', 'p90', 'max', 'gaps≥60s', '≥120s', '≥300s', 'min in ≥60s gaps'], [gapStats('strict (story/trouble/party/build/combat/talk)', strictTimes), gapStats('loose (+ any feed + any agent bubble)', looseTimes)]);
// Dead air by 15-minute window.
const win: (string | number)[][] = [];
for (let a = 0; a < MINUTES; a += 15) {
  const b = Math.min(MINUTES, a + 15);
  const inWin = strictTimes.filter((t) => min(t) >= a && min(t) < b).map((t) => (t - START) / 1000).sort((x, y) => x - y);
  const pts = [a * 60, ...inWin, b * 60];
  let longest = 0;
  for (let i = 1; i < pts.length; i++) longest = Math.max(longest, pts[i] - pts[i - 1]);
  const lines = msgTimes.filter((t) => min(t) >= a && min(t) < b).length;
  const aw = samples.filter((x) => x.m >= a && x.m < b);
  win.push([`${a}-${b}`, lines, inWin.length, Math.round(longest), f1(aw.reduce((x, y) => x + y.awake, 0) / Math.max(1, aw.length))]);
}
table(['minutes', 'chat lines', 'strict moments', 'longest strict gap (s)', 'avg awake'], win);

console.log('### Event counts');
const count = (k: string) => events.filter((e) => e.kind === k).length;
const perHour = (n: number) => f1((n / MINUTES) * 60);
table(
  ['event', 'count', 'per hour'],
  [
    ['parties (chat-thrown)', count('party'), perHour(count('party'))],
    ['grand openings', count('opening'), perHour(count('opening'))],
    ['scenes (opening/crossing/arrival/ageTurn)', `${count('scene')} (${events.filter((e) => e.kind === 'scene').map((e) => e.text).join(',')})`, perHour(count('scene'))],
    ['builds stood up', count('build-stands'), perHour(count('build-stands'))],
    ['community/Wonder builds stood', count('project-stands'), perHour(count('project-stands'))],
    ['rebuilt/restyled', count('rebuilt/restyled'), perHour(count('rebuilt/restyled'))],
    ['dude-to-dude talk turns', turnLog.filter((t) => t.kind === 'talk').length, perHour(turnLog.filter((t) => t.kind === 'talk').length)],
    ['idle (unprompted) turns', turnLog.filter((t) => t.kind === 'idle').length, perHour(turnLog.filter((t) => t.kind === 'idle').length)],
    ['attacks started', count('attack'), perHour(count('attack'))],
    ['knockouts', count('ko'), perHour(count('ko'))],
    ['caravan ask progress ticks', count('ask-progress'), perHour(count('ask-progress'))],
    ['crier lines to chat', count('crier'), perHour(count('crier'))],
    ['townie/traveller bubbles', townieSays.length, perHour(townieSays.length)],
  ],
);
const fc: Record<string, number> = {};
for (const f of feedLines) fc[catOf(f.text)] = (fc[catOf(f.text)] ?? 0) + 1;
table(['feed category', 'lines', 'per hour'], Object.entries(fc).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, v, perHour(v)]));

console.log('### Caravan progress');
const milestones: (string | number)[][] = [];
let lastKey = '',
  lastAt = START;
for (const c of caravanLog) {
  const [age, visit, stranded, between, turn] = c.what.split('|');
  const key = `${age}|${visit}|${stranded}|${between}|${turn}`;
  if (key === lastKey) continue;
  milestones.push([f1(min(c.at)), f1(min(c.at) - min(lastAt)), age, stranded ? 'bridge' : turn ? 'age turning' : between ? 'between visits' : `visit ${Number(visit) + 1}`, (c.what.split('|')[5] ?? '').slice(0, 60)]);
  lastKey = key;
  lastAt = c.at;
}
table(['at min', 'prev phase took (min)', 'age', 'phase', 'asks have/need at start'], milestones);
const cvNow = cityOf(h.state).caravan;
console.log(`end: age ${ageOf(h.state)}, caravan ${cvNow ? `age ${cvNow.age} visit ${cvNow.visit + 1}${cvNow.stranded ? ' (bridge)' : ''}, asks ${cvNow.asks.map((a) => `${a.id} ${a.have}/${a.need}`).join(', ')}` : 'none'}; project: ${cityOf(h.state).project ? `${cityOf(h.state).project!.name ?? cityOf(h.state).project!.what} ${cityOf(h.state).project!.status} coins ${cityOf(h.state).project!.coins}/${cityOf(h.state).project!.coinsNeed} work ${Math.round(cityOf(h.state).project!.work)}/${cityOf(h.state).project!.workNeed}` : 'none'}\n`);

console.log('### Population and coins (every 15 min)');
table(
  ['min', 'dudes', 'awake', 'away', 'hidden', 'bridge', 'project labour', 'on a visit', 'coins mean', 'median', 'min', 'max', 'gini', 'total', 'designs queued', 'designing', 'inbox', 'agent/design bucket'],
  samples.filter((x) => x.dudes && (x.m % 15 === 0 || x === samples[samples.length - 1])).map((x) => [x.m, x.dudes, x.awake, x.away, x.hidden, x.bridge, x.labour, x.visiting, f1(x.total / Math.max(1, x.dudes)), pct(x.coins, 0.5), Math.min(...x.coins), Math.max(...x.coins), gini(x.coins).toFixed(2), x.total, x.jobsWaiting, x.designing, x.inbox, x.agentBucket !== undefined ? `${x.agentBucket}/${x.designBucket}` : '-']),
);

console.log('### Repetition');
const norm = (t: string) => t.replace(/§\d+/g, '§N').replace(/\d+/g, 'N');
const topDup = (xs: string[], n = 6) => {
  const m: Record<string, number> = {};
  for (const x of xs) m[x] = (m[x] ?? 0) + 1;
  return Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, n);
};
const uniq = (xs: string[]) => new Set(xs).size;
const gossip = townieSays.filter((t) => t.who !== 'traveller').map((t) => t.text);
const trav = townieSays.filter((t) => t.who === 'traveller').map((t) => t.text);
const feedN = feedLines.map((f) => norm(f.text));
const crier = events.filter((e) => e.kind === 'crier').map((e) => norm(e.text!));
const idleHooks = turnLog.filter((t) => t.kind === 'idle').length;
table(
  ['stream', 'lines', 'distinct', 'top repeats'],
  [
    ['townie gossip bubbles', gossip.length, uniq(gossip), topDup(gossip, 3).map(([k, v]) => `${v}× "${k.slice(0, 50)}"`).join('; ')],
    ['traveller bubbles', trav.length, uniq(trav), topDup(trav, 3).map(([k, v]) => `${v}× "${k.slice(0, 50)}"`).join('; ')],
    ['feed (numbers normalised)', feedN.length, uniq(feedN), topDup(feedN, 3).map(([k, v]) => `${v}× "${k.slice(0, 50)}"`).join('; ')],
    ['crier lines', crier.length, uniq(crier), topDup(crier, 2).map(([k, v]) => `${v}× "${k.slice(0, 60)}"`).join('; ')],
  ],
);
console.log(`idle turns ${idleHooks}`);
console.log(`party times (min): ${events.filter((e) => e.kind === 'party' || e.kind === 'opening').map((e) => `${f1(min(e.at))}${e.kind === 'opening' ? 'O' : ''}`).join(' ')}`);

if (JSON_OUT) fs.writeFileSync(JSON_OUT, JSON.stringify({ N, MINUTES, SEED, events: events.map((e) => ({ ...e, m: min(e.at) })), feed: feedLines.map((f) => ({ m: min(f.at), text: f.text })), turns: turnLog.map((t) => ({ ...t, m: min(t.at) })), samples, caravanLog: caravanLog.map((c) => ({ ...c, m: min(c.at) })), townieSays: townieSays.map((t) => ({ ...t, m: min(t.at) })) }, null, 1));
process.exit(0);
