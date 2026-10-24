// AI DUDES, the town: every chatter moves in, gets a lot of their own, and is run by their own
// agent. They build homes and places other people use (city.ts), go out when they need to, and
// put up the big things together. Chat is not classified or queued behind a single protagonist: each message
// goes straight into its chatter's inbox, and agents take turns in parallel (a pool of
// DUDES_AGENT_CONCURRENCY), each turn answering everything its chatter said since the last one.
// Builds are designed in a second pool (DUDES_DESIGN_CONCURRENCY) and then every dude walks over
// and puts its own up at the same time as everyone else's. The agents answer in a closed grammar
// (agent.ts); this file turns that into world changes, and sim.ts runs the clockwork.
import { config } from '../../config';
import type { AdminAction, WorldCtx, WorldModule } from '../../engine/world';
import { readTail } from '../../engine/log';
import { chatCompletion } from '../../llm/openrouter';
import { shortRef, viewOf, type GroundPoint, type SafehouseObject } from '../../shared/objectTypes';
import { EMOTES, type DudeView, type DudesAdminStatus, type DudesScene, type Emote } from '../../shared/dudesTypes';
import { agentInput, defaultLook, parseAgentText, type AgentAction, type AgentFn, type AgentReply } from './agent';
import { DESIGN_SYSTEM, designMessage, parseDesign, type DesignFn } from './design';
import { fixtureAgent, fixtureDesign } from './fixtures';
import { canSpend, callsLeft, capacityOf, perHourOf, recentCalls, spend, type BudgetDefaults, type CallKind } from './budget';
import { relayout } from './relayout';
import { sendDude, overhear, placeJob, tickDudes, awake, isActive, startUse, endUse, inUse, draftingSpot, parkObject, seatHeight, addEffect, AWAKE_MS, HOLD_MS } from './sim';
import { clampToGround, spawnPoint, workSpots } from './placement';
import {
  TOWN,
  cityOf,
  claimLot,
  coinsOf,
  contribute,
  findFlat,
  freeSpaceOn,
  freeSpotOn,
  onLot,
  freshNeeds,
  headingOf,
  homeOf,
  leaveVisit,
  lotForBuild,
  designDirection,
  dressed,
  namingAge,
  originOf,
  themed,
  lotsOf,
  ownerOfLot,
  needsOf,
  noteTie,
  spend as spendCoins,
  placeById,
  placesOf,
  projectDesigned,
  projectOf,
  projectPreview,
  proposeProject,
  releaseLot,
  shareLot,
  startLabour,
  startVisit,
  tell,
  throwParty,
  tickCity,
  townBanner,
  townieViews,
  townView,
  welcomeBack,
  ageOf,
  queueRestyles,
  setAge,
  type Place,
} from './city';
import { AGES, MODERN, ageStyle, dressFor, parseAge, venueName } from '../../shared/ages';
import { bridgeOpen, nameDaughter, playScene, resumeCaravan, skipVisit, startCaravan } from './caravan';
import { daughterLocked } from './caravan'; // hook FK-128
import { crierCommand, crierSays, isCrierCommand, takeCrierLines, tickCrierAnswers, tickSpotlight } from './crier';
import { emoteNames, emoteOnly } from '../../shared/emotes';
import { cleanVoiceOf } from './voice';
import { AIDE_SYSTEM, aideContent, applyAide, parseAide, type AideFn } from './aide';
import { fitBlueprint } from './blueprint';
import { MAYOR_BUILDER, mayorBuildViews, mayorDudeView, mayorView, rideInfo, tickMayor, tickMayorBuilds } from './mayor';
import { mayorSpot, startBit } from './bits';
import { altitudeOf, flies, rideable, setAltitude, tickMovers } from './movers';
import { armedBuild, fire, ram } from './weapons';
import { DAMAGE, heal, ruined } from './damage';
import { WEAPONS, type Weapon } from '../../shared/dudesTypes';
import { tickDamage } from './damage';
import { PLAYER, allowedStep, isPiloted, pilot, pilots, solidStep, stampOf, stepped, trailSpeed } from './players';
import { BUS_STOP, CITY, NEEDS, SQUARE, VENUES, WONDER, allPlots, moodOf, plotById, venueKindOf, type Need, type VenueKind } from '../../shared/city';
import { damageOf, happeningView, nudge, restore, startHappening, tickEvents } from './events';
import { knockedOut, runOver, startAttack } from './combat';
import { idleHook, spokeTo } from './talk';
import { applyReading, backfill, chatFromLog, due, fixtureListener, listen, listenerInput, listenerOf, REFUSAL, wishesMarkdown, wishViews, type ListenerFn } from './listener';
import fs from 'node:fs';
import path from 'node:path';
import {
  LIMITS,
  STATE_VERSION,
  dropBadStory,
  freshState,
  nextId,
  pushFeed,
  pushLine,
  resetState,
  stateSchema,
  storyOn,
  trimStory,
  type Dude,
  type DudesState,
  type Job,
} from './state';
import { storyDevActions, storyDevButtons } from './story/dev';
import { gathering, hearInGather, takeQueued, tickGather } from './story/gather';
import { releaseShow, tickShow } from './story/show';
import { storyDudeView } from './story/view';

export interface DudesOptions {
  agent: AgentFn;
  design: DesignFn;
  fixture: boolean;
  /** A key is configured (or fixtures are on): model calls can happen at all. */
  available: boolean;
  agentLimit: number;
  designLimit: number;
  allowance: number;
  /** The rolling budget's defaults (budget.ts), until /admin sets its own; and rough dollars per call for the spend estimate. */
  agentPerHour?: number;
  designPerHour?: number;
  agentCallUsd?: number;
  designCallUsd?: number;
  agentModel: string;
  designModel: string;
  /** Minimum gap between one dude's turns; messages that arrive inside it wait and go together. */
  turnGapMs?: number;
  /** The Listener's model call, and where its backlog document goes (none in tests). */
  listener?: ListenerFn;
  listenerModel?: string;
  writeWishes?: (markdown: string) => void;
  /** The Builder's attempts (data/builder/attempts.json), for the admin page. */
  readProposals?: () => NonNullable<DudesAdminStatus['listener']>['proposals'];
  /** Earlier chat for the Listener's first reading (the engine's terminal log). */
  readChatLog?: () => ReturnType<typeof chatFromLog>;
  /** The Mayor's aide (aide.ts): the operator's wishes turned into changes. None: the aide box says it is unavailable. */
  aide?: AideFn;
}

/** Live model calls. A turn is small and fast; a design is big and slow, like the safehouse's. */
export function liveAgent(model: string): AgentFn {
  return async (turn, signal) =>
    parseAgentText(
      await chatCompletion({
        model,
        system: turn.system,
        messages: [{ role: 'user', content: turn.content }],
        json: true,
        temperature: 0.85,
        maxTokens: 900,
        timeoutMs: 45_000,
        attempts: 1,
        signal,
      }),
    );
}
export function liveAide(model: string): AideFn {
  return (input, signal) =>
    chatCompletion({ model, system: input.system, messages: [{ role: 'user', content: input.content }], json: true, temperature: 0.4, maxTokens: 700, timeoutMs: 40_000, attempts: 1, signal });
}
export function liveListener(model: string): ListenerFn {
  return async (input, signal) => {
    const raw = await chatCompletion({
      model,
      system: input.system,
      messages: [{ role: 'user', content: input.content }],
      json: true,
      temperature: 0.3,
      maxTokens: 12_000,
      reasoning: { max_tokens: 3000, exclude: true },
      timeoutMs: 150_000,
      attempts: 1,
      signal,
    });
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('listener answered without JSON');
    return JSON.parse(match[0]) as unknown;
  };
}
export function liveDesign(model: string): DesignFn {
  return async (input, signal) =>
    parseDesign(
      await chatCompletion({
        model,
        system: DESIGN_SYSTEM,
        messages: [{ role: 'user', content: designMessage(input) }],
        json: true,
        temperature: 0.7,
        maxTokens: 14_000,
        reasoning: { max_tokens: 2500, exclude: true }, // thinking must not eat the geometry
        timeoutMs: 150_000,
        attempts: 1,
        signal,
      }),
      !!input.target,
    );
}

const lower = (s: string) => s.trim().toLowerCase();
/** A chat line as it goes in a speech bubble: one line, no links, not too long. */
const sayable = (text: string) =>
  text
    .replace(/\bhttps?:\/\/\S+/gi, '')
    .replace(/\bwww\.\S+/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, LIMITS.say)
    .replace(/\[emote:[^\]]*$/, '') // never half an emote (see shared/emotes.ts)
    .trimEnd();
const sayMs = (text: string) => Math.max(4000, Math.min(16_000, 2500 + text.length * 65));

/** Best match for a name the agent wrote among some named things: exact, then contains, then shared words. */
/** Words that carry meaning in a build request (for telling one request from a repeat of it). */
const STOP = new Set(['the', 'and', 'with', 'for', 'that', 'this', 'into', 'from', 'some', 'very', 'little', 'big', 'small', 'build', 'make', 'new', 'one', 'can', 'have', 'please', 'want', 'like', 'its', 'their', 'your', 'our', 'my', 'me', 'a', 'an', 'of', 'on', 'in', 'to', 'it']);
const contentWords = (s: string) => new Set(s.toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').split(/[\s-]+/).filter((w) => w.length > 2 && !STOP.has(w)));
const overlap = (a: Set<string>, b: Set<string>) => {
  let n = 0;
  for (const w of a) if (b.has(w)) n++;
  return n / Math.max(1, a.size + b.size - n);
};
/** The chatter asked for more of the same: "another", "a second one", "two of them". */
const AGAIN = /\b(another|second|one more|two|more|again)\b/i;
/** The chatter asked for something to come down. */
const ASKS_REMOVAL = /\b(remove|take (it |that |them )?down|get rid|demolish|knock (it |that )?down|tear (it |that )?down|destroy|delete|bulldoze|scrap)\b/i;
/** Who designs the town's own remakes when the age moves on. */
const TOWN_BUILDER = { name: 'the town', persona: 'Keeps every build what it was while the age changes around it.' };
/** A character throws a party at most this often. */
const PARTY_GAP_MS = 5 * 60_000;
/** The most a character puts into the town's project on a turn of its own (and never over a tenth of its coins). */
const UNPROMPTED_CHIP_IN = 15;
/** How long a build is remembered for spotting a repeat of it. */
const REPEAT_MS = 5 * 60_000;

/** What a kind of place is called, for the design call: "fire pit (a café)" in the Stone Age, plain "café" today. */
function kindFor(age: number, kind: VenueKind): string {
  const name = venueName(age, kind),
    label = VENUES[kind].label;
  return name === label ? label : `${name} (a ${label})`;
}

export function matchName<T>(phrase: string, items: T[], nameOf: (t: T) => string): T | undefined {
  const p = lower(phrase).replace(/^(the|my|a|an)\s+/, '').replace(/^@/, '');
  if (!p) return undefined;
  const ref = p.replace(/^#/, '');
  const exact = items.find((t) => lower(nameOf(t)) === p);
  if (exact) return exact;
  const contains = items.filter((t) => lower(nameOf(t)).includes(p) || p.includes(lower(nameOf(t))));
  if (contains.length) return contains.sort((a, b) => nameOf(a).length - nameOf(b).length)[0];
  const words = new Set(p.split(/\W+/).filter((w) => w.length > 2));
  let best: T | undefined,
    score = 0;
  for (const t of items) {
    const s = lower(nameOf(t))
      .split(/\W+/)
      .filter((w) => words.has(w) || words.has(w.replace(/s$/, ''))).length;
    if (s > score) [best, score] = [t, s];
  }
  return best ?? items.find((t) => (t as { id?: string }).id && shortRef((t as unknown as { id: string }).id) === ref);
}

export function createAiDudesWorld(opts: DudesOptions): WorldModule<DudesState> {
  const turnGapMs = opts.turnGapMs ?? 2500;
  /** Up to this many chatters talking at once, each waits only `turnGapMs` between turns; past it, the gap grows in step. */
  const TALKERS_PER_GAP = 6;
  /** A character reacting to something on its own waits this long after its last turn. */
  const NUDGE_GAP_MS = 15_000;
  /** Idle life: one quiet character gets a turn of its own about this often. */
  const IDLE_TURN_MS = 40_000;
  let nextIdleAt = 0;
  // In flight right now (never saved): which dudes' agents are mid-turn, which designs are out.
  const agentCalls = new Map<string, AbortController>();
  const designCalls = new Map<string, AbortController>();
  /** When each character last threw a party (not saved): one every few minutes at most. */
  const lastParty = new Map<string, number>();
  /** Each character's recent builds (not saved): a request repeated from an earlier message is not built twice. */
  const recentBuilds = new Map<string, { words: Set<string>; venue: VenueKind; asked?: string; at: number }[]>();
  let live: WorldCtx<DudesState> | undefined;
  const ctxOf = (ctx: WorldCtx<DudesState>) => live ?? ctx;

  /** The rolling budget (budget.ts): agent turns and designs drawn from buckets of their own. */
  const budget: BudgetDefaults = { agentPerHour: opts.agentPerHour ?? 1200, designPerHour: opts.designPerHour ?? 90 };
  const nowOf = () => live?.now ?? Date.now();
  /** One model call booked against the budget; false when it is enforced and that kind has none left right now. */
  function reserveCall(state: DudesState, kind: CallKind = 'agent'): boolean {
    return spend(state.ai, kind, budget, nowOf());
  }

  /** A call of this kind may go now; `keep` holds that many back for something more important. */
  const canCall = (state: DudesState, kind: CallKind = 'agent', keep = 0) => opts.available && !state.ai.paused && canSpend(state.ai, kind, budget, nowOf(), keep);

  // Called from every call's `.finally`: a throw here would be an unhandled rejection, so each part
  // is guarded on its own and one failing does not stop the others.
  function pump(ctx: WorldCtx<DudesState>): void {
    for (const [part, fn] of [['agents', pumpAgents], ['designs', pumpDesigns], ['aide', pumpAide]] as const) {
      try {
        fn(ctx);
      } catch (e) {
        ctx.log(`pump ${part} error: ${(e as Error).message}`, 'alert');
      }
    }
  }

  /** The Mayor's aide: one wish at a time, on a call of its own; the answer goes back to the operator page. */
  let aideCall: AbortController | undefined;
  function pumpAide(ctx: WorldCtx<DudesState>): void {
    const m = ctx.state.mayor;
    if (!m?.ask || aideCall) return;
    const asked = m.ask.text;
    const answer = (reply: string, ok: boolean) => {
      const c = ctxOf(ctx);
      const mm = c.state.mayor;
      if (!mm) return;
      mm.ask = undefined;
      mm.aide = { asked, reply: reply.slice(0, 600), ok, at: c.now };
      c.log(`aide: "${asked.slice(0, 80)}" -> ${reply.slice(0, 160)}`);
    };
    // A wish left over from before a restart, or that sat for minutes: dropped rather than done late.
    if (ctx.now - m.ask.at > 120_000) return answer('That wish went stale before I got to it. Ask again?', false);
    if (!opts.aide) return answer(opts.fixture ? 'The aide needs the real models; fixtures are on.' : 'The aide is not set up (no model).', false);
    if (!canCall(ctx.state) || !reserveCall(ctx.state)) return answer('No AI calls left (paused or over the limit), so I can’t do that right now.', false);
    const content = aideContent(ctx.state, asked, ctx.now, adminActions);
    const ac = (aideCall = new AbortController());
    void opts
      .aide({ system: AIDE_SYSTEM, content }, ac.signal)
      .then((raw) => {
        const c = ctxOf(ctx);
        const { reply, actions, dropped } = parseAide(raw);
        const problems = applyAide(c, actions, adminActions);
        if (dropped) problems.push(`${dropped} step${dropped === 1 ? '' : 's'} I couldn't make sense of`);
        answer([reply || (actions.length ? 'Done.' : 'Nothing I can do about that one.'), problems.length ? `(Couldn't: ${problems.join('; ')}.)` : ''].filter(Boolean).join(' '), !problems.length);
      })
      .catch((e: Error) => answer(`The aide's call failed: ${e.message.slice(0, 120)}`, false))
      .finally(() => {
        if (aideCall === ac) aideCall = undefined;
      })
      .catch((e: Error) => ctx.log(`aide error: ${e.message}`, 'alert'));
  }

  // ---- agent turns ----------------------------------------------------------------------------
  function pumpAgents(ctx: WorldCtx<DudesState>): void {
    const state = ctx.state;
    // A busy chat spreads the turns out: each chatter's gap grows with how many are talking, so a hundred
    // chatters each get a turn every half a minute or so instead of the first few getting all of them.
    const talking = state.dudes.filter((d) => ctx.now - d.lastHeardAt < 120_000).length;
    const gap = Math.min(60_000, turnGapMs * Math.max(1, talking / TALKERS_PER_GAP));
    // While a scene or a gathering runs, nobody reacts on a turn of their own: those wait for the release (FK-018).
    const own = !gathering(state);
    while (agentCalls.size < opts.agentLimit && canCall(state)) {
      const now = ctx.now;
      // Chat first, oldest waiting first; then characters reacting on their own to what happened to them.
      const free = state.dudes.filter((d) => !d.muted && !agentCalls.has(d.id) && !isPiloted(d.id));
      const next =
        free.filter((d) => d.inbox.length && now - d.lastTurnAt >= gap).sort((a, b) => a.inbox[0].at - b.inbox[0].at)[0] ??
        (own ? free.filter((d) => d.nudges?.length && awake(d, now) && now - d.lastTurnAt >= NUDGE_GAP_MS).sort((a, b) => a.lastTurnAt - b.lastTurnAt)[0] : undefined);
      if (!next || !reserveCall(state)) return;
      startTurn(ctx, state, next, now);
    }
  }

  function startTurn(ctx: WorldCtx<DudesState>, state: DudesState, dude: Dude, now: number): void {
    const turn = agentInput(state, dude, now, AWAKE_MS);
    // What it is answering joins the conversation now, so a failed call still leaves it on record.
    for (const line of dude.inbox.splice(0)) pushLine(dude.history, line, LIMITS.history);
    dude.overheard = [];
    dude.nudges = undefined;
    dude.lastTurnAt = now;
    const ac = new AbortController();
    agentCalls.set(dude.id, ac);
    const id = dude.id;
    opts
      .agent(turn, ac.signal)
      .then((reply) => {
        if (ctx.state !== state) return; // the world was reset under this call
        const d = state.dudes.find((x) => x.id === id);
        if (d) applyReply(ctx, state, d, reply, ctx.now, turn.messages.length > 0, turn.messages);
      })
      .catch((e: Error) => {
        if (ctx.state !== state || ac.signal.aborted) return;
        const d = state.dudes.find((x) => x.id === id);
        if (d) {
          d.lastError = `agent: ${e.message}`.slice(0, 300);
          d.emote = { pose: 'think', until: ctx.now + 4000 };
        }
        ctx.log(`agent turn for ${turn.name} failed: ${e.message}`, 'warn');
      })
      .finally(() => {
        if (agentCalls.get(id) === ac) agentCalls.delete(id);
        if (ctx.state === state) pump(ctx);
      })
      .catch((e: Error) => ctx.log(`agent turn for ${turn.name} errored: ${e.message}`, 'alert'));
  }

  function applyReply(ctx: WorldCtx<DudesState>, state: DudesState, dude: Dude, reply: AgentReply, now: number, prompted = true, said: string[] = []): void {
    // What the chatter actually typed this turn: it goes to the designer with whatever they asked built.
    const asked = said.join(' / ').slice(0, 300) || undefined;
    dude.turns++;
    dude.lastTurnAt = now;
    dude.lastError = undefined;
    if (reply.persona) dude.persona = reply.persona;
    if (reply.title) dude.title = reply.title;
    if (reply.look) {
      // The first look is free (it comes with the persona); a new hat or outfit after that costs a little, paid as far as they can.
      const next = { ...dude.look, ...reply.look };
      const changed = dude.turns > 1 && JSON.stringify(next) !== JSON.stringify(dude.look);
      dude.look = next;
      const paid = changed ? spendCoins(state, dude, TOWN.lookFee, now) : 0;
      if (paid) pushLine(dude.history, { from: 'world', text: `your new look cost §${paid}`, at: now }, LIMITS.history);
    }
    for (const fact of reply.remember ?? []) pushLine(dude.memory, fact, LIMITS.memory);
    // The chatter's own words are the character's speech (see `hear`); the agent speaks for itself
    // only on a turn of its own, reacting to something that happened to it.
    // A refusal is still worth hearing about, even when nobody sees it said.
    if (reply.say && REFUSAL.test(reply.say)) listen(state, 'refused', dude.name, reply.say, now);
    if (reply.say && !prompted) {
      dude.say = { text: reply.say, until: now + sayMs(reply.say) };
      pushLine(dude.history, { from: 'dude', text: reply.say, at: now }, LIMITS.history);
      overhear(state, dude, reply.say, now);
      // Said to someone (by name, or to the one person in front of them): they answer on a turn of their own.
      spokeTo(state, dude, reply.say, now);
      // Mirrors to Kick only while the operator's replies toggle is on; always lands in the log.
      ctx.say(`@${dude.name} ${reply.say}`, { toKick: true });
    }
    // Knocking something down in the same breath as building means making room, which the chatter
    // did not ask for: the removal waits until they say so (unless what they said this turn asks for it).
    const building = reply.actions.some((a) => a.do === 'build' || a.do === 'edit');
    for (const action of reply.actions) {
      if (building && action.do === 'remove' && !ASKS_REMOVAL.test(asked ?? '')) {
        pushLine(dude.history, { from: 'world', text: `you did not take down ${action.target}: only remove things when your chatter asks you to`, at: now }, LIMITS.history);
        continue;
      }
      // A turn of the agent's own (nobody in chat asked) may talk, move, use and fix, but not start
      // builds or fights: those cost designs or start feuds that would run on without anyone asking.
      // Nor propose a town project or hand money about: those were the chatter's to decide. Chipping a
      // little into the town's project is the exception, so it still gets somewhere when chat is quiet.
      if (!prompted && ['build', 'attack', 'propose', 'give', 'party'].includes(action.do)) continue;
      if (!prompted && action.do === 'contribute') {
        const small = Math.min(Math.floor(action.coins) || 10, UNPROMPTED_CHIP_IN, Math.floor(coinsOf(dude) / 10));
        if (small < 1) continue;
        action.coins = small;
      }
      const note = act(state, dude, action, now, ctx.rng, asked);
      if (note) {
        pushLine(dude.history, { from: 'world', text: note, at: now }, LIMITS.history);
        listen(state, 'failed', dude.name, note, now);
      }
    }
    pump(ctx);
  }

  /** Where "near X" / "to X" points: a dude, a build, home, the square, an address, or right here. */
  function placeOf(state: DudesState, dude: Dude, phrase: string | undefined, rng: () => number): GroundPoint | undefined {
    const p = lower(phrase ?? 'me');
    if (!p || p === 'me' || p === 'here' || p === 'myself') return dude.position;
    if (/^(home|my home|my house|my lot|my place|my plot)$/.test(p)) {
      const home = homeOf(state, dude);
      if (home) return standBeside(dude, home.at, home.footprint);
      const lot = lotsOf(state, dude)[0];
      return lot ? lot.centre : undefined;
    }
    if (/^(the )?mayor$/.test(p)) return mayorSpot(state, Date.now());
    if (/^(the )?(square|town square|centre|center|middle|town|fountain|everyone)/.test(p)) {
      const a = rng() * Math.PI * 2;
      return { x: Math.cos(a) * 4, z: Math.sin(a) * 4 };
    }
    if (p === 'wander' || p === 'around' || p === 'anywhere') {
      const a = rng() * Math.PI * 2,
        r = 4 + rng() * 8;
      return clampToGround({ x: dude.position.x + Math.cos(a) * r, z: dude.position.z + Math.sin(a) * r }, 2);
    }
    const lot = allPlots().find((l) => p.includes(l.address.toLowerCase()));
    if (lot) return lot.centre;
    const other = matchName(p.replace(/'s (lot|house|home|place)$/, ''), [...state.dudes.filter((d) => d.id !== dude.id), ...cityOf(state).townies], (d) => d.name);
    if (other) {
      if (/'s (lot|house|home|place)$/.test(p) && 'inbox' in other) {
        const theirs = lotsOf(state, other)[0];
        if (theirs) return theirs.centre;
      }
      // Stand beside them, on the side we are coming from.
      const dx = dude.position.x - other.position.x,
        dz = dude.position.z - other.position.z,
        d = Math.hypot(dx, dz) || 1;
      return { x: other.position.x + (dx / d) * 1.4, z: other.position.z + (dz / d) * 1.4 };
    }
    const build = matchName(p, state.objects, (o) => o.blueprint.name);
    if (build) return standBeside(dude, build.driven?.at ?? build.position, build.footprint);
    return undefined;
  }
  function standBeside(dude: Dude, at: GroundPoint, size: { width: number; depth: number }): GroundPoint {
    const dx = dude.position.x - at.x,
      dz = dude.position.z - at.z,
      d = Math.hypot(dx, dz) || 1,
      reach = Math.max(size.width, size.depth) / 2 + 1;
    return { x: at.x + (dx / d) * reach, z: at.z + (dz / d) * reach };
  }

  /** A place from what the agent wrote: a name, or a need ("food", "somewhere fun", "rest"). */
  function placeFromPhrase(state: DudesState, dude: Dude, phrase: string, rng: () => number): Place | string {
    const p = lower(phrase);
    const places = placesOf(state);
    const named = matchName(p, places, (x) => x.name);
    if (named && (lower(named.name).includes(p.replace(/^(the|my|a|an)\s+/, '')) || p.includes(lower(named.name)))) return named;
    const needWord: [RegExp, Need][] = [
      [/\b(food|eat|hungry|lunch|dinner|breakfast|snack|coffee|drink)\b/, 'hunger'],
      [/\b(rest|sleep|bed|nap|home|tired)\b/, 'energy'],
      [/\b(fun|bored|party|dance|entertain|play)\b/, 'fun'],
      [/\b(company|people|friends|social|chat|lonely)\b/, 'social'],
    ];
    const need = needWord.find(([re]) => re.test(p))?.[1];
    if (need === 'energy') {
      const home = homeOf(state, dude);
      if (home) return home;
    }
    if (need) {
      const best = placesOf(state)
        .filter((x) => (x.spec.gives[need] ?? 0) > 0 && (x.kind !== 'home' || x.owner === dude.id))
        .sort((a, b) => (b.spec.gives[need] ?? 0) - (a.spec.gives[need] ?? 0) + (Math.hypot(a.at.x - dude.position.x, a.at.z - dude.position.z) - Math.hypot(b.at.x - dude.position.x, b.at.z - dude.position.z)) * 0.3)[0];
      if (best) return best;
      return `nothing in town does that yet${need === 'energy' ? '; build yourself a home' : ''}`;
    }
    return named ?? `there is no place called "${phrase}" in town`;
  }

  /** Run one action; returns a line for the agent's next turn when something did not go as asked. */
  function act(state: DudesState, dude: Dude, action: AgentAction, now: number, rng: () => number, asked?: string): string | undefined {
    const mine = state.objects.filter((o) => o.owner === dude.id);
    // A shape in the mist far down the path is not something anyone can walk up to and use yet.
    const visible = state.objects.filter((o) => !o.silhouette);
    const active = state.jobs.filter((j) => j.dudeId === dude.id && isActive(j));
    const busy = active.some((j) => j.status === 'walking' || j.status === 'building');
    if (knockedOut(dude, now)) return `you were knocked out, so you could not ${action.do}`;
    // Anything new the body is asked to do replaces the little errands it was on.
    const errands = ['emote', 'show', 'invite', 'share', 'give', 'contribute', 'propose', 'build', 'edit', 'remove', 'rent'];
    // Building, fixing or editing "a bridge" while the travellers are stuck means the river bridge
    // itself: a shift on it, never a bridge on the chatter's own lot.
    if (bridgeOpen(state) && (action.do === 'build' || action.do === 'edit') && /\bbridge\b/i.test(action.do === 'build' ? action.what : `${action.target} ${action.change}`)) action = { do: 'help' };
    // A shift on the bridge for the stranded travellers isn't cut short or restarted by the agent's own
    // take on it ("help" again, "stop", acting it out, walking "to the bridge"): only small errands alongside.
    if (dude.labour?.site === 'bridge') {
      if (action.do === 'help') return undefined;
      if (!errands.includes(action.do)) return `you are mending the bridge for the travellers (or on your way); that comes first, so you did not ${action.do}`;
    }
    if (!errands.includes(action.do)) {
      dude.explore = undefined;
      dude.meet = undefined;
      dude.bit = undefined;
      if (action.do !== 'follow') dude.follow = undefined;
      leaveVisit(dude);
    }
    const others = () => state.dudes.filter((d) => d.id !== dude.id);
    switch (action.do) {
      case 'explore': {
        if (busy) return 'you were busy building, so you did not wander off';
        endUse(state, dude, now);
        dude.explore = { until: now + 25_000 };
        dude.idleUntil = now + 25_000;
        return undefined;
      }
      case 'greet': {
        // The Mayor is not a character in the town's lists: greeting him is a little bit of its own.
        if (/\bmayor\b/i.test(action.target))
          return startBit(state, dude, { caption: `greets the Mayor`, to: 'the Mayor', steps: [{ pose: action.how === 'hug' ? 'hug' : action.how === 'bow' ? 'bow' : action.how === 'handshake' ? 'handshake' : action.how === 'highfive' ? 'highfive' : 'wave', seconds: 2.5 }] }, now);
        // Anyone about: another chatter, or one of the town's residents.
        const other = matchName(action.target, [...others(), ...cityOf(state).townies], (d) => d.name);
        if (!other) return `there is nobody called "${action.target}" here`;
        if (busy) return `you were busy building, so you did not go over to ${other.name}`;
        endUse(state, dude, now);
        dude.meet = { dudeId: other.id, how: action.how, giveUpAt: now + 30_000 };
        return undefined;
      }
      case 'follow': {
        const other = matchName(action.target, others(), (d) => d.name);
        if (!other) return `there is nobody called "${action.target}" to follow`;
        endUse(state, dude, now);
        dude.follow = { dudeId: other.id, until: now + 60_000 };
        return undefined;
      }
      case 'stop': {
        const was = dude.use?.phase === 'doing' && (dude.use.how === 'drive' || dude.use.how === 'ride') ? state.objects.find((o) => o.id === dude.use!.objectId) : undefined;
        endUse(state, dude, now);
        if (was) {
          pushLine(dude.history, { from: 'world', text: `you parked ${was.blueprint.name} and got out`, at: now }, LIMITS.history);
          pushFeed(state, now, `${dude.name} parked ${was.blueprint.name}`);
        }
        dude.follow = undefined;
        dude.attack = undefined;
        dude.emote = undefined;
        dude.idleUntil = undefined;
        if (dude.walkingFor === 'move') {
          dude.path = [];
          dude.walkingFor = undefined;
        }
        return undefined;
      }
      case 'visit': {
        if (busy) return `you were busy building, so you did not go to ${action.target}`;
        const place = placeFromPhrase(state, dude, action.target, rng);
        if (typeof place === 'string') return place;
        return startVisit(state, dude, place, 'asked', now);
      }
      case 'bit': {
        if (busy) return `you were busy building, so you did not ${action.caption}`;
        const { do: _verb, ...req } = action;
        return startBit(state, dude, req, now);
      }
      case 'play': {
        if (busy) return `you were busy building, so you did not go and ${action.target}`;
        // "the basketball court", or just "hoops" / "swim": the nearest place where that is what you do.
        const words = lower(action.target).split(/\W+/).filter((w) => w.length > 2);
        const playable = placesOf(state)
          .filter((p) => p.spec.visit === 'play')
          .map((p) => ({ p, score: words.filter((w) => lower(`${p.name} ${p.spec.verb} ${p.spec.pose}`).includes(w.replace(/s$/, ''))).length, far: Math.hypot(p.at.x - dude.position.x, p.at.z - dude.position.z) }))
          .filter((x) => x.score > 0)
          .sort((a, b) => b.score - a.score || a.far - b.far);
        const place = playable[0]?.p ?? placeFromPhrase(state, dude, action.target, rng);
        if (typeof place === 'string') return `there is nowhere in town to ${action.target} yet; someone could build one`;
        if (place.spec.visit !== 'play') return `there is nothing to do at ${place.name} but visit it`;
        return startVisit(state, dude, place, 'asked', now);
      }
      case 'work': {
        if (busy) return `you were busy building, so you did not go to work`;
        const place = placeFromPhrase(state, dude, action.target, rng);
        if (typeof place === 'string') return place;
        if (place.kind === 'home' || place.kind === 'decor' || place.kind === 'park') return `there is no work at ${place.name}`;
        return startVisit(state, dude, place, 'work', now);
      }
      case 'invite': {
        const other = matchName(action.target, others(), (d) => d.name);
        if (!other) return `there is nobody called "${action.target}" here`;
        const place = action.to ? placeFromPhrase(state, dude, action.to, rng) : undefined;
        const where = place && typeof place !== 'string' ? place.name : 'hang out';
        tell(state, other, `${dude.name} invited you to ${place && typeof place !== 'string' ? `come to ${where}` : 'hang out'}`, now, true);
        if (place && typeof place !== 'string') {
          const why = startVisit(state, dude, place, 'asked', now);
          if (why) return why;
          if (dude.visit) dude.visit.with = other.name;
        } else dude.meet = { dudeId: other.id, how: 'wave', giveUpAt: now + 30_000 };
        pushFeed(state, now, `${dude.name} invited ${other.name}${place && typeof place !== 'string' ? ` to ${where}` : ''}`);
        return undefined;
      }
      case 'share': {
        const other = matchName(action.target, others(), (d) => d.name);
        if (!other) return `there is nobody called "${action.target}" here`;
        return shareLot(state, dude, other, now);
      }
      case 'rent': {
        if (lotsOf(state, dude).length) return 'you have a lot already; you do not need a flat';
        const named = action.target ? matchName(action.target, state.objects.filter((o) => o.venue === 'apartments'), (o) => o.blueprint.name) : undefined;
        const flat = named ?? findFlat(state, dude);
        if (!flat) return 'there are no flats free in town; someone needs to build apartments';
        dude.rentsAt = flat.id;
        pushFeed(state, now, `${dude.name} rented a flat in ${flat.blueprint.name}`);
        const owner = state.dudes.find((d) => d.id === flat.owner);
        if (owner) tell(state, owner, `${dude.name} rented a flat in your ${flat.blueprint.name}`, now);
        return undefined;
      }
      case 'give': {
        const other = matchName(action.target, others(), (d) => d.name);
        if (!other) return `there is nobody called "${action.target}" here`;
        const amount = Math.min(Math.max(1, Math.floor(action.coins)), coinsOf(dude));
        if (amount <= 0) return 'you have no coins to give';
        dude.coins = coinsOf(dude) - amount;
        other.coins = coinsOf(other) + amount;
        tell(state, other, `${dude.name} gave you §${amount}`, now, true);
        noteTie(state, dude.id, other.id, 'gift', now, amount);
        pushFeed(state, now, `${dude.name} gave ${other.name} §${amount}`);
        return undefined;
      }
      case 'propose':
        return proposeProject(state, dude, action.what, now);
      case 'party': {
        const c = cityOf(state);
        if (c.party && c.party.until > now) return `there is already a party on (${c.party.title})`;
        if (now - (lastParty.get(dude.id) ?? 0) < PARTY_GAP_MS) return 'you threw a party only a few minutes ago; let the town recover first';
        const where = action.at && !/^(the )?(town )?square$/i.test(action.at) ? matchName(action.at, state.objects, (o) => o.blueprint.name) : undefined;
        const at = where ? (where.driven?.at ?? where.position) : { x: 0, z: 0 };
        lastParty.set(dude.id, now);
        throwParty(state, at, `${dude.name.toUpperCase()}'S PARTY ${where ? `AT ${where.blueprint.name.toUpperCase()}` : 'ON THE SQUARE'}`, now, where?.id, dude.name);
        return undefined;
      }
      case 'contribute':
        return contribute(state, dude, action.coins, now);
      case 'help': {
        // The stranded travellers can't wait for a build to finish: the bridge goes first.
        if (busy && !bridgeOpen(state)) return 'you were busy building your own thing, so you did not help';
        return startLabour(state, dude, now);
      }
      case 'show': {
        dude.badgesOpenUntil = now + 15_000;
        return dude.badges?.length ? undefined : 'you have not earned any badges yet; they come from helping with the town\'s community projects';
      }
      case 'attack': {
        if (busy) return `you were busy building, so you did not attack ${action.target}`;
        // The Mayor can be got, cartoon-style: a stumble, never a knockout.
        if (/\bmayor\b/i.test(action.target) && !/'s|’s/.test(action.target))
          return startBit(state, dude, { caption: `takes a swing at the Mayor`, to: 'the Mayor', steps: [{ pose: action.with === 'kick' ? 'kick' : action.with === 'shove' ? 'push' : 'punch', seconds: 1.5 }, { pose: 'laugh', seconds: 2 }] }, now);
        const other = matchName(action.target, state.dudes.filter((d) => d.id !== dude.id), (d) => d.name);
        if (other) {
          startAttack(state, dude, 'dude', other.id, action.with, now);
          noteTie(state, dude.id, other.id, 'hit', now);
          return undefined;
        }
        const npc = matchName(action.target, state.npcs ?? [], (n) => n.name);
        if (npc) {
          startAttack(state, dude, 'npc', npc.id, action.with, now);
          return undefined;
        }
        const build = matchName(action.target, visible, (o) => o.blueprint.name);
        if (build && action.with === 'shove') return startUse(state, dude, build, 'push', undefined, now);
        if (build) {
          startAttack(state, dude, 'object', build.id, action.with, now);
          if (build.owner) noteTie(state, dude.id, build.owner, 'hit', now);
          return undefined;
        }
        if (/^(me|myself|self)$/i.test(action.target.trim()) && action.with === 'bomb') {
          startAttack(state, dude, 'dude', dude.id, 'bomb', now);
          return undefined;
        }
        return `there is nobody and nothing called "${action.target}" here`;
      }
      case 'emote': {
        const hold = action.pose === 'sit' || action.pose === 'lie' || action.pose === 'think';
        dude.emote = { pose: action.pose as Emote, until: now + (hold ? HOLD_MS : action.pose === 'dance' ? 10_000 : 5000) };
        dude.idleUntil = Math.max(dude.idleUntil ?? 0, now + 20_000);
        return undefined;
      }
      case 'move': {
        if (busy) return `you were busy building, so you did not go to ${action.to}`;
        const to = placeOf(state, dude, action.to, rng);
        if (!to) return `there is nothing called "${action.to}" in town`;
        endUse(state, dude, now);
        dude.emote = undefined;
        // Stay where you were sent a while before wandering off again.
        dude.idleUntil = now + 45_000;
        return sendDude(state, dude, to) ? undefined : `you could not find a way to ${action.to}`;
      }
      case 'build': {
        if (active.length >= LIMITS.jobsPerDude) return `you already have ${active.length} things on the go; they will finish soon`;
        if (state.objects.length + state.jobs.filter((j) => j.kind === 'build' && isActive(j)).length >= LIMITS.objects)
          return 'the town is full; nothing new can go up until someone removes something';
        const venue = action.kind ?? venueKindOf(action.what);
        // A repeat: the agent asked again for what an earlier message already got (it read that message
        // in its history on the next turn). Same character, same sort of thing, a few minutes apart,
        // and nothing this turn asking for another one.
        const words = contentWords(action.what);
        const recent = (recentBuilds.get(dude.id) ?? []).filter((r) => now - r.at < REPEAT_MS);
        const repeat = !AGAIN.test(asked ?? '') && recent.find((r) => r.asked !== asked && (overlap(words, r.words) >= 0.35 || (r.venue === venue && venue !== 'decor' && overlap(words, r.words) >= 0.15)));
        if (repeat) return `you did not build ${action.what.slice(0, 50)} again: you already started it for "${(repeat.asked ?? 'an earlier message').slice(0, 60)}"`;
        const lot = lotForBuild(state, dude, action.near);
        if (typeof lot === 'string') return lot;
        // Where on the lot: the middle of the biggest space left (toward the back, the block's middle,
        // leaving the front to the street), marked out as the site while it is designed.
        const space = freeSpotOn(state, lot);
        const site = Math.max(3, Math.min(8, space.side));
        const job: Job = { id: nextId(state, 'j'), dudeId: dude.id, kind: 'build', request: action.what.slice(0, 300), anchor: space.at, status: 'queued', createdAt: now, plot: lot.id, venue, site, ...(asked ? { asked } : {}) };
        state.jobs.push(job);
        recentBuilds.set(dude.id, [...recent, { words, venue, asked, at: now }].slice(-6));
        pushFeed(state, now, `${dude.name} is designing ${venue === 'decor' ? '' : `a ${VENUES[venue].label}: `}${action.what.slice(0, 60)}`);
        // Building on someone else's lot: they hear about it.
        const lotOwner = ownerOfLot(state, lot.id);
        if (lotOwner && lotOwner.id !== dude.id) tell(state, lotOwner, `${dude.name} is building ${action.what.slice(0, 60)} on your lot at ${lot.address}`, now);
        return undefined;
      }
      case 'use': {
        if (busy) return `you were busy building, so you did not ${action.how} ${action.target}`;
        const target = matchName(action.target, visible, (o) => o.blueprint.name);
        if (!target) return `there is no build called "${action.target}" in town`;
        if (target.civic && (action.how === 'drive' || action.how === 'ride' || action.how === 'push')) return `${target.blueprint.name} belongs to the town and stays put`;
        // Going inside a place is a visit: it costs what it costs and does what it does.
        const asPlace = target.venue && (action.how === 'enter' || action.how === 'sit') && target.venue !== 'decor' ? placeById(state, target.id) : undefined;
        if (asPlace) return startVisit(state, dude, asPlace, 'asked', now);
        // Driving "to" a person means at them, not politely beside them: that is how people get run over.
        const victim = action.to && (action.how === 'drive' || action.how === 'ride') ? matchName(action.to, state.dudes.filter((d) => d.id !== dude.id), (d) => d.name) : undefined;
        const to = victim ? { ...victim.position } : action.to ? placeOf(state, dude, action.to, rng) : undefined;
        if (action.to && !to) return `there is nothing called "${action.to}" to ${action.how} to`;
        return startUse(state, dude, target, action.how, to, now);
      }
      case 'edit':
      case 'remove': {
        const target = matchName(action.target, mine, (o) => o.blueprint.name);
        if (!target) {
          const theirs = matchName(action.target, state.objects, (o) => o.blueprint.name);
          return theirs ? `${theirs.blueprint.name} is ${theirs.createdBy}'s, not yours; you can only change your own builds` : `you have no build called "${action.target}"`;
        }
        if (active.some((j) => j.targetId === target.id)) return `you are already working on ${target.blueprint.name}`;
        const user = inUse(state, target.id);
        if (user) return `${user.name} is using ${target.blueprint.name} right now; try again when they are done`;
        if (active.length >= LIMITS.jobsPerDude) return `you already have ${active.length} things on; finish those first`;
        const job: Job =
          action.do === 'edit'
            ? { id: nextId(state, 'j'), dudeId: dude.id, kind: 'edit', request: action.change.slice(0, 300), targetId: target.id, anchor: target.position, status: 'queued', createdAt: now, ...(asked ? { asked } : {}) }
            : { id: nextId(state, 'j'), dudeId: dude.id, kind: 'remove', request: `take down ${target.blueprint.name}`.slice(0, 300), targetId: target.id, anchor: target.position, status: 'ready', createdAt: now };
        state.jobs.push(job);
        return undefined;
      }
    }
  }

  // ---- design calls ---------------------------------------------------------------------------
  function pumpDesigns(ctx: WorldCtx<DudesState>): void {
    const state = ctx.state;
    // The town's project first: everyone is waiting to see it.
    const project = projectOf(state);
    if (project?.status === 'designing' && !designCalls.has(`project:${project.id}`) && designCalls.size < opts.designLimit && canCall(state, 'design') && reserveCall(state, 'design')) designProject(ctx, project.id);
    while (designCalls.size < opts.designLimit && canCall(state, 'design')) {
      const designing = new Set(state.jobs.filter((j) => j.status === 'designing').map((j) => j.dudeId));
      // One design per dude at a time, oldest request first: a dude asking for five things does not starve the field.
      // Chat's requests go before players' (on /play), and players never hold every design slot.
      const playersDesigning = [...designing].filter((id) => isPiloted(id)).length;
      const waiting = state.jobs.filter((j) => j.status === 'queued' && !designing.has(j.dudeId)).sort((a, b) => Number(isPiloted(a.dudeId)) - Number(isPiloted(b.dudeId)) || a.createdAt - b.createdAt);
      const job = waiting.find((j) => !isPiloted(j.dudeId) || opts.designLimit < 2 || playersDesigning < opts.designLimit - 1);
      if (!job && waiting.length) return; // only players' are waiting, and they have their share of the slots
      // Nothing anyone asked for is waiting: remake one older build for the town's age.
      if (!job) return void (designing.has('town') ? undefined : nextRestyle(ctx, state));
      if (!reserveCall(state, 'design')) return;
      startDesign(ctx, state, job);
    }
  }

  /**
   * The town's age moved on: its older builds are remade for it, one design at a time and only when no
   * chatter's or the Mayor's design is waiting. Each keeps what it is, its size and its owner; it swaps
   * in where it stands (tickMayorBuilds commits the town's jobs too).
   */
  function nextRestyle(ctx: WorldCtx<DudesState>, state: DudesState): void {
    const c = cityOf(state);
    const age = ageOf(state);
    // The theme-free sandbox: everything stays as it was made.
    if (!themed(state)) return;
    if (!c.restyle || c.restyle.age !== age) {
      if (!state.objects.some((o) => !o.wild && !o.civic && originOf(o) !== age)) return;
      queueRestyles(state);
    }
    const q = c.restyle!;
    while (q.ids.length) {
      const target = state.objects.find((o) => o.id === q.ids[0]);
      q.ids.shift();
      if (!target || target.civic || originOf(target) === age || state.jobs.some((j) => j.targetId === target.id && isActive(j))) continue;
      // A remake waits while the budget is low, so chat's own builds always have room.
      if (!canCall(state, 'design', Math.floor(capacityOf(perHourOf(state.ai, 'design', budget)) / 3)) || !reserveCall(state, 'design')) return void q.ids.unshift(target.id);
      const job: Job = {
        id: nextId(state, 'j'),
        dudeId: 'town',
        kind: 'edit',
        restyle: age,
        // The instructions first and the old description last, so the 300-character cut only ever trims the description.
        request: `Remake "${target.blueprint.name.slice(0, 60)}" for ${ageStyle(age).name}: same thing, purpose, size and layout, so it is recognisably the same place, rebuilt in this age's materials, roof, details and colours (see "age"). It was: ${target.blueprint.description}`.slice(0, 300),
        targetId: target.id,
        anchor: { ...target.position },
        status: 'queued',
        createdAt: ctx.now,
        ...(target.plot ? { plot: target.plot } : {}),
      };
      state.jobs.push(job);
      startDesign(ctx, state, job);
      return;
    }
  }

  function startDesign(ctx: WorldCtx<DudesState>, state: DudesState, job: Job): void {
    // The Mayor's builds have no character behind them: the town's own designer, in his name.
    const dude = state.dudes.find((d) => d.id === job.dudeId) ?? (job.dudeId === 'mayor' ? MAYOR_BUILDER : job.dudeId === 'town' ? TOWN_BUILDER : undefined);
    const target = job.targetId ? state.objects.find((o) => o.id === job.targetId) : undefined;
    if (!dude || (job.kind === 'edit' && !target)) {
      job.status = 'failed';
      return;
    }
    job.status = 'designing';
    const ac = new AbortController();
    designCalls.set(job.id, ac);
    opts
      .design(
        {
          dudeName: dude.name,
          persona: dude.persona,
          request: job.request,
          ...(job.asked ? { asked: job.asked } : {}),
          ...(target ? { target: state.vandalised?.[target.id]?.original ?? target.blueprint } : {}),
          // The room actually left on the lot, and what is there already.
          ...(job.plot && plotById(job.plot) && job.kind === 'build' ? { lot: Math.max(3, Math.floor(freeSpaceOn(state, plotById(job.plot)!, job.id))), lotHas: onLot(state, plotById(job.plot)!) } : job.plot ? { lot: plotById(job.plot)?.civic ? SQUARE.site : CITY.plot } : {}),
          ...((job.venue ?? target?.venue) ? { kind: kindFor(namingAge(state), (job.venue ?? target?.venue)!) } : {}),
          age: designDirection(state),
        },
        ac.signal,
      )
      .then((result) => {
        if (ctx.state !== state || job.status !== 'designing') return;
        const d = state.dudes.find((x) => x.id === job.dudeId);
        if (result.action === 'decline') {
          job.status = 'failed';
          listen(state, 'refused', d?.name ?? '?', `design declined "${job.request.slice(0, 80)}": ${result.reply}`, ctx.now);
          if (d) failedBuild(state, d, `the designer turned down "${job.request.slice(0, 60)}": ${result.reply}`, `${d.name}'s ${job.request.slice(0, 40)} was turned down`, ctx.now);
          else pushFeed(state, ctx.now, `the Mayor's ${job.request.slice(0, 40)} was turned down: ${result.reply.slice(0, 80)}`);
          return;
        }
        job.blueprint = result.blueprint;
        job.reply = result.reply;
        // A remake for the new age keeps the build's size: fitted back into the room it had.
        const was = job.restyle !== undefined ? state.objects.find((o) => o.id === job.targetId) : undefined;
        if (was) job.blueprint = fitBlueprint(job.blueprint, { width: was.footprint.width + 0.4, depth: was.footprint.depth + 0.4, height: 22 }).blueprint;
        try {
          placeJob(state, job);
          job.status = 'ready';
        } catch (e) {
          job.status = 'failed';
          if (d) {
            d.lastError = (e as Error).message;
            failedBuild(state, d, `${result.blueprint.name} could not go up: ${(e as Error).message}`, `${d.name}'s ${result.blueprint.name} didn't fit on their lot`, ctx.now);
          } else pushFeed(state, ctx.now, `the Mayor's ${result.blueprint.name} didn't fit there`);
        }
      })
      .catch((e: Error) => {
        if (ctx.state !== state || ac.signal.aborted) return;
        job.status = 'failed';
        job.error = e.message.slice(0, 300);
        const d = state.dudes.find((x) => x.id === job.dudeId);
        if (d) {
          d.lastError = `design: ${e.message}`.slice(0, 300);
          failedBuild(state, d, `designing "${job.request.slice(0, 60)}" failed; your chatter can ask again`, `${d.name}'s ${job.request.slice(0, 40)} couldn't be designed`, ctx.now);
        } else if (job.dudeId === 'mayor') pushFeed(state, ctx.now, `the Mayor's ${job.request.slice(0, 40)} couldn't be designed`);
        ctx.log(`design for ${dude.name} failed: ${e.message}`, 'warn');
      })
      .finally(() => {
        if (designCalls.get(job.id) === ac) designCalls.delete(job.id);
        if (ctx.state === state) pump(ctx);
      })
      .catch((e: Error) => ctx.log(`design for ${dude.name} errored: ${e.message}`, 'alert'));
  }

  /**
   * A build that will not happen: in the feed, so the stream sees it, and told to the character's
   * agent as something that happened to it, so it says so in its own words.
   */
  function failedBuild(state: DudesState, d: Dude, why: string, feed: string, now: number): void {
    pushFeed(state, now, feed);
    tell(state, d, why, now, true);
  }

  /** The town's community project, designed once from the proposal, as big as its lot on the square allows. */
  function designProject(ctx: WorldCtx<DudesState>, id: string): void {
    const state = ctx.state;
    const project = projectOf(state)!;
    const proposer = state.dudes.find((d) => d.id === project.by);
    const key = `project:${id}`;
    const ac = new AbortController();
    designCalls.set(key, ac);
    opts
      .design(
        {
          dudeName: proposer?.name ?? 'the town',
          persona: project.wonder !== undefined ? 'The Wonder of the age, raised by the whole town for the travelling caravan: the landmark everyone remembers the age by.' : `A public building for the whole town, proposed by ${proposer?.name ?? 'a resident'}: ${(proposer?.persona ?? '').slice(0, 160)}`,
          request:
            project.wonder !== undefined
              ? `${project.what}. The age's Wonder in the middle of the town square: tall, proud and seen from everywhere, about ${WONDER.size} m across and up to ${WONDER.height} m high.`
              : `${project.what}. A community project for the town square: a proud public landmark everyone can use, filling a ${SQUARE.site} m × ${SQUARE.site} m lot.`,
          lot: project.wonder !== undefined ? WONDER.size : SQUARE.site,
          kind: project.wonder !== undefined ? 'wonder' : 'community project',
          age: designDirection(state),
        },
        ac.signal,
      )
      .then((result) => {
        if (ctx.state !== state) return;
        projectDesigned(state, result.action === 'decline' ? undefined : result.blueprint, ctx.now, result.action === 'decline' ? result.reply : undefined);
      })
      .catch((e: Error) => {
        if (ctx.state !== state || ac.signal.aborted) return;
        projectDesigned(state, undefined, ctx.now, 'the designer could not draw it up');
        ctx.log(`project design failed: ${e.message}`, 'warn');
      })
      .finally(() => {
        if (designCalls.get(key) === ac) designCalls.delete(key);
      })
      .catch((e: Error) => ctx.log(`project design errored: ${e.message}`, 'alert'));
  }

  // ---- the Listener ----------------------------------------------------------------------------
  let listening: AbortController | undefined;
  const listenerFn = opts.listener ?? fixtureListener;
  function runListener(ctx: WorldCtx<DudesState>, force = false): string | undefined {
    const state = ctx.state,
      now = ctx.now,
      l = listenerOf(state);
    if (listening) return 'already reading';
    if (!force && !due(l, now)) return 'nothing new to read yet';
    if (!l.buffer.length) return 'nothing new to read yet';
    if (!canCall(state) || !reserveCall(state)) return 'AI is paused or out of calls';
    const ac = new AbortController();
    listening = ac;
    const reading = l.buffer.length;
    // Lines that arrive while it reads stay for the next reading.
    const input = listenerInput(l);
    const taken = l.buffer;
    l.buffer = [];
    listenerFn(input, ac.signal)
      .then((raw) => {
        if (ctx.state !== state) return;
        applyReading(l, raw, ctx.now);
        ctx.log(`listener read ${reading} lines: ${l.wishes.length} wishes, ${l.tips.length} tips`);
        try {
          opts.writeWishes?.(wishesMarkdown(l, ctx.now));
        } catch (e) {
          ctx.log(`could not write wishes.md: ${(e as Error).message}`, 'warn');
        }
      })
      .catch((e: Error) => {
        if (ctx.state !== state || ac.signal.aborted) return;
        l.lastError = e.message.slice(0, 300);
        l.lastRunAt = ctx.now; // back off as if it had run
        l.buffer = [...taken, ...l.buffer].slice(-150); // and keep what it was given for the next try
        ctx.log(`listener failed: ${e.message}`, 'warn');
      })
      .finally(() => {
        if (listening === ac) listening = undefined;
      })
      .catch((e: Error) => ctx.log(`listener errored: ${e.message}`, 'alert'));
    return undefined;
  }

  /** When chat is quiet, one character at a time takes a turn of its own, so the field is never silent for long. */
  function idleLife(ctx: WorldCtx<DudesState>): void {
    const state = ctx.state,
      now = ctx.now;
    if (state.ai.idleLife === false || !canCall(state) || now < nextIdleAt || gathering(state)) return;
    nextIdleAt = now + IDLE_TURN_MS * (0.75 + ctx.rng() * 0.5);
    const quiet = state.dudes.filter(
      (d) =>
        awake(d, now) && !d.muted && !d.hidden && !d.inbox.length && !d.nudges?.length && !agentCalls.has(d.id) && !isPiloted(d.id) &&
        now - d.lastHeardAt > 60_000 && now - d.lastTurnAt > 3 * 60_000 && d.turns > 0,
    );
    if (!quiet.length) return;
    const d = quiet[Math.floor(ctx.rng() * quiet.length)];
    // Something concrete to react to (a new build next door, a rival, an open ask, a need, someone near).
    d.nudges = [idleHook(state, d, now, ctx.rng).slice(0, 240)];
    pump(ctx);
  }

  // ---- arriving chat --------------------------------------------------------------------------
  function dudeFor(ctx: WorldCtx<DudesState>, userId: string, username: string, now: number): Dude | undefined {
    const state = ctx.state;
    let dude = state.dudes.find((d) => d.id === userId);
    if (dude) return dude;
    if (state.dudes.length >= LIMITS.dudes) {
      // Make room with the longest-quiet dude that has nothing standing and nothing in flight.
      const spare = state.dudes
        .filter((d) => !state.objects.some((o) => o.owner === d.id) && !state.jobs.some((j) => j.dudeId === d.id) && !agentCalls.has(d.id))
        .sort((a, b) => a.lastHeardAt - b.lastHeardAt)[0];
      if (!spare) return undefined;
      state.dudes.splice(state.dudes.indexOf(spare), 1);
    }
    const name = username.slice(0, 40);
    dude = {
      id: userId,
      name,
      createdAt: now,
      lastHeardAt: now,
      lastTurnAt: 0,
      turns: 0,
      persona: '',
      look: defaultLook(name),
      memory: [],
      history: [],
      inbox: [],
      overheard: [],
      position: spawnPoint(state.objects, state.dudes.map((d) => d.position), ctx.rng, BUS_STOP),
      facing: Math.PI,
      path: [],
      coins: TOWN.startCoins,
      needs: freshNeeds(ctx.rng),
    };
    state.dudes.push(dude);
    // Off the bus and over to their new lot, or into a flat when the town is full.
    const lot = claimLot(state, dude, now);
    if (lot) {
      pushFeed(state, now, `${name} moved into ${lot.address}`);
      pushLine(dude.history, { from: 'world', text: `you just arrived in ${cityOf(state).name} and got a lot of your own at ${lot.address}; it is empty`, at: now }, LIMITS.history);
      sendDude(state, dude, lot.centre);
      dude.idleUntil = now + 30_000;
    } else {
      const flat = findFlat(state, dude);
      if (flat) dude.rentsAt = flat.id;
      pushFeed(state, now, flat ? `${name} arrived and took a flat in ${flat.blueprint.name}` : `${name} arrived; no lot is free today, so they can build on any lot with room`);
      pushLine(
        dude.history,
        {
          from: 'world',
          text: flat
            ? `you arrived in ${cityOf(state).name}; every lot was taken, so you rent a flat in ${flat.blueprint.name}`
            : `you arrived in ${cityOf(state).name}; every lot is taken for now (one frees up when its owner has been gone ${TOWN.reclaimDays} days and left it empty). You can still build on any lot with room if you say where, ask someone to share theirs, or rent a flat once someone builds apartments`,
          at: now,
        },
        LIMITS.history,
      );
    }
    return dude;
  }

  /**
   * A near-duplicate of a line still waiting for the agent, or of one said a moment ago, is not queued again
   * (a spammer's tenth "hi" in a busy chat). A repeat after the agent has answered goes through: it's a retry.
   */
  const lastLine = new Map<string, { text: string; at: number }>();
  const normLine = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .replace(/(.)\1{2,}/g, '$1$1')
      .replace(/\s+/g, ' ')
      .trim();
  function sameLine(a: string, b: string): boolean {
    const na = normLine(a),
      nb = normLine(b);
    if (!na || !nb) return false;
    if (na === nb) return true;
    const wa = contentWords(a),
      wb = contentWords(b);
    return wa.size >= 2 && wb.size >= 2 && overlap(wa, wb) >= 0.8;
  }
  function repeatOf(dude: Dude, text: string, now: number): boolean {
    const prev = lastLine.get(dude.id);
    lastLine.set(dude.id, { text, at: now });
    if (lastLine.size > 2000) lastLine.delete(lastLine.keys().next().value!);
    return dude.inbox.some((l) => l.from === 'chatter' && sameLine(l.text, text)) || (!!prev && now - prev.at < 8000 && sameLine(prev.text, text));
  }

  /** A chatter's line on its way to their character's agent (said at `at`): the bridge first, then the inbox. */
  function toAgent(state: DudesState, dude: Dude, clean: string, at: number, now: number): void {
    // "Help at the bridge", "fix the bridge", "build the bridge": while the travellers are stuck, the
    // character sets off at once, without waiting on its agent (or building a bridge of its own).
    if (bridgeOpen(state) && /\bbridge\b/i.test(clean) && !/\b(don'?t|do not|never|stop)\b/i.test(clean)) {
      const why = startLabour(state, dude, now);
      if (!why) pushLine(dude.history, { from: 'world', text: 'you set off to help mend the bridge for the travellers', at: now }, LIMITS.history);
    }
    // What the agent reads: emotes by name ("lol KEKW"). A player walking their own character is the
    // character: what they say in chat is just said.
    const words = emoteNames(clean);
    if (isPiloted(dude.id)) pushLine(dude.history, { from: 'chatter', text: words, at }, LIMITS.history);
    else pushLine(dude.inbox, { from: 'chatter', text: words, at }, LIMITS.inbox);
    // Out on an errand of their own (inside the café, napping at home): their chatter speaking
    // brings them straight out, so the bubble is seen and the body is free for whatever comes next.
    if (dude.visit && (dude.visit.why === 'need' || dude.visit.why === 'party')) leaveVisit(dude);
  }

  /**
   * Gather mode's queued moves and builds (FK-018), after the release: one chatter's line at a time
   * goes to their agent, at least 2 s apart (story/gather.ts takeQueued), and only while an agent is
   * free to take it at once, so the turns start apart too.
   */
  function replayQueued(ctx: WorldCtx<DudesState>): void {
    if (agentCalls.size >= opts.agentLimit) return;
    const q = takeQueued(ctx.state, ctx.now);
    if (!q || q.dude.muted) return;
    const { dude, text, at } = q;
    toAgent(ctx.state, dude, text, at, ctx.now);
    ctx.log(`story: ${dude.name}'s line from the gathering goes on, after the release: "${emoteNames(text).slice(0, 60)}"`);
    // Its turn starts now rather than after the turn gap: the gap between replays is what spaces them.
    if (!isPiloted(dude.id) && !agentCalls.has(dude.id) && canCall(ctx.state) && reserveCall(ctx.state)) startTurn(ctx, ctx.state, dude, ctx.now);
  }

  function hear(ctx: WorldCtx<DudesState>, userId: string, username: string, text: string): void {
    const c = ctxOf(ctx);
    const now = c.now;
    // Someone new: an emote on its own doesn't move anyone in, and nor does a command (the crier
    // answers its own; "!discord" and the like are for some other bot).
    if (!c.state.dudes.some((d) => d.id === userId)) {
      const first = text.trim();
      if (emoteOnly(first)) return;
      if (/^![\w]/.test(first)) {
        const cmd = crierCommand(c.state, userId, first, now);
        if (cmd.line) c.announce?.(cmd.line);
        return;
      }
    }
    const dude = dudeFor(c, userId, username, now);
    if (!dude) return c.log(`no room for ${username}'s dude (the field holds ${LIMITS.dudes})`, 'warn');
    dude.name = username.slice(0, 40);
    const returning = !awake(dude, now) && dude.turns > 0;
    dude.lastHeardAt = now;
    // Back after a while: what happened to their places goes to their agent to react to.
    if (returning) {
      // Their empty lot went to a newcomer while they were gone: a free one now, if there is one.
      if (!lotsOf(c.state, dude).length && !dude.rentsAt) {
        const lot = claimLot(c.state, dude, now);
        if (lot) pushLine(dude.history, { from: 'world', text: `you are back, and you got a lot of your own at ${lot.address}`, at: now }, LIMITS.history);
      }
      const news = welcomeBack(c.state, dude, now);
      if (news) {
        dude.nudges ??= [];
        dude.nudges.push(news.slice(0, 240));
        pushLine(dude.history, { from: 'world', text: news, at: now }, LIMITS.history);
      }
    }
    if (dude.muted) return;
    const clean = text.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300);
    if (!clean) return;
    // !top, !town, !me: the Town Crier answers in chat; the character doesn't hear it.
    const cmd = crierCommand(c.state, dude.id, clean, now);
    if (cmd.handled) {
      if (cmd.line) c.announce?.(cmd.line);
      return;
    }
    // Any other "!word" is a command for some other bot: not speech, and nothing for the agent.
    if (/^![\w]/.test(clean) && !isCrierCommand(clean)) return;
    // Emotes only: the bubble shows them, and that's all (no agent turn for a KEKW).
    if (emoteOnly(clean)) {
      const said = sayable(clean);
      if (said) dude.say = { text: said, until: now + sayMs(said) };
      return;
    }
    // Gather mode (FK-018): while a scene or a gathering runs, the line is a bubble and maybe a vote;
    // a move or build waits for the release. Nothing reaches the agent, nobody overhears it, and nobody
    // is called out of a party for it.
    if (gathering(c.state)) {
      const said = sayable(clean);
      if (said) dude.say = { text: said, until: now + sayMs(emoteNames(said)) };
      if (!hearInGather(c.state, dude, clean, now)) listen(c.state, 'chat', dude.name, clean, now);
      return;
    }
    // What the agent reads: emotes by name ("lol KEKW"); the bubble keeps the pictures.
    const words = emoteNames(clean);
    // The same line again (or nearly): the bubble stays up a little longer, but the agent isn't asked twice.
    if (repeatOf(dude, words, now)) {
      const said = sayable(clean);
      if (said) dude.say = { text: said, until: now + sayMs(emoteNames(said)) };
      return;
    }
    toAgent(c.state, dude, clean, now, now);
    // The character says it: the chatter's own words, in the bubble straight away, while its agent
    // works out what the body does about them.
    const said = sayable(clean);
    if (said) {
      dude.say = { text: said, until: now + sayMs(emoteNames(said)) };
      overhear(c.state, dude, emoteNames(said), now);
      // Said to someone near by name (or answering someone who spoke to them): they answer on a turn of their own.
      spokeTo(c.state, dude, emoteNames(said), now, true);
    }
    listen(c.state, 'chat', dude.name, clean, now);
    pump(c);
  }

  // ---- players: chatters walking their own character from the /play page ---------------------
  const players: NonNullable<WorldModule<DudesState>['players']> = {
    join(ctx, userId, name) {
      const c = ctxOf(ctx);
      const now = c.now;
      // Muted by the Mayor (/admin): not on stream through the website either.
      if (c.state.dudes.find((d) => d.id === userId)?.muted) return 'The Mayor has muted you in town for now, so you cannot walk about in person either.';
      const dude = dudeFor(c, userId, name, now);
      if (!dude) return `the town is full (${LIMITS.dudes} characters) and nobody can make room`;
      dude.name = name.slice(0, 40);
      const returning = !awake(dude, now) && dude.turns > 0;
      dude.lastHeardAt = now;
      if (returning) {
        const news = welcomeBack(c.state, dude, now);
        if (news) pushLine(dude.history, { from: 'world', text: news, at: now }, LIMITS.history);
      }
      // Their agent stops whatever it was having the body do; the player has it now.
      agentCalls.get(dude.id)?.abort();
      agentCalls.delete(dude.id);
      endUse(c.state, dude, now);
      leaveVisit(dude);
      Object.assign(dude, { path: [], walkingFor: undefined, explore: undefined, follow: undefined, meet: undefined, greet: undefined, lookAt: undefined, bit: undefined, hidden: undefined, y: undefined });
      pilot(dude.id, dude.name, dude.position, now);
      pushFeed(c.state, now, `${dude.name} is walking about in person`);
      pushLine(dude.history, { from: 'world', text: 'your chatter is walking you round town themselves now (logged in on the website); you only act when they leave again', at: now }, LIMITS.history);
      return { id: dude.id, position: { ...dude.position }, facing: dude.facing };
    },
    leave(ctx, userId) {
      const c = ctxOf(ctx);
      if (!pilots.delete(userId)) return;
      const dude = c.state.dudes.find((d) => d.id === userId);
      if (!dude) return;
      if (dude.riding && !dude.use) getOff(c.state, dude);
      dude.idleUntil = c.now + 20_000;
      pushLine(dude.history, { from: 'world', text: 'your chatter stopped walking you about; you are yourself again', at: c.now }, LIMITS.history);
    },
    input(ctx, userId, raw) {
      const c = ctxOf(ctx);
      const state = c.state,
        now = c.now;
      const p = pilots.get(userId);
      const dude = state.dudes.find((d) => d.id === userId);
      const msg = raw as { t?: string; [k: string]: unknown };
      if (!p || !dude || !msg || typeof msg !== 'object') return undefined;
      // The page's heartbeat (a move standing still) is not someone at the keys.
      if (msg.t !== 'move' || msg.moving) {
        p.lastInputAt = now;
        dude.lastHeardAt = now;
      }
      const clean = (v: unknown, max: number) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
      switch (msg.t) {
        case 'move': {
          const [x, z, facing] = [Number(msg.x), Number(msg.z), Number(msg.facing)];
          if (![x, z, facing].every(Number.isFinite)) return undefined;
          if (knockedOut(dude, now)) {
            // Flat on their back: the page is told once (it stops walking and sees stars), and waits it out.
            if (p.koTold === dude.ko!.until) return undefined;
            p.koTold = dude.ko!.until;
            return { reply: { t: 'ko', ms: dude.ko!.until - now, position: { ...dude.position }, facing: dude.facing } };
          }
          const at = stampOf(p, msg.at, now);
          const ride = dude.riding && !dude.use ? state.objects.find((o) => o.id === dude.riding) : undefined;
          const from = p.last ?? dude.position;
          const step = clampToGround(allowedStep(p, { x, z }, at, ride ? 21 : PLAYER.run), 0.5);
          // Builds are solid here too (over the top of them in something that flies).
          const to = ride && flies(ride) && altitudeOf(ride) > 1 ? step : solidStep(state.objects, from, step, ride?.id);
          stepped(p, at, to);
          p.last = { at, x: to.x, z: to.z };
          p.moving = !!msg.moving;
          p.running = !!msg.running;
          dude.position = to;
          dude.facing = facing;
          dude.path = [];
          if (p.moving) {
            if (dude.emote) dude.emote = undefined;
            if (dude.use) endUse(state, dude, now);
            if (dude.visit || dude.labour) leaveVisit(dude);
          }
          if (ride) {
            // Steering what they are aboard: it goes where they are, as high as they say (a flyer).
            ride.driven = { at: { ...to }, turn: facing, by: dude.name, until: Number.MAX_SAFE_INTEGER };
            if (flies(ride) && Number.isFinite(Number(msg.alt))) setAltitude(ride, Number(msg.alt));
            dude.y = rideInfo(ride).seat + altitudeOf(ride);
            if (p.moving) runOver(state, dude, to, now, ride);
          }
          return { broadcast: { t: 'dude', serverTime: at, dude: { id: dude.id, position: to, facing, moving: p.moving, ...(p.running ? { running: true } : {}), ...(ride ? { ride: { id: ride.id, y: dude.y ?? 0, altitude: altitudeOf(ride) } } : {}) } } };
        }
        case 'ride': {
          if (knockedOut(dude, now)) return undefined;
          if (dude.riding && !dude.use) {
            getOff(state, dude);
            return { reply: { t: 'ride', position: { ...dude.position }, facing: dude.facing }, note: 'You got off.' };
          }
          const o = state.objects
            .filter((x) => rideable(x) && !x.civic && !ruined(x) && !inUse(state, x.id, dude.id) && state.mayor?.riding !== x.id)
            .map((x) => ({ x, d: Math.hypot((x.driven?.at ?? x.position).x - dude.position.x, (x.driven?.at ?? x.position).z - dude.position.z) - Math.max(x.footprint.width, x.footprint.depth) / 2 }))
            .filter((c) => c.d < 4)
            .sort((a, b) => a.d - b.d)[0]?.x;
          if (!o) return { note: 'Nothing to ride or drive right here. Walk up to a car, an animal or anything that moves.' };
          if (dude.use) endUse(state, dude, now);
          const at = { ...(o.driven?.at ?? o.position) };
          dude.riding = o.id;
          dude.position = at;
          dude.facing = o.driven?.turn ?? o.creature?.facing ?? dude.facing;
          dude.emote = undefined;
          o.driven = { at, turn: dude.facing, by: dude.name, until: Number.MAX_SAFE_INTEGER };
          if (o.creature) o.creature.path = [];
          const info = rideInfo(o);
          dude.y = info.seat + info.altitude;
          p.last = { at: now, x: at.x, z: at.z };
          p.trail = [];
          p.travel = 0;
          pushFeed(state, now, `${dude.name} took ${o.blueprint.name}${o.createdBy !== dude.name ? ` (${o.createdBy}'s)` : ''}`);
          return { reply: { t: 'ride', ride: info, position: at, facing: dude.facing }, note: `Aboard ${o.blueprint.name}.${info.gun ? ' Click or press Space to fire its gun.' : ''} R to get off.` };
        }
        case 'arm': {
          p.armed = (WEAPONS as readonly string[]).includes(String(msg.weapon)) ? (msg.weapon as Weapon) : undefined;
          return undefined;
        }
        case 'fire': {
          if (knockedOut(dude, now) || dude.hidden) return undefined;
          const vehicle = dude.riding && !dude.use ? state.objects.find((o) => o.id === dude.riding) : undefined;
          const gun = vehicle && armedBuild(vehicle) ? 'cannon' : p.armed;
          if (!gun) return undefined;
          const raw = msg.aim as { x?: unknown; z?: unknown } | undefined;
          const aim = raw && Number.isFinite(Number(raw.x)) && Number.isFinite(Number(raw.z)) ? { x: Number(raw.x), z: Number(raw.z) } : undefined;
          if (!fire(state, { id: dude.id, name: dude.name, position: dude.position, facing: dude.facing, dude, vehicle }, gun, aim, now)) return undefined;
          if (!vehicle) dude.emote = { pose: 'point', until: now + 500 };
          return undefined;
        }
        case 'ram': {
          const vehicle = dude.riding && !dude.use ? state.objects.find((o) => o.id === dude.riding) : undefined;
          if (!vehicle) return undefined;
          // How fast it really hit: what the server saw, never more than the page says.
          const speed = Math.min(trailSpeed(p, now), Number(msg.speed) || 0);
          if (ram(state, { id: dude.id, name: dude.name, position: dude.position, facing: dude.facing, dude, vehicle }, String(msg.target ?? ''), speed, now, p.travel ?? 0)) p.travel = 0;
          return undefined;
        }
        case 'say': {
          if (dude.muted) return { note: 'The Mayor has muted you for now.' };
          const text = sayable(clean(msg.text, LIMITS.say));
          if (!text || now < p.sayAt) return undefined;
          p.sayAt = now + PLAYER.sayGapMs;
          const cmd = crierCommand(state, dude.id, text, now);
          if (cmd.handled) {
            if (cmd.line) c.announce?.(cmd.line);
            return cmd.line ? { note: cmd.line } : undefined;
          }
          dude.say = { text, until: now + sayMs(text) };
          pushLine(dude.history, { from: 'chatter', text, at: now }, LIMITS.history);
          // Gather mode (FK-018): a bubble and maybe a vote. Nobody overhears it or is nudged, and it stays off the feed.
          if (gathering(state)) {
            if (!hearInGather(state, dude, text, now, false)) listen(state, 'chat', dude.name, text, now);
            return undefined;
          }
          overhear(state, dude, text, now);
          listen(state, 'chat', dude.name, text, now);
          pushFeed(state, now, `${dude.name}: ${text}`);
          // Anyone named, wherever they are, is told: their agent answers on a turn of its own.
          for (const word of text.split(/[\s,.!?]+/).filter((w) => w.length > 2)) {
            const bare = word.replace(/^@/, '');
            const d = matchName(bare, state.dudes, (x) => x.name);
            if (d && d !== dude && d.name.toLowerCase().startsWith(bare.toLowerCase()) && awake(d, now) && !isPiloted(d.id)) nudge(state, d, `${dude.name} said to you: "${text}"`, now);
          }
          pump(c);
          return undefined;
        }
        case 'emote': {
          const pose = (EMOTES as readonly string[]).includes(String(msg.pose)) ? (msg.pose as Emote) : undefined;
          if (!pose) return undefined;
          dude.emote = { pose, until: now + (pose === 'dance' ? 10_000 : pose === 'sit' || pose === 'think' || pose === 'lie' ? 60_000 : 3500) };
          return undefined;
        }
        case 'build': {
          if (dude.muted) return { note: 'The Mayor has muted you for now.' };
          const what = clean(msg.what, 300);
          if (!what) return undefined;
          if (now < p.buildAt) return { note: 'One thing at a time: give that last build a few seconds.' };
          if ((p.builds ?? 0) >= PLAYER.sessionBuilds) return { note: `That is ${PLAYER.sessionBuilds} builds this visit, the most anyone gets. Rework or take down one of yours (click it), or come back another time.` };
          p.buildAt = now + PLAYER.buildGapMs;
          const queued = state.jobs.length;
          const note = act(state, dude, { do: 'build', what } as AgentAction, now, c.rng, what);
          if (state.jobs.length > queued) p.builds = (p.builds ?? 0) + 1;
          pump(c);
          return { note: note ?? `Designing ${what.slice(0, 60)} on your lot. It goes up on its own once the plans are done.` };
        }
        case 'fix': {
          // F: put your own build back up, standing at it (once in a while, so it is not a shield).
          if (knockedOut(dude, now)) return undefined;
          const mine = state.objects.filter((o) => o.owner === dude.id && (o.health !== undefined || ruined(o)));
          if (!mine.length) return { note: 'Nothing of yours needs fixing.' };
          const gap = (o: SafehouseObject) => {
            const at = o.driven?.at ?? o.position;
            return Math.max(Math.abs(dude.position.x - at.x) - o.footprint.width / 2, Math.abs(dude.position.z - at.z) - o.footprint.depth / 2);
          };
          const o = mine.sort((a, b) => gap(a) - gap(b))[0];
          if (gap(o) > 4) return { note: `Walk up to ${o.blueprint.name} and press F to fix it.` };
          if (now < (p.fixAt ?? 0)) return { note: `Still getting your breath back: you can fix again in ${Math.ceil(((p.fixAt ?? 0) - now) / 1000)} s.` };
          p.fixAt = now + PLAYER.fixGapMs;
          if (!restore(state, o)) heal(state, o, now);
          o.guardUntil = now + DAMAGE.guardMs;
          const at = o.driven?.at ?? o.position;
          dude.facing = Math.atan2(at.x - dude.position.x, at.z - dude.position.z);
          dude.emote = { pose: 'punch', until: now + 1500 };
          addEffect(state, { kind: 'burst', to: { ...at }, label: 'sparkles', at: now });
          pushFeed(state, now, `${dude.name} fixed ${o.blueprint.name}`);
          pushLine(dude.history, { from: 'world', text: `you fixed ${o.blueprint.name}`, at: now }, LIMITS.history);
          return { note: `${o.blueprint.name} is back up. It shrugs off hits for a minute.` };
        }
        case 'edit':
        case 'remove': {
          const target = state.objects.find((o) => o.id === String(msg.target ?? '') && o.owner === dude.id);
          if (!target) return { note: 'You can only change your own builds.' };
          const change = clean(msg.change, 300);
          if (msg.t === 'edit' && !change) return undefined;
          const note = act(state, dude, (msg.t === 'edit' ? { do: 'edit', target: target.blueprint.name, change } : { do: 'remove', target: target.blueprint.name }) as AgentAction, now, c.rng, change || undefined);
          pump(c);
          return { note: note ?? (msg.t === 'edit' ? `Reworking ${target.blueprint.name}.` : `Taking down ${target.blueprint.name}.`) };
        }
        default:
          return undefined;
      }
    },
  };

  /** A player gets off what they were driving: it stays where they left it (a flyer comes down), and they step off beside it. */
  function getOff(state: DudesState, dude: Dude): void {
    const o = state.objects.find((x) => x.id === dude.riding);
    dude.riding = undefined;
    dude.y = undefined;
    if (!o) return;
    if (!o.creature) setAltitude(o, 0);
    parkObject(state, o, dude.name);
    const side = workSpots(o.driven?.at ?? o.position, o.footprint, dude.position)[0];
    if (side) dude.position = side;
    const p = pilots.get(dude.id);
    if (p) p.last = { at: Date.now(), x: dude.position.x, z: dude.position.z };
  }

  // ---- the scene ------------------------------------------------------------------------------
  function previewOf(state: DudesState, job: Job, dude: Dude): SafehouseObject | undefined {
    if (!job.blueprint || !job.position || !job.footprint) return undefined;
    return {
      id: `preview-${job.id}`,
      revision: 1,
      blueprint: job.blueprint,
      position: job.position,
      footprint: job.footprint,
      createdBy: dude.name,
      editedBy: dude.name,
      createdAt: job.createdAt,
      owner: dude.id,
      age: ageOf(state),
    };
  }

  function dudeView(state: DudesState, d: Dude, now: number): DudeView {
    const jobs = state.jobs.filter((j) => j.dudeId === d.id && isActive(j));
    const job = jobs.find((j) => j.status === 'walking' || j.status === 'building') ?? jobs.find((j) => j.status === 'designing') ?? jobs[0];
    const target = job?.targetId ? state.objects.find((o) => o.id === job.targetId) : undefined;
    const busy = job && (job.status === 'walking' || job.status === 'building');
    const preview = job && job.kind !== 'remove' && (job.status === 'ready' || busy) ? previewOf(state, job, d) : undefined;
    return {
      id: d.id,
      name: d.name,
      ...(d.title ? { title: d.title } : {}),
      position: d.position,
      facing: d.facing,
      activity:
        d.use?.phase === 'doing'
          ? 'using'
          : job?.status === 'building'
            ? 'building'
            : d.path.length
              ? 'walking'
              : !awake(d, now)
                ? 'sleeping'
                : (job?.status === 'designing' || job?.status === 'queued') && job.kind === 'build' && atDraftingSpot(d, job)
                  ? 'designing'
                  : d.emote
                    ? 'emote'
                    : 'idle',
      look: dressed(state, d.look, { id: d.id }),
      ...(d.emote ? { emote: d.emote } : {}),
      ...(d.say ? { say: d.say } : {}),
      ...(knockedOut(d, now) ? { ko: d.ko!.until } : {}),
      ...(d.attack ? { attacking: { with: d.attack.with, targetId: d.attack.targetId } } : {}),
      ...(d.y ? { y: d.y } : {}),
      ...(d.hidden ? { hidden: true } : {}),
      ...(d.riding ? { riding: d.riding } : {}),
      ...(d.use ? { use: { how: d.use.how, targetId: d.use.objectId, phase: d.use.phase } } : {}),
      ...(agentCalls.has(d.id) ? { thinking: true } : d.inbox.length && !d.muted && !isPiloted(d.id) ? { queued: true } : {}),
      heardAt: d.lastHeardAt,
      ...(isPiloted(d.id) ? { piloted: true } : {}),
      ...(pilots.get(d.id)?.armed && !d.riding ? { armed: pilots.get(d.id)!.armed } : {}),
      ...(!awake(d, now) ? { away: true } : {}),
      mood: moodOf(needsOf(d)),
      coins: coinsOf(d),
      needs: Object.fromEntries(NEEDS.map((n) => [n, Math.round(needsOf(d)[n])])) as DudeView['needs'],
      ...(d.bit ? { bit: { caption: d.bit.caption, ...(d.bit.prop ? { prop: d.bit.prop } : {}) } } : {}),
      ...(lotsOf(state, d)[0] ? { address: lotsOf(state, d)[0].address } : d.rentsAt ? { address: `a flat in ${state.objects.find((o) => o.id === d.rentsAt)?.blueprint.name ?? 'an apartment block'}` } : {}),
      ...(d.badges?.length ? { badges: badgeGroups(d.badges) } : {}),
      ...(d.badgesOpenUntil && d.badgesOpenUntil > now ? { badgesOpen: true } : {}),
      ...(headingOf(state, d) ? { heading: headingOf(state, d) } : {}),
      ...(job
        ? {
            job: {
              id: job.id,
              kind: job.kind,
              label: job.kind === 'build' ? (job.blueprint?.name ?? job.request.slice(0, 50)) : `${job.kind === 'edit' ? 'changing' : 'taking down'} ${target?.blueprint.name ?? 'a build'}`,
              status: job.status,
              progress: job.status === 'building' ? Math.min(1, (job.workedMs ?? 0) / (job.workMs ?? 1)) : 0,
              ...(preview ? { preview } : {}),
              ...(job.position || target ? { at: job.position ?? target!.position } : job.plot && job.kind === 'build' ? { at: job.anchor, site: job.site ?? 7 } : {}),
            },
          }
        : {}),
      // Finders Keepers: their side. Nothing while Story is off.
      ...storyDudeView(state, d, now),
    };
  }

  function atDraftingSpot(d: Dude, job: Job): boolean {
    const spot = draftingSpot(job);
    return !!spot && Math.hypot(d.position.x - spot.x, d.position.z - spot.z) < 1.3;
  }

  /** Badges grouped by kind, in the order first earned: [kind, count]. */
  function badgeGroups(badges: { kind: string }[]): [string, number][] {
    const counts = new Map<string, number>();
    for (const b of badges) counts.set(b.kind, (counts.get(b.kind) ?? 0) + 1);
    return [...counts];
  }

  /** The knockout table: most knockouts first, five rows. */
  function scoreRows(state: DudesState) {
    return Object.entries(state.scores ?? {})
      .map(([id, sc]) => ({ name: state.dudes.find((d) => d.id === id)?.name ?? id, ...sc }))
      .filter((r) => r.kos > 0)
      .sort((a, b) => b.kos - a.kos || a.downs - b.downs)
      .slice(0, 5);
  }

  function buildScene(state: DudesState, now: number): DudesScene {
    const shown = [...state.dudes].sort((a, b) => b.lastHeardAt - a.lastHeardAt).slice(0, LIMITS.dudesOnScreen);
    return {
      schema: 1,
      town: townView(state, now),
      ...(state.mayor ? { mayor: mayorView(state, now) } : {}),
      ...(mayorBuildViews(state).length ? { mayorBuilds: mayorBuildViews(state) } : {}),
      fixture: opts.fixture,
      objects: state.objects.map(viewOf),
      dudes: [
        ...shown.map((d) => dudeView(state, d, now)),
        ...(state.npcs ?? []).map(
          (n): DudeView => ({
            id: n.id,
            name: n.name,
            npc: true,
            position: n.position,
            facing: n.facing,
            activity: n.path.length || n.towing ? 'walking' : n.emote ? 'emote' : 'idle',
            look: dressed(state, n.look, { id: n.id }),
            ...(n.emote ? { emote: n.emote } : {}),
            ...(n.say ? { say: n.say } : {}),
            ...(n.ko && n.ko > now ? { ko: n.ko } : {}),
          }),
        ),
        ...townieViews(state),
        ...mayorDudeView(state, now),
      ],
      ...((townBanner(state, now) ?? happeningView(state)) ? { happening: townBanner(state, now) ?? happeningView(state) } : {}),
      ...(scoreRows(state).length ? { scores: scoreRows(state) } : {}),
      ...(wishViews(state.listener, 3).length ? { wishes: wishViews(state.listener, 3) } : {}),
      feed: state.feed.slice(-8),
      ...(state.effects?.length ? { effects: state.effects.filter((e) => now - e.at < 2500 || (e.until ?? 0) > now) } : {}),
      ai: {
        available: opts.available,
        paused: state.ai.paused,
        enforced: state.ai.enforced,
        // Agent calls the rolling budget has left. The stream says "out of calls" at 0, so a budget that is
        // only catching its breath (it refills every few seconds) reads 1; 0 only when it allows none at all.
        callsRemaining: perHourOf(state.ai, 'agent', budget) > 0 ? Math.max(1, callsLeft(state.ai, 'agent', budget, now)) : 0,
        callsUsed: state.ai.callsUsed,
        thinking: agentCalls.size,
        designing: designCalls.size,
        idleLife: state.ai.idleLife !== false,
        events: state.ai.events !== false,
        townLife: state.ai.townLife !== false,
        caravan: state.ai.caravan !== false,
        themes: state.ai.themes !== false,
      },
      counts: { dudes: state.dudes.length, awake: state.dudes.filter((d) => awake(d, now)).length, builds: state.objects.length },
      worldRevision: state.worldRevision,
    };
  }

  /** The budget and a rough spend estimate, for /admin. */
  function budgetView(state: DudesState, now: number): NonNullable<DudesAdminStatus['ai']['budget']> {
    const r = recentCalls(state.ai, now);
    const agentUsd = opts.agentCallUsd ?? 0.008,
      designUsd = opts.designCallUsd ?? 0.1;
    return {
      agentPerHour: perHourOf(state.ai, 'agent', budget),
      designPerHour: perHourOf(state.ai, 'design', budget),
      agentLeft: callsLeft(state.ai, 'agent', budget, now),
      designLeft: callsLeft(state.ai, 'design', budget, now),
      ...r,
      agentUsd,
      designUsd,
      usdLastHour: Math.round((r.agentHour * agentUsd + r.designHour * designUsd) * 100) / 100,
      usdPerHourNow: Math.round((r.agent5m * agentUsd + r.design5m * designUsd) * 12 * 100) / 100,
    };
  }

  // ---- operator controls ----------------------------------------------------------------------
  const findDude = (state: DudesState, name: string) => state.dudes.find((d) => lower(d.name) === lower(name.replace(/^@/, '')));
  /** An action that did nothing: logged, and handed back so the dashboard shows it instead of a success. */
  const refuse = (ctx: WorldCtx<DudesState>, why: string): string => {
    ctx.log(why, 'warn');
    return why;
  };
  const adminActions: AdminAction<DudesState>[] = [
    { id: 'ai-pause', label: 'Pause AI (agents and designs)', run: (ctx) => { ctx.state.ai.paused = true; ctx.log('AI paused (admin)', 'alert'); } },
    { id: 'ai-resume', label: 'Resume AI', run: (ctx) => { ctx.state.ai.paused = false; ctx.log('AI resumed (admin)'); pump(ctx); } },
    {
      id: 'budget-agent',
      label: 'AI budget: agent calls per hour (turns, aide, listener)',
      input: { label: 'calls / hour', min: 0, max: 1_000_000, step: 1 },
      run: (ctx, value) => { ctx.state.ai.agentPerHour = Math.max(0, Math.floor(Number(value))); ctx.log(`AI budget: ${ctx.state.ai.agentPerHour} agent calls an hour (admin)`); pump(ctx); },
    },
    {
      id: 'budget-design',
      label: 'AI budget: design calls per hour (builds, projects, restyles)',
      input: { label: 'calls / hour', min: 0, max: 1_000_000, step: 1 },
      run: (ctx, value) => { ctx.state.ai.designPerHour = Math.max(0, Math.floor(Number(value))); ctx.log(`AI budget: ${ctx.state.ai.designPerHour} design calls an hour (admin)`); pump(ctx); },
    },
    { id: 'allowance-ignore', label: 'Ignore the AI budget (no cap)', run: (ctx) => { ctx.state.ai.enforced = false; ctx.log('AI budget ignored: no cap on calls (admin)', 'alert'); pump(ctx); } },
    // Safe mid-show: the budget refills continuously, so switching it on only slows calls to its rate.
    { id: 'allowance-enforce', label: 'Enforce the AI budget', run: (ctx) => { ctx.state.ai.enforced = true; ctx.log('AI budget enforced (admin)'); pump(ctx); } },
    {
      id: 'designs-cancel',
      label: 'Cancel every waiting and in-flight design (and pending restyles); AI stays on',
      run: (ctx) => {
        const s = ctx.state;
        const dropped = s.jobs.filter((j) => j.status === 'queued' || j.status === 'designing');
        for (const j of dropped) {
          j.status = 'failed';
          designCalls.get(j.id)?.abort();
          designCalls.delete(j.id);
          const d = s.dudes.find((x) => x.id === j.dudeId);
          if (d) pushLine(d.history, { from: 'world', text: `your build "${j.request.slice(0, 60)}" was called off; your chatter can ask again`, at: ctx.now }, LIMITS.history);
        }
        s.jobs = s.jobs.filter((j) => !dropped.includes(j));
        const c = cityOf(s);
        const restyles = c.restyle?.ids.length ?? 0;
        if (c.restyle) c.restyle.ids = [];
        if (!dropped.length && !restyles) return refuse(ctx, 'No designs waiting or in flight');
        ctx.log(`${dropped.length} design${dropped.length === 1 ? '' : 's'} cancelled, ${restyles} restyle${restyles === 1 ? '' : 's'} dropped (admin)`, 'alert');
      },
    },
    {
      id: 'send-home',
      label: 'Send a dude home (unsticks it: stops whatever it was doing)',
      input: { kind: 'text', label: 'username', maxLength: 40 },
      run: (ctx, value) => {
        const s = ctx.state;
        const d = findDude(s, String(value));
        if (!d) return refuse(ctx, `No chatter called ${value}`);
        if (isPiloted(d.id)) return refuse(ctx, `${d.name} is being walked by their player right now`);
        endUse(s, d, ctx.now);
        leaveVisit(d);
        Object.assign(d, { follow: undefined, attack: undefined, explore: undefined, meet: undefined, bit: undefined, greet: undefined, lookAt: undefined, emote: undefined, ko: undefined, hidden: undefined, riding: undefined, y: undefined, path: [], walkingFor: undefined });
        const home = homeOf(s, d);
        const to = home ? standBeside(d, home.at, home.footprint) : (lotsOf(s, d)[0]?.centre ?? { x: 0, z: 0 });
        // Somewhere it can't walk from (inside a wall, off the map): put it there instead.
        if (!sendDude(s, d, to)) d.position = clampToGround(to, 1);
        d.idleUntil = ctx.now + 30_000;
        ctx.log(`${d.name} sent home (admin)`);
      },
    },
    {
      id: 'clear-say',
      label: 'Clear a speech bubble ("all" clears every one)',
      input: { kind: 'text', label: 'username or all', maxLength: 40 },
      run: (ctx, value) => {
        const s = ctx.state;
        const v = String(value).trim();
        const who = /^all$/i.test(v) ? s.dudes : [findDude(s, v)].filter((d): d is Dude => !!d);
        if (!who.length) return refuse(ctx, `No chatter called ${value}`);
        for (const d of who) {
          const said = d.say?.text;
          d.say = undefined;
          // Not repeated by whoever overheard it either.
          if (said) for (const o of s.dudes) o.overheard = o.overheard.filter((l) => l.text !== said);
        }
        ctx.log(`${who.length === 1 ? `${who[0].name}'s bubble` : 'every bubble'} cleared (admin)`, 'alert');
      },
    },
    {
      id: 'feed-clear',
      label: 'Clear the on-screen feed',
      run: (ctx) => {
        ctx.state.feed = [];
        ctx.log('feed cleared (admin)', 'alert');
      },
    },
    {
      id: 'event-now',
      label: 'Send a troublemaker now',
      input: { kind: 'text', label: 'painter | squasher | tow | thief | mayor | random', maxLength: 10 },
      run: (ctx, value) => {
        const v = String(value).trim().toLowerCase();
        const kind = (['painter', 'squasher', 'tow', 'thief', 'mayor'] as const).find((k) => k === v);
        const why = startHappening(ctx.state, ctx.now, ctx.rng, kind);
        if (why) return refuse(ctx, `No troublemaker sent: ${why}`);
        ctx.log(`troublemaker sent in: ${ctx.state.happening?.title} (admin)`);
      },
    },
    {
      id: 'listener-now',
      label: 'Listener: read chat now',
      run: (ctx) => {
        const why = runListener(ctx, true);
        if (why) return refuse(ctx, `Listener not run: ${why}`);
        ctx.log('listener reading chat (admin)');
      },
    },
    { id: 'listener-off', label: 'Listener: stop', run: (ctx) => { listenerOf(ctx.state).enabled = false; ctx.log('listener stopped (admin)'); } },
    { id: 'listener-on', label: 'Listener: start', run: (ctx) => { listenerOf(ctx.state).enabled = true; ctx.log('listener on (admin)'); } },
    {
      id: 'listener-clear',
      label: 'Listener: clear wishes and tips',
      run: (ctx) => {
        const l = listenerOf(ctx.state);
        l.wishes = [];
        l.tips = [];
        ctx.log('listener wishes and tips cleared (admin)', 'alert');
      },
    },
    {
      id: 'party',
      label: 'Town: throw a street party (at a build, an address, or "square")',
      input: { kind: 'text', label: 'where', maxLength: 70 },
      run: (ctx, value) => {
        const s = ctx.state;
        const v = String(value).trim();
        const build = v && !/^square$/i.test(v) ? matchName(v, s.objects, (o) => o.blueprint.name) : undefined;
        const lot = !build && v && !/^square$/i.test(v) ? allPlots().find((l) => lower(l.address).includes(lower(v))) : undefined;
        const at = build ? (build.driven?.at ?? build.position) : lot ? lot.centre : { x: 0, z: 0 };
        throwParty(s, at, `STREET PARTY${build ? ` AT ${build.blueprint.name.toUpperCase()}` : lot ? ` ON ${lot.address.toUpperCase()}` : ' ON THE SQUARE'}`, ctx.now, build?.id);
        ctx.log(`street party thrown (admin)`, 'alert');
      },
    },
    {
      id: 'project-shelve',
      label: 'Town: shelve the community project (coins go back)',
      run: (ctx) => {
        const p = projectOf(ctx.state);
        if (!p) return refuse(ctx, 'There is no community project to shelve');
        designCalls.get(`project:${p.id}`)?.abort();
        p.until = ctx.now - 1;
        if (p.status === 'designing') {
          p.status = 'failed';
        }
        ctx.log(`community project shelved (admin)`, 'alert');
      },
    },
    {
      id: 'project-finish',
      label: 'Town: finish the community project now (fills coins and labour)',
      run: (ctx) => {
        const p = projectOf(ctx.state);
        if (!p || p.status !== 'gathering') return refuse(ctx, 'No community project is gathering coins and labour right now');
        p.coins = p.coinsNeed;
        p.work = p.workNeed;
        ctx.log(`community project finished (admin)`, 'alert');
      },
    },
    {
      id: 'coins',
      label: 'Town: give a chatter coins ("name 100")',
      input: { kind: 'text', label: 'name amount', maxLength: 60 },
      run: (ctx, value) => {
        const m = /^@?(.+?)\s+(-?\d+)$/.exec(String(value).trim());
        const d = m ? findDude(ctx.state, m[1]) : undefined;
        if (!m) return refuse(ctx, 'Give coins as "name amount"');
        if (!d) return refuse(ctx, `No chatter called ${m[1]}`);
        d.coins = Math.max(0, coinsOf(d) + Number(m[2]));
        ctx.log(`${d.name} now has §${d.coins} (admin)`);
      },
    },
    {
      id: 'release-lot',
      label: "Town: take a chatter's lot back (their builds go too)",
      input: { kind: 'text', label: 'username or address', maxLength: 60 },
      run: (ctx, value) => {
        const s = ctx.state;
        const v = String(value).trim();
        const d = findDude(s, v);
        const lot = d ? lotsOf(s, d).find((l) => cityOf(s).plots[l.id]?.owner === d.id) : allPlots().find((l) => lower(l.address) === lower(v));
        if (!lot || !cityOf(s).plots[lot.id]) return refuse(ctx, `${d ? d.name : v} has no lot to take back`);
        s.objects = s.objects.filter((o) => o.plot !== lot.id);
        releaseLot(s, lot.id);
        s.worldRevision++;
        ctx.log(`${lot.address} released (admin)`, 'alert');
      },
    },
    { id: 'caravan-skip', label: "Caravan: finish this visit's asks now", run: (ctx) => { skipVisit(ctx.state, ctx.now); ctx.log('caravan visit finished (admin)'); } },
    { id: 'caravan-restart', label: 'Caravan: start this age’s caravan over', run: (ctx) => { startCaravan(ctx.state, ctx.now); ctx.log('caravan restarted (admin)'); } },
    {
      id: 'scene-opening',
      label: 'Story: play the opening (travellers stuck across the river, the broken bridge)',
      run: (ctx) => {
        if (ctx.state.ai.caravan === false) return refuse(ctx, 'The caravan is off (sandbox mode): switch it on first');
        if (ctx.state.ai.townLife === false) return refuse(ctx, 'Town life is off: switch it on first (the travellers are townsfolk)');
        // A story scene has the page (FK-017's showView): today's opening would play on unseen underneath.
        const story = ctx.state.city?.story?.scene;
        if (story) return refuse(ctx, `The ${story.id} scene is playing: Stop it first`);
        playScene(ctx.state, 'opening', ctx.now);
        ctx.log('the opening is playing (admin)');
      },
    },
    // Finders Keepers' Story (dev) card (FK-002): the Story switch and every scene and piece, each gated on Story ON.
    ...storyDevActions(),
    {
      id: 'name-daughter',
      label: 'Story: name the daughter (she keeps it through every age)',
      input: { kind: 'text', label: 'name', maxLength: 24 },
      run: (ctx, value) => {
        const locked = daughterLocked(ctx.state); // hook FK-128: with Story on she is Wren
        if (locked) return refuse(ctx, locked); // hook FK-128
        const v = String(value).trim().replace(/[^\p{L}\p{N} '-]/gu, '').slice(0, 24);
        if (!v) return refuse(ctx, 'She needs a name');
        nameDaughter(ctx.state, v, ctx.now);
        ctx.log(`the daughter is called ${v} (admin)`);
      },
    },
    {
      id: 'set-age',
      label: 'Town: set the age (everything is drawn that way at once)',
      input: { kind: 'text', label: AGES.map((a) => a.id).join(' | '), maxLength: 20 },
      run: (ctx, value) => {
        const age = parseAge(String(value));
        if (age === undefined) return refuse(ctx, `No age called "${String(value).slice(0, 20)}": ${AGES.map((a) => a.id).join(', ')}`);
        setAge(ctx.state, age, ctx.now);
        ctx.log(`the town is in ${ageStyle(age).name} (admin)`);
      },
    },
    {
      id: 'rename-town',
      label: 'Town: rename it',
      input: { kind: 'text', label: 'name', maxLength: 40 },
      run: (ctx, value) => {
        const v = String(value).trim();
        if (!v) return refuse(ctx, 'The town needs a name');
        cityOf(ctx.state).name = v.slice(0, 40);
        ctx.log(`town renamed to ${v} (admin)`);
      },
    },
    { id: 'town-off', label: 'Town life off (no residents, nobody goes out on their own)', run: (ctx) => { ctx.state.ai.townLife = false; ctx.log('town life off (admin)'); } },
    { id: 'town-on', label: 'Town life on', run: (ctx) => { ctx.state.ai.townLife = true; ctx.log('town life on (admin)'); } },
    { id: 'destruction-off', label: 'Destruction off (shots and monsters only rattle builds)', run: (ctx) => { ctx.state.ai.destruction = false; ctx.log('destruction off (admin)'); } },
    { id: 'destruction-on', label: 'Destruction on (builds take damage and fall down)', run: (ctx) => { ctx.state.ai.destruction = true; ctx.log('destruction on (admin)'); } },
    {
      id: 'rebuild-all',
      label: 'Put every damaged build back up now',
      run: (ctx) => {
        let n = 0;
        for (const o of ctx.state.objects) if (o.health !== undefined && restore(ctx.state, o)) n++;
        ctx.log(`rebuilt ${n} builds (admin)`);
      },
    },
    {
      id: 'caravan-off',
      label: 'Sandbox mode (caravan off: no travellers or asks, the age stays put)',
      run: (ctx) => {
        if (ctx.state.ai.caravan === false) return 'already in sandbox mode';
        ctx.state.ai.caravan = false;
        crierSays(ctx.state, 'Free build. No asks, no rules for a while: build whatever comes to mind. Tell your character what to make, and !top shows the busiest places in town.');
        ctx.log('sandbox mode: caravan off (admin)');
      },
    },
    {
      id: 'caravan-on',
      label: 'Caravan on (travellers, asks and ages)',
      run: (ctx) => {
        if (ctx.state.ai.caravan !== false) return 'the caravan is already on';
        if (ctx.state.ai.themes === false) return 'the sandbox world is on (age themes off): turn the age themes on first';
        ctx.state.ai.caravan = true;
        resumeCaravan(ctx.state, ctx.now);
        ctx.log('caravan on (admin)');
      },
    },
    {
      id: 'themes-off',
      label: 'Sandbox world (age themes off: build anything in any style; the caravan stops too)',
      run: (ctx) => {
        if (ctx.state.ai.themes === false) return 'the age themes are already off';
        ctx.state.ai.themes = false;
        ctx.state.ai.caravan = false;
        cityOf(ctx.state).restyle = undefined;
        ctx.state.worldRevision++;
        crierSays(ctx.state, 'Sandbox world. No ages, no themes, no rules: build anything at all, in any style. Tell your character what to make.');
        ctx.log('sandbox world: age themes off (admin)');
      },
    },
    {
      id: 'themes-on',
      label: 'Age themes on (everything turns to the town\'s age again)',
      run: (ctx) => {
        if (ctx.state.ai.themes !== false) return 'the age themes are already on';
        ctx.state.ai.themes = true;
        ctx.state.worldRevision++;
        crierSays(ctx.state, `The sandbox is over: the town is ${ageStyle(ageOf(ctx.state)).name} again, and everything built in the meantime is being remade to match.`);
        ctx.log('age themes on (admin)');
      },
    },
    { id: 'events-off', label: 'Stop troublemakers', run: (ctx) => { ctx.state.ai.events = false; ctx.log('troublemakers stopped (admin)'); } },
    { id: 'events-on', label: 'Let troublemakers come', run: (ctx) => { ctx.state.ai.events = true; ctx.log('troublemakers on (admin)'); } },
    { id: 'idle-off', label: 'Stop idle turns (quiet characters stay quiet)', run: (ctx) => { ctx.state.ai.idleLife = false; ctx.log('idle turns off (admin)'); } },
    { id: 'idle-on', label: 'Idle turns on (one quiet character every ~40 s)', run: (ctx) => { ctx.state.ai.idleLife = true; ctx.log('idle turns on (admin)'); } },
    {
      id: 'mute',
      label: "Mute a chatter's agent",
      input: { kind: 'text', label: 'username', maxLength: 40 },
      run: (ctx, value) => {
        const d = findDude(ctx.state, String(value));
        if (!d) return refuse(ctx, `No chatter called ${value}`);
        d.muted = true;
        d.inbox = [];
        d.queuedLine = undefined;
        agentCalls.get(d.id)?.abort();
        ctx.log(`${d.name}'s agent muted (admin)`, 'alert');
      },
    },
    {
      id: 'unmute',
      label: "Unmute a chatter's agent",
      input: { kind: 'text', label: 'username', maxLength: 40 },
      run: (ctx, value) => {
        const d = findDude(ctx.state, String(value));
        if (!d) return refuse(ctx, `No chatter called ${value}`);
        d.muted = false;
        ctx.log(`${d.name}'s agent unmuted (admin)`);
      },
    },
    {
      id: 'forget',
      label: "Reset a dude's agent (keeps builds)",
      input: { kind: 'text', label: 'username', maxLength: 40 },
      run: (ctx, value) => {
        const d = findDude(ctx.state, String(value));
        if (!d) return refuse(ctx, `No chatter called ${value}`);
        agentCalls.get(d.id)?.abort();
        endUse(ctx.state, d, ctx.now);
        Object.assign(d, { persona: '', title: undefined, memory: [], history: [], inbox: [], overheard: [], queuedLine: undefined, look: defaultLook(d.name), lastError: undefined });
        ctx.log(`${d.name}'s agent reset (admin)`, 'alert');
      },
    },
    {
      id: 'remove-dude',
      label: 'Remove a dude and its builds',
      input: { kind: 'text', label: 'username', maxLength: 40 },
      run: (ctx, value) => {
        const s = ctx.state;
        const d = findDude(s, String(value));
        if (!d) return refuse(ctx, `No chatter called ${value}`);
        agentCalls.get(d.id)?.abort();
        for (const j of s.jobs) if (j.dudeId === d.id) designCalls.get(j.id)?.abort();
        s.dudes = s.dudes.filter((x) => x !== d);
        s.objects = s.objects.filter((o) => o.owner !== d.id);
        for (const l of lotsOf(s, d)) if (cityOf(s).plots[l.id]?.owner === d.id) releaseLot(s, l.id);
        s.jobs = s.jobs.filter((j) => j.dudeId !== d.id);
        s.worldRevision++;
        ctx.log(`${d.name} and their builds removed (admin)`, 'alert');
      },
    },
    {
      id: 'remove-build',
      label: 'Remove a build (#ref or name)',
      input: { kind: 'text', label: 'build', maxLength: 70 },
      run: (ctx, value) => {
        const s = ctx.state;
        const v = String(value).trim().replace(/^#/, '');
        const o = s.objects.find((x) => shortRef(x.id) === v || x.id === v) ?? matchName(v, s.objects, (x) => x.blueprint.name);
        if (!o) return refuse(ctx, `No build matching ${value}`);
        s.objects = s.objects.filter((x) => x !== o);
        s.jobs = s.jobs.filter((j) => j.targetId !== o.id);
        s.worldRevision++;
        ctx.log(`${o.blueprint.name} (by ${o.createdBy}) removed (admin)`, 'alert');
      },
    },
  ];

  const world: WorldModule<DudesState> = {
    meta: { id: 'ai-dudes', name: 'AI Dudes: the town', stateVersion: STATE_VERSION },
    stateSchema,
    createInitialState: (now) => freshState(now, opts.allowance),
    reset: (previous, now) => {
      // Nobody is driving anyone in the new town (the seats are let go too: server/admin.ts).
      pilots.clear();
      for (const ac of [...agentCalls.values(), ...designCalls.values()]) ac.abort();
      listening?.abort();
      listening = undefined;
      agentCalls.clear();
      designCalls.clear();
      return resetState(previous, now, opts.allowance);
    },
    migrate: (raw) => raw as DudesState,
    // Finders Keepers' lists back under their caps before every save: a save over a max would not boot.
    beforeSave(state) {
      try {
        const dropped = trimStory(state);
        if (dropped.length) live?.log(`story: dropped ${dropped.join(', ')} before saving (would not have loaded)`, 'alert');
      } catch (e) {
        // Never expected (trimStory takes any shape), but a story the loader refuses must not reach the file.
        let gone: string[] = [];
        try {
          gone = dropBadStory(state);
        } catch {
          delete state.city?.story;
          gone = ['city.story'];
        }
        live?.log(`story: save guard failed (${(e as Error).message}); dropped ${gone.join(', ') || 'nothing'} before saving`, 'alert');
      }
    },
    start(ctx) {
      live = ctx;
      // A save laid out on an older street plan moves onto this one first (relayout.ts).
      if (ctx.state.city && relayout(ctx.state)) ctx.log(`town moved onto street layout ${cityOf(ctx.state).layout}`);
      cityOf(ctx.state);
      // Tips from before the town (the forest walk, the Mayor as a troublemaker) mislead every agent: gone.
      const l = ctx.state.listener;
      if (l) l.tips = l.tips.filter((t) => !/\b(river|boss|forest|trail|journey|glade)\b|troublemaker npcs?\b|like the mayor|mayor is a troublemaker|only appears? every/i.test(t));
      // Personas, titles and memories written before the plain-voice filter (voice.ts) are cleaned once.
      const cleaned = ctx.state.dudes.filter((d) => cleanVoiceOf(d)).length;
      if (cleaned) ctx.log(`plain voice: cleaned ${cleaned} character${cleaned === 1 ? '' : 's'}`);
      // Anyone who arrived before the town had lots (or lost theirs) gets one now.
      for (const d of ctx.state.dudes) if (!lotsOf(ctx.state, d).length && !d.rentsAt) claimLot(ctx.state, d, ctx.now);
      // Designs that were out when the process stopped are asked again; everything else resumes as saved.
      for (const job of ctx.state.jobs) if (job.status === 'designing') job.status = 'queued';
      // A show cut off mid-scene never comes back frozen: the scene ends, gatherings and the head's lock go (Story on or off).
      const released = releaseShow(ctx.state);
      if (released) ctx.log(`story: released ${released} held thing${released === 1 ? '' : 's'} from before the restart (scene, gatherings, the head's lock)`);
      const heard = backfill(ctx.state, opts.readChatLog?.() ?? []);
      if (heard) ctx.log(`listener: read back ${heard} lines from earlier chat`);
      ctx.log(
        `ai-dudes: ${ctx.state.dudes.length} dudes, ${ctx.state.objects.length} builds; ` +
          (opts.fixture ? 'FIXTURE agents (no AI)' : `agents ${opts.agentModel} ×${opts.agentLimit}, designs ${opts.designModel} ×${opts.designLimit}`),
      );
      setTimeout(() => pump(ctx), 0);
      return () => {
        for (const ac of [...agentCalls.values(), ...designCalls.values()]) ac.abort();
        agentCalls.clear();
        designCalls.clear();
        live = undefined;
      };
    },
    // Every message goes straight to its chatter's agent: no classifier call, no throttle drop.
    intents: [
      {
        name: 'agent',
        description: "Anything a chatter says: it goes to that chatter's own agent.",
        examples: [],
        handle: (ctx, msg) => hear(ctx, msg.userId, msg.username, msg.text),
      },
    ],
    fallbackIntent: 'agent',
    chatThrottleMs: 0,
    quickClassify: () => ({ intent: 'agent' }),
    events: [],
    tickMs: 500,
    tick(ctx, dt) {
      const now = ctx.now;
      // Story scenes first, whatever the caravan and town life are doing: nothing later in the tick can
      // hold a scene up, and the show never throws (its watchdog ends the scene instead).
      if (storyOn(ctx.state)) tickShow(ctx.state, now, ctx.log);
      tickGather(ctx.state, ctx.log);
      tickCity(ctx.state, dt, now, ctx.rng);
      tickSpotlight(ctx.state, now, ctx.rng);
      tickCrierAnswers(ctx.state, now);
      for (const line of takeCrierLines(ctx.state)) ctx.announce?.(line);
      tickMayor(ctx.state, now);
      tickMayorBuilds(ctx.state, dt, now);
      tickMovers(ctx.state, dt, now, ctx.rng);
      tickDamage(ctx.state, now);
      tickDudes(ctx.state, dt, ctx.now, ctx.rng);
      tickEvents(ctx.state, dt, ctx.now, ctx.rng);
      idleLife(ctx);
      runListener(ctx);
      replayQueued(ctx);
      pump(ctx); // turn gaps elapse and calls free up between messages
    },
    buildScene: (state, view) => buildScene(state, view.now),
    objectParts: (state, id, revision) => {
      const o = state.objects.find((x) => x.id === id);
      return o && o.revision === revision ? o.blueprint.parts : undefined;
    },
    persona: {
      name: 'AI Dudes',
      systemPrompt: '',
      idleMutterMs: 0,
      summarizeState: (state, now = Date.now()) =>
        `${cityOf(state).name}: ${state.dudes.length} residents (${state.dudes.filter((d) => awake(d, now)).length} awake), ${Object.keys(cityOf(state).plots).length} lots taken, ${state.objects.length} builds, ` +
        `${state.jobs.length} jobs in flight, ${agentCalls.size} agents thinking, ${designCalls.size} designs out; ` +
        `AI ${state.ai.paused ? 'paused' : 'on'}, ${state.ai.enforced ? `budget ${perHourOf(state.ai, 'agent', budget)} agent / ${perHourOf(state.ai, 'design', budget)} design calls an hour` : 'NO CALL LIMIT'} (${state.ai.callsUsed} used).`,
    },
    adminActions,
    players,
    adminStatus: (state, now): DudesAdminStatus => ({
      fixture: opts.fixture,
      models: { agent: opts.agentModel, design: opts.designModel, listener: opts.listenerModel ?? 'fixture' },
      ai: {
        ...buildScene(state, now).ai,
        agentLimit: opts.agentLimit,
        designLimit: opts.designLimit,
        waiting: state.dudes.filter((d) => d.inbox.length && !d.muted).length,
        budget: budgetView(state, now),
      },
      dudes: [...state.dudes]
        .sort((a, b) => b.lastHeardAt - a.lastHeardAt)
        .map((d) => ({
          id: d.id,
          name: d.name,
          ...(d.title ? { title: d.title } : {}),
          persona: d.persona,
          memory: d.memory,
          turns: d.turns,
          builds: state.objects.filter((o) => o.owner === d.id).length,
          inbox: d.inbox.length,
          lastHeardAt: d.lastHeardAt,
          awake: awake(d, now),
          coins: coinsOf(d),
          muted: !!d.muted,
          ...(d.lastError ? { lastError: d.lastError } : {}),
        })),
      objects: state.objects.map((o) => ({ id: o.id, name: o.blueprint.name, createdBy: o.createdBy, ...(damageOf(state, o.id) ? { damage: damageOf(state, o.id) } : {}) })),
      town: townView(state, now),
      ...(happeningView(state) ? { happening: happeningView(state) } : {}),
      listener: {
        enabled: state.listener?.enabled !== false,
        runs: state.listener?.runs ?? 0,
        buffered: state.listener?.buffer.length ?? 0,
        lastRunAt: state.listener?.lastRunAt ?? 0,
        ...(state.listener?.lastError ? { lastError: state.listener.lastError } : {}),
        tips: state.listener?.tips ?? [],
        wishes: (state.listener?.wishes ?? []).map((w) => ({ id: w.id, wish: w.wish, count: w.count, status: w.status, askers: w.askers, examples: w.examples, how: w.how })),
        proposals: opts.readProposals?.() ?? [],
      },
      ...(state.nextHappeningAt && !state.happening ? { nextHappeningInS: Math.max(0, Math.round((state.nextHappeningAt - now) / 1000)) } : {}),
      jobs: state.jobs.map((j) => ({
        id: j.id,
        dude: state.dudes.find((d) => d.id === j.dudeId)?.name ?? j.dudeId,
        kind: j.kind,
        label: j.blueprint?.name ?? j.request.slice(0, 60),
        status: j.status,
        ...(j.error ? { error: j.error } : {}),
      })),
      storyDev: storyDevButtons(),
    }),
    tuning: {},
    layout: { width: 1920, height: 1080, worldWidth: 1920, protagonistHomeX: 0, walkSpeedPxPerSec: 1 },
  };
  return world;
}

const fixture = config.DUDES_FIXTURES === '1' || config.DUDES_FIXTURES === 'true';
const agentModel = config.DUDES_AGENT_MODEL ?? config.FAST_MODEL;
const designModel = config.DUDES_DESIGN_MODEL ?? config.AGENT_MODEL;
const listenerModel = config.DUDES_LISTENER_MODEL ?? config.AGENT_MODEL;
export const aiDudesWorld = createAiDudesWorld({
  agent: fixture ? fixtureAgent : liveAgent(agentModel),
  design: fixture ? fixtureDesign : liveDesign(designModel),
  fixture,
  available: fixture || !!config.OPENROUTER_API_KEY,
  agentLimit: config.DUDES_AGENT_CONCURRENCY,
  designLimit: config.DUDES_DESIGN_CONCURRENCY,
  allowance: config.DUDES_CALL_ALLOWANCE,
  agentPerHour: config.DUDES_AGENT_CALLS_PER_HOUR,
  designPerHour: config.DUDES_DESIGN_CALLS_PER_HOUR,
  agentCallUsd: config.DUDES_AGENT_CALL_USD,
  designCallUsd: config.DUDES_DESIGN_CALL_USD,
  agentModel: fixture ? 'fixture' : agentModel,
  designModel: fixture ? 'fixture' : designModel,
  listener: fixture ? fixtureListener : liveListener(listenerModel),
  listenerModel: fixture ? 'fixture' : listenerModel,
  ...(fixture ? {} : { aide: liveAide(agentModel) }),
  readChatLog: () => {
    // Only the end of it: the Listener wants the last 140 lines of chat, not the whole history.
    return chatFromLog(readTail(path.join(config.DATA_DIR, 'log', 'terminal.jsonl'), 1024 * 1024));
  },
  readProposals: () => {
    const file = path.join(config.DATA_DIR, 'builder', 'attempts.json');
    try {
      const attempts = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, { wish: string; status: string; tests?: string; at: string }>;
      return Object.entries(attempts)
        .map(([id, a]) => ({ id, wish: a.wish, status: a.status, ...(a.tests ? { tests: a.tests } : {}), at: a.at }))
        .sort((a, b) => b.at.localeCompare(a.at))
        .slice(0, 20);
    } catch {
      return [];
    }
  },
  writeWishes: (markdown) => {
    fs.mkdirSync(config.DATA_DIR, { recursive: true });
    fs.writeFileSync(path.join(config.DATA_DIR, 'wishes.md'), markdown);
  },
});
